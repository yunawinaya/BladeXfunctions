// IA_V2_PREPARE tests (package A). usage: node scratchpad/iav2/test/prepare/test_prepare.js
// Every case runs the BUILT Item Assembly & BOM/AsyncV2/IA_V2_PREPARE.json end to end (test/prepare/lib.js): goldens against five
// recorded classic IA_SAVE v11 runs, the classic itself run as the oracle for synthesized documents, failure paths, manifest shape.
const L = require("./lib.js");
const { C, FP, eq, truthy, section } = L;

const ENGINE_I_KEYS = ["movement_key", "direction", "plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "parent_trx_no",
  "inventory_category", "location_id", "batch_id", "manufacturing_date", "expired_date", "doc_date", "isMovingInv", "handling_unit_id"];
const ENGINE_R_KEYS = ["movement_key", "direction", "plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "parent_trx_no",
  "inventory_category", "location_id", "batch_id", "unit_price", "doc_date", "manufacturing_date", "expired_date", "remark", "remark2", "remark3", "isMovingInv", "handling_unit_id"];
const BATCH_KEYS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date",
  "expired_date"];
const MANIFEST_KEYS = ["v", "prepared_by", "job_id", "ia_id", "ia_no", "action", "prevStatus", "saveAs", "organization_id", "plant_id", "nonce", "lineFingerprint", "batchMode",
  "parts", "counts"];
// a date as the DB stores it: the classic sends the form's text ('2026-10-16', '2026-10-16 00:00:00.000'), V2 the stored DATE_FORMAT
const dbDate = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?)?$/);
  return m ? m[1] + " " + (m[2] || "00:00:00") : "?" + v;
};
const num = (v) => C.iaQ8(v);
// one V2 SUBTRACT against the classic's recorded wf_subtract params (minus itemData): every key it sent, null = absent
function sameIssue(label, got, want) {
  const covered = ["plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "inventory_category", "location_id", "batch_id",
    "manufacturing_date", "expired_date", "handling_unit_id", "doc_date"];
  truthy(label + " sends no key V2 lacks", Object.keys(want).every((k) => covered.indexOf(k) >= 0), Object.keys(want));
  eq(label + " keys", Object.keys(got), ENGINE_I_KEYS);
  const pick = (m) => ({ plant_id: m.plant_id, organization_id: m.organization_id, material_id: m.material_id, quantity: num(m.quantity), material_uom: m.material_uom || "",
    transaction_type: m.transaction_type, trx_no: m.trx_no, inventory_category: m.inventory_category, location_id: m.location_id, batch_id: m.batch_id || null,
    manufacturing_date: dbDate(m.manufacturing_date), expired_date: dbDate(m.expired_date), doc_date: dbDate(m.doc_date), handling_unit_id: m.handling_unit_id || null });
  eq(label + " params", pick(got), pick(want));
  eq(label + " V2-only keys", [got.direction, got.parent_trx_no, got.isMovingInv, typeof got.quantity], ["SUBTRACT", "", 0, "number"]);
}
function sameReceipt(label, got, want) {
  const covered = ["plant_id", "organization_id", "material_id", "quantity", "material_uom", "transaction_type", "trx_no", "inventory_category", "location_id", "batch_number",
    "unit_price", "doc_date", "manufacturing_date", "expired_date", "remark", "remark2", "remark3", "isMovingInv"];
  truthy(label + " sends no key V2 lacks", Object.keys(want).every((k) => covered.indexOf(k) >= 0), Object.keys(want));
  eq(label + " keys", Object.keys(got), ENGINE_R_KEYS);
  const pick = (m) => ({ plant_id: m.plant_id, organization_id: m.organization_id, material_id: m.material_id, quantity: num(m.quantity), material_uom: m.material_uom || "",
    transaction_type: m.transaction_type, trx_no: m.trx_no, inventory_category: m.inventory_category, location_id: m.location_id, doc_date: dbDate(m.doc_date),
    manufacturing_date: dbDate(m.manufacturing_date), expired_date: dbDate(m.expired_date), remark: m.remark || "", remark2: m.remark2 || "", remark3: m.remark3 || "",
    isMovingInv: Number(m.isMovingInv) });
  eq(label + " params", pick(got), pick(want));
  eq(label + " COMMIT's two values unset", [got.unit_price, got.batch_id, got.direction, got.parent_trx_no, got.handling_unit_id], [0, null, "ADD", "", null]);
}

