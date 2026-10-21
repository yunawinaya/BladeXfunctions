// Every cached SI_CANCEL run (dev + prod) through v9 and v10: the run's own si_id, against the invoice, orders, deliveries and
// receivables its get / search nodes read. Compares the outcome, what is left on the orders / deliveries (header si_status, line
// invoice_qty / si_status / posted_qty), the receivables renamed and the invoice written.
// Usage: node replay_cancel.js <cache dir> <old SI_CANCEL json> <new SI_CANCEL json> [--verbose] [--sizes]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World, clone } = require("./world_save.js");

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined && v[k] !== null) o[k] = canon(v[k]);
    return o;
  }
  if (typeof v === "number" && Number.isFinite(v)) return Number(v.toPrecision(15));
  return v;
};
const J = (v) => JSON.stringify(canon(v));
const tenantOf = (text) => (text.match(/tenant_id = '([^']*)'/) || [])[1];
const idAfter = (text, after) => {
  const i = text.indexOf(after);
  const m = text.slice(i + after.length).match(/^\s*\(([0-9,\s]*)\)/) || text.slice(i + after.length).match(/^\s*=\s*([0-9]+)/);
  return m ? m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0") : [];
};

function cancelWorld(rec, tenantId) {
  return () => {
    const w = new World({}, { tenantId });
    const si = rec.get_node_FPExdl9O && rec.get_node_FPExdl9O.data && !Array.isArray(rec.get_node_FPExdl9O.data) ? clone(rec.get_node_FPExdl9O.data) : null;
    const docs = (nid) => (rec[nid] && Array.isArray(rec[nid].data) ? rec[nid].data : []);
    for (const d of docs("search_node_V3rnGDPj")) w.addDoc(w.so, d, "table_so");
    for (const d of docs("search_node_Gvy1Uni8")) w.addDoc(w.gd, d, "table_gd");
    const ar = docs("search_node_CuUfIpII");
    w.ar = {};
    for (const a of ar) w.ar[String(a.id)] = { ar_invoice_no: a.ar_invoice_no };
    const siLines = [];
    if (si) {
      w.si[String(si.id)] = si;
      for (const l of si.table_si || []) {
        const row = Object.assign({}, l);
        delete row.children;
        siLines.push(row);
        for (const c of Array.isArray(l.children) ? l.children : []) siLines.push(Object.assign({ parent_id: l.id }, c, { children: undefined }));
      }
    }
    const searchDocs = (store, lineKey) => (a) => {
      const ids = (Array.isArray(a.id) ? a.id : a.id === undefined || a.id === null ? [] : [a.id]).map(String);
      const rows = ids.filter((id) => store[id]).map((id) => w.shape(store[id], lineKey));
      return { total: rows.length, count: rows.length, data: rows };
    };
    w.read.get_node_FPExdl9O = () => (si ? { count: 1, data: clone(si) } : { count: 0, data: {} });
    w.read.search_node_V3rnGDPj = searchDocs(w.so, "table_so");
    w.read.search_node_Gvy1Uni8 = searchDocs(w.gd, "table_gd");
    w.read.search_node_CuUfIpII = () => ({ total: ar.length, count: ar.length, data: clone(ar) });
    const big = (v) => (v === undefined || v === null ? null : String(v));
    const check = (text) => {
      if (tenantOf(text) !== tenantId) throw new Error("sql tenant " + tenantOf(text));
    };
    w.sql.sql_node_sic_head = (text) => {
      check(text);
      if (!si || idAfter(text, "AND s.id")[0] !== String(si.id)) return [];
      return [{ j: JSON.stringify({ id: String(si.id), so_id: si.so_id === undefined ? null : si.so_id, gd_id: si.gd_id === undefined ? null : si.gd_id,
        si_status: si.si_status === undefined ? null : si.si_status, sales_invoice_no: si.sales_invoice_no === undefined ? null : si.sales_invoice_no }) }];
    };
    w.sql.sql_node_sic_lines = (text) => {
      check(text);
      if (!si || idAfter(text, "AND l.sales_invoice_id")[0] !== String(si.id)) return [];
      return siLines.slice().sort((x, y) => (BigInt(String(x.id)) < BigInt(String(y.id)) ? -1 : 1)).map((l) => ({ j: JSON.stringify({
        doc: String(si.id), id: String(l.id), parent_id: big(l.parent_id), line_so_id: l.line_so_id === undefined ? null : l.line_so_id,
        so_line_id: big(l.so_line_id), line_gd_id: big(l.line_gd_id), gd_line_id: big(l.gd_line_id), invoice_qty: l.invoice_qty === undefined ? null : l.invoice_qty }) }));
    };
    w.sql.sql_node_sic_ar = (text) => {
      check(text);
      return ar.slice().sort((x, y) => (BigInt(String(x.id)) < BigInt(String(y.id)) ? -1 : 1)).map((a) => ({ j: JSON.stringify({ id: String(a.id), ar_invoice_no: a.ar_invoice_no === undefined ? null : a.ar_invoice_no }) }));
    };
    w.sql.sql_node_sic_so = (text) => w.sqlLines(text, w.so, "s.id IN", "sales_order_axszx8cj_sub", ["id", "parent_id", "so_quantity", "invoice_qty", "posted_qty", "si_status"], ["id", "parent_id"]);
    w.sql.sql_node_sic_gd = (text) => w.sqlLines(text, w.gd, "g.id IN", "goods_delivery_fwii8mvb_sub", ["id", "parent_id", "gd_qty", "invoice_qty", "si_status"], ["id", "parent_id"]);
    return w;
  };
}

