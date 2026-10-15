// test_submit.js <fixture.json> [...]: GD_EDIT_SUBMIT's code (code/submit/*.js) on hand-made facts and on recorded runs.
//  entry: STATUS (the latest lock's job, whichever command), BUSY (Processing / open job / held Picking), STOP (not Created
//         or Draft), GO with the next lock number
//  gate:  a recorded Edit + Save as Created that the classic save completed answers GO with the classic's answers; the
//         recorded 400 (Full Picking active) answers 400 with the classic's text
//  post:  402 before 403 before the quantity 400; the queue rows (lock, job, GD Processing, the Picking lock)
//  due:   only when the GD reads back Processing under this job's lock; carries the Picking's version into the request
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const MUT = { held: ["entry.js", "if (held) return", "if (false) return"], cl_order: ["post.js", "if (s(gate.qtyStop)) return stop(\"400\", gate.qtyStop);", ""],
  due_owner: ["due.js", "&& s(b.lock_ref) === s(post.idemKey)", ""], review_busy: ["entry.js", "if (blocking) {", "if (false) {"],
  lock_ns: ["post.js", "job_id: \"GDC|\" + entry.gdId", "job_id: \"GDE|\" + entry.gdId"],
  ref_shape: ["guard.js", "if (cascadeRef && !/^[A-Za-z0-9|:_.-]{1,80}$/.test(cascadeRef))", "if (false)"],
  ops_gate: ["ops.js", "if (num(r.gate_taken) > 0)", "if (false)"],
  ops_ref: ["ops.js", " || s(r.cascade_ref) !== guard.cascadeRef", ""],
  cascade_form: ["gate.js", "if (guard.source === \"CASCADE\" && guard.delta && Array.isArray(guard.delta.layout)) {", "if (guard.source === \"CASCADE\") {"] };
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv.splice(process.argv.indexOf("--mutate"), 2)[1] : "";
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/adapter_edit.js",
  R + "scratchpad/gdc/code/submit/required.js", D + "/code/submit/_common.js", D + "/code/prepare/alloc_ids.js", D + "/code/submit/guard.js", D + "/code/submit/entry.js", D + "/code/submit/gate.js",
  D + "/code/submit/post.js", D + "/code/submit/due.js", D + "/code/submit/result.js", D + "/code/submit/held.js", D + "/code/submit/ops.js"].map((f) => {
  let t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  if (mutate && f.endsWith("/" + MUT[mutate][0])) { if (t.indexOf(MUT[mutate][1]) < 0) throw new Error("mutant does not apply"); t = t.replace(MUT[mutate][1], MUT[mutate][2]); }
  return t;
}).join("\n");
const mk = () => {
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(SRC + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";", sb);
  return sb;
};
const sb0 = mk();
const call = (sb, fn, ...args) => { sb.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", sb))); };
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.stack || e).toString().split("\n")[0]); } };

// ---- entry
const guard = { operation: "SUBMIT", gdId: "2100000000000000001", tenantId: "1", source: "FORM", uid: "7", answers: {} };
const facts = (o) => [Object.assign({ db_now: "2026-10-15 10:00:00", gd_id: "2100000000000000001", delivery_no: "GD/1", gd_status: "Created", organization_id: "9", plant_id: "8",
  line_count: 3, last_lock: "LOCK|4", lock_job: null, open_jobs: null, pickings: null, open_pickings: null }, o || {})];
