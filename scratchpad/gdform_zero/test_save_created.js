// test_save_created.js <handler.js>: runs the GD form's Save as Created handler on a mock form - the zero-quantity
// question, the rows it removes, V2 vs the frozen save, and the 500-line refusal for new deliveries (10-22)
const fs = require("fs");
const code = fs.readFileSync(process.argv[2], "utf8");
const line = (i, q) => ({ material_id: String(100000000000000000n + BigInt(i)), gd_qty: q });
const values = (lines, extra) => Object.assign({ delivery_no_type: "2021056571405717508", delivery_no: "", plant_id: "1942795438353035266", table_gd: lines }, extra || {});
async function run(s) {
  const calls = { confirm: [], setData: [], error: [], trigger: [], submit: [] };
  const state = { values: s.values };
  const self = {
    models: { _data: {} }, isAdd: s.isAdd !== false, isCopy: false, parentGenerateForm: null,
    getValues: () => JSON.parse(JSON.stringify(state.values)),
    getValue: (k) => (k === "organization_id" ? "1901545950162329602" : state.values[k]),
    setData: async (o) => { calls.setData.push(Object.keys(o).includes("table_gd") ? o.table_gd.length : null); Object.assign(state.values, o); },
    $confirm: async (m) => { calls.confirm.push(m); if (!s.proceed) throw new Error("cancel"); },
    $message: { error: (m) => calls.error.push(m), warning: () => {}, success: () => {} },
    triggerEvent: async (n) => { calls.trigger.push(n); },
    showLoading: () => {}, hideLoading: () => {}, hide: () => {}, getVarSystem: () => "", getVarGlobal: () => "",
    runWorkflow: (id, p, ok) => { if (p && p.payload) { calls.submit.push(JSON.parse(p.payload).lines.length); ok({ data: { job_id: "J1", result_code: s.useClassic ? "GD_V2_USE_CLASSIC" : "" } }); } else ok({ data: {} }); },
  };
  const db = { collection: () => ({ filter: (f) => ({ get: async () => ({ data: f[0].children[0].value.map((id) => ({ id: id, stock_control: (s.nonStock || []).includes(id) ? 0 : 1, show_delivery: 1 })) }) }) }) };
  const quiet = console.log; console.log = () => {}; const qe = console.error; console.error = () => {};
  try { new Function("db", code).call(self, db); await new Promise((r) => setTimeout(r, 200)); } finally { console.log = quiet; console.error = qe; }
  return calls;
}
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
];
(async () => {
  let fails = 0;
  for (const [name, s, ok] of cases) {
    const c = await run(s);
    const pass = ok(c);
    if (!pass) fails++;
    console.log((pass ? "ok   " : "FAIL ") + name + (pass ? "" : "  " + JSON.stringify({ confirm: c.confirm.map((m) => m.slice(0, 70)), setData: c.setData, submit: c.submit, trigger: c.trigger, error: c.error.map((m) => m.slice(0, 90)) })));
  }
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})();
