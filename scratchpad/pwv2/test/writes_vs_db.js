// Harness (c): the manifest's TO / IT / GR parts of each recorded confirmation (pwPlanA on the run's own reads + the V2
// request derived from what its client sent) vs what that classic run wrote:
//   TO       the TO as the NEXT recorded PUTAWAY run of it read it (get_node_C64LC1sr), else today's SQL rows (run_prepare_sql)
//            - to_status, every line (patched columns = after; the rest unchanged), the records the run appended
//   IT       today's in_transit_detail rows of the GR (by id for the updates; the creates by source_transit_id + quantity)
//   GR       today's goods_receiving row, when this was the last recorded confirmation of the GR
// Static columns only: what a later flow rewrites (a later confirmation, a GR revert) is reported apart, not as a difference.
// usage: TZ=Asia/Kuala_Lumpur node writes_vs_db.js <runs.jsonl> [...] --sql <sqldir>
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const args = process.argv.slice(2);
const sqldir = args[args.indexOf("--sql") + 1];
const files = args.filter((a, i) => a !== "--sql" && args[i - 1] !== "--sql");
const s = (v) => (v === undefined || v === null ? "" : String(v));
const num = (v) => Number(v || 0);
const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
const day = (v) => s(v).slice(0, 10);
const eqv = (a, b) => {
  const e = (v) => v === undefined || v === null || v === "";
  if (e(a) && e(b)) return true;
  if (e(a) || e(b)) return false;
  const na = Number(a);
  const nb = Number(b);
  if (/^-?\d{1,15}(\.\d+)?$/.test(s(a).trim()) && /^-?\d{1,15}(\.\d+)?$/.test(s(b).trim())) return Math.abs(na - nb) < 1e-9;
  return s(a) === s(b);
};

