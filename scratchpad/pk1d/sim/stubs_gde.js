// Picking 1d simulator: a mini GD Edit V2 for the force complete's deliveries. GD_EDIT_SUBMIT (as PICKING_FC_DRIVE calls it:
// SUBMIT by fcd_ref, RELEASE, CANCEL_HELD) and GD_EDIT_WORKER {job_id} (as the screen kicks it: PREPARE -> HELD, an ended hold ->
// CANCELLED, a released job -> COMMIT). COMMIT applies the planned parts to the sim's tables: E0 the base fingerprints, E1 the
// unpicked quantity's reservation back to Unrestricted (once per GDE|<job>: a re-run is REPLAYED), E2 the lines shrunk / removed,
// E3 the GD reservations cut, E6 the header. The real GD Edit V2 is proven by its own suites; this one carries the contract.
// faults: submitStop{gdId: {code, message}}, prepareFail{gdId: code}, engineRefuse{gdId: n}, crashAfterE1{gdId: n}
const path = require("path");
const { fcLineFingerprint } = require(path.join(__dirname, "../code/fc_fp.js"));

const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD", "HELD"];
const HOLD_MS = 1800 * 1000, LEASE_MS = 1800 * 1000;
const req = (j) => { try { return JSON.parse(j.request_payload || "{}") || {}; } catch (e) { return {}; } };
const q8 = (v) => Math.round(Number(v) * 1e8) / 1e8;

