const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});try{
 const p=await browser.newPage({viewport:{width:412,height:915}});let errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{let user=null,cloud={url:'',connected:false,revision:-1,dirty:false};window.calls=[];window.Native={call:(action,raw)=>{
  let data=JSON.parse(raw);window.calls.push({action,data});if(action==='status')return JSON.stringify({ok:true,setup:!user});
  if(action==='cloudLogin'){user={id:'u',name:'Администратор',login:'admin',role:'admin'};cloud={url:data.url,connected:true,revision:1,dirty:false};}
  if(action==='login')user={id:'u',name:'Администратор',login:'admin',role:'admin'};
  if(action==='cloudConnect')cloud.connected=true;
  if(action==='logout'){cloud.connected=false;return JSON.stringify({ok:true})}
  let state={user,users:user?[user]:[],projects:[],cloud};return JSON.stringify({ok:true,state,catalog:{works:[],materials:[]}});
 }};});
 await p.goto('file://'+path.resolve(__dirname,'../assets/index.html'));
 await p.getByText('Войти в общую базу с другого телефона').click();
 await p.fill('#modal [name=url]','https://sync.example.test');await p.fill('#modal [name=login]','admin');await p.fill('#modal [name=password]','long-admin-secret');await p.locator('#modal button[type=submit]').click();
 assert.equal((await p.evaluate(()=>window.calls)).find(x=>x.action==='cloudLogin').data.url,'https://sync.example.test');
 await p.getByText('Настройки',{exact:true}).click();assert.match(await p.locator('#app').innerText(),/Общий доступ/);
 await p.getByText('Отправить данные').click();assert((await p.evaluate(()=>window.calls)).some(x=>x.action==='cloudPush'));
 await p.getByText('Выйти из аккаунта',{exact:true}).click();await p.fill('[name=login]','admin');await p.fill('[name=password]','long-admin-secret');await p.click('button[type=submit]');
 assert((await p.evaluate(()=>window.calls)).some(x=>x.action==='login'),'local login remains available after cloud disconnect');
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: cloud login, sync UI and local login after disconnect; mocked native bridge.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
