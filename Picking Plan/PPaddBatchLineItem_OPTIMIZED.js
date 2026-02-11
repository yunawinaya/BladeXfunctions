// ============================================================================
// OPTIMIZED VERSION - Performance improvements for 50+ items
// Key optimizations:
// 1. Batch queries - ALL data fetched upfront in 4-5 queries instead of 500+
// 2. Single setData call - Build entire table data, then update once
// 3. Cached data reuse - Allocation phase uses pre-fetched data
// 4. Batch bin location query - Single query for all locations
// ============================================================================

/*
 * IMPORTANT NOTE: Variable Naming Convention
 * ==========================================
 * Throughout this file, variable names containing "delivered" (e.g., deliveredQty,
 * deliveredQtyFromSource, to_delivered_qty, to_undelivered_qty) represent the
 * COMBINED quantity that is already fulfilled (delivered + planned).
 *
 * Why? This code is inherited from Goods Delivery (GD) module. To minimize risk and
 * reduce changes, we kept the original variable names but changed the data source:
 *
 * - Source Data: soItem.delivered_qty + soItem.planned_qty (from Sales Order)
 * - Internal Variables: deliveredQtyFromSource (represents already delivered + planned qty)
 * - Calculations: undeliveredQty = orderedQty - deliveredQtyFromSource (available to plan)
 * - Display Fields: to_delivered_qty (shows already fulfilled quantity)
 *
 * Example Flow:
 * - SO has so_quantity = 100, delivered_qty = 20, planned_qty = 30
 * - deliveredQtyFromSource = 20 + 30 = 50 (already fulfilled)
 * - undeliveredQty = 100 - 50 = 50 (available to plan)
 * - User can create PP for up to 50 units
 *
 * This ensures that when GD moves planned_qty to delivered_qty, the next PP
 * still correctly calculates the remaining quantity.
 *
 * See PPsaveAsCreated.js for how planned_qty gets updated when PP is saved.
 */

// ============================================================================
// BATCH QUERY HELPER FUNCTIONS
// ============================================================================

const batchFetchItems = async (materialIds) => {
  if (!materialIds || materialIds.length === 0) return new Map();
  const uniqueIds = [
    ...new Set(materialIds.filter((id) => id && id !== "undefined")),
  ];
  if (uniqueIds.length === 0) return new Map();

  try {
    // Fetch all items in SINGLE query using filter with "in" operator
    const result = await db
      .collection("Item")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            {
              prop: "id",
              operator: "in",
              value: uniqueIds,
            },
            {
              prop: "is_deleted",
              operator: "equal",
              value: 0,
            },
          ],
        },
      ])
      .get();

    const itemMap = new Map();
    (result.data || []).forEach((item) => {
      itemMap.set(item.id, item);
    });

    console.log(
      `✅ Batch fetched ${itemMap.size} items in SINGLE query (was ${uniqueIds.length} queries)`,
    );
    return itemMap;
  } catch (error) {
    console.error("Error batch fetching items:", error);
    return new Map();
  }
};

