// GD_COMPLETE_COMMIT - C0 REVALIDATE: the GD is still Processing under this job's lock, every reservation the plan updates
// still holds what PREPARE read, and the handling units it delivers from still hold enough -> DONE; else FAILED, the GD back
// to Created (nothing was written; the classic save fails at its HU node after the stock moved)
const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const commitC0 = function commitC0(entry, partRows, rowRows, huPartRows, huRows, itemRows) {
  if (entry.unlockOk !== "YES") return failNoWrite(entry, "GDC_NOT_LOCKED", "the Goods Delivery is no longer Processing under this job's lock");
  const res = joinChunks(partRows, entry.partPrefix + "RES|");
  if (!res || !Array.isArray(res.updates)) return failNoWrite(entry, "GDC_INVALID_DATA", "the reservation part of the prepared payload is missing");
  const hu = joinChunks(huPartRows, entry.partPrefix + "HU|");
  if (!Array.isArray(hu)) return failNoWrite(entry, "GDC_INVALID_DATA", "the handling-unit part of the prepared payload is missing");
  const now = {};
  for (const r of list(rowRows)) {
    const o = parseJ(r.j);
    if (o && o.id) now[s(o.id)] = o;
  }
  const stale = [];
  for (const u of res.updates) {
    const cur = now[s(u.id)];
    if (!cur || String(cur.is_deleted) !== "0" || RES_COLS.some((c) => !sameVal(cur[c], u.before[c]))) stale.push(s(u.id));
  }
  if (stale.length) return failNoWrite(entry, "GDC_STALE", stale.length + " reservation(s) changed since the completion was prepared (e.g. " + stale.slice(0, 3).join(", ") + "): nothing was written");
  const short = huReplay(hu, huParse(huRows), huParse(itemRows), null).short;
  if (short.length) return failNoWrite(entry, "GDC_HU_SHORT", "the handling units cannot give what is delivered (" + short.slice(0, 3).join("; ") + (short.length > 3 ? "; ..." : "") + "): nothing was written");
  return stepOk(entry, "C0_REVALIDATE", res.updates.length + " reservation(s) unchanged, " + hu.length + " handling-unit draw(s) covered", "revalidated");
};
const res = commitC0([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc0part.data}}][0], [{{node:sql_node_CCc0rows.data}}][0],
  [{{node:sql_node_CCc0hupart.data}}][0], [{{node:sql_node_CCc0hus.data}}][0], [{{node:sql_node_CCc0huitems.data}}][0]);
console.log("commit C0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