// ------------------------------------------------------------------------------------------------ goldens
const GOLDENS = ["dev_fixedcost_manualbatch", "dev_fifo_nonbatch", "prod_edit_genbatch", "prod_add_fifo_nonbatch", "prod_multilayer_fifo"];
for (const name of GOLDENS) {
  if (!L.hasFixture(name)) {
    console.log("-- golden " + name + ": SKIPPED (no " + name + ".json in " + L.PROD_FIXTURES + ")");
    continue;
  }
  const fx = L.fixture(name);
  section("golden " + name + " (" + fx.env + " " + fx.run + ": " + fx.note + ")");
  const manual = name === "dev_fixedcost_manualbatch";
  // the stored lines are what the run wrote (by line_index: add-node records carry no line ids)
  const nodes = fx.parent.nodes;
  const recRaw = (nodes.get_ia || nodes.add_ia).response;
  const rec = Array.isArray(recRaw) ? recRaw[0] : recRaw.data || recRaw;
  const storedLines = fx.db.lines.map((r) => L.parseBig(r.j));
  for (const l of rec.stock_movement) {
    const s = storedLines.find((x) => String(x.line_index) === String(l.line_index));
    truthy(name + " line " + l.line_index + " unchanged since the run", s && s.temp_qty_data === l.temp_qty_data && s.item_selection === l.item_selection &&
      String(s.quantity_uom) === String(l.quantity_uom) && num(s.total_quantity) === num(l.total_quantity), [s && s.temp_qty_data, l.temp_qty_data]);
  }
  // a Manual Input batch parent is not eligible (section 7): PREPARE refuses it; its parameters are checked with the rule read as
  // 'According To System Settings' (the classic's params do not depend on the rule)
  if (manual) {
    const r0 = L.runPrepare(L.goldenSpec(fx));
    eq(name + " refused", [r0.failed && r0.failed.job_status, r0.failed && r0.failed.error_code, r0.failed && r0.failed.error_message],
      ["FAILED", "IA_PLAN_FAILED", "The completion could not be prepared: the assembled item's batch number is entered manually."]);
    eq(name + " refused: unlocked, nothing else written, no PLAN call", [r0.unlocks, r0.stepRows.length, r0.calls.length], [[{ id: fx.ia_id, item_assembly_status: "Draft" }], 0, 0]);
  }
  const spec = L.goldenSpec(fx, manual ? (it) => Object.assign(it, it.item_batch_management === 1 ? { batch_number_genaration: "According To System Settings" } : {}) : null);
  const r = L.runPrepare(spec);
  truthy(name + " READY_TO_COMMIT", r.ready && r.returned.job_status === "READY_TO_COMMIT", [r.returned, r.failed]);
  if (!r.ready) continue;
  const engI = r.parts.ENGINE_I;
  const engR = r.parts.ENGINE_R;
  eq(name + " op 1 movement count = the classic's SUBTRACT calls", engI.movements.length, fx.children.subtract.length);
  engI.movements.forEach((m, i) => {
    eq(name + " M" + (i + 1) + " key", m.movement_key, "M" + (i + 1));
    sameIssue(name + " M" + (i + 1), m, fx.children.subtract[i].params);
  });
  sameReceipt(name + " R1", engR.movements[0], fx.children.add[0].params);
  // value parity of the date texts: what V2 sends = what the classic's own movement rows store (text is stored verbatim)
  const outs = fx.db.movements.filter((m) => m.movement === "OUT");
  const inR = fx.db.movements.find((m) => m.movement === "IN");
  eq(name + " doc_date = the classic's stored OUT rows'", engI.movements.map((m) => m.doc_date), outs.map((m) => m.doc_date));
  eq(name + " R1 dates = the classic's stored IN row's", [engR.movements[0].doc_date, engR.movements[0].manufacturing_date, engR.movements[0].expired_date],
    [inR.doc_date, inR.mfg, inR.exp]);
  eq(name + " parent_trx_no '' = the classic's stored rows'", fx.db.movements.map((m) => m.parent_trx_no), fx.db.movements.map(() => ""));
  // receiptBaseQty = the stored IN row's base_qty; the price formula reproduces the classic's computed unit_price (base UOM)
  const inRow = fx.db.movements.find((m) => m.movement === "IN");
  const outTotal = fx.db.movements.filter((m) => m.movement === "OUT").reduce((n, m) => n + parseFloat(m.total_price), 0);
  const parent = fx.db.items.map((x) => L.parseBig(x.j)).find((it) => it.id === engR.movements[0].material_id);
  eq(name + " receiptBaseQty = the stored receipt's base_qty", engR.receiptBaseQty, num(inRow.base_qty));
  eq(name + " assemblyCost = the item's", engR.assemblyCost, num(parent.assembly_cost));
  const PR = require("../../code/shared/price.js");
  eq(name + " receiptUnitPrice(stored OUT total) = the classic's sent unit_price", PR.receiptUnitPrice({ outTotals: [outTotal], receiptBaseQty: engR.receiptBaseQty,
    assemblyCost: engR.assemblyCost }), num(fx.children.add[0].params.unit_price));
  eq(name + " ENGINE parts' request heads", [engI.operation_key, engI.mode, engI.organization_id, engR.operation_key, engR.mode],
    ["IAC|" + L.JOB + "|I", "APPLY", spec.org, "IAC|" + L.JOB + "|R", "APPLY"]);
  // BATCH = the classic's own Batch row (ADD_INVENTORY add_node_F9KqZLfd) for a batch parent; none for a non-batch parent
  const classicBatch = fx.db.batch[0];
  if (classicBatch) {
    eq(name + " batchMode", r.manifest.batchMode, "insert");
    eq(name + " BATCH keys", [r.parts.BATCH.mode, Object.keys(r.parts.BATCH.row)], ["insert", BATCH_KEYS]);
    const b = r.parts.BATCH.row;
    eq(name + " BATCH row = the classic's Batch row", BATCH_KEYS.map((k) => (k === "initial_quantity" ? num(b[k]) : k.indexOf("_date") > 0 ? dbDate(b[k]) : b[k] === null ? "" : b[k])),
      BATCH_KEYS.map((k) => (k === "initial_quantity" ? num(classicBatch[k]) : k.indexOf("_date") > 0 ? dbDate(classicBatch[k]) : classicBatch[k] === null ? "" : classicBatch[k])));
    eq(name + " BATCH initial_quantity is a fixed-scale string", typeof b.initial_quantity === "string" && /^[0-9]+\.[0-9]{8}$/.test(b.initial_quantity), true);
  } else {
    eq(name + " no BATCH part for a non-batch parent", [r.manifest.batchMode, r.parts.BATCH, "BATCH" in r.manifest.parts], ["none", undefined, false]);
  }
  // ITEMS = the classic's code_item_txn ids (parent first, then every line's item)
  eq(name + " ITEMS = code_item_txn's ids", r.parts.ITEMS, { itemDates: nodes.code_item_txn.response.updates.map((u) => ({ id: u.id })) });
  // LABELS: one per movement + R1, the bins of the picks
  const bins = {};
  for (const b of fx.db.bins) bins[L.parseBig(b.j).id] = L.parseBig(b.j).bin;
  eq(name + " LABELS keys", Object.keys(r.parts.LABELS), engI.movements.map((m) => m.movement_key).concat(["R1"]));
  eq(name + " LABELS bins", Object.values(r.parts.LABELS).map((l) => l.bin), engI.movements.map((m) => bins[m.location_id]).concat([bins[engR.movements[0].location_id]]));
  // the two PLAN calls: the parts' movements, mode PLAN, op 2 at unit_price 0 and no batch
  eq(name + " PLAN calls", r.calls.map((c) => [c.params.operation_key, c.params.mode, c.params.organization_id]),
    [["IAC|" + L.JOB + "|I", "PLAN", spec.org], ["IAC|" + L.JOB + "|R", "PLAN", spec.org]]);
  eq(name + " PLAN op 1 = ENGINE_I movements", r.calls[0].params.movements, engI.movements);
  eq(name + " PLAN op 2 = ENGINE_R movements", r.calls[1].params.movements, engR.movements);
  // manifest + READY row (section 3 / 5)
  eq(name + " manifest keys", Object.keys(r.manifest), MANIFEST_KEYS);
  eq(name + " manifest head", [r.manifest.v, r.manifest.prepared_by, r.manifest.job_id, r.manifest.ia_id, r.manifest.ia_no, r.manifest.action, r.manifest.prevStatus,
    r.manifest.saveAs, r.manifest.organization_id, r.manifest.lineFingerprint], [1, "IA_V2_PREPARE", L.JOB, fx.ia_id, fx.trx_no, "DIRECT", "Draft", "Completed", spec.org,
    spec.request.lineFingerprint]);
  eq(name + " manifest counts", r.manifest.counts, { lines: storedLines.length, picks: fx.children.subtract.length, movementsI: fx.children.subtract.length, nonStockLines: 0,
    items: nodes.code_item_txn.response.updates.length });
  const names = Object.values(r.manifest.parts).flat();
  truthy(name + " part names P|<nonce>|<PART>|<nnn> <= 23 chars", names.every((n) => /^P\|[0-9A-Za-z]{8}\|(ENGINE_I|ENGINE_R|BATCH|LABELS|ITEMS)\|[0-9]{3}$/.test(n) && n.length <= 23), names);
  eq(name + " parts written = the manifest's", r.stepRows.map((s) => s.step_name).sort(), names.slice().sort());
  truthy(name + " part rows PAYLOAD under the job", r.stepRows.every((s) => s.job_id === L.JOB && s.step_status === "PAYLOAD" && s.organization_id === spec.org && s.attempt_count === 0));
  eq(name + " READY row", [r.ready.progress_percent, r.ready.row_version, r.ready.line_count, r.ready.error_code, r.ready.lease_owner], [60, 4, fx.children.subtract.length, null, undefined]);
  eq(name + " nothing else written", [r.unlocks.length, r.jobUps.length], [0, 1]);
}