it("entry: a Created GD with nothing open goes on with lock n+1", () => {
  const r = call(sb0, "submitEntry", guard, facts());
  assert.strictEqual(r.route, "GO"); assert.strictEqual(r.lockN, 5); assert.strictEqual(r.storedStatus, "Created");
});
it("entry: a Draft goes on too (Draft -> Created)", () => { assert.strictEqual(call(sb0, "submitEntry", guard, facts({ gd_status: "Draft" })).route, "GO"); });
it("entry: Processing is BUSY", () => { const r = call(sb0, "submitEntry", guard, facts({ gd_status: "Processing" })); assert.strictEqual(r.route, "BUSY"); assert.strictEqual(r.code, "409"); });
it("entry: an open completion job is BUSY", () => {
  const r = call(sb0, "submitEntry", guard, facts({ open_jobs: JSON.stringify([{ id: "5", command: "COMPLETE_GD", job_status: "REQUIRES_REVIEW" }]) }));
  assert.strictEqual(r.route, "BUSY");
});
it("entry: a Picking held by a device (fresh lock) is BUSY", () => {
  const r = call(sb0, "submitEntry", guard, facts({ pickings: JSON.stringify([{ id: "6", to_status: "In Progress", is_processing: 1, lock_age_sec: 30 }]) }));
  assert.strictEqual(r.route, "BUSY");
});
it("entry: a Completed GD is not saved as Created", () => { const r = call(sb0, "submitEntry", guard, facts({ gd_status: "Completed" })); assert.strictEqual(r.route, "STOP"); assert.strictEqual(r.code, "400"); });
it("entry: STATUS reports the latest lock's job, whichever command", () => {
  const r = call(sb0, "submitEntry", Object.assign({}, guard, { operation: "STATUS" }), facts({ gd_status: "Processing", lock_job: JSON.stringify({ id: "7", command: "COMPLETE_GD", job_status: "COMMITTING_GD", progress_message: "x" }) }));
  assert.strictEqual(r.route, "STATUS"); assert.strictEqual(r.command, "COMPLETE_GD"); assert.strictEqual(r.jobStatus, "COMMITTING_GD");
});

// ---- post
const entryGo = { route: "GO", tenantId: "1", gdId: "2100000000000000001", gdNo: "GD/1", organizationId: "9", plantId: "8", lineCount: 3, dbNow: "2026-10-15 10:00:00", lockN: 5, storedStatus: "Created" };
const gateGo = (o) => Object.assign({ route: "GO", needCL: "required", clAutoOverride: "0", qtyStop: "", delta: { header: {}, dropHeader: [], lines: [], added: [], removed: [], layout: [] }, pickingId: "", pickingReversalNote: "" }, o || {});
it("post: a credit-limit Block answers 402 before a quantity 400", () => {
  const r = call(sb0, "submitPost", guard, entryGo, gateGo({ qtyStop: "too much" }), { result: "failed", message: "Block - over limit" });
  assert.strictEqual(r.code, "402");
});
it("post: an Override asks 403 unless the org overrides automatically", () => {
  assert.strictEqual(call(sb0, "submitPost", guard, entryGo, gateGo(), { result: "failed", message: "Override - over" }).code, "403");
  assert.strictEqual(call(sb0, "submitPost", guard, entryGo, gateGo({ clAutoOverride: "1" }), { result: "failed", message: "Override - over" }).route, "QUEUE");
});
it("post: a quantity problem answers 400 after the credit limit passed", () => { assert.strictEqual(call(sb0, "submitPost", guard, entryGo, gateGo({ qtyStop: "too much" }), { result: "passed" }).code, "400"); });
it("post: the queue rows lock the GD in the shared namespace and the Picking", () => {
  const r = call(sb0, "submitPost", guard, entryGo, gateGo({ pickingId: "6" }), { result: "passed" });
  assert.strictEqual(r.route, "QUEUE"); assert.strictEqual(r.idemKey, "GDE|2100000000000000001|5");
  assert.deepStrictEqual([r.lockRows[0].job_id, r.lockRows[0].step_name, r.lockRows[0].result_ref], ["GDC|2100000000000000001", "LOCK|5", "GDE|2100000000000000001|5"]);
  const j = r.jobRows[0];
  assert.strictEqual(j.command, "EDIT_GD"); assert.strictEqual(j.correlation_id, "GD|2100000000000000001"); assert.strictEqual(j.next_attempt_at, "2026-10-15 10:02:00");
  const req = JSON.parse(j.request_payload);
  assert.strictEqual(req.stored_status, "Created"); assert.ok(req.delta && Array.isArray(req.delta.layout));
  assert.deepStrictEqual(r.gdRows, [{ id: "2100000000000000001", gd_status: "Processing" }]); assert.deepStrictEqual(r.pickLockRows, [{ id: "6", is_processing: 1 }]);
});
it("post: the request names the Picking it locks (the worker's unlock reads it); none -> empty", () => {
  assert.strictEqual(JSON.parse(call(sb0, "submitPost", guard, entryGo, gateGo({ pickingId: "6" }), { result: "passed" }).jobRows[0].request_payload).picking_id, "6");
  assert.strictEqual(JSON.parse(call(sb0, "submitPost", guard, entryGo, gateGo(), { result: "passed" }).jobRows[0].request_payload).picking_id, "");
});
it("post: a cascade submit is held for its SO save (hold 1 + its cascade_ref); a form submit is not", () => {
  const casc = Object.assign({}, guard, { source: "CASCADE", cascadeRef: "SO|2100000000000000555|n1" });
  const req = JSON.parse(call(sb0, "submitPost", casc, entryGo, gateGo(), { result: "passed" }).jobRows[0].request_payload);
  assert.strictEqual(req.hold, 1); assert.strictEqual(req.cascade_ref, "SO|2100000000000000555|n1");
  const f = JSON.parse(call(sb0, "submitPost", guard, entryGo, gateGo(), { result: "passed" }).jobRows[0].request_payload);
  assert.strictEqual(f.hold, 0); assert.strictEqual(f.cascade_ref, "");
});
it("guard: a cascade submit without its cascade_ref is refused; with it, carried", () => {
  const base = { operation: "SUBMIT", gdId: "2100000000000000001", source: "CASCADE", tenantId: "1", delta: { header: {}, lines: [], added: [], removed: [], layout: [] } };
  assert.strictEqual(call(sb0, "submitGuard", base).route, "REJECT");
  const g = call(sb0, "submitGuard", Object.assign({ cascadeRef: "SO|5|n1" }, base));
  assert.strictEqual(g.route, "CONTINUE"); assert.strictEqual(g.cascadeRef, "SO|5|n1");
});

