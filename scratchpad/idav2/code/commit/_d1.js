// D1 helpers (d1_plan, d1_decide, d1_check): the BATCH part's checks (D1 table row 1), the intent's (row 2), the configs' forward-only
// rule (GR c1_decide) and the Batch row an insert writes (ADD_INVENTORY v65 add_node_F9KqZLfd's 11 columns)
const D1_KINDS = ["AUTO", "TYPED"];
const d1PartProblem = function d1PartProblem(entry, part) {
  if (!part || typeof part !== "object") return "the BATCH part of the prepared payload is missing or unreadable";
  if (s(part.mode) !== "insert") return "the BATCH part is mode " + (s(part.mode) || "(none)") + ", not insert";
  if (!Array.isArray(part.rows) || !part.rows.length) return "the BATCH part has no row";
  if (part.items !== undefined && !Array.isArray(part.items)) return "the BATCH part's items are not a list";
  const seen = {};
  for (const r of part.rows) {
    if (!r || typeof r !== "object" || !s(r.key)) return "a BATCH row without a key";
    const k = s(r.key);
    if (seen[k]) return "BATCH row " + k + " is listed twice";
    seen[k] = true;
    if (D1_KINDS.indexOf(s(r.kind)) < 0) return "BATCH row " + k + " has no kind (" + (s(r.kind) || "none") + ")";
    if (s(r.kind) === "TYPED" && s(r.batch_number) === "") return "TYPED BATCH row " + k + " has no number";
    if (!digits(r.material_id) || !digits(r.plant_id)) return "BATCH row " + k + "'s material / plant is not an id";
    if (s(r.organization_id) !== entry.organizationId) return "BATCH row " + k + " is of organization " + s(r.organization_id);
    if (s(r.transaction_no) !== entry.idaNo) return "BATCH row " + k + "'s transaction_no " + s(r.transaction_no) + " is not " + entry.idaNo;
    if (!Array.isArray(r.line_ids) || !r.line_ids.length) return "BATCH row " + k + " names no line";
  }
  return "";
};
// the recorded intent covers every AUTO row with a number (an earlier pass of this job wrote it from this same part)
const d1IntentProblem = function d1IntentProblem(part, intent) {
  if (!intent || typeof intent !== "object" || !intent.numbers || typeof intent.numbers !== "object" || !Array.isArray(intent.configs)) return "the recorded D1|I| intent cannot be read";
  const gap = part.rows.filter((r) => s(r.kind) === "AUTO" && !s(intent.numbers[s(r.key)])).map((r) => s(r.key));
  if (gap.length) return "the recorded D1|I| intent has no number for AUTO row(s) " + gap.slice(0, 5).join(", ");
  return "";
};
const configsOf = function configsOf(bncRows) {
  const fresh = {};
  for (const o of idaRows(bncRows)) if (o && digits(o.id)) fresh[s(o.id)] = o;
  return fresh;
};
const cfgAt = (cur, x) => num(cur.running_number) === num(x.running_number) && s(cur.last_reset_date) === s(x.last_reset_date);
// a running number never goes back: write the after-state unless the row holds it or has moved past it (GR c1_decide)
const cfgWrite = function cfgWrite(cur, c) {
  const ahead = s(cur.last_reset_date) > s(c.after.last_reset_date) || (s(cur.last_reset_date) === s(c.after.last_reset_date) && num(cur.running_number) >= num(c.after.running_number));
  if (cfgAt(cur, c.after) || (!cfgAt(cur, c.before) && ahead)) return null;
  return { id: s(c.id), running_number: num(c.after.running_number),
    last_reset_date: c.after.last_reset_date === undefined || c.after.last_reset_date === null ? (cur.last_reset_date === undefined ? null : cur.last_reset_date) : c.after.last_reset_date };
};
const cfgBehind = (cur, c) => s(cur.last_reset_date) < s(c.after.last_reset_date) || (s(cur.last_reset_date) === s(c.after.last_reset_date) && num(cur.running_number) < num(c.after.running_number));
const batchRowOf = function batchRowOf(entry, r, numbers) {
  const val = (v) => (v === undefined ? null : v);
  return { batch_number: plannedNumber(r, numbers), material_id: s(r.material_id), initial_quantity: idaQtyStr(r.initial_quantity), transaction_no: entry.idaNo, plant_id: s(r.plant_id),
    organization_id: s(r.organization_id), remark: val(r.remark), remark2: val(r.remark2), remark3: val(r.remark3), manufacturing_date: r.manufacturing_date || null,
    expired_date: r.expired_date || null };
};
// the intent's gd_publish_step rows (D1|I|nnn, step_status INTENT), STEP_PROPS-shaped
const intentRowsOf = function intentRowsOf(entry, intent) {
  return idaPartRows(entry.jobId, entry.organizationId, "D1|I|", intent, "INTENT").map((r) => Object.assign(r, { started_at: entry.dbNow, finished_at: null, inventory_operation_id: "",
    error_code: null, error_message: null }));
};
// rows 4 / 6 / 10 renumber instead of failing (user decision 10-22) while every taken number is only a generated one of this job
const IDA_BATCH_RENUMBER_TRIES = 5;
const d1Taken = function d1Taken(planRows, numbers, foreign) {
  const byKey = {};
  for (const r of list(planRows)) {
    const n = plannedNumber(r, numbers);
    if (s(n) === "") continue;
    const k = "#" + idaBatchKey(n);
    const e = (byKey[k] = byKey[k] || { number: n, typed: false });
    if (s(r.kind) !== "AUTO") e.typed = true;
  }
  const out = { numbers: [], auto: foreign.length > 0 };
  const seen = {};
  for (const o of foreign) {
    const e = byKey["#" + idaBatchKey(o.batch_number)];
    if (!e || e.typed) out.auto = false;
    const n = e ? e.number : s(o.batch_number);
    if (!seen["#" + n]) { seen["#" + n] = true; out.numbers.push(n); }
  }
  return out;
};
const d1Retired = (intentRows) => list(intentRows).filter((r) => digits(r.id) && s(r.step_name).indexOf("D1|I|") === 0);
const d1MayRenumber = (entry, taken) => taken.auto && entry.opWrote !== "YES" && num(entry.attempts) < IDA_BATCH_RENUMBER_TRIES;
const d1CanRenumber = (entry, taken, intentRows) => d1MayRenumber(entry, taken) && d1Retired(intentRows).length > 0;
// row 4 (no intent, nothing of ours yet): only holders created after this job was queued (a concurrent writer; ids as digit text)
const d1CanRenumberNew = (entry, taken, holders) => d1MayRenumber(entry, taken) && holders.length > 0 && holders.every((o) => idaIdAfter(o.id, entry.jobId));
// the job whose colliding Batch row is the oldest goes first (5 s), every other after 20-30 s - racing jobs agree from the same rows
// (ids as digit text); no colliding row of ours (row 4), a tie or an unknown id: the long wait
const d1Wait = function d1Wait(holders, ours, foreign) {
  const keys = {};
  for (const o of foreign) keys["#" + idaBatchKey(o.batch_number)] = true;
  const mine = setOf(list(ours).map(s));
  const own = list(holders).filter((o) => mine[s(o.id)] && keys["#" + idaBatchKey(o.batch_number)]).map((o) => s(o.id)).filter(digits).sort(byIdOrder);
  const first = own.length > 0 && foreign.length > 0 && foreign.every((o) => idaIdAfter(o.id, own[0]));
  return first ? { seconds: 5, reason: "short" } : { seconds: 20 + Math.floor(Math.random() * 11), reason: "long" };
};
// ours soft-deleted -> the intent renamed D1|X|<id> + soft-deleted (Job Step keeps deleted rows: its name is freed) -> the job due after `wait`
const d1Renumber = function d1Renumber(entry, taken, why, ours, intentRows, wait) {
  const k = num(entry.attempts) + 1;
  const del = uniq(list(ours).map(s).filter(digits)).map((x) => ({ id: x, is_deleted: 1 }));
  const gone = d1Retired(intentRows).map((r) => ({ id: s(r.id), step_name: "D1|X|" + s(r.id), is_deleted: 1 }));
  const text = "D1_BATCH: batch number " + taken.numbers[0] + " was taken by another document at the same moment - renumbering (try " + k + " of " + IDA_BATCH_RENUMBER_TRIES + ")";
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: k, next_attempt_at: idaDbAddSeconds(endNow(entry), wait.seconds),
    error_code: "IDA_BATCH_RETRY", error_message: text.slice(0, 1000), error_details: JSON.stringify({ step: "D1_BATCH", why: s(why).slice(0, 4000), numbers: taken.numbers.slice(0, 100),
      wait: wait.seconds, waitReason: wait.reason }) })],
  needJobUpd: "YES", batchDelSlices: slicesOf(del, SLICE), needBatchDel: del.length ? "YES" : "NO", intentDelSlices: slicesOf(gone, SLICE), needIntentDel: gone.length ? "YES" : "NO",
  result_code: "IDA_BATCH_RETRY", result_message: text + " - due in " + wait.seconds + " s (" + wait.reason + ")", job_status: "COMMITTING_IDA" });
};
