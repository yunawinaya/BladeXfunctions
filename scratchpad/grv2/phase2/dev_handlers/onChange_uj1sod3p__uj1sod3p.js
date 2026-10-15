const { value } = arguments[0];
this.setData({
  serial_number_fy3ty2wc: ''
});
if(value === -9999) {
   this.disabled('serial_number_fy3ty2wc', false)
} else {
   this.disabled('serial_number_fy3ty2wc', true)
}