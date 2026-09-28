import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/services/security.js';
import { JsonFileSyncStore,SyncCoordinator } from '../../src/sync/client/local-first.js';
import { HttpSyncTransport } from '../../src/sync/client/http-transport.js';

const org=randomUUID(),foreignOrg=randomUUID(),admin=randomUUID(),foreignAdmin=randomUUID(),worker=randomUUID(),manager=randomUUID();
const password=randomUUID()+randomUUID(); // Ephemeral CI credential, never stored in the repository.
let server:Server,base:string,access:string,otherAccess:string,workerAccess:string,managerAccess:string,foreignAccess:string;
type Operation={operationId:string;idempotencyKey:string;entityType:string;entityId:string;operationType:string;baseRevision:number;payload:Record<string,unknown>;occurredAt:string};
const op=(entityType:string,entityId:string,operationType:string,baseRevision:number,payload:Record<string,unknown>):Operation=>
  ({operationId:randomUUID(),idempotencyKey:randomUUID(),entityType,entityId,operationType,baseRevision,payload,occurredAt:new Date().toISOString()});
async function request(path:string,method='GET',body?:object,token=access){
  const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),authorization:'Bearer '+token},
    ...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json() as Record<string,unknown>};
}
async function push(ops:Operation[],token=access){const response=await request('/api/v1/sync/push','POST',{operations:ops},token);
  return {status:response.status,results:response.body.results as Array<{status:string;code?:string;resultingRevision?:number;conflictId?:string;originalStatus?:string}>};}
async function login(orgId:string,user:string){const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({organizationId:orgId,email:user+'@f5.example',password,deviceId:randomUUID()})});
  assert.equal(response.status,200);return String((await response.json() as {accessToken:string}).accessToken);
}
before(async()=>{
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[org,'F5 '+org,foreignOrg,'Foreign '+foreignOrg]);
  const hash=await hashPassword(password);
  for(const [id,tenant,role] of [[admin,org,'admin'],[foreignAdmin,foreignOrg,'admin'],[worker,org,'worker'],[manager,org,'manager']])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',
      [id,tenant,id+'@f5.example',role,role,hash]);
  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No port');
  base='http://127.0.0.1:'+address.port;
  access=await login(org,admin);otherAccess=await login(org,admin);
  workerAccess=await login(org,worker);managerAccess=await login(org,manager);
  foreignAccess=await login(foreignOrg,foreignAdmin);
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

