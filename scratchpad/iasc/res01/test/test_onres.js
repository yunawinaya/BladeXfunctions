// RES-01 R1: the on_reserved_gd form = live dev v19 + the doc_type value "Item Assembly" (an IA's raw-material hold), nothing else
//   node scratchpad/iasc/res01/test/test_onres.js
const fs = require("fs");
const path = require("path");
const read = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));
let fails = 0;
let n = 0;
const check = (label, ok, extra) => {
  n++;
  if (!ok) {
    fails++;
    console.log("FAIL " + label + (extra === undefined ? "" : " " + JSON.stringify(extra).slice(0, 400)));
  }
};
const find = (doc, model) => {
  let r = null;
  const walk = (x) => {
    if (r || !x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (x.model === model && x.type) return void (r = x);
    Object.values(x).forEach(walk);
  };
  walk(doc.list);
  return r;
};
const BASE = read("base/on_reserved_gd_form_v19.json");
const OUT = read("out/on_reserved_gd_form.json");
const opts = (doc) => find(doc, "doc_type").options.options;
check("doc_type gains one value, last: Item Assembly (the hand-added values' shape)", opts(OUT).length === opts(BASE).length + 1 &&
  JSON.stringify(opts(OUT)[opts(OUT).length - 1]) === JSON.stringify({ value: "Item Assembly", label: "Item Assembly", explain: "", disabled: false, visible: true }),
  opts(OUT).slice(-2));
check("the existing values unchanged, in order", JSON.stringify(opts(OUT).slice(0, -1)) === JSON.stringify(opts(BASE)));
const undo = JSON.parse(JSON.stringify(OUT));
find(undo, "doc_type").options.options.pop();
check("everything else byte-identical to v19", JSON.stringify(undo) === JSON.stringify(BASE));
console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
