// SA V2 / SC Review V2 - the shared SC Review chain (CONTRACT.md section 16). Package A owns this file; B2 SUBMIT (the gate)
// and A PREPARE (the plan) both run it, so a review is built ONE way.
//
// Include order in a code node: lib/lift/runtime.js (__N, __run, __withContext), code/shared/sa_common.js (saS, saList,
// saRows, saQ8), then this file. No platform calls: every read arrives as SQL rows of code/shared/review_sql.py.
//
//   saReviewPrep({ scRecord, createAdjustment, organizationId })   -> { prep, ids }   (ids: the REVIEW_READS token lists)
//   saReviewChain({ scRecord, createAdjustment, organizationId, nickname, adjustmentDate, reads[, adapted] })
//       -> { prep, required, built, saDoc, scAfter, counts }
//          prep     = lifted code_review_prep over scRecord (the REQUEST's SC record, never SQL rows)
//          required = code_review_required's { required_fields, data } (the caller runs CHECK_REQUIRED_FIELD on it)
//          built    = code_review_build_sa's { stockAdjustmentDoc, hasError, errorMessage, hasLines }; null when the classic
//                     skips the build (prep.hasApprovedVariance !== 1)
//          saDoc    = built.stockAdjustmentDoc after code_node_O4tWJ5JH (pageStatus "Add", saveAs "Completed") and the
//                     <= 50-entry split; null when there is no build, a build error or no line
//          scAfter  = code_fillback(code_review_mark(prep)).entry (mark only when prep.doProcess === 1)
//          counts   = { lines, entries } of saDoc
//   saReviewAdapt(reads)  -> the context the classic build read: search-node / get-node / sql-node outputs
//   saReviewIds(prep)     -> { MID, LID, UID, BID, ORG } bare digit lists ("0" for none)
//   saSplitLines(doc)     -> doc with every line of more than SA_REVIEW_SPLIT entries split (exported for tests / B2)
//
// reads = { items, balances, batch_balances, bins, uoms, batches, costs, prefix }: the rows of the REVIEW_READS of the same
// name ({ j: "<JSON_OBJECT>" } sql rows or plain objects). The adapter rebuilds what the classic nodes handed the build, as
// recorded in STOCK_COUNT Review runs (test/prepare/test_review_golden.js, test_review_shape.py):
//   search-node rows  bigint ids / FKs as digit STRINGS; decimals as JS numbers (880.00000000 -> 880); int as numbers;
//                     datetimes 'YYYY-MM-DD HH:MM:SS.mmm' (no fraction when .000); NULL and '' keys ABSENT; a subform
//                     (Item's table_uom_conversion) an array of its rows (id order; [] when none) under the same rules
//   get_sa_prefix     { count, data }: ONE object when one rule, {} when none, an array (the read's order) when several
//   sql_review_costs  rows of text values (the node declares all seven columns string), a NULL column absent

const SA_REVIEW_SPLIT = 50;
const SA_REVIEW_NODES = { items: "search_item", balances: "search_item_balance", batch_balances: "search_item_batch_balance", bins: "search_bin_location",
  uoms: "search_uom", batches: "search_batch", costs: "sql_review_costs", prefix: "get_sa_prefix" };
// the decimal columns of each read (CAST AS CHAR in SQL; a code node receives BigDecimal values as numbers)
const SA_REVIEW_DECIMALS = { items: ["purchase_unit_price"], balances: ["balance_quantity", "unrestricted_qty", "block_qty", "qualityinsp_qty", "reserved_qty", "intransit_qty"],
  batch_balances: ["balance_quantity", "unrestricted_qty", "block_qty", "qualityinsp_qty", "reserved_qty", "intransit_qty"], bins: [], uoms: [], batches: [], costs: [], prefix: [] };
const SA_REVIEW_SUBFORMS = { items: { table_uom_conversion: ["alt_qty", "base_qty"] } };

