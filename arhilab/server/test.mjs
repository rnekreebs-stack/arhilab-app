import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const data=mkdtempSync(join(tmpdir(),'arhilab-sync-test-'));
const port=30000+Math.floor(Math.random()*20000);
const password='server-test-password-12345';
const processServer=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ARHILAB_DATA_DIR:data,ARHILAB_ADMIN_LOGIN:'admin',ARHILAB_ADMIN_PASSWORD:password},stdio:'ignore'});
async function request(route,method='GET',payload,token){let response=await fetch('http://127.0.0.1:'+port+route,{method,headers:{...(payload?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:payload?JSON.stringify(payload):undefined});return {status:response.status,body:await response.json()};}
try{
 let ready=false;for(let i=0;i<50;i++){try{let r=await request('/health');if(r.status===200){ready=true;break}}catch{}await delay(100)}assert(ready,'server starts');
 assert.equal((await request('/v1/vault')).status,401);
 assert.equal((await request('/v1/login','POST',{login:'admin',password:'wrong'})).status,401);
 let login=await request('/v1/login','POST',{login:'admin',password});assert.equal(login.status,200);const token=login.body.token;
 let initial=await request('/v1/vault','GET',null,token);assert.deepEqual(initial.body,{revision:0,ciphertext:null});
 let encrypted=Buffer.concat([Buffer.from('ARHILAB3'),Buffer.alloc(60)]).toString('base64');
 let pushed=await request('/v1/vault','PUT',{expectedRevision:0,ciphertext:encrypted},token);assert.equal(pushed.body.revision,1);
 assert.equal((await request('/v1/vault','PUT',{expectedRevision:0,ciphertext:encrypted},token)).status,409);
 assert.equal((await request('/v1/vault','PUT',{expectedRevision:1,ciphertext:'plain'},token)).status,400);
 assert.equal((await request('/v1/vault','GET',null,token)).body.ciphertext,encrypted);
 console.log('PASS: login, authentication, encrypted vault, conflict rejection, malformed upload rejection.');
}finally{processServer.kill();rmSync(data,{recursive:true,force:true})}
