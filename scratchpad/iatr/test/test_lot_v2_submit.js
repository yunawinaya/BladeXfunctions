// LOT_V2_SUBMIT for the IA transfer request (ENH-20261027-001; sources scratchpad/smv2/code/submit, rules
// scratchpad/iatr/code/shared/iatr_rules.js): the BUILT workflow's guard, entry, keys, request check, answer, post and row code
// nodes run through scratchpad/smv2/lib/harness.js, each fed only the keys its predecessor declares (the platform drops the
// rest). IATR_SUBMIT=<file> runs another build (mutants_lot_v2.js).
//   entry  a stored request (purpose IA_SUPPLY): Requested + In Progress -> STAGE from Requested, its number kept; + Draft ->
//          NOT_ELIGIBLE (the classic saves the picks); + Completed / Cancelled -> STOP LOT_REQUEST_MOVE; dispatched: Draft and EDIT
//          refused, Completed -> COMPLETE, Cancelled -> CANCEL even when small; Requested without the purpose -> STOP; ordinary
//          transfers as before
//   keys   an Add / Clone, or an ordinary transfer, carrying the purpose or Requested -> STOP; a dispatch asks for its request read
//   check  a full pick -> GO; short, over, another item / unit, Blocked, the destination bin, a changed line, the IA no longer
//          Draft or changed since the request -> STOP with its code; a receipt of an edited dispatch -> STOP; others -> GO
//   node scratchpad/iatr/test/test_lot_v2_submit.js
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const H = require(path.join(REPO, "scratchpad", "smv2", "lib", "harness.js"));
const R = require(path.join(__dirname, "..", "code", "shared", "iatr_rules.js"));
const FILE = process.env.IATR_SUBMIT || path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_SUBMIT.json");
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const nodes = {};
(function walk(n) {
  if (Array.isArray(n)) n.forEach(walk);
  else if (n && typeof n === "object") {
    if (typeof n.id === "string" && n.type) nodes[n.id] = n;
    Object.values(n).forEach(walk);
  }
})(doc);
const body = (id) => nodes[id].data.script.code;
const declared = (id) => nodes[id].data.response_json.map((r) => r.name);
const only = (id, out) => {
  const o = {};
  for (const k of declared(id)) if (out && k in out) o[k] = out[k];
  return o;
};

const LOT = "2105231525751984129", IA = "2113088440365826050", ORG = "1123598813738675201", PLANT = "1123598813738675202", UOM = "1940", UOM2 = "1941";
const SL = "9100000000000000001", DEST = "9100000000000000002", SRC = "9100000000000000003", SRC2 = "9100000000000000004";
const M1 = "9500000000000000001", M2 = "9500000000000000002", M3 = "9500000000000000003";
const IAL1 = "9600000000000000001", IAL2 = "9600000000000000002", IAL3 = "9600000000000000003";
const L1 = "9700000000000000001", L2 = "9700000000000000002";
const NO = "LOT-2610-001";

// the IA: a stock line with a Required quantity, one with only its BOM reference, a labour line (no stock: no request line)
const iaLines = () => [
  { id: IAL1, item_selection: M1, quantity_uom: UOM, requested_qty: 3, required_qty: 3, sc_ref_key: "", line_index: "1" },
  { id: IAL2, item_selection: M2, quantity_uom: UOM, requested_qty: 2, required_qty: null, sc_ref_key: "", line_index: "2" },
  { id: IAL3, item_selection: M3, quantity_uom: UOM, requested_qty: 1, required_qty: 1, sc_ref_key: "", line_index: "3" },
];
const items = [
  { id: M1, stock_control: 1, serial_number_management: 0, material_name: "Thrust Washer", material_code: "W1" },
  { id: M2, stock_control: 1, serial_number_management: 0, material_name: "Bolt", material_code: "B1" },
  { id: M3, stock_control: 0, serial_number_management: 0, material_name: "Direct Labour", material_code: "DL" },
];
// the IA as the request read returns it: status + the fingerprint's basis
const FG = "9800000000000000001", BOM = "9800000000000000002";
const iaHead = (o) => Object.assign({ status: "Draft", plant: PLANT, item_id: FG, item_qty: 10, planned_output_qty: 10, bom_consumption_mode: "FLAT", source_bom_id: BOM }, o);
const fpOf = (lines, h) => {
  const map = {};
  for (const it of items) map[it.id] = it;
  return R.iatrFingerprint(R.iatrDemand(lines, map).lines, { plant: h.plant, storage: SL, bin: DEST, itemId: h.item_id, itemQty: h.item_qty, plannedQty: h.planned_output_qty,
    mode: h.bom_consumption_mode, bomId: h.source_bom_id });
};
const FP = fpOf(iaLines(), iaHead());
H.truthy("the fixture's demand is two lines", /^IR2:2:[0-9a-f]{16}$/.test(FP), FP);

