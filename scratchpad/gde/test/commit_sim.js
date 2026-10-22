// commit_sim.js <reads.json> <tenant> [scenario...]: the BUILT GD_EDIT_PREPARE and GD_EDIT_COMMIT (Goods Delivery/EditV2) on
// gdc's interpreter, against an in-memory world seeded from live dev reads (test/run_sql.py dump: hdr, lines, alloc, sohl,
// soh, pick, picki, pickr, ...). Nothing touches a database. The form edit is made here; its delta goes in the job's request
// as SUBMIT would put it, the GD Processing under the job's lock, its Picking locked at a version.
// Scenarios: REMOVE (a line), ADD (a copy of a line: inserts, placeholders), CRASH (a crash in E2's 2nd patch slice, resume),
// PICKCRASH (a crash after the Picking write, resume: the signature says it landed), STALE (a reservation moved before E0:
// FAILED, GD and Picking unlocked), BUSY (the stock locked: wait, then go on).
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const { Engine } = require("../../gdc/pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const [readsFile, tenant, ...want] = process.argv.slice(2);
const S0 = JSON.parse(fs.readFileSync(readsFile, "utf8"));
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const fmt3 = (ms) => new Date(ms).toISOString().slice(0, 23).replace("T", " ");

// the edit's delta, made in-process with the same modules SUBMIT runs
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const sb = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext([R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/plan_edit.js", D + "/code/commit/so_edit.js",
  D + "/code/prepare/adapter_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n") + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";", sb);
const inSb = (expr, vars) => { Object.assign(sb, vars); return JSON.parse(JSON.stringify(vm.runInContext(expr, sb))); };

function world(scenario) {
  const w = { now: Date.UTC(2026, 9, 15, 2, 0, 0), seq: 6000000000000000000n, steps: [], res: {}, creates: [], sol: {}, soh: {}, gdh: null, gdl: {}, picks: {}, pitems: {}, precs: {},
    items: {}, calls: [], crash: null, lockBusy: 0, scenario };
  w.id = () => (w.seq += 1n).toString();
  w.gdh = J(S0.hdr[0].j);
  for (const r of S0.lines) { const o = J(r.j); w.gdl[o.id] = o; }
  for (const r of S0.alloc.concat(S0.pend || [])) { const o = J(r.j); w.res[o.id] = o; }
  for (const r of S0.sohl) { const o = J(r.j); w.sol[o.id] = o; }
  for (const r of S0.soh) { const o = J(r.j); w.soh[o.id] = o; }
  for (const r of S0.pick) { const o = J(r.j); w.picks[o.id] = o; }
  for (const r of S0.picki) { const o = J(r.j); w.pitems[o.id] = o; }
  for (const r of S0.pickr) { const o = J(r.j); w.precs[o.id] = o; }
  // the form: the GD as stored with the scenario's edit
  const stored = inSb("geAdapt(__S).stored", { __S: S0 });
  const form = clone(stored);
  form.gd_status = "Created";
  // a plain stock line (top-level, allocated); in a GD of bundles only, a bundle's item
  let top = form.table_gd.findIndex((x) => x.material_id && !(x.children || []).length && JSON.parse(x.temp_qty_data || "[]").length);
  const holder = top >= 0 ? null : form.table_gd.find((x) => (x.children || []).some((c) => c.material_id && JSON.parse(c.temp_qty_data || "[]").length));
  const rows = holder ? holder.children : form.table_gd;
  if (holder) top = rows.findIndex((c) => c.material_id && JSON.parse(c.temp_qty_data || "[]").length);
  if (scenario === "ADD") { const c = clone(rows[top]); delete c.id; c.line_index = rows.length + 1; rows.push(c); }
  else rows.splice(top, 1);
  w.delta = inSb("geDelta(__F, __ST, GE_KINDS)", { __F: form, __ST: Object.assign(clone(stored), { gd_status: "Created" }) });
  w.form = form;
  // SUBMIT's state: the lock, the GD Processing, the Picking locked at a version, the job VALIDATING under the worker's lease
  w.key = "GDE|" + w.gdh.id + "|1";
  w.gdh.gd_status = "Processing";
  const pk = Object.values(w.picks)[0] || null;
  if (pk) { pk.is_processing = 1; pk.update_time = fmt3(w.now - 1000); }
  w.job = { id: "2111000000000000001", organization_id: String(w.gdh.organization_id), command: "EDIT_GD", job_status: "VALIDATING", progress_percent: 10, progress_message: "Validating",
    attempt_count: 0, next_attempt_at: null, lease_owner: "WRK|w1", lease_expires_at: fmt(w.now + 600000), row_version: 2, error_code: null, error_message: null, error_details: null,
    idempotency_key: w.key, correlation_id: "GD|" + w.gdh.id, is_deleted: 0, prepared_payload: null,
    request_payload: JSON.stringify({ v: 1, gd_id: String(w.gdh.id), gd_no: w.gdh.delivery_no, source: "FORM", stored_status: "Created", submitted_by: "1",
      answers: { needCL: "required", continueZero: "", confirmPickReversal: "Yes" }, delta: w.delta, picking_id: pk ? String(pk.id) : "", picking_version: pk ? pk.update_time : "", hold: 0, cascade_ref: "",
      notes: {} }) };
  return w;
}

const jrow = (o) => ({ j: JSON.stringify(o) });
const idsIn = (text) => [...text.matchAll(/JSON_TABLE\('(\[[^']*\])'/g)].map((m) => JSON.parse(m[1]).map(String));
function mocks(w) {
  // as the SQL: this job's rows (st.job_id = '<job>') whose name starts with the prefix
  const stepRows = (pfx, text) => {
    const jid = ((text || "").match(/st\.job_id = '([0-9]+)'/) || [])[1];
    return w.steps.filter((r) => !r.is_deleted && String(r.step_name).indexOf(pfx) === 0 && (!jid || String(r.job_id) === jid)).sort((a, b) => (a.step_name < b.step_name ? -1 : 1))
      .map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  };
  const jobRow = () => {
    const j = w.job;
    const live = j.lease_expires_at && Date.parse(j.lease_expires_at.replace(" ", "T") + "Z") > w.now ? 1 : 0;
    const due = !j.next_attempt_at || Date.parse(j.next_attempt_at.replace(" ", "T") + "Z") <= w.now ? 1 : 0;
    return Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 1800000), lease_live: live, due: due });
  };
  const req = () => JSON.parse(w.job.request_payload);
  const lockedPick = () => { const p = w.picks[req().picking_id]; return p && !p.is_deleted ? [{ id: String(p.id), is_processing: p.is_processing, update_time: p.update_time }] : []; };
  const gdLines = (text) => {
    const [ids] = idsIn(text);
    const like = w.job.id + "|L|";
    // a projected read (SELECT JSON_OBJECT('id', ..., 'col', ...)) returns those columns only
    const proj = /^SELECT JSON_OBJECT\(/.test(text) ? [...text.slice(0, text.indexOf(" AS j")).matchAll(/'([a-z0-9_]+)',\s/g)].map((m) => m[1]) : null;
    const cut = (l) => { if (!proj) return l; const o = {}; for (const c of proj) o[c] = l[c] === undefined ? null : l[c]; return o; };
    return Object.values(w.gdl).filter((l) => ids.indexOf(String(l.id)) >= 0 || String(l.job_line_key || "").indexOf(like) === 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((l) => jrow(cut(l)));
  };
  const resRows = (text) => {
    const [ids] = idsIn(text);
    const out = ids.filter((i) => w.res[i]).map((i) => ({ k: "U", j: JSON.stringify(w.res[i]) }));
    if (/job_line_key LIKE/.test(text)) for (const c of w.creates) if (!c.is_deleted) out.push({ k: "C", j: JSON.stringify({ id: c.id, job_line_key: c.job_line_key }) });
    return out;
  };
  const S = (k) => S0[k];
  return new Proxy({}, {
    get: (_, id) => (text) => {
      // GD_EDIT_SUBMIT
      if (id === "sql_node_GSfacts") {
        const lock = w.steps.filter((x) => !x.is_deleted && x.job_id === "GDC|" + w.gdh.id && /^LOCK\|/.test(x.step_name)).pop();
        const lj = lock && w.job && w.job.idempotency_key === lock.result_ref ? JSON.stringify({ id: w.job.id, command: w.job.command, job_status: w.job.job_status, progress_message: w.job.progress_message,
          cascade_ref: JSON.parse(w.job.request_payload || "{}").cascade_ref || null }) : null;
        const open = w.job && w.job.job_status !== "COMPLETED" && w.job.job_status !== "FAILED" && w.job.job_status !== "CANCELLED" ? JSON.stringify([{ id: w.job.id, command: "EDIT_GD", job_status: w.job.job_status }]) : null;
        const pks = Object.values(w.picks).map((p) => ({ id: String(p.id), to_id: p.to_id, to_status: p.to_status, is_processing: p.is_processing, lock_age_sec: 99999 }));
        return [{ db_now: fmt(w.now), gd_id: String(w.gdh.id), delivery_no: w.gdh.delivery_no, gd_status: w.gdh.gd_status, organization_id: String(w.gdh.organization_id),
          plant_id: String(w.gdh.plant_id), line_count: Object.values(w.gdl).filter((l) => !l.is_deleted).length, last_lock: lock ? lock.step_name : null, lock_job: lj, open_jobs: open,
          pickings: pks.length ? JSON.stringify(pks) : null, open_pickings: null }];
      }
      if (id === "sql_node_GShdr") return [jrow(w.gdh)];
      if (id === "sql_node_GSpick") return Object.values(w.picks).map(jrow);
      if (id === "sql_node_GSback") {
        const lock = w.steps.filter((x) => !x.is_deleted && x.job_id === "GDC|" + w.gdh.id && /^LOCK\|/.test(x.step_name)).pop();
        const pid = (text.match(/NULLIF\('([0-9]*)', ''\)/) || [])[1];
        const p = pid ? w.picks[pid] : null;
        return [{ job_id: w.job ? w.job.id : null, job_status: w.job ? w.job.job_status : null, gd_status: w.gdh.gd_status, queued_at: w.job ? w.job.queued_at : null,
          request_payload: w.job ? w.job.request_payload : null, lock_ref: lock ? lock.result_ref : null, pick_id: p ? String(p.id) : null, pick_processing: p ? p.is_processing : null,
          pick_update_time: p ? p.update_time : null }];
      }
      if (id === "sql_node_GSheld") return w.job && w.job.job_status === "HELD" && w.job.correlation_id === "GD|" + w.gdh.id
        ? [{ job_id: w.job.id, expired: w.job.next_attempt_at && w.job.next_attempt_at <= fmt(w.now) ? 1 : 0 }] : [];
      if (id === "sql_node_GSops") {
        const ref = (text.match(/'\$\.cascade_ref'\)\) = '([^']*)'/) || [])[1];
        const j = w.job;
        if (!j || j.job_status !== "HELD" || j.correlation_id !== "GD|" + w.gdh.id || JSON.parse(j.request_payload).cascade_ref !== ref) return [{ db_now: fmt(w.now) }];
        const taken = w.steps.some((x) => !x.is_deleted && x.job_id === j.id && x.step_name === "W0_CLAIM_" + j.row_version) ? 1 : 0;
        return [{ db_now: fmt(w.now), job_id: j.id, organization_id: j.organization_id, job_status: j.job_status, row_version: j.row_version, cascade_ref: ref, gate_taken: taken }];
      }
      if (id === "sql_node_GSopsBack") {
        const jid = (text.match(/j\.id = ([0-9]+)/) || [])[1];
        const j = w.job && w.job.id === jid ? w.job : null;
        return j ? [{ job_id: j.id, job_status: j.job_status, row_version: j.row_version, ended: j.next_attempt_at && j.next_attempt_at <= fmt(w.now) ? 1 : 0,
          released: w.steps.filter((x) => !x.is_deleted && x.job_id === j.id && x.step_name === "RELEASE").length }] : [];
      }
      if (/^sql_node_GS/.test(id)) return S(id.slice(11));
      // GD_EDIT_WORKER: the unlock columns as wjob_sql computes them
      if (/^sql_node_GW/.test(id)) {
        const j = jobRow();
        const r = req();
        const p = w.picks[r.picking_id];
        const unl = { gd_id: w.gdh.gd_status === "Processing" && w.key === j.idempotency_key ? String(w.gdh.id) : "0", stored_status: r.stored_status,
          pick_id: p && Number(p.is_processing) === 1 && p.update_time === r.picking_version ? String(p.id) : "0" };
        const claim = w.steps.find((x) => !x.is_deleted && x.job_id === j.id && x.step_name === "W0_CLAIM_" + j.row_version) || null;
        const claimF = { claim_id: claim ? claim.id : null, claim_started_at: claim ? claim.started_at : null, claim_owner: claim ? claim.result_ref : null,
          claim_live: claim && Date.parse(String(claim.started_at).replace(" ", "T") + "Z") > w.now - 600000 ? 1 : 0 };
        const dead = j.lease_owner && j.lease_expires_at && Date.parse(j.lease_expires_at.replace(" ", "T") + "Z") <= w.now ? 1 : 0;
        const row = Object.assign({}, j, unl, claimF, { dead_lease: dead, due_now: j.due });
        if (id === "sql_node_GWpoll") {
          const workable = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD", "HELD"].indexOf(j.job_status) >= 0 && !j.lease_live && j.due && !(claim && claimF.claim_live);
          return workable ? [row] : [{ db_now: j.db_now }];
        }
        if (id === "sql_node_GWfinal") return [{ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, gd_id: String(w.gdh.id) }];
        return [row];
      }
      // GD_EDIT_PREPARE
      if (id === "sql_node_GEjob") return [Object.assign(jobRow(), {})];
      if (id === "sql_node_GEback") return [w.job];
      if (id === "sql_node_GElock") return [{ step_name: "LOCK|1", result_ref: w.key }];
      if (id === "sql_node_GEhdr") return [jrow(w.gdh)];
      if (id === "sql_node_GEpick") return Object.values(w.picks).map(jrow);
      if (/^sql_node_GE/.test(id)) return S(id.slice(11));
      // GD_EDIT_COMMIT
      if (id === "sql_node_GXjob") { const j = jobRow(); const r = req(); return [Object.assign(j, { request_payload: JSON.stringify({ hold: r.hold, picking_id: r.picking_id, picking_version: r.picking_version }) })]; }
      if (id === "sql_node_GXsteps") return w.steps.filter((r) => !r.is_deleted && ((/^E/.test(r.step_name) && /^(DONE|STARTED)$/.test(r.step_status)) || r.step_name === "RELEASE"))
        .map((r) => ({ step_name: r.step_name, step_status: r.step_status, result_ref: r.result_ref }));
      if (id === "sql_node_GXgd") return [{ gd_status: w.gdh.gd_status, lock_ref: w.key }];
      if (id === "sql_node_GXpick" || id === "sql_node_GXe6pk") return lockedPick();
      if (id === "sql_node_GXown") return [w.job];
      if (id === "sql_node_GXe1ops") return [{ intents: String(w.engineIntents || 0) }];
      const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/);
      if (part) return stepRows(part[1] + part[2] + "|", text);
      const intent = text.match(/step_name LIKE '([A-Z0-9]+\|I\|)%'/);
      if (intent) return stepRows(intent[1], text);
      if (/^sql_node_GX(e0res|e3res|e3back)$/.test(id)) return resRows(text);
      if (/^sql_node_GX(e0gdl|e2la|e2lb|e2back|e3gdl|cgdl)$/.test(id)) return gdLines(text);
      if (/^sql_node_GX(e0sol|e4sol|e4solB)$/.test(id)) return Object.values(w.sol).map(jrow);
      if (/^sql_node_GX(e0soh|e4soh|e4sohB)$/.test(id)) return Object.values(w.soh).map(jrow);
      if (/^sql_node_GX(e0pick|e5pick|e5pickB)$/.test(id)) return Object.values(w.picks).map(jrow);
      if (/^sql_node_GX(e5items|e5itemsB)$/.test(id)) return Object.values(w.pitems).filter((r) => !r.is_deleted).map(jrow);
      if (/^sql_node_GX(e5recs|e5recsB)$/.test(id)) return Object.values(w.precs).filter((r) => !r.is_deleted).map(jrow);
      if (/^sql_node_GX(e0nhead|e0nheadB)$/.test(id)) return [jrow({ id: w.gdh.id, delivery_no: w.gdh.delivery_no, delivery_no_type: w.gdh.delivery_no_type, gd_status: w.gdh.gd_status })];
      if (/^sql_node_GX(e6head|e6back)$/.test(id)) return [jrow(w.gdh)];
      throw new Error("no mock for " + id);
    },
  });
}
// the platform's write semantics: an update writes NULL for a mapped column a record leaves out (the engine passes them as
// undefined); a Picking write replaces its two subforms (rows with an id kept, new rows get one, the rest removed) and
// moves its version
function dbOf(w) {
  const apply = (map, rows, label) => {
    for (const r0 of rows) {
      const id = String(r0.id === undefined || r0.id === null ? r0.__id : r0.id);
      if (!map[id]) throw new Error(label + " update of unknown id " + id);
      const r = Object.assign({}, r0);
      delete r.__id;
      for (const k of Object.keys(r)) if (r[k] === undefined) r[k] = null;
      Object.assign(map[id], r);
    }
  };
  const sub = (map, parentId, rows) => {
    const keep = new Set();
    for (const r0 of rows || []) {
      const r = Object.assign({}, r0, { transfer_order_id: parentId, is_deleted: 0 });
      if (!r.id) r.id = w.id();
      keep.add(String(r.id));
      map[r.id] = Object.assign(map[r.id] || {}, r);
    }
    for (const r of Object.values(map)) if (String(r.transfer_order_id) === String(parentId) && !keep.has(String(r.id))) r.is_deleted = 1;
  };
  const crash = (table) => { if (w.crash && w.crash.table === table && --w.crash.n === 0) throw new Error("crash in " + table); };
  return {
    tenantId: tenant,
    insert(table, rows) {
      crash(table);
      if (table === "GD Publish Step") {
        for (const r of rows) {
          if (w.steps.some((x) => !x.is_deleted && x.job_id === r.job_id && x.step_name === r.step_name)) throw new Error("Duplicate entry " + r.step_name);
          w.steps.push(Object.assign({ is_deleted: 0, id: w.id() }, r));
          if (/^LOCK\|/.test(r.step_name)) w.key = r.result_ref;
        }
        return rows;
      }
      if (table === "GD Async Job") return rows.map((r) => { w.job = Object.assign({ id: "2111000000000000009", is_deleted: 0, lease_owner: null, lease_expires_at: null, error_code: null,
        error_message: null, error_details: null, prepared_payload: null }, r); return w.job; });
      if (table === "On Reserved Goods Delivery") return rows.map((r) => { const o = Object.assign({ id: w.id(), is_deleted: 0 }, r); w.creates.push(o); w.res[o.id] = o; return o; });
      if (table === "goods_delivery_fwii8mvb_sub") return rows.map((r) => { const o = Object.assign({ id: w.id(), is_deleted: 0 }, r); w.gdl[o.id] = o; return o; });
      if (table === "Transfer Order Picking") return rows.map((r) => {
        const id = w.id();
        const o = Object.assign({ is_deleted: 0, is_processing: 0 }, r, { id, update_time: fmt3(w.now) });
        sub(w.pitems, id, r.table_picking_items); sub(w.precs, id, r.table_picking_records);
        delete o.table_picking_items; delete o.table_picking_records;
        w.picks[id] = o;
        return o;
      });
      w.calls.push(["add", table, rows.length]);
      return rows;
    },
    update(table, rows) {
      crash(table);
      if (table === "GD Async Job") { for (const r of rows) { const x = Object.assign({}, r); delete x.__id; Object.assign(w.job, x, { id: w.job.id }); } }
      else if (table === "On Reserved Goods Delivery") apply(w.res, rows, table);
      else if (table === "sales_order_axszx8cj_sub") apply(w.sol, rows, table);
      else if (table === "Sales Order") apply(w.soh, rows, table);
      else if (table === "goods_delivery_fwii8mvb_sub") apply(w.gdl, rows, table);
      else if (table === "Goods Delivery") apply({ [String(w.gdh.id)]: w.gdh }, rows, table);
      else if (table === "Transfer Order Picking") {
        for (const r0 of rows) {
          const id = String(r0.id === undefined || r0.id === null ? r0.__id : r0.id);
          const p = w.picks[id];
          if (!p) throw new Error("Picking update of unknown id " + id);
          const r = Object.assign({}, r0);
          delete r.__id;
          if ("table_picking_items" in r) { sub(w.pitems, id, r.table_picking_items); delete r.table_picking_items; }
          if ("table_picking_records" in r) { sub(w.precs, id, r.table_picking_records); delete r.table_picking_records; }
          for (const k of Object.keys(r)) if (r[k] === undefined) r[k] = null;
          Object.assign(p, r, { update_time: fmt3(w.now += 7) });
        }
      } else w.calls.push(["update", table, rows.length]);
      return rows.length;
    },
  };
}
let runNo = 0;
function run(w, name, label) {
  // GDE_DIR: another build of the four workflows (a before / after comparison)
  const e = new Engine({ dir: process.env.GDE_DIR || R + "Goods Delivery/EditV2", db: dbOf(w), mocks: { sql: mocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 48;
  const run0 = e.run.bind(e);
  e.run = (n, p) => {
    if (n === name || /^GD_EDIT_(PREPARE|COMMIT|WORKER)$/.test(n)) return run0(n, p);
    w.calls.push(["call", n, p.mode || p.document_type || ""]);
    if (n === "INVENTORY_BULK_APPLY") {
      if (p.mode === "APPLY" && w.lockBusy && w.lockBusy-- > 0) return { returned: { code: "409", result_code: "LOCK_BUSY", message: "ITEM|1|2 (GRC|9)" }, ctx: {} };
      return { returned: { code: "200", result_code: p.mode === "PLAN" ? "PLANNED" : "APPLIED", message: "ok" }, ctx: {} };
    }
    return { returned: { code: "200" }, ctx: {} };
  };
  let out, err = null;
  let ctx = null;
  try { const r = e.run(name, w.params || { job_id: w.job.id }); out = r.returned; ctx = r.ctx; } catch (x) { err = x.message; }
  w.params = null;
  if (process.env.SIZES && ctx) {
    const top = Object.entries(ctx.out).map(([k, v]) => [k, JSON.stringify(v === undefined ? null : v).length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log("      biggest outputs: " + top.map(([k, n]) => k + " " + (n / 1e6).toFixed(2)).join(", "));
  }
  // LANES=1: which update-nodes of the six write passes ran (a lane's own node, or the loop's)
  if (process.env.LANES) {
    const by = {};
    for (const t of e.trace) { const m = t.match(/ update_node_GX(e2pa|e2pb|e3|e4|e5s|e7)(l\d+|write)$/); if (m) by[m[1] + ":" + m[2]] = (by[m[1] + ":" + m[2]] || 0) + 1; }
    if (Object.keys(by).length) console.log("      writes: " + Object.entries(by).map(([k, v]) => k + (v > 1 ? "x" + v : "")).join(" "));
  }
  const done = w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort();
  console.log(`  ${label}: ${err ? "CRASH " + err : JSON.stringify(out).slice(0, 200)}\n      job ${w.job.job_status} ${w.job.error_code || ""} lease ${w.job.lease_owner || "-"} | done ${done.join(",")} | ${(e.sizes[name] / 1e6).toFixed(2)} MB node data`);
  return { out, err };
}
const prepare = (w) => {
  const r = run(w, "GD_EDIT_PREPARE", "PREPARE");
  assert.strictEqual(w.job.job_status, "READY_TO_COMMIT", "prepared");
  w.manifest = JSON.parse(w.job.prepared_payload);
  w.job.lease_owner = "WRK|w1";
  return r;
};
const commit = (w, label) => run(w, "GD_EDIT_COMMIT", label);
const next = (w, ms) => { w.now += ms || 2000; };
// phase A: E0 E0N E1; B: E2 alone; B2: E3 E4; C: E5 E6 E7 - one COMMIT call each
const PHASE_DONE = { A: ["E1_INVENTORY"], B: ["E2_LINES"], B2: ["E3_RESERVATIONS", "E4_SO"], C: ["E6_HEADER"] };
const phases = (w) => {
  for (const p of ["A", "B", "B2", "C"]) {
    commit(w, "COMMIT " + p); next(w);
    const done = new Set(w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name));
    for (const x of PHASE_DONE[p]) assert.ok(done.has(x), "phase " + p + ": " + x + " not done");
    if (p === "B") assert.ok(!done.has("E3_RESERVATIONS") && !done.has("E4_SO"), "phase B saves the lines only");
    if (w.job.job_status !== "COMMITTING_GD") break;
  }
};

// the expected end state: the plan's parts applied to the world as it was read
const partsOf = (w) => {
  const out = {};
  for (const [name, steps] of Object.entries(w.manifest.parts)) out[name] = JSON.parse(steps.map((sn) => w.steps.find((r) => r.step_name === sn).result_ref).join(""));
  return out;
};
const ok = (w) => {
  assert.strictEqual(w.job.job_status, "COMPLETED", w.job.error_message || "");
  assert.strictEqual(w.gdh.gd_status, "Created");
  const P = partsOf(w);
  for (const p of P.GDL.patches) for (const [c, v] of Object.entries(p.cells)) assert.ok(String(w.gdl[p.id][c] ?? "") === String(v ?? "") || Number(w.gdl[p.id][c]) === Number(v), "line " + p.id + "." + c);
  for (const id of P.GDL.deletes) assert.strictEqual(Number(w.gdl[id].is_deleted), 1, "removed " + id);
  const keys = Object.values(w.gdl).filter((l) => String(l.job_line_key || "").indexOf(w.job.id + "|L|") === 0);
  assert.strictEqual(keys.length, P.GDL.inserts.length, "inserted once each");
  for (const u of P.RES.updates) assert.strictEqual(String(w.res[u.id].status), String(u.after.status), "reservation " + u.id);
  assert.strictEqual(w.creates.length, P.RES.creates.length, "reservation creates once each");
  for (const c of w.creates) assert.ok(!/^9\d{18}$/.test(String(c.doc_line_id || "")) && !/^9\d{18}$/.test(String(c.target_gd_id || "")), "a create kept a placeholder");
  const pk = Object.values(w.picks)[0];
  if (pk) {
    assert.strictEqual(Number(pk.is_processing), 0, "the Picking lock released");
    for (const it of Object.values(w.pitems).filter((r) => !r.is_deleted)) assert.ok(!/^9\d{18}$/.test(String(it.gd_line_id || "")), "a Picking row kept a placeholder");
  }
  const calls = w.calls.filter((c) => c[0] === "call").map((c) => c[1] + ":" + c[2]);
  assert.ok(calls.indexOf("INVENTORY_BULK_APPLY:APPLY") >= 0 || !P.ENGINE.movements.length, "inventory applied");
  console.log(`      OK: ${P.GDL.patches.length} patches, ${P.GDL.deletes.length} removals, ${P.GDL.inserts.length} inserts, ${P.RES.updates.length} res updates, ${P.RES.creates.length} creates, Picking ${P.PICK.mode}; calls ${calls.join(" ")}`);
};

const REF = "SO|2110639355872194561|k7x2m9";
// a cascade's submit of the payload, prepared and held by the worker
const cascadeHeld = () => {
  const w = world("REMOVE");
  w.gdh.gd_status = "Created"; w.job = null; w.key = "";
  for (const p of Object.values(w.picks)) p.is_processing = 0;
  w.params = { operation: "SUBMIT", gd_id: String(w.gdh.id), source: "CASCADE", cascade_ref: REF, answers: { confirmPickReversal: "Yes" }, form: w.form };
  const r = run(w, "GD_EDIT_SUBMIT", "SO_CASCADE pass A: SUBMIT its payload");
  assert.strictEqual(r.out.route, "QUEUED", JSON.stringify(r.out).slice(0, 300));
  const req = JSON.parse(w.job.request_payload);
  assert.strictEqual(req.hold, 1); assert.strictEqual(req.cascade_ref, REF); assert.deepStrictEqual(req.delta, w.delta, "the payload diffed as the form's");
  w.params = { job_id: w.job.id };
  run(w, "GD_EDIT_WORKER", "WORKER on that job: PREPARE, held");
  assert.strictEqual(w.job.job_status, "HELD");
  return w;
};

const scenarios = {
  REMOVE: () => { const w = world("REMOVE"); prepare(w); phases(w); ok(w); commit(w, "rerun of a COMPLETED job"); assert.strictEqual(w.job.job_status, "COMPLETED"); },
  ADD: () => { const w = world("ADD"); prepare(w); phases(w); ok(w); },
  CRASH: () => {
    const w = world("REMOVE"); prepare(w);
    commit(w, "COMMIT A"); next(w);
    w.crash = { table: "goods_delivery_fwii8mvb_sub", n: 2 };
    const c = commit(w, "COMMIT B crashes in the 2nd patch slice");
    assert.ok(c.err && /crash/.test(c.err)); assert.strictEqual(w.job.job_status, "COMMITTING_GD");
    w.crash = null;
    commit(w, "resume while the crashed run's lease lives");
    assert.ok(!w.steps.some((r) => r.step_name === "E2_LINES"), "nothing done under a live lease");
    w.now += 31 * 60000;   // past the run's 30-minute lease (lease_until above)
    commit(w, "resume after the lease expired"); next(w);
    assert.ok(w.steps.some((r) => r.step_name === "E2_LINES" && r.step_status === "DONE") && !w.steps.some((r) => r.step_name === "E3_RESERVATIONS"), "the resumed phase B saved the lines only");
    for (const p of ["B2", "C"]) if (w.job.job_status === "COMMITTING_GD") { commit(w, "phase " + p); next(w); }
    ok(w);
  },
  PICKCRASH: () => {
    const w = world("REMOVE"); prepare(w);
    if (!Object.keys(w.picks).length) { console.log("  (no Picking in this GD)"); return; }
    commit(w, "COMMIT A"); next(w); commit(w, "COMMIT B"); next(w); commit(w, "COMMIT B2"); next(w);
    // phase C's step rows: the E5 intent (before the Picking write), then E5_PICKING DONE (after it): crash at the second
    const before = w.steps.length;
    const v0 = Object.values(w.picks)[0].update_time;
    w.crash = { table: "GD Publish Step", n: 2 };
    const c = commit(w, "COMMIT C crashes after the Picking write, before E5_PICKING DONE");
    assert.ok(c.err && /crash/.test(c.err), "crashed");
    assert.strictEqual(w.steps.length, before + 1, "the intent was recorded");
    assert.notStrictEqual(Object.values(w.picks)[0].update_time, v0, "the Picking was written");
    assert.ok(!w.steps.some((r) => r.step_name === "E5_PICKING"), "E5 not done");
    w.crash = null;
    w.now += 31 * 60000;   // past the run's 30-minute lease (lease_until above)
    commit(w, "resume: the Picking's version moved, the signature says the write landed");
    ok(w);
  },
  STALE: () => {
    const w = world("REMOVE"); prepare(w);
    const P = partsOf(w);
    const u = P.RES.updates[0];
    if (!u) { console.log("  (no reservation update)"); return; }
    w.res[u.id].reserved_qty = Number(w.res[u.id].reserved_qty) + 1;
    commit(w, "COMMIT A finds a reservation moved");
    assert.strictEqual(w.job.job_status, "FAILED"); assert.strictEqual(w.job.error_code, "GDE_STALE");
    assert.strictEqual(w.gdh.gd_status, "Created", "GD unlocked to its stored status");
    const pk = Object.values(w.picks)[0];
    if (pk) assert.strictEqual(Number(pk.is_processing), 0, "Picking unlocked");
    assert.ok(!w.calls.some((c) => c[1] === "INVENTORY_BULK_APPLY" && c[2] === "APPLY"), "no inventory write");
  },
  BUSY: () => {
    const w = world("REMOVE"); prepare(w);
    w.lockBusy = 2;
    for (let i = 0; i < 3; i++) { commit(w, "COMMIT A, stock locked, try " + (i + 1)); w.now += 6 * 60000; }
    assert.ok(/^SPLIT\|/.test(w.job.lease_owner || ""), "phase A done after the locks freed");
    next(w); commit(w, "COMMIT B"); next(w); commit(w, "COMMIT B2"); next(w); commit(w, "COMMIT C");
    ok(w);
  },
};
const queued = (w, hold) => {
  const r = JSON.parse(w.job.request_payload);
  r.hold = hold ? 1 : 0;
  if (hold) { r.source = "CASCADE"; r.cascade_ref = "SO|1|n1"; }
  Object.assign(w.job, { job_status: "QUEUED", lease_owner: null, lease_expires_at: null, progress_percent: 0, request_payload: JSON.stringify(r) });
};
Object.assign(scenarios, {
  WORKER: () => {
    const w = world("REMOVE"); queued(w);
    run(w, "GD_EDIT_WORKER", "WORKER tick (claim, PREPARE, four COMMIT calls)");
    w.manifest = JSON.parse(w.job.prepared_payload);
    ok(w);
  },
  HOLD: () => {
    const w = world("REMOVE"); queued(w, true);
    run(w, "GD_EDIT_WORKER", "WORKER tick: a cascade's job is prepared and held");
    assert.strictEqual(w.job.job_status, "HELD"); assert.strictEqual(w.job.lease_owner, null);
    assert.ok(w.job.next_attempt_at > fmt(w.now + 14 * 60000), "held about 15 minutes");
    assert.strictEqual(w.gdh.gd_status, "Processing"); assert.ok(!w.calls.some((c) => c[2] === "APPLY"), "nothing applied while held");
    run(w, "GD_EDIT_WORKER", "WORKER tick while held: nothing");
    assert.strictEqual(w.job.job_status, "HELD");
    // SO_SAVE's RELEASE: the job READY_TO_COMMIT, due now, a RELEASE row
    w.steps.push({ id: w.id(), job_id: w.job.id, step_name: "RELEASE", step_status: "DONE", result_ref: "SO|1|n1", is_deleted: 0 });
    Object.assign(w.job, { job_status: "READY_TO_COMMIT", next_attempt_at: null });
    run(w, "GD_EDIT_WORKER", "WORKER tick after RELEASE");
    w.manifest = JSON.parse(w.job.prepared_payload);
    ok(w);
  },
  SUBMIT: () => {
    const w = world("REMOVE");
    // as before any submit: the GD Created, its Picking free, no job, no lock
    w.gdh.gd_status = "Created"; w.job = null; w.key = "";
    for (const p of Object.values(w.picks)) p.is_processing = 0;
    w.params = { operation: "SUBMIT", gd_id: String(w.gdh.id), source: "FORM", answers: { needCL: "required", continueZero: "", confirmPickReversal: "Yes" }, form: w.form };
    const r = run(w, "GD_EDIT_SUBMIT", "SUBMIT (the form)");
    assert.strictEqual(r.out.route, "QUEUED", JSON.stringify(r.out).slice(0, 300));
    assert.strictEqual(w.gdh.gd_status, "Processing"); assert.strictEqual(w.job.command, "EDIT_GD"); assert.strictEqual(w.job.next_attempt_at, w.job.queued_at, "due now");
    const req = JSON.parse(w.job.request_payload), pk = Object.values(w.picks)[0];
    if (pk) { assert.strictEqual(Number(pk.is_processing), 1); assert.strictEqual(req.picking_version, pk.update_time, "the version as locked"); assert.strictEqual(req.picking_id, String(pk.id)); }
    w.params = { operation: "SUBMIT", gd_id: String(w.gdh.id), source: "FORM", answers: {}, form: w.form };
    const again = run(w, "GD_EDIT_SUBMIT", "a second submit while the first is queued");
    assert.strictEqual(again.out.route, "BUSY");
    run(w, "GD_EDIT_WORKER", "WORKER tick");
    w.manifest = JSON.parse(w.job.prepared_payload);
    ok(w);
    w.params = { operation: "STATUS", gd_id: String(w.gdh.id) };
    const st = run(w, "GD_EDIT_SUBMIT", "STATUS");
    assert.strictEqual(st.out.job_status, "COMPLETED"); assert.strictEqual(st.out.command, "EDIT_GD");
  },
  HELDKICK: () => {
    const w = world("REMOVE"); queued(w, true);
    run(w, "GD_EDIT_WORKER", "WORKER tick: a cascade's job held");
    assert.strictEqual(w.job.job_status, "HELD");
    const held = w.job.id, heldJob = w.job;
    w.now += 16 * 60000;
    // nobody kicked the worker; a user saves the GD from the form: SUBMIT cancels the ended hold first, then queues
    w.params = { operation: "SUBMIT", gd_id: String(w.gdh.id), source: "FORM", answers: { needCL: "required", continueZero: "", confirmPickReversal: "Yes" }, form: w.form };
    const r = run(w, "GD_EDIT_SUBMIT", "SUBMIT after the hold ended");
    assert.strictEqual(r.out.route, "QUEUED", JSON.stringify(r.out).slice(0, 300));
    assert.notStrictEqual(w.job.id, held, "a new job");
    assert.strictEqual(heldJob.job_status, "CANCELLED", "the ended hold was cancelled first"); assert.strictEqual(heldJob.error_code, "GDE_HOLD_EXPIRED");
    run(w, "GD_EDIT_WORKER", "WORKER tick");
    w.manifest = JSON.parse(w.job.prepared_payload);
    ok(w);
  },
  CASCADEREL: () => {
    const w = cascadeHeld();
    w.params = { operation: "RELEASE", gd_id: String(w.gdh.id), cascade_ref: REF };
    const r = run(w, "GD_EDIT_SUBMIT", "SO_SAVE: RELEASE");
    assert.strictEqual(r.out.route, "RELEASED", JSON.stringify(r.out).slice(0, 300)); assert.strictEqual(r.out.job_id, w.job.id);
    assert.strictEqual(w.job.job_status, "READY_TO_COMMIT"); assert.ok(w.steps.some((x) => x.job_id === w.job.id && x.step_name === "RELEASE" && x.result_ref === REF));
    w.params = { operation: "RELEASE", gd_id: String(w.gdh.id), cascade_ref: REF };
    assert.strictEqual(run(w, "GD_EDIT_SUBMIT", "a second RELEASE: nothing held now").out.route, "NONE");
    run(w, "GD_EDIT_WORKER", "WORKER tick after RELEASE");
    w.manifest = JSON.parse(w.job.prepared_payload);
    ok(w);
  },
  CASCADECANCEL: () => {
    const w = cascadeHeld();
    w.params = { operation: "CANCEL_HELD", gd_id: String(w.gdh.id), cascade_ref: REF };
    const r = run(w, "GD_EDIT_SUBMIT", "SO_CASCADE: CANCEL_HELD");
    assert.strictEqual(r.out.route, "CANCELLING", JSON.stringify(r.out).slice(0, 300));
    w.params = { job_id: r.out.job_id };
    run(w, "GD_EDIT_WORKER", "WORKER on that job: its EXPIRE path");
    assert.strictEqual(w.job.job_status, "CANCELLED"); assert.strictEqual(w.gdh.gd_status, "Created", "the GD unlocked at once");
    const pk = Object.values(w.picks)[0];
    if (pk) assert.strictEqual(Number(pk.is_processing), 0, "our Picking lock released");
    assert.ok(!w.calls.some((c) => c[2] === "APPLY"), "nothing was written");
  },
  CASCADEBUSY: () => {
    const w = cascadeHeld();
    w.params = { operation: "SUBMIT", gd_id: String(w.gdh.id), source: "CASCADE", cascade_ref: REF, answers: { confirmPickReversal: "Yes" }, form: w.form };
    const b = run(w, "GD_EDIT_SUBMIT", "pass B submits to a GD its own pass A holds");
    assert.strictEqual(b.out.route, "BUSY"); assert.strictEqual(b.out.job_status, "HELD"); assert.strictEqual(b.out.cascade_ref, REF, "pass B can tell it is its own hold");
    w.params = { operation: "RELEASE", gd_id: String(w.gdh.id), cascade_ref: "SO|1|another-save" };
    assert.strictEqual(run(w, "GD_EDIT_SUBMIT", "another save's RELEASE").out.route, "NONE");
    w.steps.push({ id: w.id(), job_id: w.job.id, step_name: "W0_CLAIM_" + w.job.row_version, step_status: "DONE", started_at: fmt(w.now), result_ref: "WRK|x", is_deleted: 0 });
    w.params = { operation: "RELEASE", gd_id: String(w.gdh.id), cascade_ref: REF };
    const busy = run(w, "GD_EDIT_SUBMIT", "RELEASE while the worker holds the claim gate");
    assert.strictEqual(busy.out.route, "BUSY"); assert.strictEqual(busy.out.code, "409"); assert.strictEqual(w.job.job_status, "HELD");
  },
  EXPIRE: () => {
    const w = world("REMOVE"); queued(w, true);
    run(w, "GD_EDIT_WORKER", "WORKER tick: held");
    assert.strictEqual(w.job.job_status, "HELD");
    w.now += 16 * 60000;
    run(w, "GD_EDIT_WORKER", "WORKER tick after the hold's end");
    assert.strictEqual(w.job.job_status, "CANCELLED"); assert.strictEqual(w.job.error_code, "GDE_HOLD_EXPIRED");
    assert.strictEqual(w.gdh.gd_status, "Created", "the GD back to its stored status");
    const pk = Object.values(w.picks)[0];
    if (pk) assert.strictEqual(Number(pk.is_processing), 0, "our Picking lock released");
    assert.ok(!w.calls.some((c) => c[2] === "APPLY"), "nothing was written");
  },
});
let failed = 0;
for (const sc of want.length ? want : Object.keys(scenarios)) {
  console.log(sc);
  try { scenarios[sc](); } catch (e) { failed++; console.log("  FAIL " + sc + ": " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | ")); }
}
console.log(failed ? failed + " scenario(s) failed" : "all scenarios passed");
process.exit(failed ? 1 : 0);
