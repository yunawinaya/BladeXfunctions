const data = this.getValues();
const salesOrderId = data.so_id;
const plantId = data.plant_id;

const savedTableGd = data.table_gd || [];

// Normalize salesOrderId to always be an array
const salesOrderIds = Array.isArray(salesOrderId)
  ? salesOrderId
  : [salesOrderId];

if (salesOrderIds.length > 1) {
  this.setData({ gd_delivery_method: "" });
  this.triggerEvent("func_reset_delivery_method");
}

// Function to convert base quantity to alternative quantity
const convertBaseToAlt = (baseQty, itemData, altUOM) => {
  if (
    !Array.isArray(itemData.table_uom_conversion) ||
    itemData.table_uom_conversion.length === 0 ||
    !altUOM
  ) {
    return baseQty;
  }

  const uomConversion = itemData.table_uom_conversion.find(
    (conv) => conv.alt_uom_id === altUOM
  );

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
};

// Initialize global allocation tracker for the session
if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

// Function to perform automatic allocation for eligible items
// Fixed version of the batch allocation logic
const performAutomaticAllocation = async (
  materialId,
  rowIndex,
  quantity,
  plantId,
  uomId
) => {
  try {
    console.log(
      `Auto-allocating for row ${rowIndex}, material ${materialId}, quantity ${quantity}`
    );

    // Get current allocations for this material from previous rows
    const getCurrentAllocations = (materialId, currentRowIndex) => {
      const materialAllocations =
        window.globalAllocationTracker.get(materialId) || new Map();
      const allocatedQuantities = new Map();

      // Get allocations from global tracker (excluding current row)
      materialAllocations.forEach((rowAllocations, rIdx) => {
        if (rIdx !== currentRowIndex) {
          rowAllocations.forEach((qty, locationKey) => {
            const currentAllocated = allocatedQuantities.get(locationKey) || 0;
            allocatedQuantities.set(locationKey, currentAllocated + qty);
          });
        }
      });

      return allocatedQuantities;
    };

    // Apply cross-row allocations to balance data
    const applyAllocationsToBalances = (
      balances,
      allocatedQuantities,
      isBatchManaged
    ) => {
      return balances.map((balance) => {
        const key = isBatchManaged
          ? `${balance.location_id}-${balance.batch_id || "no_batch"}`
          : `${balance.location_id}`;

        const allocatedFromOthers = allocatedQuantities.get(key) || 0;
        const originalUnrestrictedQty = balance.unrestricted_qty || 0;
        const adjustedUnrestrictedQty = Math.max(
          0,
          originalUnrestrictedQty - allocatedFromOthers
        );

        return {
          ...balance,
          unrestricted_qty: adjustedUnrestrictedQty,
          original_unrestricted_qty: originalUnrestrictedQty,
        };
      });
    };

    // Get picking setup
    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({ plant_id: plantId, movement_type: "Good Delivery" })
      .get();

    let pickingMode, defaultStrategy, fallbackStrategy;
    if (!pickingSetupResponse?.data?.length) {
      console.log("No picking setup found, using default values");
      pickingMode = "Manual";
      defaultStrategy = "RANDOM";
    } else {
      pickingMode = pickingSetupResponse.data[0].picking_mode;
      defaultStrategy = pickingSetupResponse.data[0].default_strategy_id;
      fallbackStrategy = pickingSetupResponse.data[0].fallback_strategy_id;
    }

    // Only proceed with auto-allocation for Auto picking mode
    if (pickingMode !== "Auto") {
      console.log(`Picking mode is ${pickingMode}, skipping auto-allocation`);
      return;
    }

    // Fetch item data
    const itemResult = await db
      .collection("Item")
      .where({ id: materialId, is_deleted: 0 })
      .get();

    if (!itemResult?.data?.length) {
      console.log("Item not found, skipping auto-allocation");
      return;
    }

    const itemData = itemResult.data[0];

    // Get default bin for item
    const getDefaultBin = (itemData, plantId) => {
      if (!itemData.table_default_bin?.length) return null;
      const defaultBinEntry = itemData.table_default_bin.find(
        (bin) => bin.plant_id === plantId
      );
      return defaultBinEntry?.bin_location || null;
    };

    const defaultBin = getDefaultBin(itemData, plantId);

    // Get current allocations for this material
    const allocatedFromOtherRows = getCurrentAllocations(materialId, rowIndex);

    let allAllocations = [];

    // Handle batch-managed items - FIXED VERSION
    if (itemData.item_batch_management === 1) {
      // Get ALL batches for this material, not just the first one
      const batchResult = await db
        .collection("batch")
        .where({
          material_id: itemData.id,
          is_deleted: 0,
          plant_id: plantId,
        })
        .get();

      if (!batchResult?.data?.length) {
        console.log("No batches found for item");
        return;
      }

      // Get all batch balances
      const batchBalanceResult = await db
        .collection("item_batch_balance")
        .where({
          material_id: itemData.id,
          is_deleted: 0,
        })
        .get();

      if (!batchBalanceResult?.data?.length) {
        console.log("No batch balance found");
        return;
      }

      const adjustedBalances = applyAllocationsToBalances(
        batchBalanceResult.data,
        allocatedFromOtherRows,
        true
      );

      // Process allocation with ALL batch data
      allAllocations = await processAutoAllocation(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        true,
        batchResult.data // Pass ALL batch data, not just first one
      );
    } else if (itemData.item_batch_management === 0) {
      const itemBalanceResult = await db
        .collection("item_balance")
        .where({
          plant_id: plantId,
          material_id: materialId,
          is_deleted: 0,
        })
        .get();

      if (!itemBalanceResult?.data?.length) {
        console.log("No item balance found");
        return;
      }

      const adjustedBalances = applyAllocationsToBalances(
        itemBalanceResult.data,
        allocatedFromOtherRows,
        false
      );

      allAllocations = await processAutoAllocation(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        false
      );
    }

    // Update global allocations
    if (!window.globalAllocationTracker.has(materialId)) {
      window.globalAllocationTracker.set(materialId, new Map());
    }

    const materialAllocations = window.globalAllocationTracker.get(materialId);
    const rowAllocations = new Map();

    allAllocations.forEach((allocation) => {
      const key = allocation.batchData
        ? `${allocation.balance.location_id}-${allocation.batchData.id}`
        : `${allocation.balance.location_id}`;
      rowAllocations.set(key, allocation.quantity);
    });

    materialAllocations.set(rowIndex, rowAllocations);

    // Create temp_qty_data and summary
    const tempQtyData = allAllocations.map((allocation) => ({
      material_id: materialId,
      location_id: allocation.balance.location_id,
      block_qty: allocation.balance.block_qty,
      reserved_qty: allocation.balance.reserved_qty,
      unrestricted_qty:
        allocation.balance.original_unrestricted_qty ||
        allocation.balance.unrestricted_qty,
      qualityinsp_qty: allocation.balance.qualityinsp_qty,
      intransit_qty: allocation.balance.intransit_qty,
      balance_quantity: allocation.balance.balance_quantity,
      plant_id: plantId,
      organization_id: allocation.balance.organization_id,
      is_deleted: 0,
      gd_quantity: allocation.quantity,
      ...(allocation.batchData && { batch_id: allocation.batchData.id }),
    }));

    // Get UOM name for summary
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

    const summaryDetails = allAllocations.map((allocation, index) => {
      let summaryLine = `${index + 1}. ${allocation.binLocation}: ${
        allocation.quantity
      } ${uomName}`;
      if (allocation.batchData) {
        summaryLine += `\n[${allocation.batchData.batch_number}]`;
      }
      return summaryLine;
    });

    const totalAllocated = allAllocations.reduce(
      (sum, alloc) => sum + alloc.quantity,
      0
    );
    const summary = `Total: ${totalAllocated} ${uomName}\n\nDETAILS:\n${summaryDetails.join(
      "\n"
    )}`;

    // Update the row data with allocation results
    this.setData({
      [`table_gd.${rowIndex}.view_stock`]: summary,
      [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(tempQtyData),
    });

    console.log(
      `Auto-allocation completed for row ${rowIndex}: ${allAllocations.length} allocations`
    );
  } catch (error) {
    console.error(`Error in auto-allocation for row ${rowIndex}:`, error);
  }
};

// FIXED Helper function to process auto allocation strategies
const processAutoAllocation = async (
  balances,
  defaultBin,
  quantity,
  defaultStrategy,
  fallbackStrategy,
  isBatchManaged,
  batchDataArray = null // Now accepts array of all batches
) => {
  let allAllocations = [];
  let remainingQty = quantity;

  // Get bin location details
  const getBinLocationDetails = async (locationId) => {
    try {
      const binLocationResult = await db
        .collection("bin_location")
        .where({ id: locationId, is_deleted: 0 })
        .get();
      return binLocationResult?.data?.[0] || null;
    } catch (error) {
      console.error("Error fetching bin location:", error);
      return null;
    }
  };

  // Helper function to find batch data by batch_id
  const findBatchData = (batchId) => {
    if (!isBatchManaged || !batchDataArray) return null;
    return batchDataArray.find((batch) => batch.id === batchId) || null;
  };

  if (defaultStrategy === "FIXED BIN") {
    if (defaultBin) {
      // Try fixed bin first - handle multiple batches in the same bin
      const defaultBinBalances = balances.filter(
        (balance) =>
          balance.location_id === defaultBin &&
          (balance.unrestricted_qty || 0) > 0
      );

      // Sort by batch expiry date or batch number for consistent allocation
      if (isBatchManaged) {
        defaultBinBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          // Sort by expiry date first (FIFO), then by batch number
          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (batchA?.batch_number || "").localeCompare(
            batchB?.batch_number || ""
          );
        });
      }

      // Allocate from fixed bin balances
      for (const balance of defaultBinBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(balance.location_id);
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }

    // Use fallback strategy for remaining quantity
    if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
      const availableBalances = balances.filter(
        (balance) =>
          balance.location_id !== defaultBin &&
          (balance.unrestricted_qty || 0) > 0
      );

      // Sort by batch expiry date for batch-managed items
      if (isBatchManaged) {
        availableBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (batchA?.batch_number || "").localeCompare(
            batchB?.batch_number || ""
          );
        });
      } else {
        // For non-batch items, maintain original order
        availableBalances.sort(
          (a, b) => balances.indexOf(a) - balances.indexOf(b)
        );
      }

      for (const balance of availableBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(balance.location_id);
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }
  } else if (defaultStrategy === "RANDOM") {
    // Direct random allocation - handle multiple batches
    const availableBalances = balances.filter(
      (balance) => (balance.unrestricted_qty || 0) > 0
    );

    // Sort by batch expiry date for batch-managed items (FIFO)
    if (isBatchManaged) {
      availableBalances.sort((a, b) => {
        const batchA = findBatchData(a.batch_id);
        const batchB = findBatchData(b.batch_id);

        if (batchA?.expiry_date && batchB?.expiry_date) {
          return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
        }
        return (batchA?.batch_number || "").localeCompare(
          batchB?.batch_number || ""
        );
      });
    } else {
      // For non-batch items, maintain original order
      availableBalances.sort(
        (a, b) => balances.indexOf(a) - balances.indexOf(b)
      );
    }

    for (const balance of availableBalances) {
      if (remainingQty <= 0) break;

      const availableQty = balance.unrestricted_qty || 0;
      const allocatedQty = Math.min(remainingQty, availableQty);

      if (allocatedQty > 0) {
        const binDetails = await getBinLocationDetails(balance.location_id);
        if (binDetails) {
          const batchData = isBatchManaged
            ? findBatchData(balance.batch_id)
            : null;

          allAllocations.push({
            balance: balance,
            quantity: allocatedQty,
            binLocation: binDetails.bin_location_combine,
            batchData: batchData,
          });
          remainingQty -= allocatedQty;
        }
      }
    }
  }

  return allAllocations;
};