const batchFetchBalanceData = async (materialIds, plantId) => {
  if (!materialIds || materialIds.length === 0) {
    return { serial: new Map(), batch: new Map(), regular: new Map() };
  }

  const uniqueIds = [
    ...new Set(materialIds.filter((id) => id && id !== "undefined")),
  ];
  if (uniqueIds.length === 0) {
    return { serial: new Map(), batch: new Map(), regular: new Map() };
  }

  try {
    // Fetch all balance types in parallel - 3 queries total (was 150 queries)
    const [serialResult, batchResult, regularResult] = await Promise.all([
      db
        .collection("item_serial_balance")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "material_id", operator: "in", value: uniqueIds },
              { prop: "plant_id", operator: "equal", value: plantId },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get(),
      db
        .collection("item_batch_balance")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "material_id", operator: "in", value: uniqueIds },
              { prop: "plant_id", operator: "equal", value: plantId },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get(),
      db
        .collection("item_balance")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "material_id", operator: "in", value: uniqueIds },
              { prop: "plant_id", operator: "equal", value: plantId },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get(),
    ]);

    const serialMap = new Map();
    const batchMap = new Map();
    const regularMap = new Map();

    // Group serial balances by material_id
    (serialResult.data || []).forEach((balance) => {
      if (!serialMap.has(balance.material_id)) {
        serialMap.set(balance.material_id, []);
      }
      serialMap.get(balance.material_id).push(balance);
    });

    // Group batch balances by material_id
    (batchResult.data || []).forEach((balance) => {
      if (!batchMap.has(balance.material_id)) {
        batchMap.set(balance.material_id, []);
      }
      batchMap.get(balance.material_id).push(balance);
    });

    // Group regular balances by material_id
    (regularResult.data || []).forEach((balance) => {
      if (!regularMap.has(balance.material_id)) {
        regularMap.set(balance.material_id, []);
      }
      regularMap.get(balance.material_id).push(balance);
    });

    console.log(
      `✅ Batch fetched balance data: ${serialMap.size} serial, ${
        batchMap.size
      } batch, ${regularMap.size} regular in 3 queries (was ${
        uniqueIds.length * 3
      } queries)`,
    );
    return { serial: serialMap, batch: batchMap, regular: regularMap };
  } catch (error) {
    console.error("Error batch fetching balance data:", error);
    return { serial: new Map(), batch: new Map(), regular: new Map() };
  }
};

const fetchPickingSetup = async (plantId) => {
  try {
    const response = await db
      .collection("picking_setup")
      .where({ plant_id: plantId, picking_after: "Sales Order" })
      .get();

    if (!response?.data?.length) {
      return {
        pickingMode: "Manual",
        defaultStrategy: "RANDOM",
        fallbackStrategy: "RANDOM",
      };
    }

    const setup = response.data[0];
    return {
      pickingMode: setup.picking_mode || "Manual",
      defaultStrategy: setup.default_strategy_id || "RANDOM",
      fallbackStrategy: setup.fallback_strategy_id || "RANDOM",
    };
  } catch (error) {
    console.error("Error fetching picking setup:", error);
    return {
      pickingMode: "Manual",
      defaultStrategy: "RANDOM",
      fallbackStrategy: "RANDOM",
    };
  }
};

const fetchPackingSetup = async (organizationId) => {
  try {
    const response = await db
      .collection("packing_setup")
      .where({ organization_id: organizationId })
      .get();

    if (!response?.data?.length) {
      return {
        packingRequired: 0,
      };
    }

    const setup = response.data[0];
    return {
      packingRequired: setup.packing_required || 0,
    };
  } catch (error) {
    console.error("Error fetching packing setup:", error);
    return {
      packingRequired: 0,
    };
  }
};

const batchFetchBinLocations = async (locationIds) => {
  if (!locationIds || locationIds.length === 0) return new Map();
  const uniqueIds = [...new Set(locationIds.filter((id) => id))];
  if (uniqueIds.length === 0) return new Map();

  try {
    // Fetch all bin locations in SINGLE query using filter with "in" operator
    const result = await db
      .collection("bin_location")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "id", operator: "in", value: uniqueIds },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get();

    const binMap = new Map();
    (result.data || []).forEach((bin) => {
      binMap.set(bin.id, bin);
    });

    console.log(
      `✅ Batch fetched ${binMap.size} bin locations in SINGLE query (was ${uniqueIds.length} queries)`,
    );
    return binMap;
  } catch (error) {
    console.error("Error batch fetching bin locations:", error);
    return new Map();
  }
};

const batchFetchBatchData = async (materialIds, plantId) => {
  if (!materialIds || materialIds.length === 0) return new Map();
  const uniqueIds = [
    ...new Set(materialIds.filter((id) => id && id !== "undefined")),
  ];
  if (uniqueIds.length === 0) return new Map();

  try {
    // Fetch all batch data in SINGLE query using filter with "in" operator
    const result = await db
      .collection("batch")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "material_id", operator: "in", value: uniqueIds },
            { prop: "plant_id", operator: "equal", value: plantId },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get();

    const batchMap = new Map();
    (result.data || []).forEach((batch) => {
      if (!batchMap.has(batch.material_id)) {
        batchMap.set(batch.material_id, []);
      }
      batchMap.get(batch.material_id).push(batch);
    });

    console.log(
      `✅ Batch fetched batch data for ${batchMap.size} materials in SINGLE query (was ${uniqueIds.length} queries)`,
    );
    return batchMap;
  } catch (error) {
    console.error("Error batch fetching batch data:", error);
    return new Map();
  }
};

