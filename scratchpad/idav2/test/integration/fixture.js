// Integration fixtures: the workflow set (the four BUILT V2 JSONs + the built classic IDA_SAVE v7 from "Item Disassembly/AsyncV2/", the
// DEPLOYED INVENTORY_BULK_APPLY v10 / INVENTORY_LOCK_TOKENS v5 / INVENTORY_LOCK_SEED v5 / CHECK_REQUIRED_FIELD v8 from base/), the
// real ids (ids.json), a 000000-like world (org 1123598813738675201, plant 1123598813738675202; the org's default batch config =
// Organization Level / Batch-%5d / Document Created Date), and the form's record in form v35's getValues() shape (live/build_ida_payload.py:
// header_add / explode_rows / batch_add_row / the single-source pick; minus CONTRACT section 12's NOT_RECORD for SUBMIT).
const fs = require("fs");
const path = require("path");
const W = require("./world.js");
const IDAV2 = path.join(__dirname, "..", "..");
const REPO = path.join(IDAV2, "..", "..");
const OUT = process.env.IDA_INTEGRATION_OUT || path.join(REPO, "Item Disassembly", "AsyncV2");
const C = require(path.join(IDAV2, "code", "shared", "ida_common.js"));
const IDS = JSON.parse(fs.readFileSync(path.join(IDAV2, "ids.json"), "utf8"));

const BUILT = ["IDA_V2_SUBMIT", "IDA_V2_WORKER", "IDA_V2_PREPARE", "IDA_V2_COMMIT", "IDA_SAVE"];
const BASES = { INVENTORY_BULK_APPLY: "INVENTORY_BULK_APPLY.v10.json", INVENTORY_LOCK_TOKENS: "INVENTORY_LOCK_TOKENS.v5.json", INVENTORY_LOCK_SEED: "INVENTORY_LOCK_SEED.v5.json",
  CHECK_REQUIRED_FIELD: "CHECK_REQUIRED_FIELD.v8.json" };
function loadDocs() {
  const docs = {};
  for (const n of BUILT) docs[n] = W.parseBig(fs.readFileSync(path.join(OUT, n + ".json"), "utf8"));
  for (const [n, f] of Object.entries(BASES)) docs[n] = W.parseBig(fs.readFileSync(path.join(IDAV2, "base", f), "utf8"));
  return docs;
}

const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const RULE = "2107022471794724866";
const UOM = "2018906563477008392";
const BOX = "2018906563477008399";
const SLOC = "2018912759311265793";
const SRC_BIN = "2018912822846582786";
const BINS = ["2018912822846582787", "2018912822846582788", "2018912822846582789"];
const SRC = "2105489115887079441";
const BNC_ID = "2062365526375706626";
const FIFO = "First In First Out";
const WA = "Weighted Average";
const FIXED = "Fixed Cost";
const AUTO_RULE = "According To System Settings";
const PLACEHOLDER = "Auto-generated batch number";
const DOC_DATE = "2026-10-21";
const comp = (i) => (2094626841323700300n + BigInt(i)).toString();

// the world: the source item (FIFO, two layers), recovery items per spec, bins, the org's batch config
// spec.lines: [{ kind: none | typed | auto | ns, item (index; same index = same item), number, qty, alt, cost, bin }]
function world(spec) {
  const sp = Object.assign({ pickQty: 2, picks: 1, srcStock: 100, running: 631 }, spec || {});
  const w = new W.World(sp.world || {});
  w.bins.set(SRC_BIN, "A1-01");
  BINS.forEach((b, i) => w.bins.set(b, "R1-0" + (i + 1)));
  w.addItem({ id: SRC, material_code: "FG-0001", material_name: "Assembly FG", based_uom: UOM, material_costing_method: sp.srcCost || FIFO, organization_id: ORG });
  w.addBalance({ material_id: SRC, location_id: SRC_BIN, plant_id: PLANT, organization_id: ORG, material_uom: UOM, unrestricted_qty: sp.srcStock });
  w.addFifo({ material_id: SRC, plant_id: PLANT, organization_id: ORG, fifo_sequence: "1", fifo_cost_price: 10.1234, fifo_initial_quantity: 3, fifo_available_quantity: Math.min(1.5, sp.srcStock) });
  w.addFifo({ material_id: SRC, plant_id: PLANT, organization_id: ORG, fifo_sequence: "2", fifo_cost_price: 12.3456, fifo_initial_quantity: 10000,
    fifo_available_quantity: Math.max(0, sp.srcStock - 1.5) });
  w.bnc.push({ id: BNC_ID, batch_level_selection: "Organization Level", item_id: null, item_category_id: null, item_group_id: null, batch_format: "Batch-%5d", running_number: sp.running,
    reset_frequency: "Never Reset", initial_value: 0, last_reset_date: null, date_format: "Document Created Date", format_preview: "Batch-00001", organization_id: ORG, is_deleted: 0 });
  const lines = [];
  (sp.lines || []).forEach((l, k) => {
    const i = k + 1;
    const idx = l.item === undefined ? i : l.item;
    const id = comp(idx);
    if (!w.items.get(id)) {
      const batchy = l.kind === "typed" || l.kind === "auto";
      w.addItem({ id: id, material_code: "RM-" + String(idx).padStart(4, "0"), material_name: "Part " + idx, based_uom: UOM, organization_id: ORG,
        stock_control: l.kind === "ns" ? 0 : 1, material_costing_method: l.cost || FIFO, purchase_unit_price: l.cost === FIXED ? 7.25 : 0, item_batch_management: batchy ? 1 : 0,
        batch_number_genaration: l.kind === "auto" ? AUTO_RULE : batchy ? "Manual Input" : null, uoms: l.alt ? [{ alt_uom_id: UOM, base_qty: 1 }, { alt_uom_id: BOX, base_qty: 12 }] : [{ alt_uom_id: UOM, base_qty: 1 }] });
      if ((l.cost || FIFO) === WA) w.addWa({ material_id: id, plant_id: PLANT, organization_id: ORG, wa_quantity: 4, wa_cost_price: 3.5 });
    }
    lines.push(Object.assign({}, l, { i: i, id: id, item: w.items.get(id) }));
  });
  return { w: w, sp: sp, lines: lines };
}

