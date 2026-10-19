// node test/submit/test_submit.js - the SUBMIT matrix of the BUILT SA_V2_SUBMIT (Stock Adjustment/AsyncV2/SA_V2_SUBMIT.json) on the
// interpreter (lib/sim/engine.js) against test/submit/sadb.js: every action's write order and read-back answer, twins, BUSY,
// STALE, NOT_ELIGIBLE / SA_TOO_BIG, the 5,000 limit, number reuse, every gate, STATUS per job state, INVALID requests, the
// queue-failed answer, and a 2,000-line REVIEW node-data estimate. The review chain is package A's code/shared/review_chain.js.
const path = require("path");
const H = require(path.join(__dirname, "..", "..", "lib", "harness.js"));
const { Engine } = require(path.join(__dirname, "..", "..", "lib", "sim", "engine.js"));
const { SADB, mocks } = require("./sadb.js");
const F = require("./fixtures.js");
const FP = require(path.join(__dirname, "..", "..", "code", "shared", "fingerprint.js"));
const { ORG, PLANT, PLANT2, RULE, ITEM, BIN, BATCH, ent, line, saForm, storeSa, storeSc } = F;

const DIR = path.join(__dirname, "..", "..", "..", "..", "Stock Adjustment", "AsyncV2");
const fresh = () => F.seed(new SADB());
let keyN = 0;
const newKey = (tag) => "SA:" + ORG + ":" + (tag || "t") + ":0123456789abcdef:" + ++keyN;
// the engine, measuring what code nodes receive (the JSON text their placeholders inject) beside what every node outputs
class MeasuredEngine extends Engine {
  injectJs(text, ctx) {
    const out = super.injectJs(text, ctx);
    this.injected = (this.injected || 0) + Math.max(0, out.length - text.length);
    return out;
  }
}
const run = (db, p) => {
  const eng = new MeasuredEngine({ dir: DIR, db: db, mocks: mocks() });
  const r = eng.run("SA_V2_SUBMIT", p);
  return { ans: r.returned || {}, ctx: r.ctx, eng: eng };
};
// the client sends all 12 request keys on every call ("" when unused)
const formP = (form, o) => Object.assign({ operation: "SUBMIT", source: "FORM", saveAs: "Completed", pageStatus: form.id ? "Edit" : "Add", sa_id: form.id || "", sc_id: "",
  idempotency_key: newKey("f"), form: form, organization_id: "", nickname: "", adjustment_date: "", create_adjustment: "" }, o || {});
const statusP = (o) => Object.assign({ operation: "STATUS", source: "FORM", saveAs: "", pageStatus: "", sa_id: "", sc_id: "", idempotency_key: "", form: "", organization_id: "",
  nickname: "", adjustment_date: "", create_adjustment: "" }, o || {});
const reviewP = (form, o) => Object.assign({ operation: "SUBMIT", source: "REVIEW", saveAs: "", pageStatus: "Edit", sc_id: form.id, sa_id: "", idempotency_key: newKey("r"),
  form: form, organization_id: ORG, nickname: "Reviewer", adjustment_date: "2026-10-16", create_adjustment: "Yes" }, o || {});
const job0 = (db) => db.t.job[db.t.job.length - 1];
const req0 = (db) => JSON.parse(job0(db).request_payload);
const sa0 = (db) => db.t.sa[db.t.sa.length - 1];
const pick = (a, keys) => {
  const o = {};
  for (const k of keys) o[k] = a[k];
  return o;
};
const short = (log) => log.map((l) => l.replace(/[0-9]{12,}/g, "<id>"));
const noWrites = (label, db, before) => H.eq(label + ": nothing written", db.log.slice(before.length), []);

// ------------------------------------------------------------------------------------------------- DIRECT (FORM Add)
{
  const db = fresh();
  const p = formP(saForm());
  const r = run(db, p);
  const sa = sa0(db);
  const job = job0(db);
  const req = req0(db);
  H.eq("DIRECT answer", pick(r.ans, ["route", "code", "action", "sa_id", "sa_no", "job_id", "job_status", "terminal", "line_count", "error_code"]),
    { route: "QUEUED", code: "200", action: "DIRECT", sa_id: sa.id, sa_no: "SA/20261016/0001", job_id: job.id, job_status: "QUEUED", terminal: "NO", line_count: "2",
      error_code: "" });
  H.eq("DIRECT write order", short(db.log), ["job+ COMPLETE_SA QUEUED corr=", "sa+ Processing lines=2", "step+ SAC|<id> LOCK|1",
    "job~ causation_id,correlation_id,request_payload", "job~ next_attempt_at"]);
  H.eq("DIRECT job", pick(job, ["command", "job_status", "correlation_id", "causation_id", "organization_id", "plant_id", "line_count", "idempotency_key"]),
    { command: "COMPLETE_SA", job_status: "QUEUED", correlation_id: "SA|" + sa.id, causation_id: sa.id, organization_id: ORG, plant_id: PLANT, line_count: 2,
      idempotency_key: p.idempotency_key });
  H.eq("DIRECT due now (inserted 120 s ahead)", job.next_attempt_at, db.now);
  H.eq("DIRECT SA header", pick(sa, ["stock_adjustment_status", "sa_v2_job_id", "sa_idem_key", "adjustment_no_type", "posted_status", "adjustment_type", "plant_id"]),
    { stock_adjustment_status: "Processing", sa_v2_job_id: job.id, sa_idem_key: p.idempotency_key, adjustment_no_type: RULE, posted_status: "Unposted",
      adjustment_type: "Write Off", plant_id: PLANT });
  const lines = db.t.sal.filter((l) => l.stock_adjustment_id === sa.id && !l.is_deleted);
  H.eq("DIRECT lines (filled back)", lines.map((l) => [l.line_index, l.plant_id, l.unit_price, l.total_quantity]), [[1, PLANT, 5, "3"], [2, PLANT, 5, "2"]]);
  const lock = db.t.step.find((s) => s.job_id === "SAC|" + sa.id);
  H.eq("DIRECT lock", pick(lock, ["step_name", "step_status", "result_ref", "organization_id"]), { step_name: "LOCK|1", step_status: "LOCK", result_ref: p.idempotency_key,
    organization_id: ORG });
  const fp = FP.saLineFingerprint(lines);
  H.eq("DIRECT request", pick(req, ["v", "source", "action", "prevStatus", "saveAs", "pageStatus", "saId", "saNo", "issuedNo", "scId", "lineFingerprint", "incomingFingerprint",
    "edited", "scFingerprint", "organizationId", "plantId", "lineCount", "entryCount", "movementCount", "source_form", "parts"]),
  { v: 1, source: "FORM", action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Add", saId: sa.id, saNo: "SA/20261016/0001", issuedNo: "SA/20261016/0001",
    scId: "", lineFingerprint: fp, incomingFingerprint: fp, edited: 0, scFingerprint: "", organizationId: ORG, plantId: PLANT, lineCount: 2, entryCount: 2, movementCount: 2,
    source_form: "SA", parts: {} });
  H.truthy("DIRECT nonce", /^[0-9A-Za-z]{8}$/.test(req.nonce), req.nonce);
  // twin click: the same key again -> this job's STATUS, nothing written
  const before = db.log.slice();
  const t = run(db, Object.assign({}, p));
  H.eq("twin click -> STATUS", pick(t.ans, ["route", "code", "job_id", "job_status", "sa_id", "sa_no", "terminal", "action", "line_count"]),
    { route: "STATUS", code: "200", job_id: job.id, job_status: "QUEUED", sa_id: sa.id, sa_no: "SA/20261016/0001", terminal: "NO", action: "DIRECT", line_count: "2" });
  noWrites("twin click", db, before);
  // a twin that read before the job existed: its job insert loses (unique Idempotency Key) and its run fails
  const db2 = fresh();
  const p2 = formP(saForm());
  const a = run(db2, p2);
  db2.factsSnapshot = a.ctx.out.sql_node_SSfacts;
  let err = "";
  try {
    run(db2, Object.assign({}, p2));
  } catch (e) {
    err = e.message;
  }
  H.truthy("racing twin click: its job insert fails", /Idempotency Key/.test(err), err);
  H.eq("racing twin click: one job, one SA", [db2.t.job.length, db2.t.sa.length], [1, 1]);
}

