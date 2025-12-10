(async () => {
  const data = this.getValues();
  const temporaryData = data.to_item_balance.table_item_balance;
  const rowIndex = data.to_item_balance.row_index;
  const selectedUOM = data.to_item_balance.material_uom;
  const materialId = data.table_to[rowIndex].material_id;
  const pickingPlanUOM = data.table_to[rowIndex].to_order_uom_id;

  const toUOM = await db
    .collection("unit_of_measurement")
    .where({ id: pickingPlanUOM })
    .get()
    .then((res) => {
      return res.data[0].uom_name;
    });

  // Get item data to check if it's serialized
  let isSerializedItem = false;
  let isBatchManagedItem = false;

  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    if (resItem.data && resItem.data[0]) {
      isSerializedItem = resItem.data[0].serial_number_management === 1;
      isBatchManagedItem = resItem.data[0].item_batch_management === 1;
    }
  }

  console.log(
    `Item type: Serialized=${isSerializedItem}, Batch=${isBatchManagedItem}`
  );

  // Re-validate all rows with quantities > 0 before confirming
  const toStatus = data.to_status;
  const to_order_quantity = parseFloat(
    data.table_to[rowIndex].to_order_quantity || 0
  );
  const initialDeliveredQty = parseFloat(
    data.table_to[rowIndex].to_initial_delivered_qty || 0
  );

  let orderLimit = 0;
  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();

    if (resItem.data && resItem.data[0]) {
      orderLimit =
        (to_order_quantity * (100 + resItem.data[0].over_delivery_tolerance)) /
        100;
    }
  }

  // Calculate total quantity from all rows with to_quantity > 0
  const totalDialogQuantity = temporaryData.reduce((sum, item) => {
    return sum + (item.to_quantity > 0 ? parseFloat(item.to_quantity || 0) : 0);
  }, 0);

  const totalDeliveredQty = initialDeliveredQty + totalDialogQuantity;

  console.log("Re-validation check:");
  console.log("Order limit with tolerance:", orderLimit);
  console.log("Initial delivered quantity:", initialDeliveredQty);
  console.log("Total dialog quantity:", totalDialogQuantity);
  console.log("Total delivered quantity:", totalDeliveredQty);

  // Check each row for validation
  for (let idx = 0; idx < temporaryData.length; idx++) {
    const item = temporaryData[idx];
    const quantity = parseFloat(item.to_quantity || 0);

    // Skip rows with quantity <= 0
    if (quantity <= 0) {
      console.log(`Row ${idx} has quantity <= 0, skipping validation`);
      continue;
    }

    // For serialized items, validate differently
    if (isSerializedItem) {
      // For serialized items, check if serial number exists and is valid
      if (!item.serial_number || item.serial_number.trim() === "") {
        console.log(`Row ${idx} validation failed: Serial number missing`);
        alert(`Row ${idx + 1}: Serial number is required for serialized items`);
        return;
      }

      // For serialized items, quantity should typically be 1 (whole units)
      if (quantity !== Math.floor(quantity)) {
        console.log(
          `Row ${idx} validation failed: Serialized items must be whole units`
        );
        alert(
          `Row ${idx + 1}: Serialized items must be delivered in whole units`
        );
        return;
      }

      // Check unrestricted quantity for serialized items
      const unrestricted_field = item.unrestricted_qty;
      if (toStatus === "Created") {
        // For Created status, allow more flexibility
        if (unrestricted_field < quantity) {
          console.log(
            `Row ${idx} validation failed: Serial item not available`
          );
          alert(
            `Row ${idx + 1}: Serial number ${
              item.serial_number
            } is not available`
          );
          return;
        }
      } else {
        // For other statuses, check unrestricted quantity
        if (unrestricted_field < quantity) {
          console.log(
            `Row ${idx} validation failed: Serial item unrestricted quantity insufficient`
          );
          alert(
            `Row ${idx + 1}: Serial number ${
              item.serial_number
            } unrestricted quantity is insufficient`
          );
          return;
        }
      }
    } else {
      // For non-serialized items, use existing validation logic
      const unrestricted_field = item.unrestricted_qty;
      const reserved_field = item.reserved_qty;

      if (
        toStatus === "Created" &&
        reserved_field + unrestricted_field < quantity
      ) {
        console.log(`Row ${idx} validation failed: Quantity is not enough`);
        alert(`Row ${idx + 1}: Quantity is not enough`);
        return;
      } else if (toStatus !== "Created" && unrestricted_field < quantity) {
        console.log(
          `Row ${idx} validation failed: Unrestricted quantity is not enough`
        );
        alert(`Row ${idx + 1}: Unrestricted quantity is not enough`);
        return;
      }
    }

    console.log(`Row ${idx} validation: passed`);
  }

  // Check total delivery limit
  if (orderLimit > 0 && orderLimit < totalDeliveredQty) {
    console.log("Validation failed: Total quantity exceeds delivery limit");
    alert("Total quantity exceeds delivery limit");
    return;
  }

  console.log("All validations passed, proceeding with confirm");

  // Convert quantities back to pickingPlanUOM if user changed UOM
  let processedTemporaryData = temporaryData;

  if (selectedUOM !== pickingPlanUOM) {
    console.log(
      "Converting quantities back from selectedUOM to pickingPlanUOM"
    );
    console.log("From UOM:", selectedUOM, "To UOM:", pickingPlanUOM);

    // Get item data for conversion
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    const itemData = resItem.data[0];
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

      // First convert from current UOM back to base UOM
      let baseQty = value;
      if (fromUOM !== baseUOM) {
        const fromConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === fromUOM
        );
        if (fromConversion && fromConversion.base_qty) {
          baseQty = value * fromConversion.base_qty;
        }
      }

      // Then convert from base UOM to target UOM
      if (toUOM !== baseUOM) {
        const toConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === toUOM
        );
        if (toConversion && toConversion.base_qty) {
          return Math.round(baseQty / toConversion.base_qty * 1000) / 1000;
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
      "to_quantity", // Include to_quantity in conversion
    ];

    processedTemporaryData = temporaryData.map((record, index) => {
      const convertedRecord = { ...record };

      quantityFields.forEach((field) => {
        if (convertedRecord[field]) {
          const originalValue = convertedRecord[field];
          convertedRecord[field] = convertQuantityFromTo(
            convertedRecord[field],
            tableUOMConversion,
            selectedUOM,
            pickingPlanUOM,
            baseUOM
          );
          console.log(
            `Record ${index} ${field}: ${originalValue} -> ${convertedRecord[field]}`
          );
        }
      });

      return convertedRecord;
    });

    console.log(
      "Converted temporary data back to pickingPlanUOM:",
      processedTemporaryData
    );
  }

  // Filter out items where to_quantity is less than or equal to 0
  const filteredData = processedTemporaryData.filter(
    (item) => item.to_quantity > 0
  );
  console.log("Filtered data (excluding to_quantity <= 0):", filteredData);

  const formatFilteredData = async (filteredData) => {
    // Get unique location IDs
    const locationIds = [
      ...new Set(filteredData.map((item) => item.location_id)),
    ];

    // Get unique batch IDs (filter out null/undefined values)
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

    // Wait for both location and batch data
    const [locations, batches] = await Promise.all([
      Promise.all(locationPromises),
      Promise.all(batchPromises),
    ]);

    // Create lookup maps
    const locationMap = locations.reduce((map, loc) => {
      map[loc.id] = loc.name;
      return map;
    }, {});

    const batchMap = batches.reduce((map, batch) => {
      map[batch.id] = batch.name;
      return map;
    }, {});

    const totalQty = filteredData.reduce(
      (sum, item) => sum + (item.to_quantity || 0),
      0
    );

    let summary = `Total: ${totalQty} ${toUOM}\n\nDETAILS:\n`;

    // 🐛 ADD DEBUGGING HERE
    console.log("=== DEBUGGING SERIAL DISPLAY ===");
    console.log("isSerializedItem:", isSerializedItem);
    console.log("isBatchManagedItem:", isBatchManagedItem);
    console.log("filteredData:", filteredData);

    const details = filteredData
      .map((item, index) => {
        const locationName = locationMap[item.location_id] || item.location_id;
        const qty = item.to_quantity || 0;

        let itemDetail = `${index + 1}. ${locationName}: ${qty} ${toUOM}`;

        // 🐛 ADD MORE DEBUGGING
        console.log(`Item ${index}:`, {
          serial_number: item.serial_number,
          batch_id: item.batch_id,
          isSerializedItem: isSerializedItem,
          hasSerial: !!item.serial_number,
        });

        // 🔧 IMPROVED SERIAL DISPLAY LOGIC
        if (isSerializedItem) {
          if (item.serial_number && item.serial_number.trim() !== "") {
            itemDetail += ` [Serial: ${item.serial_number.trim()}]`;
          } else {
            itemDetail += ` [Serial: NOT SET]`;
            console.warn(
              `Row ${index + 1}: Serial number missing for serialized item`
            );
          }
        }

        // Add batch info if batch exists
        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          if (isSerializedItem) {
            // If we already added serial on same line, add batch on new line
            itemDetail += `\n   [Batch: ${batchName}]`;
          } else {
            // For non-serialized items, add batch on new line as before
            itemDetail += `\n[Batch: ${batchName}]`;
          }
        }

        return itemDetail;
      })
      .join("\n");

    console.log("=== END DEBUGGING ===");
    return summary + details;
  };

  const formattedString = await formatFilteredData(filteredData);
  console.log("📋 Formatted string:", formattedString);

  const textareaContent = JSON.stringify(filteredData);

  this.setData({
    [`table_to.${rowIndex}.temp_qty_data`]: textareaContent,
    [`table_to.${rowIndex}.view_stock`]: formattedString,
    [`to_item_balance.table_item_balance`]: [],
  });

  console.log("Input data (filtered):", filteredData);
  console.log("Row index:", rowIndex);

  // Sum up all to_quantity values from filtered data
  const totalToQuantity = filteredData.reduce(
    (sum, item) => sum + (item.to_quantity || 0),
    0
  );
  console.log("Total TO quantity:", totalToQuantity);

  // Get the initial delivered quantity from the table_to
  const initialDeliveredQty2 =
    data.table_to[rowIndex].to_initial_delivered_qty || 0;
  console.log("Initial delivered quantity:", initialDeliveredQty2);

  const deliveredQty = initialDeliveredQty2 + totalToQuantity;
  console.log("Final delivered quantity:", deliveredQty);

  // Calculate price per item for the current row
  const totalPrice = parseFloat(data.table_to[rowIndex].total_price) || 0;
  const orderQuantity =
    parseFloat(data.table_to[rowIndex].to_order_quantity) || 0;

  let pricePerItem = 0;
  if (orderQuantity > 0) {
    pricePerItem = totalPrice / orderQuantity;
  } else {
    console.warn("Order quantity is zero or invalid for row", rowIndex);
  }

  const currentRowPrice = pricePerItem * totalToQuantity;
  console.log("Price per item:", pricePerItem);
  console.log("Current row price:", currentRowPrice);

  // Store the row-specific data first
  this.setData({
    [`table_to.${rowIndex}.to_delivered_qty`]: deliveredQty,
    [`table_to.${rowIndex}.to_qty`]: totalToQuantity,
    [`table_to.${rowIndex}.base_qty`]: totalToQuantity,
    [`table_to.${rowIndex}.to_price`]: currentRowPrice,
    [`table_to.${rowIndex}.price_per_item`]: pricePerItem,
    error_message: "", // Clear any error message
  });

  console.log(
    `Updated row ${rowIndex} with serialized=${isSerializedItem}, batch=${isBatchManagedItem}`
  );

  // Recalculate total from all rows
  let newTotal = 0;

  // Loop through all rows and sum up their prices
  data.table_to.forEach((row, index) => {
    const rowOrderQty = parseFloat(row.to_order_quantity) || 0;
    const rowTotalPrice = parseFloat(row.total_price) || 0;

    let rowToQty;
    if (index === rowIndex) {
      // For the current row being edited, use the new quantity we just calculated
      rowToQty = totalToQuantity;
    } else {
      // For other rows, use their existing to_qty
      rowToQty = parseFloat(row.to_qty) || 0;
    }

    if (rowOrderQty > 0 && rowToQty > 0) {
      const rowPricePerItem = rowTotalPrice / rowOrderQty;
      const rowPrice = rowPricePerItem * rowToQty;
      newTotal += rowPrice;

      console.log(
        `Row ${index}: qty=${rowToQty}, pricePerItem=${rowPricePerItem}, rowTotal=${rowPrice}`
      );
    }
  });

  console.log("Recalculated total from all rows:", newTotal);

  // Update the grand total
  this.setData({
    [`to_total`]: newTotal,
  });

  this.models["previous_material_uom"] = undefined;

  this.closeDialog("to_item_balance");
})();
