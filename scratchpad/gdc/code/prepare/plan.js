// GD_COMPLETE_PREPARE - Plan: the GD as it stood before SUBMIT locked it (gd_status Created), GOODS_DELIVERY's Completed
// path + GD_UNUSED_FN_NEW's planner on the lifted bodies (chain.js), the engine movements, and the prepared payload COMMIT
// works from. Ends FAIL (job FAILED, GD back to Created) or ENGINE (INVENTORY_BULK_APPLY PLAN next).
const GC_HEADER_COLS = ["gd_status", "gd_total", "picking_status", "so_id", "so_no"];
const GC_LINE_COLS = ["prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
  "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight"];
// a Force Complete's fill-back also stamps every line's picking_status (and a descriptive line's packing_status) Completed
const GC_FORCE_LINE_COLS = ["picking_status", "packing_status"];
const gcPlan = function gcPlan(entry, S) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v || 0);
  const base = { route: "FAIL", code: "", message: "", operationKey: "", organizationId: s(entry.organizationId), movements: [], payload: "", partRows: [], lineCount: 0, movementCount: 0, gdId: s(entry.gdId), unlockOk: 0 };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const req = entry.request || {};
  const answers = req.answers || {};
  const forced = s(answers.isForceComplete) === "Yes";
  const lineCols = forced ? GC_LINE_COLS.concat(GC_FORCE_LINE_COLS) : GC_LINE_COLS;

  const R = gcAdapt(S);
  if (!R.gd.count) return fail("GDC_GD_NOT_FOUND", "Goods Delivery " + s(entry.gdId) + " not found");
  const stored = R.gd.data;
  // the engine has no serial-number handling (SUBTRACT/ADD semantics only): such a GD stays on the old path
  if ((R.serialItems || []).length) return fail("GDC_NOT_ELIGIBLE", "serial-numbered items are completed by the classic save");
  const lock = (Array.isArray(S.lock) ? S.lock : S.lock ? [S.lock] : [])[0] || {};
  const mine = s(lock.result_ref) !== "" && s(lock.result_ref) === s(entry.idempotencyKey);
  if (s(stored.gd_status) !== "Processing" || !mine) return fail("GDC_NOT_LOCKED", "Goods Delivery is " + s(stored.gd_status) + (mine ? "" : ", locked by another submit") + ": not Processing under this job");
  // a failure from here on puts the GD back to Created (this job holds its lock)
  base.unlockOk = 1;
  // the old path reads the GD before any write: Created (SUBMIT only set the lock)
  stored.gd_status = "Created";
  const params = gcParams(stored, answers, req.source, req.line_overrides);
  for (const [k, v] of Object.entries(req.header || {})) params.allData[k] = v;

  const out = gcChain({ params: params, reads: R, tenantId: s(entry.tenantId), uuid: "GDC" + s(entry.jobId), kinds: GC_KINDS });
  if (out.route !== "PLANNED") return fail(out.route === "NOT_ELIGIBLE" ? "GDC_NOT_ELIGIBLE" : "GDC_" + out.code, out.message || out.route);

  const exec = out.unused.exec;
  // GD_UNUSED_FN_NEW's Branch 4 stamps the Picking records and headers of the lines it is linked to (line_to_id /
  // picking_record_id): only Picking Plan deliveries are (dev + prod), and those stay on the classic save
  const pickOut = out.unused.pick || {};
  const ob = __withContext(out.ctx.callee, () => __v("node:code_node_OBz5tEws.data")) || {};
  if ((ob.pickingRecordUpdates || []).length || (pickOut.recordUpdates || []).length || (pickOut.headerUpdates || []).length) {
    return fail("GDC_NOT_ELIGIBLE", "it is linked to a Picking: the classic save updates the Picking");
  }
  const P = { plant: s(stored.plant_id), org: s(stored.organization_id), no: s(stored.delivery_no), date: s(stored.delivery_date) };
  // condition_or_node_zvMyWcqT: DELIVERY = one SUBTRACT; the pairs = SUBTRACT then ADD priced (and dated) from it
  const movements = [];
  (exec.inventoryMovements || []).forEach((m, i) => {
    const common = {
      plant_id: P.plant, organization_id: P.org, material_id: s(m.material_id), quantity: m.quantity, material_uom: m.material_uom || null,
      transaction_type: "GDL", trx_no: P.no, parent_trx_no: m.line_so_no || null, location_id: s(m.bin_location), batch_id: m.batch_id || null,
      doc_date: P.date, handling_unit_id: m.handling_unit_id || "",
    };
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

  // reservations: the planner's absolute targets, each with the row as read (C3 writes only a row still equal to it)
  const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
  const readRes = {};
  for (const r of R.allocated.data.concat(R.pending.data)) readRes[r.id] = r;
  const pick = (o, cols) => { const x = {}; for (const c of cols) x[c] = o[c] === undefined ? null : o[c]; return x; };
  const resUpdates = (exec.reservedRecordUpdates || []).map((u) => ({ id: s(u.id), before: pick(readRes[s(u.id)] || {}, RES_COLS), after: pick(u, RES_COLS) }));
  // never seen in the recorded runs: the planner always carries every column a row had; refuse rather than guess
  for (const u of resUpdates) for (const c of RES_COLS) if (u.after[c] === null && u.before[c] !== null && u.before[c] !== "") return fail("GDC_RES_BLANK", "reservation " + u.id + " would lose " + c);
  const jobId = s(entry.jobId);
  const resCreates = (exec.reservedRecordCreates || []).map((c, i) => Object.assign({}, c, { job_line_key: jobId + "|C|" + (i + 1), reserved_date: P.date, plant_id: P.plant, organization_id: P.org }));

  // SO lines and headers are recomputed at C4 from a fresh read: what QtyCheckBatch and lwB2FVe0 need besides it
  const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const lineProj = (r) => ({ id: r.id, material_id: r.material_id, material_name: r.material_name, gd_material_desc: r.gd_material_desc, so_line_item_id: r.so_line_item_id, gd_qty: r.gd_qty, gd_order_quantity: r.gd_order_quantity, gd_order_uom_id: r.gd_order_uom_id, item_bundle_id: r.item_bundle_id });
  const H = (key) => __withContext(out.ctx.head, () => __v(key));
  const C = (key) => __withContext(out.ctx.callee, () => __v(key));
  const hb = H("node:code_node_hb8ZWe9c.data") || {};
  const so = {
    tableGD: (hb.tableGD || []).map(lineProj),
    bundleParents: (hb.bundleParents || []).map(lineProj),
    original: flat(stored.table_gd).map((r) => ({ id: r.id, so_line_item_id: r.so_line_item_id, gd_qty: r.gd_qty })),
    items: R.itemFlags,
    splitPolicy: H("node:code_picking_defaults.data.splitPolicy") || "ALLOW_SPLIT",
    soIds: Array.isArray(stored.so_id) ? stored.so_id.map(String) : [],
  };

  // GD write (update_node_elLmtlLm's columns): only what differs from the stored GD; "" and null are the same nothing
  const empty = (v) => v === undefined || v === null || v === "";
  const same = (a, b) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
  const after = gcAfterImage(stored, out.write, GC_KINDS);
  const header = {};
  for (const c of Object.keys(out.write.header)) {
    // delivery_cost <- driver_cost (deployed mapping): the form never sends driver_cost, so the old path blanks a column
    // that is only ever 0.00 / NULL (dev + prod); V2 writes it only when a value is sent
    if (c === "delivery_cost" && empty(after[c])) continue;
    if (GC_KINDS.header[c] && !same(after[c], stored[c])) header[c] = empty(after[c]) ? null : after[c];
  }
  header.gd_status = "Completed";
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
  if (flat(after.table_gd).length !== flat(stored.table_gd).length) return fail("GDC_LINES_CHANGED", "the write would add or drop lines");
  // C5 writes exactly these columns (the fill-back's header stamps on each line, code_node_GKc0ALEe's computed columns);
  // anything else would be a code path this port has not seen
  const outside = [];
  for (const c of Object.keys(header)) if (GC_HEADER_COLS.indexOf(c) < 0) outside.push("header." + c);
  for (const l of lines) for (const c of Object.keys(l)) if (c !== "id" && lineCols.indexOf(c) < 0 && outside.indexOf("line." + c) < 0) outside.push("line." + c);
  if (outside.length) return fail("GDC_UNEXPECTED_PATCH", "the completion would also change " + outside.join(", "));

  // GD_COMPLETION_SNAPSHOT reads only these fields of allData (code_node_zRrqNcLM, code_node_RxN5tWmA)
  const gdd = H("node:code_node_Pgtw6zFL.data.gdData") || {};
  const snapRow = (r) => {
    const x = pick(r, ["id", "material_id", "item_bundle_id", "so_line_item_id", "line_so_id", "line_to_id", "line_pp_id", "pp_line_item_id", "temp_qty_data"]);
    if (Array.isArray(r.children)) x.children = r.children.map(snapRow);
    return x;
  };
  const snapshot = { id: s(gdd.id), delivery_no: s(gdd.delivery_no), organization_id: s(gdd.organization_id), plant_id: s(gdd.plant_id), update_user: s(req.submitted_by) || s(gdd.update_user), gd_created_by: s(gdd.gd_created_by), table_gd: (gdd.table_gd || []).map(snapRow) };

  const reorderRow = (r) => {
    const x = pick(r, ["material_id", "temp_qty_data", "gd_qty", "base_qty"]);
    if (Array.isArray(r.children)) x.children = r.children.map(reorderRow);
    return x;
  };
  // REORDER_SET_REDIS GD_COMPLETED gets previous = the stored tree (get_node_xTRvHWB8), latest = code_node_hb8ZWe9c's flat
  // lines; its code_node_f8qELJUF only appends deltas, so the call is kept (with its inputs) only when there are some
  const reorderIn = { previous: (stored.table_gd || []).map(reorderRow), latest: (hb.tableGD || []).map(reorderRow) };
  const deltas = __withContext({ "workflowparams:previous_data": reorderIn.previous, "workflowparams:latest_data": reorderIn.latest,
    "workflowparams:document_type": "GD_COMPLETED", "system:tenantId": s(entry.tenantId) }, () => __run("code_node_f8qELJUF"));
  const reorder = (deltas.data || []).length ? Object.assign(reorderIn, { deltas: (deltas.data || []).length }) : null;
  const dates = H("node:code_node_62FzZA2e.data") || {};
  // the payload goes to gd_publish_step as one part per COMMIT step (each step reads only its own), chunked, under this run's
  // nonce so a re-run never meets an earlier run's rows; the job keeps a manifest
  const parts = {
    ENGINE: { operation_key: "GDC|" + jobId, movements: movements },
    RES: { updates: resUpdates, creates: resCreates },
    SO: so,
    PICK: { stamps: ob.pickingRecordUpdates || [], pickingIds: ob.pickingIds || [], planned: { records: pickOut.recordUpdates || [], headers: pickOut.headerUpdates || [] } },
    HU: exec.huUpdates || [],
    GD: { header: header, lines: lines },
    SNAP: snapshot,
    AFTER: { item_dates: (dates.updates || []).map((u) => s(u.id)), reorder: reorder, auto_si: num(H("node:code_si_gate.data.doAutoSi")) === 1 ? 1 : 0 },
  };
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const CHUNK = 400000;
  const partRows = [];
  const manifestParts = {};
  for (const [name, value] of Object.entries(parts)) {
    const text = JSON.stringify(value);
    const names = [];
    for (let at = 0, n = 1; at < text.length || n === 1; at += CHUNK, n++) {
      const step = "P|" + nonce + "|" + name + "|" + String(n).padStart(3, "0");
      names.push(step);
      partRows.push({ job_id: jobId, organization_id: P.org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: text.slice(at, at + CHUNK) });
    }
    manifestParts[name] = names;
  }
  // Force Complete: COMMIT closes the GD's Picking rows (C4P) and, at C0, re-reads this line fingerprint (taken before the reads): a
  // pick confirmation that passed its GD check just before SUBMIT may have written the lines after PREPARE read them
  const fp = (Array.isArray(S.fp) ? S.fp : S.fp ? [S.fp] : [])[0] || {};
  if (forced && (s(fp.n) === "" || s(fp.fp) === "")) return fail("GDC_INVALID_DATA", "the delivery lines' fingerprint could not be read");
  const manifest = {
    v: 1, prepared_by: "GD_COMPLETE_PREPARE", job_id: jobId, gd_id: s(stored.id), gd_no: P.no, organization_id: P.org, plant_id: P.plant,
    source: s(req.source), submitted_by: s(req.submitted_by), nonce: nonce, parts: manifestParts,
    force: forced ? 1 : 0, fp: forced ? { n: s(fp.n), sum: s(fp.fp) } : null,
    counts: { lines: flat(stored.table_gd).length, movements: movements.length, reservation_updates: resUpdates.length, reservation_creates: resCreates.length,
      gd_line_patches: lines.length, so_lines: so.tableGD.length, hu: (exec.huUpdates || []).length, picking_stamps: (ob.pickingRecordUpdates || []).length },
  };
  return Object.assign(base, {
    route: "ENGINE", code: "200", message: "Planned " + movements.length + " movements for " + flat(stored.table_gd).length + " lines",
    operationKey: "GDC|" + jobId, movements: movements, payload: JSON.stringify(manifest), partRows: partRows,
    lineCount: flat(stored.table_gd).length, movementCount: movements.length,
  });
};
