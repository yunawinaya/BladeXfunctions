// FIX: Helper function to round quantities to 3 decimal places to avoid floating-point precision issues
const roundQty = (value) => Math.round((parseFloat(value) || 0) * 1000) / 1000;

// Helper function to convert quantity from alt UOM to base UOM
const convertToBaseUOM = (quantity, altUOM, itemData) => {
  if (!altUOM || altUOM === itemData.based_uom) {
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

if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

const createTableGdWithBaseUOM = async (allItems) => {
  const processedItems = [];

  // Helper function to add gd_quantity to temp_qty_data
  const addGdQuantityToTempData = (tempQtyDataString) => {
    if (!tempQtyDataString) return null;

    try {
      const tempDataArray = JSON.parse(tempQtyDataString);

      // Add gd_quantity to each item in temp_qty_data
      // Preserve existing gd_quantity (e.g. remainingQty from partial delivery), only default to to_quantity if not set
      const updatedTempData = tempDataArray.map((item) => ({
        ...item,
        gd_quantity:
          item.gd_quantity != null ? item.gd_quantity : item.to_quantity || 0,
      }));

      return JSON.stringify(updatedTempData);
    } catch (error) {
      console.error("Error parsing temp_qty_data:", error);
      return tempQtyDataString; // Return original if parse fails
    }
  };

  for (const item of allItems) {
    // Check if item is serialized
    let itemData = null;
    if (item.itemId) {
      try {
        const res = await db
          .collection("Item")
          .where({ id: item.itemId })
          .get();
        itemData = res.data?.[0];
      } catch (error) {
        console.error(`Error fetching item data for ${item.itemId}:`, error);
      }
    }

    // GD Quantity Logic for PP:
    // - gd_order_quantity = Original SO qty (to_order_quantity)
    // - plan_qty = Remaining to deliver (to_qty - gd_delivered_qty)
    // - gd_qty = Auto-allocated to remaining qty
    // - gd_initial_delivered_qty = Already delivered (gd_delivered_qty from PP)
    // - gd_delivered_qty = Total picked qty (to_qty)
    // - gd_undelivered_qty = SO qty - picked qty (gap between ordered and picked)

    const soOrderedQty = parseFloat(item.orderedQty) || 0; // to_order_quantity (10)
    const pickedQty = parseFloat(item.pickedQty) || 0; // to_qty (8)
    const alreadyDelivered = parseFloat(item.deliveredQty) || 0; // gd_delivered_qty from PP (5 after first GD)
    const remainingToDeliver = roundQty(pickedQty - alreadyDelivered); // 8 - 5 = 3
    const undeliveredQty = roundQty(soOrderedQty - pickedQty); // 10 - 8 = 2

    // If serialized, convert to base UOM
    if (itemData?.serial_number_management === 1) {
      const soOrderedQtyBase = roundQty(
        convertToBaseUOM(soOrderedQty, item.altUOM, itemData),
      );
      const pickedQtyBase = roundQty(
        convertToBaseUOM(pickedQty, item.altUOM, itemData),
      );
      const alreadyDeliveredBase = roundQty(
        convertToBaseUOM(alreadyDelivered, item.altUOM, itemData),
      );
      const remainingToDeliverBase = roundQty(
        convertToBaseUOM(remainingToDeliver, item.altUOM, itemData),
      );
      const undeliveredQtyBase = roundQty(
        convertToBaseUOM(undeliveredQty, item.altUOM, itemData),
      );

      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: soOrderedQtyBase, // Original SO qty in base UOM
        plan_qty: remainingToDeliverBase, // Remaining to deliver (to_qty - gd_delivered_qty)
        gd_qty: remainingToDeliverBase, // Auto-allocated to remaining qty
        gd_initial_delivered_qty: alreadyDeliveredBase, // Already delivered (gd_delivered_qty)
        gd_delivered_qty: pickedQtyBase, // Total picked qty (to_qty)
        gd_undelivered_qty: undeliveredQtyBase, // Gap between SO and picked
        gd_order_uom_id: itemData.based_uom, // Base UOM
        good_delivery_uom_id: itemData.based_uom, // Base UOM
        base_uom_id: itemData.based_uom,
        base_qty: remainingToDeliverBase, // gd_qty in base UOM
        unit_price: item.unit_price || 0,
        total_price: item.total_price || 0,
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        // Picking Plan reference
        line_pp_id: item.pp_id,
        pp_line_item_id: item.pp_line_id,
        // Picking (transfer_order) reference
        line_to_id: item.picking_id,
        line_to_no: item.picking_no,
        item_category_id: item.item_category_id,
        temp_qty_data: addGdQuantityToTempData(item.temp_qty_data),
        plan_temp_qty_data: item.temp_qty_data,
        view_stock: item.view_stock,
        plan_view_stock: item.view_stock,
        fifo_sequence: item.fifo_sequence,
        item_costing_method: item.item_costing_method,
        plant_id: item.plant_id,
        customer_id: item.customer_id,
        is_force_complete: item.is_force_complete,
        picking_status: item.picking_status,
      });
    } else {
      // Non-serialized items keep original UOM
      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: soOrderedQty, // Original SO qty
        plan_qty: remainingToDeliver, // Remaining to deliver (to_qty - gd_delivered_qty)
        gd_qty: remainingToDeliver, // Auto-allocated to remaining qty
        gd_initial_delivered_qty: alreadyDelivered, // Already delivered (gd_delivered_qty)
        gd_delivered_qty: pickedQty, // Total picked qty (to_qty)
        gd_undelivered_qty: undeliveredQty, // Gap between SO and picked
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        base_uom_id: item.baseUOM,
        base_qty: roundQty(
          convertToBaseUOM(remainingToDeliver, item.altUOM, itemData || {}),
        ), // gd_qty in base UOM
        unit_price: item.unit_price || 0,
        total_price: item.total_price || 0,
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        // Picking Plan reference
        line_pp_id: item.pp_id,
        pp_line_item_id: item.pp_line_id,
        // Picking (transfer_order) reference
        line_to_id: item.picking_id,
        line_to_no: item.picking_no,
        item_category_id: item.item_category_id,
        temp_qty_data: addGdQuantityToTempData(item.temp_qty_data),
        plan_temp_qty_data: item.temp_qty_data,
        view_stock: item.view_stock,
        plan_view_stock: item.view_stock,
        fifo_sequence: item.fifo_sequence,
        item_costing_method: item.item_costing_method,
        plant_id: item.plant_id,
        customer_id: item.customer_id,
        is_force_complete: item.is_force_complete,
        picking_status: item.picking_status,
      });
    }
  }

  return processedItems;
};

