// plan_live.js <reads.json> <tenant> [scenario...]: gePlan on live dev reads (test/run_sql.py), the GD locked by a simulated
// job (Processing + the latest LOCK row ours). Read-only: nothing is written anywhere. Scenarios build the edit's delta
// from the stored GD the way the form would change it: NOOP, HEADER (order_remark), QTY (first allocated line - 1),
// REMOVE (first material line dropped). Prints route, plan counts, payload size and run time.
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const [dump, tenant, ...scenarios] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(dump, "utf8"));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/plan_edit.js", D + "/code/commit/so_edit.js",
  D + "/code/prepare/adapter_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(SRC + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";", sb);
const clone = (o) => JSON.parse(JSON.stringify(o));
for (const sc of scenarios.length ? scenarios : ["NOOP", "HEADER", "QTY", "RAISE", "ZERO", "REMOVE"]) {
  sb.__S = S;
  const Rd = vm.runInContext("geAdapt(__S)", sb);
  const stored = Rd.stored;
  if (!stored) { console.log("GD not found"); process.exit(1); }
  // the form: the stored GD (Created) with the scenario's change
  const form = clone(stored);
  form.gd_status = stored.gd_status === "Processing" ? "Created" : stored.gd_status;
  const flatLines = (form.table_gd || []).flatMap((r) => [r].concat(r.children || []));
  const parse = (t) => (Array.isArray(t) ? t : (() => { try { return JSON.parse(t || "[]"); } catch (e) { return []; } })());
  let note = "";
  if (sc === "HEADER") { form.order_remark = (form.order_remark || "") + " (edited)"; note = "order_remark"; }
  if (sc === "QTY" || sc === "RAISE" || sc === "ZERO") {
    // a stock line with an allocation; QTY takes 1 off its last allocation row, RAISE adds 1 there (within the order), ZERO sets 0
    const cand = flatLines.filter((x) => x.material_id && parse(x.temp_qty_data).length >= 1);
    const l = sc === "QTY" ? cand.find((x) => Number(x.gd_qty) >= 2) : sc === "RAISE" ? cand.find((x) => Number(x.gd_order_quantity) > Number(x.gd_qty)) : cand[0];
    if (!l) { console.log(sc.padEnd(6) + " no line fits"); continue; }
    const t = parse(l.temp_qty_data);
    const was = Number(l.gd_qty);
    const now = sc === "QTY" ? was - 1 : sc === "RAISE" ? was + 1 : 0;
    const last = t[t.length - 1];
    last.gd_quantity = sc === "ZERO" ? 0 : Number(last.gd_quantity) + (now - was);
    if (sc === "ZERO") for (const e of t) e.gd_quantity = 0;
    l.temp_qty_data = JSON.stringify(t);
    l.gd_qty = now;
    note = "line " + l.id + " gd_qty " + was + " -> " + now;
  }
  if (sc === "REMOVE") {
    // a plain line, else a whole bundle (its row with its children)
    let i = form.table_gd.findIndex((x) => x.material_id && !(x.children || []).length);
    if (i < 0) i = form.table_gd.length - 1;
    note = "removed line " + form.table_gd[i].id + ((form.table_gd[i].children || []).length ? " (bundle of " + form.table_gd[i].children.length + ")" : "");
    form.table_gd.splice(i, 1);
  }
  sb.__F = form; sb.__ST = Object.assign(clone(stored), { gd_status: form.gd_status });
  const delta = vm.runInContext("geDelta(__F, __ST, GE_KINDS)", sb);
  // the job holds the lock: Processing, latest LOCK row = its key
  const key = "GDE|" + stored.id + "|1";
  const S2 = Object.assign({}, S, { hdr: S.hdr.map((r) => ({ j: r.j.replace(/"gd_status": "[^"]*"/, '"gd_status": "Processing"') })), lock: [{ step_name: "LOCK|1", result_ref: key }] });
  sb.__S2 = S2;
  sb.__E = { jobId: "2110999999999999999", tenantId: tenant, nonce: "a1b2c3d4", idempotencyKey: key, gdId: String(stored.id), organizationId: String(stored.organization_id),
    request: { v: 1, source: "FORM", stored_status: form.gd_status, submitted_by: "1", picking_version: "", answers: { needCL: "required", continueZero: "", confirmPickReversal: "" }, delta } };
  const t0 = Date.now();
  const res = vm.runInContext("gePlan(__E, geAdapt(__S2), GE_KINDS)", sb);
  const ms = Date.now() - t0;
  const p = res.parts || {};
  const size = (res.partRows || []).reduce((k, r) => k + r.result_ref.length, 0);
  console.log(`${sc.padEnd(6)} ${note.padEnd(48)} route=${res.route} ${res.code} ${res.message.slice(0, 70)}`);
  if (res.route === "ENGINE") {
    console.log(`       delta ${JSON.stringify(delta).length} chars; movements ${res.movementCount}; res upd ${p.RES.updates.length} cre ${p.RES.creates.length}; lines ins ${p.GDL.inserts.length} patch ${p.GDL.patches.length} del ${p.GDL.deletes.length}; header cells ${Object.keys(p.GDH.cells).join(",") || "-"}; pick ${p.PICK.mode}; payload ${(size / 1e6).toFixed(2)} MB in ${res.partRows.length} rows; ${ms} ms`);
    const cols = {};
    for (const x of p.GDL.patches) for (const c of Object.keys(x.cells)) cols[c] = (cols[c] || 0) + 1;
    if (Object.keys(cols).length) console.log("       patched line columns: " + JSON.stringify(cols));
  }
}