// 🔧 NEW: Batch fetch pending reserved data for all SO line items
const batchFetchPendingReserved = async (soLineItemIds, plantId) => {
  if (!soLineItemIds || soLineItemIds.length === 0) return new Map();
  const uniqueIds = [
    ...new Set(soLineItemIds.filter((id) => id && id !== "undefined")),
  ];
  if (uniqueIds.length === 0) return new Map();

  try {
    const result = await db
      .collection("on_reserved_gd")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "parent_line_id", operator: "in", value: uniqueIds },
            { prop: "plant_id", operator: "equal", value: plantId },
            { prop: "status", operator: "equal", value: "Pending" },
          ],
        },
      ])
      .get();

    // Group by parent_line_id (so_line_item_id)
    const reservedMap = new Map();
    (result.data || []).forEach((reserved) => {
      if (!reservedMap.has(reserved.parent_line_id)) {
        reservedMap.set(reserved.parent_line_id, []);
      }
      reservedMap.get(reserved.parent_line_id).push(reserved);
    });

    console.log(
      `✅ Batch fetched pending reserved data for ${reservedMap.size} SO lines in SINGLE query`,
    );
    return reservedMap;
  } catch (error) {
    console.error("Error batch fetching pending reserved data:", error);
    return new Map();
  }
};

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

// ============================================================================
// OPTIMIZED MAIN INVENTORY CHECK FUNCTION
// ============================================================================

