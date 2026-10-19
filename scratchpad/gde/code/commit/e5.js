// GD_EDIT_COMMIT - E5 PICKING (if_9xhwui06 and code_pick_hdr_sync, after the GD's own writes):
//  UPDATE: the Picking still at the version this job locked -> the arrays code_node_6L2Ozea8 built, rebuilt from it (part
//          PICK's diff), written with the header (update_node_4uzHPx7M's columns); an intent row first records the target's
//          signature (row contents, order-free: new rows get ids, reads come back in id order), so a re-run that finds the
//          version moved can tell "our write landed" (signature equal -> done) from "someone else's" (review)
//  CREATE: the outbox consumer's guard: a STARTED row before the add; a re-run reads the Pickings naming the GD: one live
//          -> adopted; none -> added again; more -> review
//  the header sync (code_pick_hdr_sync) and the GD line stamps (update_node_StampGDLines: picking_status "Created" on
//  this GD's plan lines still Not Created / Cancelled / empty)
// the columns that say what the producer meant: an item row's line, item, batch, bin, HU, quantities and status; a record's
// own id and the two quantities an unwind changes (the platform fills other columns with its defaults on write)
const GE_SIG_ITEM = ["gd_id", "gd_line_id", "item_code", "batch_no", "source_bin", "handling_unit_id", "qty_to_pick", "pending_process_qty", "line_status", "row_type"];
const GE_SIG_REC = ["id", "gd_line_id", "item_code", "store_out_qty", "picked_qty_alt"];
const geCanon = function geCanon(row, cols) {
  const o = {};
  for (const k of cols) {
    let v = row[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(v) && v.replace(/\.0+$/, "").length < 16) v = q8(v);
    else if (typeof v === "number") v = q8(v);
    o[k] = typeof v === "number" ? v : String(v);
  }
  return JSON.stringify(o);
};
// a row array's signature: its rows' canonical contents (children flattened), order-free
const geSig = function geSig(rows, cols) {
  const flat = list(rows).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const all = flat.map((r) => geCanon(r, cols)).sort();
  let h = 2166136261;
  const text = all.join("\n");
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return all.length + ":" + h.toString(16);
};
const geObj = (rows) => list(rows).map((r) => (typeof r.j === "string" ? gcStrip(parseJ(r.j)) : r)).filter((x) => x && x.id !== undefined);
// the placeholders PREPARE minted in the Picking and the stamps (a new line's id: E2 inserted it under job_line_key; a
// Draft's number: E0N issued it), resolved before anything is written; one still unresolved -> review
const geE5Resolve = function geE5Resolve(entry, parts, lineRows) {
  const p = parts || {};
  const rv = geResolver(entry, p.GDL || {}, list(lineRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r)), entry.number);
  const pick = p.PICK ? rv.fix(p.PICK) : null;
  const stamp = p.STAMP ? rv.fix(p.STAMP) : null;
  const left = rv.unresolved({ pick: pick, stamp: stamp });
  return { pick: pick, stamp: stamp, left: left ? left[0].replace(/"/g, "") : "" };
};
const commitE5Plan = function commitE5Plan(entry, pick, stepRows, pickRows, itemRows, recRows) {
  const base = { route: "GO", mode: "NONE", writeRows: [], needWrite: "NO", addRows: [], needAdd: "NO", startRows: [], needStart: "NO", syncRows: [], needSync: "NO",
    intentRows: [], needIntent: "NO", sig: {}, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  if (!pick) return Object.assign(base, stepEnd(entry, "E5_PICKING", "the Picking part of the prepared payload is missing", true));
  const steps = {};
  for (const r of list(stepRows)) steps[s(r.step_name)] = r;
  const live = geObj(pickRows).filter((p) => String(p.is_deleted || 0) === "0" && p.to_status !== "Draft" && p.to_status !== "Cancelled");
  if (pick.hdrSync) base.syncRows = [Object.assign({ id: s(pick.hdrSync.pickingId) }, pick.hdrSync.headerData)], base.needSync = "YES";
  if (pick.mode === "UPDATE") {
    const head = live.filter((p) => s(p.id) === s(pick.pickingId))[0];
    if (!head) return Object.assign(base, stepEnd(entry, "E5_PICKING", "the Picking " + s(pick.pickingId) + " is gone", true));
    const items = gcTree(geObj(itemRows).filter((r) => s(r.transfer_order_id) === s(pick.pickingId)), "transfer_order_id");
    const recs = geObj(recRows).filter((r) => s(r.transfer_order_id) === s(pick.pickingId)).map((r) => gcNestedRow(r, "transfer_order_id"));
    const intent = joinChunks(list(stepRows), "E5|I|");
    if (intent === undefined) return Object.assign(base, stepEnd(entry, "E5_PICKING", "the recorded intent cannot be read", true));
    if (s(head.update_time) !== s(pick.version)) {
      // not the version we locked: our own write (intent + signature equal) or someone else's
      if (intent && geSig(items, GE_SIG_ITEM) === intent.items && geSig(recs, GE_SIG_REC) === intent.records) return Object.assign(base, { route: "CHECK", mode: "UPDATE", sig: intent, result_message: "the Picking write already landed" });
      return Object.assign(base, stepEnd(entry, "E5_PICKING", "the Picking changed since it was locked (version " + s(head.update_time) + ", locked at " + s(pick.version) + ")", true));
    }
    const rebuilt = geRebuildPicking({ table_picking_items: items, table_picking_records: recs }, pick);
    const sig = { items: geSig(rebuilt.table_picking_items, GE_SIG_ITEM), records: geSig(rebuilt.table_picking_records, GE_SIG_REC) };
    return Object.assign(base, { mode: "UPDATE", sig: sig, intentRows: intent ? [] : chunkRows(entry, "E5|I|", sig), needIntent: intent ? "NO" : "YES",
      writeRows: [Object.assign({ id: s(pick.pickingId) }, pick.header, { table_picking_items: rebuilt.table_picking_items, table_picking_records: rebuilt.table_picking_records })], needWrite: "YES",
      result_message: "write the Picking: " + rebuilt.table_picking_items.length + " item row(s), " + rebuilt.table_picking_records.length + " record(s)" });
  }
  if (pick.mode === "CREATE") {
    const started = !!steps.E5_PICK_ADD;
    if (live.length > 1) return Object.assign(base, stepEnd(entry, "E5_PICKING", live.length + " Pickings name the delivery", true));
    if (live.length === 1) {
      if (!started) return Object.assign(base, stepEnd(entry, "E5_PICKING", "a Picking was created for the delivery by someone else (" + s(live[0].to_id) + ")", true));
      return Object.assign(base, { route: "CHECK", mode: "CREATE", result_message: "the Picking " + s(live[0].to_id) + " was already added" });
    }
    return Object.assign(base, { mode: "CREATE", startRows: started ? [] : [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "E5_PICK_ADD", step_status: "STARTED",
      attempt_count: 0, started_at: entry.dbNow, finished_at: null, inventory_operation_id: "", result_ref: "", error_code: null, error_message: null }], needStart: started ? "NO" : "YES",
      addRows: [pick.createData], needAdd: "YES", result_message: "add the Picking" });
  }
  return Object.assign(base, { result_message: pick.hdrSync ? "sync the Picking header" : "no Picking to write" });
};
// E5's plan from the payload parts: placeholders resolved first (one left -> review, nothing written); the Picking write, add
// and header sync go out as ONE record each, as the classic's update / add / sync nodes map them
const commitE5Run = function commitE5Run(entry, parts, lineRows, stepRows, pickRows, itemRows, recRows) {
  const rz = geE5Resolve(entry, parts, lineRows);
  const res = rz.left
    ? Object.assign({ mode: "NONE", writeRows: [], needWrite: "NO", addRows: [], needAdd: "NO", startRows: [], needStart: "NO", syncRows: [], needSync: "NO", intentRows: [], needIntent: "NO", sig: {} },
      stepEnd(entry, "E5_PICKING", "a placeholder is still unresolved (" + rz.left + "): the lines or the number are missing", true))
    : commitE5Plan(entry, rz.pick, stepRows, pickRows, itemRows, recRows);
  return Object.assign(res, { writeRow: list(res.writeRows)[0] || {}, addRow: list(res.addRows)[0] || {}, syncRow: list(res.syncRows)[0] || {} });
};
const commitE5Check = function commitE5Check(entry, pick, plan, pickRows, itemRows, recRows) {
  const live = geObj(pickRows).filter((p) => String(p.is_deleted || 0) === "0" && p.to_status !== "Draft" && p.to_status !== "Cancelled");
  if (pick.mode === "UPDATE") {
    const head = live.filter((p) => s(p.id) === s(pick.pickingId))[0];
    const items = gcTree(geObj(itemRows).filter((r) => s(r.transfer_order_id) === s(pick.pickingId)), "transfer_order_id");
    const recs = geObj(recRows).filter((r) => s(r.transfer_order_id) === s(pick.pickingId)).map((r) => gcNestedRow(r, "transfer_order_id"));
    const sig = plan.sig || {};
    const off = [];
    if (!head) off.push("the Picking");
    // an [] the platform does not write to a json column: the stored value stays
    else for (const [c, v] of Object.entries(pick.header || {})) if (!((Array.isArray(v) && !v.length) || v === "[]") && !sameVal(head[c], v)) off.push("header." + c);
    if (geSig(items, GE_SIG_ITEM) !== sig.items) off.push("item rows");
    if (geSig(recs, GE_SIG_REC) !== sig.records) off.push("records");
    if (off.length) return stepEnd(entry, "E5_PICKING", "the Picking does not read back (" + off.slice(0, 4).join(", ") + ")", false);
    return stepOk(entry, "E5_PICKING", s(head.update_time), "Picking " + s(head.to_id) + " saved");
  }
  if (pick.mode === "CREATE") {
    if (live.length !== 1) return stepEnd(entry, "E5_PICKING", live.length + " live Pickings name the delivery after the add", live.length > 1);
    const n = geObj(itemRows).filter((r) => s(r.transfer_order_id) === s(live[0].id)).length;
    const want = list((pick.createData || {}).table_picking_items).flatMap((r) => [r].concat(r.children || [])).filter((r) => r.id !== undefined || r.row_type !== "header").length;
    if (!n && want) return stepEnd(entry, "E5_PICKING", "the Picking " + s(live[0].to_id) + " has no item rows", false);
    return stepOk(entry, "E5_PICKING", s(live[0].update_time), "Picking " + s(live[0].to_id) + " added");
  }
  // a header sync alone moved the Picking's version: E6 unlocks at the synced one
  const synced = pick.hdrSync ? live.filter((p) => s(p.id) === s(pick.hdrSync.pickingId))[0] : null;
  if (synced) return stepOk(entry, "E5_PICKING", s(synced.update_time), "Picking header synced");
  return stepOk(entry, "E5_PICKING", "", pick.hdrSync ? "Picking header synced" : "no Picking");
};
// update_node_StampGDLines: picking_status "Created" on the plan lines whose status is still Not Created / Cancelled / empty
const commitE5Stamps = function commitE5Stamps(entry, stamp, lineRows) {
  const fresh = geLineRows(lineRows);
  const rows = [];
  for (const id of (stamp && stamp.lineIds) || []) {
    const cur = fresh[s(id)];
    if (!cur || String(cur.is_deleted) !== "0") continue;
    const ps = s(cur.picking_status);
    if (ps === "" || ps === "Not Created" || ps === "Cancelled") rows.push({ id: s(id), picking_status: "Created" });
  }
  return { stampSlices: slicesOf(rows, 250), stampCount: rows.length };
};
