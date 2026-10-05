const assert=require('node:assert/strict');
const F2=require('../assets/f2-payments.js');
const core=require('../assets/core.js');
const estimate={id:'estimate',currency:'EUR'};
const incoming=(...values)=>values.map(amount=>({estimateId:estimate.id,kind:'income',currency:'EUR',paid:amount}));
for(const [payments,paid,remaining,overpayment] of [
  [[],0n,10000000n,0n],
  [incoming('30000.00','20000.00'),5000000n,5000000n,0n],
  [incoming('100000.00'),10000000n,0n,0n],
  [incoming('120000.00'),12000000n,0n,2000000n],
]) {
  const result=F2.summary(estimate,payments,'100000.00');
  assert.equal(result.paid,paid);assert.equal(result.remaining,remaining);assert.equal(result.overpayment,overpayment);
}
assert.equal(F2.summary(estimate,incoming('0.01','0.02'),'0.10').remaining,7n);
assert.equal(F2.summary(estimate,[...incoming('20.00'),{estimateId:'other',kind:'income',currency:'EUR',paid:'80.00'}],'100.00').paid,2000n);
assert.equal(F2.summary(estimate,[{estimateId:'estimate',kind:'expense',currency:'EUR',paid:'20.00'}],'100.00').paid,0n);
assert.equal(F2.summary({id:'estimate'},[],'100.00').currencyRequired,true);
assert.equal(F2.summary(estimate,[{estimateId:'estimate',kind:'income',currency:'USD',paid:'20.00'}],'100.00').currencyMismatch,true);
for(const invalid of ['-1','NaN','Infinity','1.001','1e3','']) assert.throws(()=>F2.cents(invalid));
assert.equal(F2.display(2000000n,'EUR'),'20000,00 EUR');
const object={lines:[{price:100,qty:1,coef:1}],materials:[],payments:[
  {kind:'income',amount:20,paid:20},
  {kind:'income',estimateId:'another-estimate',amount:90,paid:90},
]};
assert.equal(core.calc(object).paid,20);
assert.equal(core.calc(object).balance,80);
console.log('F2 payment golden totals, currency isolation and decimal validation passed');