const sb = (() => {
  const c = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp };
  const RealDate = Date;
  let now = RealDate.now();
  function FakeDate(...a) {
    if (!(this instanceof FakeDate)) return new RealDate(now).toString();
    return a.length ? new RealDate(...a) : new RealDate(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  c.Date = FakeDate;
  c.__setNow = (t) => { now = t; };
  vm.createContext(c);
  for (const f of ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js"]) vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), c, { filename: f });
  vm.runInContext("this.pwPlanA = pwPlanA; this.pwAdapt = pwAdapt; this.pwBbalKey = pwBbalKey;", c);
  return c;
})();
const processed = (r) => r.line_status !== "Cancelled" && !(r.parent_or_child === "Parent" && r.is_split === "Yes") && !(r.item_bundle_id && !r.item_code) && num(r.putaway_qty) > 0;
// as chain_parity.js: the client's rows -> the V2 request
function deriveRequest(recAll, stored) {
  const top = stored.table_putaway_item || [];
  const byId = {};
  for (const l of flat(top)) byId[s(l.id)] = l;
  const used = {};
  const pairs = [];
  let k = -1;
  for (const r of recAll.table_putaway_item || []) {
    if (r.parent_or_child === "Child") continue;
    k++;
    let st = r.id && byId[s(r.id)] ? byId[s(r.id)] : null;
    if (!st) st = top.find((l) => !used[s(l.id)] && s(l.line_index) === s(r.line_index) && s(l.item_code) === s(r.item_code)) || null;
    if (!st && top[k] && !used[s(top[k].id)] && s(top[k].item_code) === s(r.item_code)) st = top[k];
    if (st) used[s(st.id)] = true;
    pairs.push({ rec: r, line: st, child: 0 });
  }
  for (const r of recAll.table_putaway_item || []) {
    if (r.parent_or_child !== "Child") continue;
    const n = s(r.line_index).split(" - ")[0];
    const c = pairs.filter((p) => !p.child && p.line);
    const p = c.find((x) => x.rec.is_split === "Yes" && String(num(x.rec.parent_index) + 1) === n && s(x.rec.item_code) === s(r.item_code)) ||
      c.find((x) => x.rec.is_split === "Yes" && s(x.rec.item_code) === s(r.item_code));
    pairs.push({ rec: r, line: p ? p.line : null, child: 1 });
  }
  const lines = [];
  for (const p of pairs) {
    if (!p.line || !processed(p.rec)) continue;
    const o = Object.assign(p.child ? { parent_id: s(p.line.id) } : { id: s(p.line.id) }, { qty: num(p.rec.putaway_qty) });
    for (const f of ["target_location", "storage_location", "target_inv_category", "remark"]) if (p.rec[f] !== undefined && p.rec[f] !== null) o[f] = s(p.rec[f]);
    lines.push(o);
  }
  return lines;
}

// every run, in time order, per TO and per GR
const runs = [];
for (const f of files) for (const l of fs.readFileSync(f, "utf8").split("\n")) if (l.trim()) runs.push(JSON.parse(l));
runs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
const okRuns = runs.filter((r) => r.exit === "return_node_NUcmslK4" && r.nodes.get_node_C64LC1sr);
const T = { runs: 0, notEligible: 0, planFailed: 0, afterFrom: { nextRun: 0, todaySql: 0, none: 0 },
  to_status: { same: 0, diff: 0 }, lines: { same: 0, diff: 0, laterChanged: 0 }, lineIdsKept: { yes: 0, no: 0 }, recordIdsKept: { yes: 0, no: 0 },
  records: { same: 0, diff: 0, known: {} }, itUpdates: { same: 0, diff: 0, laterChanged: 0, missing: 0 }, itCreates: { same: 0, diff: 0, missing: 0 },
  gr: { same: 0, diff: 0, notLast: 0 } };
const notes = [];
const note = (r, t) => notes.push(`${r.env} ${r.id}: ${t}`);
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);
const sqlCache = {};
const sqlOf = (env, toId) => {
  const k = env + "_" + toId;
  if (sqlCache[k] === undefined) {
    const f = path.join(sqldir, k + ".json");
    let raw = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
    // today's in-transit rows: every column (PREPARE's own read keys the closed ones only)
    if (raw && !raw.transit_audit) throw new Error(f + ": no transit_audit - run run_prepare_sql.py <env> <dir> --add-audit");
    if (raw) raw = Object.assign({}, raw, { transit: raw.transit_audit });
    sqlCache[k] = raw ? sb.pwAdapt(raw) : null;
  }
  return sqlCache[k];
};

for (const r of okRuns) {
  const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
  const stored = JSON.parse(JSON.stringify(rec("get_node_C64LC1sr").data));
  const recAll = r.params.allData;
  if (flat(stored.table_putaway_item).some((l) => s(l.item_bundle_id) || (l.children && l.children.length)) ||
    flat(recAll.table_putaway_item).some((x) => processed(x) && (s(x.hu_data) || s(x.handling_unit_id) || num(x.is_serialized_item) === 1))) { T.notEligible++; continue; }
  T.runs++;
  const toId = s(stored.id);
  const subs = (r.subs || []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const bbal = {};
  for (const c of subs) if (c.params.batch_id) {
    const d = (c.resp && c.resp.data) || {};
    bbal[sb.pwBbalKey(c.params.material_id, c.params.location_id, c.params.batch_id)] = { manufacturing_date: d.manufacturing_date, expired_date: d.expired_date };
  }
  const items = rec("code_node_PwItems") ? rec("code_node_PwItems").items : rec("search_node_6yzlT81I") ? rec("search_node_6yzlT81I").data : [];
  const transit = rec("code_node_PwTransit") ? rec("code_node_PwTransit").rows : rec("search_node_ITopen") ? rec("search_node_ITopen").data : [];
  stored.is_processing = 1;
  const A = {
    to: { count: 1, data: stored }, hdr: null, items: items, itemFlags: {}, transit: transit, setup: rec("get_node_ca2032Ub") || { count: 0, data: {} },
    others: rec("search_node_SVMdNd3K") || { total: 0, count: 0, data: [] }, qi: rec("search_node_T5BGLPpK") || { total: 0, count: 0, data: [] },
    gr: { id: s(stored.gr_no) }, bbal: bbal, lock: { step_name: "LOCK|1", result_ref: "K" }, cost: [],
  };
  const entry = { route: "GO", jobId: "2200000000000000001", tenantId: r.tenant, toId: toId, grId: s(stored.gr_no), organizationId: s(stored.organization_id),
    idempotencyKey: "K", nonce: "abcdefgh", request: { v: 1, source: "TEST", lines: deriveRequest(recAll, stored), confirmedBy: r.params.confirmed_by } };
  sb.__setNow((r.nodes.code_node_qfSZO0bi && r.nodes.code_node_qfSZO0bi.t0) || r.t0);
  const plan = sb.pwPlanA(entry, A);
  if (plan.route !== "READY") { T.planFailed++; note(r, `plan ${plan.code} ${plan.message}`); continue; }
  const parts = plan.__parts;
  // ------------------------------------------------------------------ TO after this run
  const next = okRuns.find((x) => BigInt(x.id) > BigInt(r.id) && x.nodes.get_node_C64LC1sr && s(x.nodes.get_node_C64LC1sr.resp.data.data.id) === toId);
  let after = null;
  let from = "none";
  if (next) { after = next.nodes.get_node_C64LC1sr.resp.data.data; from = "nextRun"; }
  else { const q = sqlOf(r.env, toId); if (q && q.to.count) { after = q.to.data; from = "todaySql"; } }
  bump(T.afterFrom, from);
  if (after) {
    if (s(after.to_status) === s(parts.TO.to_status)) T.to_status.same++;
    else { T.to_status.diff++; note(r, `to_status ${parts.TO.to_status} | after ${after.to_status} (${from})`); }
    const afterLines = {};
    for (const l of flat(after.table_putaway_item)) afterLines[s(l.id)] = l;
    const before = flat(stored.table_putaway_item);
    if (before.every((l) => afterLines[s(l.id)])) T.lineIdsKept.yes++; else T.lineIdsKept.no++;
    const patch = {};
    for (const p of parts.TO.lines) patch[p.id] = p;
    for (const l of before) {
      const a = afterLines[s(l.id)];
      if (!a) continue;
      const p = patch[s(l.id)];
      const bad = [];
      for (const c of ["pending_process_qty", "line_status", "putaway_qty", "target_location", "remark", "is_split", "parent_or_child"]) {
        const want = p && c in p.after ? p.after[c] : l[c];
        if (!eqv(want, a[c])) bad.push(`${c} ${JSON.stringify(want)} | after ${JSON.stringify(a[c])}`);
      }
      if (!bad.length) T.lines.same++;
      else if (from === "todaySql") { T.lines.laterChanged++; }
      else { T.lines.diff++; note(r, `line ${s(l.line_index)}: ` + bad.join("; ")); }
    }
    // records: the ones the run appended (ids not in the stored TO) in order, vs the manifest's
    const beforeIds = new Set(flat(stored.table_putaway_records).map((x) => s(x.id)));
    const afterRecs = flat(after.table_putaway_records);
    if ([...beforeIds].every((id) => afterRecs.some((x) => s(x.id) === id))) T.recordIdsKept.yes++; else T.recordIdsKept.no++;
    const added = afterRecs.filter((x) => !beforeIds.has(s(x.id)));
    // a later confirmation appends more: only this run's (the first ones, in id order) are compared
    const mine = parts.TO.records;
    const theirs = added.slice(0, mine.length);
    if (theirs.length < mine.length) { T.records.diff++; note(r, `records: ${mine.length} planned, ${theirs.length} appended`); }
    else {
      let bad = [];
      mine.forEach((m, i) => {
        const t = theirs[i];
        for (const c of ["line_index", "item_code", "item_name", "item_desc", "batch_no", "source_inv_category", "target_inv_category", "store_in_qty", "item_uom", "target_location", "remark", "confirmed_by"]) {
          if (eqv(m[c], t[c])) continue;
          if (c === "item_desc" && s(t[c]) === "") { bump(T.records.known, "item_desc: the stored description (the mobile client omitted it)"); continue; }
          bad.push(`#${i} ${c} ${JSON.stringify(m[c])} | ${JSON.stringify(t[c])}`);
        }
        // confirmed_at: the platform keeps the date only (the records column is a date field)
        if (day(m.confirmed_at) !== day(t.confirmed_at)) {
          if (Math.abs(Date.parse(day(m.confirmed_at)) - Date.parse(day(t.confirmed_at))) <= 86400000) bump(T.records.known, "confirmed_at: the date part only");
          else bad.push(`#${i} confirmed_at ${m.confirmed_at} | ${t.confirmed_at}`);
        }
      });
      if (bad.length) { T.records.diff++; note(r, "records: " + bad.slice(0, 4).join("; ")); } else T.records.same++;
    }
  }
  // ------------------------------------------------------------------ IT
  const q = sqlOf(r.env, toId);
  if (q) {
    const today = {};
    for (const t of q.transit) today[s(t.id)] = t;
    for (const u of parts.IT.updates) {
      const t = today[s(u.id)];
      if (!t) { T.itUpdates.missing++; continue; }
      const bad = [];
      for (const c of ["transit_qty", "received_qty", "open_qty", "status", "to_bin", "to_category", "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id"]) {
        let want = u[c];
        // the classic wrote "" where the client sent no line id; V2 writes the stored line id
        if (c === "target_doc_line_id" && s(t[c]) === "" && s(want) !== "") { bump(T.records.known, "IT target_doc_line_id: V2's stored line id (the classic wrote '')"); continue; }
        if (!eqv(want, t[c])) bad.push(`${c} ${JSON.stringify(want)} | today ${JSON.stringify(t[c])}`);
      }
      if (day(u.received_date) !== day(t.received_date)) bad.push(`received_date ${u.received_date} | today ${t.received_date}`);
      if (!bad.length) T.itUpdates.same++;
      else if (s(t.status) === "Cancelled") T.itUpdates.laterChanged++;
      else { T.itUpdates.diff++; note(r, `IT update ${u.id}: ` + bad.join("; ")); }
    }
    const used = new Set();
    for (const c of parts.IT.creates) {
      // a row the run inserted: its snowflake id falls inside the run; a later confirmation may since have consumed it
      const hi = BigInt(r.t1 + 3000 - 1288834974657) << 22n;
      const inRun = (t) => BigInt(t.id) > BigInt(r.id) && BigInt(t.id) < hi && s(t.source_transit_id) === s(c.source_transit_id);
      const hit = q.transit.find((t) => !used.has(s(t.id)) && inRun(t) && eqv(t.transit_qty, c.transit_qty)) ||
        q.transit.find((t) => !used.has(s(t.id)) && inRun(t) && s(c.status) === "In Transit");
      if (!hit) { T.itCreates.missing++; note(r, `IT create (source ${c.source_transit_id}, ${c.transit_qty}, ${c.status}) not found today`); continue; }
      used.add(s(hit.id));
      const bad = [];
      for (const k of ["doc_type", "doc_id", "doc_no", "doc_line_id", "line_no", "parent_id", "parent_no", "parent_line_id", "material_id", "item_code", "item_uom", "batch_id",
        "plant_id", "organization_id", "transit_bin", "to_plant_id", "to_category"]) if (!eqv(c[k], hit[k])) bad.push(`${k} ${JSON.stringify(c[k])} | today ${JSON.stringify(hit[k])}`);
      const later = s(hit.status) !== s(c.status) || !eqv(hit.transit_qty, c.transit_qty);
      if (!later) {
        for (const k of ["received_qty", "open_qty", "to_bin", "target_doc_type", "target_doc_id", "target_doc_no"]) if (!eqv(c[k], hit[k])) bad.push(`${k} ${JSON.stringify(c[k])} | today ${JSON.stringify(hit[k])}`);
      }
      if (bad.length) { T.itCreates.diff++; note(r, `IT create ${hit.id}: ` + bad.join("; ")); } else T.itCreates[later ? "sameStaticLaterConsumed" : "same"] = (T.itCreates[later ? "sameStaticLaterConsumed" : "same"] || 0) + 1;
    }
    // ------------------------------------------------------------------ GR (only when no later recorded confirmation of the GR)
    const later = okRuns.some((x) => BigInt(x.id) > BigInt(r.id) && s(((x.params || {}).allData || {}).gr_no) === s(stored.gr_no));
    if (later || !q.gr) T.gr.notLast++;
    else if (!s(q.gr.putaway_status) && s(q.gr.gr_status) === "Created") T.gr.revertedSince = (T.gr.revertedSince || 0) + 1;
    else if (s(q.gr.putaway_status) === s(parts.GR.putaway_status) && s(q.gr.gr_status) === s(parts.GR.gr_status)) T.gr.same++;
    else { T.gr.diff++; note(r, `GR ${parts.GR.putaway_status}/${parts.GR.gr_status} | today ${q.gr.putaway_status}/${q.gr.gr_status}`); }
  }
}
console.log(JSON.stringify(T, null, 1));
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
