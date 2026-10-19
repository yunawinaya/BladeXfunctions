// A recorded classic IA_REVERT run's READS (the platform's node outputs) -> the rows Revert V2's own SQL returns for the same
// data (revert/sql.py + code/shared/sql.py shapes: JSON_OBJECT `j` rows with ids as text, the classic's sql-node rows as they
// are), presented as locked by a test job (Processing under JOB / KEY). Used by adapter_vs_recorded.js and the interpreter sims.
const JOB = "2112900000000000001";
const KEY = "IAV:TEST:KEY:0001";
const NONCE = "Ab12Cd34";
const resp = (r, id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : null);
const rowsOf = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.data) ? v.data : []);
const J = (o) => ({ j: JSON.stringify(o) });
const pickCols = (row, cols) => {
  const o = {};
  for (const c of cols) o[c] = row[c] === undefined ? null : row[c];
  return o;
};
const idText = (v) => (v === undefined || v === null || v === "" ? null : String(v));

// the IA record as FP_HEADER selects it (status as given: the test job holds it -> Processing)
function headerRow(rec, status) {
  return {
    id: idText(rec.id), item_id: idText(rec.item_id), item_qty: rec.item_qty === undefined ? null : rec.item_qty, item_uom: idText(rec.item_uom), location_id: idText(rec.location_id),
    inventory_category: rec.inventory_category === undefined ? null : rec.inventory_category, batch_no: rec.batch_no === undefined ? null : rec.batch_no,
    issuing_operation_faci: idText(rec.issuing_operation_faci), organization_id: rec.organization_id === undefined ? null : String(rec.organization_id),
    stock_movement_no: rec.stock_movement_no === undefined ? null : rec.stock_movement_no, stock_movement_no_type: idText(rec.stock_movement_no_type),
    item_assembly_status: status, posted_status: rec.posted_status === undefined ? null : rec.posted_status, table_hu: null, item_assembly_date: null, manufacturing_date: null,
    expired_date: null, remarks: null, remarks_2: null, remarks_3: null, ia_v2_job_id: status === "Processing" ? JOB : null,
  };
}
const ITEM_COLS = ["material_code", "material_name", "stock_control", "show_delivery", "serial_number_management", "item_batch_management", "batch_number_genaration",
  "material_costing_method", "purchase_unit_price", "assembly_cost"];
function itemRow(it) {
  const o = { id: idText(it.id) };
  for (const c of ITEM_COLS) o[c] = it[c] === undefined ? null : it[c];
  o.purchase_unit_price = o.purchase_unit_price === null ? null : String(o.purchase_unit_price);
  o.assembly_cost = o.assembly_cost === null ? null : String(o.assembly_cost);
  o.based_uom = idText(it.based_uom);
  o.table_uom_conversion = (Array.isArray(it.table_uom_conversion) ? it.table_uom_conversion : []).map((u) => ({ alt_uom_id: idText(u.alt_uom_id), base_qty: u.base_qty }));
  return o;
}
const BAL_COLS = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const balRow = (b, batch) => Object.assign({ id: idText(b.id), material_id: idText(b.material_id), location_id: idText(b.location_id) }, batch ? { batch_id: idText(b.batch_id) } : {},
  { plant_id: idText(b.plant_id), organization_id: b.organization_id === undefined ? null : String(b.organization_id) }, pickCols(b, BAL_COLS));

// S = every read of IA_REVERT_V2_PREPARE (round 1 + 2) for this run; the SUBMIT reads are S.hdr (stored status), S.moves, S.batch
function rowsFor(r, opts) {
  const o = opts || {};
  const get = resp(r, "get_node_iaRvIa");
  const rec = get && get.data && get.data.id ? get.data : null;
  const moves = rowsOf(resp(r, "sql_node_iaRvMovs"));
  const status = o.status || "Processing";
  const prep = resp(r, "code_node_iaRvPrep") || {};
  const bins = {};
  for (const m of (prep.liveOut || []).concat(prep.liveIn || [])) if (m.bin_location_id) bins[String(m.bin_location_id)] = 1;
  const S = {
    own: rec ? [{ db_now: "2026-10-19 12:00:00", ia_id: idText(rec.id), item_assembly_status: status, ia_v2_job_id: status === "Processing" ? JOB : null,
      stock_movement_no: rec.stock_movement_no, lock_ref: status === "Processing" ? KEY : null, lock_step: "LOCK|1" }] : [],
    hdr: rec ? [J(headerRow(rec, status))] : [],
    storedHdr: rec ? [J(headerRow(rec, rec.item_assembly_status))] : [],
    moves: moves.map((m) => Object.assign({}, m)),
    batch: rowsOf(resp(r, "search_node_iaRvBatch")).map((b) => J({ id: idText(b.id), batch_number: b.batch_number === undefined ? null : b.batch_number, material_id: idText(b.material_id),
      plant_id: idText(b.plant_id), organization_id: b.organization_id === undefined ? null : String(b.organization_id), transaction_no: b.transaction_no === undefined ? null : b.transaction_no })),
    fifo: rowsOf(resp(r, "sql_node_iaRvFifo")).map((x) => Object.assign({}, x)),
    wa: rowsOf(resp(r, "sql_node_iaRvWa")).map((x) => Object.assign({}, x)),
    costcounts: rowsOf(resp(r, "sql_node_iaRvCostCounts")).map((x) => Object.assign({}, x)),
    itemBal: rowsOf(resp(r, "search_node_iaRvItemBal")).map((b) => J(balRow(b, false))),
    batchBal: rowsOf(resp(r, "search_node_iaRvBatchBal")).map((b) => J(balRow(b, true))),
    items: rowsOf(resp(r, "search_node_iaRvItems")).map((it) => J(itemRow(it))),
    bins: Object.keys(bins).sort().map((id) => J({ id: id, bin_location_combine: "BIN-" + id.slice(-4) })),
    serial: [],
  };
  return S;
}

function entryFor(r, S, fp, extra) {
  const p = r.params || {};
  return Object.assign({ route: "GO", jobId: JOB, tenantId: String(r.tenant), organizationId: String(p.organization_id || ""), iaId: String(p.ia_id), idempotencyKey: KEY, rowVersion: 3,
    dbNow: "2026-10-19 12:00:00", jsAt: String(Date.now()), nonce: NONCE,
    request: { v: 1, action: "REVERT", prevStatus: "Completed", iaId: String(p.ia_id), iaNo: String(p.ia_no || ""), movesFingerprint: fp }, prevStatus: "Completed", result_code: "",
    result_message: "" }, extra || {});
}

module.exports = { JOB, KEY, NONCE, resp, rowsOf, rowsFor, entryFor, headerRow, itemRow, balRow };
