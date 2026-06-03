const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const row = data.table_picking_items[index] || {};

const pending_process_qty = parseFloat(row.pending_process_qty || 0);

if (!window.validationState) {
  window.validationState = {};
}

// picked_qty (value) is entered in the row's picking_uom; pending_process_qty
// is canonical (order UOM = item_uom). Convert the entered value back to the
// order UOM before comparing. Conversion data is cached by enrichPickingUOM
// (PickingOnMounted); identity fallback keeps behaviour unchanged when no
// alternate UOM is in play.
const convertBaseToAlt = (baseQty, conv, uom) => {
  if (!Array.isArray(conv) || conv.length === 0 || !uom) return baseQty;
  const c = conv.find((x) => x.alt_uom_id === uom);
  if (!c || !c.base_qty) return baseQty;
  return Math.round((baseQty / c.base_qty) * 1000) / 1000;
};
const convertQuantityFromTo = (val, conv, fromUOM, toUOM, baseUOM) => {
  if (!val || fromUOM === toUOM) return val;
  let baseQty = val;
  if (fromUOM !== baseUOM) {
    const fromConv = (conv || []).find((x) => x.alt_uom_id === fromUOM);
    if (fromConv && fromConv.base_qty) baseQty = val * fromConv.base_qty;
  }
  return convertBaseToAlt(baseQty, conv, toUOM);
};

const orderUom = String(row.item_uom);
const pickingUom = row.picking_uom ? String(row.picking_uom) : orderUom;
const cache =
  (window.pickingUOMCache && window.pickingUOMCache[String(row.item_code)]) ||
  null;

const parsedValue = parseFloat(value) || 0;
const pickedInOrderUom = convertQuantityFromTo(
  parsedValue,
  cache ? cache.table_uom_conversion : [],
  pickingUom,
  orderUom,
  cache ? cache.based_uom : orderUom,
);

if (pending_process_qty < pickedInOrderUom) {
  window.validationState[index] = false;
  callback("Quantity is not enough to pick");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
