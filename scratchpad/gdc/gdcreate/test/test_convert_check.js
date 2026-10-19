// test_convert_check.js: GD_SO_CONVERT_CHECK (repo Goods Delivery/AsyncV2/) on the interpreter, its one read mocked - bad
// input is answered 400 without reading; the read gets the deduplicated digit ids; an SO held by two unfinished saves is
// listed once. Nothing touches a database.
const assert = require("assert");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const run = (params, rows) => {
  let sql = null;
  const e = new Engine({ dir: R + "Goods Delivery/AsyncV2", db: { tenantId: "711077" }, mocks: { sql: { sql_node_SCbusy: (t) => { sql = t; return rows || []; } }, read: {} } });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const returned = e.run("GD_SO_CONVERT_CHECK", params).returned;
  return Object.assign({ sql }, returned);
};
let r = run({ so_ids: [] });
assert.deepStrictEqual([r.code, r.message, r.busy_json, String(r.busy_count), r.sql], ["400", "no sales order ids", "[]", "0", null]);
console.log("ok empty -> 400, nothing read");
r = run({ so_ids: "123,abc" });
assert.deepStrictEqual([r.code, r.message, r.sql], ["400", "sales order ids must be digits", null]);
console.log("ok a non-digit id -> 400, nothing read");
r = run({ so_ids: ["123", "123", "456"] }, [{ so_id: "123", job_id: "9", job_status: "QUEUED" }, { so_id: "123", job_id: "10", job_status: "VALIDATING" }]);
assert.ok(r.sql.includes(`JSON_TABLE('["123","456"]'`) && r.sql.includes("j.tenant_id = '711077'"), r.sql);
assert.strictEqual(r.code, "200");
assert.deepStrictEqual(JSON.parse(r.busy_json), [{ so_id: "123", job_id: "9", job_status: "QUEUED" }]);
assert.strictEqual(String(r.busy_count), "1");
console.log("ok an SO held by two saves -> listed once (its first job); the read got the deduplicated list");
r = run({ so_ids: "123, 456" }, []);
assert.deepStrictEqual([r.code, r.busy_json, String(r.busy_count)], ["200", "[]", "0"]);
console.log("ok comma text, none busy -> 200, []");
console.log("4 passed");
