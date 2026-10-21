// GR_COMPLETE_COMMIT - C2 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; GRC|<job> makes a re-run replay it).
// 200 -> DONE + the SPLIT hand-over (phase B in the next run); 409 lock busy -> retry (nothing moved); 400 -> FAILED, the
// receipt back to its status before the submit, this job's batch rows soft-deleted (the engine wrote nothing); else review
const commitC2 = function commitC2(entry, guard, input, eng, batchRows) {
  const ours = list(batchRows).map((r) => parseJ(r.j)).filter((o) => o && o.id).map((o) => s(o.id));
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GRC_INVALID_DATA", s(input.why) || "the inventory part of the prepared payload is missing", ours);
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") {
    const ok = stepOk(entry, "C2_INVENTORY", s(eng.result_code) + " " + s(eng.message), "inventory " + s(eng.result_code));
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock received; updating the purchase orders and the putaway", lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  }
  if (code === "409") return stepWait(entry, "C2_INVENTORY", why, 10);
  if (code === "400") return failNoWrite(entry, "GRC_INVENTORY_" + (s(eng.result_code) || "FAILED"), why, ours);
  return stepEnd(entry, "C2_INVENTORY", why, true);
};
const eng = { code: [{{node:workflow_node_RCc2.data.code}}][0], result_code: [{{node:workflow_node_RCc2.data.result_code}}][0], message: [{{node:workflow_node_RCc2.data.message}}][0] };
const res = commitC2([{{node:code_node_RCentry.data}}][0], [{{node:code_node_RCguard.data}}][0], { ok: [{{node:code_node_RCc2in.data.ok}}][0], why: [{{node:code_node_RCc2in.data.why}}][0] }, eng, [{{node:sql_node_RCc2batch.data}}][0]);
console.log("commit C2", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
