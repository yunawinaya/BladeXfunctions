// test_fc_next.js: scratchpad/pk1d/code/fc_next.js, PICKING_FC_DRIVE's next action (spec: DRIVE never runs GD_EDIT_WORKER;
// a WAIT carries the edit jobs the screen must kick). Table-driven; then each MUTANT must make some row fail.
const fs = require("fs"), path = require("path"), assert = require("assert");
const NEXT = path.join(__dirname, "../code/fc_next.js");
let failed = 0, n = 0;

const st = (job, edits, extra) => Object.assign({
  job: { id: "J1", status: job }, steps: { FC_F0: true }, manifest: [{ gi: 0, gd_id: "G0" }, { gi: 1, gd_id: "G1" }],
  edits: edits, sharedAfterHold: {},
}, extra || {});
const e = (gi, status, more) => Object.assign({ gi: gi, job_id: "E" + gi, job_status: status, due: false, lease_live: false, error_code: "", replans: 0 }, more || {});
const one = (s) => Object.assign(s, { manifest: [{ gi: 0, gd_id: "G0" }] });

const ROWS = [
  ["1 READY, no FC_F0 -> F0", st("READY_TO_COMMIT", [], { steps: {} }), { kind: "F0" }],
  ["2 READY, edit 0 missing -> SUBMIT 0", st("READY_TO_COMMIT", []), { kind: "SUBMIT", gi: 0 }],
  ["3 READY, the only edit QUEUED -> WAIT kick it", one(st("READY_TO_COMMIT", [e(0, "QUEUED")])), { kind: "WAIT", kick: ["E0"] }],
  ["3b READY, edit 0 QUEUED, edit 1 missing -> SUBMIT 1 (holds in parallel)", st("READY_TO_COMMIT", [e(0, "QUEUED")]), { kind: "SUBMIT", gi: 1 }],
  ["3c READY, both preparing -> WAIT kick both", st("READY_TO_COMMIT", [e(0, "QUEUED"), e(1, "VALIDATING")]), { kind: "WAIT", kick: ["E0", "E1"] }],
  ["4 READY, edit 0 HELD, edit 1 missing -> SUBMIT 1", st("READY_TO_COMMIT", [e(0, "HELD")]), { kind: "SUBMIT", gi: 1 }],
  ["5 READY, all HELD -> MARK_HOLD", st("READY_TO_COMMIT", [e(0, "HELD"), e(1, "HELD")]), { kind: "MARK_HOLD" }],
  ["6 READY, an edit FAILED (a refusal) -> ABORT with its code", st("READY_TO_COMMIT", [e(0, "HELD"), e(1, "FAILED", { error_code: "GDE_NOT_ELIGIBLE" })]), { kind: "ABORT", gi: 1, code: "GDE_NOT_ELIGIBLE" }],
  ["6b aborting, edit 0 HELD -> CANCEL_HELD 0", st("READY_TO_COMMIT", [e(0, "HELD"), e(1, "FAILED", { error_code: "X" })], { steps: { FC_F0: true, FC_ABORT: true } }), { kind: "CANCEL_HELD", gi: 0 }],
  ["6c aborting, edit 0 HELD and due (cancel pending) -> WAIT kick it", st("READY_TO_COMMIT", [e(0, "HELD", { due: true }), e(1, "FAILED")], { steps: { FC_F0: true, FC_ABORT: true } }), { kind: "WAIT", kick: ["E0"] }],
  ["6d aborting, nothing held or in flight -> ABORTED", st("READY_TO_COMMIT", [e(0, "CANCELLED"), e(1, "FAILED")], { steps: { FC_F0: true, FC_ABORT: true } }), { kind: "ABORTED" }],
  ["7 COMMITTING, edit 0 HELD, not shared -> RELEASE 0", st("COMMITTING_PICKING", [e(0, "HELD"), e(1, "HELD")]), { kind: "RELEASE", gi: 0 }],
  ["8 COMMITTING, edit 0 HELD, shares an SO line with an edit committed after its hold -> CANCEL_HELD 0", st("COMMITTING_PICKING", [e(0, "HELD"), e(1, "HELD")], { sharedAfterHold: { 0: true } }), { kind: "CANCEL_HELD", gi: 0 }],
  ["8b ... but its re-plans are used up -> RELEASE 0 (E0 decides)", st("COMMITTING_PICKING", [e(0, "HELD", { replans: 2 }), e(1, "HELD")], { sharedAfterHold: { 0: true } }), { kind: "RELEASE", gi: 0 }],
  ["9 COMMITTING, edit 0 CANCELLED by a re-plan -> SUBMIT 0", st("COMMITTING_PICKING", [e(0, "CANCELLED"), e(1, "HELD")]), { kind: "SUBMIT", gi: 0 }],
  ["10 COMMITTING, edit 0 released -> WAIT kick it", st("COMMITTING_PICKING", [e(0, "READY_TO_COMMIT"), e(1, "HELD")]), { kind: "WAIT", kick: ["E0"] }],
  ["11 COMMITTING, edit 0 FAILED GDE_STALE, 1 re-plan used -> SUBMIT 0", st("COMMITTING_PICKING", [e(0, "FAILED", { error_code: "GDE_STALE", replans: 1 }), e(1, "HELD")]), { kind: "SUBMIT", gi: 0 }],
  ["12 COMMITTING, edit 0 FAILED GDE_STALE, 2 re-plans used -> REVIEW", st("COMMITTING_PICKING", [e(0, "FAILED", { error_code: "GDE_STALE", replans: 2 }), e(1, "HELD")]), { kind: "REVIEW", gi: 0, code: "GDE_STALE" }],
  ["13 COMMITTING, edit 0 REQUIRES_REVIEW -> REVIEW", st("COMMITTING_PICKING", [e(0, "REQUIRES_REVIEW", { error_code: "GDE_E3_CONFLICT" }), e(1, "HELD")]), { kind: "REVIEW", gi: 0, code: "GDE_E3_CONFLICT" }],
  ["14 COMMITTING, all COMPLETED -> MARK_GDS", st("COMMITTING_PICKING", [e(0, "COMPLETED"), e(1, "COMPLETED")]), { kind: "MARK_GDS" }],
  ["15 COMMITTING, FC_GDS -> DONE", st("COMMITTING_PICKING", [e(0, "COMPLETED"), e(1, "COMPLETED")], { steps: { FC_F0: true, FC_HOLD: true, FC_GDS: true } }), { kind: "DONE" }],
  ["16 an edit committing under a live lease -> WAIT, no kick", st("COMMITTING_PICKING", [e(0, "COMMITTING_GD", { lease_live: true }), e(1, "HELD")]), { kind: "WAIT", kick: [] }],
  ["17 COMMITTING, edit 0 COMPLETED, edit 1 HELD -> RELEASE 1", st("COMMITTING_PICKING", [e(0, "COMPLETED"), e(1, "HELD")]), { kind: "RELEASE", gi: 1 }],
  ["18 COMMITTING, edit 0 still committing, edit 1 HELD -> WAIT on 0 (never release 1 first)", st("COMMITTING_PICKING", [e(0, "READY_TO_COMMIT"), e(1, "HELD")]), { kind: "WAIT", kick: ["E0"] }],
  ["19 reviewing, edit 1 HELD -> CANCEL_HELD 1", st("COMMITTING_PICKING", [e(0, "FAILED"), e(1, "HELD")], { steps: { FC_F0: true, FC_HOLD: true, FC_REVIEW: true } }), { kind: "CANCEL_HELD", gi: 1 }],
  ["19b reviewing, nothing held or in flight -> REVIEW_DONE", st("COMMITTING_PICKING", [e(0, "FAILED"), e(1, "CANCELLED")], { steps: { FC_F0: true, FC_HOLD: true, FC_REVIEW: true } }), { kind: "REVIEW_DONE" }],
  ["20 the job is no longer READY / COMMITTING -> DONE", st("FAILED", [e(0, "HELD")]), { kind: "DONE" }],
  ["21 READY, a hold expired (HELD and due) -> WAIT kick it (the worker cancels it)", one(st("READY_TO_COMMIT", [e(0, "HELD", { due: true })])), { kind: "WAIT", kick: ["E0"] }],
  ["22 READY, an expired hold now CANCELLED -> SUBMIT again", one(st("READY_TO_COMMIT", [e(0, "CANCELLED")])), { kind: "SUBMIT", gi: 0 }],
  ["23 READY, CANCELLED with re-plans used up -> ABORT", one(st("READY_TO_COMMIT", [e(0, "CANCELLED", { replans: 2, error_code: "GDE_HOLD_EXPIRED" })])), { kind: "ABORT", gi: 0, code: "GDE_HOLD_EXPIRED" }],
  ["24 READY, a refusal wins over a missing edit -> ABORT", st("READY_TO_COMMIT", [e(0, "FAILED", { error_code: "GDE_NOT_ELIGIBLE" })]), { kind: "ABORT", gi: 0, code: "GDE_NOT_ELIGIBLE" }],
];

