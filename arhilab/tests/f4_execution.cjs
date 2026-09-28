const assert=require('node:assert/strict');
const F4=require('../assets/f4-execution.js');
const row={syncId:'work-1',qty:'120.00',unit:'м²'};
const entries=['35.00','20.00','15.00'].map(quantity=>({estimateItemId:'work-1',quantity}));
const outcome=F4.item(row,entries);
assert.equal(F4.format(outcome.completed),'70.0000');
assert.equal(F4.format(outcome.remaining),'50.0000');
assert.ok(Math.abs(outcome.percent-58.33)<0.01);
assert.equal(F4.item(row,[...entries,{estimateItemId:'work-1',quantity:'50.00'}]).status,'completed');
assert.equal(F4.format(F4.item({syncId:'a',qty:'12.50'},[
 {estimateItemId:'a',quantity:'2.25'},{estimateItemId:'a',quantity:'3.10'}]).completed),'5.3500');
assert.equal(F4.item({syncId:'work-1',qty:'60.00'},entries).status,'over_completed');
assert.equal(F4.readiness([row,{syncId:'b',qty:'10',unit:'шт.'},{syncId:'c',qty:'2',unit:'п.м.'}],
 [...entries,{estimateItemId:'work-1',quantity:'50.00'},{estimateItemId:'b',quantity:'5'}]).percent,50);
assert.equal(F4.readiness([],[]).status,'not_started');
assert.equal(F4.item({syncId:'z',qty:'0'},[]).status,'no_plan');
assert.throws(()=>F4.units('1.00001'));
console.log('F4 decimal, independent units, inconsistency and empty stage checks passed');
