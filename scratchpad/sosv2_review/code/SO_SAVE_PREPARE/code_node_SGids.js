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

// ---- SO_SAVE_PREPARE cascade steps
// SO_SAVE_PREPARE cascade steps (PREPARE-B) - classic SO_CASCADE v27 pass A on the request, lifted node for node, but
// nothing is saved: the GD payloads are stored as parts for SO_SAVE_WORKER, which holds each one through GD Edit V2.
// Three worker calls (docs/lowcode/so-save-v2/PLAN.md, "PREPARE-B"): CASCADE (diff + plan + allocation requests), ALLOC
// (GLOBAL_ALLOCATION v34 in-process), PAYLOAD (classic's payloads). The lifted classic nodes (run_<name>):
//   SO_CASCADE: run_cdDiff code_cd_diff, run_cdPlan code_cd_plan, run_cdAllocReq code_cd_allocreq,
//     run_cdCollect code_cd_alloc_collect, run_cdNamesIds code_cd_names_ids, run_cdPayloads code_cd_payloads;
//   GLOBAL_ALLOCATION: run_gaItemNorm code_node_ItemNorm, run_gaExec code_node_hDa6pSw5;
//   SO_SAVE (B1 only, through soPrepareNext): the PREPARE-A chain.

const SO_SEARCH_PAGE = 10000; // the set-based allocation searches' limit: a full page means the read may be cut short

// The job row of a step's outcome; every row carries every column the update writes.
const soCascadeJobRow = function soCascadeJobRow(gate, o) {
  return Object.assign({ id: gate.jobId, job_status: "PREPARING", progress_percent: 20, progress_message: "", prepared_payload: gate.preparedPayload, error_code: "",
    error_message: "", error_details: "", confirmation_token: "", finished_at: null }, o);
};
const soCascadeSummary = function soCascadeSummary(gate, extra) {
  return JSON.stringify(Object.assign({}, soParse(gate.preparedPayload) || {}, extra));
};
// An outcome that ends the job: FAILED, the SO unlocked (nothing was written, no GD is held yet).
const soCascadeFail = function soCascadeFail(gate, out, code, message, details) {
  return Object.assign(out, { route: "FAIL", code: "500", message: message, reason: code, needUnlock: "YES", unlockRows: [{ id: gate.soId, is_processing: 0 }],
    jobRows: [soCascadeJobRow(gate, { job_status: "FAILED", progress_percent: 100, progress_message: "Not saved: " + message, error_code: code, error_message: message,
      error_details: details ? JSON.stringify(details) : "", finished_at: gate.dbNow })] });
};
const soCascadeOut = function soCascadeOut() {
  return { route: "", code: "200", message: "", reason: "", stage: "", jobRows: [], partRows: [], needUnlock: "NO", unlockRows: [], gdCount: 0, requestCount: 0, changeCount: 0 };
};
const soCascadePart = function soCascadePart(gate, ref, name, obj) {
  return { job_id: ref, organization_id: gate.organizationId, step_name: name, step_status: "PART", attempt_count: 0, result_ref: JSON.stringify(obj) };
};
const soCascadeParts = function soCascadeParts(rows, prefix) {
  return list(rows).filter((r) => s(r.step_name).indexOf(prefix) === 0).sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1)).map((r) => soParse(r.result_ref));
};