function run(fcNext, quiet) {
  let bad = 0;
  for (const [name, state, want] of ROWS) {
    try { assert.deepStrictEqual(fcNext(JSON.parse(JSON.stringify(state))), want); }
    catch (err) { bad++; if (!quiet) { failed++; console.log("FAIL " + name + ": " + String(err.message).split("\n").slice(0, 3).join(" ").slice(0, 220)); } }
    if (!quiet) n++;
  }
  return bad;
}
run(require(NEXT).fcNext, false);

const MUTANTS = [
  ["release before every delivery is held", "/*M:allheld*/ waiting.length === 0", "/*M:allheld*/ true"],
  ["no cap on re-plans", "/*M:cap*/ x.replans < 2", "/*M:cap*/ true"],
  ["commits not one at a time", "/*M:seq*/ return wait(x)", "/*M:seq*/ {}"],
];
const src = fs.readFileSync(NEXT, "utf8");
for (const [name, from, to] of MUTANTS) {
  n++;
  if (src.indexOf(from) < 0) { failed++; console.log("FAIL mutant " + name + ": marker not found"); continue; }
  const file = path.join(__dirname, "../code/.mut_fc_next.js");
  fs.writeFileSync(file, src.replace(from, to));
  delete require.cache[file];
  let killed;
  try { killed = run(require(file).fcNext, true) > 0; } catch (err) { killed = true; }
  fs.unlinkSync(file);
  if (!killed) { failed++; console.log("FAIL mutant survived: " + name); }
}
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
