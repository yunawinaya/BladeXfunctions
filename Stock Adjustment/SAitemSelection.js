const itemSelection = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;
console.log("itemSelection", itemSelection);
console.log("rowIndex", rowIndex);
if (itemSelection) {
  if (arguments[0].fieldModel) {
    this.disabled(`stock_adjustment.${rowIndex}.unit_price`, false);
    this.setData({
      [`stock_adjustment.${rowIndex}.uom_id`]:
        arguments[0]?.fieldModel?.item?.based_uom,
    });
  }
} else {
  this.disabled(`stock_adjustment.${rowIndex}.unit_price`, true);
  this.setData({
    [`stock_adjustment.${rowIndex}.uom_id`]: undefined,
  });
}

const fetchUnitPrice = async () => {
  await db
    .collection("Item")
    .where({ id: itemSelection })
    .get()
    .then((res) => {
      const unitPrice = res.data[0].purchase_unit_price;
      this.setData({
        [`stock_adjustment.${rowIndex}.unit_price`]: unitPrice,
        [`stock_adjustment.${rowIndex}.material_name`]:
          res.data[0].material_name,
        [`stock_adjustment.${rowIndex}.material_desc`]:
          res.data[0].material_desc,
        [`stock_adjustment.${rowIndex}.is_serialized_item`]:
          res.data[0].serial_number_management,
        [`stock_adjustment.${rowIndex}.is_single_serial`]:
          res.data[0].is_single_unit_serial,
      });
    });
};

fetchUnitPrice();
