// Every cached GR_Convert_PI / PO_CONVERT_PI run through the live version and the lean one, against the documents the run's
// own reads returned. PI_SAVE is a stub that records what it is handed: the comparison is the outcome and every invoice
// payload. Usage: node replay_convert.js <cache dir> <GR old> <GR new> <PO old> <PO new> [--verbose]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { World, clone } = require("./world.js");
const { runOnce, canon, J } = require("./compare.js");

const [cache, grOldF, grNewF, poOldF, poNewF] = process.argv.slice(2);
const VERBOSE = process.argv.includes("--verbose");
const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const WF = { GR_Convert_PI: [rd(grOldF), rd(grNewF)], PO_CONVERT_PI: [rd(poOldF), rd(poNewF)] };

const flatten = (doc, lineKey) => {
  const header = {};
  for (const [k, v] of Object.entries(doc)) if (k !== lineKey) header[k] = v;
  const lines = [];
  for (const l of doc[lineKey] || []) {
    const r = {};
    for (const [k, v] of Object.entries(l)) if (k !== "children") r[k] = v;
    lines.push(r);
    for (const c of Array.isArray(l.children) ? l.children : []) {
      const child = Object.assign({}, c);
      delete child.children;
      if (child.parent_id === undefined || child.parent_id === null) child.parent_id = l.id;
      lines.push(child);
    }
  }
  return { header, lines };
};
const sqlMocks = require("./replay_sql_mocks.js");

const stats = {};
const fails = [];
for (const f of fs.readdirSync(path.join(cache, "runs")).filter((x) => /_(GR_Convert_PI|PO_CONVERT_PI)_\d+\.json$/.test(x)).sort()) {
  const name = f.includes("GR_Convert_PI") ? "GR_Convert_PI" : "PO_CONVERT_PI";
  const st = (stats[name] = stats[name] || { runs: 0, same: 0, differ: 0, skipped: 0, outcomes: {}, invoices: 0 });
  const r = rd(path.join(cache, "runs", f));
  const req = L.parseJ(r.request_json_data) || {};
  const params = req.workflowparams || req.request_json;
  const nodes = {};
  let truncated = false;
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !x.node_id) continue;
    nodes[x.node_id] = L.parseJ(x.response_json_data);
    if (x.response_is_writer_file && /^search_node/.test(x.node_id)) truncated = true;
  }
  const docs = (id) => (nodes[id] && nodes[id].data && Array.isArray(nodes[id].data.data) ? nodes[id].data.data : []);
  if (!params || truncated) {
    st.skipped++;
    continue;
  }
  const makeWorld = () => {
    const w = new World({ tenantId: "000000", seed: "2300000000000000000" });
    const grSrc = name === "GR_Convert_PI" ? docs("search_node_AHtHRmqi") : [];
    for (const d of grSrc) {
      const { header, lines } = flatten(d, "table_gr");
      w.addGr(header, lines);
    }
    const poSrc = name === "GR_Convert_PI" ? docs("search_node_Ivek0yYx") : docs("search_node_PoConvGetAll");
    for (const d of poSrc) {
      const { header, lines } = flatten(d, "table_po");
      w.addPo(header, lines);
    }
    if (name === "GR_Convert_PI") {
      // order lines read by id that are not under a read order (their order was not among the GRs' po_id)
      const have = new Set([].concat(...Object.values(w.po).map((d) => d.lines.map((l) => String(l.id)))));
      const loose = docs("search_node_r3bnMaWy").filter((l) => !have.has(String(l.id)));
      if (loose.length) w.po["9999999999999999999"] = { header: { id: "9999999999999999999" }, lines: loose.map((l) => clone(l)) };
    }
    const recorded = (id, fallback) => () => (nodes[id] ? nodes[id].data : fallback);
    Object.assign(w.read, {
      search_node_d39M3W6h: recorded("search_node_d39M3W6h", { total: 0, count: 0, data: [] }),
      search_node_PoConvDraftPI: recorded("search_node_PoConvDraftPI", { total: 0, count: 0, data: [] }),
      get_node_yDMG0Sab: recorded("get_node_yDMG0Sab", { count: 1, data: { id: "1" } }),
      get_node_PoConvDocFormat: recorded("get_node_PoConvDocFormat", { count: 1, data: { id: "1" } }),
    });
    Object.assign(w.sql, sqlMocks(w));
    w.saved = [];
    w.wf.PI_SAVE = (p, world) => {
      world.saved.push(clone(p.data));
      return { id: world.nextId(), pi_no: "PI/SIM/" + world.saved.length };
    };
    return w;
  };
  st.runs++;
  const [oldDoc, newDoc] = WF[name];
  const runParams = clone(params);
  const a = runOnce(oldDoc, makeWorld, runParams);
  const b = runOnce(newDoc, makeWorld, runParams);
  const sameNow = (x, y) => {
    // the invoice date is today's date on both sides; the cache key embeds the clock
    const strip = (v) => JSON.parse(J(v).replace(/"invoice_date":"\d{4}-\d{2}-\d{2}"/g, '"invoice_date":"D"'));
    return J(strip(x)) === J(strip(y));
  };
  const outA = a.crash ? { crash: a.crash } : a.outcome;
  const outB = b.crash ? { crash: b.crash } : b.outcome;
  const ok = sameNow(outA, outB) && sameNow(a.world.saved || [], b.world.saved || []);
  const o = a.crash ? "crash" : String(a.outcome.code);
  st.outcomes[o] = (st.outcomes[o] || 0) + 1;
  st.invoices += (a.world.saved || []).length;
  // a Received GR: v18 crashed reading plant_id of an empty list, the lean version invoices it (user 2026-10-21)
  const receivedOnly = name === "GR_Convert_PI" && a.crash && /plant_id/.test(a.crash) && !b.crash &&
    docs("search_node_AHtHRmqi").some((d) => d.gr_status === "Received");
  if (receivedOnly) {
    st.receivedNowConverts = (st.receivedNowConverts || 0) + 1;
    st.invoicesFromReceived = (st.invoicesFromReceived || 0) + (b.world.saved || []).length;
  } else if (ok) st.same++;
  else {
    st.differ++;
    fails.push(f + ": old=" + JSON.stringify(outA).slice(0, 160) + " new=" + JSON.stringify(outB).slice(0, 160) + " invoices " +
      (a.world.saved || []).length + "/" + (b.world.saved || []).length);
  }
  if (VERBOSE && (o === "crash" || !ok)) console.log((ok ? "ok   " : "FAIL ") + f + " status=" + r.status + " -> " + o + " old=" + (a.crash || "") + " new=" + (b.crash || (b.outcome && b.outcome.code)) + " gr_status=" + docs("search_node_AHtHRmqi").map((d) => d.gr_status).join("/"));
}
for (const [k, v] of Object.entries(stats)) console.log(k, JSON.stringify(v));
for (const x of fails.slice(0, 12)) console.log("  " + x);
