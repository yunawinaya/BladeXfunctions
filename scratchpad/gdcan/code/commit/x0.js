// GD_CANCEL_COMMIT - X0 REVALIDATE: the GD is still Processing under this job's lock, every reservation the plan updates still
// holds what PREPARE read, no Picking it writes is held on a device or by an open Picking V2 confirm, no Packing it cancels is
// open on a phone, and every box it unpacks still holds exactly what PREPARE read -> DONE; else FAILED, the GD back to Created
// (nothing was written)
const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const cancelX0 = function cancelX0(entry, partRows, resRows, pickRows, packRows, boxRows) {
  if (entry.unlockOk !== "YES") return failNoWrite(entry, "GDX_NOT_LOCKED", "the Goods Delivery is no longer Processing under this job's lock");
  const res = joinChunks(partRows, entry.partPrefix + "RES|");
  const hu = joinChunks(partRows, entry.partPrefix + "HU|");
  if (!res || !Array.isArray(res.updates) || !hu || !Array.isArray(hu.boxes)) return failNoWrite(entry, "GDX_INVALID_DATA", "the prepared payload is missing a part");
  const now = {};
  for (const r of list(resRows)) {
    const o = parseJ(r.j);
    if (o && o.id) now[s(o.id)] = o;
  }
  const stale = [];
  for (const u of res.updates) {
    const cur = now[s(u.id)];
    if (!cur || String(cur.is_deleted) !== "0" || RES_COLS.some((c) => !sameVal(cur[c], u.before[c]))) stale.push(s(u.id));
  }
  if (stale.length) return failNoWrite(entry, "GDX_STALE", stale.length + " reservation(s) changed since the cancel was prepared (e.g. " + stale.slice(0, 3).join(", ") + "): nothing was written");
  const busy = list(pickRows).filter((r) => fcBusy(r)).map((r) => s(r.to_id) || s(r.id));
  if (busy.length) return failNoWrite(entry, "GDX_BUSY", "Picking " + busy.join(", ") + " is being processed on a device right now. Cancel the delivery again in a moment.");
  const leased = list(packRows).filter((r) => s(r.lock_session) && s(r.lock_live) === "1").map((r) => s(r.packing_no) + (s(r.lock_user) ? " (open on mobile by " + s(r.lock_user) + ")" : ""));
  if (leased.length) return failNoWrite(entry, "GDX_BUSY", "Packing " + leased.join(", ") + " is open right now. Cancel the delivery again once it is closed.");
  // a box: the items it held at PREPARE (its unload request) must be what it holds now
  const held = {};
  for (const r of list(boxRows)) (held[s(r.handling_unit_id)] = held[s(r.handling_unit_id)] || []).push(r);
  const key = (i) => [s(i.material_id), s(i.balance_id), s(i.batch_id), q8(i.quantity).toFixed(8)].join("|");
  const changed = [];
  for (const b of hu.boxes) {
    const was = ((b.request || {}).items || []).map(key).sort().join(",");
    const is = (held[s(b.hu_id)] || []).map(key).sort().join(",");
    if (was !== is) changed.push(s(b.handling_no) || s(b.hu_id));
  }
  if (changed.length) return failNoWrite(entry, "GDX_STALE", "box(es) " + changed.slice(0, 3).join(", ") + " changed since the cancel was prepared: nothing was written");
  return stepOk(entry, "X0_REVALIDATE", res.updates.length + " reservation(s) unchanged, " + hu.boxes.length + " box(es) unchanged", "revalidated");
};
const res = cancelX0([{{node:code_node_XCentry.data}}][0], [{{node:sql_node_XCx0parts.data}}][0], [{{node:sql_node_XCx0rows.data}}][0], [{{node:sql_node_XCx0pick.data}}][0],
  [{{node:sql_node_XCx0pack.data}}][0], [{{node:sql_node_XCx0box.data}}][0]);
console.log("commit X0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