it("guard: a form submit -> the materials of exactly the form's rows that may need allocation (bundle items too); no stored line list", () => {
  const form = { so_id: [], table_gd: [{ material_id: "51", gd_qty: 3, temp_qty_data: "" }, { material_id: "52", gd_qty: 3, temp_qty_data: "[{\"a\":1}]" },
    { material_id: "", gd_qty: 1 }, { material_id: "53", gd_qty: 0 }, { item_bundle_id: "9", children: [{ material_id: "54", gd_qty: 1, temp_qty_data: "[]" }] }] };
  const g = call(sb0, "submitGuard", { operation: "SUBMIT", gdId: "2100000000000000001", source: "FORM", tenantId: "1", form });
  assert.deepStrictEqual(g.idLists.deltaAllocMaterialIdsSql.split(",").sort(), ["51", "54"]);
  assert.strictEqual(g.idLists.deltaAllocLineIdsSql, "0");
});
it("guard: a cascade submit -> the delta's rows that may need allocation and the lines whose temp_qty_data it empties", () => {
  const delta = { header: {}, removed: [], layout: [], lines: [{ id: "31", cells: { temp_qty_data: "" } }, { id: "33", cells: { material_id: "53" } }], added: [{ material_id: "52", gd_qty: 1 }] };
  const g = call(sb0, "submitGuard", { operation: "SUBMIT", gdId: "2100000000000000001", source: "CASCADE", tenantId: "1", cascadeRef: "SO|5|n1", delta });
  assert.deepStrictEqual(g.idLists.deltaAllocMaterialIdsSql.split(",").sort(), ["52", "53"]);
  assert.strictEqual(g.idLists.deltaAllocLineIdsSql, "31");
});

