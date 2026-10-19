// test_convert_handler.js: the SO list's func_handleConvertGD (repo Goods Delivery/GDhandleConvertSOtoGD.js) on a mock page -
// the GD_SO_CONVERT_CHECK answer decides whether sales orders still saving in the background are converted: none busy ->
// converted as before; all busy -> told, nothing converted; some busy -> told + "convert the others" (or cancel); a failed
// check -> converted as before (GD_ASYNC_SUBMIT still refuses the save).
const fs = require("fs"), assert = require("assert");
const code = fs.readFileSync(__dirname + "/../../../../Goods Delivery/GDhandleConvertSOtoGD.js", "utf8").replace(/SO_CONVERT_CHECK_WORKFLOW_ID = "[0-9]{19}"/, 'SO_CONVERT_CHECK_WORKFLOW_ID = "CHECK"');
if (!code.includes('SO_CONVERT_CHECK_WORKFLOW_ID = "CHECK"')) throw new Error("the handler carries no 19-digit GD_SO_CONVERT_CHECK id");
const DRAFT = "1985267806223810561";
const wait = () => new Promise((r) => setTimeout(r, 20));
async function scenario({ busy, checkFails, userConvertsOthers }) {
  const log = { checks: [], converts: [], alerts: [], confirms: [], views: 0 };
  const page = {
    showLoading() {}, hideLoading() {}, refresh: async () => {},
    toView: async () => { log.views++; },
    $alert: async (msg) => { log.alerts.push(msg); },
    $confirm: (msg) => { log.confirms.push(msg); return userConvertsOthers ? Promise.resolve() : Promise.reject(new Error("cancel")); },
    getVarGlobal: () => "nick",
    runWorkflow(id, params, ok, err) {
      if (id === "CHECK") {
        log.checks.push(params.so_ids);
        if (checkFails) return err("gateway down");
        return ok({ data: { busy_json: JSON.stringify(busy || []) } });
      }
      if (id === DRAFT) {
        log.converts.push(params.so_ids);
        return ok({ data: { data: [{ delivery_no: "draft", all_item: "[]" }] } });
      }
      throw new Error("unexpected workflow " + id);
    },
  };
  const db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, picking_after: "Goods Delivery", convert_gd_created: 0 }] }) }) }) };
  const records = [{ id: "1", so_no: "SO/1", customer_name: { id: "C" } }, { id: "2", so_no: "SO/2", customer_name: { id: "C" } }];
  const one = Function("db", "window", "return async function () {\n" + code + "\n}")(db, {});
  // two selected SOs ask "single or multiple"; answer through $confirm's beforeClose like the dialog does
  page.$confirm = ((base) => (msg, title, opts) => {
    if (opts && opts.beforeClose) return opts.beforeClose("confirm", {}, () => {});
    return base(msg, title, opts);
  })(page.$confirm);
  await one.call(page, { selectedRecords: records, plantID: "P", organizationID: "O" });
  for (let i = 0; i < 20; i++) await wait();
  return log;
}
(async () => {
  let r = await scenario({ busy: [] });
  assert.deepStrictEqual(r.checks, [["1", "2"]]);
  assert.deepStrictEqual(r.converts, [["1", "2"]], "nothing busy: both converted as before");
  assert.strictEqual(r.views, 1);
  console.log("ok none busy -> converted as before");

  r = await scenario({ busy: [{ so_id: "1", job_id: "9", job_status: "VALIDATING" }, { so_id: "2", job_id: "10", job_status: "QUEUED" }] });
  assert.deepStrictEqual(r.converts, [], "all busy: nothing converted");
  assert.strictEqual(r.alerts.length, 1);
  assert.ok(/These sales orders have a goods delivery that is still being saved in the background/.test(r.alerts[0]) && /SO\/1<br>SO\/2/.test(r.alerts[0]));
  console.log("ok all busy -> told, nothing converted");

  r = await scenario({ busy: [{ so_id: "1", job_id: "9", job_status: "VALIDATING" }], userConvertsOthers: true });
  assert.ok(/This sales order has/.test(r.confirms[0]) && /Convert the other 1 sales order\?/.test(r.confirms[0]), r.confirms[0]);
  assert.deepStrictEqual(r.converts, [["2"]], "some busy + convert the others: only the free one");
  console.log("ok some busy + 'convert the others' -> only the free SO converted");

  r = await scenario({ busy: [{ so_id: "1", job_id: "9", job_status: "VALIDATING" }], userConvertsOthers: false });
  assert.deepStrictEqual(r.converts, [], "some busy + cancel: nothing converted");
  console.log("ok some busy + cancel -> nothing converted");

  r = await scenario({ checkFails: true });
  assert.deepStrictEqual(r.converts, [["1", "2"]], "a failed check converts as before");
  console.log("ok check fails -> converted as before (the save is still guarded)");
  console.log("5 passed");
})().catch((e) => { console.error(e); process.exit(1); });
