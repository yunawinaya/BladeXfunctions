// test_v2_payload.js: the GD Created V2 payload carries the header custom fields, and SO_AUTO_GD's header has them.
// 1. UXC.header_fields gains custom_fields in its three copies (SO_AUTO_GD code_v2plan; the GD form's
//    gdV2_onClick_save_as_created and gdV2_func_processGDLineItem): the three lists stay equal, the two form UXC blocks stay
//    byte-identical, nothing else in any copy changes.
// 2. The payload builder's own copy statement (code_v2plan) keeps an object as-is and leaves an absent key out.
// 3. code_build's buildHeader, run whole on the platform's own reads of dev test SOs (base vs out): the header gains
//    custom_fields = the SO's header custom fields by name (false kept, {} when the SO has none); nothing else differs.
// Run: node scratchpad/salescf/test/test_v2_payload.js [dev|prod]
const fs = require("fs"), assert = require("assert"), path = require("path"), cp = require("child_process");
const ENV = process.argv[2] || "dev", P = path.join(__dirname, "..");
const load = (kind, name) => JSON.parse(fs.readFileSync(path.join(P, kind, ENV, name + ".json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const uxc = (code) => code.match(/const UXC = (\{.*?\});/s)[1];
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

// 1. the three header lists
const soaOut = load("out", "SO_AUTO_GD"), soaBase = load("base", "SO_AUTO_GD");
const formOut = load("out", "form_goods_delivery"), formBase = load("base", "form_goods_delivery");
const handler = (f, name) => f.config.eventScript.find((e) => e.name === name).func;
const copies = {
  code_v2plan: [find(soaOut, "code_v2plan").data.script.code, find(soaBase, "code_v2plan").data.script.code],
  gdV2_onClick_save_as_created: [handler(formOut, "gdV2_onClick_save_as_created"), handler(formBase, "gdV2_onClick_save_as_created")],
  gdV2_func_processGDLineItem: [handler(formOut, "gdV2_func_processGDLineItem"), handler(formBase, "gdV2_func_processGDLineItem")],
};
const lists = {};
for (const [k, [out, base]] of Object.entries(copies)) {
  const a = JSON.parse(uxc(out)).header_fields, b = JSON.parse(uxc(base)).header_fields;
  assert.strictEqual(b.length, 111, k);
  assert.deepStrictEqual(a, b.concat(["custom_fields"]), k + ": custom_fields appended");
  assert.strictEqual(out.replace(/"sales_person", ?"custom_fields"\]/, (m) => m.replace(/, ?"custom_fields"/, "")), base, k + ": nothing else changed");
  lists[k] = a;
}
assert.deepStrictEqual(lists.code_v2plan, lists.gdV2_onClick_save_as_created);
assert.deepStrictEqual(lists.gdV2_func_processGDLineItem, lists.gdV2_onClick_save_as_created);
assert.strictEqual(uxc(copies.gdV2_onClick_save_as_created[0]), uxc(copies.gdV2_func_processGDLineItem[0]), "the two form UXC blocks byte-identical");
ok("UXC.header_fields: 112 in all three copies (custom_fields last), lists equal, form UXC blocks byte-identical, nothing else changed");

// 2. the payload builder's copy statement
const stmt = copies.code_v2plan[0].match(/const header = \{\};\s*for \(const f of UXC\.header_fields\) if \(v\[f\] !== undefined\) header\[f\] = v\[f\];/);
assert.ok(stmt, "code_v2plan's header copy statement is unchanged");
const UXC = JSON.parse(uxc(copies.code_v2plan[0]));
const build = (v) => new Function("UXC", "v", stmt[0] + " return header;")(UXC, v);
assert.deepStrictEqual(build({ customer_name: "1", custom_fields: { lsh_envelope: false } }).custom_fields, { lsh_envelope: false });
assert.ok(!("custom_fields" in build({ customer_name: "1" })), "an absent key stays absent");
ok("gdV2Payload's header keeps custom_fields as sent (false kept); an absent key stays out");

// 3. code_build on the platform's reads of dev test SOs
const SO = { "2107395955356266497": { lsh_envelope: true, lsh_restday: "Sun" }, "2105910151874023426": { lsh_envelope: false, lsh_resthour: "12-1" },
  "2105905812508454914": {} };
const scratch = process.env.SCRATCH || "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/454339d2-8350-4882-9cef-f4897bdedf89/scratchpad";
const read = (id) => {
  const out = cp.execFileSync("sudu-lowcode", ["--full", "data", "query", "sales_order", "--where", JSON.stringify({ id }), "--limit", "1", "--format", "json"],
    { cwd: scratch, encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{"))).data.rows[0];
};
const runBuild = (code, so) => {
  const subs = {
    "{{node:search_so.data.data}}": [so], "{{node:search_customers.data.data}}": [], "{{node:sql_node_Items.data}}": [],
    "{{node:code_gate.data.accIntegrationType}}": "", "{{node:code_gate.data.deliveryNoType}}": "", "{{workflowparams:created_by}}": "admin",
    "{{workflowparams:gd_type}}": "multiple", "{{workflowparams:organization_id}}": String(so.organization_id || ""), "{{workflowparams:plant_id}}": String(so.plant_name || ""),
  };
  let src = code;
  for (const [k, v] of Object.entries(subs)) src = src.split(k).join(JSON.stringify(v));
  assert.ok(!/\{\{[^}]+\}\}/.test(src), "unsubstituted placeholder");
  return new Function(src)();
};
const cbOut = find(soaOut, "code_build").data.script.code, cbBase = find(soaBase, "code_build").data.script.code;
// SO/20261006-009 has lines left to deliver (the other test SOs are fully planned): its real read, and the same read with
// only the header custom fields varied (false / empty / key absent)
const real = read("2107395955356266497");
const cases = [
  ["SO/20261006-009 as stored", real, SO["2107395955356266497"]],
  ["Envelope false", Object.assign({}, real, { custom_fields_m07krnod: { lsh_envelope: false, lsh_resthour: "12-1" } }), { lsh_envelope: false, lsh_resthour: "12-1" }],
  ["empty object", Object.assign({}, real, { custom_fields_m07krnod: {} }), {}],
  ["key absent (NULL column)", (({ custom_fields_m07krnod, ...rest }) => rest)(real), {}],
];
for (const [id, so, want] of cases) {
  const a = runBuild(cbOut, so), b = runBuild(cbBase, so);
  const pa = a.payloads || a.data || a, pb = b.payloads || b.data || b;
  assert.ok(Array.isArray(pa) && pa.length === 1, "one payload for " + id + ": " + JSON.stringify(a).slice(0, 300));
  const ha = pa[0].allData || pa[0], hb = pb[0].allData || pb[0];
  assert.deepStrictEqual(ha.custom_fields, want, id);
  assert.ok(!("custom_fields" in hb), "the base header has no custom_fields");
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
    ? Object.keys(v).sort().reduce((o, k) => ((o[k] = canon(v[k])), o), {}) : v);
  const strip = (h) => { const { custom_fields, delivery_date, ...rest } = h; return JSON.stringify(canon(rest)); };
  assert.strictEqual(strip(ha), strip(hb), id + ": nothing else in the payload differs (delivery_date is the run's clock)");
}
ok("buildHeader: custom_fields = the SO's header custom fields by name (true / false / {}), the rest of the payload unchanged");
console.log(n + " passed");