// ------------------------------------------------------------------------------------------------- Clone (= Add, ids stripped)
{
  const db = fresh();
  const src = storeSa(db, { status: "Completed", no: "SA/20261001/0009" });
  const form = Object.assign({}, src, { page_status: "Clone" });
  const before = db.t.sal.map((l) => l.id);
  const r = run(db, formP(form, { pageStatus: "Clone", sa_id: "" }));
  const sa = sa0(db);
  H.eq("Clone answer", pick(r.ans, ["route", "action"]), { route: "QUEUED", action: "DIRECT" });
  H.truthy("Clone is a new SA with new line ids", sa.id !== src.id && db.t.sal.filter((l) => l.stock_adjustment_id === sa.id).every((l) => before.indexOf(l.id) < 0));
  H.eq("Clone request pageStatus Add, a new number", [req0(db).pageStatus, sa.adjustment_no], ["Add", "SA/20261016/0001"]);
  const srcNow = db.t.sa.find((x) => x.id === src.id);
  H.eq("Clone never touches the source SA", [srcNow.stock_adjustment_status, srcNow.adjustment_no, srcNow.sa_v2_job_id || null,
    db.t.sal.filter((l) => l.stock_adjustment_id === src.id && !l.is_deleted).map((l) => l.id), db.t.step.filter((x) => x.job_id === "SAC|" + src.id).length],
  ["Completed", "SA/20261001/0009", null, before, 0]);
  H.truthy("Clone payload carried the source ids (stripped by SUBMIT)", form.id === src.id && form.stock_adjustment.every((l) => before.indexOf(l.id) >= 0));
  H.eq("Copy = Clone", run(fresh(), formP(saForm(), { pageStatus: "Copy" })).ans.route, "QUEUED");
}

// ------------------------------------------------------------------------------------------------- COMPLETE (stored Draft)
{
  const db = fresh();
  const form = storeSa(db);
  const storedFp = FP.saLineFingerprint(db.t.sal.filter((l) => l.stock_adjustment_id === form.id));
  db.t.step.push({ id: db.id(), job_id: "SAC|" + form.id, step_name: "LOCK|3", step_status: "LOCK", result_ref: "SA:old:key:000000001", started_at: db.now - 3600000,
    is_deleted: 0 });
  const p = formP(form);
  const r = run(db, p);
  const job = job0(db);
  const req = req0(db);
  const sa = db.t.sa.find((x) => x.id === form.id);
  H.eq("COMPLETE answer", pick(r.ans, ["route", "code", "action", "sa_id", "sa_no", "job_id"]),
    { route: "QUEUED", code: "200", action: "COMPLETE", sa_id: form.id, sa_no: "SA/20261016/0001", job_id: job.id });
  H.eq("COMPLETE write order", short(db.log), ["step+ SAC|<id> LOCK|4", "job+ COMPLETE_SA QUEUED corr=SA|<id>", "step+ S|*|DOC|001",
    "sa~ adjustment_no,adjustment_no_type,sa_v2_job_id,stock_adjustment_status", "job~ causation_id,correlation_id,request_payload", "job~ next_attempt_at"]);
  H.eq("COMPLETE header", pick(sa, ["stock_adjustment_status", "sa_v2_job_id", "adjustment_no"]), { stock_adjustment_status: "Processing", sa_v2_job_id: job.id,
    adjustment_no: "SA/20261016/0001" });
  H.eq("COMPLETE request", pick(req, ["action", "prevStatus", "pageStatus", "saId", "saNo", "issuedNo", "lineFingerprint", "incomingFingerprint", "edited", "entryCount"]),
    { action: "COMPLETE", prevStatus: "Draft", pageStatus: "Edit", saId: form.id, saNo: "SA/20261016/0001", issuedNo: "SA/20261016/0001", lineFingerprint: storedFp,
      incomingFingerprint: storedFp, edited: 0, entryCount: 2 });
  const part = db.t.step.find((s) => s.job_id === job.id && /^S\|/.test(s.step_name));
  H.eq("COMPLETE parts named in the request", req.parts, { DOC: [part.step_name] });
  const doc = JSON.parse(part.result_ref);
  H.eq("COMPLETE DOC part", { keys: Object.keys(doc), header: Object.keys(doc.header), lines: doc.lines.length, fp: doc.fingerprint, saId: doc.saId },
    { keys: ["v", "saId", "header", "lines", "fingerprint"], header: ["plant_id", "adjustment_date", "adjustment_type", "stock_count_id", "adjusted_by", "organization_id",
      "project_id", "acc_integration_type", "reference_documents", "adjustment_remarks", "adjustment_remarks2", "adjustment_remarks3", "posted_status"], lines: 2, fp: storedFp,
    saId: form.id });
  H.eq("COMPLETE never writes the lines", db.t.sal.filter((l) => l.stock_adjustment_id === form.id && !l.is_deleted).length, 2);
}
// COMPLETE with edits -> edited 1 (the incoming fingerprint is the DOC lines')
{
  const db = fresh();
  const form = storeSa(db);
  form.stock_adjustment[0] = Object.assign({}, form.stock_adjustment[0], { total_quantity: 4, balance_index: JSON.stringify([ent(ITEM.A, BIN.b1, 4, "In")]) });
  run(db, formP(form));
  const req = req0(db);
  H.eq("COMPLETE edited", [req.edited, req.lineFingerprint !== req.incomingFingerprint], [1, true]);
}
// number reuse: the stored number is an earlier COMPLETE_SA job's issuedNo -> no number props, nothing burned
{
  const db = fresh();
  const form = storeSa(db, { no: "SA/20261016/0042" });
  db.t.job.push({ id: db.id(), organization_id: ORG, command: "COMPLETE_SA", idempotency_key: "SA:old:1:aaaaaaaaaaaaaaaa:1", job_status: "FAILED", correlation_id: "SA|" + form.id,
    request_payload: JSON.stringify({ v: 1, action: "COMPLETE", issuedNo: "SA/20261016/0042", saNo: "SA/20261016/0042" }), is_deleted: 0 });
  const r = run(db, formP(form));
  H.eq("number reuse answer", pick(r.ans, ["route", "sa_no"]), { route: "QUEUED", sa_no: "SA/20261016/0042" });
  H.truthy("number reuse: header without the number props", short(db.log).indexOf("sa~ sa_v2_job_id,stock_adjustment_status") >= 0, short(db.log));
  H.eq("number reuse: issuedNo empty, number kept", [req0(db).issuedNo, db.numSeq], ["", 0]);
}
// manual number (-9999): written as typed, no number issued
{
  const db = fresh();
  const form = storeSa(db, { no: "MAN-001", noType: -9999 });
  form.adjustment_no = "MAN-002";
  const r = run(db, formP(form));
  H.eq("manual number", [r.ans.route, r.ans.sa_no, req0(db).issuedNo, db.numSeq], ["QUEUED", "MAN-002", "", 0]);
}