// ------------------------------------------------------------------------------------------------ the classic as the oracle
const S = require("./synth.js");
// V2's op 1 against the classic IA_SAVE v11's SUBTRACT calls on the same document (minus `skip` lines: non-stock, moving nothing)
function oracle(label, d, opts) {
  const o = opts || {};
  const form = o.classicForm || d.form;
  const c = L.runClassic(form, { items: d.items, stored: Object.assign({}, d.stored, { stock_movement: form.stock_movement }), batchNumber: o.batchNumber });
  truthy(label + ": the classic saved", c.returned && c.returned.code === "200", c.returned);
  const r = L.runPrepare(Object.assign({}, d.spec, o.spec || {}));
  truthy(label + ": READY_TO_COMMIT", r.ready, [r.returned, r.failed]);
  if (!r.ready) return { c: c, r: r };
  const m = r.parts.ENGINE_I.movements;
  eq(label + ": op 1 movements = the classic's SUBTRACT calls", m.length, c.subtracts.length);
  m.forEach((x, i) => c.subtracts[i] && sameIssue(label + " M" + (i + 1), x, c.subtracts[i]));
  sameReceipt(label + " R1", r.parts.ENGINE_R.movements[0], c.adds[0]);
  return { c: c, r: r };
}
section("oracle: the same balance picked on two lines");
{
  const d = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1" } }, parent: 0, lines: [{ item: 1, picks: [{ bin: 1, qty: 2 }] }, { item: 1, picks: [{ bin: 1, qty: 3 }] }] });
  const { r } = oracle("two lines one balance", d);
  eq("two lines one balance: two movements in line order", r.parts.ENGINE_I.movements.map((m) => [m.movement_key, m.location_id, m.quantity]), [["M1", S.BIN(1), 2], ["M2", S.BIN(1), 3]]);
  eq("two lines one balance: LABELS name each line", ["M1", "M2"].map((k) => r.parts.LABELS[k].line_index), ["1", "2"]);
}
section("oracle: picks with batches, categories, dates, a zero pick, a component in an alt UOM");
{
  const d = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1", batch: 1 }, 2: { code: "RM2" }, 3: { code: "RM3", conv: [[S.UOM, 1], [S.UOM_BOX, 12]] } }, parent: 0,
    lines: [{ item: 1, picks: [{ bin: 1, batch: 1, qty: 1.5, mfg: "2026-01-01 00:00:00", exp: "2027-01-01 00:00:00" }, { bin: 2, batch: 2, qty: 0.5, cat: "Blocked" }] },
      { item: 2, picks: [{ bin: 1, qty: 0 }, { bin: 3, qty: 4, cat: "" }] }, { item: 3, uom: S.UOM_BOX, picks: [{ bin: 4, qty: 2 }] }] });
  const { r } = oracle("mixed picks", d);
  eq("mixed picks: the zero pick moves nothing, blank category -> Unrestricted", r.parts.ENGINE_I.movements.map((m) => [m.location_id, m.batch_id, m.inventory_category]),
    [[S.BIN(1), S.BATCH(1), "Unrestricted"], [S.BIN(2), S.BATCH(2), "Blocked"], [S.BIN(3), null, "Unrestricted"], [S.BIN(4), null, "Unrestricted"]]);
  eq("mixed picks: the alt-UOM line keeps its UOM (27 apart from the base UOM)", r.parts.ENGINE_I.movements[3].material_uom, S.UOM_BOX);
  eq("mixed picks: counts", r.manifest.counts, { lines: 3, picks: 4, movementsI: 4, nonStockLines: 0, items: 4 });
}
section("oracle: non-stock lines (DL / IDL / VO) move nothing and add nothing");
{
  const items = { 0: { code: "FG", assembly_cost: 2.5 }, 1: { code: "RM1" }, 5: { code: "DL", stock_control: 0, method: "Fixed Cost", purchase_unit_price: 534.4 },
    6: { code: "IDL", stock_control: 0, method: "Fixed Cost", purchase_unit_price: 355.63 }, 7: { code: "VO", stock_control: 0, method: "Fixed Cost", purchase_unit_price: 804.69 } };
  const lines = [{ item: 5, total: 1.32 }, { item: 1, picks: [{ bin: 1, qty: 2 }] }, { item: 6, total: 1.32 }, { item: 7, total: 1.32 }];
  const d = S.synth({ items: items, parent: 0, lines: lines });
  // the classic oracle without the non-stock lines (v11's code_validate refuses a line without picks; v12 lets them through, moving nothing)
  const stockOnly = Object.assign({}, d.form, { stock_movement: d.form.stock_movement.filter((l) => l.item_selection === S.ITEM(1)) });
  const { r } = oracle("non-stock lines", d, { classicForm: stockOnly });
  eq("non-stock lines: op 1 = the stock line only", r.parts.ENGINE_I.movements.map((m) => m.material_id), [S.ITEM(1)]);
  eq("non-stock lines: counts", r.manifest.counts, { lines: 4, picks: 1, movementsI: 1, nonStockLines: 3, items: 5 });
  eq("non-stock lines: ITEMS keep them, parent first, line order", r.parts.ITEMS.itemDates.map((x) => x.id), [S.ITEM(0), S.ITEM(5), S.ITEM(1), S.ITEM(6), S.ITEM(7)]);
  eq("non-stock lines: the receipt carries the parent's assembly cost only", [r.parts.ENGINE_R.assemblyCost, r.parts.ENGINE_R.receiptBaseQty, Object.keys(r.parts).sort()],
    [2.5, 2, ["ENGINE_I", "ENGINE_R", "ITEMS", "LABELS"]]);
  truthy("non-stock lines: no labour value anywhere", !/534\.4|355\.63|804\.69|NONSTOCK/.test(JSON.stringify(r.parts) + r.ready.prepared_payload));
  // a legacy non-stock line WITH a pick: the classic calls SUBTRACT (its engine skips it, 401); V2 sends no movement
  const d2 = S.synth({ items: items, parent: 0, lines: [{ item: 5, picks: [{ bin: 7, qty: 1 }] }, { item: 1, picks: [{ bin: 1, qty: 2 }] }] });
  const c2 = L.runClassic(d2.form, { items: d2.items, stored: d2.stored });
  const r2 = L.runPrepare(d2.spec);
  eq("legacy picked non-stock line: classic calls / V2 movements", [c2.subtracts.map((s) => s.material_id), r2.parts.ENGINE_I.movements.map((m) => m.material_id)],
    [[S.ITEM(5), S.ITEM(1)], [S.ITEM(1)]]);
  eq("legacy picked non-stock line: counts", r2.manifest.counts, { lines: 2, picks: 2, movementsI: 1, nonStockLines: 1, items: 3 });
}
section("oracle: the receipt in an alt UOM (receiptBaseQty, the BATCH row's base quantity)");
{
  const d = S.synth({ items: { 0: { code: "FG", batch: 1, conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 1: { code: "RM1" } }, parent: 0,
    header: { item_qty: 2, item_uom: S.UOM_BOX, batch_no: "1020-001-0001", manufacturing_date: "2026-10-20 00:00:00", expired_date: "2028-10-19 00:00:00" },
    lines: [{ item: 1, picks: [{ bin: 1, qty: 5 }] }] });
  const { c, r } = oracle("alt-UOM receipt", d, { batchNumber: "1020-001-0001" });
  eq("alt-UOM receipt: R1 in item_qty / item_uom, base qty 24 (the 12x row, not the 1x row 27 ids away)",
    [r.parts.ENGINE_R.movements[0].quantity, r.parts.ENGINE_R.movements[0].material_uom, r.parts.ENGINE_R.receiptBaseQty], [2, S.UOM_BOX, 24]);
  eq("alt-UOM receipt: the classic sent the same quantity and UOM", [c.adds[0].quantity, c.adds[0].material_uom, c.adds[0].batch_number], [2, S.UOM_BOX, "1020-001-0001"]);
  eq("alt-UOM receipt: BATCH", r.parts.BATCH, { mode: "insert", row: { batch_number: "1020-001-0001", material_id: S.ITEM(0), initial_quantity: "24.00000000", transaction_no: "IA-SYN-001",
    plant_id: S.PLANT, organization_id: S.ORG, remark: "synthetic", remark2: "", remark3: "", manufacturing_date: "2026-10-20 00:00:00", expired_date: "2028-10-19 00:00:00" } });
  eq("alt-UOM receipt: batchMode / BATCH listed", [r.manifest.batchMode, r.manifest.parts.BATCH.length], ["insert", 1]);
}

// ------------------------------------------------------------------------------------------------ type traps, the lift context
section("type traps: string decimals, string quantities, a bare 19-digit id, float residue");
{
  const d = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1" }, 2: { code: "RM2" } }, parent: 0,
    lines: [{ item: 1, uom: S.UOM_BOX, picks: [{ bin: 1, qty: "1.25" }] }, { item: 2, picks: [{ bin: 2, qty: 0.1 + 0.2 }] }] });
  const base = L.runPrepare(d.spec);
  // the same rows as text decimals and a bare (unquoted) 19-digit quantity_uom in the JSON text
  const hdr = L.parseBig(d.spec.hdr[0].j);
  hdr.item_qty = "2.00000000";
  const lines = d.spec.lines.map((x) => L.parseBig(x.j));
  lines[0].total_quantity = "1.25000000";
  lines[1].total_quantity = "0.30000000";
  const text = lines.map((l) => ({ j: JSON.stringify(l).replace('"quantity_uom":"' + S.UOM_BOX + '"', '"quantity_uom":' + S.UOM_BOX) }));
  truthy("type traps: the bare id is in the row text", text[0].j.indexOf('"quantity_uom":' + S.UOM_BOX) >= 0);
  const spec = Object.assign({}, d.spec, { hdr: [L.jrow(hdr)], lines: text });
  spec.request = L.requestFor(spec.hdr, spec.lines);
  eq("type traps: the fingerprint is the same over text decimals", spec.request.lineFingerprint, d.spec.request.lineFingerprint);
  const r = L.runPrepare(spec);
  eq("type traps: the same parts", r.parts, base.parts);
  eq("type traps: quantities are q8 numbers", r.parts.ENGINE_I.movements.map((m) => m.quantity), [1.25, 0.3]);
  eq("type traps: the bare 19-digit UOM id stays exact", r.parts.ENGINE_I.movements[0].material_uom, S.UOM_BOX);
  const c = L.runClassic(d.form, { items: d.items, stored: d.stored });
  eq("type traps: the classic sends the raw float, V2 its q8 (deliberate, CONTRACT section 5)", [c.subtracts[1].quantity, r.parts.ENGINE_I.movements[1].quantity], [0.30000000000000004, 0.3]);
}
section("the lift context: Processing never reaches the lifted code; the slim per-line context gives the full context's outputs");
{
  const doc = L.built();
  const P = L.codeOf(doc, "code_node_IPplan", ["iaAdaptHeader", "iaAdaptLines", "iaAdaptItems", "iaPlanContext", "iaPlanRun", "iaRows"]);
  const ctxOf = (spec) => {
    const hdr = P.iaRows(spec.hdr)[0];
    const header = P.iaAdaptHeader(hdr, "Draft");
    header.stock_movement = P.iaAdaptLines(spec.lines);
    const items = P.iaAdaptItems(spec.items);
    return { header: header, ctx: P.iaPlanContext(header, items, { docId: hdr.id, stock_movement_no: hdr.stock_movement_no, stock_movement: JSON.stringify(header.stock_movement) }),
      batch: hdr.batch_no || "" };
  };
  if (L.hasFixture("prod_edit_genbatch")) {
    const gfx = L.fixture("prod_edit_genbatch");
    const a = ctxOf(L.goldenSpec(gfx));
    eq("lift: the adapted header carries the prevStatus, no lock fields, the rule id as text", [a.header.item_assembly_status, "ia_v2_job_id" in a.header,
      a.header.stock_movement_no_type], ["Draft", false, L.parseBig(gfx.db.hdr[0].j).stock_movement_no_type]);
    truthy("lift: the numbering rule id is a 19-digit string", /^[0-9]{19}$/.test(a.header.stock_movement_no_type), a.header.stock_movement_no_type);
    const run = P.iaPlanRun(a.ctx, a.batch, 1);
    eq("lift: code_fillback saw Draft (storedStatus) and wrote saveAs", [run.fill.storedStatus, run.fill.allData.item_assembly_status], ["Draft", "Completed"]);
    eq("lift: code_batch_decide (generated batch)", [run.decide.needsGen, run.decide.isBatch], [1, "Y"]);
  } else console.log("   lift (prod_edit_genbatch): SKIPPED (not in " + L.PROD_FIXTURES + ")");
  // a synthesized Processing row: the lifted code still sees the prevStatus
  const pd = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1" } }, parent: 0, lines: [{ item: 1, picks: [{ bin: 1, qty: 1 }] }] });
  const pa = ctxOf(pd.spec);
  const prun = P.iaPlanRun(pa.ctx, pa.batch, 1);
  eq("lift: a stored Processing row reaches the lifted code as Draft", [L.parseBig(pd.spec.hdr[0].j).item_assembly_status, pa.header.item_assembly_status, prun.fill.storedStatus],
    ["Processing", "Draft", "Draft"]);
  const manual = ctxOf(L.goldenSpec(L.fixture("dev_fixedcost_manualbatch")));
  eq("lift: the Manual Input rule number kept a number (-9999)", manual.header.stock_movement_no_type, -9999);
  const cases = GOLDENS.filter(L.hasFixture).map((n) => L.goldenSpec(L.fixture(n)));
  const big = S.synth({ items: Object.fromEntries([[0, { code: "FG" }]].concat([...Array(40).keys()].map((i) => [i + 1, { code: "RM" + i, batch: i % 3 === 0 ? 1 : 0 }]))), parent: 0,
    lines: [...Array(300).keys()].map((i) => ({ item: (i % 40) + 1, uom: i % 7 === 0 ? S.UOM_BOX : undefined,
      picks: [{ bin: i % 9, batch: i % 3 === 0 ? i % 5 : undefined, qty: 1 + (i % 4) * 0.25 }, { bin: (i + 1) % 9, qty: i % 5 === 0 ? 0 : 0.5, cat: i % 11 === 0 ? "Blocked" : "Unrestricted" }] })) });
  for (const spec of cases.concat([big.spec])) {
    const slim = ctxOf(spec);
    const full = ctxOf(spec);
    const t0 = Date.now();
    const rs = P.iaPlanRun(slim.ctx, slim.batch, 1);
    const t1 = Date.now();
    const rf = P.iaPlanRun(full.ctx, full.batch, 0);
    const t2 = Date.now();
    // code_item_txn stamps new Date() per run: compare everything but the stamp
    const unstamp = (x) => JSON.stringify(Object.assign({}, x, { txn: (x.txn.updates || []).map((u) => u.id) }));
    eq("lift: slim = full context (" + spec.request.iaNo + ")", unstamp(rs), unstamp(rf));
    L.note("slim = full: " + spec.request.iaNo + ", " + rs.issues.length + " picks: slim " + (t1 - t0) + " ms, full " + (t2 - t1) + " ms");
  }
}

