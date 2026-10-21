// IA_REVERT v6 - RES-01 R5: its holds must be closed before the revert (a completed IA's CLOSE delivered or released them all); one still
// open, a hold run in flight, or holds that could not be read -> refused, nothing written
const due = [{{node:code_node_RESrvDue.data.due}}][0] === "YES";
let st = null;
try {
  const raw = [{{node:sql_node_RESrvOwn.data}}][0];
  const r = (Array.isArray(raw) ? raw : raw ? [raw] : [])[0];
  st = r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null;
} catch (e) {
  st = null;
}
const open = due && (!st || Number(st.live) > 0 || (Array.isArray(st.rows) && st.rows.length > 0));
return { route: open ? "OPEN" : "GO",
  message: open ? "This Item Assembly still holds materials reserved for it: they are closed when it is opened. Open it once, then revert it." : "" };
