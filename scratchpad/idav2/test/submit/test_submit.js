// TZ=Asia/Kuala_Lumpur node scratchpad/idav2/test/submit/test_submit.js - IDA_V2_SUBMIT matrix on the BUILT code-node bodies (guard, entry,
// keys, gate, post, row, link, due, result): the action table incl. Clone / Copy, BUSY (young lock, under review) / STALE, every eligibility
// reason at 250 and 251 moves, the 5,000 limits, the WA screen, each dry-run refusal, the typed-number check (F4), the number rule, the
// idempotency key twice, INVALID requests, the queue rows
const path = require("path");
const load = require("./load_submit");
const C = require(path.join(__dirname, "..", "..", "code", "shared", "ida_common.js"));
const F = require(path.join(__dirname, "..", "..", "code", "shared", "fingerprint.js"));
const { submitGuard } = load("code_node_DSguard", ["submitGuard"]);
const { submitEntry } = load("code_node_DSentry", ["submitEntry"]);
const { submitKeys } = load("code_node_DSkeys", ["submitKeys"]);
const { submitGate, idaBatchnum } = load("code_node_DSgate", ["submitGate", "idaBatchnum"]);
const { submitPost } = load("code_node_DSpost", ["submitPost"]);
const { submitRow } = load("code_node_DSrow", ["submitRow"]);
const { submitLink } = load("code_node_DSlink", ["submitLink"]);
const { submitDue } = load("code_node_DSdue", ["submitDue"]);
const { submitResult } = load("code_node_DSdoneres", ["submitResult"]);

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + String(JSON.stringify(got)).slice(0, 900) + "\n  want " + String(JSON.stringify(want)).slice(0, 900));
  }
};
const pick = (o, ks) => ks.reduce((a, k) => Object.assign(a, { [k]: o[k] }), {});
const obj = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const T = "000000";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IDA = "2112073133161844738";
const SRC = "2105489115887079441";
const BIN = "2018912822846582786";
const RBIN = "2018912822846582999";
const SLOC = "2018912759311265793";
const UOM = "2018906563477008392";
const BATCH = "2102793508506177537";
const KEY = "IDA:" + ORG + ":" + IDA + ":0123456789abcdef:1";
const AKEY = "IDA:" + ORG + ":new-x1y2z3:0123456789abcdef:1";
const NOW = "2026-10-21 10:00:00";
const comp = (i) => String(2094626841323700300n + BigInt(i));
const pickOf = (j, extra) => Object.assign({ material_id: SRC, location_id: BIN, batch_id: null, balance_id: String(9000 + j), sm_quantity: 1, category: "Unrestricted" },
  extra || {});
const lineOf = (i, extra) => Object.assign({ id: String(2112073133161845000n + BigInt(i)), item_selection: comp(i), item_name: "C" + i, total_quantity: 1, requested_qty: 1,
  bom_ratio: 1, quantity_uom: UOM, storage_location_id: SLOC, location_id: RBIN, batch_number: "-" }, extra || {});
const linesN = (k) => Array.from({ length: k }, (_, i) => lineOf(i));
// a record of `nLines` recovery lines and `nPicks` source picks of 1 each (moves = nPicks + nLines)
const record = (page, nLines, nPicks, extra) => {
  const k = nPicks === undefined ? 1 : nPicks;
  return Object.assign({ id: page === "Add" ? undefined : IDA, organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: page === "Add" ? "" : "IDA-2610-0042",
    stock_movement_no_type: "2107022471794724866", item_disassembly_status: page === "Add" ? "" : "Draft", item_id: SRC, item_code: "FG-0001", item_name: "FG", item_desc: "",
    item_qty: k, item_uom: UOM, item_disassembly_date: "2026-10-21", issued_by: "t", project_id: "", remarks: "", remarks_2: "", remarks_3: "", reference_documents: [],
    stock_summary: "", temp_qty_data: JSON.stringify(Array.from({ length: k }, (_, j) => pickOf(j))), temp_hu_data: "[]", page_status: page, stock_movement: linesN(nLines),
    ida_v2_job_id: "x", ida_idem_key: "y" }, extra || {});
};
const itemRow = (id, extra) => Object.assign({ id: id, material_code: "M" + id.slice(-4), material_name: "N" + id.slice(-4), stock_control: 1, serial_number_management: 0,
  item_batch_management: 0, batch_number_genaration: "", material_costing_method: "First In First Out", purchase_unit_price: "0.0000", based_uom: UOM,
  item_category: "2018905941675634693", item_group_id: null, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }, extra || {});
const itemsFor = (rec, over) => {
  const ids = [rec.item_id].concat(rec.stock_movement.map((l) => l.item_selection)).filter((x, i, a) => x && a.indexOf(x) === i);
  return ids.map((id) => ({ j: JSON.stringify(itemRow(id, (over || {})[id])) }));
};
const bncRow = (o) => ({ j: JSON.stringify(Object.assign({ id: "2062365526375706626", batch_level_selection: "Organization Level", item_id: null, item_category_id: null,
  item_group_id: null, batch_format: "Batch-%5d", running_number: 631, reset_frequency: "Never Reset", initial_value: 0, last_reset_date: null,
  date_format: "Document Created Date", format_preview: "Batch-00001", organization_id: ORG }, o || {})) });
const holder = (num0, extra) => ({ j: JSON.stringify(Object.assign({ id: "2102000000000000001", batch_number: num0, material_id: comp(90), plant_id: PLANT, organization_id: ORG,
  transaction_no: "GR-0001" }, extra || {})) });
const job = (o) => JSON.stringify(Object.assign({ id: "2112100000000000001", command: "COMPLETE_IDA", job_status: "QUEUED", correlation_id: "IDA|" + IDA, progress_percent: 0,
  progress_message: "Queued for processing", error_code: null, error_message: null, line_count: 61, action: "DIRECT", ida_no: "IDA-2610-0042" }, o || {}));
const facts = (o) => [Object.assign({ db_now: NOW, key_job: null, ida_id: IDA, stock_movement_no: "IDA-2610-0042", item_disassembly_status: "Draft", posted_status: null,
  organization_id: ORG, plant_id: PLANT, no_type: "2107022471794724866", ida_v2_job_id: null, ida_lock: null, open_jobs: null, last_job: null, link_job: null,
  issued_by_job: 0, completed_under: 0 }, o || {})];
const addFacts = (o) => facts(Object.assign({ ida_id: null, stock_movement_no: null, item_disassembly_status: null, organization_id: null, plant_id: null, no_type: null },
  o || {}));
const guardIn = (o) => Object.assign({ operation: "SUBMIT", saveAs: "Completed", pageStatus: "Edit", idaId: IDA, key: KEY, source: "FORM", organizationId: ORG, tenantId: T,
  uid: "1123598821738675201", uuid: "ab12cd34-0000" }, o || {});
