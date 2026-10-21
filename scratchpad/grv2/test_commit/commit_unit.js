// Unit tests of the GR_COMPLETE_COMMIT step functions on crafted inputs (no DB). node commit_unit.js
const load = require("./load");
let fails = 0, passes = 0;
const ok = (cond, what, extra) => { if (cond) passes++; else { fails++; console.log("FAIL", what, extra === undefined ? "" : JSON.stringify(extra).slice(0, 600)); } };
const J = (o) => JSON.stringify(o);
const partRows = (nonce, name, value) => { const t = J(value); const out = []; for (let at = 0, n = 1; at < t.length; at += 400000, n++) out.push({ step_name: "P|" + nonce + "|" + name + "|" + String(n).padStart(3, "0"), result_ref: t.slice(at, at + 400000) }); return out; };
const intentRows = (prefix, value) => [{ step_name: prefix + "001", result_ref: J(value) }];
const jrows = (objs) => objs.map((o) => ({ j: J(o) }));
const JOB = "2110000000000000001", GRID = "2110000000000000100", NONCE = "abcd1234";
const baseEntry = (extra) => Object.assign({ jobId: JOB, organizationId: "1123598813738675201", grId: GRID, grNo: "GR-1", plantId: "1123598813738675202", prevStatus: "Created",
  dbNow: "2026-10-14 10:00:00", attempts: 0, rowVersion: 3, unlockOk: "YES", partPrefix: "P|" + NONCE + "|", poLocks: {}, ourBatchIds: [], jitter: 2, c0Waits: 0, leaseUntil: "2026-10-14 10:10:00" }, extra || {});

