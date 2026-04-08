// processAllocationResult - Maps global workflow result to GD row data
// Replaces the result-building part of executeAllocation
// ============================================================================

const currentRow = {{node:code_node_aay7z3VT.data.currentRow}};
const workflowResult = {{node:workflow_node_NwRLmxNW.data}};
const allUOMs = {{node:search_node_pltmkkw3.data.data}} || [];
const allBinLocations = {{node:search_node_nbpWEAFx.data.data}} || [];
const rawTracker = {{node:get_cache_node_QGhmYUxQ.data}};
const huData = {{node:code_node_Htpcyp8t.data.huData}} || [];
const splitPolicy = {{node:code_node_Htpcyp8t.data.splitPolicy}} || "ALLOW_SPLIT";

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

// For whole-HU policies, allocations may include items for other materials
const currentMaterialAllocs = allocationData.filter(
  (a) => !a.material_id || a.material_id === currentRow.materialId,
);
const otherMaterialAllocs = splitPolicy !== "ALLOW_SPLIT"
  ? allocationData.filter(
      (a) => a.material_id && a.material_id !== currentRow.materialId,
    )
  : [];

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

// Separate HU and loose allocations (current material only)
const looseAllocations = currentMaterialAllocs.filter((a) => a.source !== "hu");
const huAllocations = currentMaterialAllocs.filter((a) => a.source === "hu");

// Build temp_qty_data (loose + HU combined, same shape as before)
const tempQtyData = currentMaterialAllocs.map((alloc) => {
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
const totalAllocated = currentMaterialAllocs.reduce(
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

// Cross-line distribution for whole-HU policies
const crossLineUpdates = {};
const tempExcessData = [];

if (splitPolicy !== "ALLOW_SPLIT" && otherMaterialAllocs.length > 0) {
  const rawTableGD = {{node:get_cache_node_6hmHAVwX.data}};
  let tableGD = [];
  if (rawTableGD) {
    tableGD = typeof rawTableGD === "string" ? JSON.parse(rawTableGD) : rawTableGD;
  }

  // Build material -> line indices map
  const materialLineMap = {};
  tableGD.forEach((line, idx) => {
    if (idx === currentRow.rowIndex) return;
    if (line.material_id) {
      if (!materialLineMap[line.material_id]) materialLineMap[line.material_id] = [];
      materialLineMap[line.material_id].push(idx);
    }
  });

  for (const alloc of otherMaterialAllocs) {
    const targetLines = materialLineMap[alloc.material_id];

    if (!targetLines || targetLines.length === 0) {
      // Foreign item — no matching GD line
      tempExcessData.push({
        handling_unit_id: alloc.handling_unit_id || "",
        handling_no: getHandlingNo(alloc.handling_unit_id),
        material_id: alloc.material_id,
        material_name: alloc.material_name || "",
        quantity: alloc.gd_quantity || 0,
        batch_id: alloc.batch_id || null,
        location_id: alloc.location_id,
        reason: "no_gd_line",
      });
      continue;
    }

    // Distribute to first matching line
    const targetIdx = targetLines[0];
    if (!crossLineUpdates[targetIdx]) {
      crossLineUpdates[targetIdx] = { tempQtyData: [], tempHuData: [] };
    }

    crossLineUpdates[targetIdx].tempQtyData.push({
      material_id: alloc.material_id,
      location_id: alloc.location_id,
      batch_id: alloc.batch_id || null,
      unrestricted_qty: alloc.original_unrestricted_qty || alloc.unrestricted_qty,
      plant_id: currentRow.plantId,
      organization_id: currentRow.organizationId,
      is_deleted: 0,
      gd_quantity: alloc.gd_quantity || 0,
      balance_id: alloc.balance_id || "",
      handling_unit_id: alloc.handling_unit_id || "",
    });

    if (alloc.source === "hu") {
      crossLineUpdates[targetIdx].tempHuData.push({
        row_type: "item",
        handling_unit_id: alloc.handling_unit_id,
        material_id: alloc.material_id,
        location_id: alloc.location_id,
        batch_id: alloc.batch_id || null,
        balance_id: alloc.balance_id || "",
        deliver_quantity: alloc.gd_quantity || 0,
        item_quantity: alloc.original_unrestricted_qty || alloc.unrestricted_qty || 0,
      });
    }
  }
}

// Check for over-pick excess on current material
const currentMaterialTotal = currentMaterialAllocs.reduce(
  (sum, a) => sum + (a.gd_quantity || 0), 0,
);
if (currentMaterialTotal > currentRow.quantity && currentRow.quantity > 0) {
  tempExcessData.push({
    handling_unit_id: currentMaterialAllocs.find((a) => a.handling_unit_id)?.handling_unit_id || "",
    handling_no: "",
    material_id: currentRow.materialId,
    material_name: "",
    quantity: currentMaterialTotal - currentRow.quantity,
    batch_id: null,
    location_id: "",
    reason: "over_pick",
  });
}

// Update allocation tracker for cross-row deduction
const updatedTracker = { ...allocationTracker };
if (!updatedTracker[currentRow.materialId]) {
  updatedTracker[currentRow.materialId] = {};
}

const rowAllocations = {};
currentMaterialAllocs.forEach((alloc) => {
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
  temp_excess_data: JSON.stringify(tempExcessData || []),
  view_stock: viewStock,
  total_allocated: totalAllocated,
  rowIndex: currentRow.rowIndex,
  updatedTracker: updatedTracker,
  crossLineUpdates: crossLineUpdates,
};
