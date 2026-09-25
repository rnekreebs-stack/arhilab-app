import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const organizationId=process.env.COMPOSE_SMOKE_ORG;
const password=process.env.COMPOSE_SMOKE_PASSWORD;
if (!organizationId || !password) throw Error('CI smoke credentials missing');
const base='http://localhost:3000/api/v1';
async function request(path:string,method:string,body?:object,access?:string) {
  const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(access?{authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json() as Record<string,unknown>};
}
const deviceId=randomUUID(),entityId=randomUUID();
const login=await request('/auth/login','POST',{organizationId,email:'ci-smoke@test.example',password,deviceId});
assert.equal(login.status,200);
const access=String(login.body.accessToken);
const operationId=randomUUID();
const pushed=await request('/sync/push','POST',{operations:[{operationId,idempotencyKey:randomUUID(),entityType:'project',entityId,operationType:'create',baseRevision:0,payload:{name:'CI smoke project'},occurredAt:new Date().toISOString()}]},access);
assert.equal(pushed.status,200);
assert.equal((pushed.body.results as Array<{status:string}>)[0]?.status,'applied');
const pulled=await request('/sync/pull?cursor=0','GET',undefined,access);
assert.equal(pulled.status,200);
assert.equal((pulled.body.changes as Array<{entityId:string}>)[0]?.entityId,entityId);
console.log('Compose bootstrap, authentication, sync push and pull verified');
