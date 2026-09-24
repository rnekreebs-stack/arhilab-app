const assert=require('node:assert/strict'),fs=require('node:fs');
const {round,calc,packs,procurement}=require('../assets/core.js');
let catalog=JSON.parse(fs.readFileSync(__dirname+'/../assets/catalog.json'));
assert.equal(catalog.materials.length,254);
assert.equal(catalog.works.filter(w=>w.tiers.standard.materialIds.length).length,110);
assert.deepEqual(packs(7.3,1,0),{needed:7.3,count:8,quantity:8});
assert.deepEqual(packs(7.3,1,10),{needed:8.03,count:9,quantity:9});
assert.equal(packs(12,5,7).count,3);
for(const args of [[-1,1,0],[7,0,0],[7,1,101]])assert.throws(()=>packs(...args));
let w=catalog.works.find(w=>w.tiers.standard.materialIds.length),m=catalog.materials.find(x=>x.id===w.tiers.standard.materialIds[0]),l={id:'line',key:w.key,name:w.name,category:w.category,materialTier:'standard',qty:10,coef:1,price:w.price,cost:w.cost,autoMaterial:true,materialPrice:w.tiers.standard.materialPrice,materialCost:w.tiers.standard.materialCost};
let p={lines:[l],materials:[],payments:[]},before=calc(p);
let rows=procurement(p,catalog).rows;
assert.equal(rows.length,w.tiers.standard.materialIds.length);
assert.equal(rows[0].sku,m.id);
assert.equal(rows[0].qty,null); // Source catalog has no per-SKU usage.
assert.equal(rows[0].purchase,null);
p.purchases={['line:'+m.id]:{qty:7.3,pack:1,reserve:10,status:'Заказано',actual:110,actualEntered:true}};
rows=procurement(p,catalog).rows;
assert.equal(rows[0].purchase.count,9);
assert.equal(rows[0].status,'Заказано');
assert.equal(calc(p).total,before.total); // procurement metadata never reprices legacy estimates
l.extra=true;l.extraStatus='Создано';assert.equal(calc(p).total,0);
l.extraStatus='Согласовано';assert.equal(calc(p).total,before.total);
let old={...p,lines:[{...l,extra:false}],payments:[{kind:'income',amount:500}]};assert.equal(calc(old).paid,500);
old.payments=[{kind:'income',amount:500,paid:120}];assert.equal(calc(old).paid,120);
console.log('PASS: 0.6.1 packaging, procurement, approval, payment and legacy totals');
