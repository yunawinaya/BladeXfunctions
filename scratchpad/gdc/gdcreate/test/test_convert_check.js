// test_convert_check.js: GD_SO_CONVERT_CHECK (repo Goods Delivery/AsyncV2/) on the interpreter, its one read mocked - bad
// input is answered 400 without reading; the read gets the deduplicated digit ids; an SO held by two unfinished saves is
// listed once. Nothing touches a database.
const assert = require("assert");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const run = (params, rows, jobs) => {
  let sql = null, jsql = null;
  const e = new Engine({ dir: R + "Goods Delivery/AsyncV2", db: { tenantId: "711077" }, mocks: { sql: { sql_node_SCbusy: (t) => { sql = t; return rows || []; }, sql_node_SCjobs: (t) => { jsql = t; return jobs || []; } }, read: {} } });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const returned = e.run("GD_SO_CONVERT_CHECK", params).returned;
  return Object.assign({ sql, jsql }, returned);
};
let r = run({ so_ids: [] });
assert.deepStrictEqual([r.code, r.message, r.busy_json, String(r.busy_count), r.sql], ["400", "no sales order ids or job ids", "[]", "0", null]);
console.log("ok empty -> 400, nothing read");
r = run({ so_ids: "123,abc" });
assert.deepStrictEqual([r.code, r.message, r.sql], ["400", "ids must be digits", null]);
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
const cancelJob = { job_id: "7", job_status: "COMPLETED", gd_no: "GD/1", error_code: "", error_message: "", command: "CANCEL_GD", progress_message: "Goods Delivery GD/1-Cancelled cancelled; unpacked: HU/1" };
r = run({ job_ids: ["7"] }, [], [cancelJob]);
assert.ok(r.jsql.includes("j.command IN ('CREATE_GD_FROM_FORM', 'CANCEL_GD')") && r.jsql.includes(`JSON_TABLE('["7"]'`), r.jsql);
assert.deepStrictEqual(JSON.parse(r.jobs_json), [cancelJob]);
console.log("ok v5: a GD Cancel V2 job is read back with its command and progress message");
console.log("5 passed");
