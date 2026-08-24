(async () => {
  // Helper function to round quantities to 3 decimal places to avoid floating-point precision issues
  const roundQty = (value) =>
    Math.round((parseFloat(value) || 0) * 1000) / 1000;

  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  // FIX: Parse to_qty as number to avoid string concatenation issues
  const quantity = roundQty(data.table_to[rowIndex].to_qty);

  // Retrieve values from context
  const orderedQty = parseFloat(data.table_to[rowIndex].to_order_quantity) || 0;
  const initialDeliveredQty =
    parseFloat(data.table_to[rowIndex].to_initial_delivered_qty) || 0;
  const uomId = data.table_to[rowIndex].to_order_uom_id;
  const itemCode = data.table_to[rowIndex].material_id;
  const itemDesc = data.table_to[rowIndex].to_material_desc;
  const plantId = data.plant_id;
  const organizationId = data.organization_id;

  // Calculate undelivered quantity
  const undeliveredQty = roundQty(orderedQty - initialDeliveredQty);
  const totalDeliveredQty = roundQty(quantity + initialDeliveredQty);

  // 🔧 NEW: Check if there's existing temp_qty_data from allocation dialog
  const existingTempData = data.table_to[rowIndex].temp_qty_data;
  const hasExistingAllocation =
    existingTempData &&
    existingTempData !== "[]" &&
    existingTempData.trim() !== "";

  // An item bundle parent is not an item: it has no material, holds no stock and
  // nothing is picked against it directly. Its quantity is the number of bundles
  // planned, and every item under it follows from that -- planning 2 of a bundle
  // holding 2 of item A and 3 of item B plans 4 of A and 6 of B. The items' own
  // quantity fields are locked, so this is the only thing that sets them.
  //
  // rowIndex addresses the top-level rows, so a change on an item under a bundle
  // lands on a row that is not a bundle parent and falls through to the ordinary
  // handling below, exactly as any other line does.
  const currentRow = data.table_to[rowIndex] || {};

  // A subform row is identified by its fm_key, not by where it sits: the
  // platform resolves `table_to.<fm_key>.<field>` to that row. rowIndex is what
  // the event hands over and is fine for reading the row out of the array, but
  // every write below addresses it by key. Position is kept as a fallback for a
  // row that has not been given a key yet.
  const rowPath = currentRow.fm_key
    ? `table_to.${currentRow.fm_key}`
    : `table_to.${rowIndex}`;

  // Rebuilding the allocation from a single balance row is only safe while nothing
  // has been picked against the line. Convert to Picking works out what is left by
  // subtracting picked_temp_qty_data from temp_qty_data key by key, so a key that
  // is dropped here is re-offered as quantity to pick a second time -- stock that
  // is already off the shelf. Keep every picked key as a floor and put only the
  // remainder on the newly chosen bin.
  const allocationKey = (entry) =>
    [
      entry.location_id || "",
      entry.batch_id || "",
      entry.handling_unit_id || "",
    ].join("|");

  const allocationRespectingPicked = (fresh) => {
    let picked = [];
    try {
      picked = JSON.parse(currentRow.picked_temp_qty_data || "[]") || [];
    } catch (error) {
      picked = [];
    }
    if (!Array.isArray(picked) || !picked.length) {
      return { allocation: [fresh], preserved: 0 };
    }

    const floors = [];
    const byKey = {};
    picked.forEach((entry) => {
      const qty = roundQty(entry.to_quantity);
      if (qty <= 0) return;
      const key = allocationKey(entry);
      if (byKey[key]) {
        byKey[key].to_quantity = roundQty(byKey[key].to_quantity + qty);
        return;
      }
      const floor = Object.assign({}, entry, { to_quantity: qty });
      byKey[key] = floor;
      floors.push(floor);
    });
    if (!floors.length) return { allocation: [fresh], preserved: 0 };

    const pickedTotal = roundQty(
      floors.reduce((sum, entry) => sum + entry.to_quantity, 0),
    );
    const freshKey = allocationKey(fresh);

    // Below what is already picked there is no allocation that both covers the
    // picked stock and totals the requested quantity. Keep the picked floors --
    // the save refuses the reduction and names the shortfall.
    const remainder = roundQty(quantity - pickedTotal);
    if (remainder < 0) return { allocation: floors, preserved: pickedTotal };

    if (byKey[freshKey]) {
      Object.assign(byKey[freshKey], fresh, {
        to_quantity: roundQty(byKey[freshKey].to_quantity + remainder),
      });
    } else if (remainder > 0) {
      floors.push(Object.assign({}, fresh, { to_quantity: remainder }));
    }
    return { allocation: floors, preserved: pickedTotal };
  };

  // A reference is an object in the form model and a plain id once stored.
  const referenceId = (value) => {
    if (value && typeof value === "object") return value.id || null;
    return value || null;
  };

  const isBundleParentRow =
    Boolean(currentRow.item_bundle_id) && !currentRow.material_id;

  // The items under a bundle, each with the path that addresses it. They arrive
  // nested under `children` when the plan was just built, and as flat rows
  // pointing back through parent_id / parent_fm_key once it has been stored --
  // both shapes mean the same thing. Mirrors getBundleChildren on the sales order.
  const getBundleChildren = (rows, parent, parentIndex) => {
    if (Array.isArray(parent.children) && parent.children.length > 0) {
      return parent.children.map((child, childIndex) => ({
        row: child,
        path: child.fm_key
          ? `table_to.${child.fm_key}`
          : `${rowPath}.children.${childIndex}`,
      }));
    }

    const isChildOf = (row) => {
      if (parent.id != null && row.parent_id != null) {
        if (String(row.parent_id) === String(parent.id)) return true;
      }

      if (parent.fm_key != null && row.parent_fm_key != null) {
        if (String(row.parent_fm_key) === String(parent.fm_key)) return true;
      }

      return false;
    };

    const flatChildren = [];

    (rows || []).forEach((row, index) => {
      if (index === parentIndex) return;
      if (!isChildOf(row)) return;

      flatChildren.push({
        row,
        path: row.fm_key ? `table_to.${row.fm_key}` : `table_to.${index}`,
      });
    });

    return flatChildren;
  };

  // What one bundle holds, read from the bundle itself rather than from the rows.
  // The rows cannot be used for this: an item under a bundle is never edited by
  // hand, so its quantity is always the bundle's own times the number of bundles,
  // and the bundle is where that number lives. Keyed by item and kept in the
  // order the bundle lists them, so a bundle holding the same item on two lines
  // still lines up.
  const fetchBundleQuantities = async (bundleId) => {
    if (!bundleId) return null;

    const resBundle = await db.collection("item_bundle").doc(bundleId).get();
    const bundleLines = resBundle?.data?.[0]?.table_ib || [];

    if (bundleLines.length === 0) {
      console.log("item bundle has no lines", bundleId);
      return null;
    }

    const byItem = new Map();

    for (const line of bundleLines) {
      const key = String(line.item_id ?? "");
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(parseFloat(line.quantity) || 0);
    }

    return byItem;
  };

  if (isBundleParentRow) {
    const bundleChildren = getBundleChildren(
      data.table_to,
      currentRow,
      rowIndex,
    );

    if (bundleChildren.length === 0) {
      console.log("item bundle line has no items", currentRow.item_bundle_id);
      return;
    }

    const perBundle = await fetchBundleQuantities(
      referenceId(currentRow.item_bundle_id),
    );

    if (!perBundle) return;

    // How many bundles each item can still cover, at that item's own rate. The
    // bundle can be planned no further than its tightest item -- the bundle row
    // carries no outstanding of its own, since its sales order line is a header
    // that never receives a planned quantity.
    const taken = new Map();
    const planned = [];
    let maxBundles = null;

    for (const { row, path } of bundleChildren) {
      const key = String(row.material_id ?? "");
      const quantities = perBundle.get(key) || [];
      const position = taken.get(key) || 0;

      taken.set(key, position + 1);

      if (position >= quantities.length) {
        // The bundle no longer lists this item -- leave the row as it stands
        // rather than guessing at a quantity for it.
        console.log(
          "no bundle line for item",
          key,
          "on",
          currentRow.item_bundle_id,
        );
        continue;
      }

      const perBundleQty = quantities[position];
      const outstanding = roundQty(
        (parseFloat(row.to_order_quantity) || 0) -
          (parseFloat(row.to_initial_delivered_qty) || 0),
      );
      const coverable = perBundleQty > 0 ? outstanding / perBundleQty : 0;

      if (maxBundles === null || coverable < maxBundles) maxBundles = coverable;

      planned.push({ row, path, perBundleQty });
    }

    if (planned.length === 0) {
      console.log("no bundle lines matched", currentRow.item_bundle_id);
      return;
    }

    let effectiveQty = roundQty(Math.max(0, quantity));

    if (maxBundles !== null && effectiveQty > maxBundles) {
      effectiveQty = roundQty(maxBundles);

      console.log(
        `Row ${rowIndex}: planned quantity adjusted to maximum allowed: ${effectiveQty}`,
      );
    }

    const quantitiesFor = (row, plannedQty) => {
      const delivered = parseFloat(row.to_initial_delivered_qty) || 0;
      const ordered = parseFloat(row.to_order_quantity) || 0;

      return {
        to_qty: plannedQty,
        to_delivered_qty: roundQty(delivered + plannedQty),
        to_undelivered_qty: roundQty(ordered - delivered - plannedQty),
      };
    };

    const updates = {};

    for (const [field, value] of Object.entries(
      quantitiesFor(currentRow, effectiveQty),
    )) {
      updates[`${rowPath}.${field}`] = value;
    }

    for (const { row, path, perBundleQty } of planned) {
      const childQty = roundQty(perBundleQty * effectiveQty);

      for (const [field, value] of Object.entries(
        quantitiesFor(row, childQty),
      )) {
        updates[`${path}.${field}`] = value;
      }
    }

    await this.setData(updates);

    console.log("item bundle line", currentRow.item_bundle_id, {
      planned: effectiveQty,
      maxBundles,
      children: planned.map(({ row, perBundleQty }) => ({
        material_id: row.material_id,
        to_qty: roundQty(perBundleQty * effectiveQty),
      })),
    });

    return;
  }

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
        [`${rowPath}.to_undelivered_qty`]: 0,
      });
      return;
    }

    const uomName = await getUOMData(uomId);
    this.setData({
      [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
      [`${rowPath}.to_undelivered_qty`]: roundQty(
        orderedQty - totalDeliveredQty,
      ),
      [`${rowPath}.view_stock`]: `Total: ${quantity} ${uomName}`,
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
            [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
            [`${rowPath}.to_undelivered_qty`]: roundQty(
              orderedQty - totalDeliveredQty,
            ),
            [`${rowPath}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog for serialized items with quantity > 1`,
            [`${rowPath}.temp_qty_data`]: "[]", // Clear any existing temp data
          });
        } else {
          // If there's existing allocation, just update delivery quantities
          this.setData({
            [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
            [`${rowPath}.to_undelivered_qty`]: roundQty(
              orderedQty - totalDeliveredQty,
            ),
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
            [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
            [`${rowPath}.to_undelivered_qty`]: roundQty(
              orderedQty - totalDeliveredQty,
            ),
            [`${rowPath}.view_stock`]: `Total: ${quantity} ${uomName}\n\nPlease use allocation dialog to select serial number`,
            [`${rowPath}.temp_qty_data`]: "[]",
          });
        } else {
          this.setData({
            [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
            [`${rowPath}.to_undelivered_qty`]: roundQty(
              orderedQty - totalDeliveredQty,
            ),
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
      const { allocation, preserved } =
        allocationRespectingPicked(temporaryData);
      if (preserved > 0) {
        summary += `\n\nNote: ${preserved} ${uomName} already picked is kept in this allocation.`;
      }

      this.setData({
        [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
        [`${rowPath}.to_undelivered_qty`]: roundQty(
          orderedQty - totalDeliveredQty,
        ),
        [`${rowPath}.view_stock`]: summary,
        [`${rowPath}.temp_qty_data`]: JSON.stringify(allocation),
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
      const { allocation, preserved } =
        allocationRespectingPicked(temporaryData);
      if (preserved > 0) {
        summary += `\n\nNote: ${preserved} ${uomName} already picked is kept in this allocation.`;
      }

      this.setData({
        [`${rowPath}.to_delivered_qty`]: totalDeliveredQty,
        [`${rowPath}.to_undelivered_qty`]: roundQty(
          orderedQty - totalDeliveredQty,
        ),
        [`${rowPath}.view_stock`]: summary,
        [`${rowPath}.temp_qty_data`]: JSON.stringify(allocation),
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
