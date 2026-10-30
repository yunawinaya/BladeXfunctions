// test_convert_drain.js: the SO list's Convert (Goods Delivery/GDhandleConvertSOtoGD.js) starts its queued deliveries' worker
// runs one at a time (10-29): the next 1 s after a run that moved a job, 5 s after one that moved nothing, 15 s after a failed
// run, and at once after 60 s with no answer - never two runs of the batch in flight. Timers shortened by exact text replace
// (NEXT 30 / SLOW 150 / FAILED 400 / LOST 700 ms); the worker answers after 40 ms.
// usage: node test_convert_drain.js [handler.js]
const fs = require("fs"), assert = require("assert");
const SRC = fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDhandleConvertSOtoGD.js", "utf8");
const IDS = { AUTO: "2076557490389835777", CHECK: "2112084100104495105", WORKER: "2104840667119411201" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPL = [["const FOLLOW_EVERY_MS = 3000;", "const FOLLOW_EVERY_MS = 10;"], ["const FOLLOW_MS = 120000;", "const FOLLOW_MS = 300;"],
  ["const DRAIN_NEXT_MS = 1000;", "const DRAIN_NEXT_MS = 30;"], ["const DRAIN_SLOW_MS = 5000;", "const DRAIN_SLOW_MS = 150;"],
  ["const DRAIN_FAILED_MS = 15000;", "const DRAIN_FAILED_MS = 400;"], ["const DRAIN_LOST_MS = 60000;", "const DRAIN_LOST_MS = 700;"],
  ["const KEEP_MS = 1800000;", "const KEEP_MS = 4000;"], ["const READ_GIVE_UP_MS = 20000;", "const READ_GIVE_UP_MS = 200;"]];

// worker(job, n) -> "ok" | "fail" | "silent"; status(job, kicksSoFar) -> job_status
async function convert({ jobs, worker, status, runFor }) {
  let code = SRC;
  for (const [a, b] of REPL) {
    assert.ok(code.includes(a), "constant not found: " + a);
    code = code.replace(a, b);
  }
  const log = { kicks: [], answers: [], inFlight: 0, maxInFlight: 0 };
  const kicks = {};
  const ctx = {
    showLoading: () => {}, hideLoading: () => {}, refresh: async () => {}, getVarGlobal: () => "admin",
    $alert: async () => {}, $confirm: async (m, t, o) => { if (o && o.beforeClose) await o.beforeClose("cancel", {}, () => {}); },
    runWorkflow: (id, params, cb, err) => {
      if (id === IDS.WORKER) {
        const j = params.job_id;
        kicks[j] = (kicks[j] || 0) + 1;
        log.kicks.push({ job: j, at: Date.now() });
        log.inFlight++;
        log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
        const mode = worker(j, kicks[j]);
        if (mode === "silent") return; // no answer, no error (its run stays in flight)
        return setTimeout(() => {
          log.inFlight--;
          log.answers.push({ job: j, at: Date.now() });
          if (mode === "fail") return err("script for node[x] is not loaded");
          cb({ data: {} });
        }, 40);
      }
      setTimeout(() => {
        if (id === IDS.AUTO) return cb({ data: { code: "200", created: [], blocked: [], queued: jobs.map((j) => ({ so_no: "SO-" + j, job_id: j })) } });
        if (id === IDS.CHECK && params.so_ids) return cb({ data: { busy_json: "[]" } });
        if (id === IDS.CHECK && params.job_ids)
          return cb({ data: { jobs_json: JSON.stringify(params.job_ids.map((j) => ({ job_id: j, gd_no: "", error_message: "", job_status: status(j, kicks[j] || 0) }))) } });
        err && err("unexpected workflow " + id);
      }, 0);
    },
  };
  global.window = { location: { pathname: "/so-list" } };
  global.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, convert_gd_created: 1 }] }) }) }) };
  const records = jobs.map((j) => ({ id: j.replace(/\D/g, ""), so_no: "SO-" + j, customer_name: { id: "C1" } }));
  new Function(code).call(ctx, { selectedRecords: records, plantID: "P1", organizationID: "O1" });
  await sleep(runFor);
  global.window.location.pathname = "/elsewhere"; // stop what is left
  return log;
}
// the gap from each answered run to the next start
const gaps = (log) => log.kicks.slice(1).map((k, i) => k.at - (log.answers[i] ? log.answers[i].at : log.kicks[i].at));
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

(async () => {
  // 1. each run moves (ends) its job: the oldest first, one at a time, the next DRAIN_NEXT_MS after the answer
  let log = await convert({ jobs: ["J1", "J2", "J3", "J4"], worker: () => "ok", status: (j, k) => (k >= 1 ? "GD_COMMITTED" : "QUEUED"), runFor: 1200 });
  assert.deepStrictEqual(log.kicks.map((k) => k.job), ["J1", "J2", "J3", "J4"], log.kicks.map((k) => k.job).join(","));
  assert.strictEqual(log.maxInFlight, 1);
  assert.ok(gaps(log).every((g) => g >= 25 && g < 150), "gaps " + gaps(log).join(","));
  ok("one run at a time, oldest first, the next ~1 s (30 ms here) after a run that moved its job; none once all ended");

  // 2. runs that move nothing (another save holds the stock): DRAIN_SLOW_MS between them
  log = await convert({ jobs: ["J5", "J6"], worker: () => "ok", status: () => "COMMITTING_GD", runFor: 900 });
  const g2 = gaps(log).slice(1); // the first read has nothing to compare with: it counts as a change
  assert.ok(g2.length >= 2 && g2.every((g) => g >= 145 && g < 400), "gaps " + gaps(log).join(","));
  assert.ok(log.kicks.every((k) => k.job === "J5") && log.maxInFlight === 1);
  ok("a run that moved nothing: the next ~5 s (150 ms here) later, for the same oldest job");

  // 3. a failed run (e.g. not loaded): DRAIN_FAILED_MS, as slow as the old 15-s beat
  log = await convert({ jobs: ["J7", "J8"], worker: () => "fail", status: () => "QUEUED", runFor: 1400 });
  assert.ok(gaps(log).length >= 2 && gaps(log).every((g) => g >= 395), "gaps " + gaps(log).join(","));
  ok("a failed run: the next ~15 s (400 ms here) later - no faster retries than before");

  // 4. a run with no answer: the next starts DRAIN_LOST_MS after it
  log = await convert({ jobs: ["J9", "J10"], worker: (j, k) => (k === 1 ? "silent" : "ok"), status: (j, k) => (k >= 2 ? "COMPLETED" : "QUEUED"), runFor: 1300 });
  assert.ok(log.kicks.length >= 2 && log.kicks[1].at - log.kicks[0].at >= 690, "second start after " + (log.kicks[1] && log.kicks[1].at - log.kicks[0].at) + " ms");
  ok("a run with no answer: the next ~60 s (700 ms here) after it started");

  // 5. leaving the list stops it
  log = await convert({ jobs: ["J11", "J12"], worker: () => "ok", status: () => "COMMITTING_GD", runFor: 350 });
  const at = log.kicks.length;
  await sleep(500);
  assert.strictEqual(log.kicks.length, at);
  ok("leaving the list stops the runs");
  console.log(n + " passed");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
