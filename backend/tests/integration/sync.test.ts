import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/services/security.js';
import { JsonFileSyncStore, SyncCoordinator } from '../../src/sync/client/local-first.js';
import { HttpSyncTransport } from '../../src/sync/client/http-transport.js';
const paymentMath=createRequire(import.meta.url)('../../../arhilab/assets/f2-payments.js') as {
  summary:(estimate:Record<string,unknown>,payments:Array<Record<string,unknown>>,total:string)=>{paid:bigint;remaining:bigint;overpayment:bigint};
};
const expenseMath=(createRequire(import.meta.url)('../../../arhilab/assets/f2-payments.js') as {F3Expenses: {
  summary:(estimate:Record<string,unknown>,payments:Array<Record<string,unknown>>,
    expenses:Array<Record<string,unknown>>,total:string)=>{actualExpenses:bigint;cashResult:bigint;forecastGrossProfit:bigint;forecastMargin:bigint|null};
}}).F3Expenses;
let server:Server,base:string;
const orgA=randomUUID(),orgB=randomUUID(),adminA=randomUUID(),adminB=randomUUID(),manager=randomUUID(),worker=randomUUID();
const deviceA=randomUUID(),deviceA2=randomUUID(),deviceB=randomUUID();
const password='stage three testing password 123';
const {calc}=createRequire(import.meta.url)('../../../arhilab/assets/core.js') as {calc:(value:Record<string,unknown>)=>{total:number}};
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

async function restartTestHttpServer() {
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  server=createApp().listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No port');
  base=`http://127.0.0.1:${address.port}`;
}

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
  assert.equal(all.length,6);assert.deepEqual(all.map(x=>x.sequence),['1','2','3','4','5','7']);
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

test('all seven entity types create, update and tombstone with stable UUID and one feed event per mutation',async()=>{
  const project=randomUUID(),estimate=randomUUID(),assignee=worker;
  const entities=[
    {type:'project',id:project,create:{name:'Matrix project'},update:{name:'Matrix revised'}},
    {type:'estimate',id:estimate,create:{projectId:project,name:'Matrix estimate'},update:{name:'Estimate revised'}},
    {type:'estimateItem',id:randomUUID(),create:{estimateId:estimate,title:'Work',quantity:'2.25'},update:{quantity:'3.5'}},
    {type:'material',id:randomUUID(),create:{name:'Wood'},update:{unit:'m3'}},
    {type:'stage',id:randomUUID(),create:{projectId:project,name:'Ground',position:0},update:{position:2}},
    {type:'payment',id:randomUUID(),create:{projectId:project,amount:'99.00',currency:'USD'},update:{amount:'100.25'}},
    {type:'task',id:randomUUID(),create:{projectId:project,title:'Measure',status:'open',assigneeId:assignee},update:{status:'done'}},
  ];
  const creations=await push(entities.map(e=>op(e.type,e.id,'create',0,e.create)),accessA2);
  assert.deepEqual(creations.results.map(r=>r.resultingRevision),Array(7).fill(1));
  const updates=await push(entities.map(e=>op(e.type,e.id,'update',1,e.update)),accessA2);
  assert.deepEqual(updates.results.map(r=>r.resultingRevision),Array(7).fill(2));
  const deletions=await push([...entities].reverse().map(e=>op(e.type,e.id,'delete',2,{})),accessA2);
  assert.deepEqual(deletions.results.map(r=>r.resultingRevision),Array(7).fill(3));
  const changes=await pool.query<{entity_type:string;entity_id:string;revision:string;operation_type:string;snapshot:{id:string;revision:number;deletedAt:string|null};source_device_id:string;sync_operation_id:string}>(
    'SELECT entity_type,entity_id,revision,operation_type,snapshot,source_device_id,sync_operation_id FROM sync_changes WHERE organization_id=$1 AND entity_id=ANY($2) ORDER BY sequence',[orgA,entities.map(e=>e.id)]);
  assert.equal(changes.rowCount,21);
  for(const e of entities) {
    const records=changes.rows.filter(r=>r.entity_id===e.id);
    assert.deepEqual(records.map(r=>r.revision),['1','2','3']);
    assert.deepEqual(records.map(r=>r.operation_type),['create','update','delete']);
    assert.ok(records.every(r=>r.entity_type===e.type&&r.snapshot.id===e.id&&r.source_device_id===deviceA2&&r.sync_operation_id));
    assert.equal(records[2]?.snapshot.revision,3);
    assert.ok(records[2]?.snapshot.deletedAt);
    const stale=await push([op(e.type,e.id,'delete',2,{})],accessA2);
    assert.equal(stale.results[0]?.status,'conflict');
    const resurrect=await push([op(e.type,e.id,'update',3,e.update)],accessA2);
    assert.equal(resurrect.results[0]?.code,'already_deleted');
  }
  const pull=await request('/api/v1/sync/pull?cursor=0&limit=100','GET',undefined,accessA2);
  assert.equal(pull.status,200);
  const feed=pull.body.changes as Array<{entityId:string;revision:number;snapshot:{deletedAt:string|null}}>;
  for(const e of entities) assert.equal(feed.filter(x=>x.entityId===e.id&&x.revision===3&&!!x.snapshot.deletedAt).length,1);
});

