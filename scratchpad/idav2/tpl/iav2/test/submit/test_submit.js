// node scratchpad/iav2/test/submit/test_submit.js - IA_V2_SUBMIT matrix on the BUILT code-node bodies (guard, entry, keys, gate,
// post, row, link, due, result): the action table incl. Clone, BUSY / STALE, every eligibility reason, the 250 / 5,000 limits,
// the WA screen, the GENERATE_BATCH pre-check, the number rule, the idempotency key twice, the queue rows
const path = require("path");
const load = require("./load_submit");
const C = require(path.join(__dirname, "..", "..", "code", "shared", "ia_common.js"));
const F = require(path.join(__dirname, "..", "..", "code", "shared", "fingerprint.js"));
const { submitGuard } = load("code_node_ISguard", ["submitGuard"]);
const { submitEntry } = load("code_node_ISentry", ["submitEntry"]);
const { submitKeys } = load("code_node_ISkeys", ["submitKeys"]);
const { submitGate, iaBatchPrecheck, __run, __withContext } = load("code_node_ISgate", ["submitGate", "iaBatchPrecheck", "__run", "__withContext"]);
const { submitPost } = load("code_node_ISpost", ["submitPost"]);
const { submitRow } = load("code_node_ISrow", ["submitRow"]);
const { submitLink } = load("code_node_ISlink", ["submitLink"]);
const { submitDue } = load("code_node_ISdue", ["submitDue"]);
const { submitResult } = load("code_node_ISdoneres", ["submitResult"]);

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
  }
};
const pick = (o, ks) => ks.reduce((a, k) => Object.assign(a, { [k]: o[k] }), {});
const T = "000000";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IA = "2112073133161844738";
const PARENT = "2094626841323700251";
const BIN = "2018912822846582786";
const RBIN = "2018912822846582999";
const UOM = "2018906563477008392";
const KEY = "IA:" + ORG + ":" + IA + ":0123456789abcdef:1";
const AKEY = "IA:" + ORG + ":new-x1y2z3:0123456789abcdef:1";
const comp = (i) => String(2094626841323700300n + BigInt(i));
const NOW = "2026-10-19 10:00:00";

const lineOf = (i, k, extra) => Object.assign({ id: String(2112073133161845000n + BigInt(i)), item_selection: comp(i), item_name: "C" + i, total_quantity: k, requested_qty: k,
  quantity_uom: UOM, temp_hu_data: "", temp_qty_data: JSON.stringify(Array.from({ length: k }, (_, j) => ({ material_id: comp(i), location_id: BIN, batch_id: null,
    balance_id: String(9000 + j), sm_quantity: 1, category: "Unrestricted" }))) }, extra || {});
const record = (page, lines, extra) => Object.assign({ id: page === "Add" ? undefined : IA, organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: page === "Add" ? "" : "IA-2610-0042",
  stock_movement_no_type: "2098266711093927937", item_assembly_status: page === "Add" ? "" : "Draft", item_id: PARENT, item_name: "FG", item_qty: 1, item_uom: UOM,
  item_assembly_date: "2026-10-19", issued_by: "t", batch_no: "", storage_location_id: "2018912759311265793", location_id: RBIN, inventory_category: "Unrestricted",
  remarks: "", remarks_2: "", remarks_3: "", reference_documents: [], page_status: page, stock_movement: lines, ia_v2_job_id: "x", ia_idem_key: "y" }, extra || {});
const lines = (count, picksEach) => Array.from({ length: count }, (_, i) => lineOf(i, picksEach));
const itemRow = (id, extra) => Object.assign({ id: id, material_code: "M" + id.slice(-4), stock_control: 1, show_delivery: 1, serial_number_management: 0, item_batch_management: 0,
  batch_number_genaration: "", material_costing_method: "First In First Out", purchase_unit_price: "0.0000", assembly_cost: "0.00", based_uom: UOM, table_uom_conversion: [] },
extra || {});
const itemsFor = (rec, over) => {
  const ids = [rec.item_id].concat(rec.stock_movement.map((l) => l.item_selection)).filter((x, i, a) => x && a.indexOf(x) === i);
  return ids.map((id) => ({ j: JSON.stringify(itemRow(id, (over || {})[id])) }));
};
const job = (o) => JSON.stringify(Object.assign({ id: "2112100000000000001", command: "COMPLETE_IA", job_status: "QUEUED", correlation_id: "IA|" + IA, progress_percent: 0,
  progress_message: "Queued for processing", error_code: null, error_message: null, line_count: 60, action: "DIRECT", ia_no: "IA-2610-0042" }, o || {}));
const facts = (o) => [Object.assign({ db_now: NOW, key_job: null, ia_id: IA, stock_movement_no: "IA-2610-0042", item_assembly_status: "Draft", posted_status: null,
  organization_id: ORG, plant_id: PLANT, no_type: "2098266711093927937", ia_v2_job_id: null, ia_lock: null, open_jobs: null, last_job: null, link_job: null,
  issued_by_job: 0, completed_under: 0, batch_cfg: JSON.stringify({ n: 1, level: "Organization Level", date_format: "Document Date" }) }, o || {})];
const addFacts = (o) => facts(Object.assign({ ia_id: null, stock_movement_no: null, item_assembly_status: null, organization_id: null, plant_id: null, no_type: null }, o || {}));
const guardIn = (o) => Object.assign({ operation: "SUBMIT", saveAs: "Completed", pageStatus: "Edit", iaId: IA, key: KEY, source: "FORM", form: { organization_id: ORG },
  tenantId: T, uid: "1123598821738675201", uuid: "ab12cd34-0000" }, o || {});
