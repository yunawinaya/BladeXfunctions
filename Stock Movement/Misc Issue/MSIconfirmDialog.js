(async () => {
  const allData = this.getValues();
  const temporaryData = allData.sm_item_balance.table_item_balance;
  const rowIndex = allData.sm_item_balance.row_index;
  const quantityUOM = allData.stock_movement[rowIndex].quantity_uom;
  const selectedUOM = allData.sm_item_balance.material_uom;

  let isValid = true;

  const allValid = temporaryData.every((item, idx) => {
    const isValid =
      window.validationState && window.validationState[idx] !== false;
    return isValid;
  });

  if (!allValid) {
    return;
  }

  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: quantityUOM })
    .get()
    .then((res) => res.data[0]?.uom_name || "");

  const materialId = allData.stock_movement[rowIndex].item_selection;
  let itemData = null;
  try {
    const itemResponse = await db
      .collection("Item")
      .where({ id: materialId })
      .get();
    itemData = itemResponse.data[0];
  } catch (error) {
    console.error("Error fetching item data:", error);
  }

  let processedTemporaryData = temporaryData;

  if (selectedUOM !== quantityUOM) {
    const itemData = await db
      .collection("Item")
      .where({ id: materialId })
      .get()
      .then((res) => res.data[0]);
    const tableUOMConversion = itemData.table_uom_conversion;
    const baseUOM = itemData.based_uom;

    const convertQuantityFromTo = (
      value,
      table_uom_conversion,
      fromUOM,
      toUOM,
      baseUOM
    ) => {
      if (!value || fromUOM === toUOM) return value;

      let baseQty = value;
      if (fromUOM !== baseUOM) {
        const fromConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === fromUOM
        );
        if (fromConversion && fromConversion.base_qty) {
          baseQty = value * fromConversion.base_qty;
        }
      }

      if (toUOM !== baseUOM) {
        const toConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === toUOM
        );
        if (toConversion && toConversion.base_qty) {
          return Math.round((baseQty / toConversion.base_qty) * 1000) / 1000;
        }
      }

      return baseQty;
    };

    const quantityFields = [
      "block_qty",
      "reserved_qty",
      "unrestricted_qty",
      "qualityinsp_qty",
      "intransit_qty",
      "balance_quantity",
      "sm_quantity",
    ];

    processedTemporaryData = temporaryData.map((record) => {
      const convertedRecord = { ...record };

      quantityFields.forEach((field) => {
        if (convertedRecord[field]) {
          convertedRecord[field] = convertQuantityFromTo(
            convertedRecord[field],
            tableUOMConversion,
            selectedUOM,
            quantityUOM,
            baseUOM
          );
        }
      });

      return convertedRecord;
    });
  }

  const totalSmQuantity = processedTemporaryData
    .filter((item) => (item.sm_quantity || 0) > 0)
    .reduce((sum, item) => {
      const category_type = item.category ?? item.category_from;
      const quantity = item.sm_quantity || 0;

      if (quantity > 0) {
        let selectedField;

        switch (category_type) {
          case "Unrestricted":
            selectedField = item.unrestricted_qty;
            break;
          case "Reserved":
            selectedField = item.reserved_qty;
            break;
          case "Quality Inspection":
            selectedField = item.qualityinsp_qty;
            break;
          case "Blocked":
            selectedField = item.block_qty;
            break;
          case "In Transit":
            selectedField = item.intransit_qty;
            break;
          default:
            this.setData({ error_message: "Invalid category type" });
            isValid = false;
            return sum;
        }

        if (selectedField < quantity) {
          this.setData({
            error_message: `Quantity in ${category_type} is not enough.`,
          });
          isValid = false;
          return sum;
        }
      }

      return sum + quantity;
    }, 0);

  if (isValid) {
    this.setData({
      [`stock_movement.${rowIndex}.total_quantity`]: totalSmQuantity,
    });

    const currentBalanceIndex = this.getValues().balance_index || [];
    const rowsToUpdate = processedTemporaryData.filter(
      (item) => (item.sm_quantity || 0) > 0
    );

    let updatedBalanceIndex = currentBalanceIndex.filter((item) => {
      return String(item.row_index) !== String(rowIndex);
    });

    rowsToUpdate.forEach((newRow) => {
      const newEntry = { ...newRow, row_index: rowIndex };
      delete newEntry.id;

      // Remove dialog_ prefix from manufacturing_date and expired_date
      if (newEntry.dialog_manufacturing_date !== undefined) {
        newEntry.manufacturing_date = newEntry.dialog_manufacturing_date;
        delete newEntry.dialog_manufacturing_date;
      }
      if (newEntry.dialog_expired_date !== undefined) {
        newEntry.expired_date = newEntry.dialog_expired_date;
        delete newEntry.dialog_expired_date;
      }

      updatedBalanceIndex.push(newEntry);
    });

    const serialLocationBatchMap = new Map();

    updatedBalanceIndex.forEach((entry) => {
      if (entry.serial_number && entry.serial_number.trim() !== "") {
        const serialNumber = entry.serial_number.trim();
        const locationId = entry.location_id || "no-location";
        const batchId = entry.batch_id || "no-batch";

        const combinationKey = `${serialNumber}|${locationId}|${batchId}`;

        if (!serialLocationBatchMap.has(combinationKey)) {
          serialLocationBatchMap.set(combinationKey, []);
        }

        serialLocationBatchMap.get(combinationKey).push({
          serialNumber: serialNumber,
          locationId: locationId,
          batchId: batchId,
        });
      }
    });

    const duplicates = [];
    for (const [combinationKey, entries] of serialLocationBatchMap.entries()) {
      if (entries.length > 1) {
        duplicates.push({
          combinationKey: combinationKey,
          serialNumber: entries[0].serialNumber,
        });
      }
    }

    if (duplicates.length > 0) {
      const duplicateMessages = duplicates
        .map((dup) => `• Serial Number "${dup.serialNumber}".`)
        .join("\n");

      this.$message.error(
        `Duplicate serial numbers detected in the same location/batch combination:\n\n${duplicateMessages}\n\nThe same serial number cannot be allocated multiple times to the same location and batch. Please remove the duplicates and try again.`
      );
      return;
    }

    const formatFilteredData = async (temporaryData) => {
      const filteredData = temporaryData.filter(
        (item) => (item.sm_quantity || 0) > 0
      );

      const locationIds = [
        ...new Set(filteredData.map((item) => item.location_id)),
      ];

      const batchIds = [
        ...new Set(
          filteredData
            .map((item) => item.batch_id)
            .filter((batchId) => batchId != null && batchId !== "")
        ),
      ];

      const locationPromises = locationIds.map(async (locationId) => {
        try {
          const resBinLocation = await db
            .collection("bin_location")
            .where({ id: locationId })
            .get();

          return {
            id: locationId,
            name:
              resBinLocation.data?.[0]?.bin_location_combine ||
              `Location ID: ${locationId}`,
          };
        } catch (error) {
          console.error(`Error fetching location ${locationId}:`, error);
          return { id: locationId, name: `${locationId} (Error)` };
        }
      });

      const batchPromises = batchIds.map(async (batchId) => {
        try {
          const resBatch = await db
            .collection("batch")
            .where({ id: batchId })
            .get();

          return {
            id: batchId,
            name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
          };
        } catch (error) {
          console.error(`Error fetching batch ${batchId}:`, error);
          return { id: batchId, name: `${batchId} (Error)` };
        }
      });

      const [locations, batches] = await Promise.all([
        Promise.all(locationPromises),
        Promise.all(batchPromises),
      ]);

      const categoryMap = {
        Blocked: "BLK",
        Reserved: "RES",
        Unrestricted: "UNR",
        "Quality Inspection": "QIP",
        "In Transit": "INT",
      };

      const locationMap = locations.reduce((map, loc) => {
        map[loc.id] = loc.name;
        return map;
      }, {});

      const batchMap = batches.reduce((map, batch) => {
        map[batch.id] = batch.name;
        return map;
      }, {});

      const totalQty = filteredData.reduce(
        (sum, item) => sum + (item.sm_quantity || 0),
        0
      );

      let summary = `Total: ${totalQty} ${gdUOM}\n\nDETAILS:\n`;

      const details = filteredData
        .map((item, index) => {
          const locationName =
            locationMap[item.location_id] || item.location_id;
          const qty = item.sm_quantity || 0;
          const category = item.category;
          const categoryAbbr = categoryMap[category] || category || "UNR";

          let itemDetail = `${
            index + 1
          }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr})`;

          if (itemData?.serial_number_management === 1 && item.serial_number) {
            itemDetail += `\nSerial: ${item.serial_number}`;
          }

          if (item.batch_id) {
            const batchName = batchMap[item.batch_id] || item.batch_id;
            itemDetail += `\n${
              itemData?.serial_number_management === 1 ? "Batch: " : "["
            }${batchName}${
              itemData?.serial_number_management === 1 ? "" : "]"
            }`;
          }

          if (item.remarks && item.remarks.trim() !== "") {
            itemDetail += `\nRemarks: ${item.remarks}`;
          }

          return itemDetail;
        })
        .join("\n");

      return summary + details;
    };

    const formattedString = await formatFilteredData(processedTemporaryData);

    // Remove dialog_ prefix from temp_qty_data as well
    const cleanedTempData = processedTemporaryData
      .filter((tempData) => tempData.sm_quantity > 0)
      .map((item) => {
        const cleaned = { ...item };
        if (cleaned.dialog_manufacturing_date !== undefined) {
          cleaned.manufacturing_date = cleaned.dialog_manufacturing_date;
          delete cleaned.dialog_manufacturing_date;
        }
        if (cleaned.dialog_expired_date !== undefined) {
          cleaned.expired_date = cleaned.dialog_expired_date;
          delete cleaned.dialog_expired_date;
        }
        return cleaned;
      });

    const textareaContent = JSON.stringify(cleanedTempData);

    this.setData({
      [`stock_movement.${rowIndex}.temp_qty_data`]: textareaContent,
      [`stock_movement.${rowIndex}.stock_summary`]: formattedString,
    });

    const convertedBalanceIndex = updatedBalanceIndex.map((item) => {
      const converted = { ...item };

      const numericFields = [
        "unrestricted_qty",
        "reserved_qty",
        "qualityinsp_qty",
        "block_qty",
        "intransit_qty",
        "balance_quantity",
        "sm_quantity",
        "unit_price",
      ];

      numericFields.forEach((field) => {
        if (converted[field] !== null && converted[field] !== undefined) {
          const num = parseFloat(converted[field]) || 0;
          converted[field] = num.toFixed(3);
        }
      });

      if (converted.is_deleted !== undefined) {
        converted.is_deleted = converted.is_deleted ? 1 : 0;
      }

      return converted;
    });

    this.setData({ balance_index: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.setData({ balance_index: convertedBalanceIndex });

    this.models["previous_material_uom"] = undefined;
    this.setData({ error_message: "" });
    this.closeDialog("sm_item_balance");
  }
})();
