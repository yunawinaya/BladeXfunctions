const adjustmentType = arguments[0]?.value;

if (adjustmentType === "Write Off") {
  this.hide("subform_dus1f9ob.unit_price");
  this.setData({
    subform_dus1f9ob: [],
  });
} else {
  this.setData({
    subform_dus1f9ob: [],
  });
  this.display("subform_dus1f9ob.unit_price");
  this.disabled("subform_dus1f9ob.unit_price", true);
}