// B1 (stage CASCADE), node 1: the request and the stored SO through classic SO_SAVE's chain, then classic's
// CascadeGate -> SO_CASCADE inputs (prev / next table_so, the answers) and code_cd_diff.
const soCascadeDiff = function soCascadeDiff(gate, factRows, partRows, storedData, docsRows) {
  const f = list(factRows)[0] || {};
  const rp = soParse(f.request_payload) || {};
  const allData = soPrepareAllData(partRows, rp.answers);
  const stored = (Array.isArray(storedData) ? storedData[0] : storedData) || null;
  const out = { route: "DIFF", changeCount: 0, changes: [], materialIdCsv: "", emptyList: [], orgIdSafe: "", organizationId: s(allData.organization_id), raiseGdQty: "",
    confirmPickReversal: "", message: "" };
  if (!stored || s(stored.id) !== gate.soId) return Object.assign(out, { route: "NOSO", message: "the sales order could not be read" });
  const run = soPrepareNext(allData, stored, docsRows, []);
  const g = run.SRC.code_node_CascadeGate;
  if (!g) return Object.assign(out, { route: "NONE" }); // a Draft save: classic runs no cascade
  // workflow_node_CascadeA's params, as SO_SAVE sends them (passNo 1 = pass A)
  const P = { passNo: 1, so_id: g.soId, prev_table_so: g.prevTableSo, next_table_so: g.nextTableSo, confirmPickReversal: g.confirmPickReversal, raiseGdQty: g.raiseGdQty,
    organization_id: allData.organization_id };
  const d = run_cdDiff({}, P);
  return Object.assign(out, { changeCount: num(d.changeCount), changes: list(d.changes), materialIdCsv: s(d.materialIdCsv), emptyList: list(d.emptyList),
    orgIdSafe: s(d.orgIdSafe), raiseGdQty: s(g.raiseGdQty), confirmPickReversal: s(g.confirmPickReversal) });
};

// code_cd_plan + code_cd_allocreq on classic's reads (B1, and B3 again). gds / pps: the search rows; setupData: the
// get-node's data.
const soCascadePlanRun = function soCascadePlanRun(diff, gds, pps, items, setupData) {
  const P = { passNo: 1, raiseGdQty: diff.raiseGdQty };
  const SRC = { code_cd_diff: { changes: diff.changes, changeCount: diff.changeCount, materialIdCsv: diff.materialIdCsv, emptyList: diff.emptyList, orgIdSafe: diff.orgIdSafe },
    search_cd_gds: { data: list(gds) }, search_cd_pps: { data: list(pps) }, sql_node_CdItems: list(items), get_cd_setup: { data: setupData === undefined ? null : setupData } };
  SRC.code_cd_plan = run_cdPlan(SRC, P);
  if (num(SRC.code_cd_plan.blocked) === 1) return { SRC: SRC, P: P, plan: SRC.code_cd_plan, requests: [] };
  SRC.code_cd_allocreq = run_cdAllocReq(SRC, P);
  return { SRC: SRC, P: P, plan: SRC.code_cd_plan, requests: list(SRC.code_cd_allocreq.requests) };
};

// The plan's answer, shared by B1 and B3: null when the cascade goes on.
const soCascadeAnswer = function soCascadeAnswer(guard, gate, out, plan) {
  if (num(plan.blocked) === 1) {
    const q = { gateCode: s(plan.blockCode), message: s(plan.blockMessage), blockKind: s(plan.blockKind), blockSignal: num(plan.blockSignal) };
    // 414: GD asks to raise its quantity; the form asks the user, SUBMIT CONFIRM re-queues the job with the answer
    if (s(plan.blockCode) === "414") {
      return Object.assign(out, { route: "ASK", code: "414", message: q.message, reason: "confirmRaise", stage: "CASCADE",
        jobRows: [soCascadeJobRow(gate, { job_status: "AWAITING_CONFIRMATION", progress_percent: 20, progress_message: q.message, error_code: "414", error_message: q.message,
          error_details: JSON.stringify(q), confirmation_token: guard.nonce, prepared_payload: soCascadeSummary(gate, { stage: "CASCADE" }) })] });
    }
    return soCascadeFail(gate, out, s(plan.blockCode) || "406", q.message, q);
  }
  // decision B: a Picking Plan is re-saved by its classic save, which has no V2
  if (list(plan.ppDrafts).length) return soCascadeFail(gate, out, "SOV2_NOT_ELIGIBLE", "a picking plan of this sales order would change: saved the classic way", { gateCode: "300" });
  return null;
};
const soCascadeReady = function soCascadeReady(gate, out, why) {
  return Object.assign(out, { route: "READY", stage: "COMMIT", message: why,
    jobRows: [soCascadeJobRow(gate, { job_status: "READY_TO_COMMIT", progress_percent: 30, progress_message: "Ready to save", prepared_payload: soCascadeSummary(gate, { stage: "COMMIT", cascade: why }) })] });
};

