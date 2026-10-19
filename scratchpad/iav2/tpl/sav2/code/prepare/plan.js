// SA_V2_PREPARE - Plan: the Stock Adjustment SUBMIT locked for this job + the job's request (+ its S| part) -> the classic
// STOCK_ADJUSTMENT v24 loop run on the lifted bodies -> the manifest COMMIT executes and its parts, as gd_publish_step rows
// P|<nonce>|<PART>|<nnn> (CONTRACT.md sections 5, 9, 16). Ends READY or FAIL; unlockOk 1 only after the lock check proved this job
// owns the SA (Processing, sa_v2_job_id = the job, the latest SAC| LOCK row = the job's key) - a failure before it never unlocks.
//
// The plan's lines (the classic's loop variable, O4tWJ5JH's allData.stock_adjustment): DIRECT the stored lines (SUBMIT wrote them),
// COMPLETE the S|..|DOC lines (the filled-back form lines), REVIEW the shared review chain's lines (build -> O4tWJ5JH -> split) on
// fresh reads. Lift context (reviewer A1): pageStatus "Edit", saveAs "Completed", O4tWJ5JH's stock_adjustment_status "Draft",
// get_node_Rs3nGg9f = the STORED header (its issued adjustment_no; COMPLETE: + the DOC header props, as the classic's read-back
// after its update) - never Processing, never the 'issued' literal.
const SA_PLAN_ACTIONS = { DIRECT: { source: "FORM", prev: "Draft" }, COMPLETE: { source: "FORM", prev: "Draft" }, REVIEW: { source: "REVIEW", prev: "Cancelled" } };
// every column COMMIT A1 writes on a line (build_commit.py SA_LINE_COLS: every row carries every one)
const SA_PLAN_LINE_COLS = ["material_id", "material_name", "material_desc", "adjustment_reason", "total_quantity", "uom_id", "unit_price", "adj_summary", "adjustment_remarks",
  "balance_index", "line_index", "plant_id", "item_category", "is_single_serial", "is_serialized_item", "item_remark", "item_remark2", "item_remark3", "project_id"];
// saLineFingerprint's fields: never filled (an absent one fingerprints as "", as SUBMIT fingerprinted the DOC lines)
const SA_PLAN_FP_COLS = ["line_index", "material_id", "uom_id", "total_quantity", "unit_price", "balance_index"];
// what the classic's insert stores for a column a new line leaves out (prod: all 159 review-created lines hold '' in these, NULL in
// the others)
const SA_PLAN_INSERT_DEFAULTS = { material_desc: "", adjustment_remarks: "", item_remark: "", item_remark2: "", item_remark3: "" };
// the header props COMMIT A1 writes on a COMPLETE (build_commit.py SA_HDR = SUBMIT's S|..|DOC header)
const SA_PLAN_HDR = ["plant_id", "adjustment_date", "adjustment_type", "stock_count_id", "adjusted_by", "organization_id", "project_id", "acc_integration_type",
  "reference_documents", "adjustment_remarks", "adjustment_remarks2", "adjustment_remarks3", "posted_status"];
// update_node_sc's props minus stock_count_no / stock_count_no_type (build_commit.py SC_PROPS)
const SA_PLAN_SC_PROPS = ["id", "stock_count_status", "plant_id", "organization_id", "count_type", "count_method", "item_list", "start_date", "end_date", "assignees",
  "user_assignees", "work_group_assignees", "blind_count", "total_counted", "total_variance", "review_status", "adjustment_status", "stock_count_remark", "stock_count_remark2",
  "stock_count_remark3", "attachment", "previous_status", "table_stock_count"];
