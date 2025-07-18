(async () => {
  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  const quantity = data.table_gd[rowIndex].gd_qty;

  // Retrieve values from context
  const orderedQty = data.table_gd[rowIndex].gd_order_quantity;
  const initialDeliveredQty = data.table_gd[rowIndex].gd_initial_delivered_qty;
  const uomId = data.table_gd[rowIndex].gd_order_uom_id;
  const itemCode = data.table_gd[rowIndex].material_id;
  const itemDesc = data.table_gd[rowIndex].gd_material_desc;
  const plantId = data.plant_id;

  // Calculate undelivered quantity
  const undeliveredQty = orderedQty - initialDeliveredQty;
  const totalDeliveredQty = quantity + initialDeliveredQty;

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

    console.log(
      `Row ${rowIndex}: Checking manual allocation for material ${itemCode}, quantity ${quantity}`
    );

    let balanceData = null;
    let binLocation = null;
    let batchData = null;

    // Handle batch-managed items
    if (itemData.item_batch_management === 1) {
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
          `Row ${rowIndex}: Manual picking requires exactly one batch, found: ${batchResult.data.length}`
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
          is_deleted: 0,
        })
        .get();

      if (!batchBalanceResult?.data?.length) {
        console.error(`Row ${rowIndex}: No batch balance found`);
        return;
      }

      if (batchBalanceResult.data.length !== 1) {
        console.error(
          `Row ${rowIndex}: Manual picking requires exactly one batch balance, found: ${batchBalanceResult.data.length}`
        );
        return;
      }

      balanceData = batchBalanceResult.data[0];
    } else if (itemData.item_batch_management === 0) {
      // Handle non-batch-managed items
      const itemBalanceResult = await db
        .collection("item_balance")
        .where({
          plant_id: plantId,
          material_id: itemCode,
          is_deleted: 0,
        })
        .get();

      if (!itemBalanceResult?.data?.length) {
        console.error(`Row ${rowIndex}: No item balance found`);
        return;
      }

      if (itemBalanceResult.data.length !== 1) {
        console.error(
          `Row ${rowIndex}: Manual picking requires exactly one item balance, found: ${itemBalanceResult.data.length}`
        );
        return;
      }

      balanceData = itemBalanceResult.data[0];
    } else {
      console.error(
        `Row ${rowIndex}: Invalid item batch management value: ${itemData.item_batch_management}`
      );
      return;
    }

    // Get bin location details
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
      summary += `\n[${batchData.batch_number}]`;
    }

    // Update data
    this.setData({
      [`table_gd.${rowIndex}.view_stock`]: summary,
      [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
    });

    console.log(`Row ${rowIndex}: Manual allocation completed successfully`);
    console.log(
      `Row ${rowIndex}: Allocated ${quantity} from ${binLocation}${
        batchData ? ` [${batchData.batch_number}]` : ""
      }`
    );
  } catch (error) {
    console.error(
      `Row ${rowIndex}: Error processing manual allocation:`,
      error
    );
  }
})();
