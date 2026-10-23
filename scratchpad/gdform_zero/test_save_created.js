// test_save_created.js <handler.js>: runs the GD form's Save as Created handler on a mock form - the zero-quantity
// question, the rows it removes, V2 vs the frozen save, and the 500-line refusal for new deliveries (10-22)
const fs = require("fs");
const code = fs.readFileSync(process.argv[2], "utf8");
const line = (i, q) => ({ material_id: String(100000000000000000n + BigInt(i)), gd_qty: q });
const values = (lines, extra) => Object.assign({ delivery_no_type: "2021056571405717508", delivery_no: "", plant_id: "1942795438353035266", table_gd: lines }, extra || {});
async function run(s) {
  const calls = { confirm: [], setData: [], error: [], trigger: [], submit: [], params: [], alert: [], success: [], checks: 0, kicks: 0, display: [], unitReads: [] };
  const state = { values: s.values };
  const self = {
    models: { _data: {} }, isAdd: s.isAdd !== false, isCopy: false, parentGenerateForm: null,
    getValues: () => JSON.parse(JSON.stringify(state.values)),
    getValue: (k) => (k === "organization_id" ? "1901545950162329602" : state.values[k]),
    setData: async (o) => { calls.setData.push(Object.keys(o).includes("table_gd") ? o.table_gd.length : null); Object.assign(state.values, o); },
    $confirm: async (m) => { calls.confirm.push(m); if (!s.proceed) throw new Error("cancel"); },
    $alert: async (m) => { calls.alert.push(m); },
    $message: { error: (m) => calls.error.push(m), warning: () => {}, success: (m) => calls.success.push(m) },
    triggerEvent: async (n) => { calls.trigger.push(n); },
    showLoading: () => {}, hideLoading: () => {}, hide: () => {}, display: (b) => calls.display.push(b), getVarSystem: () => "", getVarGlobal: () => "",
    runWorkflow: (id, p, ok) => {
      if (p && p.job_ids) {
        const seq = s.check || [{ job_status: "READY_TO_COMMIT" }];
        const st = seq[Math.min(calls.checks, seq.length - 1)];
        calls.checks += 1;
        return ok({ data: { jobs_json: JSON.stringify([Object.assign({ job_id: "J1" }, st)]) } });
      }
      if (p && p.job_id) { calls.kicks += 1; return; }
      if (!(p && p.payload)) return ok({ data: {} });
      calls.submit.push(JSON.parse(p.payload).lines.length);
      calls.params.push({ needCL: p.needCL, key: p.idempotency_key });
      ok({ data: (s.answers && s.answers[calls.params.length - 1]) || { job_id: "J1", result_code: s.useClassic ? "GD_V2_USE_CLASSIC" : "" } });
    },
  };
  const db = { collection: (name) => ({ filter: (f) => ({ get: async () => {
    if (name === "unit_of_measurement") {
      calls.unitReads.push(f[0].children[0].value);
      if (s.unitsFail) throw new Error("read failed");
      return { data: f[0].children[0].value.filter((id) => (s.units || {})[id]).map((id) => ({ id: id, uom_name: s.units[id] })) };
    }
    return { data: f[0].children[0].value.map((id) => ({ id: id, stock_control: (s.nonStock || []).includes(id) ? 0 : 1, show_delivery: 1 })) };
  } }) }) };
  const quiet = console.log; console.log = () => {}; const qe = console.error; console.error = () => {};
  // a virtual clock: a wait of a second or more returns at once and moves the clock (the follow polls for up to 90 s)
  const realST = global.setTimeout, realNow = Date.now;
  let clock = 1e12;
  Date.now = () => clock;
  global.setTimeout = (fn, ms) => { if (ms >= 1000) clock += ms; return realST(fn, 0); };
  try { new Function("db", code).call(self, db); await new Promise((r) => realST(r, 400)); } finally { console.log = quiet; console.error = qe; global.setTimeout = realST; Date.now = realNow; }
  return calls;
}
const QUEUED = { job_id: "J1", job_status: "QUEUED", created: "YES", result_code: "" };
const OVERRIDE = { result_code: "GD_CREDIT_LIMIT_OVERRIDE", result_message: "Over the limit. Proceed?", job_id: "", created: "NO" };
const L = (n, zeroAt = []) => Array.from({ length: n }, (_, i) => line(i, zeroAt.includes(i) ? 0 : 1));
const cases = [
  ["2,004 lines, 5 at 0, Proceed -> rows removed, V2 with 1,999", { values: values(L(2004, [0, 1, 2, 3, 4])), proceed: true },
    (c) => c.confirm.length === 1 && /Lines #1, #2, #3, #4, #5 have a zero deliver quantity/.test(c.confirm[0]) && c.setData[0] === 1999 && c.submit[0] === 1999 && !c.trigger.length],
  ["same, Cancel -> nothing saved", { values: values(L(2004, [0, 1, 2, 3, 4])), proceed: false },
    (c) => c.confirm.length === 1 && !c.setData.length && !c.submit.length && !c.trigger.length],
  ["1,500 at 0 of 2,004 -> list capped at 20", { values: values(L(2004, Array.from({ length: 1500 }, (_, i) => i))), proceed: true },
    (c) => / and 1480 more /.test(c.confirm[0]) && c.submit[0] === 504],
  ["600 lines, a non-stock item -> refused, no classic", { values: values(L(600)), nonStock: [String(100000000000000005n)] },
    (c) => c.error.length === 1 && /600 lines and cannot use the background save/.test(c.error[0]) && !c.trigger.length && !c.submit.length],
  ["100 lines, a non-stock item -> classic as before", { values: values(L(100)), nonStock: [String(100000000000000005n)] },
    (c) => c.trigger.length === 1 && !c.error.length],
  ["Edit of a saved delivery, 600 lines -> classic as before (never refused)", { values: values(L(600), { id: "2113000000000000001" }), isAdd: false },
    (c) => c.trigger.length === 1 && !c.error.length && !c.confirm.length],
  ["2,004 lines, none at 0 -> the 2,000 cap, as before", { values: values(L(2004)) },
    (c) => c.error.length === 1 && /The maximum is 2000/.test(c.error[0]) && !c.submit.length && !c.trigger.length],
  ["server answers USE_CLASSIC on 600 lines -> refused", { values: values(L(600)), useClassic: true },
    (c) => c.submit[0] === 600 && c.error.length === 1 && /600 lines and cannot use the background save/.test(c.error[0]) && !c.trigger.length],
  ["server answers USE_CLASSIC on 100 lines -> classic as before", { values: values(L(100)), useClassic: true },
    (c) => c.submit[0] === 100 && c.trigger.length === 1 && !c.error.length],
  ["every line at 0 -> left to the frozen save (it asks)", { values: values(L(10, Array.from({ length: 10 }, (_, i) => i))), proceed: true },
    (c) => !c.confirm.length && c.trigger.length === 1],
  // the credit limit at the click (10-23): GD_ASYNC_SUBMIT answers a Block or an Override before any job
  ["credit: nothing in the way -> one submit asking (needCL required), queued", { values: values(L(10)), answers: [QUEUED] },
    (c) => c.params.length === 1 && c.params[0].needCL === "required" && c.success.length === 1 && !c.alert.length && !c.confirm.length && !c.error.length],
  ["credit: Block -> the message in an alert, nothing queued, no second submit", { values: values(L(10)), answers: [{ result_code: "GD_CREDIT_LIMIT_BLOCKED", result_message: "Credit limit exceeded. Limit 1,000.00", job_id: "", created: "NO" }] },
    (c) => c.params.length === 1 && c.alert.length === 1 && c.alert[0] === "Credit limit exceeded. Limit 1,000.00" && !c.success.length && !c.confirm.length && !c.error.length],
  ["credit: Override, Proceed -> asked once, resubmitted not required with the same key, queued", { values: values(L(10)), proceed: true, answers: [OVERRIDE, QUEUED] },
    (c) => c.confirm.length === 1 && c.confirm[0] === "Over the limit. Proceed?" && c.params.length === 2 && c.params[0].needCL === "required" && c.params[1].needCL === "not required" && c.params[0].key === c.params[1].key && c.success.length === 1 && !c.error.length],
  ["credit: Override, Cancel -> nothing queued, nothing else", { values: values(L(10)), proceed: false, answers: [OVERRIDE] },
    (c) => c.confirm.length === 1 && c.params.length === 1 && !c.success.length && !c.error.length && !c.alert.length],
  ["credit: Override again after Proceed (an older server) -> an error, no third submit", { values: values(L(10)), proceed: true, answers: [OVERRIDE, OVERRIDE] },
    (c) => c.confirm.length === 1 && c.params.length === 2 && c.error.length === 1 && !c.success.length],
  // the form waits for PREPARE's verdict (10-23)
  ["follow: VALIDATING then READY_TO_COMMIT -> closed with the submitted message, no alert", { values: values(L(10)), answers: [QUEUED], check: [{ job_status: "VALIDATING" }, { job_status: "READY_TO_COMMIT" }] },
    (c) => c.checks === 2 && c.success.length === 1 && /submitted/.test(c.success[0]) && !c.alert.length && !c.display.length],
  ["follow: FAILED with line errors -> alert names the lines (escaped), buttons back, nothing closed", { values: values([Object.assign(line(1, 1), { material_name: "Soap <b>15kg</b>" }), line(2, 1)]), answers: [QUEUED],
    check: [{ job_status: "VALIDATING" }, { job_status: "FAILED", error_code: "GD_INVALID_UOM", error_message: "unit 9 has no conversion to the base unit of the material",
      error_details: JSON.stringify({ line_errors: [{ stable_line_key: "L1", code: "GD_INVALID_UOM", message: "unit 9 has no conversion" }] }) }] },
    (c) => c.alert.length === 1 && /Line 1 \(Soap &lt;b&gt;15kg&lt;\/b&gt;\): unit 9 has no conversion/.test(c.alert[0]) && c.display.length === 1 && !c.success.length],
  ["follow: 500 refused lines, the check sends 10 + the count -> 10 named, '... and 490 more'", { values: values(L(12)), answers: [QUEUED],
    check: [{ job_status: "FAILED", error_code: "GD_INVALID_UOM", error_message: "unit 9 has no conversion",
      error_details: JSON.stringify({ line_errors: Array.from({ length: 10 }, (_, i) => ({ stable_line_key: "L" + (i + 1), message: "unit 9 has no conversion" })), line_error_count: 500 }) }] },
    (c) => c.alert.length === 1 && c.alert[0].startsWith("500 lines need correcting:<br><br>Line 1:") && (c.alert[0].match(/Line \d+:/g) || []).length === 10 && /\.\.\. and 490 more$/.test(c.alert[0])],
  ["follow: details cut or missing -> the header message alone, still an alert", { values: values(L(3)), answers: [QUEUED],
    check: [{ job_status: "FAILED", error_code: "GD_INSUFFICIENT_STOCK", error_message: "Insufficient stock for item P-1", error_details: "{\"line_errors\":[{\"stable_" }] },
    (c) => c.alert.length === 1 && c.alert[0] === "Insufficient stock for item P-1" && c.display.length === 1],
  ["follow: unit ids in the refusal -> one read, names shown (Kg, 箱CTN), an unknown id kept", { values: values([Object.assign(line(1, 1), { material_name: "Noodle" }), line(2, 1), line(3, 1)]), answers: [QUEUED],
    units: { "2113378399719399432": "Kg", "2113378399719399459": "箱CTN" },
    check: [{ job_status: "FAILED", error_code: "GD_INVALID_UOM", error_message: "unit 2113378399719399432 has no conversion to the base unit of the material",
      error_details: JSON.stringify({ line_errors: [
        { stable_line_key: "L1", message: "unit 2113378399719399432 has no conversion to the base unit of the material" },
        { stable_line_key: "L3", message: "unit 2113378399719399459 has no conversion to the base unit of the material" },
        { stable_line_key: "L2", message: "unit 2113378399719399999 has no conversion to the base unit of the material" }], line_error_count: 3 }) }] },
    (c) => c.unitReads.length === 1 && c.unitReads[0].length === 3 &&
      c.alert[0] === "3 lines need correcting:<br><br>Line 1 (Noodle): unit Kg has no conversion to the base unit of the material<br>Line 3: unit 箱CTN has no conversion to the base unit of the material<br>Line 2: unit 2113378399719399999 has no conversion to the base unit of the material"],
  ["follow: the unit read fails -> the ids stay, the alert still shows", { values: values(L(2)), answers: [QUEUED], unitsFail: true,
    check: [{ job_status: "FAILED", error_code: "GD_INVALID_UOM", error_message: "unit 2113378399719399432 has no conversion",
      error_details: JSON.stringify({ line_errors: [{ stable_line_key: "L2", message: "unit 2113378399719399432 has no conversion" }], line_error_count: 1 }) }] },
    (c) => c.alert.length === 1 && c.alert[0] === "1 line needs correcting:<br><br>Line 2: unit 2113378399719399432 has no conversion" && c.display.length === 1],
  ["follow: no unit ids -> no unit read", { values: values(L(3)), answers: [QUEUED],
    check: [{ job_status: "FAILED", error_code: "GD_INSUFFICIENT_STOCK", error_message: "Insufficient stock for item P-1", error_details: JSON.stringify({ line_errors: [{ stable_line_key: "L1", message: "Insufficient stock for item P-1" }], line_error_count: 1 }) }] },
    (c) => c.unitReads.length === 0 && c.alert[0] === "1 line needs correcting:<br><br>Line 1: Insufficient stock for item P-1"],
  ["follow: never decided in 90 s -> closed with the submitted message, the worker re-kicked every 15 s", { values: values(L(10)), answers: [QUEUED], check: [{ job_status: "VALIDATING" }] },
    (c) => c.checks >= 40 && c.kicks >= 6 && c.success.length === 1 && /submitted/.test(c.success[0]) && !c.alert.length],
  ["follow: GD_COMMITTED with its number -> 'Goods Delivery GD/1 created.'", { values: values(L(10)), answers: [QUEUED], check: [{ job_status: "GD_COMMITTED", gd_no: "GD/1" }] },
    (c) => c.success.length === 1 && c.success[0] === "Goods Delivery GD/1 created." && !c.alert.length],
  ["follow: an existing job already created -> no follow, closed", { values: values(L(10)), answers: [{ job_id: "J1", job_status: "COMPLETED", created: "NO", result_code: "" }] },
    (c) => c.checks === 0 && c.success.length === 1 && !c.alert.length],
];
(async () => {
  let fails = 0;
  for (const [name, s, ok] of cases) {
    const c = await run(s);
    const pass = ok(c);
    if (!pass) fails++;
    console.log((pass ? "ok   " : "FAIL ") + name + (pass ? "" : "  " + JSON.stringify({ confirm: c.confirm.map((m) => m.slice(0, 70)), setData: c.setData, submit: c.submit, trigger: c.trigger, error: c.error.map((m) => m.slice(0, 90)), alert: c.alert.map((m) => m.slice(0, 160)) })));
  }
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})();