// ------------------------------------------------------------------ entry
{
  const { commitEntry } = load("entry.js", ["commitEntry"]);
  const guard = { jobId: JOB, tenantId: "000000", leaseOwner: "PUB|x", nonce: "00ff00ff" };
  const manifest = { v: 1, job_id: JOB, gr_id: GRID, gr_no: "GR-1", plant_id: "5", nonce: NONCE, po_ids: ["2", "1"], counts: { lines: 3, batches: 1, autoBatches: 1, poLines: 2, onOrder: 2, toLines: 0, inTransit: 0 },
    parts: { BATCH: ["P|abcd1234|BATCH|001"], ENGINE: ["x"], PO: ["x"], TO: ["x"], GR: ["x"], AFTER: ["x"] } };
  const job = (o) => [Object.assign({ db_now: "2026-10-14 10:00:00", lease_until: "2026-10-14 10:10:00", id: JOB, organization_id: "9", command: "COMPLETE_GR", job_status: "READY_TO_COMMIT", is_deleted: 0,
    row_version: 3, attempt_count: 0, idempotency_key: "K1", correlation_id: "GR|" + GRID, prev_status: "Created", due: 1, lease_live: 0, progress_percent: 60 }, o || {})];
  const gr = [{ gr_status: "Processing", lock_ref: "K1", gr_v2_job_id: JOB }];
  const pay = [{ prepared_payload: J(manifest) }];
  let r = commitEntry(guard, job(), [], pay, gr, [], [{ id: "77" }]);
  ok(r.route === "GO" && r.phase === "A" && r.needC0 === "YES" && r.needC1 === "YES" && r.needC1B === "YES" && r.needC2 === "YES" && r.needC3 === "NO", "entry phase A", r);
  // the lease outlasts the engine call: 10 min + 0.6 s per movement, at most 90 min (the SPLIT hand-over carries the same)
  const lease = (n) => { const mm = JSON.parse(J(manifest)); mm.counts.movements = n; const x = commitEntry(guard, job(), [], [{ prepared_payload: J(mm) }], gr, [], [{ id: "77" }]);
    return [x.jobRows[0].lease_expires_at, x.leaseUntil]; };
  ok(J(lease(undefined)) === J(["2026-10-14 10:10:00", "2026-10-14 10:10:00"]), "lease: no movements -> 10 min", lease(undefined));
  ok(J(lease(2500)) === J(["2026-10-14 10:35:00", "2026-10-14 10:35:00"]), "lease: 2,500 movements -> 35 min", lease(2500));
  ok(J(lease(20000)) === J(["2026-10-14 11:30:00", "2026-10-14 11:30:00"]), "lease: capped at 90 min", lease(20000));
  ok(r.poIdsSql === "0,2,1" && r.unlockOk === "YES" && r.ourBatchIds[0] === "77" && r.prevStatus === "Created" && r.jitter === 0, "entry fields", { p: r.poIdsSql, j: r.jitter });
  r = commitEntry(guard, job({ job_status: "COMMITTING_GR", lease_owner: "SPLIT|n" }), [{ step_name: "C0_REVALIDATE", step_status: "DONE" }, { step_name: "C2_INVENTORY", step_status: "DONE" }], pay, [{ gr_status: "Processing" }], [], []);
  ok(r.route === "GO" && r.phase === "B" && r.needC3 === "YES" && r.needC4 === "NO" && r.needC5 === "YES" && r.unlockOk === "NO", "entry phase B", r);
  r = commitEntry(guard, job(), [], pay, [{ gr_status: "Draft", lock_ref: "K1", gr_v2_job_id: JOB }], [], []);
  ok(r.route === "FAIL" && r.result_code === "GRC_NOT_LOCKED" && r.needUnlock === "NO", "entry lock lost", r);
  r = commitEntry(guard, job(), [], [{ prepared_payload: "{bad" }], gr, [], []);
  ok(r.route === "FAIL" && r.result_code === "GRC_INVALID_DATA" && r.needUnlock === "YES" && r.unlockRows[0].gr_status === "Created", "entry bad manifest -> back to Created", r);
  r = commitEntry(guard, job(), [{ step_name: "C2_INVENTORY", step_status: "DONE" }], [{ prepared_payload: "{bad" }], gr, [], []);
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW", "entry bad manifest after C2 -> review", r);
  const locks = [{ job_id: "GRPO|1", step_name: "HOLD|1", result_ref: "999", holder_status: "COMPLETED" }, { job_id: "GRPO|1", step_name: "FREE|1", result_ref: "999" },
    { job_id: "GRPO|1", step_name: "HOLD|2", result_ref: JOB, holder_status: "COMMITTING_GR" }, { job_id: "GRPO|2", step_name: "HOLD|1", result_ref: "555", holder_status: "REQUIRES_REVIEW" }];
  r = commitEntry(guard, job(), [{ step_name: "C0_WAIT|1", step_status: "WAIT" }, { step_name: "C0_WAIT|2", step_status: "WAIT" }], pay, gr, locks, []);
  ok(r.poLocks["GRPO|1"].holder === JOB && r.poLocks["GRPO|1"].n === 2 && r.poLocks["GRPO|2"].held === "YES" && r.c0Waits === 2, "entry lock state + waits", r.poLocks);
  r = commitEntry(guard, job({ job_status: "COMMITTING_GR", due: 0, next_attempt_at: "x" }), [], pay, gr, [], []);
  ok(r.route === "NO_WRITE" && /backoff/.test(r.result_message), "entry not due", r);
}

