// LOT_V2_PREPARE - Plan: the stored LOT (locked by this job's SUBMIT) + the job's request (+ SUBMIT's S|..|LINES part for COMPLETE /
// EDIT) -> the classic v82 compute run on the lifted bodies (lotChain) -> the manifest COMMIT executes and its parts as
// gd_publish_step rows P|<nonce>|<PART>|<nnn> (CONTRACT.md sections 5 and 9). Ends READY or FAIL (unlockOk 1: the job holds the
// LOT's lock and nothing was written, so a failure puts the LOT back to prevStatus).
const LOT_BUILT = ["DIRECT", "STAGE", "COMPLETE", "CANCEL", "EDIT"];
const LOT_ACTIONS = { DIRECT: ["Draft", "Completed"], STAGE: ["Draft", "In Progress"], COMPLETE: ["In Progress", "Completed"], EDIT: ["In Progress", "In Progress"],
  CANCEL: ["In Progress", "Cancelled"] };
const LOT_MAX_MOVES = 5000;
// add_node_LOTmainCreate / add_node_LOTreconCreate props, in order
const LOT_IT_CREATE = ["doc_type", "doc_id", "doc_no", "doc_line_id", "line_no", "parent_id", "parent_no", "parent_line_id", "material_id", "item_code", "item_name",
  "item_desc", "item_uom", "batch_id", "handling_unit_id", "plant_id", "organization_id", "transit_bin", "from_plant_id", "from_bin", "from_category", "to_plant_id",
  "to_bin", "to_category", "transit_qty", "received_qty", "open_qty", "status", "transit_date", "received_date", "remark", "target_doc_type", "target_doc_id",
  "target_doc_no", "target_doc_line_id", "source_transit_id"];
const lotDate19 = (v) => {
  const t = lotS(v);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t) ? t.slice(0, 19) : t || null;
};
// the entries the compute bodies walk, parsed exactly as they parse them
const lotEntriesOf = (line) => {
  let entries = [];
  try {
    entries = JSON.parse(line.temp_qty_data || "[]");
  } catch (e) {
    entries = [];
  }
  return Array.isArray(entries) ? entries : [];
};
// LOTmainCompute / LOTcancelCompute push one movement per entry with sm_quantity > 0, line by line: the line of each movement
const lotMainSources = (lines) => {
  const out = [];
  for (const line of lotList(lines)) for (const e of lotEntriesOf(line)) if (lotQ8(e.sm_quantity) > 0) out.push({ line: line });
  return out;
};
// code_node_uht83Wzh's walk (same order, same pushPair rule), recording the line of each movement it pushes
const lotReconSources = (currentData, initialData) => {
  const flat = (rows) => {
    const out = [];
    for (const row of rows || []) {
      out.push(row);
      for (const child of Array.isArray(row.children) ? row.children : []) out.push(child);
    }
    return out;
  };
  const staging = (line) => {
    const byKey = {};
    for (const e of lotEntriesOf(line)) {
      const qty = lotQ8(e.sm_quantity);
      if (qty <= 0) continue;
      const k = `${e.material_id || line.item_selection}|${e.location_id}|${e.batch_id || ""}|${e.category || "Unrestricted"}`;
      if (byKey[k]) byKey[k].qty = lotQ8(byKey[k].qty + qty);
      else byKey[k] = { qty: qty };
    }
    const st = {};
    st.D = line.location_id;
    st.byKey = byKey;
    return st;
  };
  const initLines = {};
  for (const l of flat((initialData || {}).stock_movement)) if (l.id) initLines[l.id] = l;
  const curLines = {};
  for (const l of flat((currentData || {}).stock_movement)) if (l.id) curLines[l.id] = l;
  const allIds = Object.keys(initLines).concat(Object.keys(curLines).filter((x) => !initLines[x]));
  const out = [];
  for (const id of allIds) {
    const init = initLines[id] ? staging(initLines[id]) : null;
    const cur = curLines[id] ? staging(curLines[id]) : null;
    const push = (qty) => {
      if (qty > 0) out.push({ line: curLines[id] || initLines[id] });
    };
    const keys = {};
    if (init) for (const k in init.byKey) keys[k] = 1;
    if (cur) for (const k in cur.byKey) keys[k] = 1;
    if (init && cur && init.D !== cur.D) {
      for (const k in keys) {
        const cq = cur.byKey[k] ? cur.byKey[k].qty : 0;
        const iq = init.byKey[k] ? init.byKey[k].qty : 0;
        const common = Math.min(cq, iq);
        if (common > 0) push(common);
        if (cq > iq) push(cq - iq);
        else if (iq > cq) push(iq - cq);
      }
      continue;
    }
    for (const k in keys) {
      const cq = cur && cur.byKey[k] ? cur.byKey[k].qty : 0;
      const iq = init && init.byKey[k] ? init.byKey[k].qty : 0;
      const d = lotQ8(cq - iq);
      if (d > 0) push(d);
      else if (d < 0) push(-d);
    }
  }
  return out;
};
// COMPLETE fold step 1: the reconcile's ledger writes applied to the rows the main compute reads (creates get ids new:<k>), in the
// form the classic's re-read would have handed on (decimals numbers, null / "" keys absent, transit_date without a fraction)
const lotApplyRecon = (ledger, recon, creates) => {
  const rows = ledger.map((r) => Object.assign({}, r));
  const byId = {};
  for (const r of rows) byId[lotS(r.id)] = r;
  for (const u of lotList(recon.transitUpdates)) {
    const r = byId[lotS(u.id)];
    if (!r) return null;
    r.transit_qty = Number(u.transit_qty);
    r.open_qty = Number(u.open_qty);
    r.status = u.status;
  }
  lotList(creates).forEach((c, i) => {
    const r = lotDrop(Object.assign({}, c, { id: "new:" + (i + 1) }));
    for (const k of LOT_IT_NUM) if (r[k] !== undefined) r[k] = Number(r[k]);
    if (r.transit_date !== undefined) r.transit_date = lotDate19(r.transit_date);
    rows.push(r);
  });
  return rows;
};
const lotItCreate = (c, key) => {
  const o = {};
  for (const k of LOT_IT_CREATE) {
    const v = c[k] === undefined ? null : c[k];
    o[k] = (k === "transit_date" || k === "received_date") && v !== null ? lotDate19(v) : v;
  }
  o.job_line_key = key;
  return o;
};

