// A GD line may not be on Pickings for more than its quantity: what other live Pickings already hold (sql_node_Cover:
// open ones their qty_to_pick, Completed ones what they picked, as Convert to Picking counts it) + what this call adds.
// Over -> the whole call is refused before any Picking is written.
const raw = {{node:sql_node_Cover.data}};
const mine = {{node:code_node_CoverIds.data.mine}} || {};
const EPS = 1e-6;
const num = (v) => parseFloat(v) || 0;
const over = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((r) => {
  if (!r || !r.gd_line_id) return false;
  const m = num(mine[String(r.gd_line_id)]);
  const covered = num(r.covered);
  return m > EPS && covered > EPS && covered + m > num(r.gd_qty) + EPS;
});
if (!over.length) return { over: 0, message: "" };
const fmt = (v) => String(Number(num(v).toFixed(8)));
const named = over.slice(0, 3).map((r) => (r.delivery_no || "Goods Delivery") + " " + (r.item_name || "line") + ": " + fmt(r.covered) + " of " + fmt(r.gd_qty) + " already on " + (r.pickings || "another Picking"));
return {
  over: 1,
  message: "Picking not saved: these Goods Delivery lines are already on another Picking. " + named.join("; ") + (over.length > 3 ? "; and " + (over.length - 3) + " more" : "") + ". Refresh the list and convert only what is left.",
};