function miniGde(db, opts) {
  const o = Object.assign({ submitStop: {}, prepareFail: {}, engineRefuse: {}, crashAfterE1: {} }, opts || {});
  const log = { submit: [], worker: [], commits: [], e1: {}, hooks: {} };
  const gd = (id) => db.t.gd.find((g) => g.id === String(id)) || null;
  const open = (gdId) => db.t.job.filter((j) => j.command === "EDIT_GD" && !j.is_deleted && req(j).gd_id === gdId && OPEN.includes(j.job_status));
  const ans = (route, code, message, extra) => Object.assign({ route, code: String(code), message: message || "", reason: "", command: "EDIT_GD", job_id: "", job_status: "", gd_id: "",
    gd_no: "", line_count: "0", progress_percent: "0", progress_message: "", error_code: "", error_message: "", picking_reversal_note: "", credit_limit_note: "", cascade_ref: "", evidence: "" }, extra || {});
  const parts = (jobId, fcdRef) => {
    const [, nonce, gi] = String(fcdRef).split("|");
    const pre = "FCD|" + nonce + "|" + gi + "|";
    const rows = db.t.step.filter((s) => s.job_id === String(jobId) && !s.is_deleted && String(s.step_name).indexOf(pre) === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1));
    try { return rows.length ? JSON.parse(rows.map((r) => r.result_ref).join("")) : null; } catch (e) { return null; }
  };
  const lines = (gdId) => db.t.gdl.filter((l) => l.goods_delivery_id === gdId && !l.is_deleted);
  const stale = (gdId, d) => {
    const byId = {};
    for (const l of lines(gdId)) byId[l.id] = l;
    for (const id of Object.keys(d.base)) {
      if (!byId[id]) return "line " + id + " is no longer on the delivery";
      const now = fcLineFingerprint(byId[id]), was = d.base[id];
      if (["gd_qty", "base_qty", "temp_qty_data", "picking_status"].some((k) => String(now[k]) !== String(was[k]))) return "line " + id + " changed since the force complete was planned";
    }
    return "";
  };
  const finish = (j, status, extra) => {
    Object.assign(j, { job_status: status, lease_owner: null, lease_expires_at: null, next_attempt_at: null, finished_at: db.now }, extra || {});
    const g = gd(req(j).gd_id);
    if (g) g.gd_status = req(j).stored_status || "Created";
    return status;
  };

  const submit = (p) => {
    log.submit.push(Object.assign({}, p));
    if (log.hooks.submit) log.hooks.submit(p);
    const op = String(p.operation || "SUBMIT"), gdId = String(p.gd_id);
    if (op === "SUBMIT") {
      if (String(p.source) !== "PICKING_FC" || String(p.cascade_ref) !== "PKFC|" + p.causation_job_id) return ans("REJECT", "400", "refs");
      if (o.submitStop[gdId]) return ans("STOP", o.submitStop[gdId].code || "409", o.submitStop[gdId].message);
      const mine = open(gdId)[0];
      if (mine) return ans("BUSY", "409", "Its edit is being saved - please wait for it to finish.", { job_id: mine.id, job_status: mine.job_status, cascade_ref: req(mine).cascade_ref });
      const g = gd(gdId);
      if (!g || (g.gd_status !== "Created" && g.gd_status !== "Draft")) return ans("STOP", "400", "Goods Delivery is " + (g ? g.gd_status : "missing"));
      const d = parts(p.causation_job_id, p.fcd_ref);
      if (!d || !d.cells || !Array.isArray(d.removed) || !d.base) return ans("STOP", "400", "the force complete's planned changes could not be read");
      const why = stale(gdId, d);
      if (why) return ans("STOP", "409", "GDE_FC_STALE: " + why);
      const n = db.t.job.filter((j) => j.command === "EDIT_GD" && req(j).gd_id === gdId).length + 1;
      const j = { id: db.id(), command: "EDIT_GD", organization_id: g.organization_id, idempotency_key: "GDE|" + gdId + "|" + n, job_status: "QUEUED", progress_percent: 0, attempt_count: 0,
        row_version: 0, next_attempt_at: db.now, lease_owner: null, lease_expires_at: null, causation_id: "PICKING_FC", correlation_id: "GD|" + gdId, queued_at: db.now, finished_at: null,
        error_code: null, error_message: null, is_deleted: 0, create_time: db.now,
        request_payload: JSON.stringify({ v: 1, gd_id: gdId, source: "PICKING_FC", stored_status: g.gd_status, hold: 1, cascade_ref: p.cascade_ref, causation_job_id: String(p.causation_job_id),
          fcd_ref: p.fcd_ref }) };
      db.t.job.push(j);
      g.gd_status = "Processing";
      return ans("QUEUED", "200", "Queued for processing", { job_id: j.id, job_status: "QUEUED", gd_id: gdId });
    }
    const held = open(gdId).filter((j) => j.job_status === "HELD" && req(j).cascade_ref === String(p.cascade_ref))[0];
    if (!held) return ans("NONE", "200", "nothing is held on this delivery for " + p.cascade_ref);
    if (op === "RELEASE") {
      Object.assign(held, { job_status: "READY_TO_COMMIT", next_attempt_at: db.now, row_version: held.row_version + 1, released: 1 });
      return ans("RELEASED", "200", "released", { job_id: held.id, job_status: "READY_TO_COMMIT" });
    }
    if (op === "CANCEL_HELD") {
      Object.assign(held, { next_attempt_at: db.now, row_version: held.row_version + 1, cancel_requested: 1 });
      return ans("CANCELLING", "200", "the hold ended: run GD_EDIT_WORKER on the job", { job_id: held.id, job_status: "HELD" });
    }
    return ans("REJECT", "400", "operation");
  };

  // E1-E6 on the sim's tables; the engine operation GDE|<job> runs once (a re-run after a crash finds it DONE: REPLAYED)
  const commit = (j) => {
    const r = req(j), gdId = r.gd_id;
    const d = parts(r.causation_job_id, r.fcd_ref);
    const why = d ? stale(gdId, d) : "the planned changes could not be read";
    if (why) return finish(j, "FAILED", { error_code: "GDE_STALE", error_message: why });
    if (o.engineRefuse[gdId] > 0) { o.engineRefuse[gdId]--; return finish(j, "FAILED", { error_code: "GDE_E1_REFUSED", error_message: "INVENTORY_BULK_APPLY refused: insufficient stock" }); }
    const key = "GDE|" + j.id;
    const byId = {};
    for (const l of lines(gdId)) byId[l.id] = l;
    const sum = (arr) => (arr || []).reduce((m, x) => Object.assign(m, { [String(x.location_id) + "|" + (x.batch_id ? String(x.batch_id) : "")]: q8((m[String(x.location_id) + "|" + (x.batch_id ? String(x.batch_id) : "")] || 0) + Number(x.gd_quantity)) }), {});
    const arr = (v) => (Array.isArray(v) ? v : JSON.parse(v || "[]"));
    const freed = [];
    for (const id of Object.keys(d.cells).concat(d.removed)) {
      const l = byId[id];
      const before = sum(arr(l.temp_qty_data)), after = d.removed.includes(id) ? {} : sum(arr(d.cells[id].temp_qty_data === undefined ? l.temp_qty_data : d.cells[id].temp_qty_data));
      for (const k of Object.keys(before)) if (q8(before[k] - (after[k] || 0)) > 0) freed.push([l, k, q8(before[k] - (after[k] || 0))]);
    }
    if (!log.e1[key]) {
      for (const [l, k, qty] of freed) {
        const [loc, bat] = k.split("|");
        const b = (db.t.bal || {})[String(l.material_id) + "|" + loc + "|" + bat];
        if (b) { b.Reserved = q8(b.Reserved - qty); b.Unrestricted = q8(b.Unrestricted + qty); }
      }
      log.e1[key] = "DONE";
      if (o.crashAfterE1[gdId] > 0) {
        o.crashAfterE1[gdId]--;
        Object.assign(j, { job_status: "COMMITTING_GD", lease_owner: "WRK|crashed", lease_expires_at: db.now + LEASE_MS });
        return "CRASH";
      }
    } else log.e1[key + "|replayed"] = (log.e1[key + "|replayed"] || 0) + 1;
    for (const [l, k, qty] of freed) {
      const [loc, bat] = k.split("|");
      let left = qty;
      for (const res of db.t.res.filter((x) => !x.is_deleted && x.status === "Allocated" && x.doc_line_id === l.id && String(x.bin_location) === loc && String(x.batch_id || "") === bat)) {
        const cut = Math.min(left, Number(res.open_qty));
        res.open_qty = q8(Number(res.open_qty) - cut);
        res.reserved_qty = q8(Number(res.reserved_qty) - cut);
        if (res.open_qty <= 0) res.status = "Cancelled";
        left = q8(left - cut);
      }
    }
    for (const id of Object.keys(d.cells)) Object.assign(byId[id], d.cells[id]);
    for (const id of d.removed) byId[id].is_deleted = 1;
    const live = lines(gdId).filter((l) => l.material_id && Number(l.gd_qty) > 0);
    const g = gd(gdId);
    if (live.length && live.every((l) => l.picking_status === "Completed")) g.picking_status = "Completed";
    log.commits.push(gdId);
    return finish(j, "COMPLETED", { progress_percent: 100 });
  };

  const worker = (jobId) => {
    log.worker.push(String(jobId));
    const j = db.t.job.find((x) => x.id === String(jobId) && x.command === "EDIT_GD");
    if (!j || (j.next_attempt_at && j.next_attempt_at > db.now) || (j.lease_expires_at && j.lease_expires_at > db.now)) return "SKIP";
    const r = req(j);
    const fc = db.t.job.find((x) => x.id === r.causation_job_id) || {};
    const fcOpen = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING"].includes(fc.job_status);
    if (j.job_status === "QUEUED" || j.job_status === "VALIDATING") {
      if (o.prepareFail[r.gd_id]) return finish(j, "FAILED", { error_code: o.prepareFail[r.gd_id], error_message: "refused: " + o.prepareFail[r.gd_id] });
      Object.assign(j, { job_status: "HELD", next_attempt_at: db.now + HOLD_MS });
      return "HELD";
    }
    if (j.job_status === "HELD") return finish(j, "CANCELLED", { error_code: !fcOpen ? "GDE_HOLD_ORPHANED" : j.cancel_requested ? null : "GDE_HOLD_EXPIRED" });
    if (j.job_status === "READY_TO_COMMIT" || j.job_status === "COMMITTING_GD") return commit(j);
    return "SKIP";
  };
  return { submit, worker, log, opts: o };
}

module.exports = { miniGde };
