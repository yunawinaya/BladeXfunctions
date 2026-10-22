// IA_SAVE - RES-01 R4: an IA that reserves completes from its holds (resSplitLines, res01/code/shared/split.js): the loops read these
// lines; the saved lines keep the picks as made. A reservation still running -> 409, nothing written yet. Not due -> the lines as sent
const due = [{{node:code_node_RESdue.data.due}}][0] === "YES";
const all = [{{node:code_fillback.data.allData}}][0] || {};
const lines = Array.isArray(all.stock_movement) ? all.stock_movement : [];
// MIN-01 (BA 10-22, with bladexfunctions-9d): Reserved stock is never picked by hand - it belongs to another document's reservation; only
// this split's held parts (made below, server-side) come from Reserved. Every completion, reserving or not
const pickedReserved = lines.some((l) => {
  let picks = [];
  try {
    const x = typeof (l && l.temp_qty_data) === "string" ? JSON.parse(l.temp_qty_data || "[]") : (l && l.temp_qty_data) || [];
    picks = Array.isArray(x) ? x : [];
  } catch (e) {
    picks = [];
  }
  return picks.some((p) => p && String(p.category || "") === "Reserved" && parseFloat(p.sm_quantity) > 0);
});
if (pickedReserved) {
  return { route: "STOP", message: "A component is picked from Reserved stock, which belongs to another document's reservation: pick it from Unrestricted or Blocked stock instead.",
    lines: [] };
}
if (!due) return { route: "GO", message: "", lines: lines };
let st = null;
try {
  const raw = [{{node:sql_node_RESown.data}}][0];
  const r = (Array.isArray(raw) ? raw : raw ? [raw] : [])[0];
  st = r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null;
} catch (e) {
  st = null;
}
const split = resSplitLines(lines, st, [{{node:search_items.data.data}}][0] || []);
console.log("res split", JSON.stringify({ busy: split.busy, lines: split.lines.length }));
return split.busy ? { route: "BUSY", message: "The materials of this Item Assembly are being reserved right now: try again in a moment.", lines: [] }
  : { route: "GO", message: "", lines: split.lines };