// ---- held: an EDIT_GD job held for a cascade whose hold ended -> the worker is kicked first (no Quartz: nothing else would)
it("held: an ended hold on the GD -> kick GD_EDIT_WORKER with that job first", () => {
  assert.deepStrictEqual(call(sb0, "submitHeld", guard, [{ job_id: "2110000000000000009", expired: 1 }]), { needKick: "YES", jobId: "2110000000000000009" });
});
it("held: a hold still running, none, or a non-digit id -> no kick", () => {
  assert.strictEqual(call(sb0, "submitHeld", guard, [{ job_id: "9", expired: 0 }]).needKick, "NO");
  assert.strictEqual(call(sb0, "submitHeld", guard, []).needKick, "NO");
  assert.strictEqual(call(sb0, "submitHeld", guard, [{ job_id: "9 OR 1=1", expired: 1 }]).needKick, "NO");
});

// ---- result
it("result: STATUS of an edit answers its command and the notes stored on it", () => {
  const sg = Object.assign({}, guard, { operation: "STATUS" });
  const e = call(sb0, "submitEntry", sg, facts({ gd_status: "Processing", lock_job: JSON.stringify({ id: "7", command: "EDIT_GD", job_status: "COMMITTING_GD", progress_message: "x",
    notes: { pickingReversalNote: "Put back 2 units", creditLimitNote: "over by 10" } }) }));
  const r = call(sb0, "submitResult", sg, e, e, null);
  assert.strictEqual(r.command, "EDIT_GD"); assert.strictEqual(r.job_id, "7");
  assert.strictEqual(r.picking_reversal_note, "Put back 2 units"); assert.strictEqual(r.credit_limit_note, "over by 10");
  assert.strictEqual(JSON.parse(r.evidence).workflow, "GD_EDIT_SUBMIT");
});
it("result: a queued edit answers QUEUED with the notes its request stored", () => {
  const post = call(sb0, "submitPost", guard, entryGo, gateGo({ pickingReversalNote: "Put back 1 unit", clAutoOverride: "1" }), { result: "failed", message: "Override - over by 5" });
  const back = [{ job_id: "11", job_status: "QUEUED", gd_status: "Processing", lock_ref: post.idemKey }];
  const r = call(sb0, "submitResult", guard, entryGo, post, back);
  assert.strictEqual(r.route, "QUEUED"); assert.strictEqual(r.code, "200"); assert.strictEqual(r.job_id, "11"); assert.strictEqual(r.command, "EDIT_GD");
  assert.strictEqual(r.picking_reversal_note, "Put back 1 unit"); assert.strictEqual(r.credit_limit_note, "over by 5");
});
it("result: a queue that does not read back under our lock answers 500", () => {
  const post = call(sb0, "submitPost", guard, entryGo, gateGo(), { result: "passed" });
  const r = call(sb0, "submitResult", guard, entryGo, post, [{ job_id: "11", job_status: "QUEUED", gd_status: "Created", lock_ref: post.idemKey }]);
  assert.strictEqual(r.route, "STOP"); assert.strictEqual(r.code, "500");
});

// ---- due
it("due: the GD Processing under our lock -> due now, the Picking's version recorded", () => {
  const post = call(sb0, "submitPost", guard, entryGo, gateGo({ pickingId: "6" }), { result: "passed" });
  const r = call(sb0, "submitDue", entryGo, post, [{ job_id: "11", job_status: "QUEUED", gd_status: "Processing", lock_ref: "GDE|2100000000000000001|5", queued_at: "2026-10-15 10:00:00", request_payload: post.jobRows[0].request_payload, pick_id: "6", pick_processing: 1, pick_update_time: "2026-10-15 10:00:00.123" }]);
  assert.strictEqual(r.needDue, "YES"); assert.strictEqual(r.dueRows[0].next_attempt_at, "2026-10-15 10:00:00"); assert.strictEqual(JSON.parse(r.dueRows[0].request_payload).picking_version, "2026-10-15 10:00:00.123");
});
it("due: a lock taken by another submit -> nothing", () => {
  const post = call(sb0, "submitPost", guard, entryGo, gateGo(), { result: "passed" });
  const r = call(sb0, "submitDue", entryGo, post, [{ job_id: "11", job_status: "QUEUED", gd_status: "Processing", lock_ref: "GDC|2100000000000000001|6", queued_at: "2026-10-15 10:00:00", request_payload: post.jobRows[0].request_payload }]);
  assert.strictEqual(r.needDue, "NO");
});