// ------------------------------------------------------------------------------------------------- REVIEW (a NEW SA from a Stock Count)
{
  const db = fresh();
  const form = storeSc(db);
  const scFp = FP.scLineFingerprint(db.t.scl.filter((l) => l.stock_count_id === form.id));
  const p = reviewP(form);
  const r = run(db, p);
  const sa = sa0(db);
  const job = job0(db);
  const req = req0(db);
  H.eq("REVIEW answer", pick(r.ans, ["route", "code", "action", "sa_id", "sa_no", "sc_id", "job_id", "line_count"]),
    { route: "QUEUED", code: "200", action: "REVIEW", sa_id: sa.id, sa_no: "SA/20261016/0001", sc_id: form.id, job_id: job.id, line_count: "2" });
  H.eq("REVIEW write order", short(db.log), ["step+ SCR|<id> LOCK|1", "job+ COMPLETE_SA QUEUED corr=", "sa+ Processing lines=0", "step+ SAC|<id> LOCK|1", "step+ S|*|SC|001",
    "job~ causation_id,correlation_id,request_payload", "job~ next_attempt_at"]);
  H.eq("REVIEW SA header", pick(sa, ["stock_adjustment_status", "adjustment_no", "adjustment_no_type", "stock_count_id", "adjustment_type", "adjusted_by", "adjustment_date",
    "plant_id", "organization_id", "posted_status", "adjustment_remarks", "sa_v2_job_id", "sa_idem_key"]),
  { stock_adjustment_status: "Processing", adjustment_no: "SA/20261016/0001", adjustment_no_type: RULE, stock_count_id: form.id, adjustment_type: "Stock Count",
    adjusted_by: "Reviewer", adjustment_date: "2026-10-16", plant_id: PLANT, organization_id: ORG, posted_status: "Unposted", adjustment_remarks: "sc remark",
    sa_v2_job_id: job.id, sa_idem_key: p.idempotency_key });
  H.eq("REVIEW writes no SA line", db.t.sal.filter((l) => l.stock_adjustment_id === sa.id).length, 0);
  const part = db.t.step.find((s) => s.job_id === job.id && /^S\|/.test(s.step_name));
  H.eq("REVIEW request", pick(req, ["source", "action", "prevStatus", "saveAs", "saId", "saNo", "issuedNo", "scId", "lineFingerprint", "scFingerprint", "createAdjustment",
    "nickname", "adjustmentDate", "organizationId", "plantId", "lineCount", "entryCount", "movementCount", "source_form", "parts"]),
  { source: "REVIEW", action: "REVIEW", prevStatus: "Cancelled", saveAs: "Completed", saId: sa.id, saNo: "SA/20261016/0001", issuedNo: "SA/20261016/0001", scId: form.id,
    lineFingerprint: FP.saLineFingerprint([]), scFingerprint: scFp, createAdjustment: "Yes", nickname: "Reviewer", adjustmentDate: "2026-10-16", organizationId: ORG,
    plantId: PLANT, lineCount: 2, entryCount: 2, movementCount: 2, source_form: "SC", parts: { SC: [part.step_name] } });
  H.truthy("REVIEW incomingFingerprint = the built lines'", /^SAF1:2:[0-9a-f]{16}$/.test(req.incomingFingerprint), req.incomingFingerprint);
  H.eq("REVIEW SC part = the incoming SC record", JSON.parse(part.result_ref), JSON.parse(JSON.stringify(form)));
  H.eq("REVIEW: the SC SCR lock is this key", db.t.step.find((s) => s.job_id === "SCR|" + form.id).result_ref, p.idempotency_key);
  // the same click again -> STATUS; another user's review now -> BUSY (the open job names the SC)
  H.eq("REVIEW twin click -> STATUS", run(db, Object.assign({}, p)).ans.route, "STATUS");
  const b = run(db, reviewP(form));
  H.eq("REVIEW while its job is open -> BUSY", pick(b.ans, ["route", "code", "error_code", "job_id"]), { route: "BUSY", code: "409", error_code: "SA_SC_BUSY", job_id: job.id });
}
// REVIEW: createAdjustment decides when not every line is approved; all approved needs no confirmation
{
  const db = fresh();
  const sc = storeSc(db);
  H.eq("review, not all approved, createAdjustment empty -> NOT_ELIGIBLE (classic marks nothing)", pick(run(db, reviewP(sc, { create_adjustment: "" })).ans, ["route", "reason"]),
    { route: "NOT_ELIGIBLE", reason: "no adjustment" });
  const db2 = fresh();
  const sc2 = storeSc(db2, { lines: [{ material: ITEM.A, bin: BIN.b1, variance: 3 }, { material: ITEM.B, bin: BIN.b2, variance: -2 }] });
  const r2 = run(db2, reviewP(sc2, { create_adjustment: "" }));
  H.eq("review, all approved, createAdjustment empty -> QUEUED", [r2.ans.route, req0(db2).createAdjustment], ["QUEUED", ""]);
}
// REVIEW: a built line of more than 50 entries is split (the shared chain's saSplitLines); counts follow the split
{
  const db = fresh();
  const scl = [];
  for (let i = 0; i < 120; i++) {
    const bin = String(2290000000000000000n + BigInt(i));
    db.t.bins.push({ id: bin, bin_location_combine: "Z-" + i, plant_id: PLANT });
    scl.push({ material: ITEM.A, bin: bin, variance: 1 });
  }
  const r = run(db, reviewP(storeSc(db, { lines: scl })));
  const req = req0(db);
  H.eq("review split: 120 entries of one group -> 3 lines", [r.ans.route, req.lineCount, req.entryCount, r.ans.line_count], ["QUEUED", 3, 120, "3"]);
}
// COMPLETE of a Draft made by a classic review (stock_count_id set): the request names its SC (A3 parity)
{
  const db = fresh();
  const sc = storeSc(db);
  const form = storeSa(db, { scId: sc.id, extra: { stock_count_id: sc.id, adjustment_type: "Stock Count" } });
  const r = run(db, formP(form));
  H.eq("COMPLETE of a review's Draft names its SC", [r.ans.route, req0(db).scId, req0(db).source], ["QUEUED", sc.id, "FORM"]);
}
// twin review: B read the facts before A wrote anything -> B's SCR LOCK|1 insert loses (unique Job Step) and its run fails;
// B's next try -> BUSY
{
  const db = fresh();
  const form = storeSc(db);
  const a = run(db, reviewP(form));
  H.eq("twin review: A queued", a.ans.route, "QUEUED");
  const pb = reviewP(form);
  db.factsSnapshot = a.ctx.out.sql_node_SSfacts;
  let err = "";
  try {
    run(db, pb);
  } catch (e) {
    err = e.message;
  }
  H.truthy("twin review: B's SCR insert fails its run", /Job Step/.test(err), err);
  H.eq("twin review: one job, one SA", [db.t.job.length, db.t.sa.length], [1, 1]);
  H.eq("twin review: B again -> BUSY", pick(run(db, pb).ans, ["route", "error_code"]), { route: "BUSY", error_code: "SA_SC_BUSY" });
}
// a review lock still in flight (younger than 120 s, no job yet) -> BUSY; an old one, or one whose job failed -> goes on
{
  const db = fresh();
  const form = storeSc(db);
  db.t.step.push({ id: db.id(), job_id: "SCR|" + form.id, step_name: "LOCK|1", step_status: "LOCK", result_ref: "SCR:x:y:inflight0001:1", started_at: db.now - 30000, is_deleted: 0 });
  H.eq("young SCR lock without a job -> BUSY", pick(run(db, reviewP(form)).ans, ["route", "error_code"]), { route: "BUSY", error_code: "SA_SC_BUSY" });
  db.advance(150);
  const r = run(db, reviewP(form));
  H.eq("old SCR lock -> goes on with LOCK|2", [r.ans.route, db.t.step.filter((s) => s.job_id === "SCR|" + form.id).map((s) => s.step_name)], ["QUEUED", ["LOCK|1", "LOCK|2"]]);
}

