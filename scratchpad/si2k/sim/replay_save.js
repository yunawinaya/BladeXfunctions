// Every cached SI_SAVE run (dev + prod) through v83 and v84: the run's own payload, against the sales orders and goods deliveries
// its search nodes read and every other read it recorded. Compares the outcome, every write to the invoice, what is left on the
// orders / deliveries (header si_status, line invoice_qty / si_status), the deleted drafts, the sub-workflow calls (credit limit,
// receivable, posting, cash payment, auto PI) and the filters of the reads both versions make.
// Usage: node replay_save.js <cache dir> <old SI_SAVE json> <new SI_SAVE json> [--verbose] [--only <file substring>] [--sizes]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World, clone } = require("./world_save.js");

// compare.js's canonical form (it requires PI's world.js, so it is not loaded here)
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


function runOnce(doc, makeWorld, params) {
  const w = makeWorld();
  const e = new Engine(doc, w, {});
  let r;
  try {
    r = e.run(clone(params));
  } catch (err) {
    return { crash: String(err.message || err).split("\n")[0], world: w, sizes: e.sizes || {} };
  }
  const o = r.outcome || {};
  const siWrites = r.writes.filter((x) => x.table === "Sales Invoice").map((x) => ({ kind: x.kind, rows: x.rows }));
  const shared = new Set(["get_node_siSrSetup1", "search_si_sopo", "search_si_its", "search_si_gdgr", "search_node_I3e7ZpkH", "get_node_oLOE8Qt7",
    "get_node_auG34VOC", "get_node_Jcmd2YdP", "get_node_PsZEEuNO"]);
  return {
    outcome: { code: o.code, msg: o.msg, data: o.data },
    siWrites,
    counters: w.counters(),
    deleted: w.deleted.slice().sort(),
    calls: w.calls,
    reads: w.readArgs.filter((x) => shared.has(x.node)),
    sizes: e.sizes,
    order: r.order,
  };
}

function diff(a, b, p, out) {
  if (out.length > 6) return out;
  const ja = J(a);
  const jb = J(b);
  if (ja === jb) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) === !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], p + "." + k, out);
    if (Array.isArray(a) && a.length !== b.length) out.push(p + ".length " + a.length + " vs " + b.length);
    return out;
  }
  out.push(p + ": " + ja.slice(0, 200) + " vs " + jb.slice(0, 200));
  return out;
}

// the status of every line of one order / delivery after the save, from the counters
function lineStatuses(counters, key) {
  const out = {};
  for (const [k, v] of Object.entries(counters || {})) if (k.startsWith(key + ":")) out[v.si_status || ""] = (out[v.si_status || ""] || 0) + 1;
  return out;
}

function compareRuns(oldDoc, newDoc, makeWorld, params) {
  const a = runOnce(oldDoc, makeWorld, params);
  const b = runOnce(newDoc, makeWorld, params);
  const problems = [];
  if (a.crash || b.crash) {
    if (!(a.crash && b.crash)) problems.push("crash: old=" + (a.crash || "-") + " new=" + (b.crash || "-"));
    return { same: problems.length === 0, problems, a, b };
  }
  // headers: the v84 fix (header status over every line) is reported apart from everything else
  const strip = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => k.split(":").length > 2));
  const heads = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => k.split(":").length === 2));
  for (const k of ["outcome", "siWrites", "deleted", "calls", "reads"]) diff(a[k], b[k], k, problems);
  diff(strip(a.counters), strip(b.counters), "lines", problems);
  const headerChanges = [];
  const ha = heads(a.counters);
  const hb = heads(b.counters);
  for (const key of new Set([...Object.keys(ha), ...Object.keys(hb)])) {
    const x = (ha[key] || {}).si_status || "";
    const y = (hb[key] || {}).si_status || "";
    if (x !== y) headerChanges.push({ key, from: x, to: y, lines: lineStatuses(b.counters, key) });
  }
  return { same: problems.length === 0, problems, headerChanges, a, b };
}

function loadRun(file) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const req = L.parseJ(r.request_json_data) || {};
  const wp = req.workflowparams || req.request_json || {};
  let data = wp.data;
  if (typeof data === "string") data = L.parseJ(data);
  const rec = {};
  const truncated = new Set();
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !x.node_id) continue;
    if (x.response_is_writer_file) {
      truncated.add(x.node_id);
      continue;
    }
    const o = L.parseJ(x.response_json_data);
    if (o && typeof o === "object" && "data" in o) rec[x.node_id] = o.data;
  }
  return { r, data, rec, truncated };
}

