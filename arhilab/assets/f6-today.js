'use strict';
const F6Today=(()=>{
 function localDate(now){const pad=n=>String(n).padStart(2,'0');return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;}
 function units(value){const [whole,fraction='']=String(value).split('.');return BigInt(whole)*10000n+BigInt((fraction+'0000').slice(0,4));}
 function collect(projects,{now=new Date(),userId='',role='admin',projectId=''}={}){
  const today=localDate(now),seen=new Set(),entries=[];
  for(const project of projects||[]){if(projectId&&project.id!==projectId)continue;
   for(const request of project.procurementRequests||[]){
    if(seen.has(request.id)||request.status==='cancelled')continue;seen.add(request.id);
    if(role==='worker'&&request.assigneeId!==userId)continue;
    const received=(project.procurementReceipts||[]).filter(r=>r.requestId===request.id).reduce((n,r)=>n+units(r.quantity),0n);
    const remaining=units(request.requestedQuantity)-received;
    if(remaining<=0n)continue;
    const due=request.neededByDate||'';
    let group=received>0n||request.status==='partially_received'?'partial':due&&due<today?'overdue':due===today?'today':null;
    if(group)entries.push({project,request,group});
   }
  }
  entries.sort((a,b)=>(a.request.neededByDate||'9999').localeCompare(b.request.neededByDate||'9999')||a.request.id.localeCompare(b.request.id));
  return entries;
 }
 return {collect};
})();
if(typeof module!=='undefined')module.exports=F6Today;
