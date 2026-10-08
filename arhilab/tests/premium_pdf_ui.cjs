const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH, args:['--no-sandbox']});
  try {
    const p = await browser.newPage({viewport:{width:412,height:915}});
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      const user = {id:'u',name:'Администратор',role:'admin'};
      const project = {id:'p',name:'Рекалеса',client:'Дмитрий',address:'Москва',status:'Новый',delivery:120000,discount:0,
        lines:[{id:'l',name:'Линолеум коммерческий',qty:90,unit:'м²',price:1300,coef:1,autoMaterial:false}],
        materials:[],payments:[],tasks:[],notes:[],photos:[],estimatePhotos:[],legacyEstimateId:'e',
        estimates:[{id:'e',name:'Исходная смета',legacy:true},{id:'e2',name:'Новая смета',legacy:false,lines:[],materials:[]}],
        clientDocuments:[{id:'old',estimateId:'e',type:'COMMERCIAL_OFFER',number:'OLD',version:1,status:'final',snapshot:{total:'117000'}}]};
      const state = {user,users:[user],projects:[project]};
      window.pdfCalls = [];
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      window.Native = {call:(name,raw) => {
        const a = JSON.parse(raw); window.pdfCalls.push({name,args:a});
        if (['print','f7Create','f7Finalize'].includes(name)) throw Error('Legacy creation route: '+name);
        const r = {ok:true,state};
        if(name==='session')r.active=true;
        if(name==='catalog')r.catalog={works:[],materials:[]};
        if(name==='photoData')r.photos=[];
        if(name==='f7List')r.documents=project.clientDocuments.filter(d=>d.estimateId===a.estimateId);
        if(name==='premiumPreview')r.preview={pageIndex:a.pageIndex,pageCount:3,data:image};
        if(name==='premiumCreate')r.document={id:'new',premium:true,fileName:'ARHILAB_КП_Рекалеса.pdf',fileSize:2000,number:'NEW',version:1,estimateId:'e',snapshot:{total:'237000'}};
        return JSON.stringify(r);
      }};
    });
    await p.goto('file://'+path.resolve(__dirname,'../assets/index.html'));
    await p.evaluate(()=>openProject('p'));
    for (const tab of ['estimate','documents']) {
      await p.evaluate(t=>{tab=t;projectPage()},tab);
      const cta=p.locator('#detail').getByRole('button',{name:'Создать PDF',exact:true});
      assert.equal(await cta.count(),1,'Exactly one obvious creation CTA');
      assert.equal(await cta.getAttribute('onclick'),'premiumPdfForm()');
      assert.equal(await p.locator('#detail [onclick*="printDoc(false)"],#detail [onclick*="f7CreateForm"]').count(),0);
      assert.doesNotMatch(await p.locator('#detail').innerText(),/Сохранить КП в PDF|Для прежнего одностраничного формата|\+ Клиентский документ/);
      await cta.click();
      assert.equal(await p.locator('#premiumForm [name=type]').inputValue(),'COMMERCIAL_OFFER');
      await p.locator('#premiumForm').getByRole('button',{name:'Предпросмотр',exact:true}).click();
      assert.equal(await p.locator('#modal h2').innerText(),'Предпросмотр PDF');
      assert.equal(await p.locator('#premiumPreviewImage').count(),1);
      await p.getByRole('button',{name:'Далее →',exact:true}).click();
      assert.match(await p.locator('#modal').innerText(),/Страница 2 из 3/);
      await p.getByRole('button',{name:'← Назад',exact:true}).click();
      assert.match(await p.locator('#modal').innerText(),/Страница 1 из 3/);
      await p.getByRole('button',{name:'Изменить настройки',exact:true}).click();
      await p.locator('#premiumForm').getByRole('button',{name:'Предпросмотр',exact:true}).click();
      assert.match(await p.locator('#modal').innerText(),/Страница 1 из 3/);
      await p.locator('#modal').getByRole('button',{name:'Создать PDF',exact:true}).click();
      assert.equal(await p.locator('#modal h2').innerText(),'PDF создан');
      await p.getByRole('button',{name:'Поделиться / Сохранить',exact:true}).click();
      assert.equal((await p.evaluate(()=>pdfCalls)).at(-1).name,'f7Pdf');
      await p.evaluate(()=>closeModal());
    }
    await p.evaluate(()=>{selectedEstimateId='e2';tab='estimate';projectPage()});
    await p.locator('#detail').getByRole('button',{name:'Создать PDF',exact:true}).click();
    assert.equal(await p.locator('#premiumForm').count(),1);
    await p.evaluate(()=>{closeModal();f7CreateForm()});
    assert.equal(await p.locator('#premiumForm').count(),1,'Old creation alias redirects to premium');
    await p.evaluate(()=>{closeModal();printDoc(false)});
    assert.equal(await p.locator('#premiumForm').count(),1,'Old print alias redirects to premium');
    await p.evaluate(()=>{closeModal();ui08QuickRun('document','p')});
    assert.equal(await p.locator('#premiumForm').count(),1,'Quick action uses premium');
    await p.evaluate(()=>{closeModal();tab='documents';selectedEstimateId='e';projectPage()});
    assert.match(await p.locator('#detail').innerText(),/Архивный формат/);
    await p.locator('[onclick="f7Pdf(\'old\',false)"]').click();
    const calls=await p.evaluate(()=>pdfCalls);
    assert.equal(calls.at(-1).name,'f7Pdf');
    assert.equal(calls.at(-1).args.id,'old','Existing legacy PDF still opens');
    assert(calls.some(x=>x.name==='premiumPreview'));
    assert(calls.some(x=>x.name==='premiumCreate'));
    assert(!calls.some(x=>['print','f7Create','f7Finalize'].includes(x.name)));
    assert.deepEqual(errors,[]);
    console.log('PASS: primary estimate/documents/quick CTAs use premium; preview/back/re-preview/create/share; legacy archive opens. Mocked bridge; native visuals covered by Android instrumentation.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
