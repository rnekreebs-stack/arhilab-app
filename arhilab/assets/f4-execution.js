'use strict';
const F4Execution=(()=>{
  function units(value){
    const text=String(value??'0');
    if(!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(text))throw Error('Некорректный объём');
    const [whole,part='']=text.split('.');return BigInt(whole)*10000n+BigInt(part.padEnd(4,'0'));
  }
  function format(value){let sign=value<0n?'-':'',amount=value<0n?-value:value;
    return sign+(amount/10000n).toString()+'.'+(amount%10000n).toString().padStart(4,'0');}
  function item(row,entries){
    let planned=units(row.qty),completed=(entries||[]).filter(e=>e.estimateItemId===row.syncId)
      .reduce((sum,e)=>sum+units(e.quantity),0n);
    let remaining=planned-completed;
    return {planned,completed,remaining,percent:planned>0n?Number(completed*10000n/planned)/100:null,
      status:planned===0n?'no_plan':remaining<0n?'over_completed':completed===0n?'not_started':remaining===0n?'completed':'in_progress'};
  }
  function readiness(rows,entries){let values=rows.map(row=>item(row,entries)).filter(x=>x.percent!==null);
    if(!values.length)return {percent:null,status:'not_started'};
    if(values.some(x=>x.status==='over_completed'))return {percent:null,status:'over_completed'};
    return {percent:values.reduce((n,x)=>n+x.percent,0)/values.length,
      status:values.every(x=>x.status==='completed')?'completed':values.every(x=>x.status==='not_started')?'not_started':'in_progress'};
  }
  return {units,format,item,readiness};
})();
if(typeof module!=='undefined')module.exports=F4Execution;
