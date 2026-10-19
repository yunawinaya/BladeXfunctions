// The STORED status decides (mobile saves send "In Progress" for a Processing transfer); a Cancel carries no lines, so its
// size is the stored line count
const rows = [{{node:sql_node_LOTguard.data}}][0];
const row = (Array.isArray(rows) ? rows[0] : rows) || {};
const g = [{{node:code_node_LOTguard.data}}][0] || {};
const saveAs = String(g.saveAs || "");
const stored = Number(row.line_count || 0);
const n = saveAs === "Cancelled" && row.line_count !== undefined && row.line_count !== null ? stored : Number(g.payloadLines || 0);
const big = saveAs !== "Draft" && n > 500;
return {
  busy: String(row.stock_movement_status || "") === "Processing" ? "YES" : "NO",
  big: big ? "YES" : "NO",
  lines: n,
  bigMessage: "This Location Transfer has " + n + " lines. A save of more than 500 lines is not supported here - please split it into smaller transfers.",
};