const saReviewIdCmp = (a, b) => {
  const x = saS(a && a.id);
  const y = saS(b && b.id);
  return x.length !== y.length ? x.length - y.length : x < y ? -1 : x > y ? 1 : 0;
};
// one record as a code node receives it from a search / get node
const saReviewRecord = function saReviewRecord(row, decimals, subforms) {
  const o = {};
  for (const k of Object.keys(row || {})) {
    let v = row[k];
    if (subforms && subforms[k]) {
      const rows = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? saParseJ(v) : [];
      o[k] = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object").map((r) => saReviewRecord(r, subforms[k], null)).sort(saReviewIdCmp);
      continue;
    }
    if (v === null || v === undefined || v === "") continue;
    if (decimals.indexOf(k) >= 0) {
      const n = Number(v);
      v = isNaN(n) ? v : n;
    }
    o[k] = v;
  }
  return o;
};
const saReviewAdapt = function saReviewAdapt(reads) {
  const r = reads || {};
  const rows = (name) => saRows(r[name]).map((x) => saReviewRecord(x, SA_REVIEW_DECIMALS[name], SA_REVIEW_SUBFORMS[name] || null));
  const search = (list) => ({ data: { total: list.length, count: list.length, data: list } });
  const ctx = {};
  for (const name of ["items", "balances", "batch_balances", "bins", "uoms", "batches"]) ctx["node:" + SA_REVIEW_NODES[name]] = search(rows(name));
  // sql-node rows: the values as text, a NULL column absent
  ctx["node:sql_review_costs"] = { data: saRows(r.costs).map((x) => {
    const o = {};
    for (const k of Object.keys(x)) if (x[k] !== null && x[k] !== undefined) o[k] = typeof x[k] === "object" ? JSON.stringify(x[k]) : String(x[k]);
    return o;
  }) };
  // in the read's order (review_sql.py: the non-draft default first) - the build takes the first of several
  const rules = rows("prefix");
  ctx["node:get_sa_prefix"] = { data: { count: rules.length, data: rules.length === 0 ? {} : rules.length === 1 ? rules[0] : rules } };
  return ctx;
};
// the classic's own id lists (prep materialIds / locationIds / baseUomIds / batchIds, "0" when empty) as REVIEW_READS tokens
const saReviewIds = function saReviewIds(prep) {
  const p = prep || {};
  const list = (a) => {
    const ids = [];
    for (const v of saList(a)) {
      const t = saS(v);
      if (/^[0-9]{1,20}$/.test(t) && t !== "0" && ids.indexOf(t) < 0) ids.push(t);
    }
    return ids.length ? ids.join(",") : "0";
  };
  const org = saS(p.orgIdSql);
  return { MID: list(p.materialIds), LID: list(p.locationIds), UID: list(p.baseUomIds), BID: list(p.batchIds), ORG: /^[0-9]{1,20}$/.test(org) ? org : "0" };
};

// the build's adj_summary = `Total: <total> <base uom name>\nDETAILS:\n` + its details numbered "1. ".."n. " joined by "\n"
// (a detail is `<bin>: <qty> <uom> (UNR) - IN|OUT`, + `\n[<batch number>]`). Parsed back per entry, every detail checked
// against its entry, and the whole text recomposed exactly - anything else throws (the caller fails the plan).
const saAdjDetails = function saAdjDetails(line, entries) {
  const text = saS(line.adj_summary) === "" ? "" : String(line.adj_summary);
  const at = text.indexOf("\nDETAILS:\n");
  const head = "Total: " + String(line.total_quantity) + " ";
  if (at < 0 || text.slice(0, head.length) !== head) throw new Error("line " + saS(line.line_index) + ": its summary is not the build's (" + text.slice(0, 40) + ")");
  const uom = text.slice(head.length, at);
  const rest = text.slice(at + "\nDETAILS:\n".length);
  const n = entries.length;
  if (rest.slice(0, 3) !== "1. ") throw new Error("line " + saS(line.line_index) + ": its summary has no first detail");
  const starts = [3];
  let pos = 3;
  for (let k = 2; k <= n; k++) {
    const mark = "\n" + k + ". ";
    const i = rest.indexOf(mark, pos);
    if (i < 0) throw new Error("line " + saS(line.line_index) + ": its summary has " + (k - 1) + " details for " + n + " entries");
    starts.push(i + mark.length);
    pos = i + mark.length;
  }
  const details = [];
  for (let k = 0; k < n; k++) details.push(rest.slice(starts[k], k + 1 < n ? starts[k + 1] - ("\n" + (k + 2) + ". ").length : rest.length));
  details.forEach((d, i) => {
    const e = entries[i] || {};
    const tail = " (UNR) - " + String(e.movement_type || "").toUpperCase();
    const dirOk = d.slice(-tail.length) === tail || d.indexOf(tail + "\n[") >= 0;
    if (!dirOk || d.indexOf(": " + String(e.sa_quantity) + " ") < 0) throw new Error("line " + saS(line.line_index) + ": detail " + (i + 1) + " is not its entry's");
  });
  return { uom: uom, details: details };
};
// lines of more than SA_REVIEW_SPLIT entries -> ceil(n / 50) copies in order, each with its slice of balance_index,
// total_quantity = the build's sequential q8 sum of the slice, adj_summary rebuilt in the build's format; line_index renumbered
const saSplitLines = function saSplitLines(doc) {
  const out = [];
  for (const line of saList(doc && doc.stock_adjustment)) {
    let entries;
    try {
      entries = JSON.parse(saS(line.balance_index) || "[]");
    } catch (e) {
      throw new Error("line " + saS(line.line_index) + ": balance_index does not parse");
    }
    if (!Array.isArray(entries) || entries.length <= SA_REVIEW_SPLIT) {
      out.push(line);
      continue;
    }
    const det = saAdjDetails(line, entries);
    for (let at = 0; at < entries.length; at += SA_REVIEW_SPLIT) {
      const slice = entries.slice(at, at + SA_REVIEW_SPLIT);
      let total = 0;
      for (const e of slice) total = saQ8(total + e.sa_quantity);
      const d = det.details.slice(at, at + SA_REVIEW_SPLIT);
      out.push(Object.assign({}, line, { total_quantity: total, balance_index: JSON.stringify(slice),
        adj_summary: `Total: ${total} ${det.uom}\nDETAILS:\n${d.map((x, i) => `${i + 1}. ${x}`).join("\n")}` }));
    }
  }
  out.forEach((l, i) => {
    l.line_index = i + 1;
  });
  return Object.assign({}, doc, { stock_adjustment: out });
};

