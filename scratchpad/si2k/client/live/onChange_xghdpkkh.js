const { value } = arguments[0];
this.setData({
  sales_invoice_no: ''
});
if(value === -9999) {
   this.disabled('sales_invoice_no', false)
} else {
   this.disabled('sales_invoice_no', true)
}