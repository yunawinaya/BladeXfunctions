// Edit: refused unless the STORED GR is Draft / Created; only a stored Created GR has a reservation to replace
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const roundQty = (v) => parseFloat(parseFloat(v || 0).toFixed(3));
const isEdit = String([{{node:code_node_GcPrep.data.check}}][0] || "") === "YES";
const rows = [{{node:sql_node_GcProcGuard.data}}][0] || [];
const list = Array.isArray(rows) ? rows : [rows];
const head = list[0] || null;
const status = head ? String(head.gr_status || "") : "";
let message = "";
if (isEdit && !head) {
  message = "Goods Receiving not found - it may already have been deleted.";
} else if (isEdit && status === "Processing") {
  message = "This Goods Receiving is being processed in the background - please wait for it to finish.";
} else if (isEdit && status !== "Draft" && status !== "Created") {
  message = "Goods Receiving " + String(head.gr_no || "") + " cannot be saved as Created: it is " + (status || "blank") + " now.";
}
let oldAgg = null;
if (isEdit && status === "Created") {
  oldAgg = {};
  for (const r of list) {
    if (!r.po_line_id) continue;
    oldAgg[String(r.po_line_id)] = { q3: roundQty(r.qty), q8: q8(r.qty) };
  }
}
// a rule-numbered Created GR keeps its stored number (a stale form must not re-issue it)
const noRule = String([{{node:code_node_GcPrep.data.noRule}}][0] || "") === "YES";
const clientNo = [{{node:code_node_GcPrep.data.clientGrNo}}][0];
let grNo = clientNo === undefined ? null : clientNo;
if (isEdit && noRule && head) grNo = status === "Created" ? (head.gr_no || clientNo || "issued") : "issued";
return { busy: message ? "YES" : "NO", message, storedStatus: status, oldAgg, grNo };
