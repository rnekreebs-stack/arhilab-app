import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { packageSchema,inspectPackage,packageHash } from '../../src/migration/package.js';

test('legacy business fields survive validation and missing currency blocks projection',()=>{
  const payment=randomUUID();
  const pkg=packageSchema.parse({format:'ArhilabMigration-1',sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,
    exportedAt:'2026-01-01T00:00:00.000Z',catalog:{works:[{name:'Fixture',tiers:{standard:{materialCost:20}}}]},
    projects:[{id:randomUUID(),name:'Site',address:'Legacy address',client:'Legacy customer',discount:25,
      lines:[{id:randomUUID(),name:'Work',qty:2,coef:1.5,price:25,key:'catalog-key',kitOverrides:{sku:{qty:2}}}],
      materials:[],tasks:[],payments:[{id:payment,kind:'income',amount:250,date:'2026-01-01'}],notes:[],photos:[]}],
  });
  assert.equal(pkg.projects[0]?.lines[0]?.key,'catalog-key');
  assert.equal(pkg.projects[0]?.address,'Legacy address');
  assert.ok(pkg.catalog);
  assert.ok(inspectPackage(pkg).issues.some(i=>i.code==='payment_currency_required'&&i.legacyEntityId===payment));
  assert.equal(packageHash(pkg),packageHash(packageSchema.parse(JSON.parse(JSON.stringify(pkg)) as unknown)));
});

test('legacy security fields are rejected at root, project, and nested business rows',()=>{
  const base={format:'ArhilabMigration-1',sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,
    exportedAt:'2026-01-01T00:00:00.000Z',projects:[{id:randomUUID(),name:'Site',lines:[],materials:[],tasks:[],payments:[],notes:[],photos:[]}]};
  assert.equal(packageSchema.safeParse({...base,users:[{hash:'secret'}]}).success,false);
  assert.equal(packageSchema.safeParse({...base,projects:[{...base.projects[0],token:'secret'}]}).success,false);
  assert.equal(packageSchema.safeParse({...base,catalog:{works:[{sessionHash:'secret'}]}}).success,false);
  assert.equal(packageSchema.safeParse({...base,team:[{id:randomUUID(),name:'Admin',login:'x',role:'admin',salt:'secret'}]}).success,false);
});

test('unrepresentable task status and quantity precision block finalization without rounding',()=>{
  const task=randomUUID(),line=randomUUID();
  const pkg=packageSchema.parse({format:'ArhilabMigration-1',sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,
    exportedAt:'2026-01-01T00:00:00.000Z',projects:[{id:randomUUID(),name:'Site',
      lines:[{id:line,name:'Work',qty:1.00001,coef:1,price:10}],materials:[],
      tasks:[{id:task,name:'Paused',status:'Приостановлено'}],payments:[],notes:[],photos:[]}]});
  const issues=inspectPackage(pkg).issues;
  assert.ok(issues.some(i=>i.code==='unsupported_task_status'&&i.legacyEntityId===task));
  assert.ok(issues.some(i=>i.code==='invalid_quantity_precision'&&i.legacyEntityId===line));
});

test('JPEG photo payload is preserved in legacy package without entering sync projection',async()=>{
  const photoId=randomUUID(),jpeg='data:image/jpeg;base64,/9j/2Q==';
  const pkg=packageSchema.parse({format:'ArhilabMigration-1',sourceFormat:'Arhilab-2',sourceAppVersion:'0.6.2',sourceSchemaVersion:2,
    exportedAt:'2026-01-01T00:00:00.000Z',projects:[{id:randomUUID(),name:'Site',lines:[],materials:[],tasks:[],payments:[],notes:[],
      photos:[{id:photoId,data:jpeg,date:'2026-01-01'}]}]});
  assert.equal(pkg.projects[0]?.photos[0]?.data,jpeg);
  assert.ok(inspectPackage(pkg).issues.some(i=>i.code==='photos_pending_stage5'));
  const { projection }=await import('../../src/migration/projection.js');
  assert.equal(projection(pkg,new Map()).some(x=>x.sourceId===photoId),false);
});
