// PICKING_BULK_COMMIT 1c - PM1 in: on every attempt, before the stock moves, the reservations the move changes and the
// moved lines must still be as PREPARE read them. Stale and no intent row of PKM|<job> yet -> FAILED + unlock (nothing was
// written); stale after an intent -> REQUIRES_REVIEW. Otherwise the call (none when the move has no stock movement).
const commitPM1In = function commitPM1In(entry, mvp, facts) {
  const f = pmRows(facts);
  const m = mvp || {};
  const base = Object.assign({}, PM_END, { route: "GO", needCall: "NO", operationKey: pmS(entry.moveOpKey), organizationId: pmS(entry.organizationId), intents: f.I,
    result_code: "", result_message: "", job_status: "COMMITTING_PICKING" });
  if (pmS(m.ok) !== "YES") {
    const why = "the move's parts could not be read (" + pmS(m.why) + ")";
    return Object.assign(base, f.I > 0 ? pmEnd(entry, "PM1_STOCK", why, true) : pmFail(entry, "PK_INVALID_DATA", why + ": nothing was saved"));
  }
  const stale = [];
  for (const u of pmList(m.res && m.res.updates)) {
    const cur = f.U[pmS(u.id)];
    if (!cur || String(cur.is_deleted) !== "0" || !PM_RES_COLS.every((c) => pmSame(cur[c], (u.before || {})[c]))) stale.push("reservation " + pmS(u.id));
  }
  for (const l of pmList(m.alc)) {
    const cur = f.L[pmS(l.id)];
    if (!cur || !pmSame(cur.temp_qty_data, l.before_temp)) stale.push("delivery line " + pmS(l.id));
  }
  if (stale.length) {
    const why = "the delivery changed after the confirmation was queued (" + stale.slice(0, 3).join(", ") + (stale.length > 3 ? " and " + (stale.length - 3) + " more" : "") + ")";
    return Object.assign(base, f.I > 0 ? pmEnd(entry, "PM1_STOCK", why, true) : pmFail(entry, "PK_STALE", why + ". Nothing was saved; reopen the Picking and confirm again"));
  }
  const n = Number((m.counts || {}).movements) || 0;
  return Object.assign(base, { needCall: n > 0 ? "YES" : "NO", result_message: n + " stock movement(s) to apply" });
};
// the parts' reservations, allocation and counts only: the movements go from the parse node straight to the engine call
const res = commitPM1In([{{node:code_node_PCentry.data}}][0], { ok: [{{node:code_node_PCmvparse.data.ok}}][0], why: [{{node:code_node_PCmvparse.data.why}}][0],
  res: [{{node:code_node_PCmvparse.data.res}}][0], alc: [{{node:code_node_PCmvparse.data.alc}}][0], counts: [{{node:code_node_PCmvparse.data.counts}}][0] }, [{{node:sql_node_PCpm1facts.data}}][0]);
console.log("commit PM1 in", JSON.stringify({ route: res.route, call: res.needCall, intents: res.intents, result: res.result_code, message: res.result_message }));
return res;
