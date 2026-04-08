// updateRowInTableGd (code_node_56IOJIBu)
// Updated to handle crossLineUpdates and temp_excess_data from split policy.
// Copy this into the platform's code node editor.

const rawtableGD = {{node:get_cache_node_6hmHAVwX.data}};
let tableGD = [];

if (rawtableGD) {
  if (typeof rawtableGD === "string") {
    tableGD = JSON.parse(rawtableGD);
  } else {
    tableGD = rawtableGD;
  }
}

const allocationResult = {{node:code_node_hifFKzmo.data}};
const rowIndex = allocationResult.rowIndex;

// Update current row
if (tableGD[rowIndex]) {
  tableGD[rowIndex].temp_qty_data = allocationResult.temp_qty_data;
  tableGD[rowIndex].temp_hu_data = allocationResult.temp_hu_data;
  tableGD[rowIndex].view_stock = allocationResult.view_stock;

  // Save temp_excess_data on current row
  if (allocationResult.temp_excess_data) {
    tableGD[rowIndex].temp_excess_data = allocationResult.temp_excess_data;
  }

  const gdQty = parseFloat(tableGD[rowIndex].gd_qty) || 0;
  const initialDeliveredQty =
    parseFloat(tableGD[rowIndex].gd_initial_delivered_qty) || 0;
  const orderedQty = parseFloat(tableGD[rowIndex].gd_order_quantity) || 0;

  tableGD[rowIndex].gd_delivered_qty = initialDeliveredQty + gdQty;
  tableGD[rowIndex].gd_undelivered_qty =
    orderedQty - (initialDeliveredQty + gdQty);
}

// Apply cross-line distribution updates from whole-HU policies
const crossLineUpdates = allocationResult.crossLineUpdates || {};
for (const [idx, updates] of Object.entries(crossLineUpdates)) {
  const lineIdx = parseInt(idx);
  if (!tableGD[lineIdx]) continue;

  // Merge with existing temp data on the target line
  let existingQty = [];
  let existingHu = [];
  try {
    if (tableGD[lineIdx].temp_qty_data && tableGD[lineIdx].temp_qty_data !== "[]") {
      existingQty = JSON.parse(tableGD[lineIdx].temp_qty_data);
    }
  } catch (e) { /* ignore */ }
  try {
    if (tableGD[lineIdx].temp_hu_data && tableGD[lineIdx].temp_hu_data !== "[]") {
      existingHu = JSON.parse(tableGD[lineIdx].temp_hu_data);
    }
  } catch (e) { /* ignore */ }

  tableGD[lineIdx].temp_qty_data = JSON.stringify([...existingQty, ...updates.tempQtyData]);
  tableGD[lineIdx].temp_hu_data = JSON.stringify([...existingHu, ...updates.tempHuData]);
}

return {
  tableGD: tableGD,
  updatedTracker: allocationResult.updatedTracker,
};