const READS0 = { cost: [], wa: [], dup: [], bnc: [bncRow()], batches: [] };
const GATE_SMALL = ["route", "code", "message", "reason", "errorCode", "moveCount"];
const POST_IN = ["route", "code", "message", "errorCode", "lineCount", "pickCount", "moveCount", "stockLines", "nonStockLines", "plantId", "organizationId", "stockMovementNo"];
// the pipeline up to the first answer: guard -> entry -> keys -> gate -> post, each node fed what the workflow feeds it
function submit(g, f, rec, reads) {
  const guard = submitGuard(guardIn(Object.assign({ organizationId: obj(rec) ? rec.organization_id : undefined }, g || {})));
  if (guard.route === "REJECT") return { at: "guard", guard: guard, res: submitResult(guard, null, guard, null) };
  const entry = submitEntry(guard, f, obj(rec) ? rec.item_disassembly_status : undefined);
  if (entry.route !== "GO") return { at: "entry", guard: guard, entry: entry, res: submitResult(guard, entry, entry, null) };
  const keys = submitKeys(guard, entry, rec);
  if (keys.route !== "GO") return { at: "keys", guard: guard, entry: entry, keys: keys, res: submitResult(guard, entry, keys, null) };
  const R = Object.assign({ items: itemsFor(rec) }, READS0, reads || {});
  const gate = submitGate(guard, entry, keys, rec, R);
  if (gate.route !== "GO") return { at: "gate", guard: guard, entry: entry, keys: keys, gate: gate, res: submitResult(guard, entry, pick(gate, GATE_SMALL), null) };
  const post = submitPost(guard, entry, pick(gate, POST_IN));
  return { at: post.route === "QUEUE" ? "queue" : "post", guard: guard, entry: entry, keys: keys, gate: gate, post: post,
    res: post.route === "QUEUE" ? null : submitResult(guard, entry, post, null) };
}
const ans = (r) => (r.res ? pick(r.res, ["route", "code", "message", "reason", "error_code"]) : { at: r.at });
const addReq = { pageStatus: "Add", idaId: "", key: AKEY };
const INVALID_KEY = "idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -";

// ------------------------------------------------------------------ guard (INVALID requests)
eq("guard: default op SUBMIT, Edit", pick(submitGuard(guardIn()), ["route", "operation", "pageStatus", "idaId", "key", "organizationId"]),
  { route: "CONTINUE", operation: "SUBMIT", pageStatus: "Edit", idaId: IDA, key: KEY, organizationId: ORG });
eq("guard: Clone = Add, clone YES", pick(submitGuard(guardIn({ pageStatus: "Clone", idaId: "" })), ["route", "pageStatus", "clone", "idaId"]),
  { route: "CONTINUE", pageStatus: "Add", clone: "YES", idaId: "0" });
eq("guard: Copy = Clone", pick(submitGuard(guardIn({ pageStatus: "Copy", idaId: "0" })), ["pageStatus", "clone"]), { pageStatus: "Add", clone: "YES" });
eq("guard: Draft accepted (answered NOT_ELIGIBLE later)", submitGuard(guardIn({ saveAs: "Draft" })).route, "CONTINUE");
for (const [label, o, why] of [["saveAs", { saveAs: "Issued" }, "saveAs must be Draft or Completed"],
  ["View", { pageStatus: "View" }, "an Item Disassembly in View mode can't be saved"], ["page", { pageStatus: "Delete" }, "pageStatus must be Add, Edit or Clone"],
  ["Edit id", { idaId: "12a" }, "ida_id: digits only"], ["Edit without an id", { idaId: "" }, "ida_id: digits only"],
  ["Add id", { pageStatus: "Add", idaId: IDA }, "ida_id must be empty for Add / Clone"],
  ["Clone with the source id", { pageStatus: "Clone", idaId: IDA }, "ida_id must be empty for Add / Clone"],
  ["key", { key: "short" }, INVALID_KEY], ["key chars", { key: "IDA:1:2:3 4" }, INVALID_KEY], ["no key", { key: "" }, INVALID_KEY],
  ["tenant", { tenantId: "" }, "no session tenant"], ["source", { source: "LIST" }, "source must be FORM or MOBILE"],
  ["org", { organizationId: "abc" }, "form.organization_id: digits only"], ["org as an unsafe number", { organizationId: 1123598813738675201 }, "form.organization_id: digits only"],
  ["op", { operation: "DELETE" }, "operation must be SUBMIT or STATUS"]]) {
  const r = submit(o, facts(), record("Edit", 3));
  eq("guard INVALID " + label, [r.at, ans(r)], ["guard", { route: "INVALID", code: "400", message: why, reason: "", error_code: "IDA_INVALID_REQUEST" }]);
}
eq("guard INVALID: no record (form not an object) -> its organization is missing", ans(submit({}, facts(), "not a record")),
  { route: "INVALID", code: "400", message: "form.organization_id: digits only", reason: "", error_code: "IDA_INVALID_REQUEST" });
eq("guard: STATUS by ida_id (form {})", pick(submitGuard(guardIn({ operation: "STATUS", key: "", organizationId: undefined })), ["route", "idaId", "key"]),
  { route: "CONTINUE", idaId: IDA, key: "NOKEY" });
eq("guard: STATUS by key only (an Add waiting for its link)", pick(submitGuard(guardIn({ operation: "status", idaId: "", key: AKEY })), ["route", "idaId", "key"]),
  { route: "CONTINUE", idaId: "0", key: AKEY });
eq("guard: STATUS needs one of them", submitGuard(guardIn({ operation: "STATUS", idaId: "", key: "" })).message, "STATUS needs ida_id or idempotency_key");
eq("guard: STATUS with a bad id", submitGuard(guardIn({ operation: "STATUS", idaId: "x1" })).message, "ida_id: digits only");
eq("guard: nonce from the run uuid", submitGuard(guardIn({ uuid: "ab-12-CD-34-ef" })).nonce, "ab12CD34");
eq("guard: MOBILE", submitGuard(guardIn({ source: "mobile" })).source, "MOBILE");
eq("guard: the result of an INVALID answer: every field a string, ida_id ''", [Object.values(submit({ key: "" }, facts(), record("Edit", 3)).res).every((v) => typeof v === "string"),
  submit({ key: "" }, facts(), record("Edit", 3)).res.ida_id], [true, ""]);

// ------------------------------------------------------------------ entry: the key's job, STATUS
const big = record("Edit", 60);
let r = submit({}, facts({ key_job: job({ job_status: "VALIDATING", progress_percent: 10, progress_message: "Preparing" }) }), big);
eq("same idempotency key twice: that job's STATUS, nothing else run", [r.at, pick(r.res, ["route", "code", "job_id", "job_status", "terminal", "ida_id", "ida_no",
  "progress_percent", "action", "line_count"])], ["entry", { route: "STATUS", code: "200", job_id: "2112100000000000001", job_status: "VALIDATING", terminal: "NO", ida_id: IDA,
  ida_no: "IDA-2610-0042", progress_percent: "10", action: "DIRECT", line_count: "61" }]);
r = submit({}, facts({ key_job: job({ job_status: "FAILED", error_code: "IDA_LINES_CHANGED", error_message: "changed" }) }), big);
eq("the key's FAILED job: STATUS terminal with its error", pick(r.res, ["route", "job_status", "terminal", "error_code", "error_message"]),
  { route: "STATUS", job_status: "FAILED", terminal: "YES", error_code: "IDA_LINES_CHANGED", error_message: "changed" });
r = submit({ pageStatus: "Add", idaId: "", key: AKEY }, addFacts({ key_job: job({ correlation_id: "IDA|2112100000000000077", job_status: "COMPLETED" }) }), record("Add", 60));
eq("an Add re-sent with its key after the link: the linked IDA's STATUS", pick(r.res, ["route", "ida_id", "job_status", "terminal"]),
  { route: "STATUS", ida_id: "2112100000000000077", job_status: "COMPLETED", terminal: "YES" });
r = submit({ operation: "STATUS", key: "" }, facts({ last_job: job({ job_status: "COMMITTING_IDA", progress_percent: 80 }) }), {});
eq("STATUS: the IDA's latest COMPLETE_IDA job", pick(r.res, ["route", "job_status", "terminal", "progress_percent"]),
  { route: "STATUS", job_status: "COMMITTING_IDA", terminal: "NO", progress_percent: "80" });
