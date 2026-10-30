// Reserved transfer requests (Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md): pure rules shared by
// IA_TRANSFER_REQUEST, LOT V2 SUBMIT / PREPARE / COMMIT, the IA save guard and the IA form. No platform calls.
// Quantities come in as text or numbers and go out as q8 text in the line's unit; ids are text. Reservation rows have RES-01's
// shape (scratchpad/iasc/res01/code/sql_hold.py STATE rows); rows written here carry job_line_key IATR|<lotId>|<k>.
const RR_EPS = 1e-8;
const rrS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const rrN = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? x : 0;
};
const rrQ8 = (v) => Number(rrN(v).toFixed(8));
const rrQT = (v) => String(rrQ8(v));
const rrBlank = (v) => rrS(v) === "";
const rrJ = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(rrS(v) || "[]");
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return [];
  }
};
const rrPicks = (l) => rrJ(l && l.temp_qty_data).filter((p) => p && typeof p === "object" && rrN(p.sm_quantity) > RR_EPS);
const rrHasHu = (l) => rrJ(l && l.temp_hu_data).length > 0 || rrPicks(l).some((p) => rrS(p.handling_unit_id) !== "" && rrS(p.handling_unit_id) !== "0");
const rrIsStock = (it) => !!it && Number(it.stock_control) !== 0;
const rrIsSerial = (it) => !!it && Number(it.serial_number_management) === 1;
const rrKey = (bin, batch) => rrS(bin) + "|" + rrS(batch);
const rrLabel = (bin, batch) => (rrS(batch) ? rrS(bin) + " / " + rrS(batch) : rrS(bin));
// the line's live holds; `awayFrom` (a bin) leaves out the holds already there: a request never moves the stock at its own staging bin
const rrOwnHolds = (holdRows, lineId, awayFrom) =>
  (Array.isArray(holdRows) ? holdRows : []).filter((h) => h && typeof h === "object" && rrS(h.status) === "Allocated" && rrS(h.doc_line_id) === rrS(lineId)
    && (rrBlank(awayFrom) || rrS(h.bin_location) !== rrS(awayFrom)));
const rrDates = (p) => ({ expired_date: (p && p.expired_date) || null, manufacturing_date: (p && p.manufacturing_date) || null });
const rrSum = (list, f) => rrQ8(list.reduce((t, x) => t + rrN(f(x)), 0));
// the IA's demand for a line: an explicit requirement (even 0) first, else the BOM reference (the request's own rule, IA-LT-07)
const rrDemandOf = (l) => (!rrBlank(l.required_qty) ? rrQ8(l.required_qty) : rrQ8(l.requested_qty));
const rrRowOf = (ctx, iaLineId, materialId, bin, batch, qty, uom, k) => ({ doc_type: "Item Assembly", status: "Processing", doc_id: rrS(ctx.iaId),
  doc_line_id: rrS(iaLineId), material_id: rrS(materialId), bin_location: rrS(bin), batch_id: rrS(batch), item_uom: rrS(uom), reserved_qty: rrQT(qty),
  open_qty: rrQT(qty), delivered_qty: "0", from_category: "Unrestricted", job_line_key: "IATR|" + rrS(ctx.lotId) + "|" + k });

// D12: the organisation's Item Assembly Setup row (its first one: every plant row carries the same values); no row = off
const rrSetupOn = function rrSetupOn(setupRows, orgId) {
  const row = (Array.isArray(setupRows) ? setupRows : []).find((r) => r && rrS(r.organization_id) === rrS(orgId) && Number(r.is_deleted || 0) === 0);
  return !!row && Number(row.transfer_request_enabled) === 1;
};

