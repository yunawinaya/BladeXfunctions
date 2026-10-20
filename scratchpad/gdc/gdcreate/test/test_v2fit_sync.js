// test_v2fit_sync.js: GD_ASYNC_SUBMIT and SO_AUTO_GD apply ONE V2 fit. Both carry v2fit_lib.js verbatim and run the same
// fit read (placeholders and SUBMIT's tenant filter aside), so the form and the SO list route a delivery the same way.
const fs = require("fs"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const LIB = fs.readFileSync(__dirname + "/../code/v2fit_lib.js", "utf8");
const node = (file, id) => {
  const walk = (o) => {
    if (Array.isArray(o)) { for (const v of o) { const r = walk(v); if (r) return r; } return null; }
    if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = walk(v); if (r) return r; } }
    return null;
  };
  const n = walk(JSON.parse(fs.readFileSync(R + file, "utf8")));
  assert.ok(n, file + " has no " + id);
  return n.data.script.code;
};
const SUB = "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json", SOA = "Goods Delivery/SOconvertGDCreatedWorkflow.json";
for (const [f, id] of [[SUB, "code_node_GSfitPlan"], [SUB, "code_node_GSfit"], [SOA, "code_v2plan"]]) assert.ok(node(f, id).includes(LIB), id + " does not carry v2fit_lib.js verbatim");
console.log("ok the library is verbatim in code_node_GSfitPlan, code_node_GSfit and code_v2plan");
const a = node(SUB, "sql_node_GSfit")
  .replace(/\n   AND [a-z]+\.tenant_id = '\{\{node:code_node_GSfitPlan\.data\.tenantSql\}\}'/g, "")
  .replace(/\{\{node:code_node_GSfitPlan\.data\.(materialIdsSql|autoMaterialIdsSql)\}\}/g, "<M>")
  .replace(/\{\{node:code_node_GSfitPlan\.data\.(\w+)\}\}/g, "<$1>");
const b = node(SOA, "sql_v2facts").replace(/\{\{node:code_gate\.data\.materialIdCsv\}\}/g, "<M>").replace(/\{\{node:code_v2ids\.data\.(\w+)\}\}/g, "<$1>");
assert.strictEqual(a, b);
console.log("ok the fit read is the same text in both (tenant filter aside)");
