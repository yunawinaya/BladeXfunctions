// Twin attempts with one key both added a GR: the oldest wins, this one is removed before it reserves anything
const rows = [{{node:sql_node_GcKeyDup.data}}][0] || [];
const list = Array.isArray(rows) ? rows : [rows];
const markOf = String([{{node:code_node_GcPrep.data.keyStore}}][0] || "");
const mine = list.find((r) => String(r.gr_idem_key || "") === markOf) || null;
const first = list[0] || null;
const lose = Boolean(mine && first) && String(first.id) !== String(mine.id);
const no = first ? String(first.gr_no || "") : "";
return {
  lose: lose ? "YES" : "NO",
  mine: lose ? String(mine.id) : "0",
  myId: mine ? String(mine.id) : "",
  winnerId: first ? String(first.id) : "",
  winnerNo: no,
  message: "Goods Receiving " + no + " was already saved as Created.",
};