// the request as stored (code_node_LSiatr's read: one JSON row) and as the form sends it back with the warehouse's picks
const stored = () => [
  { id: L1, item_selection: M1, quantity_uom: UOM, requested_qty: 3, source_ia_line_id: IAL1, storage_location_id: SL, location_id: DEST, line_index: "1" },
  { id: L2, item_selection: M2, quantity_uom: UOM, requested_qty: 2, source_ia_line_id: IAL2, storage_location_id: SL, location_id: DEST, line_index: "2" },
];
const pick = (o) => Object.assign({ material_id: M1, location_id: SRC, category: "Unrestricted", material_uom: UOM, sm_quantity: 3, balance_id: "1", fm_key: "k1",
  unrestricted_qty: 10 }, o);
const fullPicks = () => ({ [L1]: [pick({})], [L2]: [pick({ material_id: M2, sm_quantity: 1.5 }), pick({ material_id: M2, location_id: SRC2, sm_quantity: 0.5, fm_key: "k2" })] });
const formLines = (picks, edit) => stored().map((l, i) => Object.assign({}, l, { item_name: i ? "Bolt" : "Thrust Washer", temp_qty_data: JSON.stringify(picks[l.id] || []),
  temp_hu_data: "[]", total_quantity: (picks[l.id] || []).reduce((a, e) => a + Number(e.sm_quantity), 0), is_serialized_item: 0 }, (edit || {})[l.id] || {}));
const form = (lines, o) => Object.assign({ id: LOT, stock_movement_no: NO, stock_movement_status: "Requested", transfer_purpose: "IA_SUPPLY", source_ia_id: IA,
  organization_id: ORG, issuing_operation_faci: PLANT, is_production_order: 0, stock_movement: lines }, o || {});
const iatrRows = (o, bare) => {
  const j = Object.assign({ lines: stored(), ia: iaHead(), ia_lines: iaLines(), items: items }, o || {});
  const text = JSON.stringify(j);
  // a bigint column reaches the text as a bare number: the node must keep it exact
  return [{ j: bare ? text.replace(/"([0-9]{19})"/g, "$1") : text }];
};
const facts = (o) => Object.assign({ db_now: "2026-10-28 10:00:00", key_job: null, key_lot: null, lot_id: LOT, stock_movement_no: NO, stock_movement_status: "Requested",
  organization_id: ORG, plant_id: PLANT, no_type: "1", movement_type: "Location Transfer", issue_date: "2026-10-28 00:00:00", is_production_order: 0, line_count: 2,
  bundle_children: 0, last_lock: "LOCK|1", open_jobs: null, last_job: null, lot_v2_job_id: null, link_job: null, issued_reuse: 1, transfer_purpose: "IA_SUPPLY",
  source_ia_id: IA, source_ia_fp: FP }, o || {});

const run = (o) => {
  const p = Object.assign({ operation: "SUBMIT", saveAs: "In Progress", pageStatus: "Edit", lot_id: LOT, idempotency_key: "LOT:9:" + LOT + ":abc12345", source: "FORM",
    min_lines: "50", formStatus: "Requested", facts: facts(), form: form(formLines(fullPicks())), iatr: iatrRows(), gate: { edited: 0 } }, o);
  const out = {};
  out.guard = H.runBody(body("code_node_LSguard"), { "workflowparams:operation": p.operation, "workflowparams:saveAs": p.saveAs, "workflowparams:pageStatus": p.pageStatus,
    "workflowparams:lot_id": p.lot_id, "workflowparams:idempotency_key": p.idempotency_key, "workflowparams:source": p.source, "system:tenantId": "711077",
    "system:uid": "7", "system:uuid": "0a1b2c3d-x" }, "guard");
  const g = only("code_node_LSguard", out.guard);
  out.entry = H.runBody(body("code_node_LSentry"), { "node:code_node_LSguard.data": g, "node:sql_node_LSfacts.data": [p.facts],
    "workflowparams:form.stock_movement_status": p.formStatus, "workflowparams:min_lines": p.min_lines }, "entry");
  const e = only("code_node_LSentry", out.entry);
  if (out.entry.route !== "GO") return out;
  out.keys = H.runBody(body("code_node_LSkeys"), { "node:code_node_LSguard.data": g, "node:code_node_LSentry.data": e, "workflowparams:form": p.form }, "keys");
  const k = only("code_node_LSkeys", out.keys);
  if (out.keys.route !== "GO") return out;
  // sql_node_LSiatr reads only when keys asks (its SQL's '<needIatr>' = 'YES' gate): an empty row otherwise
  const rows = k.needIatr === "YES" ? p.iatr : [{ j: null }];
  out.check = H.runBody(body("code_node_LSiatr"), { "node:code_node_LSguard.data": g, "node:code_node_LSentry.data": e, "node:code_node_LSkeys.data": k,
    "node:code_node_LSgate.data": p.gate, "workflowparams:form": p.form, "node:sql_node_LSiatr.data": rows }, "iatr");
  const c = only("code_node_LSiatr", out.check);
  if (out.check.route !== "GO") {
    out.ans = H.runBody(body("code_node_LSiatrres"), { "node:code_node_LSguard.data": g, "node:code_node_LSentry.data": e, "node:code_node_LSiatr.data": c }, "answer");
    return out;
  }
  // the gate's own answer (it prepares the lines part of a COMPLETE / EDIT only)
  const editing = e.action === "COMPLETE" || e.action === "EDIT";
  const gate = Object.assign({ route: "GO", code: "", message: "", errorCode: "", lineCount: 2, rowCount: 3, movementCount: 6, lineFingerprint: "LF1:2:x",
    incomingFingerprint: editing ? "LF1:2:y" : "", partNames: editing ? ["S|0a1b2c3d|LINES|001"] : [], partChunks: editing ? ["{}"] : [] }, p.gate);
  const gv = {};
  for (const f of ["route", "code", "message", "errorCode", "lineCount", "rowCount", "movementCount", "lineFingerprint", "incomingFingerprint", "edited", "partNames"]) {
    gv["node:code_node_LSgate.data." + f] = gate[f];
  }
  out.post = H.runBody(body("code_node_LSpost"), Object.assign({ "node:code_node_LSguard.data": g, "node:code_node_LSentry.data": e, "node:code_node_LSkeys.data": k,
    "node:code_node_LSiatr.data.partNames": c.partNames }, gv), "post");
  out.row = H.runBody(body("code_node_LSrow"), { "node:code_node_LSpost.data": only("code_node_LSpost", out.post), "node:code_node_LSentry.data": e,
    "node:code_node_LSkeys.data.organizationId": k.organizationId, "node:add_node_LSjob.data": [{ id: "2114000000000000001" }],
    "node:code_node_LSgate.data.partNames": gate.partNames, "node:code_node_LSgate.data.partChunks": gate.partChunks,
    "node:code_node_LSiatr.data.partNames": c.partNames, "node:code_node_LSiatr.data.partChunks": c.partChunks }, "row");
  return out;
};
const ent = (r) => ({ route: r.entry.route, action: r.entry.action, prevStatus: r.entry.prevStatus, errorCode: r.entry.errorCode });
const chk = (r) => (r.check ? { route: r.check.route, errorCode: r.check.errorCode } : null);

