// test_list_revert.js [--mutate name]: the GD list's Revert Completed (Bulk Actions/Sales & Distribution/Goods Delivery/RevertCompletedWorkflow.js)
// on a mock page with a virtual clock: V2 queued -> followed -> reverted; NOT_ELIGIBLE at SUBMIT or after PREPARE -> the classic
// revert; BUSY / FAILED -> not reverted; invoiced rows never submitted; the switch off -> classic only; a revert still running after
// FOLLOW_MS -> in the background. The workflow ids are the file's (placeholders until patch_list_page.py fills them).
const fs = require("fs"), assert = require("assert");
const FILE = __dirname + "/../../../Bulk Actions/Sales & Distribution/Goods Delivery/RevertCompletedWorkflow.js";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = { no_fallback: ['job.error_code === "GDR_NOT_ELIGIBLE"', "false"], switch_off: ["const REVERT_V2_ENABLED = true;", "const REVERT_V2_ENABLED = false;"] };
const SRC = fs.readFileSync(FILE, "utf8");
const SUBMIT_ID = SRC.match(/const GD_REVERT_SUBMIT_ID = "([^"]+)";/)[1];
const WORKER_ID = SRC.match(/const GD_REVERT_WORKER_ID = "([^"]+)";/)[1];
const CLASSIC_ID = "2058819647368241153";
const GDS = [{ id: "11", delivery_no: "GD/1", gd_status: "Completed", si_status: "" }, { id: "12", delivery_no: "GD/2", gd_status: "Completed", si_status: "" }];

async function scenario(o) {
  let code = SRC;
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
    $message: Object.assign((m) => log.push("message " + m.message.replace(/<br>/g, " | ")), { success: (m) => log.push("success " + m), error: (m) => log.push("error " + m) }),
    runWorkflow: (id, params, ok, bad) => {
      if (id === CLASSIC_ID) { log.push("classic " + params.allData.id); return ok({ data: o.classic || { code: "200" } }); }
      if (id === SUBMIT_ID) { log.push("submit " + params.gd_id); return ok({ data: o.submit(params.gd_id) }); }
      if (id === WORKER_ID) { log.push("worker " + params.job_id); return ok({ data: {} }); }
      if (id === "2112084100104495105") return ok({ data: { jobs_json: JSON.stringify(params.job_ids.map((j) => o.job(j, now))) } });
      throw new Error("unexpected workflow " + id);
    },
  };
  const db = { collection: () => ({ doc: (id) => ({ get: async () => ({ data: [{ id: id, gd_status: "Completed", si_status: "" }] }) }) }) };
  const origLog = console.log, origErr = console.error;
  console.log = () => {}; console.error = () => {};
  const done = Function("db", "setTimeout", "Date", code).call(page, db, fakeSetTimeout, FakeDate);
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
    const log = await scenario({ submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["submit 11", "submit 12", "worker J11", "worker J12", "success All 2 Goods Delivery reverted to Created successfully", "refresh"]);
  });
  await t("V2: NOT_ELIGIBLE at SUBMIT -> the classic revert of that delivery", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: () => ({ route: "NOT_ELIGIBLE", message: "serial-numbered items are reverted by the classic revert" }), job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["submit 11", "classic 11", "success All 1 Goods Delivery reverted to Created successfully", "refresh"]);
  });
  await t("V2: FAILED GDR_NOT_ELIGIBLE after PREPARE (the GD is back to Completed) -> the classic revert", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("FAILED", { error_code: "GDR_NOT_ELIGIBLE", error_message: "handling unit" }) });
    assert.deepStrictEqual(log, ["submit 11", "worker J11", "classic 11", "success All 1 Goods Delivery reverted to Created successfully", "refresh"]);
  });
  await t("V2: the classic fallback answers 409 -> not reverted, with classic's message", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: () => ({ route: "NOT_ELIGIBLE" }), classic: { code: "409", message: "Revert blocked: state has changed since completion." }, job: job("COMPLETED") });
    assert.ok(log.some((l) => /^alert Not reverted \(1\): \| GD\/1: Revert blocked: state has changed since completion\.$/.test(l)), log.join(" || "));
  });
  await t("V2: BUSY / STOP -> not reverted, with the reason; nothing else called", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: () => ({ route: "BUSY", message: "It is being completed - please wait for it to finish." }), job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["submit 11", "alert Not reverted (1): | GD/1: It is being completed - please wait for it to finish.", "refresh"]);
  });
  await t("V2: a job FAILED (a conflict found by PREPARE) -> not reverted, with its message", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }),
      job: job("FAILED", { error_code: "GDR_CONFLICT", error_message: "Revert blocked: state has changed since completion. Resolve conflicts manually. Fragment record 1 was modified" }) });
    assert.ok(log.some((l) => /Not reverted \(1\): \| GD\/1: Revert blocked: state has changed since completion\. Resolve conflicts manually\. Fragment record 1/.test(l)), log.join(" || "));
    assert.ok(!log.some((l) => /^classic/.test(l)), "no classic call");
  });
  await t("V2: a job under review -> not reverted, do not revert again", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("REQUIRES_REVIEW", { error_message: "R3_SO: changed" }) });
    assert.ok(log.some((l) => /Held for review by an administrator: R3_SO: changed Do not revert it again\./.test(l)), log.join(" || "));
  });
  await t("V2: still running after FOLLOW_MS -> reported in the background; the worker re-kicked every 5th check", async () => {
    const log = await scenario({ rows: [GDS[0]], submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("COMMITTING_GD") });
    assert.ok(log.some((l) => /Being reverted in the background \(1\): \| GD\/1/.test(l)), log.join(" || "));
    assert.ok(log.filter((l) => l === "worker J11").length >= 5, "re-kicked");
  });
  await t("an invoiced row is never submitted; the rest go on", async () => {
    const rows = [Object.assign({}, GDS[0], { si_status: "Fully Invoiced" }), GDS[1]];
    const log = await scenario({ rows: rows, submit: (id) => ({ route: "QUEUED", job_id: "J" + id }), job: job("COMPLETED") });
    assert.ok(!log.some((l) => l === "submit 11"), log.join(" || "));
    assert.ok(log.some((l) => /Reverted to Created \(1\): \| GD\/2 \|\s+\| Not reverted \(1\): \| GD\/1: Already invoiced \(Fully Invoiced\)/.test(l)), log.join(" || "));
  });
  await t("the switch off -> every delivery the classic way, no SUBMIT", async () => {
    const log = await scenario({ off: true, submit: () => { throw new Error("no submit"); }, job: job("COMPLETED") });
    assert.deepStrictEqual(log, ["classic 11", "classic 12", "success All 2 Goods Delivery reverted to Created successfully", "refresh"]);
  });
  console.log(n + " passed" + (mutate ? " (mutant " + mutate + ")" : ""));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