// ------------------------------------------------------------------ C0
{
  const { commitC0 } = load("c0.js", ["commitC0"]);
  const po = { poIds: ["2", "1"], fromCreated: false, poLines: [{ id: "11", po_id: "1", delta_received: 5, release_created: 0, gr_total: 5, tolerance: 10, item_name: "Bolt" },
    { id: "21", po_id: "2", delta_received: 3, release_created: 0, gr_total: 3, tolerance: 0, item_name: "Nut" }] };
  const pol = jrows([{ id: "11", purchase_order_id: "1", quantity: 10, received_qty: 6 }, { id: "21", purchase_order_id: "2", quantity: 3, received_qty: 0 }]);
  let r = commitC0(baseEntry(), partRows(NONCE, "PO", po), pol);
  ok(r.route === "OK" && r.lockRows.length === 2 && r.lockRows[0].job_id === "GRPO|1" && r.lockRows[0].step_name === "HOLD|1" && r.lockRows[0].result_ref === JOB, "C0 room + take both locks in id order", r);
  r = commitC0(baseEntry(), partRows(NONCE, "PO", po), jrows([{ id: "11", quantity: 10, received_qty: 6.5 }, { id: "21", quantity: 3, received_qty: 0 }]));
  ok(r.route === "END" && r.result_code === "GRC_PO_CHANGED" && /Quantity validation failed:\nBolt: Attempting to receive 5, but only 4\.5 remaining \(Ordered: 10, Already received: 6\.5, Max allowed: 11\)/.test(r.result_message) && r.needUnlock === "YES", "C0 over-receive message", r.result_message);
  r = commitC0(baseEntry(), partRows(NONCE, "PO", po), jrows([{ id: "11", quantity: 10, received_qty: 6 }]));
  ok(r.route === "END" && r.result_code === "GRC_PO_CHANGED" && /no longer exists/.test(r.result_message), "C0 PO line gone", r.result_message);
  const busyLocks = { "GRPO|1": { n: 2, holder: JOB, held: "YES" }, "GRPO|2": { n: 4, holder: "555", held: "YES" } };
  r = commitC0(baseEntry({ poLocks: busyLocks, c0Waits: 3 }), partRows(NONCE, "PO", po), pol);
  ok(r.route === "END" && r.result_code === "GRC_WAIT" && r.freeRows.length === 1 && r.freeRows[0].step_name === "FREE|2" && r.stepRows[0].step_name === "C0_WAIT|4" && r.jobRows[0].next_attempt_at === "2026-10-14 10:00:22", "C0 busy -> free mine + wait", r);
  r = commitC0(baseEntry({ poLocks: busyLocks, c0Waits: 10 }), partRows(NONCE, "PO", po), pol);
  ok(r.route === "END" && r.result_code === "GRC_PO_BUSY" && r.job_status === "FAILED" && r.freeRows.length === 1 && r.needUnlock === "YES", "C0 busy 10 times -> FAILED", r);
  r = commitC0(baseEntry({ poLocks: { "GRPO|1": { n: 2, holder: JOB, held: "YES" }, "GRPO|2": { n: 1, holder: "", held: "NO" } } }), partRows(NONCE, "PO", po), pol);
  ok(r.route === "OK" && r.lockRows.length === 1 && r.lockRows[0].step_name === "HOLD|2" && r.lockRows[0].job_id === "GRPO|2", "C0 resume: keep mine, take the freed one", r.lockRows);
}

