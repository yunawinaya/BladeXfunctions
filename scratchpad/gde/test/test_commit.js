// test_commit.js [--mutate <name>]: GD_EDIT_COMMIT's step functions on small hand-made states. Each case states the behaviour
// it guards. --mutate breaks one step on purpose (MUTANTS below): the suite must then FAIL (the mutation check that every
// guarded behaviour is really tested).
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const K = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
// each mutant: [file, find, replace] - a defect the suite must notice
const MUTANTS = {
  e0_skip_res: ["e0.js", "if (!cur || String(cur.is_deleted) !== \"0\" || GE_RES_COLS_E0.some", "if (false && GE_RES_COLS_E0.some"],
  e0_no_unlock: ["_common.js", "unlockRows: unlock ? [{ id: entry.gdId, gd_status: entry.storedStatus || \"Created\" }] : []", "unlockRows: []"],
  e1_no_skip: ["e1.js", "needCall: movements.length ? \"YES\" : \"NO\"", "needCall: \"YES\""],
  e1_no_restore: ["e1.js", "return failNoWrite(entry, \"GDE_INVENTORY_\" + (s(eng.result_code) || \"FAILED\"), why, restore);", "return failNoWrite(entry, \"GDE_INVENTORY_\" + (s(eng.result_code) || \"FAILED\"), why);"],
  e2_sparse: ["e2.js", "for (const c of cols) row[c] = geCell(K, c, c in p.cells ? p.cells[c] : cur[c]);", "for (const c of Object.keys(p.cells)) row[c] = geCell(K, c, p.cells[c]);"],
  e2_no_before: ["e2.js", "if (!cs.every((c) => sameVal(cur[c], p.before[c]))) { conflicts.push(s(p.id)); continue; }", ""],
  e2_dup_insert: ["e2.js", "    if (byKey[k]) return;\n", ""],
  e2_raw_dec: ["e2.js", "if (kind === \"dec\") return v === \"\" ? null : q8(v).toFixed(8);", "if (kind === \"dec\") return v;"],
  e3_no_fix: ["e3.js", "const res = rv.fix(resPart);", "const res = resPart;"],
  e5_no_sig: ["e5.js", "if (intent && geSig(items, GE_SIG_ITEM) === intent.items && geSig(recs, GE_SIG_REC) === intent.records)", "if (intent)"],
  e6_no_unlock_status: ["e6.js", "row.gd_status = \"Created\";", ""],
  entry_hold: ["entry.js", "if (req && Number(req.hold) === 1 && !released)", "if (false)"],
  e5_no_resolve: ["e5.js", "const pick = p.PICK ? rv.fix(p.PICK) : null;", "const pick = p.PICK || null;"],
};
const files = ["_common.js", "guard.js", "own.js", "result.js", "so_fresh.js", "entry.js", "e0.js", "e0n.js", "e1.js", "e2.js", "e3.js", "e5.js", "e6.js", "e7.js"];
let src = [R + "scratchpad/gdc/code/prepare/adapter.js", D + "/code/prepare/plan_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
for (const f of files) {
  let t = fs.readFileSync(D + "/code/commit/" + f, "utf8");
  if (mutate && MUTANTS[mutate] && MUTANTS[mutate][0] === f) {
    assert(t.indexOf(MUTANTS[mutate][1]) >= 0, "mutant " + mutate + " does not apply");
    t = t.replace(MUTANTS[mutate][1], MUTANTS[mutate][2]);
  }
  src += "\n" + t;
}
if (mutate && !MUTANTS[mutate]) throw new Error("no mutant " + mutate);
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date, console };
vm.createContext(sb);
vm.runInContext(src, sb);
const call = (fn, ...args) => { sb.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", sb))); };
const E = (o) => Object.assign({ jobId: "2110000000000000001", organizationId: "9", gdId: "2100000000000000001", gdNo: "GD/1", dbNow: "2026-10-15 10:00:00", attempts: 0, rowVersion: 3,
  storedStatus: "Created", unlockOk: "YES", pickUnlockOk: "YES", pickingId: "2100000000000000900", pickVersion: "2026-10-15 09:00:00.000", number: "", leaseUntil: "2026-10-15 10:10:00" }, o || {});
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + e.message.split("\n")[0]); } };

