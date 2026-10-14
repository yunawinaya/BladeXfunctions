// GD_COMPLETE_COMMIT - C2 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDC|<job> makes a re-run replay it).
// 200 -> DONE + the SPLIT hand-over (phase B in the next run); 409 lock busy -> retry; 400 -> FAILED, GD back to Created
// (the engine wrote nothing); anything else -> REQUIRES_REVIEW
const commitC2 = function commitC2(entry, guard, input, eng) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GDC_INVALID_DATA", "the inventory part of the prepared payload is missing");
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") {
    const ok = stepOk(entry, "C2_INVENTORY", s(eng.result_code) + " " + s(eng.message), "inventory " + s(eng.result_code));
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock delivered; updating the sales orders and the delivery", lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  }
  if (code === "409") return stepEnd(entry, "C2_INVENTORY", why, false);
  if (code === "400") return failNoWrite(entry, "GDC_INVENTORY_" + (s(eng.result_code) || "FAILED"), why);
  return stepEnd(entry, "C2_INVENTORY", why, true);
};
const eng = { code: [{{node:workflow_node_CCc2.data.code}}][0], result_code: [{{node:workflow_node_CCc2.data.result_code}}][0], message: [{{node:workflow_node_CCc2.data.message}}][0] };
const res = commitC2([{{node:code_node_CCentry.data}}][0], [{{node:code_node_CCguard.data}}][0], { ok: [{{node:code_node_CCc2in.data.ok}}][0] }, eng);
console.log("commit C2", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
