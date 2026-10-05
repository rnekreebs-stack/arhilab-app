'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const assets=path.join(__dirname,'../assets');
const elements=Object.fromEntries(['header','app','nav','detail','modal'].map(id=>[id,{innerHTML:'',showModal(){},close(){},insertAdjacentHTML(_,html){this.innerHTML+=html}}]));
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
// The selected F4 work card uses identity links; other estimates and units stay separate.
const work={id:'line',syncId:'item',name:'Монтаж',unit:'м²',qty:'2',stageId:'stage'};
const estimate={id:'estimate',name:'Смета',legacy:false,lines:[work],executionStages:[],progressEntries:[]};
const material={id:'sku',name:'Кабель',unit:'м'};
context.Arhilab.procurement=()=>({rows:[{ref:'line:sku',sku:'sku',material,qty:'100'}]});
vm.runInContext('S.user={id:"admin",role:"admin"};S.projects[0].estimates='+JSON.stringify([estimate,{id:'other',lines:[]}])+';S.projects[0].procurementRequests='+JSON.stringify([
 {id:'linked',estimateId:'estimate',estimateItemId:'item',catalogSku:'sku',title:'Кабель',unit:'м',requestedQuantity:'100.0000',status:'ordered'},
 {id:'other',estimateId:'other',estimateItemId:'item',catalogSku:'sku',title:'Чужая смета',unit:'м',requestedQuantity:'90.0000',status:'ordered'},
 {id:'pieces',estimateId:'estimate',estimateItemId:'item',title:'Крепёж',unit:'шт',requestedQuantity:'5.0000',status:'requested'}])+';S.projects[0].procurementReceipts='+JSON.stringify([
 {id:'delivered',requestId:'linked',quantity:'40.0000'}, {id:'otherReceipt',requestId:'other',quantity:'90.0000'}])+';selectedEstimateId="estimate";C={materials:'+JSON.stringify([material])+'}',context);
vm.runInContext('f4WorkDetail("item")',context);
for(const text of ['Потребность: 100','Заявлено: 100','Получено: 40','Осталось: 60','Заявка linked','Крепёж','Создать заявку вручную'])
 assert.ok(elements.modal.innerHTML.includes(text),text);
assert.ok(!elements.modal.innerHTML.includes('Чужая смета'));
assert.ok(elements.modal.innerHTML.includes('Заявлено: 5')&&!elements.modal.innerHTML.includes('Заявлено: 105'));
context.Arhilab.procurement=()=>({rows:[]});vm.runInContext('f4WorkDetail("item")',context);
assert.ok(elements.modal.innerHTML.includes('Автоматический комплект материалов для этой работы не задан'));
console.log('F6 request and receipt UI renders exact quantities and hides admin actions from worker');
