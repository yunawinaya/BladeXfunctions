// IA_HOLD - Finish: the rows this run wrote, by outcome (DONE -> Allocated / Cancelled, NOTHING -> rolled back, uncertain ->
// left for the next run and Needs review), the label from required versus held per line, the IA header, the ticket freed
const HD_TEXT = {
  FULL: "All materials are reserved.",
  PARTIAL: "Some materials are reserved.",
  SHORT: "Nothing is reserved.",
  NONE: "Nothing to reserve: no stock-controlled materials.",
  RELEASED: "Released: this Item Assembly holds no material now.",
  CANCELLED: "Cancelled: this Item Assembly's reserved materials are released.",
  CLOSED: "Closed: what the completion used is delivered and the rest is released.",
  AGAIN: "Saved again while reserving: the saved lines are reserved when this Item Assembly is next opened.",
};
// BA rev 1.2 C5: the server-side switch off made no new hold (the free stock was not looked at, so no shortage is claimed)
const HD_OFF = " Reservation is switched off: no new stock is reserved (what this Item Assembly holds is kept, released or closed as usual).";
// MIN-06 (BA 10-22): why the rest is not reserved, in lines (hdStatus's why), never a shortage it does not know of
const HD_WHY = { SERIAL: "serial", HANDLING_UNIT: "handling unit", CATEGORY: "a category other than Unrestricted / Blocked", UOM: "a unit with no conversion", ITEM: "an unknown item" };
const hdWhyText = (why) => {
  const n = (k) => k + (k === 1 ? " line" : " lines");
  const parts = [];
  if (why && why.notFree) parts.push(n(why.notFree) + " short of free stock where allocated");
  if (why && why.notAllocated) parts.push(n(why.notAllocated) + " allocated for less than required");
  const un = (why && why.unsupported) || {};
  const keys = Object.keys(HD_WHY).filter((k) => un[k]);
  if (keys.length) parts.push(keys.map((k) => n(un[k]) + " with " + HD_WHY[k]).join(", ") + " (not supported by the reservation)");
  return parts.length ? " Not reserved: " + parts.join("; ") + "." : "";
};
const hdFinishStep = function hdFinishStep(g, st, items, delta, mv, mutex, inserted, ans, opsRows, head) {
  let outcome = hdS(ans.outcome) || "NONE";
  if (outcome === "ASK") {
    const state = {};
    (opsRows || []).forEach((o) => (state[hdS(o.op)] = o));
    const o = state[hdS(mv.opKey)] || {};
    outcome = hdNum(o.done) > 0 ? "DONE" : hdNum(o.intents) === 0 ? "NOTHING" : "UNCERTAIN";
  }
  const written = (Array.isArray(inserted) ? inserted : inserted ? [inserted] : []).map((r) => Object.assign({}, r, { id: hdS(r.id), status: hdS(r.status) || "Processing" }))
    .concat((mv.mark || []).map((m) => {
      const old = (delta.rowsAfter || []).find((r) => hdS(r.id) === hdS(m.id)) || {};
      return Object.assign({}, old, { id: hdS(m.id), status: "Releasing" });
    }));
  const f = hdFinish(outcome, written);
  const gone = {};
  f.close.concat(f.drop).concat(mv.deliver || []).forEach((u) => (gone[hdS(u.id)] = 1));
  const before = {};
  (delta.rowsAfter || []).forEach((r) => (before[hdS(r.id)] = 1));
  // the rows held now: what was held and not closed, the new holds published, a CLOSE remainder restored (nothing moved)
  const rows = (delta.rowsAfter || []).filter((r) => !gone[hdS(r.id)]).concat(f.publish.concat(f.restore.filter((u) => !before[u.id]))
    .map((u) => Object.assign({}, written.find((w) => w.id === u.id), { status: "Allocated" })));
  const sum = hdStatus(st.lines || [], rows, items);
  const closing = hdS(g.op) === "CLOSE";
  const refused = outcome === "NOTHING" && hdS(mv.needCall) === "YES";
  const review = outcome === "UNCERTAIN" ? "the stock move did not report back" : hdS(mv.route) === "REVIEW" ? hdS(mv.why)
    : refused && hdS(ans.code) === "409" ? "the stock is busy with another operation"
    : refused ? (closing ? "the reserved stock could not be released (" : "the stock changed while reserving (") + (hdS(ans.result_code) || "refused") + ")"
    : num(mv.stuck) > 0 ? num(mv.stuck) + " hold(s) could not be released (a duplicate balance row or costing rows to migrate)"
    : (delta.over || []).length ? "the completion used more reserved stock than this Item Assembly held (" + delta.over.map((x) => x.key).join(", ") + ")"
    : (delta.under || []).length ? "more is marked delivered than its completion issued from Reserved (" + delta.under.map((x) => x.key).join(", ") + ")" : "";
  const cancelling = hdS(g.op) === "CANCEL";
  const released = !review && (hdS(g.op) === "RELEASE_ALL" || cancelling || (hdS(g.op) === "RECONCILE" && hdS(((st && st.ia) || {}).status) === "Draft"));
  // CANCEL: the status only once everything is released; a release that did not finish leaves the IA Created (Needs review)
  const cancelled = cancelling && !review;
  // a save while this reconcile worked marked the IA RESERVING again (its update_time moved): the mark stays, so the next open reserves
  // the saved lines; this run's holds stand (review I1)
  const was = hdS(((st && st.ia) || {}).ut);
  const again = !review && hdS(g.op) === "RECONCILE" && !!head && hdS(head.hold) === "RESERVING" && was !== "" && hdS(head.ut) !== "" && hdS(head.ut) !== was;
  // review 2: "saved again" wins over a Draft's release (the IA may be Created by now: the next open reserves it)
  const status = review ? "REVIEW" : again ? "RESERVING" : released ? "NONE" : closing ? "CLOSED" : sum.status;
  // a retry helps after a transient failure only; a CLOSE retries when the Item Assembly is opened while it still holds stock
  const retry = outcome === "UNCERTAIN" || refused ? (closing ? " Open the Item Assembly again to retry." : " Save the Item Assembly again to retry.") : "";
  const message = review ? "Needs review: " + review + "." + (closing ? retry : cancelling ? " The Item Assembly was not cancelled: try again." : " Save the Item Assembly again to retry.")
    : again ? HD_TEXT.AGAIN : cancelled ? HD_TEXT.CANCELLED : released ? HD_TEXT.RELEASED : closing ? HD_TEXT.CLOSED
    : HD_TEXT[status] + (hdS(delta.acquireOff) === "YES" ? HD_OFF : status === "PARTIAL" || status === "SHORT" ? hdWhyText(sum.why) : "");
  const won = hdS(mutex.route) === "WIN" && hdS(mutex.ticketId);
  return {
    outcome: outcome,
    publish: f.publish, close: f.close, drop: f.drop, restore: f.restore,
    needPublish: f.publish.length ? "YES" : "NO", needClose: f.close.length ? "YES" : "NO", needDrop: f.drop.length ? "YES" : "NO", needRestore: f.restore.length ? "YES" : "NO",
    headRows: [{ id: hdS((st.ia || {}).id), material_hold_status: status, material_hold_at: hdS(st.now) }],
    cancelRows: cancelled ? [{ id: hdS((st.ia || {}).id), item_assembly_status: "Cancelled" }] : [], needCancel: cancelled ? "YES" : "NO",
    freeRows: won ? [{ id: hdS(mutex.ticketId), step_status: "FREE", finished_at: hdS(st.now) }] : [], needFree: won ? "YES" : "NO",
    code: "200", message: message,
    result_json: JSON.stringify({ status: status, cancelled: cancelled, acquireOff: hdS(delta.acquireOff) === "YES", lines: sum.lines, notHeld: mv.notHeld || delta.notHeld || [], short: mv.short || [], held: (mv.holds || []).length,
      released: (mv.releases || []).length, delivered: (mv.deliver || []).length, checkedAt: hdS(st.now), message: message }),
  };
};
const num = (v) => hdNum(v);
const itemsOf = (rows) => {
  const out = {};
  hdSqlRows(rows).forEach((i) => (out[hdS(i.id)] = i));
  return out;
};
const res = hdFinishStep([{{node:code_node_HDguard.data}}][0] || {}, hdSqlRow([{{node:sql_node_HDstate.data}}][0]) || {}, itemsOf([{{node:sql_node_HDitems.data}}][0]), [{{node:code_node_HDdelta.data}}][0] || {},
  [{{node:code_node_HDmoves.data}}][0] || {}, [{{node:code_node_HDmutex.data}}][0] || {}, [{{node:add_node_HDrows.data}}][0], [{{node:code_node_HDans.data}}][0] || {},
  hdSqlRows([{{node:sql_node_HDops2.data}}][0]), hdSqlRow([{{node:sql_node_HDhead.data}}][0]));
console.log("hold finish", JSON.stringify({ outcome: res.outcome, status: JSON.parse(res.result_json).status, message: res.message }));
return res;
