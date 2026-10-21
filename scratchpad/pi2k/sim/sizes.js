// Node data at N lines (default 2,000), live vs lean: PI_SAVE Add / Completed and Edit / Completed, GR -> PI and PO -> PI with
// the PI_SAVE they call in the same request. Real dev documents (recorded runs) are grown to N lines by repeating their lines
// under new ids. The figure is what engine.js keeps per node (request + response of every node a later step reads, the
// platform's nodes_data rule); the stored column escapes that text, x1.04-1.06 on these runs (pi_project.py).
// Usage: node sizes.js <cache dir> <bases dir> <outs dir> [N]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { World, clone } = require("./world.js");
const { Engine } = require("./engine.js");

const [cache, baseDir, outDir] = process.argv.slice(2);
const N = Number(process.argv[5] || 2000);
const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const W = {
  save: [rd(path.join(baseDir, "PI_SAVE.v19.json")), rd(path.join(outDir, "PI_SAVE.json"))],
  gr: [rd(path.join(baseDir, "GR_Convert_PI.v18.json")), rd(path.join(outDir, "GR_Convert_PI.json"))],
  po: [rd(path.join(baseDir, "PO_CONVERT_PI.v5.json")), rd(path.join(outDir, "PO_CONVERT_PI.json"))],
};
const run = (id) => {
  const r = rd(path.join(cache, "runs", id + ".json"));
  const nodes = {};
  for (const x of L.parseJ(r.nodes_data) || []) if (x && x.node_id) nodes[x.node_id] = L.parseJ(x.response_json_data);
  const req = L.parseJ(r.request_json_data) || {};
  return { params: req.workflowparams || req.request_json, nodes };
};
let seq = 2400000000000000000n;
const nid = () => (++seq).toString();

// a document's lines grown to n: copies of its own lines, new ids, links remapped
function grow(lines, n, remap) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const src = lines[i % lines.length];
    const c = clone(src);
    const nidv = nid();
    remap.set(String(src.id) + "#" + Math.floor(i / lines.length), nidv);
    c.id = nidv;
    out.push(c);
  }
  return out;
}

const mb = (sizes) => Object.values(sizes).reduce((s, x) => s + x.in + x.out, 0) / 1e6;
const topNodes = (sizes, k) => Object.entries(sizes).map(([id, x]) => [id, (x.in + x.out) / 1e6]).sort((a, b) => b[1] - a[1]).slice(0, k)
  .map(([id, v]) => id + " " + v.toFixed(1)).join(", ");

// ---- PI_SAVE: the dev Add run (2 lines) and its PO / GR, grown to N lines
function saveWorld(edit) {
  const src = run("dev_PI_SAVE_2112117612832530434");
  const po = src.nodes.search_node_po.data.data[0];
  const gr = src.nodes.search_node_gr.data.data[0];
  const data = clone(src.params.data);
  const remapPo = new Map();
  const remapGr = new Map();
  const poLines = grow(po.table_po, N, remapPo);
  const grLines = grow(gr.table_gr, N, remapGr);
  grLines.forEach((l, i) => (l.po_line_item_id = poLines[i].id));
  const piLines = [];
  for (let i = 0; i < N; i++) {
    const l = clone(data.table_pi[i % data.table_pi.length]);
    l.po_line_id = poLines[i].id;
    l.gr_line_id = grLines[i].id;
    l.invoice_qty = 1;
    if (edit) l.id = nid();
    piLines.push(l);
  }
  data.table_pi = piLines;
  const make = () => {
    const w = new World({ tenantId: "000000" });
    w.addPo(Object.assign({}, po, { table_po: undefined }), poLines);
    w.addGr(Object.assign({}, gr, { table_gr: undefined }), grLines);
    if (edit) {
      data.page_status = "Edit";
      data.id = "2400000000000009999";
      data.previous_status = "Draft";
      w.pi[data.id] = Object.assign(clone(data), { pi_status: "Draft", purchase_invoice_no: "Draft-PI/1" });
    }
    return w;
  };
  return { data, make };
}

