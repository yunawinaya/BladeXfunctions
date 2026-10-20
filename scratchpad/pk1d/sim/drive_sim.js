// Picking 1d simulator support for PICKING_FC_DRIVE (Task 11; Task 15 builds on it): a force-complete fixture on the 1c sim's
// DB, the SQL stand-ins of DRIVE's reads (computed from the tables, the columns its SELECTs return), and a GD Edit V2 stand-in:
// GD_EDIT_SUBMIT's SUBMIT / RELEASE / CANCEL_HELD as DRIVE calls it, and GD_EDIT_WORKER as the screen kicks it (never DRIVE).
const path = require("path");
const { DB } = require(path.join(__dirname, "../../pk1c/sim/db.js"));
const { Engine } = require(path.join(__dirname, "../../pk1c/sim/engine.js"));
const { fcRowsFingerprint } = require(path.join(__dirname, "../code/fc_fp.js"));

const OPEN_EDIT = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD", "HELD"];
const q8 = (v) => Number(v).toFixed(8);
const req = (j) => JSON.parse(j.request_payload || "{}");

// gds: [{ lines: n, so: [so line ids per line] | null, status: "Created" }]; a line picks 3 of 5
function seedFc(db, opt) {
  const o = Object.assign({ org: "9", plant: "8", gds: [{ lines: 2 }] }, opt || {});
  const P = db.id();
  const nonce = "a1b2c3d4";
  const gdIds = [], manifest = [], snapRows = {}, snapGds = {};
  db.t.picking.push({ id: P, to_id: "PI-1", to_status: "In Progress", is_deleted: 0, organization_id: o.org, plant_id: o.plant, is_processing: 1, update_time: db.now + 8 * 3600 * 1000 });
  o.gds.forEach((g, gi) => {
    const G = db.id();
    gdIds.push(G);
    db.t.gd.push({ id: G, delivery_no: "GD/" + (gi + 1), gd_status: g.status || "Created", organization_id: o.org, plant_id: o.plant, is_deleted: 0 });
    snapGds[G] = g.status || "Created";
    const so = [];
    for (let k = 0; k < g.lines; k++) {
      const L = db.id(), R = db.id(), C = db.id();
      const sol = (g.so && g.so[k]) || "SOL-" + gi + "-" + k;
      so.push(sol);
      db.t.lines.push({ id: R, transfer_order_id: P, gd_id: G, gd_line_id: L, line_status: "In Progress", pending_process_qty: "5.00000000", is_deleted: 0 });
      db.t.records.push({ id: C, transfer_order_id: P, gd_line_id: L, store_out_qty: "3.00000000", is_deleted: 0 });
      snapRows[R] = { pending: "5.00000000", status: "In Progress" };
    }
    manifest.push({ gi: gi, gd_id: G, gd_no: "GD/" + (gi + 1), so_line_ids: [...new Set(so)].sort(), weight: g.weight || g.lines });
  });
  const rows = db.t.lines.filter((r) => r.transfer_order_id === P && !r.is_deleted);
  const recs = db.t.records.filter((r) => r.transfer_order_id === P && !r.is_deleted);
  const fp = { rowsFp: fcRowsFingerprint(rows), recCount: recs.length, recSum: q8(recs.reduce((t, r) => t + Number(r.store_out_qty), 0)),
    recMaxId: recs.map((r) => r.id).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).pop() };
  const J = db.id();
  const payload = { v: 1, prepared_by: "PICKING_BULK_PREPARE", job_id: J, picking_id: P, picking_no: "PI-1", organization_id: o.org, plant_id: o.plant, operation: "FORCE_COMPLETE",
    records: [], gd_lines: [], row_patch: {}, gd_ids: gdIds, gd_ids_all: gdIds, snapshot: { to_status: "In Progress", rows: snapRows, gds: snapGds },
    fc: { nonce: nonce, manifest: manifest, counts: { gds: manifest.length }, fp: fp } };
  db.t.job.push({ id: J, command: "CONFIRM_PICKING", organization_id: o.org, plant_id: o.plant, picking_id: P, idempotency_key: "K-" + J, job_status: "READY_TO_COMMIT",
    progress_percent: 60, progress_message: "Ready to force complete", attempt_count: 0, row_version: 3, next_attempt_at: db.now, lease_owner: null, lease_expires_at: null,
    request_payload: JSON.stringify({ v: 1, operation: "FORCE_COMPLETE", picking_id: P }), prepared_payload: JSON.stringify(payload), is_deleted: 0, create_time: db.now });
  manifest.forEach((m) => db.t.step.push({ id: db.id(), job_id: J, organization_id: o.org, step_name: "FCD|" + nonce + "|" + m.gi + "|000", step_status: "PAYLOAD", result_ref: "{}",
    is_deleted: 0, started_at: db.now }));
  return { J, P, nonce, gdIds, manifest };
}

