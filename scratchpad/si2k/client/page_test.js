// GD list page "Convert to SI" pre-check (func_convertSI), live v399 vs patched: fetchCashOnlyGDIds must answer the same with
// the two reads projected (.field("so_id") on the deliveries, .field("so_type") on the cash orders). The mock db applies .field()
// the way the client API does (only the named columns, plus id / tenant_id). Usage: node page_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const clone = (x) => JSON.parse(JSON.stringify(x));

function precheck(src, data, st) {
  const body = src.slice(0, src.indexOf("const handleConvertSI = async ("));
  const db = {
    collection: (name) => {
      const q = {};
      const api = {
        filter: (f) => ((q.f = f), api),
        field: (f) => ((q.fields = f), api),
        limit: (n) => ((q.n = n), api),
        get: async () => {
          st.reads++;
          const leaves = q.f[0].children;
          let rows = Object.values(data[name] || {}).filter((r) =>
            leaves.every((l) => (l.operator === "in" ? l.value.map(String).includes(String(r[l.prop])) : String(r[l.prop]) === String(l.value))));
          if (q.fields) {
            const keep = new Set(q.fields.split(",").concat(["id", "tenant_id"]));
            rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
          } else st.wholeRows += rows.reduce((s, r) => s + (r.table_gd ? r.table_gd.length : 1), 0);
          return { data: clone(rows) };
        },
      };
      return api;
    },
  };
  return new Function("db", "console", body + "\nreturn fetchCashOnlyGDIds;")(db, { log() {} });
}

let failures = 0;
(async () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => ({ id: "25" + String(i).padStart(17, "0"), material_name: "Item " + i, gd_qty: 1 }));
  const data = {
    goods_delivery: {
      g1: { id: "g1", so_id: ["s1"], table_gd: lines(2000) }, // credit only
      g2: { id: "g2", so_id: JSON.stringify(["s2"]), table_gd: lines(3) }, // cash only, stored as JSON text
      g3: { id: "g3", so_id: [{ id: "s1" }, { id: "s2" }], table_gd: lines(5) }, // mixed
      g4: { id: "g4", so_id: [], table_gd: lines(1) }, // no order
    },
    sales_order: { s1: { id: "s1", so_type: "Credit", table_so: lines(2000) }, s2: { id: "s2", so_type: "Cash", table_so: lines(4) } },
  };
  for (const sel of [["g1"], ["g2"], ["g1", "g2", "g3", "g4"], ["g3"]]) {
    const out = {};
    for (const [v, f] of [["old", "base_handleConvertGDtoSI.js"], ["new", "new_handleConvertGDtoSI.js"]]) {
      const st = { reads: 0, wholeRows: 0 };
      const fn = precheck(read(f), data, st);
      out[v] = { ids: [...(await fn(sel.map((id) => ({ id }))))].sort(), st };
    }
    const same = JSON.stringify(out.old.ids) === JSON.stringify(out.new.ids);
    if (!same) failures++;
    console.log((same ? "ok   " : "FAIL ") + "cash-only deliveries of [" + sel + "]: " + JSON.stringify(out.new.ids) + " | reads " + out.old.st.reads + " -> " +
      out.new.st.reads + ", whole rows read back " + out.old.st.wholeRows + " -> " + out.new.st.wholeRows);
  }
  console.log("page checks failures:", failures);
  process.exit(failures ? 1 : 0);
})();
