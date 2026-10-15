const { value } = arguments[0];
this.setData({
  to_id: ''
});
if(value === -9999) {
   this.disabled('to_id', false)
} else {
   this.disabled('to_id', true)
}