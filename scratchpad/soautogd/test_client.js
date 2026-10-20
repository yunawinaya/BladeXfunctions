// test_client.js: the SO list's Convert (Goods Delivery/GDhandleConvertSOtoGD.js) with the page mocked - Multiple GDs, picking
// setup convert_gd_created 1. V2 on: SO_AUTO_GD answers created / blocked / queued per batch; the list starts the worker per
// queued job and follows the jobs (GD_SO_CONVERT_CHECK job_ids) into created / not converted / in the background. Off: as before.
const fs = require("fs"), assert = require("assert");
const SRC = fs.readFileSync("/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDhandleConvertSOtoGD.js", "utf8");
const IDS = { AUTO: "2076557490389835777", CHECK: "2112084100104495105", WORKER: "2104840667119411201" };

async function convert(opts) {
  let code = SRC.replace("const FOLLOW_EVERY_MS = 3000;", "const FOLLOW_EVERY_MS = 1;").replace("const FOLLOW_MS = 120000;", "const FOLLOW_MS = " + (opts.followMs || 2000) + ";");
  if (opts.off) code = code.replace("const CONVERT_CREATED_V2 = true;", "const CONVERT_CREATED_V2 = false;");
  const log = { autoCalls: [], kicks: [], checks: 0, alerts: [], loading: [] };
  const statusOf = opts.jobs || (() => "QUEUED");
  const ctx = {
    showLoading: (t) => log.loading.push(t), hideLoading: () => {}, refresh: async () => {}, getVarGlobal: () => "admin",
    $alert: async (msg, title, o) => { log.alerts.push({ msg: String(msg), title, type: o && o.type }); },
    $confirm: async (msg, title, o) => { if (o && o.beforeClose) await o.beforeClose("cancel", {}, () => {}); },
    runWorkflow: (id, params, cb, err) => {
      setTimeout(() => {
        if (id === IDS.AUTO) {
          log.autoCalls.push(params);
          // only the sales orders of this batch (the list sends 5 per call)
          const mine = (list) => (list || []).filter((x) => params.so_ids.indexOf(x.so_no.replace(/\D/g, "")) >= 0);
          const all = opts.auto(params.so_ids);
          return cb({ data: Object.assign({}, all, { created: mine(all.created), blocked: mine(all.blocked), queued: mine(all.queued) }) });
        }
        if (id === IDS.WORKER) { log.kicks.push(params.job_id); return cb({ data: {} }); }
        if (id === IDS.CHECK && params.so_ids) return cb({ data: { busy_json: "[]" } });
        if (id === IDS.CHECK && params.job_ids) {
          log.checks++;
          return cb({ data: { jobs_json: JSON.stringify(params.job_ids.map((j) => Object.assign({ job_id: j, gd_no: "", error_message: "" }, statusOf(j, log.checks)))) } });
        }
        err && err("unexpected workflow " + id);
      }, 0);
    },
  };
  global.window = {};
  global.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, convert_gd_created: 1 }] }) }) }) };
  const records = opts.sos.map((so) => ({ id: so.replace(/\D/g, "") || "1", so_no: so, customer_name: { id: "C1" } }));
  new Function(code).call(ctx, { selectedRecords: records, plantID: "P1", organizationID: "O1" });
  for (let k = 0; k < 4000 && !log.alerts.length; k++) await new Promise((r) => setTimeout(r, 1));
  return log;
}
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

