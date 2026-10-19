// GR_COMPLETE_PREPARE - Plan: the stored GR (SUBMIT stored the filled-back lines and set gr_status Processing under this
// job) run through GOODS_RECEIVING's "Save as Completed" path on the lifted bodies (chain.js), the auto batch numbers
// previewed with batchnum.js (C1 numbers them for real), -> the manifest COMMIT works from: a small header for
// gd_async_job.prepared_payload and six parts (BATCH, ENGINE, PO, TO, GR, AFTER) as gd_publish_step rows
// `P|<nonce>|<PART>|<nnn>` (400,000-char chunks). Ends FAIL (job FAILED; the GR goes back to its previous status when
// this job holds its lock) or READY.
// opts: { now (epoch ms; the clock "Document Created Date" numbering and the item dates read), allowWA (Weighted Average
//         items stay NOT_ELIGIBLE until INVENTORY_BULK_APPLY's 4-dp price change lands), maxMovements (5000, the engine's),
//         withMovements (false: no `movements` copy in the output - only an INVENTORY_BULK_APPLY PLAN call needs it),
//         debug (the parts as objects too) }
const GR_PARTS = ["BATCH", "ENGINE", "PO", "TO", "GR", "AFTER"];

// get_node_UeM3HpzR after update_node_a31whzYI: the stored GR with gr_status = saveAs and the columns
// code_node_ApplyBatches set on each line (generated batch numbers; a hierarchy child's batch and dates, a hierarchy
// parent's quantities)
const grReadBack = function grReadBack(stored, appliedTree, saveAs) {
  const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const gr = JSON.parse(JSON.stringify(stored));
  gr.gr_status = saveAs;
  const applied = {};
  for (const r of flat(appliedTree)) if (r.id !== undefined && r.id !== null) applied[String(r.id)] = r;
  for (const r of flat(gr.table_gr)) {
    const a = applied[String(r.id)];
    if (!a) continue;
    for (const c of ["item_batch_no", "manufacturing_date", "expired_date", "received_qty", "base_received_qty"]) {
      const v = a[c];
      if (v === undefined || v === null || v === "") delete r[c];
      else if (c === "received_qty" || c === "base_received_qty") r[c] = Number(v);
      else r[c] = String(v);
    }
  }
  return gr;
};

