// PUTAWAY_BULK_COMMIT - P1 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; PWC|<job> makes a re-run replay it).
// 200 -> DONE + the SPLIT hand-over (phase B in the next run); 409 lock busy -> wait (nothing moved); 400 -> FAILED, the
// putaway released (the engine wrote nothing); else review
const commitP1 = function commitP1(entry, guard, input, eng) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "PWC_INVALID_DATA", s(input.why) || "the inventory part of the prepared payload is missing");
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") {
    const ok = stepOk(entry, "P1_INVENTORY", s(eng.result_code) + " " + s(eng.message), "inventory " + s(eng.result_code));
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock moved; updating the putaway and the in-transit ledger", lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  }
  if (code === "409") return stepWait(entry, "P1_INVENTORY", why, 10);
  if (code === "400") return failNoWrite(entry, "PWC_INVENTORY_" + (s(eng.result_code) || "FAILED"), why);
  return stepEnd(entry, "P1_INVENTORY", why, true);
};
const eng = { code: [{{node:workflow_node_PCp1.data.code}}][0], result_code: [{{node:workflow_node_PCp1.data.result_code}}][0], message: [{{node:workflow_node_PCp1.data.message}}][0] };
const res = commitP1([{{node:code_node_PCentry.data}}][0], [{{node:code_node_PCguard.data}}][0], { ok: [{{node:code_node_PCp1in.data.ok}}][0], why: [{{node:code_node_PCp1in.data.why}}][0] }, eng);
console.log("commit P1", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
