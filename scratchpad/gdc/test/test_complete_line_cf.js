// test_complete_line_cf.js: GD_COMPLETE_SUBMIT compares a line's custom fields by field name (10-27, the user's yes). The stored
// line holds definition ids, the form sends names, so the raw compare read every completion of a GD whose lines carry custom
// fields (prod 502801 kamco) as an unsaved edit and sent it to the classic save. gsFormDiff runs from the workflow's own code;
// the two reads run read-only on dev on GD/20260716/029 (tenant 239760, kamco line fields).
// usage: node test_complete_line_cf.js [GD_COMPLETE_SUBMIT.json]   (the repo file by default; dev v14 fails the line cases)
const fs = require("fs"), cp = require("child_process");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const W = JSON.parse(fs.readFileSync(process.argv[2] || R + "Goods Delivery/CompleteV2/GD_COMPLETE_SUBMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const src = find(W, "code_node_GSgate").data.script.code;
const M = new Function(src.slice(0, src.indexOf("const guard = [{{node:code_node_GSguard.data}}][0];")) + "\nreturn { gsFormDiff, GC_KINDS, gcObj };")();
const diff = (form, stored) => M.gsFormDiff(Object.assign({ table_gd: [] }, form), Object.assign({ table_gd: [] }, stored), M.GC_KINDS).changed;
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 300))); if (!ok) fails += 1; };
const CF = "table_gd.custom_fields";

const defs = { "101": "kamco_kg_pc", "102": "kamco_price_kg" };
const line = (cf) => ({ id: "L1", custom_fields: cf });
let c = diff({ table_gd: [line({ kamco_kg_pc: 12, kamco_price_kg: 2 })] }, { table_gd: [line({ "101": 12, "102": 2 })], cf_line_defs: defs });
t("stored ids and form names meaning the same values: no change (it stays V2)", c.indexOf(CF) < 0, c);
c = diff({ table_gd: [line({ kamco_kg_pc: 13, kamco_price_kg: 2 })] }, { table_gd: [line({ "101": 12, "102": 2 })], cf_line_defs: defs });
t("an edited line value: an unsaved change named table_gd.custom_fields (classic save)", c.indexOf(CF) >= 0, c);
c = diff({ table_gd: [line({})] }, { table_gd: [line(null)], cf_line_defs: defs });
t("{} against a NULL column: no change", c.indexOf(CF) < 0, c);
c = diff({ table_gd: [line({ kamco_kg_pc: "" })] }, { table_gd: [line({})], cf_line_defs: defs });
t("an empty-string value against none: no change", c.indexOf(CF) < 0, c);
c = diff({ table_gd: [line({ kamco_kg_pc: 12 })] }, { table_gd: [line({ "101": 12, "999": "orphan" })], cf_line_defs: defs });
t("a stored key whose definition is gone is ignored", c.indexOf(CF) < 0, c);
c = diff({ table_gd: [line({ kamco_kg_pc: 12 })] }, { table_gd: [line({ kamco_kg_pc: 12 })] });
t("no definitions, names on both sides: compared directly, no change", c.indexOf(CF) < 0, c);
c = diff({ table_gd: [{ id: "L1", remark: "x" }] }, { table_gd: [line({ "101": 12 })], cf_line_defs: defs });
t("a form line without the key is not a custom-fields change", c.indexOf(CF) < 0, c);

// real data: dev GD/20260716/029 (tenant 239760) through the patched reads and the node's own row parser
const run = (id) => {
  const sql = find(W, id).data.script.code.replace(/\{\{node:code_node_GSentry\.data\.tenantId\}\}/g, "239760").replace(/\{\{node:code_node_GSentry\.data\.gdId\}\}/g, "2077679551755112449");
  const out = cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", sql], { encoding: "utf8", cwd: R });
  return JSON.parse(out.slice(out.indexOf("[")));
};
const hdr = M.gcObj(run("sql_node_GShdr")[0]);
const lines = run("sql_node_GSlines").map((r) => M.gcObj(r));
const defsLive = hdr.cf_line_defs || {};
const withCf = lines.filter((l) => l.custom_fields && Object.keys(l.custom_fields).length);
t("dev 029: cf_line_defs carries the tenant's line definitions, and a stored line is id-keyed",
  Object.keys(defsLive).length >= 4 && withCf.length > 0 && Object.keys(withCf[0].custom_fields).every((k) => /^[0-9]+$/.test(k)), { defsLive, sample: withCf[0] && withCf[0].custom_fields });
// the form as the platform loads it: the same lines, custom fields by name
const asForm = lines.map((l) => Object.assign({}, l, { custom_fields: l.custom_fields ? Object.fromEntries(Object.entries(l.custom_fields).map(([k, v]) => [defsLive[k] || k, v])) : l.custom_fields }));
c = diff({ table_gd: asForm }, Object.assign({}, hdr, { table_gd: lines }));
t("dev 029: the form as loaded (names) against the stored lines (ids): no line custom-fields change", c.indexOf(CF) < 0, c);
const edited = asForm.map((l, i) => (l === asForm[asForm.indexOf(asForm.find((x) => x.custom_fields && Object.keys(x.custom_fields).length))] ? Object.assign({}, l, { custom_fields: Object.assign({}, l.custom_fields, { [Object.keys(l.custom_fields)[0]]: 999 }) }) : l));
c = diff({ table_gd: edited }, Object.assign({}, hdr, { table_gd: lines }));
t("dev 029: one line value edited: table_gd.custom_fields", c.indexOf(CF) >= 0, c);
console.log(fails ? fails + " FAILED" : "all passed");
process.exitCode = fails ? 1 : 0;
