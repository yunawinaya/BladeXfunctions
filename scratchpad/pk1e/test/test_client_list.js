// test_client_list.js [file]: the Picking list's Auto Pick & Complete (Picking/AsyncV2/pkV2_listAutoPick.js, or [file]; the
// Picking form's pkV2_onSave_Completed.js carries the same block) after a queued confirm: it follows the Picking job through
// STATUS - not the worker's answer, which a long run can lose in the browser (Kenhin 10-27) - and hands each delivery COMMIT
// handed to GD Complete V2 (stage 1e) to the browser's drain: one GD_COMPLETE_WORKER {} run at a time, the next 1 s after a run
// that moved a job, 5 s after one that moved nothing, 15 s after a failed one, 60 s with no answer; it stops once every delivery
// handed over has ended or after 3 quiet minutes (10-29; it used to start each completion at once, then kick every 15 s).
// Timers shortened by exact text replace: NEXT 2 / SLOW 12 / FAILED 40 / LOST 80 / QUIET 300 ms.
const fs = require("fs");
const { eq, done } = require("../../gdc/pkv2tools/harness.js");
const SRC = fs.readFileSync(process.argv[2] || __dirname + "/../../../Picking/AsyncV2/pkV2_listAutoPick.js", "utf8");
const PK_SUBMIT = "2109531449614647297";
const GDC_SUBMIT = "2110182609618337794";
const GDC_WORKER = "2110182645714518018";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const has = (s) => SRC.indexOf(s) >= 0;
eq("the file defines followGdCompletes", has("const followGdCompletes = async"), true);
if (has("Auto Pick & Complete")) {
  eq("the follow starts right after QUEUED, not from the worker's answer",
    /results\.push\(\{ to_id: pickingItem\.to_id, success: true, queued: true \}\);\s*followGdCompletes\(id, pickingItem\.organization_id \|\| organizationId\);/.test(SRC), true);
  eq("the worker's callback no longer starts completions", /this\.refresh\(\);\s*this\.hide\("tabs_picking"\);\s*\}, \(e\)/.test(SRC), true);
}

