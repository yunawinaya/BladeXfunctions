// SO Save V2 - shared helpers (included at the top of every code node by scripts/build-so-save-v2.mjs)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const soParse = (t) => {
  if (t && typeof t === "object") return t;
  try {
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
};
// "YYYY-MM-DD HH:MM:SS" (the DB clock, MYT on dev) + seconds
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// a request's fingerprint (not security): two FNV-1a lanes over the text, 16 hex
const soHash = function soHash(text) {
  const t = String(text);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2 * (i & 7)) >>> 0;
  }
  const h = (n) => ("0000000" + n.toString(16)).slice(-8);
  return h(a) + h(b);
};
// a SO's lines with their bundle children, as one list (children carry no `children` of their own here)
const soFlatLines = (rows) => list(rows).flatMap((r) => [r].concat(list(r.children)));
// the SAVE_SO job statuses that hold a sales order
const SO_JOB_OPEN = ["QUEUED", "PREPARING", "CASCADE_PREPARING", "AWAITING_CONFIRMATION", "READY_TO_COMMIT", "COMMITTING_SO", "RELEASING", "AFTER", "REQUIRES_REVIEW"];

// ---- lifted classic nodes (generated)
const __json = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
const __pick = function (o, path) { let v = o; for (const k of path) { if (v === undefined || v === null) return undefined; v = v[k]; } return v; };
const __V = function (tokens, SRC, P) {
  const V = {};
  for (const t of tokens) {
    const i = t.indexOf(":"); const kind = t.slice(0, i); const ref = t.slice(i + 1).split(".");
    if (kind === "workflowparams") V[t] = __json(__pick(P, ref));
    else if (kind === "node") V[t] = __json(__pick(SRC[ref[0]], ref[1] === "data" ? ref.slice(2) : ref.slice(1)));
    else V[t] = __json(__pick((P && P.__system) || {}, ref));
  }
  return V;
};
const __T_soX4 = ["workflowparams:allData"];
const soX4 = function (V) {
let entry = V["workflowparams:allData"];

if (
  entry.so_no_type !== -9999 &&
  (!entry.so_no ||
    entry.so_no === null ||
    entry.so_no === "" ||
    entry.previous_status == "Draft")
) {
  entry.so_no = 'issued'
}

if(!entry.need_cl || entry.need_cl === '' || entry.need_cl === null) {
  if(entry.acc_integration_type !== 'No Accounting') {
    entry.need_cl = 'required'
  } else {
    entry.need_cl = 'not required'
  }
}

return { entry };
};
const run_soX4 = function (SRC, P) { return __json(soX4(__V(__T_soX4, SRC, P))); };
const __T_soDraftNo = ["workflowparams:allData"];
const soDraftNo = function (V) {
let entry = V["workflowparams:allData"];

if(entry.so_no_type !== -9999 && (
  !entry.so_no || entry.so_no === null || entry.so_no === ''
)) {
  entry.so_no = 'draft'
}

return { entry };
};
const run_soDraftNo = function (SRC, P) { return __json(soDraftNo(__V(__T_soDraftNo, SRC, P))); };
const __T_soFilter = ["node:code_node_X4j8BSXd.data.entry"];
const soFilter = function (V) {
let table = V["node:code_node_X4j8BSXd.data.entry"];

table.table_so = table.table_so.filter(item => (item.item_name || item.so_desc || item.item_id) && item.so_quantity > 0)

return { table };
};
const run_soFilter = function (SRC, P) { return __json(soFilter(__V(__T_soFilter, SRC, P))); };
const __T_soGate = ["node:get_node_rvjWbHBF.data.data","node:code_node_rPqQy5CD.data.table","workflowparams:allData","node:sql_node_CascadeDocs.data"];
const soGate = function (V) {
// Does this edit touch anything a delivery or a picking plan is holding? A cheap
// id-keyed diff, so an edit that only changed header fields never pays for the
// cascade call. code_node_rPqQy5CD has already dropped blank and zero-quantity
// lines, so a line the user cleared arrives here as a removal.
const prevRaw = V["node:get_node_rvjWbHBF.data.data"];
const nextTable = V["node:code_node_rPqQy5CD.data.table"];
const allData = V["workflowparams:allData"];
// no delivery and no picking plan names this order: SO_CASCADE would have nothing to do (no answer: call it as before)
const docsRaw = V["node:sql_node_CascadeDocs.data"];
const docs = Array.isArray(docsRaw) ? docsRaw[0] : docsRaw;
const linked = docs && docs.linked !== undefined && docs.linked !== null ? Number(docs.linked) : 1;

const before = Array.isArray(prevRaw) ? prevRaw[0] || {} : prevRaw || {};
const flat = (rows) =>
  (Array.isArray(rows) ? rows : []).flatMap((r) =>
    [r].concat(Array.isArray(r && r.children) ? r.children : [])
  );
const sid = (v) => String(v === null || v === undefined ? "" : v);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const prevLines = flat(before.table_so).filter((r) => r && r.id);
const nextLines = flat(nextTable && nextTable.table_so).filter((r) => r);
const nextById = {};
nextLines.forEach((r) => { if (r.id) nextById[sid(r.id)] = r; });

let needsCascade = 0;
prevLines.forEach((r) => {
  const after = nextById[sid(r.id)];
  if (!after) { needsCascade = 1; return; }
  if (sid(after.item_name) !== sid(r.item_name)) { needsCascade = 1; return; }
  // A unit change leaves so_quantity alone but restates it in a different unit, so the
  // base quantity the delivery and its picking hold moves by the conversion ratio.
  if (sid(after.so_item_uom) !== sid(r.so_item_uom)) { needsCascade = 1; return; }
  if (Math.abs(num(after.so_quantity) - num(r.so_quantity)) > 0.0005) { needsCascade = 1; return; }
  // Price reserves no stock, but the delivery and the plan cache the line's unit_price
  // and total_price and prorate their header total from them, so a price-only edit still
  // has to reach them. Money is 4dp, hence the tighter epsilon.
  if (Math.abs(num(after.so_item_price) - num(r.so_item_price)) > 0.00005) { needsCascade = 1; return; }
  if (Math.abs(num(after.so_amount) - num(r.so_amount)) > 0.00005) { needsCascade = 1; }
});

return {
  needsCascade: linked ? needsCascade : 0,
  soId: sid(before.id || allData.id),
  prevTableSo: linked ? before.table_so || [] : [],
  nextTableSo: linked ? (nextTable && nextTable.table_so) || [] : [],
  // The confirm answers ride inside allData, the way need_cl and create_si already do.
  confirmPickReversal: sid(allData.confirmPickReversal),
  raiseGdQty: sid(allData.raiseGdQty)
};

};
const run_soGate = function (SRC, P) { return __json(soGate(__V(__T_soGate, SRC, P))); };
const __T_soFill = ["workflowparams:allData.so_status","node:code_node_hVnUCBf3.data.entry","node:workflow_node_yxaOreDk.data.needApproval","node:workflow_node_yxaOreDk.data.data","node:code_node_rPqQy5CD.data.table","node:sql_node_PkItems.data","node:get_node_rvjWbHBF.data.data","node:workflow_node_CascadeA.data.soLineCounters"];
const soFill = function (V) {
// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
let updatedLineItem = [];
let entry = V["workflowparams:allData.so_status"] == 'Draft' ? V["node:code_node_hVnUCBf3.data.entry"] : V["node:workflow_node_yxaOreDk.data.needApproval"] == 'Yes' ? V["node:workflow_node_yxaOreDk.data.data"] : V["node:code_node_rPqQy5CD.data.table"];

// --- Packing + weight (mirrors SOchangeItem.buildPackingWeightData) ---
// Only populated for created_source outside Web / Mobile / Internal Trading;
// otherwise the gated SQL node never ran and this resolves to null.
const packingRowsRaw = V["node:sql_node_PkItems.data"];
const packingRows = Array.isArray(packingRowsRaw) ? packingRowsRaw : (packingRowsRaw ? [packingRowsRaw] : []);
// Get Packing Item Data hands back the two subforms as JSON_ARRAYAGG strings, so rebuild
// the shape buildPackingWeightData expects.
const parseSubform = (v) => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
};
const packingItems = packingRows.map((r) => ({
  id: r.id,
  net_weight: r.net_weight,
  table_packing_detail: parseSubform(r.packing_detail_json),
  table_uom_conversion: parseSubform(r.uom_conversion_json)
}));
const needsPacking = packingItems.length > 0;

