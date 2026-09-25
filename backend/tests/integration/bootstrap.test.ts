import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/database/pool.js';
import { verifyPassword } from '../../src/services/security.js';
test('bootstrap creates first admin and refuses repeat without exposing password',async () => {
  const name='Bootstrap '+randomUUID(), password='long initial password 123';
  const env={ ...process.env, BOOTSTRAP_ORGANIZATION_NAME:name,BOOTSTRAP_ADMIN_EMAIL:'first@test.example',BOOTSTRAP_ADMIN_PASSWORD:password };
  const run=()=>spawnSync(process.execPath,['--import','tsx','scripts/bootstrap-admin.ts'],{cwd:process.cwd(),env,encoding:'utf8',timeout:20000});
  try {
    const first=run(); assert.equal(first.status,0,first.stderr);
    const second=run(); assert.notEqual(second.status,0);
    assert.doesNotMatch(first.stdout+first.stderr+second.stdout+second.stderr,/long initial password 123/);
    const rows=await pool.query<{role:string;password_hash:string}>('SELECT u.role,u.password_hash FROM users u JOIN organizations o ON o.id=u.organization_id WHERE o.name=$1',[name]);
    assert.equal(rows.rowCount,1); assert.equal(rows.rows[0]?.role,'admin');
    assert.equal(await verifyPassword(rows.rows[0]?.password_hash ?? '',password),true);
  } finally { await pool.end(); }
});
