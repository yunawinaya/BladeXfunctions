// IDA_V2_PREPARE tests (package A). usage: node scratchpad/idav2/test/prepare/test_prepare.js
// Every case runs the BUILT Item Disassembly/AsyncV2/IDA_V2_PREPARE.json end to end (test/prepare/lib.js): goldens against three recorded
// classic IDA_SAVE v6 runs on dev, the classic itself run as the oracle for synthesized documents, failure paths, the PLAN answers (stub and
// the deployed INVENTORY_BULK_APPLY v10 planner), the manifest shape (CONTRACT.md section 5), node data at 2,000 lines.
const L = require("./lib.js");
const { C, PR, eq, truthy, section } = L;
const S = require("./synth.js");

const ENGINE_I_KEYS = ["movement_key", "direction", "plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "parent_trx_no",
  "inventory_category", "location_id", "batch_id", "manufacturing_date", "expired_date", "doc_date", "isMovingInv", "handling_unit_id"];
const ENGINE_R_KEYS = ["movement_key", "direction", "plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "parent_trx_no",
  "inventory_category", "location_id", "batch_id", "unit_price", "doc_date", "manufacturing_date", "expired_date", "remark", "remark2", "remark3", "isMovingInv", "handling_unit_id"];
const ALLOC_KEYS = ["line_id", "line_index", "item_id", "share_qty", "base_qty", "movement_key", "batch_key"];
const BATCH_ROW_KEYS = ["key", "kind", "insert", "batch_number", "line_ids", "material_id", "plant_id", "organization_id", "initial_quantity", "transaction_no", "remark", "remark2",
  "remark3", "manufacturing_date", "expired_date", "request"];
const BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date",
  "expired_date"];
const LABEL_KEYS = ["pick", "line_index", "line_id", "item_code", "item_name", "bin", "bin_id", "category", "side"];
const MANIFEST_KEYS = ["v", "prepared_by", "job_id", "ida_id", "ida_no", "action", "prevStatus", "saveAs", "organization_id", "plant_id", "nonce", "lineFingerprint", "batchMode",
  "parts", "counts"];
const COUNT_KEYS = ["lines", "picks", "movementsI", "movementsR", "nonStockLines", "batchRows", "autoRows", "typedRows", "items"];
const REQUEST_KEYS = ["item_id", "document_date", "manufacturing_date", "expired_date", "organization_id"];
// a date as the DB stores it: the classic sends the form's text ('2026-10-16', '2026-10-16 00:00:00.000'), V2 the stored DATE_FORMAT
const dbDate = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?)?$/);
  return m ? m[1] + " " + (m[2] || "00:00:00") : "?" + v;
};
const num = (v) => C.idaQ8(v);
const rowsOf = (rows) => rows.map((r) => L.parseBig(r.j));
// one V2 SUBTRACT against the classic's wf_subtract params (minus itemData): every key it sent, null = absent
function sameIssue(label, got, want) {
  const covered = ["plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "inventory_category", "location_id", "batch_id",
    "manufacturing_date", "expired_date", "handling_unit_id", "doc_date", "isMovingInv"];
  truthy(label + " sends no key V2 lacks", Object.keys(want).every((k) => covered.indexOf(k) >= 0), Object.keys(want));
  eq(label + " keys", Object.keys(got), ENGINE_I_KEYS);
  const pick = (m) => ({ plant_id: m.plant_id, organization_id: m.organization_id, material_id: m.material_id, quantity: num(m.quantity), material_uom: m.material_uom || "",
    transaction_type: m.transaction_type, trx_no: m.trx_no, inventory_category: m.inventory_category, location_id: m.location_id, batch_id: m.batch_id || null,
    manufacturing_date: dbDate(m.manufacturing_date), expired_date: dbDate(m.expired_date), doc_date: dbDate(m.doc_date), handling_unit_id: m.handling_unit_id || null,
    isMovingInv: Number(m.isMovingInv || 0) });
  eq(label + " params", pick(got), pick(want));
  eq(label + " V2-only keys", [got.direction, got.parent_trx_no, got.isMovingInv, typeof got.quantity], ["SUBTRACT", "", 0, "number"]);
}
// one V2 ADD against the classic's wf_add params minus unit_price (D3's) and batch_number (the batch kind / BATCH row)
function sameReceipt(label, got, want) {
  const covered = ["plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "inventory_category", "location_id", "batch_number",
    "unit_price", "doc_date", "manufacturing_date", "expired_date", "remark", "remark2", "remark3", "isMovingInv"];
  truthy(label + " sends no key V2 lacks", Object.keys(want).every((k) => covered.indexOf(k) >= 0), Object.keys(want));
  eq(label + " keys", Object.keys(got), ENGINE_R_KEYS);
  const pick = (m) => ({ plant_id: m.plant_id, organization_id: m.organization_id, material_id: m.material_id, quantity: num(m.quantity), material_uom: m.material_uom || "",
    transaction_type: m.transaction_type, trx_no: m.trx_no, inventory_category: m.inventory_category, location_id: m.location_id, doc_date: dbDate(m.doc_date),
    manufacturing_date: dbDate(m.manufacturing_date), expired_date: dbDate(m.expired_date), remark: m.remark || "", remark2: m.remark2 || "", remark3: m.remark3 || "",
    isMovingInv: Number(m.isMovingInv || 0) });
  eq(label + " params", pick(got), pick(want));
  eq(label + " COMMIT's two values unset", [got.unit_price, got.batch_id, got.direction, got.parent_trx_no, got.handling_unit_id], [0, null, "ADD", "", null]);
}
// the part / manifest shapes of CONTRACT.md section 5
function shapes(label, r) {
  const P = r.parts;
  eq(label + ": manifest keys", Object.keys(r.manifest), MANIFEST_KEYS);
  eq(label + ": counts keys", Object.keys(r.manifest.counts), COUNT_KEYS);
  eq(label + ": parts listed", Object.keys(r.manifest.parts), ["ENGINE_I", "ENGINE_R"].concat(P.BATCH ? ["BATCH"] : []).concat(["LABELS", "ITEMS"]));
  eq(label + ": BATCH listed exactly when batchMode insert", [r.manifest.batchMode, "BATCH" in r.manifest.parts], [P.BATCH ? "insert" : "none", !!P.BATCH]);
  eq(label + ": ENGINE_I head", Object.keys(P.ENGINE_I), ["operation_key", "mode", "organization_id", "movements"]);
  eq(label + ": ENGINE_R head", Object.keys(P.ENGINE_R), ["operation_key", "mode", "organization_id", "movements", "alloc"]);
  truthy(label + ": movement keys", P.ENGINE_I.movements.every((m) => JSON.stringify(Object.keys(m)) === JSON.stringify(ENGINE_I_KEYS))
    && P.ENGINE_R.movements.every((m) => JSON.stringify(Object.keys(m)) === JSON.stringify(ENGINE_R_KEYS)));
  truthy(label + ": alloc keys", P.ENGINE_R.alloc.every((a) => JSON.stringify(Object.keys(a)) === JSON.stringify(ALLOC_KEYS)));
  truthy(label + ": movement keys M1..Mn / R1..Rn", P.ENGINE_I.movements.every((m, i) => m.movement_key === "M" + (i + 1)) && P.ENGINE_R.movements.every((m, i) => m.movement_key === "R" + (i + 1)));
  if (P.BATCH) {
    eq(label + ": BATCH head", Object.keys(P.BATCH), ["mode", "items", "rows"]);
    truthy(label + ": BATCH row keys", P.BATCH.rows.every((b) => JSON.stringify(Object.keys(b)) === JSON.stringify(BATCH_ROW_KEYS)));
    truthy(label + ": BATCH keys B1..Bn", P.BATCH.rows.every((b, i) => b.key === "B" + (i + 1)));
    truthy(label + ": initial_quantity fixed-scale strings", P.BATCH.rows.every((b) => /^[0-9]+\.[0-9]{8}$/.test(b.initial_quantity)));
    truthy(label + ": AUTO requests", P.BATCH.rows.every((b) => (b.kind === "AUTO" ? JSON.stringify(Object.keys(b.request)) === JSON.stringify(REQUEST_KEYS) : b.request === null)));
    truthy(label + ": items { id, item_category, item_group_id }", P.BATCH.items.every((x) => JSON.stringify(Object.keys(x)) === JSON.stringify(["id", "item_category", "item_group_id"])));
  }
  truthy(label + ": LABELS keys", Object.values(P.LABELS).every((x) => JSON.stringify(Object.keys(x)) === JSON.stringify(LABEL_KEYS)));
  eq(label + ": LABELS = one per movement", Object.keys(P.LABELS), P.ENGINE_I.movements.map((m) => m.movement_key).concat(P.ENGINE_R.movements.map((m) => m.movement_key)));
  eq(label + ": ITEMS head", Object.keys(P.ITEMS), ["itemDates"]);
  const names = Object.values(r.manifest.parts).flat();
  truthy(label + ": part names P|<nonce>|<PART>|<nnn> <= 23 chars", names.every((n) => /^P\|[0-9A-Za-z]{8}\|(ENGINE_I|ENGINE_R|BATCH|LABELS|ITEMS)\|[0-9]{3}$/.test(n) && n.length <= 23), names);
  eq(label + ": parts written = the manifest's", r.stepRows.map((s) => s.step_name).sort(), names.slice().sort());
  truthy(label + ": part rows PAYLOAD under the job, <= 400,000 chars", r.stepRows.every((s) => s.job_id === L.JOB && s.step_status === "PAYLOAD" && s.attempt_count === 0
    && s.result_ref.length <= C.IDA_CHUNK));
  eq(label + ": PLAN calls = the parts' movements (mode PLAN, the real op keys)", r.calls.map((c) => [c.params.operation_key, c.params.mode, c.params.organization_id,
    JSON.stringify(c.params.movements)]), [[P.ENGINE_I.operation_key, "PLAN", P.ENGINE_I.organization_id, JSON.stringify(P.ENGINE_I.movements)],
    [P.ENGINE_R.operation_key, "PLAN", P.ENGINE_R.organization_id, JSON.stringify(P.ENGINE_R.movements)]]);
  eq(label + ": op keys", [P.ENGINE_I.operation_key, P.ENGINE_R.operation_key, P.ENGINE_I.mode, P.ENGINE_R.mode], ["IDC|" + L.JOB + "|I", "IDC|" + L.JOB + "|R", "APPLY", "APPLY"]);
  eq(label + ": the engine calls carry the four request keys only (alloc is never sent)", r.calls.map((c) => Object.keys(c.params)),
    [["operation_key", "mode", "organization_id", "movements"], ["operation_key", "mode", "organization_id", "movements"]]);
}

