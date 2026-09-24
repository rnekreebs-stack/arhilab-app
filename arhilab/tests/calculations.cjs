const assert=require('node:assert/strict');const {calc,round,scenario}=require('../assets/core.js');const c=require('../assets/catalog.json');
assert.equal(c.works.length,371);assert.equal(c.materials.length,254);assert.equal(c.works.filter(w=>w.tiers.standard.materialIds.length).length,110);
const scenarios=[
 [{}, {total:0,profit:0,margin:0}],
 [{lines:[{price:100,cost:60,qty:10,coef:1}]},{work:1000,labor:600,gross:400,margin:40}],
 [{lines:[{price:100,cost:60,qty:10,coef:1.5}]},{total:1500,labor:900,profit:600}],
 [{lines:[{price:100,cost:60,qty:2,coef:2,autoMaterial:true,materialPrice:108,materialCost:100}]},{work:400,mat:216,matCost:200,total:616,gross:176}],
 [{materials:[{price:108,cost:100,qty:3}]},{total:324,matCost:300,gross:24}],
 [{delivery:500,deliveryCost:300},{total:500,gross:200}],
 [{lines:[{price:100,cost:60,qty:10,coef:1}],discount:100},{total:900,gross:300}],
 [{lines:[{price:100,cost:60,qty:10,coef:1}],overhead:100,otherCost:50},{gross:400,profit:250}],
 [{payments:[{amount:500,kind:'income'}]},{paid:500,balance:-500,cash:500}],
 [{payments:[{amount:500,kind:'income'},{amount:200,kind:'expense'}]},{cash:300,spent:200}],
 [{lines:[{price:0.1,cost:0,qty:3,coef:1}]},{total:0.3}],
 [{lines:[{price:99.99,cost:50,qty:0.5,coef:1}]},{total:50,labor:25}],
 [{lines:[{price:100,cost:60,qty:0,coef:1}]},{total:0}],
 [{lines:[{price:100,cost:120,qty:1,coef:1}]},{profit:-20,margin:-20}],
 [{discount:100},{total:-100,profit:-100}],
 [{lines:[{price:100,cost:60,qty:1,coef:1,autoMaterial:false,materialPrice:108,materialCost:100}]},{mat:0,total:100}],
 [{lines:Array(25).fill({price:100,cost:60,qty:1,coef:1,autoMaterial:true,materialPrice:108,materialCost:100})},{total:5200,mat:2700,labor:1500,profit:1200}],
 [{materials:[{price:1149.12,cost:1064,qty:2.5}]},{total:2872.8,matCost:2660,gross:212.8}],
 [{lines:[{price:100,cost:60,qty:1,coef:1}],payments:[{amount:100,kind:'income'}]},{balance:0}],
 [{lines:[{price:100,cost:60,qty:1,coef:1}],delivery:10,deliveryCost:5,discount:5,overhead:3,otherCost:2,materials:[{price:108,cost:100,qty:1}],payments:[{amount:200,kind:'income'},{amount:50,kind:'expense'}]},{total:213,gross:48,profit:43,balance:13,cash:150}]
];scenarios.forEach(([p,expected],i)=>{let actual=calc(p);for(const [k,v] of Object.entries(expected))assert.equal(actual[k],v,`case ${i+1}: ${k}`)});console.log('PASS: 20 independent calculation scenarios; 371 works, 254 materials, 110 linked works.');
