import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/services/security.js';
import { DurableQueue } from '../tools/durable-queue.js';
test('offline local writes survive restart, lost response retries and conflict stays local',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'arhilab-sync-')),path=join(dir,'client.json');
  const org=randomUUID(),user=randomUUID(),device=randomUUID(),entity=randomUUID();
  const password='offline test password 123';
  let server:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
  try {
    await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[org,'Offline '+org]);
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[user,org,user+'@test.example','Admin','admin',await hashPassword(password)]);
    let queue=await DurableQueue.open(path);
    for(const [operationType,baseRevision,payload] of [
      ['create',0,{name:'Local draft'}],['update',1,{name:'Local revised'}],['delete',2,{}],
    ] as const) await queue.localWrite(entity,{name:'Local state after '+operationType},{operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'project',entityId:entity,operationType,baseRevision,payload,occurredAt:new Date().toISOString()});
    queue=await DurableQueue.open(path);
    assert.equal(queue.queue.length,3);assert.ok(queue.queue.every(item=>item.state==='pending'));
    server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server?.once('listening',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
    const base=`http://127.0.0.1:${address.port}`;
    const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:org,email:user+'@test.example',password,deviceId:device})});
    const token=(await login.json() as {accessToken:string}).accessToken;
    const push=async(operations:object[])=>{
      const clean=operations.map(item=>{
        const {operationId,idempotencyKey,entityType,entityId,operationType,baseRevision,payload,occurredAt}=item as Record<string,unknown>;
        return {operationId,idempotencyKey,entityType,entityId,operationType,baseRevision,payload,occurredAt};
      });
      const response=await fetch(base+'/api/v1/sync/push',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({operations:clean})});
      assert.equal(response.status,200);
      return response.json() as Promise<{results:Array<{status:string}>}>;
    };
    await queue.mark(queue.queue[0]!.operationId,'sending');
    // Simulate a crash after the server commits but before the client receives the response.
    assert.deepEqual((await push(queue.queue)).results.map(result=>result.status),['applied','applied','applied']);
    queue=await DurableQueue.open(path);
    assert.equal(queue.queue[0]?.state,'retry');
    const retried=await push(queue.queue);
    assert.deepEqual(retried.results.map(result=>result.status),['duplicate','duplicate','duplicate']);
    for(const item of queue.queue) await queue.mark(item.operationId,'applied');
    assert.equal((await pool.query<{revision:string}>('SELECT revision FROM projects WHERE id=$1',[entity])).rows[0]?.revision,'3');
    assert.equal((await pool.query('SELECT sequence FROM sync_changes WHERE entity_id=$1',[entity])).rowCount,3);
    const stale={...queue.queue[1]!,operationId:randomUUID(),idempotencyKey:randomUUID(),baseRevision:1,payload:{name:'Unsynced conflict'}};
    await queue.localWrite(entity,{name:'Unsynced conflict'},stale);
    assert.equal((await push([stale])).results[0]?.status,'conflict');
    await queue.mark(stale.operationId,'conflict');
    queue=await DurableQueue.open(path);
    assert.equal(queue.queue.at(-1)?.state,'conflict');assert.equal((queue.entities[entity] as {name:string}|undefined)?.name,'Unsynced conflict');
  } finally {
    const activeServer=server;
    if(activeServer)await new Promise<void>(resolve=>activeServer.close(()=>resolve()));
    await pool.end();await rm(dir,{recursive:true,force:true});
  }
});
