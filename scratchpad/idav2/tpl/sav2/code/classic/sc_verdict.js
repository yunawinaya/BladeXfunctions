// A Processing SA made from this Stock Count refuses EVERY save of it (web and mobile alike).
const scGuardRows = [{{node:sql_node_SCguard.data}}][0];
const scGuardOut = [{{node:code_node_SCguard.data}}][0] || {};
let busy = false;
try {
  const rows = Array.isArray(scGuardRows) ? scGuardRows : scGuardRows && typeof scGuardRows === "object" ? [scGuardRows] : [];
  busy = rows.some((r) => r && typeof r === "object" && Number(r.busy_count) > 0);
} catch (e) {
  busy = false;
}
const reason = busy ? "SA_SC_BUSY" : String(scGuardOut.reason || "");
const message = busy ? "A Stock Adjustment from this Stock Count is being processed in the background - please wait for it to finish." : String(scGuardOut.message || "");
return { refuse: reason && message ? "YES" : "NO", reason: reason, message: message };
