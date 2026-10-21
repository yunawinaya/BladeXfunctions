// Every cached GD_Convert_SI / SO_Convert_SI run through the live version and the lean one. The old version is answered with the
// run's own recorded reads (same documents, same order); the lean version's sql-nodes with the same documents as rows. SI_SAVE is a
// stub that records what it is handed: compared are the outcome and every invoice payload (the invoice date and time, which are the
// clock's, are blanked). A run whose recorded reads were offloaded to a file (response_is_writer_file) cannot be rebuilt: skipped.
// Usage: node replay_convert.js <cache dir> <GD old> <GD new> <SO old> <SO new> [--verbose]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { Engine } = require("./engine_cv.js");
const { CvWorld, clone } = require("./world_cv.js");

// canonical JSON (sorted keys, null / undefined left off, numbers to 15 digits) - compare.js's, which needs PI_SAVE's world.js
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

const [cache, gdOldF, gdNewF, soOldF, soNewF] = process.argv.slice(2);
const VERBOSE = process.argv.includes("--verbose");
const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const WF = { GD_Convert_SI: [rd(gdOldF), rd(gdNewF)], SO_Convert_SI: [rd(soOldF), rd(soNewF)] };

const run = (doc, world, params) => {
  const e = new Engine(doc, world, {});
  try {
    const r = e.run(clone(params));
    const o = r.outcome || {};
    return { outcome: { code: o.code, end: o.end, msg: o.msg, data: o.data }, saved: world.saved, order: r.order };
  } catch (err) {
    return { crash: String(err.message || err).split("\n")[0], saved: world.saved };
  }
};
const blankClock = (v) => JSON.parse(J(v).replace(/"sales_invoice_date":"[^"]*"/g, '"sales_invoice_date":"D"'));
const diffPaths = (a, b, p, out) => {
  if (out.length > 5) return out;
  if (J(a) === J(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p + "." + k, out);
    return out;
  }
  out.push(p + ": " + String(J(a)).slice(0, 120) + " vs " + String(J(b)).slice(0, 120));
  return out;
};

const stats = {};
const fails = [];
const files = fs.readdirSync(path.join(cache, "runs")).filter((x) => /_(GD|SO)_Convert_SI_\d+\.json$/.test(x)).sort();
for (const f of files) {
  const name = f.includes("GD_Convert_SI") ? "GD_Convert_SI" : "SO_Convert_SI";
  const kind = name === "GD_Convert_SI" ? "GD" : "SO";
  const st = (stats[name] = stats[name] || { runs: 0, same: 0, orderOnly: 0, differ: 0, skipped: {}, outcomes: {}, invoices: 0, multiDoc: 0 });
  const skip = (why) => (st.skipped[why] = (st.skipped[why] || 0) + 1);
  const r = rd(path.join(cache, "runs", f));
  const req = L.parseJ(r.request_json_data) || {};
  const params = req.workflowparams || req.request_json;
  if (!params || typeof params !== "object") {
    skip("no params");
    continue;
  }
  let nodesData;
  try {
    nodesData = L.parseJ(r.nodes_data);
  } catch (e) {
    nodesData = null;
  }
  if (!Array.isArray(nodesData)) {
    skip("no nodes_data");
    continue;
  }
  const recorded = {};
  let offloaded = false;
  for (const x of nodesData) {
    if (!x || !x.node_id || !/^(search|get)_node/.test(x.node_id)) continue;
    if (x.response_is_writer_file) offloaded = true;
    const o = L.parseJ(x.response_json_data);
    if (o && typeof o === "object") recorded[x.node_id] = o.data;
  }
  if (offloaded) {
    skip("read offloaded to a file");
    continue;
  }
  // --old-id-order: the old version is handed its documents in id order (the lean reads' order), to tell order-only differences apart
  if (process.argv.includes("--old-id-order")) {
    for (const id of ["search_node_AHtHRmqi", "search_node_bOF3TVA2", "search_node_Ivek0yYx"]) {
      if (recorded[id] && Array.isArray(recorded[id].data)) recorded[id].data.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : BigInt(x.id) > BigInt(y.id) ? 1 : 0));
    }
  }
  const docs = (id) => (recorded[id] && Array.isArray(recorded[id].data) ? recorded[id].data : []);
  if (!recorded.search_node_AHtHRmqi) {
    skip("first read not recorded");
    continue;
  }
  const makeWorld = () => {
    const w = new CvWorld({ tenantId: "000000", kind: kind, recorded: recorded });
    if (kind === "GD") {
      for (const d of docs("search_node_AHtHRmqi")) w.addGd(d);
      for (const d of docs("search_node_Ivek0yYx")) w.addSo(d);
      for (const l of docs("search_node_r3bnMaWy")) w.addSoLine(l);
    } else {
      for (const d of docs("search_node_AHtHRmqi")) w.addSo(d);
      for (const d of docs("search_node_bOF3TVA2")) if (!w.so[String(d.id)]) w.addSo(d);
    }
    return w;
  };
  st.runs++;
  const [oldDoc, newDoc] = WF[name];
  const a = run(oldDoc, makeWorld(), params);
  const b = run(newDoc, makeWorld(), params);
  const outA = a.crash ? { crash: a.crash } : a.outcome;
  const outB = b.crash ? { crash: b.crash } : b.outcome;
  const sameOut = J(blankClock(outA)) === J(blankClock(outB));
  const pa = blankClock(a.saved || []);
  const pb = blankClock(b.saved || []);
  const sameSeq = J(pa) === J(pb);
  const sameSet = J(pa.map(J).sort()) === J(pb.map(J).sort());
  const o = a.crash ? "crash" : String(a.outcome.code) + (a.outcome.data && a.outcome.data.skipped ? "/skipped" : "");
  st.outcomes[o] = (st.outcomes[o] || 0) + 1;
  st.invoices += (a.saved || []).length;
  if (docs("search_node_AHtHRmqi").length > 1) st.multiDoc++;
  if (sameOut && sameSeq) st.same++;
  else if (sameOut && sameSet) st.orderOnly++;
  else {
    st.differ++;
    const d = [];
    diffPaths(outA, outB, "outcome", d);
    if (!sameSet) diffPaths(pa, pb, "payloads", d);
    fails.push(f + " (" + r.status + ", " + params.is_multiple + ", " + docs("search_node_AHtHRmqi").length + " docs): " + d.join(" | ").slice(0, 700));
  }
  if (VERBOSE) console.log((sameOut && sameSet ? "ok   " : "FAIL ") + f + " -> " + o + (a.crash ? " old=" + a.crash : "") + (b.crash ? " new=" + b.crash : ""));
}
for (const [k, v] of Object.entries(stats)) console.log(k, JSON.stringify(v));
for (const x of fails.slice(0, 25)) console.log("  " + x);
if (fails.length > 25) console.log("  ... " + (fails.length - 25) + " more");
