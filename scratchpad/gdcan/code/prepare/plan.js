// GD_CANCEL_PREPARE - Plan: the GD as it stood before SUBMIT locked it (Created), GOODS_DELIVERY's cancel + GD_UNUSED_FN_NEW's
// planner on the lifted bodies (chain.js), the engine movements, and the prepared payload COMMIT works from (one part per step).
// Ends FAIL (job FAILED, GD back to Created) or ENGINE (INVENTORY_BULK_APPLY PLAN next; with no movement COMMIT skips X2).
const GX_HEADER_COLS = ["gd_status", "gd_total", "picking_status", "delivery_no", "so_id", "so_no"];
const GX_RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const GX_MAX_MOVEMENTS = 5000;
const GX_MAX_BOXES = 300;
// a cancel's line writes: the fill-back's and code_node_GKc0ALEe's stamps (the lines seen on dev 10-20); anything else = refused
const GX_LINE_COLS = ["prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
  "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight", "picking_status", "packing_status"];

// the GD numbers of a Picking header ("GD/1, GD/2"): the old number replaced as a whole token
const gxRenumber = function gxRenumber(text, oldNo, newNo) {
  const parts = String(text === undefined || text === null ? "" : text).split(/(\s*,\s*)/);
  let hit = false;
  const out = parts.map((p, i) => (i % 2 === 0 && p.trim() === oldNo ? ((hit = true), p.replace(oldNo, newNo)) : p)).join("");
  return hit ? out : null;
};

