// test_convert_follow_cap.js: the SO list's followBackground (repo Goods Delivery/GDhandleConvertSOtoGD.js) on a fake clock - a
// 300-delivery convert starts at most MAX_WORKERS workers at once and the next as one ends, a started worker that ended early
// is started again, a long list is followed longer, a small convert still starts every worker at once (LSH 10-26).
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../../../../Goods Delivery/GDhandleConvertSOtoGD.js", "utf8");
const a = src.indexOf("// GD Created V2: the list follows the queued deliveries");
const b = src.indexOf("  return pending;\n};", a) + "  return pending;\n};".length;
if (a < 0 || b < a) throw new Error("followBackground not found");
const body = 'const GD_ASYNC_WORKER_ID = "WORKER"; const SO_CONVERT_CHECK_WORKFLOW_ID = "CHECK";\n' + src.slice(a, b) +
  "\nreturn { followBackground, MAX_WORKERS, FOLLOW_MS, FOLLOW_MAX_MS, MS_PER_QUEUED };";

// jobs: each finishes `takes` polls after a worker for it starts; `stallFirst` ignores its first worker (the run ended early)
function world(n, opts) {
  const o = opts || {};
  const clock = { t: 1000000 };
  const jobs = {};
  for (let i = 1; i <= n; i++) jobs["J" + i] = { status: "QUEUED", kicks: 0, polls: 0, stall: (o.stall || []).includes("J" + i) };
  const log = { kicks: [], maxRunning: 0 };
  const running = () => Object.values(jobs).filter((j) => j.kicks > 0 && j.status !== "COMPLETED").length;
  const page = {
    showLoading() {}, hideLoading() {},
    runWorkflow(id, params, ok) {
      if (id === "WORKER") {
        const j = jobs[params.job_id];
        j.kicks += 1;
        if (j.stall && j.kicks === 1) j.stalled = true;
        else { j.stalled = false; j.polls = 0; }
        log.kicks.push(params.job_id);
        log.maxRunning = Math.max(log.maxRunning, running());
        return ok({});
      }
      if (id === "CHECK") {
        const out = params.job_ids.map((jid) => {
          const j = jobs[jid];
          if (j.kicks > 0 && !j.stalled && j.status !== "COMPLETED" && ++j.polls >= (o.takes || 2)) j.status = "COMPLETED";
          return { job_id: jid, job_status: j.status, gd_no: "GD-" + jid };
        });
        return ok({ data: { jobs_json: JSON.stringify(out) } });
      }
      throw new Error("unexpected workflow " + id);
    },
  };
  const fakeTimeout = (fn, ms) => { clock.t += ms; Promise.resolve().then(fn); };
  const api = Function("setTimeout", "Date", body).call(page, fakeTimeout, { now: () => clock.t });
  return { api, jobs, log, clock };
}
const queuedOf = (n) => Array.from({ length: n }, (_, i) => ({ job_id: "J" + (i + 1), so_no: "SO/" + (i + 1) }));
let n = 0;
const t = async (name, f) => { await f(); n++; console.log("ok", name); };

(async () => {
  await t("300 deliveries: never more than MAX_WORKERS running, every one started once and created", async () => {
    const w = world(300);
    const created = [], blocked = [];
    const t0 = w.clock.t;
    const left = await w.api.followBackground(queuedOf(300), created, blocked);
    assert.strictEqual(w.log.kicks.slice(0, w.api.MAX_WORKERS).length, 8);
    assert.ok(w.log.maxRunning <= w.api.MAX_WORKERS, "max running " + w.log.maxRunning);
    assert.deepStrictEqual([left.length, created.length, blocked.length], [0, 300, 0]);
    assert.strictEqual(new Set(w.log.kicks).size, 300);
    assert.ok(w.log.kicks.length < 330, "kicks " + w.log.kicks.length);
    assert.ok(w.clock.t - t0 > w.api.FOLLOW_MS, "followed past the old 2 minutes: " + (w.clock.t - t0) / 1000 + " s");
  });
  await t("the first wave is MAX_WORKERS workers, not the whole list", async () => {
    const w = world(300, { takes: 1000 });
    const p = w.api.followBackground(queuedOf(300), [], []);
    assert.strictEqual(w.log.kicks.length, 8);
    await p;
  });
  await t("a started worker that ended before its job did is started again (5 rounds later), still within the cap", async () => {
    const w = world(12, { stall: ["J2"] });
    const created = [];
    const left = await w.api.followBackground(queuedOf(12), created, []);
    assert.strictEqual(w.jobs.J2.kicks, 2);
    assert.ok(w.log.maxRunning <= 8);
    assert.deepStrictEqual([left.length, created.length], [0, 12]);
  });
  await t("a long list is followed for MS_PER_QUEUED each, up to FOLLOW_MAX_MS; what is left is returned as in the background", async () => {
    const w = world(300, { takes: 1000000 });
    const t0 = w.clock.t;
    const left = await w.api.followBackground(queuedOf(300), [], []);
    const followed = w.clock.t - t0;
    assert.ok(followed >= w.api.FOLLOW_MAX_MS && followed < w.api.FOLLOW_MAX_MS + 10000, "followed " + followed);
    assert.strictEqual(left.length, 300);
    assert.ok(new Set(w.log.kicks).size === 8, "only the first 8 ever started while none finished");
  });
  await t("a small convert: every worker started at once, followed at most the old 2 minutes", async () => {
    const w = world(3, { takes: 1000000 });
    const t0 = w.clock.t;
    const p = w.api.followBackground(queuedOf(3), [], []);
    assert.deepStrictEqual(w.log.kicks.slice(0, 3), ["J1", "J2", "J3"]);
    const left = await p;
    assert.ok(w.clock.t - t0 <= w.api.FOLLOW_MS + 3000, "followed " + (w.clock.t - t0));
    assert.strictEqual(left.length, 3);
  });
  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
