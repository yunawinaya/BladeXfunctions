const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;

console.log("lineItemData", lineItemData);

const materialId = lineItemData.material_id;

const tempQtyData = lineItemData.temp_qty_data;

setTimeout(() => {
  this.setData({
    [`confirm_inventory.table_item_balance`]: [],
  });

  if (lineItemData.batch_id) {
    setTimeout(() => {
      this.display("confirm_inventory.table_item_balance.batch_id");

      const newItemBalanceTable = [
        {
          batch_id: lineItemData.batch_id,
          location_id: lineItemData.location_id,
          balance_quantity: lineItemData.balance_quantity,
        },
      ];

      this.setData({
        [`confirm_inventory.material_id`]: materialId,
        [`confirm_inventory.material_name`]: materialId,
        [`confirm_inventory.received_qty`]: lineItemData.received_qty,
        [`confirm_inventory.row_index`]: rowIndex,
      });

      if (tempQtyData) {
        const tempQtyDataArray = JSON.parse(tempQtyData);
        this.setData({
          [`confirm_inventory.table_item_balance`]: tempQtyDataArray,
        });
      } else {
        this.setData({
          [`confirm_inventory.table_item_balance`]: newItemBalanceTable,
        });
      }
    }, 100);
  } else {
    setTimeout(() => {
      this.hide("confirm_inventory.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({ material_id: materialId })
        .get()
        .then((response) => {
          console.log("response item_balance", response);
          const itemBalanceData = response.data;

          if (
            itemBalanceData &&
            Array.isArray(itemBalanceData) &&
            itemBalanceData.length > 0
          ) {
            const itemBalance = itemBalanceData.map((item) => {
              return {
                location_id: item.location_id,
                balance_quantity: item.balance_quantity,
              };
            });

            this.setData({
              [`confirm_inventory.material_id`]: materialId,
              [`confirm_inventory.material_name`]: materialId,
              [`confirm_inventory.received_qty`]: lineItemData.received_qty,
              [`confirm_inventory.row_index`]: rowIndex,
            });

            if (tempQtyData) {
              const tempQtyDataArray = JSON.parse(tempQtyData);
              this.setData({
                [`confirm_inventory.table_item_balance`]: tempQtyDataArray,
              });
            } else {
              this.setData({
                [`confirm_inventory.table_item_balance`]: itemBalance,
              });
            }
          }
        })
        .catch((error) => {
          console.error("Error fetching item balance:", error);
        });
    }, 100);
  }
}, 100);
