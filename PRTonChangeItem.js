const item = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const page_status = this.getParamsVariables("page_status");
console.log("page status item", page_status);

setTimeout(() => {
  if (page_status === "View") {
    this.disabled([`table_prt.${rowIndex}.select_return_qty`], false);
    console.log("enable select stock");
  }
}, 1000);

db.collection("Item")
  .where({ id: item.material_id })
  .get()
  .then((resItem) => {
    const itemData = resItem?.data[0];

    if (itemData) {
      this.setData({
        [`table_prt.${rowIndex}.costing_method`]:
          itemData.material_costing_method,
      });
    }
  });
