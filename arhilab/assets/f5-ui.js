'use strict';
let f5TodayMine=false,f5TodayProject='',f5TaskFilter='open';
function f5TodayView(){
 const groups=F5Today.collect(S.projects,{userId:S.user.id,mine:f5TodayMine,projectId:f5TodayProject,role:S.user.role});
 const labels={overdue:'Просрочено',today:'Сегодня',inProgress:'В работе',upcoming:'Ближайшее · 7 дней',attention:'Требует внимания'};
 const controls=`<div class="stack"><button class="secondary" onclick="f5TodayMine=!f5TodayMine;render()">${f5TodayMine?'Все задачи':'Мои задачи'}</button>
 <select aria-label="Объект" onchange="f5TodayProject=this.value;render()"><option value="">Все объекты</option>${S.projects.map(p=>`<option value="${esc(p.id)}" ${f5TodayProject===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>`;
 return controls+Object.entries(labels).map(([key,label])=>`<section class="card"><h2>${label} · ${groups[key].length}</h2>
 ${groups[key].map(({project,task,item})=>`<div class="line"><b>${esc(task?.name||item?.name)}</b> · ${esc(project.name)}
 <p class="small">${esc(task?.planDate||'Без срока')} · ${esc(task?.priority||'')}</p>
 <button class="secondary" onclick="openProject('${esc(project.id)}','${task?'tasks':'f4Execution'}')">Открыть объект</button></div>`).join('')||'<p class="small">Нет записей</p>'}</section>`).join('');
}
home=function(){
 if(S.user.role==='worker'){$('app').innerHTML=`<h1>Сегодня</h1>${f5TodayView()}`;return;}
 let total=0;S.projects.forEach(p=>{total+=calc(p).total});
 $('app').innerHTML=`<h1>Сегодня</h1><div class="card hero"><div class="small">Портфель смет</div><div class="huge">${money(total)}</div><p>${S.projects.length} объектов</p><button class="gold" onclick="projectForm()">+ Новый объект</button></div>
 ${f5TodayView()}<div class="row"><h2>Объекты</h2><button class="link" onclick="go('projects')">Все →</button></div>
 ${S.projects.slice(-5).reverse().map(projectCard).join('')||'<p class="empty">Объектов пока нет</p>'}`;
};
tasks=function(p){
 const list=(p.tasks||[]).filter(t=>f5TaskFilter==='all'||(t.taskStatus||(t.done?'done':'open'))===f5TaskFilter);
 $('detail').innerHTML=`<div class="card"><h2>Задачи объекта</h2><p class="small">${esc(syncLabel(S.syncSummary))}</p>
 ${S.user.role==='admin'?'<button class="gold" onclick="f5TaskForm()">+ Задача</button>':''}
 <div class="tabs">${[['open','Открытые'],['in_progress','В работе'],['done','Завершённые'],['all','Все']].map(([key,label])=>`<button class="${f5TaskFilter===key?'active':''}" onclick="f5TaskFilter='${key}';projectPage()">${label}</button>`).join('')}</div></div>
 ${list.map(t=>`<div class="card"><div class="row"><h3>${esc(t.name)}</h3><span class="tag">${esc(t.priority||'normal')}</span></div>
 <p>${esc(t.planDate||'Без срока')} · ${esc(t.status||'Не начато')} ${t.progress?'· '+esc(t.progress)+'%':''}</p><p class="small">${esc(t.comment||'')}</p>
 ${S.user.role==='admin'?`<div class="stack"><button class="secondary" onclick="f5TaskForm('${esc(t.id)}')">Изменить</button>
 <button class="secondary" onclick="action('f5TaskSave',{project:pid,id:'${esc(t.id)}',taskStatus:'${t.taskStatus==='done'?'open':'done'}'})">${t.taskStatus==='done'?'Открыть снова':'Выполнить'}</button>
 <button class="danger" onclick="f5TaskDelete('${esc(t.id)}')">Удалить</button></div>`:''}</div>`).join('')||'<p class="empty">Задач пока нет</p>'}`;
};
function f5TaskDelete(id){if(confirm('Удалить задачу?'))action('f5TaskDelete',{project:pid,id})}
function f5TaskForm(id='',context={}){
 const p=current(),t=(p.tasks||[]).find(x=>x.id===id)||{};
 const estimateId=context.estimateId||t.estimateId||'',stageId=context.stageId||t.stageId||'';
 const estimate=(p.estimates||[]).find(e=>e.id===estimateId);
 openModal(id?'Изменить задачу':'Новая задача',`<form onsubmit="return submitForm(this,'f5TaskSave')">
 <input type="hidden" name="project" value="${esc(pid)}"><input type="hidden" name="id" value="${esc(id)}">
 ${field('name','Задача',t.name||context.name||'','text','required maxlength="250"')}
 ${field('comment','Описание',t.comment||'','text','maxlength="1000"')}
 ${select('taskStatus','Статус',[['open','Открыта'],['in_progress','В работе'],['done','Завершена']],t.taskStatus||'open')}
 ${select('priority','Приоритет',[['normal','Обычный'],['high','Высокий'],['urgent','Срочный']],t.priority||'normal')}
 ${field('planDate','Срок',t.planDate||'','date')}
 ${select('assigneeId','Исполнитель',[['','Не назначен'],...(S.users||[]).map(u=>[u.id,u.name])],t.assigneeId||'')}
 ${select('estimateId','Смета',[['','Без сметы'],...(p.estimates||[]).map(e=>[e.id,e.name])],estimateId)}
 ${select('stageId','Этап',[['','Без этапа'],...(estimate?.executionStages||[]).map(e=>[e.id,e.name])],stageId)}
 <input type="hidden" name="estimateItemId" value="${esc(context.estimateItemId||t.estimateItemId||'')}">${footer()}</form>`);
}
