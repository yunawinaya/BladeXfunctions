// test_so_convert_gd.js: SU: SO_Convert_GD (the SO list's Draft / form convert) maps the GD header custom fields. Its code
// node runs whole (base vs out) on the platform's own reads of dev test SOs (the search node's shape, so names): each mapped
// GD carries its FIRST SO's header custom fields (false kept, {} when that SO has none), nothing else changes, and the node
// declares custom_fields so the Add Data binding {{node:code_node_HOWEZH5S.data.custom_fields}} gets it.
// Run: node scratchpad/salescf/test/test_so_convert_gd.js [dev|prod]
const fs = require("fs"), assert = require("assert"), path = require("path"), cp = require("child_process");
const ENV = process.argv[2] || "dev", P = path.join(__dirname, "..");
const load = (kind) => JSON.parse(fs.readFileSync(path.join(P, kind, ENV, "SO_Convert_GD.json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const scratch = process.env.SCRATCH || "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/454339d2-8350-4882-9cef-f4897bdedf89/scratchpad";
const read = (id) => {
  const out = cp.execFileSync("sudu-lowcode", ["--full", "data", "query", "sales_order", "--where", JSON.stringify({ id }), "--limit", "1", "--format", "json"],
    { cwd: scratch, encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{"))).data.rows[0];
};
const A = read("2107395955356266497"), B = read("2105910151874023426"), E = read("2105905812508454914");
const WANT = { [A.id]: { lsh_envelope: true, lsh_restday: "Sun" }, [B.id]: { lsh_envelope: false, lsh_resthour: "12-1" }, [E.id]: {} };
const run = (doc, sos, type) => {
  let src = find(doc, "code_node_HOWEZH5S").data.script.code;
  const subs = { "{{node:search_node_ZidRIRxa.data.data}}": sos, "{{system:tenantId}}": "000000", "{{workflowparams:gd_type}}": type,
    "{{workflowparams:plant_id}}": String(sos[0].plant_name || "") };
  for (const [k, v] of Object.entries(subs)) src = src.split(k).join(JSON.stringify(v));
  assert.ok(!/\{\{[^}]+\}\}/.test(src), "unsubstituted placeholder");
  return new Function(src)();
};
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
  ? Object.keys(v).sort().reduce((o, k) => ((o[k] = canon(v[k])), o), {}) : v);
const strip = (g) => { const { custom_fields, delivery_date, ...rest } = g; return JSON.stringify(canon(rest)); };
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };
const out = load("out"), base = load("base");
for (const [label, sos, type] of [["one GD per SO (A)", [A], "multiple"], ["one GD per SO (Envelope false)", [B], "multiple"],
  ["one GD per SO (empty)", [E], "multiple"], ["combined, B first", [B, A], "single"], ["combined, empty first", [E, A], "single"]]) {
  const got = run(out, sos, type), was = run(base, sos, type);
  const gs = Array.isArray(got) ? got : [got], ws = Array.isArray(was) ? was : [was];
  assert.strictEqual(gs.length, ws.length, label);
  gs.forEach((g, i) => {
    const first = type === "single" ? sos[0] : sos[i];
    assert.deepStrictEqual(g.custom_fields, WANT[first.id], label);
    assert.ok(!("custom_fields" in ws[i]), "the base mapping has no header custom_fields");
    assert.strictEqual(strip(g), strip(ws[i]), label + ": nothing else differs");
  });
}
ok("each mapped GD carries its first SO's header custom fields (true / false / {}); the rest of the mapping unchanged");
const decl = find(out, "code_node_HOWEZH5S").data.response_json.filter((f) => f.name === "custom_fields");
assert.strictEqual(decl.length, 1);
assert.deepStrictEqual(find(out, "add_node_sJZrsg5i").data.props.list.filter((p) => p.prop === "custom_fields").map((p) => p.value),
  ["{{node:code_node_HOWEZH5S.data.custom_fields}}"]);
ok("custom_fields is declared once; Add Data's existing binding is untouched");
console.log(n + " passed");
