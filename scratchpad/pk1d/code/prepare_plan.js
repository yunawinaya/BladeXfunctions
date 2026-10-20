// PICKING_BULK_PREPARE - Plan: the confirmation recomputed from the stored Picking (code_node_oHIIKfiw records,
// code_node_Z5JH4g2u line status, code_node_iES7iMKA GD line status + the bundle rule) -> the prepared payload
// (READY_TO_COMMIT) or the reason it cannot run (FAILED; the Picking lock is released). Full Picking (stage 1b): any
// pick closes the line, and a GD line is counted over the records of every Picking (an over-pick is refused). Stage 1c: a
// pick that moves stock (Loading Bay, or a swap) answers MOVE; the move block re-plans its GDs before anything is written.
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// finished_at = the run's real end: the DB clock read at entry + the seconds since (jsAt = the entry's Date.now())
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const planConfirm = function planConfirm(entry, hdrRows, lineRows, gdRows, uomRows, pickedRows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const num = (v) => parseFloat(v) || 0;
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
  const parseJson = (v, dflt) => {
    if (v === null || v === undefined || v === "") return dflt;
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch (e) { return dflt; }
  };
  const HEADER_FIELDS = ["ref_doc", "remarks", "remarks_2", "remarks_3", "delivery_method", "delivery_method_text", "area_id",
    "driver_name", "ic_no", "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection", "courier_company",
    "shipping_date", "tracking_number", "est_arrival_date", "freight_charges", "ct_driver_name", "ct_driver_contact_no", "ct_ic_no",
    "vehicle_no", "est_delivery_date", "delivery_cost", "shipping_company", "ss_shipping_date", "ss_freight_charges",
    "shipping_method", "ss_est_arrival_date", "ss_tracking_number", "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no",
    "tpt_driver_contact_no", "tpt_driver_name", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no",
    "di_shipping_company", "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date",
    "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges", "project_id"];

  const jobId = s(entry.jobId);
  const pickingId = s(entry.pickingId);
  const req = entry.request || {};
  const op = s(req.operation).toUpperCase();
  const base = { route: "FAIL", jobRows: [], needJobUpd: "NO", readyRows: [], needReady: "NO", unlockRows: [], needUnlock: "NO", result_code: "", result_message: "", job_status: "", recordCount: 0, touchedRows: 0, gdLineCount: 0,
    prepared: null, moveRecords: [], moveGdLineIdsSql: "0", moveBinIdsSql: "0", moveBatchIdsSql: "0", moveHuIdsSql: "0", isLoadingBay: 0, gdLineStatus: {}, plantId: "" };
  const failRow = (code, message, details) => ({
    id: jobId, job_status: "FAILED", progress_percent: 0, progress_message: ("Not confirmed: " + message).slice(0, 250),
    row_version: (Number(entry.rowVersion) || 0) + 1, error_code: code, error_message: message,
    error_details: JSON.stringify(Object.assign({ step: "PICKING_BULK_PREPARE" }, details || {})),
    lease_owner: null, lease_expires_at: null, finished_at: s(endNow(entry)) || null,
  });
  const fail = (code, message, details) => Object.assign({}, base, {
    jobRows: [failRow(code, message, details)], needJobUpd: "YES",
    unlockRows: /^[0-9]{1,20}$/.test(pickingId) ? [{ id: pickingId, is_processing: 0 }] : [], needUnlock: /^[0-9]{1,20}$/.test(pickingId) ? "YES" : "NO",
    result_code: code, result_message: message, job_status: "FAILED",
  });

  if (s(entry.route) === "FAIL") return fail(s(entry.result_code) || "PK_INVALID_REQUEST", s(entry.result_message) || "the request is not valid");
  // Picking 1d: a FORCE_COMPLETE job is planned by its own block (code_node_PPfc): nothing to write here
  if (op === "FORCE_COMPLETE") return Object.assign({}, base, { route: "FC", result_message: "force complete: planned by its own block" });

  const hdr = list(hdrRows).filter((r) => s(r.id))[0] || null;
  if (!hdr || String(hdr.is_deleted) === "1") return fail("PK_NOT_FOUND", "Picking " + pickingId + " was not found");
  const toStatus = s(hdr.to_status);
  if (toStatus === "Completed" || toStatus === "Cancelled" || toStatus === "Draft") return fail("PK_STATUS", "Picking " + s(hdr.to_id) + " is " + toStatus);
  if (s(hdr.picking_after) === "Sales Order") return fail("PK_NOT_SUPPORTED", "Picking Setup picks after Sales Order (Picking Plan): not handled by the background save yet");
  // SUBMIT's stage switches stamp request.moves; a job they did not clear keeps 1b's refusals
  const movesOn = num(req.moves) === 1;
  if (!movesOn && (num(hdr.setup_loading_bay) === 1 || num(hdr.is_loading_bay) === 1)) return fail("PK_NOT_SUPPORTED", "Loading Bay is on: not handled by the background save yet");
  const fullPicking = num(hdr.allow_full_picking) === 1;
  // Loading Bay is the setup's flag, as classic PICKING passes it to GOODS_DELIVERY (its auto-complete clash: classic's text)
  const bay = num(hdr.setup_loading_bay) === 1;
  if (bay && num(hdr.auto_completed_gd) === 1) return fail("PK_BAY_AUTO_COMPLETE", "Picking Setup has both Loading Bay and Auto Complete GD enabled. Auto Complete GD skips the Created state that the loading bay move depends on, which would strand the reserved stock at the source bin. Please turn off Auto Complete GD.");
  if (num(hdr.auto_completed_gd) === 1) return fail("PK_NOT_SUPPORTED", "Auto Complete GD is on: not handled by the background save yet");

  const rows = list(lineRows).filter((r) => s(r.id));
  const byId = {};
  for (const r of rows) byId[s(r.id)] = r;
  const isBundleParent = (r) => !!s(r.item_bundle_id) && !s(r.item_code);

  // the request lines: CONFIRM = what the picker entered; PICK_ALL_REMAINING = every open line in full (list action)
  let reqLines = [];
  if (op === "PICK_ALL_REMAINING") {
    for (const r of rows) {
      if (s(r.row_type) === "header" || s(r.line_status) === "Cancelled" || isBundleParent(r)) continue;
      if (num(r.pending_process_qty) > 0) reqLines.push({ row_id: s(r.id), qty: num(r.pending_process_qty) });
    }
  } else if (op === "CONFIRM") {
    reqLines = list(req.lines);
  } else {
    return fail("PK_INVALID_REQUEST", "operation " + op + " is not supported");
  }

  // Item master UOM factors, as the form's Pick UOM handler computes them (getBaseQtyForUom)
  const uomByItem = {};
  for (const u of list(uomRows)) {
    const it = s(u.item_id);
    if (!uomByItem[it]) uomByItem[it] = { based: s(u.based_uom), conv: {} };
    if (s(u.alt_uom_id) && num(u.base_qty) > 0 && !has(uomByItem[it].conv, s(u.alt_uom_id))) uomByItem[it].conv[s(u.alt_uom_id)] = num(u.base_qty);
  }
  const factorOf = (itemId, uom) => {
    const m = uomByItem[s(itemId)];
    if (!uom || !m) return 1;
    if (s(uom) === m.based) return 1;
    return m.conv[s(uom)] || 1;
  };

  const gdLines = list(gdRows).filter((r) => s(r.id));
  const gdStatusById = {};
  const gdLineById = {};
  for (const l of gdLines) {
    gdLineById[s(l.id)] = l;
    gdStatusById[s(l.goods_delivery_id)] = s(l.gd_status);
  }
  const hdrGdIds = parseJson(hdr.gd_no_json, []);
  const firstGdId = Array.isArray(hdrGdIds) && hdrGdIds.length ? s(hdrGdIds[0]) : "";

  const freshPending = {};
  for (const r of rows) {
    if (s(r.line_status) === "Cancelled") continue;
    freshPending[s(r.id)] = num(r.pending_process_qty);
  }

  const records = [];
  const clampedLines = [];
  const pickedByRow = {};
  const touched = {};
  const lineRemarks = {};
  const movedRow = {};
  const seen = {};
  for (const ln of reqLines) {
    const rowId = s(ln.row_id);
    const qty = num(ln.qty);
    if (!(qty > 0)) continue;
    if (seen[rowId]) return fail("PK_INVALID_REQUEST", "line " + rowId + " is sent twice");
    seen[rowId] = true;
    const row = byId[rowId];
    if (!row) return fail("PK_LINE_NOT_FOUND", "a picked line is no longer on Picking " + s(hdr.to_id) + " (row " + rowId + "); reopen the Picking and pick again");
    if (s(row.row_type) === "header" || s(row.line_status) === "Cancelled" || isBundleParent(row)) continue;
    const gdStatus = gdStatusById[s(row.gd_id)] || "";
    if (gdStatus === "Cancelled" || gdStatus === "Completed") return fail("PK_GD_CLOSED", "Goods Delivery " + s(row.gd_no) + " is " + gdStatus + ": its lines cannot be picked");
    const sourceBin = s(row.source_bin);
    const batchNo = s(row.batch_no);
    // the form sends the line's target bin / batch; the list action has only the stored line
    const target = (has(ln, "target_location_id") ? s(ln.target_location_id) : s(row.target_location)) || sourceBin;
    const targetBatch = (has(ln, "target_batch_id") ? s(ln.target_batch_id) : s(row.target_batch)) || batchNo;
    // classic's move test (code_node_iES7iMKA): both sides set and different
    if ((sourceBin && target && target !== sourceBin) || (batchNo && targetBatch && targetBatch !== batchNo)) movedRow[rowId] = true;

    const pickUom = s(ln.pick_uom) || s(row.item_uom);
    const orderBase = factorOf(row.item_code, s(row.item_uom));
    const pickBase = factorOf(row.item_code, pickUom);
    const uomScale = (pickBase || orderBase || 1) / (orderBase || 1);
    let storeOutQty = q8(qty * uomScale);
    let pickedQtyAlt = qty;
    touched[rowId] = true;
    // the line keeps the remark the picker sent, not only its record
    lineRemarks[rowId] = {};
    for (const k of ["remark", "remark_2", "remark_3"]) if (has(ln, k)) lineRemarks[rowId][k] = s(ln[k]);
    if (has(freshPending, rowId)) {
      const allowed = freshPending[rowId];
      // a stored pending's float residue (32.94999999 for 32.95) is not a clamp (BUG-20261016-023)
      if (storeOutQty - allowed > 0.0005) {
        clampedLines.push({ picking_item_id: rowId, item_name: s(row.item_name) || s(row.item_code) || rowId, requested: storeOutQty, allowed: allowed });
        storeOutQty = allowed;
        pickedQtyAlt = uomScale ? q8(allowed / uomScale) : allowed;
      } else if (storeOutQty > allowed) storeOutQty = allowed;
      freshPending[rowId] = Math.max(0, q8(allowed - storeOutQty));
      if (storeOutQty <= 0) continue;
    }
    pickedByRow[rowId] = (pickedByRow[rowId] || 0) + storeOutQty;
    records.push({
      job_line_key: jobId + "|" + rowId + "|0",
      item_code: s(row.item_code),
      item_name: s(row.item_name),
      item_desc: s(row.item_desc),
      more_desc: s(row.more_desc),
      store_out_qty: storeOutQty,
      item_uom: s(row.item_uom),
      picked_uom: pickUom,
      picked_qty_alt: pickedQtyAlt,
      source_bin: sourceBin,
      target_location: target,
      batch_no: batchNo,
      target_batch: targetBatch,
      so_id: s(row.so_id),
      so_no: s(row.so_no) || s(hdr.so_no),
      so_line_id: s(row.so_line_id),
      gd_id: s(row.gd_id) || firstGdId,
      gd_no: s(row.gd_no) || s(hdr.delivery_no),
      gd_line_id: s(row.gd_line_id),
      handling_unit_id: s(row.handling_unit_id) || null,
      remark: has(ln, "remark") ? s(ln.remark) : s(row.remark),
      remark_2: has(ln, "remark_2") ? s(ln.remark_2) : s(row.remark_2),
      remark_3: has(ln, "remark_3") ? s(ln.remark_3) : s(row.remark_3),
      line_status: "Confirmed",
      confirmed_by: s(req.confirmed_by),
      confirmed_at: s(entry.confirmedAt),
      attachment: Array.isArray(ln.attachment) ? ln.attachment : parseJson(row.attachment, []) || [],
    });
  }
  if (!records.length) {
    return fail(clampedLines.length ? "PK_NOTHING_LEFT" : "PK_NOTHING_PICKED", clampedLines.length
      ? "nothing was confirmed: the stock on these lines had already been picked (" + clampedLines.map((c) => c.item_name).join(", ") + ")"
      : "enter a picked quantity on at least one line");
  }
  // Loading Bay: every picked line goes to a bay bin (classic code_node_iES7iMKA's check, on every bay confirmation)
  if (bay) {
    const missing = [];
    for (const rec of records) {
      if (!(rec.store_out_qty > 0)) continue;
      if (rec.target_location && rec.target_location !== rec.source_bin) continue;
      const label = rec.item_name || rec.item_code || rec.gd_line_id;
      if (label && missing.indexOf(label) === -1) missing.push(label);
    }
    if (missing.length) return fail("PK_BAY_TARGET", "Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked items: " + missing.join(", ") + ". Set a loading bay bin on every picked line before completing.");
  }
  const moveRecords = records.filter((r) => movedRow[r.job_line_key.split("|")[1]]);
  if (moveRecords.length) {
    const firstRow = moveRecords[0].job_line_key.split("|")[1];
    if (!movesOn) return fail("PK_NOT_SUPPORTED", "line " + (s((byId[firstRow] || {}).item_name) || firstRow) + " moves stock to another bin or batch: not handled by the background save yet");
    if (fullPicking) return fail("PK_NOT_SUPPORTED", "Full Picking with a bin / batch move uses the classic save");
    const inHu = moveRecords.find((r) => s(r.handling_unit_id));
    if (inHu) return fail("PK_NOT_SUPPORTED", "line " + (inHu.item_name || inHu.item_code) + " is in a handling unit and moves: the classic save handles it");
  }

  // line status, as code_node_Z5JH4g2u: only the lines picked now change (an untouched line keeps its status)
  const rowPatch = {};
  for (const rowId of Object.keys(touched)) {
    const row = byId[rowId];
    const picked = pickedByRow[rowId] || 0;
    let newPending = Math.max(0, q8(num(row.pending_process_qty) - picked));
    let status;
    // Full Picking: any picked quantity closes the line; what is left goes to a new Picking (Convert to Picking)
    if (fullPicking && picked > 0) {
      status = "Completed";
      newPending = 0;
    } else if (newPending === 0) status = "Completed";
    else if (picked > 0) status = "In Progress";
    else status = s(row.line_status) || "Open";
    const patch = Object.assign({ line_status: status, pending_process_qty: newPending, picked_qty: 0 }, lineRemarks[rowId]);
    if (picked > 0) patch.attachment = [];
    rowPatch[rowId] = patch;
  }

  // ITEM BUNDLES - all or nothing (code_node_iES7iMKA): finishing one item of a bundle while another is short is refused
  const shortfalls = [];
  for (const parent of rows) {
    if (!isBundleParent(parent)) continue;
    const kids = rows.filter((r) => s(r.parent_id) === s(parent.id) && s(r.row_type) !== "header" && s(r.line_status) !== "Cancelled");
    if (!kids.length) continue;
    const state = kids.map((k) => {
      const pending = num(k.pending_process_qty);
      const picked = pickedByRow[s(k.id)] || 0;
      return { row: k, pending: pending, picked: picked, short: Math.max(0, pending - picked) };
    });
    // Full Picking closes a short line, so there anything picked under the bundle finishes it
    if (!state.some((x) => x.pending > 0 && x.short === 0) && !(fullPicking && state.some((x) => x.picked > 0))) continue;
    for (const x of state) {
      if (x.short > 0) shortfalls.push((s(parent.item_name) || s(parent.item_bundle_id)) + " / " + (s(x.row.item_name) || s(x.row.item_code) || "item") + ": picked " + x.picked + " of " + x.pending);
    }
  }
  if (shortfalls.length) return fail("PK_BUNDLE_SHORT", "An item bundle must be picked in full. Short: " + shortfalls.join("; ") + ". Pick every item of the bundle to its full quantity, or none of them.");

  // GD line picking status (code_node_iES7iMKA normal path): every Picking row of the GD line, after this pick
  const statusesByGdLine = {};
  for (const r of rows) {
    const gl = s(r.gd_line_id);
    if (!gl || s(r.row_type) === "header") continue;
    const st = rowPatch[s(r.id)] ? rowPatch[s(r.id)].line_status : s(r.line_status) || "Open";
    (statusesByGdLine[gl] = statusesByGdLine[gl] || []).push(st);
  }
  const lineStatusOf = (gl) => {
    const st = (statusesByGdLine[gl] || []).filter((x) => x !== "Cancelled");
    if (!st.length) return "Cancelled";
    if (st.every((x) => x === "Completed")) return "Completed";
    if (st.some((x) => x === "Completed" || x === "In Progress")) return "In Progress";
    return "Open";
  };
  // Full Picking (code_node_iES7iMKA's cumulative): the GD line's picked quantity over the records of every Picking, this
  // pick included; above the GD quantity the pick is refused before anything is written
  const pickedBefore = {};
  for (const r of list(pickedRows)) if (s(r.gd_line_id)) pickedBefore[s(r.gd_line_id)] = num(r.picked_qty);
  const pickedNow = {};
  for (const rec of records) if (s(rec.gd_line_id)) pickedNow[s(rec.gd_line_id)] = (pickedNow[s(rec.gd_line_id)] || 0) + rec.store_out_qty;
  const overPicked = [];
  const gdLineUpdates = [];
  const doneGdLine = {};
  for (const rec of records) {
    const gl = s(rec.gd_line_id);
    if (!gl || doneGdLine[gl]) continue;
    doneGdLine[gl] = true;
    const line = gdLineById[gl];
    if (!line) continue;
    if (fullPicking) {
      const total = r3((pickedBefore[gl] || 0) + pickedNow[gl]);
      const planQty = num(line.gd_qty);
      if (planQty > 0 && r3(total - planQty) > 0) overPicked.push((s(line.material_name) || s(rec.item_name) || s(rec.item_code)) + " (Picked: " + total + ", Plan: " + planQty + ")");
      gdLineUpdates.push({ id: gl, picking_status: total >= planQty && planQty > 0 ? "Completed" : total > 0 ? "In Progress" : "Created" });
      continue;
    }
    if (s(line.picking_status) === "Completed") continue;
    gdLineUpdates.push({ id: gl, picking_status: (statusesByGdLine[gl] ? lineStatusOf(gl) : "") || s(line.picking_status) || "Created" });
  }
  if (overPicked.length) return fail("PK_OVER_PICK", "Picked quantity cannot exceed plan quantity: " + overPicked.join(", "));
  const gdIds = Object.keys(records.reduce((o, r) => Object.assign(o, r.gd_id ? { [r.gd_id]: true } : {}), {})).sort();
  // every GD on this Picking: their header picking status is rolled up again at commit, as PICKING's GD loop does
  const gdIdsAll = Object.keys(rows.concat(records).reduce((o, r) => Object.assign(o, s(r.gd_id) && s(r.line_status) !== "Cancelled" ? { [s(r.gd_id)]: true } : {}), {})).sort();

  // the confirmation message, as code_node_ClampMsg
  let message = "Picking processed successfully";
  if (clampedLines.length) {
    const byLine = {};
    for (const c of clampedLines) {
      const k = s(c.picking_item_id);
      if (!byLine[k]) byLine[k] = { name: c.item_name || k, requested: 0, allowed: 0 };
      byLine[k].requested += Number(c.requested) || 0;
      byLine[k].allowed += Number(c.allowed) || 0;
    }
    const parts = Object.keys(byLine).map((k) => byLine[k].name + " " + r3(byLine[k].requested) + String.fromCharCode(8594) + r3(byLine[k].allowed));
    message += ". " + parts.length + " line(s) were reduced because the stock had already been picked: " + parts.join(", ") + ". Check the document before picking again.";
  }

  const headerPatch = {};
  const hp = req.header_patch && typeof req.header_patch === "object" ? req.header_patch : {};
  for (const k of HEADER_FIELDS) if (has(hp, k)) headerPatch[k] = hp[k];

  const snapshot = { to_status: toStatus, rows: {}, gds: {} };
  for (const rowId of Object.keys(touched)) snapshot.rows[rowId] = { pending: q8(byId[rowId].pending_process_qty), status: s(byId[rowId].line_status) };
  for (const g of gdIds) snapshot.gds[g] = gdStatusById[g] || "";

  const prepared = {
    v: 1, prepared_by: "PICKING_BULK_PREPARE", job_id: jobId, picking_id: pickingId, picking_no: s(hdr.to_id),
    organization_id: s(entry.organizationId), plant_id: s(hdr.plant_id), operation: op, full_picking: fullPicking ? 1 : 0,
    confirmed_by: s(req.confirmed_by), confirmed_at: s(entry.confirmedAt),
    header_patch: headerPatch, records: records, row_patch: rowPatch, gd_lines: gdLineUpdates, gd_ids: gdIds, gd_ids_all: gdIdsAll,
    snapshot: snapshot, clamped: clampedLines, result_message: message,
    packing: { required: num(hdr.packing_required) === 1 ? 1 : 0, auto: num(hdr.auto_trigger_pkg) === 1 ? 1 : 0, packing_mode: s(hdr.packing_mode) },
  };
  const ready = {
    id: jobId, job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready to save " + records.length + " picked line(s)",
    row_version: (Number(entry.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null,
    prepared_payload: JSON.stringify(prepared), line_count: records.length, picking_no: s(hdr.to_id),
  };
  // a move: the move block re-plans the moved GDs, then writes READY (with the move) or FAILED itself
  if (moveRecords.length) {
    const idsSql = (xs) => { const u = xs.map(s).filter((x) => /^[0-9]{1,20}$/.test(x)).filter((x, i, a) => a.indexOf(x) === i); return u.length ? u.join(",") : "0"; };
    const gdLineStatus = {};
    for (const u of gdLineUpdates) gdLineStatus[u.id] = u.picking_status;
    return Object.assign({}, base, {
      route: "MOVE", result_message: message, recordCount: records.length, touchedRows: Object.keys(touched).length, gdLineCount: gdLineUpdates.length,
      prepared: prepared, isLoadingBay: bay ? 1 : 0, gdLineStatus: gdLineStatus, plantId: s(hdr.plant_id),
      moveRecords: moveRecords.map((r) => ({ gd_line_id: r.gd_line_id, gd_id: r.gd_id, source_bin: r.source_bin, target_location: r.target_location, batch_no: r.batch_no,
        target_batch: r.target_batch, store_out_qty: r.store_out_qty, handling_unit_id: r.handling_unit_id, item_name: r.item_name, item_code: r.item_code })),
      moveGdLineIdsSql: idsSql(moveRecords.map((r) => r.gd_line_id)),
      moveBinIdsSql: idsSql(moveRecords.map((r) => r.source_bin).concat(moveRecords.map((r) => r.target_location))),
      moveBatchIdsSql: idsSql(moveRecords.map((r) => r.batch_no).concat(moveRecords.map((r) => r.target_batch))),
      moveHuIdsSql: "0",
    });
  }
  // READY keeps the worker's lease (it publishes under it next); only a FAILED row releases it
  return Object.assign({}, base, {
    route: "OK", readyRows: [ready], needReady: "YES", result_code: "", result_message: message, job_status: "READY_TO_COMMIT",
    recordCount: records.length, touchedRows: Object.keys(touched).length, gdLineCount: gdLineUpdates.length,
  });
};
const entry = [{{node:code_node_PPentry.data}}][0];
const res = planConfirm(entry, [{{node:sql_node_PPhdr.data}}][0], [{{node:sql_node_PPlines.data}}][0], [{{node:sql_node_PPgd.data}}][0], [{{node:sql_node_PPuom.data}}][0], [{{node:sql_node_PPpicked.data}}][0]);
console.log("prepare plan", JSON.stringify({ route: res.route, records: res.recordCount, rows: res.touchedRows, gdLines: res.gdLineCount, result: res.result_code, message: res.result_message }));
return res;