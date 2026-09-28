'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const start=script.indexOf('function f4Execution(p){'),end=script.indexOf('function f4Context()',start);
assert.ok(start>=0&&end>start,'F4 UI missing');
const detail={innerHTML:'',textContent:''},ctx={
 S:{user:{role:'admin'},syncSummary:{state:'pending_changes'}},selectedEstimateId:'estimate-a',
 F4Execution:require('../assets/f4-execution.js'),estimateChooser:()=>'',syncLabel:()=> 'Есть несинхронизированные изменения',
 esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
 $:()=>detail};
vm.createContext(ctx);vm.runInContext(script.slice(start,end),ctx);
const project={legacyEstimateId:'estimate-a',estimates:[{id:'estimate-a',name:'Основная',legacy:true,
 executionStages:[{id:'stage-a',name:'Черновые работы'}],
 progressEntries:[{id:'entry-a',estimateItemId:'work-a',quantity:'35.00',businessDate:'2026-09-28'},
  {id:'entry-b',estimateItemId:'work-a',quantity:'20.00',businessDate:'2026-09-29'}]}],
 lines:[{syncId:'work-a',stageId:'stage-a',name:'Штукатурка',qty:'120.00',unit:'м²'}]};
ctx.f4Execution(project);
for(const text of ['Выполнение','Черновые работы','Штукатурка','55.0000 / 120.0000','45.8%',
 'Журнал выполнения','Есть несинхронизированные изменения'])assert.ok(detail.innerHTML.includes(text),text);
for(const secret of ['unit_price','cost','Оплачено','Прибыль'])assert.ok(!detail.innerHTML.includes(secret),secret);
console.log('F4 selected-estimate operational UI and visible sync state passed');
