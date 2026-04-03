const rawtableGD = {{node:get_cache_node_6hmHAVwX.data}};
let tableGD = [];

if (rawtableGD) {
  if (typeof rawtableGD === "string") {
    tableGD = JSON.parse(rawtableGD);
  } else {
    tableGD = rawtableGD;
  }
}

const allocationResult = {{node:code_node_hifFKzmo.data}}
const rowIndex = allocationResult.rowIndex;

// Update specific row
if (tableGD[rowIndex]) {
  tableGD[rowIndex].temp_qty_data = allocationResult.temp_qty_data;
  tableGD[rowIndex].temp_hu_data = allocationResult.temp_hu_data;
  tableGD[rowIndex].view_stock = allocationResult.view_stock;

  const gdQty = parseFloat(tableGD[rowIndex].gd_qty) || 0;
  const initialDeliveredQty =
    parseFloat(tableGD[rowIndex].gd_initial_delivered_qty) || 0;
  const orderedQty = parseFloat(tableGD[rowIndex].gd_order_quantity) || 0;

  tableGD[rowIndex].gd_delivered_qty = initialDeliveredQty + gdQty;
  tableGD[rowIndex].gd_undelivered_qty =
    orderedQty - (initialDeliveredQty + gdQty);
}

return {
  tableGD: tableGD,
  updatedTracker: allocationResult.updatedTracker,
};