// one form line exactly as the explode / Batch Add builds it (then edited: target bin, UOM, quantity, batch number)
function formLine(L, i) {
  const it = L.item;
  const qty = L.qty === undefined ? (i % 3) + 1 : L.qty;
  const batch = L.kind === "typed" ? L.number : L.kind === "auto" ? PLACEHOLDER : "-";
  const uoms = L.alt ? [UOM, BOX] : [UOM];
  return { item_selection: it.id, item_name: it.material_name, item_desc: "", requested_qty: qty, bom_ratio: L.manual ? null : qty / 2, total_quantity: qty, quantity_uom: L.alt ? BOX : UOM,
    storage_location_id: SLOC, location_id: L.bin || BINS[i % BINS.length], batch_number: batch, manufacturing_date: L.kind === "typed" || L.kind === "auto" ? "2026-10-01" : "",
    expired_date: L.kind === "typed" || L.kind === "auto" ? "2027-10-01" : "", item_remark: "r" + i, item_remark_2: "", item_remark_3: "", project_id: "", organization_id: ORG,
    issuing_plant: PLANT, line_index: i, uom_options: JSON.stringify(uoms.map((u) => ({ id: u, uom_name: u === BOX ? "BOX" : "PCS" }))), fm_key: "fm" + i };
}
const pickOf = (sp, k) => ({ material_id: SRC, location_id: SRC_BIN, storage_location_id: null, batch_id: null, serial_number: "", balance_id: "2051183829505900001", sm_quantity: sp.pickQty,
  category: "Unrestricted", plant_id: PLANT, organization_id: ORG, is_deleted: 0, expired_date: null, manufacturing_date: null, unrestricted_qty: sp.srcStock, balance_quantity: sp.srcStock,
  fm_key: "pick" + k });