function worldFor(run) {
  return () => {
    const w = new World(run.rec, { tenantId: String(run.r.tenant_id || "000000") });
    const docs = (nid) => {
      const o = run.rec[nid];
      return o && Array.isArray(o.data) ? o.data : [];
    };
    for (const d of docs("search_node_NDKdFanY")) w.addDoc(w.so, d, "table_so");
    for (const d of docs("search_node_lTy219I0")) w.addDoc(w.gd, d, "table_gd");
    const stored = run.rec.get_node_fcE2I4vj;
    if (stored && stored.data && !Array.isArray(stored.data) && stored.data.id !== undefined) {
      w.si[String(stored.data.id)] = clone(stored.data);
      w.rec = Object.assign({}, w.rec, { get_node_fcE2I4vj: stored.data });
    } else {
      w.rec = Object.assign({}, w.rec);
      delete w.rec.get_node_fcE2I4vj;
    }
    return w;
  };
}

if (require.main === module) {
  const [cache, oldFile, newFile] = process.argv.slice(2);
  const VERBOSE = process.argv.includes("--verbose");
  const SIZES = process.argv.includes("--sizes");
  const oi = process.argv.indexOf("--only");
  const ONLY = oi > 0 ? process.argv[oi + 1] : null;
  const OLD = JSON.parse(fs.readFileSync(oldFile, "utf8"));
  const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));
  const stats = { runs: 0, same: 0, differ: 0, skipped: 0, skipWhy: {}, outcomes: {} };
  const fails = [];
  const sizeRows = [];
  const files = fs.readdirSync(path.join(cache, "runs")).filter((x) => /_SI_SAVE_\d+\.json$/.test(x) && (!ONLY || x.includes(ONLY))).sort();
  for (const f of files) {
    const run = loadRun(path.join(cache, "runs", f));
    const skip = (why) => {
      stats.skipped++;
      stats.skipWhy[why] = (stats.skipWhy[why] || 0) + 1;
    };
    if (!run.data || typeof run.data !== "object") {
      skip("no payload");
      continue;
    }
    if (run.truncated.has("search_node_NDKdFanY") || run.truncated.has("search_node_lTy219I0")) {
      skip("SO / GD read written to a file");
      continue;
    }
    stats.runs++;
    const res = compareRuns(OLD, NEW, worldFor(run), { data: run.data });
    const o = res.a.crash ? "crash" : String(res.a.outcome.code) + (res.a.outcome.data && res.a.outcome.data.pi_confirm ? "/411" : "");
    stats.outcomes[o] = (stats.outcomes[o] || 0) + 1;
    for (const h of res.headerChanges || []) {
      const t = h.from + " -> " + h.to;
      stats.headers = stats.headers || {};
      stats.headers[t] = (stats.headers[t] || 0) + 1;
      if (VERBOSE || process.argv.includes("--headers")) console.log("header " + f + " " + h.key + ": " + t + " " + JSON.stringify(h.lines));
    }
    if (res.same) stats.same++;
    else {
      stats.differ++;
      fails.push(f + ": " + res.problems.join(" | ").slice(0, 700));
    }
    if (SIZES && !res.a.crash && !res.b.crash) {
      const sum = (s) => Object.values(s || {}).reduce((t, x) => t + x.in + x.out, 0);
      sizeRows.push([f, sum(res.a.sizes), sum(res.b.sizes)]);
    }
    if (VERBOSE) console.log((res.same ? "ok   " : "FAIL ") + f + " -> " + o + (res.a.crash ? " (" + res.a.crash + ")" : ""));
  }
  console.log("runs " + stats.runs + " | same " + stats.same + " | differ " + stats.differ + " | skipped " + stats.skipped + " " +
    JSON.stringify(stats.skipWhy) + " | v83 outcomes " + JSON.stringify(stats.outcomes) + " | header status changed (v84 fix) " +
    JSON.stringify(stats.headers || {}));
  for (const x of fails.slice(0, 20)) console.log("  " + x);
  if (SIZES) {
    sizeRows.sort((x, y) => y[1] - x[1]);
    for (const [f, a, b] of sizeRows.slice(0, 8)) console.log("  size " + f + ": v83 " + (a / 1e6).toFixed(2) + " MB, v84 " + (b / 1e6).toFixed(2) + " MB");
  }
}

module.exports = { runOnce, compareRuns, loadRun, worldFor };
