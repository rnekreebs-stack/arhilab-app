import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/services/security.js';

const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),otherAdmin=randomUUID(),manager=randomUUID(),worker=randomUUID(),password='conflict test password 123';
let server:Server,base:string,tAdmin:string,tOther:string,tManager:string,tWorker:string;
async function call(path:string,method='GET',body?:object,token?:string) {
  const res=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await res.text();return {status:res.status,body:text?JSON.parse(text) as Record<string,unknown>:{}};
}
function op(entityId:string,operationType:string,baseRevision:number,payload:object) {return {operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'project',entityId,operationType,baseRevision,payload,occurredAt:new Date().toISOString()};}
async function push(item:ReturnType<typeof op>,token=tAdmin) {
  const r=await call('/api/v1/sync/push','POST',{operations:[item]},token);
  assert.equal(r.status,200);return (r.body.results as Array<Record<string,unknown>>)[0]!;
}
async function login(organizationId:string,id:string) {
  const r=await call('/api/v1/auth/login','POST',{organizationId,email:id+'@test.example',password,deviceId:randomUUID()});
  assert.equal(r.status,200);return String(r.body.accessToken);
}
before(async()=>{
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[org,'Conflicts '+org,otherOrg,'Other '+otherOrg]);
  const hash=await hashPassword(password);
  for(const [id,organizationId,role] of [[admin,org,'admin'],[otherAdmin,otherOrg,'admin'],[manager,org,'manager'],[worker,org,'worker']]) await pool.query(
    'INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,organizationId,id+'@test.example',role,role,hash]);
  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');base='http://127.0.0.1:'+address.port;
  tAdmin=await login(org,admin);tOther=await login(otherOrg,otherAdmin);tManager=await login(org,manager);tWorker=await login(org,worker);
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

test('stale requests persist both immutable snapshots once, scoped to the tenant',async()=>{
  const id=randomUUID(),create=op(id,'create',0,{name:'Original'});
  assert.equal((await push(create)).status,'applied');
  assert.equal((await push(op(id,'update',1,{name:'Server change'}))).status,'applied');
  const stale=op(id,'update',1,{name:'Client proposal'});
  const [a,b]=await Promise.all([push(stale),push(stale)]);
  assert.deepEqual([a.status,b.status].sort(),['conflict','duplicate']);
  const conflictId=String((a.status==='conflict'?a:b).conflictId);
  assert.equal(a.conflictId,b.conflictId);
  const detail=await call('/api/v1/sync/conflicts/'+conflictId,'GET',undefined,tAdmin);
  assert.equal(detail.status,200);
  assert.equal((detail.body.clientProposal as {name:string}).name,'Client proposal');
  assert.equal((detail.body.serverSnapshot as {name:string}).name,'Server change');
  assert.equal(detail.body.baseRevision,1);assert.equal(detail.body.serverRevisionAtConflict,2);
  assert.equal((await pool.query('SELECT id FROM sync_conflicts WHERE source_sync_operation_id=$1',[stale.operationId])).rowCount,1);
  assert.equal((await call('/api/v1/sync/conflicts/'+conflictId,'GET',undefined,tOther)).status,404);
  assert.equal((await call('/api/v1/sync/conflicts/'+conflictId+'/resolve','POST',{type:'keep_server',expectedRevision:2},tOther)).status,404);
  const list=await call('/api/v1/sync/conflicts?status=open&entityType=project&entityId='+id+'&limit=1','GET',undefined,tAdmin);
  assert.equal((list.body.conflicts as unknown[]).length,1);
  for(const token of [tManager,tWorker]) assert.equal((await call('/api/v1/sync/conflicts/'+conflictId+'/resolve','POST',{type:'keep_server',expectedRevision:2},token)).status,403);
  const keep=await call('/api/v1/sync/conflicts/'+conflictId+'/resolve','POST',{type:'keep_server',expectedRevision:2},tAdmin);
  assert.equal(keep.status,200);assert.equal(keep.body.resultingRevision,null);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM projects WHERE id=$1',[id])).rows[0]?.revision,'2');
  assert.equal((await pool.query('SELECT 1 FROM sync_changes WHERE entity_id=$1',[id])).rowCount,2);
  assert.equal((await call('/api/v1/sync/conflicts/'+conflictId,'GET',undefined,tAdmin)).body.status,'resolved');
  assert.equal((await pool.query('SELECT 1 FROM audit_logs WHERE organization_id=$1 AND entity_id=$2 AND action=$3',[org,conflictId,'conflict.resolved'])).rowCount,1);
});

test('manual merge validates payload and apply client checks current revision',async()=>{
  const id=randomUUID();assert.equal((await push(op(id,'create',0,{name:'Start'}))).status,'applied');
  assert.equal((await push(op(id,'update',1,{name:'Server'}))).status,'applied');
  const conflict=await push(op(id,'update',1,{name:'Client'})),cid=String(conflict.conflictId);
  const endpoint='/api/v1/sync/conflicts/'+cid+'/resolve';
  const invalid=await call(endpoint,'POST',{type:'manual_merge',expectedRevision:2,payload:{name:'Merged',revision:99}},tAdmin);
  assert.equal(invalid.status,400);
  const merged=await call(endpoint,'POST',{type:'manual_merge',expectedRevision:2,payload:{name:'Merged'}},tAdmin);
  assert.equal(merged.status,200);assert.equal(merged.body.resultingRevision,3);
  assert.equal((await pool.query<{name:string;revision:string}>('SELECT name,revision FROM projects WHERE id=$1',[id])).rows[0]?.name,'Merged');
  assert.equal((await pool.query('SELECT 1 FROM sync_changes WHERE entity_id=$1 AND revision=3',[id])).rowCount,1);
  assert.equal((await call(endpoint,'POST',{type:'apply_client',expectedRevision:3},tAdmin)).body.code,'already_resolved');
  const next=await push(op(id,'update',1,{name:'Reapply'})),nextId=String(next.conflictId);
  const stale=await call('/api/v1/sync/conflicts/'+nextId+'/resolve','POST',{type:'apply_client',expectedRevision:2},tAdmin);
  assert.equal(stale.status,409);assert.equal(stale.body.code,'resolution_stale');
  const applied=await call('/api/v1/sync/conflicts/'+nextId+'/resolve','POST',{type:'apply_client',expectedRevision:3},tAdmin);
  assert.equal(applied.status,200);assert.equal(applied.body.resultingRevision,4);
  assert.equal((await pool.query<{name:string}>('SELECT name FROM projects WHERE id=$1',[id])).rows[0]?.name,'Reapply');
});

test('concurrent resolution yields exactly one business mutation',async()=>{
  const id=randomUUID();await push(op(id,'create',0,{name:'First'}));await push(op(id,'update',1,{name:'Server'}));
  const c=await push(op(id,'update',1,{name:'Client'})),url='/api/v1/sync/conflicts/'+String(c.conflictId)+'/resolve';
  const [a,b]=await Promise.all([
    call(url,'POST',{type:'apply_client',expectedRevision:2},tAdmin),
    call(url,'POST',{type:'manual_merge',expectedRevision:2,payload:{name:'Merged'}},tAdmin),
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal((await pool.query<{revision:string}>('SELECT revision FROM projects WHERE id=$1',[id])).rows[0]?.revision,'3');
  assert.equal((await pool.query('SELECT 1 FROM sync_changes WHERE entity_id=$1',[id])).rowCount,3);
});