// B1, node 2: classic's plan and allocation requests -> the C part.
const soCascadePlanStep = function soCascadePlanStep(guard, gate, diff, gds, pps, items, setupData) {
  const out = soCascadeOut();
  out.changeCount = num(diff.changeCount);
  if (diff.route === "NOSO") return soCascadeFail(gate, out, "SOV2_NO_SO", diff.message);
  if (diff.route === "NONE" || !num(diff.changeCount)) return soCascadeReady(gate, out, "nothing a delivery holds changed");
  const r = soCascadePlanRun(diff, gds, pps, items, setupData);
  const ans = soCascadeAnswer(guard, gate, out, r.plan);
  if (ans) return ans;
  if (!num(r.plan.hasWork)) return soCascadeReady(gate, out, "no delivery needs a change");
  const ref = "SOC|" + guard.nonce;
  // classic runs code_cd_names_ids on the drafts even when nothing is allocated (their stock rows' bins / batches / UOMs):
  // with no requests B3 reads these; with requests B2 computes them again with the results
  const names = r.requests.length ? {} : run_cdNamesIds(Object.assign({}, r.SRC, { get_cd_alloc_final: "[]" }), r.P);
  out.partRows = [soCascadePart(gate, ref, "C|000", { v: 1, diff: diff, requests: r.requests,
    names: { locationIds: list(names.locationIds), batchIds: list(names.batchIds), uomIds: list(names.uomIds) } })];
  out.requestCount = r.requests.length;
  out.gdCount = list(r.plan.gdDrafts).length;
  out.stage = r.requests.length ? "ALLOC" : "PAYLOAD";
  out.route = "NEXT";
  out.message = r.requests.length ? "Allocating stock for the deliveries" : "Preparing the delivery changes";
  out.jobRows = [soCascadeJobRow(gate, { progress_percent: 22, progress_message: out.message,
    prepared_payload: soCascadeSummary(gate, { stage: out.stage, cRef: ref, xRef: "", gRef: "", requests: r.requests.length, gds: out.gdCount }) })];
  return out;
};

// ---- GLOBAL_ALLOCATION v34 in-process (B2)

