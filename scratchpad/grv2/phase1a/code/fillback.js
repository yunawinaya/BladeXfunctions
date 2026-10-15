let updatedLineItem = [];
// The record Add Data / Update Data write, built from the payload once. Draft: every row + the draft marker. Issued:
// the rows Filter unnecessary line kept + the issued marker; when approval is needed, the header fields CHECK_APPROVAL
// handed back (it may have knocked the PO back to Draft, and it carries approval_condition) overlay it.
const a = {{workflowparams:allData}} || {};
const pre = {{node:code_pre.data.approvalData}} || {};
const needApproval = {{node:wf_check_approval.data.needApproval}};
const approved = {{node:wf_check_approval.data.data}};
let entry;
if (a.po_status == "Draft") {
  entry = { ...a, purchase_order_no: {{node:code_pre.data.docNo}} };
} else {
  entry = {
    ...a,
    purchase_order_no: {{node:code_pre.data.docNo}},
    table_po: (a.table_po || []).filter((item) => (item.item_name || item.item_desc || item.item_id) && item.quantity > 0),
    min_price_result: pre.min_price_result,
    max_price_result: pre.max_price_result,
    amount_result: pre.amount_result,
  };
  if (needApproval == "Yes" && approved && typeof approved === "object") Object.assign(entry, approved);
}

// The form sends back whatever approval_condition it loaded. Only the copy CHECK_APPROVAL
// just worked out is current; anything else (draft, no approval needed) is cleared.
if (needApproval != "Yes") {
  entry.approval_condition = {};
}

// table_po is written as one array, so the columns other flows own are taken from the stored line (read just now),
// never from the form: received_qty / created_received_qty (Goods Receiving), invoice_qty (Purchase Invoice),
// return_quantity / created_return_qty (Purchase Return). A line without a stored row (Add / Clone, a new line) keeps the
// form's values.
const stored = {};
let storedPoStatus = "";
const ownedRows = [{{node:sql_po_owned.data}}][0];
if (a.page_status == "Edit") {
  for (const r of Array.isArray(ownedRows) ? ownedRows : ownedRows ? [ownedRows] : []) {
    storedPoStatus = r.head_po_status || storedPoStatus;
    if (r.id !== undefined && r.id !== null && r.id !== "") stored[String(r.id)] = r;
  }
}
const dbNum = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const storedOf = (line) => (line && line.id !== undefined && line.id !== null && line.id !== "" ? stored[String(line.id)] : null);
const ownedFromDb = (line) => {
  const s = storedOf(line);
  if (!s) return line;
  return { ...line, received_qty: dbNum(s.received_qty), created_received_qty: dbNum(s.created_received_qty), invoice_qty: dbNum(s.invoice_qty),
    return_quantity: dbNum(s.return_quantity), created_return_qty: dbNum(s.created_return_qty) };
};
// line_status of a stored line: Goods Receiving moves it to Processing / Completed and a revert back to Issued, so the stored
// value decides (the form's copy may predate either); saved as Issued, a Draft / Issued line is Issued
const lineStatusOf = (line, fallback) => {
  const s = storedOf(line);
  if (!s) return fallback;
  if (s.line_status === "Processing" || s.line_status === "Completed") return s.line_status;
  if (entry.po_status === "Issued" && (!s.line_status || s.line_status === "Draft" || s.line_status === "Issued")) return "Issued";
  return fallback;
};

// alt_uom is re-stringified on every form load, so it grows with each save; it is kept as one JSON layer with the
// four keys Goods Receiving reads (alt_uom_id, alt_qty, base_qty, base_uom_id)
const altUom = (v) => {
  if (v === undefined || v === null || v === "") return v;
  try {
    let x = v;
    for (let i = 0; i < 64 && typeof x === "string"; i++) x = JSON.parse(x);
    const keep = (c) => (c && typeof c === "object" ? { alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id } : c);
    return JSON.stringify(Array.isArray(x) ? x.map(keep) : keep(x));
  } catch (e) {
    return v;
  }
};

