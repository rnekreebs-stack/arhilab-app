const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

(async()=>{
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try {
  const p=await b.newPage({viewport:{width:412,height:915}});
  let errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{
   const user={id:'u',name:'Администратор',login:'admin',role:'admin'};
   const project={id:'p',name:'Объект',address:'Москва',status:'Новый',materialMarkup:8,lines:[{id:'l',name:'Работа с комплектом',price:500,cost:250,qty:2,coef:1,autoMaterial:true,materials:['Комплект'],materialPrice:108,materialCost:100}],materials:[{id:'m',name:'Материал',store:'Магазин',unit:'шт',price:216,cost:200,qty:3}],tasks:[],payments:[],notes:[],photos:[]};
   const state=()=>({user,users:[user],projects:[project]});
   const price=(cost,n)=>Math.round(cost*(100+n))/100;
   window.Native={call:(action,raw)=>{let a=JSON.parse(raw),r={ok:true};
    if(action==='status')r.setup=false;
    if(action==='catalog')r.catalog={works:[],materials:[{id:'cat',name:'Новый материал',store:'Магазин',unit:'шт',cost:100,price:price(100,project.materialMarkup)}]};
    if(action==='photoData')r.photos=[];
    if(action==='materialMarkup'){
     if(![8,10,12].includes(a.percent))return JSON.stringify({ok:false,error:'Неверная ставка'});
     project.materialMarkup=a.percent;
     project.materials.forEach(m=>m.price=price(m.cost,a.percent));
     project.lines.forEach(l=>l.materialPrice=price(l.materialCost,a.percent));
    }
    if(action==='material')project.materials.push({id:'added',name:'Новый материал',store:'Магазин',unit:'шт',cost:a.cost,price:price(a.cost,project.materialMarkup),qty:a.qty});
    if(action==='print')window.lastPrint=a.html;
    r.state=state();return JSON.stringify(r);
   }};
  });
  await p.goto('file://'+path.resolve(__dirname,'../assets/index.html'));
  await p.fill('[name=login]','admin');await p.fill('[name=password]','test-password');await p.click('button[type=submit]');
  await p.getByText('Объект',{exact:true}).first().click();
  await p.locator('.tabs').getByText('Материалы').click();
  assert.equal(await p.locator('#materialMarkup').inputValue(),'8');
  assert.match(await p.locator('#detail').innerText(),/864,00/);
  await p.selectOption('#materialMarkup','10');
  assert.match(await p.locator('#detail').innerText(),/880,00/);
  await p.getByText('+ Материал из базы').click();await p.getByText('Новый материал').click();
  assert.match(await p.locator('#materialPreview').innerText(),/110,00/);
  await p.fill('[name=cost]','150');assert.match(await p.locator('#materialPreview').innerText(),/165,00/);
  await p.locator('#modal button[type=submit]').click();
  await p.selectOption('#materialMarkup','12');
  const values=await p.evaluate(()=>{let x=S.projects[0];return {rate:x.materialMarkup,material:x.materials[0].price,kit:x.lines[0].materialPrice,added:x.materials[1].price,total:calc(x).total}});
  assert.deepEqual(values,{rate:12,material:224,kit:112,added:168,total:2064});
  await p.locator('.tabs').getByText('Документы').click();await p.getByText('Сохранить КП в PDF').click();
  let html=await p.evaluate(()=>window.lastPrint);assert.match(html,/2\s064,00/);assert.match(html,/224,00/);assert.match(html,/112,00/);
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS: 8% to 10% to 12%, existing items and new cost, totals and PDF update. Mocked native bridge.');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exit(1)});
