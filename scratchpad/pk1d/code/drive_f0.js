// PICKING_FC_DRIVE - F0 (once, before any delivery is touched): the Picking, its rows, its records and its deliveries'
// statuses are still what PREPARE planned against -> FC_F0; else FC_ABORT PK_FC_STALE (nothing was touched: the job ends
// FAILED and the Picking unlocked on the next iteration)
const driveF0 = function driveF0(entry, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v) || 0;
  const all = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((x) => x);
  const of = (k) => all.filter((r) => s(r.kind) === k);
  const p = of("P")[0] || {};
  const agg = of("A")[0] || {};
  const fp = entry.fp || {};
  const why = [];
  if (!s(p.id) || s(p.a) === "1") why.push("the Picking was deleted");
  else if (s(p.status) !== s(entry.snapToStatus)) why.push("the Picking is " + (s(p.status) || "without a status") + " now");
  if (fcRowsFingerprint(of("R").map((r) => ({ id: s(r.id), line_status: s(r.status) }))) !== s(fp.rowsFp)) why.push("its lines changed");
  if (num(agg.a) !== num(fp.recCount) || Math.abs(num(agg.b) - num(fp.recSum)) > 1e-6 || s(agg.c) !== s(fp.recMaxId)) why.push("its picked records changed");
  const now = {};
  for (const g of of("G")) now[s(g.id)] = s(g.status);
  const changed = Object.keys(entry.snapGds || {}).filter((id) => s(now[id]) !== s(entry.snapGds[id]));
  if (changed.length) why.push(changed.length + " of its deliveries changed status");
  const dbNow = s((all[0] || {}).db_now) || entry.dbNow;
  const step = (name, ref) => [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: name, step_status: "DONE", attempt_count: 1, started_at: dbNow, finished_at: dbNow,
    inventory_operation_id: "", result_ref: ref, error_code: null, error_message: null }];
  if (why.length) {
    return { ok: "NO", stepRows: step("FC_ABORT", "PK_FC_STALE|" + entry.pickingNo + " changed since the force complete was prepared (" + why.join("; ") + "): nothing was saved. Try again."),
      result_message: why.join("; ") };
  }
  return { ok: "YES", stepRows: step("FC_F0", "unchanged since PREPARE"), result_message: "unchanged since PREPARE" };
};
const res = driveF0([{{node:code_node_DRentry.data}}][0], [{{node:sql_node_DRf0.data}}][0]);
console.log("drive f0", JSON.stringify({ ok: res.ok, message: res.result_message }));
return res;
