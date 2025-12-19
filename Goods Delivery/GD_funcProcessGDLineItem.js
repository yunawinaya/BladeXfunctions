// ============================================================================
// OPTIMIZED VERSION - Performance improvements for 50+ items
// Key optimizations:
// 1. Batch queries - ALL data fetched upfront in 4-5 queries instead of 500+
// 2. Single setData call - Build entire table data, then update once
// 3. Cached data reuse - Allocation phase uses pre-fetched data
// 4. Batch bin location query - Single query for all locations
// ============================================================================

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
      `✅ Batch fetched ${itemMap.size} items in SINGLE query (was ${uniqueIds.length} queries)`
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
      } queries)`
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
      .where({ plant_id: plantId, picking_after: "Goods Delivery" })
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
      `✅ Batch fetched ${binMap.size} bin locations in SINGLE query (was ${uniqueIds.length} queries)`
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
      `✅ Batch fetched batch data for ${batchMap.size} materials in SINGLE query (was ${uniqueIds.length} queries)`
    );
    return batchMap;
  } catch (error) {
    console.error("Error batch fetching batch data:", error);
    return new Map();
  }
};

// Helper function to convert quantity from alt UOM to base UOM
const convertToBaseUOM = (quantity, altUOM, itemData) => {
  if (!altUOM || altUOM === itemData.based_uom) {
    return quantity;
  }

  const uomConversion = itemData.table_uom_conversion?.find(
    (conv) => conv.alt_uom_id === altUOM
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
  existingRowCount = 0
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
  const itemsForAllocation = [];
  const insufficientDialogData = []; // Build insufficient dialog table entries

  // ========================================================================
  // STEP 1: Batch fetch ALL data upfront (replaces 100s of individual queries)
  // ========================================================================
  const materialIds = Object.keys(materialGroups).filter(
    (id) => id !== "undefined"
  );

  console.log(`🚀 Fetching data for ${materialIds.length} unique materials...`);
  const fetchStart = Date.now();

  const [itemDataMap, balanceDataMaps, pickingSetup, batchDataMap] =
    await Promise.all([
      batchFetchItems(materialIds),
      batchFetchBalanceData(materialIds, plantId),
      fetchPickingSetup(plantId),
      batchFetchBatchData(materialIds, plantId),
    ]);

  console.log(
    `✅ All data fetched in ${
      Date.now() - fetchStart
    }ms (was 500+ queries, now 4-5 queries)`
  );

  // Extract for easier access
  const { pickingMode, defaultStrategy, fallbackStrategy } = pickingSetup;

  // ========================================================================
  // STEP 2: Collect all location IDs for batch bin location fetch
  // ========================================================================
  const allLocationIds = new Set();
  balanceDataMaps.serial.forEach((balances) => {
    balances.forEach((b) =>
      allLocationIds.add(b.location_id || b.bin_location_id)
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

  // ========================================================================
  // STEP 3: Process each material and build table data in memory
  // ========================================================================
  const tableGdArray = this.getValue("table_gd") || [];
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

        tableGdArray[index] = {
          ...tableGdArray[index],
          material_id: "",
          material_name: item.itemName || "",
          gd_material_desc: item.itemDesc || "",
          gd_order_quantity: orderedQty,
          gd_delivered_qty: deliveredQty,
          gd_initial_delivered_qty: deliveredQty,
          gd_order_uom_id: item.altUOM,
          good_delivery_uom_id: item.altUOM,
          more_desc: item.moreDesc || "",
          line_remark_1: item.lineRemark1 || "",
          line_remark_2: item.lineRemark2 || "",
          base_uom_id: "",
          unit_price: item.unitPrice || 0,
          total_price: item.soAmount || 0,
          item_costing_method: "",
          gd_qty: undeliveredQty,
        };

        fieldsToDisable.push(`table_gd.${index}.gd_delivery_qty`);
        fieldsToEnable.push(`table_gd.${index}.gd_qty`);
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

        tableGdArray[index] = {
          ...tableGdArray[index],
          material_id: materialId,
          material_name: item.itemName,
          gd_material_desc: item.itemDesc || "",
          gd_order_quantity: orderedQty,
          gd_delivered_qty: deliveredQty + undeliveredQty,
          gd_initial_delivered_qty: deliveredQty,
          gd_order_uom_id: item.altUOM,
          good_delivery_uom_id: item.altUOM,
          more_desc: item.moreDesc || "",
          line_remark_1: item.lineRemark1 || "",
          line_remark_2: item.lineRemark2 || "",
          base_uom_id: itemData.based_uom || "",
          unit_price: item.unitPrice || 0,
          total_price: item.soAmount || 0,
          item_costing_method: itemData.material_costing_method,
          gd_qty: undeliveredQty,
          gd_undelivered_qty: 0,
        };

        if (undeliveredQty <= 0) {
          fieldsToDisable.push(
            `table_gd.${index}.gd_qty`,
            `table_gd.${index}.gd_delivery_qty`
          );
        } else {
          fieldsToDisable.push(`table_gd.${index}.gd_delivery_qty`);
          fieldsToEnable.push(`table_gd.${index}.gd_qty`);
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

    // Calculate total available stock
    const totalUnrestrictedQtyBase = balanceData.reduce(
      (sum, balance) => sum + (balance.unrestricted_qty || 0),
      0
    );

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

    const availableStockAfterAllocations = Math.max(
      0,
      totalUnrestrictedQtyBase - totalPreviousAllocations
    );

    console.log(
      `Material ${materialId}: Available=${availableStockAfterAllocations}, Collection=${collectionUsed}`
    );

    // Handle UI controls based on balance data length
    if (balanceData.length === 1) {
      items.forEach((item) => {
        fieldsToDisable.push(`table_gd.${item.originalIndex}.gd_delivery_qty`);
        fieldsToEnable.push(`table_gd.${item.originalIndex}.gd_qty`);
      });
    }

    // Calculate total demand
    let totalDemandBase = 0;
    items.forEach((item) => {
      const undeliveredQty = item.orderedQty - item.deliveredQtyFromSource;
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
      tableGdArray[index] = {
        ...tableGdArray[index],
        material_id: materialId,
        material_name: item.itemName,
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: item.orderedQty,
        gd_delivered_qty: item.deliveredQtyFromSource,
        gd_initial_delivered_qty: item.deliveredQtyFromSource,
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        more_desc: item.moreDesc || "",
        line_remark_1: item.lineRemark1 || "",
        line_remark_2: item.lineRemark2 || "",
        base_uom_id: itemData.based_uom || "",
        unit_price: item.unitPrice || 0,
        total_price: item.soAmount || 0,
        item_costing_method: itemData.material_costing_method,
      };
    });

    console.log(
      `Material ${materialId}: Available=${availableStockAfterAllocations}, Total Demand=${totalDemandBase}`
    );

    // Check if insufficient stock
    const totalShortfallBase = totalDemandBase - availableStockAfterAllocations;

    if (totalShortfallBase > 0) {
      console.log(
        `❌ Insufficient stock for material ${materialId}: Shortfall=${totalShortfallBase}`
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
            itemData
          );
          const deliveredQtyBase = convertToBaseUOM(
            deliveredQty,
            item.altUOM,
            itemData
          );
          const undeliveredQtyBase = convertToBaseUOM(
            undeliveredQty,
            item.altUOM,
            itemData
          );

          let availableQtyBase = 0;
          if (remainingSerialCount > 0 && undeliveredQtyBase > 0) {
            const requiredUnitsBase = Math.floor(undeliveredQtyBase);
            availableQtyBase = Math.min(
              remainingSerialCount,
              requiredUnitsBase
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
          tableGdArray[index] = {
            ...tableGdArray[index],
            gd_order_quantity: orderedQtyBase,
            gd_delivered_qty: deliveredQtyBase,
            gd_initial_delivered_qty: deliveredQtyBase,
            gd_order_uom_id: itemData.based_uom,
            good_delivery_uom_id: itemData.based_uom,
          };

          if (pickingMode === "Manual") {
            tableGdArray[index].gd_qty =
              balanceData.length === 1 ? availableQtyBase : 0;
          } else {
            // Auto mode - check eligibility
            const isEligible =
              availableQtyBase > 0 &&
              (balanceData.length === 1 ||
                pickingMode === "Auto" ||
                (["FIXED BIN", "RANDOM"].includes(defaultStrategy) &&
                  ["FIXED BIN", "RANDOM"].includes(fallbackStrategy)));

            if (isEligible) {
              tableGdArray[index].gd_qty = availableQtyBase;
              itemsForAllocation.push({
                materialId,
                rowIndex: index,
                quantity: availableQtyBase,
                plantId,
                uomId: itemData.based_uom,
                isSerializedItem: true,
              });
            } else {
              tableGdArray[index].gd_qty = 0;
            }
          }
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

          if (pickingMode === "Manual") {
            tableGdArray[index].gd_qty =
              balanceData.length === 1 ? availableQtyAlt : 0;
          } else {
            const isEligible =
              availableQtyAlt > 0 &&
              (balanceData.length === 1 ||
                pickingMode === "Auto" ||
                (["FIXED BIN", "RANDOM"].includes(defaultStrategy) &&
                  ["FIXED BIN", "RANDOM"].includes(fallbackStrategy)));

            if (isEligible) {
              tableGdArray[index].gd_qty = availableQtyAlt;

              let allocationQty = availableQtyAlt;
              if (item.altUOM !== itemData.based_uom) {
                const uomConv = itemData.table_uom_conversion?.find(
                  (c) => c.alt_uom_id === item.altUOM
                );
                allocationQty = uomConv?.base_qty
                  ? availableQtyAlt * uomConv.base_qty
                  : availableQtyAlt;
              }

              itemsForAllocation.push({
                materialId,
                rowIndex: index,
                quantity: allocationQty,
                plantId,
                uomId: item.altUOM,
                isSerializedItem: false,
              });
            } else {
              tableGdArray[index].gd_qty = 0;
            }
          }
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

        if (undeliveredQty <= 0) {
          fieldsToDisable.push(
            `table_gd.${index}.gd_qty`,
            `table_gd.${index}.gd_delivery_qty`
          );
          tableGdArray[index].gd_qty = 0;
        } else {
          if (itemData.serial_number_management === 1) {
            // Serialized - use base UOM
            const orderedQtyBase = convertToBaseUOM(
              orderedQty,
              item.altUOM,
              itemData
            );
            const deliveredQtyBase = convertToBaseUOM(
              deliveredQty,
              item.altUOM,
              itemData
            );
            const undeliveredQtyBase = convertToBaseUOM(
              undeliveredQty,
              item.altUOM,
              itemData
            );

            tableGdArray[index] = {
              ...tableGdArray[index],
              gd_order_quantity: orderedQtyBase,
              gd_delivered_qty: deliveredQtyBase,
              gd_initial_delivered_qty: deliveredQtyBase,
              gd_order_uom_id: itemData.based_uom,
              good_delivery_uom_id: itemData.based_uom,
            };

            if (pickingMode === "Manual") {
              tableGdArray[index].gd_qty =
                balanceData.length === 1 ? undeliveredQtyBase : 0;
            } else {
              tableGdArray[index].gd_qty = undeliveredQtyBase;

              const isEligible =
                materialId &&
                (balanceData.length === 1 ||
                  pickingMode === "Auto" ||
                  (["FIXED BIN", "RANDOM"].includes(defaultStrategy) &&
                    ["FIXED BIN", "RANDOM"].includes(fallbackStrategy)));

              if (isEligible) {
                itemsForAllocation.push({
                  materialId,
                  rowIndex: index,
                  quantity: undeliveredQtyBase,
                  plantId,
                  uomId: itemData.based_uom,
                  isSerializedItem: true,
                });
              }
            }
          } else {
            // Non-serialized
            if (pickingMode === "Manual") {
              tableGdArray[index].gd_qty =
                balanceData.length === 1 ? undeliveredQty : 0;
            } else {
              tableGdArray[index].gd_qty = undeliveredQty;

              const isEligible =
                materialId &&
                (balanceData.length === 1 ||
                  pickingMode === "Auto" ||
                  (["FIXED BIN", "RANDOM"].includes(defaultStrategy) &&
                    ["FIXED BIN", "RANDOM"].includes(fallbackStrategy)));

              if (isEligible) {
                let allocationQty = undeliveredQty;
                if (item.altUOM !== itemData.based_uom) {
                  const uomConv = itemData.table_uom_conversion?.find(
                    (c) => c.alt_uom_id === item.altUOM
                  );
                  allocationQty = uomConv?.base_qty
                    ? undeliveredQty * uomConv.base_qty
                    : undeliveredQty;
                }

                itemsForAllocation.push({
                  materialId,
                  rowIndex: index,
                  quantity: allocationQty,
                  plantId,
                  uomId: item.altUOM,
                  isSerializedItem: false,
                });
              }
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
    "🚀 OPTIMIZATION: Applying all updates in single setData call..."
  );
  await this.setData({ table_gd: tableGdArray });

  // Apply insufficient dialog data if any
  if (insufficientDialogData.length > 0) {
    await this.setData({
      "dialog_insufficient.table_insufficient": insufficientDialogData,
    });
    console.log(
      `✅ Updated insufficient dialog with ${insufficientDialogData.length} items`
    );
  }

  // Apply field enable/disable
  if (fieldsToDisable.length > 0) {
    this.disabled(fieldsToDisable, true);
  }
  if (fieldsToEnable.length > 0) {
    this.disabled(fieldsToEnable, false);
  }

  console.log(`✅ All ${tableGdArray.length} rows updated in single operation`);

  // ========================================================================
  // STEP 5: Process allocations sequentially (keep existing logic)
  // ========================================================================
  console.log(
    `Processing ${itemsForAllocation.length} items for allocation...`
  );

  itemsForAllocation.sort((a, b) => a.rowIndex - b.rowIndex);

  for (const allocationItem of itemsForAllocation) {
    console.log(`Processing allocation for row ${allocationItem.rowIndex}`);
    await performAutomaticAllocation(
      allocationItem.materialId,
      allocationItem.rowIndex,
      allocationItem.quantity,
      allocationItem.plantId,
      allocationItem.uomId,
      allocationItem.isSerializedItem
    );
  }

  console.log(
    `✅ OPTIMIZATION COMPLETE: Total time ${Date.now() - overallStart}ms`
  );
  console.log("All allocations completed");
  return insufficientItems;
};

// ============================================================================
// OPTIMIZED ALLOCATION FUNCTION - Reuses cached data
// ============================================================================

const performAutomaticAllocation = async (
  materialId,
  rowIndex,
  quantity,
  plantId,
  uomId,
  isSerializedItem = false
) => {
  try {
    console.log(
      `Auto-allocating for row ${rowIndex}, material ${materialId}, quantity ${quantity}`
    );

    // ========================================================================
    // OPTIMIZATION: Reuse cached data instead of re-querying
    // ========================================================================
    const pickingSetup = window.cachedPickingSetup;
    const itemData = window.cachedItemDataMap.get(materialId);
    const balanceDataMaps = window.cachedBalanceDataMaps;
    const batchDataMap = window.cachedBatchDataMap;
    const binLocationMap = window.cachedBinLocationMap;

    if (!itemData) {
      console.log("Item not found in cache, skipping");
      return;
    }

    const { pickingMode, defaultStrategy, fallbackStrategy } = pickingSetup;

    if (pickingMode !== "Auto") {
      console.log(`Picking mode is ${pickingMode}, skipping auto-allocation`);
      return;
    }

    // Get current allocations
    const getCurrentAllocations = (materialId, currentRowIndex) => {
      const materialAllocations =
        window.globalAllocationTracker.get(materialId) || new Map();
      const allocatedQuantities = new Map();

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

    const applyAllocationsToBalances = (
      balances,
      allocatedQuantities,
      isSerialManaged,
      isBatchManaged
    ) => {
      return balances.map((balance) => {
        let key;
        if (isSerialManaged) {
          if (isBatchManaged) {
            key = `${balance.location_id || balance.bin_location_id}-${
              balance.serial_number || "no_serial"
            }-${balance.batch_id || "no_batch"}`;
          } else {
            key = `${balance.location_id || balance.bin_location_id}-${
              balance.serial_number || "no_serial"
            }`;
          }
        } else if (isBatchManaged) {
          key = `${balance.location_id}-${balance.batch_id || "no_batch"}`;
        } else {
          key = `${balance.location_id}`;
        }

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

    const getDefaultBin = (itemData, plantId) => {
      if (!itemData.table_default_bin?.length) return null;
      const defaultBinEntry = itemData.table_default_bin.find(
        (bin) => bin.plant_id === plantId
      );
      return defaultBinEntry?.bin_location || null;
    };

    const defaultBin = getDefaultBin(itemData, plantId);
    const allocatedFromOtherRows = getCurrentAllocations(materialId, rowIndex);

    let allAllocations = [];

    // Get balance data from cache
    if (itemData.serial_number_management === 1) {
      const serialBalances = balanceDataMaps.serial.get(materialId) || [];
      const batchDataArray =
        itemData.item_batch_management === 1
          ? batchDataMap.get(materialId) || []
          : null;

      const adjustedBalances = applyAllocationsToBalances(
        serialBalances,
        allocatedFromOtherRows,
        true,
        itemData.item_batch_management === 1
      );

      allAllocations = await processAutoAllocationForSerializedItems(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        itemData.item_batch_management === 1,
        batchDataArray,
        binLocationMap
      );
    } else if (itemData.item_batch_management === 1) {
      const batchBalances = balanceDataMaps.batch.get(materialId) || [];
      const batchDataArray = batchDataMap.get(materialId) || [];

      const adjustedBalances = applyAllocationsToBalances(
        batchBalances,
        allocatedFromOtherRows,
        false,
        true
      );

      allAllocations = await processAutoAllocation(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        true,
        batchDataArray,
        binLocationMap
      );
    } else {
      const regularBalances = balanceDataMaps.regular.get(materialId) || [];

      const adjustedBalances = applyAllocationsToBalances(
        regularBalances,
        allocatedFromOtherRows,
        false,
        false
      );

      allAllocations = await processAutoAllocation(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        false,
        null,
        binLocationMap
      );
    }

    // Update global allocations
    if (!window.globalAllocationTracker.has(materialId)) {
      window.globalAllocationTracker.set(materialId, new Map());
    }

    const materialAllocations = window.globalAllocationTracker.get(materialId);
    const rowAllocations = new Map();

    allAllocations.forEach((allocation) => {
      let key;
      if (isSerializedItem) {
        if (itemData.item_batch_management === 1) {
          key = `${
            allocation.balance.location_id || allocation.balance.bin_location_id
          }-${allocation.serialNumber}-${
            allocation.batchData?.id || "no_batch"
          }`;
        } else {
          key = `${
            allocation.balance.location_id || allocation.balance.bin_location_id
          }-${allocation.serialNumber}`;
        }
      } else if (allocation.batchData) {
        key = `${allocation.balance.location_id}-${allocation.batchData.id}`;
      } else {
        key = `${allocation.balance.location_id}`;
      }
      rowAllocations.set(key, allocation.quantity);
    });

    materialAllocations.set(rowIndex, rowAllocations);

    // Create temp_qty_data and summary
    const tempQtyData = allAllocations.map((allocation) => {
      let gdQty = allocation.quantity;
      if (uomId !== itemData.based_uom) {
        const uomConv = itemData.table_uom_conversion?.find(
          (c) => c.alt_uom_id === uomId
        );
        gdQty = uomConv?.base_qty
          ? allocation.quantity / uomConv.base_qty
          : allocation.quantity;
      }

      const baseData = {
        material_id: materialId,
        location_id:
          allocation.balance.location_id || allocation.balance.bin_location_id,
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
        gd_quantity: gdQty,
      };

      if (isSerializedItem && allocation.serialNumber) {
        baseData.serial_number = allocation.serialNumber;
      }

      if (allocation.batchData) {
        baseData.batch_id = allocation.batchData.id;
      }

      return baseData;
    });

    // Get UOM name
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
      let displayQty = allocation.quantity;
      if (uomId !== itemData.based_uom) {
        const uomConv = itemData.table_uom_conversion?.find(
          (c) => c.alt_uom_id === uomId
        );
        displayQty = uomConv?.base_qty
          ? allocation.quantity / uomConv.base_qty
          : allocation.quantity;
      }

      let summaryLine = `${index + 1}. ${
        allocation.binLocation
      }: ${displayQty} ${uomName}`;

      if (isSerializedItem && allocation.serialNumber) {
        summaryLine += `\n[Serial: ${allocation.serialNumber}]`;
      }

      if (allocation.batchData) {
        summaryLine += `\n[Batch: ${allocation.batchData.batch_number}]`;
      }

      return summaryLine;
    });

    const totalAllocatedBase = allAllocations.reduce(
      (sum, alloc) => sum + alloc.quantity,
      0
    );

    let totalAllocated = totalAllocatedBase;
    if (uomId !== itemData.based_uom) {
      const uomConv = itemData.table_uom_conversion?.find(
        (c) => c.alt_uom_id === uomId
      );
      totalAllocated = uomConv?.base_qty
        ? totalAllocatedBase / uomConv.base_qty
        : totalAllocatedBase;
    }

    const summary = `Total: ${totalAllocated} ${uomName}\n\nDETAILS:\n${summaryDetails.join(
      "\n"
    )}`;

    const deliveredQty = this.getValue(
      `table_gd.${rowIndex}.gd_initial_delivered_qty`
    );
    const undeliveredQty = this.getValue(
      `table_gd.${rowIndex}.gd_undelivered_qty`
    );

    // Update the row data
    this.setData({
      [`table_gd.${rowIndex}.view_stock`]: summary,
      [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(tempQtyData),
      [`table_gd.${rowIndex}.gd_delivered_qty`]: deliveredQty + totalAllocated,
      [`table_gd.${rowIndex}.gd_undelivered_qty`]:
        undeliveredQty - totalAllocated,
    });

    console.log(
      `Auto-allocation completed for row ${rowIndex}: ${allAllocations.length} allocations`
    );
  } catch (error) {
    console.error(`Error in auto-allocation for row ${rowIndex}:`, error);
  }
};

// ============================================================================
// OPTIMIZED ALLOCATION STRATEGY FUNCTIONS - Use cached bin location data
// ============================================================================

const processAutoAllocationForSerializedItems = async (
  balances,
  defaultBin,
  quantity,
  defaultStrategy,
  fallbackStrategy,
  isBatchManaged,
  batchDataArray = null,
  binLocationMap = new Map()
) => {
  let allAllocations = [];
  let remainingQty = Math.floor(quantity);

  // OPTIMIZATION: Use cached bin location map instead of querying individually
  const getBinLocationDetails = (locationId) => {
    return binLocationMap.get(locationId) || null;
  };

  const findBatchData = (batchId) => {
    if (!isBatchManaged || !batchDataArray) return null;
    return batchDataArray.find((batch) => batch.id === batchId) || null;
  };

  const availableBalances = balances.filter(
    (balance) =>
      (balance.unrestricted_qty || 0) > 0 &&
      balance.serial_number &&
      balance.serial_number.trim() !== ""
  );

  if (defaultStrategy === "FIXED BIN") {
    if (defaultBin) {
      const defaultBinBalances = availableBalances.filter(
        (balance) =>
          (balance.location_id || balance.bin_location_id) === defaultBin
      );

      if (isBatchManaged && batchDataArray) {
        defaultBinBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (a.serial_number || "").localeCompare(b.serial_number || "");
        });
      } else {
        defaultBinBalances.sort((a, b) =>
          (a.serial_number || "").localeCompare(b.serial_number || "")
        );
      }

      for (const balance of defaultBinBalances) {
        if (remainingQty <= 0) break;

        const allocatedQty = Math.min(1, remainingQty);

        if (allocatedQty > 0) {
          const binDetails = getBinLocationDetails(
            balance.location_id || balance.bin_location_id
          );
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
              serialNumber: balance.serial_number,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }

    if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
      const otherBalances = availableBalances.filter(
        (balance) =>
          (balance.location_id || balance.bin_location_id) !== defaultBin
      );

      if (isBatchManaged && batchDataArray) {
        otherBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (a.serial_number || "").localeCompare(b.serial_number || "");
        });
      } else {
        otherBalances.sort((a, b) =>
          (a.serial_number || "").localeCompare(b.serial_number || "")
        );
      }

      for (const balance of otherBalances) {
        if (remainingQty <= 0) break;

        const allocatedQty = Math.min(1, remainingQty);

        if (allocatedQty > 0) {
          const binDetails = getBinLocationDetails(
            balance.location_id || balance.bin_location_id
          );
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
              serialNumber: balance.serial_number,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }
  } else if (defaultStrategy === "RANDOM") {
    if (isBatchManaged && batchDataArray) {
      availableBalances.sort((a, b) => {
        const batchA = findBatchData(a.batch_id);
        const batchB = findBatchData(b.batch_id);

        if (batchA?.expiry_date && batchB?.expiry_date) {
          return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
        }
        return (a.serial_number || "").localeCompare(b.serial_number || "");
      });
    } else {
      availableBalances.sort((a, b) =>
        (a.serial_number || "").localeCompare(b.serial_number || "")
      );
    }

    for (const balance of availableBalances) {
      if (remainingQty <= 0) break;

      const allocatedQty = Math.min(1, remainingQty);

      if (allocatedQty > 0) {
        const binDetails = getBinLocationDetails(
          balance.location_id || balance.bin_location_id
        );
        if (binDetails) {
          const batchData = isBatchManaged
            ? findBatchData(balance.batch_id)
            : null;

          allAllocations.push({
            balance: balance,
            quantity: allocatedQty,
            binLocation: binDetails.bin_location_combine,
            batchData: batchData,
            serialNumber: balance.serial_number,
          });
          remainingQty -= allocatedQty;
        }
      }
    }
  }

  console.log(
    `Serialized item allocation completed: ${
      allAllocations.length
    } serial numbers allocated out of ${Math.floor(quantity)} requested`
  );
  return allAllocations;
};

const processAutoAllocation = async (
  balances,
  defaultBin,
  quantity,
  defaultStrategy,
  fallbackStrategy,
  isBatchManaged,
  batchDataArray = null,
  binLocationMap = new Map()
) => {
  let allAllocations = [];
  let remainingQty = quantity;

  // OPTIMIZATION: Use cached bin location map
  const getBinLocationDetails = (locationId) => {
    return binLocationMap.get(locationId) || null;
  };

  const findBatchData = (batchId) => {
    if (!isBatchManaged || !batchDataArray) return null;
    return batchDataArray.find((batch) => batch.id === batchId) || null;
  };

  if (defaultStrategy === "FIXED BIN") {
    if (defaultBin) {
      const defaultBinBalances = balances.filter(
        (balance) =>
          balance.location_id === defaultBin &&
          (balance.unrestricted_qty || 0) > 0
      );

      if (isBatchManaged) {
        defaultBinBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (batchA?.batch_number || "").localeCompare(
            batchB?.batch_number || ""
          );
        });
      }

      for (const balance of defaultBinBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = getBinLocationDetails(balance.location_id);
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

    if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
      const availableBalances = balances.filter(
        (balance) =>
          balance.location_id !== defaultBin &&
          (balance.unrestricted_qty || 0) > 0
      );

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
        availableBalances.sort(
          (a, b) => balances.indexOf(a) - balances.indexOf(b)
        );
      }

      for (const balance of availableBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = getBinLocationDetails(balance.location_id);
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
    const availableBalances = balances.filter(
      (balance) => (balance.unrestricted_qty || 0) > 0
    );

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
      availableBalances.sort(
        (a, b) => balances.indexOf(a) - balances.indexOf(b)
      );
    }

    for (const balance of availableBalances) {
      if (remainingQty <= 0) break;

      const availableQty = balance.unrestricted_qty || 0;
      const allocatedQty = Math.min(remainingQty, availableQty);

      if (allocatedQty > 0) {
        const binDetails = getBinLocationDetails(balance.location_id);
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

// Initialize global tracker
if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

// ============================================================================
// TABLE CREATION HELPER (Keep existing)
// ============================================================================

const createTableGdWithBaseUOM = async (allItems) => {
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
        itemData
      );
      const deliveredQtyBase = convertToBaseUOM(
        item.deliveredQtyFromSource,
        item.altUOM,
        itemData
      );

      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: orderedQtyBase,
        gd_delivered_qty: deliveredQtyBase,
        gd_undelivered_qty: orderedQtyBase - deliveredQtyBase,
        gd_order_uom_id: itemData.based_uom,
        good_delivery_uom_id: itemData.based_uom,
        unit_price: item.unitPrice || 0,
        total_price: item.soAmount || 0,
        more_desc: item.moreDesc || "",
        line_remark_1: item.lineRemark1 || "",
        line_remark_2: item.lineRemark2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
        base_uom_id: itemData.based_uom,
      });
    } else {
      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: item.orderedQty,
        gd_delivered_qty: item.deliveredQtyFromSource,
        gd_undelivered_qty: item.orderedQty - item.deliveredQtyFromSource,
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        unit_price: item.unitPrice || 0,
        total_price: item.soAmount || 0,
        more_desc: item.moreDesc || "",
        line_remark_1: item.lineRemark1 || "",
        line_remark_2: item.lineRemark2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
      });
    }
  }

  return processedItems;
};

(async () => {
  this.showLoading("Loading...");
  let allItems = arguments[0].allItems;
  let existingGD = this.getValue("table_gd");
  const plant = this.getValue("plant_id");

  this.disabled(
    [
      "gd_ref_doc",
      "table_gd",
      "gd_delivery_method",
      "document_description",
      "order_remark",
    ],
    false
  );

  const pickingSetupResponse = await db
    .collection("picking_setup")
    .where({
      plant_id: plant,
      picking_after: "Goods Delivery",
      picking_required: 1,
    })
    .get();

  if (pickingSetupResponse.data.length > 0) {
    this.display("assigned_to");
  }

  if (!window.globalAllocationTracker) {
    window.globalAllocationTracker = new Map();
  } else if (!existingGD || existingGD.length === 0) {
    // Clear tracker only when no existing GD data (fresh start)
    window.globalAllocationTracker.clear();
  }

  console.log("allItems", allItems);

  allItems = allItems.filter(
    (gd) => gd.deliveredQtyFromSource !== gd.orderedQty
  );

  console.log("allItems after filter", allItems);

  let newTableGd = await createTableGdWithBaseUOM(allItems);

  // Update table_gd with empty insufficient dialog (will be populated by checkInventoryWithDuplicates)
  this.setData({
    table_gd: newTableGd,
    dialog_insufficient: {
      table_insufficient: [], // Will be populated by checkInventoryWithDuplicates
    },
  }).then(() => {
    this.hideLoading();
  });

  setTimeout(async () => {
    try {
      const plantId = this.getValue("plant_id");

      // Use the enhanced inventory checking function with serialized item support
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

      console.log(
        "Finished populating table_gd items with serialized item support"
      );
    } catch (error) {
      console.error("Error in inventory check:", error);
    }
  }, 200);
})();