(async () => {
  const referenceType = this.getValue(`dialog_select_picking.reference_type`);
  const previousReferenceType = this.getValue("reference_type");
  const currentItemArray = this.getValue(`dialog_select_picking.item_array`);
  let existingGD = this.getValue("table_gd");
  const customerName = this.getValue("customer_name");

  console.log("currentItemArray", currentItemArray);
  console.log("referenceType", referenceType);
  console.log("previousReferenceType", previousReferenceType);
  console.log("existingGD", existingGD);
  console.log("customerName", customerName);

  // Reset global allocation tracker when starting fresh (no existing data)
  if (!window.globalAllocationTracker) {
    window.globalAllocationTracker = new Map();
  } else if (!existingGD || existingGD.length === 0) {
    // Clear tracker only when no existing GD data (fresh start)
    window.globalAllocationTracker.clear();
  }

  let allItems = [];
  let salesOrderNumber = [];
  let pickingNumber = [];
  let soId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one sales order / item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  if (previousReferenceType && previousReferenceType !== referenceType) {
    await this.$confirm(
      `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Reference Type Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGD = [];
  }

  const parseCustomerId = (id) => {
    if (Array.isArray(id)) return id[0];
    if (typeof id === "string" && id.startsWith("[") && id.endsWith("]"))
      return id.slice(1, -1);
    return id;
  };

  const uniqueCustomer = new Set(
    currentItemArray.map((item) => parseCustomerId(item.customer_id)),
  );
  const allSameCustomer = uniqueCustomer.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Deliver item(s) to more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    return;
  }

  if (customerName && customerName !== [...uniqueCustomer][0]) {
    await this.$confirm(
      `You've selected a different customer than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Customer Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGD = [];
  }

  this.closeDialog("dialog_select_picking");
  this.showLoading();

  // ========================================================================
  // Step 1: Batch fetch SO data for original order quantities
  // SO line data is embedded in sales_order.table_so
  // ========================================================================
  const allSoIds = [];
  if (referenceType === "Document") {
    // Document mode: SO IDs are in picking_record_data
    for (const picking of currentItemArray) {
      for (const record of picking.picking_record_data || []) {
        if (record.so_id) allSoIds.push(record.so_id);
      }
    }
  } else {
    // Item mode: SO IDs are directly in currentItemArray
    for (const item of currentItemArray) {
      if (item.so_id) allSoIds.push(item.so_id);
    }
  }

  const soLineMap = new Map(); // Maps so_line_id -> { so_quantity, ... }
  if (allSoIds.length > 0) {
    const uniqueSoIds = [...new Set(allSoIds)];
    try {
      const soResult = await db
        .collection("sales_order")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [{ prop: "id", operator: "in", value: uniqueSoIds }],
          },
        ])
        .get();

      // Build map from so_line_id to line item data
      (soResult.data || []).forEach((so) => {
        (so.table_so || []).forEach((line) => {
          soLineMap.set(line.id, line);
        });
      });
      console.log(
        `Fetched ${soResult.data?.length || 0} SO documents, mapped ${soLineMap.size} SO lines`,
      );
    } catch (error) {
      console.error("Error fetching SO data:", error);
    }
  }

  // ========================================================================
  // Step 2: Collect all location and batch IDs for batch fetching
  // ========================================================================
  const allLocationIds = new Set();
  const allBatchIds = new Set();
  const allUomIds = new Set();

  if (referenceType === "Document") {
    for (const picking of currentItemArray) {
      for (const record of picking.picking_record_data || []) {
        if (record.target_location) allLocationIds.add(record.target_location);
        if (record.batch_no) allBatchIds.add(record.batch_no);
        if (record.target_batch) allBatchIds.add(record.target_batch);
        if (record.item_uom) allUomIds.add(record.item_uom);
      }
    }
  } else {
    for (const item of currentItemArray) {
      if (item.location_id) allLocationIds.add(item.location_id);
      if (item.batch_no) allBatchIds.add(item.batch_no);
      if (item.uom_id) allUomIds.add(item.uom_id);
    }
  }

  // Batch fetch location names
  const locationMap = new Map();
  if (allLocationIds.size > 0) {
    try {
      const locationResult = await db
        .collection("bin_location")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "id", operator: "in", value: [...allLocationIds] },
            ],
          },
        ])
        .get();
      (locationResult.data || []).forEach((loc) => {
        locationMap.set(loc.id, loc.bin_location_combine || loc.id);
      });
      console.log(`Fetched ${locationMap.size} location names`);
    } catch (error) {
      console.error("Error fetching locations:", error);
    }
  }

  // Batch fetch batch names
  const batchMap = new Map();
  if (allBatchIds.size > 0) {
    try {
      const batchResult = await db
        .collection("batch")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [{ prop: "id", operator: "in", value: [...allBatchIds] }],
          },
        ])
        .get();
      (batchResult.data || []).forEach((batch) => {
        batchMap.set(batch.id, batch.batch_number || batch.id);
      });
      console.log(`Fetched ${batchMap.size} batch names`);
    } catch (error) {
      console.error("Error fetching batches:", error);
    }
  }

  // Batch fetch UOM names
  const uomMap = new Map();
  if (allUomIds.size > 0) {
    try {
      const uomResult = await db
        .collection("unit_of_measurement")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [{ prop: "id", operator: "in", value: [...allUomIds] }],
          },
        ])
        .get();
      (uomResult.data || []).forEach((uom) => {
        uomMap.set(uom.id, uom.uom_name || uom.id);
      });
      console.log(`Fetched ${uomMap.size} UOM names`);
    } catch (error) {
      console.error("Error fetching UOMs:", error);
    }
  }

  // Helper function to build view_stock string for locations
  const buildMultiLocationViewStock = (locationBatchInfo, uomId) => {
    const uomName = uomMap.get(uomId) || "";
    const totalQty = locationBatchInfo.reduce((sum, info) => sum + info.qty, 0);

    let viewStock = `Total: ${totalQty} ${uomName}\n\nDETAILS:\n`;

    locationBatchInfo.forEach((info, index) => {
      const locationName =
        locationMap.get(info.locationId) || info.locationId || "Unknown";
      viewStock += `${index + 1}. ${locationName}: ${info.qty} ${uomName}`;

      if (info.batchId) {
        const batchName = batchMap.get(info.batchId) || info.batchId;
        viewStock += `\n[Batch: ${batchName}]`;
      }

      if (index < locationBatchInfo.length - 1) viewStock += "\n";
    });

    return viewStock;
  };

  // ========================================================================
  // Step 3: Process picking records based on reference type
  // ========================================================================
  switch (referenceType) {
    case "Document":
      // Document mode: Group picking records by pp_line_id + material_id
      const groupedItemsDoc = new Map(); // Key: `${record.to_line_id}|${record.item_code}`

      for (const picking of currentItemArray) {
        const pickingRecords = picking.picking_record_data || [];

        console.log(
          `Picking ${picking.to_no}: ${pickingRecords.length} picking records`,
        );

        for (const record of pickingRecords) {
          // Skip fully delivered records
          const storeOutQty = parseFloat(record.store_out_qty || 0);
          const deliveredQty = parseFloat(record.delivered_qty || 0);
          if (deliveredQty >= storeOutQty) {
            console.log(
              `Skipping ${record.item_name}: fully delivered (${deliveredQty}/${storeOutQty})`,
            );
            continue;
          }

          const groupKey = `${record.to_line_id}|${record.item_code}`;
          const remainingQty = roundQty(storeOutQty - deliveredQty);
          const batchId = record.batch_no || record.target_batch;

          const tempEntry = {
            location_id: record.target_location,
            batch_id: batchId,
            to_quantity: storeOutQty,
            gd_quantity: remainingQty,
            picking_record_id: record.id,
          };

          if (!groupedItemsDoc.has(groupKey)) {
            // First record for this group - initialize
            const soLine = soLineMap.get(record.so_line_id);
            const orderedQty = soLine?.so_quantity || storeOutQty;

            console.log("pickingRecord (first in group)", record);
            groupedItemsDoc.set(groupKey, {
              itemId: record.item_code,
              itemName: record.item_name,
              itemDesc: record.item_desc,
              orderedQty: parseFloat(orderedQty),
              pickedQty: storeOutQty,
              deliveredQty: deliveredQty,
              altUOM: record.item_uom,
              baseUOM: record.item_uom,
              sourceItem: record,
              original_so_id: record.so_id,
              so_no: record.so_no,
              so_line_item_id: record.so_line_id,
              pp_id: record.to_id,
              pp_line_id: record.to_line_id,
              picking_id: picking.to_id,
              picking_no: picking.to_no,
              customer_id: picking.customer_id?.[0],
              tempEntries: [tempEntry],
              locationBatchInfo: [
                {
                  locationId: record.target_location,
                  batchId,
                  qty: remainingQty,
                  uomId: record.item_uom,
                },
              ],
            });
          } else {
            // Existing group - merge
            console.log("pickingRecord (merging into group)", record);
            const existing = groupedItemsDoc.get(groupKey);
            existing.pickedQty = roundQty(existing.pickedQty + storeOutQty);
            existing.deliveredQty = roundQty(
              existing.deliveredQty + deliveredQty,
            );
            existing.tempEntries.push(tempEntry);
            existing.locationBatchInfo.push({
              locationId: record.target_location,
              batchId,
              qty: remainingQty,
              uomId: record.item_uom,
            });
          }
        }
      }

      // Convert grouped items to allItems array
      for (const [, group] of groupedItemsDoc) {
        const tempQtyData = JSON.stringify(group.tempEntries);
        const viewStock = buildMultiLocationViewStock(
          group.locationBatchInfo,
          group.altUOM,
        );

        allItems.push({
          itemId: group.itemId,
          itemName: group.itemName,
          itemDesc: group.itemDesc,
          orderedQty: group.orderedQty,
          pickedQty: group.pickedQty,
          deliveredQty: group.deliveredQty,
          altUOM: group.altUOM,
          baseUOM: group.baseUOM,
          sourceItem: group.sourceItem,
          original_so_id: group.original_so_id,
          so_no: group.so_no,
          so_line_item_id: group.so_line_item_id,
          pp_id: group.pp_id,
          pp_line_id: group.pp_line_id,
          picking_id: group.picking_id,
          picking_no: group.picking_no,
          customer_id: group.customer_id,
          temp_qty_data: tempQtyData,
          view_stock: viewStock,
        });
      }
      break;

    case "Item":
      // Item mode: Group selected items by pp_line_id + material_id
      const groupedItemsItem = new Map(); // Key: `${pp_line_id}|${item_id}`

      for (const pickingItem of currentItemArray) {
        console.log("pickingItem (Item mode)", pickingItem);

        // Skip fully delivered records
        const storeOutQty = parseFloat(pickingItem.store_out_qty || 0);
        const deliveredQty = parseFloat(pickingItem.delivered_qty || 0);
        if (deliveredQty >= storeOutQty) {
          console.log(
            `Skipping ${pickingItem.item?.material_code}: fully delivered`,
          );
          continue;
        }

        const ppLineId = pickingItem.pp_line_id || "";
        const itemId = pickingItem.item?.id || "";
        const groupKey = `${ppLineId}|${itemId}`;

        const remainingQty = roundQty(storeOutQty - deliveredQty);
        const batchId = pickingItem.batch_no;

        const tempEntry = {
          location_id: pickingItem.location_id,
          batch_id: batchId,
          to_quantity: storeOutQty,
          gd_quantity: remainingQty,
          picking_record_id: pickingItem.picking_record_id,
        };

        if (!groupedItemsItem.has(groupKey)) {
          // First record for this group - initialize
          const soLine = soLineMap.get(pickingItem.so_line_id);
          const orderedQty = soLine?.so_quantity || storeOutQty;

          console.log("pickingItem (first in group)", pickingItem);
          groupedItemsItem.set(groupKey, {
            itemId: itemId,
            itemName: pickingItem.item?.material_code || "",
            itemDesc: "",
            orderedQty: parseFloat(orderedQty),
            pickedQty: storeOutQty,
            deliveredQty: deliveredQty,
            altUOM: pickingItem.uom_id,
            baseUOM: pickingItem.uom_id,
            sourceItem: pickingItem,
            original_so_id: pickingItem.so_id,
            so_no: pickingItem.so_no,
            so_line_item_id: pickingItem.so_line_id,
            pp_id: pickingItem.pp_id,
            pp_line_id: pickingItem.pp_line_id,
            picking_id: pickingItem.picking_data?.id,
            picking_no: pickingItem.picking_data?.to_id,
            customer_id: parseCustomerId(pickingItem.customer_id),
            tempEntries: [tempEntry],
            locationBatchInfo: [
              {
                locationId: pickingItem.location_id,
                batchId,
                qty: remainingQty,
                uomId: pickingItem.uom_id,
              },
            ],
          });
        } else {
          // Existing group - merge
          console.log("pickingItem (merging into group)", pickingItem);
          const existing = groupedItemsItem.get(groupKey);
          existing.pickedQty = roundQty(existing.pickedQty + storeOutQty);
          existing.deliveredQty = roundQty(
            existing.deliveredQty + deliveredQty,
          );
          existing.tempEntries.push(tempEntry);
          existing.locationBatchInfo.push({
            locationId: pickingItem.location_id,
            batchId,
            qty: remainingQty,
            uomId: pickingItem.uom_id,
          });
        }
      }

      // Convert grouped items to allItems array
      for (const [, group] of groupedItemsItem) {
        const tempQtyData = JSON.stringify(group.tempEntries);
        const viewStock = buildMultiLocationViewStock(
          group.locationBatchInfo,
          group.altUOM,
        );

        allItems.push({
          itemId: group.itemId,
          itemName: group.itemName,
          itemDesc: group.itemDesc,
          orderedQty: group.orderedQty,
          pickedQty: group.pickedQty,
          deliveredQty: group.deliveredQty,
          altUOM: group.altUOM,
          baseUOM: group.baseUOM,
          sourceItem: group.sourceItem,
          original_so_id: group.original_so_id,
          so_no: group.so_no,
          so_line_item_id: group.so_line_item_id,
          pp_id: group.pp_id,
          pp_line_id: group.pp_line_id,
          picking_id: group.picking_id,
          picking_no: group.picking_no,
          customer_id: group.customer_id,
          temp_qty_data: tempQtyData,
          view_stock: viewStock,
        });
      }
      break;
  }

  console.log("allItems", allItems);

  // Filter out items that:
  // 1. Are fully delivered (deliveredQty >= pickedQty)
  // 2. Are already in the existing GD (match by picking_record_id in temp_qty_data to avoid duplicates)
  allItems = allItems.filter((item) => {
    const fullyDelivered = item.deliveredQty >= item.pickedQty;

    // Get all picking_record_ids from this item's temp_qty_data
    let itemPickingRecordIds = [];
    try {
      const itemTempData = JSON.parse(item.temp_qty_data || "[]");
      itemPickingRecordIds = itemTempData
        .map((entry) => entry.picking_record_id)
        .filter(Boolean);
    } catch (e) {
      console.error("Error parsing item temp_qty_data:", e);
    }

    // Check if ANY picking_record_id exists in any existing GD's temp_qty_data
    const alreadyInGD =
      itemPickingRecordIds.length > 0 &&
      existingGD.some((gdItem) => {
        if (!gdItem.temp_qty_data) return false;
        try {
          const gdTempData = JSON.parse(gdItem.temp_qty_data);
          const gdPickingRecordIds = gdTempData
            .map((entry) => entry.picking_record_id)
            .filter(Boolean);
          // Check if any of item's picking_record_ids are in GD's picking_record_ids
          return itemPickingRecordIds.some((id) =>
            gdPickingRecordIds.includes(id),
          );
        } catch (e) {
          return false;
        }
      });

    if (fullyDelivered) {
      console.log(
        `Filtering out ${item.itemName}: fully delivered (${item.deliveredQty}/${item.pickedQty})`,
      );
    }
    if (alreadyInGD) {
      console.log(
        `Filtering out ${item.itemName}: already in GD (picking_record_ids: ${itemPickingRecordIds.join(", ")})`,
      );
    }

    return !fullyDelivered && !alreadyInGD;
  });

  console.log("allItems after filter", allItems);

  let newTableGd = await createTableGdWithBaseUOM(allItems);

  const latestTableGD = [...existingGD, ...newTableGd];

  soId = [...new Set(latestTableGD.map((gd) => gd.line_so_id))];
  salesOrderNumber = [...new Set(latestTableGD.map((gd) => gd.line_so_no))];
  pickingNumber = [...new Set(latestTableGD.map((gd) => gd.line_to_no))];

  // Collect unique Picking numbers for reference (line_to_no = picking number)
  const pickingNumbers = [
    ...new Set(latestTableGD.map((gd) => gd.line_to_no).filter(Boolean)),
  ];

  // Collect unique PP IDs for reference
  const ppIds = [
    ...new Set(latestTableGD.map((gd) => gd.line_pp_id).filter(Boolean)),
  ];

  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].so_currency?.[0] || null
        : null,
    customer_name: parseCustomerId(currentItemArray[0].customer_id),
    table_gd: latestTableGD,
    so_no: salesOrderNumber.join(", "),
    to_no: pickingNumber.join(", "),
    so_id: soId,
    pp_id: ppIds, // Add PP IDs reference
    picking_no: pickingNumbers.join(", "), // Add Picking reference
    reference_type: referenceType,
  });

  await this.display([
    "table_gd.line_to_no",
    "table_gd.plan_qty",
    "table_gd.view_stock",
  ]);

  // GDPP: Enable/disable fields based on temp_qty_data length
  setTimeout(() => {
    for (let i = 0; i < latestTableGD.length; i++) {
      const item = latestTableGD[i];
      const tempQtyData = item.temp_qty_data;

      if (!tempQtyData || tempQtyData === "[]" || tempQtyData.trim() === "") {
        continue;
      }

      try {
        const tempDataArray = JSON.parse(tempQtyData);

        if (tempDataArray.length === 1) {
          // Single location: Disable dialog button, enable gd_qty field
          this.disabled([`table_gd.${i}.gd_delivery_qty`], true);
          this.disabled([`table_gd.${i}.gd_qty`], false);
          console.log(`Item ${i}: Single location - direct edit enabled`);
        } else {
          // Multiple locations: Enable dialog button, disable gd_qty field
          this.disabled([`table_gd.${i}.gd_delivery_qty`], false);
          this.disabled([`table_gd.${i}.gd_qty`], true);
          console.log(
            `Item ${i}: Multiple locations (${tempDataArray.length}) - dialog required`,
          );
        }
      } catch (error) {
        console.error(`Error parsing temp_qty_data for item ${i}:`, error);
      }
    }
  }, 100);

  this.hideLoading();
})();