// ------------------------------------------------------------------------------------------------- BUSY (FORM)
{
  const db = fresh();
  const form = storeSa(db, { status: "Processing" });
  form.stock_adjustment_status = "Processing";
  H.eq("stored Processing -> BUSY", pick(run(db, formP(form)).ans, ["route", "code", "error_code"]), { route: "BUSY", code: "409", error_code: "SA_BUSY" });
  const db2 = fresh();
  const f2 = storeSa(db2);
  const jid = db2.id();
  db2.t.job.push({ id: jid, organization_id: ORG, command: "COMPLETE_SA", idempotency_key: "SA:o:k:bbbbbbbbbbbbbbbb:1", job_status: "VALIDATING", correlation_id: "SA|" + f2.id,
    progress_percent: 10, progress_message: "Preparing", request_payload: "{}", is_deleted: 0 });
  H.eq("open job -> BUSY with that job", pick(run(db2, formP(f2)).ans, ["route", "error_code", "job_id", "job_status", "progress_percent"]),
    { route: "BUSY", error_code: "SA_BUSY", job_id: jid, job_status: "VALIDATING", progress_percent: "10" });
  db2.t.job[db2.t.job.length - 1].job_status = "REQUIRES_REVIEW";
  H.eq("REQUIRES_REVIEW job -> BUSY under review", pick(run(db2, formP(f2)).ans, ["route", "error_code"]), { route: "BUSY", error_code: "SA_UNDER_REVIEW" });
  const db3 = fresh();
  const f3 = storeSa(db3);
  db3.t.step.push({ id: db3.id(), job_id: "SAC|" + f3.id, step_name: "LOCK|1", step_status: "LOCK", result_ref: "SA:x:y:inflight0002:1", started_at: db3.now - 5000, is_deleted: 0 });
  H.eq("young SAC lock without a job -> BUSY", pick(run(db3, formP(f3)).ans, ["route", "error_code"]), { route: "BUSY", error_code: "SA_BUSY" });
  db3.t.job.push({ id: db3.id(), organization_id: ORG, command: "COMPLETE_SA", idempotency_key: "SA:x:y:inflight0002:1", job_status: "FAILED", correlation_id: "SA|" + f3.id,
    request_payload: "{}", is_deleted: 0 });
  H.eq("young SAC lock whose job FAILED -> goes on (LOCK|2)", [run(db3, formP(f3)).ans.route, db3.t.step.filter((s) => s.job_id === "SAC|" + f3.id).length], ["QUEUED", 2]);
}
// BUSY (REVIEW): a Processing SA of this SC
{
  const db = fresh();
  const form = storeSc(db);
  storeSa(db, { status: "Processing", scId: form.id });
  H.eq("SC has a Processing SA -> BUSY", pick(run(db, reviewP(form)).ans, ["route", "error_code"]), { route: "BUSY", error_code: "SA_SC_BUSY" });
}

