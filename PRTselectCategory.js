const data = this.getValues();
const lineItemData = arguments[0]?.row;
const categoryValue = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;

console.log("lineItemData", lineItemData);

const materialId = data.confirm_inventory.material_id;

if (lineItemData.batch_id) {
  db.collection("item_batch_balance")
    .where({
      material_id: materialId,
      batch_id: lineItemData.batch_id,
      location_id: lineItemData.location_id,
    })
    .get()
    .then((response) => {
      console.log("response item_batch_balance", response);

      // Check if response.data exists and is an array with items
      if (
        response &&
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
        const itemBalanceData = response.data[0];
        console.log("Item batch balance data:", itemBalanceData);
        console.log("categoryValue", categoryValue);

        // Now set the data based on category
        switch (categoryValue) {
          case "QIP":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.qualityinsp_qty,
            });
            break;
          case "UNR":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.unrestricted_qty,
            });
            break;
          case "RES":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.reserved_qty,
            });
            break;
          case "BLK":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.block_qty,
            });
            break;
        }
      } else {
        console.log("No item batch balance data found");
      }
    })
    .catch((error) => {
      console.error("Error fetching item batch balance:", error);
    });
} else {
  db.collection("item_balance")
    .where({ material_id: materialId, location_id: lineItemData.location_id })
    .get()
    .then((response) => {
      console.log("response item_balance", response);

      // Check if response.data exists and is an array with items
      if (
        response &&
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
        const itemBalanceData = response.data[0];
        console.log("Item balance data:", itemBalanceData);

        // Now set the data based on category
        switch (categoryValue) {
          case "QIP":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.qualityinsp_qty,
            });
            break;
          case "UNR":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.unrestricted_qty,
            });
            break;
          case "RES":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.reserved_qty,
            });
            break;
          case "BLK":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.block_qty,
            });
            break;
        }
      } else {
        console.log("No item balance data found");
      }
    })
    .catch((error) => {
      console.error("Error fetching item balance:", error);
    });
}
