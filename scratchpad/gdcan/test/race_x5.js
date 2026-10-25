// race_x5.js [GD_CANCEL_COMMIT.json]: two cancels of GDs sharing one Picking header, both reading the header before either
// writes (the BA's case, 10-25). Each X5 plan writes the WHOLE delivery_no text it computed from its own read, and each check
// looks only at its own token - so a write landing after the other job's check drops that job's rename, and both pass.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/CancelV2/GD_CANCEL_COMMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = find(W, "code_node_XCx5plan").data.script.code;
const X5 = new Function(code.slice(0, code.lastIndexOf("const res = ")) + "\nreturn { cancelX5Plan, cancelX5Check };")();
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

const T0 = "GD-2610-1305, GD-2610-1311";
const job = (gdId, oldNo) => {
  const entry = { jobId: "J" + gdId, organizationId: "1", gdId: gdId, partPrefix: "P|" + gdId + "|", dbNow: "2026-10-25 05:00:00", jsAt: "0", attempts: 0, rowVersion: 5 };
  const num = [{ step_name: entry.partPrefix + "NUM|001", result_ref: JSON.stringify({ old_no: oldNo, new_no: oldNo + "-Cancelled",
    picking_headers: [{ id: "3446", before: T0, after: T0.replace(oldNo, oldNo + "-Cancelled") }], picking_rows: [], packing_headers: [], packing_items: [], packing_sources: [] }) }];
  return { entry, num };
};
// the header as X5 reads it, with the X rows its read returns: the siblings that will end Cancelled
const H = (text, sibs) => [{ k: "H", j: JSON.stringify({ id: "3446", delivery_no: text, is_deleted: 0 }) }]
  .concat((sibs || []).map((tok) => ({ k: "X", j: JSON.stringify({ id: "3446", tok: tok }) })));
const ok = (c) => !(c.jobRows && c.jobRows[0] && /RETRY|REVIEW/.test(String(c.jobRows[0].job_status) + String(c.result_code)));
// A and B both read T0, A writes and passes its check, then B writes the text from its own read and checks
const race = (aSibs, bSibs) => {
  const A = job("1305", "GD-2610-1305"), B = job("1311", "GD-2610-1311");
  let db = T0;
  const planA = quiet(() => X5.cancelX5Plan(A.entry, A.num, H(db, aSibs), []));
  const planB = quiet(() => X5.cancelX5Plan(B.entry, B.num, H(db, bSibs), []));
  db = planA.headerRows[0].delivery_no;
  const checkA = quiet(() => X5.cancelX5Check(A.entry, A.num, H(db), []));
  db = planB.headerRows[0].delivery_no;
  const checkB = quiet(() => X5.cancelX5Check(B.entry, B.num, H(db), []));
  return { db, passed: ok(checkA) && ok(checkB) };
};
// without sibling rows (a sibling still before its point of no return when read): the old loss, both checks pass
const r1 = race([], []);
console.log("no sibling rows:  header", JSON.stringify(r1.db), r1.passed && r1.db.indexOf("GD-2610-1305-Cancelled") < 0 ? "(the old loss: GD-2610-1305's rename dropped)" : "");
// with them (each read names the other cancel, past X2 / X3): whichever write lands last carries both renames
const r2 = race(["GD-2610-1311"], ["GD-2610-1305"]);
const good = r2.passed && r2.db === "GD-2610-1305-Cancelled, GD-2610-1311-Cancelled";
console.log((good ? "ok   " : "FAIL ") + "sibling rows: header " + JSON.stringify(r2.db) + " - no rename lost");
if (!good) process.exitCode = 1;