// BUSY (FORM, controller ruling): the SA names a Stock Count that has ANOTHER Processing SA / an open REVIEW / a review lock in flight
{
  const scBusy = (label, setup, o) => {
    const db = fresh();
    const sc = storeSc(db);
    const own = storeSa(db, { scId: sc.id, extra: { stock_count_id: sc.id, adjustment_type: "Stock Count" } });
    setup(db, sc, own);
    const before = db.log.slice();
    const p = o && o.add ? formP(saForm({ extra: { stock_count_id: sc.id } })) : formP(own);
    const r = run(db, p);
    H.eq(label, pick(r.ans, ["route", "code", "error_code", "sa_id"]), { route: "BUSY", code: "409", error_code: "SA_SC_BUSY", sa_id: o && o.add ? "" : own.id });
    noWrites(label, db, before);
    return r;
  };
  scBusy("COMPLETE, its SC has another Processing SA -> SA_SC_BUSY", (db, sc) => storeSa(db, { status: "Processing", scId: sc.id }));
  scBusy("DIRECT naming an SC with a Processing SA -> SA_SC_BUSY", (db, sc) => storeSa(db, { status: "Processing", scId: sc.id }), { add: true });
  const r = scBusy("COMPLETE, an open REVIEW job on its SC (no SA yet) -> SA_SC_BUSY", (db, sc) => db.t.job.push({ id: db.id(), organization_id: ORG, command: "COMPLETE_SA",
    idempotency_key: "SCR:x:" + sc.id + ":eeeeeeeeeeeeeeee:1", job_status: "QUEUED", correlation_id: "", progress_percent: 0, progress_message: "Queued for processing",
    request_payload: JSON.stringify({ v: 1, source: "REVIEW", action: "REVIEW", scId: sc.id }), is_deleted: 0 }));
  H.truthy("  the BUSY answer names the review's job", /^[0-9]+$/.test(r.ans.job_id) && r.ans.job_status === "QUEUED", r.ans);
  scBusy("COMPLETE, a review lock in flight on its SC -> SA_SC_BUSY", (db, sc) => db.t.step.push({ id: db.id(), job_id: "SCR|" + sc.id, step_name: "LOCK|1",
    step_status: "LOCK", result_ref: "SCR:x:y:inflight0003:1", started_at: db.now - 10000, is_deleted: 0 }));
  // not busy: the other SA is Completed; an open FORM job of another SA of the SC (not a review); no stock_count_id at all
  const db = fresh();
  const sc = storeSc(db);
  const own = storeSa(db, { scId: sc.id, extra: { stock_count_id: sc.id } });
  storeSa(db, { status: "Completed", scId: sc.id });
  db.t.job.push({ id: db.id(), organization_id: ORG, command: "COMPLETE_SA", idempotency_key: "SA:o:f:ffffffffffffffff:1", job_status: "QUEUED", correlation_id: "SA|1",
    request_payload: JSON.stringify({ v: 1, source: "FORM", action: "COMPLETE", scId: sc.id }), is_deleted: 0 });
  H.eq("COMPLETE, its SC has only a Completed SA and a FORM job -> QUEUED", [run(db, formP(own)).ans.route, req0(db).scId], ["QUEUED", sc.id]);
  const db2 = fresh();
  const sc2 = storeSc(db2);
  storeSa(db2, { status: "Processing", scId: sc2.id });
  H.eq("DIRECT without a stock_count_id ignores the SC -> QUEUED", run(db2, formP(saForm())).ans.route, "QUEUED");
  const db3 = fresh();
  const sc3 = storeSc(db3);
  const own3 = storeSa(db3, { scId: sc3.id });
  storeSa(db3, { status: "Processing", scId: sc3.id });
  H.eq("COMPLETE: the STORED stock_count_id counts when the form omits it -> SA_SC_BUSY", pick(run(db3, formP(own3)).ans, ["route", "error_code"]),
    { route: "BUSY", error_code: "SA_SC_BUSY" });
}

// ------------------------------------------------------------------------------------------------- STALE
{
  for (const st of ["Completed", "Fully Posted", "Pending Post", "Cancelled"]) {
    const db = fresh();
    const form = storeSa(db, { status: st });
    form.stock_adjustment_status = st;
    H.eq("stored " + st + " -> STALE already final", pick(run(db, formP(form)).ans, ["route", "code", "error_code", "message"]),
      { route: "STALE", code: "409", error_code: "SA_ALREADY_FINAL", message: "This Stock Adjustment is already " + st + "." });
  }
  const db = fresh();
  const form = storeSa(db, { status: "Completed" });
  form.stock_adjustment_status = "Draft";
  H.eq("payload Draft, stored Completed -> STALE", pick(run(db, formP(form)).ans, ["route", "error_code"]), { route: "STALE", error_code: "SA_STALE" });
  const db2 = fresh();
  const sc = storeSc(db2);
  H.eq("SC status changed -> STALE", pick(run(db2, reviewP(Object.assign({}, sc, { stock_count_status: "Completed" }))).ans, ["route", "error_code"]),
    { route: "STALE", error_code: "SA_SC_STALE" });
  H.eq("SC review status changed -> STALE", pick(run(db2, reviewP(Object.assign({}, sc, { review_status: "Completed" }))).ans, ["route", "error_code"]),
    { route: "STALE", error_code: "SA_SC_STALE" });
  db2.t.scl.find((l) => l.id === sc.table_stock_count[0].id).line_status = "Adjusted";
  const before = db2.log.slice();
  const st = run(db2, reviewP(sc));
  H.eq("stored line Adjusted, shown Approved -> STALE", pick(st.ans, ["route", "code", "error_code"]), { route: "STALE", code: "409", error_code: "SA_SC_STALE" });
  noWrites("stale review", db2, before);
}

// ------------------------------------------------------------------------------------------------- NOT_ELIGIBLE (<= 500) / SA_TOO_BIG (> 500)
{
  const ne = (label, form, why, o) => {
    const db = o && o.db ? o.db : fresh();
    const r = run(db, formP(form, o && o.p));
    H.eq(label, pick(r.ans, ["route", "code", "error_code", "reason"]), { route: "NOT_ELIGIBLE", code: "300", error_code: "SA_NOT_ELIGIBLE", reason: why });
    H.eq(label + ": nothing written", db.log, []);
  };
  ne("serialized line", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1)], { is_serialized_item: 1 })] }), "it has serial-numbered items");
  ne("serial item", saForm({ lines: [line(ITEM.SER, [ent(ITEM.SER, BIN.b1, 1)])] }), "it has serial-numbered items");
  ne("handling unit entry", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1, "In", { handling_unit_id: "77" })])] }), "it has handling units");
  ne("Reserved category", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1, "Out", { category: "Reserved" })])] }), "it moves Reserved stock");
  ne("costing records waiting for migration", saForm({ lines: [line(ITEM.MIG, [ent(ITEM.MIG, BIN.b1, 1, "Out")])] }),
    "it has items whose costing records are waiting for migration");
  ne("nothing to move", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 0)])] }), "it has no stock to adjust");
  const db = fresh();
  const form = storeSa(db, { status: "In Progress" });
  form.stock_adjustment_status = "In Progress";
  ne("a status the background save does not take", form, "its status In Progress is not one the background save takes", { db: db });
  // Blocked / Quality Inspection / '' categories and stock_control 0 items go V2
  const ok = run(fresh(), formP(saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1, "In", { category: "Blocked" }), ent(ITEM.A, BIN.b1, 1, "In", { category: "Quality Inspection" }),
    ent(ITEM.A, BIN.b1, 1, "In", { category: "" })]), line(ITEM.NOSTK, [ent(ITEM.NOSTK, BIN.b1, 1, "Out")])] })));
  H.eq("Blocked / QI / blank categories and a stock_control 0 item -> V2", ok.ans.route, "QUEUED");
  // > 500 entries that are not eligible -> STOP SA_TOO_BIG
  const many = [];
  for (let i = 0; i < 501; i++) many.push(ent(ITEM.A, BIN.b1, 1));
  const big = run(fresh(), formP(saForm({ lines: [line(ITEM.A, many, { is_serialized_item: 1 })] })));
  H.eq("not eligible above 500 entries -> STOP SA_TOO_BIG", pick(big.ans, ["route", "code", "error_code"]), { route: "STOP", code: "400", error_code: "SA_TOO_BIG" });
  H.truthy("SA_TOO_BIG text", /501 entries .*at most 500 entries/.test(big.ans.message), big.ans.message);
  // REVIEW: no SA would be created / serial lines / no default rule / nothing left after the build
  const db2 = fresh();
  const sc = storeSc(db2, { lines: [{ material: ITEM.A, bin: BIN.b1, variance: 3, status: "Counted", review: "" }] });
  H.eq("review creates no SA -> NOT_ELIGIBLE", pick(run(db2, reviewP(sc)).ans, ["route", "reason"]), { route: "NOT_ELIGIBLE", reason: "no adjustment" });
  const db3 = fresh();
  const sc3 = storeSc(db3, { lines: [{ material: ITEM.A, bin: BIN.b1, variance: 3, serialized: true }] });
  H.eq("review serialized line -> NOT_ELIGIBLE", pick(run(db3, reviewP(sc3)).ans, ["route", "reason"]), { route: "NOT_ELIGIBLE", reason: "it has serial-numbered items" });
  const db4 = fresh();
  db4.t.rules = [];
  const sc4 = storeSc(db4);
  H.eq("review without a default numbering rule -> NOT_ELIGIBLE", pick(run(db4, reviewP(sc4)).ans, ["route", "reason"]),
    { route: "NOT_ELIGIBLE", reason: "no default Stock Adjustment numbering rule for this organization" });
  const db5 = fresh();
  const sc5 = storeSc(db5, { lines: [{ material: ITEM.A, bin: BIN.b1, variance: 0.000000001 }] });
  H.eq("review whose variances round to 0 -> NOT_ELIGIBLE", pick(run(db5, reviewP(sc5)).ans, ["route", "reason"]), { route: "NOT_ELIGIBLE", reason: "no adjustment" });
  const db6 = fresh();
  const lines6 = [];
  for (let i = 0; i < 501; i++) lines6.push({ material: ITEM.A, bin: BIN.b1, variance: 1, serialized: i === 0 });
  const r6 = run(db6, reviewP(storeSc(db6, { lines: lines6 })));
  H.eq("review not eligible above 500 lines -> STOP SA_TOO_BIG", pick(r6.ans, ["route", "error_code"]), { route: "STOP", error_code: "SA_TOO_BIG" });
  H.truthy("review SA_TOO_BIG text", /501 approved lines with a variance/.test(r6.ans.message), r6.ans.message);
}

