// GD Edit V2 - GD_EDIT_PREPARE's SQL rows (prepare/sql.py) -> the reads the chain and the planner take, in the platform's
// shapes: gdc's gcAdapt for the GD, setups, linkage, items, SO and reservations (unchanged), plus the GD's Picking (the one
// live Picking naming it, as get_pick_for_reconcile returns it: header + both subforms), the live Pickings
// (search_node_NBAQ9gsj), the bins (search_bin_names), the Picking serial rule (get_node_zna6o03F) and the lock.
// Searches are supersets: chain_edit.js filters each by the ids its node searches on.
// the auto allocation's reads (prepare/sql.py aitem / abal / ares / aref) -> alloc_edit.js's A: search records, except
// GLOBAL_ALLOCATION's Get Item (an sql-node row: "" kept)
const geAllocAdapt = function geAllocAdapt(S) {
  const kinds = (rows) => { const o = {}; for (const r of gcRows(rows)) (o[r.k] = o[r.k] || []).push(gcObj(r)); return o; };
  const bal = kinds(S.abal), res = kinds(S.ares), ref = kinds(S.aref);
  // a HU search record carries its items nested (table_hu_items, subform shape)
  const hus = (ref.H || []).map((h) => Object.assign({}, h, { table_hu_items: (ref.HI || []).filter((i) => i.handling_unit_id === h.id).map((i) => gcNestedRow(i, "handling_unit_id")) }));
  return { items: gcRows(S.aitem).map((r) => gcStripNull(gcParse(r.j))), itemBalances: bal.IB || [], batchBalances: bal.IBB || [], pending: res.P || [],
    huAllocated: res.H || [], ownReserved: res.O || [], uoms: ref.U || [], bins: ref.B || [], huItems: ref.HI || [], hus: hus, batches: ref.BT || [] };
};
const geAdapt = function geAdapt(S) {
  const base = gcAdapt(Object.assign({}, S, { top: [], topr: [] }));
  const obj = (rows) => gcRows(rows).map(gcObj);
  const stored = base.gd.count ? base.gd.data : null;
  // every Picking that names the GD; the live ones (not Draft / Cancelled) are what the classic save's reads see
  const all = obj(S.pick);
  const live = all.filter((p) => String(p.is_deleted || 0) === "0" && p.to_status !== "Draft" && p.to_status !== "Cancelled");
  const items = obj(S.picki), recs = obj(S.pickr);
  let pick = { count: 0, data: {} };
  if (live.length === 1) {
    const p = Object.assign({}, live[0]);
    p.table_picking_items = gcTree(items.filter((r) => r.transfer_order_id === p.id), "transfer_order_id");
    p.table_picking_records = recs.filter((r) => r.transfer_order_id === p.id).map((r) => gcNestedRow(r, "transfer_order_id"));
    pick = gcGet(p);
  }
  // search_node_NBAQ9gsj: gd_no in the GD, to_status not Completed (its node keeps Draft / Cancelled; the code drops them)
  const notCompleted = all.filter((p) => String(p.is_deleted || 0) === "0" && p.to_status !== "Completed");
  const lock = gcRows(S.lock)[0] || (Array.isArray(S.lock) ? S.lock[0] : null) || {};
  const sohl = obj(S.sohl);
  return Object.assign(base, {
    stored: stored,
    pick: pick,
    livePickings: live.map((p) => ({ id: p.id, to_id: p.to_id, to_status: p.to_status, is_processing: p.is_processing, update_time: p.update_time })),
    activePickings: gcSearch(notCompleted),
    binNames: gcSearch(obj(S.bins)),
    pickingFormat: gcGet(obj(S.pfmt)[0] || null),
    // supersets (chain_edit.js filters them as search_node_SOLine8kQ2 / search_node_DnZIKKVH do)
    soLines: gcSearch(sohl),
    cleanupSoLines: gcSearch(sohl),
    lock: { step_name: lock.step_name || "", result_ref: lock.result_ref || "" },
    alloc: geAllocAdapt(S),
  });
};
