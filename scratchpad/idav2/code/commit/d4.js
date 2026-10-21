// IDA_V2_COMMIT - D4 FINISH (phase B; runs once D3 is DONE): (1) every AUTO row's generated number into its lines' batch_number where
// the stored value differs (the line collection, slices of 250 - GR C1B), (2) Item last_transaction_date for the ITEMS part's ids
// (the source first, every recovery item, non-stock included; slices of 250, one new Date().toISOString() per pass), (3) the header
// { item_disassembly_status Completed, posted_status Unposted } LAST - that write ends the Processing lock. Completed under this job with
// every AUTO line numbered -> done (nothing written again); Processing under this job -> write; anything else -> REQUIRES_REVIEW
const d4Entry = (entry, note) => Object.assign({}, entry, { progress: 85, progressMessage: (P80 + noteText(note, entry.skipNote)).slice(0, 250) });
// the AUTO rows' lines and the numbers D1 recorded (BATCH part + D1 intent); null = unreadable
const autoTargets = function autoTargets(entry, partRows, intentRows) {
  if (entry.batchMode !== "insert") return [];
  const part = idaJoinChunks(partRows, entry.partPrefix + "BATCH|");
  const intent = idaJoinChunks(intentRows, "D1|I|");
  if (!part || typeof part !== "object" || !Array.isArray(part.rows) || !intent || typeof intent !== "object" || !intent.numbers || typeof intent.numbers !== "object") return null;
  const out = [];
  for (const r of part.rows) if (r && s(r.kind) === "AUTO") for (const id of list(r.line_ids)) out.push({ id: s(id), n: s(intent.numbers[s(r.key)]) });
  return out.some((t) => !digits(t.id) || t.n === "") ? null : out;
};
const commitD4Plan = function commitD4Plan(entry0, itemPartRows, ownerRows, lineRows, partRows, intentRows, note) {
  const entry = d4Entry(entry0, note);
  const base = Object.assign({ route: "GO", lineSlices: [], lineCount: 0, itemSlices: [], itemCount: 0, statusRows: [], needStatus: "NO", targets: [], needLines: "NO", jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_IDA" }, END_EMPTY);
  const review = (why) => Object.assign(base, reviewEnd(entry, "D4_FINISH", "IDA_RECONCILIATION_MISMATCH", why));
  const items = idaJoinChunks(itemPartRows, entry.partPrefix + "ITEMS|");
  if (!items || typeof items !== "object" || !Array.isArray(items.itemDates)) return review("the ITEMS part of the prepared payload is missing");
  const targets = autoTargets(entry, partRows, intentRows);
  if (targets === null) return review("the BATCH part or the D1 intent cannot be read: the generated batch numbers are unknown");
  const cur = {};
  for (const o of idaRows(lineRows)) cur[s(o.id)] = o;
  const gone = targets.filter((t) => !cur[t.id]).map((t) => t.id);
  if (gone.length) return review(gone.length + " recovery line(s) of an AUTO batch are gone (" + gone.slice(0, 5).join(", ") + ")");
  const writes = targets.filter((t) => (cur[t.id].batch_number === undefined || cur[t.id].batch_number === null ? "" : String(cur[t.id].batch_number)) !== t.n).map((t) => ({ id: t.id, batch_number: t.n }));
  base.targets = targets;
  base.needLines = targets.length ? "YES" : "NO";
  const o = list(ownerRows)[0] || {};
  const keyed = s(o.ida_id) === entry.idaId && s(o.ida_v2_job_id) === entry.jobId && s(o.lock_ref) !== "" && s(o.lock_ref) === entry.idempotencyKey;
  if (keyed && s(o.item_disassembly_status) === "Completed" && !writes.length) return Object.assign(base, { result_message: "the Item Disassembly is already Completed" });
  if (!(keyed && s(o.item_disassembly_status) === "Processing")) {
    return review("the Item Disassembly is " + (s(o.item_disassembly_status) || "missing (deleted?)") + " (job " + s(o.ida_v2_job_id) + ", lock " + s(o.lock_ref) + ")"
      + (writes.length ? " with " + writes.length + " AUTO line(s) not numbered" : "") + ", neither Processing under this job nor Completed");
  }
  const now = new Date().toISOString();
  const ids = uniq(items.itemDates.map((x) => s(x && typeof x === "object" ? x.id : x)).filter(digits));
  const dates = ids.map((id) => ({ id: id, last_transaction_date: now }));
  return Object.assign(base, { lineSlices: slicesOf(writes, SLICE), lineCount: writes.length, itemSlices: slicesOf(dates, SLICE), itemCount: dates.length,
    statusRows: [{ id: entry.idaId, item_disassembly_status: "Completed", posted_status: "Unposted" }], needStatus: "YES",
    result_message: "Item Disassembly " + entry.idaNo + " -> Completed; " + writes.length + " line number(s), " + dates.length + " item date(s)" });
};
const commitD4Check = function commitD4Check(entry0, plan, ownerRows, lineRows, note) {
  const entry = d4Entry(entry0, note);
  const o = list(ownerRows)[0] || {};
  if (s(o.item_disassembly_status) !== "Completed" || s(o.ida_v2_job_id) !== entry.jobId) {
    return stepEnd(entry, "D4_FINISH", "the Item Disassembly reads back as " + (s(o.item_disassembly_status) || "missing") + " under job " + (s(o.ida_v2_job_id) || "(none)") + ", not Completed", false);
  }
  const cur = {};
  for (const r of idaRows(lineRows)) cur[s(r.id)] = r;
  const off = list(plan.targets).filter((t) => !cur[s(t.id)] || String(cur[s(t.id)].batch_number === undefined || cur[s(t.id)].batch_number === null ? "" : cur[s(t.id)].batch_number) !== s(t.n));
  if (off.length) return stepEnd(entry, "D4_FINISH", off.length + " AUTO line(s) without their generated batch number after the write (e.g. " + s(off[0].id) + ")", false);
  return stepOk(entry, "D4_FINISH", "Completed / " + s(o.stock_movement_no), "Item Disassembly Completed");
};
const res = __CALL__;
console.log("commit D4", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