const gxPlan = function gxPlan(entry, S) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v || 0);
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const ID = /^[0-9]{1,20}$/;
  const base = { route: "FAIL", code: "", message: "", operationKey: "", organizationId: s(entry.organizationId), movements: [], payload: "", partRows: [], lineCount: 0,
    movementCount: 0, gdId: s(entry.gdId), unlockOk: 0 };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const req = entry.request || {};

  const R = gcAdapt(S);
  if (!R.gd.count) return fail("GDX_GD_NOT_FOUND", "Goods Delivery " + s(entry.gdId) + " not found");
  const stored = R.gd.data;
  // the engine has no serial-number handling: such a GD stays on the classic cancel
  if ((R.serialItems || []).length) return fail("GDX_NOT_ELIGIBLE", "serial-numbered items are cancelled by the classic cancel");
  const lock = (Array.isArray(S.lock) ? S.lock : S.lock ? [S.lock] : [])[0] || {};
  const mine = s(lock.result_ref) !== "" && s(lock.result_ref) === s(entry.idempotencyKey);
  if (s(stored.gd_status) !== "Processing" || !mine) return fail("GDX_NOT_LOCKED", "Goods Delivery is " + s(stored.gd_status) + (mine ? "" : ", locked by another submit") + ": not Processing under this job");
  base.unlockOk = 1;
  // the classic cancel reads the GD before any write: Created (SUBMIT only set the lock)
  stored.gd_status = "Created";
  const gdId = s(stored.id);

  const out = gxChain({ params: gxParams(stored), reads: R, tenantId: s(entry.tenantId), uuid: "GDX" + s(entry.jobId), kinds: GC_KINDS });
  if (out.route !== "PLANNED") return fail(out.route === "NOT_ELIGIBLE" ? "GDX_NOT_ELIGIBLE" : "GDX_" + out.code, out.message || out.route);
  const exec = out.unused.exec;
  const pickOut = out.unused.pick || {};
  const ob = __withContext(out.ctx.callee, () => __v("node:code_node_OBz5tEws.data")) || {};
  if ((ob.pickingRecordUpdates || []).length || (pickOut.recordUpdates || []).length || (pickOut.headerUpdates || []).length) {
    return fail("GDX_NOT_ELIGIBLE", "it is linked to Picking records: the classic cancel updates them");
  }
  const H = (key) => __withContext(out.ctx.head, () => __v(key));
  const oldNo = s(stored.delivery_no);
  const chainNo = s(out.write.header.delivery_no);
  if (!oldNo || !chainNo || chainNo === oldNo) return fail("GDX_INVALID_DATA", "the cancelled document number could not be made from '" + oldNo + "'");
  // classic's "<number>-Cancelled" is taken when the number was typed in again after a cancel (PTS GD/2610/1010, 10-28: X6 then
  // failed on the unique number after the stock was released): the first free "-Cancelled-<n>", n from 2
  const taken = new Set((Array.isArray(S.cnos) ? S.cnos : S.cnos ? [S.cnos] : []).map((r) => s(r && r.delivery_no).toUpperCase()));
  let newNo = chainNo;
  for (let n = 2; taken.has(newNo.toUpperCase()); n++) newNo = chainNo + "-" + n;
  const P = { plant: s(stored.plant_id), org: s(stored.organization_id), no: newNo, date: s(stored.delivery_date) };

  // ENGINE: GD_UNUSED_FN_NEW's movements (condition_or_node_zvMyWcqT's switch), merged per balance, unit and order (the same
  // quantities in fewer engine movements); trx_no = the cancelled number, as GD_UNUSED_FN_NEW gets it (code_node_Pgtw6zFL)
  const merged = new Map();
  for (const m of exec.inventoryMovements || []) {
    const t = s(m.movement_type) || "RESERVED_TO_UNRESTRICTED";
    const k = [t, s(m.material_id), s(m.material_uom), s(m.bin_location), s(m.batch_id), s(m.handling_unit_id), s(m.line_so_no), s(m.source)].join("|");
    const x = merged.get(k);
    if (x) x.quantity = q8(x.quantity + num(m.quantity));
    else merged.set(k, Object.assign({}, m, { movement_type: t, quantity: q8(m.quantity) }));
  }
  const movements = [];
  let n = 0;
  for (const m of merged.values()) {
    if (!(m.quantity > 0)) continue;
    const common = {
      plant_id: P.plant, organization_id: P.org, material_id: s(m.material_id), quantity: m.quantity, material_uom: m.material_uom || null,
      transaction_type: "GDL", trx_no: P.no, parent_trx_no: m.line_so_no || null, location_id: s(m.bin_location), batch_id: m.batch_id || null,
      doc_date: P.date, handling_unit_id: m.handling_unit_id || "",
    };
    const k = "M" + ++n;
    const t = m.movement_type;
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
  }
  if (movements.length > GX_MAX_MOVEMENTS) return fail("GDX_TOO_LARGE", "This delivery needs " + movements.length + " stock movements to cancel; one cancel carries at most " + GX_MAX_MOVEMENTS);

  // RES: the planner's absolute targets with the row as read (X3 writes a row only while it still equals it). update_node_7k2yYMLH maps
  // these ten columns and writes NULL for one a record leaves out (a cancel clears target_gd_id): so does V2.
  const readRes = {};
  for (const r of R.allocated.data.concat(R.pending.data)) readRes[r.id] = r;
  const pick = (o, cols) => {
    const x = {};
    for (const c of cols) x[c] = o[c] === undefined ? null : o[c];
    return x;
  };
  // classic's merge bug: two releases into one Pending row each restate it from the row as read and the last one wins; V2 adds them up
  const byId = new Map();
  for (const u of exec.reservedRecordUpdates || []) {
    const id = s(u.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, Object.assign({}, u));
      continue;
    }
    const orig = readRes[id];
    if (!orig || s(orig.status) !== "Pending" || s(u.status) !== "Pending" || s(prev.status) !== "Pending") return fail("GDX_RES_CONFLICT", "reservation " + id + " would be written twice");
    for (const c of ["reserved_qty", "open_qty"]) prev[c] = q8(num(prev[c]) + num(u[c]) - num(orig[c]));
  }
  const resUpdates = [];
  for (const u of byId.values()) {
    const after = pick(u, GX_RES_COLS);
    if (after.status === null || after.reserved_qty === null || after.open_qty === null) return fail("GDX_RES_BLANK", "reservation " + s(u.id) + " has no status or quantity in the plan");
    resUpdates.push({ id: s(u.id), before: pick(readRes[s(u.id)] || {}, GX_RES_COLS), after: after });
  }
  const jobId = s(entry.jobId);
  const resCreates = (exec.reservedRecordCreates || []).map((c, i) => Object.assign({}, c, { job_line_key: jobId + "|C|" + (i + 1), reserved_date: P.date, plant_id: P.plant, organization_id: P.org }));

  // SO lines and headers are recomputed at X4 from a fresh read (QtyCheckBatch + UMQapdjk + lwB2FVe0 under saveAs Cancelled)
  const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const lineProj = (r) => ({ id: r.id, material_id: r.material_id, material_name: r.material_name, gd_material_desc: r.gd_material_desc, so_line_item_id: r.so_line_item_id, gd_qty: r.gd_qty, gd_order_quantity: r.gd_order_quantity, gd_order_uom_id: r.gd_order_uom_id, item_bundle_id: r.item_bundle_id });
  const hb = H("node:code_node_hb8ZWe9c.data") || {};
  const so = {
    tableGD: (hb.tableGD || []).map(lineProj),
    bundleParents: (hb.bundleParents || []).map(lineProj),
    original: flat(stored.table_gd).map((r) => ({ id: r.id, so_line_item_id: r.so_line_item_id, gd_qty: r.gd_qty })),
    items: R.itemFlags,
    splitPolicy: H("node:code_picking_defaults.data.splitPolicy") || "ALLOW_SPLIT",
    soIds: Array.isArray(stored.so_id) ? stored.so_id.map(String) : [],
    saveAs: "Cancelled",
  };

  // GD (update_node_elLmtlLm's columns): only what differs from the stored GD; "" and null are the same nothing
  const empty = (v) => v === undefined || v === null || v === "";
  const same = (a, b) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
  const after = gcAfterImage(stored, out.write, GC_KINDS);
  const header = {};
  for (const c of Object.keys(out.write.header)) {
    if (c === "delivery_cost" && empty(after[c])) continue;
    if (GC_KINDS.header[c] && !same(after[c], stored[c])) header[c] = empty(after[c]) ? null : after[c];
  }
  header.gd_status = "Cancelled";
  header.delivery_no = newNo;
  const storedLines = {};
  for (const r of flat(stored.table_gd)) storedLines[r.id] = r;
  const lines = [];
  for (const r of flat(after.table_gd)) {
    const o = storedLines[r.id] || {};
    const patch = {};
    for (const c of new Set(Object.keys(r).concat(Object.keys(o)))) {
      if (c === "children" || c === "id" || !GC_KINDS.line[c]) continue;
      if (!same(r[c], o[c])) patch[c] = empty(r[c]) ? null : r[c];
    }
    if (Object.keys(patch).length) lines.push(Object.assign({ id: r.id }, patch));
  }
  if (flat(after.table_gd).length !== flat(stored.table_gd).length) return fail("GDX_LINES_CHANGED", "the cancel would add or drop lines");
  const outside = [];
  for (const c of Object.keys(header)) if (GX_HEADER_COLS.indexOf(c) < 0) outside.push("header." + c);
  for (const l of lines) for (const c of Object.keys(l)) if (c !== "id" && GX_LINE_COLS.indexOf(c) < 0 && outside.indexOf("line." + c) < 0) outside.push("line." + c);
  if (outside.length) return fail("GDX_UNEXPECTED_PATCH", "the cancel would also change " + outside.join(", "));

  // PICK (X4P): what the GD list's bulk Cancel did client-side (CancelWorkflow.js), server-side. Only for a GD with a picking
  // status: on each Picking that names it (header gd_no) and is not Completed / Cancelled, its rows (bundle items included) go
  // Cancelled with nothing left to process; the header goes Cancelled + "-Cancelled" when every row then is Cancelled, and
  // Completed when nothing is left to pick (a shared Picking classic leaves open)
  const rows = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r && r.j);
  const grouped = (x) => {
    const g = {};
    for (const r of rows(x)) (g[r.k] = g[r.k] || []).push(gcParse(r.j));
    return g;
  };
  const pk = grouped(S.pick);
  const pickHeads = pk.H || [];
  const pickLines = pk.L || [];
  const pickRows = [];
  const pickHeaders = [];
  const pickBusy = [];
  const pickLeft = [];
  const terminal = (st) => st === "Completed" || st === "Cancelled";
  const named = (h) => (Array.isArray(h.gd_no) ? h.gd_no : []).map(String).indexOf(gdId) >= 0;
  if (num(stored.is_select_picking) !== 1 && s(stored.picking_status)) {
    for (const h of pickHeads) {
      if (!named(h)) continue;
      if (terminal(s(h.to_status))) {
        if (s(h.to_status) === "Completed") pickLeft.push(s(h.to_id) || s(h.id));
        continue;
      }
      if (fcBusy(h)) pickBusy.push(s(h.to_id) || s(h.id));
      const all = pickLines.filter((l) => s(l.picking_id) === s(h.id));
      for (const l of all) {
        if (s(l.gd_id) !== gdId) continue;
        if (s(l.line_status) === "Cancelled" && num(l.pending_process_qty) === 0) continue;
        pickRows.push({ id: s(l.id), picking_id: s(h.id), before: { line_status: s(l.line_status) || null, pending_process_qty: num(l.pending_process_qty) }, after: { line_status: "Cancelled", pending_process_qty: 0 } });
      }
      const statuses = all.map((l) => (s(l.gd_id) === gdId ? "Cancelled" : s(l.line_status)));
      const before = { to_status: s(h.to_status) || null, to_id: s(h.to_id) || null };
      if (statuses.length && statuses.every((st) => st === "Cancelled")) pickHeaders.push({ id: s(h.id), before: before, after: { to_status: "Cancelled", to_id: s(h.to_id) + "-Cancelled" } });
      else if (statuses.length && statuses.every((st) => terminal(st))) pickHeaders.push({ id: s(h.id), before: before, after: { to_status: "Completed", to_id: s(h.to_id) || null } });
    }
  }
  if (pickBusy.length) return fail("GDX_BUSY", "Picking " + pickBusy.join(", ") + " is being processed on a device right now. Try again in a moment.");

  // PACK (X4K): every open Packing of the GD is cancelled (a shared one: only this GD's lines); Completed ones are left as they are
  const pg = grouped(S.pack);
  const packHeads = pg.H || [];
  const packItems = pg.L || [];
  const packSources = pg.S || [];
  const packBoxes = pg.U || [];
  const packHeaders = [];
  const packLines = [];
  const packLeft = [];
  const packBusy = [];
  const cancelled = {};
  for (const h of packHeads) {
    const st = s(h.packing_status);
    if (st === "Cancelled") continue;
    if (st === "Completed") {
      packLeft.push(s(h.packing_no) || s(h.id));
      continue;
    }
    if (s(h.lock_session) && s(h.lock_live) === "1") packBusy.push(s(h.packing_no) + (s(h.lock_user) ? " (open on mobile by " + s(h.lock_user) + ")" : ""));
    const items = packItems.filter((l) => s(l.packing_id) === s(h.id));
    for (const l of items) {
      if (s(l.gd_id) !== gdId) continue;
      if (s(l.line_status) === "Cancelled" && num(l.remaining_qty) === 0) continue;
      packLines.push({ id: s(l.id), packing_id: s(h.id), before: { line_status: s(l.line_status) || null, remaining_qty: num(l.remaining_qty) }, after: { line_status: "Cancelled", remaining_qty: 0 } });
    }
    const whole = items.every((l) => s(l.gd_id) === gdId) && (s(h.gd_id) === gdId || s(h.gd_id) === "");
    if (whole) {
      cancelled[s(h.id)] = s(h.packing_no);
      packHeaders.push({ id: s(h.id), before: { packing_status: st || null, gd_status: s(h.gd_status) || null }, after: { packing_status: "Cancelled", gd_status: "Cancelled" } });
    }
  }
  if (packBusy.length) return fail("GDX_BUSY", "Packing " + packBusy.join(", ") + " is open right now. Try again once it is closed.");

  // HU (X4H): the boxes the cancelled open Packings generated are unloaded (REPACKING_PROCESS Unload, isPacking 1: records only,
  // from the box's own stored items; an empty box needs nothing), as the Packing form's Unpack (PackingOnUnpackHU) does; a
  // 'locked' box (picked upstream, real stock inside) keeps its stock and is only released from the Packing
  const bx = grouped(S.box);
  const huById = {};
  for (const h of bx.HU || []) huById[s(h.id)] = h;
  const itemsOf = {};
  for (const i of bx.HI || []) (itemsOf[s(i.handling_unit_id)] = itemsOf[s(i.handling_unit_id)] || []).push(i);
  const boxes = [];
  const released = [];
  const heldStock = [];
  for (const u of packBoxes) {
    const pid = s(u.packing_id);
    const hu = s(u.handling_unit_id);
    if (!ID.test(hu)) continue;
    if (!cancelled[pid]) {
      if ((itemsOf[hu] || []).length) heldStock.push(s(u.handling_no) || hu);
      continue;
    }
    if (s(u.hu_row_type) === "locked") {
      if (s((huById[hu] || {}).packing_id) === pid) released.push({ id: hu, before: { packing_id: pid }, after: { packing_id: "" } });
      continue;
    }
    if (s(u.hu_row_type) !== "generated") continue;
    const stock = itemsOf[hu] || [];
    if (!stock.length) continue;
    let td = [];
    try {
      td = JSON.parse(s(u.temp_data) || "[]");
    } catch (e) {
      td = [];
    }
    const nested = (Array.isArray(td) ? td : []).filter((e) => e && e.type === "nested_hu" && ID.test(s(e.nested_hu_id))).map((e) => s(e.nested_hu_id));
    boxes.push({
      row_id: s(u.id), packing_id: pid, hu_id: hu, handling_no: s(u.handling_no), nested: nested,
      sources: packSources.filter((r) => s(r.packing_id) === pid && nested.indexOf(s(r.handling_unit_id)) >= 0 && ["header", "item"].indexOf(s(r.row_type)) >= 0).map((r) => s(r.id)),
      request: {
        plant_id: P.plant, organization_id: P.org, process_type: "Unload", trx_no: cancelled[pid], parent_trx_no: newNo,
        items: stock.map((i) => ({ material_id: s(i.material_id), material_uom: s(i.material_uom), location_id: s(i.location_id), batch_id: s(i.batch_id) || null, balance_id: s(i.balance_id), quantity: num(i.quantity) })),
        source_hu: { id: hu, handling_no: s(u.handling_no), hu_material_id: s(u.hu_material_id), hu_type: s(u.hu_type), hu_quantity: num(u.hu_quantity) || 1, hu_uom: s(u.hu_uom),
          storage_location_id: s(u.storage_location_id), location_id: s(u.location_id), parent_hu_id: s(u.parent_hu_id), hu_status: "Created" },
        target_hu: null, target_storage_location_id: s(u.storage_location_id), target_location_id: s(u.location_id), remark: s(u.remark), transaction_type: "Packing", isPacking: 1,
      },
    });
  }
  if (boxes.length > GX_MAX_BOXES) return fail("GDX_TOO_LARGE", "This delivery's open Packing has " + boxes.length + " packed boxes; a cancel unpacks at most " + GX_MAX_BOXES + ". Unpack some boxes in the Packing first.");

  // NUM (X6): the cancelled number everywhere the old one is copied, whatever the status (user, 10-20)
  const numParts = { old_no: oldNo, new_no: newNo, picking_headers: [], picking_rows: [], packing_headers: [], packing_items: [], packing_sources: [] };
  for (const h of pickHeads) {
    if (!named(h)) continue;
    const t = gxRenumber(h.delivery_no, oldNo, newNo);
    if (t !== null) numParts.picking_headers.push({ id: s(h.id), before: s(h.delivery_no), after: t });
  }
  for (const l of pickLines) if (s(l.gd_id) === gdId && s(l.gd_no) === oldNo) numParts.picking_rows.push({ id: s(l.id), before: oldNo, after: newNo });
  for (const h of packHeads) if (s(h.gd_id) === gdId && s(h.gd_no) === oldNo) numParts.packing_headers.push({ id: s(h.id), before: oldNo, after: newNo });
  for (const l of packItems) if (s(l.gd_id) === gdId && s(l.gd_no) === oldNo) numParts.packing_items.push({ id: s(l.id), before: oldNo, after: newNo });
  for (const r of packSources) if (s(r.gd_id) === gdId && s(r.gd_no) === oldNo) numParts.packing_sources.push({ id: s(r.id), before: oldNo, after: newNo });

  // AFTER: Item last_transaction_date (code_node_62FzZA2e) and REORDER_SET_REDIS GD_CANCELLED (previous = the stored tree; kept only
  // when its code_node_f8qELJUF makes deltas)
  const reorderRow = (r) => {
    const x = pick(r, ["material_id", "temp_qty_data", "gd_qty", "base_qty"]);
    if (Array.isArray(r.children)) x.children = r.children.map(reorderRow);
    return x;
  };
  const previous = (stored.table_gd || []).map(reorderRow);
  const deltas = num(stored.is_select_picking) === 1 ? { data: [] } : __withContext({ "workflowparams:previous_data": previous, "workflowparams:document_type": "GD_CANCELLED", "system:tenantId": s(entry.tenantId) }, () => __run("code_node_f8qELJUF"));
  const dates = H("node:code_node_62FzZA2e.data") || {};

  const parts = {
    ENGINE: { operation_key: "GDX|" + jobId, movements: movements },
    RES: { updates: resUpdates, creates: resCreates },
    SO: so,
    GD: { header: header, lines: lines },
    PICK: { rows: pickRows, headers: pickHeaders },
    PACK: { headers: packHeaders, lines: packLines },
    HU: { boxes: boxes, released: released },
    NUM: numParts,
    AFTER: { item_dates: (dates.updates || []).map((u) => s(u.id)), reorder: (deltas.data || []).length ? { previous: previous, deltas: (deltas.data || []).length } : null },
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
      partRows.push({ job_id: jobId, organization_id: P.org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: text.slice(at, at + CHUNK) });
    }
    manifestParts[name] = names;
  }
  // what the cancel leaves in place, for the result (the user's decisions, 10-20)
  const notes = { pickings_completed: pickLeft, packings_completed: packLeft, packings_cancelled: Object.values(cancelled), boxes_unpacked: boxes.map((b) => b.handling_no || b.hu_id),
    boxes_with_stock_left: heldStock };
  const manifest = {
    v: 1, prepared_by: "GD_CANCEL_PREPARE", job_id: jobId, gd_id: gdId, gd_no: oldNo, new_no: newNo, organization_id: P.org, plant_id: P.plant,
    source: s(req.source), submitted_by: s(req.submitted_by), nonce: nonce, parts: manifestParts, notes: notes,
    counts: { lines: flat(stored.table_gd).length, movements: movements.length, reservation_updates: resUpdates.length, reservation_creates: resCreates.length,
      gd_line_patches: lines.length, so_lines: so.tableGD.length, picking_rows: pickRows.length, picking_headers: pickHeaders.length, packing_headers: packHeaders.length,
      packing_lines: packLines.length, boxes: boxes.length, boxes_released: released.length, renumbered: numParts.picking_headers.length + numParts.picking_rows.length +
      numParts.packing_headers.length + numParts.packing_items.length + numParts.packing_sources.length },
  };
  return Object.assign(base, {
    route: movements.length ? "ENGINE" : "READY", code: "200", message: "Planned " + movements.length + " movements for " + flat(stored.table_gd).length + " lines",
    operationKey: "GDX|" + jobId, movements: movements, payload: JSON.stringify(manifest), partRows: partRows,
    lineCount: flat(stored.table_gd).length, movementCount: movements.length,
  });
};
