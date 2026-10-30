// LOT_V2_COMMIT for the IA transfer request (ENH-20261027-001): the BUILT workflow's L1 (code_node_LCl1, its definitions up to the
// platform tail) on a request's dispatch job (prevStatus Requested). IATR_COMMIT=<file> runs another build (mutants_lot_v2.js).
//   - the engine refusing the dispatch (400, e.g. the stock was taken meanwhile) -> FAILED, the LOT back to Requested (spec U18)
//   - the stock locked past the 8 waits, nothing moved -> FAILED, back to Requested
//   - an unknown status to restore -> REQUIRES_REVIEW, no unlock (unchanged)
//   node scratchpad/iatr/test/test_lot_v2_commit.js
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const H = require(path.join(REPO, "scratchpad", "smv2", "lib", "harness.js"));
const FILE = process.env.IATR_COMMIT || path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_COMMIT.json");
let code = null;
(function walk(n) {
  if (Array.isArray(n)) n.forEach(walk);
  else if (n && typeof n === "object") {
    if (n.id === "code_node_LCl1") code = n.data.script.code;
    Object.values(n).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(FILE, "utf8")).nodes);
const lines = code.split("\n");
const { commitL1 } = new Function("console", lines.slice(0, lines.findIndex((l) => l.includes("{{"))).join("\n") + "\nreturn { commitL1 };")({ log() {} });

const LOT = "9100000000000000001";
const entry = (prev, attempts) => ({ jobId: "9100000000000000002", lotId: LOT, attempts: attempts || 0, rowVersion: 4, dbNow: "2026-10-28 12:00:00", jsAt: 0, lineCount: 2,
  unlockOk: "YES", prevStatus: prev, partPrefix: "S|abcd1234|", leaseUntil: "2026-10-28 12:30:00" });
const guard = { nonce: "abcd1234" };
const input = { ok: "YES", needCall: "YES", why: "", keys: "{}" };
const job = (r) => (r.jobRows || [])[0] || {};
const refused = { code: "400", result_code: "INSUFFICIENT_STOCK", message: "insufficient stock for M1" };

let r = commitL1(entry("Requested"), guard, input, refused, { intents: 0 }, []);
H.eq("the engine refuses a dispatch -> FAILED, the LOT back to Requested", [job(r).job_status, r.result_code, r.needUnlock, r.unlockRows],
  ["FAILED", "LOT_INVENTORY_INSUFFICIENT_STOCK", "YES", [{ id: LOT, stock_movement_status: "Requested" }]]);
r = commitL1(entry("Requested", 8), guard, input, { code: "409", result_code: "LOCK_BUSY", message: "busy" }, { intents: 0 }, []);
H.eq("the stock locked past the waits, nothing moved -> FAILED, back to Requested", [job(r).job_status, r.needUnlock, r.unlockRows],
  ["FAILED", "YES", [{ id: LOT, stock_movement_status: "Requested" }]]);
r = commitL1(entry("Draft"), guard, input, refused, { intents: 0 }, []);
H.eq("(a Draft STAGE refused the same way: back to Draft)", r.unlockRows, [{ id: LOT, stock_movement_status: "Draft" }]);
r = commitL1(entry("Processing"), guard, input, refused, { intents: 0 }, []);
H.eq("an unknown status to restore -> REQUIRES_REVIEW, no unlock", [job(r).job_status, r.needUnlock, r.unlockRows || []], ["REQUIRES_REVIEW", "NO", []]);

// LOT_V2_WORKER: a job that runs out of tries (claim / after PREPARE / after a publish) releases the LOT the same way
const WFILE = process.env.IATR_WORKER || path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_WORKER.json");
const wcode = {};
(function walk(n) {
  if (Array.isArray(n)) n.forEach(walk);
  else if (n && typeof n === "object") {
    if (typeof n.id === "string" && n.type === "code-node") wcode[n.id] = n.data.script.code;
    Object.values(n).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(WFILE, "utf8")).nodes);
for (const id of ["code_node_LWclaim", "code_node_LWafterPrep", "code_node_LWpubAfter", "code_node_LWpub2After"]) {
  const ls = wcode[id].split("\n");
  const rel = new Function("console", ls.slice(0, ls.findIndex((l) => l.includes("{{"))).join("\n") + "\nreturn lotWorkerRelease;")({ log() {} });
  H.eq(id + ": a dispatch job released -> back to Requested", [rel(LOT, "Requested"), rel(LOT, "Processing").result_code],
    [{ unlockRows: [{ id: LOT, stock_movement_status: "Requested" }], result_code: "" }, "LOT_PREV_STATUS_UNKNOWN"]);
}
H.done();