// ------------------------------------------------------------------ C1 + C1B
{
  const shared = [];
  const bn = load("c1_plan.js", ["commitC1Plan"], ["commit/_batchnum_adapter.js"]);
  const part = { configs: [], rows: [{ key: "b1", line_ids: ["L1"], material_id: "500", plant_id: "5", organization_id: "9", batch_number: null, request: {}, initial_quantity: 4 },
    { key: "b2", line_ids: ["L2"], material_id: "500", plant_id: "5", organization_id: "9", batch_number: "M-1", initial_quantity: 2 },
    { key: "b3", line_ids: ["L3"], material_id: "600", plant_id: "5", organization_id: "9", existing_batch_id: "8888" }] };
  let r = bn.commitC1Plan(baseEntry(), partRows(NONCE, "BATCH", part), [], []);
  ok(r.route === "END" && r.result_code === "GRC_BATCH_CONFIG" && /not wired/.test(r.result_message), "C1 plan without numbering -> FAILED clean", r.result_message);
  r = bn.commitC1Plan(baseEntry(), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, configs: [], adopt: {} }), []);
  ok(r.route === "GO" && r.hasIntent === "YES" && JSON.parse(r.numbersSql.replace(/''/g, "'")).map((x) => x.n).join() === "A-7,M-1", "C1 plan from the intent", r);
  const { commitC1Decide } = load("c1_decide.js", ["commitC1Decide"]);
  const draft = { hasIntent: "NO", draft: { numbers: { b1: "A-7" }, configs: [{ id: "c1", before: { running_number: 7, last_reset_date: "2026-10-01T00:00:00.000Z" }, after: { running_number: 8, last_reset_date: "2026-10-01T00:00:00.000Z" } }] } };
  const cfgAt = (n) => jrows([{ id: "c1", running_number: n, last_reset_date: "2026-10-01T00:00:00.000Z" }]);
  r = commitC1Decide(baseEntry(), draft, partRows(NONCE, "BATCH", part), [], cfgAt(7), jrows([]));
  ok(r.route === "GO" && r.needIntent === "YES" && r.batchRows.length === 2 && r.bncRows.length === 1 && r.bncRows[0].running_number === 8 && r.batchRows[0].transaction_no === "GR-1", "C1 decide: insert 2, advance config", r);
  r = commitC1Decide(baseEntry({ ourBatchIds: ["71"] }), draft, partRows(NONCE, "BATCH", part), [], cfgAt(7), jrows([{ id: "40", batch_number: "A-7", material_id: "999", plant_id: "5", transaction_no: "OTHER" }]));
  ok(r.route === "END" && r.result_code === "GRC_BATCH_DUPLICATE" && r.batchDelRows[0].id === "71", "C1 decide: generated number held by one other batch -> FAILED", r);
  r = commitC1Decide(baseEntry(), draft, partRows(NONCE, "BATCH", part), [], cfgAt(9), jrows([{ id: "41", batch_number: "M-1", material_id: "500", plant_id: "5", transaction_no: "OTHER" }]));
  const intent = JSON.parse(r.intentRows[0].result_ref);
  ok(r.route === "GO" && intent.adopt.b2 === "41" && r.batchRows.length === 1 && r.batchRows[0].batch_number === "A-7" && r.bncRows.length === 0, "C1 decide: manual number reused; a config already past our after-state is left alone", r);
  r = commitC1Decide(baseEntry(), { hasIntent: "YES" }, partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, configs: draft.draft.configs, adopt: {} }), cfgAt(8),
    jrows([{ id: "70", batch_number: "A-7", material_id: "500", plant_id: "5", transaction_no: "GR-1" }]));
  ok(r.route === "GO" && r.needIntent === "NO" && r.bncRows.length === 0 && r.batchRows.length === 1 && r.batchRows[0].batch_number === "M-1", "C1 decide rerun: config at after, A-7 already inserted", r);
  const same = { hasIntent: "NO", draft: { numbers: { b1: "D-1", b4: "D-1" }, configs: [] } };
  const part2 = { rows: [part.rows[0], Object.assign({}, part.rows[0], { key: "b4", line_ids: ["L4"] })] };
  r = commitC1Decide(baseEntry(), same, partRows(NONCE, "BATCH", part2), [], [], jrows([]));
  ok(r.batchRows.length === 1, "C1 decide: two auto lines, same number + item -> one batch row", r.batchRows);
  const { commitC1Check } = load("c1_check.js", ["commitC1Check"]);
  r = commitC1Check(baseEntry(), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, configs: draft.draft.configs, adopt: { b2: "41" } }), cfgAt(8),
    jrows([{ id: "70", batch_number: "A-7", material_id: "500", transaction_no: "GR-1" }]));
  ok(r.route === "OK" && r.stepRows[0].step_name === "C1_BATCHES", "C1 check ok", r);
  r = commitC1Check(baseEntry({ attempts: 3 }), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, configs: [], adopt: {} }), [], jrows([{ id: "70", batch_number: "A-7", material_id: "500", transaction_no: "GR-1" }]));
  ok(r.route === "END" && r.result_code === "GRC_STEP_FAILED" && r.batchDelRows.length === 1 && r.needUnlock === "YES", "C1 check: M-1 missing after retries -> FAILED + cleanup", r);
  const backOk = jrows([{ id: "70", batch_number: "A-7", material_id: "500", transaction_no: "GR-1" }]);
  r = commitC1Check(baseEntry(), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, configs: draft.draft.configs, adopt: { b2: "41" } }), cfgAt(8), backOk,
    jrows([{ id: "70", batch_number: "A-7", material_id: "500", transaction_no: "GR-1" }, { id: "95", batch_number: "a-7 ", material_id: "999", transaction_no: "SM-OTHER" }]));
  ok(r.route === "END" && r.result_code === "GRC_BATCH_DUPLICATE" && r.batchDelRows.length === 1 && r.batchDelRows[0].id === "70" && r.needUnlock === "YES",
    "C1 check: another document took our generated number after the pre-check -> FAILED, our rows removed, receipt back", r);
  r = commitC1Check(baseEntry(), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, configs: draft.draft.configs, adopt: { b2: "41" } }), cfgAt(8), backOk,
    jrows([{ id: "70", batch_number: "A-7", material_id: "500", transaction_no: "GR-1" }, { id: "41", batch_number: "M-1", material_id: "500", transaction_no: "OTHER" }]));
  ok(r.route === "OK", "C1 check: only our row holds the generated number; a manual number shared with another document is fine", r);
  const b1 = load("c1b_plan.js", ["commitC1bPlan"]);
  r = b1.commitC1bPlan(baseEntry(), partRows(NONCE, "GR", { patch: { gr_status: "Completed" }, autoLines: [{ id: "L1", key: "b1" }] }), intentRows("C1|I|", { numbers: { b1: "A-7" } }),
    jrows([{ id: "L1", item_batch_no: "Auto-generated batch number" }]));
  ok(r.route === "GO" && r.lineCount === 1 && r.lineSlices[0].rows[0].item_batch_no === "A-7", "C1B plan", r);
}