const checkInventoryWithDuplicates = async (
  allItems,
  plantId,
  existingRowCount = 0,
) => {
  console.log("🚀 OPTIMIZED VERSION: Starting inventory check");
  const overallStart = Date.now();

  // Group items by material_id to find duplicates
  const materialGroups = {};

  allItems.forEach((item, index) => {
    const materialId = item.itemId;
    if (!materialGroups[materialId]) {
      materialGroups[materialId] = [];
    }
    materialGroups[materialId].push({
      ...item,
      originalIndex: index + existingRowCount,
    });
  });

  console.log("Material groups:", materialGroups);

  const insufficientItems = [];
  const insufficientDialogData = []; // Build insufficient dialog table entries

  // ========================================================================
  // STEP 1: Batch fetch ALL data upfront (replaces 100s of individual queries)
  // ========================================================================
  const materialIds = Object.keys(materialGroups).filter(
    (id) => id !== "undefined",
  );

  // Collect all SO line item IDs for pending reserved fetch
  const allSoLineItemIds = [];
  Object.values(materialGroups).forEach((items) => {
    items.forEach((item) => {
      if (item.so_line_item_id) {
        allSoLineItemIds.push(item.so_line_item_id);
      }
    });
  });

  console.log(`🚀 Fetching data for ${materialIds.length} unique materials...`);
  const fetchStart = Date.now();

  const [itemDataMap, balanceDataMaps, pickingSetup, batchDataMap, pendingReservedMap] =
    await Promise.all([
      batchFetchItems(materialIds),
      batchFetchBalanceData(materialIds, plantId),
      fetchPickingSetup(plantId),
      batchFetchBatchData(materialIds, plantId),
      batchFetchPendingReserved(allSoLineItemIds, plantId),
    ]);

  console.log(
    `✅ All data fetched in ${
      Date.now() - fetchStart
    }ms (was 500+ queries, now 5-6 queries)`,
  );

  // Extract for easier access
  const { pickingMode, defaultStrategy, fallbackStrategy } = pickingSetup;

  // ========================================================================
  // STEP 2: Collect all location IDs for batch bin location fetch
  // ========================================================================
  const allLocationIds = new Set();
  balanceDataMaps.serial.forEach((balances) => {
    balances.forEach((b) =>
      allLocationIds.add(b.location_id || b.bin_location_id),
    );
  });
  balanceDataMaps.batch.forEach((balances) => {
    balances.forEach((b) => allLocationIds.add(b.location_id));
  });
  balanceDataMaps.regular.forEach((balances) => {
    balances.forEach((b) => allLocationIds.add(b.location_id));
  });

  // Batch fetch ALL bin locations (replaces 250+ individual queries)
  const binLocationMap = await batchFetchBinLocations([...allLocationIds]);

  // Store globally for allocation phase
  window.cachedBinLocationMap = binLocationMap;
  window.cachedItemDataMap = itemDataMap;
  window.cachedBalanceDataMaps = balanceDataMaps;
  window.cachedBatchDataMap = batchDataMap;
  window.cachedPickingSetup = pickingSetup;
  window.cachedPendingReservedMap = pendingReservedMap;

  // ========================================================================
  // STEP 3: Process each material and build table data in memory
  // ========================================================================
  const tableToArray = this.getValue("table_to") || [];
  const fieldsToDisable = [];
  const fieldsToEnable = [];

  for (const [materialId, items] of Object.entries(materialGroups)) {
    console.log("Processing materialID:", materialId);

    // Handle undefined material IDs
    if (materialId === "undefined") {
      console.log(`Skipping item with null materialId`);
      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        tableToArray[index] = {
          ...tableToArray[index],
          material_id: "",
          material_name: item.itemName || "",
          to_material_desc: item.sourceItem.so_desc || "",
          to_order_quantity: orderedQty,
          to_delivered_qty: deliveredQty,
          to_initial_delivered_qty: deliveredQty,
          to_order_uom_id: item.altUOM,
          to_uom_id: item.altUOM,
          more_desc: item.sourceItem.more_desc || "",
          line_remark_1: item.sourceItem.line_remark_1 || "",
          line_remark_2: item.sourceItem.line_remark_2 || "",
          base_uom_id: "",
          unit_price: item.sourceItem.so_item_price || 0,
          total_price: item.sourceItem.so_amount || 0,
          item_costing_method: "",
          to_qty: undeliveredQty,
        };

        fieldsToDisable.push(`table_to.${index}.to_delivery_qty`);
        fieldsToEnable.push(`table_to.${index}.to_qty`);
      });
      continue;
    }

    // Get item data from cache
    const itemData = itemDataMap.get(materialId);
    if (!itemData) {
      console.error(`Item not found in cache: ${materialId}`);
      continue;
    }

    // Handle items with stock_control = 0
    if (itemData.stock_control === 0 && itemData.show_delivery === 0) {
      console.log(`Skipping item ${materialId} due to stock_control settings`);
      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        tableToArray[index] = {
          ...tableToArray[index],
          material_id: materialId,
          material_name: item.itemName,
          to_material_desc: item.sourceItem.so_desc || "",
          to_order_quantity: orderedQty,
          to_delivered_qty: deliveredQty + undeliveredQty,
          to_initial_delivered_qty: deliveredQty,
          to_order_uom_id: item.altUOM,
          to_uom_id: item.altUOM,
          more_desc: item.sourceItem.more_desc || "",
          line_remark_1: item.sourceItem.line_remark_1 || "",
          line_remark_2: item.sourceItem.line_remark_2 || "",
          base_uom_id: itemData.based_uom || "",
          unit_price: item.sourceItem.so_item_price || 0,
          total_price: item.sourceItem.so_amount || 0,
          item_costing_method: itemData.material_costing_method,
          to_qty: undeliveredQty,
          to_undelivered_qty: 0,
        };

        if (undeliveredQty <= 0) {
          fieldsToDisable.push(
            `table_to.${index}.to_qty`,
            `table_to.${index}.to_delivery_qty`,
          );
        } else {
          fieldsToDisable.push(`table_to.${index}.to_delivery_qty`);
          fieldsToEnable.push(`table_to.${index}.to_qty`);
        }
      });
      continue;
    }

    // Get balance data from cache
    let balanceData = [];
    let collectionUsed = "";

    if (itemData.serial_number_management === 1) {
      balanceData = balanceDataMaps.serial.get(materialId) || [];
      collectionUsed = "item_serial_balance";
    } else if (itemData.item_batch_management === 1) {
      balanceData = balanceDataMaps.batch.get(materialId) || [];
      collectionUsed = "item_batch_balance";
    } else {
      balanceData = balanceDataMaps.regular.get(materialId) || [];
      collectionUsed = "item_balance";
    }

    // Calculate total available stock (unrestricted + pending reserved for these SO lines)
    const totalUnrestrictedQtyBase = balanceData.reduce(
      (sum, balance) => sum + (balance.unrestricted_qty || 0),
      0,
    );

    // 🔧 NEW: Calculate total pending reserved qty for all SO lines of this material
    // Reserved stock for a specific SO is AVAILABLE for that SO
    let totalPendingReservedQtyBase = 0;
    items.forEach((item) => {
      if (item.so_line_item_id) {
        const reservedData = pendingReservedMap.get(item.so_line_item_id) || [];
        reservedData.forEach((reserved) => {
          totalPendingReservedQtyBase += parseFloat(reserved.open_qty || 0);
        });
      }
    });

    // Subtract existing allocations
    let totalPreviousAllocations = 0;
    if (
      window.globalAllocationTracker &&
      window.globalAllocationTracker.has(materialId)
    ) {
      const materialAllocations =
        window.globalAllocationTracker.get(materialId);
      materialAllocations.forEach((rowAllocations) => {
        rowAllocations.forEach((qty) => {
          totalPreviousAllocations += qty;
        });
      });
    }

    // Available = unrestricted + reserved (for this SO) - previous allocations
    const availableStockAfterAllocations = Math.max(
      0,
      totalUnrestrictedQtyBase + totalPendingReservedQtyBase - totalPreviousAllocations,
    );

    console.log(
      `Material ${materialId}: Unrestricted=${totalUnrestrictedQtyBase}, PendingReserved=${totalPendingReservedQtyBase}, Available=${availableStockAfterAllocations}, Collection=${collectionUsed}`,
    );

    // Handle UI controls based on balance data length
    if (balanceData.length === 1) {
      items.forEach((item) => {
        fieldsToDisable.push(`table_to.${item.originalIndex}.to_delivery_qty`);
        fieldsToEnable.push(`table_to.${item.originalIndex}.to_qty`);
      });
    }

    // Calculate total demand
    let totalDemandBase = 0;
    items.forEach((item) => {
      const undeliveredQty = item.orderedQty - item.deliveredQtyFromSource;
      let undeliveredQtyBase = undeliveredQty;
      if (item.altUOM !== itemData.based_uom) {
        const uomConversion = itemData.table_uom_conversion?.find(
          (conv) => conv.alt_uom_id === item.altUOM,
        );
        if (uomConversion && uomConversion.base_qty) {
          undeliveredQtyBase = undeliveredQty * uomConversion.base_qty;
        }
      }
      totalDemandBase += undeliveredQtyBase;

      // Set basic item data
      const index = item.originalIndex;
      tableToArray[index] = {
        ...tableToArray[index],
        material_id: materialId,
        material_name: item.itemName,
        to_material_desc: item.sourceItem.so_desc || "",
        to_order_quantity: item.orderedQty,
        to_delivered_qty: item.deliveredQtyFromSource,
        to_initial_delivered_qty: item.deliveredQtyFromSource,
        to_order_uom_id: item.altUOM,
        to_uom_id: item.altUOM,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        base_uom_id: itemData.based_uom || "",
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        item_costing_method: itemData.material_costing_method,
      };
    });

    console.log(
      `Material ${materialId}: Available=${availableStockAfterAllocations}, Total Demand=${totalDemandBase}`,
    );

    // Check if insufficient stock
    const totalShortfallBase = totalDemandBase - availableStockAfterAllocations;

    if (totalShortfallBase > 0) {
      console.log(
        `❌ Insufficient stock for material ${materialId}: Shortfall=${totalShortfallBase}`,
      );

      // Handle insufficient stock (serialized vs non-serialized)
      if (itemData.serial_number_management === 1) {
        // Serialized items - handle in base UOM
        let remainingSerialCount = balanceData.length;

        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          const orderedQtyBase = convertToBaseUOM(
            orderedQty,
            item.altUOM,
            itemData,
          );
          const deliveredQtyBase = convertToBaseUOM(
            deliveredQty,
            item.altUOM,
            itemData,
          );
          const undeliveredQtyBase = convertToBaseUOM(
            undeliveredQty,
            item.altUOM,
            itemData,
          );

          let availableQtyBase = 0;
          if (remainingSerialCount > 0 && undeliveredQtyBase > 0) {
            const requiredUnitsBase = Math.floor(undeliveredQtyBase);
            availableQtyBase = Math.min(
              remainingSerialCount,
              requiredUnitsBase,
            );
            remainingSerialCount -= availableQtyBase;
          }

          // Add to insufficient dialog data (in base UOM for serialized items)
          insufficientDialogData.push({
            material_id: materialId,
            material_name: item.itemName,
            material_uom: itemData.based_uom,
            order_quantity: orderedQtyBase,
            undelivered_qty: undeliveredQtyBase,
            available_qty: availableQtyBase,
            shortfall_qty: undeliveredQtyBase - availableQtyBase,
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          });

          // Update table array with base UOM
          tableToArray[index] = {
            ...tableToArray[index],
            to_order_quantity: orderedQtyBase,
            to_delivered_qty: deliveredQtyBase,
            to_initial_delivered_qty: deliveredQtyBase,
            to_order_uom_id: itemData.based_uom,
            to_uom_id: itemData.based_uom,
          };

          // Insufficient stock - don't fill to_qty
          tableToArray[index].to_qty = 0;
        });
      } else {
        // Non-serialized items
        let remainingStockBase = Math.max(0, availableStockAfterAllocations);

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
                (conv) => conv.alt_uom_id === item.altUOM,
              );
              if (uomConversion && uomConversion.base_qty) {
                undeliveredQtyBase = undeliveredQty * uomConversion.base_qty;
              }
            }

            const allocatedBase = Math.min(
              remainingStockBase,
              undeliveredQtyBase,
            );
            const uomConversion = itemData.table_uom_conversion?.find(
              (conv) => conv.alt_uom_id === item.altUOM,
            );
            availableQtyAlt =
              item.altUOM !== itemData.based_uom
                ? allocatedBase / (uomConversion?.base_qty || 1)
                : allocatedBase;

            remainingStockBase -= allocatedBase;
          }

          // Add to insufficient dialog data
          insufficientDialogData.push({
            material_id: materialId,
            material_name: item.itemName,
            material_uom: item.altUOM,
            order_quantity: orderedQty,
            undelivered_qty: undeliveredQty,
            available_qty: availableQtyAlt,
            shortfall_qty: undeliveredQty - availableQtyAlt,
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          });

          // Insufficient stock - don't fill to_qty
          tableToArray[index].to_qty = 0;
        });
      }

      insufficientItems.push({
        itemId: materialId,
        itemName: items[0].itemName,
        soNo: items.map((item) => item.so_no).join(", "),
        lineCount: items.length,
      });
    } else {
      // Sufficient stock
      console.log(`✅ Sufficient stock for material ${materialId}`);

      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        // 🔧 Use cached pending reserved data instead of new DB query
        const pendingReservedData = pendingReservedMap.get(item.so_line_item_id) || [];
        const pendingTotal = pendingReservedData.reduce(
          (total, doc) => total + parseFloat(doc.open_qty || 0),
          0,
        );
        // Cap by pending reserved qty (if any reservations exist)
        const suggestedQty = pendingTotal > 0 ? Math.min(undeliveredQty, pendingTotal) : undeliveredQty;

        if (suggestedQty <= 0) {
          fieldsToDisable.push(
            `table_to.${index}.to_qty`,
            `table_to.${index}.to_delivery_qty`,
          );
          tableToArray[index].to_qty = 0;
        } else {
          if (itemData.serial_number_management === 1) {
            // Serialized - use base UOM
            const orderedQtyBase = convertToBaseUOM(
              orderedQty,
              item.altUOM,
              itemData,
            );
            const deliveredQtyBase = convertToBaseUOM(
              deliveredQty,
              item.altUOM,
              itemData,
            );
            const suggestedQtyBase = convertToBaseUOM(
              suggestedQty,
              item.altUOM,
              itemData,
            );

            tableToArray[index] = {
              ...tableToArray[index],
              to_order_quantity: orderedQtyBase,
              to_delivered_qty: deliveredQtyBase,
              to_initial_delivered_qty: deliveredQtyBase,
              to_order_uom_id: itemData.based_uom,
              to_uom_id: itemData.based_uom,
            };

            // Sufficient stock - fill to_qty only (allocation deferred to workflow)
            if (pickingMode === "Manual") {
              tableToArray[index].to_qty =
                balanceData.length === 1 ? suggestedQtyBase : 0;
            } else {
              tableToArray[index].to_qty = suggestedQtyBase;
            }
          } else {
            // Non-serialized - fill to_qty only (allocation deferred to workflow)
            if (pickingMode === "Manual") {
              tableToArray[index].to_qty =
                balanceData.length === 1 ? suggestedQty : 0;
            } else {
              tableToArray[index].to_qty = suggestedQty;
            }
          }
        }
      });
    }
  }

  // ========================================================================
  // STEP 4: Single setData call with complete table array
  // ========================================================================
  console.log(
    "🚀 OPTIMIZATION: Applying all updates in single setData call...",
  );
  await this.setData({ table_to: tableToArray });

  // Apply insufficient dialog data if any
  if (insufficientDialogData.length > 0) {
    await this.setData({
      "dialog_insufficient.table_insufficient": insufficientDialogData,
    });
    console.log(
      `✅ Updated insufficient dialog with ${insufficientDialogData.length} items`,
    );
  }

  // Apply field enable/disable
  if (fieldsToDisable.length > 0) {
    this.disabled(fieldsToDisable, true);
  }
  if (fieldsToEnable.length > 0) {
    this.disabled(fieldsToEnable, false);
  }

  console.log(`✅ All ${tableToArray.length} rows updated in single operation`);

  console.log(
    `✅ OPTIMIZATION COMPLETE: Total time ${Date.now() - overallStart}ms`,
  );
  console.log(
    "Stock checking completed. Allocation will be performed during save workflow.",
  );
  return insufficientItems;
};

