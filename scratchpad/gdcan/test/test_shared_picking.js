// test_shared_picking.js [GD_CANCEL_COMMIT.json]: X5 (numbers) and X4P (Pickings) of the BUILT commit on a Picking shared by several
// deliveries, cancelled concurrently (LSH 2026-10-25: three cancels went to review on whole-text before / after). Runs each node's
// own functions, its call cut off.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/CancelV2/GD_CANCEL_COMMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const fns = (id, names) => {
  const code = find(W, id).data.script.code;
  const cut = code.lastIndexOf("const res = ");
  return new Function(code.slice(0, cut) + "\nreturn { " + names.map((n) => n + ": " + n).join(", ") + " };")();
};
const X5 = fns("code_node_XCx5plan", ["cancelX5Plan", "cancelX5Check"]);
const X4P = fns("code_node_XCx4pplan", ["cancelX4PPlan", "cancelX4PCheck", "cancelX4PIds"]);
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 600))); if (!ok) fails += 1; };
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

const entry = { jobId: "77", organizationId: "1996787068457861121", gdId: "1305", partPrefix: "P|abcd1234|", dbNow: "2026-10-25 05:00:00", jsAt: "0", attempts: 0, rowVersion: 5 };
const part = (kind, v) => [{ step_name: entry.partPrefix + kind + "|001", result_ref: JSON.stringify(v) }];
const rows = (k, list) => list.map((o) => ({ k: k, j: JSON.stringify(Object.assign({ is_deleted: 0 }, o)) }));
const status = (r) => (r.jobRows && r.jobRows[0] ? r.jobRows[0].job_status : r.route);

// ---------------------------------------------------------------- X5: the shared Picking header's delivery list
const OLD = "GD-2610-1305", NEW = "GD-2610-1305-Cancelled";
// PREPARE saw "GD-2610-1305, GD-2610-1311" (the LSH header PI-2610-3446 before either cancel)
const num = part("NUM", { old_no: OLD, new_no: NEW, picking_headers: [{ id: "3446", before: OLD + ", GD-2610-1311", after: NEW + ", GD-2610-1311" }],
  picking_rows: [{ id: "501", before: OLD, after: NEW }], packing_headers: [], packing_items: [], packing_sources: [] });
const x5now = (hdr, row, extra) => rows("H", [Object.assign({ id: "3446", delivery_no: hdr }, extra || {})]).concat(rows("L", [{ id: "501", gd_no: row }]));

let r = quiet(() => X5.cancelX5Plan(entry, num, x5now(OLD + ", GD-2610-1311-Cancelled", OLD), []));
t("X5: a sibling already renamed its token -> this GD's token is renamed in the CURRENT text, the sibling's kept (no review)",
  r.route === "GO" && r.headerRows.length === 1 && r.headerRows[0].delivery_no === NEW + ", GD-2610-1311-Cancelled" && r.rowCount === 1, r);
r = quiet(() => X5.cancelX5Plan(entry, num, x5now(NEW + ", GD-2610-1311", NEW), []));
t("X5: this GD's token already renamed (a re-run) -> nothing to write", r.route === "GO" && r.headerRows.length === 0 && r.rowCount === 0, r);
r = quiet(() => X5.cancelX5Plan(entry, num, x5now("GD-2610-1311", OLD), []));
t("X5: the header lost this GD altogether -> review (someone else changed the list)", status(r) === "REQUIRES_REVIEW" && /picking_headers 3446/.test(r.result_message), r);
r = quiet(() => X5.cancelX5Plan(entry, num, x5now(OLD + ", GD-2610-1311", "GD-2610-9999"), []));
t("X5: a Picking ROW of this GD changed by someone else -> still review (single-number columns keep before / after)", status(r) === "REQUIRES_REVIEW" && /picking_rows 501/.test(r.result_message), r);
r = quiet(() => X5.cancelX5Check(entry, num, x5now(OLD + ", GD-2610-1311-Cancelled", NEW), []));
t("X5 check: a sibling's write lost this GD's rename -> a counted RETRY, not review", status(r) === "COMMITTING_GD" && r.jobRows[0].attempt_count === 1 && r.result_code === "GDX_STEP_RETRY", r);
r = quiet(() => X5.cancelX5Check(entry, num, x5now("GD-2610-1311-Cancelled, " + NEW, NEW), []));
t("X5 check: this GD's token renamed (whatever the siblings' tokens, any order) -> DONE", r.route === "OK" && r.needStep === "YES", r);
r = quiet(() => X5.cancelX5Plan(entry, num, x5now(NEW + ", GD-2610-1311-Cancelled", NEW), []));
t("X5: the three-way LSH case converges: after the retry nothing is left to write", r.route === "GO" && r.headerRows.length === 0, r);

