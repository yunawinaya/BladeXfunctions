// The STORED status decides first: a Processing SA belongs to a background save (any classic save would overwrite it).
const saGuardRows = [{{node:sql_node_SAguard.data}}][0];
const saGuardOut = [{{node:code_node_SAguard.data}}][0] || {};
let busy = false;
try {
  const rows = Array.isArray(saGuardRows) ? saGuardRows : saGuardRows && typeof saGuardRows === "object" ? [saGuardRows] : [];
  busy = rows.some((r) => r && typeof r === "object" && String(r.stock_adjustment_status) === "Processing");
} catch (e) {
  busy = false;
}
const reason = busy ? "SA_BUSY" : String(saGuardOut.reason || "");
const message = busy ? "This Stock Adjustment is being processed in the background - please wait for it to finish." : String(saGuardOut.message || "");
return { refuse: reason && message ? "YES" : "NO", reason: reason, message: message };
