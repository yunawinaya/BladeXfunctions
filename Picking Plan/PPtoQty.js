(async () => {
  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  const quantity = data.table_to[rowIndex].to_qty;

  // Retrieve values from context
  const orderedQty = data.table_to[rowIndex].to_order_quantity;
  const initialDeliveredQty = data.table_to[rowIndex].to_initial_delivered_qty;
  const uomId = data.table_to[rowIndex].to_order_uom_id;
  const itemCode = data.table_to[rowIndex].material_id;
  const itemDesc = data.table_to[rowIndex].to_material_desc;
  const plantId = data.plant_id;
  const organizationId = data.organization_id;

  // Calculate undelivered quantity
  const undeliveredQty = orderedQty - initialDeliveredQty;
  const totalDeliveredQty = quantity + initialDeliveredQty;

  // 🔧 NEW: Check if there's existing temp_qty_data from allocation dialog
  const existingTempData = data.table_to[rowIndex].temp_qty_data;
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
        [`table_to.${rowIndex}.to_undelivered_qty`]: 0,
      });
      return;
    }

    const uomName = await getUOMData(uomId);
    this.setData({
      [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
      [`table_to.${rowIndex}.to_undelivered_qty`]:
        orderedQty - totalDeliveredQty,
      [`table_to.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}`,
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
            [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
            [`table_to.${rowIndex}.to_undelivered_qty`]:
              orderedQty - totalDeliveredQty,
            [`table_to.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog for serialized items with quantity > 1`,
            [`table_to.${rowIndex}.temp_qty_data`]: "[]", // Clear any existing temp data
          });
        } else {
          // If there's existing allocation, just update delivery quantities
          this.setData({
            [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
            [`table_to.${rowIndex}.to_undelivered_qty`]:
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
            [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
            [`table_to.${rowIndex}.to_undelivered_qty`]:
              orderedQty - totalDeliveredQty,
            [`table_to.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog to select serial number`,
            [`table_to.${rowIndex}.temp_qty_data`]: "[]",
          });
        } else {
          this.setData({
            [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
            [`table_to.${rowIndex}.to_undelivered_qty`]:
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
        to_quantity: quantity,
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
        [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
        [`table_to.${rowIndex}.to_undelivered_qty`]:
          orderedQty - totalDeliveredQty,
        [`table_to.${rowIndex}.view_stock`]: summary,
        [`table_to.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
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
        to_quantity: quantity,
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
        [`table_to.${rowIndex}.to_delivered_qty`]: totalDeliveredQty,
        [`table_to.${rowIndex}.to_undelivered_qty`]:
          orderedQty - totalDeliveredQty,
        [`table_to.${rowIndex}.view_stock`]: summary,
        [`table_to.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
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