// ---- entry
const job = (o) => Object.assign({ db_now: "2026-10-15 10:00:00", id: "2110000000000000001", is_deleted: 0, command: "EDIT_GD", job_status: "READY_TO_COMMIT", row_version: 3, attempt_count: 0,
  lease_until: "2026-10-15 10:10:00", idempotency_key: "GDE|2100000000000000001|1", correlation_id: "GD|2100000000000000001", organization_id: "9",
  request_payload: JSON.stringify({ v: 1, picking_version: "2026-10-15 09:00:00.000" }),
  prepared_payload: JSON.stringify({ job_id: "2110000000000000001", gd_id: "2100000000000000001", gd_no: "GD/1", stored_status: "Created", nonce: "a1b2c3d4",
    parts: Object.fromEntries(["ENGINE", "GDL", "GDH", "RES", "SO", "PICK", "STAMP", "AFTER"].map((p) => [p, ["P|a1b2c3d4|" + p + "|001"]])), counts: { lines: 2 } }) }, o || {});
const guard = { jobId: "2110000000000000001", tenantId: "1", leaseOwner: "WRK|x", nonce: "n1" };
const gdLocked = [{ gd_status: "Processing", lock_ref: "GDE|2100000000000000001|1" }];
const pickHeld = [{ id: "2100000000000000900", is_processing: 1, update_time: "2026-10-15 09:00:00.000" }];
it("entry: a fresh job runs phase A with E0 and E1, and may unlock", () => {
  const r = call("commitEntry", guard, [job()], [], gdLocked, pickHeld);
  assert.strictEqual(r.route, "GO"); assert.strictEqual(r.phase, "A"); assert.strictEqual(r.needE0, "YES"); assert.strictEqual(r.needE1, "YES"); assert.strictEqual(r.unlockOk, "YES"); assert.strictEqual(r.pickUnlockOk, "YES");
});
it("entry: after E1 the run is phase B and can no longer unlock", () => {
  const r = call("commitEntry", guard, [job({ job_status: "COMMITTING_GD", lease_owner: "SPLIT|n0", due: 1 })], [{ step_name: "E0_REVALIDATE", step_status: "DONE" }, { step_name: "E1_INVENTORY", step_status: "DONE" }], gdLocked, pickHeld);
  assert.strictEqual(r.phase, "B"); assert.strictEqual(r.unlockOk, "NO"); assert.strictEqual(r.needE2, "YES");
  assert.strictEqual(r.needE3, "NO"); assert.strictEqual(r.needE4, "NO");
});
const doneSteps = (names) => names.map((n) => ({ step_name: n, step_status: "DONE" }));
it("entry: after E2 the run is phase B2: E3 and E4 (the lines' run and this one each stay small at 2,000 lines)", () => {
  const r = call("commitEntry", guard, [job({ job_status: "COMMITTING_GD", lease_owner: "SPLIT|n1", due: 1 })], doneSteps(["E0_REVALIDATE", "E1_INVENTORY", "E2_LINES"]), gdLocked, pickHeld);
  assert.strictEqual(r.phase, "B2"); assert.strictEqual(r.needE2, "NO"); assert.strictEqual(r.needE3, "YES"); assert.strictEqual(r.needE4, "YES"); assert.strictEqual(r.needE5, "NO");
});
it("entry: B2 resumes what is left of it; after E3 and E4 the run is phase C", () => {
  const r = call("commitEntry", guard, [job({ job_status: "COMMITTING_GD", lease_owner: "SPLIT|n1", due: 1 })], doneSteps(["E0_REVALIDATE", "E1_INVENTORY", "E2_LINES", "E3_RESERVATIONS"]), gdLocked, pickHeld);
  assert.strictEqual(r.phase, "B2"); assert.strictEqual(r.needE3, "NO"); assert.strictEqual(r.needE4, "YES");
  const c = call("commitEntry", guard, [job({ job_status: "COMMITTING_GD", lease_owner: "SPLIT|n1", due: 1 })], doneSteps(["E0_REVALIDATE", "E1_INVENTORY", "E2_LINES", "E3_RESERVATIONS", "E4_SO"]), gdLocked, pickHeld);
  assert.strictEqual(c.phase, "C"); assert.strictEqual(c.needE5, "YES");
});
it("entry: a held cascade job without RELEASE writes nothing", () => {
  const r = call("commitEntry", guard, [job({ request_payload: JSON.stringify({ v: 1, hold: 1 }) })], [], gdLocked, pickHeld);
  assert.strictEqual(r.route, "NO_WRITE");
});
it("entry: a lock taken by a later job is not ours", () => {
  const r = call("commitEntry", guard, [job()], [], [{ gd_status: "Processing", lock_ref: "GDC|2100000000000000001|2" }], pickHeld);
  assert.strictEqual(r.unlockOk, "NO");
});