r = submit({ operation: "STATUS", key: "" }, facts({ link_job: job({ id: "2112100000000000009", job_status: "COMPLETED" }) }), {});
eq("STATUS: else the job ida_v2_job_id names", pick(r.res, ["job_id", "job_status", "terminal"]), { job_id: "2112100000000000009", job_status: "COMPLETED", terminal: "YES" });
r = submit({ operation: "STATUS", key: "" }, facts(), {});
eq("STATUS: no job -> NONE, terminal, noJob text", pick(r.res, ["route", "code", "job_status", "terminal", "message"]),
  { route: "STATUS", code: "200", job_status: "NONE", terminal: "YES", message: "no background save" });
r = submit({ operation: "STATUS", idaId: "", key: AKEY }, addFacts({ key_job: job({ correlation_id: "IDA|2112100000000000077" }) }), {});
eq("STATUS by key: the linked IDA's id", pick(r.res, ["route", "ida_id"]), { route: "STATUS", ida_id: "2112100000000000077" });
r = submit({ operation: "STATUS", idaId: "", key: AKEY }, addFacts({ key_job: job({ correlation_id: "" }) }), {});
eq("STATUS by key, the job not linked yet: no ida_id", pick(r.res, ["route", "ida_id", "job_status"]), { route: "STATUS", ida_id: "", job_status: "QUEUED" });

// ------------------------------------------------------------------ entry: the action table
r = submit(addReq, addFacts(), record("Add", 60));
eq("Add + Completed: DIRECT, prevStatus Draft", [r.at, r.entry.action, r.entry.prevStatus, r.entry.organizationId], ["queue", "DIRECT", "Draft", ORG]);
for (const page of ["Clone", "Copy"]) {
  r = submit({ pageStatus: page, idaId: "", key: AKEY }, addFacts(), record("Add", 60, 1, { id: IDA, item_disassembly_status: "Completed", page_status: page,
    stock_movement_no: "IDA-2610-0001" }));
  eq(page + " of a Completed IDA + Completed: DIRECT (the stored status is never read)", [r.at, r.entry.action, r.entry.storedStatus], ["queue", "DIRECT", ""]);
  eq(page + ": the header id and every line id stripped", [r.gate.allData.id, r.gate.allData.stock_movement.filter((l) => l.id).length], [undefined, 0]);
  eq(page + ": the V2 helper fields never reach the write", [r.gate.allData.ida_v2_job_id, r.gate.allData.ida_idem_key], [undefined, undefined]);
  eq(page + ": a new number ('issued'), the request says Add", [r.gate.stockMovementNo, JSON.parse(r.post.request).pageStatus, r.post.numberProps], ["issued", "Add", "YES"]);
}
r = submit({ pageStatus: "Add", idaId: "", key: AKEY, saveAs: "Draft" }, addFacts(), record("Add", 60));
eq("Add + Draft: NOT_ELIGIBLE draft", ans(r), { route: "NOT_ELIGIBLE", code: "300", message: "draft", reason: "draft", error_code: "IDA_NOT_ELIGIBLE" });
r = submit({ saveAs: "Draft" }, facts(), record("Edit", 899));
eq("Edit Draft + Draft (900 moves): NOT_ELIGIBLE draft, never STOP", ans(r).route, "NOT_ELIGIBLE");
r = submit({}, facts({ ida_id: null, item_disassembly_status: null }), big);
eq("stored IDA missing: STOP 400 IDA_NOT_FOUND", ans(r), { route: "STOP", code: "400", message: "Item Disassembly not found - it may have been deleted.", reason: "",
  error_code: "IDA_NOT_FOUND" });
const BUSY = "This Item Disassembly is being processed in the background - please wait for it to finish.";
const REVIEW = "Its last completion stopped half-way and is under review: please contact support.";
r = submit({}, facts({ open_jobs: "[" + job({ job_status: "READY_TO_COMMIT", progress_percent: 60 }) + "]" }), big);
eq("an open COMPLETE_IDA job: BUSY 409 with its fields", pick(r.res, ["route", "code", "message", "error_code", "job_id", "job_status", "progress_percent"]),
  { route: "BUSY", code: "409", message: BUSY, error_code: "IDA_BUSY", job_id: "2112100000000000001", job_status: "READY_TO_COMMIT", progress_percent: "60" });
r = submit({}, facts({ open_jobs: "[" + job({ job_status: "REQUIRES_REVIEW" }) + "]", item_disassembly_status: "Processing" }), big);
eq("an open job under review: IDA_UNDER_REVIEW", pick(r.res, ["route", "code", "message", "error_code", "job_status"]),
  { route: "BUSY", code: "409", message: REVIEW, error_code: "IDA_UNDER_REVIEW", job_status: "REQUIRES_REVIEW" });
r = submit({}, facts({ item_disassembly_status: "Processing", link_job: job({ job_status: "REQUIRES_REVIEW" }) }), big);
eq("Processing, linked to a job under review: IDA_UNDER_REVIEW", pick(r.res, ["message", "error_code"]), { message: REVIEW, error_code: "IDA_UNDER_REVIEW" });
r = submit({}, facts({ item_disassembly_status: "Processing", link_job: job({ job_status: "FAILED" }) }), big);
eq("stored Processing (no open job): BUSY", pick(r.res, ["route", "error_code", "message"]), { route: "BUSY", error_code: "IDA_BUSY", message: BUSY });
r = submit({ saveAs: "Draft" }, facts({ item_disassembly_status: "Processing" }), big);
eq("stored Processing + Draft: BUSY (before the Draft rule)", ans(r).route, "BUSY");
const lock = (o) => JSON.stringify(Object.assign({ step: "LOCK|3", ref: "IDA:" + ORG + ":" + IDA + ":ffffffffffffffff:1", young: 1, job: null }, o || {}));
eq("a young lock of another key, no job yet: BUSY", ans(submit({}, facts({ ida_lock: lock() }), big)).route, "BUSY");
eq("a young lock of another key, its job open: BUSY", ans(submit({}, facts({ ida_lock: lock({ job: "QUEUED" }) }), big)).route, "BUSY");
eq("a young lock of another key, its job under review: BUSY", ans(submit({}, facts({ ida_lock: lock({ job: "REQUIRES_REVIEW" }) }), big)).route, "BUSY");
eq("a young lock of another key, its job FAILED: goes on", submit({}, facts({ ida_lock: lock({ job: "FAILED" }) }), big).at, "queue");
eq("an old lock of another key: goes on", submit({}, facts({ ida_lock: lock({ young: 0 }) }), big).at, "queue");
eq("a young lock of THIS key: goes on (its retry)", submit({}, facts({ ida_lock: lock({ ref: KEY }) }), big).at, "queue");
eq("the next lock is LOCK|n+1", submit({}, facts({ ida_lock: lock({ young: 0 }) }), big).post.lockRows[0].step_name, "LOCK|4");
eq("no earlier lock: LOCK|1", submit({}, facts(), big).post.lockRows[0].step_name, "LOCK|1");
r = submit({}, facts({ item_disassembly_status: "Completed" }), big);
eq("form Draft, stored Completed: STALE", ans(r), { route: "STALE", code: "409",
  message: "This Item Disassembly was changed by someone else (it is now Completed). Please close it and open it again.", reason: "", error_code: "IDA_STALE" });
r = submit({}, facts({ item_disassembly_status: "" }), big);
eq("form Draft, stored blank: STALE (without a status)", ans(r).message,
  "This Item Disassembly was changed by someone else (it is now without a status). Please close it and open it again.");
r = submit({}, facts({ item_disassembly_status: "Completed" }), record("Edit", 60, 1, { item_disassembly_status: "Completed" }));
eq("stored and form Completed: ALREADY_FINAL", ans(r), { route: "STALE", code: "409", message: "This Item Disassembly is already Completed.", reason: "",
  error_code: "IDA_ALREADY_FINAL" });
