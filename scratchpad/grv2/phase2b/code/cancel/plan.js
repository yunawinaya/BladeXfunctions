// Release per PO line from the stored GR lines (8 dp, >= 0); the suffix goes on the STORED number
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const rows = [{{node:sql_node_CcLines.data}}][0] || [];
const heads = [{{node:sql_node_CcGuard.data}}][0] || [];
const SLICE = 250;
const ok = (v) => /^[0-9]{1,20}$/.test(v);
const releases = [];
const poIds = new Set();
for (const r of Array.isArray(rows) ? rows : [rows]) {
  const po = String(r.po_id || "");
  if (ok(po)) poIds.add(po);
  const rev = q8(r.rev);
  if (!(rev > 0)) continue;
  const cur = parseFloat(r.created_received_qty || 0);
  releases.push({ id: String(r.id), created_received_qty: Math.max(0, q8(cur - rev)).toFixed(8) });
}
const slices = [];
for (let i = 0; i < releases.length; i += SLICE) slices.push({ n: slices.length + 1, rows: releases.slice(i, i + SLICE) });
const grStamps = [];
for (const h of Array.isArray(heads) ? heads : [heads]) {
  if (!h || !ok(String(h.id || ""))) continue;
  const no = String(h.gr_no || "");
  grStamps.push({ id: String(h.id), gr_no: no.endsWith("-Cancelled") ? no : no + "-Cancelled" });
}
return {
  grStamps,
  hasLines: releases.length > 0 ? "YES" : "NO",
  slices,
  releaseCount: releases.length,
  poCsv: [...poIds].join(",") || "0",
};