// ------------------------------------------------------------------------------------------------ failure paths
section("failure paths (nothing moved; the unlock only after the lock check)");
const okd = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1" }, 2: { code: "RM2" } }, parent: 0, lines: [{ item: 1, picks: [{ bin: 1, qty: 2 }] }, { item: 2, picks: [{ bin: 2, qty: 1 }] }] });
const UNLOCK = [{ id: S.IA, item_assembly_status: "Draft" }];
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
      truthy(label + ": the unlock before the FAILED write", order.indexOf("Item Assembly") >= 0 && order.indexOf("Item Assembly") < order.indexOf("GD Async Job"), order);
    }
  }
  return r;
}
failCase("not locked: another key's lock", (s) => (s.owner = { lock_ref: "IA:other:key" }), { code: "IA_NOT_LOCKED", message: C.IA_TEXT.notLocked });
failCase("not locked: the IA is Draft", (s) => (s.owner = { item_assembly_status: "Draft" }), { code: "IA_NOT_LOCKED" });
failCase("not locked: another job's IA", (s) => (s.owner = { ia_v2_job_id: "2112100000000000999" }), { code: "IA_NOT_LOCKED" });
failCase("not found: the IA was deleted", (s) => { s.hdr = []; s.owner = { ia_id: null, item_assembly_status: null, ia_v2_job_id: null }; },
  { code: "IA_NOT_FOUND", message: "Item Assembly not found - it may have been deleted." });
failCase("lines changed after SUBMIT", (s) => (s.request.lineFingerprint = "IF1:2:0000000000000000"), { code: "IA_LINES_CHANGED", message: C.IA_TEXT.linesChanged, unlock: 1 });
failCase("request: another action", (s) => (s.request.action = "REVERT"), { code: "IA_INVALID_REQUEST", unlock: 1 });
failCase("request: the stored number is not the request's", (s) => (s.request.iaNo = "IA-SYN-999"), { code: "IA_PLAN_BROKEN", unlock: 1 });
failCase("request: no fingerprint", (s) => (s.request.lineFingerprint = ""), { code: "IA_PLAN_BROKEN", unlock: 1 });
const itemsWith = (n, patch) => (s) => (s.items = s.items.map((x) => {
  const it = L.parseBig(x.j);
  return L.jrow(it.id === S.ITEM(n) ? Object.assign(it, patch) : it);
}));
failCase("eligibility: a serial-numbered component", itemsWith(2, { serial_number_management: 1 }), { code: "IA_PLAN_FAILED",
  message: "The completion could not be prepared: item RM2 is serial-numbered.", unlock: 1 });
failCase("eligibility: the parent not stock controlled", itemsWith(0, { stock_control: 0 }), { code: "IA_PLAN_FAILED", unlock: 1 });
failCase("eligibility: a Manual Input batch parent", itemsWith(0, { item_batch_management: 1, batch_number_genaration: "Manual Input" }), { code: "IA_PLAN_FAILED", unlock: 1 });
failCase("eligibility: a batch parent without its number", itemsWith(0, { item_batch_management: 1 }), { code: "IA_PLAN_FAILED",
  message: "The completion could not be prepared: the assembled item is batch managed but has no batch number.", unlock: 1 });
failCase("eligibility: an item that does not exist", (s) => (s.items = s.items.filter((x) => L.parseBig(x.j).id !== S.ITEM(2))), { code: "IA_PLAN_FAILED", unlock: 1 });
const linesWith = (i, f) => (s) => {
  const ls = s.lines.map((x) => L.parseBig(x.j));
  f(ls[i]);
  s.lines = ls.map(L.jrow);
  s.request = L.requestFor(s.hdr, s.lines);
};
failCase("eligibility: a handling-unit pick", linesWith(1, (l) => (l.temp_qty_data = l.temp_qty_data.replace('"is_deleted":0', '"is_deleted":0,"handling_unit_id":"2113000000000000333"'))),
  { code: "IA_PLAN_FAILED", message: "The completion could not be prepared: it picks from handling units.", unlock: 1 });
failCase("eligibility: a Reserved pick", linesWith(0, (l) => (l.temp_qty_data = l.temp_qty_data.replace('"category":"Unrestricted"', '"category":"Reserved"'))),
  { code: "IA_PLAN_FAILED", message: "The completion could not be prepared: line 1 picks Reserved stock.", unlock: 1 });
failCase("no stock to issue (only non-stock lines)", (s) => [1, 2].forEach((n) => itemsWith(n, { stock_control: 0 })(s)),
  { code: "IA_PLAN_FAILED", message: "The completion could not be prepared: no stock to issue.", unlock: 1 });
failCase("no stock to issue (no pick above zero)", (s) => [0, 1].forEach((i) => linesWith(i, (l) => (l.temp_qty_data = l.temp_qty_data.replace(/"sm_quantity":[0-9.]+/g, '"sm_quantity":0')))(s)),
  { code: "IA_PLAN_FAILED", message: "The completion could not be prepared: no stock to issue.", unlock: 1 });
