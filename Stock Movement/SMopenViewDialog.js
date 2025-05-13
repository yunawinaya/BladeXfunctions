const allData = this.getValues(); // Fetch form/state data
const lineItemData = arguments[0]?.row; // Row data from arguments (e.g., table row)
const rowIndex = arguments[0]?.rowIndex; // Row index from arguments
const movement_type = allData.movement_type; // Movement type ID
const materialId = lineItemData.item_selection; // Material ID from selection
const tempQtyData = lineItemData.temp_qty_data; // Temporary quantity data (unused here but included)
const plant_id = allData.issuing_operation_faci;

const movementTypeName = movement_type;

// Show/hide and disable category columns based on movement type
if (movementTypeName === "Inventory Category Transfer Posting") {
  this.display("sm_item_balance.table_item_balance.category_from");
  this.disabled("sm_item_balance.table_item_balance.category_from", true);
  this.display("sm_item_balance.table_item_balance.category_to");
  this.disabled("sm_item_balance.table_item_balance.category_to", true);
  this.hide("sm_item_balance.table_item_balance.category");
} else {
  this.hide("sm_item_balance.table_item_balance.category_from");
  this.hide("sm_item_balance.table_item_balance.category_to");
  this.display("sm_item_balance.table_item_balance.category");
}

// Step 2: Fetch item data
db.collection("Item")
  .where({
    id: materialId,
  })
  .get()
  .then((response) => {
    if (!response.data || response.data.length === 0) {
      console.error("No item found for material ID:", materialId);
      return;
    }

    console.log("response item", response);
    const itemData = response.data[0]; // itemData is defined here
    console.log("itemData", itemData);

    // Set item data and disable fields
    this.setData({
      [`sm_item_balance.material_id`]: itemData.material_code,
      [`sm_item_balance.material_name`]: itemData.material_name,
      [`sm_item_balance.row_index`]: rowIndex,
    });
    this.disabled("sm_item_balance.material_id", true);
    this.disabled("sm_item_balance.material_name", true);
    this.disabled("sm_item_balance.row_index", true);

    // Step 3: Handle batch vs. non-batch logic
    if (itemData.item_batch_management == 1) {
      // Batch-managed item
      this.display("sm_item_balance.table_item_balance.batch_id");
      this.disabled("sm_item_balance.table_item_balance.batch_id", true);

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
          plant_id: plant_id,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response.data);
          const itemBalanceData = response.data || [];

          const mappedData = Array.isArray(itemBalanceData)
            ? itemBalanceData.map((item) => {
                const mappedItem = {
                  ...item,
                  balance_id: item.id,
                  sm_quantity: 0,
                };

                if (
                  allData.balance_index &&
                  Array.isArray(allData.balance_index)
                ) {
                  const matchingBalanceItem = allData.balance_index.find(
                    (balanceItem) => balanceItem.balance_id === item.id
                  );

                  if (matchingBalanceItem) {
                    mappedItem.sm_quantity =
                      matchingBalanceItem.sm_quantity || 0;
                    if (matchingBalanceItem.category) {
                      mappedItem.category = matchingBalanceItem.category;
                    }
                    if (matchingBalanceItem.category_from) {
                      mappedItem.category_from =
                        matchingBalanceItem.category_from;
                    }
                    if (matchingBalanceItem.category_to) {
                      mappedItem.category_to = matchingBalanceItem.category_to;
                    }
                    if (matchingBalanceItem.balance_id) {
                      mappedItem.balance_id = matchingBalanceItem.balance_id;
                    }
                    if (matchingBalanceItem.material_id) {
                      mappedItem.material_id = matchingBalanceItem.material_id;
                    }
                  }
                }

                return mappedItem;
              })
            : [];

          this.setData({
            [`sm_item_balance.table_item_balance`]: mappedData,
          });

          // Disable the entire table for view mode
          this.disabled([`sm_item_balance.table_item_balance`], true);
        })
        .catch((error) => {
          console.error("Error fetching item batch balance data:", error);
        });
    } else {
      // Non-batch-managed item
      this.hide("sm_item_balance.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
          plant_id: plant_id,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response.data);
          const itemBalanceData = response.data || [];

          const mappedData = Array.isArray(itemBalanceData)
            ? itemBalanceData.map((item) => {
                const mappedItem = {
                  ...item,
                  balance_id: item.id,
                  sm_quantity: 0,
                };

                if (
                  allData.balance_index &&
                  Array.isArray(allData.balance_index)
                ) {
                  const matchingBalanceItem = allData.balance_index.find(
                    (balanceItem) => balanceItem.balance_id === item.id
                  );

                  if (matchingBalanceItem) {
                    mappedItem.sm_quantity =
                      matchingBalanceItem.sm_quantity || 0;
                    if (matchingBalanceItem.category) {
                      mappedItem.category = matchingBalanceItem.category;
                    }
                    if (matchingBalanceItem.category_from) {
                      mappedItem.category_from =
                        matchingBalanceItem.category_from;
                    }
                    if (matchingBalanceItem.category_to) {
                      mappedItem.category_to = matchingBalanceItem.category_to;
                    }
                    if (matchingBalanceItem.balance_id) {
                      mappedItem.balance_id = matchingBalanceItem.balance_id;
                    }
                    if (matchingBalanceItem.material_id) {
                      mappedItem.material_id = matchingBalanceItem.material_id;
                    }
                  }
                }

                return mappedItem;
              })
            : [];

          this.setData({
            [`sm_item_balance.table_item_balance`]: mappedData,
            [`sm_item_balance.table_item_balance.unit_price`]:
              itemData.purchase_unit_price,
          });

          // Disable the entire table for view mode
          this.disabled([`sm_item_balance.table_item_balance`], true);
          this.disabled("sm_item_balance.table_item_balance.unit_price", true);
        })
        .catch((error) => {
          console.error("Error fetching item balance data:", error);
        });
    }
  })
  .catch((error) => {
    console.error("Error fetching item data:", error);
  });