// --- Authoritative line counters ---
// planned_qty and delivered_qty are owned by the delivery and the picking plan, not by
// this page. table_so is written as one whole array, so spreading the browser's copy
// puts a stale tab's numbers back over whatever they wrote. Take them from the SO as
// stored, overlaid with whatever the cascade just left behind.
const prevSoRaw = V["node:get_node_rvjWbHBF.data.data"];
const prevSo = Array.isArray(prevSoRaw) ? prevSoRaw[0] || null : prevSoRaw || null;
const cascadeCounters = V["node:workflow_node_CascadeA.data.soLineCounters"];

const flattenSo = (rows) =>
  (Array.isArray(rows) ? rows : []).flatMap((r) =>
    [r].concat(Array.isArray(r && r.children) ? r.children : [])
  );
const storedCounters = {};
flattenSo(prevSo && prevSo.table_so).forEach((r) => {
  if (r && r.id) storedCounters[String(r.id)] = r;
});
const cascadedCounters = {};
(Array.isArray(cascadeCounters) ? cascadeCounters : []).forEach((r) => {
  if (r && r.id) cascadedCounters[String(r.id)] = r;
});

// Both maps are empty on Add / Clone / Draft, where a row carries no id and nothing has
// been planned or delivered yet.
const lineCounters = (soLineItem) => {
  const key = soLineItem.id ? String(soLineItem.id) : "";
  const cascaded = key ? cascadedCounters[key] : null;
  const stored = key ? storedCounters[key] : null;
  const pick = (field) =>
    cascaded ? Number(cascaded[field]) || 0 : stored ? Number(stored[field]) || 0 : 0;
  // return_qty is owned by the sales return flows and is NOT part of what the
  // cascade hands back, so `pick` would read undefined off a cascade row and zero
  // the column on every cascaded save. Fall through to the stored value whenever
  // the field is simply absent, rather than trusting whichever map is non-null.
  const pickPresent = (field) => {
    if (cascaded && cascaded[field] !== null && cascaded[field] !== undefined)
      return Number(cascaded[field]) || 0;
    if (stored && stored[field] !== null && stored[field] !== undefined)
      return Number(stored[field]) || 0;
    return 0;
  };
  return {
    delivered: pick("delivered_qty"),
    planned: pick("planned_qty"),
    returned: pickPresent("return_qty"),
  };
};

// Owned by the MES production workflows, which write straight onto the line:
// CONFIRM_PROD_ORDER sets production_planned_qty, WO_SAVE sets it and production_status.
// so_quantity is only the starting point for a line nothing has ever planned against.
const productionFields = (soLineItem, storedMap) => {
  const stored = soLineItem.id ? storedMap[String(soLineItem.id)] : null;
  const planned = stored ? stored.production_planned_qty : soLineItem.production_planned_qty;
  const status = stored ? stored.production_status : soLineItem.production_status;
  const neverSet = planned === null || planned === undefined || planned === '';
  return {
    planned: parseFloat((neverSet ? soLineItem.so_quantity : planned) || 0),
    status: !status ? "Not Created" : status
  };
};

const getPackingDetail = (tpd, uom) => (!Array.isArray(tpd) || !tpd.length || !uom) ? null : (tpd.find((c) => String(c.uom_id) === String(uom)) || null);
const getBaseQty = (tuc, uom) => {
  if (!Array.isArray(tuc) || !tuc.length || !uom) return 1;
  const c = tuc.find((x) => String(x.alt_uom_id) === String(uom));
  return c && c.base_qty ? c.base_qty : 1;
};
const buildPackingWeightData = (item, uom, soQuantity) => {
  const pd = getPackingDetail(item.table_packing_detail, uom);
  const packingConversion = (pd && pd.quantity) || 1;
  const weightConversion = ((Number(item.net_weight) || 0) * getBaseQty(item.table_uom_conversion, uom));
  const qty = Number(soQuantity) || 0;
  return {
    packing_uom: (pd && pd.packing_uom_id) || '',
    packing_conversion: parseFloat(packingConversion || 0),
    packing_qty: (packingConversion ? q8(qty / packingConversion) : 0),
    weight_conversion: weightConversion,
    net_weight: q8(qty * weightConversion)
  };
};

// Header fields shared by every line, parent and child alike
const commonFields = {
  plant_id: entry.plant_name || "",
  customer_id: entry.customer_name || "",
  payment_term_id: entry.so_payment_term || "",
  sales_person_id: entry.so_sales_person || "",
  billing_state_id: entry.billing_address_state || "",
  billing_country_id: entry.billing_address_country || "",
  shipping_state_id: entry.shipping_address_state || "",
  shipping_country_id: entry.shipping_address_country || "",
  area_id: entry.so_area_id || "",
  organization_id: entry.organization_id,
  access_group: entry.access_group || [],
  agent_user_id: entry.so_agent_user_id || '',
};