failCase("a plan that throws after the lock check (entry list an object)", linesWith(0, (l) => (l.temp_qty_data = '{"sm_quantity":1}')), { code: "IA_PLAN_BROKEN", unlock: 1 });
{
  const many = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1" } }, parent: 0, lines: [{ item: 1, picks: [...Array(5001).keys()].map((i) => ({ bin: i % 50, qty: 1 })) }] });
  const r = L.runPrepare(many.spec);
  eq("5,001 picks: IA_SPLIT_REQUIRED", [r.failed.error_code, r.failed.error_message, r.unlocks, r.calls.length], ["IA_SPLIT_REQUIRED", C.IA_TEXT.splitRequired(5001), UNLOCK, 0]);
  const five = S.synth({ items: { 0: { code: "FG" }, 1: { code: "RM1" } }, parent: 0, lines: [{ item: 1, picks: [...Array(5000).keys()].map((i) => ({ bin: i % 50, qty: 1 })) }] });
  eq("5,000 picks: READY", L.runPrepare(five.spec).returned.job_status, "READY_TO_COMMIT");
}
section("failure paths: the engine's PLAN answers (LABELS-mapped messages)");
const bin1 = "BIN-" + S.BIN(1).slice(-3);
failCase("PLAN op 1: 400 Insufficient quantity", (s) => (s.planI = { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M2)" }),
  { code: "IA_INVENTORY_INSUFFICIENT", message: "Insufficient quantity - line 2 (RM2), bin BIN-" + S.BIN(2).slice(-3) + " (Unrestricted)", unlock: 1, calls: 2 });
failCase("PLAN op 1: a 401 result inside a 200", (s) => (s.planI = (p) => Object.assign(L.planOk(p), { results: L.planOk(p).results.map((x, i) => (i === 0 ? { movement_key: "M1",
  direction: "SUBTRACT", code: "401", message: "Skipping inventory update for item (stock control = 0)" } : x)) })),
  { code: "IA_PLAN_SKIPPED", message: "Skipping inventory update for item (stock control = 0) - line 1 (RM1), bin " + bin1 + " (Unrestricted): nothing was moved.", unlock: 1, calls: 2 });
failCase("PLAN op 1: a guard refusal by index", (s) => (s.planI = { code: "400", result_code: "REQUEST_INVALID", message: "movements[1] location_id must be digits" }),
  { code: "IA_INVENTORY_REQUEST_INVALID", message: "location_id must be digits - line 2 (RM2), bin BIN-" + S.BIN(2).slice(-3) + " (Unrestricted)", unlock: 1, calls: 2 });
failCase("PLAN op 1: 400 UNSUPPORTED_PRECISION (no movement)", (s) => (s.planI = { code: "400", result_code: "UNSUPPORTED_PRECISION", message: "The tenant's number rule x is not a rounding" }),
  { code: "IA_INVENTORY_UNSUPPORTED_PRECISION", message: "The tenant's number rule x is not a rounding", unlock: 1, calls: 2 });
failCase("PLAN op 1: 500", (s) => (s.planI = { code: "500", result_code: "REQUIRES_REVIEW", message: "x" }), { code: "IA_PLAN_FAILED", unlock: 1, calls: 2 });
failCase("PLAN op 1: no answer", (s) => (s.planI = {}), { code: "IA_PLAN_FAILED", message: "The completion could not be prepared: the stock check answered nothing.", unlock: 1, calls: 2 });
failCase("PLAN op 1: fewer results than movements", (s) => (s.planI = (p) => Object.assign(L.planOk(p), { results: L.planOk(p).results.slice(1) })),
  { code: "IA_PLAN_FAILED", unlock: 1, calls: 2 });
failCase("PLAN op 2: 400 duplicate balance at the receipt bin", (s) => (s.planR = { code: "400", result_code: "DUPLICATE_BALANCE", message: "More than one item_balance row for x (movement R1)" }),
  { code: "IA_INVENTORY_DUPLICATE_BALANCE", message: "More than one item_balance row for x - FG, into bin BIN-" + S.BIN(90).slice(-3) + " (Unrestricted)", unlock: 1, calls: 2 });
failCase("PLAN op 2: R1 not 200", (s) => (s.planR = (p) => Object.assign(L.planOk(p), { results: [{ movement_key: "R1", direction: "ADD", code: "401", message: "Skipping inventory update for item (stock control = 0)" }] })),
  { code: "IA_PLAN_SKIPPED", unlock: 1, calls: 2 });
failCase("PLAN both refuse: op 1's reason wins", (s) => {
  s.planI = { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M1)" };
  s.planR = { code: "400", result_code: "DUPLICATE_BALANCE", message: "x (movement R1)" };
}, { code: "IA_INVENTORY_INSUFFICIENT", unlock: 1, calls: 2 });
section("entry");
{
  const noop = (label, mutate, code) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    mutate(spec);
    const r = L.runPrepare(spec);
    eq(label, [r.returned.result_code, r.returned.job_status, r.db.writes.length, r.calls.length, Object.keys(r.sql)], [code, "", 0, 0, ["sql_node_IPjob"]]);
    truthy(label + ": evidence NOOP", JSON.parse(r.returned.evidence).path === "NOOP", r.returned);
  };
  noop("not VALIDATING", (s) => (s.job = { job_status: "READY_TO_COMMIT" }), "JOB_ILLEGAL_TRANSITION");
  noop("the worker's lease expired", (s) => (s.job = { lease_live: 0 }), "JOB_ROW_VERSION_CONFLICT");
  noop("another command", (s) => (s.job = { command: "REVERT_IA" }), "IA_INVALID_DATA");
  noop("job not found", (s) => (s.jobRows = [{ db_now: L.DB_NOW, id: null }]), "IA_INVALID_DATA");
  noop("job deleted", (s) => (s.job = { is_deleted: 1 }), "IA_INVALID_DATA");
  const rej = L.runPrepare(Object.assign({}, okd.spec, { jobId: "12a" }));
  eq("guard: job_id not digits", [rej.returned.result_code, rej.db.writes.length, Object.keys(rej.sql).length, JSON.parse(rej.returned.evidence).path],
    ["IA_INVALID_DATA", 0, 0, "REJECTED_INPUT"]);
  const review = (label, mutate) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    mutate(spec);
    const r = L.runPrepare(spec);
    eq(label + ": REQUIRES_REVIEW, no unlock, no reads", [r.failed && r.failed.job_status, r.failed && r.failed.error_code, r.unlocks, Object.keys(r.sql).sort()],
      ["REQUIRES_REVIEW", "IA_PREV_STATUS_UNKNOWN", [], ["sql_node_IPback", "sql_node_IPjob"]]);
  };
  review("prevStatus Completed", (s) => (s.request.prevStatus = "Completed"));
  // RES-01 Created (BA, 10-22): a Created IA's job (prevStatus Created) is prepared like a Draft's; a refused plan puts it back to Created
  {
    const cs = JSON.parse(JSON.stringify(okd.spec));
    cs.request.prevStatus = "Created";
    eq("prevStatus Created: READY_TO_COMMIT", L.runPrepare(cs).returned.job_status, "READY_TO_COMMIT");
    const cf = JSON.parse(JSON.stringify(okd.spec));
    cf.request.prevStatus = "Created";
    [1, 2].forEach((n) => itemsWith(n, { stock_control: 0 })(cf));
    const r = L.runPrepare(cf);
    eq("prevStatus Created + a refused plan: FAILED, the IA back to Created", [r.failed && r.failed.job_status, r.unlocks], ["FAILED", [{ id: S.IA, item_assembly_status: "Created" }]]);
  }
  review("an unreadable request", (s) => (s.job = { request_payload: "{not json" }));
  const unlinked = (label, linked, unlock) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    spec.job = { correlation_id: "", linked_ia: linked };
    const r = L.runPrepare(spec);
    eq(label, [r.failed.job_status, r.failed.error_code, r.unlocks, r.calls.length], ["FAILED", "IA_INVALID_REQUEST", unlock, 0]);
  };
  unlinked("SUBMIT stopped before link: its Processing IA released", S.IA, UNLOCK);
  unlinked("SUBMIT stopped before link: no IA to release", null, []);
}

