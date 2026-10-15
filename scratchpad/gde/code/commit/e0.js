// GD_EDIT_COMMIT - E0 REVALIDATE (nothing written yet): the GD is Processing under this job's lock; every reservation the plan
// updates, every line it patches or removes still holds what PREPARE read; the Picking is still ours at the version SUBMIT
// locked (UPDATE) or still absent (CREATE); the sales orders still accept the edit (code_node_QtyCheckBatch on a fresh read).
// Else FAILED: the GD back to its stored status, our Picking lock released.
const GE_RES_COLS_E0 = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const commitE0 = function commitE0(entry, parts, resRows, lineRows, pickRows, soLines, soHeaders) {
  if (entry.unlockOk !== "YES") return failNoWrite(entry, "GDE_NOT_LOCKED", "the Goods Delivery is no longer Processing under this job's lock");
  const RES = parts.RES, GDL = parts.GDL, PICK = parts.PICK, SO = parts.SO;
  if (!RES || !GDL || !PICK || !SO) return failNoWrite(entry, "GDE_INVALID_DATA", "a part of the prepared payload is missing");
  const byId = (rows) => { const o = {}; for (const r of list(rows)) { const x = typeof r.j === "string" ? parseJ(r.j) : r; if (x && x.id !== undefined) o[s(x.id)] = x; } return o; };
  const res = byId(resRows), lines = byId(lineRows);
  const stale = [];
  for (const u of RES.updates || []) {
    const cur = res[s(u.id)];
    if (!cur || String(cur.is_deleted) !== "0" || GE_RES_COLS_E0.some((c) => !sameVal(cur[c], u.before[c]))) stale.push("reservation " + s(u.id));
  }
  for (const p of GDL.patches || []) {
    const cur = lines[s(p.id)];
    if (!cur || String(cur.is_deleted) !== "0" || Object.keys(p.before).some((c) => !sameVal(cur[c], p.before[c]))) stale.push("line " + s(p.id));
  }
  for (const id of GDL.deletes || []) { const cur = lines[s(id)]; if (!cur || String(cur.is_deleted) !== "0") stale.push("line " + s(id) + " (gone)"); }
  if (stale.length) return failNoWrite(entry, "GDE_STALE", stale.length + " row(s) changed since the edit was prepared (e.g. " + stale.slice(0, 3).join(", ") + "): nothing was written");
  const live = list(pickRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r)).filter((p) => p && String(p.is_deleted || 0) === "0" && p.to_status !== "Draft" && p.to_status !== "Cancelled");
  if (PICK.mode === "UPDATE" && entry.pickUnlockOk !== "YES") return failNoWrite(entry, "GDE_PICKING_CHANGED", "the Picking was changed or its lock released since the edit was prepared: nothing was written");
  if (PICK.mode === "CREATE" && live.length) return failNoWrite(entry, "GDE_PICKING_CHANGED", "a Picking was created for the delivery meanwhile (" + live.map((p) => s(p.to_id)).join(", ") + "): nothing was written");
  const so = geSoRun(SO, soLines, soHeaders);
  if (so.stop) return failNoWrite(entry, "GDE_SO_REFUSED", "the sales orders no longer accept the edit: " + so.stop);
  return stepOk(entry, "E0_REVALIDATE", (RES.updates || []).length + " reservation(s), " + (GDL.patches || []).length + " line patch(es), " + (GDL.deletes || []).length + " removal(s) unchanged", "revalidated");
};
