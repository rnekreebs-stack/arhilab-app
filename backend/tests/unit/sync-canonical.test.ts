import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../../src/sync/canonical.js';

test('canonical request identity sorts nested keys without sorting array members',()=>{
  const a={number:1,nullable:null,nested:{b:'hello',a:[{y:2,x:1},null]}};
  const b={nested:{a:[{x:1,y:2},null],b:'hello'},nullable:null,number:1};
  assert.equal(canonical(a),canonical(b));
  assert.notEqual(canonical(a),canonical({...b,nested:{...b.nested,a:[null,{x:1,y:2}]}}));
  assert.notEqual(canonical(1),canonical('1'));
  assert.throws(()=>canonical(undefined));
});