// ---- declarations: the keys the next nodes read survive the platform
for (const [id, keys] of [["code_node_LSentry", ["purpose", "sourceIaId", "sourceIaFp", "issuedReuse", "prevStatus"]], ["code_node_LSkeys", ["needIatr", "iatrIaId"]],
  ["code_node_LSiatr", ["route", "code", "message", "errorCode"]]]) {
  H.truthy(id + " declares " + keys.join(", "), keys.every((k) => declared(id).indexOf(k) >= 0), declared(id));
}
const facts_sql = nodes.sql_node_LSfacts.data.script.code;
H.truthy("the facts SQL reads the purpose, the source IA and its fingerprint", /g\.transfer_purpose, CAST\(g\.source_ia_id AS CHAR\) AS source_ia_id, g\.source_ia_fp/.test(facts_sql));
H.truthy("the facts SQL keeps a request's number (issued_reuse)", facts_sql.indexOf("+ COALESCE(g.stock_movement_status = 'Requested' AND COALESCE(g.stock_movement_no, '') <> '', 0) AS issued_reuse") >= 0);
const iatr_sql = nodes.sql_node_LSiatr.data.script.code;
H.truthy("the request read returns the IA's fingerprint basis", ["'plant', CAST(h.issuing_operation_faci AS CHAR)", "'item_id', CAST(h.item_id AS CHAR)", "'item_qty', h.item_qty",
  "'planned_output_qty', h.planned_output_qty", "'bom_consumption_mode', h.bom_consumption_mode", "'source_bom_id', CAST(h.source_bom_id AS CHAR)"].every((x) => iatr_sql.indexOf(x) > 0));
H.truthy("the request read runs only when keys asks, for keys' IA",iatr_sql.split("'{{node:code_node_LSkeys.data.needIatr}}' = 'YES'").length === 5
  && iatr_sql.indexOf("{{node:code_node_LSkeys.data.iatrIaId}}") > 0);
H.eq("the request check stops the save before the post", nodes.if_LSiatrEnd.data.expression.code, "'{{node:code_node_LSiatr.data.route}}' != 'GO'");

// ---- entry: the moves of a request
let r = run({});
H.eq("Requested + In Progress -> STAGE from Requested", ent(r), { route: "GO", action: "STAGE", prevStatus: "Requested", errorCode: "" });
H.eq("  its purpose, source IA and fingerprint carried", [r.entry.purpose, r.entry.sourceIaId, r.entry.sourceIaFp, r.entry.issuedReuse], ["YES", IA, FP, "YES"]);
H.eq("  keys asks for the request read", [r.keys.route, r.keys.needIatr, r.keys.iatrIaId], ["GO", "YES", IA]);
H.eq("  full picks -> the check goes on", chk(r), { route: "GO", errorCode: "" });
const req = JSON.parse(r.post.request);
H.eq("  the job: STAGE, restores Requested, In Progress", [r.post.route, req.action, req.prevStatus, req.saveAs], ["QUEUE", "STAGE", "Requested", "In Progress"]);
H.eq("  the number is kept: no number props, the no-number write", [r.post.numberProps, r.row.writeNumber, r.row.writeNoNumber], ["NO", "NO", "YES"]);
H.eq("Requested + In Progress, ids as bare numbers in the read -> goes on", chk(run({ iatr: iatrRows({}, true) })), { route: "GO", errorCode: "" });

