// IA_V2_PREPARE - Plan: the classic IA_SAVE v11 issue / receipt bodies (lifted) on the stored rows -> parts, manifest, PLAN requests
const IA_PLAN_BATCH_AUTO = "According To System Settings";
const IA_PLAN_NOT_FOUND = "Item Assembly not found - it may have been deleted.";
const IA_PLAN_PARTS = ["ENGINE_I", "ENGINE_R", "BATCH", "LABELS", "ITEMS"];
const iaPlanWhy = (why) => "The completion could not be prepared: " + why;
const iaPlanText = (v) => (v === undefined || v === null ? "" : String(v));
const iaPlanContext = function iaPlanContext(allData, items, persisted) {
  return { "workflowparams:allData": allData, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Edit",
    "node:search_items": { data: { total: items.length, count: items.length, data: items } }, "node:code_persisted": { data: persisted },
    "node:search_movements": { data: { total: 0, count: 0, data: [] } } };
};
// slim: each issue iteration gets only what code_issue_line reads (same outputs; a full copy per line is quadratic)
const iaPlanRun = function iaPlanRun(ctx, storedBatchNo, slim) {
  return __withContext(ctx, () => {
    const fill = __run("code_fillback");
    const decide = __run("code_batch_decide");
    // code_batch_number: the generated number is the one SUBMIT wrote into batch_no
    ctx["node:code_batch_number"] = { data: { batchNumber: decide.isBatch === "Y" ? storedBatchNo : "" } };
    const fullFill = ctx["node:code_fillback"];
    const fullItems = ctx["node:search_items"];
    const fullPersisted = ctx["node:code_persisted"];
    const byId = {};
    for (const it of iaList(fullItems.data.data)) if (!(String(it.id) in byId)) byId[String(it.id)] = it;
    if (slim) {
      const head = Object.assign({}, fill.allData);
      delete head.stock_movement;
      ctx["node:code_fillback"] = { data: { allData: head, storedStatus: fill.storedStatus } };
      ctx["node:code_persisted"] = { data: { docId: fullPersisted.data.docId, stock_movement_no: fullPersisted.data.stock_movement_no } };
    }
    const issues = [];
    for (const line of iaList(fill.allData && fill.allData.stock_movement)) {
      ctx["node:loop_issue_lines"] = line;
      if (slim) {
        const it = byId[String(line.item_selection)];
        ctx["node:search_items"] = { data: { total: it ? 1 : 0, count: it ? 1 : 0, data: it ? [it] : [] } };
      }
      const q = __run("code_issue_line");
      for (const pick of iaList(q.balancesToProcess)) {
        ctx["node:loop_issue_picks"] = pick;
        issues.push({ line: line, q: q, g: __run("code_issue_pick") });
      }
    }
    ctx["node:code_fillback"] = fullFill;
    ctx["node:search_items"] = fullItems;
    ctx["node:code_persisted"] = fullPersisted;
    return { fill: fill, decide: decide, issues: issues, receipt: __run("code_receipt_prep"), txn: __run("code_item_txn") };
  });
};
// the classic wf_subtract params minus itemData, + movement_key, direction, parent_trx_no, isMovingInv (CONTRACT.md section 5)
const iaPlanIssue = function iaPlanIssue(key, q, g) {
  return { movement_key: key, direction: "SUBTRACT", plant_id: iaS(q.plant_id), organization_id: iaS(q.organization_id), material_id: iaS(q.material_id),
    quantity: iaQ8(g.quantity), material_uom: iaS(q.material_uom), transaction_type: "IA", trx_no: iaPlanText(q.stock_movement_no), parent_trx_no: "",
    inventory_category: iaS(g.inventory_category), location_id: iaS(g.location_id), batch_id: iaS(g.batch_id) || null, manufacturing_date: g.manufacturing_date || null,
    expired_date: g.expired_date || null, doc_date: q.doc_date || null, isMovingInv: 0, handling_unit_id: null };
};
// the classic wf_add params minus itemData / batch_number; unit_price and batch_id are filled by COMMIT (I3 / I1)
const iaPlanReceipt = function iaPlanReceipt(r) {
  return { movement_key: "R1", direction: "ADD", plant_id: iaS(r.plant_id), organization_id: iaS(r.organization_id), material_id: iaS(r.material_id),
    quantity: iaQ8(r.quantity), material_uom: iaS(r.material_uom), transaction_type: "IA", trx_no: iaPlanText(r.trx_no), parent_trx_no: "",
    inventory_category: iaS(r.inventory_category), location_id: iaS(r.location_id), batch_id: null, unit_price: 0, doc_date: r.doc_date || null,
    manufacturing_date: r.manufacturing_date || null, expired_date: r.expired_date || null, remark: iaPlanText(r.remark), remark2: iaPlanText(r.remark2),
    remark3: iaPlanText(r.remark3), isMovingInv: 0, handling_unit_id: null };
};