function runOnce(doc, makeWorld, params) {
  const w = makeWorld();
  const e = new Engine(doc, w, {});
  let r;
  try {
    r = e.run(clone(params));
  } catch (err) {
    return { crash: String(err.message || err).split("\n")[0], sizes: e.sizes || {} };
  }
  const o = r.outcome || {};
  return { outcome: { code: o.code, msg: o.msg, data: o.data }, counters: w.counters(), ar: w.ar, si: Object.fromEntries(Object.entries(w.si).map(([k, v]) =>
    [k, { si_status: v.si_status, sales_invoice_no: v.sales_invoice_no }])), sizes: e.sizes };
}

module.exports = { cancelWorld, runOnce };
if (require.main === module) {
const [cache, oldFile, newFile] = process.argv.slice(2);
const OLD = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));
const stats = { runs: 0, same: 0, differ: 0, skipped: 0, outcomes: {} };
const fails = [];
for (const f of fs.readdirSync(path.join(cache, "runs")).filter((x) => /_SI_CANCEL_\d+\.json$/.test(x)).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(cache, "runs", f), "utf8"));
  const req = L.parseJ(r.request_json_data) || {};
  const wp = req.workflowparams || req.request_json || {};
  const rec = {};
  let offloaded = false;
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !x.node_id) continue;
    if (x.response_is_writer_file) offloaded = true;
    const o = L.parseJ(x.response_json_data);
    if (o && typeof o === "object" && "data" in o) rec[x.node_id] = o.data;
  }
  if (!wp.si_id || offloaded) {
    stats.skipped++;
    continue;
  }
  stats.runs++;
  const mk = cancelWorld(rec, String(r.tenant_id || "000000"));
  const a = runOnce(OLD, mk, { si_id: wp.si_id });
  const b = runOnce(NEW, mk, { si_id: wp.si_id });
  const oc = a.crash ? "crash" : String(a.outcome.code);
  stats.outcomes[oc] = (stats.outcomes[oc] || 0) + 1;
  const problems = [];
  if (a.crash || b.crash) {
    if (!(a.crash && b.crash)) problems.push("crash: old=" + (a.crash || "-") + " new=" + (b.crash || "-"));
  } else {
    for (const k of ["outcome", "counters", "ar", "si"]) if (J(a[k]) !== J(b[k])) problems.push(k + ": " + J(a[k]).slice(0, 300) + " vs " + J(b[k]).slice(0, 300));
  }
  if (problems.length) {
    stats.differ++;
    fails.push(f + ": " + problems.join(" | "));
  } else stats.same++;
  if (process.argv.includes("--verbose")) console.log((problems.length ? "FAIL " : "ok   ") + f + " -> " + oc + (a.crash ? " (" + a.crash + ")" : ""));
}
console.log("runs " + stats.runs + " | same " + stats.same + " | differ " + stats.differ + " | skipped " + stats.skipped + " | v9 outcomes " + JSON.stringify(stats.outcomes));
for (const x of fails.slice(0, 12)) console.log("  " + x.slice(0, 900));
}
