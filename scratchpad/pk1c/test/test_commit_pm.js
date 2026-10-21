// Picking V2 1c: PICKING_BULK_COMMIT's entry (code/commit_entry.js vs base/code_node_PCentry.js) and the move steps
// (commit_pm_common.js + commit_mvparse / pm1in / pm1check / pm2 / pm3), node bodies run as the platform runs them.
const fs = require("fs");
const path = require("path");
const { runBody, eq, truthy, done } = require("../../gdc/pkv2tools/harness.js");
const CODE = process.env.CODE_DIR || path.join(__dirname, "..", "code");
const read = (f) => fs.readFileSync(path.join(CODE, f), "utf8");
const COMMON = read("commit_pm_common.js");
const ENTRY_NEW = read("commit_entry.js"), ENTRY_BASE = fs.readFileSync(path.join(__dirname, "..", "base", "code_node_PCentry.js"), "utf8");
// a node body's {{node:X...}} placeholders, each answered from map[X] (X.data.f -> map[X].f)
const inj = (code, map) => {
  const v = {};
  for (const m of code.matchAll(/\{\{node:([A-Za-z0-9_]+)((?:\.[A-Za-z0-9_]+)*)\}\}/g)) {
    const parts = m[2].split(".").filter(Boolean);
    if (parts[0] === "data") parts.shift();
    v["node:" + m[1] + m[2]] = parts.reduce((x, k) => (x === undefined || x === null ? undefined : x[k]), map[m[1]]);
  }
  return v;
};
const fns = new Function(COMMON + "\n" + read("commit_pm2.js") + "\n" + read("commit_pm3.js") + "\nreturn { commitPM2Plan, commitPM2Check, commitPM3Plan, commitPM3Check };")();
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- entry
const GUARD = { jobId: "70001", tenantId: "496474", leaseOwner: "PUB|abc" };
const JOB = (o) => Object.assign({ id: "70001", db_now: "2026-10-16 12:00:00", is_deleted: 0, command: "CONFIRM_PICKING", job_status: "READY_TO_COMMIT", lease_owner: null, lease_live: 0,
  due: 1, organization_id: "1901545950162329602", picking_id: "9001", row_version: 4, attempt_count: 0, progress_percent: 60, lease_until: "2026-10-16 12:10:00" }, o || {});
const PAY = (o) => ({ prepared_payload: JSON.stringify(Object.assign({ job_id: "70001", picking_id: "9001", picking_no: "PI-1", records: [{}], row_patch: { "11": {} }, gd_lines: [{ id: "311" }],
  gd_ids: ["5001"], gd_ids_all: ["5001"], full_picking: 0, packing: {} }, o || {})) });
const MOVE = { nonce: "a1b2c3d4", operation_key: "PKM|70001", has_movements: 1, gd_ids: ["5001"], counts: {} };
const entry = (code, job, steps, pay) => runBody(code, { "node:code_node_PCguard.data": GUARD, "node:sql_node_PCjob.data": [job], "node:sql_node_PCsteps.data": steps || [],
  "node:sql_node_PCpayload.data": [pay] }, "entry");