const iaPrepPlan = function iaPrepPlan(entry, S, own) {
  const s = iaS;
  const jobId = s(entry.jobId);
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: 0, pickCount: 0, movementCount: 0, unlockOk: 0, organizationId: "",
    opKeyI: "", opKeyR: "", movementsI: [], movementsR: [], labels: {} };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const failed = (why) => fail("IA_PLAN_FAILED", iaPlanWhy(why));
  const broken = (why) => fail("IA_PLAN_BROKEN", iaPlanWhy(why));
  if (s(entry.route) !== "GO") return fail(s(entry.result_code), s(entry.result_message));
  const req = entry.request && typeof entry.request === "object" ? entry.request : {};
  const iaId = s(entry.iaId);
  const owner = iaList(S.owner)[0] || {};
  const hdr = iaRows(S.hdr)[0] || null;
  if (!hdr || s(hdr.id) !== iaId || s(owner.ia_id) !== iaId) return fail("IA_NOT_FOUND", IA_PLAN_NOT_FOUND);
  // only after the lock check may a failure unlock
  const key = s(entry.idempotencyKey);
  const mine = (r) => s(r.item_assembly_status) === "Processing" && s(r.ia_v2_job_id) === jobId;
  if (!mine(owner) || !mine(hdr) || !key || s(owner.lock_ref) !== key) return fail("IA_NOT_LOCKED", IA_TEXT.notLocked);
  base.unlockOk = 1;
  if (own) own.locked = 1;
  if (s(req.action) !== "DIRECT" || s(req.saveAs) !== "Completed" || !iaPrevStatusOk(entry.prevStatus)) {
    return fail("IA_INVALID_REQUEST", iaPlanWhy("the job's request names no valid action (" + s(req.action) + " / " + s(req.saveAs) + " / " + s(entry.prevStatus) + ")."));
  }
  if (s(req.iaId) && s(req.iaId) !== iaId) return broken("the job's request names another Item Assembly (" + s(req.iaId) + ").");
  const orgId = s(hdr.organization_id);
  const plantId = s(hdr.issuing_operation_faci);
  if (!iaDigits(orgId) || !iaDigits(plantId)) return broken("the Item Assembly has no organization or plant.");
  if (s(entry.organizationId) !== orgId) return broken("the job's organization is not the Item Assembly's.");
  const trxNo = iaPlanText(hdr.stock_movement_no);
  if (!s(trxNo) || s(trxNo) === "issued" || s(trxNo) === "draft") return broken("the Item Assembly has no issued number (" + (s(trxNo) || "empty") + ").");
  if (s(req.iaNo) !== s(trxNo)) return broken("its number " + s(trxNo) + " is not the request's (" + (s(req.iaNo) || "none") + ").");
  if (s(req.lineFingerprint).indexOf("IF1:") !== 0) return broken("the job's request has no line fingerprint.");
  if (iaLineFingerprint(S.lines, S.hdr) !== s(req.lineFingerprint)) return fail("IA_LINES_CHANGED", IA_TEXT.linesChanged);

  const header = iaAdaptHeader(hdr, s(entry.prevStatus));
  const stored = iaAdaptLines(S.lines);
  header.stock_movement = stored;
  const items = iaAdaptItems(S.items);
  const itemOf = (id) => iaItemOf(items, id);
  const parent = itemOf(hdr.item_id);
  if (!parent) return failed("item " + s(hdr.item_id) + " not found.");
  for (const l of stored) if (!itemOf(l.item_selection)) return failed("item " + s(l.item_selection) + " (line " + s(l.line_index) + ") not found.");
  if (s(parent.stock_control) === "0") return failed("the assembled item is not stock controlled.");
  const serial = [parent].concat(stored.map((l) => itemOf(l.item_selection))).filter((it) => s(it.serial_number_management) === "1")[0];
  if (serial) return failed("item " + (s(serial.material_code) || s(serial.id)) + " is serial-numbered.");
  if (iaJsonList(hdr.table_hu).length || stored.some(iaLineHasHu)) return failed("it picks from handling units.");

  let run;
  try {
    const persisted = { docId: iaId, stock_movement_no: trxNo, stock_movement: JSON.stringify(stored) };
    run = iaPlanRun(iaPlanContext(header, items, persisted), iaPlanText(hdr.batch_no), 1);
  } catch (e) {
    return broken("the classic parameter code failed (" + String((e && e.message) || e).slice(0, 160) + ").");
  }
  const decide = run.decide || {};
  const isBatch = s(decide.isBatch) === "Y";
  if (isBatch && Number(decide.needsGen) !== 1) return failed("the assembled item's batch number is entered manually.");
  if (isBatch && !s(hdr.batch_no)) return failed("the assembled item is batch managed but has no batch number.");
  if (isBatch !== (s(parent.batch_number_genaration) === IA_PLAN_BATCH_AUTO && s(parent.item_batch_management) === "1")) {
    return broken("the batch decision does not match the item.");
  }
  const lines = iaList(run.fill.allData && run.fill.allData.stock_movement);
  const bins = {};
  for (const b of iaRows(S.bins)) bins[s(b.id)] = s(b.bin);

  const movements = [];
  const labels = {};
  let nonStock = 0;
  for (const l of lines) if (s((itemOf(l.item_selection) || {}).stock_control) === "0") nonStock++;
  for (const x of run.issues) {
    const it = itemOf(x.line.item_selection) || {};
    if (s(it.stock_control) === "0") continue;
    const mk = "M" + (movements.length + 1);
    const mv = iaPlanIssue(mk, x.q, x.g);
    if (!iaDigits(mv.material_id) || !iaDigits(mv.plant_id) || !iaDigits(mv.location_id) || (mv.batch_id !== null && !iaDigits(mv.batch_id)) || !(mv.quantity > 0) ||
      mv.organization_id !== orgId || mv.plant_id !== plantId || mv.trx_no !== trxNo || (mv.material_uom !== "" && !iaDigits(mv.material_uom))) {
      return broken("movement " + mk + " (line " + s(x.line.line_index) + ") has no valid item, plant, bin, batch, quantity or number.");
    }
    if (IA_OK_CATEGORIES.indexOf(mv.inventory_category) < 0) return failed("line " + s(x.line.line_index) + " picks " + mv.inventory_category + " stock.");
    labels[mk] = { line_index: s(x.line.line_index), line_id: s(x.line.id), item_code: s(it.material_code), item_name: s(x.line.item_name) || s(it.material_name),
      bin: bins[mv.location_id] || mv.location_id, bin_id: mv.location_id, category: mv.inventory_category, side: "out" };
    movements.push(mv);
  }
  if (!movements.length) return failed("no stock to issue.");
  if (movements.length > IA_MAX_PICKS) return fail("IA_SPLIT_REQUIRED", IA_TEXT.splitRequired(movements.length));

  const r1 = iaPlanReceipt(run.receipt || {});
  if (!iaDigits(r1.material_id) || r1.material_id !== s(hdr.item_id) || !iaDigits(r1.location_id) || !(r1.quantity > 0) || r1.organization_id !== orgId ||
    r1.plant_id !== plantId || r1.trx_no !== trxNo || (r1.material_uom !== "" && !iaDigits(r1.material_uom))) {
    return broken("the receipt has no valid item, plant, bin, quantity or number.");
  }
  if (IA_OK_CATEGORIES.indexOf(r1.inventory_category) < 0) return failed("the assembled item is received as " + r1.inventory_category + " stock.");
  const receiptBaseQty = iaUomOf(parent, r1.quantity, r1.material_uom).baseQty;
  if (!(receiptBaseQty > 0)) return broken("the receipt's base quantity is " + receiptBaseQty + ".");
  labels.R1 = { line_index: "", line_id: "", item_code: s(parent.material_code), item_name: s(parent.material_name), bin: bins[r1.location_id] || r1.location_id,
    bin_id: r1.location_id, category: r1.inventory_category, side: "in" };
  const opI = iaOpKey(jobId, "I");
  const opR = iaOpKey(jobId, "R");
  const itemDates = [];
  for (const u of iaList(run.txn && run.txn.updates)) if (iaDigits(u.id) && !itemDates.some((d) => d.id === s(u.id))) itemDates.push({ id: s(u.id) });
  if (!itemDates.length || itemDates[0].id !== s(hdr.item_id)) return broken("the item list does not start with the assembled item.");

  const parts = {
    ENGINE_I: { operation_key: opI, mode: "APPLY", organization_id: orgId, movements: movements },
    ENGINE_R: { operation_key: opR, mode: "APPLY", organization_id: orgId, receiptBaseQty: receiptBaseQty, assemblyCost: iaQ8(parent.assembly_cost), movements: [r1] },
    LABELS: labels,
    ITEMS: { itemDates: itemDates },
  };
  if (isBatch) {
    parts.BATCH = { mode: "insert", row: { batch_number: iaPlanText(hdr.batch_no), material_id: r1.material_id, initial_quantity: iaQtyStr(receiptBaseQty), transaction_no: trxNo,
      plant_id: plantId, organization_id: orgId, remark: r1.remark, remark2: r1.remark2, remark3: r1.remark3, manufacturing_date: r1.manufacturing_date,
      expired_date: r1.expired_date } };
  }
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const name of IA_PLAN_PARTS) {
    if (!parts[name]) continue;
    const rows = iaPartRows(jobId, orgId, "P|" + nonce + "|" + name + "|", parts[name], "PAYLOAD");
    manifestParts[name] = rows.map((r) => r.step_name);
    for (const r of rows) partRows.push(r);
  }
  const manifest = {
    v: 1, prepared_by: "IA_V2_PREPARE", job_id: jobId, ia_id: iaId, ia_no: trxNo, action: "DIRECT", prevStatus: s(entry.prevStatus), saveAs: "Completed",
    organization_id: orgId, plant_id: plantId, nonce: nonce, lineFingerprint: s(req.lineFingerprint), batchMode: isBatch ? "insert" : "none", parts: manifestParts,
    counts: { lines: lines.length, picks: run.issues.length, movementsI: movements.length, nonStockLines: nonStock, items: itemDates.length },
  };
  return Object.assign(base, {
    route: "PLAN", code: "200", message: movements.length + " component picks from " + lines.length + " lines, 1 receipt" + (isBatch ? " (batch " + s(hdr.batch_no) + ")" : ""),
    payload: JSON.stringify(manifest), partRows: partRows, lineCount: lines.length, pickCount: run.issues.length, movementCount: movements.length, organizationId: orgId,
    opKeyI: opI, opKeyR: opR, movementsI: movements, movementsR: [r1], labels: labels,
  });
};
