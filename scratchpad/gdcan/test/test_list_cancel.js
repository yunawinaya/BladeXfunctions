// test_list_cancel.js [--mutate name]: the GD list's bulk Cancel (Bulk Actions/Sales & Distribution/Goods Delivery/CancelWorkflow.js) on a
// mock page with a virtual clock: V2 queued -> followed -> cancelled; NOT_ELIGIBLE at SUBMIT or after PREPARE -> the classic
// cancel; BUSY -> not cancelled; the switch off -> classic only; a cancel still running after FOLLOW_MS -> in the background.
const fs = require("fs"), assert = require("assert");
const FILE = __dirname + "/../../../Bulk Actions/Sales & Distribution/Goods Delivery/CancelWorkflow.js";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const IDS = JSON.parse(fs.readFileSync(__dirname + "/../../../Goods Delivery/CancelV2/ids.json", "utf8"));
const MUT = { no_fallback: ['job.error_code === "GDX_NOT_ELIGIBLE"', "false"], switch_off: ["const CANCEL_V2_ENABLED = true;", "const CANCEL_V2_ENABLED = false;"] };
const GDS = [{ id: "11", delivery_no: "GD/1", gd_status: "Created", organization_id: "9", picking_status: "", is_select_picking: 0 },
  { id: "12", delivery_no: "GD/2", gd_status: "Created", organization_id: "9", picking_status: "", is_select_picking: 0 }];

async function scenario(o) {
  let code = fs.readFileSync(FILE, "utf8");
  if (mutate) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  if (o.off) code = code.split(MUT.switch_off[0]).join(MUT.switch_off[1]);
  const at = code.lastIndexOf("(async () => {");
  code = code.slice(0, at) + "return " + code.slice(at);
  const log = [];
  let now = 1000000;
  const queue = [];
  const fakeSetTimeout = (fn, ms) => { queue.push({ at: now + (ms || 0), fn }); return queue.length; };
  const FakeDate = { now: () => now };
  const page = {
    getComponent: () => ({ $refs: { crud: { tableSelect: o.rows || GDS } } }),
    showLoading: () => {}, hideLoading: () => {}, refresh: () => log.push("refresh"),
    $confirm: async () => true,
    $alert: async (html) => log.push("alert " + html.replace(/<br>/g, " | ").replace(/<\/?strong>/g, "")),
    $message: { success: (m) => log.push("success " + m), error: (m) => log.push("error " + m) },
    runWorkflow: (id, params, ok, bad) => {
      if (id === "2017151544868491265") { log.push("classic " + params.allData.id); return ok({ data: { code: "200" } }); }
      if (id === IDS.GD_CANCEL_SUBMIT) { log.push("submit " + params.gd_id); return ok({ data: o.submit(params.gd_id) }); }
      if (id === IDS.GD_CANCEL_WORKER) { log.push("worker " + params.job_id); return ok({ data: {} }); }
      if (id === "2112084100104495105") return ok({ data: { jobs_json: JSON.stringify(params.job_ids.map((j) => o.job(j, now))) } });
      throw new Error("unexpected workflow " + id);
    },
  };
  const db = { collection: (name) => ({
    doc: (id) => ({ get: async () => ({ data: [{ id: id, gd_status: "Created" }] }), update: async () => log.push("db update " + name) }),
    where: () => ({ update: async () => log.push("rename movements") }),
    filter: () => ({ get: async () => ({ data: [] }) }),
  }) };
  const Filter = function () { return { in: () => ({ build: () => ({}) }) }; };
  const origLog = console.log, origErr = console.error;
  console.log = () => {}; console.error = () => {};
  const done = Function("db", "Filter", "setTimeout", "Date", code).call(page, db, Filter, fakeSetTimeout, FakeDate);
  try {
    for (let guard = 0; guard < 2000; guard++) {
      await new Promise((r) => setImmediate(r));
      if (!queue.length) { if (await Promise.race([done.then(() => true), new Promise((r) => setImmediate(() => r(false)))])) break; continue; }
      queue.sort((a, b) => a.at - b.at);
      const next = queue.shift();
      now = Math.max(now, next.at);
      next.fn();
    }
    await done;
  } finally {
    console.log = origLog; console.error = origErr;
  }
  return log;
}
const job = (status, extra) => (id) => Object.assign({ job_id: id, job_status: status, gd_no: "", error_code: "", error_message: "", progress_message: "" }, extra || {});
let n = 0;
const t = async (name, f) => { await f(); n++; console.log("ok", name); };
(async () => {
  await t("V2: both queued, followed to COMPLETED -> one success toast, no classic call", async () => {
    const log = await scenario({ submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: (id) => job("COMPLETED", { progress_message: "Goods Delivery GD/x-Cancelled cancelled" })(id) });
    assert.deepStrictEqual(log, ["submit 11", "submit 12", "worker J11", "worker J12", "success All 2 Goods Delivery cancelled successfully", "refresh"]);
  });
  await t("V2: a cancel with notes (left in place / unpacked) -> the summary dialog shows them", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }),
      job: job("COMPLETED", { progress_message: "Goods Delivery GD/1-Cancelled cancelled; left as they are (Completed): Picking PI-1; unpacked: HU/1" }) });
    assert.ok(log.some((l) => /^alert Cancelled \(1\): \| Goods Delivery GD\/1-Cancelled cancelled; left as they are \(Completed\): Picking PI-1; unpacked: HU\/1$/.test(l)), log.join(" || "));
  });
  await t("V2: NOT_ELIGIBLE at SUBMIT -> the classic cancel of that delivery", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: () => ({ route: "NOT_ELIGIBLE", message: "it has serial-numbered items" }), job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["submit 11", "classic 11", "rename movements", "success All 1 Goods Delivery cancelled successfully", "refresh"]);
  });
  await t("V2: FAILED GDX_NOT_ELIGIBLE after PREPARE (the GD is back to Created) -> the classic cancel", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("FAILED", { error_code: "GDX_NOT_ELIGIBLE", error_message: "linked" }) });
    assert.deepStrictEqual(log, ["submit 11", "worker J11", "classic 11", "rename movements", "success All 1 Goods Delivery cancelled successfully", "refresh"]);
  });
  await t("V2: BUSY -> not cancelled, with the reason; nothing else called", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: () => ({ route: "BUSY", message: "Picking PI-1 is being processed on a device right now." }), job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["submit 11", "alert Not cancelled (1): | GD/1: Picking PI-1 is being processed on a device right now.", "refresh"]);
  });
  await t("V2: a job under review -> not cancelled, do not cancel again", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("REQUIRES_REVIEW", { error_message: "X4P_PICKING: changed" }) });
    assert.ok(log.some((l) => /Held for review by an administrator: X4P_PICKING: changed Do not cancel it again\./.test(l)), log.join(" || "));
  });
  await t("V2: still running after FOLLOW_MS -> reported in the background; the worker re-kicked every 5th check", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("COMMITTING_GD") });
    assert.ok(log.some((l) => /Being cancelled in the background \(1\): \| GD\/1/.test(l)), log.join(" || "));
    assert.ok(log.filter((l) => l === "worker J11").length >= 5, "re-kicked");
  });
  await t("the switch off -> every delivery the classic way, no SUBMIT", async () => {
    const log = await scenario({ off: true, submit: () => { throw new Error("no submit"); }, job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["classic 11", "rename movements", "classic 12", "rename movements", "success All 2 Goods Delivery cancelled successfully", "refresh"]);
  });
  console.log(n + " passed" + (mutate ? " (mutant " + mutate + ")" : ""));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
