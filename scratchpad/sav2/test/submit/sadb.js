// In-memory tables + the SQL mocks of SA_V2_SUBMIT (test only). Each mock returns what its SELECT returns on MySQL (ids as text,
// the same column names / JSON_OBJECT rows), computed from these tables; every mock first checks that the SQL the engine
// injected names the values it uses (a placeholder pointing at the wrong node would fail here, not pass silently).
// Writes keep the platform's unique indexes (Idempotency Key, Job Step, Document Number) and its numbering ('issued' + a rule id
// -> a new number on every add / update that writes it), and log their order.
const T = "000000";

class SADB {
  constructor() {
    this.tenantId = T;
    this.now = Date.UTC(2026, 9, 16, 2, 0, 0);
    this.seq = 3100000000000000000n;
    this.numSeq = 0;
    this.t = { job: [], step: [], sa: [], sal: [], sc: [], scl: [], items: [], wa: [], fifo: [], bal: [], bbal: [], bins: [], uoms: [], batches: [], rules: [] };
    this.log = [];
    this.factsSnapshot = null; // a facts row to replay (a twin that read before the other run wrote)
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  fmt(ms) {
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" : "") + n;
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  }
  parse(text) {
    const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }
  advance(sec) {
    this.now += sec * 1000;
  }
  issue(r) {
    const type = r.adjustment_no_type === undefined || r.adjustment_no_type === null ? "" : String(r.adjustment_no_type);
    if (r.adjustment_no === "issued" && /^[0-9]{1,20}$/.test(type)) r.adjustment_no = "SA/20261016/" + String(++this.numSeq).padStart(4, "0");
  }
  // the stock_adjustment UNIQUE "Document Number" (adjustment_no, organization_id)
  uniqueNo(r) {
    if (r.adjustment_no && this.t.sa.some((x) => x.id !== r.id && !x.is_deleted && x.adjustment_no === r.adjustment_no && x.organization_id === r.organization_id)) {
      throw new Error("Duplicate entry for key 'Document Number'");
    }
  }
  putLines(sa, lines) {
    const keep = new Set();
    for (const l0 of lines || []) {
      const l = Object.assign({}, l0);
      if (!l.id) l.id = this.id();
      l.stock_adjustment_id = sa.id;
      l.is_deleted = 0;
      if (l.total_quantity !== undefined && l.total_quantity !== null) l.total_quantity = String(l.total_quantity);
      if (l.unit_price !== undefined && l.unit_price !== null) l.unit_price = Number(l.unit_price);
      const old = this.t.sal.find((x) => x.id === l.id);
      if (old) Object.assign(old, l);
      else this.t.sal.push(l);
      keep.add(l.id);
    }
    for (const x of this.t.sal) if (x.stock_adjustment_id === sa.id && !keep.has(x.id)) x.is_deleted = 1;
  }
  insert(table, rows) {
    const out = [];
    for (const r0 of rows) {
      const r = Object.assign({}, r0);
      delete r.__id;
      if (table === "GD Async Job") {
        if (this.t.job.some((j) => j.organization_id === r.organization_id && j.idempotency_key === r.idempotency_key)) throw new Error("Duplicate entry for key 'Idempotency Key'");
        Object.assign(r, { id: this.id(), is_deleted: 0, next_attempt_at: this.parse(r.next_attempt_at) });
        this.t.job.push(r);
        this.log.push("job+ " + r.command + " " + r.job_status + " corr=" + r.correlation_id);
      } else if (table === "GD Publish Step") {
        if (this.t.step.some((x) => x.job_id === String(r.job_id) && x.step_name === r.step_name)) throw new Error("Duplicate entry for key 'Job Step'");
        Object.assign(r, { id: this.id(), job_id: String(r.job_id), is_deleted: 0, started_at: r.started_at ? this.parse(r.started_at) : this.now });
        this.t.step.push(r);
        this.log.push("step+ " + (/^S\|/.test(r.step_name) ? r.step_name.replace(/^S\|[^|]*\|/, "S|*|") : r.job_id.replace(/[0-9]{6,}/, "<id>") + " " + r.step_name));
      } else if (table === "Stock Adjustment") {
        const lines = r.stock_adjustment;
        delete r.stock_adjustment;
        Object.assign(r, { id: this.id(), is_deleted: 0 });
        this.issue(r);
        this.uniqueNo(r);
        this.t.sa.push(r);
        this.putLines(r, Array.isArray(lines) ? lines.map((l) => Object.assign({}, l, { id: undefined })) : []);
        this.log.push("sa+ " + r.stock_adjustment_status + " lines=" + (Array.isArray(lines) ? lines.length : 0));
        r.stock_adjustment = this.t.sal.filter((l) => l.stock_adjustment_id === r.id && !l.is_deleted).map((l) => Object.assign({}, l));
      } else throw new Error("insert into " + table + " not simulated");
      out.push(JSON.parse(JSON.stringify(r)));
    }
    return out;
  }
  update(table, rows) {
    let n = 0;
    for (const r of rows) {
      const id = String(r.__id);
      const set = Object.assign({}, r);
      delete set.__id;
      delete set.id;
      if (table === "GD Async Job") {
        const j = this.t.job.find((x) => x.id === id);
        if (!j) continue;
        for (const k of Object.keys(set)) j[k] = k === "next_attempt_at" || k === "lease_expires_at" ? (set[k] ? this.parse(set[k]) : null) : set[k];
        this.log.push("job~ " + Object.keys(set).sort().join(","));
      } else if (table === "Stock Adjustment") {
        const g = this.t.sa.find((x) => x.id === id);
        if (!g) continue;
        const lines = set.stock_adjustment;
        delete set.stock_adjustment;
        const next = Object.assign({}, g, set);
        this.issue(next);
        this.uniqueNo(next);
        Object.assign(g, next);
        if (lines !== undefined) this.putLines(g, lines);
        this.log.push("sa~ " + Object.keys(set).sort().join(","));
      } else throw new Error("update of " + table + " not simulated");
      n++;
    }
    return { count: n };
  }
}

const S = (v) => (v === undefined || v === null ? null : String(v));
const must = (text, vals, id) => {
  for (const v of vals) if (!String(text).includes(String(v))) throw new Error(id + ": the SQL does not name " + v);
};
const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA", "REQUIRES_REVIEW"];
const reqOf = (j) => {
  try {
    return JSON.parse(j.request_payload);
  } catch (e) {
    return null;
  }
};
const jobObj = (j) => {
  const q = reqOf(j) || {};
  return { id: j.id, job_status: j.job_status, correlation_id: S(j.correlation_id), progress_percent: j.progress_percent, progress_message: S(j.progress_message),
    error_code: S(j.error_code), error_message: S(j.error_message), line_count: j.line_count === undefined ? null : j.line_count, action: S(q.action), sa_no: S(q.saNo),
    sc_id: S(q.scId) };
};
const byIdDesc = (a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1);
const idSet = (text) => new Set(String(text || "0").split(",").map((x) => x.trim()));
const fpSa = (l) => ({ j: JSON.stringify({ id: l.id, line_index: S(l.line_index), material_id: S(l.material_id), uom_id: S(l.uom_id), total_quantity: S(l.total_quantity),
  unit_price: l.unit_price === undefined ? null : l.unit_price, balance_index: S(l.balance_index), is_serialized_item: l.is_serialized_item === undefined ? null : l.is_serialized_item }) });
const saLinesOf = (db, saId) => db.t.sal.filter((l) => l.stock_adjustment_id === saId && !l.is_deleted)
  .sort((a, b) => (Number(a.line_index) - Number(b.line_index)) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

function mocks() {
  const out = (ctx, id) => ctx.out[id] || {};
  const lockOf = (db, jobId) => {
    const p = db.t.step.filter((x) => x.job_id === jobId && /^LOCK\|/.test(x.step_name) && !x.is_deleted).sort(byIdDesc)[0];
    if (!p) return null;
    const q = db.t.job.filter((j) => j.idempotency_key === p.result_ref && !j.is_deleted).sort(byIdDesc)[0];
    return JSON.stringify({ step: p.step_name, ref: p.result_ref, young: p.started_at > db.now - 120000, job: q ? q.job_status : null });
  };
  const sql = {
    sql_node_SSfacts: (text, ctx, e) => {
      const db = e.db;
      const g = out(ctx, "code_node_SSguard");
      must(text, [g.key, "SA|" + g.saId, "SCR|" + g.scId, "IF(" + g.formScId + " > 0, " + g.formScId + ","], "sql_node_SSfacts");
      if (db.factsSnapshot) {
        const snap = db.factsSnapshot;
        db.factsSnapshot = null;
        return snap;
      }
      const keyJob = db.t.job.filter((j) => j.idempotency_key === g.key && !j.is_deleted).sort(byIdDesc)[0];
      const sa = g.saId !== "0" ? db.t.sa.find((x) => x.id === g.saId && !x.is_deleted) : null;
      const sc = g.scId !== "0" ? db.t.sc.find((x) => x.id === g.scId && !x.is_deleted) : null;
      const saJobs = g.saId !== "0" ? db.t.job.filter((j) => !j.is_deleted && j.command === "COMPLETE_SA" && j.correlation_id === "SA|" + g.saId).sort(byIdDesc) : [];
      const scJobs = g.scId !== "0" ? db.t.job.filter((j) => !j.is_deleted && j.command === "COMPLETE_SA" && (reqOf(j) || {}).scId === g.scId).sort(byIdDesc) : [];
      const open = saJobs.filter((j) => OPEN.includes(j.job_status));
      const scOpen = scJobs.filter((j) => OPEN.includes(j.job_status));
      const link = sa && sa.sa_v2_job_id ? db.t.job.find((j) => j.id === String(sa.sa_v2_job_id) && j.command === "COMPLETE_SA" && !j.is_deleted) : null;
      const proc = sc ? db.t.sa.filter((x) => !x.is_deleted && x.stock_count_id === sc.id && x.stock_adjustment_status === "Processing").sort(byIdDesc)[0] : null;
      const reuse = sa && sa.adjustment_no ? saJobs.filter((j) => (reqOf(j) || {}).issuedNo === sa.adjustment_no).length : 0;
      // FORM: the SC the record names (the form's id, else the stored SA's) - another Processing SA, open REVIEW jobs, its SCR lock
      const fsc = g.formScId && g.formScId !== "0" ? g.formScId : sa && sa.stock_count_id ? String(sa.stock_count_id) : "0";
      const fProc = fsc !== "0" ? db.t.sa.filter((x) => !x.is_deleted && String(x.stock_count_id) === fsc && x.id !== g.saId && x.stock_adjustment_status === "Processing")
        .sort(byIdDesc)[0] : null;
      const fOpen = fsc !== "0" ? db.t.job.filter((j) => !j.is_deleted && j.command === "COMPLETE_SA" && OPEN.includes(j.job_status) && (reqOf(j) || {}).source === "REVIEW"
        && (reqOf(j) || {}).scId === fsc) : [];
      return [{
        db_now: db.fmt(db.now), key_job: keyJob ? JSON.stringify(jobObj(keyJob)) : null,
        sa_id: sa ? sa.id : null, adjustment_no: sa ? S(sa.adjustment_no) : null, stock_adjustment_status: sa ? S(sa.stock_adjustment_status) : null,
        organization_id: sa ? S(sa.organization_id) : null, plant_id: sa ? S(sa.plant_id) : null, no_type: sa ? S(sa.adjustment_no_type) : null,
        stock_count_id: sa ? S(sa.stock_count_id) : null, sa_v2_job_id: sa ? S(sa.sa_v2_job_id) : null,
        sa_lock: g.saId !== "0" ? lockOf(db, "SAC|" + g.saId) : null,
        open_jobs: open.length ? JSON.stringify(open.map(jobObj)) : null, last_job: saJobs[0] ? JSON.stringify(jobObj(saJobs[0])) : null,
        link_job: link ? JSON.stringify(jobObj(link)) : null, issued_reuse: reuse,
        sc_id: sc ? sc.id : null, stock_count_status: sc ? S(sc.stock_count_status) : null, sc_review_status: sc ? S(sc.review_status) : null,
        sc_organization_id: sc ? S(sc.organization_id) : null,
        sc_processing_sa: proc ? JSON.stringify({ id: proc.id, no: proc.adjustment_no, job: S(proc.sa_v2_job_id) }) : null,
        sc_open_jobs: scOpen.length ? JSON.stringify(scOpen.map(jobObj)) : null, sc_last_job: scJobs[0] ? JSON.stringify(jobObj(scJobs[0])) : null,
        sc_lock: g.scId !== "0" ? lockOf(db, "SCR|" + g.scId) : null,
        fsc_processing_sa: fProc ? JSON.stringify({ id: fProc.id, no: fProc.adjustment_no, job: S(fProc.sa_v2_job_id) }) : null,
        fsc_open_jobs: fOpen.length ? JSON.stringify(fOpen.map(jobObj)) : null, fsc_lock: fsc !== "0" ? lockOf(db, "SCR|" + fsc) : null,
      }];
    },
    sql_node_SSscLines: (text, ctx, e) => {
      const g = out(ctx, "code_node_SSguard");
      must(text, ["stock_count_id = " + g.scId], "sql_node_SSscLines");
      return e.db.t.scl.filter((l) => l.stock_count_id === g.scId && !l.is_deleted).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .map((l) => ({ j: JSON.stringify({ id: l.id, line_index: S(l.line_index), line_status: S(l.line_status), review_status: S(l.review_status),
          is_counted: l.is_counted === undefined ? null : l.is_counted, count_qty: l.count_qty, adjusted_qty: l.adjusted_qty === undefined ? null : l.adjusted_qty,
          variance_qty: l.variance_qty }) }));
    },
    sql_node_SSitems: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, [k.itemIdsSql], "sql_node_SSitems");
      const ids = idSet(k.itemIdsSql);
      return e.db.t.items.filter((i) => ids.has(i.id)).map((i) => ({ j: JSON.stringify({ id: i.id, material_code: i.material_code,
        serial_number_management: i.serial_number_management === undefined ? null : i.serial_number_management,
        material_costing_method: i.material_costing_method || null, stock_control: i.stock_control === undefined ? null : i.stock_control }) }));
    },
    sql_node_SScost: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, [k.itemIdsSql, k.batchIdsSql, "'" + k.organizationId + "'"], "sql_node_SScost");
      const items = idSet(k.itemIdsSql);
      const batches = idSet(k.batchIdsSql);
      const groups = {};
      const add = (t, m, b, p) => {
        const key = t + "|" + m + "|" + b + "|" + p;
        groups[key] = groups[key] || { t, m, b, p, n: 0 };
        groups[key].n++;
      };
      for (const w of e.db.t.wa) {
        if (w.organization_id !== k.organizationId || !items.has(w.material_id)) continue;
        const b = w.batch_id || "0";
        if (batches.has(b)) add("W", w.material_id, b, w.plant_id);
        add("A", w.material_id, "0", w.plant_id);
      }
      for (const f of e.db.t.fifo) {
        if (f.organization_id !== k.organizationId || !items.has(f.material_id)) continue;
        const b = f.batch_id || "0";
        if (batches.has(b)) add("F", f.material_id, b, f.plant_id);
      }
      return Object.values(groups).map((x) => ({ j: JSON.stringify(x) }));
    },
    sql_node_SSstored: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["'" + k.needStored + "' = 'YES'", "stock_adjustment_id = " + k.storedSaId], "sql_node_SSstored");
      return k.needStored === "YES" ? saLinesOf(e.db, k.storedSaId).map(fpSa) : [];
    },
    sql_node_SShdr: (text, ctx, e) => {
      const r = out(ctx, "code_node_SSrow");
      must(text, ["'" + r.jobId + "'"], "sql_node_SShdr");
      return e.db.t.sa.filter((g) => !g.is_deleted && String(g.sa_v2_job_id) === r.jobId).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .map((g) => ({ id: g.id, adjustment_no: S(g.adjustment_no), stock_adjustment_status: S(g.stock_adjustment_status), sa_v2_job_id: S(g.sa_v2_job_id) }));
    },
    sql_node_SSlines: (text, ctx, e) => {
      const r = out(ctx, "code_node_SSrow");
      const p = out(ctx, "code_node_SSpost");
      must(text, ["'" + p.linesBack + "' = 'YES'", "'" + r.jobId + "'"], "sql_node_SSlines");
      if (p.linesBack !== "YES") return [];
      const g = e.db.t.sa.filter((x) => !x.is_deleted && String(x.sa_v2_job_id) === r.jobId).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];
      return g ? saLinesOf(e.db, g.id).map(fpSa) : [];
    },
    sql_node_SSback: (text, ctx, e) => {
      const db = e.db;
      const g = out(ctx, "code_node_SSguard");
      must(text, ["'" + g.key + "'"], "sql_node_SSback");
      const j = db.t.job.filter((x) => x.idempotency_key === g.key && !x.is_deleted).sort(byIdDesc)[0];
      if (!j) return [];
      const m = String(j.correlation_id || "").match(/^SA\|([0-9]{1,20})$/);
      const sa = m ? db.t.sa.find((x) => x.id === m[1] && !x.is_deleted) : null;
      const lk = m ? db.t.step.filter((x) => x.job_id === "SAC|" + m[1] && /^LOCK\|/.test(x.step_name) && !x.is_deleted).sort(byIdDesc)[0] : null;
      return [{ job_id: j.id, job_status: j.job_status, correlation_id: S(j.correlation_id), stock_adjustment_status: sa ? S(sa.stock_adjustment_status) : null,
        adjustment_no: sa ? S(sa.adjustment_no) : null, sa_v2_job_id: sa ? S(sa.sa_v2_job_id) : null, lock_ref: lk ? lk.result_ref : null,
        parts: db.t.step.filter((x) => x.job_id === j.id && /^S\|/.test(x.step_name) && !x.is_deleted).length }];
    },
    // the review reads: what code/shared/review_sql.py's SELECTs return (JSON_OBJECT rows, ids / decimals CAST AS CHAR)
    sql_node_SSrvItems: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["IN (" + k.rvMatSql + ")"], "sql_node_SSrvItems");
      const ids = idSet(k.rvMatSql);
      return e.db.t.items.filter((i) => ids.has(i.id)).map((i) => ({ j: JSON.stringify({ id: i.id, material_code: i.material_code, material_name: i.material_name,
        item_batch_management: i.item_batch_management === undefined ? 0 : i.item_batch_management, material_costing_method: i.material_costing_method || null,
        purchase_unit_price: i.purchase_unit_price === undefined ? null : String(i.purchase_unit_price),
        table_uom_conversion: (i.uomconv || []).length ? i.uomconv.map((u) => ({ id: u.id, alt_uom_id: u.alt_uom_id, base_uom_id: u.base_uom_id, alt_qty: String(u.alt_qty),
          base_qty: String(u.base_qty) })) : null }) }));
    },
    sql_node_SSrvBalances: (text, ctx, e) => balances(e.db.t.bal, out(ctx, "code_node_SSkeys"), text, false),
    sql_node_SSrvBatchBalances: (text, ctx, e) => balances(e.db.t.bbal, out(ctx, "code_node_SSkeys"), text, true),
    sql_node_SSrvBins: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["IN (" + k.rvLocSql + ")"], "sql_node_SSrvBins");
      const ids = idSet(k.rvLocSql);
      return e.db.t.bins.filter((b) => ids.has(b.id)).map((b) => ({ j: JSON.stringify({ id: b.id, bin_location_combine: b.bin_location_combine, plant_id: b.plant_id }) }));
    },
    sql_node_SSrvUoms: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["IN (" + k.rvUomSql + ")"], "sql_node_SSrvUoms");
      const ids = idSet(k.rvUomSql);
      return e.db.t.uoms.filter((u) => ids.has(u.id)).map((u) => ({ j: JSON.stringify({ id: u.id, uom_name: u.uom_name }) }));
    },
    sql_node_SSrvBatches: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["IN (" + k.rvBatchSql + ")"], "sql_node_SSrvBatches");
      const ids = idSet(k.rvBatchSql);
      return e.db.t.batches.filter((b) => ids.has(b.id)).map((b) => ({ j: JSON.stringify({ id: b.id, batch_number: b.batch_number }) }));
    },
    sql_node_SSrvCosts: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["IN (" + k.rvMatSql + ")", "'" + k.organizationId + "'"], "sql_node_SSrvCosts");
      const ids = idSet(k.rvMatSql);
      return e.db.t.wa.filter((w) => ids.has(w.material_id) && w.organization_id === k.organizationId && Number(w.wa_cost_price) > 0)
        .map((w) => ({ j: JSON.stringify({ src: "WA", material_id: w.material_id, plant_id: w.plant_id, batch_id: w.batch_id || null, cost: String(w.wa_cost_price), rn: "1",
          rn_any: "1" }) }));
    },
    sql_node_SSrvPrefix: (text, ctx, e) => {
      const k = out(ctx, "code_node_SSkeys");
      must(text, ["department_id = " + k.organizationId], "sql_node_SSrvPrefix");
      return e.db.t.rules.filter((r) => r.department_id === k.organizationId && r.is_default === 1).map((r) => ({ j: JSON.stringify({ id: r.id, rule_name: r.rule_name,
        business_type: "Stock Adjustment", department_id: r.department_id, is_default: 1, is_draft: r.is_draft || 0, tenant_id: T }) }));
    },
  };
  function balances(rows, k, text, batch) {
    must(text, ["IN (" + k.rvMatSql + ")", "IN (" + k.rvLocSql + ")"], batch ? "sql_node_SSrvBatchBalances" : "sql_node_SSrvBalances");
    const m = idSet(k.rvMatSql);
    const l = idSet(k.rvLocSql);
    return rows.filter((b) => m.has(b.material_id) && l.has(b.location_id)).map((b) => ({ j: JSON.stringify(Object.assign({ id: b.id, material_id: b.material_id,
      plant_id: b.plant_id, location_id: b.location_id }, batch ? { batch_id: b.batch_id } : {}, { balance_quantity: String(b.balance_quantity),
      unrestricted_qty: String(b.unrestricted_qty), block_qty: "0.000", qualityinsp_qty: "0.000", reserved_qty: "0.000", intransit_qty: "0.000",
      organization_id: b.organization_id, tenant_id: T, create_user: "1", create_time: "2026-10-01 10:00:00", create_dept: b.organization_id, update_user: "1",
      update_time: "2026-10-01 10:00:00", is_deleted: 0, material_uom: b.material_uom || null })) }));
  }
  return { sql, read: {} };
}

module.exports = { SADB, mocks, T };