r = submit({ saveAs: "Draft" }, facts({ item_disassembly_status: "Fully Posted" }), record("Edit", 60, 1, { item_disassembly_status: "Fully Posted" }));
eq("Fully Posted + Draft: ALREADY_FINAL", ans(r).error_code, "IDA_ALREADY_FINAL");
r = submit({}, facts({ item_disassembly_status: "Issued" }), record("Edit", 60, 1, { item_disassembly_status: "Issued" }));
eq("another stored status: NOT_ELIGIBLE status <x>", ans(r), { route: "NOT_ELIGIBLE", code: "300", message: "status Issued", reason: "status Issued",
  error_code: "IDA_NOT_ELIGIBLE" });
r = submit({}, facts({ item_disassembly_status: "" }), record("Edit", 60, 1, { item_disassembly_status: "" }));
eq("a blank stored status: NOT_ELIGIBLE status (none)", ans(r).message, "status (none)");
r = submit({}, facts(), big);
eq("stored Draft + Completed: DIRECT", [r.at, r.entry.action, r.entry.prevStatus], ["queue", "DIRECT", "Draft"]);

// ------------------------------------------------------------------ keys
eq("keys: no record -> INVALID (defensive)", submitKeys(submitGuard(guardIn()), { organizationId: ORG }, null).route, "INVALID");
eq("keys: another IDA's record -> INVALID", ans(submit({}, facts(), record("Edit", 3, 1, { id: "2112073133161844999" }))).message,
  "form: not the record of Item Disassembly " + IDA);
const tuplesRec = record("Edit", 2, 0, { item_qty: 4, temp_qty_data: JSON.stringify([pickOf(0, { sm_quantity: 2 }), pickOf(1, { batch_id: BATCH, sm_quantity: 2 }),
  pickOf(2, { sm_quantity: 0 })]) });
tuplesRec.stock_movement[1].batch_number = "LOT-7 ";
r = submit({}, facts(), tuplesRec);
eq("keys: tuples (digits only, each once; picks of the header; the receipts' item + target bin; batch picks)", pick(r.keys, ["pickPairsJson", "costPairsJson",
  "balTuplesJson", "batchTuplesJson", "plantId", "organizationId", "pickCount", "lineCount", "moveCount"]), {
  pickPairsJson: "[[" + SRC + ",0],[" + SRC + "," + BATCH + "]]", costPairsJson: "[[" + SRC + ",0],[" + SRC + "," + BATCH + "],[" + comp(0) + ",0],[" + comp(1) + ",0]]",
  balTuplesJson: "[[" + SRC + "," + BIN + "],[" + comp(0) + "," + RBIN + "],[" + comp(1) + "," + RBIN + "]]", batchTuplesJson: "[[" + SRC + "," + BIN + "," + BATCH + "]]",
  plantId: PLANT, organizationId: ORG, pickCount: 2, lineCount: 2, moveCount: 4 });
eq("keys: item ids = code_item_ids (source first, unique)", r.keys.itemIdsSql, "0," + SRC + "," + comp(0) + "," + comp(1));
eq("keys: typed numbers only as hex (code_item_ids' trimmed list)", [r.keys.hexJson, JSON.parse(r.keys.hexJson).map((h) => Buffer.from(h, "hex").toString("utf8"))],
  [C.idaHexJson(["LOT-7"]), ["LOT-7"]]);
eq("keys: no typed number -> the classic's sentinel only", JSON.parse(submit({}, facts(), big).keys.hexJson).map((h) => Buffer.from(h, "hex").toString("utf8")),
  ["__no_batch__"]);
eq("keys: Edit org = the STORED IDA's", submit({}, facts({ organization_id: "1123598813738675299" }), big).keys.organizationId, "1123598813738675299");
eq("keys: Add org = the form's", submit(addReq, addFacts(), record("Add", 3)).keys.organizationId, ORG);

// ------------------------------------------------------------------ gate: eligibility, both sides of 250 moves
const TOO_BIG = (moves, why) => "This Item Disassembly has " + moves + " source picks and recovery lines and cannot be completed in the background (" + why
  + "); the classic save handles at most 250.";
// rec(nLines, nPicks, page) builds the case; 250 moves = 1 pick + 249 lines (NOT_ELIGIBLE), 251 = 1 pick + 250 lines (STOP IDA_TOO_BIG)
const elig = (label, rec, reads, why, itemsOver) => {
  for (const [nl, page] of [[249, "Edit"], [250, "Add"], [250, "Edit"]]) {
    const recK = rec(nl, page);
    const R = Object.assign({}, reads || {}, itemsOver ? { items: itemsFor(recK, itemsOver) } : {});
    const res = submit(page === "Add" ? addReq : {}, page === "Add" ? addFacts() : facts(), recK, R);
    const moves = C.idaMoveCount(recK, recK.stock_movement);
    eq("eligibility " + label + " (" + page + ", " + moves + " moves)", ans(res), moves > 250
      ? { route: "STOP", code: "400", message: TOO_BIG(moves, why), reason: why, error_code: "IDA_TOO_BIG" }
      : { route: "NOT_ELIGIBLE", code: "300", message: why, reason: why, error_code: "IDA_NOT_ELIGIBLE" });
  }
};
const recN = (nl, page) => record(page, nl);
const withPicks = (picks) => (nl, page) => record(page, nl, 1, { item_qty: picks.reduce((a, p) => a + p.sm_quantity, 0), temp_qty_data: JSON.stringify(picks) });
elig("item not found (no ITEMS row: the source first)", recN, { items: [] }, "item " + SRC + " not found");
{
  const recK = recN(20, "Edit");
  const rows = itemsFor(recK).filter((x) => JSON.parse(x.j).id !== comp(7));
  eq("eligibility: a recovery item not found", ans(submit({}, facts(), recK, { items: rows })).message, "item " + comp(7) + " not found");
}
elig("handling units: a pick with a handling unit", withPicks([pickOf(0, { handling_unit_id: "2037062451509002299" })]), null, "handling units");
elig("handling units: temp_hu_data", (nl, page) => record(page, nl, 1, { temp_hu_data: '[{"handling_unit_id":"1"}]' }), null, "handling units");
elig("handling units: table_hu", (nl, page) => record(page, nl, 1, { table_hu: [{ id: "1" }] }), null, "handling units");
elig("serial-numbered source item", recN, null, "serial-numbered source item", { [SRC]: { serial_number_management: 1 } });
elig("source item not stock controlled", recN, null, "source item not stock controlled", { [SRC]: { stock_control: 0 } });
elig("source stock_control NULL", recN, null, "item M" + SRC.slice(-4) + " has no stock control setting", { [SRC]: { stock_control: null } });
elig("recovery stock_control NULL", recN, null, "item M" + comp(2).slice(-4) + " has no stock control setting", { [comp(2)]: { stock_control: null } });
elig("a Reserved source pick", withPicks([pickOf(0, { category: "Blocked" }), pickOf(1, { category: "Reserved" })]), null, "Reserved stock");
elig("an In Transit source pick", withPicks([pickOf(0, { category: "In Transit" })]), null, "In Transit stock");
elig("costing migration (a source pick)", recN, { cost: [{ j: JSON.stringify({ material_id: SRC, batch_id: "0", method: "First In First Out", fifo: 0, wa: 2 }) }] },
  "costing migration");
elig("costing migration (a batch source pick)", withPicks([pickOf(0, { batch_id: BATCH })]), { cost: [{ j: JSON.stringify({ material_id: SRC, batch_id: BATCH, fifo: 1,
  wa: 1 }) }] }, "costing migration");