// getValues() of the Add form (widget keys included: the classic gets them all, SUBMIT the NOT_RECORD-stripped record)
function addForm(f, extra) {
  const sp = f.sp;
  const picks = [];
  for (let k = 0; k < sp.picks; k++) picks.push(pickOf(sp, k));
  const qty = sp.picks * sp.pickQty;
  return Object.assign({ isTrusted: true, _vts: 1792000000000, draft_status: "<span>Draft</span>", issued_status: "", completed_status: "", fullyposted_status: "", processing_status: "",
    flex_2det1nd2: "", organization_id: ORG, sid_uuid: "", item_disassembly_status: "", posted_status: "", page_status: "Add", ida_v2_job_id: "", ida_idem_key: "",
    issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: RULE, item_id: SRC, item_disassembly_date: DOC_DATE, issued_by: "integration", item_code: "FG-0001",
    item_name: "Assembly FG", item_desc: "", item_qty: qty, item_uom: UOM, stock_summary: "Total: " + qty + " PCS", temp_qty_data: JSON.stringify(picks), temp_hu_data: "",
    project_id: "", remarks: "", remarks_2: "", remarks_3: "", reference_documents: "", item_display_table: [{ item_selection: SRC, item_qty: qty }],
    stock_movement: f.lines.map((L) => formLine(L, L.i)), button_draft: "", button_completed: "", flex_t6y2yh5r: "", $_v: 56, ida_source_stock_mode: "single",
    storage_location_id: SLOC, location_id: SRC_BIN }, extra || {});
}
// the stored IDA as the Edit form loads it (its ids, status, number; the lines with their stored fields)
function editForm(w, idaId, extra) {
  const h = w.ida(idaId);
  const lines = w.liveLines(idaId).sort((a, b) => Number(a.line_index) - Number(b.line_index));
  const rec = { isTrusted: true, _vts: 1792000000001, draft_status: "", issued_status: "", completed_status: "", fullyposted_status: "", processing_status: "", flex_2det1nd2: "",
    tenant_id: W.T, id: idaId, page_status: "Edit", ida_v2_job_id: h.ida_v2_job_id || "", ida_idem_key: h.ida_idem_key || "", item_disassembly_status: h.item_disassembly_status,
    stock_movement_no: h.stock_movement_no, stock_movement_no_type: h.stock_movement_no_type === "-9999" ? -9999 : h.stock_movement_no_type, item_code: h.item_code, item_name: h.item_name,
    item_desc: h.item_desc || "", item_uom: h.item_uom, item_id: h.item_id, item_qty: h.item_qty, issuing_operation_faci: h.issuing_operation_faci, organization_id: h.organization_id,
    item_disassembly_date: h.item_disassembly_date, issued_by: h.issued_by || "integration", project_id: h.project_id || "", remarks: h.remarks || "", remarks_2: h.remarks_2 || "",
    remarks_3: h.remarks_3 || "", reference_documents: h.reference_documents || "", stock_summary: h.stock_summary || "", temp_qty_data: h.temp_qty_data, temp_hu_data: h.temp_hu_data || "",
    table_hu: h.table_hu, posted_status: h.posted_status || "", table_item_balance: [],
    stock_movement: lines.map((l) => ({ bom_ratio: l.bom_ratio, item_remark: l.item_remark, item_desc: l.item_desc || "", batch_number: l.batch_number, uom_options: l.uom_options,
      item_selection: l.item_selection, issuing_plant: l.issuing_plant, storage_location_id: l.storage_location_id, item_remark_3: l.item_remark_3, item_name: l.item_name,
      location_id: l.location_id, requested_qty: l.requested_qty, quantity_uom: l.quantity_uom, project_id: l.project_id || "", item_remark_2: l.item_remark_2,
      organization_id: l.organization_id, total_quantity: l.total_quantity, id: l.id, line_index: Number(l.line_index), manufacturing_date: l.manufacturing_date || "",
      expired_date: l.expired_date || "", fm_key: "fm" + l.id })), button_draft: "", button_completed: "", comp_post_button: "", button_post: "", flex_t6y2yh5r: "", $_v: 22 };
  return Object.assign(rec, extra || {});
}
// a stored Draft as the classic Draft save leaves it (the fill-back's line fields; a draft number)
function storeDraft(f, extra) {
  const form = addForm(f);
  const lines = form.stock_movement.map((l, k) => {
    const o = {};
    for (const key of ["item_selection", "item_name", "item_desc", "requested_qty", "bom_ratio", "total_quantity", "quantity_uom", "storage_location_id", "location_id", "batch_number",
      "manufacturing_date", "expired_date", "item_remark", "item_remark_2", "item_remark_3", "project_id", "uom_options"]) o[key] = l[key];
    return Object.assign(o, { organization_id: ORG, issuing_plant: PLANT, line_index: k + 1 });
  });
  const h = { item_disassembly_status: "Draft", issuing_operation_faci: PLANT, item_id: SRC, item_code: form.item_code, item_name: form.item_name, item_desc: "", item_qty: form.item_qty,
    item_uom: UOM, issued_by: "integration", remarks: "", remarks_2: "", remarks_3: "", project_id: null, item_disassembly_date: DOC_DATE + " 00:00:00", reference_documents: "",
    organization_id: ORG, stock_summary: form.stock_summary, temp_qty_data: form.temp_qty_data, temp_hu_data: "", stock_movement_no: "Draft-IDA-0007", stock_movement_no_type: RULE };
  return f.w.storeIda(Object.assign(h, extra || {}), lines);
}
// CONTRACT section 12 NOT_RECORD: what SUBMIT's form gets
const NOT_RECORD = ["ida_v2_job_id", "ida_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft", "button_completed", "comp_post_button", "button_post",
  "button_kdsxzl2q", "draft_status", "issued_status", "completed_status", "fullyposted_status", "processing_status", "flex_2det1nd2", "flex_t6y2yh5r", "ida_source_stock_mode",
  "item_display_table"];
const recordOf = (form) => {
  const o = {};
  for (const [k, v] of Object.entries(form)) if (NOT_RECORD.indexOf(k) < 0 && k.indexOf("dialog_") !== 0) o[k] = v;
  return o;
};
const keyOf = (doc, hash, gen) => "IDA:" + ORG + ":" + doc + ":" + (hash || "0a1b2c3d4e5f6a7b") + ":" + (gen || 1);
const submitReq = (page, idaId, key, form) => ({ operation: "SUBMIT", saveAs: "Completed", pageStatus: page, ida_id: idaId || "", idempotency_key: key, source: "FORM", form: recordOf(form) });
const statusReq = (idaId, key) => ({ operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ida_id: idaId || "0", idempotency_key: key || "", source: "FORM", form: {} });
const classicReq = (form, saveAs, page) => ({ allData: form, saveAs: saveAs || "Completed", pageStatus: page || form.page_status });

module.exports = { W, C, IDS, OUT, REPO, IDAV2, loadDocs, world, addForm, editForm, storeDraft, recordOf, keyOf, submitReq, statusReq, classicReq, formLine, comp,
  ORG, PLANT, RULE, UOM, BOX, SLOC, SRC_BIN, BINS, SRC, BNC_ID, FIFO, WA, FIXED, AUTO_RULE, PLACEHOLDER, DOC_DATE, NOT_RECORD };