// The searches of GLOBAL_ALLOCATION v34, as filters over the set-based rows (the platform's search records: a missing key
// is a null). numberEqual compares numbers (by their decimal text: two 19-digit ids may share a double), equal compares
// text. handling_unit_id's null test is left to the platform's searches (huAllocated / looseAllocated): it is SQL's, so
// an empty '' is not null, and a record shows neither.
const soGaNull = (v) => v === undefined || v === null || v === "";
const soGaNumEq = (a, b) => !soGaNull(a) && !soGaNull(b) && soCanon(a) === soCanon(b);
const soGaEq = (a, b) => s(a) === s(b);
const soGaSearch = (rows, limit) => {
  const data = rows.slice(0, limit);
  return { total: rows.length, count: data.length, data: data };
};
// p: the workflow's params (GLOBAL_ALLOCATION's request); A: { items, itemBalances, batchBalances, pending (status
// Pending), huAllocated (Allocated, handling_unit_id not null), looseAllocated (Allocated, handling_unit_id null) }.
const soGlobalAllocation = function soGlobalAllocation(p, A) {
  // if_3mHEuJow -> return_node_f4hAPru0
  if (soGaNull(p.material_id) || Number(p.quantity) <= 0 || soGaNull(p.plant_id) || soGaNull(p.organization_id) || soGaNull(p.allocationType)) {
    return { code: "400", message: "Data is incomplete", allocationData: [] };
  }
  const SRC = {};
  // code_node_ItemSqlParams (digits only) -> sql_node_ItemAlloc
  const mat = /^[0-9]+$/.test(String(p.material_id)) ? String(p.material_id) : "0";
  SRC.sql_node_ItemAlloc = list(A.items).filter((r) => s(r.id) === mat);
  SRC.code_node_ItemNorm = run_gaItemNorm(SRC, p);
  // if_TtxL5yA9 -> return_node_ClHo7ok7
  if (num(SRC.code_node_ItemNorm.itemFound) === 0) return { code: "400", message: "Item not found or being deleted", allocationData: [] };
  const at = (r) => soGaNumEq(r.material_id, p.material_id) && soGaNumEq(r.plant_id, p.plant_id);
  // if_XPr9mVTE: search_node_ARAmvXyd (Item Batch Balance) / search_node_mb8Vv8fZ (Item Balance), limit 500
  if (num(SRC.code_node_ItemNorm.isBatchManaged) === 1) SRC.search_node_ARAmvXyd = soGaSearch(list(A.batchBalances).filter((r) => at(r) && soGaEq(r.organization_id, p.organization_id)), 500);
  else SRC.search_node_mb8Vv8fZ = soGaSearch(list(A.itemBalances).filter((r) => at(r) && soGaEq(r.organization_id, p.organization_id)), 500);
  // if_xWXCj_YZ (isPending numberEqual 1): search_node_BOywHct7 (limit 500) + search_node_WGl1NGSu (limit 1000)
  if (Number(p.isPending) === 1) {
    SRC.search_node_BOywHct7 = soGaSearch(list(A.pending).filter((r) => at(r) && soGaEq(r.parent_line_id, p.parent_line_id) && soGaEq(r.status, "Pending")), 500);
    SRC.search_node_WGl1NGSu = soGaSearch(list(A.huAllocated).filter((r) => at(r) && soGaEq(r.status, "Allocated")), 1000);
  }
  // search_node_OwnReserved01 (limit 1000)
  SRC.search_node_OwnReserved01 = soGaSearch(list(A.looseAllocated).filter((r) => at(r) && soGaEq(r.target_gd_id, p.currentDocId) && soGaEq(r.status, "Allocated")), 1000);
  const r = run_gaExec(SRC, p);
  // return_node_UwhI5ag5
  return { code: r.code, message: r.message, allocationData: r.allocationData };
};

// B2, node 1: what the set-based searches read (every request's material and plant).
const soCascadeAllocIds = function soCascadeAllocIds(gate, cRows) {
  const c = soCascadeParts(cRows, "C|")[0] || {};
  const reqs = list(c.requests);
  const ids = (k) => [...new Set(reqs.map((r) => s(r[k])).filter((v) => /^[0-9]+$/.test(v)))];
  const mats = ids("material_id");
  const plants = ids("plant_id");
  return { route: c.v ? "GO" : "NOPART", materialIds: mats.length ? mats : ["0"], plantIds: plants.length ? plants : ["0"], materialIdCsv: mats.join(",") || "0",
    organizationId: gate.organizationId };
};

// A GD changed since B1 stored the requests: the cascade is planned again (stage CASCADE).
const soCascadeAgain = function soCascadeAgain(gate, out) {
  out.route = "NEXT";
  out.stage = "CASCADE";
  out.message = "A delivery changed meanwhile: checking again";
  out.jobRows = [soCascadeJobRow(gate, { progress_percent: 20, progress_message: out.message, prepared_payload: soCascadeSummary(gate, { stage: "CASCADE", cRef: "", xRef: "" }) })];
  return out;
};

