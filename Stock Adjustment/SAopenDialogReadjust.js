const allData = this.getValues();
console.log("allData", allData);
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const adjustment_type = this.getValue("adjustment_type");
const materialId = lineItemData.material_id;
const tempQtyData = lineItemData.temp_qty_data;
const plantId = allData.plant_id;
const page_status = this.getParamsVariables("page_status");
if (page_status === "View") {
  this.disabled(
    [
      `dialog_index.table_index.movement_type`,
      `dialog_index.table_index.category`,
      `dialog_index.table_index.sa_quantity`,
    ],
    true
  );
}
// Fetch item data first
db.collection("Item")
  .where({
    id: materialId,
  })
  .get()
  .then((response) => {
    console.log("response item", response);
    const itemData = response.data[0];
    console.log("itemData", itemData);

    // Set basic dialog data
    this.setData({
      [`dialog_index.material_id`]: itemData.material_code,
      [`dialog_index.material_name`]: itemData.material_name,
      [`dialog_index.row_index`]: rowIndex,
    });

    // Push table_index data into dialog_index.table_index
    if (allData.table_index && allData.table_index.length > 0) {
      // Method 1: Push entire array at once
      this.setData({
        [`dialog_index.table_index`]: [...allData.table_index],
      });
    }

    // Process based on batch management
    if (itemData.item_batch_management === 1) {
      this.display("table_index.batch_id");

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
          plant_id: plantId,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response.data);
          const itemBalanceData = response.data;

          if (adjustment_type === "Write Off") {
            this.setData({
              [`dialog_index.table_index.movement_type`]: "Out",
            });
            this.hide(`dialog_index.table_index.movement_type`);
          } else {
            this.display([`dialog_index.table_index.movement_type`]);
          }
        })
        .catch((error) => {
          console.error("Error fetching item batch balance data:", error);
        });
    } else {
      this.hide("table_index.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
          plant_id: plantId,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response.data);
          const itemBalanceData = response.data;

          if (adjustment_type === "Write Off") {
            this.setData({
              [`dialog_index.table_index.movement_type`]: "Out",
            });
            this.hide(`dialog_index.table_index.movement_type`);
          } else {
            this.display([`dialog_index.table_index.movement_type`]);
          }
        })
        .catch((error) => {
          console.error("Error fetching item balance data:", error);
        });
    }
  })
  .catch((error) => {
    console.error("Error fetching item data:", error);
  });