// ============================================================================
// ALLOCATION FUNCTIONS REMOVED
// Allocation logic has been moved to the workflow (runs during PP save)
// This improves performance and centralizes allocation logic
// ============================================================================

// Initialize global tracker
if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

// ============================================================================
// TABLE CREATION HELPER
// ============================================================================

const createTableToWithBaseUOM = async (allItems) => {
  const processedItems = [];

  for (const item of allItems) {
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

    if (itemData?.serial_number_management === 1) {
      const orderedQtyBase = convertToBaseUOM(
        item.orderedQty,
        item.altUOM,
        itemData,
      );
      const deliveredQtyBase = convertToBaseUOM(
        item.deliveredQtyFromSource,
        item.altUOM,
        itemData,
      );

      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        to_material_desc: item.itemDesc || "",
        to_order_quantity: orderedQtyBase,
        to_delivered_qty: deliveredQtyBase,
        to_undelivered_qty: orderedQtyBase - deliveredQtyBase,
        to_order_uom_id: itemData.based_uom,
        to_uom_id: itemData.based_uom,
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
        base_uom_id: itemData.based_uom,
        customer_id: item.customer_id,
      });
    } else {
      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        to_material_desc: item.itemDesc || "",
        to_order_quantity: item.orderedQty,
        to_delivered_qty: item.deliveredQtyFromSource,
        to_undelivered_qty: item.orderedQty - item.deliveredQtyFromSource,
        to_order_uom_id: item.altUOM,
        to_uom_id: item.altUOM,
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
        customer_id: item.customer_id,
      });
    }
  }

  return processedItems;
};