// a Created IA's request lines: one per stock line with reserved quantity, its picks = the reservation (D1: partial allowed); serial,
// handling-unit and non-stock lines are never requested; a line with nothing reserved waits for a replacement; the holds already at
// the staging bin (an earlier request's) stay out
const rrLinesFromHolds = function rrLinesFromHolds(iaLines, holdRows, items, stagingBin) {
  const lines = [];
  const skipped = [];
  for (const l of Array.isArray(iaLines) ? iaLines : []) {
    if (!l || typeof l !== "object") continue;
    const id = rrS(l.id);
    const it = items && items[rrS(l.item_selection)];
    if (!rrIsStock(it)) {
      skipped.push({ line: id, reason: "not stock-controlled" });
      continue;
    }
    if (rrIsSerial(it)) {
      skipped.push({ line: id, reason: "serial-numbered: picked from the warehouse as today" });
      continue;
    }
    if (rrHasHu(l)) {
      skipped.push({ line: id, reason: "stock in a handling unit: picked from the warehouse as today" });
      continue;
    }
    const own = rrOwnHolds(holdRows, id, stagingBin).filter((h) => (rrS(h.from_category) || "Unrestricted") === "Unrestricted" && rrS(h.item_uom) === rrS(l.quantity_uom)
      && rrN(h.open_qty) > RR_EPS);
    const held = rrSum(own, (h) => h.open_qty);
    if (!(held > RR_EPS)) {
      skipped.push({ line: id, reason: "nothing reserved: replaced later" });
      continue;
    }
    lines.push({ source_ia_line_id: id, item_selection: rrS(l.item_selection), quantity_uom: rrS(l.quantity_uom), requested_qty: rrQT(held),
      picks: own.map((h) => ({ location_id: rrS(h.bin_location), batch_id: rrS(h.batch_id), sm_quantity: rrQT(h.open_qty), hold_row_id: rrS(h.id) })) });
  }
  return { lines: lines, skipped: skipped };
};

// dispatch: release the IA's reservation for each line and stage the warehouse's picks, in one operation; the released rows are
// cancelled under the operation's marker; a pick away from the reservation names the bins to count
const rrSwapPlan = function rrSwapPlan(lotLines, holdRows, opKey) {
  const marker = "IATR|" + rrS(opKey);
  const fail = (code, message) => ({ ok: false, code: code, message: message, release: [], stage: [], cancelRows: [], countBins: [], marker: marker });
  const out = { ok: true, code: "", message: "", release: [], stage: [], cancelRows: [], countBins: [], marker: marker };
  const list = Array.isArray(lotLines) ? lotLines : [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i] || {};
    const n = i + 1;
    const want = rrQ8(l.requested_qty);
    const picks = rrPicks(l);
    const picked = rrSum(picks, (p) => p.sm_quantity);
    if (Math.abs(picked - want) > RR_EPS) return fail("IATR_PICKS_SHORT", "Line " + n + ": " + picked + " picked for " + want + " requested.");
    const own = rrOwnHolds(holdRows, l.source_ia_line_id, l.location_id);
    const held = rrSum(own, (h) => h.open_qty);
    if (Math.abs(held - want) > RR_EPS || own.some((h) => (rrS(h.from_category) || "Unrestricted") !== "Unrestricted")) {
      return fail("IATR_HOLD_STALE", "Line " + n + ": the Item Assembly's reservation changed (" + held + " reserved for " + want
        + " requested): refresh the request from the Item Assembly.");
    }
    const heldAt = {};
    const labelOf = {};
    for (const h of own) {
      out.release.push({ kind: "RELEASE", line_id: rrS(l.id), ia_line_id: rrS(l.source_ia_line_id), material_id: rrS(h.material_id || l.item_selection),
        location_id: rrS(h.bin_location), batch_id: rrS(h.batch_id), quantity: rrQT(h.open_qty), uom: rrS(h.item_uom || l.quantity_uom),
        from_category: "Reserved", to_category: "Unrestricted", hold_row_id: rrS(h.id) });
      out.cancelRows.push(rrS(h.id));
      const k = rrKey(h.bin_location, h.batch_id);
      heldAt[k] = rrQ8((heldAt[k] || 0) + rrN(h.open_qty));
      labelOf[k] = rrLabel(h.bin_location, h.batch_id);
    }
    const pickedAt = {};
    for (const p of picks) {
      out.stage.push({ kind: "STAGE", line_id: rrS(l.id), ia_line_id: rrS(l.source_ia_line_id), material_id: rrS(p.material_id || l.item_selection),
        location_id: rrS(p.location_id), batch_id: rrS(p.batch_id), to_location_id: rrS(l.location_id), quantity: rrQT(p.sm_quantity), uom: rrS(l.quantity_uom),
        from_category: "Unrestricted", to_category: "In Transit" });
      const k = rrKey(p.location_id, p.batch_id);
      pickedAt[k] = rrQ8((pickedAt[k] || 0) + rrN(p.sm_quantity));
      labelOf[k] = labelOf[k] || rrLabel(p.location_id, p.batch_id);
    }
    const reservedAt = Object.keys(heldAt).filter((k) => heldAt[k] - (pickedAt[k] || 0) > RR_EPS).map((k) => labelOf[k]);
    for (const k of Object.keys(pickedAt)) {
      if (pickedAt[k] - (heldAt[k] || 0) > RR_EPS) out.countBins.push({ line: n, item: rrS(l.item_selection), pickedFrom: labelOf[k], reservedAt: reservedAt });
    }
  }
  return out;
};

