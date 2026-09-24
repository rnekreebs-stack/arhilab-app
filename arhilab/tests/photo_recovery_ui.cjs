const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:412,height:915}});let errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.addInitScript(()=>{
   let user={id:'u',name:'Администратор',login:'admin',role:'admin'};
   let project={id:'p',name:'Объект',address:'Москва',status:'Новый',lines:[],materials:[],payments:[],tasks:[],notes:[],photos:[{id:'missing'}],estimatePhotos:[{id:'missing-estimate'}]};
   let state={user,users:[user],projects:[project]};window.printCalls=0;
   window.Native={call:(action)=>{
    if(action==='status')return JSON.stringify({ok:true,setup:false});
    if(action==='catalog')return JSON.stringify({ok:true,state,catalog:{works:[],materials:[]}});
    if(action==='photoData')return JSON.stringify({ok:true,state,photos:[],missingPhotos:1});
    if(action==='print')window.printCalls++;
    return JSON.stringify({ok:true,state});
   }};
  });
  await page.goto('file://'+path.resolve(__dirname,'../assets/index.html'));
  await page.fill('[name=login]','admin');await page.fill('[name=password]','test-password');await page.click('button[type=submit]');
  await page.getByText('Объект',{exact:true}).first().click();
  assert.match(await page.locator('#detail').innerText(),/Недоступно фото сметы: 1/);
  await page.locator('.tabs').getByText('Фото',{exact:true}).click();
  assert.match(await page.locator('#detail').innerText(),/Недоступно фото объекта: 1/);
  await page.locator('.tabs').getByText('Документы',{exact:true}).click();
  await page.getByText('Сохранить КП в PDF').click();
  assert.equal(await page.evaluate(()=>window.printCalls),0,'A document missing photos needs explicit confirmation');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: missing photos are disclosed and PDF requires confirmation; mocked native bridge.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
