const data = this.getValues();
const rowIndex = arguments[0]?.rowIndex;
const lineItemData = data.table_gd[rowIndex];

console.log("lineItemData", lineItemData);

const materialId = lineItemData.material_id;
const altUOM = lineItemData.gd_order_uom_id;
const plantId = data.plant_id;

const tempQtyData = lineItemData.temp_qty_data;

// Helper function to calculate allocated quantities from other line items
const calculateAllocatedQuantitiesFromOtherRows = (
  materialId,
  currentRowIndex,
  tableGdData
) => {
  const allocatedQuantities = new Map(); // Key: location_id or location_id-batch_id, Value: allocated quantity

  if (!tableGdData || !Array.isArray(tableGdData)) {
    console.log("No table_gd data found");
    return allocatedQuantities;
  }

  console.log("Calculating allocated quantities from other rows...");

  tableGdData.forEach((row, index) => {
    // Skip current row and rows with different material_id
    if (index === currentRowIndex || row.material_id !== materialId) {
      return;
    }

    // Parse temp_qty_data from other rows
    if (row.temp_qty_data) {
      try {
        const otherRowTempData = JSON.parse(row.temp_qty_data);
        if (Array.isArray(otherRowTempData)) {
          otherRowTempData.forEach((tempItem) => {
            if (tempItem.gd_quantity && tempItem.gd_quantity > 0) {
              // Create key based on whether item is batch managed
              const key = tempItem.batch_id
                ? `${tempItem.location_id}-${tempItem.batch_id}`
                : `${tempItem.location_id}`;

              const currentAllocated = allocatedQuantities.get(key) || 0;
              allocatedQuantities.set(
                key,
                currentAllocated + tempItem.gd_quantity
              );

              console.log(
                `Row ${index}: Found allocation for ${key} = ${tempItem.gd_quantity}`
              );
            }
          });
        }
      } catch (error) {
        console.error(`Error parsing temp_qty_data for row ${index}:`, error);
      }
    }
  });

  console.log(
    "Total allocated quantities from other rows:",
    Object.fromEntries(allocatedQuantities)
  );
  return allocatedQuantities;
};