// ------------------------------------------------------------------------------------------------ the real engine
section("the real INVENTORY_BULK_APPLY v10 (base/) plans PREPARE's movements (its reads mocked from synthetic balances)");
{
  const items = { 0: { code: "FG", batch: 1, conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 1: { code: "RM1", batch: 1 }, 2: { code: "RM2" }, 3: { code: "RM3", conv: [[S.UOM, 1], [S.UOM_BOX, 12]] },
    5: { code: "DL", stock_control: 0, method: "Fixed Cost" } };
  const d = S.synth({ items: items, parent: 0, header: { item_uom: S.UOM_BOX, batch_no: "1020-001-0002", inventory_category: "Blocked" },
    lines: [{ item: 1, picks: [{ bin: 1, batch: 1, qty: 1.5 }, { bin: 2, batch: 2, qty: 0.5, cat: "Blocked" }] }, { item: 2, picks: [{ bin: 3, qty: 4 }] },
      { item: 3, uom: S.UOM_BOX, picks: [{ bin: 4, qty: 2 }] }, { item: 5, total: 3 }, { item: 2, picks: [{ bin: 3, qty: 1 }] }] });
  const r = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, 1000) }));
  const [aI, aR] = r.engineAnswers;
  eq("real engine: op 1 PLAN_OK, every result 200", [aI.code, aI.result_code, aI.results.map((x) => x.code)], ["200", "OK", ["200", "200", "200", "200", "200"]]);
  eq("real engine: op 2 PLAN_OK, R1 200", [aR.code, aR.result_code, aR.results.map((x) => [x.movement_key, x.code])], ["200", "OK", [["R1", "200"]]]);
  eq("real engine: the alt-UOM line issues 24 base units (12x row), priced per base unit", [aI.results[3].total_price, aI.results[3].unit_price], [60, 2.5]);
  eq("real engine: the job READY_TO_COMMIT", r.returned.job_status, "READY_TO_COMMIT");
  // the same balance on two lines (M3, M5): the engine sees the first's deduction - 4 + 1 of 4.5 in stock is short on the second
  const short = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, (p) => (p.material_id === S.ITEM(2) ? 4.5 : 1000)) }));
  eq("real engine: the second pick of a shared balance runs short", [short.failed && short.failed.error_code, short.failed && short.failed.error_message],
    ["IA_INVENTORY_INSUFFICIENT", "Insufficient quantity - line 5 (RM2), bin BIN-" + S.BIN(3).slice(-3) + " (Unrestricted)"]);
  eq("real engine: nothing written but the unlock and the FAILED job", [short.stepRows.length, short.unlocks, short.jobUps.length], [0, [{ id: S.IA, item_assembly_status: "Draft" }], 1]);
  // a component that is non-stock in the engine's own read (flipped after PREPARE's read): the engine answers 401 inside a 200
  const flip = L.runPrepare(Object.assign({}, d.spec, { engine: S.engineState(d, 1000, (it) => (it.id === S.ITEM(3) ? { stock_control: 0 } : {})) }));
  eq("real engine: a 401 result inside a 200 -> IA_PLAN_SKIPPED naming the item", [flip.failed && flip.failed.error_code, flip.failed && flip.failed.error_message],
    ["IA_PLAN_SKIPPED", "Skipping inventory update for item (stock control = 0) - line 3 (RM3), bin BIN-" + S.BIN(4).slice(-3) + " (Unrestricted): nothing was moved."]);
  // a duplicate item_balance row at the receipt bin: op 2's PLAN refuses before anything moves
  const st = S.engineState(d, 1000);
  st.bal.push({ id: "2113000000000099998", material_id: S.ITEM(0), location_id: S.BIN(90), plant_id: S.PLANT, organization_id: S.ORG, unrestricted_qty: "0", reserved_qty: "0", block_qty: "0",
    qualityinsp_qty: "0", intransit_qty: "0", balance_quantity: "0" }, { id: "2113000000000099999", material_id: S.ITEM(0), location_id: S.BIN(90), plant_id: S.PLANT, organization_id: S.ORG,
    unrestricted_qty: "0", reserved_qty: "0", block_qty: "0", qualityinsp_qty: "0", intransit_qty: "0", balance_quantity: "0" });
  const dup = L.runPrepare(Object.assign({}, d.spec, { engine: st }));
  eq("real engine: a duplicate receipt balance -> IA_INVENTORY_DUPLICATE_BALANCE (op 2's PLAN)", [dup.failed && dup.failed.error_code, /into bin BIN-590 \(Blocked\)$/.test(dup.failed.error_message)],
    ["IA_INVENTORY_DUPLICATE_BALANCE", true]);
}

// ------------------------------------------------------------------------------------------------ fix wave R7 / R8 (CONTRACT ruling 10)
section("R7: the engine's results as an array or as JSON text");
{
  const V = L.codeOf(L.built(), "code_node_IPready", ["iaPlanVerdict"]).iaPlanVerdict;
  const labels = { M1: { line_index: "1", item_code: "RM1", bin: "B1", category: "Unrestricted", side: "out" }, R1: { item_code: "FG", bin: "B9", category: "Unrestricted", side: "in" } };
  const ok = [{ movement_key: "M1", direction: "SUBTRACT", code: "200" }];
  const skip = [{ movement_key: "M1", direction: "SUBTRACT", code: "401", message: "Skipping inventory update for item (stock control = 0)" }];
  for (const [shape, f] of [["array", (x) => x], ["JSON text", (x) => JSON.stringify(x)]]) {
    eq("R7 " + shape + ": clean", V("I", { code: "200", results: f(ok) }, 1, labels, ["M1"]), null);
    const v = V("I", { code: "200", results: f(skip) }, 1, labels, ["M1"]);
    eq("R7 " + shape + ": a 401 result", [v && v.code, v && v.message],
      ["IA_PLAN_SKIPPED", "Skipping inventory update for item (stock control = 0) - line 1 (RM1), bin B1 (Unrestricted): nothing was moved."]);
  }
  const bad = V("I", { code: "200", results: "[{not json" }, 1, labels, ["M1"]);
  eq("R7 unreadable text: no results counted -> IA_PLAN_FAILED", bad && bad.code, "IA_PLAN_FAILED");
  const textAnswer = (p) => Object.assign(L.planOk(p), { results: JSON.stringify(L.planOk(p).results) });
  const r = L.runPrepare(Object.assign({}, okd.spec, { planI: textAnswer, planR: textAnswer }));
  eq("R7 full run: both PLAN answers as JSON text -> READY_TO_COMMIT", r.returned.job_status, "READY_TO_COMMIT");
  const r2 = L.runPrepare(Object.assign({}, okd.spec, { planI: (p) => Object.assign(textAnswer(p), { results: JSON.stringify([{ movement_key: "M1", direction: "SUBTRACT", code: "401",
    message: "Skipping inventory update for item (stock control = 0)" }, { movement_key: "M2", direction: "SUBTRACT", code: "200" }]) }) }));
  eq("R7 full run: a 401 inside JSON text -> IA_PLAN_SKIPPED", r2.failed && r2.failed.error_code, "IA_PLAN_SKIPPED");
}
section("R8: an Add that stopped before link: FAILED written together with the link (STATUS then answers the IA)");
{
  const unlinked = (job) => {
    const spec = JSON.parse(JSON.stringify(okd.spec));
    spec.request = Object.assign({}, spec.request, { iaId: "", iaNo: "", issuedNo: "", lineFingerprint: "", pageStatus: "Add" });
    spec.job = Object.assign({ correlation_id: "", linked_ia: S.IA, linked_ia_no: "IA-2610-0042", linked_ia_no_type: "2102000000000000001" }, job || {});
    return { spec: spec, r: L.runPrepare(spec) };
  };
  const { spec, r } = unlinked();
  eq("R8: one job write, FAILED + the link", r.jobUps.map((j) => [j.job_status, j.error_code, j.correlation_id, j.causation_id]),
    [["FAILED", "IA_INVALID_REQUEST", "IA|" + S.IA, S.IA]]);
  const req = L.parseBig(r.jobUps[0].request_payload);
  eq("R8: request + iaId / iaNo / issuedNo (the number this Add issued), the rest kept", req,
    Object.assign({}, spec.request, { iaId: S.IA, iaNo: "IA-2610-0042", issuedNo: "IA-2610-0042" }));
  eq("R8: the FAILED row's own props (lease released, row_version + 1)", [r.jobUps[0].lease_owner, r.jobUps[0].row_version, r.jobUps[0].progress_percent, !!r.jobUps[0].finished_at],
    [null, 4, 0, true]);
  eq("R8: the IA released to Draft before the job write", [r.unlocks, r.db.writes.map((w) => w.table)], [[{ id: S.IA, item_assembly_status: "Draft" }], ["Item Assembly", "GD Async Job"]]);
  // what SUBMIT's STATUS reads from this job (code/submit/entry.js: ia_id from correlation_id, ia_no = request $.iaNo)
  const m = String(r.jobUps[0].correlation_id).match(/^IA\|([0-9]{1,20})$/);
  eq("R8: STATUS would answer ia_id / ia_no", [m && m[1], req.iaNo], [S.IA, "IA-2610-0042"]);
  eq("R8: answer = the job read back", [r.returned.job_status, r.returned.result_code], ["FAILED", "IA_INVALID_REQUEST"]);
  const manual = unlinked({ linked_ia_no: "MAN-0001", linked_ia_no_type: "-9999" }).r;
  eq("R8: a Manual Input number is not an issued one", L.parseBig(manual.jobUps[0].request_payload).issuedNo, "");
  const none = unlinked({ linked_ia: null, linked_ia_no: null, linked_ia_no_type: null }).r;
  eq("R8: no IA left Processing -> plain FAILED, no link", none.jobUps.map((j) => [j.job_status, "correlation_id" in j, "request_payload" in j]), [["FAILED", false, false]]);
  const review = unlinked();
  eq("R8: a linked (correlated) job never takes this branch", L.runPrepare(okd.spec).jobUps.some((j) => "correlation_id" in j), false);
  truthy("R8: the GO path is unchanged", review.r.calls.length === 0 && L.runPrepare(okd.spec).returned.job_status === "READY_TO_COMMIT");
}

