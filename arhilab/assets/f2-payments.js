'use strict';
const F2Payments=(()=>{
  function cents(value){let text=String(value);if(!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(text))throw Error('Некорректная сумма');
    let [whole,fraction='']=text.split('.');return BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));}
  function summary(estimate,payments,estimateTotal){let currency=estimate.currency;
    if(!/^[A-Z]{3}$/.test(currency||''))return {currencyRequired:true};
    let total=cents(estimateTotal),paid=0n;
    for(const payment of payments){if(payment.estimateId!==estimate.id||payment.kind!=='income')continue;
      if(payment.currency!==currency)return {currencyMismatch:true,currency};
      paid+=cents(payment.paid??payment.paidAmount??payment.amount);
    }
    return {currency,paid,remaining:total>paid?total-paid:0n,overpayment:paid>total?paid-total:0n};}
  function display(value,currency){let absolute=value<0n?-value:value;
    return `${value<0n?'-':''}${absolute/100n},${String(absolute%100n).padStart(2,'0')} ${currency}`;}
  return {cents,summary,display};
})();
if(typeof module!=='undefined')module.exports=F2Payments;
