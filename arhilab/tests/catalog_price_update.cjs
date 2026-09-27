const assert = require('node:assert/strict');
const catalog = require('../assets/catalog.json');
const {calc} = require('../assets/core.js');

const byId = id => catalog.works.find(w => w.id === id);
assert.equal(catalog.works.length, 389);
assert.equal(catalog.materials.length, 254);
assert.equal(catalog.works.filter(w => w.tiers.standard.materialIds.length).length, 110);
assert.equal(new Set(catalog.works.map(w => w.id)).size, catalog.works.length);
assert.equal(new Set(catalog.works.map(w => w.key)).size, catalog.works.length);
for (const w of catalog.works) {
  for (const field of ['id', 'key', 'name', 'category', 'unit', 'note', 'price', 'cost', 'tiers']) assert.ok(Object.hasOwn(w, field), `${w.id}: ${field}`);
  assert.ok(w.unit && w.price >= 0 && Number.isFinite(w.price));
  for (const tier of Object.values(w.tiers)) {
    assert.ok(Array.isArray(tier.materialIds) && tier.materialIds.every(id => catalog.materials.some(m => m.id === id)));
  }
}
const fixed = [
  ['eng2026-001',10000,12000],['eng2026-002',13000,15600],
  ['eng2026-003',15000,18000],['eng2026-004',12000,14400],
  ['236',1400,1680],['eng2026-005',2000,2400],['237',12000,14400],
  ['eng2026-006',6000,7200],['eng2026-007',20000,24000],
  ['218',8000,9600],['eng2026-009',9000,10800],
  ['eng2026-012',50000,60000],['eng2026-013',500,600],
  ['eng2026-014',480,576],['eng2026-015',450,540],
  ['eng2026-016',420,504],['eng2026-017',40000,48000],
  ['eng2026-018',400,480]
];
for (const [id, contractor, client] of fixed) {
  assert.equal(contractor * 120 / 100, client, id);
  assert.equal(byId(id).price, client, id);
}
assert.equal(byId('223').price, 6500, 'Shower drain is the explicit exception');
for (const [id, price] of [['234',7500],['197',4800],['205',3500],['206',18000],['199',4500]]) assert.equal(byId(id).price,price);
assert.deepEqual(byId('236').tiers.standard.materialIds,['sku-c6561d80158e07c9','104']);
assert.deepEqual(byId('237').tiers.standard.materialIds,['104','103']);
for (const id of ['eng2026-008','eng2026-010','eng2026-011']) {
  const w=byId(id);
  assert.equal(w.price,0);
  assert.equal(w.requiresManualPrice,true);
  assert.ok(w.note.includes('вручную'));
}
assert.match(byId('eng2026-008').note,/4 800–12 000/);
assert.match(byId('eng2026-010').note,/30%/);
assert.match(byId('eng2026-011').note,/24 000–96 000/);
for (const id of ['eng2026-001','eng2026-002','eng2026-003','eng2026-005','eng2026-006','eng2026-009']) {
  assert.ok(byId(id).tiers.standard.materialIds.length===0, 'No duplicated pipe/chasing material kit');
}
for (const q of ['радиатор','дизайн-радиатор','конвектор','тёплый пол','коллектор','узел ввода','смеситель','инсталляция','канализация','трап','котельная','пусконаладка','проектирование']) {
  assert.ok(catalog.works.some(w => (w.name+' '+w.category+' '+w.note+' '+(w.searchAliases||'')).toLowerCase().includes(q)), q);
}
// Android stores work price in each estimate line. Reading a newer catalogue cannot reprice it.
const saved=JSON.parse(JSON.stringify({lines:[{id:'old-uuid',key:byId('236').key,name:byId('236').name,qty:2,coef:1,price:900,autoMaterial:false}],materials:[],workMarkupPercent:'0'}));
assert.equal(calc(saved).estimateTotal,1800);
const reopened=JSON.parse(JSON.stringify(saved));
assert.equal(reopened.lines[0].price,900);
assert.equal(calc(reopened).estimateTotal,1800);
reopened.lines.push({id:'new-uuid',key:byId('236').key,name:byId('236').name,qty:2,coef:1,price:byId('236').price,autoMaterial:false});
assert.equal(reopened.lines[1].price,1680);
assert.equal(calc(reopened).estimateTotal,5160);
assert.equal(calc({...reopened,lines:[reopened.lines[1]],workMarkupPercent:'10'}).estimateTotal,3696);
console.log('PASS: 18 new engineering works, three price updates, fixed exceptions, preserved kit links and historical estimate prices');