const grPlan = function grPlan(entry, S, opts) {
  const o = opts || {};
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v || 0);
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const DIG = /^[0-9]{1,20}$/;
  const req = entry.request || {};
  const base = {
    route: "FAIL", code: "", message: "", operationKey: "", organizationId: s(entry.organizationId), grId: s(entry.grId), grNo: "",
    previousStatus: "", payload: "", partRows: [], movements: [], lineCount: 0, movementCount: 0, unlockOk: 0,
  };
  const fail = (code, message) => Object.assign(base, { route: "FAIL", code: code, message: message });
  const prev = s(entry.previousStatus) || s(req.previousStatus);
  if (prev !== "Draft" && prev !== "Created") return fail("GRC_INVALID_REQUEST", "the job's previous status is " + (prev || "missing") + ": only a Draft or Created Goods Receiving is completed");
  base.previousStatus = prev;

  // (a parity harness hands recorded reads already in the adapter's shapes)
  const R = o.adapted || grAdapt(S);
  if (!R.gr.count) return fail("GRC_GR_NOT_FOUND", "Goods Receiving " + s(entry.grId) + " not found");
  const stored = R.gr.data;
  base.grNo = s(stored.gr_no);
  const lock = R.lock || {};
  const mine = s(lock.result_ref) !== "" && s(lock.result_ref) === s(entry.idempotencyKey);
  if (s(stored.gr_status) !== "Processing" || !mine) {
    return fail("GRC_NOT_LOCKED", "Goods Receiving is " + s(stored.gr_status) + (mine ? "" : ", locked by another submit") + ": not Processing under this job");
  }
  if (s(stored.organization_id) !== s(entry.organizationId)) return fail("GRC_INVALID_REQUEST", "the Goods Receiving belongs to another organization");
  // from here a failure puts the GR back to its previous status (this job holds its lock)
  base.unlockOk = 1;
  // a Created receipt's reservation is the one SUBMIT read from its lines before it stored the form's (code_node_origReserved's
  // rule): the stored lines are the new ones by now, so it is never recomputed here
  const origReserved = prev === "Created" ? req.origReserved : {};
  if (!origReserved || typeof origReserved !== "object" || Array.isArray(origReserved)) return fail("GRC_INVALID_REQUEST", "the job carries no reservation map for a Created Goods Receiving");
  // SUBMIT issued the number (a Draft's, as the classic fill-back does) and relinked it into the request: a sentinel or another number fails
  const no = s(stored.gr_no);
  if (no === "" || no === "draft" || no === "issued") return fail("GRC_NO_NUMBER", "the Goods Receiving has no number yet (" + (no || "empty") + ")");
  if (s(req.grNo) !== "" && s(req.grNo) !== no) return fail("GRC_INVALID_REQUEST", "the Goods Receiving number is " + no + ", the job was submitted for " + s(req.grNo));

  // NOT_ELIGIBLE (SUBMIT routes these to the classic save; checked again on what was stored)
  const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const lines = flat(stored.table_gr);
  if (!lines.length) return fail("GRC_400", "All Received Quantity must not be 0. Please add at lease one item with received quantity > 0.");
  const itemById = {};
  for (const it of R.items.data) itemById[s(it.id)] = it;
  const ne = (why) => fail("GRC_NOT_ELIGIBLE", why + ": complete it with the classic save");
  for (const l of lines) {
    if ((l.is_split === "Yes" && l.parent_or_child === "Parent") || l.parent_or_child === "Child") return ne("hierarchy split lines");
    if (l.item_bundle_id) return ne("item bundles");
    if (s(l.temp_hu_data) !== "" && s(l.temp_hu_data) !== "[]") return ne("handling units");
    if (l.inv_category === "Quality Inspection" || l.inspection_required === "Yes") return ne("quality inspection");
    const it = itemById[s(l.item_id)];
    if (it && num(it.serial_number_management) === 1) return ne("serial-numbered items");
  }

  // GOODS_RECEIVING's request for this GR: an Edit of the stored GR, at the status SUBMIT took it from
  const allData = JSON.parse(JSON.stringify(stored));
  allData.gr_status = prev;
  allData.previous_status = prev;
  const params = { allData: allData, saveAs: "Completed", pageStatus: "Edit", continueZero: s((req.answers || {}).continueZero) };
  const now = typeof o.now === "number" ? o.now : Date.now();
  let bn = null;
  const out = grChain({
    params: params, tenantId: s(entry.tenantId), uuid: "GRC" + s(entry.jobId), numberedInCommit: true,
    origReserved: origReserved,
    reads: {
      putawaySetup: R.putawaySetup, items: R.items, poDocs: R.poDocs, origGR: { total: 1, count: 1, data: [stored] }, loadingBay: R.loadingBay,
      putawayRule: R.putawayRule, poLines: R.poLines, poHeaders: R.poHeaders, onOrder: R.onOrder, batches: R.batches,
      readBack: (ad, appliedTree, saveAs) => grReadBack(stored, appliedTree, saveAs),
    },
    batchNumbers: (requests) => {
      bn = bnNumber(R.bncRows, R.bnItems, requests, { now: now });
      return requests.map((q, k) => bn.results[k] || { ok: false, message: "not numbered" });
    },
  });
  if (out.route !== "PLANNED") {
    const code = out.route === "NOT_ELIGIBLE" ? "GRC_NOT_ELIGIBLE" : out.code === "BATCH" ? "GRC_BATCH_NUMBER" : "GRC_" + out.code;
    return fail(code, out.message || out.route);
  }

  const jobId = s(entry.jobId);
  const org = s(stored.organization_id);
  const plant = s(stored.plant_id);
  const grNo = s(stored.gr_no);
  const refKey = (v) => (typeof v === "string" && v.indexOf(GR_BATCH_REF) === 0 ? v.slice(GR_BATCH_REF.length) : null);
  const H = (key) => __withContext(out.ctx, () => __v(key));
  const loopRows = H("node:code_node_4r2Fv9G5.data.loopRows") || [];
  const fromCreated = s(H("node:code_node_4r2Fv9G5.data.allData.previous_status")) === "Created";

  // ENGINE: one ADD per ADD_INVENTORY call, its parameter set (itemData aside); a batch C1 creates is a batch_ref
  const movements = [];
  let waLines = 0;
  const refLines = {};
  for (const t of out.rows) {
    if (!t.movement) continue;
    const m = Object.assign({ movement_key: "M" + (movements.length + 1), direction: "ADD" }, JSON.parse(JSON.stringify(t.movement)));
    const ref = refKey(t.add && t.add.batchId) || refKey(m.batch_id);
    if (ref) {
      delete m.batch_id;
      m.batch_ref = ref;
      m.batch_number = "-";
      (refLines[ref] = refLines[ref] || []).push(t.line_id);
    }
    // a stock-control-0 item: ADD_INVENTORY answered 401 before its batch add, and the engine answers 401 too - but it
    // refuses (UNSUPPORTED_NEW_BATCH) any ADD naming a batch number without a batch_id first, so none is named
    if (t.add && t.add.code === "401" && !m.batch_ref) m.batch_number = "-";
    t.movementKey = m.movement_key;
    const item = (t.d && t.d.itemData) || {};
    const where = "Line " + (t.index + 1) + " (" + s((t.d.grItem || {}).item_name || item.material_name) + ")";
    if (!DIG.test(s(m.material_id)) || !DIG.test(s(m.plant_id)) || !DIG.test(s(m.location_id))) {
      return fail("GRC_INVALID_MOVEMENT", where + ": no " + (!DIG.test(s(m.location_id)) ? "bin location" : !DIG.test(s(m.plant_id)) ? "plant" : "item") + " to receive into");
    }
    if (m.batch_id !== undefined && !DIG.test(s(m.batch_id))) return fail("GRC_INVALID_MOVEMENT", where + ": batch " + s(m.batch_id) + " is not a batch id");
    // a negative price: the old movement add refused it (inventory_movement.unit_price >= 0; prod add_node_3wRWQCyv
    // failures), and an ADD_INVENTORY call carrying a negative unit_price / po_amount never ran at all (prod GR-MY2610-028
    // / -029: a discount line of a stock-control-0 item - the classic's loop dropped that row's on-order update, putaway
    // line and in-transit row and still answered 200). The engine accepts it, so V2 refuses the receipt instead.
    if (Number(m.unit_price) < 0 || Number(m.po_amount) < 0 || (t.add && t.add.code === "200" && (Number(t.add.unitPrice) < 0 || Number(t.add.totalPrice) < 0))) {
      const shown = Number(m.unit_price) < 0 ? m.unit_price : Number(m.po_amount) < 0 ? m.po_amount : t.add.unitPrice;
      return fail("GRC_NEGATIVE_PRICE", where + ": the unit price is negative (" + shown + "). A receipt with a negative-priced line is completed by the classic save.");
    }
    if (num(item.stock_control) !== 0 && s(item.material_costing_method) === "Weighted Average") waLines++;
    movements.push(m);
  }
  if (waLines > 0 && !o.allowWA) return fail("GRC_NOT_ELIGIBLE", "Weighted Average items: complete it with the classic save");
  if (movements.length > (o.maxMovements || 5000)) return fail("GRC_NOT_ELIGIBLE", movements.length + " stock movements, more than one completion carries");

  // BATCH: rows in loop order (the auto-numbered ones in GENERATE_BATCH call order), one per auto-numbered line, one per
  // manual number + item + plant + organization that this completion creates
  const callByIndex = {};
  (out.batchCalls || []).forEach((c, k) => { callByIndex[c.index] = { call: c, result: bn ? bn.results[k] : null }; });
  const createdByIndex = {};
  for (const c of out.createdBatches) if (c.by === "add") createdByIndex[c.index] = c;
  const pick = (m, k) => (m[k] === undefined ? null : m[k]);
  const rows = [];
  const autoLines = [];
  const autoItems = {};
  for (const t of out.rows) {
    const auto = callByIndex[t.index];
    const created = createdByIndex[t.index];
    if (!auto && !created) continue;
    const m = t.movement || {};
    const key = created ? refKey(created.ref) : "A" + (t.index + 1);
    const row = {
      key: key, insert: !!created, line_ids: created ? (refLines[key] || [t.line_id]) : [t.line_id], material_id: s(m.material_id || (t.d && t.d.material_id)) || null,
      plant_id: s(m.plant_id || plant) || null, organization_id: s(m.organization_id || org) || null,
      batch_number: auto ? null : s(created.batch_number), config_id: auto && auto.result ? s(auto.result.config_id) || null : null, existing_batch_id: null,
      initial_quantity: created ? created.base_qty : null, transaction_no: grNo, remark: pick(m, "remark"), remark2: pick(m, "remark2"), remark3: pick(m, "remark3"),
      manufacturing_date: pick(m, "manufacturing_date"), expired_date: pick(m, "expired_date"),
      request: auto ? auto.call.request : null, provisional_number: auto && auto.result ? s(auto.result.batch_number) : null,
    };
    rows.push(row);
    if (auto) {
      autoLines.push({ id: t.line_id, key: key });
      autoItems[row.material_id] = true;
    }
  }
  // an auto-numbered line that receives nothing (stock control 0: ADD_INVENTORY answers 401 before its batch add) still
  // consumes a number and stores it on the line (insert: false)
  const configs = bn ? Object.entries(bn.configs).map(([id, c]) => ({ id: id, before: c.before, count: c.count })) : [];
  const BATCH = {
    configs: configs,
    items: R.bnItems.filter((i) => autoItems[s(i.id)]).map((i) => ({ id: s(i.id), item_category: i.item_category === undefined ? null : i.item_category, item_group_id: i.item_group_id === undefined ? null : i.item_group_id })),
    rows: rows,
  };

  // PO: deltas COMMIT applies to fresh rows (H4Eg0oEI per PO line, W4nXz7Yb per on-order line, e9pINRwN's facts for C0)
  const poLineInfo = {};
  for (const l of R.poLines) poLineInfo[s(l.id)] = l;
  const orig = H("node:code_node_origReserved.data.origReserved") || {};
  const poLines = [];
  const poLineAt = {};
  const onOrder = [];
  const ooAt = {};
  for (const t of out.rows) {
    const d = t.d;
    const line = s(d.po_line_id);
    if (num(d.updatesPOLine) === 1 && line) {
      let e = poLineAt[line];
      if (!e) {
        e = poLineAt[line] = { id: line, po_id: s((poLineInfo[line] || {}).purchase_order_id) || s(d.po_id), delta_received: 0, release_created: 0, gr_total: 0, tolerance: 0, item_name: "" };
        poLines.push(e);
      }
      e.delta_received = q8(e.delta_received + (q8(d.quantity) || 0));
      if (fromCreated && num(d.isFirstReservationRow) === 1) e.release_created = q8(e.release_created + q8(orig[line] || 0));
    }
    if (num(d.updatesOnOrder) === 1 && line) {
      let e = ooAt[line];
      if (!e) {
        e = ooAt[line] = { po_line_id: line, delta: 0, delta_exact: 0 };
        onOrder.push(e);
      }
      const g = d.grItem || {};
      e.delta = q8(e.delta + num(d.onOrderQty));
      e.delta_exact = q8(e.delta_exact + (q8(g.base_received_qty) || q8(g.received_qty) || 0));
    }
  }
  // code_node_e9pINRwN's per-PO-line totals (its rule, re-run by C0 on a fresh PO line)
  const isBundleParentRow = (row) => Boolean(row.item_bundle_id) && !row.item_id;
  const totals = new Map();
  for (const g of loopRows) {
    if (g.is_split === "Yes" && g.parent_or_child === "Parent") continue;
    const id = g.po_line_item_id;
    if (!id) continue;
    const q = parseFloat(g.received_qty || 0);
    if (totals.has(id)) totals.get(id).total = q8(totals.get(id).total + q);
    else totals.set(id, { total: q, itemId: g.item_id, uom: g.ordered_qty_uom, name: g.item_name || g.material_name || (isBundleParentRow(g) ? "Item bundle" : "Unknown Item") });
  }
  for (const e of poLines) {
    const t = totals.get(e.id);
    if (!t) continue;
    const it = itemById[s(t.itemId)] || {};
    e.gr_total = t.total;
    e.tolerance = ((it.table_uom_conversion || []).find((c) => c.alt_uom_id === t.uom) || {}).over_receive_tolerance || 0;
    e.item_name = t.name;
  }
  const poIds = [...new Set(loopRows.map((r) => s(r.line_po_id)).filter((x) => DIG.test(x)))].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const PO = { poIds: poIds, fromCreated: fromCreated, poLines: poLines, onOrder: onOrder };

  // TO: the putaway (code_node_jo9g6Ldx) without its lines, its lines, the in-transit rows (code_node_ITrows). A TO line
  // keeps its batch in batch_no (the column: an existing batch's id, or "" + batch_ref when C1 creates it); an in-transit
  // row in batch_id (or batch_ref). target_doc_id / target_doc_no are C4's.
  const toLine = (l) => {
    const x = JSON.parse(JSON.stringify(l));
    const ref = refKey(x.batch_no);
    if (ref) {
      x.batch_no = "";
      x.batch_ref = ref;
    }
    if (Array.isArray(x.children)) x.children = x.children.map(toLine);
    return x;
  };
  let header = null;
  let toLines = [];
  if (out.putaway) {
    header = JSON.parse(JSON.stringify(out.putaway));
    toLines = (header.table_putaway_item || []).map(toLine);
    delete header.table_putaway_item;
  }
  const inTransit = ((out.inTransit && out.inTransit.inTransitRows) || []).map((r) => {
    const x = JSON.parse(JSON.stringify(r));
    x.line_id = s(x.doc_line_id);
    if (x.target_doc_id === "TOREF") x.target_doc_id = "";
    if (x.target_doc_no === "TOREF") x.target_doc_no = "";
    const ref = refKey(x.batch_id);
    if (ref) {
      delete x.batch_id;
      x.batch_ref = ref;
    }
    return x;
  });
  const TO = { header: header, lines: toLines, inTransit: inTransit };

  const patch = { gr_status: s(out.saveAs) };
  if (out.putawayStatus) patch.putaway_status = out.putawayStatus;
  const GR = { patch: patch, autoLines: autoLines };
  const AFTER = { itemDates: ((out.itemDates && out.itemDates.updates) || []).map((u) => ({ id: s(u.id), last_transaction_date: u.last_transaction_date })) };
  const ENGINE = { operation_key: "GRC|" + jobId, movements: movements };

  const parts = { BATCH: BATCH, ENGINE: ENGINE, PO: PO, TO: TO, GR: GR, AFTER: AFTER };
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const CHUNK = 400000;
  const partRows = [];
  const manifestParts = {};
  for (const name of GR_PARTS) {
    const text = JSON.stringify(parts[name]);
    const names = [];
    for (let at = 0, n = 1; at < text.length || n === 1; at += CHUNK, n++) {
      const step = "P|" + nonce + "|" + name + "|" + String(n).padStart(3, "0");
      names.push(step);
      partRows.push({ job_id: jobId, organization_id: org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: text.slice(at, at + CHUNK) });
    }
    manifestParts[name] = names;
  }
  const countLines = (rs) => rs.reduce((n, r) => n + 1 + (Array.isArray(r.children) ? r.children.length : 0), 0);
  const manifest = {
    v: 1, job_id: jobId, gr_id: s(stored.id), gr_no: grNo, organization_id: org, plant_id: plant, nonce: nonce, po_ids: poIds, parts: manifestParts,
    counts: {
      lines: lines.length, batches: rows.filter((r) => r.insert).length, autoBatches: autoLines.length, movements: movements.length, poLines: poLines.length,
      onOrder: onOrder.length, toLines: countLines(toLines), inTransit: inTransit.length, items: Object.keys(itemById).length, waLines: waLines,
    },
  };
  return Object.assign(base, {
    route: "READY", code: "200", message: "Planned " + movements.length + " movements for " + lines.length + " lines",
    operationKey: ENGINE.operation_key, movements: o.withMovements === false ? [] : movements, payload: JSON.stringify(manifest), partRows: partRows,
    lineCount: lines.length, movementCount: movements.length, parts: o.debug ? parts : undefined,
  });
};
