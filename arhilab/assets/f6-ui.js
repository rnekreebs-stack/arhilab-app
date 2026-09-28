'use strict';
const f6PreviousProjectPage=projectPage;
projectPage=function(){
 f6PreviousProjectPage();
 const tabs=document.querySelector('#app .tabs');
 if(tabs)tabs.insertAdjacentHTML('beforeend',`<button class="${tab==='f6Procurement'?'active':''}" onclick="tab='f6Procurement';projectPage()">Снабжение</button>`);
 if(tab==='f6Procurement')f6ProcurementPage(current());
};
function f6Units(value){let [whole,fraction='']=String(value).split('.');return BigInt(whole)*10000n+BigInt((fraction+'0000').slice(0,4));}
function f6Format(units){let sign=units<0n?'-':'';let n=units<0n?-units:units;return sign+String(n/10000n)+(n%10000n?'.'+String(n%10000n).padStart(4,'0').replace(/0+$/,''):'')}
function f6ProcurementPage(p){
 const requests=p.procurementRequests||[],receipts=p.procurementReceipts||[];
 const labels={requested:'Запрошено',ordered:'Заказано',partially_received:'Частично получено',received:'Получено',cancelled:'Отменено'};
 $('detail').innerHTML=`<div class="card"><h2>Снабжение</h2><p class="small">Заявки создаются только после подтверждения количества. Статус и фактическое получение учитываются отдельно. Расход записывается в разделе «Расходы» отдельным действием.</p>
 ${S.user.role==='admin'?'<button class="gold" onclick="f6RequestForm()">+ Заявка</button>':''}</div>
 ${requests.map(r=>{let delivered=receipts.filter(x=>x.requestId===r.id).reduce((sum,x)=>sum+f6Units(x.quantity),0n),remaining=f6Units(r.requestedQuantity)-delivered;
 return `<div class="card"><div class="row"><h3>${esc(r.title)}</h3><span class="tag">${esc(labels[r.status]||r.status)}</span></div>
 <p>Запрошено: ${esc(r.requestedQuantity)} ${esc(r.unit)} · Получено: ${f6Format(delivered)} · ${remaining<0n?'Превышение: '+f6Format(-remaining):'Осталось: '+f6Format(remaining)}</p>
 <p class="small">${esc(r.neededByDate||'Без срока')} · ${esc(r.note||'')}${r.catalogSku?' · SKU '+esc(r.catalogSku):''}</p>
 ${receipts.filter(x=>x.requestId===r.id).map(x=>`<div class="line">${esc(x.businessDate)} · ${esc(x.quantity)} ${esc(r.unit)} · ${esc(x.note||'')}
 ${S.user.role==='admin'?`<button class="secondary" onclick="f6ReceiptForm('${esc(r.id)}','${esc(x.id)}')">Изменить</button><button class="danger" onclick="f6Delete('receipt','${esc(x.id)}')">Удалить</button>`:''}</div>`).join('')}
 ${S.user.role==='admin'?`<div class="stack"><button class="secondary" onclick="f6ReceiptForm('${esc(r.id)}')">+ Получение</button><button class="secondary" onclick="f6RequestForm('${esc(r.id)}')">Изменить</button><button class="secondary" onclick="f3ExpenseForm()">Записать расход отдельно</button><button class="danger" onclick="f6Delete('request','${esc(r.id)}')">Удалить</button></div>`:''}</div>`}).join('')||'<p class="empty">Заявок пока нет.</p>'}
 ${S.user.role==='admin'?`<div class="card"><h3>Подсказка из сметы</h3><p class="small">Расход SKU в старом каталоге может отсутствовать. Проверьте количество перед созданием заявки.</p>
 ${Arhilab.procurement(p,C).rows.slice(0,100).map(x=>`<div class="line">${esc(x.material.name)} · ${esc(x.work)} · ${x.qty??'количество не задано'} ${esc(x.material.unit||'')}
 <button class="secondary" onclick="f6RequestForm('', '${esc(x.sku)}')">Подтвердить заявку</button></div>`).join('')}</div>`:''}`;
}
function f6RequestForm(id='',sku=''){
 const p=current(),r=(p.procurementRequests||[]).find(x=>x.id===id)||{},material=C.materials.find(x=>x.id===(sku||r.catalogSku));
 openModal(id?'Изменить заявку':'Новая заявка',`<form onsubmit="return submitForm(this,'f6RequestSave')"><input type="hidden" name="project" value="${esc(pid)}"><input type="hidden" name="id" value="${esc(id)}">
 ${select('catalogSku','Материал каталога',[['','Ручной материал'],...C.materials.map(x=>[x.id,x.name+' · '+x.id])],r.catalogSku||sku)}
 ${field('title','Материал',r.title||material?.name||'','text','required maxlength="250"')}
 ${field('unit','Единица',r.unit||material?.unit||'шт','text','required maxlength="50"')}
 ${field('requestedQuantity','Количество',r.requestedQuantity||'1','number','required min="0.0001" step="0.0001"')}
 ${select('status','Статус',[['requested','Запрошено'],['ordered','Заказано'],['partially_received','Частично получено'],['received','Получено'],['cancelled','Отменено']],r.status||'requested')}
 ${field('neededByDate','Нужно к дате',r.neededByDate||'','date')}${field('note','Примечание',r.note||'','text','maxlength="1000"')}
 ${select('estimateId','Смета',[['','Без сметы'],...(p.estimates||[]).map(e=>[e.id,e.name])],r.estimateId||'')}
 ${select('assigneeId','Ответственный',[['','Не назначен'],...(S.users||[]).map(u=>[u.id,u.name])],r.assigneeId||'')}
 ${footer(id?'Сохранить':'Создать заявку')}</form>`);
}
function f6ReceiptForm(requestId,id=''){
 const r=(current().procurementReceipts||[]).find(x=>x.id===id)||{};
 openModal(id?'Изменить получение':'Добавить получение',`<form onsubmit="return submitForm(this,'f6ReceiptSave')"><input type="hidden" name="project" value="${esc(pid)}"><input type="hidden" name="requestId" value="${esc(requestId)}"><input type="hidden" name="id" value="${esc(id)}">
 ${field('quantity','Получено',r.quantity||'1','number','required min="0.0001" step="0.0001"')}
 ${field('businessDate','Дата получения',r.businessDate||new Date().toISOString().slice(0,10),'date','required')}
 ${field('note','Примечание',r.note||'','text','maxlength="1000"')}${footer('Сохранить получение')}</form>`);
}
function f6Delete(kind,id){if(confirm('Удалить запись снабжения?'))action(kind==='request'?'f6RequestDelete':'f6ReceiptDelete',{project:pid,id});}

const f6PreviousTodayView=f5TodayView;
f5TodayView=function(){
 const entries=F6Today.collect(S.projects,{userId:S.user.id,role:S.user.role,projectId:f5TodayProject});
 return f6PreviousTodayView()+`<section class="card"><h2>Материалы · требуется внимание · ${entries.length}</h2>
 ${entries.map(({project,request,group})=>`<div class="line"><b>${esc(request.title)}</b> · ${esc(project.name)}
 <p class="small">${group==='partial'?'Получено частично':group==='overdue'?'Срок прошёл':'Нужно сегодня'} · ${esc(request.neededByDate||'Без срока')}</p>
 <button class="secondary" onclick="openProject('${esc(project.id)}','f6Procurement');tab='f6Procurement';projectPage()">Открыть снабжение</button></div>`).join('')||'<p class="small">Нет заявок, требующих внимания</p>'}</section>`;
};