r = run({ saveAs: "Draft" });
H.eq("Requested + Draft (Save Picks) -> NOT_ELIGIBLE: the classic saves the picks", [r.entry.route, r.entry.code, r.entry.errorCode, r.entry.reason],
  ["NOT_ELIGIBLE", "300", "LOT_NOT_ELIGIBLE", "a transfer request's picks are saved by the classic save"]);
H.eq("Requested + Draft with 830 lines -> still NOT_ELIGIBLE (the classic Draft takes any size)", run({ saveAs: "Draft", facts: facts({ line_count: 830 }) }).entry.route, "NOT_ELIGIBLE");
H.eq("Requested + Completed -> STOP", ent(run({ saveAs: "Completed" })), { route: "STOP", action: "", prevStatus: "", errorCode: "LOT_REQUEST_MOVE" });
r = run({ saveAs: "Cancelled" });
H.eq("Requested + Cancelled -> STOP, names Cancel Request", [r.entry.route, r.entry.code, r.entry.errorCode, /Cancel Request/.test(r.entry.message)],
  ["STOP", "400", "LOT_REQUEST_MOVE", true]);
H.eq("Requested without the purpose + In Progress -> STOP", ent(run({ facts: facts({ transfer_purpose: null }) })).errorCode, "LOT_REQUEST_MOVE");
H.eq("Requested without the purpose + Draft -> STOP", ent(run({ saveAs: "Draft", facts: facts({ transfer_purpose: "" }) })).errorCode, "LOT_REQUEST_MOVE");
H.eq("Requested, purpose in another case -> not the purpose -> STOP", ent(run({ facts: facts({ transfer_purpose: "ia_supply" }) })).errorCode, "LOT_REQUEST_MOVE");
H.eq("a request open in a stale tab (form Draft) -> STALE", ent(run({ formStatus: "Draft" })).route, "STALE");
H.eq("a request being dispatched (Processing) -> BUSY", ent(run({ formStatus: "Processing", facts: facts({ stock_movement_status: "Processing" }) })).route, "BUSY");

const ip = (o) => facts(Object.assign({ stock_movement_status: "In Progress" }, o));
H.eq("dispatched + In Progress (edit) -> STOP", ent(run({ formStatus: "In Progress", facts: ip() })).errorCode, "LOT_REQUEST_MOVE");
H.eq("dispatched + Draft -> STOP", ent(run({ saveAs: "Draft", formStatus: "In Progress", facts: ip() })).errorCode, "LOT_REQUEST_MOVE");
r = run({ saveAs: "Completed", formStatus: "In Progress", facts: ip(), form: form(formLines(fullPicks()), { stock_movement_status: "In Progress" }) });
H.eq("dispatched + Completed (Receive) -> COMPLETE", ent(r), { route: "GO", action: "COMPLETE", prevStatus: "In Progress", errorCode: "" });
H.eq("  as dispatched (a Draft IA's request) -> the request read (mode RECEIVE), goes on, no receipts needed", [r.keys.needIatr, r.keys.iatrMode, chk(r).route, r.post.route],
  ["YES", "RECEIVE", "GO", "QUEUE"]);
