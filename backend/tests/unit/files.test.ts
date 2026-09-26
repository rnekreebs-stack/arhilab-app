import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStorage,fileKey } from '../../src/files/storage.js';
import { displayFilename,digest,validSize,validType } from '../../src/files/validation.js';
import { transition } from '../../src/files/state.js';

test('server-only storage keys reject arbitrary paths and file storage preserves metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'arhilab-file-test-'));
  try {
    const store=new FilesystemStorage(root),key=fileKey(randomUUID(),randomUUID(),'photos',randomUUID());
    assert.throws(()=>fileKey('../etc',randomUUID(),'photos',randomUUID()));
    await assert.rejects(store.put('../outside',Buffer.from('x'),{size:1,sha256:'x',mime:'image/jpeg'}));
    const bytes=Buffer.from([255,216,255,0]);const metadata={size:bytes.length,sha256:digest(bytes),mime:'image/jpeg'};
    assert.equal(await store.head(key),null);await store.put(key,bytes,metadata);
    assert.deepEqual(await store.head(key),metadata);assert.deepEqual(await store.get(key),bytes);
    await store.delete(key);assert.equal(await store.head(key),null);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('filename, MIME signature, size and hash validation',()=>{
  assert.equal(displayFilename('../evil\r\nname.pdf'),'__evil__name.pdf');
  assert.equal(validType('photos','image/jpeg',Buffer.from([255,216,255])),true);
  assert.equal(validType('photos','image/jpeg',Buffer.from('%PDF-')),false);
  assert.equal(validType('documents','application/pdf',Buffer.from('%PDF-1.7')),true);
  assert.equal(validType('documents','application/pdf',Buffer.from('MZ executable')),false);
  assert.equal(validSize('photos',0),false);assert.equal(validSize('photos',50000000),false);
  assert.equal(digest(Buffer.from('a')),'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});
test('file state machine has no unsafe reverse transition',()=>{
  assert.equal(transition('pending','uploaded'),'uploaded');
  assert.equal(transition('uploaded','available'),'available');
  assert.equal(transition('available','deleted'),'deleted');
  assert.throws(()=>transition('available','uploaded'));
  assert.throws(()=>transition('deleted','available'));
});
