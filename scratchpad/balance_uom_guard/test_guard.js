// test_guard.js [patched.json] [original.json]: BALANCE_UOM_CONVERSION's guard (code_node_BUguard) run from the patched
// workflow JSON. Real-shaped inputs must give the SAME SQL text as the original did; anything else must leave no caller
// text in the SQL and match no rows.
const fs = require("fs");
const REPO = "/Users/yunawinaya/Developer/BladeXfunctions/";
const patched = JSON.parse(fs.readFileSync(process.argv[2] || REPO + "Balance Table/BalanceUOMConversionWorkflow.json", "utf8"));
const original = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : null;
const node = (doc, id) => doc.nodes.find((n) => n.id === id);
const guardCode = node(patched, "code_node_BUguard").data.script.code;
const sqlNew = node(patched, "sql_node_Qb7hK2Rx").data.script.code;
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 400))); if (!ok) fails += 1; };

// the platform injects a code-node placeholder as a JS literal (JSON); a param the caller left out becomes null
const runGuard = (p) => new Function(guardCode.replace(/\{\{workflowparams:([a-z_]+)\}\}/g, (m, k) => (k in p ? JSON.stringify(p[k]) : "null")))();
// a sql-node placeholder is plain text; an unresolvable one becomes the text null
const fillSql = (sql, vals, prefix) => sql.replace(new RegExp("\\{\\{" + prefix + "([a-z_]+)\\}\\}", "g"), (m, k) => (k in vals ? String(vals[k]) : "null"))
  .replace(/\{\{global:firstLvDeptId\}\}/g, "1900000000000000001");

const declared = node(patched, "code_node_BUguard").data.response_json.map((r) => r.name).sort().join();
t("response_json declares exactly the four outputs", declared === "balance_type,material_id,material_uom,selected_dept_id", declared);
t("no input placeholder is left in the SQL", !/\{\{workflowparams:/.test(sqlNew), sqlNew.match(/\{\{workflowparams:[^}]*\}\}/g));

const real = [
  { material_id: "2109466895710294018", material_uom: "", balance_type: "item_balance", selected_dept_id: "1900000000000000001" },
  { material_id: "2109466895710294018", material_uom: "2084000000000000123", balance_type: "item_balance", selected_dept_id: "1900000000000000777" },
  { material_id: "1963870980264357890", material_uom: "1963870980264358000", balance_type: "item_batch_balance", selected_dept_id: "" },
  { material_id: 1963870980264357, material_uom: "17", balance_type: "item_balance", selected_dept_id: "5" },
];
for (const p of real) {
  const g = runGuard(p);
  t("real-shaped input maps to itself: " + JSON.stringify(p).slice(0, 90), g.material_id === String(p.material_id) && g.material_uom === String(p.material_uom) && g.balance_type === p.balance_type && g.selected_dept_id === String(p.selected_dept_id), g);
  if (original) {
    const sqlOld = node(original, "sql_node_Qb7hK2Rx").data.script.code;
    t("  ... and the SQL text is the same as before", fillSql(sqlNew, g, "node:code_node_BUguard\\.data\\.") === fillSql(sqlOld, p, "workflowparams:"));
  }
}

const evil = "1' UNION SELECT password FROM blade_user -- ";
const bad = [
  [{ material_id: evil, material_uom: "1", balance_type: "item_balance", selected_dept_id: "" }, { material_id: "0" }],
  [{ material_id: "1", material_uom: "1' OR '1'='1", balance_type: "item_balance", selected_dept_id: "" }, { material_uom: "0" }],
  [{ material_id: "1", material_uom: "1", balance_type: "x' OR '1'='1", selected_dept_id: "" }, { balance_type: "item_balance" }],
  [{ material_id: "1", material_uom: "1", balance_type: "item_balance", selected_dept_id: "' OR ''='" }, { selected_dept_id: "0" }],
  [{ material_id: "1", material_uom: "1", balance_type: "item_balance" }, { selected_dept_id: "0" }],
  [{ material_id: { a: 1 }, material_uom: ["1"], balance_type: null, selected_dept_id: 12.5 }, { material_id: "0", material_uom: "1", balance_type: "item_balance", selected_dept_id: "0" }],
];
for (const [p, want] of bad) {
  const g = runGuard(p);
  const sql = fillSql(sqlNew, g, "node:code_node_BUguard\\.data\\.");
  t("hostile / missing input " + JSON.stringify(p).slice(0, 70) + " -> " + JSON.stringify(want), Object.keys(want).every((k) => g[k] === want[k]) && !/UNION SELECT password|OR '1'='1|OR ''='/.test(sql), g);
}
t("a missing plant matches nothing (as the old 'null' text did); blank keeps the organization scope",
  runGuard({ material_id: "1", material_uom: "1", balance_type: "item_balance" }).selected_dept_id === "0" && runGuard({ material_id: "1", material_uom: "1", balance_type: "item_balance", selected_dept_id: "" }).selected_dept_id === "");
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
