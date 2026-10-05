'use strict';
const F5Today=(()=>{
  const priority={urgent:0,high:1,normal:2};
  function localDate(now){const p=n=>String(n).padStart(2,'0');return `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;}
  function plusDays(now,days){const next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+days);return localDate(next);}
  function collect(projects,{now=new Date(),userId='',mine=false,projectId='',role='admin'}={}){
    const today=localDate(now),last=plusDays(now,7),groups={overdue:[],today:[],inProgress:[],upcoming:[],attention:[]};
    const seen=new Set();
    for(const project of projects){
      if(projectId&&project.id!==projectId)continue;
      for(const task of project.tasks||[]){
        if(seen.has(task.id))continue;seen.add(task.id);
        if((mine||role==='worker')&&(task.assigneeId||project.assigned)!==userId)continue;
        const status=task.taskStatus|| (task.done?'done':task.status==='В работе'?'in_progress':'open');
        if(status==='done')continue;
        const due=task.planDate||'';
        const entry={project,task};
        if(due&&due<today)groups.overdue.push(entry);
        else if(due===today)groups.today.push(entry);
        else if(status==='in_progress')groups.inProgress.push(entry);
        else if(due&&due>today&&due<=last)groups.upcoming.push(entry);
      }
      if(role==='admin')for(const estimate of project.estimates||[]){
        const entries=estimate.progressEntries||[];
        for(const item of estimate.lines||[]){
          if(typeof F4Execution==='undefined')break;
          if(F4Execution.item(item,entries).status==='over_completed')
            groups.attention.push({project,estimate,item,reason:'over_completed'});
        }
      }
    }
    for(const name of ['overdue','today','inProgress','upcoming'])groups[name].sort((a,b)=>
      (priority[a.task.priority]??2)-(priority[b.task.priority]??2)||
      (a.task.planDate||'9999').localeCompare(b.task.planDate||'9999')||a.task.id.localeCompare(b.task.id));
    return groups;
  }
  return {localDate,collect};
})();
if(typeof module!=='undefined')module.exports=F5Today;
