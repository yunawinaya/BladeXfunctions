// Fixtures for IDA_V2_COMMIT / IDA_V2_WORKER: a COMPLETE_IDA job as PREPARE leaves it (CONTRACT.md sections 3-5: the manifest and the P parts
// ENGINE_I / ENGINE_R (+ alloc) / BATCH / LABELS / ITEMS, built here from the contract's field lists), the stored Item Disassembly (FP_HEADER /
// FP_LINES shapes), the stock the engine reads and the organization's batch_number_config (000000's real row: Organization Level,
// Batch-%5d, running_number 631 = the next number). Built with code/shared so the fingerprint, the batch kinds, the request and the price
// helpers are the shipped ones; the engine is the DEPLOYED planner (base/INVENTORY_BULK_APPLY.v12.json code_node_IBplan's planBulk).
const fs = require("fs");
const path = require("path");
const IDAV2 = path.join(__dirname, "..", "..");
const C = require(path.join(IDAV2, "code", "shared", "ida_common.js"));
const F = require(path.join(IDAV2, "code", "shared", "fingerprint.js"));
const P = require(path.join(IDAV2, "code", "shared", "price.js"));
const REPO = path.join(IDAV2, "..", "..");
const OUT = path.join(REPO, "Item Disassembly", "AsyncV2");

// the deployed planner: code_node_IBplan's text up to its request plumbing (planBulk + fifoUnitPrice and their helpers)
function loadPlanner() {
  const doc = JSON.parse(fs.readFileSync(path.join(IDAV2, "base", "INVENTORY_BULK_APPLY.v12.json"), "utf8"));
  let code = null;
  const walk = (n) => {
    if (code) return;
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.id === "code_node_IBplan") code = n.data.script.code;
      else Object.values(n).forEach(walk);
    }
  };
  walk(doc);
  const cut = code.indexOf("\nconst arr = (v) =>");
  if (!code || cut < 0) throw new Error("code_node_IBplan not found in base/INVENTORY_BULK_APPLY.v12.json");
  return new Function(code.slice(0, cut) + "\nreturn { planBulk };")();
}
const { planBulk } = loadPlanner();

const JOB = "2112100000000000001";
const IDAID = "2112073133161844738";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const NONCE = "c9d8e7f6";
const KEY = "IDA:" + ORG + ":" + IDAID + ":0a1b2c3d4e5f6a7b:1";
const UOM = "2018906563477008392";
const ALT = "2018906563477008399";
const SRC = "2105489115887079441";
const SRC_BIN = "2106278340907413505";
const IDANO = "IDA-2610-0042";
const DOC_DATE = "2026-10-21 00:00:00";
const FIFO = "First In First Out";
const WA = "Weighted Average";
const FIXED = "Fixed Cost";
const BNC_ID = "2062365526375706626";
const AUTO_RULE = "According To System Settings";
const PLACEHOLDER = "Auto-generated batch number";
const BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date", "expired_date"];
// prod's only number rule set (Inventory Price 4 dp / Inventory Qty 3 dp, half-up): stored totals differ from the APPLY answer's
const PRECISION = { price: { dp: 4, mode: 1 }, qty: { dp: 3, mode: 1 } };

const big = (b, i) => (BigInt(b) + BigInt(i)).toString();
const itemId = (i) => big("2094626841323700300", i);
const binOf = (i) => big("2018912822846583000", i);
const lineId = (i) => big("2112073133161845000", i);
const srcBal = "2051183829505900001";
const bnc = (running) => ({ id: BNC_ID, batch_level_selection: "Organization Level", item_id: null, item_category_id: null, item_group_id: null, batch_format: "Batch-%5d",
  running_number: running === undefined ? 631 : running, reset_frequency: "Never Reset", initial_value: 0, last_reset_date: null, date_format: "Document Created Date",
  format_preview: "Batch-00001", organization_id: ORG });
// what N sequential GENERATE_BATCH calls answer on that row (format Batch-%5d, the running number is the next one, never reset)
const autoNumber = (k, running) => "Batch-" + String((running === undefined ? 631 : running) + k).padStart(5, "0");

// a recovery line spec: { kind: none | typed | auto | ns | nsauto | nstyped, item (shared item index), number, qty, alt, cost (FIFO | WA | Fixed Cost), bin }
function lineSpecs(o) {
  if (Array.isArray(o.lines)) return o.lines;
  const n = o.n === undefined ? 6 : o.n;
  const out = [];
  for (let i = 1; i <= n; i++) out.push(o.pattern ? o.pattern(i) : { kind: "none" });
  return out;
}