// a Picking another job holds (GD Edit V2 / a confirm): is_processing 1 with a lock under 15 min -> wait, never move its update_time
const held = { is_processing: 1, lock_age_sec: 30 };
r = quiet(() => X5.cancelX5Plan(entry, num, x5now(OLD + ", GD-2610-1311-Cancelled", OLD, held), []));
t("X5: the header still to rename is HELD by another job -> a counted RETRY (waits), nothing written", status(r) === "COMMITTING_GD" && r.result_code === "GDX_STEP_RETRY" && /held by another job/.test(r.result_message), r);
r = quiet(() => X5.cancelX5Plan(entry, num, x5now(NEW + ", GD-2610-1311", NEW, held), []));
t("X5: a held header whose token is already renamed -> no wait (nothing to write there)", r.route === "GO" && r.headerRows.length === 0, r);
r = quiet(() => X5.cancelX5Plan(entry, num, x5now(OLD + ", GD-2610-1311", OLD, { is_processing: 1, lock_age_sec: 1000 }), []));
t("X5: a hold older than 15 min is stale (the _fc.js rule) -> the rename goes ahead", r.route === "GO" && r.headerRows.length === 1, r);

// ---------------------------------------------------------------- X4P: an OPEN Picking shared by GD 1305 and GD 1308
const pick = part("PICK", { rows: [{ id: "601", picking_id: "7001", before: { line_status: "Open", pending_process_qty: 5 }, after: { line_status: "Cancelled", pending_process_qty: 0 } }], headers: [] });
const x4now = (mine, sibling, hdr) => rows("L", [{ id: "601", line_status: mine.st, pending_process_qty: mine.q }])
  .concat(rows("P", [Object.assign({ id: "7001", to_status: "In Progress", to_id: "PI-2610-9001" }, hdr || {})]))
  .concat(rows("A", [{ id: "601", picking_id: "7001", gd_id: "1305", line_status: mine.st }, { id: "602", picking_id: "7001", gd_id: "1308", line_status: sibling }]));