const READS0 = { cost: [], wa: [], dup: [] };
// the pipeline up to the first answer: guard -> entry -> keys -> gate -> post (GENERATE_BATCH answered by `batch`)
function submit(g, f, rec, reads, batch) {
  const guard = submitGuard(guardIn(Object.assign({ form: rec }, g || {})));
  if (guard.route === "REJECT") return { at: "guard", guard: guard, res: submitResult(guard, null, guard, null) };
  const entry = submitEntry(guard, f, rec ? rec.item_assembly_status : undefined);
  if (entry.route !== "GO") return { at: "entry", guard: guard, entry: entry, res: submitResult(guard, entry, entry, null) };
  const keys = submitKeys(guard, entry, rec);
  if (keys.route !== "GO") return { at: "keys", guard: guard, entry: entry, keys: keys, res: submitResult(guard, entry, keys, null) };
  const R = Object.assign({ items: itemsFor(rec) }, READS0, reads || {});
  const gate = submitGate(guard, entry, keys, rec, R);
  if (gate.route !== "GO") return { at: "gate", guard: guard, entry: entry, keys: keys, gate: gate, res: submitResult(guard, entry, gate, null) };
  const post = submitPost(guard, entry, gate, gate.needBatch === "YES" ? batch : null);
  return { at: post.route === "QUEUE" ? "queue" : "post", guard: guard, entry: entry, keys: keys, gate: gate, post: post,
    res: post.route === "QUEUE" ? null : submitResult(guard, entry, post, null) };
}
const ans = (r) => pick(r.res, ["route", "code", "message", "reason", "error_code"]);

// ------------------------------------------------------------------ guard
eq("guard: default op SUBMIT, Edit", pick(submitGuard(guardIn()), ["route", "operation", "pageStatus", "iaId", "key", "organizationId"]),
  { route: "CONTINUE", operation: "SUBMIT", pageStatus: "Edit", iaId: IA, key: KEY, organizationId: ORG });
eq("guard: Clone = Add, clone YES", pick(submitGuard(guardIn({ pageStatus: "Clone", iaId: "" })), ["route", "pageStatus", "clone", "iaId"]),
  { route: "CONTINUE", pageStatus: "Add", clone: "YES", iaId: "0" });
eq("guard: Copy = Clone", submitGuard(guardIn({ pageStatus: "Copy", iaId: "0" })).pageStatus, "Add");
eq("guard: Draft accepted (answered NOT_ELIGIBLE later)", submitGuard(guardIn({ saveAs: "Draft" })).route, "CONTINUE");
for (const [label, o, why] of [["saveAs", { saveAs: "Issued" }, "saveAs must be Draft or Completed"], ["View", { pageStatus: "View" }, "an Item Assembly in View mode can't be saved"],
  ["page", { pageStatus: "Delete" }, "pageStatus must be Add, Edit or Clone"], ["Edit id", { iaId: "12a" }, "ia_id: digits only"],
  ["Add id", { pageStatus: "Add", iaId: IA }, "ia_id must be empty for Add / Clone"], ["Clone with the source id", { pageStatus: "Clone", iaId: IA }, "ia_id must be empty for Add / Clone"],
  ["key", { key: "short" }, "idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -"], ["key chars", { key: "IA:1:2:3 4" }, "idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -"],
  ["tenant", { tenantId: "" }, "no session tenant"], ["source", { source: "LIST" }, "source must be FORM or MOBILE"], ["org", { form: { organization_id: "abc" } }, "form.organization_id: digits only"], ["no form", { form: "x" }, "form: the Item Assembly's record"],
  ["op", { operation: "DELETE" }, "operation must be SUBMIT or STATUS"]]) {
  const r = submit(o, facts(), record("Edit", lines(1, 1)));
  eq("guard INVALID " + label, [r.at, ans(r)], ["guard", { route: "INVALID", code: "400", message: why, reason: "", error_code: "IA_INVALID_REQUEST" }]);
}
eq("guard: STATUS by ia_id (form {})", pick(submitGuard(guardIn({ operation: "STATUS", key: "", form: {} })), ["route", "iaId", "key"]), { route: "CONTINUE", iaId: IA, key: "NOKEY" });
eq("guard: STATUS by key only (an Add's awaitLink)", pick(submitGuard(guardIn({ operation: "status", iaId: "", key: AKEY })), ["route", "iaId", "key"]),
  { route: "CONTINUE", iaId: "0", key: AKEY });
eq("guard: STATUS needs one of them", submitGuard(guardIn({ operation: "STATUS", iaId: "", key: "" })).message, "STATUS needs ia_id or idempotency_key");
eq("guard: nonce from the run uuid", submitGuard(guardIn({ uuid: "ab-12-CD-34-ef" })).nonce, "ab12CD34");
eq("guard: MOBILE", submitGuard(guardIn({ source: "mobile" })).source, "MOBILE");

// ------------------------------------------------------------------ entry: the key's job, STATUS
const big = record("Edit", lines(60, 1));
let r = submit({}, facts({ key_job: job({ job_status: "VALIDATING", progress_percent: 10, progress_message: "Preparing" }) }), big);
eq("same idempotency key twice: that job's STATUS", [r.at, pick(r.res, ["route", "code", "job_id", "job_status", "terminal", "ia_id", "ia_no", "progress_percent", "action"])],
  ["entry", { route: "STATUS", code: "200", job_id: "2112100000000000001", job_status: "VALIDATING", terminal: "NO", ia_id: IA, ia_no: "IA-2610-0042", progress_percent: "10", action: "DIRECT" }]);
r = submit({}, facts({ key_job: job({ job_status: "FAILED", error_code: "IA_LINES_CHANGED", error_message: "changed" }) }), big);
eq("the key's FAILED job: STATUS terminal with its error", pick(r.res, ["route", "job_status", "terminal", "error_code", "error_message"]),
  { route: "STATUS", job_status: "FAILED", terminal: "YES", error_code: "IA_LINES_CHANGED", error_message: "changed" });
