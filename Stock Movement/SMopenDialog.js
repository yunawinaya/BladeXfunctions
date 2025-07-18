const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const movement_type = allData.movement_type;
const plant_id = allData.issuing_operation_faci;
const materialId = lineItemData.item_selection;
const tempQtyData = lineItemData.temp_qty_data;

console.log("materialId", materialId);

const movementTypeName = movement_type;

// Show/hide category columns based on movement type
if (movementTypeName === "Inventory Category Transfer Posting") {
  this.display("sm_item_balance.table_item_balance.category_from");
  this.display("sm_item_balance.table_item_balance.category_to");
  this.hide("sm_item_balance.table_item_balance.category");
} else {
  this.hide("sm_item_balance.table_item_balance.category_from");
  this.hide("sm_item_balance.table_item_balance.category_to");
}

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

// Fetch item data
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
        sm_item_balance: {
          material_id: itemData.material_code,
          material_name: itemData.material_name,
          row_index: rowIndex,
        },
      });

      if (itemData.item_batch_management === 1) {
        this.display("sm_item_balance.table_item_balance.batch_id");

        db.collection("item_batch_balance")
          .where({
            material_id: materialId,
            plant_id: plant_id,
          })
          .get()
          .then((response) => {
            console.log("response item_batch_balance", response.data);
            console.log("material", materialId);
            const itemBalanceData = response.data;

            // Map the data and remove the original id to prevent duplicate key errors
            const mappedData = Array.isArray(itemBalanceData)
              ? itemBalanceData.map((item) => {
                  const { id, ...itemWithoutId } = item; // Remove original id
                  return {
                    ...itemWithoutId,
                    balance_id: id, // Keep balance_id for reference
                  };
                })
              : (() => {
                  const { id, ...itemWithoutId } = itemBalanceData;
                  return { ...itemWithoutId, balance_id: id };
                })();

            const filteredData = filterZeroQuantityRecords(mappedData);
            console.log("filteredData", filteredData);

            if (tempQtyData) {
              const tempQtyDataArray = JSON.parse(tempQtyData);
              this.setData({
                [`sm_item_balance.table_item_balance`]: tempQtyDataArray,
              });
            } else {
              this.setData({
                [`sm_item_balance.table_item_balance`]: filteredData,
              });
            }
          })
          .catch((error) => {
            console.error("Error fetching item batch balance data:", error);
          });
      } else {
        this.hide("sm_item_balance.table_item_balance.batch_id");

        db.collection("item_balance")
          .where({
            material_id: materialId,
            plant_id: plant_id,
          })
          .get()
          .then((response) => {
            console.log("response item_balance", response.data);
            const itemBalanceData = response.data;

            // Map the data and remove the original id to prevent duplicate key errors
            const mappedData = Array.isArray(itemBalanceData)
              ? itemBalanceData.map((item) => {
                  const { id, ...itemWithoutId } = item; // Remove original id
                  return {
                    ...itemWithoutId,
                    balance_id: id, // Keep balance_id for reference
                  };
                })
              : (() => {
                  const { id, ...itemWithoutId } = itemBalanceData;
                  return { ...itemWithoutId, balance_id: id };
                })();

            const filteredData = filterZeroQuantityRecords(mappedData);
            console.log("filteredData", filteredData);

            if (tempQtyData) {
              const tempQtyDataArray = JSON.parse(tempQtyData);
              this.setData({
                [`sm_item_balance.table_item_balance`]: tempQtyDataArray,
                [`sm_item_balance.table_item_balance.unit_price`]:
                  itemData.purchase_unit_price,
              });
            } else {
              this.setData({
                [`sm_item_balance.table_item_balance`]: filteredData,
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
}

this.setData({
  [`sm_item_balance.table_item_balance.category`]: undefined,
});