// Receive (D5, D7, D10): good + defect = what was dispatched, per batch for a line that came in several batches; good lands Reserved
// for the IA at the staging bin (new rows, the IA's picks there), defect lands Blocked with its reason
const rrReceivePlan = function rrReceivePlan(lotLines, receipts, dest) {
  const ctx = dest || {};
  const fail = (code, message) => ({ ok: false, code: code, message: message, toReserved: [], toBlocked: [], newHoldRows: [], iaPicks: {}, lineDefects: [] });
  const out = { ok: true, code: "", message: "", toReserved: [], toBlocked: [], newHoldRows: [], iaPicks: {}, lineDefects: [] };
  const list = Array.isArray(lotLines) ? lotLines : [];
  let k = 0;
  for (let i = 0; i < list.length; i++) {
    const l = list[i] || {};
    const n = i + 1;
    const ia = rrS(l.source_ia_line_id);
    const byBatch = {};
    const datesOf = {};
    for (const p of rrPicks(l)) {
      byBatch[rrS(p.batch_id)] = rrQ8((byBatch[rrS(p.batch_id)] || 0) + rrN(p.sm_quantity));
      if (!datesOf[rrS(p.batch_id)] || (!datesOf[rrS(p.batch_id)].expired_date && !datesOf[rrS(p.batch_id)].manufacturing_date)) datesOf[rrS(p.batch_id)] = rrDates(p);
    }
    const batches = Object.keys(byBatch);
    const rc = receipts && receipts[rrS(l.id)];
    if (!rc || typeof rc !== "object") return fail("IATR_RECEIPT_INVALID", "Line " + n + ": enter the good and defect quantities.");
    let entries;
    if (rc.batches && typeof rc.batches === "object") {
      if (Object.keys(rc.batches).some((b) => byBatch[b] === undefined)) return fail("IATR_RECEIPT_INVALID", "Line " + n + ": a batch that wasn't dispatched.");
      entries = batches.map((b) => ({ batch: b, good: rrQ8((rc.batches[b] || {}).good), defect: rrQ8((rc.batches[b] || {}).defect) }));
    } else {
      if (batches.length > 1) return fail("IATR_RECEIPT_INVALID", "Line " + n + ": enter the good and defect quantities per batch.");
      entries = [{ batch: batches[0] || "", good: rrQ8(rc.good), defect: rrQ8(rc.defect) }];
    }
    for (const e of entries) {
      if (e.good < -RR_EPS || e.defect < -RR_EPS || Math.abs(e.good + e.defect - (byBatch[e.batch] || 0)) > RR_EPS) {
        return fail("IATR_RECEIPT_INVALID", "Line " + n + ": good + defect must equal the " + (byBatch[e.batch] || 0) + " dispatched"
          + (e.batch ? " in batch " + e.batch : "") + ".");
      }
    }
    const defectTotal = rrSum(entries, (e) => e.defect);
    if (defectTotal > RR_EPS && !rrS(rc.reason)) return fail("IATR_DEFECT_REASON", "Line " + n + ": choose the reason for the defect.");
    out.iaPicks[ia] = out.iaPicks[ia] || [];
    const detail = {};
    for (const e of entries) {
      const move = { line_id: rrS(l.id), ia_line_id: ia, material_id: rrS(l.item_selection), location_id: rrS(ctx.location_id), batch_id: e.batch,
        uom: rrS(l.quantity_uom), from_category: "In Transit" };
      if (e.good > RR_EPS) {
        k++;
        out.toReserved.push(Object.assign({ kind: "TO_RESERVED", quantity: rrQT(e.good), to_category: "Reserved" }, move));
        out.newHoldRows.push(rrRowOf(ctx, ia, l.item_selection, ctx.location_id, e.batch, e.good, l.quantity_uom, k));
        out.iaPicks[ia].push(Object.assign({ material_id: rrS(l.item_selection), location_id: rrS(ctx.location_id), batch_id: e.batch, sm_quantity: rrQT(e.good),
          category: "Unrestricted" }, datesOf[e.batch] || rrDates(null)));
      }
      if (e.defect > RR_EPS) {
        out.toBlocked.push(Object.assign({ kind: "TO_BLOCKED", quantity: rrQT(e.defect), to_category: "Blocked" }, move));
        if (e.batch) detail[e.batch] = rrQT(e.defect);
      }
    }
    out.lineDefects.push({ id: rrS(l.id), defect_qty: rrQT(defectTotal), defect_reason: defectTotal > RR_EPS ? rrS(rc.reason) : "",
      defect_detail: Object.keys(detail).length ? JSON.stringify(detail) : "" });
  }
  return out;
};

