'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const payments=require('../assets/f2-payments.js');
const source=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const start=source.indexOf('function f3Expenses(p){'),end=source.indexOf('function f3ExpenseForm(',start);
assert.ok(start>=0&&end>start,'F3 UI entry missing');
const detail={innerHTML:'',textContent:''};
const ctx={S:{user:{role:'admin'},syncSummary:{state:'idle'}},selectedEstimateId:'estimate-a',
 f3CategoryFilter:'',f3EstimateFilter:'',pid:'project-a',F2Payments:payments,F3Expenses:payments.F3Expenses,
 calc:()=>({total:1000000}),syncLabel:()=> 'Синхронизировано',
 esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
 select:(name,label,choices,selected)=>`<label>${label}</label><select name="${name}">${choices.map(([value,text])=>`<option value="${value}" ${selected===value?'selected':''}>${text}</option>`).join('')}</select>`,
 $:()=>detail};
vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
const project={legacyEstimateId:'estimate-a',estimates:[{id:'estimate-a',currency:'RUB',name:'Смета 1'}],
 payments:[{kind:'income',estimateId:'estimate-a',amount:'400000.00',currency:'RUB'}],
 expenses:[{id:'expense-a',estimateId:'estimate-a',category:'materials',amount:'210000.00',currency:'RUB',
   date:'2026-09-27',description:'Материалы',note:''},
 {id:'expense-b',category:'other',amount:'50000.00',currency:'RUB',date:'2026-09-26',description:'Для объекта',note:''},
 {id:'expense-c',category:'delivery',amount:'30.00',currency:'EUR',date:'2026-09-25',description:'Другая валюта',note:''}]};
ctx.f3Expenses(project);
for(const label of ['Стоимость выбранной сметы','Оплачено клиентом','Осталось получить',
 'Расходы выбранной сметы','Денежный результат','Текущая прогнозная маржа','Все расходы объекта'])
 assert.ok(detail.innerHTML.includes(label),label);
for(const value of ['1000000,00 RUB','400000,00 RUB','600000,00 RUB','210000,00 RUB',
 '190000,00 RUB','790000,00 RUB','79,00 %','260000,00 RUB','30,00 EUR'])
 assert.ok(detail.innerHTML.includes(value),value);
assert.ok(detail.innerHTML.includes('Все категории')&&detail.innerHTML.includes('Без сметы'));
ctx.f3EstimateFilter='unassigned';ctx.f3Expenses(project);
assert.ok(detail.innerHTML.includes('Для объекта')&&!detail.innerHTML.includes('<h3>Материалы</h3>'));
ctx.f3EstimateFilter='';ctx.f3CategoryFilter='materials';ctx.f3Expenses(project);
assert.ok(detail.innerHTML.includes('<h3>Материалы</h3>')&&!detail.innerHTML.includes('<h3>Для объекта</h3>'));
ctx.S.user.role='worker';detail.innerHTML='';ctx.f3Expenses(project);
assert.equal(detail.innerHTML,'');assert.equal(detail.textContent,'Недостаточно прав');
console.log('F3 user financial summary, currency split, filters and worker privacy passed');