// ---- E0
const res1 = { id: "3001", is_deleted: 0, target_gd_id: "2100000000000000001", status: "Allocated", reserved_qty: 5, open_qty: 5, delivered_qty: 0, doc_no: "GD/1", doc_id: "2100000000000000001", doc_line_id: "4001", source_reserved_id: null, item_uom: "77" };
const before1 = { target_gd_id: "2100000000000000001", status: "Allocated", reserved_qty: 5, open_qty: 5, delivered_qty: 0, doc_no: "GD/1", doc_id: "2100000000000000001", doc_line_id: "4001", source_reserved_id: null, item_uom: "77" };
const partsE0 = { RES: { updates: [{ id: "3001", before: before1, after: Object.assign({}, before1, { reserved_qty: 4, open_qty: 4 }) }] }, GDL: { patches: [], deletes: [] }, PICK: { mode: "NONE" },
  SO: { soLineIds: [], tableGD: [], bundleParents: [], items: [], gdStatus: "Created", original: [], current: [] } };
sb.geSoRun = () => ({ final: [], heads: [] });
it("E0: unchanged reservations pass", () => { const r = call("commitE0", E(), partsE0, [res1], [], [], [], []); assert.strictEqual(r.route, "OK"); });
it("E0: a reservation changed since PREPARE fails the job, the GD back to Created, the Picking unlocked", () => {
  const r = call("commitE0", E(), partsE0, [Object.assign({}, res1, { reserved_qty: 3 })], [], [], [], []);
  assert.strictEqual(r.result_code, "GDE_STALE"); assert.deepStrictEqual(r.unlockRows, [{ id: "2100000000000000001", gd_status: "Created" }]); assert.strictEqual(r.needPickUnlock, "YES");
});
it("E0: a Draft's failure puts it back to Draft", () => {
  const r = call("commitE0", E({ storedStatus: "Draft" }), partsE0, [Object.assign({}, res1, { reserved_qty: 3 })], [], [], [], []);
  assert.deepStrictEqual(r.unlockRows, [{ id: "2100000000000000001", gd_status: "Draft" }]);
});
it("E0: without the lock nothing is unlocked", () => {
  const r = call("commitE0", E({ unlockOk: "NO", pickUnlockOk: "NO" }), partsE0, [res1], [], [], [], []);
  assert.strictEqual(r.result_code, "GDE_NOT_LOCKED"); assert.deepStrictEqual(r.unlockRows, []);
});

// ---- E1
it("E1: no movement = no engine call, DONE + SPLIT", () => {
  const i = call("commitE1In", E(), { operation_key: "GDE|2110000000000000001", movements: [] });
  assert.strictEqual(i.needCall, "NO");
  const r = call("commitE1", E(), guard, i, {}, {}, []);
  assert.strictEqual(r.route, "OK"); assert.strictEqual(r.needSplit, "YES");
});
it("E1: a Draft's movements carry the issued number", () => {
  const i = call("commitE1In", E({ number: "GD/20261015/001" }), { operation_key: "GDE|2110000000000000001", movements: [{ trx_no: "#GDE-DELIVERY-NO#", quantity: 1 }] });
  assert.strictEqual(i.movements[0].trx_no, "GD/20261015/001"); assert.strictEqual(i.needCall, "YES");
});
it("E1: an engine 400 after numbering fails and puts the Draft's number back", () => {
  const intent = [{ step_name: "E0N|I|001", result_ref: JSON.stringify({ delivery_no: "Draft/GD/0007", delivery_no_type: "55" }) }];
  const r = call("commitE1", E({ storedStatus: "Draft" }), guard, { ok: "YES", needCall: "YES" }, { code: "400", result_code: "INSUFFICIENT" }, {}, intent);
  assert.strictEqual(r.job_status, "FAILED"); assert.deepStrictEqual(r.restoreRows, [{ id: "2100000000000000001", delivery_no: "Draft/GD/0007", delivery_no_type: "55" }]);
});
it("E1: a 409 with engine intents is a retry, never a clean fail", () => {
  const r = call("commitE1", E(), guard, { ok: "YES", needCall: "YES" }, { code: "409" }, { intents: 3 }, []);
  assert.strictEqual(r.result_code, "GDE_STEP_RETRY"); assert.deepStrictEqual(r.unlockRows, []);
});