test('foreign references reject other-tenant, absent and tombstoned parents and inactive assignees',async()=>{
  const ownProject=randomUUID(),ownEstimate=randomUUID(),deletedProject=randomUUID(),deletedEstimate=randomUUID();
  const otherProject=randomUUID(),otherEstimate=randomUUID(),otherUser=adminB;
  assert.equal((await push([op('project',ownProject,'create',0,{name:'Own'}),op('estimate',ownEstimate,'create',0,{projectId:ownProject,name:'Own estimate'}),op('project',deletedProject,'create',0,{name:'Gone'}),op('estimate',deletedEstimate,'create',0,{projectId:ownProject,name:'Gone'})],accessA2)).results.length,4);
  assert.equal((await push([op('project',otherProject,'create',0,{name:'Other'}),op('estimate',otherEstimate,'create',0,{projectId:otherProject,name:'Other estimate'})],accessB)).results[1]?.status,'applied');
  assert.equal((await push([op('project',deletedProject,'delete',1,{}),op('estimate',deletedEstimate,'delete',1,{})],accessA2)).results[1]?.status,'applied');
  const candidates=[
    ['estimate',{projectId:otherProject,name:'Other'}],['estimate',{projectId:deletedProject,name:'Deleted'}],['estimate',{projectId:randomUUID(),name:'Absent'}],
    ['estimateItem',{estimateId:otherEstimate,title:'Other',quantity:'1'}],['estimateItem',{estimateId:deletedEstimate,title:'Deleted',quantity:'1'}],['estimateItem',{estimateId:randomUUID(),title:'Absent',quantity:'1'}],
    ['stage',{projectId:otherProject,name:'Other',position:0}],['payment',{projectId:otherProject,amount:'1',currency:'USD'}],
    ['task',{projectId:otherProject,title:'Other',status:'open'}],['task',{projectId:ownProject,assigneeId:otherUser,title:'Other',status:'open'}],
  ] as const;
  for(const [type,payload] of candidates) {
    const result=await push([op(type,randomUUID(),'create',0,payload)],accessA2);
    assert.equal(result.results[0]?.code,'invalid_reference',type);
  }
  const ownTask=randomUUID();
  assert.equal((await push([op('task',ownTask,'create',0,{projectId:ownProject,title:'Own',status:'open'})],accessA2)).results[0]?.status,'applied');
  assert.equal((await push([op('task',ownTask,'update',1,{projectId:otherProject})],accessA2)).results[0]?.code,'invalid_reference');
  assert.equal((await push([op('task',ownTask,'update',1,{assigneeId:otherUser})],accessA2)).results[0]?.code,'invalid_reference');
});

test('idempotency identity, canonical payload and operation ID collisions',async()=>{
  const id=randomUUID(),create=op('material',id,'create',0,{name:'Stable',unit:'m'});
  assert.equal((await push([create],accessA2)).results[0]?.status,'applied');
  const reordered={...create,payload:{unit:'m',name:'Stable'}};
  assert.equal((await push([reordered],accessA2)).results[0]?.status,'duplicate');
  for(const changed of [
    {...create,entityId:randomUUID()}, {...create,entityType:'project'}, {...create,operationType:'update'},
    {...create,baseRevision:1}, {...create,payload:{name:'Different',unit:'m'}},
  ]) assert.equal((await push([changed],accessA2)).results[0]?.code,'idempotency_key_reused_with_different_request');
  assert.equal((await push([{...create,idempotencyKey:randomUUID(),entityId:randomUUID()}],accessA2)).results[0]?.code,'operation_id_reused');
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM materials WHERE id=$1',[id])).rows[0]?.revision,'1');
  assert.equal((await pool.query('SELECT 1 FROM sync_changes WHERE sync_operation_id=$1',[create.operationId])).rowCount,1);
});

test('batch and envelope validation, roles, password-change gate and stable HTTP errors',async()=>{
  const missing=await request('/api/v1/sync/pull');
  assert.equal(missing.status,401);assert.equal(missing.body.code,'unauthorized');assert.equal(missing.body.errorClass,'authorization');
  const project=randomUUID(),create=op('project',project,'create',0,{name:'Validated'});
  for(const envelope of [
    {operations:[]},{operations:[{...create,unexpected:true}]},{operations:[{...create,payload:{name:'X',revision:10}}]},
    {operations:[{operationId:create.operationId,idempotencyKey:create.idempotencyKey,entityId:create.entityId,entityType:create.entityType,operationType:create.operationType,baseRevision:create.baseRevision,occurredAt:create.occurredAt}]},
    {operations:Array.from({length:51},()=>op('material',randomUUID(),'create',0,{name:'Over limit'}))},
    {operations:[create],organizationId:orgB},
  ]) {
    const response=await request('/api/v1/sync/push','POST',envelope,accessA2);
    if ('organizationId' in envelope || envelope.operations.length!==1 || 'unexpected' in envelope.operations[0]! || !('payload' in envelope.operations[0]!)) assert.equal(response.status,400);
    else assert.equal((response.body.results as Array<{code:string}>)[0]?.code,'invalid_payload');
  }
  const fifty=Array.from({length:50},()=>op('material',randomUUID(),'create',0,{name:'Batch'}));
  assert.equal((await push(fifty,accessA2)).results.filter(r=>r.status==='applied').length,50);
  for(const role of [accessManager,accessWorker]) {
    assert.equal((await request('/api/v1/sync/pull','GET',undefined,role)).status,200);
    assert.equal((await push([op('material',randomUUID(),'create',0,{name:'Denied'})],role)).status,403);
  }
  for(const query of ['cursor=-1','cursor=01','limit=0','limit=101','limit=x']) assert.equal((await request('/api/v1/sync/pull?'+query,'GET',undefined,accessA2)).status,400);
  const newUser=randomUUID(),newDevice=randomUUID();
  await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,$6,true)',[newUser,orgA,newUser+'@test.example','Must change','admin',await hashPassword(password)]);
  const initial=await login(orgA,newUser+'@test.example',newDevice);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,initial)).status,403);
  assert.equal((await push([op('project',randomUUID(),'create',0,{name:'Denied'})],initial)).status,403);
});

