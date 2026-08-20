// ============================================================================
// OPTIMIZED VERSION - Performance improvements for 50+ items
// Key optimizations:
// 1. Batch queries - ALL data fetched upfront in 4-5 queries instead of 500+
// 2. Single setData call - Build entire table data, then update once
// 3. Cached data reuse - Allocation phase uses pre-fetched data
// 4. Batch bin location query - Single query for all locations
// ============================================================================

// FIX: Helper function to round quantities to 3 decimal places to avoid floating-point precision issues
const roundQty = (value) => Math.round((parseFloat(value) || 0) * 1000) / 1000;

// ===========================================================================
// ITEM BUNDLES
// ---------------------------------------------------------------------------
// An item bundle is ONE line on the sales order with the bundle's items beneath
// it, and it is delivered as a whole. table_gd keeps that shape: the bundle is
// a row with its items under `children`.
//
// The bundle row is not an item -- it has no material, holds no stock and
// nothing is delivered against it directly. Its items are the rows stock is
// allocated for, so every walk below distinguishes the two.
//
// Note table_so's field names are inverted: item_name holds the item's id.
// ===========================================================================

// A picked entry that is a bundle rather than an item.
const isBundleParentItem = (item) =>
  !item.itemId &&
  (Boolean(item.item_bundle_id) ||
    (Array.isArray(item.bundleChildren) && item.bundleChildren.length > 0));

// A bundle's items reach us in one of three shapes, and all mean the same
// thing: nested under `children`, flat rows pointing back through parent_id /
// parent_fm_key, or -- on rows that lost their link -- a bundle row followed by
// its item rows. Returns childrenOf (a parent's index -> its items' indexes)
// and claimed (every index now owned by a parent, which the caller skips so a
// bundle's items are not delivered twice).
const groupBundleRows = (rows, getItemId) => {
  const childrenOf = new Map();
  const claimed = new Set();

  const link = (parentIndex, childIndex) => {
    if (!childrenOf.has(parentIndex)) childrenOf.set(parentIndex, []);

    childrenOf.get(parentIndex).push(childIndex);
    claimed.add(childIndex);
  };

  // PASS 1 -- parent_id, which is the link the database actually stores. A
  // subform tree is persisted FLAT, each child carrying the row id of its
  // parent; `children` exists only on a tree still being edited in a form, so a
  // sales order read back through a query never has it. This pass is what puts
  // the bundle back together, and it needs nothing else on the row -- not an
  // item bundle id on the child, not a particular ordering.
  const indexById = new Map();

  rows.forEach((row, index) => {
    if (row && row.id != null && row.id !== "") {
      indexById.set(String(row.id), index);
    }
  });

  rows.forEach((row, index) => {
    if (!row || row.parent_id == null || row.parent_id === "") return;

    const parentIndex = indexById.get(String(row.parent_id));

    if (parentIndex === undefined || parentIndex === index) return;

    link(parentIndex, index);
  });

  // PASS 2 -- the shapes a row can arrive in when it has no parent_id yet:
  // nested under `children` (a tree still in the form), linked by
  // parent_fm_key (added in this session, not saved yet), or -- on rows that
  // lost their link -- following the bundle row they belong to.
  const isBundleRow = (row) => !!row.item_bundle_id && !getItemId(row);
  const isBundleItem = (row) => !!row.item_bundle_id && !!getItemId(row);

  let openParent = null;

  rows.forEach((row, index) => {
    if (!row) return;

    if (isBundleRow(row)) {
      // Already a tree, or already reattached by parent_id: nothing to do.
      if (
        (Array.isArray(row.children) && row.children.length > 0) ||
        childrenOf.has(index)
      ) {
        openParent = null;
        return;
      }

      childrenOf.set(index, []);
      openParent = index;
      return;
    }

    if (claimed.has(index)) return; // parent_id already owns it

    if (!isBundleItem(row)) {
      openParent = null; // a plain line closes the bundle above it
      return;
    }

    let parentIndex = null;

    rows.forEach((candidate, candidateIndex) => {
      if (parentIndex !== null || !childrenOf.has(candidateIndex)) return;

      const byKey =
        row.parent_fm_key != null &&
        candidate.fm_key != null &&
        String(row.parent_fm_key) === String(candidate.fm_key);

      if (byKey) parentIndex = candidateIndex;
    });

    // No link on the row: it belongs to the bundle it follows, as long as that
    // is the same bundle.
    if (
      parentIndex === null &&
      openParent !== null &&
      String(rows[openParent].item_bundle_id) === String(row.item_bundle_id)
    ) {
      parentIndex = openParent;
    }

    if (parentIndex === null) return; // orphan: delivered as a line of its own

    link(parentIndex, index);
  });

  // A row opened as a bundle in pass 2 but never given anything is not a bundle
  // after all -- it drops back to being a line of its own.
  for (const [parentIndex, children] of [...childrenOf]) {
    if (children.length === 0) childrenOf.delete(parentIndex);
  }

  console.log("item bundle grouping", {
    rows: rows.length,
    bundles: childrenOf.size,
    claimed: claimed.size,
  });

  return { childrenOf, claimed };
};

// The picked entries in the order they will sit in table_gd: a bundle followed
// by its items. Allocation walks the rows by one index, so this is what lines
// the entries up with the rows they become.
const flattenAllItems = (items) =>
  (items || []).flatMap((item) => [
    item,
    ...(Array.isArray(item.bundleChildren) ? item.bundleChildren : []),
  ]);

