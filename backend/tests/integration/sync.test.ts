import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/services/security.js';
let server:Server,base:string;
const orgA=randomUUID(),orgB=randomUUID(),adminA=randomUUID(),adminB=randomUUID(),manager=randomUUID(),worker=randomUUID();
const deviceA=randomUUID(),deviceA2=randomUUID(),deviceB=randomUUID();
const password='stage three testing password 123';
let accessA:string,accessA2:string,accessB:string,accessManager:string,accessWorker:string;
type Operation={operationId:string;idempotencyKey:string;entityType:string;entityId:string;operationType:string;baseRevision:number;payload:object;occurredAt:string};
const op=(entityType:string,entityId:string,operationType:string,baseRevision:number,payload:object):Operation=>({operationId:randomUUID(),idempotencyKey:randomUUID(),entityType,entityId,operationType,baseRevision,payload,occurredAt:new Date().toISOString()});
async function request(path:string,method='GET',body?:object,access?:string) {
  const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(access?{authorization:`Bearer ${access}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const raw=await response.text();
  return {status:response.status,body:raw?JSON.parse(raw) as Record<string,unknown>:{}};
}
async function push(operations:Operation[],access=accessA) {const r=await request('/api/v1/sync/push','POST',{operations},access);return {status:r.status,results:r.body.results as Array<Record<string,unknown>>,body:r.body};}
async function login(org:string,email:string,device:string) {
  const r=await request('/api/v1/auth/login','POST',{organizationId:org,email,password,deviceId:device});
  assert.equal(r.status,200);
  return String(r.body.accessToken);
}
before(async()=>{
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[orgA,'Sync A '+orgA,orgB,'Sync B '+orgB]);
  const hash=await hashPassword(password);
  for(const [id,org,role] of [[adminA,orgA,'admin'],[adminB,orgB,'admin'],[manager,orgA,'manager'],[worker,orgA,'worker']]) await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,org,id+'@test.example',role,role,hash]);
  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No port');base=`http://127.0.0.1:${address.port}`;
  accessA=await login(orgA,adminA+'@test.example',deviceA);
  accessA2=await login(orgA,adminA+'@test.example',deviceA2);
  accessB=await login(orgB,adminB+'@test.example',deviceB);
  accessManager=await login(orgA,manager+'@test.example',randomUUID());
  accessWorker=await login(orgA,worker+'@test.example',randomUUID());
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

test('push validates ordered seven-entity batch and pull paginates own and other-device changes',async()=>{
  assert.equal((await request('/api/v1/sync/push','POST',{operations:[op('project',randomUUID(),'create',0,{name:'X'})]})).status,401);
  assert.equal((await push([op('project',randomUUID(),'create',0,{name:'X'})],accessManager)).status,403);
  assert.equal((await push([op('project',randomUUID(),'create',0,{name:'X'})],accessWorker)).status,403);
  const project=randomUUID(),estimate=randomUUID();
  const ops=[
    op('project',project,'create',0,{name:'Site'}),
    op('estimate',estimate,'create',0,{projectId:project,name:'Budget'}),
    op('estimateItem',randomUUID(),'create',0,{estimateId:estimate,title:'Work',quantity:'2.5',unit:'m2'}),
    op('material',randomUUID(),'create',0,{name:'Timber',unit:'m3'}),
    op('stage',randomUUID(),'create',0,{projectId:project,name:'Foundation',position:0}),
    op('payment',randomUUID(),'create',0,{projectId:project,amount:'50.00',currency:'USD'}),
    op('task',randomUUID(),'create',0,{projectId:project,title:'Inspect',status:'open'}),
  ];
  const first=await push(ops);assert.equal(first.status,200);assert.deepEqual(first.results.map(r=>r.status),Array(7).fill('applied'));
  assert.deepEqual(first.results.map(r=>r.resultingRevision),Array(7).fill(1));
  const all=[];
  let cursor='0',hasMore=true;
  while(hasMore) {
    const page=await request('/api/v1/sync/pull?cursor='+cursor+'&limit=3','GET',undefined,accessManager);
    assert.equal(page.status,200);
    all.push(...page.body.changes as Array<Record<string,unknown>>);
    cursor=String(page.body.nextCursor);hasMore=Boolean(page.body.hasMore);
  }
  assert.equal(all.length,7);assert.deepEqual(all.map(x=>x.sequence),['1','2','3','4','5','6','7']);
  assert.ok(all.every(x=>x.sourceDeviceId===deviceA));
  assert.equal((await request('/api/v1/sync/pull?cursor=0','GET',undefined,accessB)).body.changes instanceof Array,true);
  assert.equal(((await request('/api/v1/sync/pull?cursor=0','GET',undefined,accessB)).body.changes as unknown[]).length,0);
  const second=await push([op('project',randomUUID(),'create',0,{name:'New after cursor'})],accessA2);
  assert.equal(second.results[0]?.status,'applied');
  const after=await request('/api/v1/sync/pull?cursor='+cursor,'GET',undefined,accessWorker);
  assert.equal((after.body.changes as Array<Record<string,unknown>>).length,1);
  assert.equal((after.body.changes as Array<Record<string,unknown>>)[0]?.sourceDeviceId,deviceA2);
  assert.equal((await request('/api/v1/sync/pull?cursor=999999','GET',undefined,accessA)).status,400);
});

test('revisions, tombstones, duplicates, mismatch, conflict and sequential writes',async()=>{
  const id=randomUUID(),create=op('project',id,'create',0,{name:'Original'});
  assert.equal((await push([create])).results[0]?.resultingRevision,1);
  const first=op('project',id,'update',1,{name:'One'}),second=op('project',id,'update',2,{name:'Two'});
  assert.equal((await push([first,second])).results[0]?.resultingRevision,2);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM projects WHERE id=$1',[id])).rows[0]?.revision,'3');
  const stale=await push([op('project',id,'update',1,{name:'Overwrite'})]);
  assert.equal(stale.results[0]?.status,'conflict');assert.equal(stale.results[0]?.currentRevision,3);
  assert.equal((await pool.query<{name:string}>('SELECT name FROM projects WHERE id=$1',[id])).rows[0]?.name,'Two');
  const del=op('project',id,'delete',3,{}),removed=await push([del]);
  assert.equal(removed.results[0]?.resultingRevision,4);
  const duplicate=await push([del]);
  assert.equal(duplicate.results[0]?.status,'duplicate');assert.equal(duplicate.results[0]?.originalStatus,'applied');
  assert.equal(duplicate.results[0]?.resultingRevision,4);
  const mismatch=await push([{...del,payload:{name:'Changed'}}]);
  assert.equal(mismatch.results[0]?.code,'idempotency_key_reused_with_different_request');
  const row=await pool.query<{revision:string;deleted_at:Date|null}>('SELECT revision,deleted_at FROM projects WHERE id=$1',[id]);
  assert.equal(row.rows[0]?.revision,'4');assert.ok(row.rows[0]?.deleted_at);
  const feed=await pool.query<{snapshot:{deletedAt:string|null}}> ('SELECT snapshot FROM sync_changes WHERE organization_id=$1 AND entity_id=$2 AND revision=4',[orgA,id]);
  assert.equal(feed.rowCount,1);assert.ok(feed.rows[0]?.snapshot.deletedAt);
  assert.equal((await push([op('project',id,'update',4,{name:'Resurrect'})])).results[0]?.status,'rejected');
});

test('concurrent duplicate and competing devices never double-apply or overwrite stale revision',async()=>{
  const id=randomUUID();assert.equal((await push([op('material',id,'create',0,{name:'Start'})])).results[0]?.resultingRevision,1);
  const same=op('material',id,'update',1,{name:'Shared'});
  const [a,b]=await Promise.all([push([same],accessA),push([same],accessA2)]);
  assert.deepEqual([a.results[0]?.status,b.results[0]?.status].sort(),['applied','duplicate']);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM materials WHERE id=$1',[id])).rows[0]?.revision,'2');
  assert.equal((await pool.query('SELECT sequence FROM sync_changes WHERE organization_id=$1 AND entity_id=$2',[orgA,id])).rowCount,2);
  const [c,d]=await Promise.all([push([op('material',id,'update',2,{name:'Device 1'})],accessA),push([op('material',id,'update',2,{name:'Device 2'})],accessA2)]);
  assert.deepEqual([c.results[0]?.status,d.results[0]?.status].sort(),['applied','conflict']);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM materials WHERE id=$1',[id])).rows[0]?.revision,'3');
});

test('validation, tenant scope and revoked device security',async()=>{
  const foreign=randomUUID();assert.equal((await push([op('project',foreign,'create',0,{name:'Other'})],accessB)).results[0]?.status,'applied');
  for(const [operation,expected] of [
    [op('user',randomUUID(),'create',0,{name:'Injected'}),'unsupported_entity'],
    [op('project',randomUUID(),'create',0,{name:'X',organizationId:orgB}),'invalid_payload'],
    [op('project',foreign,'update',1,{name:'Steal'}),'entity_not_available'],
    [op('project',foreign,'delete',1,{}),'entity_not_available'],
  ] as const) {
    const result=await push([operation]);assert.equal(result.results[0]?.status,'rejected');assert.equal(result.results[0]?.code,expected);
  }
  assert.equal((await request('/api/v1/sync/push','POST',{operations:[]},accessA)).status,400);
  assert.equal((await request('/api/v1/sync/pull?limit=101','GET',undefined,accessA)).status,400);
  assert.equal((await request('/api/v1/devices/'+deviceA+'/revoke','POST',undefined,accessA2)).status,204);
  assert.equal((await push([op('project',randomUUID(),'create',0,{name:'Denied'})],accessA)).status,401);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,accessA)).status,401);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,accessA2)).status,200);
});
