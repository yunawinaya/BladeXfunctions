// Offline pre-flight of a SA_V2_SUBMIT request file, read-only and local: the BUILT Stock Adjustment/AsyncV2/SA_V2_SUBMIT.json run
// on package B's interpreter (lib/sim/engine.js) against B's in-memory DB (test/submit/sadb.js) seeded from a snap.py snapshot
// (or build_twins.py dry-state): items + UOM conversions, cost rows, bins, balances, the SA numbering rule. Shows whether the
// request passes every SUBMIT gate (QUEUED) and what SUBMIT itself would write (job, SA header + lines, lock row, parts) - so a
// shape mistake in a request costs nothing on dev. Stored documents (a COMPLETE's Draft, a REVIEW's Stock Count) are seeded
// from the snapshot's sa / sal / sc / scl rows when the request names them.
//   node scratchpad/sav2/live/preflight_submit.js <request.json> <snapshot.json> [<status_request.json>]
"use strict";
const fs = require("fs");
const path = require("path");
const SAV2 = path.resolve(__dirname, "..");
const { Engine } = require(path.join(SAV2, "lib", "sim", "engine.js"));
const { SADB, mocks } = require(path.join(SAV2, "test", "submit", "sadb.js"));

const [reqFile, snapFile, statusFile] = process.argv.slice(2);
if (!reqFile || !snapFile) {
  console.error("usage: node preflight_submit.js <request.json> <snapshot.json> [<status_request.json>]");
  process.exit(2);
}
const req = JSON.parse(fs.readFileSync(reqFile, "utf8"));
const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const s = (v) => (v === undefined || v === null ? "" : String(v));
const n = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const live = (rows) => (rows || []).filter((r) => Number(r.is_deleted || 0) === 0);

const db = new SADB();
const org = s(req.organization_id) || cfg.organization_id;
const plant = cfg.plant_id;
for (const it of snap.itemdef || []) {
  db.t.items.push({ id: s(it.id), material_code: it.material_code, material_name: it.material_code, serial_number_management: 0,
    material_costing_method: it.material_costing_method, stock_control: Number(it.stock_control), item_batch_management: Number(it.item_batch_management || 0),
    purchase_unit_price: n(it.purchase_unit_price),
    uomconv: (it.table_uom_conversion || []).map((c, i) => ({ id: "77" + i, alt_uom_id: s(c.alt_uom_id), base_uom_id: s(c.base_uom_id), alt_qty: n(c.alt_qty), base_qty: n(c.base_qty) })) });
}
for (const w of live(snap.wa)) db.t.wa.push({ material_id: s(w.material_id), batch_id: s(w.batch_id) || null, plant_id: s(w.plant_id), organization_id: s(w.organization_id) || org,
  wa_cost_price: n(w.wa_cost_price) });
for (const f of live(snap.fifo)) db.t.fifo.push({ material_id: s(f.material_id), batch_id: s(f.batch_id) || null, plant_id: s(f.plant_id), organization_id: s(f.organization_id) || org,
  fifo_cost_price: n(f.fifo_cost_price) });
const binNames = { [cfg.bins.b1]: "Test-Batch-S2", [cfg.bins.b2]: "Sealing Head Assembly" };
for (const [id, name] of Object.entries(binNames)) db.t.bins.push({ id, bin_location_combine: name, plant_id: plant });
db.t.uoms.push({ id: cfg.uom.PCS, uom_name: "PCS" }, { id: cfg.uom.BOX, uom_name: "BOX" });
const batchId = s((snap.meta || {}).batch_id) || s((snap.ibb || [])[0] && snap.ibb[0].batch_id);
if (batchId) db.t.batches.push({ id: batchId, batch_number: cfg.items.fifob.batch_number });
db.t.rules.push({ id: cfg.rules.sa, department_id: org, is_default: 1, is_draft: 0, rule_name: "SA 1" });
for (const b of live(snap.ib)) db.t.bal.push({ id: s(b.id), material_id: s(b.material_id), plant_id: s(b.plant_id), location_id: s(b.location_id),
  balance_quantity: n(b.balance_quantity), unrestricted_qty: n(b.unrestricted_qty), organization_id: s(b.organization_id) || org });
