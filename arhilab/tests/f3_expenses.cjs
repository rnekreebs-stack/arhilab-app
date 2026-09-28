'use strict';
const assert=require('node:assert/strict');
global.F2Payments=require('../assets/f2-payments.js');
const F3=F2Payments.F3Expenses;
const estimate={id:'estimate-1',currency:'EUR'};
const income=[{estimateId:estimate.id,kind:'income',currency:'EUR',amount:'400000.00'}];
const expenses=[{estimateId:estimate.id,currency:'EUR',amount:'210000.00'},
  {estimateId:null,currency:'EUR',amount:'1000.00'},
  {estimateId:'another',currency:'USD',amount:'20.00'}];
let summary=F3.summary(estimate,income,expenses,'1000000.00');
assert.equal(summary.actualExpenses,21000000n);
assert.equal(summary.cashResult,19000000n);
assert.equal(summary.forecastGrossProfit,79000000n);
assert.equal(summary.forecastMargin,7900n);
assert.deepEqual(F3.projectTotals(expenses),{EUR:21100000n,USD:2000n});
assert.equal(F3.summary(estimate,income,[...expenses,{estimateId:estimate.id,currency:'USD',amount:'1'}],
  '1000000.00').currencyMismatch,true);
summary=F3.summary(estimate,income,expenses,'0');assert.equal(summary.forecastMargin,null);
assert.equal(F3.summary({id:estimate.id},income,expenses,'1').currencyRequired,true);
console.log('F3 exact-cents expense totals, currency boundaries and zero denominator passed');