// ---- E2
const L = (o) => Object.assign({ id: "4001", is_deleted: 0, gd_qty: 5, temp_qty_data: "[{\"gd_quantity\":5}]", line_remark_1: "a", job_line_key: null, picking_status: "Not Created" }, o || {});
const gdl = { inserts: [{ ph: "9000000000000000001", parent: null, row: { material_id: "8", gd_qty: 1.6, line_remark_1: "new" } }, { ph: "9000000000000000002", parent: "9000000000000000001", row: { material_id: "9", gd_qty: 2 } }],
  patches: [{ id: "4001", cells: { gd_qty: 4, temp_qty_data: "[{\"gd_quantity\":4}]" }, before: { gd_qty: 5, temp_qty_data: "[{\"gd_quantity\":5}]" } }], deletes: ["4002"], order: [] };
it("E2: first pass inserts the parent, defers its child, writes whole patched rows and the removal", () => {
  const r = call("commitE2Plan", E(), gdl, [L(), L({ id: "4002" })], K);
  assert.strictEqual(r.insertRows.length, 1); assert.strictEqual(r.deferred, 1); assert.strictEqual(r.insertRows[0].job_line_key, "2110000000000000001|L|1");
  assert.strictEqual(r.insertRows[0].gd_qty, "1.60000000");
  const row = r.patchSlices[0].rows[0];
  assert.strictEqual(row.line_remark_1, "a"); assert.strictEqual(row.gd_qty, "4.00000000");
  assert.deepStrictEqual(r.deleteRows, [{ id: "4002", is_deleted: 1 }]);
});
it("E2: second pass inserts the child under its parent's real id, skips what is done", () => {
  const r = call("commitE2Plan", E(), gdl, [L({ gd_qty: 4, temp_qty_data: "[{\"gd_quantity\":4}]" }), L({ id: "4002", is_deleted: 1 }), L({ id: "5001", job_line_key: "2110000000000000001|L|1" })], K);
  assert.strictEqual(r.insertRows.length, 1); assert.strictEqual(r.insertRows[0].parent_id, "5001"); assert.strictEqual(r.patchCount, 0); assert.strictEqual(r.needDelete, "NO");
});
it("E2: a line changed by someone else after the stock moved goes to review", () => {
  const r = call("commitE2Plan", E(), gdl, [L({ gd_qty: 7 }), L({ id: "4002" })], K);
  assert.strictEqual(r.job_status, "REQUIRES_REVIEW");
});

// ---- E3
it("E3: a create for a new line gets the inserted line's id and the issued number", () => {
  const resPart = { updates: [], creates: [{ job_line_key: "2110000000000000001|C|1", doc_line_id: "9000000000000000001", doc_no: "#GDE-DELIVERY-NO#", target_gd_id: "2100000000000000001", reserved_qty: 1 }] };
  const r = call("commitE3Plan", E({ number: "GD/20261015/001" }), resPart, gdl, [], [L({ id: "5001", job_line_key: "2110000000000000001|L|1" })]);
  assert.strictEqual(r.createRows[0].doc_line_id, "5001"); assert.strictEqual(r.createRows[0].doc_no, "GD/20261015/001"); assert.strictEqual(r.createRows[0].doc_id, "2100000000000000001");
});
it("E3: an unresolved placeholder is never written", () => {
  const resPart = { updates: [], creates: [{ job_line_key: "2110000000000000001|C|1", doc_line_id: "9000000000000000001", target_gd_id: "2100000000000000001" }] };
  const r = call("commitE3Plan", E(), resPart, gdl, [], []);
  assert.strictEqual(r.job_status, "REQUIRES_REVIEW"); assert.deepStrictEqual(r.createRows, []);
});

// ---- E5
const head = (o) => Object.assign({ id: "2100000000000000900", to_id: "PI-1", to_status: "Created", is_deleted: 0, is_processing: 1, update_time: "2026-10-15 09:00:00.000" }, o || {});
const item = (o) => Object.assign({ id: "6001", transfer_order_id: "2100000000000000900", gd_id: "2100000000000000001", gd_line_id: "4001", item_code: "X", qty_to_pick: 5, pending_process_qty: 5, line_status: "Open" }, o || {});
const pickUpd = { mode: "UPDATE", pickingId: "2100000000000000900", version: "2026-10-15 09:00:00.000", header: { to_status: "Created" },
  items: { layout: [{ ref: "6001" }], cells: { "6001": { qty_to_pick: 4, pending_process_qty: 4 } }, drop: {}, added: [] }, records: { layout: [], cells: {}, drop: {}, added: [] } };