// ------------------------------------------------------------------------------------------------ RES-01 R4: an IA that reserves completes from its holds
section("RES-01 R4: the held part of each pick issued from Reserved");
{
  const l0 = L.parseBig(okd.spec.lines[0].j);
  const held = { hold: "FULL", live: 0, rows: [{ id: "7001", status: "Allocated", doc_line_id: String(l0.id), material_id: S.ITEM(1), bin_location: S.BIN(1), batch_id: null,
    from_category: "Unrestricted", open_qty: "1.5", item_uom: String(l0.quantity_uom || "") }] };
  const movesOf = (r) => ((r.parts.ENGINE_I || {}).movements || []).map((m) => [m.material_id === S.ITEM(1) ? "RM1" : "RM2", m.inventory_category, m.quantity]);
  // review I4: the stored hold status decides (an IA that holds stock completes from it even with the switch off); no switch here
  const on = L.runPrepare(Object.assign({}, okd.spec, { res: held }));
  eq("an IA that reserves: line 1's pick of 2 = 1.5 from Reserved + 0.5 as picked; line 2 as picked; READY", [on.returned.job_status, movesOf(on)],
    ["READY_TO_COMMIT", [["RM1", "Reserved", 1.5], ["RM1", "Unrestricted", 0.5], ["RM2", "Unrestricted", 1]]]);
  truthy("the holds read for the IA's tenant, organisation and id", /r\.organization_id = '\d+'/.test(on.sql.sql_node_IPres || "") &&
    (on.sql.sql_node_IPres || "").indexOf("r.doc_id = '" + okd.spec.iaId + "'") >= 0, on.sql.sql_node_IPres);
  truthy("review M13: the holds read only for an IA with a stored hold status (CASE: prod's on_reserved_gd has only its primary key)",
    (on.sql.sql_node_IPres || "").indexOf("SELECT CASE WHEN (SELECT h.material_hold_status FROM sm_item_assembly h WHERE h.tenant_id = '") === 0, on.sql.sql_node_IPres);
  const busy = L.runPrepare(Object.assign({}, okd.spec, { res: Object.assign({}, held, { live: 1 }) }));
  eq("a reservation running: FAILED IA_RESERVING, the IA back to Draft, nothing planned", [(busy.failed || {}).job_status, (busy.failed || {}).error_code, busy.unlocks, busy.calls.length],
    ["FAILED", "IA_RESERVING", UNLOCK, 0]);
  const notEnrolled = L.runPrepare(Object.assign({}, okd.spec, { res: Object.assign({}, held, { hold: "" }) }));
  eq("an IA that never reserved: as picked", movesOf(notEnrolled), [["RM1", "Unrestricted", 2], ["RM2", "Unrestricted", 1]]);
  // review M8: only the split makes a Reserved issue: an IA that reserves with a stored Reserved pick is refused, as any other IA
  const sp = Object.assign({}, okd.spec, { res: held, lines: okd.spec.lines.slice() });
  linesWith(0, (l) => (l.temp_qty_data = l.temp_qty_data.replace('"category":"Unrestricted"', '"category":"Reserved"')))(sp);
  const rp = L.runPrepare(sp);
  eq("an IA that reserves, a stored Reserved pick: refused (line 1 picks Reserved stock), nothing planned", [(rp.failed || {}).job_status, (rp.failed || {}).error_code,
    /line 1 picks Reserved stock/.test(JSON.stringify(rp.failed || {})), rp.calls.length], ["FAILED", "IA_PLAN_FAILED", true, 0]);
  const never = L.runPrepare(Object.assign({}, okd.spec, { res: { hold: "", rows: null, live: 1 } }));
  eq("an IA that never reserved is never refused as reserving", [never.returned.job_status, movesOf(never)], ["READY_TO_COMMIT", [["RM1", "Unrestricted", 2], ["RM2", "Unrestricted", 1]]]);
}

