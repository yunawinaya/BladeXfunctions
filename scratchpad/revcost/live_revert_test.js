// live_revert_test.js: GD_PROCESS_REVERT v13 on dev 000000 (admin@000000). Completes the twin GDs again - GD/20261019/597
// through classic GOODS_DELIVERY, /598 through GD Completed V2 - then Revert Completed both, and checks every returned-stock
// movement (GDL-R) and the FIFO layer it creates against the cost per base unit its delivery (GDL OUT Reserved) went out at.
const fs = require("fs"), cp = require("child_process"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const HERE = __dirname;
const T = R + "scratchpad/gdc/test/";
const ID = R + "scratchpad/gdc/tools/id000000.json";
const WF = { GOODS_DELIVERY: "2017151544868491265", SUBMIT: "2110182609618337794", WORKER: "2110182645714518018", REVERT: "2058819647368241153" };
const X = JSON.parse(fs.readFileSync(process.env.TWIN_IDS || path.join(HERE, "..", "fc", "twin_ids.json"), "utf8"));
const sql = (q) => { const t = cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "1000", q], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); return JSON.parse(t.slice(t.indexOf("["))); };
let n = 0;
const call = (wf, req, label) => {
  const f = path.join(HERE, "lr_" + (++n));
  fs.writeFileSync(f + ".req.json", JSON.stringify(req));
  cp.execFileSync("node", [R + "scratchpad/gdc/tools/runas.mjs", ID, wf, f + ".req.json", f + ".out.json"], { stdio: ["ignore", "ignore", "inherit"] });
  const out = JSON.parse(fs.readFileSync(f + ".out.json", "utf8"));
  console.log("  " + label + ": " + JSON.stringify(out.data === undefined ? out : out.data).slice(0, 200));
  return out.data || {};
};
const allData = (gd, mode) => { const f = path.join(HERE, "ad_" + gd.no.replace(/\//g, "_") + "_" + mode + ".json"); cp.execFileSync("node", [T + "build_alldata.js", "000000", gd.id, f, mode], { stdio: ["ignore", "ignore", "inherit"] }); return JSON.parse(fs.readFileSync(f, "utf8")); };
const mvs = (no, type, since) => sql("SELECT CAST(id AS CHAR) id, movement mv, inventory_category cat, CAST(item_id AS CHAR) item, CAST(IFNULL(batch_number_id, 0) AS CHAR) b, CAST(bin_location_id AS CHAR) bin, " +
  "CAST(base_qty AS CHAR) q, CAST(unit_price AS CHAR) up, CAST(total_price AS CHAR) tp, DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') ct FROM inventory_movement WHERE organization_id = '1123598813738675201' AND trx_no = '" + no +
  "' AND transaction_type = '" + type + "' AND is_deleted = 0 AND id > " + since + " ORDER BY id");
const since = ((BigInt(Date.parse("2026-10-20T02:00:00Z")) - 1288834974657n) << 22n).toString(); // snowflake of 10:00 MYT today (MAX(id) has outliers)
const A = X.GD.A, B = X.GD.B;

// 1. complete both again: A classic, B V2
const status = (g) => sql("SELECT gd_status FROM goods_delivery WHERE id = " + g.id)[0].gd_status;
if (status(A) !== "Completed") {
const reqA = allData(A, "Completed");
reqA.auto_si_skip = "true";
const ra = call(WF.GOODS_DELIVERY, reqA, "classic GOODS_DELIVERY " + A.no);
assert.strictEqual(String(ra.code), "200", "classic complete: " + JSON.stringify(ra).slice(0, 300));
}
if (status(B) !== "Completed") {
const rb = call(WF.SUBMIT, { operation: "SUBMIT", gd_id: B.id, source: "LIST", answers: { needCL: "required", continueZero: "", isForceComplete: "", auto_si_confirmed: "", auto_si_skip: "true" } }, "V2 SUBMIT " + B.no);
assert.strictEqual(rb.route, "QUEUED", JSON.stringify(rb));
let j;
for (let i = 0; i < 10; i++) {
  call(WF.WORKER, {}, "V2 WORKER");
  j = sql("SELECT job_status, error_code FROM gd_async_job WHERE id = " + rb.job_id)[0];
  if (["COMPLETED", "FAILED", "REQUIRES_REVIEW"].indexOf(j.job_status) >= 0) break;
}
assert.strictEqual(j.job_status, "COMPLETED", JSON.stringify(j));
}
const outs = {};
for (const g of [A, B]) {
  outs[g.no] = mvs(g.no, "GDL", since).filter((m) => m.mv === "OUT" && m.cat === "Reserved");
  assert.ok(outs[g.no].length > 0, "no delivery OUT for " + g.no);
  console.log("  " + g.no + " delivered:", outs[g.no].map((m) => m.q + " @ " + (Number(m.tp) / Number(m.q)).toFixed(4)).join(", "));
}

// 2. revert both with v13
for (const g of [A, B]) {
  const r = call(WF.REVERT, allData(g, "REVERT"), "Revert Completed " + g.no);
  assert.strictEqual(String(r.code), "200", "revert " + g.no + ": " + JSON.stringify(r).slice(0, 300));
}

// 3. every returned movement + its new FIFO layer at the delivery's own cost per base unit
let checked = 0;
for (const g of [A, B]) {
  const back = mvs(g.no, "GDL-R", since);
  assert.ok(back.length > 0, "no GDL-R for " + g.no);
  for (const m of back) {
    const o = outs[g.no].filter((x) => x.item === m.item && x.b === m.b && x.bin === m.bin);
    const want = o.reduce((s, x) => s + Number(x.tp), 0) / o.reduce((s, x) => s + Number(x.q), 0);
    const layer = sql("SELECT CAST(fifo_cost_price AS CHAR) c, CAST(fifo_initial_quantity AS CHAR) iq, fifo_sequence seq FROM fifo_costing_history WHERE material_id = " + m.item +
      " AND IFNULL(batch_id, 0) = " + m.b + " AND is_deleted = 0 AND create_time BETWEEN '" + m.ct + "' - INTERVAL 15 SECOND AND '" + m.ct + "' + INTERVAL 15 SECOND ORDER BY id DESC LIMIT 1")[0];
    console.log("  " + g.no + " returned " + m.q + " @ " + Number(m.up).toFixed(4) + " (delivered @ " + want.toFixed(4) + ") | FIFO layer seq " + (layer && layer.seq) + " @ " + (layer && Number(layer.c).toFixed(4)));
    assert.ok(Math.abs(Number(m.up) - want) < 1e-6, "movement unit_price");
    assert.ok(Math.abs(Number(m.tp) - want * Number(m.q)) < 1e-6, "movement total_price");
    assert.ok(layer && Math.abs(Number(layer.c) - want) < 1e-6, "FIFO layer cost");
    assert.ok(want > 0, "the delivery had a real cost");
    checked++;
  }
}
console.log("ok " + checked + " returned movement(s): movement and FIFO layer carry the delivery cost, not 0");
fs.writeFileSync(path.join(HERE, "live_since.txt"), since);