it("E5: at the locked version the rebuilt arrays are written with an intent signature", () => {
  const r = call("commitE5Plan", E(), pickUpd, [], [head()], [item()], []);
  assert.strictEqual(r.needWrite, "YES"); assert.strictEqual(r.writeRows[0].table_picking_items[0].qty_to_pick, 4); assert.strictEqual(r.needIntent, "YES");
});
it("E5: our own landed write (version moved, signature equal) is checked, not rewritten", () => {
  const p1 = call("commitE5Plan", E(), pickUpd, [], [head()], [item()], []);
  const r = call("commitE5Plan", E(), pickUpd, p1.intentRows, [head({ update_time: "2026-10-15 10:00:01.000" })], [item({ qty_to_pick: "4.000", pending_process_qty: "4.000" })], []);
  assert.strictEqual(r.route, "CHECK");
});
it("E5: someone else's change (version moved, signature differs) goes to review", () => {
  const p1 = call("commitE5Plan", E(), pickUpd, [], [head()], [item()], []);
  const r = call("commitE5Plan", E(), pickUpd, p1.intentRows, [head({ update_time: "2026-10-15 10:00:01.000" })], [item({ qty_to_pick: 5, pending_process_qty: 2, line_status: "In Progress" })], []);
  assert.strictEqual(r.job_status, "REQUIRES_REVIEW");
});

// ---- E6
const hdr = (o) => Object.assign({ id: "2100000000000000001", gd_status: "Processing", order_remark: "old", gd_total: 10, picking_status: "Created" }, o || {});
const gdh = { cells: { order_remark: "new" }, before: { order_remark: "old" } };
it("E6: the header goes out whole with gd_status Created, the Picking lock released at our version", () => {
  const r = call("commitE6Plan", E(), gdh, { gdPickingStatus: null }, [hdr()], [head()], K);
  assert.strictEqual(r.headerRows[0].gd_status, "Created"); assert.strictEqual(r.headerRows[0].order_remark, "new"); assert.strictEqual(r.headerRows[0].gd_total, "10.00000000");
  assert.deepStrictEqual(r.pickUnlockRows, [{ id: "2100000000000000900", is_processing: 0 }]);
});
it("E6: a Picking lock someone else holds now is not released", () => {
  const r = call("commitE6Plan", E(), gdh, { gdPickingStatus: null }, [hdr()], [head({ update_time: "2026-10-15 11:00:00.000" })], K);
  assert.deepStrictEqual(r.pickUnlockRows, []);
});


// ---- E5: the placeholders PREPARE minted, resolved before the Picking is written
const PH1 = "9000000000000000001";
const gdlNew = { inserts: [{ ph: PH1, parent: null, row: {} }], patches: [], deletes: [] };
const newLine = [{ j: JSON.stringify({ id: "2100000000000000099", job_line_key: "2110000000000000001|L|1", is_deleted: 0 }) }];
it("e5 resolve: a new line's placeholder in the Picking and the stamps becomes its inserted id", () => {
  const pick = { mode: "UPDATE", pickingId: "2100000000000000900", items: { add: [item({ id: undefined, gd_line_id: PH1 })] } };
  const r = call("geE5Resolve", E(), { PICK: pick, STAMP: { gdPickingStatus: "Created", lineIds: [PH1, "4001"] }, GDL: gdlNew }, newLine);
  assert.strictEqual(r.left, ""); assert.strictEqual(r.pick.items.add[0].gd_line_id, "2100000000000000099");
  assert.deepStrictEqual(r.stamp.lineIds, ["2100000000000000099", "4001"]);
});
it("e5 resolve: a placeholder with no inserted line is reported", () => {
  const r = call("geE5Resolve", E(), { PICK: { mode: "CREATE", createData: { table_picking_items: [{ gd_line_id: PH1 }] } }, STAMP: { lineIds: [] }, GDL: gdlNew }, []);
  assert.strictEqual(r.left, PH1);
});
it("e5 resolve: a Draft's number in a new Picking becomes the issued number", () => {
  const r = call("geE5Resolve", E({ number: "GD/2026/0007" }), { PICK: { mode: "CREATE", createData: { delivery_no: "#GDE-DELIVERY-NO#", gd_no: ["2100000000000000001"] } }, STAMP: null, GDL: { inserts: [] } }, []);
  assert.strictEqual(r.left, ""); assert.strictEqual(r.pick.createData.delivery_no, "GD/2026/0007");
});

it("so fresh: SQL rows -> the lines and the headers carrying their own lines (table_so), as the SO nodes take them", () => {
  const L = (o) => ({ j: JSON.stringify(Object.assign({ id: "7001", sales_order_id: "8001", parent_id: null, delivered_qty: "1.000" }, o)) });
  const f = call("geSoFresh", [L({}), L({ id: "7002" }), L({ id: "7003", sales_order_id: "8002" })], [{ j: JSON.stringify({ id: "8001", so_status: "Issued" }) }, { j: JSON.stringify({ id: "8002", so_status: "Issued" }) }]);
  assert.strictEqual(f.lines.length, 3);
  assert.deepStrictEqual(f.shaped.map((h) => h.table_so.map((l) => l.id)), [["7001", "7002"], ["7003"]]);
});

