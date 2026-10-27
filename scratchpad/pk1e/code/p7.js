// PICKING_BULK_COMMIT - P7 AUTO COMPLETE GD (Picking V2 stage 1e, 2026-10-27). After P6 - the job COMPLETED and the Picking
// unlocked earlier in this run, so GD_COMPLETE_SUBMIT's open-Picking-job fact sees this job closed - each delivery this Picking
// left fully picked and still Created goes to GD Complete V2 (source PICKING, needCL auto: classic PICKING's GOODS_DELIVERY call).
// One step row P7|<gd> per delivery records the answer; STATUS returns them and the desktop screens start GD_COMPLETE_WORKER.
const P7_MAX_GDS = 25;
const P7_MANUAL = ": complete it from the Goods Delivery list";
const p7S = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const p7List = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r && typeof r === "object");
const p7Row = function p7Row(entry, gdId, status, jobId, code, message) {
  return { job_id: p7S(entry.jobId), organization_id: p7S(entry.organizationId), step_name: "P7|" + gdId, step_status: status, attempt_count: 1,
    started_at: p7S(entry.dbNow), finished_at: p7S(entry.dbNow), inventory_operation_id: "", result_ref: p7S(jobId).slice(0, 500),
    error_code: code ? p7S(code).slice(0, 100) : null, error_message: message ? p7S(message).slice(0, 1000) : null };
};
// rows: sql_node_PCp7gds - the Picking's deliveries, read only while the organization's Auto Complete GD is on
const p7Plan = function p7Plan(entry, rows) {
  const items = [];
  const direct = [];
  for (const r of p7List(rows)) {
    const gd = p7S(r.gd_id);
    if (!/^[0-9]{1,20}$/.test(gd) || p7S(r.p7)) continue;
    if (p7S(r.gd_status) !== "Created" || p7S(r.picking_status) !== "Completed") continue;
    if (p7S(r.open_job)) direct.push(p7Row(entry, gd, "QUEUED", r.open_job, "ALREADY_QUEUED", "its completion is already queued"));
    else if (items.length >= P7_MAX_GDS) direct.push(p7Row(entry, gd, "NOT_QUEUED", "", "P7_TOO_MANY", "more than " + P7_MAX_GDS + " deliveries finished in one Picking" + P7_MANUAL));
    else items.push({ gd_id: gd, delivery_no: p7S(r.delivery_no), operation: "SUBMIT", source: "PICKING", answers: { needCL: "auto" }, causation_id: "PICKING|" + p7S(entry.jobId) });
  }
  return { items: items, needLoop: items.length ? "YES" : "NO", directRows: direct, needDirect: direct.length ? "YES" : "NO",
    plannedSql: items.length ? items.map((i) => i.gd_id).join(",") : "0" };
};
// GD_COMPLETE_SUBMIT's answer (route / code / message / job_id) -> the delivery's P7 row. BUSY on its own open completion
// ("already being completed", job_id = that job) is the same queued job; anything else waits for a manual completion
const p7Answer = function p7Answer(entry, item, ans) {
  const a = ans && typeof ans === "object" ? ans : {};
  const route = p7S(a.route), code = p7S(a.code || a.result_code), msg = p7S(a.message || a.result_message), job = p7S(a.job_id);
  const gd = p7S((item || {}).gd_id);
  if (route === "QUEUED" && job) return { rows: [p7Row(entry, gd, "QUEUED", job, "", "")] };
  if (route === "BUSY" && job && /already being completed/i.test(msg)) return { rows: [p7Row(entry, gd, "QUEUED", job, "ALREADY_QUEUED", msg)] };
  return { rows: [p7Row(entry, gd, "NOT_QUEUED", "", (route + " " + code).trim() || "NO_ANSWER", (msg || "GD_COMPLETE_SUBMIT gave no answer") + P7_MANUAL)] };
};
// after the loop - a caught failure ends it: each planned delivery still without a P7 row gets one from a fresh read, the
// completion open now (this run's call before the failure, or a sibling Picking's) or NOT_QUEUED
const p7Fill = function p7Fill(entry, plan, backRows, crashed) {
  const back = {};
  for (const r of p7List(backRows)) back[p7S(r.gd_id)] = r;
  const rows = [];
  for (const gd of p7List((plan || {}).items).map((i) => p7S(i.gd_id))) {
    const b = back[gd] || {};
    if (p7S(b.p7)) continue;
    rows.push(p7S(b.open_job)
      ? p7Row(entry, gd, "QUEUED", b.open_job, "ALREADY_QUEUED", "its completion is queued")
      : p7Row(entry, gd, "NOT_QUEUED", "", crashed ? "CALL_FAILED" : "NO_ANSWER", "the completion request " + (crashed ? "failed" : "got no answer") + P7_MANUAL));
  }
  return { fillRows: rows, needFill: rows.length ? "YES" : "NO" };
};
