// PO_SAVE pre-save checks in ONE pass over the payload (replaces Draft Check Doc No, Draft Required Fields, Check Doc No,
// Required Fields, Map Validate Quantity, Filter unnecessary line, Count line, Direct PI Zero Total Check and Map Approval
// PO Data, which each copied the whole payload). CHECK_REQUIRED_FIELD / VALIDATE_QUANTITY / CHECK_APPROVAL get only the
// fields they read; Fillback Header Fields rebuilds the record from the payload itself.
const a = {{workflowparams:allData}} || {};
const isDraft = a.po_status == "Draft";
const rows = a.table_po;
const list = Array.isArray(rows) ? rows : [];

// Doc number marker, as Draft Check Doc No / Check Doc No set it
let docNo = a.purchase_order_no;
const noNumber = !a.purchase_order_no || a.purchase_order_no === null || a.purchase_order_no === "";
if (a.purchase_order_no_type !== -9999) {
  if (isDraft && noNumber) docNo = "draft";
  if (!isDraft && (noNumber || a.previous_status == "Draft")) docNo = "issued";
}

// CHECK_REQUIRED_FIELD reads table_po only as "a non-empty array" (arrayFields is empty)
const tableForCheck = Array.isArray(rows) ? (rows.length > 0 ? [{}] : []) : null;
const tableField = { name: "table_po", label: "Item Information", isArray: true, arrayType: "object", arrayFields: [] };
const draftRequiredFields = JSON.stringify([{ name: "po_plant", label: "Plant" }, { name: "purchase_order_no", label: "PO Number" }, tableField]);
const draftRequiredEntry = JSON.stringify({ po_plant: a.po_plant, purchase_order_no: docNo, table_po: tableForCheck });
const requiredFields = JSON.stringify([
  { name: "po_supplier_id", label: "Supplier Name" },
  { name: "po_plant", label: "Plant" },
  { name: "purchase_order_no", label: "PO Number" },
  tableField,
]);
const requiredEntry = JSON.stringify({ po_supplier_id: a.po_supplier_id, po_plant: a.po_plant, purchase_order_no: docNo, table_po: tableForCheck });

// VALIDATE_QUANTITY reads item_id / item_name / item_desc / quantity of every row, children after their parent
const qtyRows = [];
const flatten = (rs) => {
  for (const row of Array.isArray(rs) ? rs : []) {
    const r = row || {};
    qtyRows.push({ item_id: r.item_id, item_name: r.item_name, item_desc: r.item_desc, quantity: r.quantity });
    flatten(r.children);
  }
};
if (!isDraft) flatten(rows);

// Filter unnecessary line + Count line (Issued)
const filtered = isDraft ? [] : list.filter((item) => (item.item_name || item.item_desc || item.item_id) && item.quantity > 0);
let savedLines = 0;
for (const line of filtered) savedLines += 1 + (Array.isArray(line.children) ? line.children.length : 0);

// Direct PI Zero Total Check (header fields only)
const piNeedConfirm = Number(a.auto_pi) === 1 && (parseFloat(a.po_total) || 0) <= 0 && a.create_pi !== "Yes";

// Map Approval PO Data: min / max unit price per line (parents 1, 2, ...; children 1/1, 1/2, ...), PO amount rule
const priced = [];
filtered.forEach((item, index) => {
  priced.push({ unit_price: item.unit_price, min_price: item.min_price, max_price: item.max_price, lineNo: `${index + 1}` });
  (Array.isArray(item.children) ? item.children : []).forEach((child, childIndex) => {
    priced.push({ unit_price: child.unit_price, min_price: child.min_price, max_price: child.max_price, lineNo: `${index + 1}/${childIndex + 1}` });
  });
});
const limitOf = (value) => {
  const n = parseFloat(value);
  return value == null || value === "" || Number.isNaN(n) || n === 0 ? null : n;
};
const minFailed = priced.filter((item) => {
  const minPrice = limitOf(item.min_price);
  return minPrice !== null && (parseFloat(item.unit_price) || 0) < minPrice;
});
const maxFailed = priced.filter((item) => {
  const maxPrice = limitOf(item.max_price);
  return maxPrice !== null && (parseFloat(item.unit_price) || 0) > maxPrice;
});
const minPriceResult = minFailed.length > 0 ? "failed" : "passed";
const maxPriceResult = maxFailed.length > 0 ? "failed" : "passed";
const amountResult = (parseFloat(a.po_total) || 0) > 0 ? "over" : "within";
const priceMessage = [
  ...minFailed.map((item) => `Line ${item.lineNo}: Unit Price ${item.unit_price} is below Min Price ${item.min_price}`),
  ...maxFailed.map((item) => `Line ${item.lineNo}: Unit Price ${item.unit_price} exceeds Max Price ${item.max_price}`),
].join("<br>");

// Distinct top-level item ids (digits only) for the internal-trading alias read
const itemIds = [...new Set(filtered.map((l) => String(l.item_id || "")).filter((id) => /^[0-9]{1,19}$/.test(id)))];
// The stored PO this save edits (Edit only: a Clone carries its source PO's id and line ids)
const rawId = a.page_status == "Edit" ? String(a.id || "").trim() : "";

return {
  docNo: docNo,
  draftRequiredFields: draftRequiredFields,
  draftRequiredEntry: draftRequiredEntry,
  requiredFields: requiredFields,
  requiredEntry: requiredEntry,
  lineItem: JSON.stringify(qtyRows),
  itemFields: "item_id,item_name,item_desc",
  quantityFields: "quantity",
  lineCount: filtered.length,
  savedLines: savedLines,
  piConfirm: piNeedConfirm ? 405 : 0,
  piGateOut: {
    pi_confirm: piNeedConfirm ? 405 : 0,
    msg: piNeedConfirm ? "This PO has 0 total amount. Do you wish to continue to create PI?" : "",
  },
  approvalData: {
    po_status: a.po_status,
    previous_status: a.previous_status,
    preq_id: a.preq_id,
    purchase_order_no: docNo,
    min_price_result: minPriceResult,
    max_price_result: maxPriceResult,
    amount_result: amountResult,
  },
  minPriceResult: minPriceResult,
  maxPriceResult: maxPriceResult,
  priceMessage: priceMessage,
  itemIdCsv: itemIds.length ? itemIds.join(",") : "0",
  poIdSql: /^[0-9]{1,19}$/.test(rawId) ? rawId : "0",
};
