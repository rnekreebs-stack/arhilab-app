import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { CreateBucketCommand,DeleteBucketCommand,S3Client } from '@aws-sdk/client-s3';
import { S3ObjectStorage,fileKey } from '../../src/files/storage.js';

test('real S3-compatible adapter creates, reads, verifies and deletes an isolated object',
  {skip:!process.env.STORAGE_TEST_S3_ENDPOINT},async()=>{
    const endpoint=process.env.STORAGE_TEST_S3_ENDPOINT!,bucket='arhilab-ci-'+randomUUID(),accessKeyId='local-ci-only',secretAccessKey='local-ci-only-password';
    const credentials={accessKeyId,secretAccessKey},client=new S3Client({region:'us-east-1',endpoint,forcePathStyle:true,credentials});
    await client.send(new CreateBucketCommand({Bucket:bucket}));
    try {
      const storage=new S3ObjectStorage(bucket,'us-east-1',endpoint,accessKeyId,secretAccessKey);
      assert.equal(await storage.ready(),true);
      const bytes=Buffer.from([255,216,255,0,8]),key=fileKey(randomUUID(),randomUUID(),'photos',randomUUID());
      const meta={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:'image/jpeg'};
      assert.equal(await storage.head(key),null);
      await storage.put(key,bytes,meta);assert.deepEqual(await storage.head(key),meta);
      assert.deepEqual(await storage.get(key),bytes);await storage.delete(key);assert.equal(await storage.head(key),null);
    } finally {await client.send(new DeleteBucketCommand({Bucket:bucket}));client.destroy();}
  });