// cancel after dispatch (D3): back to the bins and batches it was picked from, reserved for the IA again
const rrCancelBackPlan = function rrCancelBackPlan(lotLines, ctx) {
  const c = ctx || {};
  const out = { ok: true, code: "", message: "", toReserved: [], newHoldRows: [], iaPicks: {} };
  let k = 0;
  for (const l of Array.isArray(lotLines) ? lotLines : []) {
    if (!l || typeof l !== "object") continue;
    const ia = rrS(l.source_ia_line_id);
    out.iaPicks[ia] = out.iaPicks[ia] || [];
    for (const p of rrPicks(l)) {
      k++;
      const material = rrS(p.material_id || l.item_selection);
      out.toReserved.push({ kind: "TO_RESERVED", line_id: rrS(l.id), ia_line_id: ia, material_id: material, from_location_id: rrS(l.location_id),
        location_id: rrS(p.location_id), batch_id: rrS(p.batch_id), quantity: rrQT(p.sm_quantity), uom: rrS(l.quantity_uom), from_category: "In Transit",
        to_category: "Reserved" });
      out.newHoldRows.push(rrRowOf(c, ia, material, p.location_id, p.batch_id, p.sm_quantity, l.quantity_uom, k));
      out.iaPicks[ia].push(Object.assign({ material_id: material, location_id: rrS(p.location_id), batch_id: rrS(p.batch_id), sm_quantity: rrQT(p.sm_quantity),
        category: "Unrestricted" }, rrDates(p)));
    }
  }
  return out;
};