elig("costing migration (a stock recovery item)", recN, { cost: [{ j: JSON.stringify({ material_id: comp(5), batch_id: "0", method: "Weighted Average", fifo: 3, wa: 0 }) }] },
  "costing migration");
elig("duplicate item_balance (a source pick's bin)", recN, { dup: [{ j: JSON.stringify({ t: "B", material_id: SRC, location_id: BIN, batch_id: "", n: 2 }) }] },
  "duplicate balance rows");
elig("duplicate item_batch_balance (a batch pick)", withPicks([pickOf(0, { batch_id: BATCH })]), { dup: [{ j: JSON.stringify({ t: "T", material_id: SRC, location_id: BIN,
  batch_id: BATCH, n: 2 }) }] }, "duplicate balance rows");
elig("duplicate item_balance (a receipt bin)", recN, { dup: [{ j: JSON.stringify({ t: "B", material_id: comp(4), location_id: RBIN, batch_id: "", n: 2 }) }] },
  "duplicate balance rows");
{
  // every recovery item non-stock: op 2 would be empty
  const nonStock = (rec) => {
    const o = {};
    rec.stock_movement.forEach((l) => { o[l.item_selection] = { stock_control: 0 }; });
    return o;
  };
  for (const [nl, page] of [[249, "Edit"], [250, "Edit"]]) {
    const recK = record(page, nl);
    const res = submit({}, facts(), recK, { items: itemsFor(recK, nonStock(recK)) });
    eq("eligibility no stock to receive (" + (nl + 1) + " moves)", ans(res), nl + 1 > 250
      ? { route: "STOP", code: "400", message: TOO_BIG(nl + 1, "no stock to receive"), reason: "no stock to receive", error_code: "IDA_TOO_BIG" }
      : { route: "NOT_ELIGIBLE", code: "300", message: "no stock to receive", reason: "no stock to receive", error_code: "IDA_NOT_ELIGIBLE" });
  }
}
eq("a duplicate flag on another bin is not ours", submit({}, facts(), recN(60, "Edit"), { dup: [{ j: JSON.stringify({ t: "B", material_id: SRC, location_id: RBIN, batch_id: "",
  n: 2 }) }] }).at, "queue");
eq("a costing flag of another batch is not ours", submit({}, facts(), recN(60, "Edit"), { cost: [{ j: JSON.stringify({ material_id: SRC, batch_id: "1", fifo: 1, wa: 1 }) }] })
  .at, "queue");
{
  const recK = recN(60, "Edit");
  const over = { [comp(3)]: { stock_control: 0 } };
  const flags = { dup: [{ j: JSON.stringify({ t: "B", material_id: comp(3), location_id: RBIN, batch_id: "", n: 2 }) }],
    cost: [{ j: JSON.stringify({ material_id: comp(3), batch_id: "0", fifo: 1, wa: 1 }) }] };
  eq("flags on a NON-stock recovery line are not ours (it is never received)", submit({}, facts(), recK, Object.assign({ items: itemsFor(recK, over) }, flags)).at, "queue");
}
eq("the first reason wins: serial source + Reserved pick -> serial", ans(submit({}, facts(), withPicks([pickOf(0, { category: "Reserved" })])(60, "Edit"),
  { items: itemsFor(record("Edit", 60), { [SRC]: { serial_number_management: 1 } }) })).message, "serial-numbered source item");

// ------------------------------------------------------------------ gate: the lifted classic gates (STOP 400 with the classic texts)
r = submit({}, facts(), record("Edit", 60, 1, { item_disassembly_date: "" }));
eq("required fields (CHECK_REQUIRED_FIELD v8 text)", ans(r), { route: "STOP", code: "400", message: "Validation Error: Date", reason: "", error_code: "IDA_REQUIRED_FIELDS" });
r = submit({}, facts(), record("Edit", 60, 1, { stock_movement_no: "" }));
eq("required fields: the number of an Edit (the fill-back sets 'issued')", r.at, "queue");
r = submit({}, facts(), record("Edit", 60, 2, { item_qty: 3 }));
eq("code_validate (its 401 text as STOP 400 IDA_INVALID)", ans(r), { route: "STOP", code: "400",
  message: "The allocated stock (2) does not match the disassembly quantity (3). Select the stock again.", reason: "", error_code: "IDA_INVALID" });
const noBin = record("Edit", 60);
noBin.stock_movement[7].location_id = "";
eq("code_validate: a line without its target bin", ans(submit({}, facts(), noBin)).message, "Line 8 (C7): bin location is required.");
r = submit({}, facts(), record("Edit", 60, 0, { item_qty: 1, temp_qty_data: "[]" }));
eq("code_validate: no source stock (op 1 would be empty)", ans(r), { route: "STOP", code: "400",
  message: "No source stock has been allocated. Select the stock to disassemble.", reason: "", error_code: "IDA_INVALID" });
const manual = { [comp(2)]: { item_batch_management: 1, batch_number_genaration: "Manual Input" } };
const manRec = record("Edit", 60);
manRec.stock_movement[2].batch_number = "";
eq("code_validate: a manual batch item without a number", ans(submit({}, facts(), manRec, { items: itemsFor(manRec, manual) })).message,
  "Line 3 (C2): Batch number is required.");
const lotRec = record("Edit", 60);
lotRec.stock_movement[2].batch_number = "LOT-7";
eq("code_validate: an exact typed number already held (the classic's own check)", ans(submit({}, facts(), lotRec, { items: itemsFor(lotRec, manual),
  batches: [holder("LOT-7")] })), { route: "STOP", code: "400", message: "Line 3 (C2): Batch No LOT-7 already exists.", reason: "", error_code: "IDA_INVALID" });

// ------------------------------------------------------------------ gate: the typed-number check (F4: case-insensitive, trailing spaces cut)
const typed = (i, n0, extra) => {
  const rec = record("Edit", 60);
  rec.stock_movement[i].batch_number = n0;
  Object.assign(rec.stock_movement[i], extra || {});
  return rec;
};
r = submit({}, facts(), typed(2, "lot-7"), { items: itemsFor(typed(2, "lot-7"), manual), batches: [holder("LOT-7")] });
eq("F4: 'lot-7' typed, 'LOT-7' held -> code_validate passes it, SUBMIT refuses (code_validate's wording)", ans(r),
  { route: "STOP", code: "400", message: "Line 3 (C2): Batch No lot-7 already exists.", reason: "", error_code: "IDA_INVALID" });
r = submit({}, facts(), typed(4, "LOT-7  "), { batches: [holder("lot-7")] });
eq("F4: trailing spaces cut, a non-batch-managed stock item's typed number too", ans(r).message, "Line 5 (C4): Batch No LOT-7 already exists.");
r = submit({}, facts(), typed(4, "LOT-7", { item_name: "" }), { batches: [holder("Lot-7")] });
eq("F4: the label falls back to the item id", ans(r).message, "Line 5 (" + comp(4) + "): Batch No LOT-7 already exists.");
const twoTyped = typed(9, "B-2");
twoTyped.stock_movement[3].batch_number = "b-1";
eq("F4: the FIRST line in line order", ans(submit({}, facts(), twoTyped, { batches: [holder("B-2"), holder("B-1")] })).message,
  "Line 4 (C3): Batch No b-1 already exists.");
r = submit({}, facts(), typed(4, "LOT-7"), { items: itemsFor(typed(4, "LOT-7"), { [comp(4)]: { stock_control: 0 } }), batches: [holder("LOT-7")] });
eq("F4: a NON-stock line's typed number is not checked (no Batch row for it)", r.at, "queue");
r = submit({}, facts(), typed(4, "LOT-8"), { batches: [holder("LOT-7")] });
eq("F4: a holder of another number: passes", r.at, "queue");
const auto = { [comp(4)]: { item_batch_management: 1, batch_number_genaration: "According To System Settings" } };
r = submit({}, facts(), typed(4, "Auto-generated batch number"), { items: itemsFor(typed(4, "Auto-generated batch number"), auto),
  batches: [holder("Auto-generated batch number")] });
