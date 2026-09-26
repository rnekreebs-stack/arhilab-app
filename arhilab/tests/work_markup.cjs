const assert=require('node:assert/strict');
const {calc,scenario}=require('../assets/core.js');
const catalog=require('../assets/catalog.json');
const base={lines:[{id:'w1',name:'Монтаж',price:100000,cost:60000,qty:1,coef:1}],
  materials:[{id:'m1',name:'Кабель',price:50000,cost:40000,qty:1}],payments:[]};
for(const [percent,markup,total] of [[0,0,150000],[10,10000,160000],[30,30000,180000]]) {
  const result=calc({...base,workMarkupPercent:String(percent)});
  assert.equal(result.baseWorksTotal,100000);
  assert.equal(result.workMarkupAmount,markup);
  assert.equal(result.worksTotalWithMarkup,100000+markup);
  assert.equal(result.materialsTotal,50000);
  assert.equal(result.estimateTotal,total);
}
const legacy={...base,delivery:750,discount:250,lines:[{...base.lines[0],qty:1.5,coef:1.2}],
  materials:[{...base.materials[0],qty:0.5}],address:'Старый адрес',client:'Старый заказчик',materialMarkup:8};
const restored=JSON.parse(JSON.stringify(legacy));
assert.equal(restored.workMarkupPercent,undefined);
assert.equal(calc(restored).total,calc({...legacy,workMarkupPercent:'0'}).total);
assert.deepEqual(restored.lines,legacy.lines);assert.deepEqual(restored.materials,legacy.materials);
assert.equal(restored.address,legacy.address);assert.equal(restored.client,legacy.client);
assert.equal(calc({...legacy,workMarkupPercent:'10'}).workMarkupAmount,18000);
assert.equal(calc({...legacy,workMarkupPercent:'10'}).total,223500);
assert.equal(calc({lines:[{price:0.1,qty:3,coef:1}],materials:[{price:0.01,qty:1}],workMarkupPercent:'15'}).total,0.36);
assert.equal(calc({lines:[{price:100000000,qty:1.25,coef:1}],workMarkupPercent:'0.01'}).workMarkupAmount,12500);
assert.equal(calc({lines:[{price:1,qty:1,coef:1}],workMarkupPercent:'0.50'}).workMarkupAmount,0.01);
for(const invalid of ['-1','100.01','0.001','Infinity'])assert.throws(()=>calc({...base,workMarkupPercent:invalid}));
const kit=catalog.works.find(w=>w.tiers.standard.materialIds.length>0);
assert.ok(kit);
const tier={lines:[{...kit,id:'kit-line',qty:2.5,coef:1.2,autoMaterial:true,
  materialPrice:kit.tiers.standard.materialPrice,materialCost:kit.tiers.standard.materialCost}],materialMarkup:8};
const old=scenario(tier,'economy',catalog),marked=scenario({...tier,workMarkupPercent:'20'},'economy',catalog);
assert.equal(marked.baseWorksTotal,old.baseWorksTotal);
assert.equal(marked.materialsTotal,old.materialsTotal);
assert.equal(marked.estimateTotal-old.estimateTotal,marked.workMarkupAmount);
console.log('PASS: F1 markup golden cases, old estimate, decimal rounding, kit scenario and JSON round-trip');