// ------------------------------------------------------------------------------------------------ goldens (recorded classic runs on dev)
const GOLDENS = ["dev_ida_2610_003", "dev_ida_2610_002", "dev_ida_2610_001"];
for (const name of GOLDENS) {
  if (!L.hasFixture(name)) {
    truthy("golden " + name + " fixture exists (python3 test/prepare/capture_goldens.py)", false);
    continue;
  }
  const fx = L.fixture(name);
  section("golden " + name + " (" + fx.env + " " + fx.run + ": " + fx.note + ")");
  const nodes = fx.parent.nodes;
  // the premise: the stored lines are what the run received (by line_index), the item facts PREPARE reads are unchanged since the run
  const storedLines = rowsOf(fx.db.lines).sort((a, b) => Number(a.line_index) - Number(b.line_index));
  for (const l of fx.parent.allData.stock_movement) {
    const s = storedLines.find((x) => String(x.line_index) === String(l.line_index));
    truthy(name + " line " + l.line_index + " stored as sent", s && s.item_selection === l.item_selection && String(s.quantity_uom) === String(l.quantity_uom)
      && num(s.total_quantity) === num(l.total_quantity) && String(s.location_id) === String(l.location_id), [s, l]);
  }
  const nowItems = rowsOf(fx.db.items);
  for (const it of nodes.search_items.response.data) {
    const n = nowItems.find((x) => x.id === it.id) || {};
    const f = (x) => [String(x.stock_control), String(x.item_batch_management), x.batch_number_genaration, String(x.serial_number_management), x.based_uom];
    eq(name + " item " + it.material_code + " facts unchanged since the run", f(n), f(it));
  }
  const spec = L.goldenSpec(fx);
  const r = L.runPrepare(spec);
  truthy(name + " READY_TO_COMMIT", r.ready && r.returned.job_status === "READY_TO_COMMIT", [r.returned, r.failed]);
  if (!r.ready) continue;
  shapes(name, r);
  const engI = r.parts.ENGINE_I;
  const engR = r.parts.ENGINE_R;
  eq(name + " op 1 movements = the classic's SUBTRACT calls", engI.movements.length, fx.children.subtract.length);
  engI.movements.forEach((m, i) => sameIssue(name + " " + m.movement_key, m, fx.children.subtract[i].params));
  eq(name + " op 2 movements = the classic's ADD calls (every line stock-controlled)", engR.movements.length, fx.children.add.length);
  engR.movements.forEach((m, i) => sameReceipt(name + " " + m.movement_key, m, fx.children.add[i].params));
  // value parity of the date texts: what V2 sends = what the classic's own movement rows store
  const outs = fx.db.movements.filter((m) => m.movement === "OUT");
  const ins = fx.db.movements.filter((m) => m.movement === "IN");
  eq(name + " doc_date = the classic's stored OUT rows'", engI.movements.map((m) => m.doc_date), outs.map((m) => m.doc_date));
  eq(name + " R dates = the classic's stored IN rows'", engR.movements.map((m) => [m.doc_date, m.manufacturing_date, m.expired_date]), ins.map((m) => [m.doc_date, m.mfg, m.exp]));
  eq(name + " parent_trx_no '' = the classic's stored rows'", fx.db.movements.map((m) => m.parent_trx_no), fx.db.movements.map(() => ""));
  // alloc = the stored IN rows' quantities; idaAllocate over the stored OUT total = the classic's sent unit_price (base UOM lines)
  eq(name + " alloc share / base = the stored IN rows' quantity / base_qty", engR.alloc.map((a) => [a.share_qty, a.base_qty]), ins.map((m) => [num(m.quantity), num(m.base_qty)]));
  const outTotal = outs.reduce((n, m) => n + parseFloat(m.total_price), 0);
  const prices = PR.idaAllocate(outTotal, engR.alloc);
  eq(name + " idaAllocate(stored OUT total) = the classic's unit_price", prices.map((p) => p.unit_price), fx.children.add.map((a) => num(a.params.unit_price)));
  eq(name + " the allocated values add up to the issued value", num(prices.reduce((n, p) => n + p.value, 0)), num(outTotal));
  // BATCH: AUTO = code_batch_plan's genLines (+ the organization), TYPED = the classic's Batch row, NONE = the classic's blank rows (deliberate)
  const gen = nodes.code_batch_plan.response.genLines || [];
  const rowsB = r.parts.BATCH ? r.parts.BATCH.rows : [];
  const autos = rowsB.filter((b) => b.kind === "AUTO");
  eq(name + " AUTO rows = the classic's GENERATE_BATCH lines (requests in line order)", autos.map((b) => [b.line_ids[0], b.request.item_id, dbDate(b.request.document_date),
    dbDate(b.request.manufacturing_date), dbDate(b.request.expired_date), b.request.organization_id]), gen.map((g) => [storedLines[g.index].id, g.item_id, dbDate(g.document_date),
    dbDate(g.manufacturing_date), dbDate(g.expired_date), spec.org]));
  const gbf = nodes.get_batches_final ? nodes.get_batches_final.response : [];
  const generated = typeof gbf === "string" ? L.parseBig(gbf) : Array.isArray(gbf) ? gbf : [];
  const cols = (b) => BATCH_COLS.map((k) => (k === "initial_quantity" ? num(b[k]) : k.indexOf("_date") > 0 ? dbDate(b[k]) : b[k] === null || b[k] === undefined ? "" : b[k]));
  for (const b of autos) {
    const g = generated.find((x) => storedLines[x.index].id === b.line_ids[0]);
    const theirs = g && fx.db.batches.find((x) => x.batch_number === g.batch_number && x.material_id === b.material_id);
    truthy(name + " " + b.key + " the classic numbered it " + (g && g.batch_number), !!theirs, generated);
    if (theirs) eq(name + " " + b.key + " AUTO row = the classic's Batch row but the number (D1's)", cols(b).slice(1), cols(theirs).slice(1));
    eq(name + " " + b.key + " AUTO row number left to D1", [b.batch_number, b.insert], ["", true]);
  }
  for (const b of rowsB.filter((x) => x.kind === "TYPED")) {
    const theirs = fx.db.batches.find((x) => x.batch_number === b.batch_number && x.material_id === b.material_id);
    truthy(name + " " + b.key + " the classic made Batch " + b.batch_number, !!theirs);
    if (theirs) eq(name + " " + b.key + " TYPED row = the classic's Batch row", cols(b), cols(theirs));
  }
  const noneLines = engR.alloc.filter((a) => a.batch_key === "").map((a) => a.item_id);
  eq(name + " NONE lines: no row; the classic minted a blank Batch row for each (deliberate difference)", fx.db.batches.filter((b) => b.batch_number === "").map((b) => b.material_id),
    noneLines);
  eq(name + " batch keys of the alloc", engR.alloc.map((a) => a.batch_key), engR.alloc.map((a) => (rowsB.find((b) => b.line_ids.indexOf(a.line_id) >= 0) || {}).key || ""));
  // ITEMS = the classic's code_item_txn ids (source first, then every line's item)
  eq(name + " ITEMS = code_item_txn's ids", r.parts.ITEMS, { itemDates: nodes.code_item_txn.response.updates.map((u) => ({ id: u.id })) });
  const bins = {};
  for (const b of rowsOf(fx.db.bins)) bins[b.id] = b.bin;
  eq(name + " LABELS bins", Object.values(r.parts.LABELS).map((x) => x.bin), engI.movements.concat(engR.movements).map((m) => bins[m.location_id]));
  eq(name + " LABELS M1 / R1", [r.parts.LABELS.M1.pick, r.parts.LABELS.M1.side, r.parts.LABELS.R1.line_index, r.parts.LABELS.R1.side], ["1", "out", "1", "in"]);
  eq(name + " manifest head", [r.manifest.v, r.manifest.prepared_by, r.manifest.job_id, r.manifest.ida_id, r.manifest.ida_no, r.manifest.action, r.manifest.prevStatus,
    r.manifest.saveAs, r.manifest.organization_id, r.manifest.plant_id, r.manifest.lineFingerprint], [1, "IDA_V2_PREPARE", L.JOB, fx.ida_id, fx.trx_no, "DIRECT", "Draft", "Completed",
    spec.org, L.parseBig(spec.hdr[0].j).issuing_operation_faci, spec.request.lineFingerprint]);
  eq(name + " manifest counts", r.manifest.counts, { lines: storedLines.length, picks: fx.children.subtract.length, movementsI: fx.children.subtract.length,
    movementsR: fx.children.add.length, nonStockLines: 0, batchRows: rowsB.length, autoRows: autos.length, typedRows: rowsB.length - autos.length,
    items: nodes.code_item_txn.response.updates.length });
  eq(name + " READY row", [r.ready.progress_percent, r.ready.row_version, r.ready.line_count, r.ready.error_code, r.ready.lease_owner],
    [60, 4, fx.children.subtract.length + storedLines.length, null, undefined]);
  eq(name + " nothing else written", [r.unlocks.length, r.jobUps.length], [0, 1]);
}

