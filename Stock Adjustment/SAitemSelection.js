const itemSelection = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;
console.log("itemSelection", itemSelection);
console.log("rowIndex", rowIndex);
if (itemSelection) {
  this.disabled(`subform_dus1f9ob.${rowIndex}.unit_price`, false);
} else {
  this.disabled(`subform_dus1f9ob.${rowIndex}.unit_price`, true);
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
