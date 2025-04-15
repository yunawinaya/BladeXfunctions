const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const adjustment_type = allData.adjustment_type;
const materialId = lineItemData.material_id;
const plantId = allData.plant_id;

// Proceed with original queries if no tempQtyData
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
    });

    const previousBalanceData = allData.sa_item_balance.table_item_balance;

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

          this.setData({
            [`sa_item_balance.table_item_balance`]: itemBalanceData,
          });

          if (adjustment_type === "Write Off") {
            this.hide("sa_item_balance.table_item_balance.unit_price");
            this.setData({
              [`sa_item_balance.table_item_balance.movement_type`]: "Out",
            });
            this.hide("sa_item_balance.table_item_balance.movement_type");
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
          const itemBalanceData = response.data;

          if (previousBalanceData && previousBalanceData.length > 0) {
            itemBalanceData = previousBalanceData;
          }

          this.setData({
            [`sa_item_balance.table_item_balance`]: itemBalanceData,
            [`sa_item_balance.table_item_balance.unit_price`]:
              itemData.purchase_unit_price,
          });

          if (adjustment_type === "Write Off") {
            this.hide("sa_item_balance.table_item_balance.unit_price");
            this.setData({
              [`sa_item_balance.table_item_balance.movement_type`]: "Out",
            });
            this.hide("sa_item_balance.table_item_balance.movement_type");
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
