// form_noise.js <fixture.json> [...]: on recorded completions, which columns the form's allData holds differently from
// the stored GD (get_node_xTRvHWB8) once both are in the DB's shape (gcColValue) - the noise an unsaved-edit check meets
const fs = require("fs"), vm = require("vm");
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const F = JSON.parse(fs.readFileSync(D + "/lift/fields.json", "utf8"));
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, RegExp, console };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(D + "/code/prepare/chain.js", "utf8") + "\nthis.gcColValue = gcColValue;", sb);
const H = F.goods_delivery, L = F.goods_delivery_fwii8mvb_sub;
const norm = (v, k) => { const x = sb.gcColValue(v, k); return x === undefined ? null : typeof x === "object" ? JSON.stringify(x) : x; };
const eq = (a, b) => (a === null && b === null) || (a !== null && b !== null && (typeof a === "number" || typeof b === "number" ? Math.abs(Number(a) - Number(b)) < 1e-9 : String(a) === String(b)));
const count = {};
const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  let stored = null;
  for (const n of JSON.parse(fx.head.nodes_data)) if (n.node_id === "get_node_xTRvHWB8") { stored = P(n.response_json_data).data.data; break; }
  const form = P(fx.head.request_json_data).workflowparams.allData;
  if (!stored) { console.log(fx.doc_no, "no stored read"); continue; }
  const diffs = [];
  for (const c of Object.keys(H)) {
    if (c === "table_gd" || c === "table_insufficient" || c === "table_item_balance" || !(c in form)) continue;
    if (!eq(norm(form[c], H[c]), norm(stored[c], H[c]))) diffs.push("h." + c);
  }
  const sl = {};
  for (const r of flat(stored.table_gd)) sl[r.id] = r;
  const fl = flat(form.table_gd);
  if (fl.length !== Object.keys(sl).length) diffs.push("lines.count");
  for (const r of fl) {
    const o = sl[r.id];
    if (!o) { diffs.push("lines.new"); continue; }
    for (const c of Object.keys(L)) {
      if (c === "children" || !(c in r)) continue;
      if (!eq(norm(r[c], L[c]), norm(o[c], L[c]))) diffs.push("l." + c);
    }
  }
  const u = [...new Set(diffs)];
  for (const d of u) count[d] = (count[d] || 0) + 1;
  const src = form.$_v !== undefined || form.button_save_as_completed !== undefined ? "FORM" : "LIST?";
  console.log(fx.doc_no.padEnd(16), src.padEnd(5), fl.length + " lines", u.length ? u.join(" ") : "(none)");
}
console.log(Object.entries(count).sort((a, b) => b[1] - a[1]));
