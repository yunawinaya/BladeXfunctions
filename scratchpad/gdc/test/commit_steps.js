// commit_steps.js <payload.json> <reads.json>: COMMIT's C3 / C4 / C5 plan functions on a PREPARE payload (test/plan_live.js)
// and live dev reads (test/commit_reads.py) - what each step would write, nothing written
const fs = require("fs"), vm = require("vm");
const D = __dirname + "/../";
const [payloadFile, readsFile] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
const R = JSON.parse(fs.readFileSync(readsFile, "utf8"));
const body = (f) => {
  const t = fs.readFileSync(D + "code/commit/" + f, "utf8");
  const i = t.lastIndexOf("\nconst res = ");
  return i < 0 ? t : t.slice(0, i);
};
const src = [fs.readFileSync(D + "code/commit/_common.js", "utf8"), fs.readFileSync(D + "code/commit/_cmp.js", "utf8"), fs.readFileSync(D + "lift/runtime.js", "utf8"),
  fs.readFileSync(D + "lift/lifted_commit.js", "utf8"), fs.readFileSync(D + "code/prepare/adapter.js", "utf8"), fs.readFileSync(D + "engine/core.js", "utf8").match(/^function roundDec\(.*?^}\n/ms)[0],
  fs.readFileSync(D + "code/commit/_hu.js", "utf8"), body("c0.js"), body("c3_plan.js"), body("c3h_plan.js"), body("c4_plan.js"), body("c5_plan.js")].join("\n")
  .replace(/\nconst (RES_COLS|SO_LINE_COLS|SO_HDR_COLS|CREATE_COLS) = /g, "\nvar $1 = ");
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(src + "\nthis.commitC0 = commitC0; this.commitC3Plan = commitC3Plan; this.commitC3HPlan = commitC3HPlan; this.commitC4Plan = commitC4Plan; this.commitC5Plan = commitC5Plan;", sb);
const m = P.manifest;
const entry = { jobId: m.job_id, organizationId: m.organization_id, gdId: m.gd_id, gdNo: m.gd_no, partPrefix: "P|" + m.nonce + "|", dbNow: "2026-10-13 20:00:00",
  attempts: 0, rowVersion: 1, unlockOk: "NO", leaseUntil: "2026-10-13 20:10:00" };
const show = (o) => JSON.stringify(o).slice(0, 700);
const c0 = sb.commitC0(Object.assign({}, entry, { unlockOk: "YES" }), P.rows, R.c0rows, P.rows, R.c0hus, R.c0huitems);
console.log("C0:", c0.route, c0.result_code, c0.result_message);
const c3 = sb.commitC3Plan(entry, P.rows, R.c3rows);
console.log("C3:", c3.route, c3.result_code, c3.result_message, "| slices", c3.slices.length, "| first write", show(c3.slices[0] && c3.slices[0].rows[0]));
const c3h = sb.commitC3HPlan(entry, P.rows, [], R.c3hhus, R.c3hitems, R.c3hprec);
console.log("C3H:", c3h.route, c3h.result_code, c3h.result_message, "| intent rows", c3h.intentRows.length);
if (c3h.intentRows.length) {
  const hi = JSON.parse(c3h.intentRows.map((r) => r.result_ref).join(""));
  console.log("  hus:", show(hi.hus));
  console.log("  items:", show(hi.items));
  if (process.env.HU_OUT) fs.writeFileSync(process.env.HU_OUT, JSON.stringify(hi));
}
const c4 = sb.commitC4Plan(entry, P.rows, [], R.c4lines, R.c4hdrs);
console.log("C4:", c4.route, c4.result_code, c4.result_message, "| intent rows", c4.intentRows.length);
const intent = c4.intentRows.length ? JSON.parse(c4.intentRows.map((r) => r.result_ref).join("")) : null;
if (intent) {
  console.log("  first SO line:", show(intent.lines[0]));
  console.log("  headers:", show(intent.headers));
}
const c5 = sb.commitC5Plan(entry, P.rows, R.c5raw);
console.log("C5:", c5.route, c5.result_code, c5.result_message, "| header", show(c5.headerRows[0]), "| so rows", c5.soRows.length);
console.log("  first line row:", show(c5.lineSlices[0] && c5.lineSlices[0].rows[0]));
