// test_worker_budget.js [GD_REVERT_WORKER.json]: the worker's pick node, as built, after one job took 100 s: the next selected job is
// still claimed (budget 240 s, 10-25: a run finishes the jobs it selected, as GD_COMPLETE_WORKER); past 240 s it is left for the
// next tick; the first job of a run is always taken. Exit 0 only if every case holds.
const fs = require("fs");
const file = process.argv[2] || __dirname + "/../../../Goods Delivery/RevertV2/GD_REVERT_WORKER.json";
const w = JSON.parse(fs.readFileSync(file, "utf8"));
const codes = [];
const walk = (o) => { if (o && typeof o === "object") { if (o.data && o.data.script && /const workerPick = /.test(o.data.script.code || "") && /return res;/.test(o.data.script.code)) codes.push(o.data.script.code); Object.values(o).forEach(walk); } };
walk(w);
if (codes.length !== 1) { console.log("expected one pick node, found " + codes.length); process.exit(1); }
// each placeholder becomes a parameter; the test values are passed as arguments
const holders = [...new Set(codes[0].match(/\{\{[^}]+\}\}/g))];
const names = holders.map((_, i) => "__p" + i);
let body = codes[0];
holders.forEach((h, i) => { body = body.split(h).join(names[i]); });
const pick = (elapsedS, index) => {
  const start = Date.UTC(2026, 9, 25, 10, 0, 0);
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const vals = { guard: { leaseOwner: "WRK|t" }, plan: { runStart: fmt(start), dbNow: fmt(start), items: [{ jobId: "11", organizationId: "9" }, { jobId: "12", organizationId: "9" }] },
    tick: [{ db_now: fmt(start + elapsedS * 1000), id: index ? "12" : "11", organization_id: "9", gd_id: "5", job_status: "QUEUED", row_version: 0, attempt_count: 0,
      lease_live: 0, due_now: 1, claim_id: "", dead_lease: 0 }], index: index };
  const arg = (h) => (/guard/i.test(h) ? vals.guard : /plan/i.test(h) ? vals.plan : /tick/i.test(h) ? vals.tick : vals.index);
  const silent = { log: () => {} };
  return new Function("console", ...names, body)(silent, ...holders.map((h) => JSON.parse(JSON.stringify(arg(h)))));
};
const cases = [
  ["second job after 100 s is claimed", pick(100, 1).route, "CLAIM"],
  ["second job after 250 s waits for the next tick", pick(250, 1).route, "SKIP"],
  ["first job after 300 s is still claimed", pick(300, 0).route, "CLAIM"],
];
let ok = true;
for (const [name, got, want] of cases) { const pass = got === want; ok = ok && pass; console.log((pass ? "ok   " : "FAIL ") + name + ": " + got); }
console.log(ok ? "3/3 passed" : "budget test FAILED");
process.exit(ok ? 0 : 1);
