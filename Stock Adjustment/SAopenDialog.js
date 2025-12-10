const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const adjustment_type = allData.adjustment_type;
const materialId = lineItemData.material_id;
const plantId = allData.plant_id;
const uomId = lineItemData.uom_id;

console.log("materialId", materialId);

const fetchUomData = async (uomIds) => {
  if (!uomIds || uomIds.length === 0) return [];

  try {
    const resUOM = await Promise.all(
      uomIds.map((id) =>
        db.collection("unit_of_measurement").where({ id }).get()
      )
    );

    return resUOM.map((response) => response.data[0]).filter(Boolean);
  } catch (error) {
    console.error("Error fetching UOM data:", error);
    return [];
  }
};

// Initially hide serial number column
this.hide("sa_item_balance.table_item_balance.serial_number");

const filterZeroQuantityRecords = (data, itemData) => {
  return data.filter((record) => {
    // For serialized items, check both serial number existence AND quantity > 0
    if (itemData && itemData.serial_number_management === 1) {
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
        `Serial ${record.serial_number}: hasQuantity=${hasQuantity}, unrestricted=${record.unrestricted_qty}, reserved=${record.reserved_qty}, balance=${record.balance_quantity}`
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

const mergeWithSavedData = (freshDbData, savedDataArray, itemData) => {
  if (!savedDataArray || savedDataArray.length === 0) {
    console.log("No saved data to merge, using fresh DB data");
    return freshDbData;
  }

  console.log("Merging fresh DB data with existing saved data");

  const savedDataMap = new Map();
  savedDataArray.forEach((savedItem) => {
    let key;
    if (itemData && itemData.serial_number_management === 1) {
      // For serialized items, always use serial number as primary key
      // Include batch_id if item also has batch management
      if (itemData.item_batch_management === 1) {
        key = `${savedItem.location_id || "no_location"}-${
          savedItem.serial_number || "no_serial"
        }-${savedItem.batch_id || "no_batch"}`;
      } else {
        key = `${savedItem.location_id || "no_location"}-${
          savedItem.serial_number || "no_serial"
        }`;
      }
    } else if (
      itemData &&
      itemData.serial_number_management !== 1 &&
      itemData.item_batch_management === 1
    ) {
      // For batch items (non-serialized), use batch as key
      key = `${savedItem.location_id || "no_location"}-${
        savedItem.batch_id || "no_batch"
      }`;
    } else {
      // For regular items, use only location or balance_id
      key = `${savedItem.location_id || savedItem.balance_id || "no_key"}`;
    }
    savedDataMap.set(key, savedItem);
  });

  const mergedData = freshDbData.map((dbItem) => {
    let key;
    if (itemData && itemData.serial_number_management === 1) {
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
      itemData &&
      itemData.serial_number_management !== 1 &&
      itemData.item_batch_management === 1
    ) {
      key = `${dbItem.location_id || "no_location"}-${
        dbItem.batch_id || "no_batch"
      }`;
    } else {
      key = `${dbItem.location_id || dbItem.balance_id || "no_key"}`;
    }

    const savedItem = savedDataMap.get(key);

    if (savedItem) {
      console.log(
        `Merging saved data for ${key}: DB unrestricted=${dbItem.unrestricted_qty}, saved data merged`
      );

      // Merge all relevant fields from saved data, preserving saved modifications
      return {
        ...dbItem, // Start with DB data as base
        ...savedItem, // Override with saved data (this preserves all saved modifications)
        // Ensure critical DB fields are not overwritten if they shouldn't be
        id: dbItem.id, // Keep original DB id
        balance_id: dbItem.id, // Keep balance_id reference to original
        // Preserve saved-specific fields that don't exist in DB
        fm_key: savedItem.fm_key,
        category: savedItem.category,
        sa_quantity: savedItem.sa_quantity,
        movement_type: savedItem.movement_type,
        remarks: savedItem.remarks || dbItem.remarks,
      };
    } else {
      return {
        ...dbItem,
        balance_id: dbItem.id, // Ensure balance_id is set for non-saved items
      };
    }
  });

  // Add saved-only records that don't exist in DB (shouldn't normally happen for SA)
  savedDataArray.forEach((savedItem) => {
    let key;
    if (itemData && itemData.serial_number_management === 1) {
      // For serialized items, always use serial number as primary key
      // Include batch_id if item also has batch management
      if (itemData.item_batch_management === 1) {
        key = `${savedItem.location_id || "no_location"}-${
          savedItem.serial_number || "no_serial"
        }-${savedItem.batch_id || "no_batch"}`;
      } else {
        key = `${savedItem.location_id || "no_location"}-${
          savedItem.serial_number || "no_serial"
        }`;
      }
    } else if (
      itemData &&
      itemData.serial_number_management !== 1 &&
      itemData.item_batch_management === 1
    ) {
      key = `${savedItem.location_id || "no_location"}-${
        savedItem.batch_id || "no_batch"
      }`;
    } else {
      key = `${savedItem.location_id || savedItem.balance_id || "no_key"}`;
    }

    const existsInDb = freshDbData.some((dbItem) => {
      let dbKey;
      if (itemData && itemData.serial_number_management === 1) {
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
        itemData &&
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
      console.log(`Adding saved-only data for ${key}`);
      mergedData.push({
        ...savedItem,
        balance_id: savedItem.balance_id || savedItem.id, // Ensure balance_id exists
      });
    }
  });

  return mergedData;
};

// Proceed with original queries if no tempQtyData
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
        (data) => data.alt_uom_id
      );
      let uomOptions = [];

      const res = await fetchUomData(altUoms);
      uomOptions.push(...res);

      console.log("uomOptions", uomOptions);

      await this.setOptionData([`sa_item_balance.material_uom`], uomOptions);

      this.setData({
        [`sa_item_balance.material_id`]: itemData.material_code,
        [`sa_item_balance.material_name`]: itemData.material_name,
        [`sa_item_balance.row_index`]: rowIndex,
        [`sa_item_balance.material_uom`]: uomId,
      });

      const previousBalanceData =
        lineItemData.balance_index === "" ||
        lineItemData.balance_index === undefined
          ? []
          : JSON.parse(lineItemData.balance_index);

      console.log("previousBalanceData", previousBalanceData);

      // Handle Serialized Items (takes priority over batch management)
      if (itemData.serial_number_management === 1) {
        console.log(
          "Processing serialized item (may also have batch management)"
        );

        // Show serial number column
        this.display("sa_item_balance.table_item_balance.serial_number");
        this.display("sa_item_balance.search_serial_number");
        this.display("sa_item_balance.confirm_search");
        this.display("sa_item_balance.reset_search");
        this.setData({
          [`sa_item_balance.is_serialized`]: 1,
        });

        // Show or hide batch column based on whether item also has batch management
        if (itemData.item_batch_management === 1) {
          this.display([
            "sa_item_balance.table_item_balance.batch_id",
            "sa_item_balance.table_item_balance.expired_date",
            "sa_item_balance.table_item_balance.manufacturing_date",
          ]);
          console.log(
            "Serialized item with batch management - showing both serial and batch columns"
          );
        } else {
          this.hide([
            "sa_item_balance.table_item_balance.batch_id",
            "sa_item_balance.table_item_balance.expired_date",
            "sa_item_balance.table_item_balance.manufacturing_date",
          ]);
          console.log(
            "Serialized item without batch management - hiding batch column"
          );
        }

        db.collection("item_serial_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_serial_balance", response.data);
            let itemBalanceData = response.data || [];

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

            if (previousBalanceData && previousBalanceData.length > 0) {
              finalData = mergeWithSavedData(
                mappedData,
                previousBalanceData,
                itemData
              );
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered serialized data:", filteredData);

            filteredData.forEach((item) => {
              item.movement_type = "Out";
            });

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            this.setData({
              [`sa_item_balance.table_item_balance_raw`]:
                JSON.stringify(filteredData),
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.disabled(
                [`sa_item_balance.table_item_balance.movement_type`],
                true
              );
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
            }
          })
          .catch((error) => {
            console.error("Error fetching item serial balance data:", error);
          });

        // Handle Batch Items (only if not serialized)
      } else if (itemData.item_batch_management === 1) {
        console.log("Processing batch item (non-serialized)");

        // Show batch column and hide serial number column
        this.display([
          "sa_item_balance.table_item_balance.batch_id",
          "sa_item_balance.table_item_balance.expired_date",
          "sa_item_balance.table_item_balance.manufacturing_date",
        ]);
        this.hide("sa_item_balance.table_item_balance.serial_number");

        // Hide serial number column
        this.hide("sa_item_balance.table_item_balance.serial_number");
        this.hide("sa_item_balance.search_serial_number");
        this.hide("sa_item_balance.confirm_search");
        this.hide("sa_item_balance.reset_search");
        this.setData({
          [`sa_item_balance.is_serialized`]: 0,
        });

        db.collection("item_batch_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_batch_balance", response.data);
            let itemBalanceData = response.data || [];

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

            if (previousBalanceData && previousBalanceData.length > 0) {
              finalData = mergeWithSavedData(
                mappedData,
                previousBalanceData,
                itemData
              );
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered batch data:", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
            }
          })
          .catch((error) => {
            console.error("Error fetching item batch balance data:", error);
          });

        // Handle Regular Items (no batch, no serial)
      } else {
        console.log("Processing regular item (no batch, no serial)");

        // Hide both batch and serial columns
        this.hide([
          "sa_item_balance.table_item_balance.batch_id",
          "sa_item_balance.table_item_balance.expired_date",
          "sa_item_balance.table_item_balance.manufacturing_date",
        ]);
        this.hide("sa_item_balance.table_item_balance.serial_number");

        // Hide serial number column
        this.hide("sa_item_balance.table_item_balance.serial_number");
        this.hide("sa_item_balance.search_serial_number");
        this.hide("sa_item_balance.confirm_search");
        this.hide("sa_item_balance.reset_search");
        this.setData({
          [`sa_item_balance.is_serialized`]: 0,
        });

        db.collection("item_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_balance", response.data);
            let itemBalanceData = response.data || [];

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

            if (previousBalanceData && previousBalanceData.length > 0) {
              finalData = mergeWithSavedData(
                mappedData,
                previousBalanceData,
                itemData
              );
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered regular data:", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
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
