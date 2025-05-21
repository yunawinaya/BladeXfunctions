const itemSelection = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;
console.log("itemSelection", itemSelection);
console.log("rowIndex", rowIndex);
if (itemSelection) {
  this.disabled(`subform_dus1f9ob.${rowIndex}.unit_price`, false);
  this.setData({
    [`subform_dus1f9ob.${rowIndex}.uom_id`]:
      arguments[0]?.fieldModel?.item?.based_uom,
  });
} else {
  this.disabled(`subform_dus1f9ob.${rowIndex}.unit_price`, true);
  this.setData({
    [`subform_dus1f9ob.${rowIndex}.uom_id`]: undefined,
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
        [`subform_dus1f9ob.${rowIndex}.unit_price`]: unitPrice,
      });
    });
};

fetchUnitPrice();
