// IDA_V2_PREPARE - Plan: the locked Item Disassembly -> the classic IDA_SAVE v6 issue / receipt / batch / item bodies (lifted) on the
// stored rows -> the parts (CONTRACT.md section 5), the manifest and the two engine PLAN requests
const IDA_PLAN_PARTS = ["ENGINE_I", "ENGINE_R", "BATCH", "LABELS", "ITEMS"];
const idaPlanText = (v) => (v === undefined || v === null ? "" : String(v));
const idaPlanDate = (v) => (v === undefined || v === null || v === "" ? null : v);
const idaPlanN = (n, word) => n + " " + word + (n === 1 ? "" : "s");
// the items by exact id text (idaItemOf's rule, without a scan per lookup)
const idaPlanItemIndex = function idaPlanItemIndex(items) {
  const by = Object.create(null);
  for (const it of idaList(items)) if (it && typeof it === "object" && idaS(it.id) !== "" && !by[idaS(it.id)]) by[idaS(it.id)] = it;
  return (id) => (idaS(id) !== "" && by[idaS(id)]) || null;
};
// section 7's eligibility reasons on the fresh item facts, minus the SQL screens (costing migration, duplicate balances); first one wins
const idaPlanEligibility = function idaPlanEligibility(hdr, lines, itemOf) {
  const s = idaS;
  const src = itemOf(hdr.item_id);
  if (!src) return "item " + s(hdr.item_id) + " not found";
  for (const l of lines) if (!itemOf(l.item_selection)) return "item " + s(l.item_selection) + " not found";
  if (idaHasHu(hdr)) return "handling units";
  if (Number(src.serial_number_management) === 1) return "serial-numbered source item";
  if (s(src.stock_control) === "0") return "source item not stock controlled";
  const unset = [src].concat(lines.map((l) => itemOf(l.item_selection))).find((it) => s(it.stock_control) === "");
  if (unset) return "item " + (s(unset.material_code) || s(unset.id)) + " has no stock control setting";
  const cat = idaPicks(hdr).map((p) => idaCategory(p.category)).find((c) => IDA_OK_CATEGORIES.indexOf(c) < 0);
  if (cat) return cat + " stock";
  if (!lines.some((l) => s(itemOf(l.item_selection).stock_control) !== "0")) return "no stock to receive";
  return "";
};

