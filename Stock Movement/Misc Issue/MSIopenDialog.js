const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const movement_type = allData.movement_type;
const plant_id = allData.issuing_operation_faci;
const materialId = lineItemData.item_selection;
const tempQtyData = lineItemData.temp_qty_data;
const quantityUOM = lineItemData.quantity_uom;

console.log("materialId", materialId);

const fetchUomData = async (uomIds) => {
  if (!uomIds || uomIds.length === 0) return [];

  try {
    const resUOM = await Promise.all(
      uomIds.map((id) =>
        db.collection("unit_of_measurement").where({ id }).get(),
      ),
    );

    return resUOM.map((response) => response.data[0]).filter(Boolean);
  } catch (error) {
    console.error("Error fetching UOM data:", error);
    return [];
  }
};

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

// Initially hide serial number column
this.hide("sm_item_balance.table_item_balance.serial_number");

const filterZeroQuantityRecords = (data, itemData) => {
  return data.filter((record) => {
    // For serialized items, check both serial number existence AND quantity > 0
    if (itemData.serial_number_management === 1) {
      // First check if serial number exists and is not empty
      const hasValidSerial =
        record.serial_number && record.serial_number.trim() !== "";

      if (!hasValidSerial) {
        return false; // Exclude if no valid serial number
      }

      // Then check if any quantity fields have value > 0
      const hasQuantity =
        (record.block_qty && record.block_qty > 0) ||
        (record.reserved_qty && record.reserved_qty > 0) ||
        (record.unrestricted_qty && record.unrestricted_qty > 0) ||
        (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
        (record.intransit_qty && record.intransit_qty > 0) ||
        (record.balance_quantity && record.balance_quantity > 0);

      console.log(
        `Serial ${record.serial_number}: hasQuantity=${hasQuantity}, unrestricted=${record.unrestricted_qty}, reserved=${record.reserved_qty}, balance=${record.balance_quantity}`,
      );

      return hasQuantity; // Only include if both serial exists AND has quantity > 0
    }

    // For batch and regular items, check if any quantity fields have value > 0
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

const mergeWithTempData = (freshDbData, tempDataArray, itemData) => {
  if (!tempDataArray || tempDataArray.length === 0) {
    console.log("No temp data to merge, using fresh DB data");
    return freshDbData;
  }

  console.log("Merging fresh DB data with existing temp data");

  const tempDataMap = new Map();
  tempDataArray.forEach((tempItem) => {
    let key;
    if (itemData.serial_number_management === 1) {
      // For serialized items, always use serial number as primary key
      // Include batch_id if item also has batch management
      if (itemData.item_batch_management === 1) {
        key = `${tempItem.location_id || "no_location"}-${
          tempItem.serial_number || "no_serial"
        }-${tempItem.batch_id || "no_batch"}`;
      } else {
        key = `${tempItem.location_id || "no_location"}-${
          tempItem.serial_number || "no_serial"
        }`;
      }
    } else if (
      itemData.serial_number_management !== 1 &&
      itemData.item_batch_management === 1
    ) {
      // For batch items (non-serialized), use batch as key
      key = `${tempItem.location_id || "no_location"}-${
        tempItem.batch_id || "no_batch"
      }`;
    } else {
      // For regular items, use only location or balance_id
      key = `${tempItem.location_id || tempItem.balance_id || "no_key"}`;
    }
    tempDataMap.set(key, tempItem);
  });

  const mergedData = freshDbData.map((dbItem) => {
    let key;
    if (itemData.serial_number_management === 1) {
      // For serialized items, always use serial number as primary key
      // Include batch_id if item also has batch management
      if (itemData.item_batch_management === 1) {
        key = `${dbItem.location_id || "no_location"}-${
          dbItem.serial_number || "no_serial"
        }-${dbItem.batch_id || "no_batch"}`;
      } else {
        key = `${dbItem.location_id || "no_location"}-${
          dbItem.serial_number || "no_serial"
        }`;
      }
    } else if (
      itemData.serial_number_management !== 1 &&
      itemData.item_batch_management === 1
    ) {
      key = `${dbItem.location_id || "no_location"}-${
        dbItem.batch_id || "no_batch"
      }`;
    } else {
      key = `${dbItem.location_id || dbItem.balance_id || "no_key"}`;
    }

    const tempItem = tempDataMap.get(key);

    if (tempItem) {
      console.log(
        `Merging data for ${key}: DB unrestricted=${dbItem.unrestricted_qty}, temp data merged`,
      );

      // Merge all relevant fields from temp data, preserving temp modifications
      return {
        ...dbItem, // Start with DB data as base
        ...tempItem, // Override with temp data (this preserves all temp modifications)
        // Ensure critical DB fields are not overwritten if they shouldn't be
        id: dbItem.id, // Keep original DB id
        balance_id: dbItem.id, // Keep balance_id reference to original
        // Preserve temp-specific fields that don't exist in DB
        fm_key: tempItem.fm_key,
        category: tempItem.category,
        sm_quantity: tempItem.sm_quantity,
        remarks: tempItem.remarks || dbItem.remarks,
      };
    } else {
      return {
        ...dbItem,
        balance_id: dbItem.id, // Ensure balance_id is set for non-temp items
      };
    }
  });

  // Add temp-only records that don't exist in DB
  tempDataArray.forEach((tempItem) => {
    let key;
    if (itemData.serial_number_management === 1) {
      // For serialized items, always use serial number as primary key
      // Include batch_id if item also has batch management
      if (itemData.item_batch_management === 1) {
        key = `${tempItem.location_id || "no_location"}-${
          tempItem.serial_number || "no_serial"
        }-${tempItem.batch_id || "no_batch"}`;
      } else {
        key = `${tempItem.location_id || "no_location"}-${
          tempItem.serial_number || "no_serial"
        }`;
      }
    } else if (
      itemData.serial_number_management !== 1 &&
      itemData.item_batch_management === 1
    ) {
      key = `${tempItem.location_id || "no_location"}-${
        tempItem.batch_id || "no_batch"
      }`;
    } else {
      key = `${tempItem.location_id || tempItem.balance_id || "no_key"}`;
    }

    const existsInDb = freshDbData.some((dbItem) => {
      let dbKey;
      if (itemData.serial_number_management === 1) {
        // For serialized items, always use serial number as primary key
        // Include batch_id if item also has batch management
        if (itemData.item_batch_management === 1) {
          dbKey = `${dbItem.location_id || "no_location"}-${
            dbItem.serial_number || "no_serial"
          }-${dbItem.batch_id || "no_batch"}`;
        } else {
          dbKey = `${dbItem.location_id || "no_location"}-${
            dbItem.serial_number || "no_serial"
          }`;
        }
      } else if (
        itemData.serial_number_management !== 1 &&
        itemData.item_batch_management === 1
      ) {
        dbKey = `${dbItem.location_id || "no_location"}-${
          dbItem.batch_id || "no_batch"
        }`;
      } else {
        dbKey = `${dbItem.location_id || dbItem.balance_id || "no_key"}`;
      }
      return dbKey === key;
    });

    if (!existsInDb) {
      console.log(`Adding temp-only data for ${key}`);
      mergedData.push({
        ...tempItem,
        balance_id: tempItem.balance_id || tempItem.id, // Ensure balance_id exists
      });
    }
  });

  return mergedData;
};

// Fetch item data
if (materialId) {
  db.collection("Item")
    .where({
      id: materialId,
    })
    .get()
    .then(async (response) => {
      console.log("response item", response);
      const itemData = response.data[0];
      console.log("itemData", itemData);

      // Get UOM options and set up material UOM
      const altUoms = itemData.table_uom_conversion?.map(
        (data) => data.alt_uom_id,
      );
      let uomOptions = [];

      const res = await fetchUomData(altUoms);
      uomOptions.push(...res);

      console.log("uomOptions", uomOptions);

      await this.setOptionData([`sm_item_balance.material_uom`], uomOptions);

      this.setData({
        sm_item_balance: {
          material_id: itemData.material_code,
          material_name: itemData.material_name,
          row_index: rowIndex,
          material_uom: quantityUOM,
        },
      });

      // Handle Serialized Items (takes priority over batch management)
      if (itemData.serial_number_management === 1) {
        console.log(
          "Processing serialized item (may also have batch management)",
        );

        // Show serial number column
        this.display("sm_item_balance.table_item_balance.serial_number");
        this.display("sm_item_balance.search_serial_number");
        this.display("sm_item_balance.confirm_search");
        this.display("sm_item_balance.reset_search");

        // Show or hide batch column based on whether item also has batch management
        if (itemData.item_batch_management === 1) {
          this.display([
            "sm_item_balance.table_item_balance.batch_id",
            "sm_item_balance.table_item_balance.dialog_expired_date",
            "sm_item_balance.table_item_balance.dialog_manufacturing_date",
          ]);
          console.log(
            "Serialized item with batch management - showing both serial and batch columns",
          );
        } else {
          this.hide([
            "sm_item_balance.table_item_balance.batch_id",
            "sm_item_balance.table_item_balance.dialog_expired_date",
            "sm_item_balance.table_item_balance.dialog_manufacturing_date",
          ]);
          console.log(
            "Serialized item without batch management - hiding batch column",
          );
        }

        db.collection("item_serial_balance")
          .where({
            material_id: materialId,
            plant_id: plant_id,
          })
          .get()
          .then((response) => {
            console.log("response item_serial_balance", response.data);
            const itemBalanceData = response.data || [];

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

            let finalData = mappedData;

            if (tempQtyData) {
              try {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                finalData = mergeWithTempData(
                  mappedData,
                  tempQtyDataArray,
                  itemData,
                );
              } catch (error) {
                console.error("Error parsing temp_qty_data:", error);
              }
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered serialized data:", filteredData);

            this.setData({
              [`sm_item_balance.table_item_balance`]: filteredData,
            });
            this.setData({
              [`sm_item_balance.table_item_balance_raw`]:
                JSON.stringify(filteredData),
            });
          })
          .catch((error) => {
            console.error("Error fetching item serial balance data:", error);
          });

        // Handle Batch Items (only if not serialized)
      } else if (itemData.item_batch_management === 1) {
        console.log("Processing batch item (non-serialized)");

        // Show batch column and hide serial number column
        this.display([
          "sm_item_balance.table_item_balance.batch_id",
          "sm_item_balance.table_item_balance.dialog_expired_date",
          "sm_item_balance.table_item_balance.dialog_manufacturing_date",
        ]);
        this.hide("sm_item_balance.table_item_balance.serial_number");

        db.collection("item_batch_balance")
          .where({
            material_id: materialId,
            plant_id: plant_id,
          })
          .get()
          .then((response) => {
            console.log("response item_batch_balance", response.data);
            const itemBalanceData = response.data || [];

            // Map the data and remove the original id to prevent duplicate key errors
            const mappedData = Array.isArray(itemBalanceData)
              ? itemBalanceData.map((item) => {
                  const { id, ...itemWithoutId } = item; // Remove original id
                  return {
                    ...itemWithoutId,
                    balance_id: id, // Keep balance_id for reference
                    dialog_expired_date: item.expired_date, // Map expired_date to dialog field
                    dialog_manufacturing_date: item.manufacturing_date, // Map manufacturing_date to dialog field
                  };
                })
              : (() => {
                  const { id, ...itemWithoutId } = itemBalanceData;
                  return {
                    ...itemWithoutId,
                    balance_id: id,
                    dialog_expired_date: itemBalanceData.expired_date,
                    dialog_manufacturing_date:
                      itemBalanceData.manufacturing_date,
                  };
                })();

            let finalData = mappedData;

            if (tempQtyData) {
              try {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                finalData = mergeWithTempData(
                  mappedData,
                  tempQtyDataArray,
                  itemData,
                );
              } catch (error) {
                console.error("Error parsing temp_qty_data:", error);
              }
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered batch data:", filteredData);

            this.setData({
              [`sm_item_balance.table_item_balance`]: filteredData,
            });
          })
          .catch((error) => {
            console.error("Error fetching item batch balance data:", error);
          });

        // Handle Regular Items (no batch, no serial)
      } else {
        console.log("Processing regular item (no batch, no serial)");

        // Hide both batch and serial columns
        this.hide([
          "sm_item_balance.table_item_balance.batch_id",
          "sm_item_balance.table_item_balance.dialog_expired_date",
          "sm_item_balance.table_item_balance.dialog_manufacturing_date",
        ]);
        this.hide("sm_item_balance.table_item_balance.serial_number");

        db.collection("item_balance")
          .where({
            material_id: materialId,
            plant_id: plant_id,
          })
          .get()
          .then((response) => {
            console.log("response item_balance", response.data);
            const itemBalanceData = response.data || [];

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

            let finalData = mappedData;

            if (tempQtyData) {
              try {
                const tempQtyDataArray = JSON.parse(tempQtyData);
                finalData = mergeWithTempData(
                  mappedData,
                  tempQtyDataArray,
                  itemData,
                );
              } catch (error) {
                console.error("Error parsing temp_qty_data:", error);
              }
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered regular data:", filteredData);

            this.setData({
              [`sm_item_balance.table_item_balance`]: filteredData,
              [`sm_item_balance.table_item_balance.unit_price`]:
                itemData.purchase_unit_price,
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
}

this.setData({
  [`sm_item_balance.table_item_balance.category`]: undefined,
});