// B2, node 2: classic's plan again on classic's reads (the requests must be the ones B1 stored), every request through
// GLOBAL_ALLOCATION (classic's loop: set_cd_alloc_init [], then per request the workflow call and code_cd_alloc_collect),
// then code_cd_names_ids -> the X part.
const soCascadeAllocStep = function soCascadeAllocStep(guard, gate, cRows, gds, pps, items, setupData, itemRows, balRows, batchRows, pendRows, huRows, looseRows) {
  const out = soCascadeOut();
  const c = soCascadeParts(cRows, "C|")[0];
  if (!c) return soCascadeFail(gate, out, "SOV2_PARTS", "the delivery plan of this save is missing");
  const r = soCascadePlanRun(c.diff, gds, pps, items, setupData);
  const ans = soCascadeAnswer(guard, gate, out, r.plan);
  if (ans) return ans;
  if (JSON.stringify(r.requests) !== JSON.stringify(list(c.requests))) return soCascadeAgain(gate, out);
  for (const rows of [balRows, batchRows, pendRows, huRows, looseRows]) {
    if (list(rows).length >= SO_SEARCH_PAGE) return soCascadeFail(gate, out, "SOV2_NOT_ELIGIBLE", "too much stock data to allocate in the background: saved the classic way", { gateCode: "300" });
  }
  const A = { items: list(itemRows), itemBalances: list(balRows), batchBalances: list(batchRows), pending: list(pendRows), huAllocated: list(huRows), looseAllocated: list(looseRows) };
  const reqs = r.requests;
  let results = [];
  for (const req of reqs) {
    // wf_cd_alloc's body params: the request's fields, the literals isPending 1, allocationType GD, enforceStockCheck 1, includeReservedQty 1
    const p = { material_id: req.material_id, quantity: req.quantity, plant_id: req.plant_id, organization_id: req.organization_id, existingAllocationData: req.existingAllocationData,
      allocationStrategy: req.allocationStrategy, isPending: 1, parent_line_id: req.parent_line_id, allocationType: "GD", huData: req.huData, huPriority: req.huPriority,
      currentDocId: req.currentDocId, enforceStockCheck: 1, includeReservedQty: 1, orderUomId: req.orderUomId, splitPolicy: req.splitPolicy, lineMaterials: req.lineMaterials,
      allowMixedItem: req.allowMixedItem };
    const a = soGlobalAllocation(JSON.parse(JSON.stringify(p)), A);
    results = list(run_cdCollect({ get_cd_alloc: soCacheText(results), loop_cd_alloc: req, wf_cd_alloc: a }, {}).results);
  }
  const names = run_cdNamesIds(Object.assign({}, r.SRC, { get_cd_alloc_final: soCacheText(results) }), r.P);
  const ref = "SOX|" + guard.nonce;
  out.partRows = [soCascadePart(gate, ref, "X|000", { v: 1, results: results, locationIds: list(names.locationIds), batchIds: list(names.batchIds), uomIds: list(names.uomIds) })];
  out.requestCount = reqs.length;
  out.gdCount = list(r.plan.gdDrafts).length;
  out.stage = "PAYLOAD";
  out.route = "NEXT";
  out.message = "Preparing the delivery changes";
  out.jobRows = [soCascadeJobRow(gate, { progress_percent: 25, progress_message: out.message, prepared_payload: soCascadeSummary(gate, { stage: "PAYLOAD", xRef: ref }) })];
  return out;
};

// B2 / B3, node 1: the ids classic's reads take (the diff's items) and, for B3, code_cd_names_ids' answer from the X part.
const soCascadePayIds = function soCascadePayIds(gate, cRows) {
  const c = soCascadeParts(cRows, "C|")[0] || {};
  // the names B2 found with the allocations, else the ones B1 found on the drafts
  const x = soCascadeParts(cRows, "X|")[0] || c.names || {};
  const d = c.diff || {};
  const nz = (a) => (list(a).length ? list(a) : ["0"]);
  return { route: c.v ? "GO" : "NOPART", materialIdCsv: s(d.materialIdCsv), orgIdSafe: s(d.orgIdSafe), organizationId: s(d.organizationId), locationIds: nz(x.locationIds),
    batchIds: nz(x.batchIds), uomIds: nz(x.uomIds),
    // B2 reads classic's items beside the allocation's: the diff's ids under names of their own
    diffIds: { diffMaterialIdCsv: s(d.materialIdCsv), orgIdSafe: s(d.orgIdSafe), diffOrganizationId: s(d.organizationId) } };
};

