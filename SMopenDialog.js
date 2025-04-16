const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const movement_type = allData.movement_type;
const plant_id = allData.issuing_operation_faci;
const materialId = lineItemData.item_selection;
const tempQtyData = lineItemData.temp_qty_data;
console.log("movement_type", materialId);

// First, get the movement type details
db.collection("stock_movement_type")
  .where({
    id: movement_type,
  })
  .get()
  .then((result) => {
    console.log("movement type", result.data[0].sm_type_name);
    const movementTypeName = result.data[0].sm_type_name;

    // Show/hide category columns based on movement type
    if (movementTypeName === "Inventory Category Transfer Posting") {
      this.display("sm_item_balance.table_item_balance.category_from");
      this.display("sm_item_balance.table_item_balance.category_to");
      this.hide("sm_item_balance.table_item_balance.category");
    } else {
      this.hide("sm_item_balance.table_item_balance.category_from");
      this.hide("sm_item_balance.table_item_balance.category_to");
    }

    // Fetch item data
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
          [`sm_item_balance.material_id`]: itemData.material_code,
          [`sm_item_balance.material_name`]: itemData.material_name,
          [`sm_item_balance.row_index`]: rowIndex,
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

              // Map the id from item_batch_balance to balance_id
              const mappedData = Array.isArray(itemBalanceData)
                ? itemBalanceData.map((item) => ({
                    ...item,
                    balance_id: item.id,
                  }))
                : [{ ...itemBalanceData, balance_id: itemBalanceData.id }];

              if (tempQtyData) {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                this.setData({
                  [`sm_item_balance.table_item_balance`]: tempQtyDataArray,
                });
              } else {
                this.setData({
                  [`sm_item_balance.table_item_balance`]: mappedData,
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

              // Map the id from item_balance to balance_id
              const mappedData = Array.isArray(itemBalanceData)
                ? itemBalanceData.map((item) => ({
                    ...item,
                    balance_id: item.id,
                  }))
                : [{ ...itemBalanceData, balance_id: itemBalanceData.id }];

              if (tempQtyData) {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                this.setData({
                  [`sm_item_balance.table_item_balance`]: tempQtyDataArray,
                  [`sm_item_balance.table_item_balance.unit_price`]:
                    itemData.purchase_unit_price,
                });
              } else {
                this.setData({
                  [`sm_item_balance.table_item_balance`]: mappedData,
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
  })
  .catch((error) => {
    console.error("Error fetching movement type:", error);
  });
