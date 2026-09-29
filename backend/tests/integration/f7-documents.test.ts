import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {createApp} from '../../src/app.js';
import {pool} from '../../src/database/pool.js';
import {hashPassword} from '../../src/services/security.js';
const org=randomUUID(),foreignOrg=randomUUID(),admin=randomUUID(),worker=randomUUID(),foreignAdmin=randomUUID(),project=randomUUID(),estimate=randomUUID(),otherEstimate=randomUUID(),password=randomUUID()+randomUUID();
let server:Server,base:string,access:string,workerToken:string,foreignToken:string;
const settings={materials:'detailed',showMaterialPrices:true,showSections:true,paymentTerms:'Аванс',timeline:'',warranty:'',note:'<script>alert(1)</script>',companyDetails:''};
async function call(path:string,method='GET',body?:object,token=access){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json() as Record<string,unknown>};}
async function login(organizationId:string,userId:string){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId,email:userId+'@f7.example',password,deviceId:randomUUID()})});assert.equal(r.status,200);return String((await r.json() as {accessToken:string}).accessToken);}
before(async()=>{
 await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[org,'F7',foreignOrg,'Other']);
 const hash=await hashPassword(password);
 for(const [id,tenant,role] of [[admin,org,'admin'],[worker,org,'worker'],[foreignAdmin,foreignOrg,'admin']])await pool.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,tenant,id+'@f7.example',role,role,hash]);
 await pool.query('INSERT INTO projects(id,organization_id,name,address,client_name) VALUES($1,$2,$3,$4,$5)',[project,org,'Объект','Адрес','Клиент']);
 for(const id of [estimate,otherEstimate])await pool.query('INSERT INTO estimates(id,organization_id,project_id,name,work_markup_percent,delivery_amount,discount_amount) VALUES($1,$2,$3,$4,10,50,10)',[id,org,project,'Смета']);
 await pool.query(`INSERT INTO estimate_items(id,organization_id,estimate_id,title,quantity,unit,item_kind,unit_price,coefficient,auto_material,material_price,private_fields)
   VALUES($1,$2,$3,'Монтаж',2.5000,'м²','work',1234,1,true,100,'{"cost":"999.00"}'::jsonb)`,[randomUUID(),org,estimate]);
 server=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw Error('No address');base='http://127.0.0.1:'+address.port;
 access=await login(org,admin);workerToken=await login(org,worker);foreignToken=await login(foreignOrg,foreignAdmin);
});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool.end();});
test('F7 PostgreSQL snapshot, retries, isolation, immutable final, numbering and privacy',async()=>{
 const path='/api/v1/client-documents',requestId=randomUUID(),payload={projectId:project,estimateId:estimate,type:'COMMERCIAL_OFFER',requestId,settings};
 assert.equal((await call(path,'POST',payload,workerToken)).status,403);
 assert.equal((await call(path,'POST',payload,foreignToken)).status,404);
 assert.equal((await call(path,'POST',{...payload,estimateId:randomUUID()})).status,404);
 assert.equal((await call(path,'POST',{...payload,projectId:randomUUID()})).status,404);
 const first=await call(path,'POST',payload);assert.equal(first.status,201);
 const doc=first.data.document as {id:string;number:string;version:number;snapshot:{total:string;works:Array<{unitPrice:string}>};status:string};
 assert.equal(doc.snapshot.total,'3683.50');assert.equal(doc.snapshot.works[0]?.unitPrice,'1234.00');
 assert.ok(!/cost|profit|margin|expenses|procurement|password|999\.00/i.test(JSON.stringify(doc.snapshot)));
 assert.equal((await call(path,'POST',payload)).status,200);
 assert.equal((await call(path,'POST',{...payload,estimateId:otherEstimate})).status,409);
 assert.equal((await call(path+'?projectId='+project+'&estimateId='+otherEstimate)).data.documents instanceof Array,true);
 assert.equal(((await call(path+'?projectId='+project+'&estimateId='+otherEstimate)).data.documents as unknown[]).length,0);
 assert.equal((await call(path+'/'+doc.id,'GET',undefined,workerToken)).status,403);
 assert.equal((await call(path+'/'+doc.id,'GET',undefined,foreignToken)).status,404);
 const final=await call(path+'/'+doc.id+'/finalize','POST');assert.equal(final.status,200);
 assert.equal((await call(path+'/'+doc.id+'/finalize','POST')).data.duplicate,true);
 await pool.query('UPDATE estimate_items SET quantity=3.0000,unit_price=1500 WHERE estimate_id=$1',[estimate]);
 const again=await call(path+'/'+doc.id);assert.equal((again.data.document as {snapshot:{total:string}}).snapshot.total,'3683.50');
 const v2=await call(path,'POST',{...payload,requestId:randomUUID()});assert.equal(v2.status,201);
 const next=v2.data.document as {number:string;version:number;snapshot:{total:string}};assert.equal(next.version,2);assert.notEqual(next.snapshot.total,doc.snapshot.total);assert.notEqual(next.number,doc.number);
 const [a,b]=await Promise.all([call(path,'POST',{...payload,requestId:randomUUID()}),call(path,'POST',{...payload,requestId:randomUUID()})]);assert.equal(a.status,201);assert.equal(b.status,201);
 assert.notEqual((a.data.document as {number:string}).number,(b.data.document as {number:string}).number);
 assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM client_documents WHERE organization_id=$1 AND estimate_id=$2',[org,estimate])).rows[0]?.n,4);
});