r = submit({ operation: "STATUS", key: "" }, facts({ last_job: job({ command: "REVERT_IA", action: "REVERT", job_status: "COMMITTING_REVERT" }) }), {});
eq("STATUS: the IA's latest job of either command", pick(r.res, ["route", "action", "job_status", "terminal"]), { route: "STATUS", action: "REVERT", job_status: "COMMITTING_REVERT", terminal: "NO" });
r = submit({ operation: "STATUS", key: "" }, facts({ link_job: job({ id: "2112100000000000009", job_status: "COMPLETED" }) }), {});
eq("STATUS: else the job ia_v2_job_id names", pick(r.res, ["job_id", "job_status", "terminal"]), { job_id: "2112100000000000009", job_status: "COMPLETED", terminal: "YES" });
r = submit({ operation: "STATUS", key: "" }, facts(), {});
eq("STATUS: no job", pick(r.res, ["route", "code", "job_status", "terminal", "message"]), { route: "STATUS", code: "200", job_status: "NONE", terminal: "YES", message: "no background save" });
r = submit({ operation: "STATUS", iaId: "", key: AKEY }, addFacts({ key_job: job({ correlation_id: "IA|2112100000000000077" }) }), {});
eq("STATUS by key: the linked IA's id", pick(r.res, ["route", "ia_id"]), { route: "STATUS", ia_id: "2112100000000000077" });

// ------------------------------------------------------------------ entry: the action table
r = submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), record("Add", lines(60, 1)));
eq("Add + Completed: DIRECT, prevStatus Draft", [r.at, r.entry.action, r.entry.prevStatus, r.entry.organizationId], ["queue", "DIRECT", "Draft", ORG]);
r = submit({ pageStatus: "Clone", iaId: "", key: AKEY }, addFacts(), record("Clone", lines(60, 1), { id: IA, item_assembly_status: "Completed" }));
eq("Clone of a Completed IA + Completed: DIRECT (stored status not read)", [r.at, r.entry.action], ["queue", "DIRECT"]);
eq("Clone: the header id and every line id stripped", [r.gate.allData.id, r.gate.allData.stock_movement.filter((l) => l.id).length], [undefined, 0]);
eq("Clone: the V2 helper fields never reach the write", [r.gate.allData.ia_v2_job_id, r.gate.allData.ia_idem_key], [undefined, undefined]);
r = submit({ pageStatus: "Add", iaId: "", key: AKEY, saveAs: "Draft" }, addFacts(), record("Add", lines(60, 1)));
eq("Add + Draft: NOT_ELIGIBLE draft", ans(r), { route: "NOT_ELIGIBLE", code: "300", message: "draft", reason: "draft", error_code: "IA_NOT_ELIGIBLE" });
r = submit({ saveAs: "Draft" }, facts(), record("Edit", lines(900, 1)));
eq("Edit Draft + Draft (900 picks): NOT_ELIGIBLE draft, never STOP", ans(r).route, "NOT_ELIGIBLE");
r = submit({}, facts({ ia_id: null, item_assembly_status: null }), big);
eq("stored IA missing: STOP 400", ans(r), { route: "STOP", code: "400", message: "Item Assembly not found - it may have been deleted.", reason: "", error_code: "IA_NOT_FOUND" });
const BUSY = "This Item Assembly is being processed in the background - please wait for it to finish.";
r = submit({}, facts({ open_jobs: "[" + job({ job_status: "READY_TO_COMMIT", progress_percent: 60 }) + "]" }), big);
eq("an open COMPLETE_IA job: BUSY 409 with its fields", pick(r.res, ["route", "code", "message", "error_code", "job_id", "job_status", "progress_percent"]),
  { route: "BUSY", code: "409", message: BUSY, error_code: "IA_BUSY", job_id: "2112100000000000001", job_status: "READY_TO_COMMIT", progress_percent: "60" });
r = submit({}, facts({ open_jobs: "[" + job({ command: "REVERT_IA", action: "REVERT", job_status: "COMMITTING_REVERT" }) + "]", item_assembly_status: "Processing" }), big);
eq("an open REVERT_IA job: BUSY", pick(r.res, ["route", "error_code", "action"]), { route: "BUSY", error_code: "IA_BUSY", action: "" });
r = submit({}, facts({ open_jobs: "[" + job({ job_status: "REQUIRES_REVIEW" }) + "]", item_assembly_status: "Processing" }), big);
eq("an open job under review: IA_UNDER_REVIEW", pick(r.res, ["route", "code", "message", "error_code"]),
  { route: "BUSY", code: "409", message: "Its last completion stopped half-way and is under review: please contact support.", error_code: "IA_UNDER_REVIEW" });
r = submit({}, facts({ open_jobs: "[" + job({ command: "REVERT_IA", action: "REVERT", job_status: "REQUIRES_REVIEW" }) + "]", item_assembly_status: "Processing" }), big);
eq("a REVERT_IA job under review: the revert's wording (IA_TEXT.rvUnderReview)", pick(r.res, ["route", "code", "message", "error_code", "job_status"]),
  { route: "BUSY", code: "409", message: C.IA_TEXT.rvUnderReview, error_code: "IA_UNDER_REVIEW", job_status: "REQUIRES_REVIEW" });
eq("rvUnderReview is the revert's text", C.IA_TEXT.rvUnderReview, "Its last revert stopped half-way and is under review: please contact support.");
r = submit({}, facts({ item_assembly_status: "Processing", link_job: job({ command: "REVERT_IA", job_status: "REQUIRES_REVIEW" }) }), big);
eq("Processing, linked to a REVERT_IA job under review: the revert's wording", pick(r.res, ["message", "error_code"]),
  { message: C.IA_TEXT.rvUnderReview, error_code: "IA_UNDER_REVIEW" });