// ------------------------------------------------------------------------------------------------ the classic v6 as the oracle
// V2's two operations against the classic IDA_SAVE v6's SUBTRACT / ADD / GENERATE_BATCH calls on the same document
function oracle(label, d, opts) {
  const o = opts || {};
  const c = L.runClassic(d.form, { items: d.items, stored: d.stored, outMovements: o.outMovements });
  truthy(label + ": the classic saved", c.returned && c.returned.code === "200", c.returned);
  const r = L.runPrepare(Object.assign({}, d.spec, o.spec || {}));
  truthy(label + ": READY_TO_COMMIT", r.ready, [r.returned, r.failed]);
  if (!r.ready) return { c: c, r: r };
  shapes(label, r);
  const stockIds = d.items.filter((it) => C.idaS(it.stock_control) !== "0").map((it) => it.id);
  eq(label + ": op 1 = the classic's SUBTRACT calls", r.parts.ENGINE_I.movements.length, c.subtracts.length);
  r.parts.ENGINE_I.movements.forEach((x, i) => c.subtracts[i] && sameIssue(label + " " + x.movement_key, x, c.subtracts[i]));
  const adds = c.adds.filter((a) => stockIds.indexOf(a.material_id) >= 0);
  eq(label + ": op 2 = the classic's ADD calls of the stock lines", r.parts.ENGINE_R.movements.length, adds.length);
  r.parts.ENGINE_R.movements.forEach((x, i) => adds[i] && sameReceipt(label + " " + x.movement_key, x, adds[i]));
  const autos = r.parts.BATCH ? r.parts.BATCH.rows.filter((b) => b.kind === "AUTO") : [];
  eq(label + ": AUTO requests = the classic's GENERATE_BATCH calls (+ organization)", autos.map((b) => b.request),
    c.generates.map((g) => ({ item_id: g.item_id, document_date: g.document_date || null, manufacturing_date: g.manufacturing_date || null, expired_date: g.expired_date || null,
      organization_id: S.ORG })));
  return { c: c, r: r };
}
section("oracle: an alt-UOM line, a TYPED number shared by two lines of one item, AUTO lines incl. a non-stock one, NONE lines, a non-stock last line");
{
  const items = { 0: { code: "SRC" }, 1: { code: "RM-PLAIN" }, 2: { code: "RM-AUTO", batch: 1 }, 3: { code: "RM-LOT", batch: 1, rule: "Manual Input", conv: [[S.UOM, 1], [S.UOM_BOX, 12]] },
    4: { code: "RM-BOX", conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 5: { code: "NS-AUTO", stock_control: 0, batch: 1 }, 6: { code: "RM-PH" }, 7: { code: "NS-LAST", stock_control: 0, method: "Fixed Cost" },
    8: { code: "RM-AUTO2", batch: 1 } };
  const d = S.synth({ items: items, source: 0, picks: [{ bin: 1, qty: 2 }, { bin: 2, batch: 1, qty: 1.5, cat: "Blocked", mfg: "2026-01-01 00:00:00", exp: "2027-01-01 00:00:00" }],
    lines: [{ item: 1, total: 3 }, { item: 2, total: 2, batch: "Auto-generated batch number", mfg: "2026-10-01 00:00:00", exp: "2028-10-01 00:00:00" },
      { item: 3, total: 1, uom: S.UOM_BOX, batch: "LOT-7", remark: "first lot line" }, { item: 3, total: 3, batch: "lot-7 ", bin: 51, remark: "second" },
      { item: 4, uom: S.UOM_BOX, total: 2, bin: 52 }, { item: 5, total: 1, batch: "Auto-generated batch number" }, { item: 6, total: 1, batch: "Auto-generated batch number" },
      { item: 8, total: 4, batch: "" }, { item: 7, total: 1.5 }] });
  const { c, r } = oracle("mixed", d, { outMovements: [{ total_price: 64 }, { total_price: 10.25 }] });
  if (r.ready) {
    const R = r.parts.ENGINE_R;
    const B = r.parts.BATCH;
    eq("mixed: op 2 skips the two non-stock lines, R numbered over the stock lines", R.movements.map((m) => [m.movement_key, m.material_id]),
      [["R1", S.ITEM(1)], ["R2", S.ITEM(2)], ["R3", S.ITEM(3)], ["R4", S.ITEM(3)], ["R5", S.ITEM(4)], ["R6", S.ITEM(6)], ["R7", S.ITEM(8)]]);
    eq("mixed: alloc covers every line in line order (non-stock lines and the non-stock LAST line included)", R.alloc.map((a) => [a.line_index, a.item_id, a.movement_key]),
      [["1", S.ITEM(1), "R1"], ["2", S.ITEM(2), "R2"], ["3", S.ITEM(3), "R3"], ["4", S.ITEM(3), "R4"], ["5", S.ITEM(4), "R5"], ["6", S.ITEM(5), ""], ["7", S.ITEM(6), "R6"],
        ["8", S.ITEM(8), "R7"], ["9", S.ITEM(7), ""]]);
    eq("mixed: alt-UOM lines: share in the line UOM, base = the item's conversion (12 x)", [R.alloc[2].share_qty, R.alloc[2].base_qty, R.alloc[4].share_qty, R.alloc[4].base_qty],
      [1, 12, 2, 24]);
    eq("mixed: alloc.base_qty = idaUomOf (the engine's uomOf) on every line", R.alloc.map((a) => a.base_qty), d.form.stock_movement.map((l) => PR.idaUomOf(
      d.items.find((it) => it.id === l.item_selection), C.idaQ8(l.total_quantity), l.quantity_uom).baseQty));
    eq("mixed: BATCH rows (AUTO each, TYPED once per item + number, NONE none)", B.rows.map((b) => [b.key, b.kind, b.insert, b.batch_number, b.line_ids.length, b.initial_quantity]),
      [["B1", "AUTO", true, "", 1, "2.00000000"], ["B2", "TYPED", true, "LOT-7", 2, "15.00000000"], ["B3", "AUTO", false, "", 1, "1.00000000"], ["B4", "AUTO", true, "", 1, "4.00000000"]]);
    eq("mixed: the shared TYPED row = the first line's text, remarks, the sum of both lines' BASE quantities (12 + 3)", [B.rows[1].batch_number, B.rows[1].remark,
      B.rows[1].line_ids], ["LOT-7", "first lot line", [d.form.stock_movement[2].id, d.form.stock_movement[3].id]]);
    eq("mixed: the classic sent each TYPED line its own text", c.adds.filter((a) => a.material_id === S.ITEM(3)).map((a) => a.batch_number), ["LOT-7", "lot-7 "]);
    eq("mixed: the non-batch item with the placeholder is NONE (no row; the classic sent the placeholder text)",
      [R.alloc[6].batch_key, c.adds.find((a) => a.material_id === S.ITEM(6)).batch_number], ["", "Auto-generated batch number"]);
    eq("mixed: the non-stock AUTO line consumes a number (insert false), its alloc keeps no batch key", [B.rows[2].line_ids[0], B.rows[2].insert, R.alloc[5].batch_key],
      [d.form.stock_movement[5].id, false, ""]);
    eq("mixed: AUTO dates ride the request", B.rows[0].request, { item_id: S.ITEM(2), document_date: "2026-10-21 00:00:00", manufacturing_date: "2026-10-01 00:00:00",
      expired_date: "2028-10-01 00:00:00", organization_id: S.ORG });
    eq("mixed: BATCH items = every AUTO row's item (non-stock included)", B.items.map((x) => x.id), [S.ITEM(2), S.ITEM(5), S.ITEM(8)]);
    eq("mixed: alloc batch keys", R.alloc.map((a) => a.batch_key), ["", "B1", "B2", "B2", "", "", "", "B4", ""]);
    eq("mixed: counts", r.manifest.counts, { lines: 9, picks: 2, movementsI: 2, movementsR: 7, nonStockLines: 2, batchRows: 4, autoRows: 3, typedRows: 1, items: 9 });
    eq("mixed: ITEMS keep the non-stock items, source first, line order, each once", r.parts.ITEMS.itemDates.map((x) => x.id),
      [S.ITEM(0), S.ITEM(1), S.ITEM(2), S.ITEM(3), S.ITEM(4), S.ITEM(5), S.ITEM(6), S.ITEM(8), S.ITEM(7)].filter((v, i, a) => a.indexOf(v) === i));
    eq("mixed: op 1 picks (Blocked, a batch, its dates)", r.parts.ENGINE_I.movements.map((m) => [m.location_id, m.batch_id, m.inventory_category, m.manufacturing_date, m.expired_date]),
      [[S.BIN(1), null, "Unrestricted", null, null], [S.BIN(2), S.BATCH(1), "Blocked", "2026-01-01 00:00:00", "2027-01-01 00:00:00"]]);
    // the price D3 will compute: the classic's line values (per LINE unit, v6) = V2's per BASE unit x base qty (the v7 fix, CONTRACT section 5)
    const issued = 74.25;
    const v2 = PR.idaAllocate(issued, R.alloc);
    const lineValue = c.adds.map((a) => C.idaQ8(a.unit_price * C.idaQ8(a.quantity)));
    truthy("mixed: line values classic v6 = V2 within q8 (non-base UOM lines included)", v2.every((p, i) => Math.abs(C.idaQ8(p.unit_price * R.alloc[i].base_qty) - lineValue[i]) <= 1e-6
      || R.alloc[i].base_qty === 0), [v2, lineValue]);
    eq("mixed: the non-stock LAST line takes the remainder (value not received: no R movement)", [R.alloc[8].movement_key, C.idaQ8(v2[8].value) > 0], ["", true]);
    eq("mixed: V2's price differs from the classic's only on the BOX lines (v6 priced per line unit)", v2.map((p, i) => num(p.unit_price) === num(c.adds[i].unit_price)),
      [true, true, false, true, false, true, true, true, true]);
  }
}
section("oracle: base-UOM document with one line per item (the classic path the twins replay)");
{
  const d = S.synth({ items: Object.fromEntries([[0, { code: "SRC" }]].concat([...Array(12).keys()].map((i) => [i + 1, { code: "RM" + i, method: i % 3 === 0 ? "Weighted Average" : i % 3 === 1 ? "Fixed Cost" : "First In First Out", purchase_unit_price: 1.5 }]))),
    source: 0, picks: [{ bin: 1, qty: 3 }, { bin: 2, qty: 0 }, { bin: 3, qty: 1 }], lines: [...Array(12).keys()].map((i) => ({ item: i + 1, total: 0.5 + i, bin: 50 + (i % 3) })) });
  const { r } = oracle("twelve lines", d);
  if (r.ready) eq("twelve lines: the zero pick moves nothing", r.parts.ENGINE_I.movements.map((m) => [m.movement_key, m.location_id, m.quantity]), [["M1", S.BIN(1), 3], ["M2", S.BIN(3), 1]]);
}

// ------------------------------------------------------------------------------------------------ type traps, the lift context
section("type traps: string decimals, a bare 19-digit id, float residue; Processing never reaches the lifted code");
{
  const d = S.synth({ items: { 0: { code: "SRC" }, 1: { code: "RM1", conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 2: { code: "RM2" } }, source: 0, picks: [{ bin: 1, qty: "1.25" }, { bin: 2, qty: 0.1 + 0.2 }],
    lines: [{ item: 1, uom: S.UOM_BOX, total: 1.25 }, { item: 2, total: 0.1 + 0.2 }] });
  const base = L.runPrepare(d.spec);
  truthy("type traps: the plain rows READY", base.ready, [base.returned, base.failed]);
  const hdr = L.parseBig(d.spec.hdr[0].j);
  hdr.item_qty = "1.55000000";
  const lines = d.spec.lines.map((x) => L.parseBig(x.j));
  lines[0].total_quantity = "1.25000000";
  lines[1].total_quantity = "0.30000000";
  const text = lines.map((l) => ({ j: JSON.stringify(l).replace('"quantity_uom":"' + S.UOM_BOX + '"', '"quantity_uom":' + S.UOM_BOX) }));
  truthy("type traps: the bare id is in the row text", text[0].j.indexOf('"quantity_uom":' + S.UOM_BOX) >= 0);
  const spec = Object.assign({}, d.spec, { hdr: [L.jrow(hdr)], lines: text });
  spec.request = L.requestFor(spec.hdr, spec.lines, spec.items);
  eq("type traps: the fingerprint is the same over text decimals and the bare id", spec.request.lineFingerprint, d.spec.request.lineFingerprint);
  const r = L.runPrepare(spec);
  eq("type traps: the same parts", JSON.stringify(r.parts), JSON.stringify(base.parts));
  eq("type traps: quantities are q8 numbers", r.parts.ENGINE_I.movements.map((m) => m.quantity).concat(r.parts.ENGINE_R.movements.map((m) => m.quantity)), [1.25, 0.3, 1.25, 0.3]);
  eq("type traps: the bare 19-digit UOM id stays exact (27 apart from the base UOM)", [r.parts.ENGINE_R.movements[0].material_uom, r.parts.ENGINE_R.alloc[0].base_qty], [S.UOM_BOX, 15]);
  const c = L.runClassic(d.form, { items: d.items, stored: d.stored });
  eq("type traps: the classic sends the raw float, V2 its q8 (deliberate, CONTRACT section 5)", [c.subtracts[1].quantity, r.parts.ENGINE_I.movements[1].quantity], [0.30000000000000004, 0.3]);
  // the lift context: the adapted header carries the prevStatus, no lock field, the Manual Input rule as the number -9999
  const doc = L.built();
  const P = L.codeOf(doc, "code_node_DPplan", ["idaAdaptHeader", "idaAdaptLines", "idaAdaptItems", "idaAdaptStorage", "idaPlanContext", "idaPlanGate", "idaPlanRun", "idaRows"]);
  const h = P.idaRows(d.spec.hdr)[0];
  const header = P.idaAdaptHeader(h, "Draft");
  header.stock_movement = P.idaAdaptStorage(P.idaAdaptLines(d.spec.lines), d.spec.storage);
  const ctx0 = P.idaPlanContext(header, P.idaAdaptItems(d.spec.items), { docId: h.id, stock_movement_no: h.stock_movement_no }, "1", []);
  const gate = P.idaPlanGate(ctx0);
  const run = P.idaPlanRun(ctx0);
  eq("lift: a stored Processing row reaches the lifted code as Draft", [h.item_disassembly_status, header.item_disassembly_status, gate.fill.storedStatus, run.fill.storedStatus,
    "ida_v2_job_id" in header], ["Processing", "Draft", "Draft", "Draft", false]);
  eq("lift: code_validate passes the stored document (storage locations merged by line id from LINE_STORAGE)", [gate.validate, header.stock_movement.map((l) => l.storage_location_id)],
    [{ status: "Passed", message: "" }, [S.STORAGE, S.STORAGE]]);
  const lone = P.idaAdaptStorage(P.idaAdaptLines(d.spec.lines), [L.jrow({ id: L.parseBig(d.spec.lines[1].j).id, storage_location_id: null })]);
  eq("lift: a NULL storage location stays absent (code_validate then refuses it, as the classic)", lone.map((l) => "storage_location_id" in l), [false, false]);
  eq("lift: the fill-back wrote saveAs; the Manual Input rule stays the number -9999 (code_fillback keeps the typed number); the movements carry it",
    [run.fill.allData.item_disassembly_status, header.stock_movement_no_type, run.fill.allData.stock_movement_no, run.prep.stock_movement_no, run.cost.receipts[0].trx_no],
    ["Completed", -9999, "IDA-SYN-001", "IDA-SYN-001", "IDA-SYN-001"]);
  const auto = S.synth({ items: { 0: { code: "SRC" }, 1: { code: "RM1" } }, source: 0, header: { stock_movement_no_type: "2107022471794724866" }, lines: [{ item: 1 }] });
  const ah = P.idaRows(auto.spec.hdr)[0];
  const aheader = P.idaAdaptHeader(ah, "Draft");
  aheader.stock_movement = P.idaAdaptLines(auto.spec.lines);
  const arun = P.idaPlanRun(P.idaPlanContext(aheader, P.idaAdaptItems(auto.spec.items), { docId: ah.id, stock_movement_no: ah.stock_movement_no }, "1"));
  eq("lift: a numbering rule (not -9999): the fill-back's own copy says 'issued', the movements still the stored number",
    [aheader.stock_movement_no_type, arun.fill.allData.stock_movement_no, arun.prep.stock_movement_no], ["2107022471794724866", "issued", "IDA-SYN-001"]);
  const ar = L.runPrepare(auto.spec);
  eq("lift: ... and the planned movements carry it", [ar.parts.ENGINE_I.movements[0].trx_no, ar.parts.ENGINE_R.movements[0].trx_no], ["IDA-SYN-001", "IDA-SYN-001"]);
  // line order = numeric line_index, then id (stored id order differs)
  const ord = S.synth({ items: { 0: { code: "SRC" }, 1: { code: "A" }, 2: { code: "B" }, 3: { code: "C" } }, source: 0, lines: [{ item: 1 }, { item: 2 }, { item: 3 }] });
  const ls = ord.spec.lines.map((x) => L.parseBig(x.j));
  ls[0].line_index = "10";
  ls[1].line_index = "2";
  ls[2].line_index = "2";
  ls[2].id = "2113000000000000999";
  const ospec = Object.assign({}, ord.spec, { lines: ls.reverse().map(L.jrow), storage: ls.map((l) => L.jrow({ id: l.id, storage_location_id: S.STORAGE })) });
  ospec.request = L.requestFor(ospec.hdr, ospec.lines, ospec.items);
  const or = L.runPrepare(ospec);
  eq("line order: numeric line_index (2 < 10), ties by id (length, then text)", or.parts.ENGINE_R.movements.map((m) => m.material_id), [S.ITEM(3), S.ITEM(2), S.ITEM(1)]);
  eq("line order: the fill-back renumbers 1..n (what the labels show)", or.parts.ENGINE_R.alloc.map((a) => a.line_index), ["1", "2", "3"]);
}

// ------------------------------------------------------------------------------------------------ failure paths
section("failure paths (nothing moved; the unlock only after the lock check)");
const okd = S.synth({ items: { 0: { code: "SRC" }, 1: { code: "RM1" }, 2: { code: "RM2", batch: 1, rule: "Manual Input" } }, source: 0, picks: [{ bin: 1, qty: 2 }],
  lines: [{ item: 1, total: 2 }, { item: 2, total: 1, batch: "LOT-9", bin: 51 }] });
const UNLOCK = [{ id: S.IDA, item_disassembly_status: "Draft" }];
function failCase(label, mutate, want) {
  const spec = JSON.parse(JSON.stringify(okd.spec));
  mutate(spec);
  const r = L.runPrepare(spec);
  const f = r.failed || {};
  eq(label, [f.job_status, f.error_code, want.message === undefined ? undefined : f.error_message], [want.status || "FAILED", want.code, want.message]);
  eq(label + ": unlock / parts / READY / PLAN calls", [r.unlocks, r.stepRows.length, !!r.ready, r.calls.length], [want.unlock ? UNLOCK : [], 0, false, want.calls || 0]);
  if (r.failed) {
    eq(label + ": job row (lease released, row_version + 1, finished_at)", [f.lease_owner, f.lease_expires_at, f.next_attempt_at, f.row_version, f.progress_percent, !!f.finished_at],
      [null, null, null, 4, 0, true]);
    truthy(label + ": answer = the job read back", r.returned.job_status === f.job_status && r.returned.result_code === f.error_code, r.returned);
    if (want.unlock) {
      const order = r.db.writes.map((w) => w.table);
      truthy(label + ": the unlock before the FAILED write", order.indexOf("Item Disassembly") >= 0 && order.indexOf("Item Disassembly") < order.indexOf("GD Async Job"), order);
    }
  }
  return r;
}
const itemsWith = (n, patch) => (s) => (s.items = s.items.map((x) => {
  const it = L.parseBig(x.j);
  return L.jrow(it.id === S.ITEM(n) ? Object.assign(it, patch) : it);
}));
const hdrWith = (f) => (s) => {
  const h = L.parseBig(s.hdr[0].j);
  f(h);
  s.hdr = [L.jrow(h)];
  s.request = L.requestFor(s.hdr, s.lines, s.items);
};
const linesWith = (i, f) => (s) => {
  const ls = s.lines.map((x) => L.parseBig(x.j));
  f(ls[i]);
  s.lines = ls.map(L.jrow);
  s.request = L.requestFor(s.hdr, s.lines, s.items);
};
const pickOf = (patch) => hdrWith((h) => (h.temp_qty_data = JSON.stringify(C.idaJsonList(h.temp_qty_data).map((p) => Object.assign(p, patch)))));
failCase("not locked: another key's lock", (s) => (s.owner = { lock_ref: "IDA:other:key" }), { code: "IDA_NOT_LOCKED", message: C.IDA_TEXT.notLocked });
failCase("not locked: the IDA is Draft", (s) => (s.owner = { item_disassembly_status: "Draft" }), { code: "IDA_NOT_LOCKED" });
failCase("not locked: another job's IDA", (s) => (s.owner = { ida_v2_job_id: "2112100000000000999" }), { code: "IDA_NOT_LOCKED" });
failCase("not locked: the header row is another job's", hdrWith((h) => (h.ida_v2_job_id = "2112100000000000999")), { code: "IDA_NOT_LOCKED" });
failCase("not found: the IDA was deleted", (s) => {
  s.hdr = [];
  s.owner = { ida_id: null, item_disassembly_status: null, ida_v2_job_id: null };
}, { code: "IDA_NOT_FOUND", message: C.IDA_TEXT.notFound });
failCase("request: another action", (s) => (s.request.action = "REVERT"), { code: "IDA_INVALID_REQUEST", unlock: 1 });
failCase("request: saveAs Draft", (s) => (s.request.saveAs = "Draft"), { code: "IDA_INVALID_REQUEST", unlock: 1 });
failCase("request: the stored number is not the request's", (s) => (s.request.idaNo = "IDA-SYN-999"), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("request: the stored number is still the sentinel", hdrWith((h) => (h.stock_movement_no = "issued")), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("request: another IDA", (s) => (s.request.idaId = "2113000000000000002"), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("request: another organization", (s) => (s.job = { organization_id: "1123598813738675299" }), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("request: no fingerprint", (s) => (s.request.lineFingerprint = ""), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("lines changed after SUBMIT (fingerprint)", (s) => (s.request.lineFingerprint = "DF1:2:0000000000000000"), { code: "IDA_LINES_CHANGED", message: C.IDA_TEXT.linesChanged,
  unlock: 1 });
{
  const spec = JSON.parse(JSON.stringify(okd.spec));
  const ls = spec.lines.map((x) => L.parseBig(x.j));
  ls[1].batch_number = "LOT-10";
  spec.lines = ls.map(L.jrow);
  const r = L.runPrepare(spec);
  eq("lines changed: a batch number edited after SUBMIT", [r.failed && r.failed.error_code, r.unlocks], ["IDA_LINES_CHANGED", UNLOCK]);
  const spec2 = JSON.parse(JSON.stringify(okd.spec));
  const h = L.parseBig(spec2.hdr[0].j);
  h.temp_qty_data = h.temp_qty_data.replace('"sm_quantity":2', '"sm_quantity":3');
  spec2.hdr = [L.jrow(h)];
  eq("lines changed: a source pick edited after SUBMIT", L.runPrepare(spec2).failed.error_code, "IDA_LINES_CHANGED");
}
const planFailed = (why) => C.IDA_TEXT.planFailed(why);
failCase("eligibility: the source item not found", itemsWith(0, { id: "2113000000000000199" }), { code: "IDA_PLAN_FAILED", message: planFailed("item " + S.ITEM(0) + " not found"),
  unlock: 1 });
failCase("eligibility: a recovery item not found", (s) => (s.items = s.items.filter((x) => L.parseBig(x.j).id !== S.ITEM(2))), { code: "IDA_PLAN_FAILED",
  message: planFailed("item " + S.ITEM(2) + " not found"), unlock: 1 });
failCase("eligibility: a handling-unit pick", pickOf({ handling_unit_id: "2113000000000000333" }), { code: "IDA_PLAN_FAILED", message: planFailed("handling units"), unlock: 1 });
failCase("eligibility: temp_hu_data", hdrWith((h) => (h.temp_hu_data = '[{"handling_unit_id":"2113000000000000333"}]')), { code: "IDA_PLAN_FAILED",
  message: planFailed("handling units"), unlock: 1 });
failCase("eligibility: table_hu", hdrWith((h) => (h.table_hu = [{ id: "2113000000000000333" }])), { code: "IDA_PLAN_FAILED", message: planFailed("handling units"), unlock: 1 });
failCase("eligibility: a serial-numbered source item", itemsWith(0, { serial_number_management: 1 }), { code: "IDA_PLAN_FAILED", message: planFailed("serial-numbered source item"),
  unlock: 1 });
failCase("eligibility: the source item not stock controlled", itemsWith(0, { stock_control: 0 }), { code: "IDA_PLAN_FAILED", message: planFailed("source item not stock controlled"),
  unlock: 1 });
failCase("eligibility: the source item's stock control unset", itemsWith(0, { stock_control: null }), { code: "IDA_PLAN_FAILED",
  message: planFailed("item SRC has no stock control setting"), unlock: 1 });
failCase("eligibility: a recovery item's stock control unset", itemsWith(2, { stock_control: null }), { code: "IDA_PLAN_FAILED",
  message: planFailed("item RM2 has no stock control setting"), unlock: 1 });
failCase("eligibility: a Reserved pick", pickOf({ category: "Reserved" }), { code: "IDA_PLAN_FAILED", message: planFailed("Reserved stock"), unlock: 1 });
failCase("eligibility: no stock to receive (every recovery line non-stock)", (s) => [1, 2].forEach((n) => itemsWith(n, { stock_control: 0 })(s)), { code: "IDA_PLAN_FAILED",
  message: planFailed("no stock to receive"), unlock: 1 });
// the lifted code_validate refuses first, with the classic's own text (fix round 1): IDA_INVALID + ": nothing was moved."
const invalid = (text) => text.replace(/\.$/, "") + ": nothing was moved.";
failCase("no pick above zero: the classic gate", pickOf({ sm_quantity: 0 }), { code: "IDA_INVALID",
  message: invalid("No source stock has been allocated. Select the stock to disassemble."), unlock: 1 });
failCase("a line without an item", linesWith(1, (l) => (l.item_selection = "")), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("a receipt without a bin: the classic gate", linesWith(0, (l) => (l.location_id = null)), { code: "IDA_INVALID",
  message: invalid("Line 1 (line item 1): bin location is required."), unlock: 1 });
failCase("the lifted code fails (a null pick next to a real one)", hdrWith((h) => (h.temp_qty_data = "[null," + h.temp_qty_data.slice(1))), { code: "IDA_PLAN_BROKEN", unlock: 1 });
failCase("the classic gate cannot read the picks (temp_qty_data a JSON array, not its text)", hdrWith((h) => (h.temp_qty_data = JSON.parse(h.temp_qty_data))),
  { code: "IDA_INVALID", message: invalid("The selected stock data is invalid. Select the stock again."), unlock: 1 });
section("failure paths: the item-master window - the lifted code_validate on the stored document with the fresh rows (fix round 1)");
failCase("a recovery item made serial-managed after SUBMIT", itemsWith(1, { serial_number_management: 1 }), { code: "IDA_INVALID",
  message: invalid("Line 1 (line item 1): serial-managed items cannot be recovered yet."), unlock: 1 });
failCase("a recovery item made Manual Input batch after SUBMIT (its line says '-')", itemsWith(1, { item_batch_management: 1, batch_number_genaration: "Manual Input" }),
  { code: "IDA_INVALID", message: invalid("Line 1 (line item 1): Batch number is required."), unlock: 1 });
failCase("a recovery item made Manual Input batch after SUBMIT: its typed text is another item's number in this document", (s) => {
  linesWith(0, (l) => (l.batch_number = "LOT-9"))(s);
  itemsWith(1, { item_batch_management: 1, batch_number_genaration: "Manual Input" })(s);
}, { code: "IDA_INVALID", message: invalid("Line 2 (line item 2): Batch No LOT-9 is already used by another item in this document."), unlock: 1 });
failCase("a stored line without its storage location (LINE_STORAGE wired)", (s) => {
  const first = L.parseBig(s.lines[0].j).id;
  s.storage = s.storage.map((x) => {
    const r = L.parseBig(x.j);
    return L.jrow(r.id === first ? Object.assign(r, { storage_location_id: null }) : r);
  });
}, { code: "IDA_INVALID", message: invalid("Line 1 (line item 1): storage location is required."), unlock: 1 });
section("failure paths: a TYPED number already held (BATCH_TYPED_STORED, idaBatchKey)");
const holder = (n) => [{ id: "2105000000000000001", batch_number: n, material_id: "2113000000000000177", plant_id: S.PLANT, organization_id: S.ORG, transaction_no: "GRN-1" }];
const typedTaken = C.IDA_TEXT.typedTaken("Line 2 (line item 2)", "LOT-9");
failCase("typed held: the same text (another document) -> the classic gate's own refusal", (s) => (s.typed = holder("LOT-9").map(L.jrow)), { code: "IDA_INVALID",
  message: invalid("Line 2 (line item 2): Batch No LOT-9 already exists."), unlock: 1 });
failCase("typed held: another case and trailing spaces (utf8mb4_general_ci; the classic compares exactly) -> PREPARE's own check", (s) => (s.typed = holder("lot-9  ").map(L.jrow)),
  { code: "IDA_BATCH_DUPLICATE", message: typedTaken, unlock: 1 });
{
  const spec = JSON.parse(JSON.stringify(okd.spec));
  spec.typed = holder("LOT-8").map(L.jrow);
  eq("typed held: a row of another number (SQL candidate only) is not a match", L.runPrepare(spec).returned.job_status, "READY_TO_COMMIT");
  const ns = JSON.parse(JSON.stringify(okd.spec));
  itemsWith(2, { stock_control: 0 })(ns);
  ns.typed = holder("lot-9").map(L.jrow);
  const r = L.runPrepare(ns);
  eq("typed held: a non-stock line's number is not PREPARE's to check (no Batch row is planned for it)", [r.returned.job_status, r.parts.BATCH], ["READY_TO_COMMIT", undefined]);
  ns.typed = holder("LOT-9").map(L.jrow);
  const rx = L.runPrepare(ns);
  eq("typed held: ... the classic gate still refuses the exact number on its manual-batch line (classic parity)", [rx.failed && rx.failed.error_code, rx.failed && rx.failed.error_message],
    ["IDA_INVALID", invalid("Line 2 (line item 2): Batch No LOT-9 already exists.")]);
}
section("failure paths: 5,000 movements per leg");
{
  const picks = (n) => [...Array(n).keys()].map((i) => ({ bin: i % 50, qty: 1 }));
  const many = S.synth({ items: { 0: { code: "SRC" }, 1: { code: "RM1" } }, source: 0, picks: picks(5001), lines: [{ item: 1 }] });
  const r = L.runPrepare(many.spec);
  eq("5,001 source picks: IDA_SPLIT_REQUIRED", [r.failed.error_code, r.failed.error_message, r.unlocks, r.calls.length],
    ["IDA_SPLIT_REQUIRED", C.IDA_TEXT.splitRequired(5001, "source picks"), UNLOCK, 0]);
  const five = S.synth({ items: { 0: { code: "SRC" }, 1: { code: "RM1" } }, source: 0, picks: picks(5000), lines: [{ item: 1 }] });
  eq("5,000 source picks: READY", L.runPrepare(five.spec).returned.job_status, "READY_TO_COMMIT");
  const its = Object.fromEntries([[0, { code: "SRC" }], [1, { code: "RM1" }], [2, { code: "NS", stock_control: 0 }]]);
  const lines = (n, ns) => [...Array(n).keys()].map((i) => ({ item: i < ns ? 2 : 1, total: 1, bin: 50 + (i % 20) }));
  const rl = L.runPrepare(S.synth({ items: its, source: 0, lines: lines(5001, 0) }).spec);
  eq("5,001 stock recovery lines: IDA_SPLIT_REQUIRED", [rl.failed.error_code, rl.failed.error_message], ["IDA_SPLIT_REQUIRED", C.IDA_TEXT.splitRequired(5001, "recovery lines")]);
  const ok = L.runPrepare(S.synth({ items: its, source: 0, lines: lines(5003, 3) }).spec);
  eq("5,003 recovery lines of which 3 non-stock (5,000 movements): READY", [ok.returned.job_status, ok.manifest && ok.manifest.counts.movementsR], ["READY_TO_COMMIT", 5000]);
}
section("failure paths: the engine's PLAN answers (LABELS-mapped messages)");
const binOf = (n) => "BIN-" + S.BIN(n).slice(-3);
failCase("PLAN op 1: 400 Insufficient quantity", (s) => (s.planI = { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M1)" }),
  { code: "IDA_INVENTORY_INSUFFICIENT", message: "Insufficient quantity - source pick 1 (SRC), bin " + binOf(1) + " (Unrestricted)", unlock: 1, calls: 2 });
failCase("PLAN op 2: a 401 result inside a 200", (s) => (s.planR = (p) => Object.assign(L.planOk(p), { results: L.planOk(p).results.map((x, i) => (i === 1 ? { movement_key: "R2",
  direction: "ADD", code: "401", message: "Skipping inventory update for item (stock control = 0)" } : x)) })),
  { code: "IDA_PLAN_SKIPPED", message: "Skipping inventory update for item (stock control = 0) - line 2 (RM2), into bin " + binOf(51) + " (Unrestricted): nothing was moved.", unlock: 1,
    calls: 2 });
failCase("PLAN op 2: a guard refusal by index", (s) => (s.planR = { code: "400", result_code: "REQUEST_INVALID", message: "movements[1] location_id must be digits" }),
  { code: "IDA_INVENTORY_REQUEST_INVALID", message: "location_id must be digits - line 2 (RM2), into bin " + binOf(51) + " (Unrestricted)", unlock: 1, calls: 2 });
failCase("PLAN op 2: 400 duplicate balance at a receipt bin", (s) => (s.planR = { code: "400", result_code: "DUPLICATE_BALANCE", message: "More than one item_balance row for x (movement R1)" }),
  { code: "IDA_INVENTORY_DUPLICATE_BALANCE", message: "More than one item_balance row for x - line 1 (RM1), into bin " + binOf(50) + " (Unrestricted)", unlock: 1, calls: 2 });
failCase("PLAN op 1: 400 without a movement", (s) => (s.planI = { code: "400", result_code: "UNSUPPORTED_PRECISION", message: "The tenant's number rule x is not a rounding" }),
  { code: "IDA_INVENTORY_UNSUPPORTED_PRECISION", message: "The tenant's number rule x is not a rounding", unlock: 1, calls: 2 });
failCase("PLAN op 1: 400 without a result_code", (s) => (s.planI = { code: "400", message: "workflow failed" }), { code: "IDA_PLAN_FAILED", unlock: 1, calls: 2 });
failCase("PLAN op 1: 500", (s) => (s.planI = { code: "500", result_code: "REQUIRES_REVIEW", message: "x" }), { code: "IDA_PLAN_FAILED", unlock: 1, calls: 2 });
failCase("PLAN op 2: no answer", (s) => (s.planR = {}), { code: "IDA_PLAN_FAILED", message: planFailed("the stock check answered nothing."), unlock: 1, calls: 2 });
failCase("PLAN op 2: fewer results than movements", (s) => (s.planR = (p) => Object.assign(L.planOk(p), { results: L.planOk(p).results.slice(1) })),
  { code: "IDA_PLAN_FAILED", message: planFailed("the stock check answered 1 results for 2 movements."), unlock: 1, calls: 2 });
failCase("PLAN op 2: unreadable results text", (s) => (s.planR = (p) => Object.assign(L.planOk(p), { results: "[{not json" })), { code: "IDA_PLAN_FAILED", unlock: 1, calls: 2 });
failCase("PLAN both refuse: op 1's reason wins", (s) => {
  s.planI = { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M1)" };
  s.planR = { code: "400", result_code: "DUPLICATE_BALANCE", message: "x (movement R1)" };
}, { code: "IDA_INVENTORY_INSUFFICIENT", unlock: 1, calls: 2 });
{
  const textAnswer = (p) => Object.assign(L.planOk(p), { results: JSON.stringify(L.planOk(p).results) });
  eq("PLAN answers with results as JSON text -> READY_TO_COMMIT (IA R7)", L.runPrepare(Object.assign({}, okd.spec, { planI: textAnswer, planR: textAnswer })).returned.job_status,
    "READY_TO_COMMIT");
}
section("entry");
{
  const noop = (label, mutate, code) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    mutate(spec);
    const r = L.runPrepare(spec);
    eq(label, [r.returned.result_code, r.returned.job_status, r.db.writes.length, r.calls.length, Object.keys(r.sql)], [code, "", 0, 0, ["sql_node_DPjob"]]);
    truthy(label + ": evidence NOOP", JSON.parse(r.returned.evidence).path === "NOOP", r.returned);
  };
  noop("not VALIDATING", (s) => (s.job = { job_status: "READY_TO_COMMIT" }), "JOB_ILLEGAL_TRANSITION");
  noop("the worker's lease expired", (s) => (s.job = { lease_live: 0 }), "JOB_ROW_VERSION_CONFLICT");
  noop("another command", (s) => (s.job = { command: "COMPLETE_IA" }), "IDA_INVALID_DATA");
  noop("job not found", (s) => (s.jobRows = [{ db_now: L.DB_NOW, id: null }]), "IDA_INVALID_DATA");
  noop("job deleted", (s) => (s.job = { is_deleted: 1 }), "IDA_INVALID_DATA");
  const rej = L.runPrepare(Object.assign({}, okd.spec, { jobId: "12a" }));
  eq("guard: job_id not digits", [rej.returned.result_code, rej.db.writes.length, Object.keys(rej.sql).length, JSON.parse(rej.returned.evidence).path],
    ["IDA_INVALID_DATA", 0, 0, "REJECTED_INPUT"]);
  const review = (label, mutate) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    mutate(spec);
    const r = L.runPrepare(spec);
    eq(label + ": REQUIRES_REVIEW, no unlock, no reads", [r.failed && r.failed.job_status, r.failed && r.failed.error_code, r.failed && r.failed.error_message, r.unlocks,
      Object.keys(r.sql).sort()], ["REQUIRES_REVIEW", "IDA_PREV_STATUS_UNKNOWN", C.IDA_TEXT.prevUnknown, [], ["sql_node_DPback", "sql_node_DPjob"]]);
  };
  review("prevStatus Completed", (s) => (s.request.prevStatus = "Completed"));
  review("prevStatus missing", (s) => delete s.request.prevStatus);
  review("an unreadable request", (s) => (s.job = { request_payload: "{not json" }));
  review("an unreadable request on an unlinked job (no unlock either)", (s) => (s.job = { request_payload: "", correlation_id: "", linked_ida: S.IDA }));
}
section("R8: an Add that stopped before link: FAILED written together with the link (STATUS then answers the IDA)");
{
  const unlinked = (job) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    spec.request = Object.assign({}, spec.request, { idaId: "", idaNo: "", issuedNo: "", lineFingerprint: "", pageStatus: "Add" });
    spec.job = Object.assign({ correlation_id: "", linked_ida: S.IDA, linked_ida_no: "IDA-2610-0042", linked_ida_no_type: "2107022471794724866" }, job || {});
    return { spec: spec, r: L.runPrepare(spec) };
  };
  const { spec, r } = unlinked();
  eq("R8: one job write, FAILED + the link", r.jobUps.map((j) => [j.job_status, j.error_code, j.error_message, j.correlation_id, j.causation_id]),
    [["FAILED", "IDA_INVALID_REQUEST", C.IDA_TEXT.unlinked, "IDA|" + S.IDA, S.IDA]]);
  const req = L.parseBig(r.jobUps[0].request_payload);
  eq("R8: request + idaId / idaNo / issuedNo (the number this Add issued), the rest kept", req,
    Object.assign({}, spec.request, { idaId: S.IDA, idaNo: "IDA-2610-0042", issuedNo: "IDA-2610-0042" }));
  eq("R8: the FAILED row's own props (lease released, row_version + 1)", [r.jobUps[0].lease_owner, r.jobUps[0].row_version, r.jobUps[0].progress_percent, !!r.jobUps[0].finished_at],
    [null, 4, 0, true]);
  eq("R8: the IDA released to Draft before the job write; no reads, no PLAN", [r.unlocks, r.db.writes.map((w) => w.table), Object.keys(r.sql).sort(), r.calls.length],
    [[{ id: S.IDA, item_disassembly_status: "Draft" }], ["Item Disassembly", "GD Async Job"], ["sql_node_DPback", "sql_node_DPjob"], 0]);
  const m = String(r.jobUps[0].correlation_id).match(/^IDA\|([0-9]{1,20})$/);
  eq("R8: STATUS would answer ida_id / ida_no", [m && m[1], req.idaNo], [S.IDA, "IDA-2610-0042"]);
  eq("R8: answer = the job read back", [r.returned.job_status, r.returned.result_code], ["FAILED", "IDA_INVALID_REQUEST"]);
  eq("R8: a Manual Input number is not an issued one", L.parseBig(unlinked({ linked_ida_no: "MAN-0001", linked_ida_no_type: "-9999" }).r.jobUps[0].request_payload).issuedNo, "");
  eq("R8: the sentinel is no number", L.parseBig(unlinked({ linked_ida_no: "issued" }).r.jobUps[0].request_payload).idaNo, "");
  const none = unlinked({ linked_ida: null, linked_ida_no: null, linked_ida_no_type: null }).r;
  eq("R8: no IDA left Processing -> plain FAILED, no link, no unlock", none.jobUps.map((j) => [j.job_status, "correlation_id" in j, "request_payload" in j]).concat([none.unlocks]),
    [["FAILED", false, false], []]);
  eq("R8: a linked (correlated) job never takes this branch", L.runPrepare(okd.spec).jobUps.some((j) => "correlation_id" in j), false);
}

// ------------------------------------------------------------------------------------------------ the deployed engine planner
section("the deployed INVENTORY_BULK_APPLY v10 (base/) plans PREPARE's two operations (its reads mocked from synthetic balances)");
{
  const items = { 0: { code: "SRC", batch: 1, conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 1: { code: "RM-FIFO" }, 2: { code: "RM-WA", method: "Weighted Average" },
    3: { code: "RM-FIX", method: "Fixed Cost", purchase_unit_price: 2.5, conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 4: { code: "RM-AUTO", batch: 1 }, 5: { code: "NS", stock_control: 0 },
    6: { code: "RM-LOT", batch: 1, rule: "Manual Input" } };
  const d = S.synth({ items: items, source: 0, header: { item_uom: S.UOM_BOX }, picks: [{ bin: 1, batch: 1, qty: 1.5 }, { bin: 2, batch: 2, qty: 0.5, cat: "Blocked" }],
    lines: [{ item: 1, total: 4 }, { item: 2, total: 2 }, { item: 3, total: 2, uom: S.UOM_BOX }, { item: 4, total: 3, batch: "Auto-generated batch number" }, { item: 5, total: 1 },
      { item: 6, total: 1, batch: "LOT-1" }] });
  const r = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, 1000) }));
  const [aI, aR] = r.engineAnswers;
  eq("real engine: op 1 PLAN_OK, every result 200", [aI && aI.code, aI && aI.result_code, aI && C.idaJsonList(aI.results).map((x) => x.code)], ["200", "OK", ["200", "200"]]);
  eq("real engine: op 2 PLAN_OK, every R 200", [aR && aR.code, aR && aR.result_code, aR && C.idaJsonList(aR.results).map((x) => [x.movement_key, x.code])],
    ["200", "OK", [["R1", "200"], ["R2", "200"], ["R3", "200"], ["R4", "200"], ["R5", "200"]]]);
  eq("real engine: the job READY_TO_COMMIT", r.returned.job_status, "READY_TO_COMMIT");
  if (aI && aR && r.ready) {
    const fix = C.idaJsonList(aR.results)[2];
    eq("real engine: the Fixed Cost BOX line received at purchase_unit_price per BASE unit: total / unit = alloc.base_qty (the engine's uomOf)",
      [fix.unit_price, num(fix.total_price / fix.unit_price), r.parts.ENGINE_R.alloc[2].base_qty], [2.5, 24, 24]);
    eq("real engine: the source BOX picks issue 12 x their quantity at 2.5", C.idaJsonList(aI.results).map((x) => x.total_price), [45, 15]);
  }
  const short = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, (p) => (p.balance_id.slice(-1) === "1" ? 3 : 1000)) }));
  eq("real engine: short stock on the second pick -> IDA_INVENTORY_INSUFFICIENT naming it", [short.failed && short.failed.error_code, short.failed && short.failed.error_message],
    ["IDA_INVENTORY_INSUFFICIENT", "Insufficient quantity - source pick 2 (SRC), bin " + binOf(2) + " (Blocked)"]);
  eq("real engine: nothing written but the unlock and the FAILED job", [short.stepRows.length, short.unlocks, short.jobUps.length], [0, [{ id: S.IDA, item_disassembly_status: "Draft" }], 1]);
  const flip = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, 1000, (it) => (it.id === S.ITEM(2) ? { stock_control: 0 } : {})) }));
  eq("real engine: a recovery item non-stock in the engine's own read (401 inside a 200) -> IDA_PLAN_SKIPPED naming the line",
    [flip.failed && flip.failed.error_code, flip.failed && flip.failed.error_message],
    ["IDA_PLAN_SKIPPED", "Skipping inventory update for item (stock control = 0) - line 2 (RM-WA), into bin " + binOf(50) + " (Unrestricted): nothing was moved."]);
  const st = S.engineState(d, 1000);
  const dupRow = (id) => ({ id: id, material_id: S.ITEM(3), location_id: S.BIN(50), plant_id: S.PLANT, organization_id: S.ORG, unrestricted_qty: "0", reserved_qty: "0", block_qty: "0",
    qualityinsp_qty: "0", intransit_qty: "0", balance_quantity: "0" });
  st.bal.push(dupRow("2113000000000099998"), dupRow("2113000000000099999"));
  const dup = L.runPrepare(Object.assign({}, d.spec, { engine: st }));
  eq("real engine: a duplicate balance at a receipt bin -> IDA_INVENTORY_DUPLICATE_BALANCE (op 2's PLAN)", [dup.failed && dup.failed.error_code,
    /- line 3 \(RM-FIX\), into bin BIN-550 \(Unrestricted\)$/.test(dup.failed && dup.failed.error_message)], ["IDA_INVENTORY_DUPLICATE_BALANCE", true]);
  const mig = S.engineState(d, 1000);
  mig.wa.push({ id: "2113000000000099997", material_id: S.ITEM(0), plant_id: S.PLANT, organization_id: S.ORG, batch_id: S.BATCH(1), wa_quantity: "5", wa_cost_price: "1", created_at: "2026-10-01 00:00:00" });
  const cm = L.runPrepare(Object.assign({}, d.spec, { engine: mig }));
  eq("real engine: FIFO + WA rows on a source batch -> IDA_INVENTORY_UNSUPPORTED_COSTING", cm.failed && cm.failed.error_code, "IDA_INVENTORY_UNSUPPORTED_COSTING");
}

