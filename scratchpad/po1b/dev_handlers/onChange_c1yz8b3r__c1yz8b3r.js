const { value } = arguments[0];
this.setData({
  purchase_order_no: ''
});
if(value === -9999) {
   this.disabled('purchase_order_no', false)
} else {
   this.disabled('purchase_order_no', true)
}