// opts: lines (specs) | n + pattern, picks (source picks, sm_quantity each), pickQty, itemQty, running (BNC), lineFields (per-line overrides)
function makeCase(opts) {
  const o = Object.assign({ picks: 1, pickQty: 2 }, opts || {});
  const specs = lineSpecs(o);
  const items = {};
  items[SRC] = { id: SRC, material_code: "FG-0001", material_name: "Assembly", stock_control: 1, material_costing_method: FIFO, based_uom: UOM, table_uom_conversion: [], purchase_unit_price: "0",
    item_batch_management: 0, batch_number_genaration: null, serial_number_management: 0, item_category: "2018905941675634693", item_group_id: null };
  const lines = [];
  specs.forEach((sp, k) => {
    const i = k + 1;
    const kind = sp.kind || "none";
    const idx = sp.item === undefined ? i : sp.item;
    const mat = itemId(idx);
    const ns = kind === "ns" || kind === "nsauto" || kind === "nstyped";
    const batchy = kind === "typed" || kind === "auto" || kind === "nsauto" || kind === "nstyped";
    if (!items[mat]) {
      items[mat] = { id: mat, material_code: "RM-" + String(idx).padStart(4, "0"), material_name: "Part " + idx, stock_control: ns ? 0 : 1, material_costing_method: sp.cost || FIFO,
        based_uom: UOM, table_uom_conversion: sp.alt ? [{ alt_uom_id: ALT, base_qty: 12 }] : [], purchase_unit_price: sp.cost === FIXED ? "7.2500" : "0", item_batch_management: batchy ? 1 : 0,
        batch_number_genaration: kind === "auto" || kind === "nsauto" ? AUTO_RULE : batchy ? "Manual Input" : null, serial_number_management: 0, item_category: "2018905941675634693",
        item_group_id: null };
    }
    const number = kind === "typed" || kind === "nstyped" ? sp.number || "LOT-" + i : kind === "auto" || kind === "nsauto" ? PLACEHOLDER : "-";
    const qty = sp.qty === undefined ? (i % 3) + 1 : sp.qty;
    lines.push(Object.assign({ id: lineId(i), line_index: String(i), item_selection: mat, quantity_uom: sp.alt ? ALT : UOM, total_quantity: C.idaQtyStr(qty), location_id: sp.bin || binOf(i),
      batch_number: number, manufacturing_date: batchy ? "2026-10-01 00:00:00" : null, expired_date: batchy ? "2027-10-01 00:00:00" : null, item_remark: "r" + i, item_remark_2: "",
      item_remark_3: "", issuing_plant: PLANT, organization_id: ORG, item_name: items[mat].material_name }, (o.lineFields || {})[i] || {}));
  });
  const picks = [];
  for (let k = 0; k < o.picks; k++) {
    picks.push({ balance_id: srcBal, location_id: SRC_BIN, batch_id: "", category: "Unrestricted", sm_quantity: o.pickQty, material_id: SRC, plant_id: PLANT });
  }
  const header = { id: IDAID, item_id: SRC, item_code: "FG-0001", item_name: "Assembly", item_qty: C.idaQtyStr(o.itemQty === undefined ? o.picks * o.pickQty : o.itemQty), item_uom: UOM,
    issuing_operation_faci: PLANT, organization_id: ORG, stock_movement_no: IDANO, stock_movement_no_type: "2098256587713404930", item_disassembly_status: "Processing", posted_status: "",
    item_disassembly_date: DOC_DATE, temp_qty_data: JSON.stringify(picks), temp_hu_data: "[]", table_hu: null, remarks: "", remarks_2: "", remarks_3: "", ida_v2_job_id: JOB };
  const balances = [{ id: srcBal, material_id: SRC, location_id: SRC_BIN, plant_id: PLANT, organization_id: ORG, unrestricted_qty: 100000, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0,
    intransit_qty: 0, balance_quantity: 100000 }];
  // two FIFO layers of the source: a small first one (a bigger pick is priced over both)
  const layers = [{ id: "2061183829505900001", material_id: SRC, batch_id: null, plant_id: PLANT, organization_id: ORG, fifo_sequence: "1", fifo_cost_price: 10.1234, fifo_initial_quantity: 3,
    fifo_available_quantity: 1.5 }, { id: "2061183829505900002", material_id: SRC, batch_id: null, plant_id: PLANT, organization_id: ORG, fifo_sequence: "2", fifo_cost_price: 12.3456,
    fifo_initial_quantity: 100000, fifo_available_quantity: 99999 }];
  const waRows = [];
  for (const id of Object.keys(items)) {
    if (items[id].material_costing_method === WA && id !== SRC) waRows.push({ id: big("2071183829505900000", waRows.length + 1), material_id: id, batch_id: null, plant_id: PLANT, organization_id: ORG, wa_quantity: 4, wa_cost_price: 3.5, created_at: "2026-10-01 00:00:00" });
  }
  return Object.assign({ o, specs, items, lines, header, picks, balances, layers, waRows }, buildParts(header, lines, items));
}