const SA_PLAN_MSG = {
  notFound: "Stock Adjustment not found - it may have been deleted.",
  notLocked: "The Stock Adjustment is no longer locked by this completion: nothing was moved.",
  linesChanged: "The Stock Adjustment's lines changed while it was waiting: nothing was moved, please complete it again.",
  scChanged: "The Stock Count changed while its adjustment was waiting: nothing was moved, please review it again.",
  scUnsaved: "The Stock Count has lines that were never saved: nothing was moved. Save the Stock Count, then review it again.",
};
const saPlanJoin = function saPlanJoin(partRows, names) {
  const want = saList(names).map(saS);
  const rows = saList(partRows).filter((r) => want.indexOf(saS(r.step_name)) >= 0).sort((a, b) => (saS(a.step_name) < saS(b.step_name) ? -1 : 1));
  if (!want.length || rows.length !== want.length) return null;
  return saParseJ(rows.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
};
// the classic loop (loop_Jhtr4lro -> code_node_qrsgEz2F -> loop_NygsPXBU -> code_node_GmKmvMGe -> the OUT / IN sub-workflow) on the
// lifted bodies: one { line, q, g } per entry with sa_quantity > 0, lines in order, entries in array order. ctx: the classic context
// the bodies read (PREPARE: saPlanContext; the golden test: a recorded run's)
const saPlanContext = (header) => ({ "workflowparams:pageStatus": "Edit", "workflowparams:saveAs": "Completed",
  "node:code_node_O4tWJ5JH": { data: { stock_adjustment_status: "Draft" } }, "node:get_node_Rs3nGg9f": { data: { count: 1, data: header } },
  "node:search_node_SAItems": { data: { total: 0, count: 0, data: [] } } });
const saPlanLoop = function saPlanLoop(lines, base) {
  const out = [];
  for (const line of lines) {
    const ctx = Object.assign({}, base, { "node:loop_Jhtr4lro": line });
    __withContext(ctx, () => {
      const q = __run("code_node_qrsgEz2F");
      for (const b of saList(q.balancesToProcess)) {
        ctx["node:loop_NygsPXBU"] = b;
        out.push({ line: line, q: q, g: __run("code_node_GmKmvMGe") });
      }
    });
  }
  return out;
};
// one engine movement per classic sub-workflow call: its params (workflow_node_p9gVSMG0 / ABYSBRCw) minus itemData, + movement_key,
// direction; quantity q8; batch / dates null when the classic passes none; remark / remark2 / remark3 on an ADD only
const saPlanMovement = function saPlanMovement(key, q, g) {
  const t = saS(g.movement_type);
  const dir = t === "out" ? "SUBTRACT" : t === "in" ? "ADD" : "";
  const mv = { movement_key: key, direction: dir, plant_id: saS(g.plant_id), organization_id: saS(q.organization_id), material_id: saS(q.material_id),
    quantity: saQ8(g.quantity), material_uom: q.material_uom === undefined || q.material_uom === null ? "" : saS(q.material_uom), transaction_type: "SA",
    trx_no: saS(q.stock_adjustment_no), inventory_category: saS(g.inventory_category), location_id: saS(g.location_id), batch_id: saS(g.batch_id) || null,
    manufacturing_date: g.manufacturing_date || null, expired_date: g.expired_date || null, doc_date: q.doc_date === undefined ? null : q.doc_date, isMovingInv: 0,
    unit_price: typeof q.unit_price === "number" ? q.unit_price : parseFloat(q.unit_price) || 0 };
  if (dir === "ADD") Object.assign(mv, { remark: q.remark || null, remark2: q.remark2 || null, remark3: q.remark3 || null });
  return mv;
};
// SALINES rows: every A1 column on every row. A column the line lacks: a fingerprint field null (fingerprint-neutral); else the
// stored line's value when the line exists (never wipes what the classic's update kept), else the classic insert's default
const saPlanRowsOf = function saPlanRowsOf(lines, storedById) {
  return lines.map((l) => {
    const r = Object.assign({}, l);
    const cur = (storedById && saS(l.id) && storedById[saS(l.id)]) || null;
    for (const k of SA_PLAN_LINE_COLS) {
      if (k in r) continue;
      if (SA_PLAN_FP_COLS.indexOf(k) >= 0) r[k] = null;
      else if (cur) r[k] = cur[k] === undefined ? null : cur[k];
      else r[k] = k in SA_PLAN_INSERT_DEFAULTS ? SA_PLAN_INSERT_DEFAULTS[k] : null;
    }
    return r;
  });
};
// a DOC header prop against the stored one (COMMIT A1's loose rules: a miss only costs one more identical write)
const saPlanCanon = function saPlanCanon(v) {
  if (v === undefined || v === null || v === "") return "";
  const p = typeof v === "string" ? saParseJ(v) : v;
  if (p === null || typeof p !== "object") return saS(v);
  const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => ((o[k] = sortKeys(x[k])), o), {}) : x);
  const t = JSON.stringify(sortKeys(p));
  return t === "[]" || t === "{}" ? "" : t;
};
const saPlanHdrDiffers = function saPlanHdrDiffers(docHeader, stored) {
  return SA_PLAN_HDR.filter((k) => {
    const a = docHeader[k];
    const b = stored[k];
    if (k === "adjustment_date") return saDbDate(a) !== saDbDate(b);
    if (k === "reference_documents") return saPlanCanon(a) !== saPlanCanon(b);
    return saS(a) !== saS(b);
  });
};
// the SC part: update_node_sc's props as code_fillback left them (a prop the record did not carry is null, as the classic passes it),
// + the Stock Count lines' fingerprints before (SUBMIT's read) and after this write
const saPlanScPart = function saPlanScPart(after, beforeFingerprint) {
  const p = {};
  for (const k of SA_PLAN_SC_PROPS) p[k] = after[k] === undefined ? null : after[k];
  return Object.assign(p, { beforeFingerprint: saS(beforeFingerprint), afterFingerprint: scLineFingerprint(saList(after.table_stock_count)) });
};

