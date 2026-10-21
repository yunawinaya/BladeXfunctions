// GR_REVERT_COMMIT - R0 REVALIDATE: on FRESH reads nothing has touched this receipt's stock since PREPARE (grRvBuild's
// later-movement rule), its FIFO layers are still untouched and its weighted-average batch rows unchanged; the purchase
// orders are locked for this job (GRPO|<po> / HOLD|<n>, in id order) -> DONE. Anything moved -> FAILED with the classic's
// message, the receipt back to its status before the submit (nothing was moved). A purchase order held by another job ->
// this job's holds are freed and it waits (ten tries, then FAILED)
const commitR0 = function commitR0(entry, inp, laterRows, fifoRows, waRows) {
  if (s(inp.ok) !== "YES") return failNoWrite(entry, "GRV_INVALID_DATA", s(inp.why) + ": no stock was moved");
  const cmpId = (a, b) => {
    a = s(a);
    b = s(b);
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const nameOf = (id) => s((inp.names || {})[s(id)]) || s(id);
  const conflicts = [];
  const flag = (type, id, message) => conflicts.push({ type: type, id: s(id), message: message });
  for (const lr of list(laterRows)) {
    const anchor = (inp.anchors || {})[s(lr.item_id) + "|" + s(lr.batch_id)];
    if (!anchor || cmpId(lr.max_id, anchor) <= 0) continue;
    flag("later_movement", lr.item_id, "Item " + nameOf(lr.item_id) + " has been used since this receipt (latest: " + s(lr.latest) + ").");
  }
  const fifo = byId(fifoRows);
  for (const f of list(inp.fifo)) {
    const cur = fifo[s(f.id)];
    if (!cur || String(cur.is_deleted) !== "0") flag("fifo_layer_mismatch", f.material_id, "The costing layer for " + nameOf(f.material_id) + " no longer exists.");
    else if (Math.abs(num(cur.fifo_available_quantity) - num(cur.fifo_initial_quantity)) > EPS) {
      flag("fifo_layer_consumed", f.material_id, "The costing layer for " + nameOf(f.material_id) + " has already been drawn down (" + q8(cur.fifo_available_quantity) + " of " + q8(cur.fifo_initial_quantity) + " left).");
    }
  }
  const wa = byId(waRows);
  for (const w of list(inp.waDelete)) {
    const cur = wa[s(w.id)];
    if (!cur || String(cur.is_deleted) !== "0" || Math.abs(num(cur.wa_quantity) - num(w.wa_quantity)) > EPS || Math.abs(num(cur.wa_cost_price) - num(w.wa_cost_price)) > 0.00005) {
      flag("wa_batch_row_mismatch", w.material_id, "The costing row for " + nameOf(w.material_id) + " has changed since this receipt.");
    }
  }
  if (conflicts.length) {
    const why = "Revert blocked: this receipt's stock has been used or its documents have moved on. " + conflicts.slice(0, 5).map((c) => c.message).join(" ") + (conflicts.length > 5 ? " (+" + (conflicts.length - 5) + " more)" : "");
    return failNoWrite(entry, "GRV_STALE", why.slice(0, 1000), { step: "R0_REVALIDATE", conflicts: conflicts });
  }
  const po = entry.manifest && Array.isArray(entry.manifest.po_ids) ? entry.manifest.po_ids : [];
  const st = entry.poLocks || {};
  const busy = [];
  const take = [];
  for (const poId of po.map(s).filter(digits).sort()) {
    const key = "GRPO|" + poId;
    const k = st[key] || { n: 0, holder: "", held: "NO" };
    if (k.holder === entry.jobId) continue;
    if (k.held === "YES") busy.push(poId);
    else take.push(lockRowOf(entry, key, "HOLD|" + (k.n + 1)));
  }
  if (busy.length) {
    const why = "purchase order " + busy.slice(0, 3).join(", ") + (busy.length > 3 ? " (+" + (busy.length - 3) + ")" : "") + " is being received or reverted by another Goods Receiving";
    if (entry.r0Waits >= 10) return failNoWrite(entry, "GRV_PO_BUSY", why + " (waited " + entry.r0Waits + " times): no stock was moved");
    const end = stepWait(entry, "R0_REVALIDATE", why, Math.min(60, 5 * (entry.r0Waits + 1)) + entry.jitter);
    end.stepRows = [Object.assign(doneRow(entry, "R0_WAIT|" + (entry.r0Waits + 1), why), { step_status: "WAIT" })];
    end.needStep = "YES";
    end.freeRows = freeRowsOf(entry);
    end.needFree = end.freeRows.length ? "YES" : "NO";
    return end;
  }
  const ok = stepOk(entry, "R0_REVALIDATE", list(inp.fifo).length + " FIFO layer(s) untouched; " + po.length + " purchase order(s) locked", "revalidated");
  ok.lockRows = take;
  ok.needLock = take.length ? "YES" : "NO";
  return ok;
};
const res = commitR0([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr0in.data}}][0], [{{node:sql_node_VCr0later.data}}][0], [{{node:sql_node_VCr0fifo.data}}][0],
  [{{node:sql_node_VCr0wa.data}}][0]);
console.log("commit R0", JSON.stringify({ route: res.route, take: (res.lockRows || []).length, free: (res.freeRows || []).length, result: res.result_code, message: res.result_message }));
return res;
