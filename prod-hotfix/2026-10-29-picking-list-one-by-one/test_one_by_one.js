// test_one_by_one.js [file]: the Picking list's mounted handler on a mock page with a fake clock. The three worker starts go out
// one at a time (each 1 s after the previous answer, or after 60 s with no answer); the 60-s GD_COMPLETE beat is unchanged.
const fs = require("fs");
const SRC = fs.readFileSync(process.argv[2] || __dirname + "/PPonMountedListPage.one_by_one.js", "utf8");
const PK = "2109531412499251201", ED = "2110618789356687361", GDC = "2110182645714518018";
let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "\n     got  " + JSON.stringify(got) + "\n     want " + JSON.stringify(want)));
};

const setup = (mode) => {
  let now = 1e12;
  const timers = [];
  let tid = 0;
  const store = {};
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const win = { location: { href: "https://erp.example/app/page/1935635853539348481" }, beats: [], cleared: [], pkV2GdcBeat: null };
  win.setTimeout = (fn, ms) => { tid += 1; timers.push({ id: tid, at: now + ms, fn }); return tid; };
  win.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  win.setInterval = (fn, ms) => { win.beats.push({ fn, ms }); return win.beats.length; };
  win.clearInterval = (id) => win.cleared.push(id);
  const calls = [];
  const ctx = {
    runWorkflow: (id, params, ok, bad) => {
      const c = { id, params, at: now, ok, bad };
      calls.push(c);
      const m = mode(id);
      if (m === "throw") throw new Error("boom");
      if (m === "fail") bad(new Error("not loaded"));
      if (m === "ok") ok({ data: {} });
    },
    toView: () => {}, display: () => {}, hide: () => {},
    getVarGlobal: () => "77", getVarSystem: () => "77",
  };
  const db = { collection: () => ({ where: () => ({ get: async () => ({ data: [] }) }) }) };
  const realDate = Date;
  const FakeDate = { now: () => now };
  const mount = () => new Function("db", "window", "localStorage", "console", "Date", SRC).call(ctx, db, win, ls, { log: () => {}, error: () => {}, warn: () => {} }, FakeDate);
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  const seq = () => calls.map((c) => [c.id === PK ? "PK" : c.id === ED ? "ED" : c.id === GDC ? "GDC" : c.id, (c.at - 1e12) / 1000]);
  return { mount, advance, calls, seq, store, win, realDate, setNow: (v) => { now = v; }, getNow: () => now };
};

// 1. every worker answers at once: one at a time, 1 s apart
{
  const t = setup(() => "ok");
  t.mount();
  eq("on open only the Picking worker goes out", t.seq(), [["PK", 0]]);
  t.advance(1000);
  eq("1 s after its answer: GD Edit", t.seq(), [["PK", 0], ["ED", 1]]);
  t.advance(1000);
  eq("1 s after that: GD Complete sweep, {} params", [t.seq(), t.calls[2].params], [[["PK", 0], ["ED", 1], ["GDC", 2]], {}]);
  t.advance(120000);
  eq("nothing more from the chain", t.calls.length, 3);
  eq("the one-minute beat is registered as before", t.win.beats.map((b) => b.ms), [60000]);
}

// 2. answers that never come: the next one starts 60 s (+1 s) later
{
  const t = setup(() => "silent");
  t.mount();
  t.advance(60999);
  eq("a lost Picking answer holds GD Edit for 60 s", t.seq(), [["PK", 0]]);
  t.advance(1);
  eq("then GD Edit at 61 s", t.seq(), [["PK", 0], ["ED", 61]]);
  t.advance(61000);
  eq("and the sweep at 122 s", t.seq(), [["PK", 0], ["ED", 61], ["GDC", 122]]);
  // a late answer after the fallback starts nothing twice
  t.calls[0].ok({ data: {} });
  t.calls[1].ok({ data: {} });
  t.advance(5000);
  eq("late answers start nothing more", t.calls.length, 3);
}

// 3. failures and throws move the chain on
{
  const t = setup((id) => (id === PK ? "fail" : id === ED ? "throw" : "ok"));
  t.mount();
  t.advance(2000);
  eq("a failed Picking start and a throwing GD Edit start still reach the sweep", t.seq(), [["PK", 0], ["ED", 1], ["GDC", 2]]);
}

// 4. the sweep is throttled per browser (55 s): the chain ends without it, and a second open re-runs the two workers only
{
  const t = setup(() => "ok");
  t.mount();
  t.advance(3000);
  t.mount();
  t.advance(3000);
  eq("a second open 3 s later: Picking + GD Edit again, no second sweep", t.seq(), [["PK", 0], ["ED", 1], ["GDC", 2], ["PK", 3], ["ED", 4]]);
  eq("its beat replaces the first", [t.win.cleared, t.win.beats.length], [[1], 2]);
}

// 5. the beat: sweeps once a minute, stops off the list
{
  const t = setup(() => "ok");
  t.mount();
  t.advance(3000);
  t.advance(60000);
  t.win.beats[0].fn();
  eq("the beat after a minute sweeps again, alone", t.seq().slice(3), [["GDC", 63]]);
  t.win.beats[0].fn();
  eq("a beat inside the minute does not", t.calls.length, 4);
  t.win.location.href = "https://erp.example/app/page/other";
  t.advance(61000);
  t.win.beats[0].fn();
  eq("off the list: the beat stops, no sweep", [t.calls.length, t.win.cleared.length, t.win.pkV2GdcBeat], [4, 1, null]);
}

// 6. never two worker runs in flight at once in a normal open (each answer arrives 0.5 s after its start)
{
  const pending = [];
  const t = setup(() => "manual");
  const orig = t.calls;
  t.mount();
  const flight = [];
  for (let s = 0; s < 10; s += 1) {
    orig.forEach((c) => { if (!c.answered && t.getNow() - c.at >= 500) { c.answered = true; c.ok({ data: {} }); } });
    flight.push(orig.filter((c) => !c.answered).length);
    t.advance(500);
  }
  eq("at most one worker run in flight", Math.max(...flight), 1);
  eq("all three went out", orig.length, 3);
}

if (failed) {
  console.log(failed + " FAILED");
  process.exit(1);
}
console.log("all passed");
