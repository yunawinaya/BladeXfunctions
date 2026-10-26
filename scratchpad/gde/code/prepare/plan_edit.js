// GD Edit V2 - GD_EDIT_PREPARE's planner: the GD as stored (read fresh, locked Processing by this job), the edit's delta
// applied back (apply_delta.js), GOODS_DELIVERY's Edit + Save as Created path run on it (chain_edit.js), and the payload
// COMMIT works from, one part per step. Needs gdc chain.js + lift, chain_edit.js, delta.js, apply_delta.js loaded first.
// R = adapted reads: stored, lock, pick, linkage, pickingSetup, itemFlags, packingSetup, activePickings, binNames, soLines,
// cleanupSoLines, soHeaders, pickingFormat, itemDatas, allocated, pending, serialItems, (extraReads, calleeExtraReads: tests)
const GE_RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const GE_SYS_COLS = ["id", "parent_id", "goods_delivery_id", "children", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id"];
// update_node_4uzHPx7M's columns besides the two arrays (6L2Ozea8's updateData also carries so_no, customer_id, updated_by,
// updated_at: the node does not write them)
const GE_PICK_UPDATE_COLS = ["to_status", "assigned_to", "ref_doc", "project_id", "delivery_method", "delivery_method_text", "area_id", "driver_name", "ic_no",
  "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection", "courier_company", "shipping_date", "tracking_number", "est_arrival_date",
  "freight_charges", "ct_driver_name", "ct_driver_contact_no", "ct_ic_no", "vehicle_no", "est_delivery_date", "delivery_cost", "shipping_company",
  "ss_shipping_date", "ss_freight_charges", "shipping_method", "ss_est_arrival_date", "ss_tracking_number", "tpt_vehicle_number", "tpt_transport_name",
  "tpt_ic_no", "tpt_driver_contact_no", "tpt_driver_name", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company",
  "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection", "di_tracking_number",
  "di_freight_charges"];
const GE_NUMBER_PH = "#GDE-DELIVERY-NO#";
const geLinePh = (n) => "9" + String(n).padStart(18, "0");

// a row array as {layout, cells, drop, added} against the stored rows (one level of children): rebuilding it gives the
// target array exactly (geApplyRowsDelta); rows of the stored array it does not name are the ones the write drops
const geRowsDelta = function geRowsDelta(target, stored) {
  const byId = {};
  for (const r of stored || []) { if (r && r.id !== undefined) byId[String(r.id)] = r; for (const c of (r && r.children) || []) if (c.id !== undefined) byId[String(c.id)] = c; }
  const d = { layout: [], cells: {}, drop: {}, added: [] };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const refOf = (r) => {
    const id = r.id === undefined || r.id === null ? "" : String(r.id);
    const o = id ? byId[id] : null;
    if (!o) { const x = JSON.parse(JSON.stringify(r)); delete x.children; d.added.push(x); return "+" + (d.added.length - 1); }
    const cells = {}, drop = [];
    for (const k of Object.keys(r)) if (k !== "children" && (!has(o, k) || JSON.stringify(r[k]) !== JSON.stringify(o[k]))) cells[k] = r[k];
    for (const k of Object.keys(o)) if (k !== "children" && !has(r, k)) drop.push(k);
    if (Object.keys(cells).length) d.cells[id] = cells;
    if (drop.length) d.drop[id] = drop;
    return id;
  };
  for (const r of target || []) {
    const e = { ref: refOf(r) };
    if (Array.isArray(r.children)) e.children = r.children.map(refOf);
    d.layout.push(e);
  }
  return d;
};
const geApplyRowsDelta = function geApplyRowsDelta(stored, d) {
  const byId = {};
  for (const r of stored || []) { if (r && r.id !== undefined) byId[String(r.id)] = r; for (const c of (r && r.children) || []) if (c.id !== undefined) byId[String(c.id)] = c; }
  const rowOf = (ref) => {
    if (ref.indexOf("+") === 0) return JSON.parse(JSON.stringify(d.added[Number(ref.slice(1))]));
    if (!byId[ref]) throw new Error("row " + ref + " is no longer stored");
    const r = JSON.parse(JSON.stringify(byId[ref]));
    delete r.children;
    Object.assign(r, JSON.parse(JSON.stringify(d.cells[ref] || {})));
    for (const k of d.drop[ref] || []) delete r[k];
    return r;
  };
  return (d.layout || []).map((e) => { const r = rowOf(e.ref); if (e.children) r.children = e.children.map(rowOf); return r; });
};
// E5: the arrays the producer (code_node_6L2Ozea8) built, rebuilt from the Picking as read at the gated version
const geRebuildPicking = function geRebuildPicking(storedPick, PICK) {
  return { table_picking_items: geApplyRowsDelta(storedPick.table_picking_items || [], PICK.items), table_picking_records: geApplyRowsDelta(storedPick.table_picking_records || [], PICK.records) };
};

// the GD write as COMMIT applies it: lines removed / patched (only the cells the write changes; a cell the write leaves out
// reads back empty) / inserted (placeholder id until E2), the header's changed cells; order = the read-back's line order
// the Picking version this job holds: SUBMIT's recorded one; else (SUBMIT died before recording it: the job fell due by itself
// after 120 s, and no device takes a lock while the GD has an open edit) the locked Picking's current version
const geAdoptPickVersion = function geAdoptPickVersion(req, R) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const p = R && R.pick && R.pick.data;
  return s((req || {}).picking_version) || (p && s(p.id) && Number(p.is_processing) === 1 ? s(p.update_time) : "");
};
// cfDefs: the header table's custom-field definitions (cf.js) - a header custom_fields value compares as names
const geGdParts = function geGdParts(stored, after, K, cfDefs) {
  const L = K.line, H = K.header;
  const sys = new Set(GE_SYS_COLS);
  const emptyV = (v) => v === undefined || v === null || v === "";
  // JSON with sorted keys: a MySQL json column keeps its own key order
  const sorted = (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x);
  const same = (a, b) => (emptyV(a) && emptyV(b)) || JSON.stringify(a, sorted) === JSON.stringify(b, sorted);
  const storedRows = {};
  for (const r of stored.table_gd || []) { storedRows[String(r.id)] = r; for (const c of r.children || []) storedRows[String(c.id)] = c; }
  const seen = {};
  const GDL = { inserts: [], patches: [], deletes: [], order: [] };
  const cellsOf = (r, o) => {
    const cells = {}, before = {};
    for (const c of new Set(Object.keys(r).concat(Object.keys(o)))) {
      if (sys.has(c) || !L[c]) continue;
      if (!same(r[c], o[c])) { cells[c] = emptyV(r[c]) ? null : r[c]; before[c] = emptyV(o[c]) ? null : o[c]; }
    }
    return { cells, before };
  };
  const take = (r, parentId) => {
    const id = String(r.id);
    if (storedRows[id] && !/^9\d{18}$/.test(id)) {
      seen[id] = true;
      const d = cellsOf(r, storedRows[id]);
      if (Object.keys(d.cells).length) GDL.patches.push({ id: id, cells: d.cells, before: d.before });
    } else {
      const row = {};
      for (const c of Object.keys(r)) if (!sys.has(c) && L[c] && !emptyV(r[c])) row[c] = r[c];
      GDL.inserts.push({ ph: id, parent: parentId || null, row: row });
    }
    return id;
  };
  for (const r of after.table_gd || []) {
    const e = { id: take(r, null) };
    if (Array.isArray(r.children) && r.children.length) e.children = r.children.map((c) => take(c, String(r.id)));
    GDL.order.push(e);
  }
  GDL.deletes = Object.keys(storedRows).filter((id) => !seen[id]);
  const GDH = { cells: {}, before: {} };
  for (const c of new Set(Object.keys(after).concat(Object.keys(stored)))) {
    // gd_status is E6's; a Draft's 'issued' number is E0N's (the placeholder); a typed number (-9999) is a plain cell
    if (c === "table_gd" || c === "gd_status" || sys.has(c) || !H[c] || (c === "delivery_no" && after[c] === GE_NUMBER_PH)) continue;
    const changed = c === "custom_fields" && cfDefs ? !same(geCfCanon(after[c], cfDefs), geCfCanon(stored[c], cfDefs)) : !same(after[c], stored[c]);
    if (changed) { GDH.cells[c] = emptyV(after[c]) ? null : after[c]; GDH.before[c] = emptyV(stored[c]) ? null : stored[c]; }
  }
  return { GDL, GDH };
};
// the GD after E2 + E6 (tests; COMMIT reads it back instead): stored, parts applied, gd_status Created
const geApplyGdParts = function geApplyGdParts(stored, parts, K) {
  const gd = JSON.parse(JSON.stringify(stored));
  const rows = {};
  for (const r of gd.table_gd || []) { rows[String(r.id)] = r; for (const c of r.children || []) rows[String(c.id)] = c; }
  for (const p of parts.GDL.patches) for (const [c, v] of Object.entries(p.cells)) { if (v === null) delete rows[p.id][c]; else rows[p.id][c] = v; }
  for (const i of parts.GDL.inserts) rows[i.ph] = Object.assign({ id: i.ph }, JSON.parse(JSON.stringify(i.row)), i.parent ? { parent_id: i.parent } : {});
  const strip = (r) => { const o = Object.assign({}, r); delete o.children; return o; };
  gd.table_gd = parts.GDL.order.map((e) => { const r = strip(rows[e.id]); if (e.children) r.children = e.children.map((x) => strip(rows[x])); return r; });
  for (const [c, v] of Object.entries(parts.GDH.cells)) { if (v === null) delete gd[c]; else gd[c] = v; }
  gd.gd_status = "Created";
  if (parts.GDH.number) gd.delivery_no = parts.GDH.number;
  return gd;
};

