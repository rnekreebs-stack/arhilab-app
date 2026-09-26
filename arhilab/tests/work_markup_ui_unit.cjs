const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const project={id:'f8eb4554-0b91-40da-9ccf-3c8664ff59fa',name:'Старый объект',address:'Москва',client:'Клиент',status:'Новый',
  lines:[{id:'line-1',name:'Работа',price:100000,qty:1,coef:1,autoMaterial:false}],
  materials:[{id:'mat-1',name:'Материал',price:50000,qty:1}],tasks:[],payments:[],photos:[],estimatePhotos:[],notes:[]};
const state=()=>({user:{id:'u',name:'Тест',role:'admin'},users:[],projects:[JSON.parse(JSON.stringify(project))]});
const elements=new Map();
const context={console,window:null,document:{getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',open:false,showModal(){},close(){}});return elements.get(id)}},
  Native:{call(action,raw){const a=JSON.parse(raw);if(action==='session')return JSON.stringify({ok:true,active:true,state:state()});
    if(action==='catalog')return JSON.stringify({ok:true,state:state(),catalog:{works:[],materials:[]}});
    if(action==='photoData')return JSON.stringify({ok:true,state:state(),photos:[],missingPhotos:0});
    if(action==='workMarkup')project.workMarkupPercent=a.percent;
    return JSON.stringify({ok:true,state:state()});}},
  scrollTo(){},alert(){throw Error('Unexpected UI error')},setTimeout(){}};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../assets/core.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(require.resolve('../assets/app.js'),'utf8'),context);
context.openProject(project.id);
let html=elements.get('detail').innerHTML;
assert.match(html,/Наценка на работы/);assert.match(html,/150\s*000/);
assert.match(html,/0%/);assert.match(html,/30%/);
assert.match(html,/Количество работы/);
context.lineForm();assert.match(elements.get('modal').innerHTML,/Ручная работа/);
context.action('workMarkup',{project:project.id,percent:'15'});
html=elements.get('detail').innerHTML;
assert.match(html,/15\s*000/);assert.match(html,/165\s*000/);
assert.equal(project.workMarkupPercent,'15');
console.log('PASS: embedded legacy estimate renders zero markup and updates total after local edit');
