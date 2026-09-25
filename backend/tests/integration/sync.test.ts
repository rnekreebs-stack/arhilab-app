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
