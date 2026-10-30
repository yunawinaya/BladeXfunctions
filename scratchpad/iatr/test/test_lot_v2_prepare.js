// LOT_V2_PREPARE for the IA transfer request (ENH-20261027-001; sources scratchpad/smv2/code/prepare): the BUILT workflow's entry,
// plan and ready code nodes on a synthetic STAGE (IATR_PREPARE=<file> runs another build: mutants_lot_v2.js).
//   - a request's dispatch (STAGE from Requested) plans exactly what a STAGE from Draft plans (movements, In Transit rows,
//     labels); only the manifest's prevStatus differs
//   - a dispatch that fails in PREPARE puts the LOT back to Requested (spec U18); a Draft STAGE back to Draft
//   - a job that would restore Requested after any other action goes to REQUIRES_REVIEW without an unlock
//   TZ=Asia/Kuala_Lumpur node scratchpad/iatr/test/test_lot_v2_prepare.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const H = require(path.join(REPO, "scratchpad", "smv2", "lib", "harness.js"));
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const FILE = process.env.IATR_PREPARE || path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_PREPARE.json");
const nodes = {};
(function walk(n) {
  if (Array.isArray(n)) n.forEach(walk);
  else if (n && typeof n === "object") {
    if (typeof n.id === "string" && n.type) nodes[n.id] = n;
    Object.values(n).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(FILE, "utf8")));
const body = (id) => nodes[id].data.script.code;
const only = (id, out) => {
  const o = {};
  for (const k of nodes[id].data.response_json.map((r) => r.name)) if (out && k in out) o[k] = out[k];
  return o;
};
const J = (o) => JSON.stringify(o);

const LOT = "9100000000000000001", JOB = "9100000000000000002", KEY = "LOT:K:1", ORG = "1123598813738675201", P = "1123598813738675202", UOM = "1940";
const SL = "9200000000000000001", DEST = "9300000000000000001", SRC = "9300000000000000002", SRC2 = "9300000000000000003";
const M1 = "9500000000000000001", M2 = "9500000000000000002", L1 = "9400000000000000001", L2 = "9400000000000000002";
const entryOf = (o) => Object.assign({ material_id: M1, location_id: SRC, unrestricted_qty: 10, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, balance_quantity: 10, intransit_qty: 0,
  plant_id: P, organization_id: ORG, material_uom: UOM, is_deleted: 0, balance_id: "8100000000000000001", category: "Unrestricted", unit_price: 2.5, fm_key: "fm1",
  sm_quantity: 3 }, o);
const lines = (unpickedL2) => [
  { id: L1, line_index: "1", item_selection: M1, item_name: "Thrust Washer", quantity_uom: UOM, storage_location_id: SL, location_id: DEST, requested_qty: "3.00000000",
    total_quantity: "3.00000000", temp_qty_data: J([entryOf({})]), temp_hu_data: "[]", parent_id: null, item_bundle_id: null, organization_id: ORG, source_ia_line_id: "9600000000000000001" },
  { id: L2, line_index: "2", item_selection: M2, item_name: "Bolt", quantity_uom: UOM, storage_location_id: SL, location_id: DEST, requested_qty: "2.00000000",
    total_quantity: unpickedL2 ? "0.00000000" : "2.00000000", temp_hu_data: "[]", parent_id: null, item_bundle_id: null, organization_id: ORG, source_ia_line_id: "9600000000000000002",
    temp_qty_data: unpickedL2 ? "" : J([entryOf({ material_id: M2, sm_quantity: 1.5, balance_id: "8100000000000000002", fm_key: "fm2" }),
      entryOf({ material_id: M2, location_id: SRC2, sm_quantity: 0.5, balance_id: "8100000000000000003", fm_key: "fm3" })]) },
];
const request = (action, prev, saveAs) => ({ v: 1, action: action, prevStatus: prev, saveAs: saveAs, pageStatus: "Edit", lotId: LOT, lotNo: "LOT-2610-001", issuedNo: "",
  lineFingerprint: "LF1:2:x", incomingFingerprint: "", edited: 0, organizationId: ORG, plantId: P, lineCount: 2, rowCount: 3, movementCount: 6, uid: "7", source: "FORM",
  nonce: "0a1b2c3d", parts: {} });
const sb = () => vm.createContext({ console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date });

const run = (req, o) => {
  const x = Object.assign({ unpickedL2: false, correlation: "LOT|" + LOT, stockL2: 0 }, o);
  const out = {};
  out.guard = H.runBody(body("code_node_LPguard"), { "system:tenantId": "711077", "workflowparams:job_id": JOB }, "guard");
  const job = { id: JOB, is_deleted: 0, command: "SAVE_LOT", job_status: "VALIDATING", lease_live: 1, request_payload: J(req), organization_id: ORG, idempotency_key: KEY,
    row_version: 2, attempt_count: 1, db_now: "2026-10-28 12:00:00", correlation_id: x.correlation, linked_lot: LOT };
  out.entry = H.runBody(body("code_node_LPentry"), { "node:code_node_LPguard.data": only("code_node_LPguard", out.guard), "node:sql_node_LPjob.data": [job],
    "system:uuid": "5e6f7a8b-y" }, "entry");
  const e = only("code_node_LPentry", out.entry);
  const hdr = { id: LOT, stock_movement_no: "LOT-2610-001", stock_movement_status: "Processing", issuing_operation_faci: P, organization_id: ORG, issue_date: "2026-10-28 00:00:00",
    is_production_order: 0, movement_type: "Location Transfer", lot_v2_job_id: JOB, transfer_purpose: "IA_SUPPLY" };
  const S = { entry: e, parts: x.parts || [], hdr: [{ j: J(hdr) }], lines: lines(x.unpickedL2).map((l) => ({ j: J(l) })), transit: x.transit || [], lock: [{ step_name: "LOCK|2", result_ref: KEY }],
    bins: [[DEST, "PROD-01"], [SRC, "A-01"], [SRC2, "A-02"]].map(([id, bin]) => ({ id: id, bin: bin })),
    items: [M1, M2].map((m, i) => ({ j: J({ id: m, material_code: "IT" + (i + 1), material_name: i ? "Bolt" : "Thrust Washer" }) })),
    aitem: [M1, M2].map((m, i) => ({ j: J({ id: m, material_code: "IT" + (i + 1), item_batch_management: 0, stock_control: 1, uom_conversion_json: "[]", default_bin_json: "[]" }) })),
    abal: x.stockL2 ? [{ k: "IB", j: J({ id: "8100000000000000009", material_id: M2, location_id: SRC2, unrestricted_qty: x.stockL2, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0,
      balance_quantity: x.stockL2, plant_id: P, organization_id: ORG, intransit_qty: 0, material_uom: UOM, is_deleted: 0, create_time: "2026-10-01 10:00:00.000" }) }] : [] };
  // reserved requests (Task 5): the request's IA status and its Allocated hold rows; by default a Draft IA with none (today's logic)
  S.holds = x.holds || [{ j: J({ ia_status: "Draft", rows: [] }) }];
  const tok = { code_node_LPentry: "entry", sql_node_LPparts: "parts", sql_node_LPhdr: "hdr", sql_node_LPlines: "lines", sql_node_LPtransit: "transit", sql_node_LPitems: "items",
    sql_node_LPbins: "bins", sql_node_LPaitem: "aitem", sql_node_LPabal: "abal", sql_node_LPlock: "lock", sql_node_LPholds: "holds" };
  const code = body("code_node_LPplan").replace(/\{\{node:([A-Za-z0-9_]+)\.data\}\}/g, (m, id) => {
    if (!(id in tok)) throw new Error("no value for " + id);
    return J(S[tok[id]]);
  });
  out.plan = JSON.parse(J(vm.runInContext("(function () {\n" + code + "\n})()", sb())));
  const p = only("code_node_LPplan", out.plan);
  const pv = {};
  for (const f of ["code", "lineCount", "message", "payload", "route", "unlockOk"]) pv["node:code_node_LPplan.data." + f] = p[f];
  out.ready = H.runBody(body("code_node_LPready"), Object.assign({ "node:code_node_LPentry.data": e }, pv), "ready");
  return out;
};

// ---- the dispatch plans what a Draft STAGE plans
const d = run(request("STAGE", "Draft", "In Progress"));
const q = run(request("STAGE", "Requested", "In Progress"));
H.eq("STAGE from Draft is READY (the control)", [d.entry.route, d.plan.route, d.ready.job_status], ["GO", "READY", "READY_TO_COMMIT"]);
H.eq("STAGE from Requested is READY", [q.entry.route, q.entry.prevStatus, q.plan.route, q.ready.job_status], ["GO", "Requested", "READY", "READY_TO_COMMIT"]);
const pay = (r) => JSON.parse(r.plan.payload);
H.eq("  the manifest records Requested (what a failure restores)", [pay(q).prevStatus, pay(d).prevStatus], ["Requested", "Draft"]);
const strip = (r) => J(Object.assign(pay(r), { prevStatus: "-" }));
H.eq("  everything else equals the Draft STAGE's plan", strip(q), strip(d));
// the Item date stamp is the run's clock (new Date()): equal up to that
const parts = (r) => J(r.plan.partRows).replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<now>");
H.eq("  and its parts", parts(q), parts(d));
const part = (r, name) => JSON.parse((r.plan.partRows.filter((x) => x.step_name === "P|5e6f7a8b|" + name + "|001")[0] || {}).result_ref || "null");
H.eq("  the dispatch moves the picks to In Transit at the production bin", part(q, "ENGINE").movements.map((m) => [m.direction, m.location_id, m.inventory_category, m.quantity]),
  [["SUBTRACT", SRC, "Unrestricted", 3], ["ADD", DEST, "In Transit", 3], ["SUBTRACT", SRC, "Unrestricted", 1.5], ["ADD", DEST, "In Transit", 1.5],
    ["SUBTRACT", SRC2, "Unrestricted", 0.5], ["ADD", DEST, "In Transit", 0.5]]);
H.eq("  In Transit rows for both lines, the header to In Progress", [[...new Set(part(q, "IT").creates.map((c) => c.doc_line_id))], part(q, "HDR").after],
  [[L1, L2], { stock_movement_status: "In Progress" }]);

// ---- a failed dispatch goes back to Requested
const fq = run(request("STAGE", "Requested", "In Progress"), { unpickedL2: true });
H.eq("a dispatch failing in PREPARE -> FAILED", [fq.plan.route, String(fq.plan.unlockOk), fq.ready.job_status], ["FAIL", "1", "FAILED"]);
H.eq("  the LOT back to Requested", [fq.ready.needUnlock, fq.ready.unlockRows], ["YES", [{ id: LOT, stock_movement_status: "Requested" }]]);
H.eq("  says the line has no stock selected", [fq.plan.code, /line 2 \(Bolt\) has no stock selected/.test(fq.plan.message)], ["LOT_PLAN_FAILED", true]);
H.eq("  its allocation reads cover nothing (spec IA-LT-12)", [q.entry.allocScope, d.entry.allocScope], ["NONE", "EMPTY"]);
// an unpicked line with stock at hand: a Draft STAGE allocates it (as today), a request's dispatch never does
const ad = run(request("STAGE", "Draft", "In Progress"), { unpickedL2: true, stockL2: 5 });
const aq = run(request("STAGE", "Requested", "In Progress"), { unpickedL2: true, stockL2: 5 });
H.eq("an unpicked line with stock: a Draft STAGE allocates it (unchanged)", [ad.plan.route, ad.ready.job_status], ["READY", "READY_TO_COMMIT"]);
H.eq("  a request's dispatch refuses it, back to Requested", [aq.plan.route, aq.plan.code, aq.ready.unlockRows], ["FAIL", "LOT_PLAN_FAILED", [{ id: LOT, stock_movement_status: "Requested" }]]);
const fd = run(request("STAGE", "Draft", "In Progress"), { unpickedL2: true });
H.eq("  (a Draft STAGE with no stock at all: FAILED, back to Draft)", [fd.ready.job_status, fd.ready.unlockRows], ["FAILED", [{ id: LOT, stock_movement_status: "Draft" }]]);
const sq = run(request("STAGE", "Requested", "In Progress"), { correlation: "" });
H.eq("a dispatch job never linked -> FAILED, the LOT back to Requested", [sq.entry.route, sq.ready.job_status, sq.ready.unlockRows],
  ["FAIL", "FAILED", [{ id: LOT, stock_movement_status: "Requested" }]]);

// ---- only a dispatch may restore Requested
for (const [action, saveAs] of [["COMPLETE", "Completed"], ["EDIT", "In Progress"], ["CANCEL", "Cancelled"], ["DIRECT", "Completed"], ["DRAFT", "Draft"]]) {
  const m = run(request(action, "Requested", saveAs));
  H.eq(action + " restoring Requested -> REQUIRES_REVIEW, no unlock", [m.entry.route, m.entry.result_code, m.ready.job_status, m.ready.needUnlock, m.ready.unlockRows],
    ["REVIEW", "LOT_PREV_STATUS_UNKNOWN", "REQUIRES_REVIEW", "NO", []]);
}
const mp = run(request("STAGE", "Requested", "Completed"));
H.eq("a STAGE from Requested to Completed -> FAILED invalid (its lock owned: back to Requested)", [mp.plan.code, mp.ready.job_status, mp.ready.unlockRows],
  ["LOT_INVALID_REQUEST", "FAILED", [{ id: LOT, stock_movement_status: "Requested" }]]);
H.eq("an unknown status to restore -> REQUIRES_REVIEW (unchanged)", run(request("STAGE", "Processing", "In Progress")).ready.job_status, "REQUIRES_REVIEW");

// ---- reserved requests (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 5): a Created IA's dispatch releases the IA's reservation and
// stages the picks in ONE engine operation, release first (the engine's running balance); the rows to cancel go to COMMIT (part RR)
const holdsOf = (rows, status) => [{ j: J({ purpose: "IA_SUPPLY", ia_id: "9700000000000000001", ia_status: status || "Created", rows: rows }) }];
const hrow = (id, line, mat, bin, qty) => ({ id: id, status: "Allocated", doc_line_id: line, material_id: mat, bin_location: bin, batch_id: "", from_category: "Unrestricted",
  open_qty: String(qty), reserved_qty: String(qty), item_uom: UOM, job_line_key: "" });
const IAL1 = "9600000000000000001", IAL2 = "9600000000000000002";
const fullHolds = [hrow("8800000000000000001", IAL1, M1, SRC, 3), hrow("8800000000000000002", IAL2, M2, SRC, 1.5), hrow("8800000000000000003", IAL2, M2, SRC2, 0.5)];
const r1 = run(request("STAGE", "Requested", "In Progress"), { holds: holdsOf(fullHolds) });
H.eq("dispatch: one operation, release before stage", [r1.plan.route, part(r1, "ENGINE").movements.map((m) => [m.direction, m.location_id, m.inventory_category, m.quantity])],
  ["READY", [["SUBTRACT", SRC, "Reserved", 3], ["ADD", SRC, "Unrestricted", 3], ["SUBTRACT", SRC, "Reserved", 1.5], ["ADD", SRC, "Unrestricted", 1.5],
    ["SUBTRACT", SRC2, "Reserved", 0.5], ["ADD", SRC2, "Unrestricted", 0.5],
    ["SUBTRACT", SRC, "Unrestricted", 3], ["ADD", DEST, "In Transit", 3], ["SUBTRACT", SRC, "Unrestricted", 1.5], ["ADD", DEST, "In Transit", 1.5],
    ["SUBTRACT", SRC2, "Unrestricted", 0.5], ["ADD", DEST, "In Transit", 0.5]]]);
H.eq("  the release pairs are category moves at the held keys (isMovingInv 1, priced from their own subtract)",
  part(r1, "ENGINE").movements.slice(0, 6).map((m) => [m.movement_key, m.isMovingInv, m.unit_price_from || ""]),
  [["RR1", 1, ""], ["RR1.2", 1, "RR1"], ["RR2", 1, ""], ["RR2.2", 1, "RR2"], ["RR3", 1, ""], ["RR3.2", 1, "RR3"]]);
H.eq("  the RR part: the IA's rows to cancel under the marker, no bin to count", [part(r1, "RR").kind, part(r1, "RR").cancelRows, part(r1, "RR").marker, part(r1, "RR").countBins],
  ["DISPATCH", fullHolds.map((h) => h.id), "IATR|" + JOB, []]);
H.eq("  labels for the release pairs", [part(r1, "LABELS").RR1.category, part(r1, "LABELS")["RR1.2"].category], ["Reserved", "Unrestricted"]);
const r2 = run(request("STAGE", "Requested", "In Progress"), { holds: holdsOf(fullHolds.slice(0, 2)) });
H.eq("dispatch: holds below requested → IATR_HOLD_STALE, back to Requested", [r2.plan.route, r2.plan.code, r2.ready.unlockRows],
  ["FAIL", "IATR_HOLD_STALE", [{ id: LOT, stock_movement_status: "Requested" }]]);
const r3 = run(request("STAGE", "Requested", "In Progress"), { holds: holdsOf(fullHolds, "Draft") });
H.eq("dispatch of a Draft IA's request (today's logic): no release, plan as before", strip(r3), strip(q));
const lotN = (x) => (Array.isArray(x) ? x : []);
// ---- reserved requests (Task 5): Receive (COMPLETE) of a Created IA's request = the classic COMPLETE (In Transit -> Unrestricted at the
// staging bin), then in the same operation good -> Reserved and defect -> Blocked there; the rows / picks / defects go to COMMIT (part RR)
const FP = require(path.join(REPO, "scratchpad", "smv2", "code", "shared", "fingerprint.js"));
const itRows = part(r1, "IT").creates.map((c, i) => ({ j: J(Object.assign({}, c, { id: "89000000000000" + String(10001 + i), is_deleted: 0 })) }));
const tree = lines(false);
const linesPart = { step_name: "S|0a1b2c3d|LINES|001", result_ref: J({ lotId: LOT, header: {}, stock_movement: tree }) };
const recPart = (rc) => ({ step_name: "S|0a1b2c3d|RECEIPTS|001", result_ref: J({ lotId: LOT, receipts: rc }) });
const creq = (withReceipts) => Object.assign(request("COMPLETE", "In Progress", "Completed"), { incomingFingerprint: FP.lotLineFingerprint(tree),
  parts: Object.assign({ LINES: ["S|0a1b2c3d|LINES|001"] }, withReceipts ? { RECEIPTS: ["S|0a1b2c3d|RECEIPTS|001"] } : {}) });
const rc1 = { [L1]: { good: "2", defect: "1", reason: "R1" }, [L2]: { good: "2", defect: "0" } };
const v1 = run(creq(true), { holds: holdsOf([]), parts: [linesPart, recPart(rc1)], transit: itRows });
const mvs = (r) => part(r, "ENGINE").movements.map((m) => [m.direction, m.location_id, m.inventory_category, m.quantity]);
H.eq("receive: READY; the classic COMPLETE first, then good -> Reserved and defect -> Blocked at the staging bin", [v1.plan.route, v1.plan.code, mvs(v1).slice(-6)],
  ["READY", "200", [["SUBTRACT", DEST, "Unrestricted", 2], ["ADD", DEST, "Reserved", 2], ["SUBTRACT", DEST, "Unrestricted", 1], ["ADD", DEST, "Blocked", 1],
    ["SUBTRACT", DEST, "Unrestricted", 2], ["ADD", DEST, "Reserved", 2]]]);
const rr1 = part(v1, "RR") || {};
H.eq("  the RR part: new rows for the good stock, the IA's picks there, the line defects",
  [rr1.kind, lotN(rr1.newHoldRows).map((h) => [h.doc_line_id, h.bin_location, h.open_qty, h.job_line_key]), Object.keys(rr1.iaPicks || {}).sort(),
    lotN(rr1.lineDefects).map((d) => [d.id, d.defect_qty, d.defect_reason])],
  ["RECEIVE", [[IAL1, DEST, "2", "IATR|" + LOT + "|1"], [IAL2, DEST, "2", "IATR|" + LOT + "|2"]], [IAL1, IAL2].sort(), [[L1, "1", "R1"], [L2, "0", ""]]]);
const v2 = run(creq(false), { holds: holdsOf([]), parts: [linesPart], transit: itRows });
H.eq("receive without receipts (a Created IA's request) -> refused, back to In Progress", [v2.plan.route, v2.plan.code, v2.ready.unlockRows],
  ["FAIL", "IATR_RECEIPT_INVALID", [{ id: LOT, stock_movement_status: "In Progress" }]]);
const v3 = run(creq(false), { holds: holdsOf([], "Draft"), parts: [linesPart], transit: itRows });
H.eq("receive of a Draft IA's request (today's logic): the classic COMPLETE only, no RR part", [v3.plan.route, mvs(v3).some((m) => m[2] === "Reserved"), part(v3, "RR")],
  ["READY", false, null]);

// ---- reserved requests (Task 5, D3): cancel after dispatch of a Created IA's request = the classic reversal, then Unrestricted ->
// Reserved at each picked key, with new rows and the IA's picks there
const c1 = run(request("CANCEL", "In Progress", "Cancelled"), { holds: holdsOf([]), transit: itRows });
H.eq("cancel back: READY; the classic reversal, then Reserved at the picked keys", [c1.plan.route, mvs(c1).slice(-6)],
  ["READY", [["SUBTRACT", SRC, "Unrestricted", 3], ["ADD", SRC, "Reserved", 3], ["SUBTRACT", SRC, "Unrestricted", 1.5], ["ADD", SRC, "Reserved", 1.5],
    ["SUBTRACT", SRC2, "Unrestricted", 0.5], ["ADD", SRC2, "Reserved", 0.5]]]);
const cb = part(c1, "RR") || {};
H.eq("  the RR part: rows at the picked keys", [cb.kind, lotN(cb.newHoldRows).map((h) => [h.bin_location, h.open_qty])],
  ["CANCEL_BACK", [[SRC, "3"], [SRC, "1.5"], [SRC2, "0.5"]]]);
H.eq("the RR parts of Receive and cancel back name the staging bin (COMMIT keeps the IA's picks already there)", [rr1.stagingBin, cb.stagingBin], [DEST, DEST]);
H.done();