test('concurrent cursor allocation and rollback of failed change insert are atomic',async()=>{
  // Each integration scenario owns a fresh in-memory rate limiter; database state persists.
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  server=createApp().listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No port');base=`http://127.0.0.1:${address.port}`;
  const ids=Array.from({length:8},()=>randomUUID());
  const simultaneous=await Promise.all(ids.map(id=>push([op('material',id,'create',0,{name:'Parallel'})],accessA2)));
  assert.ok(simultaneous.every(r=>r.results[0]?.status==='applied'));
  const rows=await pool.query<{sequence:string}>('SELECT sequence FROM sync_changes WHERE organization_id=$1 AND entity_id=ANY($2) ORDER BY sequence',[orgA,ids]);
  assert.equal(rows.rowCount,8);
  assert.equal(new Set(rows.rows.map(r=>r.sequence)).size,8);
  const broken=randomUUID(),brokenOp=op('material',broken,'create',0,{name:'Must roll back'});
  const before=await pool.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[orgA]);
  // A generated UUID is safe as a DDL literal; PostgreSQL cannot bind a CHECK expression.
  await pool.query(`ALTER TABLE sync_changes ADD CONSTRAINT test_atomicity CHECK (entity_id <> '${broken}'::uuid)`);
  try {
    assert.equal((await push([brokenOp],accessA2)).status,500);
    assert.equal((await pool.query('SELECT 1 FROM materials WHERE id=$1',[broken])).rowCount,0);
    assert.equal((await pool.query('SELECT 1 FROM sync_operations WHERE id=$1',[brokenOp.operationId])).rowCount,0);
    assert.equal((await pool.query('SELECT 1 FROM sync_changes WHERE entity_id=$1',[broken])).rowCount,0);
    assert.equal((await pool.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[orgA])).rows[0]?.sync_cursor,before.rows[0]?.sync_cursor);
  } finally {await pool.query('ALTER TABLE sync_changes DROP CONSTRAINT test_atomicity');}
  assert.equal((await push([brokenOp],accessA2)).results[0]?.status,'applied');
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

test('sync requires a live device and user; reactivation does not revive old sessions',async()=>{
  const temporary=randomUUID();
  const userLogin=await request('/api/v1/auth/login','POST',{organizationId:orgA,email:worker+'@test.example',password,deviceId:temporary});
  assert.equal(userLogin.status,200);
  const access=String(userLogin.body.accessToken),refresh=String(userLogin.body.refreshToken);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,access)).status,200);
  assert.equal((await request('/api/v1/devices/'+temporary+'/revoke','POST',undefined,accessA2)).status,204);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,access)).status,401);
  assert.equal((await push([op('project',randomUUID(),'create',0,{name:'Denied'})],access)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:refresh})).status,401);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,accessA2)).status,200);

  const newDevice=randomUUID();
  const second=await request('/api/v1/auth/login','POST',{organizationId:orgA,email:worker+'@test.example',password,deviceId:newDevice});
  assert.equal(second.status,200);
  const oldAccess=String(second.body.accessToken),oldRefresh=String(second.body.refreshToken);
  assert.equal((await request('/api/v1/users/'+worker,'PATCH',{active:false},accessA2)).status,200);
  assert.equal((await request('/api/v1/auth/login','POST',{organizationId:orgA,email:worker+'@test.example',password,deviceId:randomUUID()})).status,401);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,oldAccess)).status,401);
  assert.equal((await push([op('material',randomUUID(),'create',0,{name:'Denied'})],oldAccess)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:oldRefresh})).status,401);
  assert.equal((await request('/api/v1/users/'+worker,'PATCH',{active:true},accessA2)).status,200);
  assert.equal((await request('/api/v1/sync/pull','GET',undefined,oldAccess)).status,401);
  assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:oldRefresh})).status,401);
});

test('estimate work markup defaults to zero, validates range and persists stale edit conflict',async()=>{
  const project=randomUUID(),estimate=randomUUID();
  const before=(await pool.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[orgA])).rows[0]?.sync_cursor;
  assert.equal((await push([op('project',project,'create',0,{name:'F1 объект'})],accessA2)).results[0]?.status,'applied');
  assert.equal((await push([op('estimate',estimate,'create',0,{projectId:project,name:'Смета'})],accessA2)).results[0]?.status,'applied');
  assert.equal((await pool.query<{work_markup_percent:string}>('SELECT work_markup_percent FROM estimates WHERE id=$1',[estimate])).rows[0]?.work_markup_percent,'0.00');
  for(const value of ['-1','100.01','1.001','Infinity','1e2']) {
    const invalid=await push([op('estimate',estimate,'update',1,{workMarkupPercent:value})],accessA2);
    assert.equal(invalid.results[0]?.code,'invalid_payload');
  }
  assert.equal((await push([op('estimate',estimate,'update',1,{workMarkupPercent:'100.00'})],accessManager)).status,403);
  const deviceA=op('estimate',estimate,'update',1,{workMarkupPercent:'10.00'});
  const deviceB=op('estimate',estimate,'update',1,{workMarkupPercent:'20.00'});
  assert.equal((await push([deviceA],accessA2)).results[0]?.resultingRevision,2);
  const loser=await push([deviceB],accessA2);
  assert.equal(loser.results[0]?.status,'conflict');assert.ok(loser.results[0]?.conflictId);
  const stored=await pool.query<{work_markup_percent:string;revision:string}>('SELECT work_markup_percent,revision FROM estimates WHERE id=$1',[estimate]);
  assert.equal(stored.rows[0]?.work_markup_percent,'10.00');assert.equal(stored.rows[0]?.revision,'2');
  const conflict=await pool.query<{client_proposal:{workMarkupPercent:string};server_snapshot:{workMarkupPercent:string}}>(
    'SELECT client_proposal,server_snapshot FROM sync_conflicts WHERE id=$1',[loser.results[0]?.conflictId]);
  assert.equal(conflict.rows[0]?.client_proposal.workMarkupPercent,'20.00');
  assert.equal(conflict.rows[0]?.server_snapshot.workMarkupPercent,'10.00');
  const pull=await request('/api/v1/sync/pull?cursor='+before,'GET',undefined,accessA2);
  assert.ok((pull.body.changes as Array<{entityId:string;snapshot:{workMarkupPercent:string}}>).some(x=>x.entityId===estimate&&x.snapshot.workMarkupPercent==='10.00'));
  assert.equal(((await request('/api/v1/sync/snapshot','GET',undefined,accessB)).body.entities as Array<{entityId:string}>).some(x=>x.entityId===estimate),false);
});

