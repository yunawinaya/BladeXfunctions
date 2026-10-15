// plan_live.js <sql dump.json> [...]: the whole PREPARE plan node (runtime + lifted bodies + adapter + chain + batchnum +
// plan, as the builder concatenates them) on the SQL rows run_prepare_sql.py read for a stored GR. A GR that is no longer
// Processing is treated as if this job had just locked it (gr_status Processing + a LOCK row of this key). Prints the
// route, the manifest counts, the part sizes and the time. Run with TZ=Asia/Kuala_Lumpur.
// env: PREV=Draft|Created (the job's previousStatus, default Draft), SHOW=1 (print the manifest parts)
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
const FILES = ["lift/runtime.js", "lift/lifted_prepare.js", "code/shared/batchnum.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js"];

// fakeClock: new Date() / Date.now() read the time set with sb.__setNow (a harness replays a recorded run at its time)
function planSandbox(fakeClock) {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date, console, process };
  if (fakeClock) {
    const RealDate = Date;
    let now = RealDate.now();
    const FakeDate = function (...a) {
      if (!(this instanceof FakeDate)) return new RealDate(now).toString();
      return a.length ? new RealDate(...a) : new RealDate(now);
    };
    FakeDate.now = () => now;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    FakeDate.prototype = RealDate.prototype;
    sb.Date = FakeDate;
    sb.__setNow = (t) => { now = t; };
  }
  vm.createContext(sb);
  vm.runInContext(FILES.map((f) => fs.readFileSync(path.join(D, f), "utf8")).join("\n") + "\nthis.grPlan = grPlan; this.grAdapt = grAdapt;", sb);
  return sb;
}
module.exports = { planSandbox };

if (require.main === module) {
  const sb = planSandbox();
  for (const f of process.argv.slice(2)) {
    const S = JSON.parse(fs.readFileSync(f, "utf8"));
    const vals = S._vals || {};
    const h = JSON.parse(S.hdr[0].j.replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
    const was = h.gr_status;
    S.hdr = [{ j: S.hdr[0].j.replace(/"gr_status": ?"[^"]*"/, '"gr_status": "Processing"') }];
    S.lock = [{ step_name: "LOCK|1", result_ref: "TEST-KEY" }];
    const prev = process.env.PREV || "Draft";
    // what SUBMIT hands a Created receipt: code_node_origReserved's map of its stored lines (skip hierarchy parents, q8 sums)
    const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
    const origReserved = {};
    if (prev === "Created") {
      for (const l of S.lines.map((x) => JSON.parse(x.j.replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"'))))) {
        if (l.is_split === "Yes" && l.parent_or_child === "Parent") continue;
        if (!l.po_line_item_id) continue;
        origReserved[l.po_line_item_id] = q8((origReserved[l.po_line_item_id] || 0) + parseFloat(l.received_qty || 0));
      }
    }
    const entry = { route: "GO", jobId: "2110999999999999999", tenantId: vals.tenantId, organizationId: vals.organizationId, plantId: String(h.plant_id), grId: vals.grId,
      idempotencyKey: "TEST-KEY", nonce: "abcd1234", previousStatus: prev, request: { v: 1, previousStatus: prev, answers: {}, origReserved: origReserved, grNo: h.gr_no } };
    const t0 = Date.now();
    sb.__args = { entry, S };
    const res = vm.runInContext("grPlan(__args.entry, __args.S, { now: Date.now(), debug: true, withMovements: false, allowWA: !!process.env.ALLOW_WA })", sb);
    const ms = Date.now() - t0;
    const man = res.payload ? JSON.parse(res.payload) : null;
    const partBytes = {};
    for (const r of res.partRows) partBytes[r.step_name.split("|")[2]] = (partBytes[r.step_name.split("|")[2]] || 0) + r.result_ref.length;
    console.log(`${path.basename(f)} (stored ${was}) -> ${res.route} ${res.code} ${res.message} | ${ms} ms | payload ${res.payload.length} B | parts ${JSON.stringify(partBytes)}`);
    if (man) console.log("   counts", JSON.stringify(man.counts));
    if (process.env.SHOW && res.parts) console.log(JSON.stringify(res.parts, null, 1).slice(0, Number(process.env.SHOW) > 1 ? Number(process.env.SHOW) : 6000));
  }
}
