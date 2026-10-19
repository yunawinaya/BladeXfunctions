// PICKING_BULK_PREPARE 1c - Move plan: every moved GD's re-plan read back from its part rows. Each GD needs an OK verdict;
// no reservation may be planned by two GDs (both would write the same row); the movements of every GD form the one
// INVENTORY_BULK_APPLY operation of the job (PKM|<job>), planned next when there is stock to move.
const prepareMovePlan = function prepareMovePlan(entry, move, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const out = { route: "FAIL", needEngine: "NO", operationKey: "PKM|" + s(entry.jobId), organizationId: s(entry.organizationId), movements: [], counts: {}, gdIds: [],
    result_code: "", result_message: "" };
  const fail = (code, message) => Object.assign(out, { route: "FAIL", result_code: code, result_message: message });
  const text = {};
  for (const r of list(rows)) {
    const p = s(r.step_name).split("|");
    if (p.length !== 5) continue;
    const k = p[2] + "|" + p[3];
    text[k] = (text[k] || "") + (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref));
  }
  const part = (name, gi) => {
    const t = text[name + "|" + gi];
    if (t === undefined) return undefined;
    try { return JSON.parse(t); } catch (e) { return undefined; }
  };
  const seen = {};
  let updates = 0, creates = 0;
  for (const call of list(move.gdCalls)) {
    const gi = s(call.gi);
    const v = part("VRD", gi);
    if (!v) return fail("PK_REPLAN", "the re-plan of a moved delivery did not finish (" + s(call.gd_id) + ")");
    if (s(v.verdict) !== "OK") return fail("PK_REPLAN", "Goods Delivery " + (s(v.gd_no) || s(call.gd_id)) + ": " + s(v.verdict));
    const eng = part("ENG", gi);
    const res = part("RES", gi);
    if (!Array.isArray(eng) || !res) return fail("PK_REPLAN", "the re-plan of Goods Delivery " + (s(v.gd_no) || s(call.gd_id)) + " is incomplete");
    for (const u of list(res.updates)) {
      if (seen[s(u.id)]) return fail("PK_REPLAN", "reservation " + s(u.id) + " would be changed by two deliveries at once (" + seen[s(u.id)] + ", " + (s(v.gd_no) || s(call.gd_id)) + "); confirm them separately");
      seen[s(u.id)] = s(v.gd_no) || s(call.gd_id);
    }
    updates += list(res.updates).length;
    creates += list(res.creates).length;
    out.movements = out.movements.concat(eng);
    out.gdIds.push(s(call.gd_id));
  }
  out.counts = { gds: out.gdIds.length, lines: Number(move.lineCount || 0), movements: out.movements.length, reservation_updates: updates, reservation_creates: creates };
  return Object.assign(out, { route: "OK", needEngine: out.movements.length ? "YES" : "NO",
    result_message: "re-planned " + out.gdIds.length + " deliver(ies): " + out.movements.length + " stock movement(s), " + updates + " reservation update(s), " + creates + " new" });
};
const res = prepareMovePlan({ jobId: [{{node:code_node_PPentry.data.jobId}}][0], organizationId: [{{node:code_node_PPentry.data.organizationId}}][0] },
  { gdCalls: [{{node:code_node_PPmove.data.gdList}}][0], lineCount: [{{node:code_node_PPmove.data.lineCount}}][0] }, [{{node:sql_node_PPmvparts.data}}][0]);
console.log("prepare move plan", JSON.stringify({ route: res.route, counts: res.counts, result: res.result_code, message: res.result_message }));
return res;