// ------------------------------------------------------------------------------------------------ sizes
section("size: node data and time of one PREPARE run (sim, the deployed engine planner)");
for (const n of [830, 2000]) {
  const items = Object.fromEntries([[0, { code: "SRC" }]].concat([...Array(n).keys()].map((i) => [i + 1, { code: "RM-" + i, batch: i % 10 === 0 ? 1 : 0,
    rule: i % 20 === 0 ? "Manual Input" : undefined, conv: i % 7 === 0 ? [[S.UOM, 1], [S.UOM_BOX, 12]] : undefined }])));
  const lines = [...Array(n).keys()].map((i) => ({ item: i + 1, total: 1 + (i % 3), uom: i % 7 === 0 ? S.UOM_BOX : undefined, bin: 50 + (i % 40),
    batch: i % 20 === 0 ? "LOT-" + i : i % 10 === 0 ? "Auto-generated batch number" : "-", remark: "line remark " + i }));
  const d = S.synth({ items: items, source: 0, picks: [{ bin: 1, qty: 1 }], lines: lines });
  const r = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, 100000) }));
  const mb = (x) => (x / 1048576).toFixed(1);
  truthy(n + " lines: READY with " + n + " receipts", r.ready && r.parts.ENGINE_R.movements.length === n, [r.returned, r.failed]);
  if (!r.ready) continue;
  const plan = JSON.stringify(r.out.code_node_DPplan).length;
  const prep = r.sizes.IDA_V2_PREPARE || r.bytes;
  const eng = r.sizes.INVENTORY_BULK_APPLY || 0;
  L.note(n + " lines: " + r.ms + " ms in the sim; PREPARE node outputs " + mb(prep) + " MB (the plan node " + mb(plan) + " MB), engine PLAN run " + mb(eng) + " MB; " + r.stepRows.length
    + " part rows " + JSON.stringify(Object.fromEntries(Object.entries(r.manifest.parts).map(([k, v]) => [k, v.length]))) + "; op 2 request " + mb(JSON.stringify(r.calls.length ? r.calls[1].params
    : { movements: r.parts.ENGINE_R.movements }).length) + " MB");
  truthy(n + " lines: PREPARE's own node data within the ~35 MB run budget", prep < 35 * 1048576, prep);
  const typedN = lines.filter((l, i) => i % 20 === 0).length;
  const autoN = lines.filter((l, i) => i % 10 === 0 && i % 20 !== 0).length;
  eq(n + " lines: counts", [r.manifest.counts.batchRows, r.manifest.counts.typedRows, r.manifest.counts.autoRows, r.manifest.counts.movementsR], [typedN + autoN, typedN, autoN, n]);
  if (n === 2000) {
    shapes("2,000 lines", r);
    truthy("2,000 lines: multi-chunk parts reassemble", r.manifest.parts.ENGINE_R.length > 1 && JSON.stringify(r.parts.ENGINE_R.alloc).length > 0, r.manifest.parts);
  }
}

L.done();
