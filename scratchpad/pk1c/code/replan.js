// Picking V2 1c - GD_REPLAN's planner: what GOODS_DELIVERY's "Save as Created" from PICKING (isPicking "Yes") does to
// one Created GD's stock and reservations, run in-process on GD Edit V2's lifted code (needs PLAN_MODS loaded first),
// without GD Edit V2's job, lock, Picking or payload parts (gePlan is not used: its params and lock are GD Edit V2's).
// Classic PICKING writes the moved lines (temp_qty_data / prev_temp_qty_data / view_stock / picking_status) before
// GOODS_DELIVERY re-reads the GD, so the chain sees that post-move image (get_node_xTRvHWB8 and the PkMerge re-read);
// the parts are taken against the GD as stored, i.e. what V2 still has to write.
// IN = { gdId, organizationId, tenantId, isLoadingBay (0 | 1), lines: [{ id, cells }] }; R = geAdapt(S); K = GE_KINDS
const grPlan = function grPlan(IN, R, K) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const out = { route: "STOP", code: "", message: "", gd_id: s(IN.gdId), gd_no: "", movements: [], res_updates: [], res_creates: [], gdl_patches: [], gdl_inserts: 0,
    gdl_deletes: 0, gdh_cells: {}, reorder: [], line_count: 0 };
  const stop = (route, code, message) => Object.assign(out, { route: route, code: code, message: message });
  try {
    const stored = R.stored;
    if (!stored || !s(stored.id)) return stop("STOP", "GR_GD_NOT_FOUND", "Goods Delivery " + s(IN.gdId) + " not found");
    out.gd_no = s(stored.delivery_no);
    out.line_count = (stored.table_gd || []).reduce((k, r) => k + 1 + (r.children || []).length, 0);
    if (s(stored.gd_status) !== "Created") return stop("STOP", "GR_NOT_CREATED", "Goods Delivery " + out.gd_no + " is " + s(stored.gd_status) + ": only a Created delivery is re-planned");
    if ((R.serialItems || []).length) return stop("NOT_ELIGIBLE", "GR_SERIAL", "Goods Delivery " + out.gd_no + " has serial-numbered items: the classic save handles them");
    if (s(stored.is_select_picking) === "1") return stop("NOT_ELIGIBLE", "GR_SELECT_PICKING", "Goods Delivery " + out.gd_no + " uses select picking: the classic save handles it");
    const known = {};
    for (const r of stored.table_gd || []) { known[s(r.id)] = 1; for (const c of r.children || []) known[s(c.id)] = 1; }
    for (const l of IN.lines || []) if (!known[s(l.id)]) return stop("STOP", "GR_LINE_NOT_FOUND", "line " + s(l.id) + " is not on Goods Delivery " + out.gd_no);

    const layout = (stored.table_gd || []).map((r) => ({ ref: s(r.id), children: (r.children || []).map((c) => s(c.id)) }));
    const delta = { header: {}, dropHeader: [], lines: (IN.lines || []).map((l) => ({ id: s(l.id), cells: l.cells || {}, drop: [] })), added: [], removed: [], layout: layout };
    const allData = geApplyDelta(stored, delta, K);
    allData.gd_status = stored.gd_status;
    const post = clone(allData);
    const params = { allData: allData, saveAs: "Created", pageStatus: "Edit", needCL: "auto", isPicking: "Yes", isLoadingBay: Number(IN.isLoadingBay) === 1 ? 1 : 0 };
    const reads = Object.assign({}, R, { gd: { count: 1, data: post }, pick: { count: 0, data: {} } });
    const extraReads = Object.assign({}, R.extraReads || {}, { get_node_PkMergeGd: { count: 1, data: post } });
    const ch = geChain({ params: params, reads: reads, stored: stored, tenantId: s(IN.tenantId), uuid: "GDR" + s(IN.gdId), kinds: K,
      mint: { line: geLinePh, number: GE_NUMBER_PH }, extraReads: extraReads, calleeExtraReads: R.calleeExtraReads });
    if (ch.route !== "PLANNED") return stop(ch.route === "NOT_ELIGIBLE" ? "NOT_ELIGIBLE" : "STOP", "GR_" + s(ch.code || ch.route), s(ch.message) || ch.route);
    if (!ch.afterImage) return stop("STOP", "GR_NO_AFTER_IMAGE", "the GD write could not be emulated");
    if ((ch.minted.lines || []).length || ch.minted.number) return stop("STOP", "GR_MINTED", "the re-save would add lines or number the delivery");
    const H = (key) => __withContext(ch.ctx.head, () => __v(key));

    // ENGINE: condition_or_node_zvMyWcqT's mapping (as gePlan), the GD as written (Pgtw6zFL.gdData)
    const gdd = H("node:code_node_Pgtw6zFL.data.gdData") || {};
    const Pm = { plant: s(gdd.plant_id), org: s(gdd.organization_id), no: s(gdd.delivery_no), date: s(gdd.delivery_date) };
    const exec = ch.unused.exec || {};
    (exec.inventoryMovements || []).forEach((m, i) => {
      const common = { plant_id: Pm.plant, organization_id: Pm.org, material_id: s(m.material_id), quantity: m.quantity, material_uom: m.material_uom || null, transaction_type: "GDL",
        trx_no: Pm.no, parent_trx_no: m.line_so_no || null, location_id: s(m.bin_location), batch_id: m.batch_id || null, doc_date: Pm.date, handling_unit_id: m.handling_unit_id || "" };
      const k = "M" + (i + 1);
      const t = s(m.movement_type);
      if (t === "DELIVERY") out.movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: m.source || null, isMovingInv: 0 }));
      else if (t === "UNRESTRICTED_TO_RESERVED") {
        out.movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: "Unrestricted", isMovingInv: 1 }));
        out.movements.push(Object.assign({}, common, { movement_key: k + ".2", direction: "ADD", inventory_category: "Reserved", isMovingInv: 1, unit_price_from: k }));
      } else if (t === "RESERVED_SUBTRACT_CROSS_BIN") out.movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }));
      else if (t === "RESERVED_ADD_CROSS_BIN") out.movements.push(Object.assign({}, common, { movement_key: k, direction: "ADD", inventory_category: "Reserved", isMovingInv: 1 }));
      else {
        out.movements.push(Object.assign({}, common, { movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }));
        out.movements.push(Object.assign({}, common, { movement_key: k + ".2", direction: "ADD", inventory_category: "Unrestricted", isMovingInv: 1, unit_price_from: k }));
      }
    });

    // RES: the planner's records as update_node_7k2yYMLH / add_node_ojy0rTgC write them (an omitted key is written NULL)
    const readRes = {};
    for (const r of ((R.allocated || {}).data || []).concat((R.pending || {}).data || [])) readRes[s(r.id)] = r;
    const pickCols = (o) => { const x = {}; for (const c of GE_RES_COLS) x[c] = o[c] === undefined ? null : o[c]; return x; };
    out.res_updates = (exec.reservedRecordUpdates || []).map((u) => ({ id: s(u.id), before: pickCols(readRes[s(u.id)] || {}), after: pickCols(u) }));
    for (const u of out.res_updates) if (!readRes[u.id]) return stop("STOP", "GR_RES_UNREAD", "the planner updates reservation " + u.id + ", which was not read");
    out.res_creates = (exec.reservedRecordCreates || []).map((c) => Object.assign({}, c, { reserved_date: Pm.date, plant_id: Pm.plant, organization_id: Pm.org }));

    // GDL / GDH: the write as the read-back shows it, against the GD as stored
    const gp = geGdParts(stored, ch.afterImage, K);
    out.gdl_patches = gp.GDL.patches;
    out.gdl_inserts = gp.GDL.inserts.length;
    out.gdl_deletes = gp.GDL.deletes.length;
    out.gdh_cells = gp.GDH.cells;
    out.reorder = ch.reorder ? ch.reorder.data || [] : [];
    return Object.assign(out, { route: "PLANNED", code: "200", message: "Planned " + out.movements.length + " movements, " + out.res_updates.length + " reservation updates, "
      + out.res_creates.length + " creates for " + out.gd_no });
  } catch (e) {
    return stop("STOP", "GR_EXCEPTION", s(e && e.message ? e.message : e));
  }
};
