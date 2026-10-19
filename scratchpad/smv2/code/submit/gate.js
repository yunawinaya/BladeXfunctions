// LOT_V2_SUBMIT - Gate: the eligibility the reads show (the stored side of COMPLETE / EDIT / CANCEL; serial items and costing
// records waiting for migration, every stock-moving action), lines added to an In Progress transfer (COMPLETE / EDIT), then
// SM_LOCATION_TRANSFER v82's gates up to its first write, lifted and run in-process with the request's real saveAs /
// pageStatus (Clone as Add, ids stripped; a Cancel runs over the STORED document, as get_node_czmdH3Jw): yPlLXIZW fill-back,
// kuH3MokM + CHECK_REQUIRED_FIELD v8, i8zWlzBw (not Draft / Cancel), LOTqtyComplete (DIRECT / STAGE); the WA-no-row STOP
// (DIRECT / STAGE, GLOBAL_INVENTORY_VALIDATION v11's text); the limits (COMPLETE / EDIT count the reconcile pairs with the
// lifted uht83Wzh). Same codes and texts as the classic's return nodes.
// V2.1: bundle trees are taken; a line the classic auto-allocates (code_node_LOTallocPrep's rule) is allocated by PREPARE, so
// the classic's post-allocation checks see it as picked (i8zWlzBw / LOTqtyComplete), its item is screened (serial, costing,
// WA), and it counts 1 row / 2 movements (PREPARE enforces the real cap).
const LOT_HDR_PROPS = ["issuing_operation_faci", "issue_date", "movement_type", "movement_type_id", "movement_reason", "issued_by", "reference_documents", "organization_id",
  "project_id", "is_production_order", "production_order_id", "remarks", "remark", "remark2", "remark3"];
