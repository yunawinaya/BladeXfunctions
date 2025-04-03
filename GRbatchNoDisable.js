const page_status = this.getParamsVariables("page_status");
const fieldData = arguments[0];
const rowIndex = fieldData.rowIndex;

db.collection("Item")
  .where({ id: fieldData.value })
  .get()
  .then((res) => {
    console.log("res Junaaaa", res);
    const itemData = res.data[0];
    if (itemData) {
      const batchManagementEnabled =
        itemData.item_batch_management === 1 ||
        itemData.item_batch_management === true ||
        itemData.item_batch_management === "1";

      if (batchManagementEnabled) {
        this.disabled(`table_gr.${rowIndex}.item_batch_no`, false);
        if (page_status === "Add") {
          this.setData({ [`table_gr.${rowIndex}.item_batch_no`]: "" });
        }
      } else {
        this.disabled(`table_gr.${rowIndex}.item_batch_no`, true);
      }
      this.setData({
        [`table_gr.${rowIndex}.item_costing_method`]:
          itemData.material_costing_method,
      });
    } else {
      this.disabled(`table_gr.${rowIndex}.item_batch_no`, true);
    }
  });
