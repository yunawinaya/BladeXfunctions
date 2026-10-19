// SA_V2_SUBMIT - Gate (CONTRACT §7; nothing is written when it answers): the eligibility the reads show (serial items, costing
// records waiting for migration -> NOT_ELIGIBLE, or SA_TOO_BIG above 500), the classic's gates lifted and run in-process
// (FORM: STOCK_ADJUSTMENT v24 code_node_O4tWJ5JH with the request's pageStatus (Clone as Add, ids stripped) + saveAs Completed,
// code_node_EZJK1Hzm + CHECK_REQUIRED_FIELD v8; REVIEW: the shared review chain (code/shared/review_chain.js: prep -> required ->
// build -> O4tWJ5JH -> <= 50-entry split) + CHECK_REQUIRED_FIELD on its required fields, then EZJK1Hzm + CHECK on the built doc;
// an SC record line without an id: SA_SC_UNSAVED_LINES),
// the entry checks (movement type In / Out case-insensitive, lines without stock, 60,000-byte balance_index), the WA-no-row STOP
// (GLOBAL_INVENTORY_VALIDATION v11's text), the 5,000-entry limit. Answers the filled-back record (DIRECT), the S|..|DOC part
// (COMPLETE) or the review's SA header + the S|..|SC part (REVIEW), with the fingerprints and counts of the request
// update_node_bYNSsj0v's header props minus stock_adjustment_status / adjustment_no / adjustment_no_type (the S|..|DOC header)
const SA_DOC_HDR_PROPS = ["plant_id", "adjustment_date", "adjustment_type", "stock_count_id", "adjusted_by", "organization_id", "project_id", "acc_integration_type",
  "reference_documents", "adjustment_remarks", "adjustment_remarks2", "adjustment_remarks3", "posted_status"];
// add_node_sa's header props (STOCK_COUNT v10) the review's header-only add writes from the built doc, + posted_status (fill-back)
const SA_REVIEW_HDR_PROPS = ["organization_id", "adjustment_no_type", "stock_count_id", "adjustment_date", "adjustment_type", "adjusted_by", "plant_id", "adjustment_remarks",
  "adjustment_remarks2", "adjustment_remarks3", "posted_status"];
