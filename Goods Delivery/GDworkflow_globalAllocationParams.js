// Global Allocation Params (code_node_Htpcyp8t)
// This is the code for the backend workflow node that prepares params for GLOBAL_AUTO_ALLOCATION.
// Copy this into the platform's code node editor.
// CHANGES: Added splitPolicy, lineMaterials to the return object.
//          For FULL_HU_PICK/NO_SPLIT, includes ALL items per HU (not just current material).

const currentRow = {{node:code_node_aay7z3VT.data.currentRow}};
const pickingSetup = {{node:get_node_iFPuvJX2.data.data}};
const rawTracker = {{node:get_cache_node_QGhmYUxQ.data}};
const allData = {{workflowparams:allData}};
const allHUData = {{node:search_node_l8oiJ60B.data.data}} || [];
const isGDPP = allData.is_select_picking || 0;
const gd_status = {{workflowparams:allData.gd_status}} || "Draft";
const rowsNeedingAllocation = {{node:code_node_kJx9p9Nh.data.rowsNeedingAllocation}};

// Split policy from picking setup
const splitPolicy = pickingSetup.split_policy || "ALLOW_SPLIT";
const allowMixedItem = pickingSetup.allow_mixed_item ?? 1;

let allocationTracker = {};
if (rawTracker) {
  if (typeof rawTracker === "string") {
    try {
      allocationTracker = JSON.parse(rawTracker);
    } catch (e) {
      allocationTracker = {};
    }
  } else if (typeof rawTracker === "object") {
    allocationTracker = rawTracker;
  }
}

// Build existingAllocationData from tracker (cross-row deduction)
const existingAllocations = [];
const materialAllocations = allocationTracker[currentRow.materialId] || {};

Object.entries(materialAllocations).forEach(([rIdx, rowAllocs]) => {
  if (parseInt(rIdx) !== currentRow.rowIndex) {
    Object.entries(rowAllocs).forEach(([locationKey, qty]) => {
      const parts = locationKey.split("-");
      const locationId = parts[0];
      let batchId = null;
      let handlingUnitId = null;

      if (parts.length > 1) {
        if (parts[1] === "hu") {
          handlingUnitId = parts[2] || null;
        } else {
          batchId = parts[1] !== "no_batch" ? parts[1] : null;
        }
      }

      existingAllocations.push({
        location_id: locationId,
        batch_id: batchId,
        handling_unit_id: handlingUnitId,
        quantity: qty,
      });
    });
  }
});

// Build HU data from pre-fetched allHUData
const huData = [];
for (const hu of allHUData) {
  // For ALLOW_SPLIT: only include items matching current material
  // For FULL_HU_PICK/NO_SPLIT: include ALL items in HUs that contain current material
  const allActiveItems = (hu.table_hu_items || []).filter(
    (item) => item.is_deleted !== 1,
  );
  const hasCurrentMaterial = allActiveItems.some(
    (item) => item.material_id === currentRow.materialId,
  );
  if (!hasCurrentMaterial) continue;

  const itemsToInclude = splitPolicy === "ALLOW_SPLIT"
    ? allActiveItems.filter((item) => item.material_id === currentRow.materialId)
    : allActiveItems;

  // Header row
  huData.push({
    row_type: "header",
    handling_unit_id: hu.id,
    handling_no: hu.handling_no,
    material_id: "",
    material_name: "",
    storage_location_id: hu.storage_location_id,
    location_id: hu.location_id,
    batch_id: null,
    item_quantity: parseFloat(hu.total_quantity) || 0,
    deliver_quantity: 0,
    remark: hu.remark || "",
    balance_id: "",
  });

  // Item rows
  for (const huItem of itemsToInclude) {
    huData.push({
      row_type: "item",
      handling_unit_id: hu.id,
      handling_no: "",
      material_id: huItem.material_id,
      material_name: huItem.material_name,
      storage_location_id: hu.storage_location_id,
      location_id: huItem.location_id || hu.location_id,
      batch_id: huItem.batch_id || null,
      item_quantity: parseFloat(huItem.quantity) || 0,
      deliver_quantity: 0,
      remark: "",
      balance_id: huItem.balance_id || "",
      expired_date: huItem.expired_date || null,
      manufacturing_date: huItem.manufacturing_date || null,
      create_time: huItem.create_time || hu.create_time,
    });
  }
}

return {
  material_id: currentRow.materialId,
  quantity: currentRow.quantity,
  plant_id: currentRow.plantId,
  organization_id: currentRow.organizationId,
  allocationType: "GD",
  allocationStrategy: pickingSetup.default_strategy_id || "RANDOM",
  isPending: currentRow.soLineItemId ? 1 : 0,
  parent_line_id: currentRow.soLineItemId || "",
  existingAllocationData: existingAllocations,
  huData: huData,
  huPriority: pickingSetup.hu_priority || "HU First",
  currentDocId: allData.id || "",
  enforceStockCheck: 1,
  includeReservedQty: (gd_status === "Created" || isGDPP === 1) ? 1 : 0,
  orderUomId: currentRow.uomId || "",
  splitPolicy: splitPolicy,
  allowMixedItem: allowMixedItem,
  lineMaterials: rowsNeedingAllocation.map((r) => r.materialId),
};
