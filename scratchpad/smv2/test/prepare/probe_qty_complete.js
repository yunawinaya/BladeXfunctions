// V2.1 M2 probe (synthetic, read-only): the BUILT LOT_V2_PREPARE plan node on a DIRECT bundle whose children are unpicked. GLOBAL_ALLOCATION
// places nothing for a stock_control 0 item with no stock (a 206, not a 400), so its child is still empty after the allocation:
// code_node_LOTqtyComplete must refuse it as the classic does (FAILED LOT_LINES_WITHOUT_STOCK, its incompleteMessage, unlock).
// The control run gives that item stock and must be READY.
// usage: TZ=Asia/Kuala_Lumpur node probe_qty_complete.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");
const BUILT = path.join(__dirname, "..", "..", "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_PREPARE.json");
let planSrc = null;
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.id === "code_node_LPplan") planSrc = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(BUILT, "utf8")));
const J = (o) => JSON.stringify(o);
const LOT = "9100000000000000001", JOB = "9100000000000000002", KEY = "LOT:K:1", ORG = "1123598813738675201", P = "1123598813738675202";
const D = "9300000000000000001", A = "9300000000000000002", PR = "9400000000000000001", C1 = "9400000000000000002", C2 = "9400000000000000003";
const M1 = "9500000000000000001", M2 = "9500000000000000002", UOM = "1940", BUN = "2089258885490675714";
const lines = [
  { id: PR, line_index: "1", item_selection: null, item_name: "BUNDLE", total_quantity: "1.00000000", parent_id: null, item_bundle_id: BUN, requested_qty: "0.00000000", organization_id: ORG },
  { id: C1, line_index: "2", item_selection: M1, item_name: "C1", quantity_uom: UOM, location_id: D, temp_qty_data: "", total_quantity: "0.00000000", parent_id: PR, item_bundle_id: BUN,
    requested_qty: "3.00000000", organization_id: ORG },
  { id: C2, line_index: "3", item_selection: M2, item_name: "C2", quantity_uom: UOM, location_id: D, temp_qty_data: "", total_quantity: "0.00000000", parent_id: PR, item_bundle_id: BUN,
    requested_qty: "2.00000000", organization_id: ORG },
];
const run = (m2Stock) => {
  const entry = { route: "GO", jobId: JOB, tenantId: "000000", organizationId: ORG, lotId: LOT, idempotencyKey: KEY, rowVersion: 1, attempts: 0, dbNow: "2026-10-20 12:00:00",
    jsAt: String(Date.now()), nonce: "n0nce123", request: { v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Add", lotId: LOT, lotNo: "LOT-X",
      lineFingerprint: "LF1:2:0", lineCount: 2, parts: {} }, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", allocScope: "EMPTY", unlockRows: [] };
  const hdr = { id: LOT, stock_movement_no: "LOT-X", stock_movement_status: "Processing", issuing_operation_faci: P, organization_id: ORG, issue_date: "2026-10-20 00:00:00",
    is_production_order: 0, movement_type: "Location Transfer", lot_v2_job_id: JOB };
  const bal = (id, mat, bin, q) => ({ k: "IB", j: J({ id, material_id: mat, location_id: bin, unrestricted_qty: q, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, balance_quantity: q,
    plant_id: P, organization_id: ORG, intransit_qty: 0, material_uom: UOM, is_deleted: 0, create_time: "2026-10-01 10:00:00.000" }) });
  const S = { entry, parts: [], hdr: [{ j: J(hdr) }], lines: lines.map((l) => ({ j: J(l) })), transit: [], bins: [], lock: [{ step_name: "LOCK|1", result_ref: KEY }],
    items: [M1, M2].map((m, i) => ({ j: J({ id: m, material_code: "IT" + (i + 1), material_name: "Item " + (i + 1) }) })),
    aitem: [[M1, 1], [M2, 0]].map(([m, sc], i) => ({ j: J({ id: m, material_code: "IT" + (i + 1), item_batch_management: 0, stock_control: sc, uom_conversion_json: "[]", default_bin_json: "[]" }) })),
    abal: [bal("1", M1, A, 10)].concat(m2Stock ? [bal("2", M2, A, m2Stock)] : []) };
  const tok = { code_node_LPentry: "entry", sql_node_LPparts: "parts", sql_node_LPhdr: "hdr", sql_node_LPlines: "lines", sql_node_LPtransit: "transit", sql_node_LPitems: "items",
    sql_node_LPbins: "bins", sql_node_LPaitem: "aitem", sql_node_LPabal: "abal", sql_node_LPlock: "lock" };
  const code = planSrc.replace(/\{\{node:([A-Za-z0-9_]+)\.data\}\}/g, (m, id) => J(S[tok[id]]));
  const sb = vm.createContext({ console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date });
  return vm.runInContext("(function () {\n" + code + "\n})()", sb);
};
const bad = run(0);
console.log("stock_control 0 item, no stock ->", bad.route, bad.code, JSON.stringify(bad.message), "unlockOk", bad.unlockOk);
assert.strictEqual(bad.route, "FAIL");
assert.strictEqual(bad.code, "LOT_LINES_WITHOUT_STOCK");
assert.strictEqual(bad.message, "No stock selected for line 3. Select stock for every line before saving.");
assert.strictEqual(String(bad.unlockOk), "1");
const ok = run(5);
console.log("the same item with 5 in stock ->", ok.route, ok.code, ok.message);
assert.strictEqual(ok.route, "READY");
console.log("all passed");
