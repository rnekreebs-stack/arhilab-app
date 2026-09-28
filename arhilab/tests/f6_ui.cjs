'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const assets=path.join(__dirname,'../assets');
const elements=Object.fromEntries(['header','app','nav','detail','modal'].map(id=>[id,{innerHTML:'',showModal(){},close(){}}]));
const context={document:{getElementById:id=>elements[id],querySelector:()=>null},window:{scrollTo(){}},
 Native:{call:()=>JSON.stringify({ok:true,active:false,setup:false})},
 Arhilab:{calc:()=>({total:0}),procurement:()=>({rows:[]})},F4Execution:require('../assets/f4-execution.js'),
 F5Today:require('../assets/f5-today.js'),F6Today:require('../assets/f6-today.js'),console};
vm.createContext(context);
for(const name of ['app.js','f5-ui.js','f6-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),context);
const p={id:'p',name:'Объект',procurementRequests:[{id:'req',title:'Кабель',unit:'м',status:'ordered',requestedQuantity:'3.0000',neededByDate:'2026-09-28'}],
 procurementReceipts:[{id:'rec',requestId:'req',quantity:'1.2500',businessDate:'2026-09-28'}]};
vm.runInContext('S='+JSON.stringify({user:{id:'admin',role:'admin'},projects:[p],users:[],syncSummary:{state:'pending_changes'}})+';pid="p";C={materials:[]}',context);
vm.runInContext('f6ProcurementPage(S.projects[0])',context);
for(const text of ['Снабжение','Кабель','1.25','Осталось: 1.75','Принять материал','Записать расход отдельно'])
 assert.ok(elements.detail.innerHTML.includes(text),text);
vm.runInContext("S.projects[0].expenses=[{id:'expense',procurementRequestId:'req',amount:'100.00',currency:'RUB'}];f6ProcurementPage(S.projects[0])",context);
assert.ok(elements.detail.innerHTML.includes('Расход уже записан'));
vm.runInContext('S.user={id:"worker",role:"worker"};f6ProcurementPage(S.projects[0])',context);
assert.ok(!elements.detail.innerHTML.includes('Записать расход'));
assert.ok(!elements.detail.innerHTML.includes('Удалить'));
console.log('F6 request and receipt UI renders exact quantities and hides admin actions from worker');
