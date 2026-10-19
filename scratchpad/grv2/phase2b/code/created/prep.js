// The only node that reads allData: guards, fill, checks, the GR row to write and a compact per-PO-line view
const MAX_LINES = 2000;
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const roundQty = (v) => parseFloat(parseFloat(v || 0).toFixed(3));
const allData = [{{workflowparams:allData}}][0] || {};
const pageStatus = String([{{workflowparams:pageStatus}}][0] || "");
const continueZero = String([{{workflowparams:continueZero}}][0] || "");
const rawKey = String([{{workflowparams:idempotency_key}}][0] || "").trim();

const rows0 = Array.isArray(allData.table_gr) ? allData.table_gr : [];
let lineCount = 0;
for (const row of rows0) {
  lineCount += 1 + (Array.isArray(row.children) ? row.children.length : 0);
}
const sizeMessage =
  "This Goods Receiving has " + lineCount + " lines. A save of more than " + MAX_LINES +
  " lines is not supported here - please split it into smaller receipts.";
if (lineCount > MAX_LINES) {
  return { tooBig: "YES", sizeMessage };
}

const edit = pageStatus === "Edit";
const idText = String(allData.id === undefined || allData.id === null ? "" : allData.id).trim();
const grId = edit && /^[0-9]{1,20}$/.test(idText) ? idText : "0";
const keyOk = !edit && /^[A-Za-z0-9:_.-]{8,128}$/.test(rawKey);
// gr_idem_key = key#nonce: an attempt finds its own row after the add
const nonce = String([{{system:uuid}}][0] || "").replace(/[^A-Za-z0-9-]/g, "") ||
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// table_gr is a tree: an item bundle is ONE row with its items under `children`
const flatten = (rows) => {
  const flat = [];
  for (const row of rows || []) {
    flat.push(row);
    for (const child of Array.isArray(row.children) ? row.children : []) flat.push(child);
  }
  return flat;
};
const isBundleParentRow = (row) => Boolean(row.item_bundle_id) && !row.item_id;

const zeroQtyArray = [];
for (const [index, gr] of flatten(rows0).entries()) {
  if (isBundleParentRow(gr)) continue;
  if (gr.received_qty <= 0) zeroQtyArray.push(`#${index + 1}`);
}
let hasZero = 0;
let zeroMessage = null;
if (zeroQtyArray.length > 0) {
  zeroMessage = `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${zeroQtyArray.length > 1 ? "ve" : "s"} a zero received quantity.\nIf you proceed, those rows will be removed.\nWould you like to proceed?`;
  hasZero = 1;
}

// q8 as GOODS_RECEIVING's fillback: a raw client float (2032.3799999999997) failed the decimal check
const DECIMALS = ["ordered_qty", "base_ordered_qty", "to_received_qty", "received_qty", "base_received_qty",
  "initial_received_qty", "unit_price", "total_price", "uom_conversion"];
const stampGrLineItem = (line) => {
  for (const f of DECIMALS) {
    if (line[f] !== undefined && line[f] !== null && line[f] !== "") line[f] = q8(line[f]);
  }
  line.supplier_id = allData.supplier_name || null;
  line.organization_id = allData.organization_id;
  line.plant_id = allData.plant_id || null;
  line.billing_state_id = allData.billing_address_state || null;
  line.billing_country_id = allData.billing_address_country || null;
  line.shipping_state_id = allData.shipping_address_state || null;
  line.shipping_country_id = allData.shipping_address_country || null;
  line.assigned_to = allData.assigned_to || null;
};
const kept = [];
for (const [index, line] of rows0.entries()) {
  stampGrLineItem(line);
  line.line_index = index + 1;
  const children = Array.isArray(line.children) ? line.children : [];
  if (children.length > 0) {
    const keptChildren = [];
    for (const child of children) {
      stampGrLineItem(child);
      if (child.received_qty > 0) {
        child.line_index = keptChildren.length + 1;
        keptChildren.push(child);
      }
    }
    line.children = keptChildren;
  }
  if (isBundleParentRow(line) ? Array.isArray(line.children) && line.children.length > 0 : line.received_qty > 0) {
    kept.push(line);
  }
}
const flatRows = flatten(kept);

const noRule = allData.gr_no_type !== -9999;
const grNo = noRule && (!allData.gr_no || allData.previous_status === "Draft") ? "issued" : allData.gr_no;

let poID = [];
for (const gr of flatRows) poID.push(gr.line_po_id);
poID = [...new Set(poID)];
const poBusy = poID.map((v) => String(v === undefined || v === null ? "" : v).trim()).filter((v) => /^[0-9]{1,20}$/.test(v));

const invalidMessage = kept.length === 0
  ? "All Received Quantity must not be 0. Please add at least one item with received quantity > 0."
  : "";

