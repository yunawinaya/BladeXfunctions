const { value, rowIndex } = arguments[0];
const path = `subform_sub_material.${rowIndex}.ref_bom_id`;

if (value === "reference") {
  this.disabled([path], false);
} else {
  this.setData({ [path]: null });
  this.disabled([path], true);
}