eq("F4: an AUTO line is not a typed number", r.at, "queue");
r = submit({}, facts(), typed(4, "-"), { batches: [holder("-")] });
eq("F4: '-' is no number", r.at, "queue");
eq("F4 text = IDA_TEXT.typedExists(idaLineLabel(i, line), n)", C.IDA_TEXT.typedExists(C.idaLineLabel(3, { item_name: "C2" }), "lot-7"),
  "Line 3 (C2): Batch No lot-7 already exists.");

// ------------------------------------------------------------------ gate: limits
r = submit({}, facts(), record("Edit", 10, 5001));
eq("5,001 source picks: STOP IDA_SPLIT_REQUIRED", ans(r), { route: "STOP", code: "400",
  message: "This Item Disassembly has 5001 source picks. At most 5,000 can be moved at once - please split the disassembly.", reason: "split",
  error_code: "IDA_SPLIT_REQUIRED" });
r = submit({}, facts(), record("Edit", 5001, 1));
eq("5,001 recovery lines: STOP IDA_SPLIT_REQUIRED", ans(r), { route: "STOP", code: "400",
  message: "This Item Disassembly has 5001 recovery lines. At most 5,000 can be moved at once - please split the disassembly.", reason: "split",
  error_code: "IDA_SPLIT_REQUIRED" });
// Cap 2,500 (controller ruling 10-21): at most 2,500 movements per leg; the shared 5,000 check above stays the backstop
const CAP = (k, what) => ({ route: "STOP", code: "400", message: "This Item Disassembly has " + k + " " + what
  + ". At most 2,500 can be completed in the background at once - please split the disassembly.", reason: "split", error_code: "IDA_SPLIT_REQUIRED" });
r = submit({}, facts(), record("Edit", 2500, 2500));
eq("2,500 picks + 2,500 lines: queued (5,000 moves, line_count = moves)", [r.at, r.post && r.post.jobRows[0].line_count], ["queue", 5000]);
eq("2,501 stock recovery lines: STOP IDA_SPLIT_REQUIRED (the 2,500 text)", ans(submit({}, facts(), record("Edit", 2501, 1))), CAP(2501, "recovery lines"));
eq("2,501 source picks: STOP IDA_SPLIT_REQUIRED (the 2,500 text)", ans(submit({}, facts(), record("Edit", 10, 2501))), CAP(2501, "source picks"));
eq("5,000 recovery lines: the 2,500 cap answers (below the 5,000 backstop)", ans(submit({}, facts(), record("Edit", 5000, 1))), CAP(5000, "recovery lines"));
{
  const rec = record("Edit", 2501, 1);
  r = submit({}, facts(), rec, { items: itemsFor(rec, { [comp(7)]: { stock_control: 0 } }) });
  eq("2,501 lines, one non-stock (2,500 receipts = op 2 movements): queued", [r.at, JSON.parse(r.post.request).stockLines], ["queue", 2500]);
}

// ------------------------------------------------------------------ gate: the WA screen
r = submit({}, facts(), recN(60, "Edit"), { wa: [{ j: JSON.stringify({ material_id: SRC, batch_id: "0", material_code: "FG-0001" }) }] });
eq("WA screen, non-batch pick: GLOBAL_INVENTORY_VALIDATION's text", ans(r), { route: "STOP", code: "400",
  message: "No Weighted Average costing record for item M" + SRC.slice(-4) + " at this plant. The batch was most likely moved between plants without its costing record; "
    + "create it for this plant before issuing this stock.", reason: "", error_code: "IDA_NO_WA_RECORD" });
r = submit({}, facts(), withPicks([pickOf(0, { batch_id: BATCH })])(60, "Edit"), { wa: [{ j: JSON.stringify({ material_id: SRC, batch_id: BATCH }) }] });
eq("WA screen, batch pick: names the batch", ans(r).message, "No Weighted Average costing record for item M" + SRC.slice(-4) + " at this plant (batch " + BATCH + "). "
  + "The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock.");
r = submit({}, facts(), withPicks([pickOf(0, { batch_id: BATCH })])(60, "Edit"), { wa: [{ j: JSON.stringify({ material_id: SRC, batch_id: "0" }) }] });
eq("WA screen: a flag of the non-batch key does not refuse a batch pick", r.at, "queue");

// ------------------------------------------------------------------ gate: the batchnum dry run (nothing reserved: no write node exists for it)
const autoRec = (extra, i) => {
  const rec = record("Edit", 60);
  rec.stock_movement[i === undefined ? 4 : i].batch_number = "Auto-generated batch number";
  Object.assign(rec.stock_movement[i === undefined ? 4 : i], extra || {});
  return rec;
};
const dry = (cfgRows, rec, over) => submit({}, facts(), rec || autoRec(), { items: itemsFor(rec || autoRec(), over || auto), bnc: cfgRows });
eq("dry run: the org's default config numbers it -> queued", [dry([bncRow()]).at, dry([bncRow()]).gate.autoLines], ["queue", 1]);
for (const [label, cfgRows, rec, over, msg] of [
  ["no default config", [], null, null, "No default batch found."],
  ["only an item-level config of another item", [bncRow({ batch_level_selection: "Item Level", item_id: "999" })], null, null, "No default batch found."],
  ["Expired Date format, the line has none", [bncRow({ date_format: "Expired Date" })], null, null, "Expired Date is required."],
  ["Manufacturing Date format, the line has none", [bncRow({ date_format: "Manufacturing Date" })], null, null, "Manufacturing Date is required."],
  ["an unknown date format", [bncRow({ date_format: "Posting Date" })], null, null, "Invalid date format configuration."],
  ["Item Category Level, an item without a category", [bncRow({ batch_level_selection: "Item Category Level" })], null,
    { [comp(4)]: Object.assign({ item_category: null }, auto[comp(4)]) }, "The item has no category, which Item Category Level batch numbering needs."],
  ["Item Group Level, an item without a group", [bncRow({ batch_level_selection: "Item Group Level" })], null, null,
    "The item has no item group, which Item Group Level batch numbering needs."],
  ["a NON-stock AUTO line counts (the classic generated for it too)", [bncRow({ date_format: "Expired Date" })], null,
    { [comp(4)]: Object.assign({ stock_control: 0 }, auto[comp(4)]) }, "Expired Date is required."]]) {
  eq("dry run refusal: " + label, ans(dry(cfgRows, rec, over)), { route: "STOP", code: "400", message: msg, reason: "", error_code: "IDA_BATCH_CONFIG" });
}
eq("dry run: Expired Date format with the line's expiry -> queued", dry([bncRow({ date_format: "Expired Date" })], autoRec({ expired_date: "2028-10-21" })).at, "queue");
eq("dry run: Document Date format -> queued (the required Date is always there)", dry([bncRow({ date_format: "Document Date" })]).at, "queue");
eq("dry run: Document Date is required. (unreachable through the gate: CHECK_REQUIRED_FIELD refuses a blank Date first)",
  [idaBatchnum([bncRow({ date_format: "Document Date" })], [], [{ item_id: comp(4), document_date: null, organization_id: ORG }], Date.now()).error,
    ans(dry([bncRow({ date_format: "Document Date" })], Object.assign(autoRec(), { item_disassembly_date: "" }))).error_code],
  ["Document Date is required.", "IDA_REQUIRED_FIELDS"]);