const ENTRY_KEYS = ["route", "phase", "needP0", "needP1", "needP3", "needP3fp", "needP4", "needP5", "jobRows", "needJobUpd", "result_code", "job_status"];
const pick = (o) => Object.fromEntries(ENTRY_KEYS.map((k) => [k, o[k]]));
const DONE = (...names) => names.map((n, i) => ({ id: String(i + 1), step_name: n, step_status: "DONE" }));
for (const [label, job, steps] of [["fresh", JOB(), []], ["P0 done", JOB({ job_status: "COMMITTING_PICKING" }), DONE("P0_REVALIDATE")], ["A done", JOB({ job_status: "COMMITTING_PICKING" }), DONE("P0_REVALIDATE", "P1_PICKING", "P3_GD_LINES", "P4_GD_HEADERS")]]) {
  eq("entry, no move: " + label + ": as before", pick(entry(ENTRY_NEW, job, steps, PAY())), pick(entry(ENTRY_BASE, job, steps, PAY())));
  eq("entry, no move: " + label + ": no PM step", ["needMove", "needPM1", "needPM2", "needPM3"].map((k) => entry(ENTRY_NEW, job, steps, PAY())[k]), ["NO", "NO", "NO", "NO"]);
}
{
  const e = entry(ENTRY_NEW, JOB(), [], PAY({ move: MOVE }));
  eq("entry, move, fresh", [e.route, e.needP0, e.needMove, e.needPM1, e.needPM2, e.needPM3, e.needP1, e.moveNonce, e.moveOpKey, e.hasMovements, e.pm1Waits],
    ["GO", "YES", "YES", "YES", "YES", "YES", "YES", "a1b2c3d4", "PKM|70001", "YES", 0]);
  const e1 = entry(ENTRY_NEW, JOB({ job_status: "COMMITTING_PICKING" }), DONE("P0_REVALIDATE", "PM1_STOCK"), PAY({ move: MOVE }));
  eq("entry, move, PM1 done: P0 not again", [e1.needP0, e1.needPM1, e1.needPM2, e1.needPM3], ["NO", "NO", "YES", "YES"]);
  eq("entry, move: once stock moved, P0 never runs again (even without its DONE row)", entry(ENTRY_NEW, JOB({ job_status: "COMMITTING_PICKING" }), DONE("PM1_STOCK"), PAY({ move: MOVE })).needP0, "NO");
  const e2 = entry(ENTRY_NEW, JOB({ job_status: "COMMITTING_PICKING" }), DONE("P0_REVALIDATE", "PM1_STOCK", "PM2_RESERVATIONS", "PM3_GD_ALLOC", "P1_PICKING"), PAY({ move: MOVE }));
  eq("entry, move, P1 done: no PM step", [e2.needMove, e2.needPM1, e2.needPM2, e2.needPM3, e2.needP1, e2.needP3], ["NO", "NO", "NO", "NO", "NO", "YES"]);
  const e3 = entry(ENTRY_NEW, JOB({ job_status: "COMMITTING_PICKING" }), DONE("P0_REVALIDATE").concat([{ id: "9", step_name: "PM1_WAIT|1", step_status: "WAIT" }, { id: "10", step_name: "PM1_WAIT|2", step_status: "WAIT" }]), PAY({ move: MOVE }));
  eq("entry: lock waits counted", [e3.pm1Waits, e3.needPM1], [2, "YES"]);
  eq("entry: a move of another job is refused", entry(ENTRY_NEW, JOB(), [], PAY({ move: Object.assign({}, MOVE, { operation_key: "PKM|1" }) })).route, "FAIL");
  eq("entry: unreadable payload after PM1: review", entry(ENTRY_NEW, JOB({ job_status: "COMMITTING_PICKING" }), DONE("PM1_STOCK"), PAY({ move: Object.assign({}, MOVE, { nonce: "bad" }) })).route, "REVIEW");
  eq("entry: unreadable payload, nothing done: FAILED", entry(ENTRY_NEW, JOB({ job_status: "COMMITTING_PICKING" }), [], PAY({ move: Object.assign({}, MOVE, { nonce: "bad" }) })).route, "FAIL");
}

// ---- move parts
const E = { jobId: "70001", organizationId: "1901545950162329602", pickingId: "9001", attempts: 0, rowVersion: 5, dbNow: "2026-10-16 12:00:00", moveNonce: "a1b2c3d4", moveOpKey: "PKM|70001", pm1Waits: 0 };
const MOVEMENTS = [{ movement_key: "G000.M1", direction: "SUBTRACT" }, { movement_key: "G000.M2", direction: "ADD" }];
const RES = { updates: [{ id: "8001", before: { target_gd_id: "5001", status: "Allocated", reserved_qty: 5, open_qty: 5, delivered_qty: 0, doc_no: "GD/1", doc_id: "5001", doc_line_id: "311", source_reserved_id: null, item_uom: "U1" },
  after: { target_gd_id: null, status: "Cancelled", reserved_qty: 5, open_qty: 0, delivered_qty: null, doc_no: null, doc_id: null, doc_line_id: null, source_reserved_id: null, item_uom: null } }],
  creates: [{ status: "Allocated", bin_location: "4009", reserved_qty: 5, open_qty: 5, delivered_qty: 0, target_gd_id: "5001", job_line_key: "70001|R|000.1", doc_type: "Good Delivery" }] };
