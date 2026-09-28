'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const assets=path.join(__dirname,'../assets');
const elements=Object.fromEntries(['header','app','nav','detail','modal'].map(id=>[id,{innerHTML:'',showModal(){this.open=true},close(){this.open=false}}]));
const context={document:{getElementById:id=>elements[id]},window:{scrollTo(){}},
 Native:{call:()=>JSON.stringify({ok:true,active:false,setup:false})},
 Arhilab:{calc:()=>({total:0})},F4Execution:require('../assets/f4-execution.js'),
 F5Today:require('../assets/f5-today.js'),console};
vm.createContext(context);
for(const file of ['app.js','f5-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),context);
const project={id:'00000000-0000-4000-8000-000000000001',name:'Коттедж',status:'В работе',address:'',assigned:'worker',
 tasks:[{id:'00000000-0000-4000-8000-000000000002',name:'Проверка трапа',taskStatus:'open',priority:'urgent',planDate:'2026-09-28',assigneeId:'worker'}],
 estimates:[],payments:[]};
vm.runInContext('S='+JSON.stringify({user:{id:'admin',name:'Admin',role:'admin'},projects:[project],users:[],syncSummary:{state:'pending_changes',pendingOperations:1}})+';pid='+JSON.stringify(project.id),context);
vm.runInContext('render()',context);
assert.ok(elements.app.innerHTML.includes('Просрочено')&&elements.app.innerHTML.includes('Требует внимания'));
vm.runInContext("page='project';tab='tasks';tasks(S.projects[0])",context);
for(const label of ['Задачи объекта','Открытые','В работе','Завершённые','+ Задача','Проверка трапа'])
 assert.ok(elements.detail.innerHTML.includes(label),label);
vm.runInContext('f5TaskForm()',context);
assert.ok(elements.modal.innerHTML.includes('Приоритет')&&elements.modal.innerHTML.includes('Срок'));
vm.runInContext("S.user={id:'worker',name:'Worker',role:'worker'};page='home';render()",context);
assert.ok(elements.app.innerHTML.includes('Сегодня'));
assert.ok(!elements.app.innerHTML.includes('Портфель смет')&&!elements.app.innerHTML.includes('Прибыль'));
vm.runInContext("tasks(S.projects[0])",context);
assert.ok(!elements.detail.innerHTML.includes('+ Задача')&&!elements.detail.innerHTML.includes('Удалить'));
console.log('F5 production Today/task UI, status filters, form and worker privacy passed');