eq("dry run: no AUTO line -> no dry run (an empty BNC passes)", submit({}, facts(), recN(60, "Edit"), { bnc: [] }).at, "queue");
eq("dry run: a blank batch_number of an AUTO item is AUTO (code_batch_plan's rule)", dry([], autoRec({ batch_number: "" })).res.error_code, "IDA_BATCH_CONFIG");
eq("dry run: the first refusing AUTO line stops it (line order)", ans(dry([bncRow({ date_format: "Expired Date" })], (() => {
  const x = autoRec({ expired_date: "2028-10-21" });
  x.stock_movement[8].batch_number = "Auto-generated batch number";
  return x;
})(), Object.assign({ [comp(8)]: auto[comp(4)] }, auto))).message, "Expired Date is required.");

// ------------------------------------------------------------------ post: the queue rows and the number rule
r = submit(addReq, addFacts(), record("Add", 60));
eq("Add: no lock before the insert; numberProps YES; the 'issued' sentinel", [r.post.needLock, r.post.lockRows.length, r.post.numberProps, r.post.numberIssued],
  ["NO", 0, "YES", "YES"]);
eq("Add: the job row (line_count = moves)", r.post.jobRows[0], { organization_id: ORG, plant_id: PLANT, command: "COMPLETE_IDA", idempotency_key: AKEY, job_status: "QUEUED",
  progress_percent: 0, progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: "2026-10-21 10:10:00",
  request_payload: r.post.request, causation_id: "", correlation_id: "", line_count: 61, queued_at: NOW });
eq("Add: the request (CONTRACT section 3)", JSON.parse(r.post.request), { v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Add", idaId: "",
  idaNo: "", issuedNo: "", lineFingerprint: "", organizationId: ORG, plantId: PLANT, lineCount: 60, pickCount: 1, moveCount: 61, stockLines: 60, nonStockLines: 0,
  uid: "1123598821738675201", source: "FORM", nonce: "ab12cd34", parts: {} });
eq("Add: the request never holds lines", Object.keys(JSON.parse(r.post.request)).some((k) => /line|stock_movement/.test(k) && !/Count|Lines|Fingerprint/.test(k)), false);
const mixed = record("Edit", 60);
r = submit({}, facts(), mixed, { items: itemsFor(mixed, { [comp(1)]: { stock_control: 0 }, [comp(2)]: { stock_control: 0 } }) });
eq("stock / non-stock lines counted from the items", pick(JSON.parse(r.post.request), ["lineCount", "stockLines", "nonStockLines", "moveCount"]),
  { lineCount: 60, stockLines: 58, nonStockLines: 2, moveCount: 61 });
r = submit({}, facts(), big);
eq("stored Draft: LOCK|n+1 row (the key as result_ref, db clock)", r.post.lockRows, [{ job_id: "IDC|" + IDA, organization_id: ORG, step_name: "LOCK|1",
  step_status: "LOCK", attempt_count: 0, started_at: NOW, result_ref: KEY }]);
eq("stored Draft: correlation / causation at the insert", pick(r.post.jobRows[0], ["correlation_id", "causation_id"]), { correlation_id: "IDA|" + IDA, causation_id: IDA });
eq("stored Draft: idaId / idaNo in the request", pick(JSON.parse(r.post.request), ["pageStatus", "idaId", "idaNo"]), { pageStatus: "Edit", idaId: IDA, idaNo: "IDA-2610-0042" });
eq("stored Draft, no earlier job: a new number", [r.post.numberProps, r.post.numberIssued], ["YES", "YES"]);
r = submit({}, facts({ issued_by_job: 1, completed_under: 0 }), big);
eq("number rule: an earlier (failed) job issued it, none COMPLETED under it -> kept", [r.post.numberProps, r.post.numberIssued], ["NO", "NO"]);
r = submit({}, facts({ issued_by_job: 1, completed_under: 1 }), big);
eq("number rule: a COMPLETED job ran under it -> a new number", [r.post.numberProps, r.post.numberIssued], ["YES", "YES"]);
r = submit({}, facts({ issued_by_job: 0, completed_under: 0 }), big);
eq("number rule: no earlier job issued it -> a new number", [r.post.numberProps, r.post.numberIssued], ["YES", "YES"]);
r = submit({}, facts({ issued_by_job: 1, completed_under: 0 }), record("Edit", 60, 1, { stock_movement_no_type: -9999, stock_movement_no: "MAN-7" }));
eq("number rule: -9999 writes the typed number (no sentinel, nothing issued)", [r.post.numberProps, r.post.numberIssued, r.gate.stockMovementNo], ["YES", "NO", "MAN-7"]);
r = submit(addReq, addFacts(), record("Add", 60, 1, { stock_movement_no_type: -9999, stock_movement_no: "MAN-8" }));
eq("Add with -9999: the typed number, numberIssued NO", [r.post.numberProps, r.post.numberIssued, r.gate.allData.stock_movement_no], ["YES", "NO", "MAN-8"]);
eq("the gate's allData is the classic fill-back's (q8, line_index, org / plant stamps, no posted_status here)",
  pick(submit({}, facts(), big).gate.allData.stock_movement[1], ["line_index", "organization_id", "issuing_plant", "total_quantity", "batch_number"]),
  { line_index: 2, organization_id: ORG, issuing_plant: PLANT, total_quantity: 1, batch_number: "-" });
eq("Edit: allData.id is the request's", submit({}, facts(), big).gate.allData.id, IDA);
eq("the fill-back's posted_status 'Unposted' is not a write prop (the add / update nodes drop it)", submit({}, facts(), big).gate.allData.posted_status, "Unposted");
eq("prevStatus not Draft -> refused (no default anywhere)", submitPost(submitGuard(guardIn()), { dbNow: NOW, prevStatus: "Issued" }, { route: "GO", organizationId: ORG })
  .errorCode, "IDA_INVALID_DATA");
eq("no DB clock -> STOP 500", pick(submitPost(submitGuard(guardIn()), { dbNow: "", prevStatus: "Draft" }, { route: "GO", organizationId: ORG }), ["route", "code", "errorCode"]),
  { route: "STOP", code: "500", errorCode: "IDA_QUEUE_FAILED" });

// ------------------------------------------------------------------ row / link / due / result
eq("row: Add -> the insert, its job read back after the link", submitRow({ isAdd: "YES", numberProps: "YES" }, [{ id: "2112100000000000001" }]),
  { ok: "YES", jobId: "2112100000000000001", writeAdd: "YES", writeNumber: "NO", writeNoNumber: "NO", backNow: "NO" });
eq("row: stored Draft -> its job read back with the document (in the read-back fork-join)", submitRow({ isAdd: "NO", numberProps: "YES" },
  [{ id: "2112100000000000001" }]).backNow, "YES");
eq("row: Draft + number", submitRow({ isAdd: "NO", numberProps: "YES" }, [{ id: "2112100000000000001" }]).writeNumber, "YES");
eq("row: Draft, number kept", submitRow({ isAdd: "NO", numberProps: "NO" }, [{ id: "2112100000000000001" }]).writeNoNumber, "YES");
eq("row: no job id -> nothing written, nothing read back", submitRow({ isAdd: "NO" }, []), { ok: "NO", jobId: "0", writeAdd: "NO", writeNumber: "NO", writeNoNumber: "NO",
  backNow: "NO" });
const addRun = submit(addReq, addFacts(), record("Add", 3));
const NEWIDA = "2112200000000000001";
const fpLines = addRun.gate.allData.stock_movement.map((l, i) => ({ j: JSON.stringify({ id: String(2112200000000000100n + BigInt(i)), line_index: String(i + 1),
  item_selection: l.item_selection, quantity_uom: UOM, total_quantity: "1.00000000", location_id: RBIN, batch_number: "-", manufacturing_date: null, expired_date: null,
  item_name: l.item_name }) }));
