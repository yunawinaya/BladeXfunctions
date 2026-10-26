// test_commit_engine_crash.js: GD_COMPLETE_COMMIT C2, GD_CANCEL_COMMIT X2 and GD_REVERT_COMMIT R1 decide a CAUGHT failed
// INVENTORY_BULK_APPLY call (10-27; 10-26 Kenhin GD 2097 / LSH GD-2610-1473: the call's run failed, nothing came back) as a 409:
// a counted retry with the lease released; past 8 tries, review with intent rows, else FAILED with nothing written. Every other
// answer decides exactly as the live version (the old workflow file, given as the second path of each pair).
// The decision node's own code runs on the real C2 entry of dev run 2114758965897801730 (fixtures/commit_c2_entry_598.json).
// usage: node test_commit_engine_crash.js [<new COMMIT.json> <old COMMIT.json> ...]
const fs = require("fs");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const B = "/Users/yunawinaya/Documents/ASC-dev/workflow-backups/dev/";
const args = process.argv.slice(2);
const PAIRS = args.length ? Array.from({ length: args.length / 2 }, (_, i) => [args[2 * i], args[2 * i + 1]]) : [
  [R + "Goods Delivery/CompleteV2/GD_COMPLETE_COMMIT.json", B + "GD_COMPLETE_COMMIT/v11_20261027-032702.enabled.json"],
  [R + "Goods Delivery/CancelV2/GD_CANCEL_COMMIT.json", B + "GD_CANCEL_COMMIT/v9_20261027-032703.enabled.json"],
  [R + "Goods Delivery/RevertV2/GD_REVERT_COMMIT.json", B + "GD_REVERT_COMMIT/v6_20261027-032704.enabled.json"]];