(async () => {
  if (!has("const followGdCompletes = async")) return done();
  const start = SRC.indexOf("const PK_V2_WF = {");
  const end = SRC.indexOf("\n};\n", SRC.indexOf("const followGdCompletes = async")) + 4;
  let body = SRC.slice(start, end);
  for (const [a, b] of [["PK_V2_POLL_MS = 3000", "PK_V2_POLL_MS = 1"], ["PK_V2_DRAIN_NEXT_MS = 1000", "PK_V2_DRAIN_NEXT_MS = 2"],
    ["PK_V2_DRAIN_SLOW_MS = 5000", "PK_V2_DRAIN_SLOW_MS = 12"], ["PK_V2_DRAIN_FAILED_MS = 15000", "PK_V2_DRAIN_FAILED_MS = 40"],
    ["PK_V2_DRAIN_LOST_MS = 60000", "PK_V2_DRAIN_LOST_MS = 80"], ["PK_V2_DRAIN_QUIET_MS = 180000", "PK_V2_DRAIN_QUIET_MS = 300"]]) {
    if (body.indexOf(a) < 0) throw new Error("not found: " + a);
    body = body.replace(a, b);
  }
  // pickings: one STATUS answer list per Picking followed (several = several follows in one browser); gdc: gd_id -> the GD
  // completion's job_status per read (the last repeats, COMPLETED when not given); worker(n) -> the n-th run's answer: "moved",
  // "idle", "fail" or "silent" (default: "moved" while a handed-over delivery has not been read as ended... simplified: moved for
  // the first `moves` runs, then idle)
  const run = async ({ pickings, gdc, moves, worker }) => {
    const log = { calls: [], msgs: [], runs: [], inFlight: 0, maxInFlight: 0 };
    const reads = {};
    const store = { m: {}, getItem: (k) => (k in store.m ? store.m[k] : null), setItem: (k, v) => { store.m[k] = String(v); } };
    const win = {};
    const queues = pickings.map((p) => p.slice());
    const answerOf = worker || ((n) => (n <= (moves || 0) ? "moved" : "idle"));
    const ctx = {
      runWorkflow: (id, params, ok, fail) => {
        log.calls.push([id, params.operation || "", params.job_id || params.gd_id || params.picking_id || ""]);
        if (id === GDC_WORKER) {
          const n = log.runs.length + 1;
          const a = answerOf(n);
          log.runs.push({ at: Date.now(), params: JSON.stringify(params), a: a, stamp: store.m.pkv2_gdc_kick_at });
          log.inFlight++;
          log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
          if (a === "silent") return undefined;
          return setTimeout(() => {
            log.inFlight--;
            if (a === "fail") return fail("script for node[x] is not loaded");
            const data = a === "moved"
              ? { worker_route: "WORKED", processed: "1", jobs: JSON.stringify([{ job_id: "J" + n, before: "QUEUED", job_status: "COMPLETED" }]) }
              : { worker_route: "IDLE", processed: "0", jobs: "[]" };
            ok({ data: data });
          }, 3);
        }
        if (id === GDC_SUBMIT) {
          const seq = (gdc || {})[params.gd_id] || ["COMPLETED"];
          const k = (reads[params.gd_id] = (reads[params.gd_id] || 0) + 1);
          const js = seq[Math.min(k, seq.length) - 1];
          return js === "FAIL" ? fail("no answer") : ok({ data: { route: "STATUS", code: "200", gd_id: params.gd_id, job_status: js } });
        }
        const q = queues[Number(params.picking_id) - 9001];
        const a = q && q.shift();
        if (a) ok(a);
        else fail("no answer");
      },
      $message: { success: (m) => log.msgs.push("S " + m), warning: (m) => log.msgs.push("W " + m), error: (m) => log.msgs.push("E " + m) },
    };
    const follow = new Function("console", "localStorage", "window", body + "\nreturn followGdCompletes;").call(ctx, { log: () => {}, error: () => {} }, store, win);
    await Promise.all(pickings.map((p, i) => follow(String(9001 + i), "77")));
    for (let i = 0; i < 400 && win.pkV2GdcDrain && win.pkV2GdcDrain.active; i++) await sleep(5);
    log.store = store.m;
    log.drain = win.pkV2GdcDrain;
    return log;
  };
  const pkStatus = (log) => log.calls.filter((c) => c[0] === PK_SUBMIT && c[1] === "STATUS").length;
  const gdcReads = (log) => log.calls.filter((c) => c[0] === GDC_SUBMIT).map((c) => c[1] + ":" + c[2]);
  const st = (job_status, list) => ({ data: { route: "STATUS", job_status: job_status, gd_complete: list } });
  const Q = (id, job) => ({ gd_id: id, gd_no: "GD-" + id, status: "QUEUED", job_id: job });
  const two = [Q("51", "888"), Q("52", "889")];
  const twoDone = [st("VALIDATING", []), st("COMPLETED", [Q("51", "888")]), st("COMPLETED", two), st("COMPLETED", two), st("COMPLETED", two), st("COMPLETED", two)];

  let log = await run({ pickings: [twoDone], moves: 2 });
  eq("STATUS polled until the list is stable; each delivery handed over and announced once",
    [pkStatus(log), log.msgs], [6, ["S Completing GD-51 in the background.", "S Completing GD-52 in the background."]]);
  eq("the drain's runs carry no job id (the worker takes the tenant's due jobs); one at a time",
    [log.runs.map((r) => r.params), log.maxInFlight], [["{}", "{}", "{}"], 1]);
  eq("two runs moved, the third moved nothing: then one status read each, both ended, the drain stops",
    [gdcReads(log), log.drain.active, Object.keys(log.drain.open)], [["STATUS:51", "STATUS:52"], false, []]);
  eq("each run stamps pkv2_gdc_kick_at (the Picking list's sweep holds back)", log.runs.every((r) => r.stamp !== undefined) || log.runs.slice(1).every((r) => r.stamp), true);
  const g1 = log.runs[1].at - log.runs[0].at, g2 = log.runs[2].at - log.runs[1].at;
  eq("a run that moved a job: the next ~1 s (2 ms here) later, not 15 s", g1 < 12 && g2 < 12, true);

  log = await run({ pickings: [[st("COMPLETED", JSON.stringify([Q("51", "888")])), st("COMPLETED", JSON.stringify([Q("51", "888")])), st("COMPLETED", JSON.stringify([Q("51", "888")])),
    st("COMPLETED", JSON.stringify([Q("51", "888")]))]], moves: 1 });
  eq("gd_complete as JSON text (a string-declared output) is read too", [log.msgs, log.runs.length], [["S Completing GD-51 in the background."], 2]);
  log = await run({ pickings: [[st("REQUIRES_REVIEW", [])]] });
  eq("a job under review ends the follow, nothing handed over", [log.calls.length, log.msgs, log.runs.length], [1, [], 0]);
  log = await run({ pickings: [[st("COMPLETED", []), st("COMPLETED", []), st("COMPLETED", []), st("COMPLETED", [])]] });
  eq("nothing handed over: no run, no read", [log.runs.length, gdcReads(log)], [0, []]);

  // a completion that lost the lock (not due for a while): runs move nothing, 5 s apart, each followed by a read
  log = await run({ pickings: [twoDone], gdc: { 52: ["COMMITTING_GD", "QUEUED", "COMPLETED"] } });
  // GD-51 is handed over one poll before GD-52: the first idle run reads 51 only
  eq("one still running: a read after each idle run, the finished one is not read again",
    [gdcReads(log), log.runs.length], [["STATUS:51", "STATUS:52", "STATUS:52", "STATUS:52"], 4]);
  const gs = log.runs.slice(1).map((r, i) => r.at - log.runs[i].at);
  eq("idle runs ~5 s (12 ms here) apart", gs.every((g) => g >= 11), true);
  log = await run({ pickings: [twoDone], gdc: { 51: ["FAILED"], 52: ["REQUIRES_REVIEW"] } });
  eq("FAILED / REQUIRES_REVIEW count as ended: one read each", [gdcReads(log), log.runs.length], [["STATUS:51", "STATUS:52"], 2]);
  log = await run({ pickings: [twoDone], gdc: { 51: ["FAIL", "COMPLETED"] } });
  eq("an unanswered read keeps the delivery followed", [gdcReads(log), log.runs.length], [["STATUS:51", "STATUS:51", "STATUS:52"], 2]);
  log = await run({ pickings: [twoDone], gdc: { 51: ["COMMITTING_GD"] } });
  eq("a completion that never finishes: idle runs until 3 quiet minutes (300 ms here), then the lists' sweeps take over",
    [log.runs.length >= 10 && log.runs.length <= 30, log.drain.active], [true, false]);

  // failures and lost answers slow it down
  log = await run({ pickings: [twoDone], gdc: { 51: ["QUEUED", "QUEUED", "COMPLETED"], 52: ["QUEUED", "COMPLETED"] }, worker: (n) => (n <= 2 ? "fail" : "idle") });
  eq("a failed run: the next ~15 s (40 ms here) later", [log.runs.length >= 3, log.runs[1].at - log.runs[0].at >= 38], [true, true]);
  log = await run({ pickings: [twoDone], worker: (n) => (n === 1 ? "silent" : "idle") });
  eq("a run with no answer: the next ~60 s + 15 s (120 ms here) after it", [log.runs.length >= 2, log.runs[1].at - log.runs[0].at >= 115], [true, true]);

  // two Pickings followed at once (Auto Pick & Complete on several): one drain, never two runs in flight
  const one = (id, job) => [st("COMPLETED", [Q(id, job)]), st("COMPLETED", [Q(id, job)]), st("COMPLETED", [Q(id, job)]), st("COMPLETED", [Q(id, job)])];
  log = await run({ pickings: [one("61", "961"), one("62", "962"), one("63", "963")], moves: 3 });
  eq("three Pickings: their deliveries go to one drain, one run at a time",
    [log.msgs.length, log.maxInFlight, log.runs.length, gdcReads(log).sort()], [3, 1, 4, ["STATUS:61", "STATUS:62", "STATUS:63"]]);
  done();
})();