const lotEntryKeys = function lotEntryKeys(flat, fn) {
  for (const l of flat) {
    for (const e of lotJsonList(l.temp_qty_data)) {
      if (!e || typeof e !== "object" || !(lotQ8(e.sm_quantity) > 0)) continue;
      const r = fn(l, e, s(e.material_id) || s(l.item_selection));
      if (r) return r;
    }
  }
  return "";
};
const lotItemReasons = function lotItemReasons(flat, byItem, cost) {
  return lotEntryKeys(flat, (l, e, m) => {
    const it = byItem[m];
    if (!it) return "";
    if (num(it.serial_number_management) === 1) return "it has serial-numbered items";
    if (it.stock_control === 0 || s(it.stock_control) === "0") return "";
    const b = lotIdStr(e.batch_id) || "0";
    const f = cost.F[m + "|" + b] || 0;
    const w = cost.W[m + "|" + b] || 0;
    const method = s(it.material_costing_method);
    return (f > 0 && w > 0) || (method === "First In First Out" && f === 0 && w > 0) || (method === "Weighted Average" && w === 0 && f > 0)
      ? "it has items whose costing records are waiting for migration" : "";
  });
};
const lotWaMissing = function lotWaMissing(flat, byItem, cost) {
  return lotEntryKeys(flat, (l, e, m) => {
    const it = byItem[m];
    if (!it || it.stock_control === 0 || s(it.stock_control) === "0" || s(it.material_costing_method) !== "Weighted Average") return "";
    const batch = s(e.batch_id);
    const n = batch ? cost.W[m + "|" + (lotIdStr(batch) || batch)] || 0 : cost.WA[m] || 0;
    return n === 0 ? "No Weighted Average costing record for item " + (s(it.material_code) || m) + " at this plant" + (batch ? " (batch " + batch + ")" : "")
      + ". The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock." : "";
  });
};
// the allocation lines' items: serial, and (no batch yet: only a non-batch item's key is known) costing records waiting for
// migration
const lotAllocReasons = function lotAllocReasons(allocRows, byItem, cost) {
  for (const l of allocRows) {
    const m = s(l.item_selection);
    const it = byItem[m];
    if (!it) continue;
    if (num(it.serial_number_management) === 1) return "it has serial-numbered items";
    if (it.stock_control === 0 || s(it.stock_control) === "0" || num(it.item_batch_management) === 1) continue;
    const f = cost.F[m + "|0"] || 0;
    const w = cost.W[m + "|0"] || 0;
    const method = s(it.material_costing_method);
    if ((f > 0 && w > 0) || (method === "First In First Out" && f === 0 && w > 0) || (method === "Weighted Average" && w === 0 && f > 0)) {
      return "it has items whose costing records are waiting for migration";
    }
  }
  return "";
};
// a WA item with no WA row at the plant at all fails GLOBAL_INVENTORY_VALIDATION whatever batch the allocation picks
const lotAllocWaMissing = function lotAllocWaMissing(allocRows, byItem, cost) {
  for (const l of allocRows) {
    const m = s(l.item_selection);
    const it = byItem[m];
    if (!it || it.stock_control === 0 || s(it.stock_control) === "0" || s(it.material_costing_method) !== "Weighted Average") continue;
    if (!(cost.WA[m] > 0)) {
      return "No Weighted Average costing record for item " + (s(it.material_code) || m) + " at this plant. The batch was most likely moved between plants without its "
        + "costing record; create it for this plant before issuing this stock.";
    }
  }
  return "";
};
const lotRowCount = (flat) => {
  let n = 0;
  lotEntryKeys(flat, () => {
    n++;
    return "";
  });
  return n;
};
const submitGate = function submitGate(guard, entry, keys, form, R) {
  const act = entry.action;
  const base = { reason: "", errorCode: "", allData: {}, lineCount: num(keys.lineCount), rowCount: 0, movementCount: 0, numberIssued: "NO", lineFingerprint: "",
    incomingFingerprint: "", edited: 0, partNames: [], partChunks: [] };
  const out = (route, code, message, errorCode, extra) => Object.assign(base, answer(route, code, message, Object.assign({ errorCode: errorCode || "" }, extra || {})));
  if (BUILT_ACTIONS.indexOf(act) < 0) return out("STOP", "400", "the gate does not take " + act, "LOT_INVALID_REQUEST");
  const byItem = {};
  for (const it of lotRows(R.items)) byItem[s(it.id)] = it;
  const cost = { W: {}, F: {}, WA: {} };
  for (const c of lotRows(R.cost)) {
    const k = s(c.m) + "|" + s(c.b);
    if (s(c.t) === "W") {
      cost.W[k] = (cost.W[k] || 0) + num(c.n);
      cost.WA[s(c.m)] = (cost.WA[s(c.m)] || 0) + num(c.n);
    } else cost.F[k] = (cost.F[k] || 0) + num(c.n);
  }
  const editing = act === "COMPLETE" || act === "EDIT";
  const storedRows = lotRows(R.stored);
  if (editing || act === "CANCEL") {
    base.lineFingerprint = lotLineFingerprint(storedRows);
    const why = num(entry.isProductionOrder) === 1 ? "it is linked to a production order" : lotLineReasons(storedRows) || lotItemReasons(storedRows, byItem, cost);
    if (why) return Object.assign(base, notEligible(why, base.lineCount, guard.saveAs));
  }
  const doc = act === "CANCEL" ? null : JSON.parse(JSON.stringify(form));
  if (doc) {
    if (guard.clone === "YES") {
      delete doc.id;
      const strip = (rows) => {
        for (const r of Array.isArray(rows) ? rows : []) {
          if (!r || typeof r !== "object") continue;
          delete r.id;
          strip(r.children);
        }
      };
      strip(doc.stock_movement);
    }
    for (const k of ["lot_v2_job_id", "lot_idem_key"]) delete doc[k];
    const docFlat = flatOf(doc.stock_movement);
    const why = lotItemReasons(docFlat, byItem, cost) || lotAllocReasons(docFlat.filter(lotNeedsAlloc), byItem, cost);
    if (why) return Object.assign(base, notEligible(why, base.lineCount, guard.saveAs));
  }
  if (editing) {
    // every row of the tree, bundle parents included, must be a stored row (an emptied pick is allowed: PREPARE allocates it)
    const ids = {};
    for (const r of storedRows) ids[lotIdStr(r.id)] = true;
    const added = lotTreeRows(doc.stock_movement).filter((l) => !lotIdStr(l.id) || !ids[lotIdStr(l.id)]);
    if (added.length) return out("STOP", "400", "Lines can't be added to an In Progress transfer.", "LOT_LINES_ADDED");
  }
  // the STORED document a Cancel runs over (get_node_czmdH3Jw's record): the header the read gave + the stored lines
  const storedDoc = act === "CANCEL" ? { id: guard.lotId, stock_movement_no: entry.lotNo, stock_movement_status: entry.storedStatus, movement_type: entry.movementType,
    issue_date: entry.issueDate, issuing_operation_faci: entry.plantId, organization_id: entry.organizationId, is_production_order: entry.isProductionOrder,
    stock_movement_no_type: entry.noType === "" ? null : Number(entry.noType), stock_movement: storedRows } : null;
  const ctx = { "workflowparams:allData": doc || { id: guard.lotId }, "workflowparams:saveAs": guard.saveAs, "workflowparams:pageStatus": guard.pageStatus,
    "system:tenantId": guard.tenantId, "node:get_node_czmdH3Jw": { data: { data: storedDoc } } };
  let stop = null;
  let fill = null;
  let recon = null;
  __withContext(ctx, () => {
    fill = __run("code_node_yPlLXIZW");
    const req = __run("code_node_kuH3MokM");
    const chk = __withContext({ "system:tenantId": guard.tenantId, "workflowparams:entry": req.data, "workflowparams:required_fields": req.required_fields },
      () => __run("code_node_AeSdXE85"));
    if (s(chk.status) === "Failed") return (stop = ["400", s(chk.message), "LOT_REQUIRED_FIELDS"]);
    if (act === "DRAFT" || act === "CANCEL") return null;
    // the classic allocates before these checks: an allocation line reaches them picked (its requested quantity)
    const picked = (Array.isArray(fill.flatLines) ? fill.flatLines : []).map((l) => (lotNeedsAlloc(l)
      ? Object.assign({}, l, { temp_qty_data: JSON.stringify([{ sm_quantity: lotQ8(l.requested_qty) }]) }) : l));
    __set("node:code_node_yPlLXIZW", { data: Object.assign({}, fill, { flatLines: picked }) });
    const v = __run("code_node_i8zWlzBw");
    if (num(v.locationFailed) === 1) return (stop = ["400", s(v.locationMessage), "LOT_LOCATION_REQUIRED"]);
    if (num(v.quantityFailed) === 1) return (stop = ["400", s(v.quantityMessage), "LOT_NO_QUANTITY"]);
    if (act === "DIRECT" || act === "STAGE") {
      const q = __run("code_node_LOTqtyComplete");
      if (num(q.isIncomplete) === 1) return (stop = ["400", s(q.incompleteMessage), "LOT_LINES_WITHOUT_STOCK"]);
    }
    __set("node:code_node_yPlLXIZW", { data: fill });
    if (editing) {
      // the reconcile pair count only (its ledger input does not change it): the stored lines as get_node_Ij7YbXCA gives them,
      // ids compared as text on both sides; allocation lines left out on both sides (counted 2 movements each below)
      const cur = JSON.parse(JSON.stringify(fill.allData || {}));
      const idText = (r) => {
        for (const k of ["id", "location_id", "quantity_uom"]) if (r[k] !== undefined && r[k] !== null) r[k] = lotIdStr(r[k]) || s(r[k]);
      };
      for (const l of lotTreeRows(cur.stock_movement)) idText(l);
      const allocIds = {};
      for (const l of lotTreeRows(cur.stock_movement)) if (lotNeedsAlloc(l) && s(l.id)) allocIds[s(l.id)] = true;
      cur.stock_movement = (Array.isArray(cur.stock_movement) ? cur.stock_movement : []).filter((r) => !(r && allocIds[s(r.id)])).map((r) => (r && Array.isArray(r.children)
        ? Object.assign({}, r, { children: r.children.filter((c) => !(c && allocIds[s(c.id)])) }) : r));
      const init = { id: guard.lotId, stock_movement_status: entry.storedStatus,
        stock_movement: storedRows.filter((r) => !allocIds[lotIdStr(r.id)]).map((r) => Object.assign({}, r)) };
      recon = __withContext(Object.assign({}, ctx, { "node:code_node_yPlLXIZW": { data: Object.assign({}, fill, { allData: cur }) }, "node:get_node_Ij7YbXCA": { data: { data: init } },
        "node:search_node_LOTitOpenRecon": { data: { data: [] } } }), () => __run("code_node_uht83Wzh"));
    }
    return null;
  });
  if (stop) return out("STOP", stop[0], stop[1], stop[2]);
  const allData = fill.allData || {};
  const flat = Array.isArray(fill.flatLines) ? fill.flatLines : [];
  // a Cancel counts the stored lines (stored bundle children carry no parent_fm_key: yPlLXIZW's flatLines would drop them)
  const allocCount = act === "CANCEL" ? 0 : flat.filter(lotNeedsAlloc).length;
  if (act === "DIRECT" || act === "STAGE") {
    const wa = lotWaMissing(flat, byItem, cost) || lotAllocWaMissing(flat.filter(lotNeedsAlloc), byItem, cost);
    if (wa) return out("STOP", "400", wa, "LOT_NO_WA_RECORD");
  }
  const picks = lotRowCount(act === "CANCEL" ? lotStoredFlat(storedRows) : flat);
  const rows = picks + allocCount;
  const reconPairs = recon ? num(recon.movementsLength) : 0;
  // DRAFT counts as the DIRECT it may become; an allocation line = 1 row, 2 movements (PREPARE enforces the real cap)
  const movements = 2 * (act === "EDIT" ? reconPairs + allocCount : rows + reconPairs);
  base.rowCount = rows;
  base.movementCount = movements;
  if (rows > MAX_ROWS || movements > MAX_MOVEMENTS) {
    // a Draft is never refused for its size: the classic Draft takes it
    if (act === "DRAFT") return Object.assign(base, notEligible("it has " + rows + " stock rows", base.lineCount, guard.saveAs));
    return out("STOP", "400", "This Location Transfer has " + rows + " stock rows (" + movements + " stock movements). At most 2,500 rows and 5,000 movements can be saved at once - please split the transfer.",
      "LOT_SPLIT_REQUIRED");
  }
  if (act === "DRAFT") return out("GO", "", "", "", { allData: allData, lineCount: flat.length });
  if (act === "CANCEL") return out("GO", "", "", "", { lineCount: base.lineCount });
  if (editing) {
    // every row L2 writes, bundle parents included (FP_LINES reads every stored row back)
    base.incomingFingerprint = lotLineFingerprint(lotTreeRows(allData.stock_movement));
    base.edited = base.incomingFingerprint !== base.lineFingerprint ? 1 : 0;
    const header = {};
    for (const k of LOT_HDR_PROPS) header[k] = allData[k] === undefined ? null : allData[k];
    const text = JSON.stringify({ v: 1, lotId: guard.lotId, header: header, stock_movement: allData.stock_movement || [], fingerprint: base.incomingFingerprint });
    const prefix = "S|" + guard.nonce + "|LINES|";
    for (let at = 0, n = 1; at < text.length || n === 1; at += LOT_CHUNK, n++) {
      base.partNames.push(prefix + String(n).padStart(3, "0"));
      base.partChunks.push(text.slice(at, at + LOT_CHUNK));
    }
    return out("GO", "", "", "", { lineCount: Math.max(base.lineCount, flat.length) });
  }
  base.numberIssued = s(allData.stock_movement_no) === "issued" ? "YES" : "NO";
  return out("GO", "", "", "", { allData: allData, lineCount: flat.length });
};
