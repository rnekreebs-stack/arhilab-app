import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/database/pool.js';
test('login has its own IP rate limit without permanent account lock',async () => {
  const server=createApp().listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const addr=server.address(); if (!addr || typeof addr==='string') throw Error('Missing port');
  try {
    let status=0;
    for(let i=0;i<11;i++) {
      const res=await fetch(`http://127.0.0.1:${addr.port}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:randomUUID(),email:'unknown@example.com',password:'wrong',deviceId:randomUUID()})}); status=res.status;
    }
    assert.equal(status,429);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); await pool.end(); }
});
