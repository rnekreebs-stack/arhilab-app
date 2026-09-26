import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/database/pool.js';
import { hashPassword } from '../../src/services/security.js';
import { packageHash,packageSchema } from '../../src/migration/package.js';

const org=randomUUID(),foreignOrg=randomUUID(),admin=randomUUID(),manager=randomUUID(),foreignAdmin=randomUUID();
const deviceA=randomUUID(),deviceB=randomUUID(),foreignDevice=randomUUID(),password='local-stage-five-test-password-123';
let server:Server,base:string,access:string,reader:string,foreign:string;
const jpeg=Buffer.from([255,216,255,0,1,2,255,217]);
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function call(path:string,method='GET',body?:object|Buffer,token?:string) {
  const response=await fetch(base+path,{method,headers:{...(body?{'content-type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}:{}),
    ...(token?{authorization:'Bearer '+token}:{})},...(body?{body:Buffer.isBuffer(body)?new Uint8Array(body):JSON.stringify(body)}:{})});
  const raw=await response.arrayBuffer();
  return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?JSON.parse(Buffer.from(raw).toString()) as Record<string,unknown>:Buffer.from(raw),
    headers:response.headers};
}
async function login(organizationId:string,userId:string,deviceId:string) {
  const r=await call('/api/v1/auth/login','POST',{organizationId,email:userId+'@test.example',password,deviceId});
  assert.equal(r.status,200);return String((r.body as Record<string,unknown>).accessToken);
}
async function push(projectId:string,token:string) {
  return call('/api/v1/sync/push','POST',{operations:[{operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'project',entityId:projectId,
    operationType:'create',baseRevision:0,payload:{name:'File fixture'},occurredAt:new Date().toISOString()}]},token);
}
before(async()=>{
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[org,'Files '+org,foreignOrg,'Files '+foreignOrg]);
  const pwd=await hashPassword(password);
  for(const [id,organization,role] of [[admin,org,'admin'],[manager,org,'manager'],[foreignAdmin,foreignOrg,'admin']])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,organization,id+'@test.example',role,role,pwd]);
  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const addr=server.address();if(!addr||typeof addr==='string')throw Error('Missing port');base=`http://127.0.0.1:${addr.port}`;
  access=await login(org,admin,deviceA);reader=await login(org,manager,deviceB);foreign=await login(foreignOrg,foreignAdmin,foreignDevice);
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

test('photo E2E: intent, lossless retry, concurrent finalize, metadata pull, download and tombstone',async()=>{
  const project=randomUUID();assert.equal((await push(project,access)).status,200);
  const intent={projectId:project,filename:'../photo\r\nname.jpg',mimeType:'image/jpeg',byteSize:jpeg.length,sha256:hash(jpeg),idempotencyKey:randomUUID()};
  const first=await call('/api/v1/files/photos/intents','POST',intent,access);
  assert.equal(first.status,201);const file=(first.body as {file:{id:string;status:string}}).file;
  assert.equal(file.status,'pending');const path='/api/v1/files/photos/'+file.id;
  assert.equal((await call('/api/v1/files/photos/intents','POST',intent,access)).status,200);
  assert.equal((await call('/api/v1/files/photos/intents','POST',{...intent,byteSize:jpeg.length+1},access)).status,409);
  assert.equal((await call(path+'/finalize','POST',undefined,access)).status,409);
  assert.equal((await call(path+'/content','PUT',Buffer.from([0,0,0,0,0,0,0,0]),access)).status,409);
  assert.equal((await call(path+'/content','PUT',jpeg,access)).status,200);
  assert.equal((await call(path+'/content','PUT',jpeg,access)).status,200);
  const [a,b]=await Promise.all([call(path+'/finalize','POST',undefined,access),call(path+'/finalize','POST',undefined,access)]);
  assert.deepEqual([a.status,b.status],[200,200]);
  assert.deepEqual([(a.body as {duplicate:boolean}).duplicate,(b.body as {duplicate:boolean}).duplicate].sort(),[false,true]);
  assert.equal((await pool.query('SELECT 1 FROM photos WHERE id=$1',[file.id])).rowCount,1);
  assert.equal((await pool.query("SELECT 1 FROM sync_changes WHERE entity_type='photo' AND entity_id=$1",[file.id])).rowCount,1);
  const pulled=await call('/api/v1/sync/pull?cursor=0','GET',undefined,reader);
  assert.equal(pulled.status,200);
  const changes=(pulled.body as {changes:Array<{entityType:string;entityId:string;snapshot:Record<string,unknown>}>}).changes;
  assert.ok(changes.some(x=>x.entityType==='photo'&&x.entityId===file.id&&x.snapshot.sha256===hash(jpeg)));
  assert.equal(JSON.stringify(changes).includes(jpeg.toString('base64')),false);
  const downloaded=await call(path+'/content','GET',undefined,reader);
  assert.equal(downloaded.status,200);assert.deepEqual(downloaded.body,jpeg);
  assert.equal(downloaded.headers.get('content-disposition')?.includes('%0D'),false);
  assert.equal((await call('/api/v1/files/quota','GET',undefined,reader)).status,200);
  const removed=await call(path,'DELETE',undefined,access);assert.equal(removed.status,200);
  assert.equal((await call(path,'DELETE',undefined,access)).status,200);
  assert.equal((await call(path+'/content','GET',undefined,reader)).status,404);
  assert.equal((await pool.query("SELECT 1 FROM sync_changes WHERE entity_type='photo' AND entity_id=$1",[file.id])).rowCount,2);
  const snapshot=await call('/api/v1/sync/snapshot','GET',undefined,reader);
  assert.ok((snapshot.body as {entities:Array<{entityId:string;snapshot:{status:string}}>}).entities.some(x=>x.entityId===file.id&&x.snapshot.status==='deleted'));
});