// ------------------------------------------------------------------------------------------------- the 5,000-entry limit
{
  const many = [];
  for (let i = 0; i < 5001; i++) many.push(ent(ITEM.A, BIN.b1, 1));
  const lines = [];
  for (let i = 0; i < 5001; i += 50) lines.push(line(ITEM.A, many.slice(i, i + 50)));
  const db = fresh();
  const r = run(db, formP(saForm({ lines: lines })));
  H.eq("5,001 entries -> STOP SA_SPLIT_REQUIRED", pick(r.ans, ["route", "code", "error_code"]), { route: "STOP", code: "400", error_code: "SA_SPLIT_REQUIRED" });
  H.eq("5,001 entries: nothing written", db.log, []);
  const db2 = fresh();
  const scl = [];
  for (let i = 0; i < 5001; i++) scl.push({ material: ITEM.A, bin: BIN.b1, variance: 1 });
  const r2 = run(db2, reviewP(storeSc(db2, { lines: scl })));
  H.eq("review of 5,001 variance lines -> STOP SA_SPLIT_REQUIRED", pick(r2.ans, ["route", "error_code"]), { route: "STOP", error_code: "SA_SPLIT_REQUIRED" });
  const ok = [];
  for (let i = 0; i < 5000; i += 50) ok.push(line(ITEM.A, many.slice(i, i + 50)));
  H.eq("5,000 entries -> QUEUED", run(fresh(), formP(saForm({ lines: ok }))).ans.route, "QUEUED");
}

// ------------------------------------------------------------------------------------------------- the gates
{
  const stop = (label, form, code, msg, p) => {
    const db = fresh();
    const r = run(db, p ? p(form) : formP(form));
    H.eq(label, pick(r.ans, ["route", "code", "error_code", "message"]), { route: "STOP", code: "400", error_code: code, message: msg });
    H.eq(label + ": nothing written", db.log, []);
  };
  stop("required fields (classic CHECK_REQUIRED_FIELD text)", saForm({ extra: { adjustment_type: "" } }), "SA_REQUIRED_FIELDS", "Validation Error: Adjustment Type");
  const nl = run(fresh(), formP(saForm({ lines: [] })));
  H.eq("no lines -> NOT_ELIGIBLE (eligibility comes before the gates; the classic answers its own required-field text)", pick(nl.ans, ["route", "reason"]),
    { route: "NOT_ELIGIBLE", reason: "it has no stock to adjust" });
  stop("invalid movement type", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1)]), line(ITEM.A, [ent(ITEM.A, BIN.b1, 1, "Adjust")])] }), "SA_INVALID_MOVEMENT_TYPE",
    "Invalid Movement Type - line 2");
  stop("a line with a quantity and no stock", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1)]), line(ITEM.A, [], { total_quantity: 4 })] }), "SA_LINES_WITHOUT_STOCK",
    "No stock selected for line 2. Select stock for every line before completing.");
  const fat = [];
  for (let i = 0; i < 130; i++) fat.push(ent(ITEM.A, BIN.b1, 1, "In", { create_time: "2026-10-01 13:39:04.569", update_time: "2026-10-01 15:24:00.215", tenant_id: "000000",
    create_user: "2098239805434880001", create_dept: "2098239805212581889", update_user: "2098239805434880001", balance_id: "2105532932065497090" }));
  const fatLine = line(ITEM.A, fat);
  const bytes = Buffer.byteLength(fatLine.balance_index, "utf8");
  H.truthy("fixture: the fat line is over 60,000 bytes", bytes > 60000, bytes);
  stop("a balance_index over 60,000 bytes", saForm({ lines: [fatLine] }), "SA_LINE_TOO_LARGE", "Line 1 holds too many bins (" + bytes + " bytes); split it into several lines.");
  const wa = "No Weighted Average costing record for item FG-A at this plant. The batch was most likely moved between plants without its costing record; create it for this "
    + "plant before issuing this stock.";
  stop("WA SUBTRACT without a WA row at the plant", saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1, "Out", { plant_id: PLANT2 })])] }), "SA_NO_WA_RECORD", wa);
  stop("WA batch SUBTRACT without the batch's WA row", saForm({ lines: [line(ITEM.BAT, [ent(ITEM.BAT, BIN.b1, 1, "Out", { batch_id: BATCH.y })])] }), "SA_NO_WA_RECORD",
    wa.replace("FG-A at this plant", "FG-BAT at this plant (batch " + BATCH.y + ")"));
  H.eq("WA batch SUBTRACT with its row -> QUEUED", run(fresh(), formP(saForm({ lines: [line(ITEM.BAT, [ent(ITEM.BAT, BIN.b1, 1, "Out", { batch_id: BATCH.x })])] }))).ans.route,
    "QUEUED");
  H.eq("movement type casing IN / out -> QUEUED", run(fresh(), formP(saForm({ lines: [line(ITEM.A, [ent(ITEM.A, BIN.b1, 1, "IN"), ent(ITEM.A, BIN.b1, 1, "out")])] }))).ans.route,
    "QUEUED");
  // REVIEW gates: the build's own error (classic 406 text), the SC's required fields
  const db = fresh();
  db.t.bal = [];
  const sc = storeSc(db);
  const r = run(db, reviewP(sc));
  H.eq("review build error -> STOP SA_REVIEW_BUILD_FAILED", pick(r.ans, ["route", "code", "error_code", "message"]),
    { route: "STOP", code: "400", error_code: "SA_REVIEW_BUILD_FAILED", message: "Stock Adjustment not created. item 02 @ A1-B2: no stock balance, cannot deduct 2" });
  H.eq("review build error: nothing written", db.log, []);
  const dbu = fresh();
  const scu = storeSc(dbu);
  scu.table_stock_count.push(Object.assign({}, scu.table_stock_count[0], { id: undefined, line_index: "4", location_id: BIN.b3 }));
  delete scu.table_stock_count[3].id;
  const ru = run(dbu, reviewP(scu));
  H.eq("review with an unsaved SC line -> STOP SA_SC_UNSAVED_LINES", pick(ru.ans, ["route", "code", "error_code", "message"]),
    { route: "STOP", code: "400", error_code: "SA_SC_UNSAVED_LINES", message: "This Stock Count has lines that are not saved yet - save the count, then review it." });
  H.eq("review with an unsaved SC line: nothing written", dbu.log, []);
  const db2 = fresh();
  const sc2 = storeSc(db2, { countType: "" });
  H.eq("review required fields", pick(run(db2, reviewP(sc2)).ans, ["route", "error_code", "message"]),
    { route: "STOP", error_code: "SA_REQUIRED_FIELDS", message: "Validation Error: Count Type" });
}