// the classic SM_LOCATION_TRANSFER v82 path of one action on the lifted bodies; reads = the rebuilt get-node document, the ledger
// rows, the items (pageStatus Edit: the document exists after SUBMIT, so the classic's Add branches are never taken)
const lotChain = function lotChain(IN) {
  const out = { route: "PLANNED", code: "", message: "" };
  const get = { data: { count: 1, data: IN.doc } };
  const search = (rows) => ({ data: { total: rows.length, count: rows.length, data: rows } });
  const ctx = {
    "workflowparams:allData": IN.allData, "workflowparams:saveAs": IN.saveAs, "workflowparams:pageStatus": "Edit", "system:uuid": IN.uuid,
    "node:get_node_czmdH3Jw": get, "node:get_node_Ij7YbXCA": get, "node:get_node_lvTzXllZ": get, "node:get_node_LOTmainLines": get,
  };
  const stop = (code, message) => Object.assign(out, { route: "STOP", code: code, message: message });
  return __withContext(ctx, () => {
    if (IN.action !== "CANCEL") {
      // if_LOTallocGate (saveAs not Draft / Cancelled): the auto allocation; its lines reach yPlLXIZW as get_cache_node_LOTallocOut
      out.alloc = lotAllocLoop(IN.alloc, IN.allocScope, IN.allocWhere);
      // if_LOTallocErr -> return_node_LOTallocErr
      if (out.alloc.route === "STOP") return stop("LOT_ALLOC_FAILED", out.alloc.message);
      if (out.alloc.route === "SCOPE") {
        const l = out.alloc.line || {};
        return stop("LOT_PLAN_FAILED", "The save could not be prepared: line " + (lotS(l.line_index) || "?") + " (" + (lotS(l.item_name) || lotS(out.alloc.row && out.alloc.row.materialId)) +
          ") has no stock selected and cannot be allocated in the background. Select its stock and save again.");
      }
      if (out.alloc.route === "DONE") ctx["node:get_cache_node_LOTallocOut"] = { data: out.alloc.lines };
    }
    out.fill = __run("code_node_yPlLXIZW");
    if (IN.action === "CANCEL") {
      // search_node_LOTitOpenCancel: this document's In Transit rows
      ctx["node:search_node_LOTitOpenCancel"] = search(IN.ledger.filter((r) => r.status === "In Transit"));
      out.cancel = __run("code_node_LOTcancelCompute");
      return out;
    }
    let ledger = IN.ledger;
    if (IN.action === "COMPLETE" || IN.action === "EDIT") {
      ctx["node:search_node_LOTitOpenRecon"] = search(ledger);
      out.recon = __run("code_node_uht83Wzh");
      // if_LOTreconShort -> return_node_LOTreconShort
      if (Number(out.recon.hasShortage) === 1) return stop("LOT_RECON_SHORTAGE", "In Transit reconcile shortage on Location Transfer edit.");
      ctx["node:search_node_LOTitItemsRecon"] = search(IN.items);
      out.reconEnrich = __run("code_node_LOTreconEnrich");
      // EDIT: update_node_TxDhhT03 then return_node_uyJo2Ej7 (no main compute, no Item date stamp)
      if (IN.action === "EDIT") return out;
      ledger = lotApplyRecon(ledger, out.recon, out.reconEnrich.enrichedCreates);
      if (!ledger) return stop("LOT_PLAN_BROKEN", "The save could not be prepared: the reconcile names an In Transit row that was not read.");
    }
    ctx["node:search_node_LOTitOpenMain"] = search(ledger);
    out.docId = __run("code_node_LOTmainDocId");
    out.main = __run("code_node_LOTmainCompute");
    // if_LOTmainShort -> return_node_LOTmainShort
    if (Number(out.main.hasShortage) === 1) return stop("LOT_TRANSIT_SHORTAGE", "Insufficient In Transit quantity to complete this Location Transfer.");
    ctx["node:search_node_LOTitItemsMain"] = search(IN.items);
    out.mainEnrich = __run("code_node_LOTmainEnrich");
    out.items = __run("code_node_0njluBVP");
    return out;
  });
};

