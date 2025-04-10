this.openDialog("confirm_inventory");

const data = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
console.log("lineItemData", lineItemData);

if (!lineItemData || !lineItemData.material_id) {
  console.error("Invalid line item data or missing material ID");
  return;
}

const materialId = lineItemData.material_id;
const tempQtyData = lineItemData.temp_qty_data;

db.collection("item")
  .where({
    id: materialId,
  })
  .get()
  .then((response) => {
    console.log("response item", response);

    if (!response.data || !response.data.length) {
      console.error("Item not found for material ID:", materialId);
      return;
    }

    const itemData = response.data[0];

    this.setData({
      [`confirm_inventory.material_id`]: materialId,
      [`confirm_inventory.material_name`]: itemData.material_name || materialId,
      [`confirm_inventory.received_qty`]: lineItemData.received_qty,
      [`confirm_inventory.row_index`]: rowIndex,
    });

    this.setData({
      [`confirm_inventory.table_item_balance`]: [],
    });

    if (lineItemData.batch_id || itemData.item_batch_management === 1) {
      this.display("confirm_inventory.table_item_balance.batch_id");

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response);

          // Process tempQtyData or use queried data
          if (tempQtyData) {
            try {
              const tempQtyDataArray = JSON.parse(tempQtyData);
              this.setData({
                [`confirm_inventory.table_item_balance`]: tempQtyDataArray,
              });
            } catch (error) {
              console.error("Error parsing tempQtyData:", error);
              this.setData({
                [`confirm_inventory.table_item_balance`]: response.data || [],
              });
            }
          } else {
            // If no batch balance records found but we know there's a batch_id
            if (
              (!response.data || !response.data.length) &&
              lineItemData.batch_id
            ) {
              const newItemBalanceTable = [
                {
                  batch_id: lineItemData.batch_id,
                  location_id: lineItemData.location_id,
                  balance_quantity: lineItemData.balance_quantity || 0,
                },
              ];
              this.setData({
                [`confirm_inventory.table_item_balance`]: newItemBalanceTable,
              });
            } else {
              this.setData({
                [`confirm_inventory.table_item_balance`]: response.data || [],
              });
            }
          }
        })
        .catch((error) => {
          console.error("Error fetching item batch balance data:", error);
        });
    } else {
      this.hide("confirm_inventory.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response);

          // Process tempQtyData or use queried data
          if (tempQtyData) {
            try {
              const tempQtyDataArray = JSON.parse(tempQtyData);
              this.setData({
                [`confirm_inventory.table_item_balance`]: tempQtyDataArray,
              });
            } catch (error) {
              console.error("Error parsing tempQtyData:", error);
              this.setData({
                [`confirm_inventory.table_item_balance`]: response.data || [],
              });
            }
          } else {
            this.setData({
              [`confirm_inventory.table_item_balance`]: response.data || [],
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

window.validationState = {};
const rowCount = data.confirm_inventory.table_item_balance.length;
for (let i = 0; i < rowCount; i++) {
  window.validationState[i] = true;
}
