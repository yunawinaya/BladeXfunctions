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


// ---- this node
const res = soPrepareResult([{{node:code_node_SPguard.data}}][0], {}, [{{node:code_node_SPguard.data}}][0]);
console.log("so prepare result", JSON.stringify({ route: res.route, code: res.code, message: res.message, stage: res.stage }));
return res;