r = submit({}, facts({ item_assembly_status: "Processing", link_job: job({ job_status: "FAILED" }) }), big);
eq("stored Processing (no open job): BUSY", pick(r.res, ["route", "error_code"]), { route: "BUSY", error_code: "IA_BUSY" });
const lock = (o) => JSON.stringify(Object.assign({ step: "LOCK|3", ref: "IA:" + ORG + ":" + IA + ":ffffffffffffffff:1", young: 1, job: null }, o || {}));
eq("a young lock of another key, no job yet: BUSY", ans(submit({}, facts({ ia_lock: lock() }), big)).route, "BUSY");
eq("a young lock of another key, its job open: BUSY", ans(submit({}, facts({ ia_lock: lock({ job: "QUEUED" }) }), big)).route, "BUSY");
eq("a young lock of another key, its job FAILED: goes on", submit({}, facts({ ia_lock: lock({ job: "FAILED" }) }), big).at, "queue");
eq("an old lock of another key: goes on", submit({}, facts({ ia_lock: lock({ young: 0 }) }), big).at, "queue");
eq("a young lock of THIS key: goes on (its retry)", submit({}, facts({ ia_lock: lock({ ref: KEY }) }), big).at, "queue");
eq("the next lock is LOCK|n+1", submit({}, facts({ ia_lock: lock({ young: 0 }) }), big).post.lockRows[0].step_name, "LOCK|4");
eq("no earlier lock: LOCK|1", submit({}, facts(), big).post.lockRows[0].step_name, "LOCK|1");
r = submit({}, facts({ item_assembly_status: "Completed" }), big);
eq("form Draft, stored Completed: STALE", ans(r), { route: "STALE", code: "409",
  message: "This Item Assembly was changed by someone else (it is now Completed). Please close it and open it again.", reason: "", error_code: "IA_STALE" });
r = submit({}, facts({ item_assembly_status: "Completed" }), record("Edit", lines(60, 1), { item_assembly_status: "Completed" }));
eq("stored and form Completed: ALREADY_FINAL", ans(r), { route: "STALE", code: "409", message: "This Item Assembly is already Completed.", reason: "", error_code: "IA_ALREADY_FINAL" });
r = submit({ saveAs: "Draft" }, facts({ item_assembly_status: "Fully Posted" }), record("Edit", lines(60, 1), { item_assembly_status: "Fully Posted" }));
eq("Fully Posted + Draft: ALREADY_FINAL", ans(r).error_code, "IA_ALREADY_FINAL");
r = submit({}, facts({ item_assembly_status: "Issued" }), record("Edit", lines(60, 1), { item_assembly_status: "Issued" }));
eq("another stored status: NOT_ELIGIBLE status <x>", ans(r), { route: "NOT_ELIGIBLE", code: "300", message: "status Issued", reason: "status Issued", error_code: "IA_NOT_ELIGIBLE" });
r = submit({}, facts({ item_assembly_status: "" }), record("Edit", lines(60, 1), { item_assembly_status: "" }));
eq("a blank stored status: NOT_ELIGIBLE", ans(r).message, "status (none)");
r = submit({}, facts(), big);
eq("stored Draft + Completed: DIRECT", [r.at, r.entry.action, r.entry.prevStatus], ["queue", "DIRECT", "Draft"]);

// ------------------------------------------------------------------ keys
eq("no record -> INVALID before anything is read", [submit({}, facts(), "not a record").at, ans(submit({}, facts(), "not a record"))], ["guard", { route: "INVALID", code: "400",
  message: "form: the Item Assembly's record", reason: "", error_code: "IA_INVALID_REQUEST" }]);
eq("keys: no record -> INVALID (defensive)", submitKeys(submitGuard(guardIn()), { organizationId: ORG }, null).route, "INVALID");
eq("keys: another IA's record -> INVALID", ans(submit({}, facts(), record("Edit", lines(1, 1), { id: "2112073133161844999" }))).message,
  "form: not the record of Item Assembly " + IA);
r = submit({}, facts(), record("Edit", [lineOf(0, 2), lineOf(1, 1, { temp_qty_data: JSON.stringify([{ location_id: BIN, batch_id: "2102793508506177537", sm_quantity: 3 },
  { location_id: BIN, sm_quantity: 0 }]) })]));
eq("keys: tuples (digits only, each once; the parent's receipt bin; batch picks)", pick(r.keys, ["pickPairsJson", "costPairsJson", "balTuplesJson", "batchTuplesJson", "plantId",
  "organizationId", "pickCount", "lineCount"]), {
  pickPairsJson: "[[" + comp(0) + ",0],[" + comp(1) + ",2102793508506177537]]", costPairsJson: "[[" + comp(0) + ",0],[" + comp(1) + ",2102793508506177537],[" + PARENT + ",0]]",
  balTuplesJson: "[[" + comp(0) + "," + BIN + "],[" + comp(1) + "," + BIN + "],[" + PARENT + "," + RBIN + "]]",
  batchTuplesJson: "[[" + comp(1) + "," + BIN + ",2102793508506177537]]", plantId: PLANT, organizationId: ORG, pickCount: 3, lineCount: 2 });
eq("keys: item ids = code_item_ids (parent first, unique)", r.keys.itemIdsSql, "0," + PARENT + "," + comp(0) + "," + comp(1));
eq("keys: Edit org = the STORED IA's", submit({}, facts({ organization_id: "1123598813738675299" }), big).keys.organizationId, "1123598813738675299");

// ------------------------------------------------------------------ gate: eligibility (<= 250 picks NOT_ELIGIBLE, above STOP IA_TOO_BIG)
const elig = (label, rec, reads, why, itemsOver) => {
  for (const [k, page] of [[60, "Edit"], [251, "Add"]]) {
    const recK = rec(k, page);
    const R = Object.assign({}, reads || {}, itemsOver ? { items: itemsFor(recK, itemsOver) } : {});
    const res = submit(page === "Add" ? { pageStatus: "Add", iaId: "", key: AKEY } : {}, page === "Add" ? addFacts() : facts(), recK, R);
    const picks = C.iaPickCount(recK.stock_movement);
    eq("eligibility " + label + " (" + picks + " picks)", ans(res), picks > 250
      ? { route: "STOP", code: "400", message: "This Item Assembly has " + picks + " stock picks and cannot be completed in the background (" + why
        + "); the classic save handles at most 250 picks.", reason: why, error_code: "IA_TOO_BIG" }
      : { route: "NOT_ELIGIBLE", code: "300", message: why, reason: why, error_code: "IA_NOT_ELIGIBLE" });
  }
};
const recN = (k, page) => record(page, lines(k, 1));
elig("item not found", recN, { items: [] }, "item " + PARENT + " not found");
elig("HU on a pick", (k, p) => record(p, [lineOf(0, k, { temp_qty_data: JSON.stringify(Array.from({ length: k }, (_, j) => ({ location_id: BIN, sm_quantity: 1,
  handling_unit_id: j === 3 ? "2037062451509002299" : "" }))) })]), null, "handling units");