// Header fields shared by every line, parent and child alike
const commonFields = {
  supplier_id: entry.po_supplier_id || "",
  plant_id: entry.po_plant || "",
  payment_term_id: entry.po_payment_terms || "",
  shipping_preference_id: entry.po_shipping_preference || "",
  billing_state_id: entry.billing_address_state || "",
  billing_country_id: entry.billing_address_country || "",
  shipping_state_id: entry.shipping_address_state || "",
  shipping_country_id: entry.shipping_address_country || "",
  organization_id: entry.organization_id,
  po_created_by: {{global:nickname}},
};

const round8 = (value) => Math.round((parseFloat(value) || 0) * 100000000) / 100000000;

const formatLine = (formLine) => {
  const poLineItem = ownedFromDb(formLine);
  const receivedQty = poLineItem.received_qty === null || poLineItem.received_qty === undefined || poLineItem.received_qty === '' ? 0 : parseFloat(poLineItem.received_qty);

  const out = {
    ...poLineItem,
    quantity: round8(poLineItem.quantity),
    unit_price: round8(poLineItem.unit_price),
    gross: round8(poLineItem.gross),
    discount: round8(poLineItem.discount),
    discount_amount: round8(poLineItem.discount_amount),
    tax_amount: round8(poLineItem.tax_amount),
    po_amount: round8(poLineItem.po_amount),
    min_price: round8(poLineItem.min_price),
    max_price: round8(poLineItem.max_price),
    received_qty: round8(receivedQty),
    outstanding_quantity: Math.max(0, round8((parseFloat(poLineItem.quantity) || 0) - receivedQty)),
    item_category_id: poLineItem.item_category_id || "",
    po_expected_date: poLineItem.po_expected_date ?? entry.po_expected_date,
  };
  if ("alt_uom" in poLineItem) out.alt_uom = altUom(poLineItem.alt_uom);
  return out;
};

for (const [index, poLineItem] of entry.table_po.entries()) {
  const lineStatus =
    !poLineItem.line_status ||
    poLineItem.line_status === "" ||
    poLineItem.line_status === "Draft"
      ? entry.po_status
      : poLineItem.line_status;

  const formattedItem = {
    ...formatLine(poLineItem),
    ...commonFields,
    line_index: index + 1,
    line_status: lineStatusOf(poLineItem, lineStatus),

    // If got child, give it the same formatting and header fields
    ...(Array.isArray(poLineItem.children) && {
      children: poLineItem.children.map((child, childIndex) => ({
        ...formatLine(child),
        ...commonFields,
        line_index: `${index + 1}/${childIndex + 1}`,
        line_status: lineStatusOf(child, lineStatus),
      })),
    }),
  };

  updatedLineItem.push(formattedItem);
}

entry.partially_received = !entry.partially_received || entry.partially_received === '' ? `0 / ${updatedLineItem.length}` : entry.partially_received;
entry.fully_received = !entry.fully_received || entry.fully_received === '' ? `0 / ${updatedLineItem.length}` : entry.fully_received;
entry.po_total_gross = round8(entry.po_total_gross);
entry.po_total_discount = round8(entry.po_total_discount);
entry.po_total_tax = round8(entry.po_total_tax);
entry.po_total = round8(entry.po_total);
entry.myr_total_amount = round8(entry.myr_total_amount);

entry.table_po = updatedLineItem;

// Goods Receiving moves an Issued PO to Processing / Completed: saving it as Issued (the form always asks for Issued) keeps
// that status. Lines above already took the requested status, so a new line still starts as Issued.
if (entry.po_status === "Issued" && (storedPoStatus === "Processing" || storedPoStatus === "Completed")) entry.po_status = storedPoStatus;

// Update Transaction Date: the items of the top-level lines (was Map Item IDs)
const itemIDs = [...new Set(updatedLineItem.filter((item) => item.item_id).map((item) => item.item_id))];

return { entry, itemIDs };
