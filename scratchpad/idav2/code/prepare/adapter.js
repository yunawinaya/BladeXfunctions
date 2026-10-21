// IDA_V2_PREPARE - SQL rows -> the shapes the lifted IDA_SAVE v6 bodies read (status = prevStatus; temp_qty_data stays the stored TEXT)
const idaAdaptDrop = (o) => {
  const r = {};
  for (const k of Object.keys(o || {})) {
    const v = o[k];
    if (v === null || v === undefined || v === "") continue;
    r[k] = v;
  }
  return r;
};
const idaAdaptHeader = function idaAdaptHeader(row, prevStatus) {
  const h = idaAdaptDrop(row);
  delete h.ida_v2_job_id;
  h.item_disassembly_status = prevStatus;
  if (h.item_qty !== undefined) h.item_qty = Number(h.item_qty);
  // code_fillback compares the Manual Input rule with !== -9999
  if (idaS(h.stock_movement_no_type) === "-9999") h.stock_movement_no_type = -9999;
  return h;
};
const idaAdaptIdKey = (v) => String(idaS(v).length).padStart(2, "0") + idaS(v);
// line order (CONTRACT.md ruling 17): numeric line_index, then id
const idaAdaptLines = function idaAdaptLines(rows) {
  const at = (v) => (/^[0-9]{1,15}$/.test(idaS(v)) ? Number(idaS(v)) : Infinity);
  const lines = idaRows(rows).map((r) => {
    const o = idaAdaptDrop(r);
    if (o.total_quantity !== undefined) o.total_quantity = Number(o.total_quantity);
    return o;
  });
  return lines.sort((a, b) => {
    const x = at(a.line_index);
    const y = at(b.line_index);
    if (x !== y) return x < y ? -1 : 1;
    const p = idaAdaptIdKey(a.id);
    const q = idaAdaptIdKey(b.id);
    return p < q ? -1 : p > q ? 1 : 0;
  });
};
const idaAdaptItems = (rows) => idaRows(rows).map((r) => {
  const o = idaAdaptDrop(r);
  if (o.purchase_unit_price !== undefined) o.purchase_unit_price = Number(o.purchase_unit_price);
  o.table_uom_conversion = idaList(o.table_uom_conversion).filter((c) => c && typeof c === "object").map((c) => ({ alt_uom_id: idaS(c.alt_uom_id), base_qty: Number(c.base_qty) }));
  return o;
});
// LINE_STORAGE rows -> each stored line's storage_location_id (by id; a blank one stays absent, as the stored row has none)
const idaAdaptStorage = function idaAdaptStorage(lines, rows) {
  const at = {};
  for (const r of idaRows(rows)) if (idaDigits(r.storage_location_id)) at[idaS(r.id)] = idaS(r.storage_location_id);
  for (const l of lines) if (at[idaS(l.id)]) l.storage_location_id = at[idaS(l.id)];
  return lines;
};
// the platform context of the lifted bodies: an Edit of the stored Draft saved as Completed; search_batches = the BATCH_TYPED_STORED rows;
// no OUT rows yet (the price is COMMIT D3's)
const idaPlanContext = function idaPlanContext(allData, items, persisted, uid, batches) {
  const b = idaList(batches);
  return { "workflowparams:allData": allData, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Edit",
    "node:search_items": { data: { total: items.length, count: items.length, data: items } }, "node:search_batches": { data: { total: b.length, count: b.length, data: b } },
    "node:code_persisted": { data: persisted }, "node:search_movements": { data: { total: 0, count: 0, data: [] } }, "system:uid": uid || null };
};
// the classic gate: fill-back, then code_validate on the stored document with the fresh item / Batch rows
const idaPlanGate = function idaPlanGate(ctx) {
  return __withContext(ctx, () => ({ fill: __run("code_fillback"), validate: __run("code_validate") }));
};
// then the classic order: issue prep, one issue-pick run per pick (loop_issue_picks), batch plan, cost allocation, item stamps;
// code_apply_batches' lines are the fill-back's (AUTO numbers are COMMIT D1's)
const idaPlanRun = function idaPlanRun(ctx) {
  return __withContext(ctx, () => {
    const fill = (ctx["node:code_fillback"] || {}).data || __run("code_fillback");
    ctx["node:code_apply_batches"] = { data: { stock_movement: idaList(fill.allData && fill.allData.stock_movement) } };
    const prep = __run("code_issue_prep");
    const picks = [];
    for (const p of idaList(prep.balancesToProcess)) {
      ctx["node:loop_issue_picks"] = p;
      picks.push(__run("code_issue_pick"));
    }
    delete ctx["node:loop_issue_picks"];
    const plan = __run("code_batch_plan");
    const cost = __run("code_cost_alloc");
    return { fill: fill, prep: prep, picks: picks, plan: plan, cost: cost, txn: __run("code_item_txn") };
  });
};
