// IA_V2_COMMIT - I4 FINISH (phase B; runs once I3 is DONE): Item last_transaction_date for the ITEMS part's ids (parent first,
// every component, non-stock included) in slices of 250 with one new Date().toISOString() per pass (code_item_txn's value),
// then the header { item_assembly_status Completed, posted_status Unposted } - that write ends the Processing lock. Header
// Completed under this job -> done (nothing written again); Processing under this job -> write; anything else -> REQUIRES_REVIEW
const i4Entry = (entry) => Object.assign({}, entry, { progress: 85, progressMessage: P80 });
const commitI4Plan = function commitI4Plan(entry0, itemPartRows, ownerRows) {
  const entry = i4Entry(entry0);
  const base = Object.assign({ route: "GO", statusRows: [], needStatus: "NO", itemSlices: [], itemCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "",
    job_status: "COMMITTING_IA" }, END_EMPTY);
  const items = iaJoinChunks(itemPartRows, entry.partPrefix + "ITEMS|");
  if (!items || typeof items !== "object" || !Array.isArray(items.itemDates)) return Object.assign(base, reviewEnd(entry, "I4_FINISH", "IA_RECONCILIATION_MISMATCH", "the ITEMS part of the prepared payload is missing"));
  const o = list(ownerRows)[0] || {};
  const keyed = s(o.ia_id) === entry.iaId && s(o.ia_v2_job_id) === entry.jobId && s(o.lock_ref) !== "" && s(o.lock_ref) === entry.idempotencyKey;
  if (keyed && s(o.item_assembly_status) === "Completed") return Object.assign(base, { result_message: "the Item Assembly is already Completed" });
  if (!(keyed && s(o.item_assembly_status) === "Processing")) {
    return Object.assign(base, reviewEnd(entry, "I4_FINISH", "IA_RECONCILIATION_MISMATCH", "the Item Assembly is " + (s(o.item_assembly_status) || "missing (deleted?)") + " (job " + s(o.ia_v2_job_id)
      + ", lock " + s(o.lock_ref) + "), neither Processing under this job nor Completed"));
  }
  const now = new Date().toISOString();
  const ids = items.itemDates.map((x) => s(x && typeof x === "object" ? x.id : x)).filter((x, i, a) => digits(x) && a.indexOf(x) === i);
  const dates = ids.map((id) => ({ id: id, last_transaction_date: now }));
  return Object.assign(base, { statusRows: [{ id: entry.iaId, item_assembly_status: "Completed", posted_status: "Unposted" }], needStatus: "YES", itemSlices: slicesOf(dates, 250),
    itemCount: dates.length, result_message: "Item Assembly " + entry.iaNo + " -> Completed; " + dates.length + " item date(s)" });
};
const commitI4Check = function commitI4Check(entry0, ownerRows) {
  const entry = i4Entry(entry0);
  const o = list(ownerRows)[0] || {};
  if (s(o.item_assembly_status) !== "Completed" || s(o.ia_v2_job_id) !== entry.jobId) {
    return stepEnd(entry, "I4_FINISH", "the Item Assembly reads back as " + (s(o.item_assembly_status) || "missing") + " under job " + (s(o.ia_v2_job_id) || "(none)") + ", not Completed", false);
  }
  return stepOk(entry, "I4_FINISH", "Completed / " + s(o.stock_movement_no), "Item Assembly Completed");
};
const res = __CALL__;
console.log("commit I4", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
