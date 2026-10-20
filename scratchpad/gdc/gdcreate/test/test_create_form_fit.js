// test_create_form_fit.js [--mutate drop_frozen]: Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js on a mock form.
// GD_ASYNC_SUBMIT's GD_V2_USE_CLASSIC answer (no job made) runs the frozen save; the other answers behave as before.
const fs = require("fs"), assert = require("assert");
const FILE = __dirname + "/../../../../Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js";
const SUBMIT = "2105133540498116609", WORKER = "2104840667119411201";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = { drop_frozen: ['if (outcome.action === "FROZEN") {', "if (false) {"] };

async function scenario(o) {
  let code = fs.readFileSync(FILE, "utf8");
  if (mutate) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const at = code.lastIndexOf("(async () => {");
  code = code.slice(0, at) + "return " + code.slice(at);
  const log = [], submits = [];
  const answers = (o.answers || []).slice();
  const values = Object.assign({ id: "", delivery_no: "GD-T-1", delivery_no_type: "", plant_id: "2105200506810306561", organization_id: "2105190589240086530",
    table_gd: [{ material_id: "11", gd_qty: 2, line_so_id: "81", so_line_item_id: "91", gd_order_uom_id: "5", temp_qty_data: "[]" }] }, o.values || {});
  const form = {
    isAdd: true, isCopy: false, models: { _data: {} },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.push("closed") } }, refresh: () => log.push("refreshed") },
    getValues: () => values,
    getValue: (k) => (k === "gd_v2_job_id" ? form._job : values[k]),
    getVarSystem: () => "", getVarGlobal: () => "",
    setData: async (d) => { if (d.gd_v2_job_id) form._job = d.gd_v2_job_id; },
    showLoading: () => {}, hideLoading: () => {}, hide: () => log.push("buttons hidden"),
    triggerEvent: async (name) => log.push("TRIGGER " + name),
    $message: { warning: (m) => log.push("warning " + m), error: (m) => log.push("error " + m), success: (m) => log.push("success " + m) },
    runWorkflow: (id, params, ok) => {
      if (id === SUBMIT) { submits.push(params); ok({ data: answers.shift() }); }
      else if (id === WORKER) log.push("worker " + params.job_id);
      else throw new Error("unexpected workflow " + id);
    },
  };
  const db = { collection: () => ({ filter: () => ({ get: async () => ({ data: [{ id: "11", stock_control: 1, show_delivery: 1 }] }) }) }) };
  const origLog = console.log, origErr = console.error;
  console.log = () => {}; console.error = () => {};
  try { await Function("db", code).call(form, db); } finally { console.log = origLog; console.error = origErr; }
  return { log, submits };
}

const ANSWER = (over) => Object.assign({ result_code: "", result_message: "", job_id: "", job_status: "", created: "NO", line_errors: "[]" }, over);
let n = 0;
const t = async (name, f) => { await f(); n++; console.log("ok", name); };
(async () => {
  await t("GD_V2_USE_CLASSIC (no job) -> the frozen save runs; no error, the dialog stays for it, no worker", async () => {
    const r = await scenario({ answers: [ANSWER({ result_code: "GD_V2_USE_CLASSIC", result_message: "This delivery needs the classic save: line 1: handling units in this plant hold material 11." })] });
    assert.strictEqual(r.submits.length, 1);
    assert.deepStrictEqual(r.log, ["TRIGGER onClick_save_as_created"]);
  });
  await t("queued (a job id) -> closed, worker started (unchanged)", async () => {
    const r = await scenario({ answers: [ANSWER({ job_id: "7000", job_status: "QUEUED", created: "YES" })] });
    assert.deepStrictEqual(r.log, ["buttons hidden", "success Goods Delivery submitted. It is being created in the background and will appear in the list shortly.", "closed", "refreshed", "worker 7000"]);
  });
  await t("another refusal (same sales order still saving) -> error, stays (unchanged)", async () => {
    const r = await scenario({ answers: [ANSWER({ result_code: "GD_SO_SAVE_RUNNING", result_message: "A delivery for SO/1 is still being saved in the background" })] });
    assert.strictEqual(r.log.length, 1);
    assert.ok(/^error Not submitted: A delivery for SO\/1/.test(r.log[0]), r.log[0]);
  });
  await t("not routed to V2 (built from a Picking) -> frozen save, nothing submitted (unchanged)", async () => {
    const r = await scenario({ values: { is_select_picking: 1 } });
    assert.deepStrictEqual([r.log, r.submits.length], [["TRIGGER onClick_save_as_created"], 0]);
  });
  console.log(n + " passed" + (mutate ? " (mutant " + mutate + ")" : ""));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