// ------------------------------------------------------------------------------------------------ sizes
section("IA output split (plan 10-27): one receipt per row, one price, a Batch row per group (System); the split checked again");
{
  const SYSF = { 0: { code: "FG", batch: 1, conv: [[S.UOM, 1], [S.UOM_BOX, 12]] }, 1: { code: "RM1" } };
  const PLAINF = { 0: { code: "FG" }, 1: { code: "RM1" } };
  const lines = [{ item: 1, picks: [{ bin: 1, qty: 2 }] }];
  const split3 = [{ qty: 5, bin: 21, cat: "Blocked", group: 1, batch: "B-0001", mfg: "2026-10-27 00:00:00", exp: "2028-10-27 00:00:00" },
    { qty: 3, bin: 22, cat: "Blocked", group: 1, batch: "B-0001", mfg: "2026-10-27 00:00:00", exp: "2028-10-27 00:00:00" },
    { qty: 2, bin: 23, cat: "Unrestricted", group: 2, batch: "B-0002", mfg: "2026-10-20 00:00:00", exp: "2028-10-20 00:00:00" }];
  let d = S.synth({ items: SYSF, parent: 0, header: { item_qty: 10, batch_no: "B-0001", location_id: S.BIN(21), inventory_category: "Blocked" }, lines: lines, split: split3 });
  let r = L.runPrepare(d.spec);
  truthy("System split: READY", !!r.ready, r.failed);
  const mr = (r.parts.ENGINE_R || {}).movements || [];
  eq("System split: R1..R3, each row's bin, category, qty and its batch's dates", mr.map((m) => [m.movement_key, m.location_id, m.inventory_category, m.quantity, m.manufacturing_date,
    m.expired_date]), [["R1", S.BIN(21), "Blocked", 5, "2026-10-27 00:00:00", "2028-10-27 00:00:00"], ["R2", S.BIN(22), "Blocked", 3, "2026-10-27 00:00:00", "2028-10-27 00:00:00"],
    ["R3", S.BIN(23), "Unrestricted", 2, "2026-10-20 00:00:00", "2028-10-20 00:00:00"]]);
  eq("System split: one price over the whole output (receiptBaseQty = 10), no batch id yet, the rows' batches named", [r.parts.ENGINE_R.receiptBaseQty, mr.every((m) => m.batch_id === null && m.unit_price === 0),
    r.parts.ENGINE_R.batchOf], [10, true, { R1: "B-0001", R2: "B-0001", R3: "B-0002" }]);
  eq("System split: BATCH = one row per group, its base qty, its dates", (r.parts.BATCH.rows || []).map((b) => [b.batch_number, b.initial_quantity, b.manufacturing_date, b.transaction_no]),
    [["B-0001", "8.00000000", "2026-10-27 00:00:00", "IA-SYN-001"], ["B-0002", "2.00000000", "2026-10-20 00:00:00", "IA-SYN-001"]]);
  eq("System split: the receipt PLAN sends the three", r.calls.filter((c) => /\|R$/.test(c.params.operation_key)).map((c) => c.params.movements.length), [3]);
  eq("System split: LABELS R1..R3 (their bins)", ["R1", "R2", "R3"].map((k) => r.parts.LABELS[k] && r.parts.LABELS[k].bin_id), [S.BIN(21), S.BIN(22), S.BIN(23)]);
  eq("System split: the manifest counts the receipts", [r.manifest.counts.movementsR, r.manifest.batchMode], [3, "insert"]);
  // the grid's date cells hold "YYYY-MM-DD" (date-type date): the receipts and the Batch rows get the header read's "YYYY-MM-DD HH:MM:SS"
  d = S.synth({ items: SYSF, parent: 0, header: { item_qty: 10, batch_no: "B-0001", location_id: S.BIN(21) }, lines: lines,
    split: [{ qty: 6, bin: 21, group: 1, batch: "B-0001", mfg: "2026-10-27", exp: "2028-10-27" }, { qty: 4, bin: 22, group: 1, batch: "B-0001", mfg: "2026-10-27", exp: "2028-10-27" }] });
  r = L.runPrepare(d.spec);
  eq("System split with grid dates: receipts and Batch row dated YYYY-MM-DD 00:00:00", [((r.parts.ENGINE_R || {}).movements || []).map((m) => [m.manufacturing_date, m.expired_date]),
    ((r.parts.BATCH || {}).rows || []).map((b) => [b.manufacturing_date, b.expired_date])],
  [[["2026-10-27 00:00:00", "2028-10-27 00:00:00"], ["2026-10-27 00:00:00", "2028-10-27 00:00:00"]], [["2026-10-27 00:00:00", "2028-10-27 00:00:00"]]]);
  // a CTN output: the Batch rows' base quantities in the base UOM
  d = S.synth({ items: SYSF, parent: 0, header: { item_qty: 1.5, item_uom: S.UOM_BOX, batch_no: "B-0001", location_id: S.BIN(21) }, lines: lines,
    split: [{ qty: 1, bin: 21, group: 1, batch: "B-0001" }, { qty: 0.5, bin: 22, group: 1, batch: "B-0001" }] });
  r = L.runPrepare(d.spec);
  eq("System split in CTN: one Batch row of 18 (1.5 x 12), receiptBaseQty 18", [(r.parts.BATCH.rows || []).map((b) => b.initial_quantity), r.parts.ENGINE_R.receiptBaseQty], [["18.00000000"], 18]);
  // non-batch: bins only, no BATCH part
  d = S.synth({ items: PLAINF, parent: 0, header: { item_qty: 2, location_id: S.BIN(21), manufacturing_date: "2026-01-01 00:00:00" }, lines: lines,
    split: [{ qty: 1.2, bin: 21 }, { qty: 0.8, bin: 22, cat: "Blocked" }] });
  r = L.runPrepare(d.spec);
  eq("non-batch split: READY, R1 / R2, no BATCH part, the header's dates", [!!r.ready, (r.parts.ENGINE_R.movements || []).map((m) => [m.movement_key, m.location_id, m.quantity, m.inventory_category,
    m.manufacturing_date]), !!r.parts.BATCH], [true, [["R1", S.BIN(21), 1.2, "Unrestricted", "2026-01-01 00:00:00"], ["R2", S.BIN(22), 0.8, "Blocked", "2026-01-01 00:00:00"]], false]);
  // no split: exactly as before (one R1, the header's bin)
  d = S.synth({ items: PLAINF, parent: 0, header: { item_qty: 2, location_id: S.BIN(21) }, lines: lines, split: [] });
  r = L.runPrepare(d.spec);
  eq("no split rows: one R1 at the header's bin", (r.parts.ENGINE_R.movements || []).map((m) => [m.movement_key, m.location_id, m.quantity]), [["R1", S.BIN(21), 2]]);
  // the split checked again: a total that is not the output, another plant's bin, a group without its number, the item serial
  const fails = [
    ["the total is not the output", { items: PLAINF, header: { item_qty: 2, location_id: S.BIN(21) }, split: [{ qty: 1, bin: 21 }, { qty: 0.5, bin: 22 }] }, /split total 1.5 is not the output quantity 2/],
    ["another plant's bin", { items: PLAINF, header: { item_qty: 2, location_id: S.BIN(21) }, split: [{ qty: 1, bin: 21 }, { qty: 1, bin: 22 }], binsExtra: { 22: { plant: "999" } } },
      /Output row 2: its bin location is not a bin of this plant/],
    ["an inactive bin", { items: PLAINF, header: { item_qty: 2, location_id: S.BIN(21) }, split: [{ qty: 1, bin: 21 }, { qty: 1, bin: 22 }], binsExtra: { 22: { active: 0 } } },
      /Output row 2: its bin location is not active/],
    ["one row", { items: PLAINF, header: { item_qty: 2, location_id: S.BIN(21) }, split: [{ qty: 2, bin: 21 }] }, /at least 2 rows/]];
  for (const [label, o, re] of fails) {
    d = S.synth(Object.assign({ parent: 0, lines: lines }, o));
    r = L.runPrepare(d.spec);
    truthy("split refused (" + label + "): FAILED, its reason, the IA unlocked", !r.ready && r.failed && r.failed.job_status === "FAILED" && re.test(r.failed.error_message || "") &&
      r.unlocks.length === 1, r.failed);
  }
  d = S.synth({ items: SYSF, parent: 0, header: { item_qty: 10, batch_no: "B-0001", location_id: S.BIN(21) }, lines: lines,
    split: [{ qty: 5, bin: 21, group: 1, batch: "B-0001" }, { qty: 5, bin: 22, group: 2, batch: "" }] });
  r = L.runPrepare(d.spec);
  truthy("System split without group 2's number (SUBMIT writes them): not prepared", !r.ready && r.failed && /group 2 has no single batch number/.test(r.failed.error_message || ""), r.failed);
  d = S.synth({ items: SYSF, parent: 0, header: { item_qty: 10, batch_no: "B-0001", location_id: S.BIN(21) }, lines: lines,
    split: [{ qty: 5, bin: 21, group: 1, batch: "B-0001" }, { qty: 5, bin: 22, group: 1, batch: "B-0003" }] });
  r = L.runPrepare(d.spec);
  truthy("System split: group 1's rows with two numbers: not prepared", !r.ready && r.failed && /group 1 has no single batch number/.test(r.failed.error_message || ""), r.failed);
  d = S.synth({ items: SYSF, parent: 0, header: { item_qty: 10, batch_no: "B-0001", location_id: S.BIN(21) }, lines: lines,
    split: [{ qty: 5, bin: 21, group: 1, batch: "B-0001" }, { qty: 5, bin: 22, group: 2, batch: "b-0001" }] });
  r = L.runPrepare(d.spec);
  truthy("System split: two groups with one number: not prepared", !r.ready && r.failed && /two groups of the output split have one batch number/.test(r.failed.error_message || ""), r.failed);
  // a Manual Input batch output's split is the classic save's (SUBMIT routes it there): PREPARE's Manual parent rule refuses it first
  d = S.synth({ items: { 0: { code: "FG", batch: 1, rule: "Manual Input" }, 1: { code: "RM1" } }, parent: 0, header: { item_qty: 2, batch_no: "M-1", location_id: S.BIN(21) }, lines: lines,
    split: [{ qty: 1, bin: 21, batch: "M-1" }, { qty: 1, bin: 22, batch: "M-2" }] });
  r = L.runPrepare(d.spec);
  truthy("Manual batch split: FAILED (the Manual parent rule, before the split), the IA unlocked", !r.ready && r.failed && r.failed.job_status === "FAILED" &&
    /batch number is entered manually/.test(r.failed.error_message || "") && r.unlocks.length === 1, r.failed);
  // the request's fingerprint covers the split: a row changed after SUBMIT -> IA_LINES_CHANGED
  d = S.synth({ items: PLAINF, parent: 0, header: { item_qty: 2, location_id: S.BIN(21) }, lines: lines, split: [{ qty: 1.2, bin: 21 }, { qty: 0.8, bin: 22 }] });
  const moved = S.synth({ items: PLAINF, parent: 0, header: { item_qty: 2, location_id: S.BIN(21) }, lines: lines, split: [{ qty: 1.2, bin: 21 }, { qty: 0.8, bin: 23 }] });
  r = L.runPrepare(Object.assign({}, moved.spec, { request: d.spec.request }));
  truthy("a split row moved after SUBMIT: IA_LINES_CHANGED", !r.ready && r.failed && r.failed.error_code === "IA_LINES_CHANGED", r.failed);
}

section("size: node data and time of one PREPARE run (sim)");
for (const n of [830, 2000]) {
  const d = S.synth({ items: Object.fromEntries([[0, { code: "FG" }]].concat([...Array(n).keys()].map((i) => [i + 1, { code: "RM-" + i }]))), parent: 0,
    lines: [...Array(n).keys()].map((i) => ({ item: i + 1, picks: [{ bin: i % 40, qty: 1 }] })) });
  const r = L.runPrepare(d.spec);
  const mb = (x) => (x / 1048576).toFixed(1);
  const plan = JSON.stringify(r.out.code_node_IPplan).length;
  truthy(n + " lines: READY with " + n + " movements", r.ready && r.parts.ENGINE_I.movements.length === n);
  L.note(n + " lines: " + r.ms + " ms in the sim; node outputs " + mb(r.bytes) + " MB (the plan node " + mb(plan) + " MB), " + r.stepRows.length + " part rows, PLAN request "
    + mb(JSON.stringify(r.calls[0].params).length) + " MB");
}

L.done();
