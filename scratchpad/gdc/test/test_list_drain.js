// test_list_drain.js: the GD list's worker drain (Goods Delivery/CompleteV2/gdc_list_mounted.js) on a fake clock, in a
// simulated list page. The server is a queue of jobs per worker; a run takes RUN_MS and moves the head job (one stock call
// per run). Cases: plain answers, a run dropped when started right after the list refresh, answers that never arrive, a
// throwing refresh, server errors, the beat and a re-mount beside a running drain, a blocked queue, the 40-run cap, leaving
// the page. The old script (git HEAD, or OLD=<file>) runs the same cases for comparison.
//   node scratchpad/gdc/test/test_list_drain.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..", "..");
const FILE = "Goods Delivery/CompleteV2/gdc_list_mounted.js";
const NEW = fs.readFileSync(path.join(ROOT, FILE), "utf8");
const OLD = process.env.OLD ? fs.readFileSync(process.env.OLD, "utf8") : execFileSync("git", ["-C", ROOT, "show", "HEAD:" + FILE]).toString();
const COMPLETE = "2110182645714518018";

function world(opts) {
  const o = Object.assign({ jobs: 5, runMs: 15000, dropAfterRefreshMs: 0, loseAnswersOver: Infinity, refreshThrows: false,
                            errors: 0, blocked: false, href: "https://x/sucode/page/1902688873696313346?name=Goods+Delivery" }, opts);
  let now = 1761550000000; // a real epoch: the 2-minute throttle sees no earlier kick
  const timers = [];
  let seq = 0;
  const at = (ms, fn) => { const t = { id: ++seq, due: now + ms, fn }; timers.push(t); return t.id; };
  const clear = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const intervals = {};
  const store = {};
  const win = {
    location: { href: o.href },
    setTimeout: (fn, ms) => at(ms || 0, fn),
    clearTimeout: clear,
    setInterval: (fn, ms) => { const id = ++seq; intervals[id] = true; const tick = () => { if (!intervals[id]) return; fn(); at(ms, tick); }; at(ms, tick); return id; },
    clearInterval: (id) => { delete intervals[id]; },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const server = { [COMPLETE]: { queue: o.jobs, inFlight: 0, maxInFlight: 0, runs: 0, done: 0, errorsLeft: o.errors } };
  let lastRefresh = -Infinity;
  let refreshes = 0;
  const log = [];
  const page = {
    refresh() {
      refreshes++;
      lastRefresh = now;
      if (o.refreshThrows) throw new TypeError("refresh is not a function");
    },
    runWorkflow(id, params, ok, err) {
      // the platform drops a run silently (no request, no callback) while runs are disabled
      if (now - lastRefresh < o.dropAfterRefreshMs) { log.push(`${now} dropped ${id === COMPLETE ? "complete" : id}`); return Promise.resolve(); }
      const s = server[id];
      if (!s) { at(200, () => ok && ok({ code: 200, data: { worker_route: "IDLE", processed: "0", jobs: "[]" } })); return Promise.resolve(); }
      if (s.errorsLeft > 0) { s.errorsLeft--; at(100, () => err && err(new Error("500"))); return Promise.resolve(); }
      s.runs++;
      if (s.queue === 0) { at(200, () => ok && ok({ code: 200, data: { worker_route: "IDLE", processed: "0", jobs: "[]" } })); return Promise.resolve(); }
      s.inFlight++;
      s.maxInFlight = Math.max(s.maxInFlight, s.inFlight);
      at(o.runMs, () => {
        s.inFlight--;
        const read = s.queue;
        const moved = !o.blocked;
        if (moved) { s.queue--; s.done++; }
        const jobs = Array.from({ length: Math.min(read, 10) }, (_, i) => ({ job_id: String(i), before: "QUEUED", job_status: i === 0 && moved ? "COMPLETED" : "QUEUED" }));
        log.push(`${now} run ends: ${moved ? "moved" : "blocked"}, ${s.queue} left`);
        if (o.runMs <= o.loseAnswersOver && ok) ok({ code: 200, data: { worker_route: "WORKED", processed: String(read), jobs: JSON.stringify(jobs) } });
      });
      return Promise.resolve();
    },
  };
  const mount = (code) => {
    const fn = new Function("window", "localStorage", "URL", "console", "Date", code);
    fn.call(Object.create(page), win, localStorage, URL, { error: () => {}, warn: () => {}, log: () => {} }, { now: () => now });
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const t = timers[0];
      if (!t || t.due > end) break;
      timers.shift();
      now = t.due;
      t.fn();
    }
    now = end;
  };
  return { mount, advance, server: server[COMPLETE], win, store, get refreshes() { return refreshes; }, log, get now() { return now; } };
}

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!cond) failures++;
};
const drained = (w) => `done ${w.server.done}/${w.server.done + w.server.queue}, runs ${w.server.runs}, max in flight ${w.server.maxInFlight}`;