it("so ids: the SOs and SO lines the SO part names (header so_id; every row and child of the edit, the stored GD and the current table)", () => {
  const so = { soIds: '["8001"]', soLineIds: ["7001"], tableGD: [{ so_line_item_id: "7001", line_so_id: "8001", children: [{ so_line_item_id: "7002", line_so_id: "8001" }] }],
    bundleParents: [], original: [{ so_line_item_id: "7009", line_so_id: "8009" }], current: [{ so_line_item_id: "7001", line_so_id: "8001" }] };
  const r = call("geSoIds", so);
  assert.deepStrictEqual(JSON.parse(r.soIdsJson).sort(), ["8001", "8009"]);
  assert.deepStrictEqual(JSON.parse(r.lineIdsJson).sort(), ["7001", "7002", "7009"]);
  assert.deepStrictEqual(JSON.parse(call("geSoIds", null).soIdsJson), ["0"]);
});

it("phase split: COMMITTING_GD under a SPLIT| hand-over lease, no next attempt (the worker calls again in the tick)", () => {
  const r = call("commitPhaseSplit", E(), { nonce: "abc" }, 90, "lines saved");
  assert.strictEqual(r.needSplit, "YES");
  const j = r.splitRows[0];
  assert.strictEqual(j.job_status, "COMMITTING_GD"); assert.strictEqual(j.lease_owner, "SPLIT|abc"); assert.strictEqual(j.lease_expires_at, "2026-10-15 10:10:00");
  assert.strictEqual(j.next_attempt_at, null); assert.strictEqual(j.progress_percent, 90); assert.strictEqual(j.row_version, 5);
});
it("E6: a header cell still holding a placeholder is never written (review)", () => {
  const head = [{ j: JSON.stringify({ id: "2100000000000000001", gd_status: "Processing", delivery_no: "GD/1" }) }];
  const r = call("commitE6Plan", E(), { cells: { remark: "#GDE-DELIVERY-NO#" }, before: { remark: "" } }, null, head, [], K);
  assert.strictEqual(r.route, "END"); assert.strictEqual(r.job_status, "REQUIRES_REVIEW"); assert.strictEqual(r.needHeader, "NO");
});

it("e5 run: an unresolved placeholder ends E5 in review and writes nothing", () => {
  const r = call("commitE5Run", E(), { PICK: { mode: "CREATE", createData: { table_picking_items: [{ gd_line_id: PH1 }] } }, STAMP: { lineIds: [] }, GDL: gdlNew }, [], [], [], [], []);
  assert.strictEqual(r.route, "END"); assert.strictEqual(r.job_status, "REQUIRES_REVIEW");
  assert.strictEqual(r.needAdd, "NO"); assert.strictEqual(r.needWrite, "NO"); assert.deepStrictEqual(r.addRow, {});
});
it("e5 run: resolved, a new Picking's row goes out as ONE object (the classic add-node maps a single record)", () => {
  const r = call("commitE5Run", E(), { PICK: { mode: "CREATE", createData: { to_status: "Created", table_picking_items: [{ gd_line_id: PH1 }] } }, STAMP: { lineIds: [PH1] }, GDL: gdlNew }, newLine, [], [], [], []);
  assert.strictEqual(r.needAdd, "YES"); assert.strictEqual(r.addRow.table_picking_items[0].gd_line_id, "2100000000000000099"); assert.strictEqual(r.needStart, "YES");
});

it("line check projection: id, is_deleted, job_line_key and the patched columns, each as jobj renders it; an unknown column is never read", () => {
  const ex = { id: "CAST(gl.`id` AS UNSIGNED)", is_deleted: "gl.`is_deleted`", job_line_key: "gl.`job_line_key`", line_index: "gl.`line_index`", prev_temp_qty_data: "gl.`prev_temp_qty_data`" };
  const sql = call("geLineCheckSql", { patches: [{ id: "1", cells: { line_index: 2, prev_temp_qty_data: "[]" }, before: {} }, { id: "2", cells: { "x`); DROP": 1 }, before: {} }] }, ex);
  assert.strictEqual(sql, "JSON_OBJECT('id', CAST(gl.`id` AS UNSIGNED), 'is_deleted', gl.`is_deleted`, 'job_line_key', gl.`job_line_key`, 'line_index', gl.`line_index`, 'prev_temp_qty_data', gl.`prev_temp_qty_data`)");
  assert.strictEqual(call("geLineCheckSql", null, ex), "JSON_OBJECT('id', CAST(gl.`id` AS UNSIGNED), 'is_deleted', gl.`is_deleted`, 'job_line_key', gl.`job_line_key`)");
});