const formatLine = (soLineItem) => {
  const counters = lineCounters(soLineItem);
  const production = productionFields(soLineItem, storedCounters);
  const formattedItem = {
    // Copy all existing properties
    ...soLineItem,

    // Apply number formatting to numeric fields
    unrestricted_qty: parseFloat(soLineItem.unrestricted_qty || 0),
    base_unrestricted_qty: parseFloat(soLineItem.base_unrestricted_qty || 0),
    so_quantity: parseFloat(soLineItem.so_quantity || 0),
    so_item_price: parseFloat(soLineItem.so_item_price || 0).toFixed(8),
    so_gross: parseFloat(soLineItem.so_gross || 0).toFixed(8),
    so_discount: parseFloat(soLineItem.so_discount || 0).toFixed(8),
    so_discount_amount: parseFloat(soLineItem.so_discount_amount || 0).toFixed(8),
    so_tax_amount: parseFloat(soLineItem.so_tax_amount || 0).toFixed(8),
    min_price: parseFloat(soLineItem.min_price || 0).toFixed(8),
    max_price: parseFloat(soLineItem.max_price || 0).toFixed(8),
    so_amount: parseFloat(soLineItem.so_amount || 0).toFixed(8),
    production_planned_qty: production.planned,
    production_status: production.status,
    // toFixed strings: both columns are decimal(_, 3) and a raw float trips multipleOf.
    delivered_qty: counters.delivered,
    planned_qty: counters.planned,
    // Owned by SR_SAVE. table_so is written as one whole array, so leaving it out
    // drops the column back to 0 on the next edit of the order.
    return_qty: counters.returned,
    // Clamped: over-delivery tolerance drives this negative, which the column rejects.
    outstanding_quantity: Math.max(0, q8(parseFloat(soLineItem.so_quantity || 0) - counters.delivered)),

    so_shipping_date: soLineItem.so_shipping_date ?? entry.so_shipping_date,
  };

  if (needsPacking && soLineItem.item_name) {
    const itemData = packingItems.find((d) => String(d.id) === String(soLineItem.item_name));
    if (itemData) {
      Object.assign(formattedItem, buildPackingWeightData(itemData, soLineItem.so_item_uom, soLineItem.so_quantity));
    }
  }

  return formattedItem;
};

for (const [index, soLineItem] of entry.table_so.entries()) {
  const lineStatus =
    !soLineItem.line_status ||
    soLineItem.line_status === '' ||
    soLineItem.line_status === 'Draft'
      ? entry.so_status === 'Processing' ? 'Issued' : entry.so_status
      : soLineItem.line_status;

  const formattedItem = {
    ...formatLine(soLineItem),
    ...commonFields,
    line_index: index + 1,
    line_status: lineStatus,

    // If got child, give it the same formatting and header fields
    ...(Array.isArray(soLineItem.children) && {
      children: soLineItem.children.map((child, childIndex) => ({
        ...formatLine(child),
        ...commonFields,
        line_index: `${index + 1}/${childIndex + 1}`,
        line_status: lineStatus,
      })),
    }),
  };

  updatedLineItem.push(formattedItem);
}

entry.need_cl = ''

entry.production_status = !entry.production_status || entry.production_status === '' ? 'Not Created' : entry.production_status;

entry.si_status = !entry.si_status || entry.si_status === '' ? 'Not Created' : entry.si_status;

// Owned by the sales return flows, which write straight onto the order: SR_SAVE
// sets sr_status, SRR_SAVE sets srr_status. The browser's copy is whatever the tab
// loaded, so a tab opened before a return was raised puts the pre-return value
// back over it. Read as stored; empty on Add, where there is no return yet.
entry.sr_status = prevSo ? prevSo.sr_status || '' : '';
entry.srr_status = prevSo ? prevSo.srr_status || '' : '';
entry.so_total_gross = parseFloat(entry.so_total_gross || 0).toFixed(8);
entry.so_total_discount = parseFloat(entry.so_total_discount || 0).toFixed(8);
entry.so_total_tax = parseFloat(entry.so_total_tax || 0).toFixed(8);
entry.so_total = parseFloat(entry.so_total || 0).toFixed(8);
entry.myr_total_amount = parseFloat(entry.myr_total_amount || 0).toFixed(8);


entry.table_so = updatedLineItem;

