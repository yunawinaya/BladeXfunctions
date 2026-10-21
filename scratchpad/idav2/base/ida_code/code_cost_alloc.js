// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const entry = {{node:code_fillback.data.allData}};
const items = {{node:search_items.data.data}} || [];
const movements = {{node:search_movements.data.data}} || [];
const persisted = {{node:code_persisted.data}};
const lines = {{node:code_apply_batches.data.stock_movement}} || [];

const itemMap = {};
items.forEach(function (it) { itemMap[String(it.id)] = it; });

// Read the issued value back off the movements the issue leg just wrote.
// SUBTRACT has a success path that returns only `code` and no unit_price, so its
// response can never be relied on; the movement rows always carry the real figure.
const issuedValue = movements.reduce(function (sum, m) {
  return sum + (parseFloat(m.total_price) || 0);
}, 0);

// PROVISIONAL COSTING RULE -- Finance has not confirmed the policy yet.
// The issued value is split across recovery lines by each line's share of the
// total recovered quantity, so recovered value always equals issued value and no
// variance is posted. The last line takes the rounding remainder. Replace this
// block once the costing policy is decided.
const totalQty = lines.reduce(function (sum, l) { return sum + q8(l.total_quantity); }, 0);
let remaining = issuedValue;

const receipts = lines.map(function (line, i) {
  const qty = q8(line.total_quantity);
  const lineValue = i === lines.length - 1
    ? remaining
    : (totalQty > 0 ? issuedValue * qty / totalQty : 0);
  remaining -= lineValue;

  // '-' is the form's "no batch" marker, not a batch number.
  const batch = String(line.batch_number || '');

  return {
    plant_id: line.issuing_plant || entry.issuing_operation_faci,
    organization_id: line.organization_id || entry.organization_id,
    material_id: line.item_selection,
    material_uom: line.quantity_uom,
    quantity: qty,
    unit_price: qty > 0 ? q8(lineValue / qty) : 0,
    location_id: line.location_id,
    batch_number: batch === '-' ? '' : batch,
    trx_no: persisted.stock_movement_no,
    doc_date: entry.item_disassembly_date || null,
    manufacturing_date: line.manufacturing_date || null,
    expired_date: line.expired_date || null,
    remark: line.item_remark || '',
    remark2: line.item_remark_2 || '',
    remark3: line.item_remark_3 || '',
    itemData: itemMap[String(line.item_selection)] || null
  };
});

return { receipts: receipts, issuedValue: q8(issuedValue) };