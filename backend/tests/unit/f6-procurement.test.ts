import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePayload,visibleSnapshot} from '../../src/sync/registry.js';
import {catalogSkuIds} from '../../src/sync/catalog-skus.js';
const uuid='8d54e4be-920e-4f20-b8dc-c26bf5dc21ff';
const request={projectId:uuid,title:'Кабель',unit:'м',requestedQuantity:'12.5000',status:'requested'};
test('F6 request and receipt payloads use exact positive decimal quantities and strict operational fields',()=>{
 assert.ok(parsePayload('procurementRequest','create',request));
 assert.equal(parsePayload('procurementRequest','create',{...request,requestedQuantity:'0'}),null);
 assert.equal(parsePayload('procurementRequest','create',{...request,requestedQuantity:'1.00001'}),null);
 assert.equal(parsePayload('procurementRequest','create',{...request,cost:'100.00'}),null);
 assert.ok(parsePayload('procurementReceipt','create',{projectId:uuid,requestId:uuid,quantity:'0.0001',businessDate:'2026-09-28'}));
 assert.equal(parsePayload('procurementReceipt','create',{projectId:uuid,requestId:uuid,quantity:'-1',businessDate:'2026-09-28'}),null);
 assert.equal(parsePayload('procurementRequest','update',{createdBy:uuid}),null);
});
test('F6 operational snapshot contains no monetary fields',()=>{
 const view=visibleSnapshot('worker',{id:uuid,title:'Кабель',requestedQuantity:'2.0000',privateData:{cost:'99'},price:'99'});
 assert.equal(view.privateData,undefined);assert.equal(view.price,undefined);
});
test('F6 server catalog SKU allowlist follows shipped Android catalog',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../../../arhilab/assets/catalog.json',import.meta.url),'utf8')) as
  {materials:Array<{id:string}>};
 assert.deepEqual([...catalogSkuIds].sort(),catalog.materials.map(m=>m.id).sort());
});
