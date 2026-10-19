// V2.1 bundles: the BUILT LOT_V2_PREPARE plan node (code_node_LPplan's script, from the workflow JSON) on a real classic payload
// that was never stored (fetch_bundle.py). The stored document SUBMIT would have written is rebuilt from the payload: the lifted
// fillback (code_node_yPlLXIZW, saveAs as the payload's, pageStatus Add) gives the tree and line numbers, then every row gets a
// synthetic id (children: parent_id). Read-only: nothing is written anywhere.
// usage: TZ=Asia/Kuala_Lumpur node run_bundle.js <fixture.json> [--count-shortages]
//   --count-shortages: a DIAGNOSTIC second run with the GLOBAL_ALLOCATION 400 stop patched to "allocate nothing and go on",
//                      to count every row the stock cannot cover (the real node stops at the first one)
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const SMV2 = path.join(__dirname, "..", "..");
const BUILT = path.join(SMV2, "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_PREPARE.json");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const COUNT = process.argv.includes("--count-shortages");

const nodes = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (typeof o.id === "string" && o.data && o.type) nodes[o.id] = o;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(BUILT, "utf8")));
const planSrc = nodes.code_node_LPplan.data.script.code;

// the stored document SUBMIT writes for an Add: the fillback's tree, synthetic ids
const lift = vm.createContext({ JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date });
vm.runInContext(fs.readFileSync(path.join(SMV2, "lib", "lift", "runtime.js"), "utf8") + "\n" + fs.readFileSync(path.join(SMV2, "lift", "lifted_prepare.js"), "utf8") +
  "\nthis.__run = __run; this.__withContext = __withContext;", lift);
lift.__P = F.params;
const filled = vm.runInContext(`__withContext({ "workflowparams:allData": __P.allData, "workflowparams:saveAs": __P.saveAs, "workflowparams:pageStatus": "Add" },
  () => __run("code_node_yPlLXIZW"))`, lift);
const A = filled.allData;
const LOT = "9100000000000000001", JOB = "9100000000000000002", KEY = "LOT:" + A.organization_id + ":" + LOT + ":0000000000000000:1";
let next = 9200000000000000000n;
const nid = () => String(++next);
const s = (v) => (v === undefined || v === null ? null : String(v));
const lineRow = (r, parentId) => ({ id: r.__id, line_index: s(r.line_index), item_selection: s(r.item_selection) || null, item_name: s(r.item_name), quantity_uom: s(r.quantity_uom),
  location_id: s(r.location_id), storage_location_id: s(r.storage_location_id), temp_qty_data: r.temp_qty_data === undefined ? null : r.temp_qty_data,
  total_quantity: r.total_quantity === undefined || r.total_quantity === "" ? null : Number(r.total_quantity), organization_id: s(r.organization_id),
  issuing_plant: s(r.issuing_plant), receiving_plant: s(r.receiving_plant), item_remark: s(r.item_remark), parent_id: parentId, item_bundle_id: s(r.item_bundle_id),
  requested_qty: r.requested_qty === undefined || r.requested_qty === "" ? null : Number(r.requested_qty) });
const lines = [];
for (const top of A.stock_movement || []) {
  top.__id = nid();
  lines.push(lineRow(top, null));
  for (const c of top.children || []) {
    c.__id = nid();
    lines.push(lineRow(c, top.__id));
  }
}
const hdr = { id: LOT, stock_movement_no: "LOT-V21-HARNESS", stock_movement_no_type: s(A.stock_movement_no_type), stock_movement_status: "Processing",
  issuing_operation_faci: s(A.issuing_operation_faci), receiving_operation_faci: s(A.receiving_operation_faci) || null, organization_id: s(A.organization_id),
  issue_date: String(A.issue_date || "").length === 10 ? A.issue_date + " 00:00:00" : String(A.issue_date || "").slice(0, 19), is_production_order: Number(A.is_production_order) || 0,
  movement_type: s(A.movement_type), movement_reason: s(A.movement_reason), issued_by: s(A.issued_by), tenant_id: F.tenant, lot_v2_job_id: JOB };
const action = F.params.saveAs === "Completed" ? "DIRECT" : "STAGE";
const entry = { route: "GO", jobId: JOB, tenantId: F.tenant, organizationId: s(A.organization_id), lotId: LOT, idempotencyKey: KEY, rowVersion: 1, attempts: 0,
  dbNow: "2026-10-19 12:00:00", jsAt: String(Date.now()), nonce: "h4rn3ss0", request: { v: 1, action: action, prevStatus: "Draft", saveAs: F.params.saveAs, pageStatus: "Add",
    lotId: LOT, lotNo: hdr.stock_movement_no, lineCount: lines.filter((l) => !(l.item_bundle_id && !l.parent_id)).length, parts: {} }, action: action, prevStatus: "Draft", saveAs: F.params.saveAs, allocScope: "EMPTY", unlockRows: [] };
