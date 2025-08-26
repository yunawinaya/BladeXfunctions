(async () => {
  await this.openDialog("confirm_inventory");
  const data = this.getValues();
  const lineItemData = arguments[0]?.row;
  const rowIndex = arguments[0]?.rowIndex;
  const batchId = arguments[0]?.row.batch_id;

  console.log("lineItemData", lineItemData);

  if (!lineItemData || !lineItemData.material_id) {
    console.error("Invalid line item data or missing material ID");
    return;
  }

  const materialId = lineItemData.material_id;
  const tempQtyData = lineItemData.temp_qty_data;

  // Helper function to merge tempQtyDataArray into response.data
  const mergeData = (responseData, tempQtyDataArray, key) => {
    if (!tempQtyDataArray || !Array.isArray(tempQtyDataArray)) {
      return responseData || [];
    }

    const mergedData = [...(responseData || [])];

    tempQtyDataArray.forEach((tempItem) => {
      const matchIndex = mergedData.findIndex(
        (item) => item[key] === tempItem[key]
      );
      if (matchIndex !== -1) {
        // Update existing record with tempQtyData
        mergedData[matchIndex] = { ...mergedData[matchIndex], ...tempItem };
      } else {
        // Optionally append new record (remove this if you don't want to add unmatched items)
        mergedData.push(tempItem);
      }
    });

    return mergedData;
  };

  db.collection("Item")
    .where({ id: materialId })
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
        [`confirm_inventory.material_name`]: materialId,
        [`confirm_inventory.received_qty`]:
          lineItemData.received_qty - lineItemData.returned_quantity,
        [`confirm_inventory.row_index`]: rowIndex,
      });

      this.setData({
        [`confirm_inventory.table_item_balance`]: [],
      });

      if (itemData.item_batch_management === 1) {
        this.display("confirm_inventory.table_item_balance.batch_id");

        db.collection("item_batch_balance")
          .where({
            material_id: materialId,
          })
          .get()
          .then((response) => {
            console.log("response item_batch_balance", response);

            let tableData = [];
            // Process tempQtyData or use queried data
            if (tempQtyData) {
              try {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                tableData = mergeData(
                  response.data,
                  tempQtyDataArray,
                  "batch_id"
                );
              } catch (error) {
                console.error("Error parsing tempQtyData:", error);
                tableData = response.data || [];
              }
            } else {
              tableData = response.data || [];
            }

            this.setData({
              [`confirm_inventory.table_item_balance`]: tableData.filter(
                (item) => item.batch_id !== batchId
              ),
            });
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

            let tableData = [];
            // Process tempQtyData or use queried data
            if (tempQtyData) {
              try {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                tableData = mergeData(
                  response.data,
                  tempQtyDataArray,
                  "location_id"
                );
              } catch (error) {
                console.error("Error parsing tempQtyData:", error);
                tableData = response.data || [];
              }
            } else {
              tableData = response.data || [];
            }

            this.setData({
              [`confirm_inventory.table_item_balance`]: tableData,
            });
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
})();