test('F1 financial rows survive revisioned push, bootstrap and pull without leaking private costs',async()=>{
  const project=randomUUID(),estimate=randomUUID(),work=randomUUID(),material=randomUUID();
  const cursor=(await pool.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[orgA])).rows[0]?.sync_cursor;
  const submitted=[
    op('project',project,'create',0,{name:'Дом',address:'Улица 1',client:'Клиент',status:'Новый'}),
    op('estimate',estimate,'create',0,{projectId:project,name:'Исходная смета',delivery:'75.20',discount:'5.10',workMarkupPercent:'10.00'}),
    op('estimateItem',work,'create',0,{estimateId:estimate,title:'Работа',kind:'work',quantity:'1.2500',unit:'м²',price:'100.00',coefficient:'1.5000',autoMaterial:true,materialPrice:'20.00',catalogKey:'work-1'}),
    op('estimateItem',material,'create',0,{estimateId:estimate,title:'Материал',kind:'material',quantity:'2.0000',unit:'шт.',price:'30.00'}),
  ];
  const first=await push(submitted,accessA2);
  assert.deepEqual(first.results.map(x=>x.status),['applied','applied','applied','applied']);
  assert.equal((await push(submitted,accessA2)).results.every(x=>x.status==='duplicate'),true);
  const feed=await request('/api/v1/sync/pull?cursor='+cursor,'GET',undefined,accessManager);
  assert.equal(feed.status,200);
  const changes=feed.body.changes as Array<{entityId:string;snapshot:Record<string,unknown>}>;
  assert.deepEqual(changes.filter(x=>[project,estimate,work,material].some(id=>id===x.entityId)).map(x=>x.entityId),[project,estimate,work,material]);
  const e=changes.find(x=>x.entityId===estimate)?.snapshot;
  const w=changes.find(x=>x.entityId===work)?.snapshot;
  const m=changes.find(x=>x.entityId===material)?.snapshot;
  assert.equal(e?.delivery,'75.20');assert.equal(e?.discount,'5.10');
  assert.equal(w?.price,'100.00');assert.equal(w?.coefficient,'1.5000');
  assert.equal(JSON.stringify(changes).includes('cost'),false);
  assert.equal(calc({lines:[{price:w?.price,qty:w?.quantity,coef:w?.coefficient,autoMaterial:w?.autoMaterial,materialPrice:w?.materialPrice}],
    materials:[{price:m?.price,qty:m?.quantity}],workMarkupPercent:e?.workMarkupPercent,delivery:Number(e?.delivery),discount:Number(e?.discount)}).total,361.35);
  const other=await request('/api/v1/sync/snapshot','GET',undefined,accessManager);
  assert.equal(other.status,200);
  const entities=other.body.entities as Array<{entityId:string;snapshot:Record<string,unknown>}>;
  assert.ok([project,estimate,work,material].every(id=>entities.some(x=>x.entityId===id)));
  assert.equal(((await request('/api/v1/sync/snapshot','GET',undefined,accessB)).body.entities as Array<{entityId:string}>).some(x=>x.entityId===estimate),false);
});