const ALC = [{ id: "311", gd_id: "5001", temp_qty_data: '[{"location_id":"4009"}]', view_stock: "Total: 5 PCS (bay)", before_temp: '[{"location_id":"4001"}]', before_view: "Total: 5 PCS" }];
const PARTS = (o) => {
  const rows = [["VRD|000", { gd_id: "5001", verdict: "OK" }], ["ENG|000", MOVEMENTS], ["RES|000", RES], ["ALC|000", ALC]].map(([k, v]) => ({ step_name: "MV|a1b2c3d4|" + k + "|001", result_ref: JSON.stringify(v) }));
  return (o || {}).rows ? o.rows(rows) : rows;
};
const parse = (rows) => runBody(COMMON + "\n" + read("commit_mvparse.js"), { "node:code_node_PCentry.data": E, "node:sql_node_PCmvparts.data": rows }, "parse");
const MVP = parse(PARTS());
eq("parse: OK", [MVP.ok, MVP.movements.length, MVP.res.updates.length, MVP.res.creates.length, MVP.alc.length, MVP.resIdsJson, MVP.lineIdsJson], ["YES", 2, 1, 1, 1, '["8001"]', '["311"]']);
{
  const chunked = PARTS({ rows: (rows) => { const r = rows[1]; return [rows[0], { step_name: "MV|a1b2c3d4|ENG|000|002", result_ref: r.result_ref.slice(20) }, { step_name: "MV|a1b2c3d4|ENG|000|001", result_ref: r.result_ref.slice(0, 20) }, rows[2], rows[3]]; } });
  eq("parse: chunks joined in step order", parse(chunked).movements.length, 2);
}
eq("parse: a failed verdict", parse(PARTS({ rows: (r) => [{ step_name: r[0].step_name, result_ref: JSON.stringify({ verdict: "no" }) }].concat(r.slice(1)) })).ok, "NO");
eq("parse: no allocation part", parse(PARTS({ rows: (r) => r.slice(0, 3) })).ok, "NO");
eq("parse: another nonce's rows are not read", parse(PARTS().map((r) => Object.assign({}, r, { step_name: r.step_name.replace("a1b2c3d4", "zzzzzzzz") }))).ok, "NO");