// Helper function to populate addresses from SO data
const populateAddressesFromSO = (soData) => {
  console.log("Populating addresses from SO:", soData);

  // Display address section
  this.display("address_grid");

  // Extract address data from SO
  const {
    cust_billing_address,
    cust_shipping_address,
    billing_address_line_1,
    billing_address_line_2,
    billing_address_line_3,
    billing_address_line_4,
    billing_address_city,
    billing_address_state,
    billing_address_country,
    billing_postal_code,
    billing_address_phone,
    billing_address_name,
    billing_attention,
    shipping_address_line_1,
    shipping_address_line_2,
    shipping_address_line_3,
    shipping_address_line_4,
    shipping_address_city,
    shipping_address_state,
    shipping_address_country,
    shipping_postal_code,
    shipping_address_name,
    shipping_address_phone,
    shipping_attention,
  } = soData;

  // Set address fields from SO data
  this.setData({
    // Main address fields (formatted addresses)
    gd_billing_address: cust_billing_address || "",
    gd_shipping_address: cust_shipping_address || "",

    // Detailed billing address fields
    billing_address_line_1: billing_address_line_1 || "",
    billing_address_line_2: billing_address_line_2 || "",
    billing_address_line_3: billing_address_line_3 || "",
    billing_address_line_4: billing_address_line_4 || "",
    billing_address_city: billing_address_city || "",
    billing_address_state: billing_address_state || "",
    billing_address_country: billing_address_country || "",
    billing_postal_code: billing_postal_code || "",
    billing_address_phone: billing_address_phone || "",
    billing_address_name: billing_address_name || "",
    billing_attention: billing_attention || "",

    // Detailed shipping address fields
    shipping_address_line_1: shipping_address_line_1 || "",
    shipping_address_line_2: shipping_address_line_2 || "",
    shipping_address_line_3: shipping_address_line_3 || "",
    shipping_address_line_4: shipping_address_line_4 || "",
    shipping_address_city: shipping_address_city || "",
    shipping_address_state: shipping_address_state || "",
    shipping_address_country: shipping_address_country || "",
    shipping_postal_code: shipping_postal_code || "",
    shipping_address_name: shipping_address_name || "",
    shipping_address_phone: shipping_address_phone || "",
    shipping_attention: shipping_attention || "",
  });

  console.log("Addresses populated from SO successfully");
};