test('Java Android ledger serialization reaches PostgreSQL, survives Device B restart and preserves a markup conflict',
  {skip:!process.env.F1_CLIENT_FIXTURE_PATH},async()=>{
    const raw=await readFile(process.env.F1_CLIENT_FIXTURE_PATH!,'utf8');
    const fixture=JSON.parse(raw) as {operations:Operation[]};
    assert.deepEqual(fixture.operations.map(x=>x.entityType),['project','estimate','estimateItem','estimateItem']);
    const [project,estimate]=fixture.operations;
    assert.ok(project&&estimate);
    const accessOwner=await login(orgA,adminA+'@test.example',randomUUID());
    const creation=await push(fixture.operations,accessOwner);
    assert.equal(creation.status,200);
    assert.deepEqual(creation.results.map(x=>x.status),Array(4).fill('applied'));
    const lostResponse=await push(fixture.operations,accessOwner);
    assert.deepEqual(lostResponse.results.map(x=>x.status),Array(4).fill('duplicate'));
    const count=await pool.query<{total:string}>('SELECT count(*)::text AS total FROM estimate_items WHERE estimate_id=$1',[estimate.entityId]);
    assert.equal(count.rows[0]?.total,'2');
    const workId=fixture.operations.find(x=>x.entityType==='estimateItem'&&x.payload&&
      (x.payload as {kind?:string}).kind==='work')?.entityId;
    assert.ok(workId);
    const privateRow=await pool.query<{private_fields:{cost:string}}>('SELECT private_fields FROM estimate_items WHERE id=$1',[workId]);
    assert.equal(privateRow.rows[0]?.private_fields.cost,'45.00');
    const activeWorker=await login(orgA,worker+'@test.example',randomUUID());
    for(const limitedAccess of [accessManager,activeWorker]) {
      const limited=await request('/api/v1/sync/snapshot','GET',undefined,limitedAccess);
      assert.equal(limited.status,200);
      const limitedItem:{entityId:string;snapshot:Record<string,unknown>}|undefined=
        (limited.body.entities as Array<{entityId:string;snapshot:Record<string,unknown>}>).find(x=>x.entityId===workId);
      assert.ok(limitedItem);assert.equal(Object.hasOwn(limitedItem.snapshot,'privateData'),false);
      const feed=await request('/api/v1/sync/pull?cursor=0&limit=100','GET',undefined,limitedAccess);
      assert.equal(feed.status,200);
      assert.equal((feed.body.changes as Array<{snapshot:Record<string,unknown>}>).some(x=>Object.hasOwn(x.snapshot,'privateData')),false);
    }
    const folder=await mkdtemp(join(tmpdir(),'arhilab-f1-device-b-'));
    try {
      const store=new JsonFileSyncStore(join(folder,'state.json'));
      const transport=new HttpSyncTransport(base+'/api/v1',{accessToken:async()=>accessA2,refresh:async()=>false});
      let deviceB=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await deviceB.syncNow()).state,'idle');
      const synced=deviceB.entities[estimate.entityId];
      assert.equal(synced?.delivery,'75.20');assert.equal(synced?.discount,'5.10');
      assert.equal(synced?.workMarkupPercent,'0.00');
      deviceB=await SyncCoordinator.open(store,transport,()=>false);
      assert.equal(deviceB.summary().state,'offline');
      assert.deepEqual(deviceB.entities[estimate.entityId],synced);
      const ops=fixture.operations.filter(x=>x.entityType==='estimateItem');
      const work=deviceB.entities[ops[0]!.entityId],material=deviceB.entities[ops[1]!.entityId];
      const rows=[work,material];
      const w=rows.find(x=>x?.kind==='work'),m=rows.find(x=>x?.kind==='material');
      assert.equal(calc({lines:[{price:w?.price,qty:w?.quantity,coef:w?.coefficient,autoMaterial:w?.autoMaterial,materialPrice:w?.materialPrice}],
        materials:[{price:m?.price,qty:m?.quantity}],workMarkupPercent:synced?.workMarkupPercent,
        delivery:Number(synced?.delivery),discount:Number(synced?.discount)}).total,470.1);
      const localOperation=op('estimate',estimate.entityId,'update',1,{workMarkupPercent:'20.00'});
      await deviceB.localWrite(estimate.entityId,{...synced,workMarkupPercent:'20.00'},
        {...localOperation,entityType:'estimate',entityId:estimate.entityId,operationType:'update',baseRevision:1,payload:{workMarkupPercent:'20.00'}});
      const first=await push([op('estimate',estimate.entityId,'update',1,{workMarkupPercent:'10.00'})],accessOwner);
      assert.equal(first.results[0]?.status,'applied');
      deviceB=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await deviceB.syncNow()).state,'conflict');
      assert.equal(deviceB.entities[estimate.entityId]?.workMarkupPercent,'20.00');
      deviceB=await SyncCoordinator.open(store,transport,()=>false);
      assert.equal(deviceB.entities[estimate.entityId]?.workMarkupPercent,'20.00');
      assert.equal(deviceB.summary().conflicts,1);
      const stored=await pool.query<{work_markup_percent:string}>('SELECT work_markup_percent FROM estimates WHERE id=$1',[estimate.entityId]);
      assert.equal(stored.rows[0]?.work_markup_percent,'10.00');
    } finally {await rm(folder,{recursive:true,force:true});}
});

test('consistent bootstrap covers a large 0.6.2-scale estimate and 100 objects',async()=>{
  const parent=randomUUID(),estimate=randomUUID();
  await pool.query('INSERT INTO projects(id,organization_id,name) VALUES($1,$2,$3)',[parent,orgA,'Large estimate project']);
  await pool.query('INSERT INTO estimates(id,organization_id,project_id,name) VALUES($1,$2,$3,$4)',[estimate,orgA,parent,'Large estimate']);
  await pool.query(`INSERT INTO projects(id,organization_id,name)
    SELECT gen_random_uuid(),$1,'Object '||n FROM generate_series(1,100) AS n`,[orgA]);
  await pool.query(`INSERT INTO estimate_items(id,organization_id,estimate_id,title,quantity)
    SELECT gen_random_uuid(),$1,$2,'Item '||n,1 FROM generate_series(1,1100) AS n`,[orgA,estimate]);
  const snapshot=await request('/api/v1/sync/snapshot','GET',undefined,accessA2);
  assert.equal(snapshot.status,200);
  const entities=snapshot.body.entities as Array<{entityType:string;entityId:string}>;
  assert.equal(entities.filter(x=>x.entityType==='estimateItem'&&x.entityId).length>=1100,true);
  assert.equal(entities.filter(x=>x.entityType==='project').length>=101,true);
  assert.equal((snapshot.body.cursor as string).length>0,true);
  const other=await request('/api/v1/sync/snapshot','GET',undefined,accessB);
  assert.equal((other.body.entities as Array<{entityId:string}>).some(x=>x.entityId===estimate),false);
});

