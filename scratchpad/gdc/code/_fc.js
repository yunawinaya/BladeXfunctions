// Force Complete's Picking rules, verbatim from GOODS_DELIVERY v245 code_node_FcPlan (SUBMIT, C0 and C4P embed them): rows =
// every row of each open Picking that still holds an open row of this GD (sql_node_FcPick). Busy = a device holds the
// Picking (is_processing 1, the lock no older than 900 s; a missing age counts as held) or a Picking V2 confirm is open.
// Close = this GD's open rows of the Pickings no one holds; a Picking header only when every row is this GD's or done.
const fcBusy = (r) => {
  const age = Number(r.lock_age_sec);
  return (Number(r.is_processing) === 1 && !(isFinite(age) && age > 900)) || Number(r.open_jobs) > 0;
};
const fcPlan = function fcPlan(rows, gdId) {
  const done = (r) => r.line_status === "Completed" || r.line_status === "Cancelled";
  const byPicking = {};
  for (const r of rows) (byPicking[r.picking_id] = byPicking[r.picking_id] || []).push(r);
  const busyNos = [];
  const lineIds = [];
  const pickingIds = [];
  for (const pickingId of Object.keys(byPicking)) {
    const pickingRows = byPicking[pickingId];
    if (fcBusy(pickingRows[0])) { busyNos.push(pickingRows[0].picking_no || pickingId); continue; }
    for (const r of pickingRows) if (r.gd_id === gdId && !done(r)) lineIds.push(r.id);
    if (pickingRows.every((r) => r.gd_id === gdId || done(r))) pickingIds.push(pickingId);
  }
  return { busyNos: busyNos, lineIds: lineIds, pickingIds: pickingIds,
    busyMessage: "Picking " + busyNos.join(", ") + " is being processed on a device right now. Try again in a moment." };
};
