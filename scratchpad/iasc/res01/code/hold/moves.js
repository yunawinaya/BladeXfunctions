// IA_HOLD - Moves: the engine's refusals screened per key (a duplicate balance row, costing rows that need migration: that
// key is not held, and a release on it waits for Needs review), each hold capped at the free stock, the ticket and operation key,
// the engine moves (releases first) and the rows written before the move
const HD_MAX_MOVES = 5000;
const hdMovesStep = function hdMovesStep(g, st, items, delta, balRows) {
  const ia = st.ia || {};
  const bad = {};
  (balRows || []).forEach((b) => {
    const key = [hdS(b.material_id), hdS(b.location_id), hdS(b.batch_id)].join("|");
    const fifo = hdNum(b.fifo);
    const wa = hdNum(b.wa);
    const method = hdS(b.method);
    if (hdNum(b.item_rows) > 1 || hdNum(b.batch_rows) > 1) bad[key] = "DUPLICATE_BALANCE";
    else if ((fifo > 0 && wa > 0) || (method === "First In First Out" && fifo === 0 && wa > 0) || (method === "Weighted Average" && wa === 0 && fifo > 0)) bad[key] = "COSTING";
  });
  const pk = (f) => [hdS(f.materialId), hdS(f.binId), hdS(f.batchId)].join("|");
  const notHeld = (delta.notHeld || []).slice();
  const holds0 = [];
  (delta.holds || []).forEach((h) => (bad[pk(h.frag)] ? notHeld.push({ lineId: h.frag.lineId, reason: bad[pk(h.frag)] }) : holds0.push(h)));
  const releases = (delta.releases || []).filter((r) => !bad[pk(r.frag)]);
  const stuck = (delta.releases || []).length - releases.length;
  const cap = hdCap(holds0, balRows || [], items, releases);
  const n = hdNum(st.ticket_max) + 1;
  const opKey = "IAH|" + hdS(ia.id) + "|" + n;
  const moves = hdMoves(cap.holds, releases, { iaNo: hdS(ia.no), plantId: hdS(ia.plant_id), orgId: hdS(ia.organization_id), docDate: hdS(st.now) });
  // CLOSE: the used holds Delivered under the ticket (the completion already issued them), with the completed number
  const deliver = (delta.deliver || []).map((d) => Object.assign({}, d, { doc_no: hdS(ia.no) }));
  const out = { route: "GO", opKey: opKey, moves: moves, holds: cap.holds, releases: releases, short: cap.short, notHeld: notHeld, stuck: stuck, add: [], mark: [],
    ticketRows: [], needTicket: "NO", needCall: "NO", needAdd: "NO", needMark: "NO", why: "", deliver: deliver, needDeliver: deliver.length ? "YES" : "NO" };
  if (!moves.length && !deliver.length) return out;
  if (moves.length > HD_MAX_MOVES) return Object.assign(out, { route: "REVIEW", why: "more than " + (HD_MAX_MOVES / 2) + " pick fragments to reserve at once" });
  const iaRef = { id: ia.id, no: ia.no, plantId: ia.plant_id, orgId: ia.organization_id };
  const r = !moves.length ? { add: [], mark: [] } : hdS(g.op) === "CLOSE" ? hdCloseRows({ releases: releases }, iaRef, opKey, st.now) : hdRows(cap.holds, releases, iaRef, opKey, st.now);
  out.add = r.add;
  out.mark = r.mark;
  out.ticketRows = [{ job_id: "IAH|" + hdS(ia.id), organization_id: hdS(ia.organization_id), step_name: "TICKET|" + n, step_status: "HELD", attempt_count: 1, started_at: hdS(st.now),
    finished_at: null, inventory_operation_id: "", result_ref: opKey, error_code: "", error_message: "" }];
  out.needTicket = "YES";
  out.needCall = moves.length ? "YES" : "NO";
  out.needAdd = r.add.length ? "YES" : "NO";
  out.needMark = r.mark.length ? "YES" : "NO";
  return out;
};
const itemsOf = (rows) => {
  const out = {};
  hdSqlRows(rows).forEach((i) => (out[hdS(i.id)] = i));
  return out;
};
const res = hdMovesStep([{{node:code_node_HDguard.data}}][0] || {}, hdSqlRow([{{node:sql_node_HDstate.data}}][0]) || {}, itemsOf([{{node:sql_node_HDitems.data}}][0]),
  [{{node:code_node_HDdelta.data}}][0] || {}, hdSqlRows([{{node:sql_node_HDbal.data}}][0]));
console.log("hold moves", JSON.stringify({ route: res.route, op: res.opKey, moves: res.moves.length, short: res.short.length, notHeld: res.notHeld.length, stuck: res.stuck }));
return res;