db.collection("Item")
  .where({
    id: materialId,
  })
  .get()
  .then((response) => {
    console.log("response item", response);
    const itemData = response.data[0];
    const baseUOM = itemData.based_uom;

    this.setData({
      [`gd_item_balance.material_code`]: itemData.material_code,
      [`gd_item_balance.material_name`]: itemData.material_name,
      [`gd_item_balance.row_index`]: rowIndex,
      [`gd_item_balance.material_uom`]: altUOM,
    });

    this.setData({
      [`gd_item_balance.table_item_balance`]: [],
    });

    const convertBaseToAlt = (baseQty, itemData, altUOM) => {
      if (
        !Array.isArray(itemData.table_uom_conversion) ||
        itemData.table_uom_conversion.length === 0 ||
        !altUOM
      ) {
        return baseQty;
      }

      const uomConversion = itemData.table_uom_conversion.find(
        (conv) => conv.alt_uom_id === altUOM
      );

      if (!uomConversion || !uomConversion.base_qty) {
        return baseQty;
      }

      return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
    };

    const processItemBalanceData = (itemBalanceData) => {
      return itemBalanceData.map((record) => {
        const processedRecord = { ...record };

        if (altUOM !== baseUOM) {
          if (processedRecord.block_qty) {
            processedRecord.block_qty = convertBaseToAlt(
              processedRecord.block_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.reserved_qty) {
            processedRecord.reserved_qty = convertBaseToAlt(
              processedRecord.reserved_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.unrestricted_qty) {
            processedRecord.unrestricted_qty = convertBaseToAlt(
              processedRecord.unrestricted_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.qualityinsp_qty) {
            processedRecord.qualityinsp_qty = convertBaseToAlt(
              processedRecord.qualityinsp_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.intransit_qty) {
            processedRecord.intransit_qty = convertBaseToAlt(
              processedRecord.intransit_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.balance_quantity) {
            processedRecord.balance_quantity = convertBaseToAlt(
              processedRecord.balance_quantity,
              itemData,
              altUOM
            );
          }
        }

        return processedRecord;
      });
    };

    const mergeWithTempData = (
      freshDbData,
      tempDataArray,
      allocatedFromOtherRows
    ) => {
      if (!tempDataArray || tempDataArray.length === 0) {
        console.log(
          "No temp data to merge, using fresh DB data with cross-row adjustments"
        );

        // Apply cross-row adjustments even when no temp data
        return freshDbData.map((dbItem) => {
          const key =
            itemData.item_batch_management === 1
              ? `${dbItem.location_id}-${dbItem.batch_id || "no_batch"}`
              : `${dbItem.location_id}`;

          const allocatedFromOthers = allocatedFromOtherRows.get(key) || 0;
          const adjustedUnrestrictedQty = Math.max(
            0,
            (dbItem.unrestricted_qty || 0) - allocatedFromOthers
          );

          console.log(
            `Location ${key}: Original=${dbItem.unrestricted_qty}, Allocated by others=${allocatedFromOthers}, Available=${adjustedUnrestrictedQty}`
          );

          return {
            ...dbItem,
            unrestricted_qty: adjustedUnrestrictedQty,
            gd_quantity: 0,
          };
        });
      }

      console.log(
        "Merging fresh DB data with existing temp data and cross-row adjustments"
      );

      const tempDataMap = new Map();
      tempDataArray.forEach((tempItem) => {
        const key =
          itemData.item_batch_management === 1
            ? `${tempItem.location_id}-${tempItem.batch_id || "no_batch"}`
            : `${tempItem.location_id}`;
        tempDataMap.set(key, tempItem);
      });

      const mergedData = freshDbData.map((dbItem) => {
        const key =
          itemData.item_batch_management === 1
            ? `${dbItem.location_id}-${dbItem.batch_id || "no_batch"}`
            : `${dbItem.location_id}`;

        const tempItem = tempDataMap.get(key);
        const allocatedFromOthers = allocatedFromOtherRows.get(key) || 0;

        // Calculate available quantity after subtracting allocations from other rows
        const originalUnrestrictedQty = dbItem.unrestricted_qty || 0;
        const adjustedUnrestrictedQty = Math.max(
          0,
          originalUnrestrictedQty - allocatedFromOthers
        );

        console.log(
          `Location ${key}: Original=${originalUnrestrictedQty}, Allocated by others=${allocatedFromOthers}, Available=${adjustedUnrestrictedQty}`
        );

        if (tempItem) {
          console.log(
            `Merging data for ${key}: DB unrestricted=${adjustedUnrestrictedQty}, temp gd_quantity=${tempItem.gd_quantity}`
          );
          return {
            ...dbItem,
            unrestricted_qty: adjustedUnrestrictedQty,
            gd_quantity: tempItem.gd_quantity,
            remarks: tempItem.remarks || dbItem.remarks,
          };
        } else {
          return {
            ...dbItem,
            unrestricted_qty: adjustedUnrestrictedQty,
            gd_quantity: 0,
          };
        }
      });

      // Add temp-only items (items that exist in temp but not in DB)
      tempDataArray.forEach((tempItem) => {
        const key =
          itemData.item_batch_management === 1
            ? `${tempItem.location_id}-${tempItem.batch_id || "no_batch"}`
            : `${tempItem.location_id}`;

        const existsInDb = freshDbData.some((dbItem) => {
          const dbKey =
            itemData.item_batch_management === 1
              ? `${dbItem.location_id}-${dbItem.batch_id || "no_batch"}`
              : `${dbItem.location_id}`;
          return dbKey === key;
        });

        if (!existsInDb) {
          console.log(`Adding temp-only data for ${key}`);
          // For temp-only items, we don't adjust quantities since they're not in the main DB
          mergedData.push(tempItem);
        }
      });

      return mergedData;
    };

    // Calculate quantities already allocated by other line items
    const allocatedFromOtherRows = calculateAllocatedQuantitiesFromOtherRows(
      materialId,
      rowIndex,
      data.table_gd
    );

    if (itemData.item_batch_management === 1) {
      this.display("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
          plant_id: plantId,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response);
          let freshDbData = response.data || [];

          const processedFreshData = processItemBalanceData(freshDbData);

          let tempDataArray = [];
          if (tempQtyData) {
            try {
              tempDataArray = JSON.parse(tempQtyData);
              console.log("Parsed temp data:", tempDataArray);
            } catch (error) {
              console.error("Error parsing temp_qty_data:", error);
              tempDataArray = [];
            }
          }

          const finalData = mergeWithTempData(
            processedFreshData,
            tempDataArray,
            allocatedFromOtherRows
          );

          console.log("Final merged data:", finalData);

          this.setData({
            [`gd_item_balance.table_item_balance`]: finalData,
          });
        })
        .catch((error) => {
          console.error("Error fetching item batch balance data:", error);
        });
    } else {
      this.hide("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
          plant_id: plantId,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response);
          let freshDbData = response.data || [];

          const processedFreshData = processItemBalanceData(freshDbData);

          let tempDataArray = [];
          if (tempQtyData) {
            try {
              tempDataArray = JSON.parse(tempQtyData);
              console.log("Parsed temp data:", tempDataArray);
            } catch (error) {
              console.error("Error parsing temp_qty_data:", error);
              tempDataArray = [];
            }
          }

          const finalData = mergeWithTempData(
            processedFreshData,
            tempDataArray,
            allocatedFromOtherRows
          );

          console.log("Final merged data:", finalData);

          this.setData({
            [`gd_item_balance.table_item_balance`]: finalData,
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

setTimeout(() => {
  const currentData = this.getValues();
  const rowCount = currentData.gd_item_balance?.table_item_balance?.length || 0;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
  console.log(`Initialized validation state for ${rowCount} rows`);
}, 100);