test('cross-tenant/project and RBAC are closed; incomplete and spoofed objects stay unavailable',async()=>{
  const project=randomUUID(),foreignProject=randomUUID();await push(project,access);await push(foreignProject,foreign);
  const intent={projectId:project,filename:'file.pdf',mimeType:'application/pdf',byteSize:8,sha256:hash(Buffer.from('%PDF-1.7')),idempotencyKey:randomUUID()};
  assert.equal((await call('/api/v1/files/documents/intents','POST',{...intent,projectId:foreignProject},access)).status,404);
  assert.equal((await call('/api/v1/files/documents/intents','POST',intent,reader)).status,403);
  const created=await call('/api/v1/files/documents/intents','POST',intent,access);
  assert.equal(created.status,201);const id=(created.body as {file:{id:string}}).file.id,path='/api/v1/files/documents/'+id;
  for(const [token,method,suffix] of [[foreign,'GET',''],[foreign,'GET','/content'],[foreign,'POST','/finalize'],[foreign,'DELETE',''],[reader,'POST','/finalize']] as const)
    assert.equal((await call(path+suffix,method,undefined,token)).status,token===reader?403:404);
  assert.equal((await call(path,'GET',undefined,reader)).status,404);
  assert.equal((await call(path+'/content','GET',undefined,reader)).status,404);
  assert.equal((await call(path+'/content','PUT',Buffer.from('MZabcdef'),access)).status,409);
  const invalid={...intent,sha256:hash(Buffer.from('MZabcdef')),idempotencyKey:randomUUID()};
  const spoof=await call('/api/v1/files/documents/intents','POST',invalid,access);
  const spoofId=(spoof.body as {file:{id:string}}).file.id;
  assert.equal((await call('/api/v1/files/documents/'+spoofId+'/content','PUT',Buffer.from('MZabcdef'),access)).status,415);
  assert.equal((await pool.query<{status:string}>('SELECT status FROM documents WHERE id=$1',[spoofId])).rows[0]?.status,'pending');
  assert.equal((await call('/api/v1/files/documents/'+spoofId+'/finalize','POST',undefined,access)).status,409);
  const compromised=await login(org,admin,randomUUID());
  await pool.query('UPDATE users SET active=false WHERE id=$1',[admin]);
  assert.equal((await call(path,'GET',undefined,compromised)).status,401);
  await pool.query('UPDATE users SET active=true WHERE id=$1',[admin]);
});

test('completed legacy snapshot migrates one JPEG idempotently without exposing archive bytes in sync',async()=>{
  const project=randomUUID(),photo=randomUUID(),session=randomUUID();await push(project,access);
  const pkg=packageSchema.parse({format:'ArhilabMigration-1',sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,
    exportedAt:'2026-01-01T00:00:00.000Z',projects:[{id:project,name:'Legacy',lines:[],materials:[],tasks:[],payments:[],notes:[],
      photos:[{id:photo,name:'legacy.jpg',data:'data:image/jpeg;base64,'+jpeg.toString('base64')}]}]});
  await pool.query(`INSERT INTO migration_sessions(id,organization_id,initiated_by_user_id,source_device_id,source_format,source_app_version,source_schema_version,package_hash,expected_chunks,status)
    VALUES($1,$2,$3,$4,'Arhilab-2','0.6.2',2,$5,1,'completed')`,[session,org,admin,deviceA,packageHash(pkg)]);
  await pool.query(`INSERT INTO migration_legacy_snapshots(session_id,organization_id,source_format,source_app_version,source_schema_version,package_hash,business_snapshot)
    VALUES($1,$2,'Arhilab-2','0.6.2',2,$3,$4)`,[session,org,packageHash(pkg),JSON.stringify(pkg)]);
  const path='/api/v1/files/legacy/'+session+'/'+photo;
  assert.equal((await call(path,'POST',undefined,foreign)).status,404);
  assert.equal((await call(path,'POST',undefined,reader)).status,403);
  const first=await call(path,'POST',undefined,access);assert.equal(first.status,200);
  assert.equal((await call(path,'POST',undefined,access)).status,200);
  assert.equal((await pool.query('SELECT 1 FROM photos WHERE id=$1',[photo])).rowCount,1);
  assert.equal((await pool.query("SELECT 1 FROM sync_changes WHERE entity_type='photo' AND entity_id=$1",[photo])).rowCount,1);
  assert.deepEqual((await call('/api/v1/files/photos/'+photo+'/content','GET',undefined,reader)).body,jpeg);
  const pulled=await call('/api/v1/sync/pull?cursor=0','GET',undefined,reader);
  assert.equal(JSON.stringify(pulled.body).includes(jpeg.toString('base64')),false);
});