const gePlan = function gePlan(entry, R, K) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v || 0);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const G0 = { count: 0, data: {} };
  const base = { route: "FAIL", code: "", message: "", operationKey: "", organizationId: s(entry.organizationId), movements: [], payload: "", partRows: [], parts: null,
    lineCount: 0, movementCount: 0, gdId: s(entry.gdId), unlockOk: 0, pickUnlockId: "", notes: {} };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const req = entry.request || {};
  const stored0 = R.stored;
  if (!stored0 || !s(stored0.id)) return fail("GDE_GD_NOT_FOUND", "Goods Delivery " + s(entry.gdId) + " not found");
  const lock = R.lock || {};
  const mine = s(lock.result_ref) !== "" && s(lock.result_ref) === s(entry.idempotencyKey);
  if (s(stored0.gd_status) !== "Processing" || !mine) return fail("GDE_NOT_LOCKED", "Goods Delivery is " + s(stored0.gd_status) + (mine ? "" : ", locked by another job") + ": not Processing under this job");
  // from here a failure puts the GD back to its stored status (this job holds its lock)
  base.unlockOk = 1;
  if ((R.serialItems || []).length) return fail("GDE_NOT_ELIGIBLE", "serial-numbered items are saved by the classic save");
  const stored = clone(stored0);
  stored.gd_status = s(req.stored_status) || "Created";
  // our Picking lock (SUBMIT: is_processing 1 at the recorded version, or adopted) is released with a failure
  // a Picking force complete (PICKING_FC) edits under ITS job's Picking lock: never adopted, never released here
  const fcSrc = s(req.source) === "PICKING_FC";
  const pv = fcSrc ? "" : geAdoptPickVersion(req, R);
  if (!fcSrc && R.pick && R.pick.data && s(R.pick.data.id) && num(R.pick.data.is_processing) === 1 && pv && s(R.pick.data.update_time) === pv) base.pickUnlockId = s(R.pick.data.id);
  // the Picking as the classic save would read it: our own lock (SUBMIT, at the recorded version) is not a device's
  let pick = R.pick && R.pick.data && s(R.pick.data.id) ? clone(R.pick) : G0;
  if (pick !== G0 && fcSrc) pick.data.is_processing = 0;
  else if (pick !== G0) {
    if (num(pick.data.is_processing) === 1) {
      if (!pv || s(pick.data.update_time) !== pv) return fail("GDE_PICKING_CHANGED", "the Picking was changed or taken over since the edit was submitted");
      pick.data.is_processing = 0;
    } else if (pv) return fail("GDE_PICKING_CHANGED", "the Picking's lock was released by someone else");
  }
  const allData = geApplyDelta(stored, req.delta || { header: {}, dropHeader: [], lines: [], added: [], removed: [], layout: (stored.table_gd || []).map((r) => ({ ref: String(r.id), children: (r.children || []).map((c) => String(c.id)) })) }, K);
  allData.gd_status = stored.gd_status;
  const a = req.answers || {};
  // the force complete's re-save is classic PICKING's (code_node_GdPlan), as GD_EDIT_SUBMIT's gate ran it
  const params = fcSrc ? { allData, saveAs: "Created", pageStatus: "Edit", needCL: "not required", continueZero: "Yes", confirmPickReversal: "", isPicking: "Yes", isLoadingBay: 0 }
    : s(req.source) === "CASCADE"
    ? { allData, saveAs: "Created", pageStatus: "Edit", needCL: "auto", continueZero: "Yes", confirmPickReversal: s(a.confirmPickReversal) }
    : { allData, saveAs: "Created", pageStatus: "Edit", needCL: s(a.needCL) || "required", continueZero: s(a.continueZero), confirmPickReversal: s(a.confirmPickReversal), auto_gr_confirmed: "", auto_gr_skip: "" };
  const reads = Object.assign({}, R, { gd: { count: 1, data: stored }, pick: pick });
  const ch = geChain({ params, reads, stored, tenantId: s(entry.tenantId), uuid: "GDE" + s(entry.jobId), kinds: K, mint: { line: geLinePh, number: GE_NUMBER_PH },
    extraReads: R.extraReads, calleeExtraReads: R.calleeExtraReads });
  if (ch.route !== "PLANNED") return fail(ch.route === "NOT_ELIGIBLE" ? "GDE_NOT_ELIGIBLE" : "GDE_" + ch.code, ch.message || ch.route);
  if (!ch.afterImage) return fail("GDE_NO_AFTER_IMAGE", "the GD write could not be emulated");
  base.notes = { pickingReversalNote: s(ch.pickingReversalNote) };
  const H = (key) => __withContext(ch.ctx.head, () => __v(key));
  const C = (key) => __withContext(ch.ctx.callee, () => __v(key));
  const jobId = s(entry.jobId);

  // ENGINE: condition_or_node_zvMyWcqT's mapping (gdc plan.js); every call carries the GD as written (Pgtw6zFL.gdData)
  const gdd = H("node:code_node_Pgtw6zFL.data.gdData") || {};
  const Pm = { plant: s(gdd.plant_id), org: s(gdd.organization_id), no: s(gdd.delivery_no), date: s(gdd.delivery_date) };
  const exec = ch.unused.exec || {};
  const movements = [];
  (exec.inventoryMovements || []).forEach((m, i) => {
    const common = { plant_id: Pm.plant, organization_id: Pm.org, material_id: s(m.material_id), quantity: m.quantity, material_uom: m.material_uom || null, transaction_type: "GDL",
      trx_no: Pm.no, parent_trx_no: m.line_so_no || null, location_id: s(m.bin_location), batch_id: m.batch_id || null, doc_date: Pm.date, handling_unit_id: m.handling_unit_id || "" };
    const k = "M" + (i + 1);
    const t = s(m.movement_type);
    if (t === "DELIVERY") movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: m.source || null, isMovingInv: 0 }));
    else if (t === "UNRESTRICTED_TO_RESERVED") {
      movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: "Unrestricted", isMovingInv: 1 }));
      movements.push(Object.assign({}, common, { movement_key: k + ".2", direction: "ADD", inventory_category: "Reserved", isMovingInv: 1, unit_price_from: k }));
    } else if (t === "RESERVED_SUBTRACT_CROSS_BIN") movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }));
    else if (t === "RESERVED_ADD_CROSS_BIN") movements.push(Object.assign({}, common, { movement_key: k, direction: "ADD", inventory_category: "Reserved", isMovingInv: 1 }));
    else {
      movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }));
      movements.push(Object.assign({}, common, { movement_key: k + ".2", direction: "ADD", inventory_category: "Unrestricted", isMovingInv: 1, unit_price_from: k }));
    }
  });

  // RES: the planner's records as update_node_7k2yYMLH / add_node_ojy0rTgC write them (an omitted key is written NULL)
  const readRes = {};
  for (const r of ((R.allocated || {}).data || []).concat((R.pending || {}).data || [])) readRes[s(r.id)] = r;
  const pickCols = (o, cols) => { const x = {}; for (const c of cols) x[c] = o[c] === undefined ? null : o[c]; return x; };
  const resUpdates = (exec.reservedRecordUpdates || []).map((u) => ({ id: s(u.id), before: pickCols(readRes[s(u.id)] || {}, GE_RES_COLS), after: pickCols(u, GE_RES_COLS) }));
  for (const u of resUpdates) if (!readRes[u.id]) return fail("GDE_RES_UNREAD", "the planner updates reservation " + u.id + ", which PREPARE did not read");
  const resCreates = (exec.reservedRecordCreates || []).map((c, i) => Object.assign({}, c, { job_line_key: jobId + "|C|" + (i + 1), reserved_date: Pm.date, plant_id: Pm.plant, organization_id: Pm.org }));

  // GDL / GDH: the write, as the read-back shows it, against the GD as stored
  const gp = geGdParts(stored, ch.afterImage, K, R.cfDefs);
  if (ch.minted.number) gp.GDH.number = ch.minted.number;
  if (s(stored.gd_status) === "Draft") gp.GDH.numbering = { delivery_no_type: ch.write.header.delivery_no_type === undefined ? null : ch.write.header.delivery_no_type, issue: ch.write.header.delivery_no === "issued" ? 1 : 0 };
  // delivery_cost <- driver_cost (deployed mapping): the form never sends driver_cost, so the classic save blanks a column
  // that is only ever 0.00 / NULL; V2 writes it only when a value is sent (as GD Completed V2)
  if ("delivery_cost" in gp.GDH.cells && gp.GDH.cells.delivery_cost === null) { delete gp.GDH.cells.delivery_cost; delete gp.GDH.before.delivery_cost; }

  // SO: what E4 re-runs the lifted SO nodes from (the GD side frozen here; the SO rows read fresh at E4)
  const fill = H("node:code_node_IyJHrBst.data") || {};
  const hb = H("node:code_node_hb8ZWe9c.data") || {};
  const proj = (rows, cols) => (rows || []).map((r) => { const x = {}; for (const c of cols) if (r[c] !== undefined) x[c] = r[c]; if (Array.isArray(r.children)) x.children = proj(r.children, cols); return x; });
  const LINE_SO = ["id", "material_id", "material_name", "gd_material_desc", "so_line_item_id", "gd_qty", "gd_order_quantity", "gd_order_uom_id", "good_delivery_uom_id",
    "item_bundle_id", "line_so_id", "base_qty"];
  const so = {
    gdStatus: s(fill.gd_status), needSOCleanUp: num(fill.needSOCleanUp), isSelectPicking: allData.is_select_picking === undefined ? null : allData.is_select_picking,
    splitPolicy: H("node:code_picking_defaults.data.splitPolicy") || "ALLOW_SPLIT", items: ((R.itemFlags || {}).data !== undefined ? R.itemFlags.data : R.itemFlags) || [],
    tableGD: proj(hb.tableGD, LINE_SO), bundleParents: proj(hb.bundleParents, LINE_SO), soLineIds: (hb.soLineIds || []).map(String),
    original: s(fill.gd_status) === "Draft" ? null : proj(stored.table_gd, ["id", "so_line_item_id", "gd_qty", "item_bundle_id", "material_id", "line_so_id"]),
    current: proj((fill.allData || {}).table_gd, ["so_line_item_id", "item_bundle_id", "material_id", "line_so_id", "gd_qty"]),
    soIds: (fill.allData || {}).so_id === undefined ? null : fill.allData.so_id,
  };

  // PICK / STAMP: code_node_o35eZx2c -> code_node_6L2Ozea8 (if_9xhwui06), and code_pick_hdr_sync
  const PICK = { mode: "NONE" };
  const STAMP = { gdPickingStatus: null, lineIds: [] };
  if (num(ch.pickBranch) === 1) {
    const six = H("node:code_node_6L2Ozea8.data") || {};
    const o35 = H("node:code_node_o35eZx2c.data") || {};
    if (num(six.isUpdate) === 1) {
      if (!pick.data || s(pick.data.id) !== s(six.existingTOId)) return fail("GDE_PICKING_MISMATCH", "the Picking to update is not the one read");
      const ud = six.updateData || {};
      Object.assign(PICK, { mode: "UPDATE", pickingId: s(six.existingTOId), version: pv, header: pickCols(ud, GE_PICK_UPDATE_COLS),
        items: geRowsDelta(ud.table_picking_items || [], pick.data.table_picking_items || []), records: geRowsDelta(ud.table_picking_records || [], pick.data.table_picking_records || []) });
    } else Object.assign(PICK, { mode: "CREATE", createData: six.createData || {} });
    STAMP.gdPickingStatus = (six.gdUpdateData || {}).picking_status === undefined ? null : six.gdUpdateData.picking_status;
    STAMP.lineIds = (o35.gdLineUpdates || []).map((x) => s(x.gd_line_id));
  }
  const hs = H("node:code_pick_hdr_sync.data") || {};
  if (num(hs.syncNeeded) === 1) PICK.hdrSync = { pickingId: s(hs.pickingId), headerData: hs.headerData || {} };

  // AFTER: REORDER_SET_REDIS GD_CREATED (once, after the writes) and the items' last_transaction_date
  const reorderRow = (r) => { const x = {}; for (const c of ["material_id", "temp_qty_data", "gd_qty", "base_qty"]) if (r[c] !== undefined) x[c] = r[c]; if (Array.isArray(r.children)) x.children = r.children.map(reorderRow); return x; };
  const deltas = ch.reorder ? ch.reorder.data || [] : [];
  const reorder = deltas.length ? { previous: s(fill.gd_status) === "Draft" ? null : (stored.table_gd || []).map(reorderRow), latest: (hb.tableGD || []).map(reorderRow), deltas: deltas } : null;
  const dates = H("node:code_node_62FzZA2e.data") || {};
  const AFTER = { reorder: reorder, item_ids: (dates.updates || []).map((u) => s(u.id)) };

  const parts = {
    ENGINE: { operation_key: "GDE|" + jobId, movements: movements },
    GDL: gp.GDL, GDH: gp.GDH,
    RES: { updates: resUpdates, creates: resCreates },
    SO: so, PICK: PICK, STAMP: STAMP, AFTER: AFTER,
  };
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const CHUNK = 400000;
  const partRows = [];
  const manifestParts = {};
  for (const [name, value] of Object.entries(parts)) {
    const text = JSON.stringify(value);
    const names = [];
    for (let at = 0, k = 1; at < text.length || k === 1; at += CHUNK, k++) {
      const step = "P|" + nonce + "|" + name + "|" + String(k).padStart(3, "0");
      names.push(step);
      partRows.push({ job_id: jobId, organization_id: Pm.org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: text.slice(at, at + CHUNK) });
    }
    manifestParts[name] = names;
  }
  const lines = (stored.table_gd || []).reduce((k, r) => k + 1 + (r.children || []).length, 0);
  const manifest = {
    v: 1, prepared_by: "GD_EDIT_PREPARE", job_id: jobId, gd_id: s(stored.id), gd_no: s(stored.delivery_no), stored_status: stored.gd_status, organization_id: Pm.org,
    plant_id: Pm.plant, source: s(req.source), submitted_by: s(req.submitted_by), nonce: nonce, parts: manifestParts, notes: base.notes, picking_version: pv,
    counts: { lines: lines, movements: movements.length, reservation_updates: resUpdates.length, reservation_creates: resCreates.length, line_inserts: gp.GDL.inserts.length,
      line_patches: gp.GDL.patches.length, line_deletes: gp.GDL.deletes.length, header_cells: Object.keys(gp.GDH.cells).length, picking: PICK.mode, stamps: STAMP.lineIds.length },
  };
  return Object.assign(base, { route: "ENGINE", code: "200", message: "Planned " + movements.length + " movements for " + lines + " lines", operationKey: "GDE|" + jobId,
    movements: movements, payload: JSON.stringify(manifest), partRows: partRows, parts: parts, lineCount: lines, movementCount: movements.length });
};
