// processAllocationResult - Maps global workflow result to GD row data
// Replaces the result-building part of executeAllocation
// ============================================================================

const currentRow = {{node:code_node_aay7z3VT.data.currentRow}};
const workflowResult = {{node:workflow_node_NwRLmxNW.data}};
const allUOMs = {{node:search_node_pltmkkw3.data.data}} || [];
const allBinLocations = {{node:search_node_nbpWEAFx.data.data}} || [];
const rawTracker = {{node:get_cache_node_QGhmYUxQ.data}};
const huData = {{node:code_node_Htpcyp8t.data.huData}} || [];

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

// Extract allocation result from workflow response
const allocationResult = workflowResult?.data || workflowResult || {};
const allocationData = allocationResult.allocationData || [];

// Helper: lookup bin location name
const getBinLocationName = (locationId) => {
  const bin = allBinLocations.find((b) => b.id === locationId);
  return bin ? bin.bin_location_combine : locationId;
};

// Helper: lookup UOM name
const getUOMName = (uomId) => {
  const uom = allUOMs.find((u) => u.id === uomId);
  return uom ? uom.uom_name : "";
};

// Helper: lookup handling_no from huData header rows
const getHandlingNo = (handlingUnitId) => {
  const header = huData.find(
    (row) => row.row_type === "header" && row.handling_unit_id === handlingUnitId,
  );
  return header ? header.handling_no : handlingUnitId;
};

// Separate HU and loose allocations
const looseAllocations = allocationData.filter((a) => a.source !== "hu");
const huAllocations = allocationData.filter((a) => a.source === "hu");

// Build temp_qty_data (loose + HU combined, same shape as before)
const tempQtyData = allocationData.map((alloc) => {
  const record = {
    material_id: currentRow.materialId,
    location_id: alloc.location_id,
    batch_id: alloc.batch_id || null,
    unrestricted_qty:
      alloc.original_unrestricted_qty || alloc.unrestricted_qty,
    plant_id: currentRow.plantId,
    organization_id: currentRow.organizationId,
    is_deleted: 0,
    gd_quantity: alloc.gd_quantity || 0,
    balance_id: alloc.balance_id || "",
  };

  // Tag HU records so they can be distinguished later
  if (alloc.source === "hu" && alloc.handling_unit_id) {
    record.handling_unit_id = alloc.handling_unit_id;
  }

  return record;
});

// Build temp_hu_data (HU-only allocations for HU-specific processing)
const tempHuData = huAllocations.map((alloc) => ({
  row_type: "item",
  handling_unit_id: alloc.handling_unit_id,
  material_id: alloc.material_id || currentRow.materialId,
  location_id: alloc.location_id,
  batch_id: alloc.batch_id || null,
  balance_id: alloc.balance_id || "",
  deliver_quantity: alloc.gd_quantity || 0,
  item_quantity: alloc.original_unrestricted_qty || alloc.unrestricted_qty || 0,
}));

// Build view_stock summary
const uomName = getUOMName(currentRow.uomId);
const totalAllocated = allocationData.reduce(
  (sum, a) => sum + (a.gd_quantity || 0),
  0,
);

let viewStock = "";

if (totalAllocated > 0) {
  const looseTotal = looseAllocations.reduce(
    (sum, a) => sum + (a.gd_quantity || 0),
    0,
  );
  const huTotal = huAllocations.reduce(
    (sum, a) => sum + (a.gd_quantity || 0),
    0,
  );

  viewStock = `Total: ${totalAllocated} ${uomName}\n\n`;

  if (huAllocations.length > 0 && looseAllocations.length > 0) {
    // Both loose and HU
    viewStock += `LOOSE STOCK:\n`;
    looseAllocations.forEach((alloc, idx) => {
      const binName = getBinLocationName(alloc.location_id);
      let line = `${idx + 1}. ${binName}: ${alloc.gd_quantity} ${uomName}`;
      if (alloc.batch_id) {
        line += `\n[Batch: ${alloc.batch_id}]`;
      }
      viewStock += line + "\n";
    });

    viewStock += `\nHANDLING UNIT:\n`;
    huAllocations.forEach((alloc, idx) => {
      const binName = getBinLocationName(alloc.location_id);
      let line = `${idx + 1}. ${binName}: ${alloc.gd_quantity} ${uomName}`;
      if (alloc.handling_unit_id) {
        line += ` [HU: ${getHandlingNo(alloc.handling_unit_id)}]`;
      }
      if (alloc.batch_id) {
        line += `\n[Batch: ${alloc.batch_id}]`;
      }
      viewStock += line + "\n";
    });
  } else if (huAllocations.length > 0) {
    // HU only
    viewStock += `HANDLING UNIT:\n`;
    huAllocations.forEach((alloc, idx) => {
      const binName = getBinLocationName(alloc.location_id);
      let line = `${idx + 1}. ${binName}: ${alloc.gd_quantity} ${uomName}`;
      if (alloc.handling_unit_id) {
        line += ` [HU: ${getHandlingNo(alloc.handling_unit_id)}]`;
      }
      if (alloc.batch_id) {
        line += `\n[Batch: ${alloc.batch_id}]`;
      }
      viewStock += line + "\n";
    });
  } else {
    // Loose only
    viewStock += `DETAILS:\n`;
    looseAllocations.forEach((alloc, idx) => {
      const binName = getBinLocationName(alloc.location_id);
      let line = `${idx + 1}. ${binName}: ${alloc.gd_quantity} ${uomName}`;
      if (alloc.batch_id) {
        line += `\n[Batch: ${alloc.batch_id}]`;
      }
      viewStock += line + "\n";
    });
  }
}

// Update allocation tracker for cross-row deduction
const updatedTracker = { ...allocationTracker };
if (!updatedTracker[currentRow.materialId]) {
  updatedTracker[currentRow.materialId] = {};
}

const rowAllocations = {};
allocationData.forEach((alloc) => {
  // Only track loose allocations for cross-row deduction
  // HU stock is independent and already deducted from balances
  if (alloc.source === "hu") return;

  const key = alloc.batch_id
    ? `${alloc.location_id}-${alloc.batch_id}`
    : `${alloc.location_id}`;
  rowAllocations[key] = (rowAllocations[key] || 0) + (alloc.gd_quantity || 0);
});
updatedTracker[currentRow.materialId][currentRow.rowIndex] = rowAllocations;

return {
  temp_qty_data: JSON.stringify(tempQtyData),
  temp_hu_data: JSON.stringify(tempHuData),
  view_stock: viewStock,
  total_allocated: totalAllocated,
  rowIndex: currentRow.rowIndex,
  updatedTracker: updatedTracker,
};
