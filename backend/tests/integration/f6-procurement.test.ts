import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Server} from 'node:http';
import {pool} from '../../src/database/pool.js';
import {createApp} from '../../src/app.js';
import {hashPassword} from '../../src/services/security.js';
import {JsonFileSyncStore,SyncCoordinator} from '../../src/sync/client/local-first.js';
import {HttpSyncTransport} from '../../src/sync/client/http-transport.js';
const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),otherAdmin=randomUUID(),worker=randomUUID(),manager=randomUUID();
const password=randomUUID()+randomUUID();
let server:Server,base:string,access:string,otherAccess:string,workerAccess:string,managerAccess:string,foreignAccess:string;
type Operation={operationId:string;idempotencyKey:string;entityType:string;entityId:string;operationType:string;baseRevision:number;payload:Record<string,unknown>;occurredAt:string};
const op=(entityType:string,entityId:string,operationType:string,baseRevision:number,payload:Record<string,unknown>):Operation=>
 ({operationId:randomUUID(),idempotencyKey:randomUUID(),entityType,entityId,operationType,baseRevision,payload,occurredAt:new Date().toISOString()});
async function request(path:string,method='GET',body?:object,token=access){const response=await fetch(base+path,{method,
 headers:{...(body?{'content-type':'application/json'}:{}),authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json() as Record<string,unknown>};}
async function push(ops:Operation[],token=access){const response=await request('/api/v1/sync/push','POST',{operations:ops},token);
 return {status:response.status,results:response.body.results as Array<{status:string;code?:string;conflictId?:string;resultingRevision?:number;originalStatus?:string}>};}
async function login(tenant:string,user:string){const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({organizationId:tenant,email:user+'@f6.example',password,deviceId:randomUUID()})});
 assert.equal(response.status,200);return String((await response.json() as {accessToken:string}).accessToken);}
