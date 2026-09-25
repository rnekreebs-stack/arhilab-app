const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=JSON.parse(fs.readFileSync('assets/catalog.json','utf8'));
const {calc,scenario,procurement,packs}=require('../assets/core.js');
assert.equal(C.materials.length,254);
assert.equal(C.works.length,371);
assert.equal(C.works.filter(w=>w.tiers.standard.materialIds.length).length,110);
const w=C.works.find(x=>x.tiers.standard.materialIds.length);
const projects=Array.from({length:100},(_,i)=>({
  id:`project-${i}`,name:`Объект ${i}`,materialMarkup:8,delivery:0,discount:0,
  lines:Array.from({length:11},(_,j)=>({id:`line-${i}-${j}`,key:w.key,name:w.name,category:w.category,qty:2,coef:1,price:300,cost:180,autoMaterial:true,materialTier:'standard',materialCost:w.tiers.standard.materialCost,materialPrice:w.tiers.standard.materialCost*1.08})),
  materials:[{id:C.materials[0].id,name:C.materials[0].name,qty:3,cost:C.materials[0].cost,price:C.materials[0].cost*1.08}],
  tasks:Array.from({length:8},(_,j)=>({id:`t-${i}-${j}`,done:false})),
  payments:Array.from({length:8},(_,j)=>({id:`p-${i}-${j}`,kind:'income',amount:500,paid:j*50})),
}));
const start=performance.now();
for(const p of projects){let x=calc(p);assert(Number.isFinite(x.profit));assert(Number.isFinite(scenario(p,'premium',C).total));assert(procurement(p,C).rows.length>0);}
const ms=Math.round(performance.now()-start);
assert.equal(projects.length,100);
assert.equal(projects.reduce((n,p)=>n+p.lines.length,0),1100);
assert.equal(packs(7.3,1,10).count,9);
assert(ms<15000,`Calculation too slow on CI: ${ms}ms`);
console.log(`PASS: 100 projects, 1100 lines, 800 stages, 800 payments; calculations ${ms}ms, heap ${Math.round(process.memoryUsage().heapUsed/1048576)}MiB`);