const fpHeaderOf = (id, no) => [{ j: JSON.stringify({ id: id, item_id: SRC, item_qty: "1.00000000", item_uom: UOM, issuing_operation_faci: PLANT, organization_id: ORG,
  stock_movement_no: no, item_disassembly_status: "Processing", item_disassembly_date: "2026-10-21 00:00:00", temp_qty_data: addRun.gate.allData.temp_qty_data,
  ida_v2_job_id: "2112100000000000001" }) }];
const fpHeader = fpHeaderOf(NEWIDA, "IDA-2610-0043");
const row = { jobId: "2112100000000000001", ok: "YES" };
const link = submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: NEWIDA }], fpHeader, fpLines);
const linkedReq = JSON.parse(link.request);
eq("link (Add): idaId / idaNo / issuedNo / lineFingerprint of the STORED rows", pick(linkedReq, ["idaId", "idaNo", "issuedNo", "lineFingerprint"]),
  { idaId: NEWIDA, idaNo: "IDA-2610-0043", issuedNo: "IDA-2610-0043", lineFingerprint: F.idaLineFingerprint(fpLines, fpHeader) });
eq("link (Add): the fingerprint is DF1 over 3 stored lines", /^DF1:3:[0-9a-f]{16}$/.test(linkedReq.lineFingerprint), true);
eq("link (Add): LOCK|1 + correlation / causation", [link.needLock, link.lockRows[0], link.needLink, pick(link.jobRows[0], ["id", "correlation_id", "causation_id"])],
  ["YES", { job_id: "IDC|" + NEWIDA, organization_id: ORG, step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0, started_at: NOW, result_ref: AKEY }, "YES",
    { id: row.jobId, correlation_id: "IDA|" + NEWIDA, causation_id: NEWIDA }]);
eq("link (Add): the request keeps the section 3 key order", Object.keys(linkedReq), Object.keys(JSON.parse(addRun.post.request)));
eq("link: two rows under the job -> nothing linked", submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: "1" }, { id: "2" }], fpHeader, fpLines).ok, "NO");
eq("link: no row under the job -> nothing linked", submitLink(addRun.guard, addRun.entry, addRun.post, row, [], fpHeader, fpLines).why,
  "the Item Disassembly did not read back (0 found)");
eq("link: the number comes from the FP_HEADER row (HDR_BY_JOB carries ids only)", submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: NEWIDA }],
  fpHeaderOf(NEWIDA, "IDA-2610-0099"), fpLines).idaNo, "IDA-2610-0099");
eq("link: an FP_HEADER row of another IDA -> nothing linked", submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: NEWIDA }], fpHeaderOf(IDA, "IDA-1"), fpLines).ok,
  "NO");
eq("link: no FP_HEADER row -> nothing linked", submitLink(addRun.guard, addRun.entry, addRun.post, row, [{ id: NEWIDA }], [], fpLines).ok, "NO");
const draftRun = submit({ key: KEY }, facts({ issued_by_job: 1 }), record("Edit", 3));
const dlink = submitLink(draftRun.guard, draftRun.entry, draftRun.post, row, [{ id: IDA }], fpHeaderOf(IDA, "IDA-2610-0042"), fpLines);
eq("link (stored Draft, number kept): no LOCK|1, no link write, issuedNo ''", [dlink.ok, dlink.needLock, dlink.needLink, JSON.parse(dlink.request).issuedNo,
  JSON.parse(dlink.request).idaNo], ["YES", "NO", "NO", "", "IDA-2610-0042"]);
eq("link (stored Draft): another IDA under the job -> nothing", submitLink(draftRun.guard, draftRun.entry, draftRun.post, row, [{ id: NEWIDA }], fpHeader, fpLines).ok, "NO");
const back = (o) => [Object.assign({ job_id: row.jobId, job_status: "QUEUED", correlation_id: "IDA|" + IDA, item_disassembly_status: "Processing",
  stock_movement_no: "IDA-2610-0042", ida_v2_job_id: row.jobId, lock_ref: KEY }, o || {})];
eq("due: queued and owned -> due now with the final request", submitDue(draftRun.guard, draftRun.entry, dlink, back()),
  { dueRows: [{ id: row.jobId, next_attempt_at: NOW, request_payload: dlink.request }], needDue: "YES" });
for (const [label, o] of [["not Processing", { item_disassembly_status: "Draft" }], ["another job's IDA", { ida_v2_job_id: "2112100000000000002" }],
  ["another key's lock", { lock_ref: AKEY }], ["not QUEUED", { job_status: "VALIDATING" }], ["not linked", { correlation_id: "" }], ["an IA correlation", { correlation_id: "IA|" + IDA }]]) {
  eq("due: " + label + " -> not due", submitDue(draftRun.guard, draftRun.entry, dlink, back(o)).needDue, "NO");
  eq("result: " + label + " -> STOP 500", pick(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(o), true), ["route", "code", "error_code", "message"]),
    { route: "STOP", code: "500", error_code: "IDA_QUEUE_FAILED", message: "The completion could not be queued: please try again." });
}
eq("due: the link failed -> not due", submitDue(draftRun.guard, draftRun.entry, { ok: "NO" }, back()).needDue, "NO");
eq("result: the read-back is fine but the link failed -> STOP 500 (as Due)", pick(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(), false),
  ["route", "code", "error_code"]), { route: "STOP", code: "500", error_code: "IDA_QUEUE_FAILED" });
eq("result: no back rows at all (neither BACK ran) -> STOP 500", pick(submitResult(draftRun.guard, draftRun.entry, draftRun.post, [], true), ["route", "code"]),
  { route: "STOP", code: "500" });
eq("result: queued", pick(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(), true), ["route", "code", "message", "action", "job_id", "job_status", "terminal",
  "ida_id", "ida_no", "line_count", "progress_percent", "error_code"]), { route: "QUEUED", code: "200", message: "Queued for processing", action: "DIRECT", job_id: row.jobId,
  job_status: "QUEUED", terminal: "NO", ida_id: IDA, ida_no: "IDA-2610-0042", line_count: "4", progress_percent: "0", error_code: "" });
eq("result: every answer field a string", Object.values(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(), true)).every((v) => typeof v === "string"), true);
eq("result: the answer has exactly the section 7 fields", Object.keys(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(), true)),
  ["route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "ida_id", "ida_no", "line_count", "progress_percent", "progress_message", "error_code",
    "error_message", "evidence"]);
eq("result: evidence", JSON.parse(submitResult(draftRun.guard, draftRun.entry, draftRun.post, back(), true).evidence),
  { v: 1, workflow: "IDA_V2_SUBMIT", operation: "SUBMIT", route: "QUEUED", code: "200", reason: "" });
eq("result: a gate answer carries its moves and its error text", pick(submit({}, facts(), recN(60, "Edit"), { items: [] }).res, ["line_count", "error_message"]),
  { line_count: "61", error_message: "item " + SRC + " not found" });
const codes = [submit({}, facts(), record("Edit", 60, 1, { item_qty: 0 })), submit({}, facts(), record("Edit", 60, 2, { item_qty: 3 })), submit({ key: "" }, facts(), big),
  submit({}, facts({ item_disassembly_status: "Completed" }), big), submit({}, facts(), recN(60, "Edit"), { items: [] })].map((x) => x.res.code);
eq("result: never 401 (required / invalid / INVALID / STALE / NOT_ELIGIBLE)", codes, ["400", "400", "400", "409", "300"]);

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
