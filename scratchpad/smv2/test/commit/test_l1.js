// node test/commit/test_l1.js - COMMIT L1's answer handling on the BUILT LOT_V2_COMMIT.json (code_node_LCl1 up to its platform tail):
// engine v12 answers 409 while an earlier run of the SAME operation is alive or < 20 min dead, so a 409 with intent rows waits like
// a lock wait and ends in REQUIRES_REVIEW, never in a clean FAILED; a 409 without intent rows keeps the 8 waits then FAILED.
const fs = require("fs");
const path = require("path");
const BUILT = path.join(__dirname, "..", "..", "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_COMMIT.json");
const doc = JSON.parse(fs.readFileSync(BUILT, "utf8"));
const body = (id) => {
  let found = null;
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.id === id) found = n.data.script.code; Object.values(n).forEach(walk); } };
  walk(doc.nodes);
  if (!found) throw new Error("no node " + id);
  const lines = found.split("\n");
  return lines.slice(0, lines.findIndex((l) => l.includes("{{"))).join("\n");
};
const { commitL1 } = new Function("console", body("code_node_LCl1") + "\nreturn { commitL1 };")({ log() {} });

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? "ok   " : "FAIL ") + label + (cond ? "" : " -> " + JSON.stringify(detail).slice(0, 400)));
};
const entry = (attempts) => ({ jobId: "2112782565316567041", attempts: attempts, rowVersion: 4, dbNow: "2026-10-21 17:20:00", jsAt: 0, lineCount: 2,
  unlockOk: "YES", prevStatus: "In Progress", partPrefix: "S|abcd1234|", leaseUntil: "2026-10-21 17:50:00" });
const guard = { nonce: "abcd1234" };
const input = { ok: "YES", needCall: "YES", why: "", keys: "{}" };
const busy = { code: "409", result_code: "LOCK_BUSY", message: "the same operation is still running" };
const job = (r) => (r.jobRows || [])[0] || {};

// 409 + intent rows: waits 1..8 on the lock-wait schedule (15 s x 2^n, max 300 s), the 9th answer -> REQUIRES_REVIEW
let total = 0;
for (let n = 0; n < 8; n++) {
  const r = commitL1(entry(n), guard, input, busy, { intents: 3 }, []);
  const due = (Date.parse(job(r).next_attempt_at.replace(" ", "T")) - Date.parse("2026-10-21T17:20:00")) / 1000;
  total += due;
  check("intents, wait " + (n + 1) + ": LOT_LOCK_WAIT, COMMITTING_LOT, due +" + due + " s", r.result_code === "LOT_LOCK_WAIT" && job(r).job_status === "COMMITTING_LOT" && due === Math.min(300, 15 * Math.pow(2, n)), r);
}
check("intents: 8 waits add up to more than the engine's 20-min window (" + total + " s)", total > 1200, total);
const end = commitL1(entry(8), guard, input, busy, { intents: 3 }, []);
check("intents, 9th 409: REQUIRES_REVIEW, no unlock", job(end).job_status === "REQUIRES_REVIEW" && end.needUnlock === "NO" && end.result_code === "LOT_RECONCILIATION_MISMATCH", end);

// 409 without intent rows: unchanged - 8 waits, then FAILED with the transfer unlocked back to its status before the save
const w = commitL1(entry(0), guard, input, busy, { intents: 0 }, []);
check("no intents, wait 1: LOT_LOCK_WAIT", w.result_code === "LOT_LOCK_WAIT" && job(w).job_status === "COMMITTING_LOT", w);
const f = commitL1(entry(8), guard, input, busy, { intents: 0 }, []);
check("no intents, 9th 409: FAILED LOT_INVENTORY_LOCK_BUSY", job(f).job_status === "FAILED" && f.result_code === "LOT_INVENTORY_LOCK_BUSY", f);

// 200 / REPLAYED: DONE + hand-over, attempt_count back to 0
const ok = commitL1(entry(5), guard, input, { code: "200", result_code: "REPLAYED", message: "" }, { intents: 3 }, []);
check("200 REPLAYED after waits: SPLIT, attempt_count 0", ok.path === "SPLIT" && (ok.splitRows || [])[0].attempt_count === 0, ok);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
