// PICKING_FC_DRIVE - Call: GD_EDIT_SUBMIT's answer to this iteration's SUBMIT / RELEASE / CANCEL_HELD. QUEUED / RELEASED /
// CANCELLING / NONE (the state moved on) / BUSY on our own edit -> go on (the next read shows it); BUSY on another's edit or a
// write that did not read back (500) -> stop, retried on the next call; anything else refuses the delivery -> FC_ABORT
// (holding: nothing is committed) or FC_REVIEW (committing)
const driveCall = function driveCall(entry, next, resp) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const r = resp || {};
  const route = s(r.route), code = s(r.code), msg = s(r.message);
  const base = { route: "GO", stepRows: [], needStep: "NO", stop: "NO", result_message: s(next.operation) + " " + s(next.gdNo) + ": " + route + " " + code + " " + msg };
  if (["QUEUED", "RELEASED", "CANCELLING", "NONE"].indexOf(route) >= 0 || (route === "BUSY" && s(r.cascade_ref) === s(next.cascadeRef))) return base;
  if (route === "BUSY" || code === "500") return Object.assign(base, { route: "WAIT", stop: "YES" });
  const kind = route === "NOT_ELIGIBLE" ? "PK_FC_GD_NOT_ELIGIBLE" : /^GDE_FC_STALE/.test(msg) ? "PK_FC_GD_CHANGED" : "PK_FC_GD_REFUSED";
  const text = kind === "PK_FC_GD_CHANGED" ? s(next.gdNo) + " changed since the force complete was prepared: nothing was saved. Try again."
    : kind === "PK_FC_GD_NOT_ELIGIBLE" ? s(next.gdNo) + " cannot be updated in the background (" + msg + ")"
    : s(next.gdNo) + ": " + (msg || route + " " + code);
  const dbNow = s(next.dbNow) || s(entry.dbNow);
  return Object.assign(base, { route: "REFUSED", needStep: "YES", stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId,
    step_name: next.phase === "COMMIT" ? "FC_REVIEW" : "FC_ABORT", step_status: "DONE", attempt_count: 1, started_at: dbNow, finished_at: dbNow, inventory_operation_id: "",
    result_ref: kind + "|" + text, error_code: null, error_message: null }] });
};
const res = driveCall([{{node:code_node_DRentry.data}}][0], [{{node:code_node_DRnext.data}}][0], [{{node:workflow_node_DRsubmit.data}}][0]);
console.log("drive call", JSON.stringify({ route: res.route, stop: res.stop, message: res.result_message }));
return res;
