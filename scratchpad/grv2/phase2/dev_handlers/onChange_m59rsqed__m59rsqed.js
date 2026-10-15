const { value } = arguments[0];
this.setData({
  gr_no: ''
});
if(value === -9999) {
   this.disabled('gr_no', false)
} else {
   this.disabled('gr_no', true)
}