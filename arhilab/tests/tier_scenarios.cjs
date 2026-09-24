const assert=require('node:assert/strict');
const {scenario,calc,round}=require('../assets/core.js');
const catalog=require('../assets/catalog.json');
const tiers=['economy','standard','premium'];
const sku=new Map(catalog.materials.map(m=>[m.id,m]));
assert.equal(sku.size,254);
const works=catalog.works.filter(w=>w.tiers.standard.materialIds.length);
assert.equal(works.length,110);
for(const w of catalog.works){for(const tier of tiers){const kit=w.tiers[tier];for(const id of kit.materialIds)assert.ok(sku.has(id),`Missing SKU ${id} in ${w.name}/${tier}`);assert.equal(kit.materialIds.length>0,kit.materialCost>0,`Missing/invalid cost in ${w.name}/${tier}`);}}
// 20 different estimates, each with two work types and a manually added product.
for(let n=0;n<20;n++){
 const first=works[n],second=works[works.length-1-n],markup=[8,10,12][n%3];
 const line=(w,q,c)=>({key:w.key,category:w.category,name:w.name,qty:q,coef:1+n%3/10,price:w.price,cost:w.cost,autoMaterial:true,materialCost:1,materialPrice:1});
 const p={materialMarkup:markup,lines:[line(first,n+1,first.cost),line(second,0.5+n/5,second.cost)],materials:[{price:216,cost:200,qty:1+n%4}],delivery:250+n*10,deliveryCost:100,discount:n*3,overhead:75,otherCost:25};
 const original=JSON.stringify(p);
 for(const tier of tiers){const got=scenario(p,tier,catalog),cost=round(p.lines.reduce((a,l)=>a+round(catalog.works.find(w=>w.key===l.key).tiers[tier].materialCost*l.qty),0)+p.materials[0].cost*p.materials[0].qty),price=round(p.lines.reduce((a,l)=>{const kit=catalog.works.find(w=>w.key===l.key).tiers[tier];return a+round(round(kit.materialCost*(1+markup/100))*l.qty)},0)+p.materials[0].price*p.materials[0].qty);assert.equal(got.matCost,cost,`${n} ${tier} procurement`);assert.equal(got.mat,price,`${n} ${tier} customer material`);assert.equal(got.total,round(got.work+price+p.delivery-p.discount),`${n} ${tier} total`);assert.equal(got.gross,round(got.total-got.labor-cost-p.deliveryCost),`${n} ${tier} gross`);assert.equal(got.profit,round(got.gross-p.overhead-p.otherCost),`${n} ${tier} profit`);assert.equal(got.margin,got.total?100*got.gross/got.total:0,`${n} ${tier} margin`);}
 assert.equal(JSON.stringify(p),original,'Scenario changed saved estimate');
}
const unlinked=catalog.works.find(w=>!w.tiers.standard.materialIds.length),p={lines:[{key:unlinked.key,name:unlinked.name,category:unlinked.category,price:100,cost:20,qty:1,coef:1,autoMaterial:false}],materials:[{price:108,cost:100,qty:2}]};for(const tier of tiers)assert.equal(scenario(p,tier,catalog).mat,216);
console.log('PASS: 20 distinct estimates × 3 material classes; all catalog material references resolved; procurement, customer total, profit, margin, unchanged saved estimates and manual materials.');
