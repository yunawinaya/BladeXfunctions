(async () => {
  // FIX: Helper function to round quantities to 3 decimal places to avoid floating-point precision issues
  const roundQty = (value) => Math.round((parseFloat(value) || 0) * 1000) / 1000;

  const data = this.getValues();
  const temporaryData = data.gd_item_balance.table_item_balance;
  const huData = data.gd_item_balance.table_hu || [];
  const rowIndex = data.gd_item_balance.row_index;
  const selectedUOM = data.gd_item_balance.material_uom;
  const materialId = data.table_gd[rowIndex].material_id;
  const goodDeliveryUOM = data.table_gd[rowIndex].gd_order_uom_id;
  const isSelectPicking = data.is_select_picking;
  const splitPolicy = data.split_policy || "ALLOW_SPLIT";

  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: goodDeliveryUOM })
    .get()
    .then((res) => {
      return res.data[0].uom_name;
    });

  // Get item data to check if it's serialized
  let isSerializedItem = false;
  let isBatchManagedItem = false;
  let itemData = null;

  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    if (resItem.data && resItem.data[0]) {
      itemData = resItem.data[0];
      isSerializedItem = itemData.serial_number_management === 1;
      isBatchManagedItem = itemData.item_batch_management === 1;
    }
  }

  // Helper function to convert quantity from alt UOM to base UOM
  const convertToBaseUOM = (quantity, altUOM) => {
    if (!itemData || !altUOM || altUOM === itemData.based_uom) {
      return quantity;
    }

    const uomConversion = itemData.table_uom_conversion?.find(
      (conv) => conv.alt_uom_id === altUOM,
    );

    if (uomConversion && uomConversion.base_qty) {
      return quantity * uomConversion.base_qty;
    }

    return quantity;
  };

  // Helper function to convert quantity from base UOM to alt UOM
  const convertFromBaseUOM = (quantity, altUOM) => {
    if (!itemData || !altUOM || altUOM === itemData.based_uom) {
      return quantity;
    }

    const uomConversion = itemData.table_uom_conversion?.find(
      (conv) => conv.alt_uom_id === altUOM,
    );

    if (uomConversion && uomConversion.base_qty) {
      return quantity / uomConversion.base_qty;
    }

    return quantity;
  };

  console.log(
    `Item type: Serialized=${isSerializedItem}, Batch=${isBatchManagedItem}`,
  );

  // Re-validate all rows with quantities > 0 before confirming
  const gdStatus = data.gd_status;
  const currentDialogUOM = data.gd_item_balance.current_table_uom || selectedUOM;

  // Convert GD line quantities to current dialog UOM for accurate comparison
  const convertGdToDialogUOM = (qty) => {
    if (!qty || goodDeliveryUOM === currentDialogUOM) return qty;
    if (!itemData || !itemData.table_uom_conversion) return qty;
    const tableUOM = itemData.table_uom_conversion;
    const baseUOM = itemData.based_uom;
    // GD line UOM → base
    let baseQty = qty;
    if (goodDeliveryUOM !== baseUOM) {
      const fromConv = tableUOM.find((c) => c.alt_uom_id === goodDeliveryUOM);
      if (fromConv && fromConv.base_qty) baseQty = qty * fromConv.base_qty;
    }
    // base → dialog UOM
    if (currentDialogUOM === baseUOM) return roundQty(baseQty);
    const toConv = tableUOM.find((c) => c.alt_uom_id === currentDialogUOM);
    if (toConv && toConv.base_qty) return roundQty(baseQty / toConv.base_qty);
    return qty;
  };

  const rawOrderQty = parseFloat(data.table_gd[rowIndex].gd_order_quantity || 0);
  const rawInitialDeliveredQty = parseFloat(data.table_gd[rowIndex].gd_initial_delivered_qty || 0);
  const gd_order_quantity = convertGdToDialogUOM(rawOrderQty);
  const initialDeliveredQty = convertGdToDialogUOM(rawInitialDeliveredQty);

  let orderLimit = 0;
  if (materialId) {
    orderLimit =
      (gd_order_quantity * (100 + (itemData?.over_delivery_tolerance || 0))) /
      100;
  }

  // Calculate total quantity from all rows with gd_quantity > 0
  const balanceTotal = roundQty(temporaryData.reduce((sum, item) => {
    return sum + (item.gd_quantity > 0 ? parseFloat(item.gd_quantity || 0) : 0);
  }, 0));

  // Filter HU item rows with deliver_quantity > 0
  const filteredHuData = huData.filter(
    (item) => item.row_type === "item" && parseFloat(item.deliver_quantity) > 0,
  );

  const totalHuQuantity = roundQty(filteredHuData.reduce(
    (sum, item) => sum + parseFloat(item.deliver_quantity || 0),
    0,
  ));

  const totalDialogQuantity = roundQty(balanceTotal + totalHuQuantity);
  const totalDeliveredQty = roundQty(initialDeliveredQty + totalDialogQuantity);

  // For NO_SPLIT: validate tolerance — no over-pick allowed beyond delivery tolerance
  // For FULL_HU_PICK: skip — whole-HU excess is inherent, tracked in temp_excess_data
  if (splitPolicy === "NO_SPLIT" && materialId) {
    const tolerance = itemData?.over_delivery_tolerance || 0;
    const maxAllowed = roundQty(gd_order_quantity * (1 + tolerance / 100));
    const remainingCapacity = roundQty(maxAllowed - initialDeliveredQty);

    if (totalDialogQuantity > remainingCapacity) {
      alert(
        `Total picked quantity (${totalDialogQuantity}) exceeds remaining delivery capacity (${remainingCapacity}). ` +
          `Order: ${gd_order_quantity}, Already delivered: ${initialDeliveredQty}, Tolerance: ${tolerance}%`,
      );
      return;
    }
  }

  console.log("Re-validation check:");
  console.log("Order limit with tolerance:", orderLimit);
  console.log("Initial delivered quantity:", initialDeliveredQty);
  console.log("Balance total:", balanceTotal);
  console.log("HU total:", totalHuQuantity);
  console.log("Total dialog quantity:", totalDialogQuantity);
  console.log("Total delivered quantity:", totalDeliveredQty);

  // Get SO line item ID for pending reserved check
  const soLineItemId = data.table_gd[rowIndex].so_line_item_id;

  // Check each row for validation
  for (let idx = 0; idx < temporaryData.length; idx++) {
    const item = temporaryData[idx];
    const quantity = parseFloat(item.gd_quantity || 0);

    // Skip rows with quantity <= 0
    if (quantity <= 0) {
      console.log(`Row ${idx} has quantity <= 0, skipping validation`);
      continue;
    }

    // GDPP mode: Only validate against to_quantity
    if (isSelectPicking === 1) {
      console.log(
        `Row ${idx}: GDPP mode validation - checking against to_quantity`,
      );

      const to_quantity_field = item.to_quantity;

      if (to_quantity_field < quantity) {
        console.log(`Row ${idx} validation failed: Exceeds picked quantity`);
        alert(
          `Row ${
            idx + 1
          }: Quantity exceeds picked quantity from Picking (${to_quantity_field})`,
        );
        return;
      }

      // For serialized items, still check serial number and whole units
      if (isSerializedItem) {
        if (!item.serial_number || item.serial_number.trim() === "") {
          console.log(`Row ${idx} validation failed: Serial number missing`);
          alert(
            `Row ${idx + 1}: Serial number is required for serialized items`,
          );
          return;
        }

        if (quantity !== Math.floor(quantity)) {
          console.log(
            `Row ${idx} validation failed: Serialized items must be whole units`,
          );
          alert(
            `Row ${idx + 1}: Serialized items must be delivered in whole units`,
          );
          return;
        }
      }
    } else {
      // Regular GD mode: Validate against balance quantities
      console.log(
        `Row ${idx}: Regular GD mode validation - checking against balance`,
      );

      // For serialized items, validate differently
      if (isSerializedItem) {
        // For serialized items, check if serial number exists and is valid
        if (!item.serial_number || item.serial_number.trim() === "") {
          console.log(`Row ${idx} validation failed: Serial number missing`);
          alert(
            `Row ${idx + 1}: Serial number is required for serialized items`,
          );
          return;
        }

        // For serialized items, quantity should typically be 1 (whole units)
        if (quantity !== Math.floor(quantity)) {
          console.log(
            `Row ${idx} validation failed: Serialized items must be whole units`,
          );
          alert(
            `Row ${idx + 1}: Serialized items must be delivered in whole units`,
          );
          return;
        }

        // Check quantity for serialized items against displayed balance
        const unrestricted_field = item.unrestricted_qty;
        const reserved_field = item.reserved_qty || 0;
        const availableQty = soLineItemId
          ? roundQty(unrestricted_field + reserved_field)
          : roundQty(unrestricted_field);

        if (availableQty < quantity) {
          console.log(
            `Row ${idx} validation failed: Serial item quantity insufficient (available: ${availableQty}, requested: ${quantity})`,
          );
          alert(
            `Row ${idx + 1}: Serial number ${
              item.serial_number
            } quantity is insufficient`,
          );
          return;
        }
      } else {
        // For non-serialized items: validate against displayed balance
        // reserved_qty now shows SO-line-specific reserved (set by dialog workflow)
        const unrestricted_field = item.unrestricted_qty;
        const reserved_field = item.reserved_qty;

        // With SO: reserved_qty is SO-specific, so unrestricted + reserved = total available
        // Without SO: only check unrestricted (reserved belongs to other documents)
        const availableQty = soLineItemId
          ? roundQty(unrestricted_field + reserved_field)
          : roundQty(unrestricted_field);

        if (availableQty < quantity) {
          console.log(
            `Row ${idx} validation failed: Quantity is not enough (available: ${availableQty}, requested: ${quantity})`,
          );
          alert(`Row ${idx + 1}: Quantity is not enough`);
          return;
        }
      }
    }

    console.log(`Row ${idx} validation: passed`);
  }

  // Validate HU item rows
  for (const huItem of filteredHuData) {
    const deliverQty = parseFloat(huItem.deliver_quantity || 0);
    const availableQty = parseFloat(huItem.item_quantity || 0);

    if (deliverQty > availableQty) {
      const huHeader = huData.find(
        (row) =>
          row.row_type === "header" &&
          row.handling_unit_id === huItem.handling_unit_id,
      );
      const huName = huHeader?.handling_no || huItem.handling_unit_id;
      console.log(
        `HU validation failed: ${huName} deliver quantity ${deliverQty} exceeds available ${availableQty}`,
      );
      alert(
        `HU ${huName}: Deliver quantity (${deliverQty}) exceeds available quantity (${availableQty})`,
      );
      return;
    }
  }

  // Check total delivery limit (skip for FULL_HU_PICK only — NO_SPLIT enforces tolerance)
  if (splitPolicy !== "FULL_HU_PICK" && orderLimit > 0 && orderLimit < totalDeliveredQty) {
    console.log("Validation failed: Total quantity exceeds delivery limit");
    alert("Total quantity exceeds delivery limit");
    return;
  }

  console.log("All validations passed, proceeding with confirm");

  // Convert quantities back to goodDeliveryUOM if user changed UOM
  let processedTemporaryData = temporaryData;

  if (selectedUOM !== goodDeliveryUOM) {
    console.log(
      "Converting quantities back from selectedUOM to goodDeliveryUOM",
    );
    console.log("From UOM:", selectedUOM, "To UOM:", goodDeliveryUOM);

    // Use itemData already fetched at top of function (no redundant DB call)
    const tableUOMConversion = itemData.table_uom_conversion;
    const baseUOM = itemData.based_uom;

    const convertQuantityFromTo = (
      value,
      table_uom_conversion,
      fromUOM,
      toUOM,
      baseUOM,
    ) => {
      if (!value || fromUOM === toUOM) return value;

      // First convert from current UOM back to base UOM
      let baseQty = value;
      if (fromUOM !== baseUOM) {
        const fromConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === fromUOM,
        );
        if (fromConversion && fromConversion.base_qty) {
          baseQty = value * fromConversion.base_qty;
        }
      }

      // Then convert from base UOM to target UOM
      if (toUOM !== baseUOM) {
        const toConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === toUOM,
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
      "gd_quantity", // Include gd_quantity in conversion
      "to_quantity", // Include to_quantity for GDPP mode
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
            goodDeliveryUOM,
            baseUOM,
          );
          console.log(
            `Record ${index} ${field}: ${originalValue} -> ${convertedRecord[field]}`,
          );
        }
      });

      return convertedRecord;
    });

    console.log(
      "Converted temporary data back to goodDeliveryUOM:",
      processedTemporaryData,
    );
  }

  // Filter out items where gd_quantity is less than or equal to 0
  const filteredData = processedTemporaryData.filter(
    (item) => item.gd_quantity > 0,
  );
  console.log("Filtered data (excluding gd_quantity <= 0):", filteredData);

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
          .filter((batchId) => batchId != null && batchId !== ""),
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

    const totalQty = roundQty(filteredData.reduce(
      (sum, item) => sum + (item.gd_quantity || 0),
      0,
    ));

    const hasHuAllocation = filteredHuData && filteredHuData.length > 0;
    const sectionLabel = hasHuAllocation ? "LOOSE STOCK" : "DETAILS";
    let summary = hasHuAllocation
      ? `${sectionLabel}:\n`
      : `Total: ${totalQty} ${gdUOM}\n\n${sectionLabel}:\n`;

    const details = filteredData
      .map((item, index) => {
        const locationName = locationMap[item.location_id] || item.location_id;
        const qty = item.gd_quantity || 0;

        let itemDetail = `${index + 1}. ${locationName}: ${qty} ${gdUOM}`;

        if (isSerializedItem) {
          if (item.serial_number && item.serial_number.trim() !== "") {
            itemDetail += ` [Serial: ${item.serial_number.trim()}]`;
          } else {
            itemDetail += ` [Serial: NOT SET]`;
            console.warn(
              `Row ${index + 1}: Serial number missing for serialized item`,
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

    return summary + details;
  };

  const balanceSummary = await formatFilteredData(filteredData);

  let formattedString = "";

  if (filteredHuData.length > 0) {
    // Grand total at top when both loose stock and HU exist
    const grandTotal = roundQty(balanceTotal + totalHuQuantity);
    formattedString += `Total: ${grandTotal} ${gdUOM}\n\n`;

    // Loose stock section (only if there are balance allocations)
    if (filteredData.length > 0) {
      formattedString += balanceSummary;
    }

    // HU section
    formattedString += `\n\nHANDLING UNIT:\n`;
    const huDetails = filteredHuData
      .map((item, index) => {
        const huHeader = huData.find(
          (row) =>
            row.row_type === "header" &&
            row.handling_unit_id === item.handling_unit_id,
        );
        const huName = huHeader?.handling_no || item.handling_unit_id;
        let detail = `${index + 1}. ${huName}: ${item.deliver_quantity} ${gdUOM}`;
        if (item.batch_id) {
          detail += `\n   [Batch: ${item.batch_id}]`;
        }
        return detail;
      })
      .join("\n");
    formattedString += huDetails;
  } else {
    formattedString = balanceSummary;
  }

  console.log("Formatted string:", formattedString);

  // Convert HU items to same shape as balance data for combined temp_qty_data
  const huAsBalanceData = filteredHuData.map((huItem) => ({
    material_id: huItem.material_id,
    location_id: huItem.location_id,
    batch_id: huItem.batch_id || null,
    balance_id: huItem.balance_id || "",
    gd_quantity: parseFloat(huItem.deliver_quantity) || 0,
    handling_unit_id: huItem.handling_unit_id,
    plant_id: data.plant_id,
    organization_id: data.organization_id,
    is_deleted: 0,
  }));

  // Combine balance allocations + HU items into single temp_qty_data
  const combinedQtyData = [...filteredData, ...huAsBalanceData];
  const textareaContent = JSON.stringify(combinedQtyData);

  // Build temp_excess_data for FULL_HU_PICK/NO_SPLIT policies
  const tempExcessData = [];

  if (splitPolicy !== "ALLOW_SPLIT") {
    const gdQty = parseFloat(data.table_gd[rowIndex].gd_qty || 0);

    // 1. Over-pick excess: current material picked more than GD line needs
    const currentMaterialHuTotal = roundQty(
      filteredHuData
        .filter((item) => item.material_id === materialId)
        .reduce(
          (sum, item) => sum + parseFloat(item.deliver_quantity || 0),
          0,
        ),
    );

    if (currentMaterialHuTotal > gdQty && gdQty > 0) {
      const excessQty = roundQty(currentMaterialHuTotal - gdQty);
      // Get the HU info for the excess record
      const huItems = filteredHuData.filter(
        (item) => item.material_id === materialId,
      );
      if (huItems.length > 0) {
        tempExcessData.push({
          handling_unit_id: huItems[0].handling_unit_id,
          handling_no: huItems[0].handling_no || "",
          material_id: materialId,
          material_name: huItems[0].material_name || "",
          quantity: excessQty,
          batch_id: huItems[0].batch_id || null,
          location_id: huItems[0].location_id,
          reason: "over_pick",
        });
      }
    }

    // 2. Foreign item excess (FULL_HU_PICK only): items not in any GD line
    if (splitPolicy === "FULL_HU_PICK") {
      const gdMaterialIds = new Set(
        (data.table_gd || [])
          .map((line) => line.material_id)
          .filter(Boolean),
      );

      filteredHuData
        .filter((item) => !gdMaterialIds.has(item.material_id))
        .forEach((item) => {
          tempExcessData.push({
            handling_unit_id: item.handling_unit_id,
            handling_no: item.handling_no || "",
            material_id: item.material_id,
            material_name: item.material_name || "",
            quantity: parseFloat(item.deliver_quantity || 0),
            batch_id: item.batch_id || null,
            location_id: item.location_id,
            reason: "no_gd_line",
          });
        });
    }
  }

  // Cross-line distribution for FULL_HU_PICK/NO_SPLIT policies
  if (splitPolicy !== "ALLOW_SPLIT") {
    const tableGd = data.table_gd || [];

    // Build map: material_id -> [{ lineIndex, remainingNeed }]
    const gdMaterialMap = {};
    tableGd.forEach((line, idx) => {
      if (idx === rowIndex) return; // skip current line
      if (!line.material_id) return;

      // Calculate how much this line still needs
      let existingAllocated = 0;
      if (
        line.temp_qty_data &&
        line.temp_qty_data !== "[]" &&
        line.temp_qty_data.trim() !== ""
      ) {
        try {
          const existing = JSON.parse(line.temp_qty_data);
          existingAllocated = existing.reduce(
            (sum, t) => sum + parseFloat(t.gd_quantity || 0),
            0,
          );
        } catch (e) {
          /* ignore */
        }
      }
      const lineNeed = parseFloat(line.gd_qty || 0) - existingAllocated;

      if (lineNeed > 0) {
        if (!gdMaterialMap[line.material_id])
          gdMaterialMap[line.material_id] = [];
        gdMaterialMap[line.material_id].push({
          lineIndex: idx,
          remainingNeed: lineNeed,
        });
      }
    });

    // Accumulate cross-line updates to avoid stale snapshot re-reads
    const crossLineAccum = {}; // lineIndex -> { tempQty: [], tempHu: [] }

    // Distribute HU items to matching lines
    for (const huItem of filteredHuData) {
      if (huItem.material_id === materialId) continue; // current line — handled by normal flow

      const matchingLines = gdMaterialMap[huItem.material_id];
      if (!matchingLines || matchingLines.length === 0) continue; // FULL_HU_PICK: foreign item handled in tempExcessData above; NO_SPLIT: can't reach here (disabled HUs)

      let remainingHuQty = parseFloat(huItem.deliver_quantity || 0);

      for (const lineInfo of matchingLines) {
        if (remainingHuQty <= 0) break;

        const allocQty = roundQty(
          Math.min(remainingHuQty, lineInfo.remainingNeed),
        );
        if (allocQty <= 0) continue;

        // Initialize accumulator from original snapshot on first access
        if (!crossLineAccum[lineInfo.lineIndex]) {
          let existingTemp = [];
          let existingHuTemp = [];
          try {
            if (
              tableGd[lineInfo.lineIndex].temp_qty_data &&
              tableGd[lineInfo.lineIndex].temp_qty_data !== "[]"
            ) {
              existingTemp = JSON.parse(
                tableGd[lineInfo.lineIndex].temp_qty_data,
              );
            }
            if (
              tableGd[lineInfo.lineIndex].temp_hu_data &&
              tableGd[lineInfo.lineIndex].temp_hu_data !== "[]"
            ) {
              existingHuTemp = JSON.parse(
                tableGd[lineInfo.lineIndex].temp_hu_data,
              );
            }
          } catch (e) {
            /* ignore */
          }
          crossLineAccum[lineInfo.lineIndex] = {
            tempQty: existingTemp,
            tempHu: existingHuTemp,
          };
        }

        // Push to accumulator
        crossLineAccum[lineInfo.lineIndex].tempQty.push({
          material_id: huItem.material_id,
          location_id: huItem.location_id,
          batch_id: huItem.batch_id || null,
          balance_id: huItem.balance_id || "",
          gd_quantity: allocQty,
          handling_unit_id: huItem.handling_unit_id,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
          is_deleted: 0,
        });

        crossLineAccum[lineInfo.lineIndex].tempHu.push({
          row_type: "item",
          handling_unit_id: huItem.handling_unit_id,
          material_id: huItem.material_id,
          location_id: huItem.location_id,
          batch_id: huItem.batch_id || null,
          balance_id: huItem.balance_id || "",
          deliver_quantity: allocQty,
          item_quantity: parseFloat(huItem.item_quantity || 0),
        });

        remainingHuQty -= allocQty;
        lineInfo.remainingNeed -= allocQty;
      }

      // Any remaining after distributing = excess (over-pick for this material)
      if (remainingHuQty > 0) {
        tempExcessData.push({
          handling_unit_id: huItem.handling_unit_id,
          handling_no: huItem.handling_no || "",
          material_id: huItem.material_id,
          material_name: huItem.material_name || "",
          quantity: roundQty(remainingHuQty),
          batch_id: huItem.batch_id || null,
          location_id: huItem.location_id,
          reason: "over_pick",
        });
      }
    }

    // Write all accumulated cross-line data at once
    for (const [idx, accum] of Object.entries(crossLineAccum)) {
      this.setData({
        [`table_gd.${idx}.temp_qty_data`]: JSON.stringify(accum.tempQty),
        [`table_gd.${idx}.temp_hu_data`]: JSON.stringify(accum.tempHu),
      });
    }
  }

  this.setData({
    [`table_gd.${rowIndex}.temp_qty_data`]: textareaContent,
    [`table_gd.${rowIndex}.temp_hu_data`]: JSON.stringify(filteredHuData),
    [`table_gd.${rowIndex}.temp_excess_data`]: JSON.stringify(
      tempExcessData || [],
    ),
    [`table_gd.${rowIndex}.view_stock`]: formattedString,
    [`gd_item_balance.table_item_balance`]: [],
    [`gd_item_balance.table_hu`]: [],
  });

  console.log("Input data (filtered):", filteredData);
  console.log("Row index:", rowIndex);

  // Sum up all gd_quantity values from filtered data + HU deliver quantities
  const totalGdQuantity = roundQty(
    filteredData.reduce((sum, item) => sum + (item.gd_quantity || 0), 0) +
      filteredHuData.reduce(
        (sum, item) => sum + parseFloat(item.deliver_quantity || 0),
        0,
      ),
  );
  console.log("Total GD quantity (balance + HU):", totalGdQuantity);

  // Get the initial delivered quantity from the table_gd
  const initialDeliveredQty2 =
    parseFloat(data.table_gd[rowIndex].gd_initial_delivered_qty) || 0;
  console.log("Initial delivered quantity:", initialDeliveredQty2);

  const deliveredQty = roundQty(initialDeliveredQty2 + totalGdQuantity);
  console.log("Final delivered quantity:", deliveredQty);

  // Calculate price per item for the current row
  const totalPrice = parseFloat(data.table_gd[rowIndex].total_price) || 0;
  const orderQuantity =
    parseFloat(data.table_gd[rowIndex].gd_order_quantity) || 0;

  let pricePerItem = 0;
  if (orderQuantity > 0) {
    pricePerItem = totalPrice / orderQuantity;
  } else {
    console.warn("Order quantity is zero or invalid for row", rowIndex);
  }

  const currentRowPrice = pricePerItem * totalGdQuantity;
  console.log("Price per item:", pricePerItem);
  console.log("Current row price:", currentRowPrice);

  // Store the row-specific data first
  this.setData({
    [`table_gd.${rowIndex}.gd_delivered_qty`]: deliveredQty,
    [`table_gd.${rowIndex}.gd_qty`]: totalGdQuantity,
    [`table_gd.${rowIndex}.base_qty`]: totalGdQuantity,
    [`table_gd.${rowIndex}.gd_price`]: currentRowPrice,
    [`table_gd.${rowIndex}.price_per_item`]: pricePerItem,
    error_message: "", // Clear any error message
  });

  console.log(
    `Updated row ${rowIndex} with serialized=${isSerializedItem}, batch=${isBatchManagedItem}`,
  );

  // Recalculate total from all rows
  let newTotal = 0;

  // Loop through all rows and sum up their prices
  data.table_gd.forEach((row, index) => {
    const rowOrderQty = parseFloat(row.gd_order_quantity) || 0;
    const rowTotalPrice = parseFloat(row.total_price) || 0;

    let rowGdQty;
    if (index === rowIndex) {
      // For the current row being edited, use the new quantity we just calculated
      rowGdQty = totalGdQuantity;
    } else {
      // For other rows, use their existing gd_qty
      rowGdQty = parseFloat(row.gd_qty) || 0;
    }

    if (rowOrderQty > 0 && rowGdQty > 0) {
      const rowPricePerItem = rowTotalPrice / rowOrderQty;
      const rowPrice = rowPricePerItem * rowGdQty;
      newTotal += rowPrice;

      console.log(
        `Row ${index}: qty=${rowGdQty}, pricePerItem=${rowPricePerItem}, rowTotal=${rowPrice}`,
      );
    }
  });

  console.log("Recalculated total from all rows:", newTotal);

  // Update the grand total
  this.setData({
    [`gd_total`]: roundQty(newTotal),
  });

  this.models["previous_material_uom"] = undefined;

  this.closeDialog("gd_item_balance");
})();
