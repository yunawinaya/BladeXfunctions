(async () => {
  // Extract input parameters
  const { value: quantity, rowIndex } = arguments[0];

  // Retrieve values from context
  const orderedQty = this.getValue(`table_gd.${rowIndex}.gd_order_quantity`);
  const initialDeliveredQty = this.getValue(
    `table_gd.${rowIndex}.gd_initial_delivered_qty`
  );
  const uomId = this.getValue(`table_gd.${rowIndex}.gd_order_uom_id`);
  const itemCode = this.getValue(`table_gd.${rowIndex}.material_id`);
  const itemDesc = this.getValue(`table_gd.${rowIndex}.gd_material_desc`);
  const plantId = this.getValue("plant_id");

  // Calculate undelivered quantity
  const undeliveredQty = orderedQty - initialDeliveredQty;

  // Calculate total delivered quantity
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

  // Process non-item code case
  if (!itemCode && itemDesc) {
    // Validate quantity
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

  // Process item with batch management
  const processItem = async () => {
    try {
      // Fetch item data
      const itemResult = await db
        .collection("item")
        .where({ id: itemCode, is_deleted: 0 })
        .get();
      if (!itemResult?.data?.length) {
        console.error("Item not found or deleted");
        return;
      }

      const itemData = itemResult.data[0];
      const uomName = await getUOMData(uomId);
      const tempQtyData = [];
      let summary = "";

      const pickingSetupResponse = await db
        .collection("picking_setup")
        .where({ plant_id: plantId, movement_type: "Good Delivery" })
        .get();
      const pickingMode = pickingSetupResponse.data[0].picking_mode;
      const defaultStrategy = pickingSetupResponse.data[0].default_strategy_id;
      const fallbackStrategy =
        pickingSetupResponse.data[0].fallback_strategy_id;

      let defaultBin;

      if (pickingMode === "Auto" && defaultStrategy === "FIXED BIN") {
        console.log("Auto picking mode and fixed bin strategy");
        console.log(itemData.table_default_bin);

        defaultBin = itemData.table_default_bin?.find(
          (bin) => bin.plant_id === plantId
        ).bin_location;
      }

      // Handle batch-managed items
      if (itemData.item_batch_management === 1) {
        const batchResult = await db
          .collection("batch")
          .where({
            material_id: itemData.id,
            is_deleted: 0,
            plant_id: plantId,
          })
          .get();

        if (batchResult?.data?.length !== 1 && pickingMode === "Manual") {
          console.log("expected one batch");
          return;
        }

        const batchData = batchResult.data[0];
        const batchBalanceResult =
          pickingMode === "Manual"
            ? await db
                .collection("item_batch_balance")
                .where({
                  material_id: itemData.id,
                  batch_id: batchData.id,
                  is_deleted: 0,
                })
                .get()
            : await db
                .collection("item_batch_balance")
                .where({
                  material_id: itemData.id,
                  is_deleted: 0,
                })
                .get();

        if (!batchBalanceResult?.data?.length) {
          console.error("No batch balance found");
          return;
        }

        let batchBalanceData =
          pickingMode === "Auto" && defaultStrategy === "FIXED BIN"
            ? batchBalanceResult.data
            : batchBalanceResult.data[0];

        if (pickingMode === "Auto" && defaultBin) {
          batchBalanceData = batchBalanceData.find(
            (bin) => bin.location_id === defaultBin
          );

          if (!batchBalanceData && fallbackStrategy === "RANDOM") {
            batchBalanceData = batchBalanceResult.data[0];
          }
        }

        const binLocationResult = await db
          .collection("bin_location")
          .where({
            id: batchBalanceData.location_id,
            is_deleted: 0,
          })
          .get();

        const temporaryData = {
          material_id: itemCode,
          location_id: batchBalanceData.location_id,
          block_qty: batchBalanceData.block_qty,
          reserved_qty: batchBalanceData.reserved_qty,
          unrestricted_qty: batchBalanceData.unrestricted_qty,
          qualityinsp_qty: batchBalanceData.qualityinsp_qty,
          intransit_qty: batchBalanceData.intransit_qty,
          balance_quantity: batchBalanceData.balance_quantity,
          batch_id: batchData.id,
          plant_id: plantId,
          organization_id: batchBalanceData.organization_id,
          is_deleted: 0,
          gd_quantity: quantity,
        };

        tempQtyData.push(JSON.stringify(temporaryData));

        if (binLocationResult?.data?.length) {
          const binLocation = binLocationResult.data[0].bin_location_combine;
          summary = `Total: ${quantity} ${uomName}\n\nDETAILS:\n1. ${binLocation}: ${quantity} ${uomName}\n[${batchData.batch_number}]`;
        }

        // Handle non-batch-managed items
      } else if (itemData.item_batch_management === 0) {
        const resItemBalance = await db
          .collection("item_balance")
          .where({ plant_id: plantId, material_id: itemCode, is_deleted: 0 })
          .get();

        if (resItemBalance?.data?.length !== 1) {
          return;
        }

        const balanceData = resItemBalance.data[0];

        const binLocationResult = await db
          .collection("bin_location")
          .where({
            id: balanceData.location_id,
            is_deleted: 0,
          })
          .get();

        if (binLocationResult?.data?.length !== 1) {
          return;
        }

        const binLocation = binLocationResult?.data[0]?.bin_location_combine;

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

        tempQtyData.push(temporaryData);
        summary = `Total: ${quantity} ${uomName}\n\nDETAILS:\n1. ${binLocation}: ${quantity} ${uomName}`;
      } else {
        console.error("Invalid item batch management value");
        return;
      }

      console.log("set data", summary);

      let orderLimit = undeliveredQty;
      if (itemData.over_delivery_tolerance > 0) {
        orderLimit =
          undeliveredQty +
          undeliveredQty * (itemData.over_delivery_tolerance / 100);
      }

      let gdUndeliveredQty = 0;

      if (quantity > undeliveredQty) {
        gdUndeliveredQty = 0;
        console.log(`${quantity} larger than ${undeliveredQty}`);
      } else {
        gdUndeliveredQty = orderedQty - totalDeliveredQty;
      }

      // Update data
      setTimeout(() => {
        this.setData({
          [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
          [`table_gd.${rowIndex}.gd_undelivered_qty`]: gdUndeliveredQty,
          [`table_gd.${rowIndex}.view_stock`]: summary,
          [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(tempQtyData),
        });
      }, 100);
    } catch (error) {
      console.error("Error processing item:", error);
    }
  };

  // Execute item processing if plantId exists
  if (plantId) {
    await processItem();
  }
})();
