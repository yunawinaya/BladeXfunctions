// IA_HOLD - Finish: the rows this run wrote, by outcome (DONE -> Allocated / Cancelled, NOTHING -> rolled back, uncertain ->
// left for the next run and Needs review), the label from required versus held per line, the IA header, the ticket freed
const HD_TEXT = {
  FULL: "All materials are reserved.",
  PARTIAL: "Some materials are reserved: the rest is short of stock.",
  SHORT: "Nothing could be reserved: the materials are not in free stock.",
  NONE: "Nothing to reserve.",
  RELEASED: "Released: this Item Assembly holds no material now.",
  CLOSED: "Closed: what the completion used is delivered and the rest is released.",
  AGAIN: "Saved again while reserving: the saved lines are reserved when this Item Assembly is next opened.",
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
  const released = !review && hdS(g.op) === "RELEASE_ALL";
  // a save while this reconcile worked marked the IA RESERVING again (its update_time moved): the mark stays, so the next open reserves
  // the saved lines; this run's holds stand (review I1)
  const was = hdS(((st && st.ia) || {}).ut);
  const again = !review && hdS(g.op) === "RECONCILE" && !!head && hdS(head.hold) === "RESERVING" && was !== "" && hdS(head.ut) !== "" && hdS(head.ut) !== was;
  const status = review ? "REVIEW" : released ? "NONE" : closing ? "CLOSED" : again ? "RESERVING" : sum.status;
  // a retry helps after a transient failure only; a CLOSE retries when the Item Assembly is opened while it still holds stock
  const retry = outcome === "UNCERTAIN" || refused ? (closing ? " Open the Item Assembly again to retry." : " Save the Item Assembly again to retry.") : "";
  const message = review ? "Needs review: " + review + "." + (closing ? retry : " Save the Item Assembly again to retry.")
    : released ? HD_TEXT.RELEASED : closing ? HD_TEXT.CLOSED : again ? HD_TEXT.AGAIN : HD_TEXT[status];
  const won = hdS(mutex.route) === "WIN" && hdS(mutex.ticketId);
  return {
    outcome: outcome,
    publish: f.publish, close: f.close, drop: f.drop, restore: f.restore,
    needPublish: f.publish.length ? "YES" : "NO", needClose: f.close.length ? "YES" : "NO", needDrop: f.drop.length ? "YES" : "NO", needRestore: f.restore.length ? "YES" : "NO",
    headRows: [{ id: hdS((st.ia || {}).id), material_hold_status: status, material_hold_at: hdS(st.now) }],
    freeRows: won ? [{ id: hdS(mutex.ticketId), step_status: "FREE", finished_at: hdS(st.now) }] : [], needFree: won ? "YES" : "NO",
    code: "200", message: message,
    result_json: JSON.stringify({ status: status, lines: sum.lines, notHeld: mv.notHeld || delta.notHeld || [], short: mv.short || [], held: (mv.holds || []).length,
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