// ---- PM1
const U = (o) => ({ k: "U", j: JSON.stringify(Object.assign({ id: "8001", is_deleted: 0 }, RES.updates[0].before, o || {})) });
const LN = (o) => ({ k: "L", j: JSON.stringify(Object.assign({ id: "311", temp_qty_data: ALC[0].before_temp, view_stock: "Total: 5 PCS" }, o || {})) });
const PM1IN = COMMON + "\n" + read("commit_pm1in.js");
const pm1in = (facts, mvp) => runBody(PM1IN, inj(PM1IN, { code_node_PCentry: E, code_node_PCmvparse: mvp || MVP, sql_node_PCpm1facts: facts }), "pm1in");
const I = (n) => ({ k: "I", j: String(n) });
eq("PM1 in: unchanged -> the call (the movements go from the parts to the engine, not through this node)", [pm1in([U(), LN(), I(0)]).route, pm1in([U(), LN(), I(0)]).needCall, "movements" in pm1in([U(), LN(), I(0)])], ["GO", "YES", false]);
eq("PM1 in: no movement -> no call", pm1in([U(), LN(), I(0)], Object.assign({}, MVP, { movements: [], counts: Object.assign({}, MVP.counts, { movements: 0 }) })).needCall, "NO");
{
  const st = pm1in([U({ reserved_qty: 4 }), LN(), I(0)]);
  eq("PM1 in: a stale reservation before any intent: FAILED + unlock", [st.route, st.result_code, st.needUnlock, st.jobRows[0].job_status], ["END", "PK_STALE", "YES", "FAILED"]);
  const st2 = pm1in([U(), LN({ temp_qty_data: "[]" }), I(3)]);
  eq("PM1 in: stale after an intent: review", [st2.route, st2.result_code, st2.needUnlock, st2.jobRows[0].job_status], ["END", "PK_RECONCILIATION_MISMATCH", "NO", "REQUIRES_REVIEW"]);
  eq("PM1 in: an unreadable move: FAILED", pm1in([I(0)], { ok: "NO", why: "x" }).result_code, "PK_INVALID_DATA");
}
const IN_OK = pm1in([U(), LN(), I(0)]);
const PM1C = COMMON + "\n" + read("commit_pm1check.js");
const pm1 = (eng, inp, entry) => runBody(PM1C, inj(PM1C, { code_node_PCentry: entry || E, code_node_PCpm1in: inp || IN_OK, workflow_node_PCpm1: eng }), "pm1");
{
  const ok = pm1({ code: "200", result_code: "OK", message: "applied" });
  eq("PM1: 200 -> DONE", [ok.route, ok.stepRows[0].step_name, ok.stepRows[0].inventory_operation_id], ["OK", "PM1_STOCK", "PKM|70001"]);
  eq("PM1: replayed -> DONE", pm1({ code: "200", result_code: "REPLAYED" }).route, "OK");
  eq("PM1: no call -> DONE", pm1(null, Object.assign({}, IN_OK, { needCall: "NO" })).stepRows[0].result_ref, "no stock movement");
  const busy = pm1({ code: "409", result_code: "LOCK_BUSY" });
  eq("PM1: busy, no intent: wait 1", [busy.route, busy.result_code, busy.needWait, busy.waitRows[0].step_name, busy.jobRows[0].next_attempt_at, busy.jobRows[0].attempt_count, busy.needUnlock],
    ["END", "PK_LOCK_WAIT", "YES", "PM1_WAIT|1", "2026-10-16 12:00:15", 0, "NO"]);
  eq("PM1: busy, 3 waits so far: wait 4 (120 s)", pm1({ code: "409" }, IN_OK, Object.assign({}, E, { pm1Waits: 3 })).jobRows[0].next_attempt_at, "2026-10-16 12:02:00");
  const gave = pm1({ code: "409" }, IN_OK, Object.assign({}, E, { pm1Waits: 4 }));
  eq("PM1: busy after 4 waits: FAILED + unlock", [gave.result_code, gave.needUnlock, gave.jobRows[0].job_status], ["PK_INVENTORY_LOCK_BUSY", "YES", "FAILED"]);
  eq("PM1: busy with an intent (engine v12: our own APPLY still held): wait, not a counted retry", [pm1({ code: "409" }, Object.assign({}, IN_OK, { intents: 2 })).result_code, pm1({ code: "409" }, Object.assign({}, IN_OK, { intents: 2 })).jobRows[0].attempt_count], ["PK_LOCK_WAIT", 0]);
  eq("PM1: busy with an intent after 8 waits: review, the Picking stays locked", [pm1({ code: "409" }, Object.assign({}, IN_OK, { intents: 2 }), Object.assign({}, E, { pm1Waits: 8 })).job_status, pm1({ code: "409" }, Object.assign({}, IN_OK, { intents: 2 }), Object.assign({}, E, { pm1Waits: 8 })).needUnlock], ["REQUIRES_REVIEW", "NO"]);
  // engine v12: its OWN operation still running (a run that died mid-APPLY) answers 409 for up to 20 min - wait it out
  const SAME = "the same operation is still running";
  const same = pm1({ code: "409", result_code: "LOCK_BUSY", message: SAME }, Object.assign({}, IN_OK, { intents: 2 }));
  eq("PM1: the same operation still running, with intents: wait 1, not a retry", [same.route, same.result_code, same.waitRows[0].step_name, same.jobRows[0].attempt_count, same.needUnlock],
    ["END", "PK_LOCK_WAIT", "PM1_WAIT|1", 0, "NO"]);
  eq("PM1: the same operation, 7 waits so far: wait 8 (300 s)", pm1({ code: "409", message: SAME }, Object.assign({}, IN_OK, { intents: 2 }), Object.assign({}, E, { pm1Waits: 7 })).jobRows[0].next_attempt_at, "2026-10-16 12:05:00");
  const sameGave = pm1({ code: "409", message: SAME }, IN_OK, Object.assign({}, E, { pm1Waits: 8 }));
  eq("PM1: the same operation after 8 waits: review, never FAILED 'nothing was saved'", [sameGave.job_status, sameGave.needUnlock], ["REQUIRES_REVIEW", "NO"]);
  eq("PM1: 400 -> FAILED + unlock", [pm1({ code: "400", result_code: "INSUFFICIENT" }).result_code, pm1({ code: "400", result_code: "INSUFFICIENT" }).needUnlock], ["PK_INVENTORY_INSUFFICIENT", "YES"]);
  eq("PM1: anything else -> review", pm1({ code: "500", result_code: "REQUIRES_REVIEW" }).job_status, "REQUIRES_REVIEW");
  eq("PM1: no answer -> review, the Picking stays locked", [pm1({}).job_status, pm1({}).needUnlock], ["REQUIRES_REVIEW", "NO"]);
}

