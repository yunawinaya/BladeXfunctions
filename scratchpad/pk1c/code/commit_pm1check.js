// PICKING_BULK_COMMIT 1c - PM1 STOCK: INVENTORY_BULK_APPLY's answer to APPLY PKM|<job> (all-or-nothing; a re-run replays it),
// as GD Edit V2's E1: 200 -> DONE; 400 -> FAILED + unlock (the engine wrote nothing); 409 lock busy -> wait (a PM1_WAIT|<n>
// row counts it, so the other steps keep their retries; 15 s, 30 s, 60 s, 120 s), then FAILED, only while the operation has
// no intent row (IBA|I|*), else retry -> review; anything else -> REQUIRES_REVIEW.
const PM_LOCK_WAITS = 4;
const commitPM1Check = function commitPM1Check(entry, inp, eng) {
  const i = inp || {};
  const g = eng || {};
  if (pmS(i.needCall) !== "YES") return pmOk(entry, "PM1_STOCK", "no stock movement", "no stock to move");
  const code = pmS(g.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + pmS(g.result_code) + (pmS(g.message) ? ": " + pmS(g.message) : "");
  if (code === "200") return pmOk(entry, "PM1_STOCK", pmS(g.result_code) + " " + pmS(g.message), "stock moved (" + pmS(g.result_code) + ")", pmS(entry.moveOpKey));
  if (code === "409") {
    if (Number(i.intents) > 0) return pmEnd(entry, "PM1_STOCK", why, false);
    const w = Number(entry.pm1Waits) || 0;
    if (w >= PM_LOCK_WAITS) return pmFail(entry, "PK_INVENTORY_LOCK_BUSY", "the stock of these items stayed locked by another operation: nothing was saved, confirm again later");
    return Object.assign({}, PM_END, { route: "END", jobRows: [pmJob(entry, { progress_message: "Waiting for the stock to be free", next_attempt_at: pmDbAddSeconds(entry.dbNow, Math.min(120, 15 * Math.pow(2, w))),
      error_code: "PK_LOCK_WAIT", error_message: ("PM1_STOCK: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "PM1_STOCK", wait: w + 1 }) })], needJobUpd: "YES",
      waitRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "PM1_WAIT|" + (w + 1), step_status: "WAIT", attempt_count: 1, started_at: entry.dbNow,
        finished_at: endNow(entry), inventory_operation_id: "", result_ref: why.slice(0, 500), error_code: null, error_message: null }], needWait: "YES",
      result_code: "PK_LOCK_WAIT", result_message: "PM1_STOCK: the stock is locked by another operation - wait " + (w + 1) + " of " + PM_LOCK_WAITS, job_status: "COMMITTING_PICKING" });
  }
  if (code === "400") return pmFail(entry, "PK_INVENTORY_" + (pmS(g.result_code) || "FAILED"), why);
  return pmEnd(entry, "PM1_STOCK", why, true);
};
const res = commitPM1Check([{{node:code_node_PCentry.data}}][0], { needCall: [{{node:code_node_PCpm1in.data.needCall}}][0], intents: [{{node:code_node_PCpm1in.data.intents}}][0] },
  { code: [{{node:workflow_node_PCpm1.data.code}}][0], result_code: [{{node:workflow_node_PCpm1.data.result_code}}][0], message: [{{node:workflow_node_PCpm1.data.message}}][0] });
console.log("commit PM1", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