// Helper function to fetch source items from multiple SO IDs
const fetchSourceItems = async (soIds) => {
  const promises = soIds.map(async (soId) => {
    try {
      const response = await db
        .collection("sales_order")
        .where({ id: soId })
        .get();

      if (
        response.data &&
        response.data.length > 0 &&
        response.data[0].table_so
      ) {
        console.log("response.data[0]:", response.data[0]);

        // Add the SO ID to each item for reference
        return {
          soData: response.data[0],
          items: response.data[0].table_so.map((item) => ({
            ...item,
            original_so_id: soId,
            so_no: response.data[0].so_no,
          })),
        };
      }
      return { soData: null, items: [] };
    } catch (error) {
      console.error(`Error fetching SO ${soId}:`, error);
      return { soData: null, items: [] };
    }
  });

  try {
    const results = await Promise.all(promises);

    // POPULATE ADDRESSES FROM THE LATEST SELECTED SO (last in array)
    const latestSOResult = results[results.length - 1];
    if (latestSOResult.soData) {
      console.log(
        "Using latest selected SO for addresses:",
        latestSOResult.soData.so_no
      );
      populateAddressesFromSO(latestSOResult.soData);
    }

    // Flatten all items from all SOs
    const allItems = results.flatMap((result) => result.items);
    return allItems;
  } catch (error) {
    console.error("Error fetching source items:", error);
    return [];
  }
};