r = run({ saveAs: "Completed", formStatus: "In Progress", facts: ip(), form: form(formLines(fullPicks()), { stock_movement_status: "In Progress" }), gate: { edited: 1 } });
H.eq("  edited -> STOP", [chk(r).route, r.check.code, r.check.errorCode, /can't be edited/.test(r.check.message)], ["STOP", "400", "LOT_REQUEST_MOVE", true]);
H.eq("  its answer to the form", [r.ans.route, r.ans.code, r.ans.error_code, r.ans.action], ["STOP", "400", "LOT_REQUEST_MOVE", "COMPLETE"]);
r = run({ saveAs: "Cancelled", source: "LIST", formStatus: "In Progress", facts: ip() });
H.eq("dispatched + Cancelled, 2 lines, min_lines 50 -> CANCEL in the background (never the classic)", ent(r), { route: "GO", action: "CANCEL", prevStatus: "In Progress", errorCode: "" });
H.eq("  goes on to the post", [chk(r).route, r.post.route], ["GO", "QUEUE"]);

// ---- ordinary transfers: as before
const plain = (o) => facts(Object.assign({ transfer_purpose: null, source_ia_id: null, source_ia_fp: null, issued_reuse: 0 }, o));
const pform = (o) => form(formLines(fullPicks()), Object.assign({ transfer_purpose: "", source_ia_id: "", stock_movement_status: "Draft" }, o));
r = run({ formStatus: "Draft", facts: plain({ stock_movement_status: "Draft" }), form: pform() });
H.eq("ordinary Draft + In Progress -> STAGE from Draft", ent(r), { route: "GO", action: "STAGE", prevStatus: "Draft", errorCode: "" });
H.eq("  purpose NO, no request read, a number written", [r.entry.purpose, r.keys.needIatr, r.keys.iatrIaId, chk(r).route, r.post.numberProps, r.row.writeNumber],
  ["NO", "NO", "0", "GO", "YES", "YES"]);
H.eq("ordinary Draft + Draft -> DRAFT", ent(run({ saveAs: "Draft", formStatus: "Draft", facts: plain({ stock_movement_status: "Draft" }), form: pform() })).action, "DRAFT");
H.eq("ordinary In Progress + Cancelled, 2 lines, min_lines 50 -> NOT_ELIGIBLE classic", [ent(run({ saveAs: "Cancelled", source: "LIST", formStatus: "In Progress",
  facts: plain({ stock_movement_status: "In Progress" }) })).route], ["NOT_ELIGIBLE"]);
r = run({ formStatus: "In Progress", facts: plain({ stock_movement_status: "In Progress" }), form: pform({ stock_movement_status: "In Progress" }) });
H.eq("ordinary In Progress + In Progress -> EDIT", ent(r), { route: "GO", action: "EDIT", prevStatus: "In Progress", errorCode: "" });
r = run({ saveAs: "Completed", formStatus: "In Progress", facts: plain({ stock_movement_status: "In Progress" }), form: pform({ stock_movement_status: "In Progress" }), gate: { edited: 1 } });
H.eq("ordinary edited COMPLETE -> goes on", [ent(r).action, chk(r).route], ["COMPLETE", "GO"]);
H.eq("  no request read; its request names the LINES part only", [r.keys.needIatr, JSON.parse(r.post.request).parts, r.post.partCount, r.row.partRows.length],
  ["NO", { LINES: ["S|0a1b2c3d|LINES|001"] }, 1, 1]);
r = run({ formStatus: "Draft", facts: plain({ stock_movement_status: "Draft" }), form: pform({ stock_movement_status: "Requested" }) });
H.eq("ordinary Draft whose form claims Requested -> STOP", [ent(r).route, r.keys.errorCode], ["GO", "LOT_REQUEST_MOVE"]);

// ---- keys: a claim no stored row backs
const add = (o) => run(Object.assign({ pageStatus: "Add", lot_id: "", formStatus: "", facts: plain({ lot_id: null, stock_movement_status: null, stock_movement_no: null }) }, o));
H.eq("Add carrying the purpose, Draft -> STOP", [add({ saveAs: "Draft", form: form(formLines(fullPicks()), { id: "", stock_movement_status: "" }) }).keys.errorCode], ["LOT_REQUEST_MOVE"]);
H.eq("Add carrying the purpose, In Progress -> STOP", add({ form: form(formLines(fullPicks()), { id: "", stock_movement_status: "" }) }).keys.errorCode, "LOT_REQUEST_MOVE");
H.eq("Add carrying Requested -> STOP", add({ form: pform({ id: "", stock_movement_status: "Requested" }) }).keys.errorCode, "LOT_REQUEST_MOVE");
H.eq("Clone of a request -> STOP", add({ pageStatus: "Clone", form: form(formLines(fullPicks()), { id: "" }) }).keys.errorCode, "LOT_REQUEST_MOVE");
r = add({ form: pform({ id: "", stock_movement_status: "" }) });
H.eq("an ordinary Add -> goes on, no request read", [r.entry.action, r.keys.route, r.keys.needIatr, chk(r).route], ["STAGE", "GO", "NO", "GO"]);
H.eq("ordinary Draft carrying the purpose -> STOP", run({ formStatus: "Draft", facts: plain({ stock_movement_status: "Draft" }), form: pform({ transfer_purpose: "IA_SUPPLY" }) }).keys.errorCode,
  "LOT_REQUEST_MOVE");

// ---- the dispatch check
const stop = (o) => chk(run(o));
const picks = (f) => {
  const p = fullPicks();
  f(p);
  return form(formLines(p));
};
H.eq("a line short -> STOP NOT_FULL", stop({ form: picks((p) => p[L2].pop()) }), { route: "STOP", errorCode: "IATR_NOT_FULL" });
r = run({ form: picks((p) => p[L2].pop()) });
H.eq("  names the line and the figures", r.check.message, "Line 2 (Bolt): picked 1.5 of 2. Every line must be picked in full before the dispatch.");
H.eq("  the form's answer", [r.ans.route, r.ans.code, r.ans.error_code, r.ans.action], ["STOP", "400", "IATR_NOT_FULL", "STAGE"]);
H.eq("a line over-picked -> STOP NOT_FULL", stop({ form: picks((p) => (p[L1][0].sm_quantity = 3.5)) }).errorCode, "IATR_NOT_FULL");
H.eq("a line not picked at all -> STOP NOT_FULL", stop({ form: picks((p) => (p[L1] = [])) }).errorCode, "IATR_NOT_FULL");
H.eq("a pick at the destination bin -> STOP", stop({ form: picks((p) => (p[L2][1].location_id = DEST)) }).errorCode, "IATR_PICK_AT_DESTINATION");
H.eq("a Blocked pick -> STOP", stop({ form: picks((p) => (p[L1][0].category = "Blocked")) }).errorCode, "IATR_PICK_CATEGORY");
H.eq("a pick of another item -> STOP", stop({ form: picks((p) => (p[L1][0].material_id = M2)) }).errorCode, "IATR_PICK_ITEM");
H.eq("a pick in another unit -> STOP", stop({ form: picks((p) => (p[L1][0].material_uom = UOM2)) }).errorCode, "IATR_PICK_UOM");
r = run({ form: picks((p) => (p[L1][0].handling_unit_id = "8800000000000000001")) });
H.eq("an HU pick -> NOT_ELIGIBLE before the check (the form shows why)", [r.keys.route, r.keys.why, r.check], ["NOT_ELIGIBLE", "it has handling units", undefined]);
H.eq("a requested quantity changed in the form -> STOP DEMAND_CHANGED", stop({ form: form(formLines(fullPicks(), { [L1]: { requested_qty: 4 } })) }).errorCode, "IATR_DEMAND_CHANGED");
H.eq("a destination bin changed in the form -> STOP DEMAND_CHANGED", stop({ form: form(formLines(fullPicks(), { [L2]: { location_id: SRC2 } })) }).errorCode, "IATR_DEMAND_CHANGED");
H.eq("a line removed in the form -> STOP DEMAND_CHANGED", stop({ form: form(formLines(fullPicks()).slice(0, 1)) }).errorCode, "IATR_DEMAND_CHANGED");
H.eq("a line added in the form -> STOP DEMAND_CHANGED", stop({ form: form(formLines(fullPicks()).concat([Object.assign({}, formLines(fullPicks())[0], { id: "" })])) }).errorCode,
  "IATR_DEMAND_CHANGED");
H.eq("the IA was completed meanwhile -> STOP IA_STATUS", stop({ iatr: iatrRows({ ia: iaHead({ status: "Completed" }) }) }).errorCode, "IATR_IA_STATUS");
H.eq("the IA is gone -> STOP IA_STATUS", stop({ iatr: iatrRows({ ia: null }) }).errorCode, "IATR_IA_STATUS");
H.eq("no source IA on the request -> STOP IA_STATUS (nothing read)", stop({ facts: facts({ source_ia_id: null }), iatr: iatrRows({ ia: null, ia_lines: null, items: null }) }).errorCode,
  "IATR_IA_STATUS");
const changedIa = iaLines();
changedIa[0].required_qty = 4;
H.eq("the IA's materials changed since the request -> STOP STALE", stop({ iatr: iatrRows({ ia_lines: changedIa }) }).errorCode, "IATR_STALE");
H.eq("the IA gained a line -> STOP STALE", stop({ iatr: iatrRows({ ia_lines: iaLines().concat([Object.assign({}, iaLines()[0], { id: "9600000000000000009" })]) }) }).errorCode, "IATR_STALE");
H.eq("the IA's plant changed -> STOP STALE", stop({ iatr: iatrRows({ ia: iaHead({ plant: "1123598813738675299" }) }) }).errorCode, "IATR_STALE");
H.eq("the IA's output quantity changed -> STOP STALE", stop({ iatr: iatrRows({ ia: iaHead({ item_qty: 12 }) }) }).errorCode, "IATR_STALE");
H.eq("the IA's planned output changed -> STOP STALE", stop({ iatr: iatrRows({ ia: iaHead({ planned_output_qty: 8 }) }) }).errorCode, "IATR_STALE");
H.eq("the IA's finished item changed -> STOP STALE", stop({ iatr: iatrRows({ ia: iaHead({ item_id: "9800000000000000009" }) }) }).errorCode, "IATR_STALE");
H.eq("the IA's BOM mode changed -> STOP STALE", stop({ iatr: iatrRows({ ia: iaHead({ bom_consumption_mode: "STANDARD" }) }) }).errorCode, "IATR_STALE");
H.eq("the IA's BOM changed -> STOP STALE", stop({ iatr: iatrRows({ ia: iaHead({ source_bom_id: "9800000000000000003" }) }) }).errorCode, "IATR_STALE");
H.eq("the IA's output read as text \"10.00000000\" -> the same basis, goes on", stop({ iatr: iatrRows({ ia: iaHead({ item_qty: "10.00000000" }) }) }), { route: "GO", errorCode: "" });
const blank = iaLines();
blank[1].requested_qty = 0;
H.eq("the IA's demand no longer valid -> STOP STALE", stop({ iatr: iatrRows({ ia_lines: blank }) }).errorCode, "IATR_STALE");
H.eq("the request has no fingerprint -> STOP STALE", stop({ facts: facts({ source_ia_fp: null }) }).errorCode, "IATR_STALE");
H.eq("the labour line's change is not the demand -> goes on", stop({ iatr: iatrRows({ ia_lines: iaLines().map((l) => (l.id === IAL3 ? Object.assign(l, { required_qty: 9 }) : l)) }) }),
  { route: "GO", errorCode: "" });
// a stale tab saved the pre-refresh lines back under the refreshed fingerprint: the fingerprints agree, the stored lines don't
const before = stored().map((l) => (l.id === L1 ? Object.assign({}, l, { requested_qty: 2 }) : l));
const beforePicks = fullPicks();
beforePicks[L1][0].sm_quantity = 2;
H.eq("stored lines that are not the IA's demand now (fingerprints equal) -> STOP LINES_STALE", stop({ iatr: iatrRows({ lines: before }),
  form: form(formLines(beforePicks, { [L1]: { requested_qty: 2 } })) }).errorCode, "IATR_LINES_STALE");
H.eq("an unreadable request read -> STOP (never a blind dispatch)", stop({ iatr: [{ j: "{not json" }] }).route, "STOP");

// ---- reserved requests (RESERVED_REQUEST_PLAN.md Task 6): a Created IA's request - the dispatch swaps its reservation, the Receive
// carries good / defect per line (the RECEIPTS part PREPARE splits on), a cancel after dispatch goes back reserved (PREPARE)
const created = (o) => iaHead(Object.assign({ status: "Created" }, o));
const hold = (id, line, m, bin, qty, o) => Object.assign({ id: id, status: "Allocated", doc_line_id: line, material_id: m, bin_location: bin, batch_id: null,
  from_category: "Unrestricted", open_qty: String(qty), item_uom: UOM, job_line_key: "" }, o || {});
const holds = () => [hold("h1", IAL1, M1, SRC, 3), hold("h2", IAL2, M2, SRC, 1.5), hold("h3", IAL2, M2, SRC2, 0.5)];
const rrRows = (o) => iatrRows(Object.assign({ ia: created(), holds: holds() }, o));
r = run({ iatr: rrRows() });
H.eq("reserved dispatch: picked in full, the reservation as requested -> the read (mode DISPATCH), goes on", [r.keys.needIatr, r.keys.iatrMode, chk(r)],
  ["YES", "DISPATCH", { route: "GO", errorCode: "" }]);
H.eq("  picked away from the reservation (D9) -> goes on", chk(run({ iatr: rrRows({ holds: [hold("h1", IAL1, M1, SRC2, 3), hold("h2", IAL2, M2, SRC2, 2)] }) })),
  { route: "GO", errorCode: "" });
H.eq("reserved dispatch: the reservation below what is requested -> STOP IATR_HOLD_STALE", stop({ iatr: rrRows({ holds: holds().slice(0, 2) }) }).errorCode, "IATR_HOLD_STALE");
H.eq("  a hold released meanwhile -> STOP IATR_HOLD_STALE", stop({ iatr: rrRows({ holds: holds().map((h) => (h.id === "h1" ? Object.assign(h, { status: "Cancelled" }) : h)) }) }).errorCode,
  "IATR_HOLD_STALE");
H.eq("reserved dispatch: a line short -> STOP IATR_PICKS_SHORT", stop({ iatr: rrRows(), form: picks((p) => p[L2].pop()) }).errorCode, "IATR_PICKS_SHORT");
H.eq("reserved dispatch: a requested quantity changed in the form -> STOP DEMAND_CHANGED", stop({ iatr: rrRows(), form: form(formLines(fullPicks(), { [L1]: { requested_qty: 4 } })) })
  .errorCode, "IATR_DEMAND_CHANGED");
H.eq("reserved dispatch: a line removed in the form -> STOP DEMAND_CHANGED", stop({ iatr: rrRows(), form: form(formLines(fullPicks()).slice(0, 1)) }).errorCode, "IATR_DEMAND_CHANGED");
H.eq("reserved dispatch: a Blocked pick -> STOP", stop({ iatr: rrRows(), form: picks((p) => (p[L1][0].category = "Blocked")) }).errorCode, "IATR_PICK_CATEGORY");
H.eq("reserved dispatch: a pick at the destination bin -> STOP", stop({ iatr: rrRows(), form: picks((p) => (p[L2][1].location_id = DEST)) }).errorCode, "IATR_PICK_AT_DESTINATION");
H.eq("reserved dispatch: a pick of another item -> STOP", stop({ iatr: rrRows(), form: picks((p) => (p[L1][0].material_id = M2)) }).errorCode, "IATR_PICK_ITEM");
H.eq("reserved dispatch: a pick in another unit -> STOP", stop({ iatr: rrRows(), form: picks((p) => (p[L1][0].material_uom = UOM2)) }).errorCode, "IATR_PICK_UOM");
H.eq("a replacement's dispatch (D6): the IA's stock already at the staging bin stays out of the swap -> goes on",
  chk(run({ iatr: rrRows({ holds: holds().concat([hold("h9", IAL1, M1, DEST, 6, { job_line_key: "IATR|1|1" })]) }) })), { route: "GO", errorCode: "" });
H.eq("the IA no longer Created or Draft -> STOP IA_STATUS", stop({ iatr: rrRows({ ia: created({ status: "Completed" }) }) }).errorCode, "IATR_IA_STATUS");
H.eq("the read asks for the IA's holds on a dispatch only", [iatr_sql.indexOf("FROM on_reserved_gd r") > 0,
  iatr_sql.indexOf("WHERE '{{node:code_node_LSkeys.data.iatrMode}}' = 'DISPATCH' AND r.tenant_id") > 0], [true, true]);
H.eq("  and the stored picks (the Receive is checked against them)", iatr_sql.indexOf("'temp_qty_data', l.temp_qty_data") > 0, true);

const dispatched = () => stored().map((l) => Object.assign({}, l, { temp_qty_data: JSON.stringify(fullPicks()[l.id]) }));
const recv = (receipts, o) => run(Object.assign({ saveAs: "Completed", formStatus: "In Progress", facts: ip(), iatr: rrRows({ lines: dispatched() }),
  form: form(formLines(fullPicks()), { stock_movement_status: "In Progress", iatr_receipts: receipts }) }, o));
const good = () => ({ [L1]: { good: "3", defect: "0" }, [L2]: { good: 1.5, defect: "0.5", reason: "Damaged" } });
r = recv(good());
H.eq("reserved Receive: the read (mode RECEIVE); good + defect as dispatched, the defect's reason -> goes on", [r.keys.needIatr, r.keys.iatrMode, chk(r)],
  ["YES", "RECEIVE", { route: "GO", errorCode: "" }]);
const rq = JSON.parse(r.post.request);
H.eq("  the request names the RECEIPTS part after the LINES part, both counted", [rq.parts, r.post.partCount],
  [{ LINES: ["S|0a1b2c3d|LINES|001"], RECEIPTS: ["S|0a1b2c3d|RECEIPTS|001"] }, 2]);
H.eq("  the job writes both parts", r.row.partRows.map((x) => x.step_name), ["S|0a1b2c3d|LINES|001", "S|0a1b2c3d|RECEIPTS|001"]);
H.eq("  the RECEIPTS part: this transfer and its receipts per stored line (quantities as text)", JSON.parse(r.row.partRows[1].result_ref),
  { lotId: LOT, receipts: { [L1]: { good: "3", defect: "0", reason: "" }, [L2]: { good: "1.5", defect: "0.5", reason: "Damaged" } } });
H.eq("reserved Receive: a defect without a reason -> STOP IATR_DEFECT_REASON", chk(recv({ [L1]: { good: "3", defect: "0" }, [L2]: { good: "1.5", defect: "0.5" } })).errorCode,
  "IATR_DEFECT_REASON");
H.eq("  a reason longer than its column -> STOP IATR_DEFECT_REASON", chk(recv({ [L1]: { good: "3", defect: "0" }, [L2]: { good: "1.5", defect: "0.5", reason: "x".repeat(256) } }))
  .errorCode, "IATR_DEFECT_REASON");
H.eq("reserved Receive: good + defect not what was dispatched -> STOP IATR_RECEIPT_INVALID", chk(recv({ [L1]: { good: "2", defect: "0" }, [L2]: { good: "2", defect: "0" } })).errorCode,
  "IATR_RECEIPT_INVALID");
H.eq("reserved Receive: no receipts -> STOP IATR_RECEIPT_INVALID", chk(recv(undefined)).errorCode, "IATR_RECEIPT_INVALID");
H.eq("reserved Receive: a line without its receipt -> STOP IATR_RECEIPT_INVALID", chk(recv({ [L1]: { good: "3", defect: "0" } })).errorCode, "IATR_RECEIPT_INVALID");
H.eq("reserved Receive of an edited dispatch -> STOP (as before)", chk(recv(good(), { gate: { edited: 1 } })).errorCode, "LOT_REQUEST_MOVE");
r = recv(undefined, { iatr: iatrRows({ lines: dispatched() }) });
H.eq("a Draft IA's request (today's logic): received as dispatched, no receipts, the LINES part only", [chk(r).route, JSON.parse(r.post.request).parts, r.post.partCount],
  ["GO", { LINES: ["S|0a1b2c3d|LINES|001"] }, 1]);
r = run({ saveAs: "Cancelled", source: "LIST", formStatus: "In Progress", facts: ip(), iatr: rrRows({ lines: dispatched() }) });
H.eq("reserved cancel after dispatch -> CANCEL in the background (PREPARE returns it reserved), no request read", [ent(r).action, r.keys.needIatr, chk(r).route, r.post.route],
  ["CANCEL", "NO", "GO", "QUEUE"]);

// ---- ordinary transfers: every node but the request's five == the deployed v6 (keys aside: a build's keys depend on the build run)
const strip = (n) => (Array.isArray(n) ? n.map(strip) : n && typeof n === "object" ? Object.fromEntries(Object.keys(n).filter((k) => k !== "key").map((k) => [k, strip(n[k])])) : n);
const byIdOf = (d) => {
  const o = {};
  (function w(n) {
    if (Array.isArray(n)) n.forEach(w);
    else if (n && typeof n === "object") {
      if (typeof n.id === "string" && n.type) o[n.id] = n;
      Object.values(n).forEach(w);
    }
  })(d.nodes);
  return o;
};
const now6 = byIdOf(strip(doc));
const v6 = byIdOf(strip(JSON.parse(fs.readFileSync(path.join(REPO, "scratchpad", "iatr", "base", "rr_LOT_V2_SUBMIT_v6.json"), "utf8"))));
const own = (n) => JSON.stringify(Object.assign({}, n, { blocks: undefined }));
H.eq("the build has v6's nodes; only the request's read, keys, check, post and row differ", [Object.keys(now6).length === Object.keys(v6).length,
  Object.keys(now6).filter((id) => !v6[id] || own(now6[id]) !== own(v6[id])).sort()],
  [true, ["code_node_LSiatr", "code_node_LSkeys", "code_node_LSpost", "code_node_LSrow", "sql_node_LSiatr"]]);
H.done();
