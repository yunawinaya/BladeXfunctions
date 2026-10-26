// test_gd_complete_cf.js: GD Complete V2 (GD_COMPLETE_SUBMIT) treats an edited header custom field as an unsaved change, so
// the completion goes through the classic save (which stores it) instead of V2 (which would drop it). The stored GD comes
// from sql_node_GShdr with ids, the form sends names: sql_node_GShdr also returns cf_defs {definition id: field name} and
// gsFormDiff compares the two by name (null / "" values dropped on both sides, as gcStrip does; {} equals NULL).
// gsFormDiff runs from the workflow's own code (cut before its first placeholder); the SQL runs read-only on dev on
// GD/20260904/508 (tenant 000000; stored {lsh_envelope: true, lsh_receivehour: "8-5"} by id).
// Run: node scratchpad/salescf/test/test_gd_complete_cf.js [dev|prod]
const fs = require("fs"), assert = require("assert"), path = require("path"), cp = require("child_process");
const ENV = process.argv[2] || "dev", P = path.join(__dirname, "..");
const W = JSON.parse(fs.readFileSync(path.join(P, "out", ENV, "GD_COMPLETE_SUBMIT.json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const src = find(W, "code_node_GSgate").data.script.code;
const cut = src.indexOf("const guard = [{{node:code_node_GSguard.data}}][0];");
assert.ok(cut > 0);
const M = new Function(src.slice(0, cut) + "\nreturn { gsFormDiff, GC_KINDS, gcObj };")();
const diff = (form, stored) => M.gsFormDiff(Object.assign({ table_gd: [] }, form), Object.assign({ table_gd: [] }, stored), M.GC_KINDS).changed;
const ENV_ID = "2114765569527459842", RH = "2114765750322933761";
const defs = { [ENV_ID]: "lsh_envelope", [RH]: "lsh_receivehour" };
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

assert.ok(!diff({ custom_fields: { lsh_envelope: true } }, { custom_fields: { [ENV_ID]: true }, cf_defs: defs }).includes("custom_fields"));
ok("unchanged_stays_v2: stored ids and form names that mean the same values are no change");

assert.ok(diff({ custom_fields: { lsh_envelope: false } }, { custom_fields: { [ENV_ID]: true }, cf_defs: defs }).includes("custom_fields"));
assert.ok(diff({ custom_fields: { lsh_envelope: true, lsh_receivehour: "9-6" } }, { custom_fields: { [ENV_ID]: true, [RH]: "8-5" }, cf_defs: defs }).includes("custom_fields"));
ok("edit_goes_classic: a changed value (true -> false, 8-5 -> 9-6) is an unsaved change named custom_fields");

assert.ok(!diff({ custom_fields: {} }, {}).includes("custom_fields"));
assert.ok(!diff({ custom_fields: { lsh_restday: "" } }, { custom_fields: {}, cf_defs: defs }).includes("custom_fields"));
ok("empty_vs_null: {} against a NULL column, and an empty-string value against none, are no change");

assert.ok(!diff({ custom_fields: { lsh_envelope: true } }, { custom_fields: { lsh_envelope: true } }).includes("custom_fields"));
ok("no_defs: name-keyed on both sides compares directly");

assert.ok(!diff({}, { custom_fields: { [ENV_ID]: true }, cf_defs: defs }).includes("custom_fields"));
ok("a form payload without the key is not a change");

assert.ok(!diff({ custom_fields: { lsh_envelope: true } }, { custom_fields: { [ENV_ID]: true, "999": "orphan" }, cf_defs: defs }).includes("custom_fields"));
ok("a stored key whose definition is gone is ignored, as cf_names_sql drops it");

// real data: the patched header read on GD/20260904/508, through the node's own row parser
const sql = find(W, "sql_node_GShdr").data.script.code.replace("{{node:code_node_GSentry.data.tenantId}}", "000000").replace("{{node:code_node_GSentry.data.gdId}}", "2095877730484424705");
assert.ok(!/\{\{/.test(sql), "unfilled placeholder");
const outTxt = cp.execFileSync(path.join(P, "..", "..", ".dbtools", "db"), ["--dev", "--json", sql], { encoding: "utf8" });
const rows = JSON.parse(outTxt.slice(outTxt.indexOf("\n[") + 1));
const stored = M.gcObj(rows[0]);
assert.deepStrictEqual(stored.cf_defs, Object.assign({ "2114765622417633281": "lsh_restday", "2114765681024643073": "lsh_resthour" }, defs));
assert.deepStrictEqual(stored.custom_fields, { [ENV_ID]: true, [RH]: "8-5" });
assert.ok(!diff({ custom_fields: { lsh_envelope: true, lsh_receivehour: "8-5" } }, stored).includes("custom_fields"));
assert.ok(diff({ custom_fields: { lsh_envelope: false, lsh_receivehour: "8-5" } }, stored).includes("custom_fields"));
ok("dev GD/20260904/508: cf_defs = the 4 GD header definitions; the stored row equals the form's names, an edit does not");
console.log(n + " passed");