return { entry };

};
const run_soFill = function (SRC, P) { return __json(soFill(__V(__T_soFill, SRC, P))); };
const __T_cfNeed = ["node:code_node_BtxYhPym.data.entry.custom_fields_m07krnod","node:code_node_BtxYhPym.data.entry.table_so","node:code_node_BtxYhPym.data.entry.id"];
const cfNeed = function (V) {
// Custom fields this edit would blank: the payload left the header object, or a line's, out
const missing = (v) => v === undefined || v === null;
const flat = (rows) => {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    out.push(r);
    for (const c of Array.isArray(r.children) ? r.children : []) if (c && typeof c === "object") out.push(c);
  }
  return out;
};
const cf = [V["node:code_node_BtxYhPym.data.entry.custom_fields_m07krnod"]][0];
const lines = [V["node:code_node_BtxYhPym.data.entry.table_so"]][0];
const rawId = [V["node:code_node_BtxYhPym.data.entry.id"]][0];
const id = missing(rawId) ? "" : String(rawId).trim();
const lineKeys = ["custom_fields"];
const lineMiss = flat(lines).some((r) => lineKeys.some((k) => missing(r[k])));
return { need: /^[0-9]{1,20}$/.test(id) && (missing(cf) || lineMiss) ? "YES" : "NO", id: id };
};
const run_cfNeed = function (SRC, P) { return __json(cfNeed(__V(__T_cfNeed, SRC, P))); };
const __T_cfFill = ["node:code_node_BtxYhPym.data.entry.custom_fields_m07krnod","node:code_node_BtxYhPym.data.entry.table_so","node:get_node_CfStored1.data.data"];
const cfFill = function (V) {
// The stored custom fields for what this edit left out: the header as stored; each line by its id
const missing = (v) => v === undefined || v === null;
const flat = (rows) => {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    out.push(r);
    for (const c of Array.isArray(r.children) ? r.children : []) if (c && typeof c === "object") out.push(c);
  }
  return out;
};
const cf = [V["node:code_node_BtxYhPym.data.entry.custom_fields_m07krnod"]][0];
const lines = [V["node:code_node_BtxYhPym.data.entry.table_so"]][0];
const got = [V["node:get_node_CfStored1.data.data"]][0];
const stored = (Array.isArray(got) ? got[0] : got) || {};
const natKey = null;
const storedRows = flat(stored["table_so"]);
const sentIds = new Set(flat(lines).map((r) => (missing(r.id) ? "" : String(r.id))).filter((x) => x));
const byId = new Map(storedRows.filter((r) => !missing(r.id) && r.id !== "").map((r) => [String(r.id), r]));
const byKey = new Map();
if (natKey) {
  for (const r of storedRows) {
    if (sentIds.has(String(r.id))) continue;
    const k = missing(r[natKey]) ? "" : String(r[natKey]);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
}
const fill = (row) => {
  if (!row || typeof row !== "object") return row;
  let src = !missing(row.id) && row.id !== "" ? byId.get(String(row.id)) : undefined;
  if (!src && natKey) {
    const queue = byKey.get(missing(row[natKey]) ? "" : String(row[natKey]));
    if (queue && queue.length) src = queue.shift();
  }
  const add = {};
  if (src) for (const k of Object.keys(src)) if (k.indexOf("custom_fields") === 0 && missing(row[k]) && !missing(src[k])) add[k] = src[k];
  let next = Object.keys(add).length ? Object.assign({}, row, add) : row;
  if (Array.isArray(row.children)) next = Object.assign({}, next, { children: row.children.map(fill) });
  return next;
};
return { ok: "YES", cf: missing(cf) ? (missing(stored["custom_fields_m07krnod"]) ? null : stored["custom_fields_m07krnod"]) : cf, lines: Array.isArray(lines) ? lines.map(fill) : lines };
};
const run_cfFill = function (SRC, P) { return __json(cfFill(__V(__T_cfFill, SRC, P))); };
const __T_cfOut = ["node:code_node_CfFill1.data","node:code_node_BtxYhPym.data.entry.custom_fields_m07krnod","node:code_node_BtxYhPym.data.entry.table_so"];
const cfOut = function (V) {
// What the update writes: the payload's custom fields, or the stored ones where this edit left them out
const filled = [V["node:code_node_CfFill1.data"]][0];
if (filled && filled.ok === "YES") return { cf: filled.cf, lines: filled.lines };
const cf = [V["node:code_node_BtxYhPym.data.entry.custom_fields_m07krnod"]][0];
return { cf: cf === undefined ? null : cf, lines: [V["node:code_node_BtxYhPym.data.entry.table_so"]][0] };
};
const run_cfOut = function (SRC, P) { return __json(cfOut(__V(__T_cfOut, SRC, P))); };
const __T_soItemIds = ["node:code_node_BtxYhPym.data.entry.table_so"];
const soItemIds = function (V) {
const lineItem = V["node:code_node_BtxYhPym.data.entry.table_so"];

const uniqueItemIDs = [
  ...new Set(lineItem.filter((item) => item.item_name).map((item) => item.item_name))
];

return {
  itemIDs: uniqueItemIDs
}
};
const run_soItemIds = function (SRC, P) { return __json(soItemIds(__V(__T_soItemIds, SRC, P))); };
const SO_HEADER_EDIT = ["id","so_description","created_source","wa_number","wa_group","so_no","so_date","customer_name","plant_name","cust_billing_address","cust_shipping_address","so_payment_term","so_shipping_date","so_delivery_method","table_so","so_total_gross","so_total_discount","so_total_tax","so_total","so_sales_person","so_remarks","so_tnc","so_payment_details","shipping_address_line_4","shipping_postal_code","shipping_address_state","billing_address_fax","billing_address_code","shipping_address_code","shipping_address_fax","billing_address_city","billing_address_country","shipping_address_city","shipping_address_line_1","billing_address_state","shipping_address_line_3","billing_address_line_1","billing_address_line_3","billing_address_line_4","shipping_address_country","billing_postal_code","billing_address_line_2","shipping_address_line_2","so_currency","cs_shipping_date","ss_shippping_date","ss_est_arrival_date","cs_courier_company","cp_vehicle_number","delivery_method_text","ct_driver_contact_no","cp_driver_contact_no","ct_delivery_cost","ct_driver_name","cp_pickup_date","ct_est_delivery_date","ss_freight_charges","ct_vehicle_number","ss_shipping_company","ss_tracking_number","cp_driver_name","est_arrival_date","so_status","sqt_no","organization_id","si_posted_status","myr_total_amount","exchange_rate","tpt_vehicle_number","tpt_driver_contact_no","di_shipping_method","di_driver_name","di_ic_no","di_driver_contact_no","di_shipping_company","di_transport_name","di_vehicle_number","di_est_delivery_date","di_est_arrival_date","di_pickup_date","di_validity_of_collection","di_tracking_number","di_freight_charges","project_id","tpt_transport_name","ct_ic_no","tpt_ic_no","so_docno","total_gross_currency","exchange_rate_myr","total_amount_myr","exchange_rate_currency","total_tax_currency","total_discount_currency","total_amount_currency","cp_ic_no","validity_of_collection","cs_tracking_number","ss_shipping_method","partially_delivered","fully_delivered","sr_status","srr_status","so_ref_doc","cs_freight_charges","billing_attention","shipping_attention","shipping_address_phone","shipping_address_name","billing_address_name","billing_address_phone","overdue_inv_total_amount","last_sync_date","outstanding_balance","is_accurate","customer_credit_limit","overdue_limit","acc_integration_type","sqt_id","so_created_by","cust_po","so_remarks2","so_remarks3","cust_po_date","access_group","price_tag_id","to_status","packing_status","so_no_type","previous_status","need_cl","posted_status","so_remarks5","so_remarks4","so_delivery_term","so_area_id","so_agent_user_id","tpt_driver_name","auto_si","auto_gd","so_type","create_si","approval_condition","custom_fields_m07krnod"];
const SO_HEADER_ADD = ["so_description","created_source","wa_number","wa_group","so_no","so_date","customer_name","plant_name","cust_billing_address","cust_shipping_address","so_payment_term","so_shipping_date","so_delivery_method","table_so","so_total_gross","so_total_discount","so_total_tax","so_total","so_sales_person","so_remarks","so_tnc","so_payment_details","shipping_address_line_4","shipping_postal_code","shipping_address_state","billing_address_city","billing_address_country","billing_address_fax","billing_address_code","shipping_address_code","shipping_address_fax","shipping_address_city","shipping_address_line_1","billing_address_state","shipping_address_line_3","billing_address_line_1","billing_address_line_3","billing_address_line_4","shipping_address_country","billing_postal_code","billing_address_line_2","shipping_address_line_2","so_currency","cs_shipping_date","ss_shippping_date","ss_est_arrival_date","cs_courier_company","cp_vehicle_number","delivery_method_text","ct_driver_contact_no","cp_driver_contact_no","ct_delivery_cost","ct_driver_name","cp_pickup_date","ct_est_delivery_date","ss_freight_charges","ct_vehicle_number","ss_shipping_company","ss_tracking_number","cp_driver_name","est_arrival_date","si_status","so_status","gd_status","sqt_no","organization_id","si_posted_status","myr_total_amount","exchange_rate","tpt_vehicle_number","tpt_driver_contact_no","di_shipping_method","di_driver_name","di_ic_no","di_driver_contact_no","di_shipping_company","di_transport_name","di_vehicle_number","di_est_delivery_date","di_est_arrival_date","di_pickup_date","di_validity_of_collection","di_tracking_number","di_freight_charges","project_id","tpt_transport_name","ct_ic_no","tpt_ic_no","so_docno","total_gross_currency","exchange_rate_myr","total_amount_myr","exchange_rate_currency","total_tax_currency","total_discount_currency","total_amount_currency","cp_ic_no","validity_of_collection","cs_tracking_number","ss_shipping_method","partially_delivered","fully_delivered","sr_status","srr_status","so_ref_doc","cs_freight_charges","billing_attention","shipping_attention","shipping_address_phone","shipping_address_name","billing_address_name","billing_address_phone","production_status","overdue_inv_total_amount","last_sync_date","outstanding_balance","is_accurate","customer_credit_limit","overdue_limit","acc_integration_type","sqt_id","so_created_by","cust_po","so_remarks2","so_remarks3","cust_po_date","access_group","price_tag_id","to_status","packing_status","so_no_type","previous_status","need_cl","posted_status","so_remarks5","so_remarks4","so_delivery_term","so_area_id","so_agent_user_id","tpt_driver_name","auto_si","auto_gd","so_type","create_si","approval_condition","custom_fields_m07krnod"];
const SO_LINE_FIELDS = ["id","sales_order_id","item_name","item_id","so_desc","more_desc","further_description","unrestricted_qty","base_unrestricted_qty","so_quantity","bundle_ratio","min_quantity","max_quantity","so_item_uom","so_item_price","so_gross","so_discount","so_discount_uom","so_discount_amount","so_tax_preference","so_tax_percentage","so_tax_amount","min_price","max_price","so_tax_inclusive","so_brand","so_packaging_style","so_amount","tariff_id","net_weight","weight_conversion","packing_qty","packing_uom","packing_conversion","delivered_qty","from_historical","planned_qty","outstanding_quantity","invoice_qty","posted_qty","production_qty","production_planned_qty","production_status","return_qty","line_remark_1","line_remark_2","line_remark_3","so_shipping_date","project_id","item_category_id","access_group","plant_id","sqt_id","sqt_line_id","sqt_created_by_id","customer_id","item_bundle_id","payment_term_id","sales_person_id","billing_state_Id","shipping_state_id","billing_country_id","shipping_country_id","area_id","agent_user_id","line_index","organization_id","line_status","si_status","packing_status","source_po_line_item_id","table_uom_conversion","packing_no","hu_no","custom_fields","create_user","create_dept","create_time","update_user","update_time","is_deleted","tenant_id","parent_id"];
// ---- SO Save V2 rules
// SO Save V2 - the column rules and the cell comparison shared by SO_SAVE_PREPARE and SO_SAVE_COMMIT (included by
// scripts/build-so-save-v2.mjs after common.js).

