// test_engine_409_wait.js: the GD V2 COMMITs' engine step (GD_COMPLETE C2, GD_CANCEL X2, GD_REVERT R1) on engine v12's 409 "the same
// operation is still running": with intent rows (IBA|I|*) it waits on the lock-wait schedule and goes to review once the 8 waits are spent
// (never a clean FAILED: the operation may have written); without them it waits, then FAILED + unlock as before. Runs the built node.
const fs = require("fs");
const assert = require("assert");
const R = __dirname + "/../../../";
const find = (n, id) => {
  if (Array.isArray(n)) { for (const x of n) { const r = find(x, id); if (r) return r; } return null; }
  if (n && typeof n === "object") { if (n.id === id) return n; for (const v of Object.values(n)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const CASES = [["Goods Delivery/CompleteV2/GD_COMPLETE_COMMIT.json", "code_node_CCc2", "CC", "GDC"], ["Goods Delivery/CancelV2/GD_CANCEL_COMMIT.json", "code_node_XCx2", "XC", "GDX"],
  ["Goods Delivery/RevertV2/GD_REVERT_COMMIT.json", "code_node_RCr1", "RC", "GDR"]];
let n = 0;
for (const [file, nid, p, pre] of CASES) {
  const code = find(JSON.parse(fs.readFileSync(R + file, "utf8")), nid).data.script.code;
  const run = (eng, intents, attempts) => {
    const ctx = { entry: { attempts: attempts, dbNow: "2026-10-21 17:40:00", jobId: "2112000000000000001", gdId: "2112000000000000002", unlockOk: "YES", rowVersion: 3,
      leaseUntil: "2026-10-21 18:10:00", organizationId: "1", nonce: "abc" }, guard: { nonce: "abc" }, ops: [{ intents: String(intents) }] };
    const body = code.replace(/\{\{node:([^}]+)\}\}/g, (_, path) => {
      if (/^workflow_node_/.test(path)) return JSON.stringify(eng[path.split(".").pop()]);
      if (/data\.ok$/.test(path)) return JSON.stringify("YES");
      if (/entry\.data$|CCentry|XCentry|RCentry/.test(path)) return JSON.stringify(ctx.entry);
      if (/guard\.data$|guard/.test(path)) return JSON.stringify(ctx.guard);
      if (/ops\.data$|ops/.test(path)) return JSON.stringify(ctx.ops);
      throw new Error(nid + " reads " + path);
    });
    return new Function("console", body)({ log() {} });
  };
  const busy = { code: "409", result_code: "LOCK_BUSY", message: "the same operation is still running (run 1, last heartbeat 2026-10-21 17:35:00); try again later" };
  const w = run(busy, 1, 0);
  assert.deepStrictEqual([w.job_status, w.jobRows[0].error_code, w.needUnlock], ["COMMITTING_GD", pre + "_LOCK_WAIT", "NO"], file + " wait");
  const r = run(busy, 1, 8);
  assert.deepStrictEqual([r.job_status, r.needUnlock], ["REQUIRES_REVIEW", "NO"], file + " review after 8 waits");
  const f = run({ code: "409", result_code: "LOCK_BUSY", message: "ITEM|1|2 (GDC|9)" }, 0, 8);
  assert.deepStrictEqual([f.job_status, f.needUnlock], ["FAILED", "YES"], file + " no intents: FAILED + unlock as before");
  const f0 = run({ code: "409", result_code: "LOCK_BUSY", message: "ITEM|1|2 (GDC|9)" }, 0, 2);
  assert.strictEqual(f0.job_status, "COMMITTING_GD", file + " no intents: wait as before");
  n++;
  console.log("ok", nid, ": 409 + intents -> wait (" + w.jobRows[0].next_attempt_at + "), review after 8; no intents -> wait, then FAILED + unlock");
}
console.log(n + " passed");