// ------------------------------------------------------------------------------------------- DRIVE's reads
function driveMocks() {
  const out = (ctx, id) => ctx.out[id] || {};
  const fmt = (db, ms) => (ms === null || ms === undefined ? null : db.fmt(ms));
  const steps = (db, J) => db.t.step.filter((s) => s.job_id === J && !s.is_deleted && /^FC_/.test(s.step_name)).map((s) => ({ name: s.step_name, ref: s.result_ref || "" }));
  const edits = (db, J, gdIds) => db.t.job.filter((e) => !e.is_deleted && e.command === "EDIT_GD" && e.causation_id === "PICKING_FC" && gdIds.includes(req(e).gd_id)
    && String(req(e).causation_job_id) === J).sort((a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : 1)).map((e) => ({
    // MySQL 8.4's JSON_OBJECT renders a comparison as true / false (dev, 10-20)
    id: e.id, status: e.job_status, fcd: req(e).fcd_ref, gd_id: req(e).gd_id, due: !e.next_attempt_at || e.next_attempt_at <= db.now,
    live: !!(e.lease_expires_at && e.lease_expires_at > db.now), code: e.error_code || null, msg: e.error_message || null, queued: fmt(db, e.queued_at), finished: fmt(db, e.finished_at) }));
  const state = (text, ctx, e) => {
    const db = e.db, en = out(ctx, "code_node_DRentry");
    const j = db.t.job.find((x) => x.id === en.jobId && !x.is_deleted);
    if (!j) return [{ db_now: db.fmt(db.now) }];
    return [{ db_now: db.fmt(db.now), id: j.id, job_status: j.job_status, row_version: j.row_version, lease_owner: j.lease_owner || null,
      lease_live: j.lease_expires_at && j.lease_expires_at > db.now ? 1 : 0, progress_percent: j.progress_percent,
      edits: JSON.stringify(edits(db, j.id, String(en.gdIdsSql).split(","))), steps: JSON.stringify(steps(db, j.id)) }];
  };
  const sql = {
    sql_node_DRjob: (text, ctx, e) => {
      const db = e.db, g = out(ctx, "code_node_DRguard");
      const j = db.t.job.find((x) => x.id === g.jobId);
      const base = { db_now: db.fmt(db.now), lease_until: db.fmt(db.now + 600000) };
      if (!j) return [base];
      let p = null;
      try { p = JSON.parse(j.prepared_payload || "null"); } catch (err) { p = null; }
      return [Object.assign(base, { id: j.id, command: j.command, is_deleted: j.is_deleted, organization_id: j.organization_id, picking_id: j.picking_id, job_status: j.job_status,
        row_version: j.row_version, attempt_count: j.attempt_count, lease_owner: j.lease_owner || null, lease_expires_at: fmt(db, j.lease_expires_at),
        lease_live: j.lease_expires_at && j.lease_expires_at > db.now ? 1 : 0, progress_percent: j.progress_percent, progress_message: j.progress_message,
        operation: req(j).operation || null, fc: p && p.fc ? JSON.stringify(p.fc) : null, picking_no: p ? p.picking_no : null,
        snap_to_status: p && p.snapshot ? p.snapshot.to_status : null, snap_gds: p && p.snapshot ? JSON.stringify(p.snapshot.gds) : null,
        gd_ids_all: p ? JSON.stringify(p.gd_ids_all) : null, fc_steps: steps(db, j.id).map((s) => s.name).join(",") || null })];
    },
    sql_node_DRstate: state,
    sql_node_DRend: state,
    sql_node_DRf0: (text, ctx, e) => {
      const db = e.db, en = out(ctx, "code_node_DRentry");
      const now = db.fmt(db.now);
      const p = db.t.picking.find((x) => x.id === en.pickingId);
      const rows = [{ db_now: now, kind: "P", id: p ? p.id : null, status: p ? p.to_status : null, a: p ? String(p.is_deleted || 0) : null, b: p ? String(p.is_processing || 0) : null, c: null }];
      for (const r of db.t.lines.filter((x) => x.transfer_order_id === en.pickingId && !x.is_deleted)) rows.push({ db_now: now, kind: "R", id: r.id, status: r.line_status, a: null, b: null, c: null });
      const recs = db.t.records.filter((x) => x.transfer_order_id === en.pickingId && !x.is_deleted);
      rows.push({ db_now: now, kind: "A", id: null, status: null, a: String(recs.length), b: recs.length ? recs.reduce((t, r) => t + Number(r.store_out_qty), 0).toFixed(8) : null,
        c: recs.length ? recs.map((r) => r.id).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).pop() : null });
      const ids = String(en.gdIdsAllSql).split(",");
      for (const g of db.t.gd.filter((x) => ids.includes(x.id) && !x.is_deleted)) rows.push({ db_now: now, kind: "G", id: g.id, status: g.gd_status, a: null, b: null, c: null });
      return rows;
    },
  };
  return { sql, read: {} };
}