// Report defect (D2): reserved stock at the staging bin -> Blocked (IA-D); the reservation and the IA's picks drop by it
const rrDefectPlan = function rrDefectPlan(iaLines, holdRows, stagingBin, defects) {
  const fail = (code, message) => ({ ok: false, code: code, message: message, moves: [], holdChanges: [], iaPicks: {} });
  const out = { ok: true, code: "", message: "", moves: [], holdChanges: [], iaPicks: {} };
  const list = Array.isArray(iaLines) ? iaLines : [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i] || {};
    const id = rrS(l.id);
    const df = defects && defects[id];
    if (!df || typeof df !== "object") continue;
    const n = i + 1;
    const entries = df.batches && typeof df.batches === "object" ? Object.keys(df.batches).map((b) => ({ batch: b, qty: rrQ8(df.batches[b]) }))
      : [{ batch: rrS(df.batch_id), qty: rrQ8(df.qty) }];
    const total = rrSum(entries, (e) => e.qty);
    if (!(total > RR_EPS)) continue;
    if (!rrS(df.reason)) return fail("IATR_DEFECT_REASON", "Line " + n + ": choose the reason for the defect.");
    const atBin = rrOwnHolds(holdRows, id).filter((h) => rrS(h.bin_location) === rrS(stagingBin));
    let picks = rrPicks(l).map((p) => Object.assign({}, p));
    for (const e of entries) {
      if (e.qty < -RR_EPS) return fail("IATR_DEFECT_TOO_MUCH", "Line " + n + ": a defect can't be negative.");
      const rows = atBin.filter((h) => rrS(h.batch_id) === e.batch);
      const avail = rrSum(rows, (h) => h.open_qty);
      if (e.qty - avail > RR_EPS) return fail("IATR_DEFECT_TOO_MUCH", "Line " + n + ": only " + avail + " reserved at the staging bin" + (e.batch ? " in batch " + e.batch : "") + ".");
      let left = e.qty;
      for (const h of rows) {
        if (!(left > RR_EPS)) break;
        const take = Math.min(rrN(h.open_qty), left);
        const open = rrQ8(rrN(h.open_qty) - take);
        out.holdChanges.push({ id: rrS(h.id), open_qty: rrQT(open), reserved_qty: rrQT(rrN(h.reserved_qty) - take), status: open > RR_EPS ? "Allocated" : "Cancelled" });
        left = rrQ8(left - take);
      }
      out.moves.push({ kind: "DEFECT", line_id: id, material_id: rrS(l.item_selection), location_id: rrS(stagingBin), batch_id: e.batch, quantity: rrQT(e.qty),
        uom: rrS(l.quantity_uom), from_category: "Reserved", to_category: "Blocked", transaction_type: "IA-D" });
      let cut = e.qty;
      picks = picks.map((p) => {
        if (!(cut > RR_EPS) || rrS(p.location_id) !== rrS(stagingBin) || rrS(p.batch_id) !== e.batch) return p;
        const take = Math.min(rrN(p.sm_quantity), cut);
        cut = rrQ8(cut - take);
        return Object.assign({}, p, { sm_quantity: rrQT(rrN(p.sm_quantity) - take) });
      }).filter((p) => rrN(p.sm_quantity) > RR_EPS);
    }
    out.iaPicks[id] = picks;
  }
  return out;
};

// the replacement (D1, D6, D11): per line a request can carry, the demand not yet reserved and not in transit
const rrGap = function rrGap(iaLines, holdRows, requests, items) {
  const transit = {};
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || (rrS(r.status) !== "In Progress" && rrS(r.status) !== "Processing")) continue;
    for (const rl of Array.isArray(r.lines) ? r.lines : []) transit[rrS(rl.source_ia_line_id)] = rrQ8((transit[rrS(rl.source_ia_line_id)] || 0) + rrN(rl.requested_qty));
  }
  const out = [];
  for (const l of Array.isArray(iaLines) ? iaLines : []) {
    if (!l || typeof l !== "object") continue;
    const it = items && items[rrS(l.item_selection)];
    if (!rrIsStock(it) || rrIsSerial(it) || rrHasHu(l)) continue;
    const missing = rrQ8(rrDemandOf(l) - rrSum(rrOwnHolds(holdRows, l.id), (h) => h.open_qty) - (transit[rrS(l.id)] || 0));
    if (missing > RR_EPS) out.push({ iaLineId: rrS(l.id), missing: rrQT(missing) });
  }
  return out;
};

// D11: once the IA has used a request (any not cancelled), every line a request can carry is taken from the staging bin; serial and
// handling-unit lines are picked from the warehouse as today
const rrStagingCheck = function rrStagingCheck(iaLines, requests, items, stagingBin) {
  const used = (Array.isArray(requests) ? requests : []).some((r) => r && rrS(r.status) !== "" && rrS(r.status) !== "Cancelled");
  if (!used) return { ok: true, line: 0, message: "" };
  const list = Array.isArray(iaLines) ? iaLines : [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l || typeof l !== "object") continue;
    const it = items && items[rrS(l.item_selection)];
    if (!rrIsStock(it) || rrIsSerial(it) || rrHasHu(l)) continue;
    if (rrPicks(l).some((p) => rrS(p.location_id) !== rrS(stagingBin))) {
      return { ok: false, line: i + 1, message: "Line " + (i + 1) + " (" + (rrS(l.item_name) || rrS(l.item_selection)) + ") must be taken from the staging bin: "
        + "request a replacement for it." };
    }
  }
  return { ok: true, line: 0, message: "" };
};