const S = { entry: entry, parts: [], hdr: [{ j: JSON.stringify(hdr) }], lines: lines.map((l) => ({ j: JSON.stringify(l) })), transit: [], items: F.reads.items, bins: F.reads.bins,
  aitem: F.reads.aitem, abal: F.reads.abal, lock: [{ step_name: "LOCK|1", result_ref: KEY }] };

const tokenOf = { code_node_LPentry: "entry", sql_node_LPparts: "parts", sql_node_LPhdr: "hdr", sql_node_LPlines: "lines", sql_node_LPtransit: "transit",
  sql_node_LPitems: "items", sql_node_LPbins: "bins", sql_node_LPaitem: "aitem", sql_node_LPabal: "abal", sql_node_LPlock: "lock" };
const runPlan = (src) => {
  const code = src.replace(/\{\{node:([A-Za-z0-9_]+)\.data\}\}/g, (m, id) => {
    if (!tokenOf[id]) throw new Error("unexpected token " + m);
    return JSON.stringify(S[tokenOf[id]]);
  });
  if (/\{\{/.test(code)) throw new Error("a token is left");
  const sb = { console: { log() {}, error() {}, warn() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  const t0 = Date.now();
  const res = vm.runInContext("(function () {\n" + code + "\n})()", sb);
  return { res: res, ms: Date.now() - t0, fails: sb.__fails || [] };
};
const part = (res, name) => {
  const rows = (res.partRows || []).filter((r) => r.step_name.split("|")[2] === name).sort((a, b) => (a.step_name < b.step_name ? -1 : 1));
  return rows.length ? JSON.parse(rows.map((r) => r.result_ref).join("")) : null;
};
const flatCount = lines.filter((l) => !(l.item_bundle_id && !l.parent_id)).length;
console.log(`payload: ${lines.length} rows (${lines.length - flatCount} bundle parents, ${flatCount} lines), action ${action}, ${F.candidates} candidate items, ` +
  `${F.reads.abal.length} balance rows`);
const one = runPlan(planSrc);
const r = one.res;
console.log(`plan node: ${one.ms} ms -> route ${r.route} ${r.code} ${String(r.message).slice(0, 220)}`);
if (r.route === "READY") {
  const m = JSON.parse(r.payload);
  const alloc = part(r, "ALLOC");
  console.log(`  counts ${JSON.stringify(m.counts)}; parts ${Object.keys(m.parts).join(", ")}; ALLOC lines ${alloc ? alloc.lines.length : 0}, fingerprint ${alloc && alloc.fingerprint}`);
  const dump = (process.argv.find((a) => a.startsWith("--dump=")) || "").slice(7);
  if (dump) fs.writeFileSync(dump, JSON.stringify({ manifest: m, ALLOC: alloc, ENGINE: part(r, "ENGINE"), lines: lines }));
}
if (COUNT) {
  // DIAGNOSTIC ONLY: the 400 stop becomes "nothing allocated for this row", to count every row the stock cannot cover
  const STOP = 'if (s(ga.code) === "400") return { stop: s(ga.message) };';
  if (planSrc.indexOf(STOP) < 0) throw new Error("the GLOBAL_ALLOCATION 400 stop was not found in the built node");
  const patched = planSrc.replace(STOP, 'if (s(ga.code) === "400") { (globalThis.__fails = globalThis.__fails || []).push({ mat: mat, line: row.lineIndex, message: s(ga.message) }); ' +
    '__set("node:workflow_node_LOTallocRun", { data: { code: "206", message: "", allocationData: [] } }); }');
  const two = runPlan(patched);
  const byMsg = {};
  for (const f of two.fails) byMsg[f.message.replace(/item \S+\. Available: [^,]+, Requested: \S+/, "item <code>. Available: <n>, Requested: <n>")] = (byMsg[f.message.replace(/item \S+\. Available: [^,]+, Requested: \S+/, "item <code>. Available: <n>, Requested: <n>")] || 0) + 1;
  console.log(`diagnostic (continue past 400s): ${two.ms} ms; rows GLOBAL_ALLOCATION refused: ${two.fails.length} of ${flatCount} (${new Set(two.fails.map((f) => f.mat)).size} items)`);
  for (const [k, v] of Object.entries(byMsg)) console.log(`  ${v} x ${k}`);
  for (const f of two.fails.slice(0, 5)) console.log(`  e.g. flat line ${f.line + 1}: ${f.message}`);
  console.log(`  then: route ${two.res.route} ${two.res.code} ${String(two.res.message).slice(0, 160)}`);
}
if (process.argv.includes("--complete") && r.route === "READY") {
  // --complete: the same transfer In Progress (the run's ALLOC picks stored on its lines, no ledger rows: the legacy path),
  // completed through the built node with the S|..|LINES part SUBMIT writes (its fillback over the form's tree, fingerprinted
  // with SUBMIT's own lotTreeRows, code/submit/_common.js) - the incomingFingerprint gate must pass; then once with a wrong
  // incomingFingerprint, which must fail LOT_INVALID_REQUEST with the unlock
  const defs = planSrc.slice(0, planSrc.indexOf("const entry = [{{node:code_node_LPentry.data}}][0];"));
  const common = fs.readFileSync(path.join(SMV2, "code", "submit", "_common.js"), "utf8");
  const tree = common.match(/const lotTreeRows = \(rows\) => \{[\s\S]*?\n\};/);
  if (!tree) throw new Error("SUBMIT's lotTreeRows not found");
  const sb = { console: { log() {}, error() {}, warn() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(defs + "\n" + tree[0] + "\nthis.api = { lotAdaptDoc, lotLineFingerprint, lotTreeRows, lotPartRows, run: __run, ctx: __withContext };", sb);
  const api = sb.api;
  const picks = {};
  for (const l of part(r, "ALLOC").lines) picks[l.id] = l;
  const stored = lines.map((l) => (picks[l.id] ? Object.assign({}, l, { temp_qty_data: picks[l.id].temp_qty_data, total_quantity: picks[l.id].total_quantity }) : l));
  const lineFp = api.lotLineFingerprint(stored);
  const doc = api.lotAdaptDoc(Object.assign({}, hdr, { stock_movement_status: "In Progress" }), stored, "In Progress");
  const filled2 = api.ctx({ "workflowparams:allData": doc, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Edit" }, () => api.run("code_node_yPlLXIZW"));
  const sTree = filled2.allData.stock_movement;
  const fp = api.lotLineFingerprint(api.lotTreeRows(sTree));
  const header = {};
  for (const k of ["issuing_operation_faci", "issue_date", "movement_type", "movement_type_id", "movement_reason", "issued_by", "reference_documents", "organization_id", "project_id",
    "is_production_order", "production_order_id", "remarks", "remark", "remark2", "remark3"]) header[k] = filled2.allData[k] === undefined ? null : filled2.allData[k];
  const sRows = api.lotPartRows(JOB, s(A.organization_id), "S|ab12cd34|LINES|", { v: 1, lotId: LOT, header: header, stock_movement: sTree, fingerprint: fp }, "PAYLOAD");
  const run = (incoming) => {
    S.entry = Object.assign({}, entry, { action: "COMPLETE", prevStatus: "In Progress", saveAs: "Completed", allocScope: "REQ",
      request: Object.assign({}, entry.request, { action: "COMPLETE", prevStatus: "In Progress", saveAs: "Completed", pageStatus: "Edit", lineFingerprint: lineFp,
        incomingFingerprint: incoming, edited: 0, parts: { LINES: sRows.map((x) => x.step_name) } }) });
    S.lines = stored.map((l) => ({ j: JSON.stringify(l) }));
    S.parts = sRows.map((x) => ({ step_name: x.step_name, result_ref: x.result_ref }));
    return runPlan(planSrc);
  };
  const c1 = run(fp);
  const m1 = c1.res.route === "READY" ? JSON.parse(c1.res.payload) : null;
  console.log(`COMPLETE (S part: ${sRows.length} chunk(s), incomingFingerprint ${fp}): ${c1.ms} ms -> route ${c1.res.route} ${c1.res.code} ${String(c1.res.message).slice(0, 160)}` +
    (m1 ? `; counts ${JSON.stringify(m1.counts)}; parts ${Object.keys(m1.parts).join(", ")}; lineCount ${m1.lineCount}` : ""));
  const eng = m1 ? part(c1.res, "ENGINE") : null;
  if (eng) console.log(`  first pair: ${eng.movements[0].inventory_category} @ ${eng.movements[0].location_id} -> ${eng.movements[1].inventory_category} @ ${eng.movements[1].location_id}`);
  const c2 = run("LF1:1461:0000000000000000");
  console.log(`COMPLETE with a wrong incomingFingerprint: route ${c2.res.route} ${c2.res.code} "${c2.res.message}" unlockOk ${c2.res.unlockOk}`);
}
