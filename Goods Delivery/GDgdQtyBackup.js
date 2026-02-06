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

  // Calculate total delivered quantity
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

  // ============================================================================
  // MANUAL ALLOCATION REMOVED
  // Allocation logic has been moved to the workflow (runs during GD save)
  // Only update delivery quantities here - allocation happens during save
  // ============================================================================

  // Simply update delivery quantities - allocation will happen in workflow when saving
  this.setData({
    [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
    [`table_gd.${rowIndex}.gd_undelivered_qty`]: orderedQty - totalDeliveredQty,
  });

  console.log(
    `Row ${rowIndex}: Updated quantities - gd_qty: ${quantity}, delivered: ${totalDeliveredQty}, undelivered: ${orderedQty - totalDeliveredQty}`,
  );
  console.log(
    `Row ${rowIndex}: Allocation will be performed during save workflow`,
  );
})();
