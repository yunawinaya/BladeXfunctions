const exchangeRate = this.getValue('exchange_rate')
const piTotal = this.getValue('invoice_total')

if(!exchangeRate){
    return
}

if(piTotal === undefined || piTotal === 0){
  this.setData({'myr_total_amount': 0.00})
} else {
  const myrTotalAmount = exchangeRate * piTotal
      this.setData({'myr_total_amount': myrTotalAmount})
}
  
