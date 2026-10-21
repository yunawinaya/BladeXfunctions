const exchangeRate = this.getValue('exchange_rate')
const siTotal = this.getValue('invoice_total')

if(!exchangeRate){
    return
}

if(siTotal === undefined || siTotal === 0){
  this.setData({'myr_total_amount': 0.00})
} else {
  const myrTotal = exchangeRate * siTotal;
  this.setData({
    myr_total_amount: myrTotal,
  });
}