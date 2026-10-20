// PICKING_FC_DRIVE - Next: this iteration's ONE action from the fresh state (fcNext), within the call's budget: the loop's 12
// slots, 20 s on the DB clock and about 600 line-weight units of SUBMIT (the first action always runs). WAIT / DONE /
// ABORTED / REVIEW_DONE, MARK_GDS or the budget end the loop: the stamp after it reads the state again and answers
const DRIVE_BUDGET = { seconds: 20, weight: 600 };
const driveNext = function driveNext(entry, rows, index) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const D = driveState(entry, rows);
  const a = fcNext(D.st);
  const i = Number(index) || 0;
  const sec = (t) => { const m = s(t).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : NaN; };
  const elapsed = Math.max(0, sec(D.dbNow) - sec(entry.runStart)) || 0;
  const m = typeof a.gi === "number" ? entry.manifest[a.gi] || null : null;
  const base = { kind: s(a.kind), index: i, dbNow: D.dbNow, phase: D.jobStatus === "COMMITTING_PICKING" ? "COMMIT" : "HOLD", gi: m ? m.gi : -1, gdNo: m ? m.gd_no : "", terminal: "NO",
    needF0: "NO", call: "NO", operation: "", gdId: "0", fcdRef: "", cascadeRef: "PKFC|" + entry.jobId, stepRows: [], needStep: "NO", jobRows: [], needJob: "NO", result_message: "" };
  const stop = (why) => Object.assign(base, { terminal: "YES", result_message: why });
  if (["WAIT", "DONE", "ABORTED", "REVIEW_DONE"].indexOf(a.kind) >= 0) return stop(a.kind);
  if (i > 0 && elapsed >= DRIVE_BUDGET.seconds) return stop("budget: " + elapsed + " s");
  if (i > 0 && a.kind === "SUBMIT" && m && D.weightDone + m.weight > DRIVE_BUDGET.weight) return stop("budget: line weight " + (D.weightDone + m.weight));
  const step = (name, ref) => [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: name, step_status: "DONE", attempt_count: 1, started_at: D.dbNow,
    finished_at: D.dbNow, inventory_operation_id: "", result_ref: ref, error_code: null, error_message: null }];
  const n = entry.manifest.length;
  if (a.kind === "F0") return Object.assign(base, { needF0: "YES", result_message: "F0" });
  if ((a.kind === "SUBMIT" || a.kind === "RELEASE" || a.kind === "CANCEL_HELD") && m) {
    return Object.assign(base, { call: "YES", operation: a.kind, gdId: m.gd_id, fcdRef: a.kind === "SUBMIT" ? "FCD|" + entry.nonce + "|" + m.gi : "", result_message: a.kind + " " + m.gd_no });
  }
  if (a.kind === "MARK_HOLD") {
    return Object.assign(base, { stepRows: step("FC_HOLD", "held: " + n), needStep: "YES", result_message: "every delivery is held",
      jobRows: [{ id: entry.jobId, job_status: "COMMITTING_PICKING", progress_percent: 70, progress_message: n ? "Updating delivery 1 of " + n : "No delivery to update", row_version: D.rowVersion + 1 }],
      needJob: "YES" });
  }
  if (a.kind === "MARK_GDS") return Object.assign(base, { stepRows: step("FC_GDS", "updated: " + n), needStep: "YES", terminal: "YES", result_message: "every delivery is updated" });
  if ((a.kind === "ABORT" || a.kind === "REVIEW") && m) {
    const x = D.st.edits.filter((e) => e.gi === m.gi)[0] || {};
    const code = s(a.code) || "PK_FC_GD_FAILED";
    return Object.assign(base, { stepRows: step(a.kind === "ABORT" ? "FC_ABORT" : "FC_REVIEW", code + "|" + m.gd_no + ": " + (s(x.error_message) || "its edit ended " + s(x.job_status))),
      needStep: "YES", result_message: a.kind + " " + m.gd_no + " " + code });
  }
  return stop("no action for " + s(a.kind));
};
const res = driveNext([{{node:code_node_DRentry.data}}][0], [{{node:sql_node_DRstate.data}}][0], [{{node:loop_DRact}}][0]);
console.log("drive next", JSON.stringify({ index: res.index, kind: res.kind, gi: res.gi, terminal: res.terminal, message: res.result_message }));
return res;