const saPrepPlan = function saPrepPlan(entry, S, own) {
  const s = saS;
  const jobId = s(entry.jobId);
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: 0, movementCount: 0, unlockOk: 0 };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const broken = (why) => fail("SA_PLAN_BROKEN", "The save could not be prepared: " + why);
  if (s(entry.route) !== "GO") return fail(s(entry.result_code), s(entry.result_message));
  const req = entry.request && typeof entry.request === "object" ? entry.request : {};
  const saId = s(entry.saId);
  const hdr = saRows(S.hdr)[0] || null;
  if (!hdr || s(hdr.id) !== saId) return fail("SA_NOT_FOUND", SA_PLAN_MSG.notFound);
  // the lock check (section 4): only after it may a failure put the SA back to prevStatus
  const key = s(entry.idempotencyKey);
  if (s(hdr.stock_adjustment_status) !== "Processing" || s(hdr.sa_v2_job_id) !== jobId || !key || s(hdr.lock_ref) !== key) {
    return fail("SA_NOT_LOCKED", SA_PLAN_MSG.notLocked);
  }
  base.unlockOk = 1;
  if (own) own.locked = 1;
  const action = s(entry.action);
  const source = s(entry.source);
  const prev = s(entry.prevStatus);
  const want = SA_PLAN_ACTIONS[action];
  if (!want || want.source !== source || want.prev !== prev || s(entry.saveAs) !== "Completed") {
    return fail("SA_INVALID_REQUEST", "The save could not be prepared: the job's request names no valid action (" + action + " / " + source + " / " + prev + ").");
  }
  const orgId = s(hdr.organization_id);
  if (!saDigits(orgId) || !saDigits(hdr.plant_id)) return broken("the Stock Adjustment has no organization or plant.");
  if (s(entry.organizationId) !== orgId) return broken("the job's organization is not the Stock Adjustment's.");
  const trxNo = s(hdr.adjustment_no);
  if (!trxNo || trxNo === "issued" || trxNo === "draft") return broken("the Stock Adjustment has no issued number (" + (trxNo || "empty") + ").");
  const stored = saAdaptLines(S.lines);
  const storedFp = saLineFingerprint(stored);
  const header = saAdaptHeader(hdr);
  let lines = [];
  let salines = null;
  let scPart = null;
  let scId = "";
  let incoming = s(req.incomingFingerprint);
  let scAfterFp = "";

  if (action === "DIRECT") {
    // the stored lines are what SUBMIT wrote and read back (request.lineFingerprint)
    if (storedFp !== s(req.lineFingerprint)) return fail("SA_LINES_CHANGED", SA_PLAN_MSG.linesChanged);
    lines = stored;
    scId = saDigits(hdr.stock_count_id) ? s(hdr.stock_count_id) : "";
  } else if (action === "COMPLETE") {
    if (storedFp !== s(req.lineFingerprint) && storedFp !== incoming) return fail("SA_LINES_CHANGED", SA_PLAN_MSG.linesChanged);
    const doc = saPlanJoin(S.parts, req.parts && req.parts.DOC);
    if (!doc || typeof doc !== "object" || s(doc.saId) !== saId || !Array.isArray(doc.lines) || !doc.header || typeof doc.header !== "object") {
      return broken("its lines part is missing or unreadable.");
    }
    lines = doc.lines.filter((l) => l && typeof l === "object");
    if (saLineFingerprint(lines) !== incoming || s(doc.fingerprint) !== incoming) return broken("its lines part is not the request's (" + saLineFingerprint(lines) + ").");
    // a line id the Stock Adjustment no longer has (A1 refuses it: the write would touch a foreign row); the stored rows AS READ
    // ('' kept: a column the DOC line lacks keeps its stored value, '' included)
    const storedById = {};
    for (const l of saRows(S.lines)) storedById[s(l.id)] = l;
    if (lines.some((l) => s(l.id) && !storedById[s(l.id)])) return fail("SA_LINES_CHANGED", SA_PLAN_MSG.linesChanged);
    // A1 writes the DOC lines + header whenever either differs from the stored SA (a header-only edit is never lost)
    const changed = saPlanHdrDiffers(doc.header, header);
    if (Number(req.edited) === 1 || incoming !== storedFp || changed.length) {
      const docHeader = {};
      for (const k of SA_PLAN_HDR) docHeader[k] = doc.header[k] === undefined ? null : doc.header[k];
      salines = { stock_adjustment: saPlanRowsOf(lines, storedById), header: docHeader, fingerprint: incoming, headerChanged: changed };
    }
    // the classic's read-back after update_node_bYNSsj0v: the form's header props over the stored header (its number stays)
    for (const k of ["plant_id", "organization_id"]) if (s(doc.header[k])) header[k] = s(doc.header[k]);
    if (s(doc.header.adjustment_date)) header.adjustment_date = saDbDate(doc.header.adjustment_date);
    if (!saDigits(header.plant_id) || s(header.organization_id) !== orgId) return broken("its lines part names another plant or organization.");
    scId = saDigits(doc.header.stock_count_id) ? s(doc.header.stock_count_id) : "";
  } else {
    // REVIEW: the shared chain on the S|..|SC record and fresh reads (SUBMIT ran the same chain as its gate)
    if (storedFp !== s(req.lineFingerprint)) return fail("SA_LINES_CHANGED", SA_PLAN_MSG.linesChanged);
    scId = s(entry.scId);
    if (!saDigits(scId) || s(req.scId) !== scId) return broken("the review names no Stock Count.");
    if (scLineFingerprint(S.sclines) !== s(req.scFingerprint)) return fail("SA_SC_CHANGED", SA_PLAN_MSG.scChanged);
    const rec = saPlanJoin(S.parts, req.parts && req.parts.SC);
    if (!rec || typeof rec !== "object" || !Array.isArray(rec.table_stock_count) || s(rec.id) !== scId) return broken("the review's Stock Count part is missing or unreadable.");
    const chain = saReviewChain({ scRecord: rec, createAdjustment: req.createAdjustment, organizationId: s(req.organizationId) || orgId,
      nickname: req.nickname === undefined ? s(hdr.adjusted_by) : req.nickname, adjustmentDate: req.adjustmentDate === undefined ? s(hdr.adjustment_date).slice(0, 10) : req.adjustmentDate,
      reads: S.rv });
    const ids = saReviewIds(chain.prep);
    const used = S.ids || {};
    if (Number(chain.prep.hasApprovedVariance) !== 1) return broken("the review no longer creates a Stock Adjustment.");
    const same = (keys, k) => keys.every((u) => s(used[u]) === s(ids[k]));
    if (!same(["MID", "BMID", "CMID"], "MID") || !same(["LID", "BLID"], "LID") || !same(["UID"], "UID") || !same(["BID"], "BID") || !same(["ORG"], "ORG")) {
      return broken("the review reads do not match the review.");
    }
    const built = chain.built || {};
    if (Number(built.hasError) === 1) return fail("SA_REVIEW_BUILD_FAILED", s(built.errorMessage));
    if (Number(built.hasLines) !== 1 || !chain.saDoc) return broken("the review builds no line.");
    lines = saList(chain.saDoc.stock_adjustment);
    for (const l of lines) {
      const n = saUtf8Bytes(l.balance_index);
      if (n > SA_LINE_MAX_BYTES) return fail("SA_LINE_TOO_LARGE", "Line " + s(l.line_index) + " holds too many bins (" + n + " bytes); split it into several lines.");
    }
    const rows = saPlanRowsOf(lines, null);
    incoming = saLineFingerprint(rows);
    salines = { stock_adjustment: rows, header: {}, fingerprint: incoming };
    // the Stock Count after the review (A3 writes it after the stock moved)
    const after = chain.scAfter || {};
    if (s(after.id) !== scId) return broken("the review's Stock Count write is not Stock Count " + scId + "'s.");
    // A3 checks the written lines by id (prep already dropped the Cancel lines): one without an id would be inserted on every retry
    if (saList(after.table_stock_count).some((l) => typeof l !== "object" || !saDigits(l.id))) return fail("SA_SC_UNSAVED_LINES", SA_PLAN_MSG.scUnsaved);
    scPart = saPlanScPart(after, req.scFingerprint);
    scAfterFp = scPart.afterFingerprint;
  }
  if (action !== "REVIEW" && saDigits(req.scId) && s(req.scId) !== scId) return broken("the request's Stock Count " + s(req.scId) + " is not the Stock Adjustment's (" + (scId || "none") + ").");
  if (!scPart && scId) scPart = { mode: "PARITY", scId: scId };

  // ENGINE + LABELS: the classic loop, movement by movement
  let loop;
  try {
    loop = saPlanLoop(lines, saPlanContext(header));
  } catch (e) {
    return broken("the line loop failed (" + String((e && e.message) || e).slice(0, 160) + ").");
  }
  const items = {};
  for (const it of saRows(S.rv && S.rv.items)) items[s(it.id)] = it;
  const bins = {};
  for (const b of saRows(S.rv && S.rv.bins)) bins[s(b.id)] = b;
  const movements = [];
  const labels = {};
  for (let i = 0; i < loop.length; i++) {
    const line = loop[i].line;
    const q = loop[i].q;
    const g = loop[i].g;
    const mk = "M" + (i + 1);
    const mv = saPlanMovement(mk, q, g);
    if (!mv.direction) return broken("line " + s(line.line_index) + " has an invalid movement type (" + s(g.movement_type) + ").");
    if (!saDigits(mv.material_id) || !saDigits(mv.plant_id) || !saDigits(mv.location_id) || (mv.batch_id !== null && !saDigits(mv.batch_id)) || !(mv.quantity > 0) ||
      mv.organization_id !== orgId || mv.trx_no !== trxNo) {
      return broken("movement " + mk + " (line " + s(line.line_index) + ") has no valid item, plant, bin, batch, quantity or number.");
    }
    const it = items[mv.material_id] || {};
    labels[mk] = { line_index: s(line.line_index), line_id: s(line.id), item_code: s(it.material_code), item_name: s(line.material_name) || s(it.material_name),
      bin: s((bins[mv.location_id] || {}).bin_location_combine) || mv.location_id, bin_id: mv.location_id, category: mv.inventory_category, side: mv.direction === "ADD" ? "in" : "out" };
    movements.push(mv);
  }
  if (!movements.length) return broken("it moves no stock.");
  if (movements.length > SA_MAX_ENTRIES) {
    return fail("SA_SPLIT_REQUIRED", "This Stock Adjustment has " + movements.length + " stock movements. At most 5,000 can be completed at once - please split it.");
  }

  // ITEMS: code_node_WFXy3gHI over the plan's lines (one new Date().toISOString() at PREPARE time, the classic's value form)
  const stamp = __withContext({ "node:code_node_O4tWJ5JH": { data: { allData: { stock_adjustment: lines } } } }, () => __run("code_node_WFXy3gHI"));
  const itemDates = saList(stamp.updates).map((u) => ({ id: s(u.id), last_transaction_date: s(u.last_transaction_date) }));

  const parts = {
    ENGINE: { operation_key: "SAC|" + jobId, mode: "APPLY", organization_id: orgId, movements: movements },
    LABELS: labels,
    HDR: { id: saId, before: { stock_adjustment_status: "Processing" }, after: { stock_adjustment_status: "Completed" } },
    ITEMS: { itemDates: itemDates },
    REORDER: { document_type: "SA_COMPLETED", latest_data: lines, organization_id: orgId },
  };
  if (salines) parts.SALINES = salines;
  if (scPart) parts.SC = scPart;
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const name of Object.keys(parts)) {
    const rows = saPartRows(jobId, orgId, "P|" + nonce + "|" + name + "|", parts[name], "PAYLOAD");
    manifestParts[name] = rows.map((r) => r.step_name);
    for (const r of rows) partRows.push(r);
  }
  const manifest = {
    v: 1, prepared_by: "SA_V2_PREPARE", job_id: jobId, sa_id: saId, sa_no: trxNo, source: source, action: action, prevStatus: prev, sc_id: scId,
    organization_id: orgId, plant_id: s(header.plant_id), nonce: nonce, edited: action === "COMPLETE" ? Number(req.edited) || 0 : 0,
    lineFingerprint: s(req.lineFingerprint), incomingFingerprint: incoming, scFingerprint: action === "REVIEW" ? s(req.scFingerprint) : "", scAfterFingerprint: scAfterFp,
    parts: manifestParts, sparts: req.parts && typeof req.parts === "object" ? req.parts : {},
    counts: { lines: lines.length, entries: movements.length, movements: movements.length, items: itemDates.length },
  };
  return Object.assign(base, {
    route: "READY", code: "200", message: action + ": " + movements.length + " movements for " + lines.length + " lines", payload: JSON.stringify(manifest), partRows: partRows,
    lineCount: lines.length, movementCount: movements.length,
  });
};
