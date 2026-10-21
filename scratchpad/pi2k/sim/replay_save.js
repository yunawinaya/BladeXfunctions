// Every cached PI_SAVE run (dev + prod) through v19 and v20: the run's own payload, against the orders and receipts its
// search nodes read (rebuilt as rows, so v19 reads them back in the search shape and v20 as sql rows). Compares the outcome
// and every write. Usage: node replay_save.js <cache dir> <old PI_SAVE json> <new PI_SAVE json> [--verbose]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { World, clone } = require("./world.js");
const { compare } = require("./compare.js");

const [cache, oldFile, newFile] = process.argv.slice(2);
const VERBOSE = process.argv.includes("--verbose");
const OLD = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));

const flatten = (doc, lineKey) => {
  const header = {};
  for (const [k, v] of Object.entries(doc)) if (k !== lineKey) header[k] = v;
  const lines = [];
  for (const l of doc[lineKey] || []) {
    const row = {};
    for (const [k, v] of Object.entries(l)) if (k !== "children") row[k] = v;
    lines.push(row);
    for (const c of Array.isArray(l.children) ? l.children : []) {
      const child = Object.assign({}, c);
      delete child.children;
      if (child.parent_id === undefined || child.parent_id === null) child.parent_id = l.id;
      lines.push(child);
    }
  }
  return { header, lines };
};

const stats = { runs: 0, same: 0, differ: 0, skipped: 0, outcomes: {} };
const fails = [];
for (const f of fs.readdirSync(path.join(cache, "runs")).filter((x) => /_PI_SAVE_\d+\.json$/.test(x)).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(cache, "runs", f), "utf8"));
  const req = L.parseJ(r.request_json_data) || {};
  const wp = req.workflowparams || req.request_json || {};
  const data = wp.data;
  if (!data || typeof data !== "object") {
    stats.skipped++;
    continue;
  }
  const nodes = {};
  let truncated = false;
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !x.node_id) continue;
    nodes[x.node_id] = L.parseJ(x.response_json_data);
    if (x.response_is_writer_file && /search_node_(po|gr)/.test(x.node_id)) truncated = true;
  }
  const docsOf = (id) => {
    const o = nodes[id];
    const d = o && o.data && Array.isArray(o.data.data) ? o.data.data : [];
    return d;
  };
  if (truncated || (!nodes.search_node_po && !nodes.search_node_gr && data.pi_status === "Completed")) {
    stats.skipped++;
    continue;
  }
  const storedRec = nodes.get_node_pi_stored && nodes.get_node_pi_stored.data ? nodes.get_node_pi_stored.data.data : null;
  const makeWorld = () => {
    const w = new World({ tenantId: "000000", seed: "2300000000000000000" });
    for (const d of docsOf("search_node_po")) {
      const { header, lines } = flatten(d, "table_po");
      w.addPo(header, lines);
    }
    for (const d of docsOf("search_node_gr")) {
      const { header, lines } = flatten(d, "table_gr");
      w.addGr(header, lines);
    }
    if (data.page_status === "Edit" && data.id) {
      const rec = storedRec && !Array.isArray(storedRec) && storedRec.id ? clone(storedRec) : null;
      w.pi[String(data.id)] = rec || { id: String(data.id), pi_status: "Draft", purchase_invoice_no: data.purchase_invoice_no,
        purchase_invoice_no_type: data.purchase_invoice_no_type, custom_fields_d10wd6ob: data.custom_fields_d10wd6ob, table_pi: clone(data.table_pi || []) };
    }
    return w;
  };
  stats.runs++;
  const res = compare(OLD, NEW, makeWorld, { data: data });
  const o = res.a.outcome ? String(res.a.outcome.code) : "crash";
  stats.outcomes[o] = (stats.outcomes[o] || 0) + 1;
  if (res.same) stats.same++;
  else {
    stats.differ++;
    fails.push(f + ": " + res.problems.join(" | ").slice(0, 600));
  }
  if (VERBOSE) console.log((res.same ? "ok   " : "FAIL ") + f + " -> " + o);
}
console.log("runs " + stats.runs + " | same " + stats.same + " | differ " + stats.differ + " | skipped " + stats.skipped + " | v19 outcomes " + JSON.stringify(stats.outcomes));
for (const x of fails.slice(0, 15)) console.log("  " + x);
