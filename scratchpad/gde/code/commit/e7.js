// GD_EDIT_COMMIT - E7 AFTER (the GD is already unlocked): REORDER_SET_REDIS GD_CREATED at most once (its marker E7_REORDER
// is written before the call, as GD Completed V2's C6 does), the items' last_transaction_date (code_node_62FzZA2e), then the
// job COMPLETED with the notes the form shows (pickingReversalNote)
const commitE7Plan = function commitE7Plan(entry, after, doneReorder) {
  const ids = ((after || {}).item_ids || []).filter((x) => digits(x));
  const reorder = (after || {}).reorder;
  const needReorder = reorder && (reorder.deltas || []).length && doneReorder !== "YES";
  return {
    needReorder: needReorder ? "YES" : "NO",
    markerRows: needReorder ? [doneRow(entry, "E7_REORDER", (reorder.deltas || []).length + " delta(s)")] : [],
    previous: reorder ? reorder.previous : null, latest: reorder ? reorder.latest : [],
    // the time of the save as ISO, as code_node_62FzZA2e (and GD Completed V2's C6) write it
    itemSlices: slicesOf(ids.map((id) => ({ id: id, last_transaction_date: new Date().toISOString() })), 250), itemCount: ids.length,
  };
};
const commitFinish = function commitFinish(entry, manifest) {
  const notes = (manifest || {}).notes || {};
  const message = "Goods Delivery " + s(entry.gdNo) + " saved" + (s(notes.pickingReversalNote) ? ". " + s(notes.pickingReversalNote) : "");
  return {
    stepRows: [doneRow(entry, "E7_AFTER", "")],
    jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: endNow(entry) })],
    result_message: message,
  };
};