const SA_REVIEW_READS = ["items", "balances", "batch_balances", "bins", "uoms", "batches", "costs", "prefix"];
// costing rows counted per (material, batch, plant): W / F (wa / fifo, batch-scoped), A (wa, any batch, per material + plant)
const saCostIndex = function saCostIndex(rows) {
  const ix = { W: {}, A: {}, F: {} };
  for (const c of saRows(rows)) {
    const t = s(c.t);
    if (!ix[t]) continue;
    const k = t === "A" ? s(c.m) + "|" + s(c.p) : s(c.m) + "|" + (s(c.b) || "0") + "|" + s(c.p);
    ix[t][k] = (ix[t][k] || 0) + num(c.n);
  }
  return ix;
};
// every moving entry with the keys its movement will carry: the LINE's material_id (code_node_qrsgEz2F), the entry's batch
// (0 = none) and plant (entry plant_id || the header plant: code_node_GmKmvMGe); the first non-empty answer of fn wins
const saEachEntry = function saEachEntry(lines, headerPlant, fn) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || typeof l !== "object") continue;
    for (const e of saMoving(l)) {
      const r = fn(l, e, saIdOf(l.material_id) || s(l.material_id), saIdOf(e.batch_id) || "0", saIdOf(e.plant_id) || headerPlant, i);
      if (r) return r;
    }
  }
  return "";
};
// eligibility the reads show (CONTRACT §7): serial items; FIFO / WA rows of one (material, batch, plant) waiting for the costing
// migration (pwv2 SUBMIT_SQL["cost"]'s rule; stock_control 0 items skipped)
const saItemReasons = function saItemReasons(lines, headerPlant, byItem, cost) {
  return saEachEntry(lines, headerPlant, (l, e, m, b, p) => {
    const it = byItem[m];
    if (!it) return "";
    if (num(it.serial_number_management) === 1) return "it has serial-numbered items";
    if (it.stock_control === 0 || s(it.stock_control) === "0") return "";
    const k = m + "|" + b + "|" + p;
    const f = cost.F[k] || 0;
    const w = cost.W[k] || 0;
    const method = s(it.material_costing_method);
    return (f > 0 && w > 0) || (method === "First In First Out" && f === 0 && w > 0) || (method === "Weighted Average" && w === 0 && f > 0)
      ? "it has items whose costing records are waiting for migration" : "";
  });
};
// a SUBTRACT of a Weighted Average item with no wa_costing_method row at the plant (GLOBAL_INVENTORY_VALIDATION v11
// code_node_hDa6pSw5: batch -> search_node_GIVWaBatch, no batch -> search_node_GIVWaNoBatch; same text)
const saWaMissing = function saWaMissing(lines, headerPlant, byItem, cost) {
  return saEachEntry(lines, headerPlant, (l, e, m, b, p) => {
    if (saDirection(e.movement_type) !== "SUBTRACT") return "";
    const it = byItem[m];
    if (!it || it.stock_control === 0 || s(it.stock_control) === "0" || s(it.material_costing_method) !== "Weighted Average") return "";
    const batch = b !== "0";
    const n = batch ? cost.W[m + "|" + b + "|" + p] || 0 : cost.A[m + "|" + p] || 0;
    return n === 0 ? "No Weighted Average costing record for item " + (s(it.material_code) || m) + " at this plant" + (batch ? " (batch " + b + ")" : "")
      + ". The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock." : "";
  });
};
// the entry checks on the filled-back lines (CONTRACT §7, in its order): [code, message] of the first failure, or null
const saEntryChecks = function saEntryChecks(lines) {
  const n = (l, i) => s(l.line_index) || String(i + 1);
  for (let i = 0; i < lines.length; i++) {
    for (const e of saMoving(lines[i])) if (!saDirection(e.movement_type)) return ["SA_INVALID_MOVEMENT_TYPE", "Invalid Movement Type - line " + n(lines[i], i)];
  }
  for (let i = 0; i < lines.length; i++) {
    if (parseFloat(lines[i].total_quantity) > 0 && !saMoving(lines[i]).length) {
      return ["SA_LINES_WITHOUT_STOCK", "No stock selected for line " + n(lines[i], i) + ". Select stock for every line before completing."];
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const bytes = saUtf8Bytes(lines[i].balance_index);
    if (bytes > SA_LINE_MAX_BYTES) return ["SA_LINE_TOO_LARGE", "Line " + n(lines[i], i) + " holds too many bins (" + bytes + " bytes); split it into several lines."];
  }
  return null;
};
const saChunks = function saChunks(text, prefix) {
  const names = [];
  const chunks = [];
  for (let at = 0, k = 1; at < text.length || k === 1; at += SA_CHUNK, k++) {
    names.push(prefix + String(k).padStart(3, "0"));
    chunks.push(text.slice(at, at + SA_CHUNK));
  }
  return { names: names, chunks: chunks };
};
// lifted CHECK_REQUIRED_FIELD v8 (code_node_AeSdXE85) over a { required_fields, data } pair
const saCheckRequired = (tenantId, req) => __withContext({ "system:tenantId": tenantId, "workflowparams:entry": req.data,
  "workflowparams:required_fields": req.required_fields }, () => __run("code_node_AeSdXE85"));
const submitGate = function submitGate(guard, entry, keys, form, R) {
  const act = entry.action;
  const review = act === "REVIEW";
  const base = { reason: "", errorCode: "", allData: {}, saHeader: {}, lineCount: num(keys.lineCount), entryCount: num(keys.entryCount), movementCount: 0, numberIssued: "NO",
    lineFingerprint: "", incomingFingerprint: "", edited: 0, scFingerprint: "", stockCountId: "", partNames: [], partChunks: [], plantId: "", organizationId: s(keys.organizationId) };
  const out = (route, code, message, errorCode, extra) => Object.assign(base, answer(route, code, message, Object.assign({ errorCode: errorCode || "" }, extra || {})));
  const ne = (a) => Object.assign(base, a);
  if (["DIRECT", "COMPLETE", "REVIEW"].indexOf(act) < 0) return out("STOP", "400", "the gate does not take " + act, "SA_INVALID_REQUEST");
  const byItem = {};
  for (const it of saRows(R.items)) byItem[s(it.id)] = it;
  const cost = saCostIndex(R.cost);
  if (review) {
    let chain = null;
    try {
      const reads = {};
      for (const k of SA_REVIEW_READS) reads[k] = list((R.rv || {})[k]);
      chain = saReviewChain({ scRecord: JSON.parse(JSON.stringify(form)), createAdjustment: guard.createAdjustment, organizationId: guard.organizationId,
        nickname: guard.nickname, adjustmentDate: guard.adjustmentDate, reads: reads });
    } catch (e) {
      return out("STOP", "500", "The review could not be checked: " + s(e && e.message), "SA_INVALID_DATA");
    }
    const prep = (chain && chain.prep) || {};
    // keys chose the review reads with saReviewPrep's lists: the chain's prep must give the same, or its build ran on other rows
    const ids = saReviewIds(prep);
    if (num(prep.hasApprovedVariance) !== 1 || s(ids.MID) !== s(keys.rvMatSql) || s(ids.LID) !== s(keys.rvLocSql) || s(ids.UID) !== s(keys.rvUomSql)
      || s(ids.BID) !== s(keys.rvBatchSql)) {
      return out("STOP", "500", "The review could not be checked: its reads do not match the review (please try again).", "SA_INVALID_DATA");
    }
    const built = (chain && chain.built) || {};
    const builtDoc = built.stockAdjustmentDoc || {};
    // eligibility first (CONTRACT §7 order), on the entries the build made: serial items, costing records waiting for the
    // migration; no default numbering rule (the header add could not issue a number) -> the classic Review
    const why = saItemReasons(list(builtDoc.stock_adjustment).filter((l) => l && typeof l === "object"), saIdOf(builtDoc.plant_id), byItem, cost);
    if (why) return ne(notEligible(why, base.lineCount, true));
    if (chain.built && !saIdOf(builtDoc.adjustment_no_type)) {
      return ne(notEligible("no default Stock Adjustment numbering rule for this organization", base.lineCount, true));
    }
    // controller ruling (C's A3 review): a line the SC record carries without an id would be inserted again by every retry of A3's
    // whole-subform update -> refused before any write
    if ((Array.isArray(form.table_stock_count) ? form.table_stock_count : []).some((l) => l && typeof l === "object" && !saIdOf(l.id))) {
      return out("STOP", "400", "This Stock Count has lines that are not saved yet - save the count, then review it.", "SA_SC_UNSAVED_LINES");
    }
    const req = (chain && chain.required) || {};
    const chk = saCheckRequired(guard.tenantId, req);
    if (s(chk.status) === "Failed") return out("STOP", "400", s(chk.message), "SA_REQUIRED_FIELDS");
    if (num(built.hasError) === 1) return out("STOP", "400", s(built.errorMessage), "SA_REVIEW_BUILD_FAILED");
    if (num(built.hasLines) !== 1) return ne(answer("NOT_ELIGIBLE", "300", "the review creates no Stock Adjustment", { reason: "no adjustment", errorCode: "SA_NOT_ELIGIBLE" }));
    const saDoc = (chain && chain.saDoc) || {};
    const lines = (Array.isArray(saDoc.stock_adjustment) ? saDoc.stock_adjustment : []).filter((l) => l && typeof l === "object");
    const headerPlant = saIdOf(saDoc.plant_id);
    let chk2 = null;
    __withContext({ "system:tenantId": guard.tenantId, "node:code_node_O4tWJ5JH": { data: { allData: saDoc } } }, () => {
      const req2 = __run("code_node_EZJK1Hzm");
      chk2 = saCheckRequired(guard.tenantId, req2);
    });
    if (s(chk2.status) === "Failed") return out("STOP", "400", s(chk2.message), "SA_REQUIRED_FIELDS");
    const bad = saEntryChecks(lines);
    if (bad) return out("STOP", "400", bad[1], bad[0]);
    const wa = saWaMissing(lines, headerPlant, byItem, cost);
    if (wa) return out("STOP", "400", wa, "SA_NO_WA_RECORD");
    const entries = saEntryCount(lines);
    if (entries > SA_MAX_ENTRIES) return ne(splitRequired(entries, true));
    if (!entries) return ne(answer("NOT_ELIGIBLE", "300", "the review creates no Stock Adjustment", { reason: "no adjustment", errorCode: "SA_NOT_ELIGIBLE" }));
    const header = {};
    for (const k of SA_REVIEW_HDR_PROPS) header[k] = saDoc[k] === undefined ? null : saDoc[k];
    Object.assign(header, { adjustment_no: "issued", adjustment_no_type: saIdOf(saDoc.adjustment_no_type), stock_count_id: guard.scId });
    const parts = saChunks(JSON.stringify(form), "S|" + guard.nonce + "|SC|");
    return out("GO", "", "", "", { saHeader: header, lineCount: lines.length, entryCount: entries, movementCount: entries, numberIssued: "YES",
      lineFingerprint: saLineFingerprint([]), incomingFingerprint: saLineFingerprint(lines), scFingerprint: scLineFingerprint(R.scLines), stockCountId: guard.scId,
      partNames: parts.names, partChunks: parts.chunks, plantId: headerPlant, organizationId: guard.organizationId });
  }
  // FORM: the record as the classic would take it (an Add / Clone without ids: it creates a new SA and new lines; the V2 helper
  // fields never reach a write)
  const doc = JSON.parse(JSON.stringify(form));
  if (act === "DIRECT") delete doc.id;
  doc.stock_adjustment = (Array.isArray(doc.stock_adjustment) ? doc.stock_adjustment : []).filter((l) => l && typeof l === "object");
  if (act === "DIRECT") for (const l of doc.stock_adjustment) delete l.id;
  for (const k of ["sa_v2_job_id", "sa_idem_key"]) delete doc[k];
  const why = saItemReasons(doc.stock_adjustment, saIdOf(doc.plant_id), byItem, cost);
  if (why) return ne(notEligible(why, base.entryCount, false));
  let fill = null;
  let chk = null;
  try {
    __withContext({ "workflowparams:allData": doc, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": guard.pageStatus, "system:tenantId": guard.tenantId },
      () => {
        fill = __run("code_node_O4tWJ5JH");
        chk = saCheckRequired(guard.tenantId, __run("code_node_EZJK1Hzm"));
      });
  } catch (e) {
    return out("STOP", "400", "The Stock Adjustment could not be checked: " + s(e && e.message), "SA_INVALID_DATA");
  }
  if (s(chk.status) === "Failed") return out("STOP", "400", s(chk.message), "SA_REQUIRED_FIELDS");
  const allData = fill.allData || {};
  const lines = (Array.isArray(allData.stock_adjustment) ? allData.stock_adjustment : []).filter((l) => l && typeof l === "object");
  const headerPlant = saIdOf(allData.plant_id);
  const bad = saEntryChecks(lines);
  if (bad) return out("STOP", "400", bad[1], bad[0]);
  const wa = saWaMissing(lines, headerPlant, byItem, cost);
  if (wa) return out("STOP", "400", wa, "SA_NO_WA_RECORD");
  const entries = saEntryCount(lines);
  if (entries > SA_MAX_ENTRIES) return ne(splitRequired(entries, false));
  const numberIssued = s(allData.adjustment_no) === "issued" ? "YES" : "NO";
  const common = { lineCount: lines.length, entryCount: entries, movementCount: entries, numberIssued: numberIssued, stockCountId: saIdOf(allData.stock_count_id),
    plantId: headerPlant };
  if (act === "DIRECT") return out("GO", "", "", "", Object.assign(common, { allData: allData }));
  // COMPLETE: the S|<nonce>|DOC part = what A1 writes (header props minus status / number, the filled-back lines, their fingerprint)
  const lineFingerprint = saLineFingerprint(R.stored);
  const incomingFingerprint = saLineFingerprint(lines);
  const header = {};
  for (const k of SA_DOC_HDR_PROPS) header[k] = allData[k] === undefined ? null : allData[k];
  const parts = saChunks(JSON.stringify({ v: 1, saId: guard.saId, header: header, lines: lines, fingerprint: incomingFingerprint }), "S|" + guard.nonce + "|DOC|");
  return out("GO", "", "", "", Object.assign(common, { allData: { adjustment_no: allData.adjustment_no, adjustment_no_type: allData.adjustment_no_type },
    lineFingerprint: lineFingerprint, incomingFingerprint: incomingFingerprint, edited: incomingFingerprint !== lineFingerprint ? 1 : 0, partNames: parts.names,
    partChunks: parts.chunks }));
};
