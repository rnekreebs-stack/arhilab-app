import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const directory=path.resolve(process.env.ARHILAB_DATA_DIR||'./data');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const accountFile=path.join(directory,'account.json'),vaultFile=path.join(directory,'vault.json');
const maxBody=128*1024*1024;
const tokens=new Map(),failures=new Map();
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
function writeAtomic(file,value){const tmp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function read(file){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
let account=read(accountFile);
if(!account){let login=process.env.ARHILAB_ADMIN_LOGIN||'admin',password=process.env.ARHILAB_ADMIN_PASSWORD;if(!password||password.length<12)throw Error('First run requires ARHILAB_ADMIN_PASSWORD of at least 12 characters');let salt=crypto.randomBytes(16);account={login,salt:salt.toString('base64'),hash:crypto.scryptSync(password,salt,64).toString('base64')};writeAtomic(accountFile,account);}
const unauthorized=res=>json(res,401,{error:'Требуется вход администратора'});
async function body(req,limit=maxBody){let chunks=[],size=0;for await(const part of req){size+=part.length;if(size>limit){const e=Error('Файл слишком большой');e.status=413;throw e;}chunks.push(part);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function authorized(req){const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return false;let until=tokens.get(token);if(!until||until<Date.now()){tokens.delete(token);return false;}return true;}
let vault=read(vaultFile)||{revision:0,ciphertext:null};
const server=http.createServer(async(req,res)=>{try{
 const route=new URL(req.url,'http://localhost').pathname;
 if(req.method==='GET'&&route==='/health')return json(res,200,{ok:true});
 if(req.method==='POST'&&route==='/v1/login'){
  let ip=req.socket.remoteAddress||'unknown',slot=failures.get(ip)||{count:0,until:0};if(slot.until<Date.now())slot={count:0,until:Date.now()+15*60_000};if(slot.count>=5)return json(res,429,{error:'Слишком много попыток. Повторите позже.'});
  let input=await body(req,4096),provided=crypto.scryptSync(String(input.password||''),Buffer.from(account.salt,'base64'),64);let valid=String(input.login||'')===account.login&&crypto.timingSafeEqual(provided,Buffer.from(account.hash,'base64'));
  if(!valid){slot.count++;failures.set(ip,slot);return unauthorized(res);}failures.delete(ip);
  const token=crypto.randomBytes(32).toString('hex');tokens.set(token,Date.now()+12*60*60_000);return json(res,200,{token});
 }
 if(!authorized(req))return unauthorized(res);
 if(req.method==='GET'&&route==='/v1/vault')return json(res,200,vault);
 if(req.method==='PUT'&&route==='/v1/vault'){
  let input=await body(req);if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==vault.revision)return json(res,409,{error:'На сервере есть более новая версия. Сначала получите её.',revision:vault.revision});
  if(typeof input.ciphertext!=='string'||input.ciphertext.length>maxBody||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.ciphertext))return json(res,400,{error:'Некорректная копия'});
  let bytes=Buffer.from(input.ciphertext,'base64');if(bytes.length<52||bytes.subarray(0,8).toString('ascii')!=='ARHILAB3')return json(res,400,{error:'Ожидается зашифрованная копия Arhilab'});
  let updated={revision:vault.revision+1,ciphertext:input.ciphertext};writeAtomic(vaultFile,updated);vault=updated;return json(res,200,{revision:vault.revision});
 }
 return json(res,404,{error:'Не найдено'});
 }catch(e){if(e instanceof SyntaxError)return json(res,400,{error:'Некорректный JSON'});return json(res,e.status||500,{error:e.status?e.message:'Ошибка сервера'});}});
const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>process.stdout.write(`Arhilab sync listening on ${host}:${port}\n`));