// code_cd_payloads after soCascadePlanRun r, on the allocation results and classic's name lookups.
// The allocation results reach classic's nodes as a get-cache-node hands them over: the cache's JSON text.
const soCacheText = (v) => (typeof v === "string" ? v : JSON.stringify(list(v)));
const soCascadePayloadsRun = function soCascadePayloadsRun(r, results, bins, uoms, batches) {
  const SRC = Object.assign({}, r.SRC, { get_cd_alloc_final: soCacheText(results), search_cd_bins: { data: list(bins) }, search_cd_uoms: { data: list(uoms) }, search_cd_batches: { data: list(batches) } });
  return run_cdPayloads(SRC, r.P);
};

// B3, node 2: classic's plan again (a GD changed since B1 -> back to CASCADE), then code_cd_payloads -> one G part per GD.
const soCascadePayStep = function soCascadePayStep(guard, gate, cRows, gds, pps, items, setupData, bins, uoms, batches) {
  const out = soCascadeOut();
  const c = soCascadeParts(cRows, "C|")[0];
  if (!c) return soCascadeFail(gate, out, "SOV2_PARTS", "the delivery plan of this save is missing");
  const x = soCascadeParts(cRows, "X|")[0] || { results: [] };
  const r = soCascadePlanRun(c.diff, gds, pps, items, setupData);
  const ans = soCascadeAnswer(guard, gate, out, r.plan);
  if (ans) return ans;
  if (JSON.stringify(r.requests) !== JSON.stringify(list(c.requests))) return soCascadeAgain(gate, out);
  const pay = soCascadePayloadsRun(r, x.results, bins, uoms, batches);
  if (num(pay.allocFailed) === 1) return soCascadeFail(gate, out, "406", s(pay.allocMessage), { gateCode: "406", message: s(pay.allocMessage), blockKind: s(pay.allocBlockKind), blockSignal: 1 });
  if (list(pay.ppPayloads).length) return soCascadeFail(gate, out, "SOV2_NOT_ELIGIBLE", "a picking plan of this sales order would change: saved the classic way", { gateCode: "300" });
  const gdp = list(pay.gdPayloads);
  if (!gdp.length) return soCascadeReady(gate, out, "no delivery needs a change");
  const ref = "SOG|" + guard.nonce;
  out.partRows = gdp.map((g, i) => soCascadePart(gate, ref, "G|" + ("00" + (i + 1)).slice(-3), { gd_id: s(g.gd_id), gd_no: s(g.gd_no), lineCount: num(g.lineCount), allData: g.allData }));
  out.gdCount = gdp.length;
  out.stage = "HOLD";
  out.route = "HOLD";
  out.message = "Updating " + gdp.length + " deliver" + (gdp.length === 1 ? "y" : "ies") + " of this sales order";
  out.jobRows = [soCascadeJobRow(gate, { job_status: "CASCADE_PREPARING", progress_percent: 30, progress_message: out.message,
    prepared_payload: soCascadeSummary(gate, { stage: "HOLD", gRef: ref, gdParts: gdp.length, gdsToHold: gdp.map((g) => ({ gd_id: s(g.gd_id), gd_no: s(g.gd_no) })) }) })];
  return out;
};

// Result of a cascade step.
const soCascadeResult = function soCascadeResult(guard, gate, src) {
  const r = src || {};
  const jr = list(r.jobRows)[0];
  return { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(gate.jobId), job_status: jr ? s(jr.job_status) : "", stage: s(r.stage),
    plan_ref: "", plan_parts: String(list(r.partRows).length), header_cells: "0", line_updates: "0", line_inserts: "0", line_deletes: "0", needs_cascade: "1",
    evidence: JSON.stringify({ v: 1, workflow: "SO_SAVE_PREPARE", step: s(gate.step), route: s(r.route), code: s(r.code), reason: s(r.reason), stage: s(r.stage),
      gds: num(r.gdCount), requests: num(r.requestCount) }) };
};

// ---- this node
const res = soCascadePayIds([{{node:code_node_SPgate.data}}][0], [{{node:sql_node_SGc.data}}][0]);
console.log("so prepare payload ids", JSON.stringify({ route: res.route, bins: res.locationIds.length, batches: res.batchIds.length, uoms: res.uomIds.length }));
return res;