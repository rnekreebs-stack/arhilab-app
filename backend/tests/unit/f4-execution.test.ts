import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePayload,visibleSnapshot} from '../../src/sync/registry.js';

test('F4 stage ownership and progress journal validate UUID, decimal and date',()=>{
 const uuid='e8f00ff0-3392-4400-8000-111111111111';
 const stage={projectId:uuid,estimateId:uuid,name:'Электрика',position:1};
 assert.deepEqual(parsePayload('stage','create',stage),stage);
 assert.equal(parsePayload('stage','create',{...stage,estimateId:'wrong'}),null);
 const progress={projectId:uuid,estimateId:uuid,estimateItemId:uuid,quantity:'2.2500',businessDate:'2026-09-28'};
 assert.deepEqual(parsePayload('progressEntry','create',progress),progress);
 for(const value of ['0','-1','1.12345','1e2'])
   assert.equal(parsePayload('progressEntry','create',{...progress,quantity:value}),null);
 assert.equal(parsePayload('progressEntry','create',{...progress,businessDate:'tomorrow'}),null);
 assert.equal(parsePayload('progressEntry','create',{...progress,createdBy:uuid}),null);
 assert.deepEqual(parsePayload('progressEntry','delete',{}),{});
});

test('worker operational change does not contain estimate prices or F2/F3 financial fields',()=>{
 const source={id:'a',revision:1,title:'Штукатурка',quantity:'120',unit:'м²',stageId:'b',
   price:'100',materialPrice:'10',privateData:{cost:'12'},workMarkupPercent:'10',delivery:'200',discount:'5',currency:'RUB'};
 const worker=visibleSnapshot('worker',source);
 assert.equal(worker.title,'Штукатурка');
 for(const field of ['price','materialPrice','privateData','workMarkupPercent','delivery','discount','currency'])
   assert.equal(field in worker,false,field);
 assert.equal(visibleSnapshot('admin',source).price,'100');
});