const lotPrepPlan = function lotPrepPlan(entry, S, own) {
  const s = lotS;
  const jobId = s(entry.jobId);
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: 0, movementCount: 0, unlockOk: 0 };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const broken = (why) => fail("LOT_PLAN_BROKEN", "The save could not be prepared: " + why);
  if (s(entry.route) !== "GO") return fail(s(entry.result_code), s(entry.result_message));
  const req = entry.request && typeof entry.request === "object" ? entry.request : {};
  const lotId = s(entry.lotId);
  const hdr = lotRows(S.hdr)[0] || null;
  if (!hdr) return fail("LOT_NOT_FOUND", "Location Transfer not found - it may have been deleted.");
  // the job owns the LOT: Processing, lot_v2_job_id = this job, the latest LOCK row carries this job's idempotency key
  const lock = lotList(S.lock).filter((r) => r && s(r.step_name))[0] || null;
  const key = s(entry.idempotencyKey);
  if (s(hdr.stock_movement_status) !== "Processing" || s(hdr.lot_v2_job_id) !== jobId || !lock || !key || s(lock.result_ref) !== key) {
    return fail("LOT_NOT_LOCKED", "The Location Transfer is no longer locked by this save: nothing was moved.");
  }
  base.unlockOk = 1;
  if (own) own.locked = 1;
  const action = s(entry.action);
  const prev = s(entry.prevStatus);
  const saveAs = s(entry.saveAs);
  const want = LOT_ACTIONS[action];
  if (!want || want[0] !== prev || want[1] !== saveAs) return fail("LOT_INVALID_REQUEST", "The save could not be prepared: the job's request names no valid action (" + action + ").");
  if (LOT_BUILT.indexOf(action) < 0) return fail("LOT_ACTION_NOT_BUILT", "This kind of save (" + action + ") is not available in the background yet: please save it again.");
  const orgId = s(hdr.organization_id);
  if (!lotDigits(orgId) || !lotDigits(hdr.issuing_operation_faci)) return broken("the Location Transfer has no organization or plant.");
  // the ledger read is scoped by the job's organization (the classic: the LOT's)
  if (s(entry.organizationId) !== orgId) return broken("the job's organization is not the Location Transfer's.");

  const storedRows = lotRows(S.lines);
  const doc = lotAdaptDoc(hdr, storedRows, prev);
  const ledgerRaw = lotRows(S.transit);
  const ledger = lotAdaptLedger(ledgerRaw);
  const items = lotAdaptItems(lotRows(S.items));
  let allData = doc;
  let sLines = null;
  if (action === "COMPLETE" || action === "EDIT") {
    // S|<nonce>|LINES|<nnn> (SUBMIT): the header props and the filled-back lines L2 writes = the incoming document
    const names = lotList(req.parts && req.parts.LINES).map(s);
    const rows = lotList(S.parts).filter((r) => names.indexOf(s(r.step_name)) >= 0).sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
    if (!names.length || rows.length !== names.length) return broken("its lines part is missing.");
    const part = lotParseJ(rows.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
    if (!part || typeof part !== "object" || s(part.lotId) !== lotId || !Array.isArray(part.stock_movement) || !part.header || typeof part.header !== "object") {
      return broken("its lines part cannot be read.");
    }
    allData = Object.assign({}, doc, part.header, { id: doc.id, stock_movement_no: doc.stock_movement_no, stock_movement_status: prev, stock_movement: part.stock_movement });
    sLines = part.stock_movement;
  }

  let out;
  try {
    out = lotChain({ action: action, saveAs: saveAs, allData: allData, doc: doc, ledger: ledger, items: items, uuid: "LOT" + jobId, alloc: lotAllocAdapt(S),
      allocScope: lotAllocScope(storedRows, s(entry.allocScope)), allocWhere: { plant: s(hdr.issuing_operation_faci), org: orgId } });
  } catch (e) {
    return broken(String((e && e.message) || e).slice(0, 200));
  }
  if (out.route !== "PLANNED") return fail(out.code, out.message);
  const flat = lotList(out.fill.flatLines);
  const rowCount = lotMainSources(flat).length;

  // ENGINE: one SUBTRACT M<n> (unpriced) + ADD M<n>.2 (unit_price_from) per classic movement; COMPLETE: the reconcile pairs first
  const groups = [];
  if (out.recon) groups.push({ c: out.recon, mv: lotList(out.recon.movements), src: lotReconSources(out.fill.allData, doc) });
  if (action !== "EDIT") {
    const c = action === "CANCEL" ? out.cancel : out.main;
    groups.push({ c: c, mv: lotList(c.movements), src: lotMainSources(flat) });
  }
  const bins = {};
  for (const b of lotRows(S.bins)) bins[s(b.id)] = s(b.bin);
  const itemById = {};
  for (const it of items) itemById[s(it.id)] = it;
  const movements = [];
  const labels = {};
  let n = 0;
  for (const g of groups) {
    if (g.src.length !== g.mv.length) return broken("the movements do not match the lines (" + g.mv.length + " / " + g.src.length + ").");
    for (let i = 0; i < g.mv.length; i++) {
      const m = g.mv[i];
      const line = g.src[i].line || {};
      const mk = "M" + ++n;
      const common = { plant_id: s(g.c.plant_id), organization_id: s(g.c.organization_id), material_id: lotIdStr(m.material_id), quantity: lotQ8(m.quantity),
        material_uom: lotIdStr(m.material_uom) || (typeof m.material_uom === "number" ? "" : s(m.material_uom)) || null, transaction_type: "LOT",
        trx_no: s(g.c.stock_movement_no) };
      const tail = { batch_id: lotIdStr(m.batch_id) || null, manufacturing_date: m.manufacturing_date || null, expired_date: m.expired_date || null,
        doc_date: g.c.doc_date === undefined || g.c.doc_date === null ? null : g.c.doc_date, isMovingInv: 1, handling_unit_id: m.handling_unit_id || null };
      const sub = Object.assign({ movement_key: mk, direction: "SUBTRACT" }, common, { inventory_category: s(m.subtractCategory), location_id: lotIdStr(m.subtractLocation) }, tail);
      const add = Object.assign({ movement_key: mk + ".2", direction: "ADD" }, common, { inventory_category: s(m.addCategory), location_id: lotIdStr(m.addLocation) }, tail,
        { unit_price_from: mk });
      if (!lotDigits(sub.material_id) || !lotDigits(sub.plant_id) || !lotDigits(sub.location_id) || !lotDigits(add.location_id) || (m.batch_id && !sub.batch_id) ||
        !(sub.quantity > 0) || sub.organization_id !== orgId || !sub.trx_no || (typeof m.material_uom === "number" && !sub.material_uom)) {
        return broken("movement " + mk + " (line " + s(line.line_index) + ") has no valid item, bin, batch, quantity or number.");
      }
      const it = itemById[s(m.material_id)] || {};
      const label = (side, cat, binId) => ({ line_index: s(line.line_index), line_id: s(line.id), item_code: s(it.material_code), item_name: s(line.item_name) || s(it.material_name),
        bin: bins[binId] || binId, bin_id: binId, category: cat, side: side });
      labels[mk] = label("from", sub.inventory_category, sub.location_id);
      labels[mk + ".2"] = label("to", add.inventory_category, add.location_id);
      movements.push(sub, add);
    }
  }
  if (movements.length > LOT_MAX_MOVES) {
    return fail("LOT_SPLIT_REQUIRED", "This Location Transfer has " + rowCount + " stock rows (" + movements.length +
      " stock movements). At most 2,500 rows and 5,000 movements can be saved at once - please split the transfer.");
  }

  // IT: creates (complete rows + job_line_key), updates { id, source, before (as read), after (the columns the classic node writes) }
  const rawById = {};
  for (const r of ledgerRaw) rawById[s(r.id)] = r;
  const beforeOf = (id, cols) => {
    const r = rawById[id] || {};
    const o = {};
    for (const c of cols) o[c] = r[c] === undefined || r[c] === null ? null : c === "received_date" ? lotDate19(r[c]) : r[c];
    return o;
  };
  const keyN = {};
  const jlk = (lineId) => {
    const k = lotDigits(lineId) ? s(lineId) : "0";
    keyN[k] = (keyN[k] || 0) + 1;
    return jobId + "|" + k + "|" + keyN[k];
  };
  const creates = [];
  const updates = [];
  if (action === "STAGE") for (const c of lotList(out.mainEnrich.enrichedCreates)) creates.push(lotItCreate(c, jlk(c.doc_line_id)));
  if (action === "CANCEL") {
    for (const u of lotList(out.cancel.transitUpdates)) {
      if (!rawById[s(u.id)]) return broken("In Transit row " + s(u.id) + " was not read.");
      updates.push({ id: s(u.id), source: "CANCEL", before: beforeOf(s(u.id), ["open_qty", "status"]), after: { open_qty: s(u.open_qty), status: s(u.status) } });
    }
  }
  if (action === "COMPLETE" || action === "EDIT") {
    const reconCreates = lotList(out.reconEnrich.enrichedCreates).map((c) => Object.assign({}, c));
    const reconUpd = {};
    for (const u of lotList(out.recon.transitUpdates)) reconUpd[s(u.id)] = u;
    const mainAfter = {};
    for (const u of action === "COMPLETE" ? lotList(out.main.transitUpdates) : []) {
      const after = { received_qty: s(u.received_qty), open_qty: s(u.open_qty), status: s(u.status), received_date: u.received_date ? lotDate19(u.received_date) : null };
      const id = s(u.id);
      if (/^new:[0-9]+$/.test(id)) {
        // a create then a close = one insert carrying the closed values
        const c = reconCreates[Number(id.slice(4)) - 1];
        if (!c) return broken("the completion closes a reconcile row that was not created.");
        Object.assign(c, after);
      } else mainAfter[id] = after;
    }
    for (const id of Object.keys(reconUpd)) {
      const r = reconUpd[id];
      if (!rawById[id]) return broken("In Transit row " + id + " was not read.");
      const radj = { transit_qty: s(r.transit_qty), open_qty: s(r.open_qty), status: s(r.status) };
      if (mainAfter[id]) {
        // an adjust then a close = one update
        updates.push({ id: id, source: "FOLD", before: beforeOf(id, ["transit_qty", "received_qty", "open_qty", "status", "received_date"]),
          after: Object.assign({ transit_qty: radj.transit_qty }, mainAfter[id]) });
        delete mainAfter[id];
      } else updates.push({ id: id, source: "RECON", before: beforeOf(id, ["transit_qty", "open_qty", "status"]), after: radj });
    }
    for (const id of Object.keys(mainAfter)) {
      if (!rawById[id]) return broken("In Transit row " + id + " was not read.");
      updates.push({ id: id, source: "MAIN", before: beforeOf(id, ["received_qty", "open_qty", "status", "received_date"]), after: mainAfter[id] });
    }
    for (const c of reconCreates) creates.push(lotItCreate(c, jlk(c.doc_line_id)));
  }

  // HDR: the header's final write (L4); CANCEL also the number (update_node_u5YASPXU)
  const hdrPart = { id: lotId, before: { stock_movement_status: "Processing" }, after: { stock_movement_status: saveAs } };
  if (action === "CANCEL") {
    hdrPart.before.stock_movement_no = s(hdr.stock_movement_no);
    hdrPart.after.stock_movement_no = s(out.fill.allData && out.fill.allData.stock_movement_no);
    if (!hdrPart.after.stock_movement_no) return broken("the cancelled number is empty.");
  }
  // ITEMS: code_node_0njluBVP's updates (DIRECT, STAGE, COMPLETE)
  const itemDates = out.items ? lotList(out.items.updates).map((u) => ({ id: s(u.id), last_transaction_date: s(u.last_transaction_date) })) : [];

  const parts = {
    ENGINE: { operation_key: "SMLT|" + jobId, mode: "APPLY", organization_id: orgId, movements: movements },
    LABELS: labels,
    IT: { creates: creates, updates: updates },
    HDR: hdrPart,
    ITEMS: { itemDates: itemDates },
  };
  // ALLOC (V2.1): the picks the auto allocation wrote on the lines (L2 stores them), and the fingerprint of the lines L2 leaves
  // (DIRECT / STAGE: the stored rows, COMPLETE / EDIT: the S|..|LINES tree; both with these picks)
  if (out.alloc && out.alloc.route === "DONE") {
    const flatAll = (rows) => {
      const o = [];
      for (const r of lotList(rows)) {
        o.push(r);
        for (const c of Array.isArray(r.children) ? r.children : []) o.push(c);
      }
      return o;
    };
    const target = sLines ? flatAll(sLines) : storedRows;
    const known = new Set(target.map((r) => s(r.id)));
    const allocLines = [];
    const at = {};
    for (const idx of out.alloc.done) {
      const l = out.alloc.lines[idx] || {};
      if (!lotDigits(l.id) || !known.has(s(l.id)) || at[s(l.id)] !== undefined) return broken("an auto-allocated line (" + s(l.line_index) + ") is not a line of the transfer.");
      const tq = l.temp_qty_data === undefined || l.temp_qty_data === null ? "" : String(l.temp_qty_data);
      at[s(l.id)] = tq;
      allocLines.push({ id: s(l.id), fm_key: s(l.fm_key), temp_qty_data: tq, total_quantity: Number(l.total_quantity) || 0 });
    }
    parts.ALLOC = { lines: allocLines, fingerprint: lotLineFingerprint(target.map((r) => (at[s(r.id)] !== undefined ? Object.assign({}, r, { temp_qty_data: at[s(r.id)] }) : r))) };
  }
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const name of Object.keys(parts)) {
    const rows = lotPartRows(jobId, orgId, "P|" + nonce + "|" + name + "|", parts[name], "PAYLOAD");
    manifestParts[name] = rows.map((r) => r.step_name);
    for (const r of rows) partRows.push(r);
  }
  const storedLines = lotList(doc.stock_movement).reduce((t, l) => t + 1 + lotList(l.children).length, 0);
  const lineCount = Math.max(Number(req.lineCount) || 0, storedLines, flat.length);
  const manifest = {
    v: 1, prepared_by: "LOT_V2_PREPARE", job_id: jobId, lot_id: lotId, lot_no: s(hdr.stock_movement_no), action: action, prevStatus: prev, saveAs: saveAs,
    organization_id: orgId, plant_id: s(hdr.issuing_operation_faci), nonce: nonce, lineCount: lineCount, lineFingerprint: s(req.lineFingerprint),
    incomingFingerprint: s(req.incomingFingerprint), parts: manifestParts, sparts: req.parts && typeof req.parts === "object" ? req.parts : {},
    counts: { lines: flat.length, rows: rowCount, movements: movements.length, itCreates: creates.length, itUpdates: updates.length, items: itemDates.length,
      allocated: parts.ALLOC ? parts.ALLOC.lines.length : 0 },
  };
  return Object.assign(base, {
    route: "READY", code: "200", message: action + ": " + movements.length + " movements for " + rowCount + " stock rows of " + flat.length + " lines" +
      (parts.ALLOC ? " (" + parts.ALLOC.lines.length + " auto-allocated)" : ""),
    payload: JSON.stringify(manifest), partRows: partRows, lineCount: lineCount, movementCount: movements.length,
  });
};