const idaPrepPlan = function idaPrepPlan(entry, S, own) {
  const s = idaS;
  const jobId = s(entry.jobId);
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: 0, pickCount: 0, moveCount: 0, movementCountI: 0, movementCountR: 0,
    unlockOk: 0, organizationId: "", opKeyI: "", opKeyR: "", movementsI: [], movementsR: [], labels: {} };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const failed = (why) => fail("IDA_PLAN_FAILED", IDA_TEXT.planFailed(why));
  const broken = (why) => fail("IDA_PLAN_BROKEN", IDA_TEXT.planFailed(why));
  if (s(entry.route) !== "GO") return fail(s(entry.result_code), s(entry.result_message));
  const req = entry.request && typeof entry.request === "object" ? entry.request : {};
  const idaId = s(entry.idaId);
  const owner = idaList(S.owner)[0] || {};
  const hdr = idaRows(S.hdr)[0] || null;
  if (!hdr || s(hdr.id) !== idaId || s(owner.ida_id) !== idaId) return fail("IDA_NOT_FOUND", IDA_TEXT.notFound);
  // only after the lock check may a failure unlock
  const key = s(entry.idempotencyKey);
  const mine = (r) => s(r.item_disassembly_status) === "Processing" && s(r.ida_v2_job_id) === jobId;
  if (!mine(owner) || !mine(hdr) || !key || s(owner.lock_ref) !== key) return fail("IDA_NOT_LOCKED", IDA_TEXT.notLocked);
  base.unlockOk = 1;
  if (own) own.locked = 1;
  if (s(req.action) !== "DIRECT" || s(req.saveAs) !== "Completed" || !idaPrevStatusOk(entry.prevStatus)) {
    return fail("IDA_INVALID_REQUEST", IDA_TEXT.planFailed("the job's request names no valid action (" + s(req.action) + " / " + s(req.saveAs) + " / " + s(entry.prevStatus) + ")."));
  }
  if (s(req.idaId) && s(req.idaId) !== idaId) return broken("the job's request names another Item Disassembly (" + s(req.idaId) + ").");
  const orgId = s(hdr.organization_id);
  const plantId = s(hdr.issuing_operation_faci);
  if (!idaDigits(orgId) || !idaDigits(plantId)) return broken("the Item Disassembly has no organization or plant.");
  if (s(entry.organizationId) !== orgId) return broken("the job's organization is not the Item Disassembly's.");
  const trxNo = idaPlanText(hdr.stock_movement_no);
  if (!s(trxNo) || s(trxNo) === "issued" || s(trxNo) === "draft") return broken("the Item Disassembly has no issued number (" + (s(trxNo) || "empty") + ").");
  if (s(req.idaNo) !== s(trxNo)) return broken("its number " + s(trxNo) + " is not the request's (" + (s(req.idaNo) || "none") + ").");
  if (s(req.lineFingerprint).indexOf("DF1:") !== 0) return broken("the job's request has no line fingerprint.");
  if (idaLineFingerprint(S.lines, S.hdr) !== s(req.lineFingerprint)) return fail("IDA_LINES_CHANGED", IDA_TEXT.linesChanged);

  const stored = idaAdaptLines(S.lines);
  for (let i = 0; i < stored.length; i++) if (!s(stored[i].item_selection)) return broken("line " + (i + 1) + " has no item.");
  const itemOf = idaPlanItemIndex(idaRows(S.items));
  const why = idaPlanEligibility(hdr, stored, itemOf);
  if (why) return failed(why);
  // the classic gate on the stored document with the fresh rows: an item made serial-managed or manual-numbered, a number taken since SUBMIT
  const header = idaAdaptHeader(hdr, s(entry.prevStatus));
  header.stock_movement = idaAdaptStorage(stored, S.storage);
  const ctx = idaPlanContext(header, idaAdaptItems(S.items), { docId: idaId, stock_movement_no: trxNo }, s(req.uid), idaRows(S.typed));
  let gate;
  try {
    gate = idaPlanGate(ctx);
  } catch (e) {
    return broken("the classic gate failed (" + String((e && e.message) || e).slice(0, 160) + ").");
  }
  if (s(gate.fill.storedStatus) !== s(entry.prevStatus)) return broken("the classic code saw the status " + (s(gate.fill.storedStatus) || "none") + ".");
  const verdict = gate.validate || {};
  if (s(verdict.status) === "Failed") return fail("IDA_INVALID", (s(verdict.message) || "the classic check refused it").replace(/\.$/, "") + ": nothing was moved.");
  if (s(verdict.status) !== "Passed") return broken("the classic gate answered " + (s(verdict.status) || "nothing") + ".");
  const stockOf = (it) => s(it && it.stock_control) !== "0";
  // a number taken since SUBMIT (any item of the organization, utf8mb4_general_ci = idaBatchKey); COMMIT D1 checks again
  const held = {};
  for (const b of idaRows(S.typed)) held[idaBatchKey(b.batch_number)] = true;
  for (let i = 0; i < stored.length; i++) {
    const l = stored[i];
    const it = itemOf(l.item_selection);
    if (stockOf(it) && idaBatchKind(l, it) === "TYPED" && held[idaBatchKey(l.batch_number)]) {
      return fail("IDA_BATCH_DUPLICATE", IDA_TEXT.typedTaken(idaLineLabel(i + 1, l), s(l.batch_number)));
    }
  }
  const countI = idaPickCount(hdr);
  const countR = stored.filter((l) => stockOf(itemOf(l.item_selection))).length;
  if (!countI) return failed("no source stock to issue");
  if (countI > IDA_MAX_MOVES) return fail("IDA_SPLIT_REQUIRED", IDA_TEXT.splitRequired(countI, "source picks"));
  if (!countR) return failed("no stock to receive");
  if (countR > IDA_MAX_MOVES) return fail("IDA_SPLIT_REQUIRED", IDA_TEXT.splitRequired(countR, "recovery lines"));

  let run;
  try {
    run = idaPlanRun(ctx);
  } catch (e) {
    return broken("the classic parameter code failed (" + String((e && e.message) || e).slice(0, 160) + ").");
  }
  const fill = run.fill || {};
  const prep = run.prep || {};
  const lines = idaList(fill.allData && fill.allData.stock_movement);
  const receipts = idaList(run.cost && run.cost.receipts);
  const picks = idaPicks(hdr);
  if (lines.length !== stored.length || receipts.length !== stored.length || run.picks.length !== picks.length) {
    return broken("the classic code saw " + lines.length + " lines, " + receipts.length + " receipts and " + run.picks.length + " picks for " + stored.length + " stored lines and "
      + picks.length + " picks.");
  }
  const bins = {};
  for (const b of idaRows(S.bins)) bins[s(b.id)] = s(b.bin);
  const srcItem = itemOf(hdr.item_id);
  const labels = {};

  // ENGINE_I: one SUBTRACT per pick = wf_subtract's params minus itemData, + movement_key, direction, parent_trx_no
  const movementsI = [];
  for (let k = 0; k < run.picks.length; k++) {
    const g = run.picks[k];
    const p = picks[k];
    const mk = "M" + (k + 1);
    const mv = { movement_key: mk, direction: "SUBTRACT", plant_id: s(prep.plant_id), organization_id: s(prep.organization_id), material_id: s(prep.material_id),
      quantity: idaQ8(g.quantity), material_uom: s(prep.material_uom), transaction_type: "IDA", trx_no: idaPlanText(prep.stock_movement_no), parent_trx_no: "",
      inventory_category: idaCategory(g.inventory_category), location_id: s(g.location_id), batch_id: s(g.batch_id) || null, manufacturing_date: idaPlanDate(g.manufacturing_date),
      expired_date: idaPlanDate(g.expired_date), doc_date: idaPlanDate(prep.doc_date), isMovingInv: 0, handling_unit_id: null };
    // the lifted code parses temp_qty_data with JSON.parse: its ids must still be the stored digits
    if (!idaDigits(mv.material_id) || mv.material_id !== s(hdr.item_id) || !idaDigits(mv.plant_id) || mv.plant_id !== plantId || !idaDigits(mv.location_id)
      || mv.location_id !== s(p.location_id) || (mv.batch_id !== null && !idaDigits(mv.batch_id)) || s(mv.batch_id) !== s(p.batch_id) || !(mv.quantity > 0)
      || mv.organization_id !== orgId || mv.trx_no !== trxNo || (mv.material_uom !== "" && !idaDigits(mv.material_uom))) {
      return broken("movement " + mk + " (source pick " + (k + 1) + ") has no valid item, plant, bin, batch, quantity or number.");
    }
    if (IDA_OK_CATEGORIES.indexOf(mv.inventory_category) < 0) return failed(mv.inventory_category + " stock");
    labels[mk] = { pick: String(k + 1), line_index: "", line_id: "", item_code: s(srcItem.material_code), item_name: s(hdr.item_name) || s(srcItem.material_name),
      bin: bins[mv.location_id] || mv.location_id, bin_id: mv.location_id, category: mv.inventory_category, side: "out" };
    movementsI.push(mv);
  }

  // ENGINE_R (one ADD per stock line = wf_add's params minus itemData / batch_number) + alloc (every line) + the BATCH rows, in line order
  const genAt = {};
  for (const x of idaList(run.plan && run.plan.genLines)) genAt[String(x.index)] = x;
  const movementsR = [];
  const alloc = [];
  const rows = [];
  const typedRow = {};
  const typedBase = {};
  const autoItems = [];
  const autoSeen = {};
  let nonStock = 0;
  let typedRows = 0;
  let autoRows = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const r = receipts[i];
    const it = itemOf(l.item_selection);
    const stock = stockOf(it);
    if (!stock) nonStock++;
    if (s(l.id) !== s(stored[i].id) || s(r.material_id) !== s(stored[i].item_selection)) return broken("receipt " + (i + 1) + " is not stored line " + (i + 1) + ".");
    const share = idaQ8(r.quantity);
    const baseQty = idaUomOf(it, share, s(r.material_uom)).baseQty;
    const kind = idaBatchKind(l, it);
    if ((kind === "AUTO") !== (String(i) in genAt)) return broken("line " + (i + 1) + " is numbered differently from the classic batch plan.");
    let mk = "";
    if (stock) {
      mk = "R" + (movementsR.length + 1);
      const mv = { movement_key: mk, direction: "ADD", plant_id: s(r.plant_id), organization_id: s(r.organization_id), material_id: s(r.material_id), quantity: share,
        material_uom: s(r.material_uom), transaction_type: "IDA", trx_no: idaPlanText(r.trx_no), parent_trx_no: "", inventory_category: "Unrestricted", location_id: s(r.location_id),
        batch_id: null, unit_price: 0, doc_date: idaPlanDate(r.doc_date), manufacturing_date: idaPlanDate(r.manufacturing_date), expired_date: idaPlanDate(r.expired_date),
        remark: idaPlanText(r.remark), remark2: idaPlanText(r.remark2), remark3: idaPlanText(r.remark3), isMovingInv: 0, handling_unit_id: null };
      if (!idaDigits(mv.material_id) || !idaDigits(mv.plant_id) || !idaDigits(mv.location_id) || !(mv.quantity > 0) || mv.organization_id !== orgId || mv.trx_no !== trxNo
        || (mv.material_uom !== "" && !idaDigits(mv.material_uom))) {
        return broken("movement " + mk + " (line " + s(l.line_index) + ") has no valid item, plant, bin, quantity or number.");
      }
      labels[mk] = { pick: "", line_index: s(l.line_index), line_id: s(l.id), item_code: s(it.material_code), item_name: s(l.item_name) || s(it.material_name),
        bin: bins[mv.location_id] || mv.location_id, bin_id: mv.location_id, category: "Unrestricted", side: "in" };
      movementsR.push(mv);
    }
    const common = { material_id: s(r.material_id), plant_id: s(r.plant_id), organization_id: s(r.organization_id) };
    const tail = { transaction_no: trxNo, remark: idaPlanText(r.remark), remark2: idaPlanText(r.remark2), remark3: idaPlanText(r.remark3),
      manufacturing_date: idaPlanDate(r.manufacturing_date), expired_date: idaPlanDate(r.expired_date) };
    let bk = "";
    if (kind === "TYPED" && stock) {
      const gk = s(l.item_selection) + "|" + idaBatchKey(l.batch_number);
      let row = typedRow[gk];
      if (!row) {
        row = Object.assign({ key: "B" + (rows.length + 1), kind: "TYPED", insert: true, batch_number: idaPlanText(l.batch_number), line_ids: [] }, common,
          { initial_quantity: "" }, tail, { request: null });
        typedRow[gk] = row;
        typedBase[row.key] = 0;
        rows.push(row);
        typedRows++;
      }
      row.line_ids.push(s(l.id));
      typedBase[row.key] += baseQty;
      bk = row.key;
    } else if (kind === "AUTO") {
      const q = idaBatchRequest(header, l, orgId);
      const g = genAt[String(i)];
      if (s(g.item_id) !== q.item_id || idaPlanDate(g.document_date) !== q.document_date || idaPlanDate(g.manufacturing_date) !== q.manufacturing_date
        || idaPlanDate(g.expired_date) !== q.expired_date) {
        return broken("line " + (i + 1) + "'s batch request is not the classic batch plan's.");
      }
      // a non-stock line still consumes its number (GENERATE_BATCH ran for it in the classic); D4 writes it into the line, no Batch row
      const row = Object.assign({ key: "B" + (rows.length + 1), kind: "AUTO", insert: stock, batch_number: "", line_ids: [s(l.id)] }, common,
        { initial_quantity: idaQtyStr(baseQty) }, tail, { request: q });
      rows.push(row);
      autoRows++;
      if (!autoSeen[s(it.id)]) {
        autoSeen[s(it.id)] = true;
        autoItems.push({ id: s(it.id), item_category: it.item_category === undefined ? null : it.item_category, item_group_id: it.item_group_id === undefined ? null : it.item_group_id });
      }
      if (stock) bk = row.key;
    }
    alloc.push({ line_id: s(l.id), line_index: s(l.line_index), item_id: s(l.item_selection), share_qty: share, base_qty: baseQty, movement_key: mk, batch_key: bk });
  }
  for (const row of rows) if (row.kind === "TYPED") row.initial_quantity = idaQtyStr(typedBase[row.key]);
  if (movementsI.length !== countI || movementsR.length !== countR) return broken("the plan holds " + movementsI.length + " / " + movementsR.length + " movements for " + countI + " / " + countR + ".");

  const itemDates = [];
  const dated = {};
  for (const u of idaList(run.txn && run.txn.updates)) {
    if (idaDigits(u.id) && !dated[s(u.id)]) {
      dated[s(u.id)] = true;
      itemDates.push({ id: s(u.id) });
    }
  }
  if (!itemDates.length || itemDates[0].id !== s(hdr.item_id)) return broken("the item list does not start with the item being disassembled.");

  const opI = idaOpKey(jobId, "I");
  const opR = idaOpKey(jobId, "R");
  const parts = {
    ENGINE_I: { operation_key: opI, mode: "APPLY", organization_id: orgId, movements: movementsI },
    ENGINE_R: { operation_key: opR, mode: "APPLY", organization_id: orgId, movements: movementsR, alloc: alloc },
    LABELS: labels,
    ITEMS: { itemDates: itemDates },
  };
  if (rows.length) parts.BATCH = { mode: "insert", items: autoItems, rows: rows };
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const name of IDA_PLAN_PARTS) {
    if (!parts[name]) continue;
    const prow = idaPartRows(jobId, orgId, "P|" + nonce + "|" + name + "|", parts[name], "PAYLOAD");
    manifestParts[name] = prow.map((r) => r.step_name);
    for (const r of prow) partRows.push(r);
  }
  const manifest = {
    v: 1, prepared_by: "IDA_V2_PREPARE", job_id: jobId, ida_id: idaId, ida_no: trxNo, action: "DIRECT", prevStatus: s(entry.prevStatus), saveAs: "Completed",
    organization_id: orgId, plant_id: plantId, nonce: nonce, lineFingerprint: s(req.lineFingerprint), batchMode: rows.length ? "insert" : "none", parts: manifestParts,
    counts: { lines: lines.length, picks: movementsI.length, movementsI: movementsI.length, movementsR: movementsR.length, nonStockLines: nonStock, batchRows: rows.length,
      autoRows: autoRows, typedRows: typedRows, items: itemDates.length },
  };
  return Object.assign(base, {
    route: "PLAN", code: "200", message: idaPlanN(movementsI.length, "source pick") + ", " + idaPlanN(movementsR.length, "receipt") + " from " + idaPlanN(lines.length, "line")
      + (rows.length ? ", " + idaPlanN(rows.length, "batch row") : ""),
    payload: JSON.stringify(manifest), partRows: partRows, lineCount: lines.length, pickCount: movementsI.length, moveCount: idaMoveCount(hdr, stored),
    movementCountI: movementsI.length, movementCountR: movementsR.length, organizationId: orgId, opKeyI: opI, opKeyR: opR, movementsI: movementsI, movementsR: movementsR,
    labels: labels,
  });
};