// ---- guard / own / result
it("guard: a bad job id is refused with Edit V2's code; the lease owner is PUB|<nonce>", () => {
  assert.strictEqual(call("publishGuard", { jobId: "x", systemTenantId: "1", uuid: "ab" }).result_code, "GDE_INVALID_DATA");
  assert.strictEqual(call("publishGuard", { jobId: "5", systemTenantId: "1", uuid: "ab-cd" }).leaseOwner, "PUB|abcd00000000000000000000");
});
it("own: COMMITTING_GD under this run's lease goes on; anything else is LOST", () => {
  const g = { leaseOwner: "PUB|x" };
  assert.strictEqual(call("commitOwn", g, [{ id: "5", job_status: "COMMITTING_GD", lease_owner: "PUB|x" }]).route, "GO");
  assert.strictEqual(call("commitOwn", g, [{ id: "5", job_status: "COMMITTING_GD", lease_owner: "PUB|y" }]).route, "LOST");
  assert.strictEqual(call("commitOwn", g, []).route, "LOST");
});
it("result: names GD_EDIT_COMMIT and the path", () => {
  const r = call("commitResult", { jobId: "5" }, { phase: "B" }, { job_status: "COMMITTING_GD", result_code: "" }, "SPLIT");
  const ev = JSON.parse(r.evidence);
  assert.strictEqual(ev.workflow, "GD_EDIT_COMMIT"); assert.strictEqual(ev.path, "SPLIT"); assert.strictEqual(r.path, "SPLIT");
});

// ---- end stamps: finished_at is the run's real end (the DB clock read at entry + the seconds the run has taken)
const T0 = Date.UTC(2026, 9, 16, 2, 0, 0);
const withClock = (t, f) => { const real = sb.Date; sb.Date = class extends real { static now() { return t; } }; try { return f(); } finally { sb.Date = real; } };
it("entry: returns jsAt, its own clock, for the run's end stamps", () => {
  assert.strictEqual(withClock(T0, () => call("commitEntry", guard, [job()], [], gdLocked, pickHeld)).jsAt, String(T0));
});
it("end stamps: entry + the run's whole seconds (jsAt); dbNow when the entry has no jsAt", () => {
  const e = E({ jsAt: String(T0) });
  withClock(T0 + 30500, () => {
    assert.strictEqual(call("doneRow", e, "E2_LINES", "").finished_at, "2026-10-15 10:00:30");
    assert.strictEqual(call("failNoWrite", e, "GDE_X", "why").jobRows[0].finished_at, "2026-10-15 10:00:30");
    assert.strictEqual(call("stepEnd", e, "E2_LINES", "why", true).jobRows[0].finished_at, "2026-10-15 10:00:30");
    assert.strictEqual(call("commitFinish", e, {}).jobRows[0].finished_at, "2026-10-15 10:00:30");
    assert.strictEqual(call("doneRow", E(), "E2_LINES", "").finished_at, "2026-10-15 10:00:00");
  });
});