const FX = JSON.parse(fs.readFileSync(__dirname + "/fixtures/commit_c2_entry_598.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const KIT = { GD_COMPLETE_COMMIT: ["CC", "CCc2", "C2_INVENTORY", "GDC"], GD_CANCEL_COMMIT: ["XC", "XCx2", "X2_INVENTORY", "GDX"], GD_REVERT_COMMIT: ["RC", "RCr1", "R1_INVENTORY", "GDR"] };
let fails = 0, n = 0;
const t = (name, ok, got) => { n += 1; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 400))); if (!ok) fails += 1; };
const decide = (W, P, X, c) => {
  const code = find(W, "code_node_" + X).data.script.code;
  const subs = {
    ["node:code_node_" + P + "entry.data"]: Object.assign({}, FX.entry, { attempts: c.attempts }),
    ["node:code_node_" + P + "guard.data"]: FX.guard,
    ["node:code_node_" + X + "in.data.ok"]: "YES",
    ["node:workflow_node_" + X + ".data.code"]: c.code === undefined ? null : c.code,
    ["node:workflow_node_" + X + ".data.result_code"]: c.result_code === undefined ? null : c.result_code,
    ["node:workflow_node_" + X + ".data.message"]: c.message === undefined ? null : c.message,
    ["node:code_node_" + X + "crash.data.crashed"]: c.crashed === undefined ? null : c.crashed,
    ["node:sql_node_" + X + "ops.data"]: [{ intents: c.intents }],
  };
  let body = code;
  for (const [k, v] of Object.entries(subs)) body = body.split("{{" + k + "}}").join(JSON.stringify(v));
  const left = body.match(/\{\{[^}]+\}\}/g);
  if (left) throw new Error("unfilled: " + left.slice(0, 3).join(", "));
  return new Function(body.replace(/console\.log\([^;]*\);/g, ""))();
};
for (const [newPath, oldPath] of PAIRS) {
  const NEW = JSON.parse(fs.readFileSync(newPath, "utf8")), OLD = JSON.parse(fs.readFileSync(oldPath, "utf8"));
  const wf = Object.keys(KIT).find((k) => newPath.indexOf(k) >= 0);
  const [P, X, STEP, ERR] = KIT[wf];
  const tag = wf + " " + X;
  // a caught failure, nothing written: a counted retry with the lease released, 15 s, the GD kept Processing
  let r = decide(NEW, P, X, { crashed: "YES", attempts: 0, intents: 0 });
  const j = (r.jobRows || [])[0] || {};
  t(tag + ": crash, try 1 -> retry: END, " + ERR + "_STEP_RETRY, lease released, attempt 1, due +15 s, GD stays locked",
    r.route === "END" && r.result_code === ERR + "_STEP_RETRY" && r.needJobUpd === "YES" && j.lease_owner === null && j.lease_expires_at === null &&
    j.attempt_count === 1 && j.next_attempt_at === "2026-10-27 00:40:17" && r.needUnlock === "NO" && String(j.error_message).indexOf("failed (caught), nothing written") >= 0, r);
  r = decide(NEW, P, X, { crashed: "YES", attempts: 3, intents: 2 });
  t(tag + ": crash with intent rows, try 4 -> still a retry (the engine replays its own operation)", r.route === "END" && r.result_code === ERR + "_STEP_RETRY" && (r.jobRows[0] || {}).attempt_count === 4, r);
  r = decide(NEW, P, X, { crashed: "YES", attempts: 8, intents: 0 });
  t(tag + ": crash, tries used up, nothing written -> FAILED " + ERR + "_INVENTORY_CALL_FAILED, the GD released", JSON.stringify(r).indexOf(ERR + "_INVENTORY_CALL_FAILED") >= 0 && r.needUnlock === "YES", r);
  r = decide(NEW, P, X, { crashed: "YES", attempts: 8, intents: 2 });
  const rOld409 = decide(OLD, P, X, { code: "409", result_code: "LOCK_BUSY", message: "busy", attempts: 8, intents: 2 });
  t(tag + ": crash, tries used up, intent rows -> review, as a used-up 409 with intent rows", r.route === rOld409.route && r.result_code === rOld409.result_code && r.needUnlock === rOld409.needUnlock, [r.route, r.result_code, rOld409.route, rOld409.result_code]);
  // the crashed run's marker holds the operation for 20 min: "the same operation is still running" is our own operation, so
  // even a job past its 8 tries keeps waiting (never FAILED, never review), with or without intent rows
  const OWN = "the same operation is still running (run 1, last heartbeat 2026-10-27 03:35:20); try again later";
  for (const intents of [0, 2]) {
    r = decide(NEW, P, X, { code: "409", result_code: "LOCK_BUSY", message: OWN, attempts: 8, intents: intents });
    t(tag + ": own run still holds it, try 9, intents " + intents + " -> keeps waiting (retry, lease released)",
      r.route === "END" && r.result_code === ERR + "_STEP_RETRY" && (r.jobRows[0] || {}).attempt_count === 9 && (r.jobRows[0] || {}).lease_owner === null && r.needUnlock === "NO", r);
  }
  // the ceiling (as GD_EDIT_COMMIT E1): after 16 own-run tries, review - never FAILED - so a marker that never clears is seen
  for (const intents of [0, 2]) {
    r = decide(NEW, P, X, { code: "409", result_code: "LOCK_BUSY", message: OWN, attempts: 16, intents: intents });
    t(tag + ": own run still holds it, try 17, intents " + intents + " -> review, as a used-up 409 with intent rows",
      r.route === rOld409.route && r.result_code === rOld409.result_code && r.needUnlock === rOld409.needUnlock && JSON.stringify(r).indexOf("_INVENTORY_LOCK_BUSY") < 0, [r.route, r.result_code]);
  }
  r = decide(NEW, P, X, { code: "409", result_code: "LOCK_BUSY", message: OWN, attempts: 15, intents: 0 });
  t(tag + ": own run still holds it, try 16 -> still waiting", r.route === "END" && r.result_code === ERR + "_STEP_RETRY", r);
  r = decide(NEW, P, X, { code: "409", result_code: "LOCK_BUSY", message: "locked by operation GDC|other", attempts: 8, intents: 0 });
  t(tag + ": another operation's lock, try 9 -> gives up as before (FAILED, nothing written)", JSON.stringify(r).indexOf(ERR + "_INVENTORY_LOCK_BUSY") >= 0, r);
  // every other answer decides exactly as the live version
  const cases = [
    { code: "200", result_code: "APPLIED", message: "Applied 2 movements", attempts: 0, intents: 2 },
    { code: "409", result_code: "LOCK_BUSY", message: "lock row not created yet", attempts: 0, intents: 0 },
    { code: "409", result_code: "LOCK_BUSY", message: "busy", attempts: 8, intents: 0 },
    { code: "400", result_code: "INSUFFICIENT", message: "no stock", attempts: 0, intents: 0 },
    { code: "500", result_code: "REVIEW", message: "mismatch", attempts: 0, intents: 1 },
    { attempts: 0, intents: 0 },
  ];
  for (const c of cases) {
    const a = decide(NEW, P, X, c), b = decide(OLD, P, X, c);
    t(tag + ": answer " + (c.code || "none") + " (try " + (c.attempts + 1) + ", intents " + c.intents + ") decides as live", JSON.stringify(a) === JSON.stringify(b), [a.route, a.result_code, b.route, b.result_code]);
  }
}
console.log(n + " cases; " + (fails ? fails + " FAILED" : "all passed"));
process.exitCode = fails ? 1 : 0;