// PREPARE's parts per CONTRACT.md section 5 (line order = numeric line_index, then id)
function buildParts(header, lines, items) {
  const order = lines.slice().sort((a, b) => Number(a.line_index) - Number(b.line_index) || (a.id < b.id ? -1 : 1));
  const picks = C.idaPicks(header);
  const movementsI = picks.map((p, k) => ({ movement_key: "M" + (k + 1), direction: "SUBTRACT", plant_id: header.issuing_operation_faci, organization_id: header.organization_id, material_id: header.item_id,
    quantity: C.idaQ8(p.sm_quantity), material_uom: header.item_uom, transaction_type: "IDA", trx_no: header.stock_movement_no, parent_trx_no: "", inventory_category: C.idaCategory(p.category),
    location_id: p.location_id, batch_id: p.batch_id || null, manufacturing_date: p.manufacturing_date || null, expired_date: p.expired_date || null, doc_date: header.item_disassembly_date || null,
    isMovingInv: 0, handling_unit_id: null }));
  const labels = {};
  picks.forEach((p, k) => {
    labels["M" + (k + 1)] = { pick: String(k + 1), line_index: "", line_id: "", item_code: items[header.item_id].material_code, item_name: items[header.item_id].material_name, bin: "SRC-" + p.location_id.slice(-3),
      bin_id: p.location_id, category: C.idaCategory(p.category), side: "out" };
  });
  const movementsR = [];
  const alloc = [];
  const rows = [];
  const typedRow = {};
  const autoItems = [];
  let stock = 0;
  for (const l of order) {
    const it = items[l.item_selection];
    const isStock = Number(it.stock_control) !== 0;
    const share = C.idaQ8(l.total_quantity);
    const base = P.idaUomOf(it, share, l.quantity_uom).baseQty;
    const kind = C.idaBatchKind(l, it);
    let mk = "";
    if (isStock) {
      stock++;
      mk = "R" + stock;
      movementsR.push({ movement_key: mk, direction: "ADD", plant_id: l.issuing_plant || header.issuing_operation_faci, organization_id: l.organization_id || header.organization_id, material_id: l.item_selection,
        quantity: share, material_uom: l.quantity_uom, transaction_type: "IDA", trx_no: header.stock_movement_no, parent_trx_no: "", inventory_category: "Unrestricted", location_id: l.location_id,
        batch_id: null, unit_price: 0, doc_date: header.item_disassembly_date || null, manufacturing_date: l.manufacturing_date || null, expired_date: l.expired_date || null, remark: l.item_remark || "",
        remark2: l.item_remark_2 || "", remark3: l.item_remark_3 || "", isMovingInv: 0, handling_unit_id: null });
      labels[mk] = { pick: "", line_index: l.line_index, line_id: l.id, item_code: it.material_code, item_name: l.item_name || it.material_name, bin: "BIN-" + l.location_id.slice(-3), bin_id: l.location_id,
        category: "Unrestricted", side: "in" };
    }
    let bk = "";
    const common = { plant_id: l.issuing_plant || header.issuing_operation_faci, organization_id: l.organization_id || header.organization_id, transaction_no: header.stock_movement_no,
      remark: l.item_remark || "", remark2: l.item_remark_2 || "", remark3: l.item_remark_3 || "", manufacturing_date: l.manufacturing_date || null, expired_date: l.expired_date || null };
    if (kind === "TYPED" && isStock) {
      const tk = l.item_selection + "|" + C.idaBatchKey(l.batch_number);
      if (!typedRow[tk]) {
        typedRow[tk] = Object.assign({ key: "B" + (rows.length + 1), kind: "TYPED", insert: true, batch_number: l.batch_number, line_ids: [], material_id: l.item_selection, initial_quantity: "0",
          request: null }, common);
        typedRow[tk].baseSum = 0;
        rows.push(typedRow[tk]);
      }
      typedRow[tk].line_ids.push(l.id);
      typedRow[tk].baseSum = C.idaQ8(typedRow[tk].baseSum + base);
      bk = typedRow[tk].key;
    } else if (kind === "AUTO") {
      const r = Object.assign({ key: "B" + (rows.length + 1), kind: "AUTO", insert: isStock, batch_number: "", line_ids: [l.id], material_id: l.item_selection, initial_quantity: C.idaQtyStr(base),
        request: C.idaBatchRequest(header, l, header.organization_id) }, common);
      rows.push(r);
      if (!autoItems.some((x) => x.id === l.item_selection)) autoItems.push({ id: l.item_selection, item_category: it.item_category, item_group_id: it.item_group_id });
      bk = isStock ? r.key : "";
    }
    alloc.push({ line_id: l.id, line_index: l.line_index, item_id: l.item_selection, share_qty: share, base_qty: base, movement_key: mk, batch_key: bk });
  }
  for (const r of rows) {
    if (r.kind === "TYPED") r.initial_quantity = C.idaQtyStr(r.baseSum);
    delete r.baseSum;
  }
  const itemIds = [header.item_id].concat(order.map((l) => l.item_selection)).filter((x, i, a) => a.indexOf(x) === i);
  const parts = {
    ENGINE_I: { operation_key: "IDC|" + JOB + "|I", mode: "APPLY", organization_id: ORG, movements: movementsI },
    ENGINE_R: { operation_key: "IDC|" + JOB + "|R", mode: "APPLY", organization_id: ORG, movements: movementsR, alloc: alloc },
    LABELS: labels,
    ITEMS: { itemDates: itemIds.map((id) => ({ id: id })) },
  };
  const batchMode = rows.length ? "insert" : "none";
  if (rows.length) parts.BATCH = { mode: "insert", items: autoItems, rows: rows };
  const partStepRows = [];
  const names = {};
  for (const k of Object.keys(parts)) {
    const r = C.idaPartRows(JOB, ORG, "P|" + NONCE + "|" + k + "|", parts[k], "PAYLOAD");
    names[k] = r.map((x) => x.step_name);
    partStepRows.push(...r);
  }
  const fp = F.idaLineFingerprint(lines.map((l) => ({ j: JSON.stringify(l) })), [{ j: JSON.stringify(header) }]);
  const nonStockLines = order.filter((l) => Number(items[l.item_selection].stock_control) === 0).length;
  const manifest = { v: 1, prepared_by: "IDA_V2_PREPARE", job_id: JOB, ida_id: IDAID, ida_no: header.stock_movement_no, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", organization_id: ORG,
    plant_id: header.issuing_operation_faci, nonce: NONCE, lineFingerprint: fp, batchMode: batchMode, parts: names,
    counts: { lines: lines.length, picks: picks.length, movementsI: movementsI.length, movementsR: movementsR.length, nonStockLines: nonStockLines, batchRows: rows.length,
      autoRows: rows.filter((r) => r.kind === "AUTO").length, typedRows: rows.filter((r) => r.kind === "TYPED").length, items: itemIds.length } };
  const request = { v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Edit", idaId: IDAID, idaNo: header.stock_movement_no, issuedNo: header.stock_movement_no,
    lineFingerprint: fp, organizationId: ORG, plantId: PLANT, lineCount: lines.length, pickCount: picks.length, moveCount: picks.length + lines.length, stockLines: movementsR.length,
    nonStockLines: nonStockLines, uid: "1123598821738675201", source: "FORM", nonce: "ab12cd34", parts: {} };
  return { order, movementsI, movementsR, alloc, batchRows: rows, labels, parts, partStepRows, manifest, request, fp, itemIds, batchMode };
}