for (const b of live(snap.ibb)) db.t.bbal.push({ id: s(b.id), material_id: s(b.material_id), plant_id: s(b.plant_id), location_id: s(b.location_id), batch_id: s(b.batch_id),
  balance_quantity: n(b.balance_quantity), unrestricted_qty: n(b.unrestricted_qty), organization_id: s(b.organization_id) || org });
// stored documents the request names (a FORM COMPLETE's Draft, a REVIEW's Stock Count), as snap.py read them
const strip = (r) => { const o = {}; for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined) o[k] = typeof v === "number" && !Number.isSafeInteger(v) ? s(v) : v; return o; };
if (s(req.sa_id)) {
  for (const h of (snap.sa || []).filter((x) => s(x.id) === s(req.sa_id))) db.t.sa.push(Object.assign(strip(h), { id: s(h.id), is_deleted: 0 }));
  for (const l of live(snap.sal).filter((x) => s(x.stock_adjustment_id) === s(req.sa_id))) db.t.sal.push(Object.assign(strip(l), { id: s(l.id), stock_adjustment_id: s(l.stock_adjustment_id), is_deleted: 0 }));
}
if (s(req.sc_id)) {
  for (const h of (snap.sc || []).filter((x) => s(x.id) === s(req.sc_id))) db.t.sc.push(Object.assign(strip(h), { id: s(h.id), is_deleted: 0 }));
  for (const l of live(snap.scl).filter((x) => s(x.stock_count_id) === s(req.sc_id))) db.t.scl.push(Object.assign(strip(l), { id: s(l.id), stock_count_id: s(l.stock_count_id), is_deleted: 0 }));
}
const DIR = path.resolve(SAV2, "..", "..", "Stock Adjustment", "AsyncV2");
const eng = new Engine({ dir: DIR, db: db, mocks: mocks() });
const r = eng.run("SA_V2_SUBMIT", req);
const a = r.returned || {};
console.log(`${path.basename(reqFile)}: route ${a.route} code ${a.code} action ${a.action || "-"} job_status ${a.job_status || "-"} sa_no ${a.sa_no || "-"} line_count ${a.line_count || "-"}`
  + `${a.error_code ? " error_code " + a.error_code : ""}${a.message ? " | " + String(a.message).slice(0, 300) : ""}`);
console.log("  SUBMIT writes (in order): " + JSON.stringify(db.log.map((l) => l.replace(/[0-9]{12,}/g, "<id>"))));
const sa = db.t.sa.filter((x) => s(x.sa_v2_job_id)).slice(-1)[0];
if (sa) {
  const lines = db.t.sal.filter((l) => l.stock_adjustment_id === sa.id && !l.is_deleted).sort((x, y) => Number(x.line_index) - Number(y.line_index));
  console.log(`  SA ${sa.adjustment_no} ${sa.stock_adjustment_status} (${lines.length} lines): ` + lines.map((l) => `${l.line_index}:${s(l.material_id).slice(-4)} uom ..${s(l.uom_id).slice(-4)} `
    + `qty ${l.total_quantity} @ ${l.unit_price}`).join(", "));
  const job = db.t.job.slice(-1)[0];
  const p = JSON.parse(job.request_payload || "{}");
  console.log(`  job ${job.job_status} request_payload: action ${p.action} edited ${p.edited} entries ${p.entryCount} lines ${p.lineCount} prevStatus ${p.prevStatus} `
    + `parts ${JSON.stringify(p.parts)} issuedNo ${p.issuedNo}`);
}
if (statusFile) {
  const st = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  const rs = eng.run("SA_V2_SUBMIT", st).returned || {};
  console.log(`  STATUS (${path.basename(statusFile)}): route ${rs.route} job_status ${rs.job_status} sa_id ${rs.sa_id ? "<id>" : "-"} sa_no ${rs.sa_no || "-"} terminal ${rs.terminal}`);
}
process.exit(a.route === "QUEUED" ? 0 : 1);
