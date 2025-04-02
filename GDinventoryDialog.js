const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;

console.log("lineItemData", lineItemData);

const materialId = lineItemData.material_id;

const tempQtyData = lineItemData.temp_qty_data;

db.collection("Item")
  .where({
    id: materialId,
  })
  .get()
  .then((response) => {
    console.log("response item", response);
    const itemData = response.data[0];

    this.setData({
      [`gd_item_balance.material_code`]: itemData.material_code,
      [`gd_item_balance.material_name`]: itemData.material_name,
      [`gd_item_balance.row_index`]: rowIndex,
    });

    this.setData({
      [`gd_item_balance.table_item_balance`]: [],
    });

    if (itemData.item_batch_management === 1) {
      this.display("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response);
          const itemBalanceData = response.data;

          if (tempQtyData) {
            const tempQtyDataArray = JSON.parse(tempQtyData);
            this.setData({
              [`gd_item_balance.table_item_balance`]: tempQtyDataArray,
            });
          } else {
            this.setData({
              [`gd_item_balance.table_item_balance`]: itemBalanceData,
            });
          }
        })
        .catch((error) => {
          console.error("Error fetching item balance data:", error);
        });
    } else {
      this.hide("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response);
          const itemBalanceData = response.data;

          if (tempQtyData) {
            const tempQtyDataArray = JSON.parse(tempQtyData);
            this.setData({
              [`gd_item_balance.table_item_balance`]: tempQtyDataArray,
            });
          } else {
            this.setData({
              [`gd_item_balance.table_item_balance`]: itemBalanceData,
            });
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