function nodeById(doc, id) {
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.id === id && n.type) hit = n;
      else Object.values(n).forEach(walk);
    }
  };
  walk(doc);
  if (!hit) throw new Error("no node " + id);
  return hit;
}
const docs = {};
const built = (name) => docs[name] || (docs[name] = JSON.parse(fs.readFileSync(path.join(OUT, name + ".json"), "utf8")));
// the unit loader (lib/test_load.js strip rule) on a BUILT code node: exactly what ships, without its platform tail
const strip = require(path.join(IDAV2, "lib", "test_load.js")).strip;
function loadNode(name, id, names) {
  const src = strip(nodeById(built(name), id).data.script.code) + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(id + ": a platform token is left in the loaded body");
  return new Function(src)();
}
// batchnum runs in UTC+8 as the platform does: a test file calls this first
function utc8(file) {
  if (new Date(2026, 0, 1).getTimezoneOffset() === -480) return;
  const r = require("child_process").spawnSync(process.execPath, [file].concat(process.argv.slice(2)), { env: Object.assign({}, process.env, { TZ: "Asia/Kuala_Lumpur" }), stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = { C, F, P, planBulk, REPO, OUT, JOB, IDAID, ORG, PLANT, NONCE, KEY, UOM, ALT, SRC, SRC_BIN, IDANO, DOC_DATE, FIFO, WA, FIXED, BNC_ID, AUTO_RULE, PLACEHOLDER, BATCH_COLS,
  PRECISION, bnc, autoNumber, makeCase, buildParts, nodeById, built, loadNode, itemId, binOf, lineId, utc8 };
