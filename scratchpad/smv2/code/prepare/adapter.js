// LOT_V2_PREPARE - SQL rows (prepare/sql.py) -> the shapes the classic's read nodes handed its code nodes (CONTRACT.md section 9):
//   lotAdaptDoc     the stored document as the CLIENT tree: header + stock_movement in line_index order, bundle children under their
//                   parent's `children` (parent_id = the parent row's id); every row an fm_key (its id, as the form keys a loaded row),
//                   every child parent_fm_key = its parent's fm_key (stored rows carry neither, and yPlLXIZW / LOTallocPrep take a row
//                   with item_bundle_id and no parent_fm_key for a bundle parent); bigint ids digit strings, decimals numbers,
//                   null / "" columns absent; stock_movement_status = the job's prevStatus (NEVER Processing: it turns STAGE into
//                   DIRECT and skips the reconcile)
//   lotAdaptLedger  search-node in_transit_detail rows: decimals and line_no numbers, ids exact strings, null / "" keys absent
//   lotAdaptItems   search-node Item rows (id, material_code, material_name, material_desc)
//   lotAllocAdapt   the auto allocation's reads (aitem / abal) -> geGlobalAllocation's A: balance search records (null / "" keys
//                   dropped), Get Item sql-node rows ("" kept)
const lotDrop = (o) => {
  const r = {};
  for (const k of Object.keys(o || {})) {
    const v = o[k];
    if (v === null || v === undefined || v === "") continue;
    r[k] = v;
  }
  return r;
};
const lotAdaptDoc = function lotAdaptDoc(hdrRow, lineRows, prevStatus) {
  const h = lotDrop(hdrRow);
  delete h.lot_v2_job_id;
  h.stock_movement_status = prevStatus;
  const lines = lotList(lineRows).map(lotDrop);
  const byId = {};
  for (const l of lines) {
    if (!lotS(l.fm_key)) l.fm_key = lotS(l.id);
    byId[lotS(l.id)] = l;
  }
  const top = [];
  for (const l of lines) {
    const p = l.parent_id ? byId[lotS(l.parent_id)] : null;
    if (p && p !== l) {
      l.parent_fm_key = p.fm_key;
      (p.children = p.children || []).push(l);
    } else top.push(l);
  }
  h.stock_movement = top;
  return h;
};
const LOT_IT_NUM = ["transit_qty", "received_qty", "open_qty", "line_no"];
const lotAdaptLedger = (rows) => lotList(rows).map((r) => {
  const o = lotDrop(r);
  for (const k of LOT_IT_NUM) if (o[k] !== undefined) o[k] = Number(o[k]);
  return o;
});
const lotAdaptItems = (rows) => lotList(rows).map(lotDrop);
const lotAllocAdapt = function lotAllocAdapt(S) {
  const noNull = (o) => {
    const r = {};
    for (const k of Object.keys(o || {})) if (o[k] !== null && o[k] !== undefined) r[k] = o[k];
    return r;
  };
  const bal = { IB: [], IBB: [] };
  for (const r of lotList(S.abal)) {
    const o = r && typeof r.j === "string" ? lotParseJ(r.j) : r && r.j;
    if (o && typeof o === "object" && bal[lotS(r.k)]) bal[lotS(r.k)].push(lotDrop(o));
  }
  return { items: lotRows(S.aitem).map(noNull), itemBalances: bal.IB, batchBalances: bal.IBB, pending: [], huAllocated: [], ownReserved: [] };
};