elig("HU data on a line", (k, p) => record(p, [lineOf(0, k, { temp_hu_data: '[{"handling_unit_id":"1"}]' })]), null, "handling units");
elig("HU on the header", (k, p) => record(p, lines(k, 1), { table_hu: [{ id: "1" }] }), null, "handling units");
elig("serial parent", recN, null, "serial numbers", { [PARENT]: { serial_number_management: 1 } });
elig("serial component", recN, null, "serial numbers", { [comp(3)]: { serial_number_management: 1 } });
elig("parent not stock controlled", recN, null, "assembled item not stock controlled", { [PARENT]: { stock_control: 0 } });
elig("parent stock_control NULL", recN, null, "assembled item not stock controlled", { [PARENT]: { stock_control: null } });
elig("component stock_control NULL", recN, null, "item M" + comp(2).slice(-4) + " has no stock control setting", { [comp(2)]: { stock_control: null } });
elig("manual batch parent (Manual Input)", recN, null, "manual batch number", { [PARENT]: { item_batch_management: 1, batch_number_genaration: "Manual Input" } });
elig("manual batch parent (blank rule)", recN, null, "manual batch number", { [PARENT]: { item_batch_management: 1, batch_number_genaration: "" } });
elig("a Reserved stock pick", (k, p) => record(p, [lineOf(0, k, { temp_qty_data: JSON.stringify(Array.from({ length: k }, (_, j) => ({ location_id: BIN, sm_quantity: 1,
  category: j === 1 ? "Reserved" : "Blocked" }))) })]), null, "Reserved stock");
elig("costing migration (a pick)", recN, { cost: [{ j: JSON.stringify({ material_id: comp(5), batch_id: "0", method: "First In First Out", fifo: 0, wa: 2 }) }] }, "costing migration");
elig("costing migration (the parent)", recN, { cost: [{ j: JSON.stringify({ material_id: PARENT, batch_id: "0", method: "Weighted Average", fifo: 3, wa: 0 }) }] },
  "costing migration");
elig("duplicate item_balance (a pick)", recN, { dup: [{ j: JSON.stringify({ t: "B", material_id: comp(4), location_id: BIN, batch_id: "", n: 2 }) }] }, "duplicate balance rows");
elig("duplicate item_balance (the receipt bin)", recN, { dup: [{ j: JSON.stringify({ t: "B", material_id: PARENT, location_id: RBIN, batch_id: "", n: 2 }) }] },
  "duplicate balance rows");
elig("duplicate item_batch_balance", (k, p) => record(p, [lineOf(0, k, { temp_qty_data: JSON.stringify(Array.from({ length: k }, () => ({ location_id: BIN, sm_quantity: 1,
  batch_id: "2102793508506177537" }))) })]), { dup: [{ j: JSON.stringify({ t: "T", material_id: comp(0), location_id: BIN, batch_id: "2102793508506177537", n: 2 }) }] },
  "duplicate balance rows");
elig("no stock pick (only non-stock lines)", (k, p) => record(p, lines(Math.min(k, 3), 0).map((l) => Object.assign(l, { total_quantity: 2, temp_qty_data: "" }))), null,
  "no stock to issue", { [comp(0)]: { stock_control: 0 }, [comp(1)]: { stock_control: 0 }, [comp(2)]: { stock_control: 0 } });
eq("a duplicate flag on another bin is not ours", submit({}, facts(), recN(60, "Edit"), { dup: [{ j: JSON.stringify({ t: "B", material_id: comp(4), location_id: RBIN, batch_id: "", n: 2 }) }] })
  .at, "queue");
eq("a costing flag of another batch is not ours", submit({}, facts(), recN(60, "Edit"), { cost: [{ j: JSON.stringify({ material_id: comp(5), batch_id: "1", fifo: 1, wa: 1 }) }] }).at,
  "queue");
eq("250 picks + item not found: NOT_ELIGIBLE", ans(submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), recN(250, "Add"), { items: [] })).route, "NOT_ELIGIBLE");
eq("501 picks + item not found: STOP IA_TOO_BIG (the brief's 500 is now the user's 250)", ans(submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), recN(501, "Add"),
  { items: [] })).error_code, "IA_TOO_BIG");
eq("251 picks + item not found: STOP IA_TOO_BIG", ans(submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), recN(251, "Add"), { items: [] })).error_code, "IA_TOO_BIG");

// ------------------------------------------------------------------ gate: the lifted classic gates
r = submit({}, facts(), record("Edit", lines(60, 1), { location_id: "" }));
eq("required fields (CHECK_REQUIRED_FIELD v8 text)", ans(r), { route: "STOP", code: "400", message: "Validation Error: Bin Location", reason: "", error_code: "IA_REQUIRED_FIELDS" });
r = submit({}, facts(), record("Edit", lines(60, 1).map((l, i) => (i === 7 ? Object.assign(l, { total_quantity: 2 }) : l))));
eq("code_validate (its 401 text as STOP 400)", ans(r), { route: "STOP", code: "400",
  message: "Line 8 (C7): the quantity does not match the allocated stock. Re-enter the quantity or re-pick it.", reason: "", error_code: "IA_ASSEMBLY_INVALID" });