const saReviewPrep = function saReviewPrep(IN) {
  const ctx = { "workflowparams:allData": IN.scRecord, "workflowparams:createAdjustment": IN.createAdjustment, "workflowparams:organizationId": IN.organizationId };
  const prep = __withContext(ctx, () => __run("code_review_prep"));
  return { prep: prep, ids: saReviewIds(prep) };
};

const saReviewChain = function saReviewChain(IN) {
  const ctx = { "workflowparams:allData": IN.scRecord, "workflowparams:createAdjustment": IN.createAdjustment, "workflowparams:organizationId": IN.organizationId,
    "workflowparams:nickname": IN.nickname, "workflowparams:adjustmentDate": IN.adjustmentDate };
  const res = { prep: null, required: null, built: null, saDoc: null, scAfter: null, counts: { lines: 0, entries: 0 } };
  __withContext(ctx, () => {
    res.prep = __run("code_review_prep");
    res.required = __run("code_review_required");
    // if_has_approved_variance -> par_review_fetch -> code_review_build_sa
    if (Number(res.prep.hasApprovedVariance) === 1) {
      // IN.adapted (tests): node outputs as recorded, instead of the SQL rows' adaptation
      Object.assign(ctx, IN.adapted || saReviewAdapt(IN.reads));
      res.built = __run("code_review_build_sa");
    }
    // if_do_process -> code_review_mark; code_fillback reads mark's entry, else prep's (code_draft / issued / stockcount never ran)
    if (Number(res.prep.doProcess) === 1) __run("code_review_mark");
    res.scAfter = __run("code_fillback").entry || null;
  });
  const b = res.built;
  if (b && Number(b.hasError) !== 1 && Number(b.hasLines) === 1 && b.stockAdjustmentDoc) {
    const fill = __withContext({ "workflowparams:allData": b.stockAdjustmentDoc, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Add" },
      () => __run("code_node_O4tWJ5JH"));
    res.saDoc = saSplitLines(fill.allData);
    for (const l of res.saDoc.stock_adjustment) {
      res.counts.lines++;
      for (const e of JSON.parse(saS(l.balance_index) || "[]")) if (saQ8(e && e.sa_quantity) > 0) res.counts.entries++;
    }
  }
  return res;
};

// ==== BEGIN LIFTED BODIES (generated by lift/sync_review_chain.py from lift/review_lift.json - do not edit) ====
// GENERATED by scratchpad/sav2/lib/lift/lift.py from lift/review_lift.json (the shared SC Review chain): the classic STOCK_COUNT v10 review bodies + STOCK_ADJUSTMENT v24 fillbackHeaderFields, verbatim. Do not edit: run python3 lift/sync_review_chain.py.
// base/STOCK_COUNT.v10.json :: code_review_prep
__N["code_review_prep"] = { decl: [["entry", "any"], ["itemsWithVariance", "any"], ["doProcess", "any"], ["hasApprovedVariance", "any"], ["materialIds", "any"], ["locationIds", "any"], ["baseUomIds", "any"], ["batchIds", "any"], ["materialIdCsv", "string"], ["orgIdSql", "string"]], fn: function () {
const console = __QUIET;
let entry = __v("workflowparams:allData");
const createAdjustment = __v("workflowparams:createAdjustment");
entry.table_stock_count = (entry.table_stock_count || []).filter((item) => item.line_status !== "Cancel");

const totalItems = entry.table_stock_count.length;
const lockedItems = entry.table_stock_count.filter((item) => item.is_counted === 1).length;
entry.total_counted = `${lockedItems} / ${totalItems}`;

const totalSystemQty = entry.table_stock_count.reduce((sum, item) => sum + (parseFloat(item.system_qty) || 0), 0);
const totalVarianceQty = entry.table_stock_count.reduce((sum, item) => {
  const varianceQty = parseFloat(item.variance_qty) || 0;
  const adjustedQty = parseFloat(item.adjusted_qty);
  const actualVariance = (!isNaN(adjustedQty) && adjustedQty !== null && adjustedQty !== varianceQty) ? adjustedQty : varianceQty;
  return sum + actualVariance;
}, 0);
const variancePercentage = totalSystemQty > 0 ? Math.abs(totalVarianceQty / totalSystemQty) * 100 : 0;
entry.total_variance = `${variancePercentage.toFixed(2)}%`;
entry.organization_id = __v("workflowparams:organizationId");

const hasRecountItems = entry.table_stock_count.some((item) => item.line_status === "Recount");
const allApproved = entry.table_stock_count.every((item) => item.line_status === "Approved" || item.line_status === "Adjusted");

if (hasRecountItems) {
  entry.review_status = "Recount";
  entry.stock_count_status = "In Progress";
} else if (allApproved) {
  entry.review_status = "Completed";
  entry.stock_count_status = "Completed";
} else {
  entry.review_status = "In Review";
}

const approvedItems = entry.table_stock_count.filter((item) => item.review_status === "Approved" && item.line_status !== "Adjusted");
const itemsWithVariance = approvedItems.filter((item) => item.variance_qty !== 0 && item.line_status === "Approved");

const doProcess = (approvedItems.length > 0 && (allApproved || createAdjustment === "Yes")) ? 1 : 0;
const hasApprovedVariance = (doProcess === 1 && itemsWithVariance.length > 0) ? 1 : 0;

let materialIds = [...new Set(itemsWithVariance.map((i) => i.material_id))];
let locationIds = [...new Set(itemsWithVariance.map((i) => i.location_id))];
let baseUomIds = [...new Set(itemsWithVariance.map((i) => i.base_uom_id))];
let batchIds = [...new Set(itemsWithVariance.filter((i) => i.batch_id).map((i) => i.batch_id))];
if (materialIds.length === 0) materialIds = ["0"];
if (locationIds.length === 0) locationIds = ["0"];
if (baseUomIds.length === 0) baseUomIds = ["0"];
if (batchIds.length === 0) batchIds = ["0"];

const isDigits = (v) => /^[0-9]+$/.test(String(v == null ? "" : v).trim());
const materialIdCsv = materialIds.filter(isDigits).join(",");
const orgIdSql = isDigits(entry.organization_id) ? String(entry.organization_id).trim() : "0";

return { entry, itemsWithVariance, doProcess, hasApprovedVariance, materialIds, locationIds, baseUomIds, batchIds, materialIdCsv, orgIdSql };
} };
// base/STOCK_COUNT.v10.json :: code_review_required
__N["code_review_required"] = { decl: [["required_fields", "any"], ["data", "any"]], fn: function () {
const console = __QUIET;
return {
  required_fields: JSON.stringify([
    { name: "plant_id", label: "Plant" },
    { name: "count_type", label: "Count Type" },
    { name: "table_stock_count", label: "Stock Count Items", isArray: true, arrayType: "object", arrayFields: [] }
  ]),
  data: JSON.stringify({
    plant_id: __v("node:code_review_prep.data.entry.plant_id"),
    count_type: __v("node:code_review_prep.data.entry.count_type"),
    table_stock_count: __v("node:code_review_prep.data.entry.table_stock_count")
  })
};
} };
// base/STOCK_COUNT.v10.json :: code_review_build_sa
__N["code_review_build_sa"] = { decl: [["stockAdjustmentDoc", "any"], ["hasError", "int"], ["errorMessage", "string"], ["hasLines", "int"]], fn: function () {
const console = __QUIET;
const itemsWithVariance = __v("node:code_review_prep.data.itemsWithVariance") || [];
const entry = __v("node:code_review_prep.data.entry");
const itemList = __v("node:search_item.data.data") || [];
const balanceList = __v("node:search_item_balance.data.data") || [];
const batchBalanceList = __v("node:search_item_batch_balance.data.data") || [];
const binList = __v("node:search_bin_location.data.data") || [];
const uomList = __v("node:search_uom.data.data") || [];
const batchList = __v("node:search_batch.data.data") || [];
const costRows = __v("node:sql_review_costs.data") || [];
let prefixRule = __v("node:get_sa_prefix.data.data");
if (Array.isArray(prefixRule)) prefixRule = prefixRule[0];

const organizationId = __v("workflowparams:organizationId");
const nickname = __v("workflowparams:nickname");
const adjustmentDate = __v("workflowparams:adjustmentDate");

const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const isActive = (b) => b.is_deleted === 0 || b.is_deleted === "0" || !b.is_deleted;

// Found stock is valued at the plant's current cost so it does not drag WA/FIFO toward 0.
const costFor = (itemData, materialId, plantId, batchId) => {
  const method = itemData.material_costing_method;
  const src = method === "Weighted Average" ? "WA" : method === "First In First Out" ? "FIFO" : null;
  if (src) {
    const rows = costRows.filter(
      (r) => r.src === src && String(r.material_id) === String(materialId) && String(r.plant_id) === String(plantId)
    );
    const hit =
      rows.find((r) => Number(r.rn) === 1 && (batchId ? String(r.batch_id) === String(batchId) : !r.batch_id)) ||
      rows.find((r) => Number(r.rn_any) === 1);
    if (hit && q8(hit.cost) > 0) return q8(hit.cost);
  }
  return q8(itemData.purchase_unit_price);
};

const errors = [];
const groups = {};
const groupOrder = [];

for (const item of itemsWithVariance) {
  const itemData = itemList.find((it) => it.id === item.material_id) || {};
  const label = item.material_name || itemData.material_name || item.material_id;

  let varianceToUse = item.variance_qty;
  if (item.adjusted_qty !== undefined && item.adjusted_qty !== null && item.adjusted_qty !== item.variance_qty) {
    varianceToUse = item.adjusted_qty;
  }
  let varianceQtyInBaseUOM = varianceToUse;
  if (item.uom_id !== item.base_uom_id) {
    let tableUOMConversion = item.table_uom_conversion || itemData.table_uom_conversion;
    if (typeof tableUOMConversion === "string") {
      try { tableUOMConversion = JSON.parse(tableUOMConversion); } catch (e) { tableUOMConversion = null; }
    }
    if (tableUOMConversion && !Array.isArray(tableUOMConversion)) tableUOMConversion = [tableUOMConversion];
    if (tableUOMConversion && Array.isArray(tableUOMConversion)) {
      const currentUOMConversion = tableUOMConversion.find((conv) => conv.alt_uom_id === item.uom_id);
      if (currentUOMConversion && currentUOMConversion.base_qty) {
        varianceQtyInBaseUOM = varianceToUse * currentUOMConversion.base_qty;
      }
    }
  }

  const movementType = varianceQtyInBaseUOM > 0 ? "In" : "Out";
  const saQuantity = q8(Math.abs(varianceQtyInBaseUOM));
  if (saQuantity === 0) continue;

  const bin = binList.find((b) => b.id === item.location_id) || {};
  const locationName = bin.bin_location_combine || item.location_id;
  const binPlant = bin.plant_id || item.plant_id || entry.plant_id;

  if (Number(itemData.item_batch_management) === 1 && !item.batch_id) {
    errors.push(`${label} @ ${locationName}: batch is required for a batch-managed item`);
    continue;
  }

  const source = item.batch_id ? batchBalanceList : balanceList;
  const candidates = source.filter(
    (b) =>
      b.material_id === item.material_id &&
      b.location_id === item.location_id &&
      (!item.batch_id || b.batch_id === item.batch_id) &&
      isActive(b)
  );
  const balanceData =
    candidates.find((b) => b.plant_id === item.plant_id) || candidates.find((b) => b.plant_id === binPlant) || null;

  if (movementType === "Out") {
    const available = balanceData ? q8(balanceData.unrestricted_qty) : 0;
    if (available < saQuantity) {
      errors.push(
        balanceData
          ? `${label} @ ${locationName}: only ${available} unrestricted, cannot deduct ${saQuantity}`
          : `${label} @ ${locationName}: no stock balance, cannot deduct ${saQuantity}`
      );
      continue;
    }
  }

  const plantId = balanceData ? balanceData.plant_id : binPlant;
  const unitPrice = movementType === "In" ? costFor(itemData, item.material_id, plantId, item.batch_id) : 0;

  const balanceEntry = balanceData
    ? {
        balance_id: balanceData.id,
        material_id: balanceData.material_id,
        plant_id: balanceData.plant_id,
        location_id: balanceData.location_id,
        batch_id: balanceData.batch_id || null,
        balance_quantity: balanceData.balance_quantity,
        unrestricted_qty: balanceData.unrestricted_qty,
        block_qty: balanceData.block_qty,
        qualityinsp_qty: balanceData.qualityinsp_qty,
        reserved_qty: balanceData.reserved_qty,
        intransit_qty: balanceData.intransit_qty,
        organization_id: balanceData.organization_id,
        tenant_id: balanceData.tenant_id,
        create_user: balanceData.create_user,
        create_time: balanceData.create_time,
        create_dept: balanceData.create_dept,
        update_user: balanceData.update_user,
        update_time: balanceData.update_time,
        is_deleted: balanceData.is_deleted,
      }
    : {
        balance_id: null,
        material_id: item.material_id,
        plant_id: plantId,
        location_id: item.location_id,
        batch_id: item.batch_id || null,
        balance_quantity: 0,
        unrestricted_qty: 0,
        block_qty: 0,
        qualityinsp_qty: 0,
        reserved_qty: 0,
        intransit_qty: 0,
        organization_id: organizationId,
        is_deleted: 0,
      };
  balanceEntry.category = "Unrestricted";
  balanceEntry.movement_type = movementType;
  balanceEntry.sa_quantity = saQuantity;

  const key = `${item.material_id}|${plantId}|${movementType}|${movementType === "In" ? unitPrice : ""}`;
  if (!groups[key]) {
    groups[key] = { firstItem: item, itemData, plantId, unitPrice, balanceIndex: [], totalQuantity: 0, details: [] };
    groupOrder.push(key);
  }
  const group = groups[key];
  group.balanceIndex.push(balanceEntry);
  group.totalQuantity = q8(group.totalQuantity + saQuantity);

  const uomName = (uomList.find((u) => u.id === item.base_uom_id) || {}).uom_name || "";
  let batchName = "";
  if (item.batch_id) batchName = (batchList.find((bt) => bt.id === item.batch_id) || {}).batch_number || "";
  let detailLine = `${locationName}: ${saQuantity} ${uomName} (UNR) - ${movementType === "In" ? "IN" : "OUT"}`;
  if (batchName) detailLine += `\n[${batchName}]`;
  group.details.push(detailLine);
}

const stockAdjustmentTable = groupOrder.map((key) => {
  const group = groups[key];
  const firstItem = group.firstItem;
  const baseUomName = (uomList.find((u) => u.id === firstItem.base_uom_id) || {}).uom_name || "";
  return {
    material_id: firstItem.material_id,
    uom_id: firstItem.base_uom_id,
    material_name: group.itemData.material_name || "",
    item_category: firstItem.item_category,
    is_serialized_item: firstItem.is_serialized || 0,
    is_single_serial: firstItem.is_single || 0,
    total_quantity: group.totalQuantity,
    unit_price: group.unitPrice,
    balance_index: JSON.stringify(group.balanceIndex),
    adj_summary: `Total: ${group.totalQuantity} ${baseUomName}\nDETAILS:\n${group.details
      .map((detail, idx) => `${idx + 1}. ${detail}`)
      .join("\n")}`,
  };
});

const plantIds = [...new Set(groupOrder.map((key) => groups[key].plantId))];

const stockAdjustmentDoc = {
  stock_adjustment_status: "Draft",
  organization_id: organizationId,
  adjustment_no: "draft",
  adjustment_no_type: prefixRule && prefixRule.id ? prefixRule.id : null,
  stock_count_id: entry.id,
  adjustment_date: adjustmentDate,
  adjustment_type: "Stock Count",
  adjusted_by: nickname,
  plant_id: plantIds.length === 1 ? plantIds[0] : entry.plant_id,
  adjustment_remarks: entry.stock_count_remark || "",
  adjustment_remarks2: entry.stock_count_remark2 || "",
  adjustment_remarks3: entry.stock_count_remark3 || "",
  stock_adjustment: stockAdjustmentTable,
};

const shown = errors.slice(0, 10).join("; ");
const errorMessage = errors.length
  ? `Stock Adjustment not created. ${shown}${errors.length > 10 ? `; and ${errors.length - 10} more` : ""}`
  : "";

return {
  stockAdjustmentDoc,
  hasError: errors.length ? 1 : 0,
  errorMessage,
  hasLines: stockAdjustmentTable.length ? 1 : 0,
};
} };
// base/STOCK_COUNT.v10.json :: code_review_mark
__N["code_review_mark"] = { decl: [["entry", "any"]], fn: function () {
const console = __QUIET;
let entry = __v("node:code_review_prep.data.entry");
entry.table_stock_count = entry.table_stock_count.map((item) => {
  if (item.review_status === "Approved" && item.line_status !== "Adjusted") {
    return { ...item, line_status: "Adjusted" };
  }
  return item;
});
const allAdjusted = entry.table_stock_count.every((item) => item.line_status === "Adjusted");
entry.adjustment_status = allAdjusted ? "Fully Adjusted" : "Partially Adjusted";
return { entry };
} };
// base/STOCK_COUNT.v10.json :: code_fillback
__N["code_fillback"] = { decl: [["entry", "any"]], fn: function () {
const console = __QUIET;
let entry = __v("node:code_draft.data.entry") || __v("node:code_issued.data.entry") || __v("node:code_stockcount.data.entry") || __v("node:code_review_mark.data.entry") || __v("node:code_review_prep.data.entry");
entry.table_stock_count = entry.table_stock_count || [];
for (const [index, row] of entry.table_stock_count.entries()) {
  row.line_index = index + 1;
}
entry.organization_id = __v("workflowparams:organizationId");
return { entry };
} };
// base/STOCK_ADJUSTMENT.v24.json :: code_node_O4tWJ5JH
__N["code_node_O4tWJ5JH"] = { decl: [["allData", "any"], ["stock_adjustment_status", "string"], ["stock_count_id", "string"]], fn: function () {
const console = __QUIET;
let allData = __v("workflowparams:allData")
const updatedSA = []
const saveAs = __v("workflowparams:saveAs")

// 8dp is the maximum configurable column precision: rounding there keeps every
// client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));

for (const [index, saLineItem] of allData.stock_adjustment.entries()) {
  saLineItem.unit_price = q8(saLineItem.unit_price);
  
  saLineItem.plant_id = allData.plant_id || null;
  saLineItem.line_index = index + 1;

  updatedSA.push(saLineItem)
}

allData.stock_adjustment = updatedSA

if (__v("workflowparams:pageStatus") === "Add") {
  allData.stock_adjustment_status = "Draft"
}

if (saveAs === "Draft") {
  if(allData.adjustment_no_type !== -9999 && (
  !allData.adjustment_no || allData.adjustment_no === null || allData.adjustment_no === ''
)) {
  allData.adjustment_no = 'draft'
  }
} else {
  if (
  allData.adjustment_no_type !== -9999 &&
  (!allData.adjustment_no ||
    allData.adjustment_no === null ||
    allData.adjustment_no === "" ||
    allData.stock_adjustment_status !== "In Progress")
) {
  allData.adjustment_no = 'issued'
  }
}

if (allData.acc_integration_type !== "No Accounting Integration") {
  allData.posted_status = "Unposted";
} else {
  allData.posted_status = "";
}

return {
  allData: allData,
  stock_adjustment_status: allData.stock_adjustment_status,
  stock_count_id: allData.stock_count_id || null,
}

} };
// ==== END LIFTED BODIES ====
if (typeof module !== "undefined") module.exports = { SA_REVIEW_SPLIT, SA_REVIEW_NODES, saReviewRecord, saReviewAdapt, saReviewIds, saAdjDetails, saSplitLines, saReviewPrep, saReviewChain };
