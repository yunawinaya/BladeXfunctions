// test_picking_wa_guard.js [PickingProcessWorkflow.json]: classic PICKING's code_node_SizeGuard, run from the workflow file as built.
// An Auto Complete GD org whose deliveries hold a Weighted Average item with no costing record at its plant is refused before
// anything is written (Kenhin 10-23 / 10-26: the auto-complete died half-way and stranded the Picking). Other orgs pass; a
// busy delivery still answers first. Exit 0 only if every case holds.
const fs = require("fs");
const file = process.argv[2] || __dirname + "/../../../Picking/PickingProcessWorkflow.json";
const w = JSON.parse(fs.readFileSync(file, "utf8"));
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const code = find(w, "code_node_SizeGuard").data.script.code;
const holders = [...new Set(code.match(/\{\{[^}]+\}\}/g))];
const names = holders.map((_, i) => "__p" + i);
let body = code;
holders.forEach((h, i) => { body = body.split(h).join(names[i]); });
const run = (o) => {
  const vals = {
    "sql_node_GdLineCount": o.lines || [{ gd_id: "1", line_count: 3, busy_no: "" }],
    "get_node_Uj1uV9PU": o.setup || { auto_completed_gd: 1, is_loading_bay: 0 },
    "isForceComplete": 0,
    "code_node_iES7iMKA": 0,
    "sql_node_WaCostGuard": o.wa || [],
  };
  const arg = (h) => vals[Object.keys(vals).find((k) => h.indexOf(k) >= 0)];
  return new Function(...names, body)(...holders.map((h) => JSON.parse(JSON.stringify(arg(h)))));
};
const missing = [{ delivery_no: "GD/20261026/2092", material_code: "V131", material_name: "LENGKUAS [GALANGAL] [9.5-10KG]" }];
const refused = run({ wa: missing });
const cases = [
  ["auto-complete org, an item without a costing record: refused", refused.code, "400"],
  ["the message names the item and the delivery", /V131 LENGKUAS .*GD\/20261026\/2092/.test(refused.message || "") ? "named" : (refused.message || "-"), "named"],
  ["no auto-complete: the same gap passes (completion refuses later, cleanly)", run({ wa: missing, setup: { auto_completed_gd: 0 } }).code, "200"],
  ["auto-complete org, every costing record present: passes", run({ wa: [] }).code, "200"],
  ["a delivery saving in the background still answers first", /background/.test(run({ wa: missing, lines: [{ gd_id: "1", line_count: 3, busy_no: "GD/9" }] }).message || "") ? "busy" : "-", "busy"],
];
let ok = true;
for (const [name, got, want] of cases) { const pass = got === want; ok = ok && pass; console.log((pass ? "ok   " : "FAIL ") + name + ": " + got); }
console.log(ok ? cases.length + "/" + cases.length + " passed" : "wa guard test FAILED");
process.exit(ok ? 0 : 1);
