// GD_CANCEL_COMMIT - X7 AFTER: Item last_transaction_date (code_node_62FzZA2e: the materials of the lines, the time of the save as
// ISO) and REORDER_SET_REDIS GD_CANCELLED with the stored lines as previous_data (if_ReorderCancelled; organization_id passed: a
// background run has no session organization) - the call at most once (its marker row is written before it); then FINISH
const cancelX7Plan = function cancelX7Plan(entry, partRows) {
  const after = joinChunks(partRows, entry.partPrefix + "AFTER|");
  if (!after) return { route: "END", itemSlices: [], reorderRows: [], needReorder: "NO", reorderPrevious: [], jobRows: stepEnd(entry, "X7_AFTER", "the after part of the prepared payload is missing", true).jobRows, needJobUpd: "YES" };
  const date = new Date().toISOString();
  const items = (after.item_dates || []).filter(digits).map((id) => ({ id: id, last_transaction_date: date }));
  const reorder = after.reorder && entry.doneX7Reorder !== "YES" ? after.reorder : null;
  return { route: "GO", itemSlices: slicesOf(items, 250), reorderRows: reorder ? [doneRow(entry, "X7_REORDER", "called")] : [], needReorder: reorder ? "YES" : "NO",
    reorderPrevious: reorder ? reorder.previous || [] : [], jobRows: [], needJobUpd: "NO" };
};
// the job COMPLETED, its message naming what the cancel left in place (the user's decisions, 10-20)
const cancelFinish = function cancelFinish(entry) {
  const m = entry.manifest || {};
  const n = m.notes || {};
  const parts = ["Goods Delivery " + s(entry.newNo || m.new_no) + " cancelled"];
  const left = (n.pickings_completed || []).map((x) => "Picking " + x).concat((n.packings_completed || []).map((x) => "Packing " + x));
  if (left.length) parts.push("left as they are (Completed): " + left.join(", "));
  if ((n.packings_cancelled || []).length) parts.push("Packing cancelled: " + n.packings_cancelled.join(", "));
  if ((n.boxes_unpacked || []).length) parts.push("unpacked: " + n.boxes_unpacked.join(", "));
  if ((n.boxes_with_stock_left || []).length) parts.push("boxes still holding stock: " + n.boxes_with_stock_left.join(", "));
  const message = parts.join("; ");
  return {
    stepRows: [doneRow(entry, "X7_AFTER", "done")],
    jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), error_details: message.length > 250 ? JSON.stringify({ notes: n }) : null,
      finished_at: endNow(entry) })],
    result_message: message,
  };
};
