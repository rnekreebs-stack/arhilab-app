import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
import { hashPassword, hashToken } from '../../src/services/security.js';

const password = 'independent verification password 123';
type TokenResponse = { accessToken: string; refreshToken: string; sessionId: string };
let server: Server, base: string;

async function request(path: string, method = 'GET', body?: object, accessToken?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} };
}
async function organization() {
  const id = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [id, 'Verification ' + id]);
  return id;
}
async function user(org: string, role: 'admin' | 'manager' | 'worker') {
  const id = randomUUID(), email = `${id}@test.example`;
  await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)', [id,org,email,'Verification user',role,await hashPassword(password)]);
  return { id, email };
}
async function login(org: string, email: string, deviceId = randomUUID(), pass = password) {
  const result = await request('/api/v1/auth/login','POST',{ organizationId:org,email,password:pass,deviceId });
  assert.equal(result.status,200);
  return result.body as unknown as TokenResponse;
}

before(async () => {
  server = createApp().listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing port');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

for (const change of [{role:'worker'}, {active:false}] as const) {
  test(`concurrent cross-admin ${'role' in change ? 'demotion' : 'deactivation'} preserves an active admin`, async () => {
    const org = await organization(), a = await user(org,'admin'), b = await user(org,'admin');
    const aTokens = await login(org,a.email), bTokens = await login(org,b.email);
    const [aToB,bToA] = await Promise.all([
      request(`/api/v1/users/${b.id}`,'PATCH',change,aTokens.accessToken),
      request(`/api/v1/users/${a.id}`,'PATCH',change,bTokens.accessToken),
    ]);
    assert.equal([aToB,bToA].filter(result => result.status === 200).length,1);
    assert.ok([403,409].includes([aToB,bToA].find(result => result.status !== 200)?.status ?? 0));
    const count = await pool.query<{count:string}>("SELECT count(*)::text AS count FROM users WHERE organization_id=$1 AND active AND role='admin'",[org]);
    assert.equal(Number(count.rows[0]?.count),1);
  });
}

test('concurrent refresh consumes one token and revokes the whole session on reuse', async () => {
  const org = await organization(), admin = await user(org,'admin'), original = await login(org,admin.email);
  const [first,second] = await Promise.all([
    request('/api/v1/auth/refresh','POST',{refreshToken:original.refreshToken}),
    request('/api/v1/auth/refresh','POST',{refreshToken:original.refreshToken}),
  ]);
  assert.deepEqual([first.status,second.status].sort(),[200,401]);
  const rotated = (first.status === 200 ? first.body : second.body) as unknown as TokenResponse;
  assert.equal((await request('/api/v1/users','GET',undefined,rotated.accessToken)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:rotated.refreshToken})).status,401);
  const rows = await pool.query<{revoked_at:Date|null;count:string}>(`SELECT s.revoked_at,count(r.id)::text AS count FROM sessions s JOIN refresh_credentials r ON r.session_id=s.id WHERE s.id=$1 GROUP BY s.revoked_at`,[original.sessionId]);
  assert.ok(rows.rows[0]?.revoked_at);
  assert.equal(rows.rows[0]?.count,'2');
});

test('device revoke invalidates access and refresh, rejects its ID, preserves another device', async () => {
  const org = await organization(), admin = await user(org,'admin'), deviceA = randomUUID(), deviceB = randomUUID();
  const a = await login(org,admin.email,deviceA), b = await login(org,admin.email,deviceB);
  assert.equal((await request(`/api/v1/devices/${deviceA}/revoke`,'POST',undefined,b.accessToken)).status,204);
  assert.equal((await request('/api/v1/users','GET',undefined,a.accessToken)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:a.refreshToken})).status,401);
  assert.equal((await request('/api/v1/auth/login','POST',{organizationId:org,email:admin.email,password,deviceId:deviceA})).status,401);
  assert.equal((await request('/api/v1/users','GET',undefined,b.accessToken)).status,200);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:b.refreshToken})).status,200);
});

test('deactivation invalidates existing sessions and reactivation never revives them', async () => {
  const org = await organization(), admin = await user(org,'admin'), worker = await user(org,'worker');
  const adminTokens = await login(org,admin.email), workerTokens = await login(org,worker.email);
  assert.equal((await request(`/api/v1/users/${worker.id}`,'PATCH',{active:false},adminTokens.accessToken)).status,200);
  assert.equal((await request('/api/v1/auth/login','POST',{organizationId:org,email:worker.email,password,deviceId:randomUUID()})).status,401);
  assert.equal((await request('/api/v1/auth/logout-all','POST',undefined,workerTokens.accessToken)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:workerTokens.refreshToken})).status,401);
  assert.equal((await request(`/api/v1/users/${worker.id}`,'PATCH',{active:true},adminTokens.accessToken)).status,200);
  assert.equal((await request('/api/v1/auth/logout-all','POST',undefined,workerTokens.accessToken)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:workerTokens.refreshToken})).status,401);
  assert.equal((await request('/api/v1/auth/login','POST',{organizationId:org,email:worker.email,password,deviceId:randomUUID()})).status,200);
});

test('cross-tenant user, device and session operations all hide resource existence', async () => {
  const orgA = await organization(),orgB = await organization(),adminA = await user(orgA,'admin'),adminB = await user(orgB,'admin');
  const deviceB = randomUUID(), a = await login(orgA,adminA.email), b = await login(orgB,adminB.email,deviceB);
  const hidden = [
    await request(`/api/v1/users/${adminB.id}`,'GET',undefined,a.accessToken),
    await request(`/api/v1/users/${adminB.id}`,'PATCH',{displayName:'Changed'},a.accessToken),
    await request(`/api/v1/users/${adminB.id}`,'PATCH',{active:false},a.accessToken),
    await request(`/api/v1/users/${adminB.id}`,'PATCH',{role:'worker'},a.accessToken),
    await request(`/api/v1/users/${adminB.id}/devices`,'GET',undefined,a.accessToken),
    await request(`/api/v1/devices/${deviceB}/revoke`,'POST',undefined,a.accessToken),
    await request(`/api/v1/users/${adminB.id}/revoke-sessions`,'POST',undefined,a.accessToken),
  ];
  for (const result of hidden) { assert.equal(result.status,404); assert.equal(result.body.error,'Not found'); }
  assert.equal((await request('/api/v1/users','GET',undefined,b.accessToken)).status,200);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:b.refreshToken})).status,200);
  assert.equal((await pool.query('SELECT id FROM users WHERE id=$1 AND role=$2 AND active',[adminB.id,'admin'])).rowCount,1);
  assert.equal((await pool.query('SELECT revoked_at FROM devices WHERE id=$1 AND revoked_at IS NULL',[deviceB])).rowCount,1);
  assert.equal((await pool.query('SELECT token_hash FROM refresh_credentials WHERE token_hash=$1',[hashToken(b.refreshToken)])).rowCount,1);
});