before(async()=>{
 await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[org,'F6 '+org,otherOrg,'Foreign '+otherOrg]);
 const hash=await hashPassword(password);
 for(const [id,tenant,role] of [[admin,org,'admin'],[otherAdmin,otherOrg,'admin'],[worker,org,'worker'],[manager,org,'manager']])
  await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,tenant,id+'@f6.example',role,role,hash]);
 server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No port');base='http://127.0.0.1:'+address.port;
 access=await login(org,admin);otherAccess=await login(org,admin);workerAccess=await login(org,worker);
 managerAccess=await login(org,manager);foreignAccess=await login(otherOrg,otherAdmin);
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
test('F6 Android queued fixture, real HTTP/PostgreSQL, duplicate retry, second device, privacy and receipt races',async()=>{
 const fixture=JSON.parse(await readFile(process.env.F6_CLIENT_FIXTURE_PATH!,'utf8')) as
  {operations:Operation[];projectId:string;requestId:string;receiptId:string};
 const created=await push(fixture.operations);assert.equal(created.status,200);
 assert.deepEqual(created.results.map(x=>x.status),Array(fixture.operations.length).fill('applied'));
 const retry=await push(fixture.operations);assert.deepEqual(retry.results.map(x=>x.originalStatus),Array(fixture.operations.length).fill('applied'));
 assert.equal((await pool.query('SELECT id FROM procurement_requests WHERE id=$1',[fixture.requestId])).rowCount,1);
 assert.equal((await pool.query('SELECT id FROM procurement_receipts WHERE request_id=$1',[fixture.requestId])).rowCount,1);
 assert.equal((await pool.query('SELECT 1 FROM sync_changes WHERE entity_type=$1 AND entity_id=$2',['procurementReceipt',fixture.receiptId])).rowCount,1);
 const expense=fixture.operations.find(x=>x.entityType==='expense');assert.ok(expense);
 const expenseId=expense.entityId;
 assert.equal((await pool.query('SELECT id FROM expenses WHERE id=$1 AND procurement_request_id=$2',[expenseId,fixture.requestId])).rowCount,1);
 assert.equal((await push([op('expense',randomUUID(),'create',0,
  {...expense.payload,projectId:randomUUID()})])).results[0]?.status,'rejected');
 const invalid=[
  {projectId:randomUUID(),title:'Wrong',unit:'шт',requestedQuantity:'2',status:'requested'},
  {projectId:fixture.projectId,estimateId:randomUUID(),title:'Wrong',unit:'шт',requestedQuantity:'2',status:'requested'},
  {projectId:fixture.projectId,assigneeId:otherAdmin,title:'Wrong',unit:'шт',requestedQuantity:'2',status:'requested'},
 ];
 for(const payload of invalid)assert.equal((await push([op('procurementRequest',randomUUID(),'create',0,payload)])).results[0]?.status,'rejected');
 assert.equal((await push([op('procurementRequest',randomUUID(),'create',0,
  {projectId:fixture.projectId,title:'Unknown',unit:'шт',catalogSku:'not-a-sku',requestedQuantity:'1',status:'requested'})])).results[0]?.code,'unknown_catalog_sku');
 assert.equal((await push([op('procurementRequest',randomUUID(),'create',0,
  {projectId:fixture.projectId,title:'Wrong',unit:'шт',requestedQuantity:'2',status:'requested',createdBy:worker})])).results[0]?.code,'invalid_payload');
 assert.equal((await push([op('procurementReceipt',randomUUID(),'create',0,
  {projectId:randomUUID(),requestId:fixture.requestId,quantity:'1',businessDate:'2026-09-28'})])).results[0]?.status,'rejected');
 assert.equal((await push([op('procurementReceipt',randomUUID(),'create',0,
  {projectId:fixture.projectId,requestId:fixture.requestId,quantity:'2',businessDate:'2026-09-28'})])).results[0]?.code,'receipt_exceeds_requested');
 assert.equal((await push([op('procurementReceipt',randomUUID(),'create',0,
  {projectId:fixture.projectId,requestId:randomUUID(),quantity:'1',businessDate:'2026-09-28'})])).results[0]?.code,'invalid_procurement_context');
 assert.equal((await push([op('procurementRequest',fixture.requestId,'update',1,{status:'ordered'})],foreignAccess)).results[0]?.status,'rejected');
 assert.equal((await push([op('procurementRequest',randomUUID(),'create',0,
  {projectId:fixture.projectId,title:'No',unit:'шт',requestedQuantity:'1',status:'requested'})],workerAccess)).status,403);
 assert.equal((await push([op('procurementRequest',randomUUID(),'create',0,
  {projectId:fixture.projectId,title:'No',unit:'шт',requestedQuantity:'1',status:'requested'})],managerAccess)).status,403);
 const workerSnapshot=await request('/api/v1/sync/snapshot','GET',undefined,workerAccess);
 assert.equal((workerSnapshot.body.entities as Array<{entityType:string;entityId:string}>).some(e=>e.entityId===fixture.requestId),false);
 assert.equal((workerSnapshot.body.entities as Array<{entityType:string}>).some(e=>e.entityType==='procurementReceipt'||e.entityType==='expense'),false);
 const assign=await push([op('procurementRequest',fixture.requestId,'update',1,{assigneeId:worker})]);assert.equal(assign.results[0]?.status,'applied');
 const assigned=await request('/api/v1/sync/snapshot','GET',undefined,workerAccess);
 assert.equal((assigned.body.entities as Array<{entityType:string;entityId:string}>).some(e=>e.entityId===fixture.requestId),true);
 const folder=await mkdtemp(join(tmpdir(),'f6-device-b-'));
 try{const transport=new HttpSyncTransport(base+'/api/v1',{accessToken:async()=>otherAccess,refresh:async()=>false});
  let b=await SyncCoordinator.open(new JsonFileSyncStore(join(folder,'state.json')),transport,()=>true);
  assert.equal((await b.syncNow()).state,'idle');assert.equal(b.entities[fixture.receiptId]?.quantity,'1.2500');
  b=await SyncCoordinator.open(new JsonFileSyncStore(join(folder,'state.json')),transport,()=>false);
  assert.equal(b.entities[fixture.requestId]?.title,'Кабель');
 }finally{await rm(folder,{recursive:true,force:true});}
 const first=op('procurementReceipt',randomUUID(),'create',0,
  {projectId:fixture.projectId,requestId:fixture.requestId,quantity:'1.0000',businessDate:'2026-09-28'});
 const second=op('procurementReceipt',randomUUID(),'create',0,
  {projectId:fixture.projectId,requestId:fixture.requestId,quantity:'1.0000',businessDate:'2026-09-28'});
 const raced=await Promise.all([push([first]),push([second])]);
 assert.equal(raced.flatMap(x=>x.results).filter(x=>x.status==='applied').length,1);
 assert.equal((await pool.query<{total:string}>('SELECT sum(quantity)::text AS total FROM procurement_receipts WHERE request_id=$1 AND deleted_at IS NULL',[fixture.requestId])).rows[0]?.total,'2.2500');
 const stale=await push([op('procurementRequest',fixture.requestId,'update',1,{status:'cancelled'})],otherAccess);
 assert.equal(stale.results[0]?.status,'conflict');assert.ok(stale.results[0]?.conflictId);
 const edit=await push([op('procurementReceipt',fixture.receiptId,'update',1,{note:'Исправлено'})]);assert.equal(edit.results[0]?.status,'applied');
 assert.equal((await push([op('procurementReceipt',fixture.receiptId,'delete',1,{})],otherAccess)).results[0]?.status,'conflict');
 const receiptWin=await push([op('procurementReceipt',fixture.receiptId,'update',2,{note:'Второе уточнение'})]);
 assert.equal(receiptWin.results[0]?.status,'applied');
 const receiptStale=await push([op('procurementReceipt',fixture.receiptId,'update',2,{note:'Параллельное уточнение'})],otherAccess);
 assert.equal(receiptStale.results[0]?.status,'conflict');assert.ok(receiptStale.results[0]?.conflictId);
 const temporary=op('procurementReceipt',randomUUID(),'create',0,
  {projectId:fixture.projectId,requestId:fixture.requestId,quantity:'0.5000',businessDate:'2026-09-28'});
 assert.equal((await push([temporary])).results[0]?.status,'applied');
 assert.equal((await push([op('procurementReceipt',temporary.entityId,'delete',1,{})])).results[0]?.status,'applied');
 const resurrection=await push([op('procurementReceipt',temporary.entityId,'update',1,{note:'Вернуть незаметно'})],otherAccess);
 assert.equal(resurrection.results[0]?.status,'conflict');assert.ok(resurrection.results[0]?.conflictId);
 assert.equal((await pool.query('SELECT id FROM procurement_receipts WHERE id=$1 AND deleted_at IS NULL',[temporary.entityId])).rowCount,0);
 assert.equal((await push([op('procurementRequest',fixture.requestId,'delete',2,{})])).results[0]?.code,'request_has_receipt_history');
 const unassign=await push([op('procurementRequest',fixture.requestId,'update',2,{assigneeId:null})]);assert.equal(unassign.results[0]?.status,'applied');
 const reduced=await push([op('procurementRequest',fixture.requestId,'update',3,{requestedQuantity:'2.0000'})]);
 assert.equal(reduced.results[0]?.status,'applied');
 assert.equal((await pool.query<{total:string}>('SELECT sum(quantity)::text AS total FROM procurement_receipts WHERE request_id=$1 AND deleted_at IS NULL',[fixture.requestId])).rows[0]?.total,'2.2500');
 assert.equal((await push([op('procurementReceipt',randomUUID(),'create',0,
  {projectId:fixture.projectId,requestId:fixture.requestId,quantity:'0.0001',businessDate:'2026-09-28'})])).results[0]?.code,'receipt_exceeds_requested');
 assert.equal((await push([op('procurementRequest',fixture.requestId,'update',4,{status:'ordered'})])).results[0]?.status,'applied');
 const statusStale=await push([op('procurementRequest',fixture.requestId,'update',4,{status:'cancelled'})],otherAccess);
 assert.equal(statusStale.results[0]?.status,'conflict');assert.ok(statusStale.results[0]?.conflictId);
 const workerPull=await request('/api/v1/sync/pull?cursor=0&limit=100','GET',undefined,workerAccess);
 const visible=(workerPull.body.changes as Array<{entityType:string;entityId:string;operationType:string;snapshot:Record<string,unknown>}>);
 assert.equal(visible.some(row=>row.entityType==='procurementReceipt'),false);
 assert.ok(visible.some(row=>row.entityId===fixture.requestId&&row.operationType==='delete'&& !('title' in row.snapshot)));
});
