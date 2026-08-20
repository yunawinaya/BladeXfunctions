(async () => {
  // FIX: Helper function to round quantities to 3 decimal places to avoid floating-point precision issues
  const roundQty = (value) => Math.round((parseFloat(value) || 0) * 1000) / 1000;

  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  const quantity = roundQty(data.table_gd[rowIndex].gd_qty);
  const isSelectPicking = data.is_select_picking;

  // Retrieve values from context
  const orderedQty = parseFloat(data.table_gd[rowIndex].gd_order_quantity) || 0;
  const initialDeliveredQty = parseFloat(data.table_gd[rowIndex].gd_initial_delivered_qty) || 0;
  const uomId = data.table_gd[rowIndex].gd_order_uom_id;
  const itemCode = data.table_gd[rowIndex].material_id;
  const itemDesc = data.table_gd[rowIndex].gd_material_desc;
  const plantId = data.plant_id;
  const organizationId = data.organization_id;

  // Calculate undelivered quantity
  const undeliveredQty = roundQty(orderedQty - initialDeliveredQty);
  const totalDeliveredQty = roundQty(quantity + initialDeliveredQty);

  // ==========================================================================
  // ITEM BUNDLES
  // --------------------------------------------------------------------------
  // A bundle row is not an item: it has no material, holds no stock and nothing
  // is delivered against it directly. Its quantity is the number of bundles
  // being delivered, and every item under it follows from that by ratio --
  // their own quantity fields are not editable, so this is the only thing that
  // sets them. A bundle is delivered whole or not at all, which the select
  // stock dialog enforces on the items.
  //
  // A change on an item under a bundle never lands here: those rows are locked.
  // A plain line falls straight through to the ordinary handling below.
  // ==========================================================================
  const currentRow = data.table_gd[rowIndex] || {};

  // A subform row is identified by its fm_key, not by where it sits: the
  // platform resolves `table_gd.<fm_key>.<field>` to that row, which is the
  // only way to reach an item under a bundle -- it is not a row of table_gd at
  // all. Position is kept as a fallback for a row without a key yet.
  const rowPath = currentRow.fm_key
    ? `table_gd.${currentRow.fm_key}`
    : `table_gd.${rowIndex}`;

  // The tree only exists while the form is open. A saved subform is stored
  // flat -- every item under a bundle is a row of table_gd in its own right,
  // carrying its parent's id in parent_id -- so a bundle just added has its
  // items nested under `children`, while the same bundle reopened for edit has
  // them sitting beside it instead. Both shapes arrive here.
  const isChildOf = (row, parent) => {
    if (
      parent.id != null &&
      parent.id !== "" &&
      row.parent_id != null &&
      row.parent_id !== ""
    ) {
      if (String(row.parent_id) === String(parent.id)) return true;
    }

    if (parent.fm_key != null && row.parent_fm_key != null) {
      if (String(row.parent_fm_key) === String(parent.fm_key)) return true;
    }

    return false;
  };

  // Each item with the path it is written back through: its fm_key, which
  // resolves a row wherever it sits, falling back to its own position when it
  // is a row of table_gd that has no key yet. A nested item with no key has no
  // path of its own -- those are the bundles that have to go across as a whole
  // array instead.
  const resolveBundleChildren = (rows, parent, parentIndex) => {
    if (Array.isArray(parent.children) && parent.children.length > 0) {
      return parent.children.map((child) => ({
        row: child,
        path: child.fm_key ? `table_gd.${child.fm_key}` : null,
      }));
    }

    const flat = [];

    rows.forEach((row, index) => {
      if (!row || index === parentIndex) return;
      if (!isChildOf(row, parent)) return;

      flat.push({
        row,
        path: row.fm_key ? `table_gd.${row.fm_key}` : `table_gd.${index}`,
      });
    });

    return flat;
  };

  const bundleChildren = resolveBundleChildren(
    Array.isArray(data.table_gd) ? data.table_gd : [],
    currentRow,
    rowIndex,
  );

  // It is the bundle id that says a row is a bundle, but a row holding no
  // material with items under it is one either way. A line with a material is
  // never a bundle, so an ordinary line is untouched by this.
  const isBundleParentRow =
    !currentRow.material_id &&
    (Boolean(currentRow.item_bundle_id) || bundleChildren.length > 0);

  if (isBundleParentRow) {
    // A bundle row holds no material, so every lookup below -- the item, its
    // balances, its batches -- would go out with an empty id and come back as a
    // conversion error. Nothing is ever allocated against the bundle row, so
    // there is nothing here for it either way.
    if (bundleChildren.length === 0) {
      console.log(
        "item bundle line with no items under it, nothing to spread",
        currentRow.item_bundle_id,
      );

      return;
    }

    // A bundle carries no tolerance of its own, so the most that can be
    // delivered is whatever is still outstanding on the bundle line.
    let effectiveQty = roundQty(Math.max(0, quantity));

    if (effectiveQty > undeliveredQty) {
      effectiveQty = undeliveredQty;

      console.log(
        `Row ${rowIndex}: delivery quantity adjusted to maximum allowed: ${undeliveredQty}`,
      );
    }

    // Delivering two of three outstanding bundles delivers two thirds of every
    // item in them.
    const ratio = undeliveredQty > 0 ? effectiveQty / undeliveredQty : 0;

    const childOutstanding = (child) =>
      roundQty(
        (parseFloat(child.gd_order_quantity) || 0) -
          (parseFloat(child.gd_initial_delivered_qty) || 0),
      );

    // An item cannot be delivered beyond what it still has outstanding,
    // whatever the ratio works out to.
    const childQty = (child) => {
      const outstanding = childOutstanding(child);
      const delivered = roundQty(outstanding * ratio);
      return delivered > outstanding ? outstanding : delivered;
    };

    // Packing quantity and net weight are derived from the line quantity and
    // are not editable, so nothing else will put them right once an item's
    // quantity moves -- the same two formulas recalcPackingWeight runs for an
    // ordinary line.
    const quantitiesFor = (row, delivered) => {
      const already = parseFloat(row.gd_initial_delivered_qty) || 0;
      const ordered = parseFloat(row.gd_order_quantity) || 0;
      const packingConversion = parseFloat(row.packing_conversion) || 1;
      const weightConversion = parseFloat(row.weight_conversion) || 0;

      return {
        gd_qty: delivered,
        gd_delivered_qty: roundQty(already + delivered),
        gd_undelivered_qty: roundQty(ordered - already - delivered),
        packing_qty: packingConversion
          ? roundQty(delivered / packingConversion)
          : 0,
        net_weight: roundQty(delivered * weightConversion),
      };
    };

    const updates = {};

    for (const [field, value] of Object.entries(
      quantitiesFor(currentRow, effectiveQty),
    )) {
      updates[`${rowPath}.${field}`] = value;
    }

    // A nested row that has not been given a key yet cannot be addressed on its
    // own, so those bundles still go across as one array. An item that is a row
    // of table_gd in its own right always has a path.
    if (bundleChildren.every((child) => child.path)) {
      for (const child of bundleChildren) {
        for (const [field, value] of Object.entries(
          quantitiesFor(child.row, childQty(child.row)),
        )) {
          updates[`${child.path}.${field}`] = value;
        }
      }
    } else {
      updates[`${rowPath}.children`] = bundleChildren.map((child) => ({
        ...child.row,
        ...quantitiesFor(child.row, childQty(child.row)),
      }));
    }

    await this.setData(updates);

    console.log("item bundle line", currentRow.item_bundle_id, {
      delivered: effectiveQty,
      outstanding: undeliveredQty,
      ratio,
      children: bundleChildren.map((child) => ({
        material_id: child.row.material_id,
        gd_qty: childQty(child.row),
      })),
    });

    return;
  }

  // Live-update packing qty + net weight from the delivery qty, using the
  // line's stored packing_conversion / weight_conversion (seeded on add).
  // The workflow recomputes these authoritatively on save as well.
  const recalcPackingWeight = (qty) => {
    const line = data.table_gd[rowIndex];
    const packingConversion = parseFloat(line.packing_conversion) || 1;
    const weightConversion = parseFloat(line.weight_conversion) || 0;
    this.setData({
      [`table_gd.${rowIndex}.packing_qty`]: packingConversion
        ? roundQty(qty / packingConversion)
        : 0,
      [`table_gd.${rowIndex}.net_weight`]: roundQty(qty * weightConversion),
    });
  };
  recalcPackingWeight(quantity);

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

      // Fetch item data for UOM conversion factor
      const itemResultGDPP = await db
        .collection("Item")
        .where({ id: itemCode, is_deleted: 0 })
        .get();
      const itemDataGDPP = itemResultGDPP?.data?.[0];
      const getBaseQtyFactorGDPP = (altUOM, itm) => {
        if (!itm || !altUOM || altUOM === itm.based_uom) return 1;
        const conv = itm.table_uom_conversion?.find(
          (c) => c.alt_uom_id === altUOM,
        );
        return conv?.base_qty || 1;
      };
      const baseQtyFactorGDPP = getBaseQtyFactorGDPP(uomId, itemDataGDPP);

      // Calculate total to_quantity (ceiling from PP)
      const totalToQuantity = roundQty(tempDataArray.reduce((sum, item) => {
        return sum + parseFloat(item.to_quantity || 0);
      }, 0));

      // Validate: quantity cannot exceed total to_quantity
      if (quantity > totalToQuantity) {
        console.error(
          `Row ${rowIndex}: Quantity ${quantity} exceeds picked quantity ${totalToQuantity}`,
        );
        this.setData({
          [`table_gd.${rowIndex}.gd_qty`]: totalToQuantity,
        });
        recalcPackingWeight(totalToQuantity);
        alert(
          `Quantity cannot exceed picked quantity from Picking (${totalToQuantity})`,
        );
        return;
      }

      // Calculate proportional distribution
      // Each location gets: (its to_quantity / total to_quantity) * new gd_qty
      const updatedTempData = tempDataArray.map((item) => {
        const itemToQty = parseFloat(item.to_quantity || 0);
        const proportion = itemToQty / totalToQuantity;
        const newGdQty = roundQty(quantity * proportion);

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
          roundQty(orderedQty - totalDeliveredQty),
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(updatedTempData),
        [`table_gd.${rowIndex}.base_qty`]: roundQty(quantity * baseQtyFactorGDPP),
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
        roundQty(orderedQty - totalDeliveredQty),
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

    // UOM conversion factor (base_qty) for the row's order UOM
    const getBaseQtyFactor = (altUOM, itm) => {
      if (!itm || !altUOM || altUOM === itm.based_uom) return 1;
      const conv = itm.table_uom_conversion?.find(
        (c) => c.alt_uom_id === altUOM,
      );
      return conv?.base_qty || 1;
    };
    const baseQtyFactor = getBaseQtyFactor(uomId, itemData);
    const baseQtyValue = roundQty(quantity * baseQtyFactor);

    // Check if HUs exist for this material — if so, skip auto allocation
    // and let the user use the inventory dialog instead
    const huCheckResult = await db
      .collection("handling_unit_atu7sreg_sub")
      .where({
        material_id: itemCode,
        is_deleted: 0,
      })
      .get();

    const hasHU = huCheckResult.data && huCheckResult.data.length > 0;

    if (hasHU) {
      console.log(
        `Row ${rowIndex}: HU exists for material ${itemCode}, skipping auto allocation`,
      );
      this.setData({
        [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
        [`table_gd.${rowIndex}.gd_undelivered_qty`]:
          roundQty(orderedQty - totalDeliveredQty),
        [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
      });
      return;
    }

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

    // Guard: preserve whole-HU allocation data set by inventory dialog
    if (hasExistingAllocation) {
      try {
        const tempArray = JSON.parse(existingTempData);
        const hasHuAllocation = tempArray.some((t) => t.handling_unit_id);
        if (hasHuAllocation) {
          console.log(
            `Row ${rowIndex}: Preserving whole-HU allocation data from inventory dialog`,
          );
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]: roundQty(orderedQty - totalDeliveredQty),
            [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
          });
          return;
        }
      } catch (e) {
        /* ignore parse error, proceed normally */
      }
    }

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
              roundQty(orderedQty - totalDeliveredQty),
            [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog for serialized items with quantity > 1`,
            [`table_gd.${rowIndex}.temp_qty_data`]: "[]", // Clear any existing temp data
            [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
          });
        } else {
          // If there's existing allocation, just update delivery quantities
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]:
              roundQty(orderedQty - totalDeliveredQty),
            [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
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
              roundQty(orderedQty - totalDeliveredQty),
            [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog to select serial number`,
            [`table_gd.${rowIndex}.temp_qty_data`]: "[]",
            [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
          });
        } else {
          this.setData({
            [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
            [`table_gd.${rowIndex}.gd_undelivered_qty`]:
              roundQty(orderedQty - totalDeliveredQty),
            [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
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
          roundQty(orderedQty - totalDeliveredQty),
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
        [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
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
          roundQty(orderedQty - totalDeliveredQty),
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify([temporaryData]),
        [`table_gd.${rowIndex}.base_qty`]: baseQtyValue,
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