// The same walk over rows that already exist on the document.
const flattenTreeRows = (rows) =>
  (rows || []).flatMap((row) => [
    row,
    ...(Array.isArray(row.children) ? row.children : []),
  ]);

// Allocation addresses a row by a single index, but a bundle's items are rows
// of the tree rather than of table_gd. It therefore works on this flat view and
// the result is folded back into the tree when it is done.
const flattenForAllocation = (rows) => {
  const flat = [];
  const refs = [];

  (rows || []).forEach((row, parent) => {
    flat.push(row);
    refs.push({ parent, child: null });

    const children = Array.isArray(row.children) ? row.children : [];

    children.forEach((child, childIndex) => {
      flat.push(child);
      refs.push({ parent, child: childIndex });
    });
  });

  return { flat, refs };
};

const rebuildTree = (rows, flat, refs) => {
  const out = (rows || []).map((row) => ({ ...row }));

  refs.forEach((ref, index) => {
    // The parent's own `children` is stale by now -- the items are written
    // through their own refs, which come after this one.
    const { children: staleChildren, ...rest } = flat[index] || {};

    if (ref.child === null) {
      out[ref.parent] = { ...out[ref.parent], ...rest };
      return;
    }

    const parent = out[ref.parent] || {};
    const children = Array.isArray(parent.children) ? [...parent.children] : [];
    children[ref.child] = { ...children[ref.child], ...flat[index] };
    out[ref.parent] = { ...parent, children };
  });

  return out;
};

// ============================================================================
// BATCH QUERY HELPER FUNCTIONS
// ============================================================================

const batchFetchItems = async (materialIds) => {
  if (!materialIds || materialIds.length === 0) return new Map();
  const uniqueIds = [
    ...new Set(materialIds.filter((id) => id && id !== "undefined" && id !== "null")),
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
    ...new Set(materialIds.filter((id) => id && id !== "undefined" && id !== "null")),
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
      .where({ plant_id: plantId, picking_after: "Goods Delivery" })
      .get();

    if (!response?.data?.length) {
      return {
        pickingMode: "Manual",
        defaultStrategy: "RANDOM",
        fallbackStrategy: "RANDOM",
        splitPolicy: "ALLOW_SPLIT",
      };
    }

    const setup = response.data[0];
    return {
      pickingMode: setup.picking_mode || "Manual",
      defaultStrategy: setup.default_strategy_id || "RANDOM",
      fallbackStrategy: setup.fallback_strategy_id || "RANDOM",
      splitPolicy: setup.split_policy || "ALLOW_SPLIT",
    };
  } catch (error) {
    console.error("Error fetching picking setup:", error);
    return {
      pickingMode: "Manual",
      defaultStrategy: "RANDOM",
      fallbackStrategy: "RANDOM",
      splitPolicy: "ALLOW_SPLIT",
    };
  }
};