// ------------------------------------------------------------------ C2
{
  const { commitC2In } = load("c2_in.js", ["commitC2In"]);
  const e = baseEntry();
  const part = { rows: [{ key: "b1", material_id: "500", batch_number: null }, { key: "b3", material_id: "600", existing_batch_id: "8888" }, { key: "b2", material_id: "500", batch_number: "M-1" }] };
  const eng = { operation_key: "GRC|" + JOB, movements: [{ movement_key: "m1", batch_ref: "b1" }, { movement_key: "m2", batch_ref: "b3" }, { movement_key: "m3", batch_ref: "b2" }, { movement_key: "m4" }] };
  let r = commitC2In(e, partRows(NONCE, "ENGINE", eng), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" }, adopt: { b2: "41" } }), jrows([{ id: "70", batch_number: "A-7", material_id: "500" }]));
  ok(r.ok === "YES" && r.movements[0].batch_id === "70" && r.movements[1].batch_id === "8888" && r.movements[2].batch_id === "41" && r.movements[3].batch_id === undefined && r.movements.every((m) => m.batch_ref === undefined), "C2 input: batch refs resolved", r);
  r = commitC2In(e, partRows(NONCE, "ENGINE", eng), partRows(NONCE, "BATCH", part), intentRows("C1|I|", { numbers: { b1: "A-7" } }), jrows([]));
  ok(r.ok === "NO" && /batch reference/.test(r.why), "C2 input: missing batch row", r);
  const { commitC2 } = load("c2.js", ["commitC2"]);
  const g = { nonce: "00ff00ff" };
  r = commitC2(e, g, { ok: "YES" }, { code: "200", result_code: "APPLIED" }, jrows([]));
  ok(r.route === "OK" && r.needSplit === "YES" && r.splitRows[0].lease_owner === "SPLIT|00ff00ff", "C2 200 -> DONE + SPLIT", r);
  r = commitC2(e, g, { ok: "YES" }, { code: "409", result_code: "LOCK_BUSY" }, jrows([]));
  ok(r.route === "END" && r.result_code === "GRC_WAIT" && r.needUnlock === "NO", "C2 409 -> wait", r);
  r = commitC2(e, g, { ok: "YES" }, { code: "400", result_code: "VALIDATION", message: "bad" }, jrows([{ id: "70" }].map((x) => x)).concat([]));
  ok(r.route === "END" && r.job_status === "FAILED" && r.needUnlock === "YES", "C2 400 -> FAILED + back", r);
  r = commitC2(e, g, { ok: "YES" }, { code: "500" }, jrows([]));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "C2 500 -> review", r);
}