test('F2 Android serialized payment survives lost response, PostgreSQL sync and offline Device B restart',
  {skip:!process.env.F2_CLIENT_FIXTURE_PATH},async()=>{
    const fixture=JSON.parse(await readFile(process.env.F2_CLIENT_FIXTURE_PATH!,'utf8')) as
      {operations:Operation[];paymentId:string;estimateId:string;projectId:string};
    assert.deepEqual(fixture.operations.map(x=>x.entityType),['project','estimate','estimate','payment']);
    const owner=await login(orgA,adminA+'@test.example',randomUUID());
    const created=await push(fixture.operations,owner);
    assert.deepEqual(created.results.map(x=>x.status),Array(4).fill('applied'));
    const lost=await push(fixture.operations,owner);
    assert.deepEqual(lost.results.map(x=>x.status),Array(4).fill('duplicate'));
    const row=await pool.query<{amount:string;paid_amount:string;currency:string;estimate_id:string;business_date:string}>(
      'SELECT amount,paid_amount,currency,estimate_id,business_date::text FROM payments WHERE id=$1',[fixture.paymentId]);
    assert.equal(row.rowCount,1);assert.equal(row.rows[0]?.paid_amount,'30000.00');
    assert.equal(row.rows[0]?.estimate_id,fixture.estimateId);
    assert.equal((await pool.query('SELECT id FROM audit_logs WHERE entity_type=$1 AND entity_id=$2',
      ['payment',fixture.paymentId])).rowCount,1);
    const managerAccess=await login(orgA,`${manager}@test.example`,randomUUID());
    const workerAccess=await login(orgA,`${worker}@test.example`,randomUUID());
    for(const limited of [managerAccess,workerAccess]) {
      const snapshot=await request('/api/v1/sync/snapshot','GET',undefined,limited);
      assert.equal((snapshot.body.entities as Array<{entityId:string}>).some(x=>x.entityId===fixture.paymentId),false);
      const feed=await request('/api/v1/sync/pull?cursor=0&limit=100','GET',undefined,limited);
      assert.equal((feed.body.changes as Array<{entityType:string}>).some(x=>x.entityType==='payment'),false);
      assert.equal((await push([op('payment',randomUUID(),'create',0,{projectId:fixture.projectId,
        amount:'1.00',currency:'EUR'})],limited)).status,403);
    }
    const folder=await mkdtemp(join(tmpdir(),'arhilab-f2-device-b-'));
    try {
      const accessSecond=await login(orgA,adminA+'@test.example',randomUUID());
      const store=new JsonFileSyncStore(join(folder,'state.json'));
      const transport=new HttpSyncTransport(base+'/api/v1',{accessToken:async()=>accessSecond,refresh:async()=>false});
      let second=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await second.syncNow()).state,'idle');
      assert.equal(second.entities[fixture.paymentId]?.paidAmount,'30000.00');
      assert.equal(second.entities[fixture.estimateId]?.currency,'EUR');
      const totals=paymentMath.summary(second.entities[fixture.estimateId]!,
        [second.entities[fixture.paymentId]!], '100000.00');
      assert.equal(totals.paid,3000000n);assert.equal(totals.remaining,7000000n);
      second=await SyncCoordinator.open(store,transport,()=>false);
      assert.equal(second.entities[fixture.paymentId]?.paidAmount,'30000.00');
      assert.ok(BigInt(second.cursor)>0n);
      const edit=op('payment',fixture.paymentId,'update',1,{amount:'55000.00',paidAmount:'55000.00',comment:'Исправлено'});
      assert.equal((await push([edit],owner)).results[0]?.status,'applied');
      const stale=op('payment',fixture.paymentId,'update',1,{paidAmount:'40000.00'});
      const conflict=await push([stale],accessSecond);
      assert.equal(conflict.results[0]?.status,'conflict');assert.ok(conflict.results[0]?.conflictId);
      assert.equal((await pool.query<{paid_amount:string}>('SELECT paid_amount FROM payments WHERE id=$1',
        [fixture.paymentId])).rows[0]?.paid_amount,'55000.00');
      second=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await second.syncNow()).state,'idle');
      assert.equal(second.entities[fixture.paymentId]?.paidAmount,'55000.00');
      const removed=await push([op('payment',fixture.paymentId,'delete',2,{})],owner);
      assert.equal(removed.results[0]?.status,'applied');
      second=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await second.syncNow()).state,'idle');
      assert.ok(second.entities[fixture.paymentId]?.deletedAt);
      assert.equal((await pool.query('SELECT id FROM audit_logs WHERE entity_type=$1 AND entity_id=$2',
        ['payment',fixture.paymentId])).rowCount,3);
    } finally {await rm(folder,{recursive:true,force:true});}
});

