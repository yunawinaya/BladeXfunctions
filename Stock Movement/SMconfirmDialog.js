(async () => {
  const allData = this.getValues();
  const temporaryData = allData.sm_item_balance.table_item_balance;
  const rowIndex = allData.sm_item_balance.row_index;
  const movementType = allData.movement_type;

  let isValid = true;

  const allValid = temporaryData.every((item, idx) => {
    const isValid =
      window.validationState && window.validationState[idx] !== false;
    console.log(`Row ${idx} validation: ${isValid}`);
    return isValid;
  });

  if (!allValid) {
    console.log("Validation failed, canceling confirm");
    return;
  }

  // Get UOM information - you'll need to adjust this field name based on your data structure
  const materialUOMid = allData.stock_movement[rowIndex].quantity_uom;
  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: materialUOMid })
    .get()
    .then((res) => {
      return res.data[0]?.uom_name || "";
    });

  // Get item data to check for serial/batch management
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

  const totalSmQuantity = temporaryData
    .filter((item) => (item.sm_quantity || 0) > 0)
    .reduce((sum, item) => {
      const category_type = item.category ?? item.category_from;
      const quantity = item.sm_quantity || 0;

      // Define quantity fields
      const unrestricted_field = item.unrestricted_qty;
      const reserved_field = item.reserved_qty;
      const quality_field = item.qualityinsp_qty;
      const blocked_field = item.block_qty;
      const intransit_field = item.intransit_qty;

      // Validate only if movementType is "Out"
      if (quantity > 0) {
        let selectedField;

        switch (category_type) {
          case "Unrestricted":
            selectedField = unrestricted_field;
            break;
          case "Reserved":
            selectedField = reserved_field;
            break;
          case "Quality Inspection":
            selectedField = quality_field;
            break;
          case "Blocked":
            selectedField = blocked_field;
            break;
          case "In Transit":
            selectedField = intransit_field;
            break;
          default:
            this.setData({ error_message: "Invalid category type" });
            isValid = false;
            return sum;
        }

        // Check if selected field has enough quantity
        if (selectedField < quantity) {
          this.setData({
            error_message: `Quantity in ${category_type} is not enough.`,
          });
          isValid = false;
          return sum;
        }
      }

      // Add to sum if validation passes or if movement is "In"
      return sum + quantity;
    }, 0);

  console.log("Total SM quantity:", totalSmQuantity);

  // Only update data and close dialog if all validations pass
  if (isValid) {
    // Update total quantity
    this.setData({
      [`stock_movement.${rowIndex}.total_quantity`]: totalSmQuantity,
    });

    const currentBalanceIndex = this.getValues().balance_index || [];
    const rowsToUpdate = temporaryData.filter(
      (item) => (item.sm_quantity || 0) > 0
    );

    console.log("🔍 BALANCE INDEX DEBUG INFO:");
    console.log("Current rowIndex:", rowIndex);
    console.log("Current balance_index length:", currentBalanceIndex.length);
    console.log(
      "Current balance_index:",
      JSON.stringify(currentBalanceIndex, null, 2)
    );
    console.log("Rows to update:", JSON.stringify(rowsToUpdate, null, 2));
    console.log("Rows to update length:", rowsToUpdate.length);

    // Check what row_index values exist in current balance_index
    const existingRowIndexes = currentBalanceIndex.map(
      (item) => item.row_index
    );
    console.log(
      "Existing row_index values in balance_index:",
      existingRowIndexes
    );

    // Filter out any existing entries that belong to this specific row
    let updatedBalanceIndex = currentBalanceIndex.filter((item) => {
      const shouldKeep = item.row_index !== rowIndex;
      console.log(
        `Checking item with row_index ${
          item.row_index
        } against current rowIndex ${rowIndex}: ${
          shouldKeep ? "KEEP" : "REMOVE"
        }`
      );
      return shouldKeep;
    });

    console.log(
      "After filtering, balance_index length:",
      updatedBalanceIndex.length
    );
    console.log(
      "After filtering, balance_index:",
      JSON.stringify(updatedBalanceIndex, null, 2)
    );

    // Add all new entries for this row
    rowsToUpdate.forEach((newRow, index) => {
      const newEntry = {
        ...newRow,
        row_index: rowIndex,
        id: undefined,
      };

      delete newEntry.id;

      updatedBalanceIndex.push(newEntry);
      console.log(
        `Added new entry ${index + 1} for row ${rowIndex}:`,
        JSON.stringify(newEntry, null, 2)
      );
    });

    console.log("Final balance_index length:", updatedBalanceIndex.length);
    console.log(
      "Final balance_index:",
      JSON.stringify(updatedBalanceIndex, null, 2)
    );

    const formatFilteredData = async (temporaryData) => {
      // Filter data to only include items with quantity > 0
      const filteredData = temporaryData.filter(
        (item) => (item.sm_quantity || 0) > 0
      );

      // Get unique location IDs from filtered data
      const locationIds = [
        ...new Set(filteredData.map((item) => item.location_id)),
      ];

      // Get unique batch IDs (filter out null/undefined values) from filtered data
      const batchIds = [
        ...new Set(
          filteredData
            .map((item) => item.batch_id)
            .filter((batchId) => batchId != null && batchId !== "")
        ),
      ];

      // Fetch locations in parallel
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

      // Fetch batches in parallel (only if there are batch IDs)
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

      // Create lookup maps
      const locationMap = locations.reduce((map, loc) => {
        map[loc.id] = loc.name;
        return map;
      }, {});

      const batchMap = batches.reduce((map, batch) => {
        map[batch.id] = batch.name;
        return map;
      }, {});

      // Calculate total from filtered data only
      const totalQty = filteredData.reduce(
        (sum, item) => sum + (item.sm_quantity || 0),
        0
      );

      let summary = `Total: ${totalQty} ${gdUOM}\n\nDETAILS:\n`;

      // Process only filtered data for details
      const details = filteredData
        .map((item, index) => {
          const locationName =
            locationMap[item.location_id] || item.location_id;
          const qty = item.sm_quantity || 0;

          const category = item.category;
          let categoryAbbr = categoryMap[category] || category || "UNR";

          if (movementType === "Inventory Category Transfer Posting") {
            const category_from =
              categoryMap[item.category_from] || item.category_from;
            const category_to =
              categoryMap[item.category_to] || item.category_to;
            categoryAbbr = `${category_from} -> ${category_to}`;
          }

          let itemDetail = `${
            index + 1
          }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr})`;

          // Add serial number info if item is serialized
          if (itemData?.serial_number_management === 1 && item.serial_number) {
            itemDetail += `\nSerial: ${item.serial_number}`;
          }

          // Add batch info if batch exists
          if (item.batch_id) {
            const batchName = batchMap[item.batch_id] || item.batch_id;
            itemDetail += `\n${
              itemData?.serial_number_management === 1 ? "Batch: " : "["
            }${batchName}${
              itemData?.serial_number_management === 1 ? "" : "]"
            }`;
          }

          // Add remarks if they exist
          if (item.remarks && item.remarks.trim() !== "") {
            itemDetail += `\nRemarks: ${item.remarks}`;
          }

          return itemDetail;
        })
        .join("\n");

      return summary + details;
    };

    const formattedString = await formatFilteredData(temporaryData);
    console.log("📋 Formatted string:", formattedString);

    const textareaContent = JSON.stringify(
      temporaryData.filter((tempData) => tempData.sm_quantity > 0)
    );

    this.setData({
      [`stock_movement.${rowIndex}.temp_qty_data`]: textareaContent,
      [`stock_movement.${rowIndex}.stock_summary`]: formattedString,
    });

    this.setData({
      balance_index: updatedBalanceIndex,
    });

    // Clear the error message
    this.setData({
      error_message: "",
    });

    this.closeDialog("sm_item_balance");
  }
})();
