const exchangeRate = this.getValue('exchange_rate')
const poTotal = this.getValue('po_total')

if(!exchangeRate){
    return
}

if(poTotal === undefined || poTotal === 0){
  this.setData({'myr_total_amount': 0.00})
} else {
  const myrTotalAmount = exchangeRate * poTotal
            this.setData({'myr_total_amount': myrTotalAmount})
}
  
