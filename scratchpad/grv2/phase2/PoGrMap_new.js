const poRaw = {{node:search_node_PoGrGetAll.data.data}} || [];
const poIds = ({{workflowparams:po_ids}} || []).map(String);
const isMultiple = {{workflowparams:is_multiple}} === "multiple" ? 1 : 0;
const plantID = {{workflowparams:plant_id}} || null;
// The page sends the user's name; the global nickname does not resolve inside a workflow.
const receivedBy = {{workflowparams:received_by}} || "";

// A relation column can come back as an object rather than an id.
const referenceId = (value) => {
  if (value && typeof value === "object") return value.id || null;
  return value || null;
};

const toNumber = (value) => parseFloat(value) || 0;

const q8 = (value) => Number(toNumber(value).toFixed(8));

// Received date in Malaysia time. toISOString() alone is UTC, a day early before 08:00.
const grDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

const FULLY_RECEIVED =
  "All line items in the selected PO(s) are fully received. No items to convert to GR.";

const result = (resultCode, message, extra = {}) => ({
  result_code: resultCode,
  message,
  is_multiple: isMultiple,
  grData: null,
  grList: [],
  skipped: [],
  organization_id: "",
  ...extra,
});

// The POs in the order the user selected them.
const allPOs = (Array.isArray(poRaw) ? poRaw : [poRaw])
  .filter(Boolean)
  .sort((a, b) => poIds.indexOf(String(a.id)) - poIds.indexOf(String(b.id)));

// The list page only offers Issued and Processing orders; this re-checks them
// against the database in case one changed after the page loaded.
const poList = allPOs.filter(
  (po) => po.po_status === "Issued" || po.po_status === "Processing",
);

if (poList.length === 0) {
  return result(
    402,
    "No selected records are available for conversion. Please select records with status 'Issued' or 'Processing'.",
  );
}

if (!isMultiple && poList.length > 1) {
  const suppliers = new Set(
    poList.map((po) => String(referenceId(po.po_supplier_id) || "")),
  );

  if (suppliers.size > 1) {
    return result(
      405,
      "Selected POs contain multiple suppliers. Create individual goods receipts - one GR per PO?",
    );
  }
}

// ==========================================================================
// ITEM BUNDLES
// --------------------------------------------------------------------------
// A bundle is one PO line with its items beneath it, and the GR keeps that
// shape: the bundle is received as a single line with its items under
// `children`. table_po arrives either nested or as flat rows pointing back
// through parent_id, so both are read into one list with each bundle's items
// directly after their bundle.
// ==========================================================================
const flattenPoLines = (lines) => {
  const rows = lines || [];

  // Flat rows grouped by parent once (O(1) lookups, not a scan per line).
  const flatChildren = new Map();
  rows.forEach((row) => {
    if (
      row.parent_id === undefined ||
      row.parent_id === null ||
      row.parent_id === ""
    ) {
      return;
    }
    const parentKey = String(row.parent_id);
    if (!flatChildren.has(parentKey)) flatChildren.set(parentKey, []);
    flatChildren.get(parentKey).push(row);
  });

  const childrenOf = (line) => {
    const nested = Array.isArray(line.children) ? line.children : [];
    if (nested.length > 0) return nested;

    return flatChildren.get(String(line.id)) || [];
  };

  const claimed = new Set();

  rows.forEach((line) => {
    childrenOf(line).forEach((child) => {
      if (child && child.id !== undefined && child.id !== null) {
        claimed.add(String(child.id));
      }
    });
  });

  const flat = [];

  rows.forEach((line) => {
    if (claimed.has(String(line.id))) return;

    flat.push({ line: line, parentId: null });

    childrenOf(line).forEach((child) => {
      flat.push({ line: child, parentId: String(line.id) });
    });
  });

  return flat;
};

const mapLineItem = (item, po) => ({
  item_id: referenceId(item.item_id),
  item_name: item.item_name,
  item_desc: item.item_desc,
  more_desc: item.more_desc,
  ordered_qty: item.quantity,
  ordered_qty_uom: referenceId(item.quantity_uom),
  to_received_qty_uom: referenceId(item.quantity_uom),
  // Ordered less received, less what Created GRs already hold (as GRaddBatchLineItem.js).
  received_qty: Math.max(
    0,
    q8(
      toNumber(item.quantity) -
        toNumber(item.received_qty) -
        toNumber(item.created_received_qty),
    ),
  ),
  item_uom: referenceId(item.quantity_uom),
  line_po_no: po.purchase_order_no,
  initial_received_qty: q8(item.received_qty),
  line_po_id: po.id,
  unit_price: item.unit_price,
  total_price: item.po_amount,
  line_remark_1: item.line_remark_1,
  line_remark_2: item.line_remark_2,
  po_line_item_id: item.id,
  item_bundle_id: referenceId(item.item_bundle_id),
  item_category_id: referenceId(item.item_category_id),
  tariff_id: referenceId(item.tariff_id),
  further_description: item.further_description,
  project_id: referenceId(item.project_id),
});

// A line already received in full is left out, and a bundle line left out
// takes its items with it.
const buildGrLines = (po) => {
  const lines = [];
  const rowByPoLine = {};

  for (const entry of flattenPoLines(po.table_po)) {
    if (entry.parentId) {
      const parentRow = rowByPoLine[entry.parentId];
      if (!parentRow) continue;
      if (!Array.isArray(parentRow.children)) parentRow.children = [];

      parentRow.children.push(mapLineItem(entry.line, po));
      continue;
    }

    if (toNumber(entry.line.received_qty) >= toNumber(entry.line.quantity)) continue;

    const row = mapLineItem(entry.line, po);
    lines.push(row);
    rowByPoLine[String(entry.line.id)] = row;
  }

  return lines;
};

const mapHeaderData = (record, pos, lines) => ({
  gr_status: "Draft",
  plant_id: plantID,
  purchase_order_number: pos.map((po) => po.purchase_order_no).join(", "),
  po_id: pos.map((po) => po.id),
  gr_no: "",
  gr_no_type: "",
  gr_date: grDate,
  organization_id: record.organization_id,
  supplier_name: referenceId(record.po_supplier_id),
  currency_code: record.po_currency,
  gr_received_by: receivedBy,
  table_gr: lines,
  project_id: referenceId(record.project_id),
  from_convert: "Yes",
  gr_remark1: record.po_remark,
  gr_remark2: record.po_remark2,
  gr_remark3: record.po_remark3,
  gr_remark4: record.po_remark4,
  gr_remark5: record.po_remark5,
});

const organizationId = String(poList[0].organization_id || "");

if (isMultiple) {
  const grList = [];
  const skipped = [];

  for (const po of poList) {
    const lines = buildGrLines(po);

    if (lines.length === 0) {
      skipped.push(po.purchase_order_no);
      continue;
    }

    grList.push(mapHeaderData(po, [po], lines));
  }

  if (grList.length === 0) return result(402, FULLY_RECEIVED);

  return result(200, "", { grList, skipped, organization_id: organizationId });
}

let lines = [];

for (const po of poList) {
  lines = lines.concat(buildGrLines(po));
}

if (lines.length === 0) return result(402, FULLY_RECEIVED);

// One GR for every selected order, opened in the add form by the page.
return result(200, "", {
  grData: mapHeaderData(poList[0], poList, lines),
  organization_id: organizationId,
});
