const data = this.getValues();
const based_uom = data.based_uom;

db.collection("unit_of_measurement")
  .where({ id: data.based_uom })
  .get()
  .then((resUOM) => {
    data.table_uom_conversion.forEach((uom, index) => {
      this.setData({
        [`table_uom_conversion.${index}.base_uom_id`]: resUOM.data[0].uom_name,
      });
    });
  });

if (based_uom) {
  this.disabled("purchase_default_uom", false);
  this.disabled("sales_default_uom", false);
} else {
  this.disabled("purchase_default_uom", true);
  this.disabled("sales_default_uom", true);
}