// written by other documents (handoff 6.1): never in the plan of an edit
const SO_HEADER_OWNED = ["gd_status", "si_status", "production_status", "sr_status", "srr_status", "posted_status", "si_posted_status", "partially_delivered", "fully_delivered",
  "to_status", "packing_status", "is_processing"];
const SO_HEADER_NUMBER = ["so_no", "so_no_type"]; // decided by COMMIT S0N from the stored record
const SO_LINE_OWNED = ["planned_qty", "delivered_qty", "invoice_qty", "posted_qty", "si_status", "return_qty", "production_planned_qty", "production_qty", "production_status",
  "packing_status", "packing_no", "hu_no"];
const SO_LINE_SYSTEM = ["id", "sales_order_id", "parent_id", "create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id"];

// A cell's comparable text: null / absent / "" alike; numbers by their decimal text (2300 = "2300.00000000", ids exact);
// JSON (objects, arrays, JSON text) by its key-sorted text. Two cells differ only when these differ; a spurious
// difference costs one write of the value classic would have written anyway.
const soCanonJson = function soCanonJson(v) {
  if (Array.isArray(v)) return "[" + v.map(soCanonJson).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + soCanonJson(v[k])).join(",") + "}";
  return soCanon(v);
};
const soCanon = function soCanon(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return "J" + soCanonJson(v);
  const t = String(v).trim();
  const m = t.match(/^([-+]?)(\d+)(?:\.(\d*))?$/);
  if (m) {
    const int = m[2].replace(/^0+(?=\d)/, "");
    const frac = (m[3] || "").replace(/0+$/, "");
    const body = int + (frac ? "." + frac : "");
    return (m[1] === "-" && body !== "0" ? "-" : "") + body;
  }
  if (/^[\[{]/.test(t)) {
    try {
      return "J" + soCanonJson(JSON.parse(t));
    } catch (e) {
      /* plain text */
    }
  }
  return t;
};
const soSame = (a, b) => soCanon(a) === soCanon(b);

// ---- SO_SAVE_PREPARE
// SO_SAVE_PREPARE phase SO (PREPARE-A) - the SO side of a queued save: the stored request applied through classic SO_SAVE's
// own line computation (lifted), then a cell-level write plan against the stored SO, stored as parts for SO_SAVE_COMMIT.
// Nothing here writes the sales order. The lifted classic nodes (run_<name>, see scripts/build-so-save-v2.mjs):
//   run_soX4 code_node_X4j8BSXd, run_soDraftNo code_node_hVnUCBf3, run_soFilter code_node_rPqQy5CD,
//   run_soGate code_node_CascadeGate, run_soFill code_node_BtxYhPym, run_cfNeed code_node_CfNeed1,
//   run_cfFill code_node_CfFill1, run_cfOut code_node_CfOut1, run_soItemIds code_node_JYYVm92x.
// Generated above this file by the build: SO_HEADER_EDIT / SO_HEADER_ADD (the live update / add node props) and
// SO_LINE_FIELDS (the line table's schema fields); rules.js: the column rules and soCanon / soSame.

const SO_PLAN_OPS = 250; // line ops per plan part

// the job's prepared_payload.stage -> the step this call runs ("" = a fresh job: the SO plan)
const SO_PREP_STEPS = ["SO", "CASCADE", "ALLOC", "PAYLOAD"];

const soPrepBase = function soPrepBase() {
  return { route: "", code: "", message: "", reason: "", tenantId: "0", jobIdSql: "0", rowVersion: -1, phase: "", nonce: "" };
};

// Guard: the worker's call. inp: { jobId, rowVersion, phase, tenantId, uuid }.
const soPrepareGuard = function soPrepareGuard(inp) {
  const out = soPrepBase();
  out.nonce = s(inp.uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
  const reject = (why) => Object.assign(out, answer("REJECT", "400", why));
  if (!digits(inp.tenantId)) return reject("no session tenant");
  out.tenantId = s(inp.tenantId);
  if (!digits(inp.jobId)) return reject("job_id: digits");
  out.jobIdSql = s(inp.jobId);
  if (!/^[0-9]{1,9}$/.test(s(inp.rowVersion))) return reject("row_version: the worker's claim");
  out.rowVersion = Number(s(inp.rowVersion));
  // the step comes from the job (prepared_payload.stage); a phase given must match it
  out.phase = s(inp.phase).toUpperCase();
  if (out.phase && SO_PREP_STEPS.indexOf(out.phase) < 0) return reject("phase must be one of " + SO_PREP_STEPS.join(", ") + " (or empty)");
  if (!out.nonce) return reject("no run nonce");
  return Object.assign(out, answer("GO", "", ""));
};

// Gate: the job and its SO as stored. GO only for this job's claim (PREPARING at the caller's row version), an edit's SO
// still flagged under this job's lock, and what the step reads present (the request parts; the cascade parts). Not our
// claim -> STOP, nothing written. step: what this call runs, from prepared_payload.stage.
const soPrepareGate = function soPrepareGate(guard, factRows) {
  const f = list(factRows)[0] || {};
  const rp = soParse(f.request_payload) || {};
  const pp = soParse(f.prepared_payload) || {};
  const stage = s(pp.stage);
  const out = { route: "STOP", code: "409", message: "", reason: "", dbNow: s(f.db_now), jobId: s(f.job_id), soId: "0", isEdit: "NO", requestNonce: "", parts: 0,
    organizationId: digits(f.organization_id) ? s(f.organization_id) : "0", needJob: "NO", needUnlock: "NO", jobRows: [], unlockRows: [], stage: stage,
    step: stage === "" ? "SO" : stage, preparedPayload: s(f.prepared_payload), cRef: "", xRef: "" };
  if (!s(f.job_id)) return Object.assign(out, { code: "404", message: "Save job not found" });
  if (s(f.job_status) !== "PREPARING" || num(f.row_version) !== guard.rowVersion) {
    return Object.assign(out, { message: "Not this worker's claim (job " + s(f.job_status) + ", row version " + num(f.row_version) + ")", reason: "claim" });
  }
  out.isEdit = s(f.correlation_id).indexOf("SO|") === 0 ? "YES" : "NO";
  out.requestNonce = s(rp.nonce);
  out.parts = num(rp.parts);
  const fail = (code, why, unlock) => Object.assign(out, {
    route: "FAIL", code: "500", message: why, reason: code, needJob: "YES", needUnlock: unlock ? "YES" : "NO", unlockRows: unlock ? [{ id: out.soId, is_processing: 0 }] : [],
    jobRows: [{ id: out.jobId, job_status: "FAILED", progress_percent: 100, progress_message: "Not saved: " + why, prepared_payload: "", error_code: code, error_message: why,
      finished_at: out.dbNow }] });
  if (SO_PREP_STEPS.indexOf(out.step) < 0) return Object.assign(out, { message: "Nothing to prepare (stage " + stage + ")", reason: "stage" });
  if (guard.phase && guard.phase !== out.step) return Object.assign(out, { message: "The job is at step " + out.step + ", not " + guard.phase, reason: "phase" });
  if (out.isEdit === "YES") {
    out.soId = (s(f.correlation_id).match(/^SO\|([0-9]+)$/) || [])[1] || "0";
    if (!s(f.so_id)) return fail("SOV2_NO_SO", "the sales order no longer exists", false);
    // the lock is ours only while the SO's latest LOCK row names this job; anything else is a writer we do not know
    if (num(f.is_processing) !== 1 || s(f.lock_ref) !== s(f.idempotency_key)) {
      return Object.assign(out, { route: "STOP", code: "409", message: "The sales order's lock is not this job's", reason: "lock" });
    }
  }
  // the nonce goes into SQL text: SUBMIT wrote it alphanumeric
  if (!/^[0-9A-Za-z]{1,24}$/.test(out.requestNonce) || !out.parts || num(f.part_rows) !== out.parts) {
    return fail("SOV2_PARTS", "the stored request is incomplete (" + num(f.part_rows) + " of " + out.parts + " parts)", out.isEdit === "YES");
  }
  if (out.step !== "SO" && out.isEdit !== "YES") return fail("SOV2_PARTS", "a new sales order has no deliveries to change", false);
  // the cascade parts' refs go into SQL text too
  const ref = (v, k) => (new RegExp("^" + k + "\\|[0-9A-Za-z]{1,24}$").test(s(v)) ? s(v) : "");
  out.cRef = ref(pp.cRef, "SOC");
  out.xRef = ref(pp.xRef, "SOX");
  if ((out.step === "ALLOC" || out.step === "PAYLOAD") && !out.cRef) return fail("SOV2_PARTS", "the delivery plan of this save is missing", true);
  return Object.assign(out, { route: "GO", code: "", message: "" });
};

// The request as SUBMIT stored it: R|000 the header, R|001... the top-level lines in order; the answers ride in allData
// the way classic takes them (need_cl and create_si already do).
const soPrepareAllData = function soPrepareAllData(partRows, answers) {
  const rows = list(partRows).slice().sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
  const head = soParse((rows[0] || {}).result_ref) || {};
  const lines = [];
  for (const r of rows.slice(1)) for (const l of list(soParse(r.result_ref))) lines.push(l);
  const a = answers || {};
  const allData = Object.assign({}, head, { table_so: lines });
  if (s(a.raiseGdQty)) allData.raiseGdQty = s(a.raiseGdQty);
  if (s(a.confirmPickReversal)) allData.confirmPickReversal = s(a.confirmPickReversal);
  return allData;
};

// Classic SO_SAVE's chain on the request, node for node (if_BA0MN7OZ: Draft or not; if_nvqMTmNn: an Issue edit reads the
// stored SO and the cascade gate; if_yJor3Xzv: an edit fills custom fields it left out). SRC holds each lifted node's
// output under its classic id, as the engine would. stored: the get-node record (an edit) or null.
const soPrepareNext = function soPrepareNext(allData, stored, docsRows, pkRows) {
  const P = { allData: allData };
  // a get-node's data: the record itself
  const getNode = { data: stored || null };
  const draft = allData.so_status == "Draft";
  const SRC = { workflow_node_yxaOreDk: { needApproval: "No" }, sql_node_PkItems: list(pkRows) };
  if (draft) SRC.code_node_hVnUCBf3 = run_soDraftNo({}, P);
  else {
    SRC.code_node_X4j8BSXd = run_soX4({}, P);
    SRC.code_node_rPqQy5CD = run_soFilter(SRC, P);
  }
  const issueEdit = !draft && s((SRC.code_node_rPqQy5CD.table || {}).page_status) === "Edit";
  if (issueEdit) {
    SRC.get_node_rvjWbHBF = getNode;
    SRC.sql_node_CascadeDocs = list(docsRows);
    SRC.code_node_CascadeGate = run_soGate(SRC, P);
  }
  SRC.code_node_BtxYhPym = run_soFill(SRC, P);
  if (s((SRC.code_node_BtxYhPym.entry || {}).page_status) === "Edit") {
    SRC.code_node_CfNeed1 = run_cfNeed(SRC, P);
    if (s(SRC.code_node_CfNeed1.need) === "YES") {
      SRC.get_node_CfStored1 = getNode;
      SRC.code_node_CfFill1 = run_cfFill(SRC, P);
    }
    SRC.code_node_CfOut1 = run_cfOut(SRC, P);
  }
  const next = Object.assign({}, SRC.code_node_BtxYhPym.entry);
  if (SRC.code_node_CfOut1) {
    next.table_so = SRC.code_node_CfOut1.lines;
    next.custom_fields_m07krnod = SRC.code_node_CfOut1.cf;
  }
  return { P: P, SRC: SRC, next: next, issueEdit: issueEdit, needsCascade: issueEdit ? num(SRC.code_node_CascadeGate.needsCascade) : 0 };
};

// Plan: classic's computation on the request, then the cells that differ from the stored SO.
// storedData: get_node_SPso's data (an edit), pkRows: the packing items, docsRows: the linked-documents flag.
const soPreparePlan = function soPreparePlan(guard, gate, partRows, factRows, storedData, docsRows, pkRows) {
  const f = list(factRows)[0] || {};
  const rp = soParse(f.request_payload) || {};
  const edit = gate.isEdit === "YES";
  const out = { route: "PLAN", code: "200", message: "", reason: "", planRows: [], jobRows: [], needUnlock: "NO", unlockRows: [], stage: "", planRef: "", planParts: 0,
    headerCells: 0, lineUpdates: 0, lineInserts: 0, lineDeletes: 0, needsCascade: 0 };
  const fail = (code, why) => Object.assign(out, {
    route: "FAIL", code: "500", message: why, reason: code, needUnlock: edit ? "YES" : "NO", unlockRows: edit ? [{ id: gate.soId, is_processing: 0 }] : [],
    jobRows: [{ id: gate.jobId, job_status: "FAILED", progress_percent: 100, progress_message: "Not saved: " + why, prepared_payload: "", error_code: code, error_message: why,
      finished_at: gate.dbNow }] });

  const allData = soPrepareAllData(partRows, rp.answers);
  const stored = edit ? (Array.isArray(storedData) ? storedData[0] : storedData) || null : null;
  if (edit && (!stored || s(stored.id) !== gate.soId)) return fail("SOV2_NO_SO", "the sales order could not be read");
  const run = soPrepareNext(allData, stored, docsRows, pkRows);
  const SRC = run.SRC;
  const P = run.P;
  const next = run.next;
  const needsCascade = run.needsCascade;

  // ---- the write plan
  const lineCols = SO_LINE_FIELDS.filter((c) => SO_LINE_SYSTEM.indexOf(c) < 0);
  const lineUpdCols = lineCols.filter((c) => SO_LINE_OWNED.indexOf(c) < 0);
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
  const header = { set: {}, before: {} };
  if (edit) {
    for (const c of SO_HEADER_EDIT) {
      if (c === "id" || c === "table_so" || SO_HEADER_OWNED.indexOf(c) >= 0 || SO_HEADER_NUMBER.indexOf(c) >= 0) continue;
      if (!has(next, c)) continue; // a key the request leaves out is never written
      if (soSame(next[c], stored[c])) continue;
      header.set[c] = next[c];
      header.before[c] = has(stored, c) ? stored[c] : null;
    }
  } else {
    for (const c of SO_HEADER_ADD) if (c !== "table_so" && has(next, c)) header.set[c] = next[c];
  }
  const storedLines = {};
  const storedOrder = [];
  for (const r of soFlatLines(stored ? stored.table_so : [])) {
    if (!s(r.id)) continue;
    storedLines[s(r.id)] = r;
    storedOrder.push(s(r.id));
  }
  const ops = [];
  const seen = {};
  const rowOf = (l, cols) => {
    const o = {};
    for (const c of cols) if (has(l, c)) o[c] = l[c];
    return o;
  };
  // a new SO (Add, Clone) inserts every line: a Clone's lines still carry the source SO's ids, which classic's insert
  // ignores too (new ids for the header and every line)
  const visit = (l, key, parentRef) => {
    const id = edit ? s(l.id) : "";
    if (id) {
      const was = storedLines[id];
      if (!was) return "a line of this sales order was removed by another save: reopen the sales order and save again";
      seen[id] = true;
      const set = {};
      const before = {};
      for (const c of lineUpdCols) {
        if (!has(l, c) || soSame(l[c], was[c])) continue;
        set[c] = l[c];
        before[c] = has(was, c) ? was[c] : null;
      }
      if (Object.keys(set).length) ops.push({ op: "U", id: id, set: set, before: before });
      return "";
    }
    ops.push({ op: "I", key: key, parent: parentRef, row: rowOf(l, lineCols) });
    return "";
  };
  const top = list(next.table_so);
  for (let i = 0; i < top.length; i++) {
    const key = "N" + (i + 1);
    const why = visit(top[i], key, "");
    if (why) return fail("SOV2_STALE", why);
    const parentRef = (edit ? s(top[i].id) : "") || key;
    const kids = list(top[i].children);
    for (let j = 0; j < kids.length; j++) {
      const w = visit(kids[j], key + "/" + (j + 1), parentRef);
      if (w) return fail("SOV2_STALE", w);
    }
  }
  for (const id of storedOrder) if (!seen[id]) ops.push({ op: "D", id: id, before: { is_deleted: 0, line_index: has(storedLines[id], "line_index") ? storedLines[id].line_index : null } });
  // pass B (classic code_node_CascadeB_Gate): an Issue edit adding an item line to a sales order a delivery or picking plan
  // names re-runs the cascade after the lines have ids; not in V2 yet (PLAN.md, COMMIT design) -> classic
  const docs = list(docsRows)[0];
  const linked = docs && docs.linked !== undefined && docs.linked !== null ? Number(docs.linked) : 1;
  if (SRC.code_node_CascadeGate && linked && ops.some((o) => o.op === "I" && s(o.row.item_name))) {
    return fail("SOV2_NOT_ELIGIBLE", "new lines on a sales order with deliveries: saved the classic way");
  }

  // ---- the parts
  // classic workflow_node_CIDWG583 (Issued): REORDER_SET_REDIS SO_ISSUED with previous_data = the stored table_so (an Issue
  // edit; else none) and latest_data = BtxYhPym's table_so. Its SO branch sums so_quantity by item + plant from five fields
  // of the top-level lines, so the lines whose five fields did not change add the same on both sides: only the others
  // are kept (the same deltas, a payload of the changed lines only).
  const five = (l) => ({ item_name: l.item_name, plant_id: l.plant_id, so_item_uom: l.so_item_uom, so_quantity: l.so_quantity, organization_id: l.organization_id });
  const prevTop = run.issueEdit ? list(stored && stored.table_so) : [];
  const latestTop = list(SRC.code_node_BtxYhPym.entry.table_so);
  const latestById = {};
  for (const l of latestTop) if (s(l.id)) latestById[s(l.id)] = l;
  const same = {};
  for (const l of prevTop) {
    const n = s(l.id) ? latestById[s(l.id)] : null;
    if (n && soCanonJson(five(l)) === soCanonJson(five(n))) same[s(l.id)] = true;
  }
  const reorder = { run: s(next.so_status) === "Issued" ? 1 : 0, prev: prevTop.filter((l) => !same[s(l.id)]).map(five),
    latest: latestTop.filter((l) => !same[s(l.id)]).map(five) };
  const after = {
    reorder: reorder,
    itemIds: list((run_soItemIds(SRC, P) || {}).itemIDs).map(String),
    sqtId: next.sqt_id === undefined ? null : next.sqt_id,
    soStatus: s(next.so_status),
    autoSi: num(next.auto_si),
    createSi: s(next.create_si),
    salesOrderTitle: s(allData.sales_order_title),
    needsCascade: needsCascade,
  };
  const head = { v: 1, mode: edit ? "EDIT" : "ADD", jobId: gate.jobId, soId: gate.soId, saveAs: s(rp.save_as), set: header.set, before: header.before,
    number: { so_no: next.so_no === undefined ? null : next.so_no, so_no_type: next.so_no_type === undefined ? null : next.so_no_type,
      stored_so_no: stored ? s(stored.so_no) : "", stored_so_status: stored ? s(stored.so_status) : "", stored_so_no_type: stored ? s(stored.so_no_type) : "" },
    // the lines the plan was made against: COMMIT S0 requires exactly these, S2 tells its own inserts from them
    storedLineIds: storedOrder };
  const ref = "SOP|" + guard.nonce;
  const part = (name, obj) => ({ job_id: ref, organization_id: gate.organizationId, step_name: name, step_status: "PART", attempt_count: 0, result_ref: JSON.stringify(obj) });
  const rows = [part("H|000", head)];
  for (let i = 0; i < ops.length; i += SO_PLAN_OPS) rows.push(part("L|" + ("00" + (rows.length)).slice(-3), ops.slice(i, i + SO_PLAN_OPS)));
  rows.push(part("A|000", after));
  const count = (k) => ops.filter((o) => o.op === k).length;
  Object.assign(out, { planRows: rows, planRef: ref, planParts: rows.length, headerCells: Object.keys(header.set).length, lineUpdates: count("U"), lineInserts: count("I"),
    lineDeletes: count("D"), needsCascade: needsCascade, stage: needsCascade ? "CASCADE" : "COMMIT" });
  const summary = { v: 1, plan: ref, parts: rows.length, stage: out.stage, mode: head.mode, headerCells: out.headerCells, lineUpdates: out.lineUpdates, lineInserts: out.lineInserts,
    lineDeletes: out.lineDeletes, needsCascade: needsCascade };
  out.jobRows = [{ id: gate.jobId, job_status: needsCascade ? "PREPARING" : "READY_TO_COMMIT", progress_percent: needsCascade ? 20 : 30,
    progress_message: needsCascade ? "Checking the deliveries of this sales order" : "Ready to save", prepared_payload: JSON.stringify(summary), error_code: "", error_message: "",
    finished_at: null }];
  out.message = out.jobRows[0].progress_message;
  return out;
};

// Result: whichever node ended the run.
const soPrepareResult = function soPrepareResult(guard, gate, src) {
  const g = gate || {};
  const r = src || {};
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(g.jobId || guard.jobIdSql), job_status: "", stage: s(r.stage),
    plan_ref: s(r.planRef), plan_parts: String(num(r.planParts)), header_cells: String(num(r.headerCells)), line_updates: String(num(r.lineUpdates)),
    line_inserts: String(num(r.lineInserts)), line_deletes: String(num(r.lineDeletes)), needs_cascade: String(num(r.needsCascade)), evidence: "" };
  const jr = list(r.jobRows)[0];
  out.job_status = jr ? s(jr.job_status) : "";
  out.evidence = JSON.stringify({ v: 1, workflow: "SO_SAVE_PREPARE", phase: s(guard.phase), route: out.route, code: out.code, reason: out.reason, stage: out.stage });
  return out;
};


// ---- this node
const res = soPreparePlan([{{node:code_node_SPguard.data}}][0], [{{node:code_node_SPgate.data}}][0], [{{node:sql_node_SPparts.data}}][0], [{{node:sql_node_SPjob.data}}][0], [{{node:get_node_SPso.data.data}}][0],
  [{{node:sql_node_SPdocs.data}}][0], [{{node:sql_node_SPpk.data}}][0]);
console.log("so prepare plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, stage: res.stage, parts: res.planParts, header: res.headerCells,
  updates: res.lineUpdates, inserts: res.lineInserts, deletes: res.lineDeletes }));
return res;