// ---- MySQL json columns keep their own key order (sorted by length, then bytewise): read-backs compare JSON with sorted keys
const CLIENT_DOC = [{ key: "k1", domain: "d", link: "https://x/a.jpg", url: "https://x/a.jpg", size: 10, name: "a.jpg" }];
const MYSQL_DOC = [{ key: "k1", url: "https://x/a.jpg", link: "https://x/a.jpg", name: "a.jpg", size: 10, domain: "d" }];
it("sameVal: JSON values compare with sorted keys, objects and JSON text alike", () => {
  assert.strictEqual(call("sameVal", CLIENT_DOC, MYSQL_DOC), true);
  assert.strictEqual(call("sameVal", JSON.stringify(CLIENT_DOC), JSON.stringify(MYSQL_DOC)), true);
  assert.strictEqual(call("sameVal", { b: 1, a: { d: 2, c: 3 } }, '{"a": {"c": 3, "d": 2}, "b": 1}'), true);
  assert.strictEqual(call("sameVal", CLIENT_DOC, [{ key: "k2" }]), false);
});
it("E6: an attachment edit (gd_ref_doc) reads back in MySQL's key order -> the header is saved, no retry", () => {
  const gdh = { cells: { gd_ref_doc: CLIENT_DOC }, before: { gd_ref_doc: null } };
  const r = call("commitE6Check", E(), gdh, { gdPickingStatus: null }, [{ id: "2100000000000000001", gd_status: "Created", gd_ref_doc: MYSQL_DOC }]);
  assert.ok(!/does not read back/.test(r.result_message || ""), r.result_message);
  assert.notStrictEqual(r.job_status, "REQUIRES_REVIEW");
});
it("geGdParts: a JSON cell that differs only in key order is not a change", () => {
  const r = call("geGdParts", { id: "1", gd_ref_doc: MYSQL_DOC, table_gd: [{ id: "11", custom_fields: { b: 1, a: 2 } }] },
    { id: "1", gd_ref_doc: CLIENT_DOC, table_gd: [{ id: "11", custom_fields: { a: 2, b: 1 } }] }, K);
  assert.deepStrictEqual(r.GDH.cells, {}); assert.deepStrictEqual(r.GDL.patches, []);
});
const PICK_ID = "2100000000000000900", AFTER = "2026-10-15 10:00:01.123";
const pickHead = (o) => [Object.assign({ id: PICK_ID, to_id: "PI-1", to_status: "Created", is_deleted: 0, is_processing: 1, update_time: AFTER }, o || {})];
it("E5: a Picking header JSON cell (ref_doc) in MySQL's key order and an [] the platform does not write both read back", () => {
  const pick = { mode: "UPDATE", pickingId: PICK_ID, version: "2026-10-15 09:00:00.000", header: { ref_doc: CLIENT_DOC, assigned_to: [] }, items: [], records: [] };
  const r = call("commitE5Check", E(), pick, { sig: { items: call("geSig", [], []), records: call("geSig", [], []) } }, pickHead({ ref_doc: MYSQL_DOC, assigned_to: ["2105190590557097986"] }), [], []);
  assert.ok(!/does not read back/.test(r.result_message || ""), r.result_message);
});
it("E5 (C1): a header sync with no other Picking write records the synced version, and E6 unlocks at it", () => {
  const pick = { mode: "NONE", hdrSync: { pickingId: PICK_ID, headerData: { delivery_method: "Company Truck" } } };
  const chk = call("commitE5Check", E(), pick, { needSync: "YES" }, pickHead(), [], []);
  assert.strictEqual(chk.stepRows[0].result_ref, AFTER);
  const e6 = call("commitE6Plan", E({ unlockOk: "NO", pickUnlockOk: "YES", pickingId: PICK_ID, pickVersion: chk.stepRows[0].result_ref }), { cells: {}, before: {} }, { gdPickingStatus: null },
    [{ id: "2100000000000000001", gd_status: "Processing" }], [{ id: PICK_ID, is_processing: 1, update_time: AFTER }], K);
  assert.strictEqual(e6.needPickUnlock, "YES");
});

// SUBMIT died between locking the Picking and recording its version: PREPARE adopts the current one, COMMIT reads it from the payload
it("geAdoptPickVersion: the recorded version; else a locked Picking's current one; else none", () => {
  const R = (on, t) => ({ pick: { count: 1, data: { id: "6", is_processing: on, update_time: t } } });
  assert.strictEqual(call("geAdoptPickVersion", { picking_version: "2026-10-15 09:00:00.000" }, R(1, "2026-10-15 09:00:05.000")), "2026-10-15 09:00:00.000");
  assert.strictEqual(call("geAdoptPickVersion", { picking_version: "" }, R(1, "2026-10-15 09:00:05.000")), "2026-10-15 09:00:05.000");
  assert.strictEqual(call("geAdoptPickVersion", {}, R(0, "2026-10-15 09:00:05.000")), "");
  assert.strictEqual(call("geAdoptPickVersion", {}, {}), "");
});
it("entry: with no version in the request, the Picking version PREPARE adopted (the payload's) unlocks", () => {
  const m = JSON.parse(job().prepared_payload); m.picking_version = "2026-10-15 09:00:00.000";
  const r = call("commitEntry", guard, [job({ request_payload: JSON.stringify({ v: 1, picking_version: "" }), prepared_payload: JSON.stringify(m) })], [], gdLocked, pickHeld);
  assert.strictEqual(r.pickVersion, "2026-10-15 09:00:00.000"); assert.strictEqual(r.pickUnlockOk, "YES");
});

console.log(JSON.stringify({ mutant: mutate || null, cases: n, failed: failed }));
process.exit(failed ? 1 : 0);
