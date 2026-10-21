// GD_REVERT_PREPARE - Plan: the GD as it stood before SUBMIT locked it (Completed), GD_REVERT_COMPLETED + GD_PROCESS_REVERT on the
// lifted bodies (chain.js), the engine movements (the classic ADD to Reserved at the delivery cost, merged per balance and price) and
// the prepared payload COMMIT works from: per step the rows it writes with their before / after values (the classic update nodes'
// columns). Ends FAIL (job FAILED, GD back to Completed) or ENGINE (INVENTORY_BULK_APPLY PLAN next).
const GR_MAX_MOVEMENTS = 5000;
const GR_GROUPS = {
  res: ["status", "reserved_qty", "open_qty", "delivered_qty", "doc_type", "doc_id", "doc_no", "doc_line_id", "target_gd_id"],
  frag: ["is_deleted", "status", "open_qty"],
  pend: ["reserved_qty", "open_qty"],
  sol: ["planned_qty", "delivered_qty", "outstanding_quantity", "line_status"],
  soh: ["so_status", "gd_status", "partially_delivered", "fully_delivered"],
  gdl: ["picking_status"],
  snap: ["snapshot_status"],
  gdh: ["gd_status", "picking_status"],
};

const grPlan = function grPlan(entry, S) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const ID = /^[0-9]{1,20}$/;
  const base = { route: "FAIL", code: "", message: "", operationKey: "", organizationId: s(entry.organizationId), movements: [], payload: "", partRows: [], lineCount: 0,
    movementCount: 0, gdId: s(entry.gdId), unlockOk: 0 };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const R = grReads(S);
  if (!R.gd.count) return fail("GDR_GD_NOT_FOUND", "Goods Delivery " + s(entry.gdId) + " not found");
  const stored = R.gd.data;
  const lock = (Array.isArray(S.lock) ? S.lock : S.lock ? [S.lock] : [])[0] || {};
  const mine = s(lock.result_ref) !== "" && s(lock.result_ref) === s(entry.idempotencyKey);
  if (s(stored.gd_status) !== "Processing" || !mine) return fail("GDR_NOT_LOCKED", "Goods Delivery is " + s(stored.gd_status) + (mine ? "" : ", locked by another submit") + ": not Processing under this job");
  base.unlockOk = 1;
  // the classic revert reads the GD before any write: Completed (SUBMIT only set the lock)
  const lockedStatus = s(stored.gd_status);
  stored.gd_status = "Completed";
  const gdId = s(stored.id);
  const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const lines = flat(stored.table_gd);
  // what the background revert does not take goes to the classic revert (its own 500-line cap applies)
  if (R.items.some((i) => Number(i.serial_number_management) === 1)) return fail("GDR_NOT_ELIGIBLE", "serial-numbered items are reverted by the classic revert");
  if (Number(stored.is_select_picking) === 1) return fail("GDR_NOT_ELIGIBLE", "a delivery made from a Picking is reverted by the classic revert");
  const huLine = lines.some((l) => {
    let t = l.temp_qty_data;
    try { t = typeof t === "string" ? JSON.parse(t) : t; } catch (e) { t = []; }
    return (Array.isArray(t) ? t : []).some((a) => a && s(a.handling_unit_id));
  });
  if (huLine) return fail("GDR_NOT_ELIGIBLE", "stock delivered from a handling unit is reverted by the classic revert");

  const out = grChain(stored, R, "all");
  if (out.route === "STOP") {
    const c = (out.conflicts || []).map((x) => (typeof x === "string" ? x : s(x.message || x.reason || JSON.stringify(x)))).slice(0, 5);
    return fail(out.code, out.message + (c.length ? " " + c.join("; ") : ""));
  }
  const ex = out.extract || {};
  const b = out.batch || {};
  const so = out.so || {};
  const ps = out.pickStatus || {};
  if ((b.huUpdates || []).length) return fail("GDR_NOT_ELIGIBLE", "stock delivered from a handling unit is reverted by the classic revert");
  // Picking Plan records are only in Picking Plan deliveries' snapshots (dev + prod, 10-21)
  if ((b.pickingRecUpdates || []).length || (b.pickingHdrUpdates || []).length) return fail("GDR_NOT_ELIGIBLE", "a delivery made from a Picking Plan is reverted by the classic revert");
  const P = { plant: s(stored.plant_id), org: s(stored.organization_id), no: s(ex.gdNo), type: s(ex.transactionType) || "GDL-R", date: s(ex.docDate) };

  // ENGINE: GD_PROCESS_REVERT's ADD_INVENTORY_NEW calls (one per reservation, one per balance delivered without one), merged per
  // category, balance, unit, price and order
  const merged = new Map();
  for (const m of b.inventoryMovements || []) {
    if (s(m.handling_unit_id)) return fail("GDR_NOT_ELIGIBLE", "stock delivered from a handling unit is reverted by the classic revert");
    const k = [s(m.inventory_category), s(m.material_id), s(m.material_uom), s(m.location_id), s(m.batch_id), String(q8(m.unit_price)), s(m.parent_no)].join("|");
    const x = merged.get(k);
    if (x) x.quantity = q8(x.quantity + q8(m.quantity));
    else merged.set(k, Object.assign({}, m, { quantity: q8(m.quantity) }));
  }
  const movements = [];
  for (const m of merged.values()) {
    if (!(m.quantity > 0)) continue;
    if (!ID.test(s(m.material_id)) || !ID.test(s(m.location_id))) return fail("GDR_INVALID_DATA", "a returned line has no item or bin: " + s(m.material_id) + " / " + s(m.location_id));
    movements.push({ movement_key: "R" + (movements.length + 1), direction: "ADD", inventory_category: s(m.inventory_category) || "Reserved", isMovingInv: 0, plant_id: P.plant, organization_id: P.org,
      material_id: s(m.material_id), location_id: s(m.location_id), batch_id: ID.test(s(m.batch_id)) ? s(m.batch_id) : null, quantity: m.quantity, material_uom: s(m.material_uom) || null,
      unit_price: q8(m.unit_price), transaction_type: P.type, trx_no: P.no, parent_trx_no: s(m.parent_no) || null, doc_date: P.date, handling_unit_id: null });
  }
  if (movements.length > GR_MAX_MOVEMENTS) return fail("GDR_TOO_LARGE", movements.length + " stock movements: at most " + GR_MAX_MOVEMENTS + " per revert");
  // a stock item delivered but given nothing back (e.g. from a handling unit with no reservation) is refused rather than
  // reverted on its statuses alone
  const stockItem = Object.fromEntries((R.items || []).filter((i) => Number(i.stock_control) === 1).map((i) => [s(i.id), i]));
  const moved = new Set(movements.map((mv) => mv.material_id));
  const unreturned = Array.from(new Set((ex.tableData || []).filter((l) => stockItem[s(l.material_id)] && q8(l.gd_qty) > 0 && !moved.has(s(l.material_id)))
    .map((l) => s(stockItem[s(l.material_id)].material_code) || s(l.material_id))));
  if (unreturned.length) return fail("GDR_STOCK_NOT_RETURNABLE", "Goods Delivery " + s(ex.gdNo) + " was completed without reserved stock for " + unreturned.slice(0, 5).join(", ") +
    (unreturned.length > 5 ? " and " + (unreturned.length - 5) + " more" : "") + ": a revert would not put that stock back. Please contact support.");

  // per step: the rows it writes, each with the columns as read now (before) and as the classic revert leaves them (after)
  const byId = (rows) => Object.fromEntries((rows || []).map((r) => [s(r.id), r]));
  const resv = byId(R.resv.concat(R.pend));
  const pick = (o, cols) => Object.fromEntries(cols.map((c) => [c, o && o[c] !== undefined ? o[c] : null]));
  const missing = [];
  const rowsOf = (group, updates, now, afterOf) => (updates || []).map((u) => {
    const cur = now[s(u.id)];
    if (!cur) missing.push(group + " " + s(u.id));
    return { id: s(u.id), before: pick(cur, GR_GROUPS[group]), after: pick(afterOf ? afterOf(u) : u, GR_GROUPS[group]) };
  });
  const G = {
    res: rowsOf("res", b.reservedUpdates, resv),
    frag: rowsOf("frag", b.fragmentSoftDeletes, resv),
    pend: rowsOf("pend", b.pendingRestores, resv),
    sol: rowsOf("sol", so.soLineUpdates, byId(R.sol)),
    soh: rowsOf("soh", so.soHeaderUpdates, byId(R.soh)),
    gdl: rowsOf("gdl", String(ps.hasLineUpdates) === "1" ? ps.lineUpdates : [], byId(lines)),
    snap: [{ id: s(out.snapshotId), before: { snapshot_status: "Active" }, after: { snapshot_status: "Reverted" } }],
    gdh: [{ id: gdId, before: { gd_status: lockedStatus, picking_status: stored.picking_status === undefined ? null : stored.picking_status },
      after: { gd_status: "Created", picking_status: String(ps.hasHeaderUpdate) === "1" ? ps.headerPickingStatus : (stored.picking_status === undefined ? null : stored.picking_status) } }],
  };
  if (missing.length) return fail("GDR_INVALID_DATA", "row(s) the revert writes were not found: " + missing.slice(0, 3).join(", "));

  const soQty = (rows) => (rows || []).map((r) => ({ so_line_item_id: r.so_line_item_id === undefined ? null : r.so_line_item_id, gd_qty: r.gd_qty === undefined ? null : r.gd_qty }));
  const parts = {
    ENGINE: { operation_key: "GDR|" + s(entry.jobId), movements: movements },
    RES: { res: G.res, frag: G.frag, pend: G.pend },
    // R3 recomputes the sales orders on fresh rows (code_node_hrComputeSoUpdates reads so_line_item_id and gd_qty only)
    SO: { lines: soQty(ex.tableData), bundles: soQty(ex.bundleParentLines), sol: G.sol, soh: G.soh },
    GD: { gdl: G.gdl, snap: G.snap, gdh: G.gdh },
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
      partRows.push({ job_id: s(entry.jobId), organization_id: P.org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: text.slice(at, at + CHUNK) });
    }
    manifestParts[name] = names;
  }
  const counts = { lines: lines.length, movements: movements.length };
  for (const k of Object.keys(G)) counts[k] = G[k].length;
  const manifest = { v: 1, prepared_by: "GD_REVERT_PREPARE", job_id: s(entry.jobId), gd_id: gdId, gd_no: P.no, organization_id: P.org, plant_id: P.plant,
    snapshot_id: s(out.snapshotId), source: s((entry.request || {}).source), nonce: nonce, parts: manifestParts, counts: counts };
  return Object.assign(base, {
    route: movements.length ? "ENGINE" : "READY", code: "200", message: "Planned " + movements.length + " movements for " + lines.length + " lines",
    operationKey: "GDR|" + s(entry.jobId), movements: movements, payload: JSON.stringify(manifest), partRows: partRows, lineCount: lines.length, movementCount: movements.length,
  });
};
