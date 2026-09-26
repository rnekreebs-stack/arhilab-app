import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/database/pool.js';
import { hashPassword } from '../../src/services/security.js';
import { packageHash,packageSchema } from '../../src/migration/package.js';
import { snapshotForBootstrap } from '../../src/sync/snapshot.js';

const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),foreignAdmin=randomUUID(),worker=randomUUID();
const device=randomUUID(),secondDevice=randomUUID(),foreignDevice=randomUUID(),password='stage four fixture password 123';
let server:Server,base:string,access:string,access2:string,foreign:string,workerAccess:string;
async function request(path:string,method='GET',body?:object,token?:string) {
  const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const raw=await response.text();
  return {status:response.status,body:raw?JSON.parse(raw) as Record<string,unknown>:{}};
}
async function login(organizationId:string,userId:string,deviceId:string) {
  const response=await request('/api/v1/auth/login','POST',{organizationId,email:userId+'@test.example',password,deviceId});
  assert.equal(response.status,200);
  return String(response.body.accessToken);
}
before(async()=>{
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[org,'Migration fixture '+org,otherOrg,'Migration foreign '+otherOrg]);
  const hash=await hashPassword(password);
  for(const [id,organization,role] of [[admin,org,'admin'],[foreignAdmin,otherOrg,'admin'],[worker,org,'worker']])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,organization,id+'@test.example',role,role,hash]);
  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No port');base=`http://127.0.0.1:${address.port}`;
  access=await login(org,admin,device);access2=await login(org,admin,secondDevice);
  foreign=await login(otherOrg,foreignAdmin,foreignDevice);workerAccess=await login(org,worker,randomUUID());
});
after(async()=>{if(server) await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

test('golden 0.6.2 migration blocks currency, resumes chunks, preserves snapshot, finalizes, and feeds another device',async()=>{
  const session=randomUUID(),project=randomUUID(),line=randomUUID(),material=randomUUID(),task=randomUUID(),payment=randomUUID();
  const fixture=packageSchema.parse({format:'ArhilabMigration-1',sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,
    exportedAt:'2026-01-01T00:00:00.000Z',catalog:{works:[{name:'Work',tiers:{standard:{materialCost:33}}}]},
    team:[{id:randomUUID(),name:'Legacy admin',login:'legacy',role:'admin'}],
    projects:[{id:project,name:'Building',address:'Historic address',client:'Legacy client',discount:15,
      lines:[{id:line,name:'Brickwork',qty:2,coef:1.25,price:40,key:'work-brick'}],
      materials:[{id:material,name:'Brick',qty:20,cost:2,unit:'pcs'}],
      tasks:[{id:task,name:'Inspect',status:'В работе'}],
      payments:[{id:payment,amount:99.5,kind:'income',date:'2026-01-01'}],notes:[{text:'Legacy note'}],photos:[]}],
  });
  const hash=packageHash(fixture);
  const prefix='/api/v1/migrations';
  const preflight=await request(prefix+'/preflight','POST',fixture,access);
  assert.equal(preflight.status,200);assert.equal(preflight.body.valid,false);
  assert.equal(preflight.body.packageHash,hash);
  assert.equal((await pool.query('SELECT 1 FROM projects WHERE organization_id=$1',[org])).rowCount,0);
  assert.equal((await request(prefix+'/preflight','POST',fixture,workerAccess)).status,403);
  const creation={id:session,packageHash:hash,expectedChunks:1,sourceFormat:fixture.sourceFormat,sourceAppVersion:fixture.sourceAppVersion,
    sourceSchemaVersion:fixture.sourceSchemaVersion,exportedAt:fixture.exportedAt,catalog:fixture.catalog,team:fixture.team};
  assert.equal((await request(prefix,'POST',creation,access)).status,201);
  assert.equal((await request(prefix,'POST',creation,access2)).body.duplicate,true);
  assert.equal((await request(prefix,'POST',{...creation,expectedChunks:2},access)).status,409);
  assert.equal((await request(prefix+'/'+session+'/verify','POST',undefined,access)).status,409);
  assert.equal((await request(prefix+'/'+session+'/chunks/0','PUT',{projects:fixture.projects},access)).status,200);
  assert.equal((await request(prefix+'/'+session+'/chunks/0','PUT',{projects:fixture.projects},access2)).body.status,'duplicate');
  assert.equal((await request(prefix+'/'+session+'/chunks/0','PUT',{projects:[]},access)).status,409);
  for(const path of [prefix+'/'+session,prefix+'/'+session+'/issues',prefix+'/'+session+'/verify',prefix+'/'+session+'/finalize'])
    assert.equal((await request(path,path.endsWith('verify')||path.endsWith('finalize')?'POST':'GET',undefined,foreign)).status,404);
  const blocked=await request(prefix+'/'+session+'/verify','POST',undefined,access);
  assert.equal(blocked.status,200);assert.equal(blocked.body.status,'verification_failed');
  assert.ok(Number(blocked.body.blockingIssueCount)>0);
  assert.equal((await request(prefix+'/'+session+'/finalize','POST',undefined,access)).status,409);
  assert.equal((await pool.query('SELECT 1 FROM projects WHERE organization_id=$1',[org])).rowCount,0);
  const archived=await pool.query<{business_snapshot:{projects:Array<{address:string;lines:Array<{key:string}>}>;catalog:object;team:unknown[]}}>('SELECT business_snapshot FROM migration_legacy_snapshots WHERE session_id=$1',[session]);
  assert.equal(archived.rows[0]?.business_snapshot.projects[0]?.address,'Historic address');
  assert.equal(archived.rows[0]?.business_snapshot.projects[0]?.lines[0]?.key,'work-brick');
  assert.ok(archived.rows[0]?.business_snapshot.catalog);
  assert.equal(archived.rows[0]?.business_snapshot.team.length,1);
  await assert.rejects(pool.query("UPDATE migration_legacy_snapshots SET package_hash=$1 WHERE session_id=$2",['0'.repeat(64),session]));
  const issues=await request(prefix+'/'+session+'/issues','GET',undefined,access);
  const missing=(issues.body.issues as Array<{id:string;code:string}>).find(i=>i.code==='payment_currency_required');assert.ok(missing);
  assert.equal((await request(prefix+'/'+session+'/issues/'+missing.id+'/resolve','POST',{currency:'USD'},workerAccess)).status,403);
  assert.equal((await request(prefix+'/'+session+'/issues/'+missing.id+'/resolve','POST',{currency:'USD'},access)).status,200);
  assert.equal((await request(prefix+'/'+session+'/issues/'+missing.id+'/resolve','POST',{currency:'USD'},access2)).body.status,'duplicate');
  assert.equal((await request(prefix+'/'+session+'/issues/'+missing.id+'/resolve','POST',{currency:'EUR'},access)).status,409);
  const verified=await request(prefix+'/'+session+'/verify','POST',undefined,access);
  assert.equal(verified.status,200);assert.equal(verified.body.status,'ready_to_finalize');
  const finalized=await request(prefix+'/'+session+'/finalize','POST',undefined,access);
  assert.equal(finalized.status,200);assert.equal(finalized.body.status,'completed');
  assert.equal((await request(prefix+'/'+session+'/finalize','POST',undefined,access2)).body.duplicate,true);
  assert.equal((await request(prefix+'/'+session+'/cancel','POST',undefined,access)).status,409);
  assert.equal((await pool.query<{currency:string}>('SELECT currency FROM payments WHERE id=$1',[payment])).rows[0]?.currency,'USD');
  const snapshot=await request('/api/v1/sync/snapshot','GET',undefined,access2);
  assert.equal(snapshot.status,200);
  const entities=snapshot.body.entities as Array<{entityType:string;entityId:string;revision:number}>;
  assert.ok(entities.some(e=>e.entityType==='project'&&e.entityId===project&&e.revision===1));
  assert.equal(JSON.stringify(snapshot.body).includes('Historic address'),false);
  assert.equal(JSON.stringify(snapshot.body).includes('Legacy admin'),false);
  const pull=await request('/api/v1/sync/pull?cursor=0','GET',undefined,access2);
  assert.equal(pull.status,200);assert.equal((pull.body.changes as unknown[]).length,6);
  assert.equal(snapshot.body.cursor,pull.body.nextCursor);
  const [a,b]=await Promise.all(['Device A','Device B'].map(name=>request('/api/v1/sync/push','POST',{
    operations:[{operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'project',entityId:project,operationType:'update',
      baseRevision:1,payload:{name},occurredAt:new Date().toISOString()}]},name==='Device A'?access:access2)));
  const outcomes=[a,b].map(r=>(r?.body.results as Array<{status:string}>)[0]?.status).sort();
  assert.deepEqual(outcomes,['applied','conflict']);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM projects WHERE id=$1',[project])).rows[0]?.revision,'2');
  assert.equal((await request(prefix+'/'+session+'/cancel','POST',undefined,access)).status,409);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM projects WHERE id=$1',[project])).rows[0]?.revision,'2');
});

test('cancelled migration never writes business rows and tenant UUID collision is hidden',async()=>{
  const id=randomUUID();
  const existing=randomUUID();
  const created=await request('/api/v1/sync/push','POST',{operations:[{operationId:randomUUID(),idempotencyKey:randomUUID(),
    entityType:'material',entityId:existing,operationType:'create',baseRevision:0,payload:{name:'Preserve on cancel'},
    occurredAt:new Date().toISOString()}]},foreign);
  assert.equal((created.body.results as Array<{status:string}>)[0]?.status,'applied');
  const result=await request('/api/v1/migrations','POST',{id,packageHash:'f'.repeat(64),expectedChunks:1,
    sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,exportedAt:'2026-01-01T00:00:00.000Z'},foreign);
  assert.equal(result.status,201);
  assert.equal((await request('/api/v1/migrations/'+id+'/chunks/0','PUT',{projects:[]},foreign)).status,200);
  assert.equal((await request('/api/v1/migrations/'+id+'/cancel','POST',undefined,foreign)).status,200);
  assert.equal((await pool.query('SELECT 1 FROM migration_chunks WHERE session_id=$1',[id])).rowCount,0);
  assert.equal((await request('/api/v1/migrations/'+id+'/chunks/0','PUT',{projects:[]},foreign)).status,409);
  assert.equal((await request('/api/v1/migrations/'+id,'GET',undefined,access)).status,404);
  assert.equal((await pool.query<{name:string}>('SELECT name FROM materials WHERE id=$1',[existing])).rows[0]?.name,'Preserve on cancel');
});

test('snapshot cursor and entities share one PostgreSQL version during a concurrent committed mutation',async()=>{
  const id=randomUUID();
  const create=await request('/api/v1/sync/push','POST',{operations:[{operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'material',
    entityId:id,operationType:'create',baseRevision:0,payload:{name:'Before snapshot'},occurredAt:new Date().toISOString()}]},access);
  assert.equal((create.body.results as Array<{status:string}>)[0]?.status,'applied');
  const before=(await pool.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[org])).rows[0]?.sync_cursor;
  const snapshot=await snapshotForBootstrap({userId:admin,organizationId:org,role:'admin',deviceId:device,
    sessionId:randomUUID(),mustChangePassword:false},async()=>{
    const concurrent=await request('/api/v1/sync/push','POST',{operations:[{operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'material',
      entityId:id,operationType:'update',baseRevision:1,payload:{name:'After snapshot'},occurredAt:new Date().toISOString()}]},access2);
    assert.equal((concurrent.body.results as Array<{status:string}>)[0]?.status,'applied');
  });
  assert.equal(snapshot.cursor,before);
  const item=snapshot.entities.find(x=>x.entityId===id);
  assert.equal(item?.revision,1);
  assert.equal(item?.snapshot.name,'Before snapshot');
  assert.equal((await pool.query<{name:string}>('SELECT name FROM materials WHERE id=$1',[id])).rows[0]?.name,'After snapshot');
});