// 1. plain answers: drains every job, one run at a time, then one IDLE run ends it
{
  const w = world({ jobs: 5 });
  w.mount(NEW);
  w.advance(119000);
  check("1 new: plain answers drain all 5 jobs, one at a time, then one IDLE run (before the first beat)", w.server.queue === 0 && w.server.maxInFlight === 1 && w.server.runs === 6, drained(w));
}
// 2. the run started right after the list refresh is dropped (no request, no callback): the old chain stalls, the drain does not
{
  const a = world({ jobs: 5, dropAfterRefreshMs: 1000 });
  a.mount(OLD);
  a.advance(4 * 60000);
  const b = world({ jobs: 5, dropAfterRefreshMs: 1000 });
  b.mount(NEW);
  b.advance(4 * 60000);
  check("2 old: a run dropped beside the refresh: one job per 2-minute beat (<= 2 in 4 min)", a.server.done <= 2, drained(a));
  check("2 new: the same platform drains all 5 in 4 min (next run 3 s after the refresh)", b.server.queue === 0 && b.server.maxInFlight === 1, drained(b));
}
// 2b. a longer drop window (5 s): the drain falls back to the 60-s timer, still finishes, never two runs at once
{
  const w = world({ jobs: 5, dropAfterRefreshMs: 5000 });
  w.mount(NEW);
  w.advance(10 * 60000);
  check("2b new: a 5-s drop window still drains all 5 via the 60-s fallback", w.server.queue === 0 && w.server.maxInFlight === 1, drained(w));
}
// 3. answers of long runs never arrive (the server run still completes): the 60-s fallback keeps going
{
  const a = world({ jobs: 5, runMs: 17000, loseAnswersOver: 10000 });
  a.mount(OLD);
  a.advance(5 * 60000);
  const b = world({ jobs: 5, runMs: 17000, loseAnswersOver: 10000 });
  b.mount(NEW);
  b.advance(5 * 60000);
  check("3 old: lost answers: one job per 2-minute beat (<= 3 in 5 min)", a.server.done <= 3, drained(a));
  check("3 new: lost answers still drain all 5 in 5 min, one run at a time", b.server.queue === 0 && b.server.maxInFlight === 1, drained(b));
}
// 4. a throwing refresh does not end the drain
{
  const w = world({ jobs: 4, refreshThrows: true });
  w.mount(NEW);
  w.advance(5 * 60000);
  check("4 new: a throwing list refresh does not stop the drain", w.server.queue === 0, drained(w));
}
// 5. three server errors in a row end the drain; the next beat starts a fresh one
{
  const w = world({ jobs: 3, errors: 3 });
  w.mount(NEW);
  w.advance(119000);
  const afterErrors = w.server.done;
  w.advance(10 * 60000);
  check("5 new: 3 failures end the drain (nothing done before the next beat), the next beat drains the rest", afterErrors === 0 && w.server.queue === 0, drained(w));
}
// 6. leaving the list stops the drain
{
  const w = world({ jobs: 20 });
  w.mount(NEW);
  w.advance(40000);
  w.win.location.href = "https://x/sucode/page/other";
  const doneAtLeave = w.server.done;
  w.advance(10 * 60000);
  check("6 new: leaving the list stops it (at most the run in flight finishes)", w.server.done <= doneAtLeave + 1, `done ${w.server.done} after leaving at ${doneAtLeave}`);
}
// 7. the beat (every 2 min) never starts a second drain beside a running one
{
  const w = world({ jobs: 30 });
  w.mount(NEW);
  w.advance(20 * 60000);
  check("7 new: beats beside a running drain keep one run in flight", w.server.maxInFlight === 1 && w.server.queue === 0, drained(w));
}
// 8. a re-mount takes the running drain over: still one run at a time, the queue still drains
{
  const w = world({ jobs: 10 });
  w.mount(NEW);
  w.advance(30000);
  w.mount(NEW); // the list re-mounts inside the 2-minute throttle
  w.advance(20 * 60000);
  check("8 new: a re-mount inside the throttle takes the drain over", w.server.maxInFlight === 1 && w.server.queue === 0, drained(w));
}
// 9. a blocked queue (runs read jobs, move none) ends the drain on the first run, not 40 fast runs
{
  const w = world({ jobs: 5, blocked: true });
  w.mount(NEW);
  w.advance(119000);
  check("9 new: a blocked queue stops after one run per beat", w.server.runs === 1, `runs ${w.server.runs}`);
}
// 10. the 40-run cap per drain (2-s runs + 3-s gaps: 40 runs by ~200 s); the beat at 240 s starts the next drain
{
  const w = world({ jobs: 60, runMs: 2000 });
  w.mount(NEW);
  w.advance(235000);
  const first = w.server.runs;
  w.advance(10 * 60000);
  check("10 new: one drain stops at 40 runs; the next beat drains the rest", first === 40 && w.server.queue === 0, `runs by 235 s ${first}, then ${drained(w)}`);
}
// 11. an idle queue ends after one IDLE run
{
  const w = world({ jobs: 0 });
  w.mount(NEW);
  w.advance(119000);
  check("11 new: an idle queue ends after one IDLE run", w.server.runs === 1, `runs ${w.server.runs}`);
}
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
