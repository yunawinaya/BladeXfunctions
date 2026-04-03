const currentRow = {{node:code_node_aay7z3VT.data.currentRow}};
const pickingSetup = {{node:get_node_iFPuvJX2.data.data}};
const rawTracker = {{node:get_cache_node_QGhmYUxQ.data}};
const allData = {{workflowparams:allData}};
const allHUData = {{node:search_node_l8oiJ60B.data.data}}|| [];

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

      // Key format: "locationId" or "locationId-batchId" or "locationId-hu-huId"
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

// Build HU data for this material from pre-fetched allHUData
const huData = [];
for (const hu of allHUData) {
  const matchingItems = (hu.table_hu_items || []).filter(
    (item) => item.material_id === currentRow.materialId && item.is_deleted !== 1,
  );
  if (matchingItems.length === 0) continue;

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
  for (const huItem of matchingItems) {
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
};
