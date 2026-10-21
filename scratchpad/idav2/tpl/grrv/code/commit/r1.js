// GR_REVERT_COMMIT - R1 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; GRV|<job> makes a re-run replay it).
// 200 (or nothing to take back) -> DONE + the SPLIT hand-over (phase B in the next run); 409 lock busy -> retry (nothing
// moved); 400 -> FAILED, the receipt back to its status before the submit (the engine wrote nothing); else review
const commitR1 = function commitR1(entry, guard, input, eng) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GRV_INVALID_DATA", (s(input.why) || "the inventory part of the prepared payload is missing") + ": no stock was moved");
  const split = (ref) => {
    const ok = stepOk(entry, "R1_INVENTORY", ref, "inventory " + ref);
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock taken back; restoring costing, documents and purchase orders", lease_owner: "SPLIT|" + guard.nonce,
      lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  };
  if (s(input.call) !== "YES") return split("no stock to take back");
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") return split(s(eng.result_code) + " " + s(eng.message));
  if (code === "409") return stepWait(entry, "R1_INVENTORY", why, 10);
  if (code === "400") return failNoWrite(entry, "GRV_INVENTORY_" + (s(eng.result_code) || "FAILED"), why);
  return stepEnd(entry, "R1_INVENTORY", why, true);
};
const eng = { code: [{{node:workflow_node_VCr1.data.code}}][0], result_code: [{{node:workflow_node_VCr1.data.result_code}}][0], message: [{{node:workflow_node_VCr1.data.message}}][0] };
const res = commitR1([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCguard.data}}][0], { ok: [{{node:code_node_VCr1in.data.ok}}][0], why: [{{node:code_node_VCr1in.data.why}}][0],
  call: [{{node:code_node_VCr1in.data.call}}][0] }, eng);
console.log("commit R1", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
