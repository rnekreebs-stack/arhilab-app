import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileSyncStore,SyncCoordinator,atomicVerifiedCache,type SyncTransport,type UploadJob } from '../../src/sync/client/local-first.js';
import { TransportFailure } from '../../src/sync/client/http-transport.js';

test('offline upload survives restart; lost finalize response retries without changing intent ID',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'arhilab-client-test-'));
  try {
    const bytes=Buffer.from([255,216,255,42]),path=join(dir,'local.jpg'),sha=createHash('sha256').update(bytes).digest('hex');
    await writeFile(path,bytes);let online=false,createCalls=0,uploadCalls=0,finalizeCalls=0,commits=0;
    const transport:SyncTransport={snapshot:async()=>({cursor:'0',entities:[]}),push:async()=>({results:[]}),
      pull:async cursor=>({changes:[],nextCursor:cursor,hasMore:false}),refresh:async()=>false,
      createIntent:async()=>{createCalls++;return {id:'server-file-id'};},upload:async()=>{uploadCalls++;},
      finalize:async()=>{finalizeCalls++;if(commits++===0)throw new TransportFailure(503);},
      download:async()=>bytes};
    const store=new JsonFileSyncStore(join(dir,'queue.json'));
    const job:Omit<UploadJob,'remoteId'|'state'|'attempts'|'nextAttemptAt'>={localId:randomUUID(),kind:'photos',projectId:randomUUID(),
      localPath:path,filename:'image.jpg',mimeType:'image/jpeg',byteSize:bytes.length,sha256:sha,idempotencyKey:randomUUID()};
    const offline=await SyncCoordinator.open(store,transport,()=>online,()=>1000,()=>0);
    await offline.enqueueFile(job);assert.equal((await offline.syncNow()).state,'offline');
    let restarted=await SyncCoordinator.open(store,transport,()=>online,()=>1000,()=>0);
    assert.equal(restarted.uploadJobs[0]?.idempotencyKey,job.idempotencyKey);
    online=true;assert.equal((await restarted.syncNow()).state,'retry_wait');
    assert.equal(restarted.uploadJobs[0]?.remoteId,'server-file-id');
    restarted=await SyncCoordinator.open(store,transport,()=>online,()=>2000,()=>0);
    assert.equal((await restarted.syncNow()).state,'idle');
    assert.equal(createCalls,1);assert.equal(uploadCalls,1);assert.equal(finalizeCalls,2);
    assert.equal(restarted.summary().pendingUploads,0);
    const cached=join(dir,'cached.jpg');
    await assert.rejects(atomicVerifiedCache(cached,Buffer.from('corrupt'),sha));
    await atomicVerifiedCache(cached,await transport.download('photos','server-file-id'),sha);
    assert.deepEqual(await readFile(cached),bytes);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('conflict is isolated from other operations and auth failure preserves pending queue',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'arhilab-client-test-'));
  try {
    const store=new JsonFileSyncStore(join(dir,'queue.json'));let authorized=false;
    const transport:SyncTransport={snapshot:async()=>({cursor:'0',entities:[]}),pull:async cursor=>({changes:[],nextCursor:cursor,hasMore:false}),
      push:async ops=>{if(!authorized)throw new TransportFailure(401);return {results:[{operationId:ops[0]!.operationId,
        status:ops[0]!.entityId==='conflict'?'duplicate':'applied',...(ops[0]!.entityId==='conflict'?{originalStatus:'conflict'}:{})}]};},
      refresh:async()=>false,createIntent:async()=>({id:'unused'}),upload:async()=>{},finalize:async()=>{},download:async()=>Buffer.alloc(0)};
    const client=await SyncCoordinator.open(store,transport,()=>true);
    for(const entityId of ['conflict','other']) await client.localWrite(entityId,{name:entityId},
      {operationId:randomUUID(),idempotencyKey:randomUUID(),entityType:'project',entityId,operationType:'update',baseRevision:1,payload:{name:entityId},occurredAt:new Date().toISOString()});
    assert.equal((await client.syncNow()).state,'auth_required');assert.equal(client.summary().pendingOperations,2);
    authorized=true;assert.equal((await client.syncNow()).state,'conflict');
    assert.equal(client.summary().pendingOperations,0);assert.equal(client.summary().conflicts,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});
