// test_loop_openjob.js [--mutate <name>]: PICKING_LOOP's lock gate (Picking 1d, Task 14). A Picking with an open CONFIRM_PICKING
// job (a background confirm or force complete: QUEUED .. COMMITTING_PICKING, or REQUIRES_REVIEW) is held by that job: its lock is
// never taken over, however old (a force complete can outlast 900 s). Runs the nodes' code as the platform would.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const FILE = process.env.LOOP_JSON || R + "Picking/PickingLoopWorkflow.json";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = {
  job_ignored: ["} else if (row.open_job) {", "} else if (false) {"],
};
const load = () => {
  let s = fs.readFileSync(FILE, "utf8");
  if (mutate) {
    const [a, b] = MUT[mutate];
    const enc = (x) => JSON.stringify(x).slice(1, -1);
    if (s.indexOf(enc(a)) < 0) throw new Error("mutant anchor not found: " + mutate);
    s = s.split(enc(a)).join(enc(b));
  }
  return JSON.parse(s);
};
const nodes = (doc) => { const out = []; const walk = (l) => { for (const n of l || []) { out.push(n); walk(n.blocks); } }; walk(doc.nodes); return out; };
const node = (doc, id) => nodes(doc).filter((n) => n.id === id)[0];
const code = (n) => (n && n.data.script && n.data.script.code) || "";
const run = (n, values) => {
  const body = code(n).replace(/\{\{([^}]+)\}\}/g, (m, k) => { if (!(k in values)) throw new Error(n.id + ": no value for " + k); return JSON.stringify(values[k]); });
  return new Function(body)();
};
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };

const L = load();
const gate = node(L, "sql_node_LockGate"), decide = node(L, "code_node_LockDecide");
const row = (x) => Object.assign({ id: "9001", to_status: "In Progress", is_processing: 1, lock_age_sec: 1000, open_job: null }, x || {});
const decideRun = (r) => run(decide, { "node:sql_node_LockGate.data": [r] });

it("wiring: the lock gate reads this Picking's open CONFIRM_PICKING job (tenant-scoped, the five open states) and declares it", () => {
  const sql = code(gate);
  assert.ok(/j\.command = 'CONFIRM_PICKING'/.test(sql) && /j\.tenant_id = t\.tenant_id/.test(sql) && /j\.is_deleted = 0/.test(sql), "job predicate");
  assert.ok(/j\.picking_id = '\{\{node:code_node_hjAwTKzF\.data\.lockId\}\}'/.test(sql), "picking_id compared as text");
  assert.ok(/'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW'/.test(sql), "open states");
  assert.ok(gate.data.response_json.some((r) => r.name === "open_job"), "open_job undeclared");
});
it("1 a lock older than 900 s with an open job: NOT taken over (held by the job)", () => {
  assert.deepStrictEqual(decideRun(row({ open_job: "3000|COMMITTING_PICKING" })), { lockState: 1, staleRecovered: 0 });
});
it("1b a job under review holds it too", () => {
  assert.deepStrictEqual(decideRun(row({ open_job: "3000|REQUIRES_REVIEW" })), { lockState: 1, staleRecovered: 0 });
});
it("1c an open job holds the Picking even when its lock flag was cleared", () => {
  assert.deepStrictEqual(decideRun(row({ is_processing: 0, open_job: "3000|READY_TO_COMMIT" })), { lockState: 1, staleRecovered: 0 });
});
it("2 a lock older than 900 s and no open job: taken over as today", () => {
  assert.deepStrictEqual(decideRun(row()), { lockState: 0, staleRecovered: 1 });
});
it("2b as today: a fresh lock is held, a free Picking is free, Completed / Cancelled come first", () => {
  assert.deepStrictEqual(decideRun(row({ lock_age_sec: 10 })), { lockState: 1, staleRecovered: 0 });
  assert.deepStrictEqual(decideRun(row({ is_processing: 0 })), { lockState: 0, staleRecovered: 0 });
  assert.deepStrictEqual(decideRun(row({ to_status: "Completed", open_job: "3000|COMMITTING_PICKING" })), { lockState: 2, staleRecovered: 0 });
  assert.deepStrictEqual(decideRun(row({ to_status: "Cancelled" })), { lockState: 3, staleRecovered: 0 });
});

console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
