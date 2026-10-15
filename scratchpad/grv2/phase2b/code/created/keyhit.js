// A retried Add (same idempotency key): the GR the first attempt created is the answer; nothing is written again
const rows = [{{node:sql_node_GcKeyHit.data}}][0] || [];
const first = (Array.isArray(rows) ? rows : [rows])[0] || null;
const no = first ? String(first.gr_no || "") : "";
return {
  hit: first ? "YES" : "NO",
  id: first ? String(first.id) : "",
  grNo: no,
  message: "Goods Receiving " + no + " was already saved as Created.",
};