r = submit({}, facts(), record("Edit", lines(60, 1), { item_qty: 0 }));
eq("item_qty 0: CHECK_REQUIRED_FIELD answers first (as the classic)", pick(ans(r), ["message", "error_code"]), { message: "Validation Error: Quantity", error_code: "IA_REQUIRED_FIELDS" });
r = submit({}, facts(), record("Edit", lines(60, 1), { item_qty: -2 }));
eq("code_validate: quantity below zero", pick(ans(r), ["message", "error_code"]), { message: "Validation Error: Quantity", error_code: "IA_REQUIRED_FIELDS" });
r = submit({}, facts(), record("Edit", lines(60, 1), { inventory_category: "Reserved" }));
eq("code_validate: header category", ans(r).message, "Inventory Category must be Unrestricted or Blocked.");
r = submit({}, facts(), record("Edit", lines(60, 1).map((l, i) => (i === 2 ? Object.assign(l, { temp_qty_data: "" }) : l))));
eq("code_validate: a stock line without picks", ans(r).message, "Line 3 (C2): no stock has been allocated.");
const withDl = record("Edit", lines(60, 1).concat([lineOf(60, 0, { item_selection: "1999999999999990001", item_name: "DL", total_quantity: 2, temp_qty_data: "" })]));
r = submit({}, facts(), withDl, { items: itemsFor(withDl, { "1999999999999990001": { stock_control: 0, material_costing_method: "Fixed Cost" } }) });
eq("a non-stock line (no picks, qty > 0) passes; counted", [r.at, r.gate.nonStockLines, r.gate.stockPickCount, r.gate.movementCount, r.gate.pickCount], ["queue", 1, 60, 61, 60]);
const dl0 = record("Edit", lines(60, 1).concat([lineOf(60, 0, { item_selection: "1999999999999990001", item_name: "DL", total_quantity: 0, temp_qty_data: "" })]));
r = submit({}, facts(), dl0, { items: itemsFor(dl0, { "1999999999999990001": { stock_control: 0 } }) });
eq("a non-stock line with qty 0: the v12 text", ans(r).message, "Line 61 (DL): quantity must be greater than zero.");

// ------------------------------------------------------------------ gate: limits, WA, the GENERATE_BATCH pre-check
r = submit({}, facts(), record("Edit", lines(1001, 5)));
eq("5,005 stock picks: STOP IA_SPLIT_REQUIRED", ans(r), { route: "STOP", code: "400",
  message: "This Item Assembly has 5005 stock picks. At most 5,000 can be issued at once - please split the assembly.", reason: "split", error_code: "IA_SPLIT_REQUIRED" });
eq("5,000 stock picks: queued", submit({}, facts(), record("Edit", lines(1000, 5))).at, "queue");
r = submit({}, facts(), recN(60, "Edit"), { wa: [{ j: JSON.stringify({ material_id: comp(9), batch_id: "0", material_code: "RM-0009" }) }] });
eq("WA screen, non-batch pick: GLOBAL_INVENTORY_VALIDATION's text", ans(r), { route: "STOP", code: "400",
  message: "No Weighted Average costing record for item M" + comp(9).slice(-4) + " at this plant. The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock.",
  reason: "", error_code: "IA_NO_WA_RECORD" });
const bRec = record("Edit", [lineOf(0, 3, { temp_qty_data: JSON.stringify([{ location_id: BIN, sm_quantity: 1, batch_id: "2102793508506177537" }]) })].concat(lines(60, 1).slice(1)));
bRec.stock_movement[0].total_quantity = 1;
r = submit({}, facts(), bRec, { wa: [{ j: JSON.stringify({ material_id: comp(0), batch_id: "2102793508506177537" }) }] });
eq("WA screen, batch pick: names the batch", ans(r).message, "No Weighted Average costing record for item M" + comp(0).slice(-4) + " at this plant (batch 2102793508506177537). "
  + "The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock.");
const batchParent = { [PARENT]: { item_batch_management: 1, batch_number_genaration: "According To System Settings" } };
const bp = (o, rec) => submit({}, facts(o), rec || recN(60, "Edit"), { items: itemsFor(rec || recN(60, "Edit"), batchParent) }, { batch_number: "1016-005-0003" });
eq("batch parent, Organization Level / Document Date: the call's params (organization_id passed)", pick(bp({}).gate, ["needBatch", "batchItemId", "batchDocDate", "batchMfgDate", "batchExpDate", "batchOrg"]),
  { needBatch: "YES", batchItemId: PARENT, batchDocDate: "2026-10-19", batchMfgDate: null, batchExpDate: null, batchOrg: ORG });
eq("batch parent: the generated number goes into batch_no", bp({}).post.batchNo, "1016-005-0003");
for (const [label, cfg, rec, msg] of [["no default config", { n: 0, level: null, date_format: null }, null, "No default batch found."],
  ["two default configs", { n: 2, level: "Organization Level", date_format: "Document Date" }, null, "No default batch found."],
  ["an unknown level", { n: 1, level: "Plant Level", date_format: "Document Date" }, null, "No default batch found."],
  ["Document Date without a date", { n: 1, level: "Item Level", date_format: "Document Date" }, recN(60, "Edit"), "Document Date is required."],
  ["Expired Date without one", { n: 1, level: "Item Category Level", date_format: "Expired Date" }, null, "Expired Date is required."],
  ["Manufacturing Date without one", { n: 1, level: "Item Group Level", date_format: "Manufacturing Date" }, null, "Manufacturing Date is required."],
  ["an unknown date format", { n: 1, level: "Organization Level", date_format: "Posting Date" }, null, "Invalid date format configuration."]]) {
    const recX = rec ? Object.assign(rec, { item_assembly_date: "" }) : null;
    eq("GENERATE_BATCH pre-check: " + label, ans(bp({ batch_cfg: JSON.stringify(cfg) }, recX)), { route: "STOP", code: "400", message: msg, reason: "", error_code: "IA_BATCH_FAILED" });
}
eq("GENERATE_BATCH pre-check: Document Created Date passes", bp({ batch_cfg: JSON.stringify({ n: 1, level: "Organization Level", date_format: "Document Created Date" }) }).at, "queue");
eq("GENERATE_BATCH pre-check: Expired Date given passes", bp({ batch_cfg: JSON.stringify({ n: 1, level: "Organization Level", date_format: "Expired Date" }) },
  record("Edit", lines(60, 1), { expired_date: "2028-10-19" })).at, "queue");
