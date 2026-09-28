'use strict';
const f6PreviousProjectPage=projectPage;
projectPage=function(){
 f6PreviousProjectPage();
 const tabs=document.querySelector('#app .tabs');
 if(tabs)tabs.insertAdjacentHTML('beforeend',`<button class="${tab==='f6Procurement'?'active':''}" onclick="tab='f6Procurement';projectPage()">Снабжение</button>`);
 if(tab==='f6Procurement')f6ProcurementPage(current());
 else if(['estimate','materials','f4Execution'].includes(tab)&&document.getElementById('detail'))
  document.getElementById('detail').insertAdjacentHTML('beforeend',
   '<div class="card"><h3>Потребность и снабжение</h3><p class="small">Комплекты и ручные материалы сметы показаны отдельно от подтверждённых заявок и получений.</p><button class="secondary" onclick="tab=\'f6Procurement\';projectPage()">Открыть снабжение выбранной сметы</button></div>');
};
function f6Units(value){let [whole,fraction='']=String(value).split('.');return BigInt(whole)*10000n+BigInt((fraction+'0000').slice(0,4));}
function f6Format(units){let sign=units<0n?'-':'';let n=units<0n?-units:units;return sign+String(n/10000n)+(n%10000n?'.'+String(n%10000n).padStart(4,'0').replace(/0+$/,''):'')}
function f6ProcurementPage(p){
 const estimate=(p.estimates||[]).find(e=>e.id===(selectedEstimateId||p.legacyEstimateId));
 const requests=(p.procurementRequests||[]).filter(r=>!r.estimateId||r.estimateId===estimate?.id),receipts=p.procurementReceipts||[];
 const labels={requested:'Нужно заказать',ordered:'Заказано',partially_received:'Получено частично',received:'Получено',cancelled:'Отменено'};
 const status=r=>{const got=receipts.filter(x=>x.requestId===r.id).reduce((sum,x)=>sum+f6Units(x.quantity),0n);
  return r.status==='cancelled'?'cancelled':got>=f6Units(r.requestedQuantity)?'received':got>0n?'partially_received':r.status==='ordered'?'ordered':'requested';};
 const groups=['requested','ordered','partially_received','received','cancelled'];
 $('detail').innerHTML=`<div class="card"><h2>Снабжение</h2><p class="small">Заявки создаются только после подтверждения количества. Статус и фактическое получение учитываются отдельно. Расход записывается в разделе «Расходы» отдельным действием.</p>
 ${p.estimates?.length?`<label>Выбранная смета</label><select onchange="selectedEstimateId=this.value;projectPage()">${p.estimates.map(e=>`<option value="${esc(e.id)}" ${estimate?.id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select>`:''}
 ${S.user.role==='admin'?'<button class="gold" onclick="f6RequestForm()">+ Заявка вручную</button>':''}</div>
 ${groups.map(group=>{const groupRows=requests.filter(r=>status(r)===group);return groupRows.length?`<h2>${labels[group]}</h2>`+groupRows.map(r=>{let delivered=receipts.filter(x=>x.requestId===r.id).reduce((sum,x)=>sum+f6Units(x.quantity),0n),remaining=f6Units(r.requestedQuantity)-delivered;
 return `<div class="card"><div class="row"><h3>${esc(r.title)}</h3><span class="tag">${esc(labels[group])}</span></div>
 <p>Запрошено: ${esc(r.requestedQuantity)} ${esc(r.unit)} · Получено: ${f6Format(delivered)} · ${remaining<0n?'Превышение: '+f6Format(-remaining):'Осталось: '+f6Format(remaining)}</p>
 <p class="small">${esc(r.neededByDate||'Без срока')} · ${esc(r.note||'')}${r.catalogSku?' · SKU '+esc(r.catalogSku):' · Ручной материал'}${r.stageId?' · Этап '+esc((estimate?.executionStages||[]).find(s=>s.id===r.stageId)?.name||'—'):''}</p>
 ${receipts.filter(x=>x.requestId===r.id).map(x=>`<div class="line">${esc(x.businessDate)} · ${esc(x.quantity)} ${esc(r.unit)} · ${esc(x.note||'')}
 ${S.user.role==='admin'?`<button class="secondary" onclick="f6ReceiptForm('${esc(r.id)}','${esc(x.id)}')">Изменить</button><button class="danger" onclick="f6Delete('receipt','${esc(x.id)}')">Удалить</button>`:''}</div>`).join('')}
 ${S.user.role==='admin'?`<div class="stack"><button class="secondary" onclick="f6ReceiptForm('${esc(r.id)}')">Принять материал</button><button class="secondary" onclick="f6RequestForm('${esc(r.id)}')">Изменить</button><button class="secondary" onclick="f6ExpenseForm('${esc(r.id)}')">${(p.expenses||[]).some(e=>e.procurementRequestId===r.id)?'Расход уже записан · открыть':'Записать расход отдельно'}</button><button class="danger" onclick="f6Delete('request','${esc(r.id)}')">Удалить</button></div>`:''}</div>`}).join(''):''}).join('')||'<p class="empty">Заявок пока нет.</p>'}
 ${S.user.role==='admin'?`<div class="card"><h3>Подсказка из сметы</h3><p class="small">Расход SKU в старом каталоге может отсутствовать. Проверьте количество перед созданием заявки.</p>
 ${Arhilab.procurement(estimate&&!estimate.legacy?estimate:p,C).rows.slice(0,100).map(x=>`<div class="line">${esc(x.material.name)} · ${esc(x.work)} · ${x.qty??'количество не задано'} ${esc(x.material.unit||'')}
 <button class="secondary" onclick="f6RequestForm('', '${esc(x.sku)}','${esc(x.ref)}')">Подтвердить заявку</button></div>`).join('')||'<p class="small">Автоматический комплект для этой сметы не задан. Создайте заявку вручную.</p>'}</div>`:''}`;
}
function f6RequestForm(id='',sku='',ref='',itemId=''){
 const p=current(),r=(p.procurementRequests||[]).find(x=>x.id===id)||{},material=C.materials.find(x=>x.id===(sku||r.catalogSku));
 const estimate=(p.estimates||[]).find(e=>e.id===(r.estimateId||selectedEstimateId||p.legacyEstimateId));
 const source=estimate&&!estimate.legacy?estimate:p;
 const line=(source.lines||[]).find(x=>ref.startsWith(x.id+':')||x.syncId===itemId)||(source.materials||[]).find(x=>x.id===ref);
 const plan=Arhilab.procurement(source,C).rows.find(x=>x.ref===ref);
 openModal(id?'Изменить заявку':'Новая заявка',`<form onsubmit="return submitForm(this,'f6RequestSave')"><input type="hidden" name="project" value="${esc(pid)}"><input type="hidden" name="id" value="${esc(id)}">
 ${select('catalogSku','Материал каталога',[['','Ручной материал'],...C.materials.map(x=>[x.id,x.name+' · '+x.id])],r.catalogSku||sku)}
 ${field('title','Материал',r.title||material?.name||'','text','required maxlength="250"')}
 ${field('unit','Единица',r.unit||material?.unit||'шт','text','required maxlength="50"')}
 ${field('requestedQuantity','Количество',r.requestedQuantity||plan?.qty||'1','number','required min="0.0001" step="0.0001"')}
 ${select('status','Статус',[['requested','Запрошено'],['ordered','Заказано'],['partially_received','Частично получено'],['received','Получено'],['cancelled','Отменено']],r.status||'requested')}
 ${field('neededByDate','Нужно к дате',r.neededByDate||'','date')}${field('note','Примечание',r.note||'','text','maxlength="1000"')}
 ${select('estimateId','Смета',[['','Без сметы'],...(p.estimates||[]).map(e=>[e.id,e.name])],r.estimateId||estimate?.id||'')}
 <input type="hidden" name="estimateItemId" value="${esc(r.estimateItemId||line?.syncId||'')}">
 <input type="hidden" name="stageId" value="${esc(r.stageId||line?.stageId||'')}">
 ${select('assigneeId','Ответственный',[['','Не назначен'],...(S.users||[]).map(u=>[u.id,u.name])],r.assigneeId||'')}
 ${footer(id?'Сохранить':'Создать заявку')}</form>`);
}

// Keep the F4 work card operational: group quantities only for the same SKU and unit.
function f6WorkProcurement(p,estimate,row){
 const source=estimate.legacy?p:estimate;
 const plans=Arhilab.procurement(source,C).rows.filter(x=>x.ref.startsWith(row.id+':'));
 const requests=(p.procurementRequests||[]).filter(r=>r.estimateId===estimate.id&&r.estimateItemId===row.syncId);
 const receipts=p.procurementReceipts||[];
 const groups=new Map();
 for(const plan of plans){const key=plan.sku+'\u0000'+(plan.material.unit||'');
  if(!groups.has(key))groups.set(key,{sku:plan.sku,unit:plan.material.unit||'',need:0n,known:true,requests:[]});
  const group=groups.get(key);if(plan.qty==null)group.known=false;else group.need+=f6Units(plan.qty);
 }
 for(const request of requests){const key=(request.catalogSku||request.title)+'\u0000'+request.unit;
  if(!groups.has(key))groups.set(key,{sku:request.catalogSku||'',unit:request.unit,need:0n,known:false,requests:[]});
  groups.get(key).requests.push(request);
 }
 let html='<h3>Материалы и снабжение</h3>';
 if(!plans.length)html+='<p class="small">Автоматический комплект материалов для этой работы не задан</p>';
 for(const group of groups.values()){
  const claimed=group.requests.reduce((n,r)=>n+f6Units(r.requestedQuantity),0n);
  const received=group.requests.reduce((n,r)=>n+receipts.filter(x=>x.requestId===r.id).reduce((sum,x)=>sum+f6Units(x.quantity),0n),0n);
  html+=`<div class="line"><b>${esc(group.sku||group.requests[0]?.title||'Материал')}</b> · ${esc(group.unit)}
  <p>Потребность: ${group.known?f6Format(group.need):'уточнить'} · Заявлено: ${f6Format(claimed)} · Получено: ${f6Format(received)} · Осталось: ${received>claimed?'превышение '+f6Format(received-claimed):f6Format(claimed-received)}</p>
  ${group.requests.map(r=>`<p class="small">Заявка ${esc(r.id)} · ${esc(r.title)} · ${esc(r.status)}</p>`).join('')}</div>`;
 }
 if(S.user.role==='admin')html+=`<button class="secondary" onclick="f6RequestForm('', '', '', '${esc(row.syncId)}')">Создать заявку вручную</button>`;
 return html;
}
const f6PreviousWorkDetail=f4WorkDetail;
f4WorkDetail=function(itemId){
 f6PreviousWorkDetail(itemId);
 const {p,e,lines}=f4Context(),row=lines.find(x=>x.syncId===itemId);
 if(row)document.getElementById('modal').insertAdjacentHTML('beforeend',f6WorkProcurement(p,e,row));
};
function f6ReceiptForm(requestId,id=''){
 const r=(current().procurementReceipts||[]).find(x=>x.id===id)||{};
 openModal(id?'Изменить получение':'Добавить получение',`<form onsubmit="return submitForm(this,'f6ReceiptSave')"><input type="hidden" name="project" value="${esc(pid)}"><input type="hidden" name="requestId" value="${esc(requestId)}"><input type="hidden" name="id" value="${esc(id)}">
 ${field('quantity','Получено',r.quantity||'1','number','required min="0.0001" step="0.0001"')}
 ${field('businessDate','Дата получения',r.businessDate||new Date().toISOString().slice(0,10),'date','required')}
 ${field('note','Примечание',r.note||'','text','maxlength="1000"')}${footer('Сохранить получение')}</form>`);
}
function f6Delete(kind,id){if(confirm('Удалить запись снабжения?'))action(kind==='request'?'f6RequestDelete':'f6ReceiptDelete',{project:pid,id});}
function f6ExpenseForm(id){
 const request=(current().procurementRequests||[]).find(x=>x.id===id);
 if(!request)return;
 const existing=(current().expenses||[]).find(x=>x.procurementRequestId===id);
 if(existing){f3ExpenseForm(existing.id);return;}
 openModal('Записать расход по заявке',`<form onsubmit="return submitForm(this,'f3ExpenseSave')">
 <input type="hidden" name="project" value="${esc(pid)}"><input type="hidden" name="estimate" value="${esc(request.estimateId||'')}">
 <input type="hidden" name="procurementRequestId" value="${esc(id)}"><input type="hidden" name="category" value="materials">
 <p>${esc(request.title)} · ${esc(request.requestedQuantity)} ${esc(request.unit)}. Деньги не создаются из статуса или количества автоматически.</p>
 ${field('amount','Фактически потрачено', '', 'number','required min="0.01" step="0.01"')}
 ${field('currency','Валюта (код ISO 4217)', '', 'text','required pattern="[A-Z]{3}" maxlength="3"')}
 ${field('date','Дата расхода',new Date().toISOString().slice(0,10),'date','required')}
 ${field('description','Описание',request.title,'text','required maxlength="250"')}
 ${field('note','Примечание','','text','maxlength="1000"')}${footer('Записать расход')}</form>`);
}

const f6PreviousTodayView=f5TodayView;
f5TodayView=function(){
 const entries=F6Today.collect(S.projects,{userId:S.user.id,role:S.user.role,projectId:f5TodayProject});
 return f6PreviousTodayView()+`<section class="card"><h2>Материалы · требуется внимание · ${entries.length}</h2>
 ${entries.map(({project,request,group})=>`<div class="line"><b>${esc(request.title)}</b> · ${esc(project.name)}
 <p class="small">${group==='partial'?'Получено частично':group==='overdue'?'Срок прошёл':'Нужно сегодня'} · ${esc(request.neededByDate||'Без срока')}</p>
 <button class="secondary" onclick="openProject('${esc(project.id)}','f6Procurement');tab='f6Procurement';projectPage()">Открыть снабжение</button></div>`).join('')||'<p class="small">Нет заявок, требующих внимания</p>'}</section>`;
};