test('F2 ownership, currency, tenant collision, stale delete/update and payment paging',async()=>{
  const owner=await login(orgA,adminA+'@test.example',randomUUID());
  const project=randomUUID(),otherProject=randomUUID(),estimate=randomUUID(),otherEstimate=randomUUID();
  const setup=await push([op('project',project,'create',0,{name:'F2 project'}),
    op('project',otherProject,'create',0,{name:'Other F2 project'}),
    op('estimate',estimate,'create',0,{projectId:project,name:'F2 estimate',currency:'EUR'}),
    op('estimate',otherEstimate,'create',0,{projectId:otherProject,name:'Other estimate',currency:'USD'})],owner);
  assert.deepEqual(setup.results.map(x=>x.status),Array(4).fill('applied'));
  for(const payload of [
    {projectId:project,estimateId:otherEstimate,amount:'10.00',paidAmount:'10.00',currency:'USD',kind:'income'},
    {projectId:project,estimateId:estimate,amount:'10.00',paidAmount:'10.00',currency:'USD',kind:'income'},
    {projectId:project,estimateId:estimate,amount:'10.00',paidAmount:'10.00',currency:'EUR',kind:'expense'},
    {projectId:project,estimateId:estimate,amount:'0.00',paidAmount:'0.00',currency:'EUR',kind:'income'},
    {projectId:project,estimateId:estimate,amount:'10.00',paidAmount:'11.00',currency:'EUR',kind:'income'},
  ]) assert.equal((await push([op('payment',randomUUID(),'create',0,payload)],owner)).results[0]?.status,'rejected');
  const id=randomUUID(),payment={projectId:project,estimateId:estimate,amount:'10.00',paidAmount:'10.00',currency:'EUR',kind:'income',businessDate:'2026-09-27'};
  assert.equal((await push([op('payment',id,'create',0,payment)],owner)).results[0]?.status,'applied');
  assert.equal((await push([op('estimate',estimate,'update',1,{currency:'USD'})],owner)).results[0]?.code,'currency_has_payments');
  const deleteFirst=await push([op('payment',id,'delete',1,{})],owner);
  assert.equal(deleteFirst.results[0]?.status,'applied');
  assert.equal((await push([op('payment',id,'update',1,{comment:'Late edit'})],owner)).results[0]?.status,'conflict');
  const id2=randomUUID();assert.equal((await push([op('payment',id2,'create',0,payment)],owner)).results[0]?.status,'applied');
  assert.equal((await push([op('payment',id2,'update',1,{comment:'Edited'})],owner)).results[0]?.status,'applied');
  assert.equal((await push([op('payment',id2,'delete',1,{})],owner)).results[0]?.status,'conflict');
  const fromB=await push([op('payment',id2,'create',0,payment)],accessB);
  assert.equal(fromB.results[0]?.status,'rejected');
  const outside=await request('/api/v1/sync/snapshot','GET',undefined,accessB);
  assert.equal((outside.body.entities as Array<{entityId:string}>).some(x=>x.entityId===id2),false);
  const issued:Operation[]=[];
  for(let i=0;i<105;i++)issued.push(op('payment',randomUUID(),'create',0,
    {...payment,amount:'0.01',paidAmount:'0.01',businessDate:'2026-09-27'}));
  for(let i=0;i<issued.length;i+=50) assert.ok((await push(issued.slice(i,i+50),owner)).results.every(r=>r.status==='applied'));
  const snapshot=await request('/api/v1/sync/snapshot','GET',undefined,owner);
  assert.equal((snapshot.body.entities as Array<{entityType:string;entityId:string}>).filter(x=>x.entityType==='payment'&&issued.some(p=>p.entityId===x.entityId)).length,105);
});

test('F3 Android offline expense -> HTTP/PostgreSQL -> second device restart, idempotency, conflict and privacy',
  {skip:!process.env.F3_CLIENT_FIXTURE_PATH},async()=>{
    // The prior 105-payment paging test legitimately exhausts the general IP limiter.
    // Keep production limits intact while giving this independent device scenario a fresh HTTP server.
    await restartTestHttpServer();
    const fixture=JSON.parse(await readFile(process.env.F3_CLIENT_FIXTURE_PATH!,'utf8')) as
      {operations:Operation[];expenseId:string;estimateId:string;projectId:string;paymentId:string};
    assert.deepEqual(fixture.operations.map(x=>x.entityType),['project','estimate','payment','expense']);
    const owner=await login(orgA,adminA+'@test.example',randomUUID());
    const created=await push(fixture.operations,owner);
    assert.deepEqual(created.results.map(x=>x.status),Array(4).fill('applied'));
    const retry=await push(fixture.operations,owner); // Applied server-side, reply lost, client restarts and resends same IDs.
    assert.deepEqual(retry.results.map(x=>x.status),Array(4).fill('duplicate'));
    assert.equal((await pool.query('SELECT id FROM expenses WHERE id=$1',[fixture.expenseId])).rowCount,1);
    assert.equal((await pool.query('SELECT sequence FROM sync_changes WHERE organization_id=$1 AND entity_id=$2',
      [orgA,fixture.expenseId])).rowCount,1);
    assert.equal((await pool.query('SELECT id FROM audit_logs WHERE entity_type=$1 AND entity_id=$2',
      ['expense',fixture.expenseId])).rowCount,1);
    const limitedManager=await login(orgA,`${manager}@test.example`,randomUUID());
    const limitedWorker=await login(orgA,`${worker}@test.example`,randomUUID());
    for(const limited of [limitedManager,limitedWorker]){
      assert.equal((await push([op('expense',randomUUID(),'create',0,{projectId:fixture.projectId,
        category:'other',amount:'1.00',currency:'EUR',businessDate:'2026-09-27',description:'Forbidden'})],limited)).status,403);
      const snapshot=await request('/api/v1/sync/snapshot','GET',undefined,limited);
      assert.equal((snapshot.body.entities as Array<{entityId:string}>).some(x=>x.entityId===fixture.expenseId),false);
      const feed=await request('/api/v1/sync/pull?cursor=0','GET',undefined,limited);
      assert.equal((feed.body.changes as Array<{entityType:string}>).some(x=>x.entityType==='expense'),false);
    }
    const folder=await mkdtemp(join(tmpdir(),'arhilab-f3-device-b-'));
    try {
      const secondAccess=await login(orgA,adminA+'@test.example',randomUUID());
      const store=new JsonFileSyncStore(join(folder,'state.json'));
      const transport=new HttpSyncTransport(base+'/api/v1',{accessToken:async()=>secondAccess,refresh:async()=>false});
      let second=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await second.syncNow()).state,'idle');
      assert.equal(second.entities[fixture.expenseId]?.amount,'210000.00');
      const totals=expenseMath.summary(second.entities[fixture.estimateId]!,
        [second.entities[fixture.paymentId]!],[second.entities[fixture.expenseId]!],'1000000.00');
      assert.equal(totals.cashResult,19000000n);
      assert.equal(totals.forecastGrossProfit,79000000n);
      assert.equal(totals.forecastMargin,7900n);
      second=await SyncCoordinator.open(store,transport,()=>false);
      assert.equal(second.entities[fixture.expenseId]?.amount,'210000.00');
      assert.ok(BigInt(second.cursor)>0n);
      const edit=op('expense',fixture.expenseId,'update',1,{amount:'220000.00'});
      assert.equal((await push([edit],owner)).results[0]?.status,'applied');
      const stale=await push([op('expense',fixture.expenseId,'update',1,{amount:'230000.00'})],secondAccess);
      assert.equal(stale.results[0]?.status,'conflict');
      assert.equal((await pool.query<{amount:string}>('SELECT amount FROM expenses WHERE id=$1',
        [fixture.expenseId])).rows[0]?.amount,'220000.00');
      assert.equal((await push([op('expense',fixture.expenseId,'delete',1,{})],owner)).results[0]?.status,'conflict');
      assert.equal((await push([op('expense',fixture.expenseId,'delete',2,{})],owner)).results[0]?.status,'applied');
      assert.equal((await push([op('expense',fixture.expenseId,'update',2,{amount:'240000.00'})],secondAccess)).results[0]?.status,'conflict');
      second=await SyncCoordinator.open(store,transport,()=>true);
      assert.equal((await second.syncNow()).state,'idle');
      assert.ok(second.entities[fixture.expenseId]?.deletedAt);
      assert.equal((await pool.query('SELECT id FROM audit_logs WHERE entity_type=$1 AND entity_id=$2',
        ['expense',fixture.expenseId])).rowCount,3);
    }finally{await rm(folder,{recursive:true,force:true});}
    const foreignAccess=await login(orgB,`${adminB}@test.example`,randomUUID());
    const alien=await push([op('expense',fixture.expenseId,'create',0,
      {projectId:fixture.projectId,category:'other',amount:'1.00',currency:'EUR',businessDate:'2026-09-27',description:'Collision'})],foreignAccess);
    assert.equal(alien.results[0]?.status,'rejected');
    assert.equal(((await request('/api/v1/sync/snapshot','GET',undefined,foreignAccess)).body.entities as
      Array<{entityId:string}>).some(x=>x.entityId===fixture.expenseId),false);
});

