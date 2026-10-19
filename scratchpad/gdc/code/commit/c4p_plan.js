// GD_COMPLETE_COMMIT - C4P plan (Force Complete only): GOODS_DELIVERY's if_FcApply on a fresh read - this GD's open rows of the
// open Pickings go Completed with nothing pending, a Picking header Completed only when every row is this GD's or done (a
// shared Picking stays open) - recorded as an intent (C4P|I|nnn: each row's before + after) before anything is written; a
// re-run works from the intent: at after = done, at before = write, else review. Status only: no pick records, no stock.
const C4P_LINE_AFTER = { line_status: "Completed", pending_process_qty: 0 };
const commitC4PPlan = function commitC4PPlan(entry, intentRows, pickRows, byIdRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const line = {};
  const head = {};
  for (const r of list(byIdRows)) {
    if (s(r.k) === "L") line[s(r.id)] = r;
    else if (s(r.k) === "P") head[s(r.id)] = r;
  }
  let intent = joinChunks(intentRows, "C4P|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "C4P_PICKING", "the recorded intent cannot be read", true));
  if (!intent) {
    // C0 found the Pickings free and every Picking writer refuses a Processing delivery since: a holder now is a crashed run's
    // lock that has not aged out yet - wait for it, never close part of the set
    const plan = fcPlan(list(pickRows), entry.gdId);
    if (plan.busyNos.length) return Object.assign(base, stepEnd(entry, "C4P_PICKING", plan.busyMessage, false));
    const gone = plan.lineIds.filter((id) => !line[s(id)]).concat(plan.pickingIds.filter((id) => !head[s(id)]));
    if (gone.length) return Object.assign(base, stepEnd(entry, "C4P_PICKING", gone.length + " Picking row(s) vanished meanwhile (e.g. " + gone.slice(0, 3).join(", ") + ")", true));
    intent = {
      lines: plan.lineIds.map((id) => ({ id: s(id), picking_id: s(line[s(id)].picking_id), before: { line_status: s(line[s(id)].status), pending_process_qty: s(line[s(id)].pending) }, after: C4P_LINE_AFTER })),
      pickings: plan.pickingIds.map((id) => ({ id: s(id), before: { to_status: s(head[s(id)].status) }, after: { to_status: "Completed" } })),
    };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "C4P|I|", intent);
  }
  const conflicts = [];
  const lineWrites = [];
  for (const r of intent.lines || []) {
    const cur = line[r.id];
    if (!cur || String(cur.is_deleted) !== "0") { conflicts.push(r.id + " (gone)"); continue; }
    if (s(cur.status) === r.after.line_status && sameVal(cur.pending, r.after.pending_process_qty)) continue;
    if (s(cur.status) === r.before.line_status && sameVal(cur.pending, r.before.pending_process_qty)) lineWrites.push(Object.assign({ id: r.id }, r.after));
    else conflicts.push(r.id);
  }
  const headWrites = [];
  for (const h of intent.pickings || []) {
    const cur = head[h.id];
    if (!cur || String(cur.is_deleted) !== "0") { conflicts.push("Picking " + h.id + " (gone)"); continue; }
    if (s(cur.status) === h.after.to_status) continue;
    if (s(cur.status) === h.before.to_status) headWrites.push({ id: h.id, to_status: h.after.to_status });
    else conflicts.push("Picking " + h.id);
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "C4P_PICKING", conflicts.length + " Picking row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { lineSlices: slicesOf(lineWrites, 250), lineCount: lineWrites.length, headerRows: headWrites, needHeaders: headWrites.length ? "YES" : "NO",
    result_message: lineWrites.length + " Picking row(s), " + headWrites.length + " Picking header(s) to close" });
};
const res = commitC4PPlan([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc4pintent.data}}][0], [{{node:sql_node_CCc4ppick.data}}][0], [{{node:sql_node_CCc4prows.data}}][0]);
console.log("commit C4P plan", JSON.stringify({ route: res.route, intent: res.needIntent, lines: res.lineCount, headers: res.headerRows.length, result: res.result_code, message: res.result_message }));
return res;
