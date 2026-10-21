// What the OLD versions (GR_Convert_PI v18 / PO_CONVERT_PI v5, each calling PI_SAVE v19) write for one conversion, from the
// documents as the platform reads them now: the invoice header + lines it adds and the order / receipt counters it moves.
// Usage: node predict.js <fixture.json> <out.json>
//   fixture: { kind: "GR"|"PO", params, grs: [platform GR docs], pos: [platform PO docs], tenantId }
"use strict";
const fs = require("fs");
const path = require("path");
const { World, clone } = require("./world.js");
const { Engine } = require("./engine.js");

const [fixFile, outFile] = process.argv.slice(2);
const fx = JSON.parse(fs.readFileSync(fixFile, "utf8"));
const base = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "base", f), "utf8"));
const OLD_SAVE = base("PI_SAVE.v19.json");
const OLD = fx.kind === "GR" ? base("GR_Convert_PI.v18.json") : base("PO_CONVERT_PI.v5.json");

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

const w = new World({ tenantId: fx.tenantId || "000000" });
for (const d of fx.grs || []) {
  const { header, lines } = flatten(d, "table_gr");
  w.addGr(header, lines);
}
for (const d of fx.pos || []) {
  const { header, lines } = flatten(d, "table_po");
  w.addPo(header, lines);
}
w.read.search_node_d39M3W6h = () => ({ total: 0, count: 0, data: [] });
w.read.search_node_PoConvDraftPI = () => ({ total: 0, count: 0, data: [] });
w.payloads = [];
w.wf.PI_SAVE = (p, world) => {
  world.payloads.push(clone(p.data));
  const r = new Engine(OLD_SAVE, world).run({ data: clone(p.data) });
  if (!r.outcome || r.outcome.code !== 200) throw new Error("PI_SAVE v19 ended " + JSON.stringify(r.outcome));
  return r.outcome.data;
};
const r = new Engine(OLD, w).run(clone(fx.params));
const lineState = (store) => {
  const out = {};
  for (const d of Object.values(store)) {
    out[d.header.id] = { pi_status: d.header.pi_status === undefined ? null : d.header.pi_status, lines: {} };
    for (const l of d.lines) out[d.header.id].lines[l.id] = { invoice_qty: l.invoice_qty === undefined ? null : l.invoice_qty, pi_status: l.pi_status === undefined ? null : l.pi_status };
  }
  return out;
};
fs.writeFileSync(outFile, JSON.stringify({ outcome: r.outcome, pis: Object.values(w.pi), po: lineState(w.po), gr: lineState(w.gr), payloads: w.payloads }, null, 1));
console.log("predicted:", JSON.stringify(r.outcome).slice(0, 200), "| invoices:", Object.keys(w.pi).length);