// Alternative approach: Handle address population for multiple SOs
const handleMultipleSOMAddresses = async (soIds) => {
  if (soIds.length >= 1) {
    // Use the LATEST selected SO (last in array) for addresses
    const latestSOId = soIds[soIds.length - 1];

    try {
      const response = await db
        .collection("sales_order")
        .where({ id: latestSOId })
        .get();
      if (response.data && response.data.length > 0) {
        console.log(
          `Using latest selected SO (${response.data[0].so_no}) for addresses`
        );
        populateAddressesFromSO(response.data[0]);
      }
    } catch (error) {
      console.error("Error fetching latest SO for address:", error);
    }
  }
};

const checkInventoryWithDuplicates = async (allItems, plantId) => {
  // Group items by material_id to find duplicates
  const materialGroups = {};

  allItems.forEach((item, index) => {
    const materialId = item.itemId;
    if (!materialGroups[materialId]) {
      materialGroups[materialId] = [];
    }
    materialGroups[materialId].push({ ...item, originalIndex: index });
  });

  console.log("Material groups:", materialGroups);

  const insufficientItems = [];

  // Create a flat array of all items that need allocation, sorted by index
  const itemsForAllocation = [];

  // First pass: Set up all item data and determine which items need allocation
  for (const [materialId, items] of Object.entries(materialGroups)) {
    // Skip database call and enable gd_qty if materialId is null
    if (!materialId) {
      console.log(`Skipping item with null materialId`);
      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        this.setData({
          [`table_gd.${index}.material_id`]: materialId || "",
          [`table_gd.${index}.material_name`]: item.itemName || "",
          [`table_gd.${index}.gd_material_desc`]: item.sourceItem.so_desc || "",
          [`table_gd.${index}.gd_order_quantity`]: orderedQty,
          [`table_gd.${index}.gd_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_order_uom_id`]: item.altUOM,
          [`table_gd.${index}.good_delivery_uom_id`]: item.altUOM,
          [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
          [`table_gd.${index}.line_remark_1`]:
            item.sourceItem.line_remark_1 || "",
          [`table_gd.${index}.line_remark_2`]:
            item.sourceItem.line_remark_2 || "",
          [`table_gd.${index}.base_uom_id`]: "",
          [`table_gd.${index}.unit_price`]: item.sourceItem.so_item_price || 0,
          [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
          [`table_gd.${index}.item_costing_method`]: "",
          [`table_gd.${index}.gd_qty`]: undeliveredQty,
        });

        this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
        this.disabled([`table_gd.${index}.gd_qty`], false);
      });
      continue;
    }

    try {
      // Fetch item data
      const res = await db.collection("Item").where({ id: materialId }).get();
      if (!res.data || !res.data.length) {
        console.error(`Item not found: ${materialId}`);
        continue;
      }

      const itemData = res.data[0];

      if (itemData.stock_control === 0 && itemData.show_delivery === 0) {
        console.log(
          `Skipping item ${materialId} due to stock_control or show_delivery settings`
        );
        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          this.setData({
            [`table_gd.${index}.material_id`]: materialId,
            [`table_gd.${index}.material_name`]: item.itemName,
            [`table_gd.${index}.gd_material_desc`]:
              item.sourceItem.so_desc || "",
            [`table_gd.${index}.gd_order_quantity`]: orderedQty,
            [`table_gd.${index}.gd_delivered_qty`]: deliveredQty,
            [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQty,
            [`table_gd.${index}.gd_order_uom_id`]: item.altUOM,
            [`table_gd.${index}.good_delivery_uom_id`]: item.altUOM,
            [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
            [`table_gd.${index}.line_remark_1`]:
              item.sourceItem.line_remark_1 || "",
            [`table_gd.${index}.line_remark_2`]:
              item.sourceItem.line_remark_2 || "",
            [`table_gd.${index}.base_uom_id`]: itemData.based_uom || "",
            [`table_gd.${index}.unit_price`]:
              item.sourceItem.so_item_price || 0,
            [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
            [`table_gd.${index}.item_costing_method`]:
              itemData.material_costing_method,
            [`table_gd.${index}.gd_qty`]: undeliveredQty,
          });

          if (undeliveredQty <= 0) {
            this.disabled(
              [`table_gd.${index}.gd_qty`, `table_gd.${index}.gd_delivery_qty`],
              true
            );
          } else {
            this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
            this.disabled([`table_gd.${index}.gd_qty`], false);
          }
        });
        continue;
      }

      // Get total available stock for this material
      let totalUnrestrictedQtyBase = 0;
      let itemBatchBalanceData = [];
      let itemBalanceData = [];

      if (itemData.item_batch_management === 1) {
        try {
          const response = await db
            .collection("item_batch_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          itemBatchBalanceData = response.data || [];

          // DEBUG: Log batch balance data
          console.log(`DEBUG - Batch balance for material ${materialId}:`, {
            response: response,
            data: itemBatchBalanceData,
            dataLength: itemBatchBalanceData.length,
          });

          if (itemBatchBalanceData.length === 1) {
            items.forEach((item) => {
              const itemIndex = item.originalIndex;
              this.disabled([`table_gd.${itemIndex}.gd_delivery_qty`], true);
              this.disabled([`table_gd.${itemIndex}.gd_qty`], false);
            });
          }
          totalUnrestrictedQtyBase = itemBatchBalanceData.reduce(
            (sum, balance) => sum + (balance.unrestricted_qty || 0),
            0
          );
        } catch (error) {
          console.error(
            `Error fetching batch balance for ${materialId}:`,
            error
          );
          totalUnrestrictedQtyBase = 0;
        }
      } else {
        try {
          const response = await db
            .collection("item_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          itemBalanceData = response.data || [];

          // DEBUG: Log item balance data
          console.log(`DEBUG - Item balance for material ${materialId}:`, {
            response: response,
            data: itemBalanceData,
            dataLength: itemBalanceData.length,
          });

          if (itemBalanceData.length === 1) {
            items.forEach((item) => {
              const itemIndex = item.originalIndex;
              this.disabled([`table_gd.${itemIndex}.gd_delivery_qty`], true);
              this.disabled([`table_gd.${itemIndex}.gd_qty`], false);
            });
          }

          totalUnrestrictedQtyBase = itemBalanceData.reduce(
            (sum, balance) => sum + (balance.unrestricted_qty || 0),
            0
          );
        } catch (error) {
          console.error(
            `Error fetching item balance for ${materialId}:`,
            error
          );
          totalUnrestrictedQtyBase = 0;
        }
      }

      const balanceData =
        itemData.item_batch_management === 1
          ? itemBatchBalanceData
          : itemBalanceData;

      // Get picking setup
      const pickingSetupResponse = await db
        .collection("picking_setup")
        .where({ plant_id: plantId, movement_type: "Good Delivery" })
        .get();

      // Handle case where no picking setup exists for the plant
      let pickingMode, defaultStrategy, fallbackStrategy;
      if (!pickingSetupResponse?.data?.length) {
        console.log("No picking setup found for plant, using default values");
        pickingMode = "Manual";
        defaultStrategy = "RANDOM";
        fallbackStrategy = "RANDOM";
      } else {
        const pickingSetup = pickingSetupResponse.data[0];
        pickingMode = pickingSetup.picking_mode || "Manual";
        defaultStrategy = pickingSetup.default_strategy_id || "RANDOM";
        fallbackStrategy = pickingSetup.fallback_strategy_id || "RANDOM";
      }

      // DEBUG: Log picking setup information
      console.log(`DEBUG - Material ${materialId}:`, {
        pickingMode,
        defaultStrategy,
        fallbackStrategy,
        balanceDataLength: balanceData.length,
        balanceData: balanceData,
      });

      // Calculate total demand and set up basic item data
      let totalDemandBase = 0;
      items.forEach((item) => {
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        let undeliveredQtyBase = undeliveredQty;
        if (item.altUOM !== itemData.based_uom) {
          const uomConversion = itemData.table_uom_conversion?.find(
            (conv) => conv.alt_uom_id === item.altUOM
          );
          if (uomConversion && uomConversion.base_qty) {
            undeliveredQtyBase = undeliveredQty * uomConversion.base_qty;
          }
        }
        totalDemandBase += undeliveredQtyBase;

        // Set basic item data
        const index = item.originalIndex;
        this.setData({
          [`table_gd.${index}.material_id`]: materialId,
          [`table_gd.${index}.material_name`]: item.itemName,
          [`table_gd.${index}.gd_material_desc`]: item.sourceItem.so_desc || "",
          [`table_gd.${index}.gd_order_quantity`]: orderedQty,
          [`table_gd.${index}.gd_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_order_uom_id`]: item.altUOM,
          [`table_gd.${index}.good_delivery_uom_id`]: item.altUOM,
          [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
          [`table_gd.${index}.line_remark_1`]:
            item.sourceItem.line_remark_1 || "",
          [`table_gd.${index}.line_remark_2`]:
            item.sourceItem.line_remark_2 || "",
          [`table_gd.${index}.base_uom_id`]: itemData.based_uom || "",
          [`table_gd.${index}.unit_price`]: item.sourceItem.so_item_price || 0,
          [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
          [`table_gd.${index}.item_costing_method`]:
            itemData.material_costing_method,
          [`dialog_insufficient.table_insufficient.${index}.material_id`]:
            materialId,
          [`dialog_insufficient.table_insufficient.${index}.order_quantity`]:
            orderedQty,
        });
      });

      console.log(
        `Material ${materialId}: Available=${totalUnrestrictedQtyBase}, Total Demand=${totalDemandBase}, Line Count=${items.length}`
      );

      // Handle insufficient vs sufficient stock scenarios
      const totalShortfallBase = totalDemandBase - totalUnrestrictedQtyBase;

      if (totalShortfallBase > 0) {
        console.log(
          `❌ Insufficient stock for material ${materialId}: Shortfall=${totalShortfallBase}`
        );

        // Distribute available stock proportionally
        let remainingStockBase = Math.max(0, totalUnrestrictedQtyBase);

        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          let availableQtyAlt = 0;
          if (remainingStockBase > 0 && undeliveredQty > 0) {
            let undeliveredQtyBase = undeliveredQty;
            if (item.altUOM !== itemData.based_uom) {
              const uomConversion = itemData.table_uom_conversion?.find(
                (conv) => conv.alt_uom_id === item.altUOM
              );
              if (uomConversion && uomConversion.base_qty) {
                undeliveredQtyBase = undeliveredQty * uomConversion.base_qty;
              }
            }

            const allocatedBase = Math.min(
              remainingStockBase,
              undeliveredQtyBase
            );
            const uomConversion = itemData.table_uom_conversion?.find(
              (conv) => conv.alt_uom_id === item.altUOM
            );
            availableQtyAlt =
              item.altUOM !== itemData.based_uom
                ? allocatedBase / (uomConversion?.base_qty || 1)
                : allocatedBase;

            remainingStockBase -= allocatedBase;
          }

          // Update insufficient dialog data
          this.setData({
            [`dialog_insufficient.table_insufficient.${index}.undelivered_qty`]:
              undeliveredQty,
            [`dialog_insufficient.table_insufficient.${index}.available_qty`]:
              availableQtyAlt,
            [`dialog_insufficient.table_insufficient.${index}.shortfall_qty`]:
              undeliveredQty - availableQtyAlt,
          });

          // Set quantity and add to allocation queue if eligible
          const allocationCondition1 = availableQtyAlt > 0;
          const allocationCondition2 = balanceData.length === 1;
          const allocationCondition3 = ["FIXED BIN", "RANDOM"].includes(
            defaultStrategy
          );
          const allocationCondition4 = ["FIXED BIN", "RANDOM"].includes(
            fallbackStrategy
          );
          const allocationCondition5 = pickingMode === "Auto";
          const allocationCondition6 =
            allocationCondition3 && allocationCondition4;
          const isEligibleForAllocation =
            allocationCondition1 &&
            (allocationCondition2 ||
              allocationCondition5 ||
              allocationCondition6);

          // DEBUG: Log allocation conditions
          console.log(`DEBUG - Row ${index} allocation conditions:`, {
            materialId,
            availableQtyAlt,
            balanceDataLength: balanceData.length,
            defaultStrategy,
            pickingMode,
            allocationCondition1,
            allocationCondition2,
            allocationCondition3,
            allocationCondition4,
            allocationCondition5,
            allocationCondition6,
            isEligibleForAllocation,
          });

          if (isEligibleForAllocation) {
            this.setData({
              [`table_gd.${index}.gd_qty`]: availableQtyAlt,
            });

            // Add to allocation queue
            if (materialId) {
              itemsForAllocation.push({
                materialId,
                rowIndex: index,
                quantity: availableQtyAlt,
                plantId,
                uomId: item.altUOM,
              });
              console.log(
                `DEBUG - Added to allocation queue: row ${index}, material ${materialId}, qty ${availableQtyAlt}`
              );
            }
          } else {
            this.setData({
              [`table_gd.${index}.gd_qty`]: 0,
            });
            console.log(
              `DEBUG - NOT eligible for allocation: row ${index}, material ${materialId}`
            );
          }
        });

        insufficientItems.push({
          itemId: materialId,
          itemName: items[0].itemName,
          soNo: items.map((item) => item.so_no).join(", "),
          lineCount: items.length,
        });
      } else {
        console.log(
          `✅ Sufficient stock for material ${materialId}: Available=${totalUnrestrictedQtyBase}, Demand=${totalDemandBase}`
        );

        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          if (undeliveredQty <= 0) {
            this.disabled(
              [`table_gd.${index}.gd_qty`, `table_gd.${index}.gd_delivery_qty`],
              true
            );
            this.setData({
              [`table_gd.${index}.gd_qty`]: 0,
            });
          } else {
            this.setData({
              [`table_gd.${index}.gd_qty`]: undeliveredQty,
            });

            // Add to allocation queue if eligible
            const allocationCondition1 = materialId;
            const allocationCondition2 = balanceData.length === 1;
            const allocationCondition3 = ["FIXED BIN", "RANDOM"].includes(
              defaultStrategy
            );
            const allocationCondition4 = ["FIXED BIN", "RANDOM"].includes(
              fallbackStrategy
            );
            const allocationCondition5 = pickingMode === "Auto";
            const allocationCondition6 =
              allocationCondition3 && allocationCondition4;
            const isEligibleForAllocation =
              allocationCondition1 &&
              (allocationCondition2 ||
                allocationCondition5 ||
                allocationCondition6);

            // DEBUG: Log allocation conditions for sufficient stock
            console.log(
              `DEBUG - Sufficient stock row ${index} allocation conditions:`,
              {
                materialId,
                undeliveredQty,
                balanceDataLength: balanceData.length,
                defaultStrategy,
                pickingMode,
                allocationCondition1,
                allocationCondition2,
                allocationCondition3,
                allocationCondition4,
                allocationCondition5,
                allocationCondition6,
                isEligibleForAllocation,
              }
            );

            if (isEligibleForAllocation) {
              itemsForAllocation.push({
                materialId,
                rowIndex: index,
                quantity: undeliveredQty,
                plantId,
                uomId: item.altUOM,
              });
              console.log(
                `DEBUG - Added to allocation queue (sufficient): row ${index}, material ${materialId}, qty ${undeliveredQty}`
              );
            } else {
              console.log(
                `DEBUG - NOT eligible for allocation (sufficient): row ${index}, material ${materialId}`
              );
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error processing material ${materialId}:`, error);
    }
  }

  // Second pass: Process all allocations sequentially by row index
  console.log(
    `Processing ${itemsForAllocation.length} items for allocation sequentially...`
  );

  // DEBUG: Log detailed allocation queue information
  console.log(`DEBUG - Allocation queue details:`, {
    totalItems: itemsForAllocation.length,
    items: itemsForAllocation.map((item) => ({
      materialId: item.materialId,
      rowIndex: item.rowIndex,
      quantity: item.quantity,
      plantId: item.plantId,
      uomId: item.uomId,
    })),
  });

  // Sort by row index to ensure consistent processing order
  itemsForAllocation.sort((a, b) => a.rowIndex - b.rowIndex);

  for (const allocationItem of itemsForAllocation) {
    console.log(`Processing allocation for row ${allocationItem.rowIndex}`);
    await performAutomaticAllocation(
      allocationItem.materialId,
      allocationItem.rowIndex,
      allocationItem.quantity,
      allocationItem.plantId,
      allocationItem.uomId
    );
  }

  console.log("All allocations completed sequentially");
  return insufficientItems;
};

// Main processing logic - modified to handle addresses from SO
(async () => {
  try {
    const fieldModelItem = Array.isArray(arguments[0]?.fieldModel)
      ? arguments[0]?.fieldModel[0]?.item
      : arguments[0]?.fieldModel?.item;

    if (!salesOrderIds.length || !salesOrderIds[0]) {
      console.log("No sales order IDs found");
      return;
    }

    // Define isSOUnchanged for edit mode
    const newSoId = fieldModelItem?.so_id || salesOrderIds[0];
    const isSOUnchanged =
      (data.page_status === "Edit" || data.page_status === "View") &&
      JSON.stringify(salesOrderIds) ===
        JSON.stringify(Array.isArray(newSoId) ? newSoId : [newSoId]) &&
      savedTableGd.length > 0;

    // Handle address population early in the process
    if (!isSOUnchanged) {
      await handleMultipleSOMAddresses(salesOrderIds);
    }

    // Check if we have valid salesOrderIds
    if (salesOrderIds.length > 0 && salesOrderIds[0]) {
      this.disabled(["plant_id"], false);

      // Set SO numbers in so_no field
      if (salesOrderIds.length > 1) {
        try {
          const soNumbers = await Promise.all(
            salesOrderIds.map(async (soId) => {
              try {
                const response = await db
                  .collection("sales_order")
                  .where({ id: soId })
                  .get();
                if (response.data && response.data.length > 0) {
                  return response.data[0].so_no;
                }
                return "";
              } catch (error) {
                console.error(`Error fetching SO number for ${soId}:`, error);
                return "";
              }
            })
          );

          const validSoNumbers = soNumbers.filter(Boolean);
          this.setData({
            so_no: validSoNumbers.join(", "),
          });
        } catch (error) {
          console.error("Error fetching SO numbers:", error);
        }
      } else {
        try {
          const response = await db
            .collection("sales_order")
            .where({ id: salesOrderIds[0] })
            .get();
          if (response.data && response.data.length > 0) {
            this.setData({
              so_no: response.data[0].so_no,
            });
          }
        } catch (error) {
          console.error("Error fetching SO number:", error);
        }
      }
    }

    // Fetch source items from all SO IDs (addresses will be populated here)
    const sourceItems = await fetchSourceItems(salesOrderIds);
    console.log("sourceItems from all SOs:", sourceItems);

    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
      console.log("No source items found in sales orders");
      return;
    }

    if (!isSOUnchanged) {
      // Reset table data
      this.setData({
        table_gd: [],
        gd_item_balance: {
          table_item_balance: [],
        },
      });

      setTimeout(async () => {
        try {
          // Create items array
          const allItems = [];

          sourceItems.forEach((sourceItem) => {
            const itemId = sourceItem.item_name || "";
            const itemDesc = sourceItem.so_desc || "";
            const itemName = sourceItem.item_id || "";

            if (itemId === "" && itemDesc === "") return;

            const orderedQty = parseFloat(sourceItem.so_quantity || 0);
            const deliveredQtyFromSource = parseFloat(
              sourceItem.delivered_qty || 0
            );

            const altUOM = sourceItem.so_item_uom || "";

            allItems.push({
              itemId,
              itemName,
              itemDesc,
              orderedQty,
              altUOM,
              sourceItem,
              deliveredQtyFromSource,
              original_so_id: sourceItem.original_so_id,
              so_no: sourceItem.so_no,
            });
          });

          // Create new table_gd structure
          const newTableGd = allItems.map((item) => ({
            material_id: item.itemId || "",
            material_name: item.itemName || "",
            gd_material_desc: item.itemDesc || "",
            gd_order_quantity: item.orderedQty,
            gd_delivered_qty: item.sourceItem.delivered_qty,
            gd_undelivered_qty: item.orderedQty - item.sourceItem.delivered_qty,
            gd_order_uom_id: item.altUOM,
            unit_price: item.sourceItem.so_item_price || 0,
            total_price: item.sourceItem.so_amount || 0,
            more_desc: item.sourceItem.more_desc || "",
            line_remark_1: item.sourceItem.line_remark_1 || "",
            line_remark_2: item.sourceItem.line_remark_2 || "",
            line_so_no: item.so_no,
            line_so_id: item.original_so_id,
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          }));

          console.log("New table_gd structure:", newTableGd);

          await this.setData({
            table_gd: newTableGd,
          });

          // Create insufficient items table structure
          const newTableInsufficient = allItems.map((item) => ({
            material_id: item.itemId,
            material_name: item.itemName,
            material_uom: item.altUOM,
            order_quantity: item.orderedQty,
            available_qty: "",
            shortfall_qty: "",
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          }));

          console.log(
            "New table_insufficient structure:",
            newTableInsufficient
          );

          this.setData({
            dialog_insufficient: {
              table_insufficient: newTableInsufficient,
            },
          });

          // Use a longer delay to ensure the arrays are created
          setTimeout(async () => {
            try {
              // Use the new enhanced inventory checking function
              const insufficientItems = await checkInventoryWithDuplicates(
                allItems,
                plantId
              );

              // Show insufficient dialog if there are any shortfalls
              if (insufficientItems.length > 0) {
                console.log(
                  "Materials with insufficient inventory:",
                  insufficientItems
                );
                this.openDialog("dialog_insufficient");
              }

              console.log("Finished populating table_gd items");
            } catch (error) {
              console.error("Error in inventory check:", error);
            }
          }, 200);
        } catch (error) {
          console.error("Error in setTimeout processing:", error);
        }
      }, 100);
    } else {
      console.log("Preserving existing table_gd data during edit");
    }
  } catch (e) {
    console.error("Error in main processing:", e);
  }
})();