(async () => {
  // V2 on: SO-1 classic created, SO-2 refused at submit, SO-3 / SO-4 / SO-5 / SO-6 queued
  let log = await convert({
    sos: ["SO-1", "SO-2", "SO-3", "SO-4", "SO-5", "SO-6"],
    auto: () => ({ code: "200", created: [{ so_no: "SO-1", delivery_no: "GD/1" }], blocked: [{ so_no: "SO-2", reason: "Another delivery of this sales order is still saving" }],
      queued: [{ so_no: "SO-3", job_id: "J3" }, { so_no: "SO-4", job_id: "J4" }, { so_no: "SO-5", job_id: "J5" }, { so_no: "SO-6", job_id: "J6" }] }),
    jobs: (j, round) => round < 2 ? { job_status: "VALIDATING" } : {
      J3: { job_status: "GD_COMMITTED", gd_no: "GD/3" }, J4: { job_status: "FAILED", error_message: "Insufficient stock for item X" },
      J5: { job_status: "REQUIRES_REVIEW", error_message: "Stock outcome under review" }, J6: { job_status: "AWAITING_CONFIRMATION" } }[j],
  });
  assert.deepStrictEqual(log.autoCalls.map((p) => p.v2), ["1", "1"], "v2 sent on every batch (5 + 1 SOs)");
  assert.deepStrictEqual(log.kicks.slice(0, 4), ["J3", "J4", "J5", "J6"]);
  const a = log.alerts[0];
  assert.strictEqual(a.title, "Converted with Exceptions");
  assert.ok(/Created 2 goods deliveries/.test(a.msg) && /GD\/1/.test(a.msg) && /GD\/3/.test(a.msg), a.msg);
  assert.ok(/Not converted \(4\)/.test(a.msg), a.msg);
  assert.ok(/SO-4 — Insufficient stock for item X/.test(a.msg) && /SO-5 — Held for review/.test(a.msg) && /SO-6 — Conditions changed/.test(a.msg), a.msg);
  assert.ok(!/background \(/.test(a.msg), "nothing left pending");
  assert.ok(log.loading.some((t) => /in the background: \d of 4 done/.test(t)));
  ok("V2: created (classic + V2), refused at submit, failed / review / confirmation from the jobs");

  log = await convert({ sos: ["SO-7", "SO-8"], followMs: 400,
    auto: () => ({ code: "200", created: [], blocked: [], queued: [{ so_no: "SO-7", job_id: "J7" }, { so_no: "SO-8", job_id: "J8" }] }),
    jobs: (j) => (j === "J7" ? { job_status: "COMPLETED", gd_no: "GD/7" } : { job_status: "COMMITTING_GD" }) });
  assert.strictEqual(log.alerts[0].title, "Converted to Goods Deliveries");
  assert.ok(/Created 1 goods delivery/.test(log.alerts[0].msg) && /Being created in the background \(1\):<\/strong><br>SO-8/.test(log.alerts[0].msg), log.alerts[0].msg);
  assert.ok(log.kicks.filter((k) => k === "J8").length >= 2, "the worker is started again for a job still running");
  ok("V2: a job still running at the end is reported as being created in the background, its worker re-started");

  log = await convert({ sos: ["SO-9", "SO-10"], auto: () => ({ code: "200", created: [], blocked: [], queued: [{ so_no: "SO-9", job_id: "J9" }, { so_no: "SO-10", job_id: "J10" }] }),
    jobs: () => ({ job_status: "FAILED", error_message: "Insufficient stock" }) });
  assert.strictEqual(log.alerts[0].title, "Could Not Convert to Goods Delivery");
  assert.ok(/SO-9<\/strong><br>Insufficient stock/.test(log.alerts[0].msg));
  ok("V2: every job failed -> the classic error dialog with the reasons");

  log = await convert({ sos: ["SO-11", "SO-12"], off: true, auto: () => ({ code: "200", created: [{ so_no: "SO-11", delivery_no: "GD/11" }, { so_no: "SO-12", delivery_no: "GD/12" }], blocked: [] }) });
  assert.deepStrictEqual([log.autoCalls[0].v2, log.kicks.length, log.checks], ["", 0, 0]);
  assert.ok(/Created 2 goods deliveries/.test(log.alerts[0].msg) && !/background/.test(log.alerts[0].msg));
  ok("switch off: v2 empty, no worker, no job checks, today's summary");

  log = await convert({ sos: ["SO-13", "SO-14"], auto: () => ({ code: "400", message: "Picking mode is Manual", created: [], blocked: [], queued: [] }) });
  assert.ok(/Picking mode is Manual/.test(log.alerts[0].msg) && log.autoCalls.length === 1);
  ok("setup gate still stops at the first batch with its message");
  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
