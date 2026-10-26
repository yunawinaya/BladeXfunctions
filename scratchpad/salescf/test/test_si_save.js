// test_si_save.js: SI_SAVE stores the SI header custom fields (out/dev/SI_SAVE.json from build.py). The add node writes the
// payload's object; the update node writes it through the keep-stored guard: a save that leaves the key out gets the stored
// column back (one column, by id), a save that sends it writes it. Code nodes run with placeholders filled like the platform.
// Run: node scratchpad/salescf/test/test_si_save.js [out/<env>/SI_SAVE.json]
const fs = require("fs"), assert = require("assert"), path = require("path");
const W = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "out", "dev", "SI_SAVE.json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const node = (id) => { const n = find(W, id); assert.ok(n, "no node " + id); return n; };
// a placeholder the payload lacks resolves to null; a present one to its JSON value
const run = (id, vals) => new Function(node(id).data.script.code.replace(/\{\{(?:node|system):([A-Za-z0-9_.]+)\}\}/g, (m, name) =>
  (name in vals && vals[name] !== undefined ? JSON.stringify(vals[name]) : "null")))();
const CF = "code_si_prep.data.entry.custom_fields_h35azf2l", ID = "code_si_prep.data.entry.id";
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

let r = run("code_node_SiCfNeed", { [CF]: { a: 1 }, [ID]: "2114000000000000001" });
assert.deepStrictEqual(r, { need: "0", id: "2114000000000000001" });
let o = run("code_node_SiCfOut", { "code_node_SiCfNeed.data.need": "0", [CF]: { a: 1 }, "sql_node_SiCfRead.data": null });
assert.deepStrictEqual(o, { cf: { a: 1 } });
ok("present_no_read: the payload's object is written, nothing is read");

r = run("code_node_SiCfNeed", { [CF]: { lsh_envelope: false }, [ID]: "2114000000000000001" });
assert.strictEqual(r.need, "0");
o = run("code_node_SiCfOut", { "code_node_SiCfNeed.data.need": "0", [CF]: { lsh_envelope: false } });
assert.deepStrictEqual(o, { cf: { lsh_envelope: false } });
ok("false_present: {lsh_envelope:false} is a value, not a missing key");

r = run("code_node_SiCfNeed", { [ID]: "2114000000000000001" });
assert.deepStrictEqual(r, { need: "1", id: "2114000000000000001" });
const stored = { "2114764172450934786": "x" };
o = run("code_node_SiCfOut", { "code_node_SiCfNeed.data.need": "1", "sql_node_SiCfRead.data": [{ si_id: "2114000000000000001", custom_fields_h35azf2l: stored }] });
assert.deepStrictEqual(o, { cf: stored });
o = run("code_node_SiCfOut", { "code_node_SiCfNeed.data.need": "1", "sql_node_SiCfRead.data": { si_id: "1", custom_fields_h35azf2l: JSON.stringify(stored) } });
assert.deepStrictEqual(o, { cf: stored }, "a single row (object) and a JSON-text column read the same");
ok("missing_reads: a key left out is read back (one column) and written as stored");

o = run("code_node_SiCfOut", { "code_node_SiCfNeed.data.need": "1", "sql_node_SiCfRead.data": [{ si_id: "2114000000000000001" }] });
assert.deepStrictEqual(o, { cf: null });
ok("missing_null_column: a NULL column (dropped from the row) writes null back, i.e. stays NULL");

r = run("code_node_SiCfNeed", { [ID]: "12; DROP" });
assert.deepStrictEqual(r, { need: "0", id: "0" });
ok("a non-digit id never reaches the read");

// wiring: the add node, the update node, the guard's position and declarations
const prop = (nid, name) => node(nid).data.props.list.find((p) => p.prop === name);
assert.strictEqual(prop("add_node_adYeQB4a", "custom_fields_h35azf2l").value, "{{node:code_si_prep.data.entry.custom_fields_h35azf2l}}");
assert.strictEqual(prop("update_node_I7KGszOE", "custom_fields_h35azf2l").value, "{{node:code_node_SiCfOut.data.cf}}");
const parent = (o, id) => {
  if (Array.isArray(o)) { if (o.some((x) => x && x.id === id)) return o; for (const v of o) { const r = parent(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") for (const v of Object.values(o)) { const r = parent(v, id); if (r) return r; }
  return null;
};
assert.deepStrictEqual(parent(W, "update_node_I7KGszOE").map((x) => x.id), ["code_node_SiCfNeed", "if_SiCfNeed", "code_node_SiCfOut", "update_node_I7KGszOE"]);
assert.deepStrictEqual(node("if_SiCfNeed").blocks[0].blocks.map((x) => x.id), ["sql_node_SiCfRead"]);
const names = (id) => node(id).data.response_json.map((f) => f.name);
assert.deepStrictEqual(names("code_node_SiCfNeed"), ["need", "id"]);
assert.deepStrictEqual(names("code_node_SiCfOut"), ["cf"]);
assert.ok(names("sql_node_SiCfRead").includes("custom_fields_h35azf2l"));
const sql = node("sql_node_SiCfRead").data.script.code;
assert.ok(/FROM sales_invoice/.test(sql) && /tenant_id = '\{\{system:tenantId\}\}'/.test(sql) && /CAST\('\{\{node:code_node_SiCfNeed\.data\.id\}\}' AS UNSIGNED\)/.test(sql), sql);
assert.ok(/custom_fields_h35azf2l/.test(sql) && !/SELECT \*/.test(sql), "one column, not the row");
ok("wiring: add / update props, guard order before the update, if true block = the read, declarations, tenant + id guard in SQL");

// the guard's read, run read-only on dev: the stored SI header comes back BY NAME (the platform drops id keys on a header write)
const cp = require("child_process");
const read = (siId) => {
  const s = node("sql_node_SiCfRead").data.script.code.replace("{{node:code_node_SiCfNeed.data.id}}", siId).replace("{{system:tenantId}}", "000000");
  const out = cp.execFileSync(path.join(__dirname, "..", "..", "..", ".dbtools", "db"), ["--dev", "--json", s], { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("\n[") + 1));
};
const live = run("code_node_SiCfOut", { "code_node_SiCfNeed.data.need": "1", "sql_node_SiCfRead.data": read("2114776549963673602") });
assert.deepStrictEqual(live, { cf: { lsh_envelope: true, lsh_restday: "Sun" } });
ok("live read (dev): SI/20261027/0169's header comes back by name, so the update writes names");

console.log(n + " passed");