test('F5 Android offline fixture, HTTP PostgreSQL, second device, conflict, idempotency and tenant privacy',async()=>{
  const fixture=JSON.parse(await readFile(process.env.F5_CLIENT_FIXTURE_PATH!,'utf8')) as
    {operations:Operation[];projectId:string;estimateId:string;taskId:string;legacyId:string};
  const first=await push(fixture.operations);assert.equal(first.status,200);
  assert.deepEqual(first.results.map(x=>x.status),Array(fixture.operations.length).fill('applied'));
  const duplicate=await push(fixture.operations);
  assert.deepEqual(duplicate.results.map(x=>x.originalStatus),Array(fixture.operations.length).fill('applied'));
  const rows=await pool.query<{id:string;description:string;due_date:string;priority:string;created_by:string}>(
    'SELECT id,description,due_date,priority,created_by FROM tasks WHERE organization_id=$1 AND project_id=$2',[org,fixture.projectId]);
  assert.equal(rows.rowCount,2);assert.ok(rows.rows.every(row=>row.created_by===admin));
  assert.equal(rows.rows.find(row=>row.id===fixture.taskId)?.priority,'urgent');
  assert.equal((await pool.query('SELECT sequence FROM sync_changes WHERE entity_type=$1 AND entity_id=$2',
    ['task',fixture.taskId])).rowCount,1);
  const invalid=[
    {projectId:randomUUID(),title:'Foreign',status:'open'},
    {projectId:fixture.projectId,estimateId:randomUUID(),title:'Other estimate',status:'open'},
    {projectId:fixture.projectId,estimateId:fixture.estimateId,stageId:randomUUID(),title:'Other stage',status:'open'},
    {projectId:fixture.projectId,assigneeId:foreignAdmin,title:'Other worker',status:'open'},
  ];
  for(const payload of invalid)assert.equal((await push([op('task',randomUUID(),'create',0,payload)])).results[0]?.status,'rejected');
  assert.equal((await push([op('task',randomUUID(),'create',0,{projectId:fixture.projectId,title:'Wrong author',status:'open',createdBy:worker})])).results[0]?.code,'invalid_payload');
  assert.equal((await push([op('task',fixture.taskId,'update',1,{title:'Hijack'})],foreignAccess)).results[0]?.status,'rejected');
  assert.equal((await push([op('task',randomUUID(),'create',0,{projectId:fixture.projectId,title:'Denied',status:'open'})],managerAccess)).status,403);
  assert.equal((await push([op('task',randomUUID(),'create',0,{projectId:fixture.projectId,title:'Denied',status:'open'})],workerAccess)).status,403);
  const workerView=await request('/api/v1/sync/snapshot','GET',undefined,workerAccess);
  assert.equal(workerView.status,200);
  assert.equal((workerView.body.entities as Array<{entityType:string;entityId:string}>)
    .some(entity=>entity.entityType==='task'&&entity.entityId===fixture.taskId),false);
  const workerPage=await request('/api/v1/sync/pull?cursor=0&limit=100','GET',undefined,workerAccess);
  assert.equal((workerPage.body.changes as Array<{entityType:string}>).some(row=>row.entityType==='task'),false);
  const assign=op('task',fixture.taskId,'update',1,{assigneeId:worker});
  assert.equal((await push([assign])).results[0]?.status,'applied');
  const assigned=await request('/api/v1/sync/snapshot','GET',undefined,workerAccess);
  assert.equal((assigned.body.entities as Array<{entityType:string;entityId:string}>)
    .some(entity=>entity.entityType==='task'&&entity.entityId===fixture.taskId),true);
  const off=op('task',fixture.taskId,'update',2,{assigneeId:null});
  assert.equal((await push([off])).results[0]?.status,'applied');
  const reassigned=await request('/api/v1/sync/pull?cursor='+String(BigInt(String(first.results.at(-1)?.resultingRevision??1)))+'&limit=100','GET',undefined,workerAccess);
  const revocations=(reassigned.body.changes as Array<{entityId:string;operationType:string;snapshot:Record<string,unknown>}>)
    .filter(row=>row.entityId===fixture.taskId&&row.operationType==='delete');
  assert.equal(revocations.length,1);assert.equal('title' in revocations[0]!.snapshot,false);
  const folder=await mkdtemp(join(tmpdir(),'f5-device-b-'));
  try {
    const transport=new HttpSyncTransport(base+'/api/v1',{accessToken:async()=>otherAccess,refresh:async()=>false});
    let device=await SyncCoordinator.open(new JsonFileSyncStore(join(folder,'state.json')),transport,()=>true);
    assert.equal((await device.syncNow()).state,'idle');
    assert.equal(device.entities[fixture.taskId]?.title,'Монтаж трапа');
    device=await SyncCoordinator.open(new JsonFileSyncStore(join(folder,'state.json')),transport,()=>false);
    assert.equal(device.entities[fixture.taskId]?.priority,'urgent');
  }finally{await rm(folder,{recursive:true,force:true});}
  const win=op('task',fixture.taskId,'update',3,{status:'done'});
  assert.equal((await push([win])).results[0]?.status,'applied');
  const completed=await pool.query<{completed_at:Date|null}>('SELECT completed_at FROM tasks WHERE id=$1',[fixture.taskId]);
  assert.ok(completed.rows[0]?.completed_at);
  const stale=await push([op('task',fixture.taskId,'update',3,{status:'in_progress'})],otherAccess);
  assert.equal(stale.results[0]?.status,'conflict');assert.ok(stale.results[0]?.conflictId);
  assert.equal((await pool.query('SELECT id FROM audit_logs WHERE entity_type=$1 AND entity_id=$2',
    ['task',fixture.taskId])).rowCount,4);
  const reopened=await push([op('task',fixture.taskId,'update',4,{status:'open'})]);
  assert.equal(reopened.results[0]?.status,'applied');
  assert.equal((await pool.query<{completed_at:Date|null}>('SELECT completed_at FROM tasks WHERE id=$1',[fixture.taskId])).rows[0]?.completed_at,null);
  assert.equal((await push([op('task',fixture.taskId,'delete',5,{})])).results[0]?.status,'applied');
  assert.equal((await push([op('task',fixture.taskId,'update',5,{title:'Resurrect'})],otherAccess)).results[0]?.status,'conflict');
  assert.equal((await pool.query('SELECT id FROM tasks WHERE id=$1 AND deleted_at IS NULL',[fixture.taskId])).rowCount,0);
  const stage=randomUUID(),nextStage=randomUUID(),item=randomUUID(),linkedTask=randomUUID();
  const linked=await push([
    op('stage',stage,'create',0,{projectId:fixture.projectId,estimateId:fixture.estimateId,name:'Черновые',position:0}),
    op('stage',nextStage,'create',0,{projectId:fixture.projectId,estimateId:fixture.estimateId,name:'Чистовые',position:1}),
    op('estimateItem',item,'create',0,{estimateId:fixture.estimateId,title:'Стяжка',kind:'work',quantity:'2.0000',stageId:stage}),
    op('task',linkedTask,'create',0,{projectId:fixture.projectId,estimateId:fixture.estimateId,
      stageId:stage,estimateItemId:item,title:'Проверить стяжку',status:'open',priority:'high'}),
  ]);
  assert.deepEqual(linked.results.map(x=>x.status),['applied','applied','applied','applied']);
  assert.equal((await push([op('estimateItem',item,'update',1,{stageId:nextStage})])).results[0]?.status,'applied');
  assert.equal((await push([op('stage',stage,'delete',1,{})])).results[0]?.status,'applied');
  assert.equal((await push([op('task',linkedTask,'update',1,{status:'in_progress'})])).results[0]?.status,'applied');
  const historical=await pool.query<{stage_id:string;estimate_item_id:string}>('SELECT stage_id,estimate_item_id FROM tasks WHERE id=$1',[linkedTask]);
  assert.equal(historical.rows[0]?.stage_id,stage);assert.equal(historical.rows[0]?.estimate_item_id,item);
});