// ------------------------------------------------------------------ C3
{
  const { commitC3Plan } = load("c3_plan.js", ["commitC3Plan"]);
  const { commitC3Check } = load("c3_check.js", ["commitC3Check"]);
  const po = { poIds: ["1"], fromCreated: true, poLines: [{ id: "11", po_id: "1", delta_received: 4, release_created: 4 }, { id: "12", po_id: "1", delta_received: 2, release_created: 1 }],
    onOrder: [{ po_line_id: "11", delta: 8 }, { po_line_id: "12", delta: 2 }] };
  const pol = [{ id: "11", purchase_order_id: "1", quantity: 10, received_qty: 6, created_received_qty: 4, outstanding_quantity: 4, line_status: "Processing" },
    { id: "12", purchase_order_id: "1", quantity: 5, received_qty: 0, created_received_qty: 3, outstanding_quantity: 5, line_status: "Issued" },
    { id: "13", purchase_order_id: "1", quantity: 1, received_qty: 0, created_received_qty: 0, outstanding_quantity: 1, line_status: "Issued" },
    { id: "14", purchase_order_id: "1", parent_id: "13", item_bundle_id: "77", item_id: "500", quantity: 1, received_qty: 0 }];
  const oo = [{ id: "91", po_line_id: "11", open_qty: 10, received_qty: 0 }, { id: "100", po_line_id: "11", open_qty: 10, received_qty: 0 }, { id: "92", po_line_id: "12", open_qty: 1, received_qty: 0 }];
  const poh = [{ id: "1", po_status: "Issued", gr_status: "", partially_received: "0 / 3", fully_received: "0 / 3" }];
  const e = baseEntry({ poLocks: { "GRPO|1": { n: 3, holder: JOB, held: "YES" } } });
  let r = commitC3Plan(e, partRows(NONCE, "PO", po), [], jrows(pol), jrows(oo), jrows(poh));
  const it = r.intentRows.length ? JSON.parse(r.intentRows.map((x) => x.result_ref).join("")) : null;
  const l11 = it.lines.find((x) => x.id === "11").after, l12 = it.lines.find((x) => x.id === "12").after;
  ok(r.route === "GO" && l11.received_qty === 10 && l11.outstanding_quantity === 0 && l11.line_status === "Completed" && l11.created_received_qty === 0, "C3 line 11", l11);
  ok(l12.received_qty === 2 && l12.outstanding_quantity === 3 && l12.line_status === "Processing" && l12.created_received_qty === 2, "C3 line 12", l12);
  const o91 = it.oo.find((x) => x.id === "91").after, o100 = it.oo.find((x) => x.id === "100").after, o92 = it.oo.find((x) => x.id === "92").after;
  ok(o91.open_qty === 2 && o91.received_qty === 8 && o100.open_qty === 2 && o92.open_qty === 0 && o92.received_qty === 2, "C3 on-order (lowest id base, every live row, clamped)", it.oo);
  const h = it.headers[0].after;
  ok(h.po_status === "Processing" && h.gr_status === "Partially Received" && h.partially_received === "2 / 3" && h.fully_received === "1 / 3", "C3 header (bundle child excluded)", h);
  ok(r.lineCount === 2 && r.ooCount === 3 && r.needHeaders === "YES" && r.lineSlices[0].rows[0].received_qty === "10.00000000", "C3 writes as strings", r.lineSlices[0].rows[0]);
  // rerun: line 11 written, 12 not yet; oo all written; header not yet
  const pol2 = pol.map((x) => (x.id === "11" ? Object.assign({}, x, l11) : x));
  const oo2 = oo.map((x) => Object.assign({}, x, it.oo.find((y) => y.id === x.id).after));
  r = commitC3Plan(e, partRows(NONCE, "PO", po), r.intentRows, jrows(pol2), jrows(oo2), jrows(poh));
  ok(r.route === "GO" && r.needIntent === "NO" && r.lineCount === 1 && r.lineSlices[0].rows[0].id === "12" && r.ooCount === 0 && r.headerRows.length === 1, "C3 rerun from intent", r);
  const pol3 = pol.map((x) => (x.id === "12" ? Object.assign({}, x, { received_qty: 1 }) : x));
  r = commitC3Plan(e, partRows(NONCE, "PO", po), intentRows("C3|I|", it), jrows(pol3), jrows(oo), jrows(poh));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "C3 conflict -> review", r);
  const done = pol.map((x) => Object.assign({}, x, (it.lines.find((y) => y.id === x.id) || {}).after || {}));
  r = commitC3Check(e, intentRows("C3|I|", it), jrows(done), jrows(oo2), jrows([Object.assign({}, poh[0], h)]));
  ok(r.route === "OK" && r.freeRows.length === 1 && r.freeRows[0].step_name === "FREE|3" && r.freeRows[0].job_id === "GRPO|1", "C3 check -> free + DONE", r);
}

