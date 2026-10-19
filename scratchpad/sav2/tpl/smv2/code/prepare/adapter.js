// LOT_V2_PREPARE - SQL rows (prepare/sql.py) -> the shapes the classic's read nodes handed its code nodes (CONTRACT.md section 9):
//   lotAdaptDoc     the get-node document: header + stock_movement nested in line_index order (bundle children under `children`);
//                   bigint ids digit strings, decimals numbers, null / "" columns absent; stock_movement_status = the job's prevStatus
//                   (NEVER Processing: it turns STAGE into DIRECT and skips the reconcile)
//   lotAdaptLedger  search-node in_transit_detail rows: decimals and line_no numbers, ids exact strings, null / "" keys absent
//   lotAdaptItems   search-node Item rows (id, material_code, material_name, material_desc)
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
  for (const l of lines) byId[lotS(l.id)] = l;
  const top = [];
  for (const l of lines) {
    const p = l.parent_id ? byId[lotS(l.parent_id)] : null;
    if (p && p !== l) (p.children = p.children || []).push(l);
    else top.push(l);
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
