'use strict';
const assert=require('node:assert/strict');
const F5=require('../assets/f5-today.js');
global.F4Execution=require('../assets/f4-execution.js');
const when=new Date(2026,8,28,0,30),date='2026-09-28';
assert.equal(F5.localDate(when),date);
const project={id:'a',name:'Объект',tasks:[
 {id:'1',name:'Срочная',taskStatus:'open',priority:'urgent',planDate:'2026-09-27',assigneeId:'worker'},
 {id:'2',name:'Сегодня',taskStatus:'open',priority:'high',planDate:date,assigneeId:'worker'},
 {id:'3',name:'Без срока',taskStatus:'in_progress',priority:'normal',assigneeId:'worker'},
 {id:'4',name:'Далее',taskStatus:'open',planDate:'2026-10-05',assigneeId:'other'},
 {id:'5',name:'Поздно',taskStatus:'done',planDate:'2026-09-20',assigneeId:'worker'}],
 estimates:[{id:'estimate',lines:[{name:'План',syncId:'line',qty:'1'}],progressEntries:[{estimateItemId:'line',quantity:'2'}]}]};
const values=F5.collect([project],{now:when,userId:'worker',role:'admin'});
assert.deepEqual(Object.values(values).map(group=>group.length),[1,1,1,1,1]);
assert.equal(new Set(Object.values(values).flat().filter(x=>x.task).map(x=>x.task.id)).size,4);
assert.equal(F5.collect([project],{now:when,userId:'worker',role:'worker'}).attention.length,0);
assert.equal(F5.collect([project],{now:when,userId:'worker',role:'worker'}).upcoming.length,0);
assert.equal(F5.collect([project],{now:when,userId:'worker',mine:true,role:'admin'}).today.length,1);
assert.equal(F5.collect([project],{now:when,projectId:'other'}).overdue.length,0);
project.estimates[0].lines[0].qty='3';
assert.equal(F5.collect([project],{now:when}).attention.length,0);
process.env.TZ='Pacific/Honolulu';
assert.equal(F5.localDate(new Date(2026,8,28,23,59)),date);
console.log('F5 local calendar, grouping, priority, filters and F4 signal passed');
