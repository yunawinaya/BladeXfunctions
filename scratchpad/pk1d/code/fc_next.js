// Picking 1d - fcNext: PICKING_FC_DRIVE's next single action from its freshly read state (spec ~/.claude/plans/delightful-imagining-naur.md).
// DRIVE never runs GD_EDIT_WORKER: a WAIT names the edit jobs the screen must kick. Holds run in parallel; commits one at a time.
// /*M:...*/ markers are mutation points for scratchpad/pk1d/test/test_fc_next.js.
const STALE = { GDE_STALE: true, GDE_FC_STALE: true };
const INFLIGHT = { QUEUED: true, VALIDATING: true, READY_TO_COMMIT: true, COMMITTING_GD: true };

const fcNext = function fcNext(st) {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const status = s(st.job && st.job.status);
  if (status !== "READY_TO_COMMIT" && status !== "COMMITTING_PICKING") return { kind: "DONE" };
  const steps = st.steps || {};
  const edits = {};
  for (const x of st.edits || []) edits[x.gi] = x;
  const manifest = (st.manifest || []).slice().sort((a, b) => a.gi - b.gi);
  const held = (x) => !!x && x.job_status === "HELD" && !x.due;
  const flying = (x) => !!x && (INFLIGHT[x.job_status] === true || (x.job_status === "HELD" && !!x.due));
  const kickOf = (list) => list.filter((x) => !x.lease_live).map((x) => s(x.job_id));
  const wait = (x) => ({ kind: "WAIT", kick: kickOf([x]) });
  const replannable = (x) => x.job_status === "CANCELLED" || (x.job_status === "FAILED" && STALE[s(x.error_code)] === true);

  // aborting (hold phase) or under review (commit phase): cancel what is held, let in-flight jobs land, then finish
  if (steps.FC_ABORT || steps.FC_REVIEW) {
    for (const m of manifest) if (held(edits[m.gi])) return { kind: "CANCEL_HELD", gi: m.gi };
    const busy = manifest.map((m) => edits[m.gi]).filter(flying);
    if (busy.length) return { kind: "WAIT", kick: kickOf(busy) };
    return { kind: steps.FC_ABORT ? "ABORTED" : "REVIEW_DONE" };
  }

  if (status === "READY_TO_COMMIT") {
    if (!steps.FC_F0) return { kind: "F0" };
    for (const m of manifest) {
      const x = edits[m.gi];
      if (x && (x.job_status === "FAILED" || x.job_status === "REQUIRES_REVIEW") && !replannable(x)) return { kind: "ABORT", gi: m.gi, code: s(x.error_code) };
    }
    for (const m of manifest) {
      const x = edits[m.gi];
      if (!x) return { kind: "SUBMIT", gi: m.gi };
      if (replannable(x)) return (x.replans || 0) < 2 ? { kind: "SUBMIT", gi: m.gi } : { kind: "ABORT", gi: m.gi, code: s(x.error_code) || "GDE_HOLD_EXPIRED" };
    }
    const waiting = manifest.map((m) => edits[m.gi]).filter((x) => !held(x));
    if (/*M:allheld*/ waiting.length === 0) return { kind: "MARK_HOLD" };
    return { kind: "WAIT", kick: kickOf(waiting.filter(flying)) };
  }

  // COMMITTING_PICKING: deliveries strictly in order; the next one only after the previous COMPLETED
  for (const m of manifest) {
    const x = edits[m.gi];
    if (!x) return { kind: "SUBMIT", gi: m.gi };
    if (x.job_status === "COMPLETED") continue;
    if (held(x)) {
      if (st.sharedAfterHold && st.sharedAfterHold[m.gi] && (x.replans || 0) < 2) return { kind: "CANCEL_HELD", gi: m.gi };
      return { kind: "RELEASE", gi: m.gi };
    }
    if (replannable(x)) {
      if (/*M:cap*/ x.replans < 2) return { kind: "SUBMIT", gi: m.gi };
      return { kind: "REVIEW", gi: m.gi, code: s(x.error_code) };
    }
    if (x.job_status === "FAILED" || x.job_status === "REQUIRES_REVIEW") return { kind: "REVIEW", gi: m.gi, code: s(x.error_code) };
    /*M:seq*/ return wait(x);
  }
  if (!steps.FC_GDS) return { kind: "MARK_GDS" };
  return { kind: "DONE" };
};

module.exports = { fcNext };
