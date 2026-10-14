// GD_COMPLETE_COMMIT - C1 SNAPSHOT: GD_COMPLETION_SNAPSHOT (Revert Completed reads it) answered 200 -> DONE; else retry,
// and after MAX_RETRIES FAILED with the GD back to Created (only the snapshot row exists)
const commitC1 = function commitC1(entry, input, snap) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GDC_INVALID_DATA", "the snapshot part of the prepared payload is missing");
  if (s(snap.code) === "200") return stepOk(entry, "C1_SNAPSHOT", s(snap.snapshot_id), "snapshot " + s(snap.snapshot_id));
  const why = "GD_COMPLETION_SNAPSHOT answered " + (s(snap.code) || "nothing") + (s(snap.message) ? ": " + s(snap.message) : "");
  if (entry.attempts >= MAX_RETRIES) return failNoWrite(entry, "GDC_SNAPSHOT_FAILED", why + " (after " + entry.attempts + " retries)");
  return stepEnd(entry, "C1_SNAPSHOT", why, false);
};
const snap = { code: [{{node:workflow_node_CCc1.data.code}}][0], message: [{{node:workflow_node_CCc1.data.message}}][0], snapshot_id: [{{node:workflow_node_CCc1.data.snapshot_id}}][0] };
const res = commitC1([{{node:code_node_CCentry.data}}][0], { ok: [{{node:code_node_CCc1in.data.ok}}][0] }, snap);
console.log("commit C1", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