const ids = quiet(() => X4P.cancelX4PIds(entry, pick));
t("X4P ids: every Picking this GD has rows on is read (not only headers PREPARE meant to close)", JSON.parse(ids.pickingIdsJson).join() === "7001", ids);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Open")));
t("X4P: the sibling's row still open -> this GD's row written, header left open", r.route === "GO" && r.lineCount === 1 && r.headerRows.length === 0, r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Cancelled")));
t("X4P: the sibling cancelled first -> header Cancelled + '-Cancelled' (decided on the rows NOW, not PREPARE's snapshot)",
  r.route === "GO" && r.headerRows.length === 1 && r.headerRows[0].to_status === "Cancelled" && r.headerRows[0].to_id === "PI-2610-9001-Cancelled", r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Cancelled", { to_id: "PI-2610-9001-Cancelled" })));
t("X4P: the suffix is added once even if the to_id already carries it", r.headerRows.length === 1 && r.headerRows[0].to_id === "PI-2610-9001-Cancelled", r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Cancelled", { to_status: "Cancelled", to_id: "PI-2610-9001-Cancelled" })));
t("X4P: a header a sibling already closed is left as it is (no review)", r.route === "GO" && r.headerRows.length === 0 && r.lineCount === 1, r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Completed")));
t("X4P: the sibling's row Completed -> header Completed, to_id kept", r.headerRows.length === 1 && r.headerRows[0].to_status === "Completed" && r.headerRows[0].to_id === "PI-2610-9001", r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Picked by hand", q: 1 }, "Open")));
t("X4P: this GD's row changed by someone else -> review, as before", status(r) === "REQUIRES_REVIEW", r);
// the race: both cancels plan while the other's row is open; each writes its row; the LAST to check closes the header
r = quiet(() => X4P.cancelX4PCheck(entry, pick, x4now({ st: "Cancelled", q: 0 }, "Open")));
t("X4P check: own row written, sibling still open, header open -> DONE", r.route === "OK", r);
r = quiet(() => X4P.cancelX4PCheck(entry, pick, x4now({ st: "Cancelled", q: 0 }, "Cancelled")));
t("X4P check: own row written, sibling cancelled meanwhile, header still open -> RETRY (the retry closes it)", status(r) === "COMMITTING_GD" && r.result_code === "GDX_STEP_RETRY", r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Cancelled", q: 0 }, "Cancelled")));
t("X4P retry: nothing left on the rows, header Cancelled + suffix", r.lineCount === 0 && r.headerRows.length === 1 && r.headerRows[0].to_status === "Cancelled", r);
r = quiet(() => X4P.cancelX4PCheck(entry, pick, x4now({ st: "Cancelled", q: 0 }, "Cancelled", { to_status: "Cancelled", to_id: "PI-2610-9001-Cancelled" })));
t("X4P check: header closed -> DONE", r.route === "OK", r);

r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Cancelled", { is_processing: 1, lock_age_sec: 12 })));
t("X4P: the header to close is HELD by another job -> a counted RETRY, nothing written (no rows either)", status(r) === "COMMITTING_GD" && r.result_code === "GDX_STEP_RETRY" && /held by another job/.test(r.result_message), r);
r = quiet(() => X4P.cancelX4PPlan(entry, pick, x4now({ st: "Open", q: 5 }, "Open", { is_processing: 1, lock_age_sec: 12 })));
t("X4P: a held Picking whose header does not change -> this GD's rows still written (rows don't move the pinned header)", r.route === "GO" && r.lineCount === 1 && r.headerRows.length === 0, r);

// dev live test 10-25 (PI-20261019-0361): GD 599's rows were picked (Completed), GD 600's open. The 600 cancel closed the header
// Completed (599's rows still Completed then); the 599 cancel then cancelled its rows -> every row Cancelled -> header Cancelled
const pick599 = part("PICK", { rows: [{ id: "601", picking_id: "7001", before: { line_status: "Completed", pending_process_qty: 0 }, after: { line_status: "Cancelled", pending_process_qty: 0 } }], headers: [] });
r = quiet(() => X4P.cancelX4PPlan(entry, pick599, x4now({ st: "Completed", q: 0 }, "Cancelled", { to_status: "Completed" })));
t("X4P: a sibling closed the header Completed while this GD's rows were picked -> now every row is Cancelled -> Cancelled + suffix",
  r.route === "GO" && r.lineCount === 1 && r.headerRows.length === 1 && r.headerRows[0].to_status === "Cancelled" && r.headerRows[0].to_id === "PI-2610-9001-Cancelled", r);
r = quiet(() => X4P.cancelX4PCheck(entry, pick599, x4now({ st: "Cancelled", q: 0 }, "Cancelled", { to_status: "Completed" })));
t("X4P check: that header left Completed over all-Cancelled rows -> RETRY (the retry cancels it)", status(r) === "COMMITTING_GD" && r.result_code === "GDX_STEP_RETRY", r);
const pickNone = part("PICK", { rows: [], headers: [] });
r = quiet(() => X4P.cancelX4PPlan(entry, pickNone, rows("P", [{ id: "7001", to_status: "Completed", to_id: "PI-2610-9001" }]).concat(rows("A", [{ id: "601", picking_id: "7001", gd_id: "1305", line_status: "Completed" }]))));
t("X4P: a Picking already Completed before the cancel (no rows of this GD to write) stays as it is (user rule)", r.route === "GO" && r.headerRows.length === 0, r);

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