// ---- PM2
{
  const C = (key) => ({ k: "C", j: JSON.stringify({ id: "9" + key.length, job_line_key: key }) });
  const p = fns.commitPM2Plan(E, MVP, [U()]);
  eq("PM2 plan: at before -> written whole, decimals as 8-dp text", [p.route, p.writeCount, p.slices[0].rows[0].status, p.slices[0].rows[0].open_qty, p.slices[0].rows[0].target_gd_id], ["GO", 1, "Cancelled", "0.00000000", null]);
  eq("PM2 plan: the create, doc_id from target_gd_id, decimals as text", [p.needCreates, p.createRows[0].job_line_key, p.createRows[0].doc_id, p.createRows[0].reserved_qty], ["YES", "70001|R|000.1", "5001", "5.00000000"]);
  const after = fns.commitPM2Plan(E, MVP, [{ k: "U", j: JSON.stringify(Object.assign({ id: "8001", is_deleted: 0 }, RES.updates[0].after)) }, C("70001|R|000.1")]);
  eq("PM2 plan: already written, already created", [after.writeCount, after.needCreates], [0, "NO"]);
  eq("PM2 plan: changed by someone else: review", fns.commitPM2Plan(E, MVP, [U({ status: "Delivered" })]).job_status, "REQUIRES_REVIEW");
  eq("PM2 plan: created twice: review", fns.commitPM2Plan(E, MVP, [U(), C("70001|R|000.1"), C("70001|R|000.1")]).job_status, "REQUIRES_REVIEW");
  eq("PM2 check: read back -> DONE", fns.commitPM2Check(E, MVP, [{ k: "U", j: JSON.stringify(Object.assign({ id: "8001", is_deleted: 0 }, RES.updates[0].after)) }, C("70001|R|000.1")]).route, "OK");
  eq("PM2 check: the create is missing: retry", fns.commitPM2Check(E, MVP, [{ k: "U", j: JSON.stringify(Object.assign({ id: "8001", is_deleted: 0 }, RES.updates[0].after)) }]).result_code, "PK_STEP_RETRY");
}

// ---- PM3 (its facts carry the move's reservations too: PM2's result must still stand)
{
  const C = (key) => ({ k: "C", j: JSON.stringify({ id: "9" + key.length, job_line_key: key }) });
  const UA = (o) => ({ k: "U", j: JSON.stringify(Object.assign({ id: "8001", is_deleted: 0 }, RES.updates[0].after, o || {})) });
  const RES_OK = [UA(), C("70001|R|000.1")];
  const p = fns.commitPM3Plan(E, MVP, RES_OK.concat([LN()]));
  eq("PM3 plan: at before -> the new allocation, prev = the new allocation", [p.writeCount, p.slices[0].rows[0].temp_qty_data, p.slices[0].rows[0].prev_temp_qty_data, p.slices[0].rows[0].view_stock],
    [1, ALC[0].temp_qty_data, ALC[0].temp_qty_data, ALC[0].view_stock]);
  eq("PM3 plan: already written", fns.commitPM3Plan(E, MVP, RES_OK.concat([LN({ temp_qty_data: ALC[0].temp_qty_data })])).writeCount, 0);
  eq("PM3 plan: changed by someone else: review", fns.commitPM3Plan(E, MVP, RES_OK.concat([LN({ temp_qty_data: "[1]" })])).job_status, "REQUIRES_REVIEW");
  eq("PM3 plan: the line is gone: review", fns.commitPM3Plan(E, MVP, RES_OK).job_status, "REQUIRES_REVIEW");
  const back = fns.commitPM3Plan(E, MVP, [U(), C("70001|R|000.1"), LN()]);
  eq("PM3 plan: a reservation moved back after PM2 (a GD save in between): review, nothing written", [back.job_status, back.writeCount, /reservation/.test(back.result_message)],
    ["REQUIRES_REVIEW", 0, true]);
  eq("PM3 plan: PM2's create is gone: review", fns.commitPM3Plan(E, MVP, [UA(), LN()]).job_status, "REQUIRES_REVIEW");
  eq("PM3 plan: PM2's create made twice: review", fns.commitPM3Plan(E, MVP, [UA(), C("70001|R|000.1"), C("70001|R|000.1"), LN()]).job_status, "REQUIRES_REVIEW");
  eq("PM3 check: read back -> DONE", fns.commitPM3Check(E, MVP, [LN({ temp_qty_data: ALC[0].temp_qty_data, view_stock: ALC[0].view_stock })]).route, "OK");
  eq("PM3 check: not written: retry", fns.commitPM3Check(E, MVP, [LN()]).result_code, "PK_STEP_RETRY");
}
done();