eq("pre-check: the date checks see the fill-back's values", iaBatchPrecheck({ n: 1, level: "Item Level", date_format: "Expired Date" }, { expired_date: "2028-10-19" }), "");
r = submit({}, facts(), recN(60, "Edit"), { items: itemsFor(recN(60, "Edit"), batchParent) }, { batch_number: "" });
eq("GENERATE_BATCH answered no number: the classic text", ans(r), { route: "STOP", code: "400",
  message: "Could not generate a batch number. Check the Batch Number Configuration for this item.", reason: "", error_code: "IA_BATCH_FAILED" });
r = submit({}, facts(), recN(60, "Edit"), { items: itemsFor(recN(60, "Edit"), batchParent) }, null);
eq("GENERATE_BATCH did not run (null): the classic text", ans(r).error_code, "IA_BATCH_FAILED");
eq("a non-batch parent: no call, batch_no ''", pick(submit({}, facts(), recN(60, "Edit")).post, ["batchNo"]), { batchNo: "" });
eq("a non-batch parent: needBatch NO", submit({}, facts(), recN(60, "Edit")).gate.needBatch, "NO");

// ------------------------------------------------------------------ post: the queue rows and the number rule
r = submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), record("Add", lines(60, 1)));
eq("Add: no lock before the insert; numberProps YES; the 'issued' sentinel", [r.post.needLock, r.post.lockRows.length, r.post.numberProps, r.post.numberIssued], ["NO", 0, "YES", "YES"]);
eq("Add: the job row", r.post.jobRows[0], { organization_id: ORG, plant_id: PLANT, command: "COMPLETE_IA", idempotency_key: AKEY, job_status: "QUEUED", progress_percent: 0,
  progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: "2026-10-19 10:02:00",
  request_payload: r.post.request, causation_id: "", correlation_id: "", line_count: 60, queued_at: NOW });
eq("Add: the request", JSON.parse(r.post.request), { v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Add", iaId: "", iaNo: "", issuedNo: "",
  lineFingerprint: "", organizationId: ORG, plantId: PLANT, lineCount: 60, pickCount: 60, nonStockLines: 0, movementCount: 61, uid: "1123598821738675201", source: "FORM",
  nonce: "ab12cd34", parts: {} });
r = submit({}, facts(), big);
eq("stored Draft: LOCK|n+1 row (the key as result_ref, db clock)", r.post.lockRows, [{ job_id: "IAC|" + IA, organization_id: ORG, step_name: "LOCK|1", step_status: "LOCK",
  attempt_count: 0, started_at: NOW, result_ref: KEY }]);
eq("stored Draft: correlation / causation at the insert", pick(r.post.jobRows[0], ["correlation_id", "causation_id"]), { correlation_id: "IA|" + IA, causation_id: IA });
eq("stored Draft: iaId / iaNo in the request", pick(JSON.parse(r.post.request), ["pageStatus", "iaId", "iaNo"]), { pageStatus: "Edit", iaId: IA, iaNo: "IA-2610-0042" });
eq("stored Draft, no earlier job: a new number", [r.post.numberProps, r.post.numberIssued], ["YES", "YES"]);
r = submit({}, facts({ issued_by_job: 1, completed_under: 0 }), big);
eq("number rule: an earlier (failed) job issued it, none COMPLETED under it -> kept", [r.post.numberProps, r.post.numberIssued], ["NO", "NO"]);
r = submit({}, facts({ issued_by_job: 1, completed_under: 1 }), big);
eq("number rule: a COMPLETED job ran under it (then reverted) -> a new number", [r.post.numberProps, r.post.numberIssued], ["YES", "YES"]);
r = submit({}, facts({ issued_by_job: 1, completed_under: 0 }), record("Edit", lines(60, 1), { stock_movement_no_type: -9999, stock_movement_no: "MAN-7" }));
eq("number rule: -9999 writes the typed number (no sentinel, nothing issued)", [r.post.numberProps, r.post.numberIssued, r.gate.stockMovementNo], ["YES", "NO", "MAN-7"]);
r = submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), record("Add", lines(60, 1), { stock_movement_no_type: -9999, stock_movement_no: "MAN-8" }));
eq("Add with -9999: the typed number, numberIssued NO", [r.post.numberProps, r.post.numberIssued, r.gate.allData.stock_movement_no], ["YES", "NO", "MAN-8"]);
eq("the gate's allData is the classic fill-back's (q8, line_index, org stamps; Processing written by the node)", pick(submit({}, facts(), big).gate.allData.stock_movement[1],
  ["line_index", "organization_id", "issuing_plant", "total_quantity"]), { line_index: 2, organization_id: ORG, issuing_plant: PLANT, total_quantity: 1 });
eq("Edit: allData.id is the request's", submit({}, facts(), big).gate.allData.id, IA);

// ------------------------------------------------------------------ fix wave R5 in the gate's lifted code_validate (the copy SUBMIT ships)
const lv = (lineRows, stockControl) => __withContext({ "workflowparams:saveAs": "Completed", "node:code_fillback": { data: { storedStatus: "Draft",
  allData: { item_id: PARENT, item_qty: 1, inventory_category: "Unrestricted", stock_movement: lineRows } } },
"node:search_items": { data: { data: [itemRow(PARENT), itemRow("1999999999999990001", { stock_control: stockControl })] } } }, () => __run("code_validate"));
const dlRow = { item_selection: "1999999999999990001", item_name: "DL", total_quantity: 2, temp_qty_data: "" };
eq("R5 (lifted): non-stock lines only -> v11's no-components text", lv([dlRow], 0),
  { status: "Failed", message: "There are no components to consume. Add at least one component line." });
eq("R5 (lifted): a stock line with its pick + a non-stock line -> passes", lv([lineOf(0, 1), dlRow], 0), { status: "Passed", message: "" });
eq("R5 (SUBMIT): non-stock lines only never reach it - NOT_ELIGIBLE 'no stock to issue' first", ans(submit({}, facts(),
  record("Edit", [Object.assign(lineOf(0, 0), { total_quantity: 2, temp_qty_data: "" })]), { items: itemsFor(record("Edit", [lineOf(0, 0)]), { [comp(0)]: { stock_control: 0 } }) })).message,
"no stock to issue");