it("gate: an edit that changes the plant -> NOT_ELIGIBLE (every read of the background save is scoped to the stored plant)", () => {
  const stored = { id: "2100000000000000001", plant_id: "8", organization_id: "9", gd_status: "Draft", table_gd: [] };
  const R = { stored, gd: { count: 1, data: stored }, serialItems: [], pickingSetup: { count: 0, data: {} }, livePickings: [], pick: { count: 0, data: {} } };
  const r = call(sb0, "submitGateOn", guard, { route: "GO", tenantId: "1", gdId: stored.id, lineCount: 1, storedStatus: "Draft" }, R, { id: stored.id, plant_id: "7", organization_id: "9", table_gd: [] }, vm.runInContext("GE_KINDS", sb0));
  assert.strictEqual(r.route, "NOT_ELIGIBLE", JSON.stringify(r).slice(0, 200)); assert.ok(/plant/.test(r.reason), r.reason);
});

// ---- batch 5: the cascade sends its payload (form); its held jobs are released / cancelled by gd_id + cascade_ref
const REF = "SO|2110639355872194561|k7x2m9";
it("guard: RELEASE / CANCEL_HELD need a gd_id and a well-formed cascade_ref (it reaches SQL)", () => {
  for (const op of ["RELEASE", "CANCEL_HELD"]) {
    assert.strictEqual(call(sb0, "submitGuard", { operation: op, gdId: "21", tenantId: "1", cascadeRef: REF }).route, "CONTINUE", op);
    assert.strictEqual(call(sb0, "submitGuard", { operation: op, gdId: "21", tenantId: "1", cascadeRef: "" }).route, "REJECT", op + " without a ref");
    assert.strictEqual(call(sb0, "submitGuard", { operation: op, gdId: "21", tenantId: "1", cascadeRef: "x' OR '1'='1" }).route, "REJECT", op + " with a quote");
  }
  assert.strictEqual(call(sb0, "submitGuard", { operation: "SUBMIT", gdId: "21", tenantId: "1", source: "CASCADE", cascadeRef: "a'b", delta: { layout: [] } }).route, "REJECT");
});
it("guard: a cascade SUBMIT may send its payload (form) in place of a delta; one of them is required", () => {
  const form = { table_gd: [{ id: "1", material_id: "5", so_line_item_id: "6", line_so_id: "7", gd_qty: 2 }], so_id: ["7"] };
  const g = call(sb0, "submitGuard", { operation: "SUBMIT", gdId: "21", tenantId: "1", source: "CASCADE", cascadeRef: REF, form: form });
  assert.strictEqual(g.route, "CONTINUE", g.message); assert.strictEqual(g.idLists.deltaMaterialIdsSql, "5"); assert.strictEqual(g.idLists.deltaSoIdsSql, "7");
  assert.strictEqual(g.idLists.deltaSoLineIdsSql, "6");
  assert.strictEqual(call(sb0, "submitGuard", { operation: "SUBMIT", gdId: "21", tenantId: "1", source: "CASCADE", cascadeRef: REF }).route, "REJECT");
});
it("entry: BUSY on a Processing GD carries the holding job's cascade_ref (the cascade's pass B finds its own hold)", () => {
  const r = call(sb0, "submitEntry", guard, facts({ gd_status: "Processing", lock_job: JSON.stringify({ id: "9", command: "EDIT_GD", job_status: "HELD", cascade_ref: REF }) }));
  assert.strictEqual(r.route, "BUSY"); assert.strictEqual(r.jobStatus, "HELD"); assert.strictEqual(r.cascadeRef, REF);
  const out = call(sb0, "submitResult", guard, r, { route: r.route, code: r.code, message: r.message }, null);
  assert.strictEqual(out.cascade_ref, REF);
});
const opsGuard = (op) => ({ route: "CONTINUE", operation: op, gdId: "21", tenantId: "1", source: "CASCADE", cascadeRef: REF, uid: "7", answers: {} });
const heldRow = (o) => [Object.assign({ db_now: "2026-10-15 18:00:00", job_id: "77", organization_id: "9", job_status: "HELD", row_version: 4, cascade_ref: REF, gate_taken: 0 }, o || {})];
it("ops: RELEASE of a held job -> the claim gate W0_CLAIM_<rv>, READY_TO_COMMIT due now (rv + 1), a RELEASE step row", () => {
  const r = call(sb0, "submitOps", opsGuard("RELEASE"), heldRow());
  assert.strictEqual(r.route, "WRITE"); assert.strictEqual(r.jobId, "77");
  assert.deepStrictEqual(r.claimRows.map((x) => [x.job_id, x.step_name]), [["77", "W0_CLAIM_4"]]);
  assert.strictEqual(r.jobRows[0].id, "77"); assert.strictEqual(r.jobRows[0].job_status, "READY_TO_COMMIT"); assert.strictEqual(r.jobRows[0].row_version, 5);
  assert.strictEqual(r.jobRows[0].next_attempt_at, "2026-10-15 18:00:00"); assert.strictEqual(r.jobRows[0].lease_owner, null);
  assert.deepStrictEqual(r.stepRows.map((x) => [x.job_id, x.step_name, x.step_status, x.result_ref]), [["77", "RELEASE", "DONE", REF]]);
  assert.strictEqual(r.needStep, "YES");
});
it("ops: CANCEL_HELD of a held job -> the hold ends now (still HELD, rv + 1), no step row: the worker's EXPIRE path cancels + unlocks", () => {
  const r = call(sb0, "submitOps", opsGuard("CANCEL_HELD"), heldRow());
  assert.strictEqual(r.route, "WRITE"); assert.strictEqual(r.jobRows[0].job_status, "HELD"); assert.strictEqual(r.jobRows[0].row_version, 5);
  assert.strictEqual(r.jobRows[0].next_attempt_at, "2026-10-15 18:00:00"); assert.strictEqual(r.needStep, "NO"); assert.deepStrictEqual(r.stepRows, []);
});
it("ops: nothing held by this reference -> NONE (200, nothing written); the worker on it -> BUSY", () => {
  const none = call(sb0, "submitOps", opsGuard("RELEASE"), [{ db_now: "2026-10-15 18:00:00" }]);
  assert.strictEqual(none.route, "NONE"); assert.strictEqual(none.code, "200"); assert.deepStrictEqual(none.jobRows, []);
  assert.strictEqual(call(sb0, "submitOps", opsGuard("RELEASE"), heldRow({ cascade_ref: "SO|1|another-save" })).route, "NONE", "another save's hold is not ours");
  const busy = call(sb0, "submitOps", opsGuard("RELEASE"), heldRow({ gate_taken: 1 }));
  assert.strictEqual(busy.route, "BUSY"); assert.strictEqual(busy.code, "409"); assert.deepStrictEqual(busy.claimRows, []);
});
it("ops: the read-back decides (RELEASED / CANCELLING with the job, else a 500)", () => {
  const w = call(sb0, "submitOps", opsGuard("RELEASE"), heldRow());
  const ok = call(sb0, "submitOpsBack", opsGuard("RELEASE"), w, [{ job_id: "77", job_status: "READY_TO_COMMIT", row_version: 5, released: 1 }]);
  assert.strictEqual(ok.route, "RELEASED"); assert.strictEqual(ok.code, "200"); assert.strictEqual(ok.job_id, "77");
  assert.strictEqual(call(sb0, "submitOpsBack", opsGuard("RELEASE"), w, [{ job_id: "77", job_status: "HELD", row_version: 4, released: 0 }]).code, "500");
  const c = call(sb0, "submitOps", opsGuard("CANCEL_HELD"), heldRow());
  const cb = call(sb0, "submitOpsBack", opsGuard("CANCEL_HELD"), c, [{ job_id: "77", job_status: "HELD", row_version: 5, ended: 1 }]);
  assert.strictEqual(cb.route, "CANCELLING"); assert.strictEqual(cb.job_id, "77");
});

