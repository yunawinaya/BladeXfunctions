// The STORED status decides first: a Processing SA belongs to a background save (any classic save would overwrite it). Then the
// payload's own refusals; last, a lock key of this save's stock held by a background (engine) operation - the classic would write
// under that operation's feet (its absolute writes could undo ours, or ours its).
const saGuardRows = [{{node:sql_node_SAguard.data}}][0];
const saGuardOut = [{{node:code_node_SAguard.data}}][0] || {};
let busy = false;
let held = null;
try {
  const rows = Array.isArray(saGuardRows) ? saGuardRows : saGuardRows && typeof saGuardRows === "object" ? [saGuardRows] : [];
  busy = rows.some((r) => r && typeof r === "object" && String(r.stock_adjustment_status) === "Processing");
  held = rows.find((r) => r && typeof r === "object" && r.lock_key && r.owner_operation_id) || null;
} catch (e) {
  busy = false;
  held = null;
}
let reason = busy ? "SA_BUSY" : String(saGuardOut.reason || "");
let message = busy ? "This Stock Adjustment is being processed in the background - please wait for it to finish." : String(saGuardOut.message || "");
if (!reason && held) {
  reason = "SA_STOCK_LOCKED";
  message = "Some of this stock is being moved by another background operation (" + String(held.owner_operation_id) + "). Please try again in a minute.";
}
return { refuse: reason && message ? "YES" : "NO", reason: reason, message: message };
