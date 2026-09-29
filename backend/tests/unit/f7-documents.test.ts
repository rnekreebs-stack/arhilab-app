import test from 'node:test';
import assert from 'node:assert/strict';
import {projectClient,type EstimateMeta,type EstimateRow,type Settings} from '../../src/f7/projection.js';
const meta:EstimateMeta={name:'Смета A',project_name:'Объект',address:'Адрес',client_name:'Клиент',work_markup_percent:'10.00',delivery_amount:'50.00',discount_amount:'10.00',currency:'RUB'};
const row:EstimateRow={title:'Монтаж',quantity:'2.5000',unit:'м²',unit_price:'1234.00',coefficient:'1.0000',item_kind:'work',auto_material:true,material_price:'100.00',extra:false,extra_status:null,stage_name:'Раздел'};
const options:Settings={materials:'detailed',showMaterialPrices:true,showSections:true,paymentTerms:'',timeline:'',warranty:'',note:'',companyDetails:''};
test('F7 derives historical decimal prices and a client-only projection',()=>{
 const source={...row,cost:'99',profit:'777',private_fields:{password:'secret'},expenses:['hidden']} as EstimateRow;
 const x=projectClient(meta,[source],options);
 assert.equal(x.works[0]?.unitPrice,'1234.00');assert.equal(x.works[0]?.total,'3085.00');
 assert.equal(x.materialTotal,'250.00');assert.equal(x.workMarkup,'308.50');assert.equal(x.total,'3683.50');
 for(const forbidden of ['cost','profit','private_fields','expenses','password','secret'])assert.ok(!JSON.stringify(x).includes(forbidden));
 const hidden=projectClient(meta,[row],{...options,materials:'hidden'});assert.equal(hidden.materials.length,0);assert.equal(hidden.materialTotal,'');assert.equal(hidden.total,x.total);
 const noPrice=projectClient(meta,[row],{...options,showMaterialPrices:false});assert.ok(!('unitPrice' in (noPrice.materials[0]??{})));
});
test('F7 excludes unapproved extras and rejects mixed currency',()=>{
 const extra={...row,extra:true,extra_status:'Создано'};
 assert.equal(projectClient(meta,[extra],options).total,'40.00');
 assert.throws(()=>projectClient({...meta,currency:'USD'},[row],options),/currency/);
});