// ---- gate on recorded runs
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {}, recCallee = {};
  for (const [src, into] of [[fx.head, rec], [fx.unused, recCallee]]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_id && into[x.node_id] === undefined) { try { into[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  const stored = rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data && rec["get_node_xTRvHWB8"].data.id ? rec["get_node_xTRvHWB8"].data : null;
  if (!stored) continue;
  const params = P(fx.head.request_json_data).workflowparams;
  it("gate: " + path.basename(file).slice(0, 19) + " " + fx.doc_no + " answers as the classic did", () => {
    const sb = mk();
    // the recorded run's own code over the lifted bodies (the gate's answer, not code drift, is under test)
    const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
    const codes = [];
    for (const src of [fx.head, fx.unused]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_type === "code-node" && x.request_json_data) { const rq = P(x.request_json_data); codes.push({ id: x.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) }); }
    sb.__CODES = codes;
    vm.runInContext('for (const c of __CODES) __N[c.id] = { decl: c.decl, fn: new Function("const console = __QUIET;\\n" + c.code) };', sb);
    const g = (id, d) => (rec[id] === undefined ? d : rec[id]);
    const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
    const Rd = { stored, gd: { count: 1, data: stored }, pick: g("get_pick_for_reconcile", G0), livePickings: [], linkage: g("search_gr_linkage", S0), pickingSetup: g("get_node_iFPuvJX2", G0),
      itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0), activePickings: g("search_node_NBAQ9gsj", S0), binNames: g("search_bin_names", S0),
      soLines: g("search_node_SOLine8kQ2", S0), cleanupSoLines: g("search_node_DnZIKKVH", S0), soHeaders: g("search_node_FVhsTRDu", S0), pickingFormat: g("get_node_zna6o03F", G0),
      itemDatas: recCallee["sql_node_ItemDatas"] || [], allocated: recCallee["search_node_r3NiR6B7"] || S0, pending: recCallee["search_node_QdY1FLLA"] || S0, serialItems: [],
      allocTable: rec["get_cache_node_wiBIs4cB"], extraReads: {} };
    for (const x of JSON.parse(fx.head.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "") && !(x.node_id in Rd)) Rd.extraReads[x.node_id] = rec[x.node_id];
    const gd = { route: "GO", tenantId: fx.tenant_id, gdId: String(stored.id), gdNo: stored.delivery_no, organizationId: String(stored.organization_id), lineCount: 1, storedStatus: stored.gd_status };
    const gu = { operation: "SUBMIT", gdId: String(stored.id), tenantId: fx.tenant_id, source: "FORM", uid: "7",
      answers: { needCL: params.needCL || "required", continueZero: params.continueZero || "", confirmPickReversal: params.confirmPickReversal || "" } };
    sb.__G = gu; sb.__E = gd; sb.__R = Rd; sb.__F = params.allData;
    const r = JSON.parse(JSON.stringify(vm.runInContext("submitGateOn(__G, __E, __R, __F, GE_KINDS)", sb)));
    const resp = P(fx.head.response_json_data || "{}").data || {};
    const classicCode = String(resp.code || "");
    if (classicCode === "200") {
      assert.strictEqual(r.route, "GO", "classic saved it; the gate answered " + r.route + " " + r.code + " " + r.message);
      sb.__G = Object.assign({}, gu, { source: "CASCADE", cascadeRef: REF, delta: null });
      const rc = JSON.parse(JSON.stringify(vm.runInContext("submitGateOn(__G, __E, __R, __F, GE_KINDS)", sb)));
      assert.deepStrictEqual(rc.delta, r.delta, "the cascade's payload diffs as the form's");
    }
    else { assert.strictEqual(r.code, classicCode); assert.strictEqual(r.message, String(resp.message || "")); }
  });
}
console.log(JSON.stringify({ cases: n, failed: failed }));
process.exit(failed ? 1 : 0);