// ------------------------------------------------------------------ C4 + C5 + finish
{
  const { commitC4To } = load("c4_to.js", ["commitC4To"]);
  const { commitC4It } = load("c4_it.js", ["commitC4It"]);
  const { commitC4Check } = load("c4_check.js", ["commitC4Check"]);
  const e = baseEntry();
  const to = { header: { to_status: "Created", to_id: "issued", gr_no: GRID }, lines: [{ line_index: 1, batch_ref: "b1", gr_line_id: "L1" }, { line_index: 2, gr_line_id: "L2", batch_no: "" }],
    inTransit: [{ line_id: "L1", batch_ref: "b1", transit_qty: 4 }, { line_id: "L2", transit_qty: 2 }] };
  const bpart = partRows(NONCE, "BATCH", { rows: [{ key: "b1", material_id: "500" }] });
  const bint = intentRows("C1|I|", { numbers: { b1: "A-7" } });
  const brows = jrows([{ id: "70", batch_number: "A-7", material_id: "500" }]);
  let r = commitC4To(e, partRows(NONCE, "TO", to), bpart, bint, brows, []);
  ok(r.route === "GO" && r.needTo === "YES" && r.toRow.table_putaway_item[0].batch_no === "70" && r.toRow.table_putaway_item[0].batch_ref === undefined, "C4 TO add with batch id", r.toRow);
  r = commitC4To(e, partRows(NONCE, "TO", to), bpart, bint, brows, [{ id: "300", to_id: "PA-1", line_count: 2 }]);
  ok(r.route === "GO" && r.needTo === "NO", "C4 TO already added", r);
  r = commitC4To(e, partRows(NONCE, "TO", to), bpart, bint, brows, [{ id: "300", to_id: "PA-1", line_count: 1 }]);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "C4 TO partial -> review", r);
  r = commitC4It(e, partRows(NONCE, "TO", to), bpart, bint, brows, [{ id: "300", to_id: "PA-1", line_count: 2 }], jrows([{ id: "9", doc_line_id: "L2", status: "Open" }]));
  ok(r.route === "GO" && r.itCount === 1 && r.itSlices[0].rows[0].doc_line_id === "L1" && r.itSlices[0].rows[0].batch_id === "70" && r.itSlices[0].rows[0].target_doc_no === "PA-1"
    && r.itSlices[0].rows[0].target_doc_type === "Putaway" && r.itSlices[0].rows[0].doc_id === GRID && r.itSlices[0].rows[0].line_id === undefined, "C4 in-transit rows", r.itSlices);
  r = commitC4Check(e, partRows(NONCE, "TO", to), [{ id: "300", to_id: "PA-1", line_count: 2 }], jrows([{ id: "9", doc_line_id: "L2" }, { id: "10", doc_line_id: "L1" }]));
  ok(r.route === "OK" && r.stepRows[0].step_name === "C4_PUTAWAY", "C4 check", r);
  const { commitC5Plan } = load("c5_plan.js", ["commitC5Plan"]);
  const { commitC5Check } = load("c5_check.js", ["commitC5Check"]);
  r = commitC5Plan(e, partRows(NONCE, "GR", { patch: { gr_status: "Received", putaway_status: "Created" } }), partRows(NONCE, "AFTER", { itemDates: [{ id: "500", last_transaction_date: "2026-10-14T02:00:00.000Z" }, { id: "600" }] }), [{ gr_status: "Processing", putaway_status: "" }]);
  ok(r.route === "GO" && r.headerRows[0].gr_status === "Received" && r.headerRows[0].putaway_status === "Created" && r.itemSlices[0].rows.length === 2
    && r.itemSlices[0].rows[0].last_transaction_date === "2026-10-14T02:00:00.000Z" && /T/.test(r.itemSlices[0].rows[1].last_transaction_date), "C5 plan", r);
  const keep = commitC5Plan(e, partRows(NONCE, "GR", { patch: { gr_status: "Completed" } }), partRows(NONCE, "AFTER", { itemDates: [] }), [{ gr_status: "Processing", putaway_status: "Not Created" }]);
  ok(keep.headerRows[0].putaway_status === "Not Created", "C5 plan keeps the stored putaway_status when none applies", keep.headerRows);
  ok(commitC5Check(e, r, [{ gr_status: "Received", putaway_status: "Created" }]).route === "OK", "C5 check ok");
  ok(commitC5Check(e, r, [{ gr_status: "Processing", putaway_status: "" }]).route === "END", "C5 check retry");
  const { commitFinish } = load("finish.js", ["commitFinish"]);
  const held = [{ job_id: "GRPO|1", step_name: "HOLD|3", result_ref: JOB, holder_status: "COMMITTING_GR" }, { job_id: "GRPO|2", step_name: "HOLD|1", result_ref: "x", holder_status: "COMMITTING_GR" }];
  r = commitFinish(baseEntry({ poLocks: { "GRPO|1": { n: 3, holder: JOB, held: "YES" } } }), held);
  ok(r.freeRows.length === 1 && r.freeRows[0].step_name === "FREE|3" && r.jobRows[0].job_status === "COMPLETED" && r.jobRows[0].lease_owner === null, "finish", r);
  // C3 freed the lock earlier in this run; the entry's state (read at the start) still shows the hold -> nothing freed twice
  r = commitFinish(baseEntry({ poLocks: { "GRPO|1": { n: 1, holder: JOB, held: "YES" } } }), [{ job_id: "GRPO|1", step_name: "HOLD|1", result_ref: JOB, holder_status: "COMMITTING_GR" }, { job_id: "GRPO|1", step_name: "FREE|1", result_ref: JOB }]);
  ok(r.freeRows.length === 0 && r.needFree === "NO" && r.jobRows[0].job_status === "COMPLETED", "finish after C3 freed in the same run: no second FREE", r);
}