// ============================================================================
// MAIN EXECUTION (Keep existing)
// ============================================================================

(async () => {
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const previousReferenceType = this.getValue("reference_type");
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingTO = this.getValue("table_to");
  const customerName = this.getValue("customer_name");

  if (!window.globalAllocationTracker) {
    window.globalAllocationTracker = new Map();
  } else if (!existingTO || existingTO.length === 0) {
    window.globalAllocationTracker.clear();
  }

  let allItems = [];
  let salesOrderNumber = [];
  let soId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one sales order / item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });
    return;
  }

  const packingRequired = await fetchPackingSetup(
    this.getValue("organization_id"),
  );

  const uniqueCustomer = new Set(
    currentItemArray.map((so) =>
      referenceType === "Document" ? so.customer_id : so.customer_id.id,
    ),
  );
  const allSameCustomer = uniqueCustomer.size === 1;

  if (!allSameCustomer && packingRequired == 1) {
    this.$alert(
      "Picking item(s) to more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
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

    existingTO = [];
  }

  const newCustomerIds = [
    ...new Set(
      currentItemArray.map((so) =>
        referenceType === "Document" ? so.customer_id : so.customer_id.id,
      ),
    ),
  ];

  const existingCustomerIds = customerName || [];
  const allCustomerIds = [
    ...new Set([
      ...(Array.isArray(existingCustomerIds)
        ? existingCustomerIds
        : [existingCustomerIds]),
      ...newCustomerIds,
    ]),
  ];

  this.closeDialog("dialog_select_item");
  this.showLoading();

  switch (referenceType) {
    case "Document":
      for (const so of currentItemArray) {
        for (const soItem of so.table_so) {
          allItems.push({
            itemId: soItem.item_name,
            itemName: soItem.item_id,
            itemDesc: soItem.so_desc,
            orderedQty: parseFloat(soItem.so_quantity || 0),
            altUOM: soItem.so_item_uom || "",
            sourceItem: soItem,
            deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0) + parseFloat(soItem.planned_qty || 0),
            original_so_id: so.sales_order_id,
            so_no: so.sales_order_number,
            so_line_item_id: soItem.id,
            item_category_id: soItem.item_category_id,
            customer_id: so.customer_id,
          });
        }
      }
      break;

    case "Item":
      for (const soItem of currentItemArray) {
        allItems.push({
          itemId: soItem.item.id,
          itemName: soItem.item.material_name,
          itemDesc: soItem.so_desc,
          orderedQty: parseFloat(soItem.so_quantity || 0),
          altUOM: soItem.so_item_uom || "",
          sourceItem: soItem,
          deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0) + parseFloat(soItem.planned_qty || 0),
          original_so_id: soItem.sales_order.id,
          so_no: soItem.sales_order.so_no,
          so_line_item_id: soItem.sales_order_line_id,
          item_category_id: soItem.item.item_category,
          customer_id: soItem.customer_id,
        });
      }
      break;
  }

  console.log("allItems", allItems);
  allItems = allItems.filter(
    (to) =>
      to.deliveredQtyFromSource !== to.orderedQty &&
      !existingTO.find(
        (toItem) => toItem.so_line_item_id === to.so_line_item_id,
      ),
  );

  console.log("allItems after filter", allItems);

  let newTableTo = await createTableToWithBaseUOM(allItems);

  const latestTableTO = [...existingTO, ...newTableTo];

  const newTableInsufficient = allItems.map((item) => ({
    material_id: item.itemId,
    material_name: item.itemName,
    material_uom: item.altUOM,
    order_quantity: item.orderedQty,
    available_qty: "",
    shortfall_qty: "",
    fm_key: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
  }));

  soId = [...new Set(latestTableTO.map((gr) => gr.line_so_id))];
  salesOrderNumber = [...new Set(latestTableTO.map((gr) => gr.line_so_no))];

  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].currency
        : currentItemArray[0].sales_order.so_currency,
    customer_name: allCustomerIds,
    table_to: latestTableTO,
    so_no: salesOrderNumber.join(", "),
    so_id: soId,
    reference_type: referenceType,
    dialog_insufficient: {
      table_insufficient: newTableInsufficient,
    },
  });

  setTimeout(async () => {
    try {
      const plantId = this.getValue("plant_id");
      const newItems = allItems.filter((item) => {
        return !existingTO.find(
          (toItem) => toItem.so_line_item_id === item.so_line_item_id,
        );
      });

      const insufficientItems = await checkInventoryWithDuplicates(
        newItems,
        plantId,
        existingTO.length,
      );

      if (insufficientItems.length > 0) {
        console.log(
          "Materials with insufficient inventory:",
          insufficientItems,
        );
        this.openDialog("dialog_insufficient");
      }

      console.log("Finished populating table_to items");
    } catch (error) {
      console.error("Error in inventory check:", error);
    }
  }, 200);

  this.hideLoading();
})();
