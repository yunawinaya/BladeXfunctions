// adapter_vs_recorded.js <sql dump.json> <fixture.json>: adapter output vs the recorded read outputs of the same rows
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../code/prepare/adapter.js", "utf8");
const gcAdapt = new Function(src + "\nreturn gcAdapt;")();
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const S = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const fx = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const rec = {};
for (const src of [fx.head, fx.unused]) if (src) for (const n of JSON.parse(src.nodes_data)) if (n.response_json_data && !rec[n.node_id]) { try { rec[n.node_id] = P(n.response_json_data).data; } catch (e) {} }
const A = gcAdapt(S);
const ty = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
function cmp(label, a, b, values) {
  const out = [];
  const walk = (x, y, p) => {
    if (out.length > 25) return;
    if (ty(x) !== ty(y)) { out.push(`${p}: ${ty(x)} vs recorded ${ty(y)} (${JSON.stringify(x)?.slice(0, 40)} | ${JSON.stringify(y)?.slice(0, 40)})`); return; }
    if (ty(x) === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (!(k in y)) out.push(`${p}.${k}: only adapter (${JSON.stringify(x[k])?.slice(0, 40)})`);
        else if (!(k in x)) out.push(`${p}.${k}: only recorded (${JSON.stringify(y[k])?.slice(0, 40)})`);
        else walk(x[k], y[k], p + "." + k);
      }
    } else if (ty(x) === "array") {
      if (x.length !== y.length) out.push(`${p}: ${x.length} rows vs recorded ${y.length}`);
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${p}[${i}]`);
    } else if (values && x !== y) out.push(`${p}: ${JSON.stringify(x)?.slice(0, 50)} vs recorded ${JSON.stringify(y)?.slice(0, 50)}`);
  };
  walk(a, b, "");
  console.log(`== ${label}: ${out.length ? out.length + " differences" : "IDENTICAL" + (values ? "" : " (keys/types)")}`);
  for (const l of out) console.log("   " + l);
}
const pick = (id) => rec[id];
cmp("gd vs get_node_Cef6vdH4 (after completion)", A.gd, pick("get_node_Cef6vdH4"), true);
cmp("pickingSetup vs get_node_iFPuvJX2", A.pickingSetup, pick("get_node_iFPuvJX2"), true);
cmp("packingSetup vs get_packing_setup", A.packingSetup, pick("get_packing_setup"), true);
cmp("itemFlags vs sql_node_ItemFlags", A.itemFlags, pick("sql_node_ItemFlags"), true);
cmp("itemDatas vs sql_node_ItemDatas", A.itemDatas, pick("sql_node_ItemDatas"), true);
cmp("soLines vs search_node_SOLine8kQ2", A.soLines, pick("search_node_SOLine8kQ2"), false);
cmp("soHeaders vs search_node_FVhsTRDu", A.soHeaders, pick("search_node_FVhsTRDu"), false);
cmp("linkage vs search_gr_linkage", A.linkage, pick("search_gr_linkage"), true);
