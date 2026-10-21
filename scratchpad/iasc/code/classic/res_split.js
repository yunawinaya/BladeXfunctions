// IA_SAVE - RES-01 R4: an IA that reserves completes from its holds (resSplitLines, res01/code/shared/split.js): the loops read these
// lines; the saved lines keep the picks as made. A reservation still running -> 409, nothing written yet. Not due -> the lines as sent
const due = [{{node:code_node_RESdue.data.due}}][0] === "YES";
const all = [{{node:code_fillback.data.allData}}][0] || {};
const lines = Array.isArray(all.stock_movement) ? all.stock_movement : [];
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
