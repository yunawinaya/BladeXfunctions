// sizes_convert.js <cache dir> <GD old> <GD new> <SO old> <SO new> [lines]: node data of one conversion at N lines (default 2,000),
// old vs lean. The documents are the largest recorded single-document runs (prod, then dev), their lines repeated to N with fresh
// ids (each GD line with its own order line). Sizes are what engine.js records per node (request + response of every node a later
// placeholder reads, loop passes included) - the platform's nodes_data leaves the loop body out, so both totals are shown.
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { Engine } = require("./engine_cv.js");
const { CvWorld, clone } = require("./world_cv.js");

const [cache, gdOldF, gdNewF, soOldF, soNewF] = process.argv.slice(2);
const N = Number(process.argv[7] || 2000);
const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
let seq = 2300000000000000000n;
const fresh = () => String((seq += 4096n));

const pick = (kind) => {
  let best = null;
  for (const f of fs.readdirSync(path.join(cache, "runs")).filter((x) => new RegExp("_" + kind + "_Convert_SI_\\d+\\.json$").test(x))) {
    const r = rd(path.join(cache, "runs", f));
    let lines = 0, docs = 0, offloaded = false;
    const rec = {};
    for (const x of L.parseJ(r.nodes_data) || []) {
      if (!x || !/^(search|get)_node/.test(x.node_id || "")) continue;
      if (x.response_is_writer_file) offloaded = true;
      const o = L.parseJ(x.response_json_data);
      if (o) rec[x.node_id] = o.data;
    }
    const d = rec.search_node_bOF3TVA2 && rec.search_node_bOF3TVA2.data;
    if (offloaded || !Array.isArray(d) || d.length !== 1) continue;
    const lk = kind === "GD" ? "table_gd" : "table_so";
    lines = (d[0][lk] || []).length;
    if ((d[0][lk] || []).some((l) => l.children)) continue;
    if (!best || lines > best.lines) best = { f, r, rec, lines, params: (L.parseJ(r.request_json_data) || {}).workflowparams };
  }
  return best;
};

const measure = (doc, w, params) => {
  const e = new Engine(doc, w, {});
  const r = e.run(clone(params));
  let all = 0, outside = 0;
  const loopIds = new Set();
  (function walk(nodes, inLoop) {
    for (const n of nodes || []) {
      if (inLoop) loopIds.add(n.id);
      walk(n.blocks, inLoop || n.type === "loop");
    }
  })(doc.nodes, false);
  const rows = [];
  for (const [id, s] of Object.entries(e.sizes)) {
    all += s.in + s.out;
    if (!loopIds.has(id)) outside += s.in + s.out;
    rows.push([s.in + s.out, id, s.runs]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  const payload = JSON.stringify(w.saved).length;
  return { code: r.outcome && r.outcome.code, all, outside, rows: rows.slice(0, 6), payload, invoices: w.saved.length };
};

for (const kind of ["GD", "SO"]) {
  const t = pick(kind);
  if (!t) continue;
  const mk = () => {
    const w = new CvWorld({ tenantId: "000000", kind: kind === "SO" ? "SO" : undefined });
    if (kind === "GD") {
      for (const d of t.rec.search_node_bOF3TVA2.data) w.addGd(d);
      for (const d of (t.rec.search_node_Ivek0yYx || {}).data || []) w.addSo(d);
      for (const l of (t.rec.search_node_r3bnMaWy || {}).data || []) w.addSoLine(l);
      const g = Object.values(w.gd)[0];
      const base = g.lines.slice();
      const soLines = new Map(w.allSoLines().map((l) => [String(l.id), l]));
      const so = Object.values(w.so)[0];
      g.lines = [];
      so.lines = [];
      w.looseSoLines = {};
      for (let i = 0; i < N; i++) {
        const src = base[i % base.length];
        const sl = clone(soLines.get(String(src.so_line_item_id)) || {});
        sl.id = fresh();
        so.lines.push(sl);
        const gl = clone(src);
        gl.id = fresh();
        gl.so_line_item_id = sl.id;
        gl.line_so_id = so.header.id;
        g.lines.push(gl);
      }
      g.header.so_id = [so.header.id];
    } else {
      for (const d of t.rec.search_node_bOF3TVA2.data) w.addSo(d);
      const s = Object.values(w.so)[0];
      const base = s.lines.slice();
      s.lines = [];
      for (let i = 0; i < N; i++) {
        const l = clone(base[i % base.length]);
        l.id = fresh();
        s.lines.push(l);
      }
    }
    return w;
  };
  const params = Object.assign({}, t.params);
  if (kind === "GD") params.ids = [Object.keys(mk().gd)[0]];
  else params.so_ids = [Object.keys(mk().so)[0]];
  const [o, nw] = kind === "GD" ? [rd(gdOldF), rd(gdNewF)] : [rd(soOldF), rd(soNewF)];
  const a = measure(o, mk(), params);
  const b = measure(nw, mk(), params);
  console.log("%s_Convert_SI at %d lines (template %s, %d lines, %s/%s): SI_SAVE payload %s MB, %d invoice(s)", kind, N, t.f, t.lines,
    params.is_multiple, params.convert_to, (a.payload / 1e6).toFixed(2), a.invoices);
  for (const [name, m] of [["old ", a], ["lean", b]]) {
    console.log("  %s: %s MB all nodes, %s MB outside the loop | top: %s", name, (m.all / 1e6).toFixed(1), (m.outside / 1e6).toFixed(1),
      m.rows.map(([s, id, runs]) => id + " " + (s / 1e6).toFixed(1) + (runs > 1 ? "x" + runs : "")).join(", "));
  }
}
