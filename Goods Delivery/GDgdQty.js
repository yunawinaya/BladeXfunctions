(async () => {
  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  const quantity = data.table_gd[rowIndex].gd_qty;
  const isSelectPicking = data.is_select_picking;

  // Retrieve values from context
  const orderedQty = data.table_gd[rowIndex].gd_order_quantity;
  const initialDeliveredQty = data.table_gd[rowIndex].gd_initial_delivered_qty;
  const uomId = data.table_gd[rowIndex].gd_order_uom_id;
  const itemCode = data.table_gd[rowIndex].material_id;
  const itemDesc = data.table_gd[rowIndex].gd_material_desc;
  const plantId = data.plant_id;
  const organizationId = data.organization_id;

  // Calculate undelivered quantity
  const undeliveredQty = orderedQty - initialDeliveredQty;
  const totalDeliveredQty = quantity + initialDeliveredQty;

  // GDPP mode: Update existing temp_qty_data proportionally
  if (isSelectPicking === 1) {
    console.log(
      `Row ${rowIndex}: GDPP mode - updating pre-allocated quantities`,
    );

    const existingTempData = data.table_gd[rowIndex].temp_qty_data;

    if (
      !existingTempData ||
      existingTempData === "[]" ||
      existingTempData.trim() === ""
    ) {
      console.warn(`Row ${rowIndex}: No existing temp_qty_data from PP`);
      return;
    }

    try {
      const tempDataArray = JSON.parse(existingTempData);

      // Calculate total to_quantity (ceiling from PP)
      const totalToQuantity = tempDataArray.reduce((sum, item) => {
        return sum + parseFloat(item.to_quantity || 0);
      }, 0);

      // Validate: quantity cannot exceed total to_quantity
      if (quantity > totalToQuantity) {
        console.error(
          `Row ${rowIndex}: Quantity ${quantity} exceeds picked quantity ${totalToQuantity}`,
        );
        this.setData({
          [`table_gd.${rowIndex}.gd_qty`]: totalToQuantity,
        });
        alert(
          `Quantity cannot exceed picked quantity from Picking Plan (${totalToQuantity})`,
        );
        return;
      }

      // Calculate proportional distribution
      // Each location gets: (its to_quantity / total to_quantity) * new gd_qty
      const updatedTempData = tempDataArray.map((item) => {
        const itemToQty = parseFloat(item.to_quantity || 0);
        const proportion = itemToQty / totalToQuantity;
        const newGdQty = Math.round(quantity * proportion * 1000) / 1000;

        return {
          ...item,
          gd_quantity: newGdQty,
        };
      });

      // Get UOM for display
      const getUOMData = async (uomId) => {
        if (!uomId) return "";
        try {
          const uomResult = await db
            .collection("unit_of_measurement")
            .where({ id: uomId })
            .get();
          return uomResult?.data?.[0]?.uom_name || "";
        } catch (error) {
          console.error("Error fetching UOM data:", error);
          return "";
        }
      };

      const uomName = await getUOMData(uomId);

      // Fetch location and batch names for display
      const locationIds = [
        ...new Set(updatedTempData.map((item) => item.location_id)),
      ];
      const batchIds = [
        ...new Set(
          updatedTempData.map((item) => item.batch_id).filter((id) => id),
        ),
      ];

      // Fetch locations
      const locationPromises = locationIds.map(async (locationId) => {
        try {
          const res = await db
            .collection("bin_location")
            .where({ id: locationId })
            .get();
          return {
            id: locationId,
            name: res.data?.[0]?.bin_location_combine || locationId,
          };
        } catch {
          return { id: locationId, name: locationId };
        }
      });

      // Fetch batches
      const batchPromises = batchIds.map(async (batchId) => {
        try {
          const res = await db.collection("batch").where({ id: batchId }).get();
          return { id: batchId, name: res.data?.[0]?.batch_number || batchId };
        } catch {
          return { id: batchId, name: batchId };
        }
      });

      const [locations, batches] = await Promise.all([
        Promise.all(locationPromises),
        Promise.all(batchPromises),
      ]);

      const locationMap = locations.reduce((map, loc) => {
        map[loc.id] = loc.name;
        return map;
      }, {});

      const batchMap = batches.reduce((map, batch) => {
        map[batch.id] = batch.name;
        return map;
      }, {});

      // Build view_stock summary
      let summary = `Total: ${quantity} ${uomName}\n\nDETAILS:\n`;
      const details = updatedTempData
        .map((item, index) => {
          const locationName =
            locationMap[item.location_id] || item.location_id;
          const gdQty = item.gd_quantity || 0;
          let detail = `${index + 1}. ${locationName}: ${gdQty} ${uomName}`;

          if (item.serial_number) {
            detail += ` [Serial: ${item.serial_number}]`;
          }
          if (item.batch_id) {
            const batchName = batchMap[item.batch_id] || item.batch_id;
            detail += `\n   [Batch: ${batchName}]`;
          }

          return detail;
        })
        .join("\n");

      summary += details;

      // Update GD row
      this.setData({
        [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
        [`table_gd.${rowIndex}.gd_undelivered_qty`]:
          orderedQty - totalDeliveredQty,
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(updatedTempData),
      });

      console.log(
        `Row ${rowIndex}: GDPP mode - updated temp_qty_data proportionally`,
      );
      return;
    } catch (error) {
      console.error(
        `Row ${rowIndex}: Error updating GDPP temp_qty_data:`,
        error,
      );
      return;
    }
  }

  // 🔧 NEW: Check if there's existing temp_qty_data from allocation dialog
  const existingTempData = data.table_gd[rowIndex].temp_qty_data;
  const hasExistingAllocation =
    existingTempData &&
    existingTempData !== "[]" &&
    existingTempData.trim() !== "";

  // Get UOM data
  const getUOMData = async (uomId) => {
    if (!uomId) return "";
    try {
      const uomResult = await db
        .collection("unit_of_measurement")
        .where({ id: uomId })
        .get();
      return uomResult?.data?.[0]?.uom_name || "";
    } catch (error) {
      console.error("Error fetching UOM data:", error);
      return "";
    }
  };

  // Get bin location details
  const getBinLocationDetails = async (locationId) => {
    try {
      const binLocationResult = await db
        .collection("bin_location")
        .where({
          id: locationId,
          is_deleted: 0,
        })
        .get();

      if (!binLocationResult?.data?.length) {
        console.error("Bin location not found for ID:", locationId);
        return null;
      }

      return binLocationResult.data[0];
    } catch (error) {
      console.error("Error fetching bin location:", error);
      return null;
    }
  };

  // Process non-item code case
  if (!itemCode && itemDesc) {
    if (quantity < 0 || quantity > undeliveredQty) {
      this.setData({
        [`table_gd.${rowIndex}.gd_undelivered_qty`]: 0,
      });
      return;
    }

    const uomName = await getUOMData(uomId);
    this.setData({
      [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
      [`table_gd.${rowIndex}.gd_undelivered_qty`]:
        orderedQty - totalDeliveredQty,
      [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}`,
    });
    return;
  }

  // Process item with manual allocation for single balance records
  try {
    // Fetch item data
    const itemResult = await db
      .collection("Item")
      .where({ id: itemCode, is_deleted: 0 })
      .get();

    if (!itemResult?.data?.length) {
      console.error(`Row ${rowIndex}: Item not found or deleted`);
      return;
    }

    const itemData = itemResult.data[0];
    const uomName = await getUOMData(uomId);

    // 🔧 NEW: Check if item is serialized
    const isSerializedItem = itemData.serial_number_management === 1;
    const isBatchManagedItem = itemData.item_batch_management === 1;

    console.log(
      `Row ${rowIndex}: Checking manual allocation for material ${itemCode}, quantity ${quantity}`,
    );
    console.log(
      `Item type - Serialized: ${isSerializedItem}, Batch: ${isBatchManagedItem}`,
    );
    console.log(
      `Row ${rowIndex}: Has existing allocation: ${hasExistingAllocation}`,
    );

    let balanceData = null;
    let binLocation = null;
    let batchData = null;
    let serialData = null;

    // 🔧 UPDATED: Handle serialized items
    if (isSerializedItem) {
      console.log(`Row ${rowIndex}: Processing serialized item`);

      // 🔧 NEW: If there's existing allocation data and quantity > 1, preserve it
      if (orderedQty > 1) {
        console.log(`Row ${rowIndex}: Quantity > 1, skipping`);
        return;
      }

      // For serialized items, we need to check if there's exactly one serial available
      const serialBalanceQuery = {
        material_id: itemData.id,
        plant_id: plantId,
        organization_id: organizationId,
      };

      // Add batch filter if item also has batch management
      if (isBatchManagedItem) {
        // Get batch data first
        const batchResult = await db
          .collection("batch")
          .where({
            material_id: itemData.id,
            is_deleted: 0,
            plant_id: plantId,
          })
          .get();

        if (!batchResult?.data?.length) {
          console.error(
            `Row ${rowIndex}: No batches found for serialized item`,
          );
          return;
        }

        if (batchResult.data.length !== 1) {
          console.warn(
            `Row ${rowIndex}: Manual picking requires exactly one batch for serialized item, found: ${batchResult.data.length}`,
          );
          return;
        }

        batchData = batchResult.data[0];
        serialBalanceQuery.batch_id = batchData.id;
      }

      // Get serial balance data
      const serialBalanceResult = await db
        .collection("item_serial_balance")
        .where(serialBalanceQuery)
        .get();

      if (!serialBalanceResult?.data?.length) {
        console.error(`Row ${rowIndex}: No serial balance found`);
        return;
      }

      // For manual allocation, we can only handle when there's exactly the required quantity available
      const availableSerials = serialBalanceResult.data.filter(
        (serial) => parseFloat(serial.unrestricted_qty || 0) > 0,
      );

      if (availableSerials.length < quantity) {
        console.error(
          `Row ${rowIndex}: Not enough serialized items available. Required: ${quantity}, Available: ${availableSerials.length}`,
        );
        return;
      }

      if (quantity !== 1) {
        console.warn(
          `Row ${rowIndex}: Manual allocation for serialized items typically requires quantity of 1, but ${quantity} requested`,
        );
        // 🔧 UPDATED: Only show the message if there's no existing allocation
        if (!hasExistingAllocation) {
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]:
              orderedQty - totalDeliveredQty,
            [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog for serialized items with quantity > 1`,
            [`table_gd.${rowIndex}.temp_qty_data`]: "[]", // Clear any existing temp data
          });
        } else {
          // If there's existing allocation, just update delivery quantities
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]:
              orderedQty - totalDeliveredQty,
          });
        }
        return;
      }

      // 🔧 NEW: Check if there's exactly 1 serial available (single balance scenario)
      if (availableSerials.length !== 1) {
        console.warn(
          `Row ${rowIndex}: Manual allocation requires exactly one serial available, found: ${availableSerials.length}`,
        );
        if (!hasExistingAllocation) {
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]:
              orderedQty - totalDeliveredQty,
            [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog to select serial number`,
            [`table_gd.${rowIndex}.temp_qty_data`]: "[]",
          });
        } else {
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]:
              orderedQty - totalDeliveredQty,
          });
        }
        return;
      }

      // Take the first (and only) available serial
      serialData = availableSerials[0];

      // Create temporary data for serialized item
      const temporaryData = {
        material_id: itemCode,
        serial_number: serialData.serial_number,
        location_id: serialData.location_id,
        unrestricted_qty: serialData.unrestricted_qty,
        reserved_qty: serialData.reserved_qty,
        qualityinsp_qty: serialData.qualityinsp_qty,
        intransit_qty: serialData.intransit_qty,
        block_qty: serialData.block_qty,
        balance_quantity: serialData.balance_quantity,
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
        gd_quantity: quantity,
      };

      // Add batch information if applicable
      if (batchData) {
        temporaryData.batch_id = batchData.id;
      }

      // For serialized items, we don't need location_id in the traditional sense
      // as the serial number is the primary identifier
      let summary = `Total: ${quantity} ${uomName}\n\nDETAILS:\n1. Serial: ${serialData.serial_number}`;
      if (batchData) {
        summary += `\n   [Batch: ${batchData.batch_number}]`;
      }

      // Update data
      this.setData({
        [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
        [`table_gd.${rowIndex}.gd_undelivered_qty`]:
          orderedQty - totalDeliveredQty,
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
      });

      console.log(
        `Row ${rowIndex}: Manual allocation completed for serialized item: ${serialData.serial_number}`,
      );
      return;
    }

    // 🔧 EXISTING: Handle batch-managed items (non-serialized)
    if (isBatchManagedItem) {
      // Get batch data
      const batchResult = await db
        .collection("batch")
        .where({
          material_id: itemData.id,
          is_deleted: 0,
          plant_id: plantId,
        })
        .get();

      if (!batchResult?.data?.length) {
        console.error(`Row ${rowIndex}: No batches found for item`);
        return;
      }

      if (batchResult.data.length !== 1) {
        console.warn(
          `Row ${rowIndex}: Manual picking requires exactly one batch, found: ${batchResult.data.length}`,
        );
        return;
      }

      batchData = batchResult.data[0];

      // Get batch balance
      const batchBalanceResult = await db
        .collection("item_batch_balance")
        .where({
          material_id: itemData.id,
          batch_id: batchData.id,
          plant_id: plantId,
          organization_id: organizationId,
          is_deleted: 0,
        })
        .get();

      if (!batchBalanceResult?.data?.length) {
        console.error(`Row ${rowIndex}: No batch balance found`);
        return;
      }

      if (batchBalanceResult.data.length !== 1) {
        console.error(
          `Row ${rowIndex}: Manual picking requires exactly one batch balance, found: ${batchBalanceResult.data.length}`,
        );
        return;
      }

      balanceData = batchBalanceResult.data[0];
    } else {
      // 🔧 EXISTING: Handle non-batch-managed items (non-serialized)
      const itemBalanceResult = await db
        .collection("item_balance")
        .where({
          plant_id: plantId,
          material_id: itemCode,
          organization_id: organizationId,
          is_deleted: 0,
        })
        .get();

      if (!itemBalanceResult?.data?.length) {
        console.error(`Row ${rowIndex}: No item balance found`);
        return;
      }

      if (itemBalanceResult.data.length !== 1) {
        console.error(
          `Row ${rowIndex}: Manual picking requires exactly one item balance, found: ${itemBalanceResult.data.length}`,
        );
        return;
      }

      balanceData = itemBalanceResult.data[0];
    }

    // Get bin location details (for non-serialized items)
    if (balanceData) {
      const binDetails = await getBinLocationDetails(balanceData.location_id);
      if (!binDetails) {
        console.error(`Row ${rowIndex}: Could not get bin location details`);
        return;
      }

      binLocation = binDetails.bin_location_combine;

      // Create temporary data
      const temporaryData = {
        material_id: itemCode,
        location_id: balanceData.location_id,
        block_qty: balanceData.block_qty,
        reserved_qty: balanceData.reserved_qty,
        unrestricted_qty: balanceData.unrestricted_qty,
        qualityinsp_qty: balanceData.qualityinsp_qty,
        intransit_qty: balanceData.intransit_qty,
        balance_quantity: balanceData.balance_quantity,
        plant_id: plantId,
        organization_id: balanceData.organization_id,
        is_deleted: 0,
        gd_quantity: quantity,
      };

      // Add batch information for batch-managed items
      if (batchData) {
        temporaryData.batch_id = batchData.id;
      }

      // Create summary
      let summary = `Total: ${quantity} ${uomName}\n\nDETAILS:\n1. ${binLocation}: ${quantity} ${uomName}`;
      if (batchData) {
        summary += `\n[Batch: ${batchData.batch_number}]`;
      }

      // Update data
      this.setData({
        [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
        [`table_gd.${rowIndex}.gd_undelivered_qty`]:
          orderedQty - totalDeliveredQty,
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
      });

      console.log(`Row ${rowIndex}: Manual allocation completed successfully`);
      console.log(
        `Row ${rowIndex}: Allocated ${quantity} from ${binLocation}${
          batchData ? ` [${batchData.batch_number}]` : ""
        }`,
      );
    }
  } catch (error) {
    console.error(
      `Row ${rowIndex}: Error processing manual allocation:`,
      error,
    );
  }
})();
