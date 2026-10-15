// Harness (d): a synthetic 2,000-row confirmation on a real dev TO through the whole plan (pwPlan: SQL rows -> adapter ->
// rebuild -> lifted chain -> manifest + parts): time, manifest and node-data size, and the plan's own invariants.
// usage: TZ=Asia/Kuala_Lumpur node synthetic_2k.js <sqldir>/dev_<to_id>.json [lines=2000] [rows=2000]
// The TO's real rows (run_prepare_sql.py) are the template: its lines are repeated (new ids, line numbers, batches) to
// `lines` lines, each with an open in-transit row at its source bin and a source batch balance; the request puts away
// `rows` rows: whole lines, then 25 lines split in two. Output: the measurements only (no customer data).
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const [file, nLinesArg, nRowsArg] = process.argv.slice(2);
const N_LINES = Number(nLinesArg || 2000);
const N_ROWS = Number(nRowsArg || 2000);
const SPLIT_LINES = 25;
const sb = (() => {
  const c = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(c);
  for (const f of ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js"]) vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), c, { filename: f });
  vm.runInContext("this.pwPlan = pwPlan; this.pwParse = pwParse; this.pwGates = pwGates;", c);
  return c;
})();
const S0 = JSON.parse(fs.readFileSync(file, "utf8"));
const P = (r) => sb.pwParse(r.j);
const J = (o) => ({ j: JSON.stringify(o) });
const big = (base, n) => (BigInt(base) + BigInt(n)).toString();

const hdr = P(S0.hdr[0]);
hdr.is_processing = 1;
const tplLines = S0.lines.map(P);
const tplTransit = S0.transit.map(P);
const tplBbal = S0.bbal.map(P);
const lines = [];
const transit = [];
const bbal = [];
for (let i = 0; i < N_LINES; i++) {
  const t = tplLines[i % tplLines.length];
  const id = big("2290000000000000000", i + 1);
  const batch = t.batch_no ? big("2291000000000000000", i + 1) : null;
  const pending = 10;
  lines.push(Object.assign({}, t, { id: id, line_index: String(i + 1), parent_index: i, batch_no: batch, received_qty: pending, qty_to_putaway: pending,
    pending_process_qty: pending, putaway_qty: 0, line_status: "Open", gr_line_id: big("2292000000000000000", i + 1) }));
  const it = tplTransit[i % tplTransit.length];
  transit.push(Object.assign({}, it, { id: big("2293000000000000000", i + 1), material_id: t.item_code, batch_id: batch, transit_bin: t.source_bin, doc_line_id: big("2292000000000000000", i + 1),
    line_no: i + 1, transit_qty: pending, received_qty: 0, open_qty: pending, status: "In Transit" }));
  if (batch) bbal.push({ id: big("2294000000000000000", i + 1), material_id: t.item_code, location_id: t.source_bin, batch_id: batch, plant_id: hdr.plant_id,
    organization_id: hdr.organization_id, manufacturing_date: i % 3 ? "2026-09-0" + (1 + (i % 9)) + " 00:00:00" : null, expired_date: i % 5 ? null : "2027-01-31 00:00:00" });
}
const S = Object.assign({}, S0, {
  hdr: [J(hdr)], lines: lines.map(J), transit: transit.map((o) => J(o)), bbal: bbal.map(J),
  lock: [{ step_name: "LOCK|1", result_ref: "KEY-SYNTH" }],
});
// the request: whole lines first, then SPLIT_LINES lines split in two, up to N_ROWS rows
const bin = lines[0].target_location || lines[0].source_bin;
const req = [];
const whole = N_ROWS - SPLIT_LINES * 2;
for (let i = 0; i < whole && i < N_LINES; i++) req.push({ id: lines[i].id, qty: 10, target_location: String(bin), storage_location: String(lines[i].storage_location || ""), target_inv_category: "Unrestricted", remark: "" });
for (let i = whole; i < whole + SPLIT_LINES && i < N_LINES; i++) {
  req.push({ parent_id: lines[i].id, qty: 4, target_location: String(bin), storage_location: String(lines[i].storage_location || ""), target_inv_category: "Unrestricted", remark: "split a" });
  req.push({ parent_id: lines[i].id, qty: 6, target_location: String(bin), storage_location: String(lines[i].storage_location || ""), target_inv_category: "Unrestricted", remark: "split b" });
}
const entry = { route: "GO", jobId: "2295000000000000001", tenantId: hdr.tenant_id, toId: String(hdr.id), grId: String(hdr.gr_no), organizationId: String(hdr.organization_id),
  idempotencyKey: "KEY-SYNTH", nonce: "Ab12Cd34", request: { v: 1, source: "FORM", uid: "1", toId: String(hdr.id), grId: String(hdr.gr_no), confirmedBy: "Synthetic", lines: req } };

const size = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
const MB = (n) => (n / 1048576).toFixed(2) + " MB";
const times = [];
let res;
for (let k = 0; k < 3; k++) {
  const t0 = process.hrtime.bigint();
  res = sb.pwPlan(entry, S);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
if (res.route !== "READY") {
  console.log("plan:", res.route, res.code, res.message);
  process.exit(1);
}
const parts = res.__parts;
const manifest = JSON.parse(res.payload);
// invariants: every row moves once out of its source and once into its bin, every confirmed line is patched, one record
// per row, one ledger row closed per row (each line has its own open row)
const mv = parts.ENGINE.movements;
const checks = {
  rows: req.length,
  movements: mv.length,
  pairs_ok: mv.every((m, i) => (i % 2 === 0 ? m.direction === "SUBTRACT" && m.movement_key === "M" + (i / 2 + 1) : m.direction === "ADD" && m.movement_key === "M" + ((i - 1) / 2 + 1) + ".2")),
  add_dates_from_source: mv.filter((m) => m.direction === "ADD").every((m, i) => {
    const b = bbal.find((x) => x.batch_id === m.batch_id);
    return m.manufacturing_date === (b && b.manufacturing_date ? b.manufacturing_date : "") && m.expired_date === (b && b.expired_date ? b.expired_date : "");
  }),
  same_price_both: mv.every((m, i) => i % 2 === 1 || m.unit_price === mv[i + 1].unit_price),
  line_patches: parts.TO.lines.length,
  records: parts.TO.records.length,
  record_keys_unique: new Set(parts.TO.records.map((r) => r.job_line_key)).size === parts.TO.records.length,
  it_updates: parts.IT.updates.length,
  it_creates: parts.IT.creates.length,
  to_status: parts.TO.to_status,
  gr: parts.GR.putaway_status + " / " + parts.GR.gr_status,
};
const partSizes = {};
for (const r of res.partRows) partSizes[r.step_name.split("|")[2]] = (partSizes[r.step_name.split("|")[2]] || 0) + r.result_ref.length;
const sqlBytes = {};
for (const k of ["hdr", "lines", "records", "gr", "items", "transit", "others", "qi", "setup", "bbal", "lock"]) sqlBytes[k] = size(S[k] || []);
const sqlTotal = Object.values(sqlBytes).reduce((a, b) => a + b, 0);
const codeBytes = ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js", "code/prepare/plan_tail.js"]
  .reduce((a, f) => a + fs.statSync(path.join(D, f)).size, 0);
const planOut = size({ route: res.route, code: res.code, message: res.message, payload: res.payload, partRows: res.partRows, lineCount: res.lineCount, movementCount: res.movementCount, toId: res.toId, unlockOk: res.unlockOk });
const entryBytes = size(entry);
console.log(JSON.stringify({
  lines: N_LINES, rows: req.length, plan_ms: times.map((t) => Math.round(t)),
  checks: checks,
  manifest_header_bytes: size(res.payload), part_rows: res.partRows.length, part_chars: partSizes, parts_total: MB(Object.values(partSizes).reduce((a, b) => a + b, 0)),
  node_data_estimate: {
    sql_node_outputs: MB(sqlTotal), sql_by_key: Object.fromEntries(Object.entries(sqlBytes).map(([k, v]) => [k, MB(v)])),
    plan_node_input: MB(codeBytes + sqlTotal + entryBytes) + " (code " + MB(codeBytes) + " + SQL rows + entry " + MB(entryBytes) + ")",
    plan_node_output: MB(planOut),
    parts_add_node_input: MB(size(res.partRows)),
    prepare_total: MB(sqlTotal + codeBytes + sqlTotal + entryBytes + planOut + size(res.partRows)),
  },
  request_payload_bytes: MB(size(entry.request)),
}, null, 1));
// SUBMIT's gates on the same TO (the stored lines + the request)
const t1 = process.hrtime.bigint();
const hdrSubmit = Object.assign({}, S.hdr[0], { lock_age_sec: 5, gr_status: "Received" });
const g = sb.pwGates({ request: entry.request, S: { hdr: [Object.assign({}, hdrSubmit, { j: JSON.stringify(Object.assign({}, hdr, { is_processing: 0 })) })], lines: S.lines, items: S.items, cost: [] },
  tenantId: hdr.tenant_id, confirmedBy: "Synthetic" });
console.log(JSON.stringify({ submit_gates: { route: g.route, code: g.code, message: g.message.slice(0, 120), rowCount: g.rowCount, lineCount: g.lineCount, ms: Math.round(Number(process.hrtime.bigint() - t1) / 1e6),
  submit_sql_bytes: MB(size(S.lines) + size(S.items) + size(S.hdr)) } }));