// ------------------------------------------------------------------ C1 batch rules from the plan core review
{
  const { commitC1Decide } = load("c1_decide.js", ["commitC1Decide"]);
  const rows = [{ key: "A1", insert: true, material_id: "500", plant_id: "5", organization_id: "9", batch_number: null, request: {} },
    { key: "A2", insert: false, material_id: "500", plant_id: "5", organization_id: "9", batch_number: null, request: {} },
    { key: "M1", insert: true, material_id: "600", plant_id: "5", organization_id: "9", batch_number: "lot-7 " },
    { key: "M2", insert: true, material_id: "600", plant_id: "5", organization_id: "9", batch_number: "LOT-7" }];
  const plan = { hasIntent: "NO", draft: { numbers: { A1: "X-1", A2: "X-2" }, configs: [] } };
  let r = commitC1Decide(baseEntry(), plan, partRows(NONCE, "BATCH", { rows: rows }), [], [], jrows([]));
  ok(r.route === "GO" && r.batchRows.length === 2 && r.batchRows.map((b) => b.batch_number).join() === "X-1,lot-7", "C1: insert false gets no row; LOT-7 / 'lot-7 ' are one batch (stored trimmed)", r.batchRows);
  r = commitC1Decide(baseEntry(), plan, partRows(NONCE, "BATCH", { rows: rows }), [], [], jrows([{ id: "40", batch_number: "x-1", material_id: "999", plant_id: "8", transaction_no: "OTHER" },
    { id: "41", batch_number: "x-1", material_id: "998", plant_id: "8", transaction_no: "OTHER2" }]));
  ok(r.route === "END" && r.result_code === "GRC_BATCH_DUPLICATE", "C1: a generated number any other batch holds (case-insensitive) -> FAILED", r);
  r = commitC1Decide(baseEntry(), plan, partRows(NONCE, "BATCH", { rows: rows }), [], [], jrows([{ id: "52", batch_number: "Lot-7", material_id: "600", plant_id: "5", transaction_no: "OTHER" }]));
  const it = JSON.parse(r.intentRows[0].result_ref);
  ok(it.adopt.M1 === "52" && it.adopt.M2 === "52" && r.batchRows.length === 1, "C1: manual numbers reuse the existing batch case-insensitively", it.adopt);
  const { commitC1Check } = load("c1_check.js", ["commitC1Check"]);
  r = commitC1Check(baseEntry(), partRows(NONCE, "BATCH", { rows: rows }), intentRows("C1|I|", { numbers: { A1: "X-1", A2: "X-2" }, configs: [], adopt: {} }), [],
    jrows([{ id: "70", batch_number: "X-1", material_id: "500", transaction_no: "GR-1" }, { id: "71", batch_number: "lot-7 ", material_id: "600", transaction_no: "GR-1" }]));
  ok(r.route === "OK", "C1 check: insert-false row needs no batch row; LOT-7 resolves to 'lot-7 '", r);
}

// ------------------------------------------------------------------ the read-back compare under a tenant number rule
{
  const { sameStored } = load("c5_check.js", ["sameStored"]);
  const cases = [[1.23456789, 1.2346, true], [1.23456789, 1.234, true], [1.23456789, 1.235, true], [2.5, 3, true], [2.5, 2, true], [10, "10.00000000", true],
    [1.2345, 1.2346, false], [1.2345, 1.3, true], [1.2345, 1.25, false], [0.1, 0.2, false], [3.9995, "4.000", true], [7, 7.1, false], ["Completed", "Completed", true],
    ["Completed", "Processing", false], [5, "", false]];
  for (const [a, b, want] of cases) ok(sameStored(a, b) === want, "sameStored(" + a + ", " + b + ")", { got: sameStored(a, b) });
}
console.log("commit unit tests:", passes, "passed,", fails, "failed");
process.exit(fails ? 1 : 0);