// ------------------------------------------------------------------------------------------------- STATUS
{
  const db = fresh();
  const form = storeSa(db);
  const st = (o) => run(db, statusP(Object.assign({ sa_id: form.id }, o || {}))).ans;
  H.eq("STATUS: no job -> NONE (terminal)", pick(st(), ["route", "code", "job_status", "terminal", "message"]),
    { route: "STATUS", code: "200", job_status: "NONE", terminal: "YES", message: "no background save" });
  for (const [state, terminal] of [["QUEUED", "NO"], ["VALIDATING", "NO"], ["READY_TO_COMMIT", "NO"], ["COMMITTING_SA", "NO"], ["COMPLETED", "YES"], ["FAILED", "YES"],
    ["REQUIRES_REVIEW", "YES"]]) {
    const jid = db.id();
    db.t.job.push({ id: jid, organization_id: ORG, command: "COMPLETE_SA", idempotency_key: "SA:s:" + state + ":cccccccccccccccc:1", job_status: state, correlation_id: "SA|" + form.id,
      progress_percent: state === "COMPLETED" ? 100 : 60, progress_message: "msg " + state, error_code: state === "FAILED" ? "SA_INVENTORY_INSUFFICIENT" : null,
      error_message: state === "FAILED" ? "Insufficient quantity" : null, request_payload: JSON.stringify({ action: "COMPLETE", saNo: "SA-DRAFT-0007" }), is_deleted: 0 });
    H.eq("STATUS " + state, pick(st(), ["route", "job_id", "job_status", "terminal", "action", "sa_id", "progress_percent", "error_code"]),
      { route: "STATUS", job_id: jid, job_status: state, terminal: terminal, action: "COMPLETE", sa_id: form.id, progress_percent: state === "COMPLETED" ? "100" : "60",
        error_code: state === "FAILED" ? "SA_INVENTORY_INSUFFICIENT" : "" });
  }
  const k = db.t.job[0].idempotency_key;
  H.eq("STATUS by key answers that job", st({ sa_id: "", idempotency_key: k }).job_id, db.t.job[0].id);
  // an Add whose job was never linked: the SA's sa_v2_job_id names it
  const db2 = fresh();
  const jid = db2.id();
  db2.t.job.push({ id: jid, organization_id: ORG, command: "COMPLETE_SA", idempotency_key: "SA:s:link:dddddddddddddddd:1", job_status: "QUEUED", correlation_id: "",
    request_payload: "{}", is_deleted: 0 });
  const f2 = storeSa(db2, { jobId: jid, status: "Processing" });
  H.eq("STATUS via sa_v2_job_id", run(db2, statusP({ sa_id: f2.id })).ans.job_id, jid);
  // (a) the SA form waiting for a NEW SA to be linked: sa_id "0", the submit's key
  H.eq("STATUS (a): sa_id 0 + key -> that job", pick(run(db2, statusP({ sa_id: "0", idempotency_key: "SA:s:link:dddddddddddddddd:1" })).ans, ["route", "job_id", "sa_id"]),
    { route: "STATUS", job_id: jid, sa_id: "" });
  // a review's job by sc_id
  const db3 = fresh();
  const sc = storeSc(db3);
  const q = run(db3, reviewP(sc));
  H.eq("STATUS by sc_id", pick(run(db3, statusP({ source: "REVIEW", sc_id: sc.id })).ans, ["route", "job_id", "sc_id", "sa_id", "action"]),
    { route: "STATUS", job_id: q.ans.job_id, sc_id: sc.id, sa_id: q.ans.sa_id, action: "REVIEW" });
  // (b) the SC form's Processing view: source REVIEW, the Processing SA's id, the sc_id, no key
  H.eq("STATUS (b): review by sa_id", pick(run(db3, statusP({ source: "REVIEW", sa_id: q.ans.sa_id, sc_id: sc.id })).ans, ["route", "job_id", "job_status", "sa_id", "sa_no"]),
    { route: "STATUS", job_id: q.ans.job_id, job_status: "QUEUED", sa_id: q.ans.sa_id, sa_no: q.ans.sa_no });
  H.eq("STATUS of an SA without jobs (its SC has one) -> no background save (sa_id rules, not the SC)",
    pick(run(db3, statusP({ source: "REVIEW", sa_id: "2104431462706188289", sc_id: sc.id })).ans, ["route", "job_status", "terminal", "message"]),
    { route: "STATUS", job_status: "NONE", terminal: "YES", message: "no background save" });
}

