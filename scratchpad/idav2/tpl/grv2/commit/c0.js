// GR_COMPLETE_COMMIT - C0 REVALIDATE: every PO line the receipt adds to is still there and still has room on a FRESH
// read (code_node_e9pINRwN's rule, its message); the purchase orders are locked for this job (GRPO|<po> / HOLD|<n>, taken
// in id order) -> DONE. A purchase order held by another open receipt -> this job's holds are freed and it waits (ten
// tries, then FAILED). A line without room -> FAILED, the receipt back to its status before the submit (nothing moved)
const commitC0 = function commitC0(entry, partRows, polRows) {
  const po = joinChunks(partRows, entry.partPrefix + "PO|");
  if (!po || !Array.isArray(po.poLines) || !Array.isArray(po.poIds)) return failNoWrite(entry, "GRC_INVALID_DATA", "the purchase-order part of the prepared payload is missing");
  const fresh = {};
  for (const r of list(polRows)) {
    const o = parseJ(r.j);
    if (o && o.id) fresh[s(o.id)] = o;
  }
  const errors = [];
  for (const l of po.poLines) {
    const cur = fresh[s(l.id)];
    if (!cur) return failNoWrite(entry, "GRC_PO_CHANGED", "purchase order line " + s(l.id) + " (" + s(l.item_name) + ") no longer exists: no stock was moved");
    if (l.gr_total === undefined || l.gr_total === null) continue;
    const currentReceivedQty = parseFloat(cur.received_qty || 0);
    const totalAfterReceiving = q8(currentReceivedQty + num(l.gr_total));
    const orderedQty = parseFloat(cur.quantity || 0);
    const maxAllowed = q8(orderedQty * ((100 + num(l.tolerance)) / 100));
    if (totalAfterReceiving > maxAllowed) {
      errors.push(s(l.item_name) + ": Attempting to receive " + num(l.gr_total) + ", but only " + Math.max(0, q8(maxAllowed - currentReceivedQty)) + " remaining (Ordered: " + orderedQty
        + ", Already received: " + currentReceivedQty + ", Max allowed: " + maxAllowed + ")");
    }
  }
  if (errors.length) return failNoWrite(entry, "GRC_PO_CHANGED", "Quantity validation failed:\n" + errors.join("\n"));
  const st = entry.poLocks || {};
  const busy = [];
  const take = [];
  for (const poId of po.poIds.map(s).filter(digits).sort()) {
    const key = "GRPO|" + poId;
    const k = st[key] || { n: 0, holder: "", held: "NO" };
    if (k.holder === entry.jobId) continue;
    if (k.held === "YES") busy.push(poId);
    else take.push(lockRowOf(entry, key, "HOLD|" + (k.n + 1)));
  }
  if (busy.length) {
    const why = "purchase order " + busy.slice(0, 3).join(", ") + (busy.length > 3 ? " (+" + (busy.length - 3) + ")" : "") + " is being received by another Goods Receiving";
    if (entry.c0Waits >= 10) return failNoWrite(entry, "GRC_PO_BUSY", why + " (waited " + entry.c0Waits + " times): no stock was moved");
    const end = stepWait(entry, "C0_REVALIDATE", why, Math.min(60, 5 * (entry.c0Waits + 1)) + entry.jitter);
    end.stepRows = [Object.assign(doneRow(entry, "C0_WAIT|" + (entry.c0Waits + 1), why), { step_status: "WAIT" })];
    end.needStep = "YES";
    end.freeRows = freeRowsOf(entry);
    end.needFree = end.freeRows.length ? "YES" : "NO";
    return end;
  }
  const ok = stepOk(entry, "C0_REVALIDATE", po.poLines.length + " PO line(s) with room; " + po.poIds.length + " purchase order(s) locked", "revalidated");
  ok.lockRows = take;
  ok.needLock = take.length ? "YES" : "NO";
  return ok;
};
const res = commitC0([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc0part.data}}][0], [{{node:sql_node_RCc0pol.data}}][0]);
console.log("commit C0", JSON.stringify({ route: res.route, take: (res.lockRows || []).length, free: (res.freeRows || []).length, result: res.result_code, message: res.result_message }));
return res;