function measure(doc, make, params, nestedSave) {
  const w = make();
  let nested = 0;
  if (nestedSave) {
    w.wf.PI_SAVE = (p, world) => {
      const e2 = new Engine(nestedSave, world);
      const r2 = e2.run({ data: clone(p.data) });
      nested += mb(e2.sizes);
      return r2.outcome && r2.outcome.data ? r2.outcome.data : {};
    };
  }
  const e = new Engine(doc, w);
  const r = e.run(clone(params));
  return { own: mb(e.sizes), nested, outcome: r.outcome, top: topNodes(e.sizes, 4) };
}

const lines = [];
for (const edit of [false, true]) {
  const s = saveWorld(edit);
  const old = measure(W.save[0], s.make, { data: s.data });
  const neu = measure(W.save[1], s.make, { data: s.data });
  lines.push(["PI_SAVE " + (edit ? "Edit -> Completed" : "Add -> Completed"), old, neu]);
}

// ---- GR -> PI: the dev 2-line GR conversion, grown to N lines
{
  const src = run("dev_GR_Convert_PI_2112117612056584194");
  const gr = src.nodes.search_node_AHtHRmqi.data.data[0];
  const po = src.nodes.search_node_Ivek0yYx.data.data[0];
  const poLines = grow(po.table_po, N, new Map());
  const grLines = grow(gr.table_gr, N, new Map());
  grLines.forEach((l, i) => {
    l.po_line_item_id = poLines[i].id;
    l.line_po_id = po.id;
  });
  const make = () => {
    const w = new World({ tenantId: "000000" });
    w.addPo(Object.assign({}, po, { table_po: undefined }), poLines);
    w.addGr(Object.assign({}, gr, { table_gr: undefined }), grLines);
    Object.assign(w.sql, require("./replay_sql_mocks.js")(w));
    return w;
  };
  const params = clone(src.params);
  const old = measure(W.gr[0], make, params, W.save[0]);
  const neu = measure(W.gr[1], make, params, W.save[1]);
  lines.push(["GR -> PI (+ PI_SAVE)", old, neu]);
}

// ---- PO -> PI: the dev 2-line PO conversion (the heavy-line test PO), grown to N lines
for (const id of ["dev_PO_CONVERT_PI_2107687119629516801", "dev_PO_CONVERT_PI_2110995749973131265"]) {
  const src = run(id);
  const pos = src.nodes.search_node_PoConvGetAll.data.data;
  const grown = pos.map((po) => ({ po, lines: grow(po.table_po, Math.ceil(N / pos.length), new Map()) }));
  const make = () => {
    const w = new World({ tenantId: "000000" });
    for (const g of grown) w.addPo(Object.assign({}, g.po, { table_po: undefined }), g.lines);
    Object.assign(w.sql, require("./replay_sql_mocks.js")(w));
    w.read.search_node_PoConvDraftPI = () => ({ total: 0, count: 0, data: [] });
    return w;
  };
  const params = clone(src.params);
  const old = measure(W.po[0], make, params, W.save[0]);
  const neu = measure(W.po[1], make, params, W.save[1]);
  const kb = Math.round(JSON.stringify(pos[0].table_po[0]).length / 100) / 10;
  lines.push(["PO -> PI (+ PI_SAVE), " + kb + " KB PO lines", old, neu]);
}

console.log("Node data at " + N + " lines (MB, engine count; stored column ~x1.05):");
for (const [name, o, n] of lines) {
  const ot = o.own + o.nested;
  const nt = n.own + n.nested;
  console.log("  " + name.padEnd(42) + " live " + ot.toFixed(1).padStart(6) + "  ->  lean " + nt.toFixed(1).padStart(5) +
    "   (" + (o.outcome && o.outcome.code) + "/" + (n.outcome && n.outcome.code) + ")");
  console.log("      live top: " + o.top);
  console.log("      lean top: " + n.top);
}
