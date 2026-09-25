import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/database/pool.js';
import { config } from '../../src/config/env.js';
test('login has its own IP rate limit without permanent account lock',async () => {
  const server=createApp().listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const addr=server.address(); if (!addr || typeof addr==='string') throw Error('Missing port');
  try {
    let status=0,body:Record<string,unknown>={};
    for(let i=0;i<=config.LOGIN_RATE_LIMIT_MAX;i++) {
      const res=await fetch(`http://127.0.0.1:${addr.port}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:randomUUID(),email:'unknown@example.com',password:'wrong',deviceId:randomUUID()})}); status=res.status;body=await res.json() as Record<string,unknown>;
    }
    assert.equal(status,429);
    assert.equal(body.code,'rate_limited');assert.equal(body.errorClass,'retryable');assert.equal(typeof body.requestId,'string');
    let globalLimit:Record<string,unknown>|undefined;
    for(let i=0;i<=config.RATE_LIMIT_MAX;i++) {
      const response=await fetch(`http://127.0.0.1:${addr.port}/api/v1/health`);
      if(response.status===429) {globalLimit=await response.json() as Record<string,unknown>;break;}
    }
    assert.equal(globalLimit?.code,'rate_limited');
    assert.equal(globalLimit?.errorClass,'retryable');
    assert.equal(typeof globalLimit?.requestId,'string');
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); await pool.end(); }
});