const errors = [];
const headerRequired = [
  { name: "gr_no", label: "Good Receiving Number", value: grNo },
  { name: "gr_date", label: "Received Date", value: allData.gr_date },
  { name: "plant_id", label: "Plant", value: allData.plant_id },
];
for (const f of headerRequired) {
  const v = f.value;
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) errors.push(f.label + " is required.");
}
if (flatRows.length === 0) errors.push("GR Items are required.");
for (let i = 0; i < flatRows.length; i++) {
  const item = flatRows[i];
  if (item.is_split === "Yes" && item.parent_or_child === "Parent") continue;
  if (isBundleParentRow(item)) continue;
  if (!item.location_id) errors.push(`Target Location is required for item #${i + 1}.`);
  if (!item.inv_category) errors.push(`Inventory Category is required for item #${i + 1}.`);
  if (!item.item_batch_no) errors.push(`Batch Number is required for item #${i + 1}.`);
  if (item.is_serialized_item === 1 && item.is_serial_allocated !== 1) {
    const name = item.item_name || item.item_code || item.item_id || `Item #${i + 1}`;
    errors.push(`Serial number allocation is required for ${name} (row ${i + 1}).`);
  }
}

// per PO line: 3 dp for the checks (as before), 8 dp for the reservation
const agg = new Map();
for (const gr of flatRows) {
  if (gr.is_split === "Yes" && gr.parent_or_child === "Parent") continue;
  const lid = gr.po_line_item_id;
  if (!lid) continue;
  let a = agg.get(String(lid));
  if (!a) {
    a = { lid: String(lid), q3: 0, q8: 0, item: gr.item_id, uom: null, name: gr.item_name || gr.item_id || lid };
    agg.set(String(lid), a);
  }
  a.q3 = roundQty(a.q3 + parseFloat(gr.received_qty || 0));
  a.q8 = q8(a.q8 + parseFloat(gr.received_qty || 0));
  a.uom = gr.ordered_qty_uom;
}
const lines = [...agg.values()].map((a) => ({
  lid: a.lid, q3: a.q3, q8: a.q8, name: a.name,
  item: a.item === undefined || a.item === null ? "" : String(a.item),
  uom: a.uom === undefined || a.uom === null ? "" : String(a.uom),
}));
const digits = (list) => [...new Set(list.filter((v) => /^[0-9]{1,20}$/.test(v)))].join(",") || "0";

// only the columns the add / update nodes map (no dialog models)
const FIELDS = ["putaway_status", "plant_id", "purchase_order_number", "supplier_name", "currency_code",
  "gr_billing_address", "gr_shipping_address", "supplier_contact_person", "supplier_contact_number", "supplier_email",
  "organization_id", "acc_integration_type", "project_id", "reference_type", "previous_status", "batch_index",
  "reference_doc", "ref_no_1", "ref_no_2", "gr_no_type", "gr_received_by", "gr_date", "assigned_to", "table_sn_records",
  "gr_remark1", "gr_remark2", "gr_remark3", "gr_remark4", "gr_remark5", "billing_address_name", "billing_address_phone",
  "billing_address_line_1", "billing_address_line_2", "billing_address_line_3", "billing_address_line_4",
  "billing_address_city", "billing_postal_code", "billing_address_state", "billing_address_country", "billing_attention",
  "billing_address_fax", "shipping_address_fax", "shipping_address_name", "shipping_address_phone", "custom_fields_e9609s2l",
  "shipping_address_line_1", "shipping_address_line_2", "shipping_address_line_3", "shipping_address_line_4",
  "shipping_address_city", "shipping_postal_code", "shipping_address_state", "shipping_address_country",
  "shipping_attention"];
const gr = {};
for (const f of FIELDS) {
  if (f in allData) gr[f] = allData[f];
}
gr.po_id = poID;
gr.gr_no = grNo;
gr.table_gr = kept;

return {
  tooBig: "NO",
  sizeMessage,
  edit: edit ? "YES" : "NO",
  check: edit ? "YES" : "NO",
  grId,
  keyCheck: keyOk ? "YES" : "NO",
  keySql: keyOk ? rawKey : "",
  keyStore: keyOk ? rawKey + "#" + nonce : null,
  zeroStop: hasZero === 1 && continueZero !== "Yes" ? "YES" : "NO",
  zeroMessage,
  invalid: invalidMessage ? "YES" : "NO",
  invalidMessage,
  hasError: errors.length > 0 ? "YES" : "NO",
  errorMessage: errors.length > 0 ? errors.join("\n") : null,
  noRule: noRule ? "YES" : "NO",
  clientGrNo: allData.gr_no === undefined ? null : allData.gr_no,
  gr,
  lines,
  poLineCsv: digits(lines.map((a) => a.lid)),
  itemCsv: digits(lines.map((a) => a.item)),
  lineCount,
  poBusyJson: JSON.stringify(poBusy.length ? poBusy : ["0"]),
};
