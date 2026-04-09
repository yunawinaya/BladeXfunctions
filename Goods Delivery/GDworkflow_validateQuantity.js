// Validate Quantity & Update SO Table (code_node_muzjP26e)
// Updated to skip order limit validation for FULL_HU_PICK/NO_SPLIT policies.
// Copy this into the platform's code node editor.

const gdItem = {{node:code_node_SOBNriDH.data.gdItem}};
const originalGdItem = {{node:code_node_SOBNriDH.data.originalGdItem}};
const itemData = {{node:get_node_DDcDRdMe.data.data}};
const soItem = {{node:get_node_YMto3jtl.data.data}};
const rowIndex = {{node:code_node_SOBNriDH.data.nextIndex}};
const gd_status = {{node:code_node_IyJHrBst.data.gd_status}};
const saveAs = {{workflowparams:saveAs}};
const isGDPP = {{workflowparams:allData.is_select_picking}} || 0;
const splitPolicy = {{workflowparams:allData.split_policy}} || "ALLOW_SPLIT";

const orderLimit = (gdItem.gd_order_quantity * (100 + (itemData.over_delivery_tolerance || 0))) / 100;
const deliveredQty = soItem.delivered_qty || 0;
const plannedQty = soItem.planned_qty || 0;

// Returns number for calculations/validation
const roundQty = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const num = parseFloat(value);
  return Math.round(num * 1000) / 1000;
};

// Returns string for database updates
const formatNumber = (value) => {
  if (value === null || value === undefined || value === "") return "0.000";
  return parseFloat(value).toFixed(3);
};

// FIX: Parse gd_qty as number to avoid string concatenation
const currentGdQty = parseFloat(gdItem.gd_qty) || 0;
const origQty = parseFloat(originalGdItem?.gd_qty) || 0;

let gdQtyChange = currentGdQty;
if (originalGdItem) {
  gdQtyChange = roundQty(currentGdQty - origQty);
}

let totalCommitted;
if (isGDPP === 1) {
  totalCommitted = roundQty(deliveredQty + currentGdQty);
} else {
  totalCommitted = roundQty(deliveredQty + plannedQty + gdQtyChange);
}

let validationMessage = null;

// Validate order limit (skip for FULL_HU_PICK only — NO_SPLIT enforces tolerance)
if (splitPolicy !== "FULL_HU_PICK" && totalCommitted > orderLimit && saveAs !== "Cancelled") {
  validationMessage = `Row ${rowIndex} with Item ${itemData.material_code} validation failed: quantity is exceeding the maximum deliverable quantity.`;
}

// Validate planned_qty won't go negative
if (!validationMessage) {
  let projectedPlannedQty = plannedQty;

  if (isGDPP === 1 && saveAs === "Completed") {
    projectedPlannedQty = roundQty(plannedQty - currentGdQty);
  } else if (gd_status === "Created" && saveAs === "Completed") {
    projectedPlannedQty = roundQty(plannedQty - origQty);
  } else if (gd_status === "Created" && saveAs === "Created") {
    projectedPlannedQty = roundQty(plannedQty - origQty + currentGdQty);
  } else if (saveAs === "Cancelled" && gd_status === "Created") {
    projectedPlannedQty = roundQty(plannedQty - currentGdQty);
  }

  if (projectedPlannedQty < 0) {
    validationMessage = `Row ${rowIndex} with Item ${itemData.material_code} validation failed: planned quantity would become negative (${projectedPlannedQty}). Please contact support.`;
  }
}

// If validation failed, return early
if (validationMessage) {
  let updatedSOTable = {{node:get_cache_node_pLyxuBie.data}};
  if (typeof updatedSOTable === 'string') {
    try {
      updatedSOTable = JSON.parse(updatedSOTable);
    } catch (e) {
      updatedSOTable = [];
    }
  }
  if (!Array.isArray(updatedSOTable)) {
    updatedSOTable = [];
  }

  return {
    validationMessage: validationMessage,
    updatedSOTable: updatedSOTable
  };
}

let updatedSOTable = {{node:get_cache_node_pLyxuBie.data}};
if (typeof updatedSOTable === 'string') {
  try {
    updatedSOTable = JSON.parse(updatedSOTable);
  } catch (e) {
    updatedSOTable = [];
  }
}
if (!Array.isArray(updatedSOTable)) {
  updatedSOTable = [];
}
let updatedSOItem = {{node:get_node_YMto3jtl.data.data}};

if (isGDPP === 1) {
  if (saveAs === "Completed") {
    updatedSOItem.delivered_qty = formatNumber(deliveredQty + currentGdQty);
    updatedSOItem.planned_qty = formatNumber(plannedQty - currentGdQty);
    updatedSOItem.outstanding_quantity = formatNumber(updatedSOItem.so_quantity - updatedSOItem.delivered_qty);
  }

} else {
  if (gd_status === "Draft" && saveAs === "Completed") {
    updatedSOItem.delivered_qty = formatNumber(deliveredQty + currentGdQty);
    updatedSOItem.outstanding_quantity = formatNumber(updatedSOItem.so_quantity - updatedSOItem.delivered_qty);

  } else if (gd_status === "Draft" && saveAs === "Created") {
    updatedSOItem.planned_qty = formatNumber(plannedQty + currentGdQty);

  } else if (gd_status === "Created" && saveAs === "Completed") {
    updatedSOItem.planned_qty = formatNumber(plannedQty - origQty);
    updatedSOItem.delivered_qty = formatNumber(deliveredQty + currentGdQty);
    updatedSOItem.outstanding_quantity = formatNumber(updatedSOItem.so_quantity - updatedSOItem.delivered_qty);

  } else if (gd_status === "Created" && saveAs === "Created") {
    updatedSOItem.planned_qty = formatNumber(plannedQty - origQty + currentGdQty);

  } else if (saveAs === "Cancelled" && gd_status === "Created") {
    updatedSOItem.planned_qty = formatNumber(plannedQty - currentGdQty);
  }
}

if (saveAs === "Completed") {
  if (parseFloat(updatedSOItem.outstanding_quantity) > 0) {
    updatedSOItem.line_status = "Processing";
  } else {
    updatedSOItem.line_status = "Completed";
  }
}

updatedSOTable.push(updatedSOItem);

return {
  validationMessage: validationMessage,
  updatedSOTable: updatedSOTable
};
