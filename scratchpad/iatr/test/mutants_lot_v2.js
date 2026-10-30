// node scratchpad/iatr/test/mutants_lot_v2.js - each mutant of the built LOT_V2_SUBMIT / LOT_V2_PREPARE (the IA transfer request's
// changes) must make test_lot_v2_submit.js / test_lot_v2_prepare.js fail. "all" = every inlined copy of the anchor.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..", "..");
const BUILT = path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2");
const J = (s) => JSON.stringify(s).slice(1, -1);
const TARGET = {
  SUBMIT: { file: "LOT_V2_SUBMIT.json", env: "IATR_SUBMIT", test: "test_lot_v2_submit.js" },
  PREPARE: { file: "LOT_V2_PREPARE.json", env: "IATR_PREPARE", test: "test_lot_v2_prepare.js" },
  COMMIT: { file: "LOT_V2_COMMIT.json", env: "IATR_COMMIT", test: "test_lot_v2_commit.js" },
  WORKER: { file: "LOT_V2_WORKER.json", env: "IATR_WORKER", test: "test_lot_v2_commit.js" },
  // L3_RESERVATION's entry flag and wiring in the built COMMIT (its logic: mutants_lot_v2_l3r.js on l3r.js)
  COMMIT_L3R: { file: "LOT_V2_COMMIT.json", env: "IATR_COMMIT", test: "test_lot_v2_commit_l3r.js" },
};
const MUTANTS = [
  ["SUBMIT", "a dispatch restores Draft", J('if (rq.decision === "DISPATCH") return pick("STAGE", "Requested");'), J('if (rq.decision === "DISPATCH") return pick("STAGE", "Draft");')],
  ["SUBMIT", "no dispatch branch", J('if (rq.decision === "DISPATCH") return pick("STAGE", "Requested");'), ""],
  ["SUBMIT", "a refused move goes on", J('if (rq.decision === "REFUSE") return'), J('if (rq.decision === "NEVER") return')],
  ["SUBMIT", "Save Picks taken by V2", J('if (rq.decision === "SAVE") return Object.assign(base, notEligible('), J('if (rq.decision === "SAVE") return pick("DRAFT", "Draft") || Object.assign(base, notEligible(')],
  ["SUBMIT", "a request's small cancel goes classic", J(' && num(f.bundle_children) === 0 && base.purpose !== "YES") {'), J(" && num(f.bundle_children) === 0) {")],
  ["SUBMIT", "the purpose never read", J('purpose: s(f.transfer_purpose) === IATR_PURPOSE ? "YES" : "NO"'), J('purpose: "NO"')],
  ["SUBMIT", "the stored purpose ignored", J("storedPurpose: s(f.transfer_purpose), saveAs: saveAs, hasStored: true"), J('storedPurpose: "", saveAs: saveAs, hasStored: true')],
  ["SUBMIT", "the source IA not carried", J("sourceIaId: s(f.source_ia_id)"), J('sourceIaId: ""')],
  ["SUBMIT", "a claim no stored row backs goes on", J('if (claim.decision === "REFUSE")'), J('if (claim.decision === "NEVER")')],
  ["SUBMIT", "the payload's purpose ignored", J("payloadPurpose: form.transfer_purpose,"), J('payloadPurpose: "",')],
  ["SUBMIT", "the payload's status ignored", J("payloadStatus: form.stock_movement_status });"), J('payloadStatus: "" });')],
  ["SUBMIT", "a dispatch reads no request", J('base.needIatr = "YES";'), J('base.needIatr = "NO";')],
  ["SUBMIT", "the read asks for no IA", J('base.iatrIaId = digits(entry.sourceIaId) ? s(entry.sourceIaId) : "0";'), J('base.iatrIaId = "0";')],
  ["SUBMIT", "the read asked for Draft STAGEs", J('(entry.action === "STAGE" && entry.prevStatus === "Requested")'), J('(entry.action === "STAGE" && entry.prevStatus === "Draft")')],
  // reserved requests (RESERVED_REQUEST_PLAN.md Task 6)
  ["SUBMIT", "a receipt asks for no read", J(' || (entry.action === "COMPLETE" && entry.prevStatus === "In Progress")'), J("")],
  ["SUBMIT", "a receipt read as a dispatch", J('base.iatrMode = entry.action === "STAGE" ? "DISPATCH" : "RECEIVE";'), J('base.iatrMode = "DISPATCH";')],
  ["SUBMIT", "a Created IA's dispatch takes the Draft check", J('if (s(ia.status) === "Created") {\n    const c = rrDispatchCheck('), J('if (false) {\n    const c = rrDispatchCheck(')],
  ["SUBMIT", "the receipts not checked", J("    if (!rv.ok) return stop(rv.message, rv.code);\n"), J("")],
  ["SUBMIT", "a long reason passes", J("if (long >= 0) return stop("), J("if (false) return stop(")],
  ["SUBMIT", "the RECEIPTS part not named", J("parts: editing ? (receiptNames.length ? { LINES: lineNames, RECEIPTS: receiptNames } : { LINES: lineNames }) : {} };"),
    J("parts: editing ? { LINES: lineNames } : {} };")],
  ["SUBMIT", "the RECEIPTS part not written", J(".concat(list([{{node:code_node_LSiatr.data.partNames}}][0]))"), J("")],
  ["SUBMIT", "the holds read on every mode", J("WHERE '{{node:code_node_LSkeys.data.iatrMode}}' = 'DISPATCH' AND r.tenant_id"), J("WHERE r.tenant_id")],
  ["SUBMIT", "the dispatched picks not read", J("'line_index', l.line_index, 'temp_qty_data', l.temp_qty_data))"), J("'line_index', l.line_index))")],
  ["SUBMIT", "the check skipped", J('if (s(entry.purpose) !== "YES") return go;'), J('if (s(entry.purpose) !== "YES" || true) return go;')],
  ["SUBMIT", "an edited receipt goes on", J("num(gate.edited) === 1"), J("num(gate.edited) === 2")],
  ["SUBMIT", "the check without its read", J('if (s(keys.needIatr) !== "YES") return go;'), J('if (s(keys.needIatr) !== "NO") return go;')],
  ["SUBMIT", "the request's fingerprint never compared", J("lotFp: s(entry.sourceIaFp)"), J("lotFp: iaFp")],
  ["SUBMIT", "the fingerprint's destination swapped", J("storage: dest.storage_location_id, bin: dest.location_id,"), J("storage: dest.location_id, bin: dest.storage_location_id,")],
  ["SUBMIT", "the fingerprint without the plant", J("iatrFingerprint(demand.lines, { plant: ia.plant,"), J("iatrFingerprint(demand.lines, { plant: \"\",")],
  ["SUBMIT", "the fingerprint without the output basis", J("itemQty: ia.item_qty, plannedQty: ia.planned_output_qty, mode: ia.bom_consumption_mode, bomId: ia.source_bom_id }"), J("}")],
  ["SUBMIT", "the request read without the basis", J("'item_qty', h.item_qty, 'planned_output_qty', h.planned_output_qty,"), J("'item_qty', NULL, 'planned_output_qty', NULL,")],
  ["PREPARE", "a dispatch auto-allocates", J('const scope = prev === "Requested" ? "NONE" : {'), J('const scope = prev === "Requested_" ? "NONE" : {')],
  ["SUBMIT", "the IA's demand now not compared", J("demand: demand.ok ? demand.lines : null"), J("demand: null")],
  ["SUBMIT", "the IA's status ignored", J("iaStatus: ia.status"), J('iaStatus: "Draft"')],
  ["SUBMIT", "the picks read from the stored lines", J("const incoming = flatOf(form && form.stock_movement);"), J("const incoming = stored;")],
  ["SUBMIT", "bare ids rounded", J('const r = (typeof row.j === "string" ? iatrParseObj(row.j) : row.j) || {};'),
    J('const r = (typeof row.j === "string" ? JSON.parse(row.j.replace(/^\\{not json$/, "{}")) : row.j) || {};')],
  ["SUBMIT", "a request's number re-issued", J("\n         + COALESCE(g.stock_movement_status = 'Requested' AND COALESCE(g.stock_movement_no, '') <> '', 0) AS issued_reuse"), J(" AS issued_reuse")],
  ["SUBMIT", "the request read ungated", J("WHERE '{{node:code_node_LSkeys.data.needIatr}}' = 'YES' AND l.tenant_id"), J("WHERE l.tenant_id")],
  ["SUBMIT", "a stopped check goes on", J("'{{node:code_node_LSiatr.data.route}}' != 'GO'"), J("'{{node:code_node_LSiatr.data.route}}' == 'NEVER'")],
  ["SUBMIT", "Requested not a status to restore", J('const LOT_PREV_STATUSES = ["Draft", "In Progress", "Requested"];'), J('const LOT_PREV_STATUSES = ["Draft", "In Progress"];'), "all"],
  ["PREPARE", "the dispatch not mapped to Draft", J('const origin = action === "STAGE" && prev === "Requested" ? "Draft" : prev;'), J("const origin = prev;")],
  ["PREPARE", "the compute sees Requested", J("const doc = lotAdaptDoc(hdr, storedRows, origin);"), J("const doc = lotAdaptDoc(hdr, storedRows, prev);")],
  ["PREPARE", "any action may restore Requested", J('if (!lotPrevStatusOk(prev) || (prev === "Requested" && lotS(req && req.action) !== "STAGE")) {'),
    J("if (!lotPrevStatusOk(prev)) {")],
  ["PREPARE", "Requested not a status to restore", J('const LOT_PREV_STATUSES = ["Draft", "In Progress", "Requested"];'), J('const LOT_PREV_STATUSES = ["Draft", "In Progress"];'), "all"],
  ["COMMIT", "Requested not a status to restore", J('const LOT_PREV_STATUSES = ["Draft", "In Progress", "Requested"];'), J('const LOT_PREV_STATUSES = ["Draft", "In Progress"];'), "all"],
  ["COMMIT_L3R", "the step never due", J('needL3R: phase === "B" && needs.L3R && !done.L3_RESERVATION ? "YES" : "NO",'), J('needL3R: "NO",')],
  ["COMMIT_L3R", "the step due in phase A", J('needL3R: phase === "B" && needs.L3R && !done.L3_RESERVATION ? "YES" : "NO",'), J('needL3R: needs.L3R && !done.L3_RESERVATION ? "YES" : "NO",')],
  ["COMMIT_L3R", "the step due again after its DONE", J('needL3R: phase === "B" && needs.L3R && !done.L3_RESERVATION ? "YES" : "NO",'), J('needL3R: phase === "B" && needs.L3R ? "YES" : "NO",')],
  ["COMMIT_L3R", "an RR part without chunks accepted", J(" && (rrNames === undefined || hasRR);"), J(";")],
  ["COMMIT_L3R", "the step not built", J('const LOT_BUILT = ["L0", "L1", "L2", "L3", "L3R", "L4"];'), J('const LOT_BUILT = ["L0", "L1", "L2", "L3", "L4"];')],
  ["COMMIT_L3R", "the block runs on L3's flag", J("'{{node:code_node_LCentry.data.needL3R}}' == 'YES'"), J("'{{node:code_node_LCentry.data.needL3}}' == 'YES'")],
  ["COMMIT_L3R", "the lookups gated on nothing", J("node.code_node_LCl3rkeys.data.need"), J("node.code_node_LCl3rkeys.data.plant")],
  ["WORKER", "Requested not a status to restore", J('const LOT_PREV_STATUSES = ["Draft", "In Progress", "Requested"];'), J('const LOT_PREV_STATUSES = ["Draft", "In Progress"];'), "all"],
];
const base = {};
for (const t of Object.keys(TARGET)) base[t] = fs.readFileSync(path.join(BUILT, TARGET[t].file), "utf8");
let survived = 0;
for (const [t, name, from, to, mode] of MUTANTS) {
  const n = base[t].split(from).length - 1;
  if (n < 1 || (mode !== "all" && n !== 1)) {
    console.log("BROKEN mutant (anchor found " + n + " times): " + t + " " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-v2m-")), TARGET[t].file);
  fs.writeFileSync(f, mode === "all" ? base[t].split(from).join(to) : base[t].replace(from, () => to));
  const env = Object.assign({}, process.env, { TZ: "Asia/Kuala_Lumpur", [TARGET[t].env]: f });
  const r = spawnSync(process.execPath, [path.join(__dirname, TARGET[t].test)], { env: env, encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + t + " " + name);
  } else console.log("killed   " + t + " " + name + (mode === "all" ? " (" + n + " copies)" : ""));
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