// ------------------------------------------------------------------------------------------------- INVALID / not found
{
  const inv = (label, p, why) => {
    const db = fresh();
    const r = run(db, p);
    H.eq("INVALID " + label, pick(r.ans, ["route", "code", "error_code"]), { route: "INVALID", code: "400", error_code: "SA_INVALID_REQUEST" });
    if (why) H.truthy("INVALID " + label + " says why", r.ans.message.indexOf(why) >= 0, r.ans.message);
    H.eq("INVALID " + label + ": nothing written", db.log, []);
  };
  const f = saForm();
  inv("operation", formP(f, { operation: "DELETE" }), "operation");
  inv("saveAs Draft", formP(f, { saveAs: "Draft" }), "saveAs");
  inv("View", formP(f, { pageStatus: "View" }), "View");
  inv("bad sa_id", formP(Object.assign({}, f, { id: "12a" }), { pageStatus: "Edit", sa_id: "12a" }), "sa_id");
  inv("Add with an sa_id", formP(f, { sa_id: "2104431462706188289" }), "sa_id");
  inv("key characters", formP(f, { idempotency_key: "bad key!!" }), "idempotency_key");
  inv("key too short", formP(f, { idempotency_key: "abc" }), "idempotency_key");
  inv("source", formP(f, { source: "LIST" }), "source");
  inv("form not a record", formP("x", { pageStatus: "Add", sa_id: "" }), "form");
  const dbx = fresh();
  const other = storeSa(dbx);
  const rx = run(dbx, formP(Object.assign({}, other, { id: "2104431462706188289" }), { pageStatus: "Edit", sa_id: other.id }));
  H.eq("INVALID Edit form of another SA", pick(rx.ans, ["route", "error_code"]), { route: "INVALID", error_code: "SA_INVALID_REQUEST" });
  H.eq("INVALID Edit form of another SA: nothing written", dbx.log, []);
  const sc = { id: "2104431462706188289", table_stock_count: [] };
  inv("review without sc_id", reviewP(sc, { sc_id: "" }), "sc_id");
  inv("review with an sa_id", reviewP(sc, { sa_id: "2104431462706188289" }), "sa_id");
  inv("review without organization", reviewP(sc, { organization_id: "" }), "organization_id");
  inv("review create_adjustment", reviewP(sc, { create_adjustment: "No" }), "create_adjustment");
  inv("review date", reviewP(sc, { adjustment_date: "16/10/2026" }), "adjustment_date");
  inv("STATUS without ids", statusP({ sa_id: "0" }), "STATUS needs");
  const db = fresh();
  db.tenantId = "";
  H.eq("INVALID no session tenant", run(db, formP(f)).ans.route, "INVALID");
  const nf = fresh();
  H.eq("FORM Edit of a missing SA -> STOP SA_NOT_FOUND", pick(run(nf, formP(Object.assign({}, f, { id: "2104431462706188289" }))).ans, ["route", "code", "error_code"]),
    { route: "STOP", code: "400", error_code: "SA_NOT_FOUND" });
  H.eq("REVIEW of a missing SC -> STOP SA_SC_NOT_FOUND", pick(run(nf, reviewP({ id: "2104431462706188289", stock_count_status: "", review_status: "", table_stock_count: [] })).ans,
    ["route", "error_code"]), { route: "STOP", error_code: "SA_SC_NOT_FOUND" });
}

// ------------------------------------------------------------------------------------------------- the read-back decides
{
  const db = fresh();
  const insert = db.insert.bind(db);
  db.insert = (table, rows) => insert(table, table === "Stock Adjustment" ? rows.map((r) => Object.assign({}, r, { sa_v2_job_id: null })) : rows);
  const r = run(db, formP(saForm()));
  const job = job0(db);
  H.eq("the SA did not read back -> STOP 500 SA_QUEUE_FAILED", pick(r.ans, ["route", "code", "error_code", "job_id", "job_status", "terminal"]),
    { route: "STOP", code: "500", error_code: "SA_QUEUE_FAILED", job_id: job.id, job_status: "QUEUED", terminal: "NO" });
  H.eq("  and the job is not made due (falls due by itself in 120 s)", [job.next_attempt_at - db.now, job.correlation_id], [120000, ""]);
  H.eq("  the next click with the key -> its STATUS", run(db, formP(saForm(), { idempotency_key: job.idempotency_key })).ans.route, "STATUS");
}

// ------------------------------------------------------------------------------------------------- node data: a 2,000-line REVIEW
{
  const db = fresh();
  const scl = [];
  for (let i = 0; i < 2000; i++) {
    const mat = String(2600000000000000000n + BigInt(i));
    const bin = BIN["b" + (1 + (i % 3))];
    db.t.items.push({ id: mat, material_code: "M" + i, material_name: "Material number " + i, serial_number_management: 0, material_costing_method: "Weighted Average",
      stock_control: 1, item_batch_management: 0, purchase_unit_price: 1.25, uomconv: [{ id: String(2700000000000000000n + BigInt(i)), alt_uom_id: "2300000000000000009",
        base_uom_id: F.UOM, alt_qty: 1, base_qty: 12 }] });
    db.t.wa.push({ material_id: mat, batch_id: null, plant_id: PLANT, organization_id: ORG, wa_cost_price: 2.5 });
    db.t.bal.push({ id: String(2800000000000000000n + BigInt(i)), material_id: mat, plant_id: PLANT, location_id: bin, balance_quantity: 50, unrestricted_qty: 50,
      organization_id: ORG });
    scl.push({ material: mat, bin: bin, variance: i % 2 ? 2 : -3 });
  }
  const form = storeSc(db, { lines: scl });
  const p = reviewP(form);
  const t0 = Date.now();
  const r = run(db, p);
  const ms = Date.now() - t0;
  const outBytes = r.eng.sizes.SA_V2_SUBMIT;
  const paramBytes = JSON.stringify(p).length;
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  H.eq("2,000-line REVIEW queued", pick(r.ans, ["route", "line_count"]), { route: "QUEUED", line_count: "2000" });
  console.log("     node data (2,000-line REVIEW): outputs " + mb(outBytes) + " + request " + mb(paramBytes) + " = " + mb(outBytes + paramBytes) + " (" + ms + " ms in-process); "
    + "code-node inputs " + mb(r.eng.injected) + " -> with inputs " + mb(outBytes + paramBytes + r.eng.injected));
  const big = Object.entries(r.ctx.out).map(([k, v]) => [k, JSON.stringify(v === undefined ? null : v).length]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log("     largest outputs: " + big.map(([k, n]) => k + " " + mb(n)).join(", "));
  H.truthy("2,000-line REVIEW node data <= 25 MB (even counting every code-node input)", outBytes + paramBytes + r.eng.injected <= 25 * 1048576,
    mb(outBytes + paramBytes + r.eng.injected));
  // a 2,000-entry COMPLETE (the DOC part) for comparison
  const db2 = fresh();
  const ents = [];
  for (let i = 0; i < 2000; i++) ents.push(ent(ITEM.A, BIN.b1, 1, "In", { create_time: "2026-10-01 13:39:04.569", update_time: "2026-10-01 15:24:00.215", tenant_id: "000000" }));
  const ls = [];
  for (let i = 0; i < 2000; i += 50) ls.push(line(ITEM.A, ents.slice(i, i + 50)));
  const form2 = storeSa(db2, { lines: ls });
  const p2 = formP(form2);
  const r2 = run(db2, p2);
  const tot2 = r2.eng.sizes.SA_V2_SUBMIT + JSON.stringify(p2).length + r2.eng.injected;
  H.eq("2,000-entry COMPLETE queued", r2.ans.route, "QUEUED");
  console.log("     node data (2,000-entry COMPLETE): outputs + request + inputs = " + mb(tot2));
}

H.done();
