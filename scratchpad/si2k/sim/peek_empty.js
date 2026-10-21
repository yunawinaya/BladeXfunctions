// peek_empty.js <cache dir>: do the old search nodes of the SI conversions ever hand over "" or null values, and what are the
// element types of JSON arrays (so_id, sales_person)? Read-only over the cache.
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const cache = process.argv[2];
const empty = {}, nulls = {}, elems = {};
let rowsSeen = 0;
const visit = (prefix, o) => {
  rowsSeen++;
  for (const [k, v] of Object.entries(o)) {
    if (v === "") empty[prefix + k] = (empty[prefix + k] || 0) + 1;
    if (v === null) nulls[prefix + k] = (nulls[prefix + k] || 0) + 1;
    if (Array.isArray(v) && v.length && typeof v[0] !== "object") {
      const t = v.map((e) => (typeof e === "string" ? (/^\d{16,}$/.test(e) ? "str19" : "str") : typeof e)).join(",");
      elems[prefix + k] = elems[prefix + k] || {};
      elems[prefix + k][t.split(",")[0]] = (elems[prefix + k][t.split(",")[0]] || 0) + 1;
    }
  }
};
for (const f of fs.readdirSync(path.join(cache, "runs")).filter((x) => /_(GD|SO)_Convert_SI_\d+\.json$/.test(x))) {
  const r = JSON.parse(fs.readFileSync(path.join(cache, "runs", f), "utf8"));
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !/^search_node/.test(x.node_id || "")) continue;
    const o = L.parseJ(x.response_json_data);
    for (const d of o && o.data && Array.isArray(o.data.data) ? o.data.data : []) {
      visit(x.node_id.slice(-8) + ".", d);
      for (const lk of ["table_gd", "table_so", "table_si"]) for (const l of Array.isArray(d[lk]) ? d[lk] : []) {
        visit(x.node_id.slice(-8) + "." + lk + ".", l);
        for (const c of Array.isArray(l.children) ? l.children : []) visit(x.node_id.slice(-8) + "." + lk + ".child.", c);
      }
    }
  }
}
console.log("rows seen", rowsSeen);
console.log('"" values:', JSON.stringify(empty).slice(0, 1500));
console.log("null values:", JSON.stringify(nulls).slice(0, 600));
console.log("array element types:", JSON.stringify(elems));