test('F3 expense owner, amount, currency isolation, foreign estimate and concurrent revisions',async()=>{
  const owner=await login(orgA,`${adminA}@test.example`,randomUUID());
  const alternate=await login(orgA,`${adminA}@test.example`,randomUUID());
  const foreign=await login(orgB,`${adminB}@test.example`,randomUUID());
  const project=randomUUID(),otherProject=randomUUID(),estimate=randomUUID(),foreignEstimate=randomUUID();
  const setup=await push([op('project',project,'create',0,{name:'Expense project'}),
    op('project',otherProject,'create',0,{name:'Different project'}),
    op('estimate',estimate,'create',0,{projectId:project,name:'Estimate'}),
    op('estimate',foreignEstimate,'create',0,{projectId:otherProject,name:'Other estimate'})],owner);
  assert.ok(setup.results.every(x=>x.status==='applied'));
  const valid={projectId:project,estimateId:estimate,category:'labor',amount:'0.01',currency:'EUR',
    businessDate:'2026-09-27',description:'Work'};
  for(const bad of [{...valid,estimateId:foreignEstimate},{...valid,amount:'0.00'},
    {...valid,currency:''},{...valid,description:''},{...valid,category:'unknown'}])
    assert.equal((await push([op('expense',randomUUID(),'create',0,bad)],owner)).results[0]?.status,'rejected');
  const id=randomUUID(),created=await push([op('expense',id,'create',0,valid)],owner);
  assert.equal(created.results[0]?.status,'applied');
  const [first,second]=await Promise.all([
    push([op('expense',id,'update',1,{amount:'0.02'})],owner),
    push([op('expense',id,'update',1,{amount:'0.03'})],alternate)]);
  assert.deepEqual([first.results[0]?.status,second.results[0]?.status].sort(),['applied','conflict']);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM expenses WHERE id=$1',[id])).rows[0]?.revision,'2');
  const alien=await push([op('expense',id,'update',1,{amount:'10.00'})],foreign);
  assert.equal(alien.results[0]?.status,'rejected');
  assert.equal((await request('/api/v1/sync/pull?cursor=0','GET',undefined,foreign)).status,200);
  const projectOnly=randomUUID();
  assert.equal((await push([op('expense',projectOnly,'create',0,{...valid,estimateId:null,currency:'USD'})],owner)).results[0]?.status,'applied');
  assert.equal((await pool.query<{estimate_id:string|null}>('SELECT estimate_id FROM expenses WHERE id=$1',[projectOnly])).rows[0]?.estimate_id,null);
  // Explicit project-only values cannot be silently included in a selected estimate.
  const snapshot=await request('/api/v1/sync/snapshot','GET',undefined,owner);
  assert.equal((snapshot.body.entities as Array<{entityId:string;snapshot:{estimateId:string|null}}>).find(x=>x.entityId===projectOnly)?.snapshot.estimateId,null);
});