const batchFetchBinLocations = async (locationIds) => {
  if (!locationIds || locationIds.length === 0) return new Map();
  const uniqueIds = [...new Set(locationIds.filter((id) => id && id !== "undefined" && id !== "null"))];
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
    ...new Set(materialIds.filter((id) => id && id !== "undefined" && id !== "null")),
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
    ...new Set(soLineItemIds.filter((id) => id && id !== "undefined" && id !== "null")),
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

// How many base UOM units make up 1 unit of the given UOM (1 for base UOM).
const getBaseQty = (itemData, uom) => {
  if (!itemData || !uom || uom === itemData.based_uom) {
    return 1;
  }

  const uomConversion = itemData.table_uom_conversion?.find(
    (conv) => conv.alt_uom_id === uom,
  );

  return uomConversion && uomConversion.base_qty ? uomConversion.base_qty : 1;
};

// Find the packing detail row for a UOM. An item may define several packing rows
// per uom_id, so when a packing UOM is supplied match on the (uom_id,
// packing_uom_id) pair, which is unique. Otherwise fall back to the first row.
const getPackingDetail = (table_packing_detail, uom, packingUom) => {
  if (!Array.isArray(table_packing_detail) || !uom) {
    return null;
  }

  const rows = table_packing_detail.filter((conv) => conv.uom_id === uom);
  if (rows.length === 0) {
    return null;
  }

  if (packingUom) {
    return rows.find((conv) => conv.packing_uom_id === packingUom) || null;
  }

  return rows[0];
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
    // A bundle row holds no material, so there is nothing to check stock for --
    // its items are entries of their own in this list and are allocated
    // normally. It still occupies its index, so the rows below stay lined up.
    if (isBundleParentItem(item)) {
      return;
    }

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
  // A row with no material of its own -- an item bundle line, or a
  // description-only line -- groups under a blank key. batchFetchItems and its
  // siblings drop those, but fetchHUData below queries the ids as they stand,
  // and the server rejects a blank one with "数据转换BigInt类型失败，原值为:
  // [null]". Dropped once, here, so every fetch sees the same list.
  const materialIds = Object.keys(materialGroups).filter(
    (id) => id && id !== "undefined" && id !== "null",
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

  // Fetch HU sub-items to check which materials have handling units
  const fetchHUData = async () => {
    const huResults = await Promise.all(
      materialIds.map((id) =>
        db
          .collection("handling_unit_atu7sreg_sub")
          .where({ material_id: id, is_deleted: 0 })
          .get(),
      ),
    );

    const huMaterialSet = new Set();
    huResults.forEach((res, idx) => {
      if (res.data && res.data.length > 0) {
        huMaterialSet.add(materialIds[idx]);
      }
    });
    return huMaterialSet;
  };

  const [
    itemDataMap,
    balanceDataMaps,
    pickingSetup,
    batchDataMap,
    pendingReservedMap,
    huMaterialSet,
  ] = await Promise.all([
    batchFetchItems(materialIds),
    batchFetchBalanceData(materialIds, plantId),
    fetchPickingSetup(plantId),
    batchFetchBatchData(materialIds, plantId),
    batchFetchPendingReserved(allSoLineItemIds, plantId),
    fetchHUData(),
  ]);

  console.log(
    `✅ All data fetched in ${
      Date.now() - fetchStart
    }ms (was 500+ queries, now 5-6 queries)`,
  );

  // Extract for easier access
  const { pickingMode } = pickingSetup;

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
  const tableGdArray = this.getValue("table_gd") || [];
  const { flat: flatRows, refs: rowRefs } = flattenForAllocation(tableGdArray);

  // How to address a flat row. A subform row is identified by its fm_key, not
  // by where it sits: the platform resolves `table_gd.<fm_key>.<field>` to that
  // row, which is also the only way to reach an item under a bundle without
  // threading through its parent's position. Position is kept as a fallback for
  // a row that has not been given a key yet.
  const pathOf = (index) => {
    const row = flatRows[index];
    if (row && row.fm_key) return `table_gd.${row.fm_key}`;

    const ref = rowRefs[index];
    if (!ref) return `table_gd.${index}`;
    return ref.child === null
      ? `table_gd.${ref.parent}`
      : `table_gd.${ref.parent}.children.${ref.child}`;
  };

  const fieldsToDisable = [];
  const fieldsToEnable = [];

  for (const [materialId, items] of Object.entries(materialGroups)) {
    console.log("Processing materialID:", materialId);

    // Handle undefined material IDs
    if (materialId === "undefined") {
      console.log(`Skipping item with null materialId`);
      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = parseFloat(item.orderedQty) || 0;
        const deliveredQty = parseFloat(item.deliveredQtyFromSource) || 0;
        const plannedQty = parseFloat(item.plannedQtyFromSource) || 0;
        const undeliveredQty = roundQty(orderedQty - deliveredQty);
        const suggestedQty = roundQty(Math.max(0, undeliveredQty - plannedQty));

        flatRows[index] = {
          ...flatRows[index],
          material_id: "",
          material_name: item.itemName || "",
          gd_material_desc: item.sourceItem.so_desc || "",
          gd_order_quantity: orderedQty,
          gd_delivered_qty: deliveredQty,
          gd_initial_delivered_qty: deliveredQty,
          gd_order_uom_id: item.altUOM,
          good_delivery_uom_id: item.altUOM,
          more_desc: item.sourceItem.more_desc || "",
          line_remark_1: item.sourceItem.line_remark_1 || "",
          line_remark_2: item.sourceItem.line_remark_2 || "",
          line_remark_3: item.sourceItem.line_remark_3 || "",
          custom_fields: item.sourceItem.custom_fields,
          tariff_id: item.sourceItem.tariff_id,
          base_uom_id: "",
          unit_price: item.sourceItem.so_item_price || 0,
          total_price: item.sourceItem.so_amount || 0,
          item_costing_method: "",
          gd_qty: suggestedQty,
          base_qty: suggestedQty, // no item data → no UOM conversion possible
        };

        fieldsToDisable.push(`${pathOf(index)}.gd_delivery_qty`);
        fieldsToEnable.push(`${pathOf(index)}.gd_qty`);
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
        const orderedQty = parseFloat(item.orderedQty) || 0;
        const deliveredQty = parseFloat(item.deliveredQtyFromSource) || 0;
        const plannedQty = parseFloat(item.plannedQtyFromSource) || 0;
        const undeliveredQty = roundQty(orderedQty - deliveredQty);
        const suggestedQty = roundQty(Math.max(0, undeliveredQty - plannedQty));

        flatRows[index] = {
          ...flatRows[index],
          material_id: materialId,
          material_name: item.itemName,
          gd_material_desc: item.sourceItem.so_desc || "",
          gd_order_quantity: orderedQty,
          gd_delivered_qty: roundQty(deliveredQty + undeliveredQty),
          gd_initial_delivered_qty: deliveredQty,
          gd_order_uom_id: item.altUOM,
          good_delivery_uom_id: item.altUOM,
          more_desc: item.sourceItem.more_desc || "",
          line_remark_1: item.sourceItem.line_remark_1 || "",
          line_remark_2: item.sourceItem.line_remark_2 || "",
          line_remark_3: item.sourceItem.line_remark_3 || "",
          custom_fields: item.sourceItem.custom_fields,
          tariff_id: item.sourceItem.tariff_id,
          base_uom_id: itemData.based_uom || "",
          unit_price: item.sourceItem.so_item_price || 0,
          total_price: item.sourceItem.so_amount || 0,
          item_costing_method: itemData.material_costing_method,
          gd_qty: suggestedQty,
          base_qty: roundQty(
            convertToBaseUOM(suggestedQty, item.altUOM, itemData),
          ),
          gd_undelivered_qty: 0,
        };

        if (suggestedQty <= 0) {
          fieldsToDisable.push(
            `${pathOf(index)}.gd_qty`,
            `${pathOf(index)}.gd_delivery_qty`,
          );
        } else {
          fieldsToDisable.push(`${pathOf(index)}.gd_delivery_qty`);
          fieldsToEnable.push(`${pathOf(index)}.gd_qty`);
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

    // Filter out zero-stock balance rows so UI branching (single vs multi
    // balance) and allocation only consider rows with usable stock.
    balanceData = balanceData.filter(
      (b) =>
        (parseFloat(b.unrestricted_qty) || 0) > 0 &&
        (parseFloat(b.balance_quantity) || 0) > 0,
    );

    // Calculate total available stock (unrestricted + pending reserved for these SO lines)
    const totalUnrestrictedQtyBase = balanceData.reduce(
      (sum, balance) => sum + (balance.unrestricted_qty || 0),
      0,
    );

    // 🔧 FIXED: Calculate total pending reserved qty WITH UOM conversion to base
    // Reserved stock for a specific SO is AVAILABLE for that SO
    let totalPendingReservedQtyBase = 0;
    items.forEach((item) => {
      if (item.so_line_item_id) {
        const reservedData = pendingReservedMap.get(item.so_line_item_id) || [];
        reservedData.forEach((reserved) => {
          const altQty = parseFloat(reserved.open_qty || 0);
          const altUOM = reserved.item_uom;
          // Convert to base UOM before summing
          const baseQty = convertToBaseUOM(altQty, altUOM, itemData);
          totalPendingReservedQtyBase += baseQty;
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
      totalUnrestrictedQtyBase +
        totalPendingReservedQtyBase -
        totalPreviousAllocations,
    );

    console.log(
      `Material ${materialId}: Unrestricted=${totalUnrestrictedQtyBase}, PendingReserved=${totalPendingReservedQtyBase}, Available=${availableStockAfterAllocations}, Collection=${collectionUsed}`,
    );

    // Handle UI controls based on balance data length
    // Skip auto-enabling gd_qty if HUs exist for this material (user must use inventory dialog)
    const materialHasHU = huMaterialSet.has(materialId);
    if (balanceData.length === 1 && !materialHasHU) {
      items.forEach((item) => {
        fieldsToDisable.push(`${pathOf(item.originalIndex)}.gd_delivery_qty`);
        fieldsToEnable.push(`${pathOf(item.originalIndex)}.gd_qty`);
      });
    }

    // Calculate total demand (only unplanned portion needs stock)
    let totalDemandBase = 0;
    items.forEach((item) => {
      const undeliveredQty = roundQty(
        (parseFloat(item.orderedQty) || 0) -
          (parseFloat(item.deliveredQtyFromSource) || 0),
      );
      const plannedQty = parseFloat(item.plannedQtyFromSource) || 0;
      const remainingDemandQty = roundQty(
        Math.max(0, undeliveredQty - plannedQty),
      );
      let remainingDemandQtyBase = remainingDemandQty;
      if (item.altUOM !== itemData.based_uom) {
        const uomConversion = itemData.table_uom_conversion?.find(
          (conv) => conv.alt_uom_id === item.altUOM,
        );
        if (uomConversion && uomConversion.base_qty) {
          remainingDemandQtyBase = remainingDemandQty * uomConversion.base_qty;
        }
      }
      totalDemandBase += remainingDemandQtyBase;

      // Set basic item data
      const index = item.originalIndex;
      flatRows[index] = {
        ...flatRows[index],
        material_id: materialId,
        material_name: item.itemName,
        gd_material_desc: item.sourceItem.so_desc || "",
        gd_order_quantity: item.orderedQty,
        gd_delivered_qty: item.deliveredQtyFromSource,
        gd_initial_delivered_qty: item.deliveredQtyFromSource,
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_remark_3: item.sourceItem.line_remark_3 || "",
        custom_fields: item.sourceItem.custom_fields,
        tariff_id: item.sourceItem.tariff_id,
        base_uom_id: itemData.based_uom || "",
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        item_costing_method: itemData.material_costing_method,
      };
    });

    console.log(
      `Material ${materialId}: Available=${availableStockAfterAllocations}, Total Remaining Demand (after planned)=${totalDemandBase}`,
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
          const orderedQty = parseFloat(item.orderedQty) || 0;
          const deliveredQty = parseFloat(item.deliveredQtyFromSource) || 0;
          const plannedQty = parseFloat(item.plannedQtyFromSource) || 0;
          const undeliveredQty = roundQty(orderedQty - deliveredQty);
          const remainingDemandQty = roundQty(
            Math.max(0, undeliveredQty - plannedQty),
          );

          const orderedQtyBase = roundQty(
            convertToBaseUOM(orderedQty, item.altUOM, itemData),
          );
          const deliveredQtyBase = roundQty(
            convertToBaseUOM(deliveredQty, item.altUOM, itemData),
          );
          const undeliveredQtyBase = roundQty(
            convertToBaseUOM(undeliveredQty, item.altUOM, itemData),
          );
          const remainingDemandQtyBase = roundQty(
            convertToBaseUOM(remainingDemandQty, item.altUOM, itemData),
          );

          let availableQtyBase = 0;
          if (remainingSerialCount > 0 && remainingDemandQtyBase > 0) {
            const requiredUnitsBase = Math.floor(remainingDemandQtyBase);
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
            remaining_demand_qty: remainingDemandQtyBase,
            available_qty: availableQtyBase,
            shortfall_qty: roundQty(remainingDemandQtyBase - availableQtyBase),
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          });

          // Update table array with base UOM
          flatRows[index] = {
            ...flatRows[index],
            gd_order_quantity: orderedQtyBase,
            gd_delivered_qty: deliveredQtyBase,
            gd_initial_delivered_qty: deliveredQtyBase,
            gd_order_uom_id: itemData.based_uom,
            good_delivery_uom_id: itemData.based_uom,
          };

          // Insufficient stock - don't fill gd_qty
          flatRows[index].gd_qty = 0;
          flatRows[index].base_qty = 0;
        });
      } else {
        // Non-serialized items
        let remainingStockBase = Math.max(0, availableStockAfterAllocations);

        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = parseFloat(item.orderedQty) || 0;
          const deliveredQty = parseFloat(item.deliveredQtyFromSource) || 0;
          const plannedQty = parseFloat(item.plannedQtyFromSource) || 0;
          const undeliveredQty = roundQty(orderedQty - deliveredQty);
          const remainingDemandQty = roundQty(
            Math.max(0, undeliveredQty - plannedQty),
          );

          let availableQtyAlt = 0;
          if (remainingStockBase > 0 && remainingDemandQty > 0) {
            let remainingDemandQtyBase = remainingDemandQty;
            if (item.altUOM !== itemData.based_uom) {
              const uomConversion = itemData.table_uom_conversion?.find(
                (conv) => conv.alt_uom_id === item.altUOM,
              );
              if (uomConversion && uomConversion.base_qty) {
                remainingDemandQtyBase =
                  remainingDemandQty * uomConversion.base_qty;
              }
            }

            const allocatedBase = Math.min(
              remainingStockBase,
              remainingDemandQtyBase,
            );
            const uomConversion = itemData.table_uom_conversion?.find(
              (conv) => conv.alt_uom_id === item.altUOM,
            );
            availableQtyAlt = roundQty(
              item.altUOM !== itemData.based_uom
                ? allocatedBase / (uomConversion?.base_qty || 1)
                : allocatedBase,
            );

            remainingStockBase -= allocatedBase;
          }

          // Add to insufficient dialog data
          insufficientDialogData.push({
            material_id: materialId,
            material_name: item.itemName,
            material_uom: item.altUOM,
            order_quantity: orderedQty,
            undelivered_qty: undeliveredQty,
            remaining_demand_qty: remainingDemandQty,
            available_qty: availableQtyAlt,
            shortfall_qty: roundQty(remainingDemandQty - availableQtyAlt),
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          });

          // Insufficient stock - don't fill gd_qty
          flatRows[index].gd_qty = 0;
          flatRows[index].base_qty = 0;
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
        const orderedQty = parseFloat(item.orderedQty) || 0;
        const deliveredQty = parseFloat(item.deliveredQtyFromSource) || 0;
        const plannedQty = parseFloat(item.plannedQtyFromSource) || 0;

        const undeliveredQty = roundQty(orderedQty - deliveredQty);
        const suggestedQty = roundQty(Math.max(0, undeliveredQty - plannedQty));
        // Use suggested qty directly - allocation logic handles sourcing from
        // pending reserved + unrestricted stock during save workflow
        const finalQty = suggestedQty;

        if (finalQty <= 0) {
          fieldsToDisable.push(
            `${pathOf(index)}.gd_qty`,
            `${pathOf(index)}.gd_delivery_qty`,
          );
          flatRows[index].gd_qty = 0;
          flatRows[index].base_qty = 0;
        } else {
          if (itemData.serial_number_management === 1) {
            // Serialized - use base UOM
            const orderedQtyBase = roundQty(
              convertToBaseUOM(orderedQty, item.altUOM, itemData),
            );
            const deliveredQtyBase = roundQty(
              convertToBaseUOM(deliveredQty, item.altUOM, itemData),
            );
            const finalQtyBase = roundQty(
              convertToBaseUOM(finalQty, item.altUOM, itemData),
            );

            flatRows[index] = {
              ...flatRows[index],
              gd_order_quantity: orderedQtyBase,
              gd_delivered_qty: deliveredQtyBase,
              gd_initial_delivered_qty: deliveredQtyBase,
              gd_order_uom_id: itemData.based_uom,
              good_delivery_uom_id: itemData.based_uom,
            };

            // Sufficient stock - fill gd_qty only (allocation deferred to workflow)
            if (pickingMode === "Manual") {
              flatRows[index].gd_qty =
                balanceData.length === 1 ? finalQtyBase : 0;
            } else {
              flatRows[index].gd_qty = finalQtyBase;
            }
            // Serialized: gd_qty already in base UOM
            flatRows[index].base_qty = flatRows[index].gd_qty;
          } else {
            // Non-serialized - fill gd_qty only (allocation deferred to workflow)
            if (pickingMode === "Manual") {
              flatRows[index].gd_qty =
                balanceData.length === 1 ? finalQty : 0;
            } else {
              flatRows[index].gd_qty = finalQty;
            }
            flatRows[index].base_qty = roundQty(
              convertToBaseUOM(
                flatRows[index].gd_qty,
                item.altUOM,
                itemData,
              ),
            );
          }
        }
      });
    }
  }

  // ========================================================================
  // STEP 3.5: Seed packing + net weight for every processed row, based on its
  // final delivery qty/uom (good_delivery_uom_id + gd_qty). Mirrors the SO
  // packing/weight logic so values are consistent across modules.
  // ========================================================================
  for (const items of Object.values(materialGroups)) {
    for (const item of items) {
      const index = item.originalIndex;
      const row = flatRows[index];
      if (!row) continue;

      const rowItemData = itemDataMap.get(row.material_id);
      const uom = row.good_delivery_uom_id;
      const qty = parseFloat(row.gd_qty) || 0;

      // packing_uom is taken from the SO line (the user can choose it there, and
      // an item may define several packing rows for the same uom_id). Fall back
      // to first-match on the item when the source line carries none (older SOs
      // / other flows) or when its choice does not exist for this GD's UOM,
      // which happens when the GD delivers in a different UOM.
      const tpd = rowItemData?.table_packing_detail;
      const soPackingUom = item.sourceItem?.packing_uom ?? item.packing_uom;
      const packingDetail =
        getPackingDetail(tpd, uom, soPackingUom || undefined) ||
        getPackingDetail(tpd, uom);
      const packingConversion = packingDetail?.quantity || 1;

      // weight_conversion is the weight of ONE unit in the line's UOM, so the SO
      // line's value (which the user can manually edit there) only carries over
      // while the GD delivers in the SO's UOM - serialized items switch to base
      // UOM above. Otherwise derive it from the item, whose net_weight is the
      // weight of one base UOM unit.
      const baseQty = getBaseQty(rowItemData, uom);
      const soWeightConversion =
        item.sourceItem?.weight_conversion ?? item.weight_conversion;
      const weightConversion =
        String(item.altUOM || "") === String(uom || "") &&
        soWeightConversion !== undefined &&
        soWeightConversion !== null &&
        soWeightConversion !== ""
          ? Number(soWeightConversion)
          : roundQty((Number(rowItemData?.net_weight) || 0) * baseQty);

      flatRows[index] = {
        ...row,
        packing_uom: packingDetail?.packing_uom_id || "",
        packing_conversion: packingConversion,
        packing_qty: packingConversion ? roundQty(qty / packingConversion) : 0,
        weight_conversion: weightConversion,
        net_weight: roundQty(qty * weightConversion),
      };
    }
  }


  // An item bundle is delivered as a whole. The bundle row's quantity is the
  // number of bundles going out, and every item under it follows from that by
  // ratio (onChange_delivered_qty) -- so the bundle row is the one that takes a
  // quantity, and its items are driven rather than driving.
  //
  // A bundle row holds no material, so it never reaches the allocation above
  // and would come out of it with nothing to deliver at all. It is defaulted
  // here to what is still outstanding on the line -- the order quantity less
  // what has already gone out, which is what every ordinary line is defaulted
  // to a few lines up.
  //
  // That allocation also enabled gd_qty on every row it costed, and a bundle's
  // items are costed like any other line, so those are taken back here. Rows
  // are addressed by pathOf, which keys off fm_key.
  const bundleParents = new Set();

  rowRefs.forEach((ref, index) => {
    if (ref.child !== null) return;

    const row = flatRows[index] || {};

    if (row.item_bundle_id && !row.material_id) {
      bundleParents.add(ref.parent);
    }
  });

  if (bundleParents.size > 0) {
    const drivenPaths = new Set();
    const bundlePaths = [];

    rowRefs.forEach((ref, index) => {
      if (!bundleParents.has(ref.parent)) return;

      const path = `${pathOf(index)}.gd_qty`;

      if (ref.child !== null) {
        drivenPaths.add(path);
        return;
      }

      const row = flatRows[index] || {};
      // gd_delivered_qty is what the source has already delivered, so this is
      // the number of bundles still to go out.
      const outstanding = roundQty(
        (parseFloat(row.gd_order_quantity) || 0) -
          (parseFloat(row.gd_delivered_qty) || 0),
      );

      flatRows[index] = { ...row, gd_qty: outstanding };
      bundlePaths.push(path);
      // A bundle row holds no material and no stock, so the select-stock dialog
      // has nothing to show for it -- and every lookup it makes is keyed on the
      // material, so opening it on a bundle row sends an empty id to the server.
      fieldsToDisable.push(`${pathOf(index)}.gd_delivery_qty`);
    });

    // Enabling runs after disabling below, so a driven row left in the enable
    // list would simply undo its own lock.
    for (let i = fieldsToEnable.length - 1; i >= 0; i--) {
      if (drivenPaths.has(fieldsToEnable[i])) {
        fieldsToEnable.splice(i, 1);
      }
    }

    drivenPaths.forEach((path) => fieldsToDisable.push(path));
    bundlePaths.forEach((path) => fieldsToEnable.push(path));

    console.log(
      "item bundle rows",
      bundlePaths.length,
      "delivered by the bundle,",
      drivenPaths.size,
      "items driven by it",
    );
  }

  // ========================================================================
  // STEP 4: Single setData call with complete table array
  // ========================================================================
  console.log(
    "🚀 OPTIMIZATION: Applying all updates in single setData call...",
  );
  await this.setData({
    table_gd: rebuildTree(tableGdArray, flatRows, rowRefs),
    split_policy: pickingSetup.splitPolicy || "ALLOW_SPLIT",
  });

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

  console.log(`✅ All ${flatRows.length} rows updated in single operation`);

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
// Allocation logic has been moved to the workflow (runs during GD save)
// This improves performance and centralizes allocation logic
// ============================================================================

// Initialize global tracker
if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

// ============================================================================
// TABLE CREATION HELPER (Keep existing)
// ============================================================================

const createTableGdWithBaseUOM = async (allItems) => {

  // A bundle row has no item behind it, so the fields that would describe one --
  // item category, tariff, unit of measure -- come back empty from the sales
  // order. Those columns are id-typed, and the server rejects a null on one with
  // "数据转换BigInt类型失败，原值为: [null]", so they go across blank instead.
  // Only bundle rows are touched; an ordinary line keeps whatever it carried.
  const BUNDLE_ID_FIELDS = [
    "material_id",
    "gd_order_uom_id",
    "good_delivery_uom_id",
    "base_uom_id",
    "packing_uom",
    "tariff_id",
    "item_category_id",
    "line_pp_id",
    "pp_line_item_id",
    "line_to_id",
    "to_record_id",
    "packing_no",
    "hu_no",
    "project_id",
  ];

  const blankMissingIds = (row) => {
    for (const field of BUNDLE_ID_FIELDS) {
      if (row[field] === null || row[field] === undefined) {
        row[field] = "";
      }
    }

    return row;
  };
  // One row from one picked entry. A bundle row has no material -- itemId is
  // empty on it -- so no item is fetched for it and it takes the plain branch,
  // leaving its stock fields empty, which is what a bundle row should carry.
  const buildRow = async (item) => {
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

      return {
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: orderedQtyBase,
        gd_delivered_qty: deliveredQtyBase,
        gd_undelivered_qty:
          Math.round((orderedQtyBase - deliveredQtyBase) * 1000) / 1000,
        gd_order_uom_id: itemData.based_uom,
        good_delivery_uom_id: itemData.based_uom,
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_remark_3: item.sourceItem.line_remark_3 || "",
        custom_fields: item.sourceItem.custom_fields,
        tariff_id: item.sourceItem.tariff_id,
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        is_internal: !!(
          item.is_internal ||
          item.source_po_id ||
          item.source_po_line_item_id
        ),
        item_category_id: item.item_category_id,
        base_uom_id: itemData.based_uom,
        item_bundle_id: item.item_bundle_id || "",
      };
    } else {
      return {
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: item.orderedQty,
        gd_delivered_qty: item.deliveredQtyFromSource,
        gd_undelivered_qty:
          Math.round((item.orderedQty - item.sourceItem.delivered_qty) * 1000) /
          1000,
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_remark_3: item.sourceItem.line_remark_3 || "",
        custom_fields: item.sourceItem.custom_fields,
        tariff_id: item.sourceItem.tariff_id,
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        is_internal: !!(
          item.is_internal ||
          item.source_po_id ||
          item.source_po_line_item_id
        ),
        item_category_id: item.item_category_id,
        item_bundle_id: item.item_bundle_id || "",
      };
    }
  };

  const processedItems = [];

  for (const item of allItems) {
    const row = await buildRow(item);

    // A bundle keeps its items under it, so the delivery carries the same shape
    // the sales order does.
    const bundleChildren = Array.isArray(item.bundleChildren)
      ? item.bundleChildren
      : [];

    if (bundleChildren.length > 0) {
      blankMissingIds(row);
      row.children = [];

      for (const child of bundleChildren) {
        row.children.push(await buildRow(child));
      }
    }

    processedItems.push(row);
  }

  return processedItems;
};

// ============================================================================
// MAIN EXECUTION (Keep existing)
// ============================================================================

(async () => {
  const referenceType = arguments[0].referenceType;
  const previousReferenceType = this.getValue("reference_type");
  const currentItemArray = arguments[0].itemArray || [];
  let existingGD = this.getValue("table_gd");
  const customerName = this.getValue("customer_name");

  if (!window.globalAllocationTracker) {
    window.globalAllocationTracker = new Map();
  } else if (!existingGD || existingGD.length === 0) {
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

  const uniqueCustomer = new Set(
    currentItemArray.map((so) =>
      referenceType === "Document" ? so.customer_id : so.customer_id.id,
    ),
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
  this.showLoading();

  // One sales-order line as a picked entry. item_name holds the item's id on
  // table_so and item_id its name -- the fields are inverted there. A bundle
  // row has no item, so itemId comes out empty on it, which is what marks it.
  const soLineToItem = (soItem, so) => ({
    itemId: soItem.item_name,
    itemName: soItem.item_id,
    itemDesc: soItem.so_desc,
    orderedQty: parseFloat(soItem.so_quantity || 0),
    altUOM: soItem.so_item_uom || "",
    sourceItem: soItem,
    deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0),
    plannedQtyFromSource: parseFloat(soItem.planned_qty || 0),
    original_so_id: so.sales_order_id,
    so_no: so.sales_order_number,
    so_line_item_id: soItem.id,
    item_category_id: soItem.item_category_id,
    item_bundle_id: soItem.item_bundle_id || "",
    is_internal: !!so.source_po_id,
  });

  switch (referenceType) {
    case "Document":
      for (const so of currentItemArray) {
        const soLines = so.table_so || [];

        // A bundle's items are delivered under their bundle line rather than as
        // lines of their own, in whichever shape the order stored them.
        const { childrenOf, claimed } = groupBundleRows(
          soLines,
          (row) => row.item_name,
        );

        for (const [index, soItem] of soLines.entries()) {
          // Already carried by its bundle row; not a line of its own.
          if (claimed.has(index)) continue;

          const entry = soLineToItem(soItem, so);

          const nested = Array.isArray(soItem.children) ? soItem.children : [];
          const regrouped = (childrenOf.get(index) || []).map(
            (childIndex) => soLines[childIndex],
          );
          const bundleChildren = nested.length > 0 ? nested : regrouped;

          if (bundleChildren.length > 0) {
            entry.bundleChildren = bundleChildren.map((child) =>
              soLineToItem(child, so),
            );
          }

          allItems.push(entry);
        }
      }
      break;

    case "Item": {
      // A picked row is already mapped by rowClick_addSOItem, and a bundle
      // keeps its items under `children` there. A bundle row has no item, so
      // every read through `item` is guarded.
      const pickedToItem = (picked) => ({
        itemId: picked.item?.id || "",
        itemName: picked.item?.material_name || picked.item_bundle_code || "",
        itemDesc: picked.so_desc,
        orderedQty: parseFloat(picked.so_quantity || 0),
        altUOM: picked.so_item_uom || "",
        sourceItem: picked,
        deliveredQtyFromSource: parseFloat(picked.delivered_qty || 0),
        plannedQtyFromSource: parseFloat(picked.planned_qty || 0),
        original_so_id: picked.sales_order.id,
        so_no: picked.sales_order.so_no,
        so_line_item_id: picked.sales_order_line_id,
        item_category_id: picked.item?.item_category,
        item_bundle_id: picked.item_bundle_id || "",
        is_internal: !!picked.source_po_line_item_id,
      });

      for (const soItem of currentItemArray) {
        const entry = pickedToItem(soItem);

        const bundleChildren = Array.isArray(soItem.children)
          ? soItem.children
          : [];

        if (bundleChildren.length > 0) {
          entry.bundleChildren = bundleChildren.map(pickedToItem);
        }

        allItems.push(entry);
      }
      break;
    }
  }

  console.log("allItems", allItems);

  // TEMP GUARD: block combining internal-trading and non-internal SOs in one GD.
  // Internal = the SO carries a source PO ref (source_po_id header / source_po_line_item_id
  // line). No DB fetch — the marker is already on the selected records / GD lines.
  {
    const isInternalRec = (x) =>
      !!(x && (x.is_internal || x.source_po_id || x.source_po_line_item_id));
    const flags = [
      ...(allItems || []).map(isInternalRec),
      ...(existingGD || [])
        .filter((l) => typeof l.is_internal === "boolean")
        .map((l) => l.is_internal),
    ];
    if (flags.includes(true) && flags.includes(false)) {
      this.hideLoading();
      this.$alert(
        "Cannot combine internal trading and non-internal Sales Orders in the same Goods Delivery. Please select only one type.",
        "Error",
        { confirmButtonText: "OK", type: "error" },
      );
      return;
    }
  }

  allItems = allItems.filter(
    (gd) =>
      gd.deliveredQtyFromSource !== gd.orderedQty &&
      !existingGD.find(
        (gdItem) => gdItem.so_line_item_id === gd.so_line_item_id,
      ),
  );

  console.log("allItems after filter", allItems);

  let newTableGd = await createTableGdWithBaseUOM(allItems);

  const latestTableGD = [...existingGD, ...newTableGd];

  soId = [...new Set(latestTableGD.map((gr) => gr.line_so_id))];
  salesOrderNumber = [...new Set(latestTableGD.map((gr) => gr.line_so_no))];
  const uniqueSalesPerson = [
    ...new Set(
      currentItemArray
        .map((so) => {
          // Document: item_array entry already stores the agent id under
          // `sales_person` (see rowClick_addSO). Item: read from the SO FK.
          const sp =
            referenceType === "Document"
              ? so.sales_person
              : so.sales_order.so_sales_person;
          // Item mode may return an FK object; the field stores agent ids.
          return sp && typeof sp === "object" ? sp.id : sp;
        })
        .filter((sp) => sp),
    ),
  ];

  const headerData = {
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].currency
        : currentItemArray[0].sales_order.so_currency,
    customer_name:
      referenceType === "Document"
        ? currentItemArray[0].customer_id
        : currentItemArray[0].customer_id.id,
    table_gd: latestTableGD,
    so_no: salesOrderNumber.join(", "),
    so_id: soId,
    reference_type: referenceType,
    dialog_insufficient: {
      table_insufficient: [], // Will be populated by checkInventoryWithDuplicates
    },
  };

  // Only set sales_person when there's an actual value; setting an empty
  // array/null forces the multi-select to render an empty [null] row.
  if (uniqueSalesPerson.length > 0) {
    headerData.sales_person = uniqueSalesPerson;
  }

  await this.setData(headerData);

  setTimeout(async () => {
    try {
      const plantId = this.getValue("plant_id");
      const newItems = allItems.filter((item) => {
        return !existingGD.find(
          (gdItem) => gdItem.so_line_item_id === item.so_line_item_id,
        );
      });

      // Allocation walks the rows flat, and a bundle's items are rows in their
      // own right, so both the entries and the offset are counted that way.
      const insufficientItems = await checkInventoryWithDuplicates(
        flattenAllItems(newItems),
        plantId,
        flattenTreeRows(existingGD).length,
      );

      if (insufficientItems.length > 0) {
        console.log(
          "Materials with insufficient inventory:",
          insufficientItems,
        );
        this.openDialog("dialog_insufficient");
      }

      console.log("Finished populating table_gd items");
    } catch (error) {
      console.error("Error in inventory check:", error);
    }
  }, 200);

  this.hideLoading();
})();
