const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const adjustment_type = allData.adjustment_type;
const materialId = lineItemData.material_id;
const plantId = allData.plant_id;

const filterZeroQuantityRecords = (data) => {
  return data.filter((record) => {
    // Check if any of the quantity fields have a value greater than 0
    const hasQuantity =
      (record.block_qty && record.block_qty > 0) ||
      (record.reserved_qty && record.reserved_qty > 0) ||
      (record.unrestricted_qty && record.unrestricted_qty > 0) ||
      (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
      (record.intransit_qty && record.intransit_qty > 0) ||
      (record.balance_quantity && record.balance_quantity > 0);

    return hasQuantity;
  });
};

// Proceed with original queries if no tempQtyData
if (materialId) {
  db.collection("Item")
    .where({
      id: materialId,
    })
    .get()
    .then((response) => {
      console.log("response item", response);
      const itemData = response.data[0];
      console.log("itemData", itemData);
      this.setData({
        [`sa_item_balance.material_id`]: itemData.material_code,
        [`sa_item_balance.material_name`]: itemData.material_name,
        [`sa_item_balance.row_index`]: rowIndex,
        [`sa_item_balance.material_uom`]: itemData.based_uom,
      });

      const previousBalanceData =
        lineItemData.balance_index === ""
          ? []
          : JSON.parse(lineItemData.balance_index);

      console.log("previousBalanceData", previousBalanceData);

      if (itemData.item_batch_management === 1) {
        this.display("sa_item_balance.table_item_balance.batch_id");

        db.collection("item_batch_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_batch_balance", response.data);
            let itemBalanceData = response.data;

            if (previousBalanceData && previousBalanceData.length > 0) {
              itemBalanceData = previousBalanceData;
            }

            const filteredData = filterZeroQuantityRecords(itemBalanceData);
            console.log("filteredData", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
            }
          })
          .catch((error) => {
            console.error("Error fetching item balance data:", error);
          });
      } else {
        this.hide("sa_item_balance.table_item_balance.batch_id");

        db.collection("item_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_balance", response.data);
            let itemBalanceData = response.data;

            if (previousBalanceData && previousBalanceData.length > 0) {
              itemBalanceData = previousBalanceData;
            }

            const filteredData = filterZeroQuantityRecords(itemBalanceData);
            console.log("filteredData", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
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
}