// a Created IA's request at dispatch, before the job (SUBMIT): its requested lines as stored; every pick loose Unrestricted stock of
// the line's item, in its unit, away from the staging bin; the picks and the IA's reservation (away from the staging bin) each equal
// to what is requested (rrSwapPlan, which PREPARE runs again on the stored lines under the job)
const rrDispatchCheck = function rrDispatchCheck(stored, incoming, holdRows) {
  const stop = (code, message) => ({ ok: false, code: code, message: message });
  const st = (Array.isArray(stored) ? stored : []).filter((l) => l && typeof l === "object");
  const inc = (Array.isArray(incoming) ? incoming : []).filter((l) => l && typeof l === "object");
  const changed = stop("IATR_DEMAND_CHANGED", "The requested lines of this transfer were changed. Only the picks can be edited: reopen the transfer and pick again.");
  if (!st.length || st.length !== inc.length) return changed;
  const byId = {};
  for (const l of st) byId[rrS(l.id)] = l;
  for (const l of inc) {
    const was = byId[rrS(l.id)];
    if (!was) return changed;
    if (["item_selection", "quantity_uom", "source_ia_line_id", "storage_location_id", "location_id"].some((k) => rrS(l[k]) !== rrS(was[k]))
      || rrQ8(l.requested_qty) !== rrQ8(was.requested_qty)) return changed;
  }
  for (const l of inc) {
    const label = "Line " + (rrS(l.line_index) || rrS(l.id)) + (rrS(l.item_name) ? " (" + rrS(l.item_name) + ")" : "");
    for (const p of rrPicks(l)) {
      if (rrS(p.material_id || l.item_selection) !== rrS(l.item_selection)) return stop("IATR_PICK_ITEM", label + ": a pick is of another item.");
      if (!rrBlank(p.material_uom) && rrS(p.material_uom) !== rrS(l.quantity_uom)) {
        return stop("IATR_PICK_UOM", label + ": pick it in the line's unit; a pick in another unit can't be dispatched.");
      }
      if (rrS(p.handling_unit_id) && rrS(p.handling_unit_id) !== "0") return stop("IATR_PICK_HU", label + ": a pick from a handling unit can't be dispatched; pick loose stock.");
      if ((rrS(p.category) || "Unrestricted") !== "Unrestricted") {
        return stop("IATR_PICK_CATEGORY", label + ": pick Unrestricted stock; " + rrS(p.category) + " stock can't supply production.");
      }
      if (rrS(p.location_id) === rrS(l.location_id)) return stop("IATR_PICK_AT_DESTINATION", label + ": a pick is from the destination bin itself.");
    }
  }
  const sw = rrSwapPlan(inc, holdRows, "");
  return sw.ok ? { ok: true, code: "", message: "" } : stop(sw.code, sw.message);
};

// the Receive's receipts as SUBMIT stores them for PREPARE (part RECEIPTS): one per stored line, the quantities as q8 text, the
// reason as text, per batch when the form sent batches; nothing else of the payload
const rrReceiptsOf = function rrReceiptsOf(lotLines, receipts) {
  const out = {};
  const rec = receipts && typeof receipts === "object" && !Array.isArray(receipts) ? receipts : {};
  for (const l of Array.isArray(lotLines) ? lotLines : []) {
    if (!l || typeof l !== "object") continue;
    const rc = rec[rrS(l.id)];
    if (!rc || typeof rc !== "object" || Array.isArray(rc)) continue;
    const o = { good: rrQT(rc.good), defect: rrQT(rc.defect), reason: rrS(rc.reason) };
    if (rc.batches && typeof rc.batches === "object" && !Array.isArray(rc.batches)) {
      o.batches = {};
      for (const b of Object.keys(rc.batches)) o.batches[rrS(b)] = { good: rrQT((rc.batches[b] || {}).good), defect: rrQT((rc.batches[b] || {}).defect) };
    }
    out[rrS(l.id)] = o;
  }
  return out;
};

if (typeof module !== "undefined") module.exports = { RR_EPS, rrS, rrQ8, rrQT, rrSetupOn, rrLinesFromHolds, rrSwapPlan, rrReceivePlan, rrCancelBackPlan, rrDefectPlan, rrGap, rrStagingCheck, rrDispatchCheck, rrReceiptsOf };