// ------------------------------------------------------------------ row / link / due / result
eq("row: Add -> the insert", submitRow({ isAdd: "YES", numberProps: "YES" }, [{ id: "2112100000000000001" }]),
  { ok: "YES", jobId: "2112100000000000001", writeAdd: "YES", writeNumber: "NO", writeNoNumber: "NO" });
eq("row: Draft + number", submitRow({ isAdd: "NO", numberProps: "YES" }, [{ id: "2112100000000000001" }]).writeNumber, "YES");
eq("row: Draft, number kept", submitRow({ isAdd: "NO", numberProps: "NO" }, [{ id: "2112100000000000001" }]).writeNoNumber, "YES");
eq("row: no job id -> nothing written", submitRow({ isAdd: "YES" }, []), { ok: "NO", jobId: "0", writeAdd: "NO", writeNumber: "NO", writeNoNumber: "NO" });
const addRun = submit({ pageStatus: "Add", iaId: "", key: AKEY }, addFacts(), record("Add", lines(3, 1)));
const NEWIA = "2112200000000000001";
const fpLines = addRun.gate.allData.stock_movement.map((l, i) => ({ j: JSON.stringify({ id: String(2112200000000000100n + BigInt(i)), line_index: String(i + 1), item_selection: l.item_selection,
  quantity_uom: UOM, total_quantity: "1.00000000", temp_qty_data: l.temp_qty_data, temp_hu_data: "", item_name: l.item_name }) }));
const fpHeader = [{ j: JSON.stringify({ id: NEWIA, item_id: PARENT, item_qty: "1.00000000", item_uom: UOM, location_id: RBIN, inventory_category: "Unrestricted", batch_no: "",
  issuing_operation_faci: PLANT, stock_movement_no: "IA-2610-0043", item_assembly_status: "Processing", ia_v2_job_id: "2112100000000000001" }) }];
const row = { jobId: "2112100000000000001", ok: "YES" };
const link = submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: NEWIA, stock_movement_no: "IA-2610-0043", item_assembly_status: "Processing", ia_v2_job_id: row.jobId }],
  fpHeader, fpLines);
const linkedReq = JSON.parse(link.request);
eq("link (Add): iaId / iaNo / issuedNo / lineFingerprint of the STORED rows", pick(linkedReq, ["iaId", "iaNo", "issuedNo", "lineFingerprint"]),
  { iaId: NEWIA, iaNo: "IA-2610-0043", issuedNo: "IA-2610-0043", lineFingerprint: F.iaLineFingerprint(fpLines, fpHeader) });
eq("link (Add): LOCK|1 + correlation / causation", [link.needLock, link.lockRows[0], link.needLink, pick(link.jobRows[0], ["id", "correlation_id", "causation_id"])],
  ["YES", { job_id: "IAC|" + NEWIA, organization_id: ORG, step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0, started_at: NOW, result_ref: AKEY }, "YES",
    { id: row.jobId, correlation_id: "IA|" + NEWIA, causation_id: NEWIA }]);
eq("link: two rows under the job -> nothing linked", submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: "1" }, { id: "2" }], fpHeader, fpLines).ok, "NO");
const draftRun = submit({ key: KEY }, facts({ issued_by_job: 1 }), record("Edit", lines(3, 1)));
const dlink = submitLink(draftRun.guard, draftRun.entry, draftRun.post, row, [{ id: IA, stock_movement_no: "IA-2610-0042" }], fpHeader, fpLines);
eq("link (stored Draft, number kept): no LOCK|1, no link write, issuedNo ''", [dlink.ok, dlink.needLock, dlink.needLink, JSON.parse(dlink.request).issuedNo,
  JSON.parse(dlink.request).iaNo], ["YES", "NO", "NO", "", "IA-2610-0042"]);
eq("link (stored Draft): another IA under the job -> nothing", submitLink(draftRun.guard, draftRun.entry, draftRun.post, row, [{ id: NEWIA }], fpHeader, fpLines).ok, "NO");
const back = (o) => [Object.assign({ job_id: row.jobId, job_status: "QUEUED", correlation_id: "IA|" + IA, item_assembly_status: "Processing", stock_movement_no: "IA-2610-0042",
  ia_v2_job_id: row.jobId, lock_ref: KEY }, o || {})];
eq("due: queued and owned -> due now with the final request", submitDue(draftRun.guard, draftRun.entry, dlink, back()),
  { dueRows: [{ id: row.jobId, next_attempt_at: NOW, request_payload: dlink.request }], needDue: "YES" });
for (const [label, o] of [["not Processing", { item_assembly_status: "Draft" }], ["another job's IA", { ia_v2_job_id: "2112100000000000002" }], ["another key's lock", { lock_ref: AKEY }],
  ["not QUEUED", { job_status: "VALIDATING" }], ["not linked", { correlation_id: "" }]]) {
  eq("due: " + label + " -> not due", submitDue(draftRun.guard, draftRun.entry, dlink, back(o)).needDue, "NO");
  eq("result: " + label + " -> STOP 500", pick(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(o)), ["route", "code", "error_code", "message"]),
    { route: "STOP", code: "500", error_code: "IA_QUEUE_FAILED", message: "The completion could not be queued: please try again." });
}
eq("result: queued", pick(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back()), ["route", "code", "message", "action", "job_id", "job_status", "terminal", "ia_id",
  "ia_no", "line_count", "progress_percent", "error_code"]), { route: "QUEUED", code: "200", message: "Queued for processing", action: "DIRECT", job_id: row.jobId,
  job_status: "QUEUED", terminal: "NO", ia_id: IA, ia_no: "IA-2610-0042", line_count: "3", progress_percent: "0", error_code: "" });
eq("result: every answer field a string", Object.values(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back())).every((v) => typeof v === "string"), true);
eq("result: evidence", JSON.parse(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back()).evidence),
  { v: 1, workflow: "IA_V2_SUBMIT", operation: "SUBMIT", route: "QUEUED", code: "200", reason: "" });
eq("result: never 401", [ans(submit({}, facts(), record("Edit", lines(60, 1), { item_qty: 0 }))).code], ["400"]);

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