// ------------------------------------------------------------------------------------------- GD Edit V2 stand-in
// opts: refuse[gdId] = { route, code, message, skip: n SUBMITs let through first }, prepareFail[gdId] = code, commitFail[gdId] = [code, ...] (one per commit),
// busyFor[gdId] = n (SUBMIT answers BUSY n times for a foreign job)
function gdeStub(db, opts) {
  const o = Object.assign({ refuse: {}, prepareFail: {}, commitFail: {}, busyFor: {} }, opts || {});
  const log = { submit: [], worker: [], commits: [] };
  const open = (gdId) => db.t.job.filter((j) => j.command === "EDIT_GD" && !j.is_deleted && req(j).gd_id === gdId && OPEN_EDIT.includes(j.job_status));
  const gd = (id) => db.t.gd.find((g) => g.id === id) || {};
  const ans = (route, code, message, extra) => Object.assign({ route, code, message: message || "", reason: "", command: "EDIT_GD", job_id: "", job_status: "", gd_id: "", gd_no: "",
    line_count: "0", progress_percent: "0", progress_message: "", error_code: "", error_message: "", picking_reversal_note: "", credit_limit_note: "", cascade_ref: "", evidence: "" }, extra || {});
  const submit = (p) => {
    log.submit.push(Object.assign({}, p));
    const op = String(p.operation || "SUBMIT"), gdId = String(p.gd_id);
    if (op === "SUBMIT") {
      if (String(p.source) !== "PICKING_FC") return ans("REJECT", "400", "source");
      if (!/^FCD\|[0-9a-z]{8}\|[0-9]{1,2}$/.test(String(p.fcd_ref)) || String(p.cascade_ref) !== "PKFC|" + p.causation_job_id) return ans("REJECT", "400", "refs");
      const [, nonce, gi] = String(p.fcd_ref).split("|");
      if (!db.t.step.some((s) => s.job_id === String(p.causation_job_id) && s.step_name === "FCD|" + nonce + "|" + gi + "|000" && !s.is_deleted)) {
        return ans("STOP", "400", "the force complete's planned changes could not be read");
      }
      if (o.busyFor[gdId] > 0) { o.busyFor[gdId]--; return ans("BUSY", "409", "Its edit is being saved - please wait for it to finish.", { cascade_ref: "SO|X", job_id: "999" }); }
      const mine = open(gdId)[0];
      if (mine) return ans("BUSY", "409", "Its edit is being saved - please wait for it to finish.", { job_id: mine.id, job_status: mine.job_status, cascade_ref: req(mine).cascade_ref });
      const no = o.refuse[gdId];
      if (no && !(no.skip > 0 && no.skip--)) return ans(no.route, no.code, no.message, { reason: no.reason || "" });
      if (gd(gdId).gd_status !== "Created") return ans("STOP", "400", "Goods Delivery is " + gd(gdId).gd_status);
      const n = db.t.job.filter((j) => j.command === "EDIT_GD" && req(j).gd_id === gdId).length + 1;
      const j = { id: db.id(), command: "EDIT_GD", organization_id: gd(gdId).organization_id, idempotency_key: "GDE|" + gdId + "|" + n, job_status: "QUEUED", progress_percent: 0,
        attempt_count: 0, row_version: 0, next_attempt_at: db.now, lease_owner: null, lease_expires_at: null, causation_id: "PICKING_FC", correlation_id: "GD|" + gdId, queued_at: db.now,
        finished_at: null, error_code: null, error_message: null, is_deleted: 0, create_time: db.now,
        request_payload: JSON.stringify({ v: 1, gd_id: gdId, source: "PICKING_FC", hold: 1, cascade_ref: p.cascade_ref, causation_job_id: String(p.causation_job_id), fcd_ref: p.fcd_ref }) };
      db.t.job.push(j);
      gd(gdId).gd_status = "Processing";
      return ans("QUEUED", "200", "Queued for processing", { job_id: j.id, job_status: "QUEUED", gd_id: gdId });
    }
    const held = open(gdId).filter((j) => j.job_status === "HELD" && req(j).cascade_ref === String(p.cascade_ref))[0];
    if (!held) return ans("NONE", "200", "nothing is held on this delivery for " + p.cascade_ref);
    if (op === "RELEASE") {
      Object.assign(held, { job_status: "READY_TO_COMMIT", next_attempt_at: db.now, row_version: held.row_version + 1 });
      return ans("RELEASED", "200", "released", { job_id: held.id, job_status: "READY_TO_COMMIT" });
    }
    if (op === "CANCEL_HELD") {
      Object.assign(held, { next_attempt_at: db.now, row_version: held.row_version + 1 });
      return ans("CANCELLING", "200", "the hold ended: run GD_EDIT_WORKER on the job", { job_id: held.id, job_status: "HELD" });
    }
    return ans("REJECT", "400", "operation");
  };
  // the screen's kick: one EDIT_GD job, as GD_EDIT_WORKER {job_id} runs it (due, no live lease)
  const worker = (jobId) => {
    log.worker.push(jobId);
    const j = db.t.job.find((x) => x.id === String(jobId) && x.command === "EDIT_GD");
    if (!j || (j.next_attempt_at && j.next_attempt_at > db.now) || (j.lease_expires_at && j.lease_expires_at > db.now)) return "SKIP";
    const g = gd(req(j).gd_id);
    const fc = db.t.job.find((x) => x.id === req(j).causation_job_id) || {};
    const fcOpen = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING"].includes(fc.job_status);
    if (j.job_status === "QUEUED" || j.job_status === "VALIDATING") {
      const fail = o.prepareFail[g.id];
      if (fail) { Object.assign(j, { job_status: "FAILED", error_code: fail, error_message: "refused: " + fail, finished_at: db.now }); g.gd_status = "Created"; return "FAILED"; }
      Object.assign(j, { job_status: "HELD", next_attempt_at: db.now + 1800 * 1000 });
      return "HELD";
    }
    if (j.job_status === "HELD") {
      Object.assign(j, { job_status: "CANCELLED", error_code: fcOpen ? "GDE_HOLD_EXPIRED" : "GDE_HOLD_ORPHANED", finished_at: db.now });
      g.gd_status = "Created";
      return "CANCELLED";
    }
    if (j.job_status === "READY_TO_COMMIT") {
      const fails = o.commitFail[g.id] || [];
      if (fails.length) {
        const code = fails.shift();
        const review = code === "GDE_E3_CONFLICT";
        Object.assign(j, { job_status: review ? "REQUIRES_REVIEW" : "FAILED", error_code: code, error_message: "commit: " + code, finished_at: db.now });
        if (!review) g.gd_status = "Created";
        return j.job_status;
      }
      Object.assign(j, { job_status: "COMPLETED", finished_at: db.now, progress_percent: 100 });
      g.gd_status = "Created";
      log.commits.push(g.id);
      return "COMPLETED";
    }
    return "SKIP";
  };
  return { submit, worker, log };
}

// an engine on the repo's built Picking/AsyncV2 JSONs with GD_EDIT_SUBMIT stood in (and GD_EDIT_WORKER refused: DRIVE never calls it)
function driveEngine(db, gde) {
  const e = new Engine({ dir: path.join(__dirname, "../../../Picking/AsyncV2"), db: db, mocks: driveMocks() });
  const run = e.run.bind(e);
  e.calls = [];
  e.run = (name, params) => {
    e.calls.push(name);
    if (name === "GD_EDIT_SUBMIT") return { returned: gde.submit(params || {}), ctx: {} };
    if (name === "GD_EDIT_WORKER") throw new Error("DRIVE called GD_EDIT_WORKER");
    return run(name, params);
  };
  return e;
}

module.exports = { seedFc, driveMocks, gdeStub, driveEngine, DB };
