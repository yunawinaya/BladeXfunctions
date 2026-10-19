// Unit tests of the GR_REVERT_COMMIT step functions on crafted inputs (no DB). node commit_unit.js
const load = require("./load");
let fails = 0, passes = 0;
const ok = (cond, what, extra) => { if (cond) passes++; else { fails++; console.log("FAIL", what, extra === undefined ? "" : JSON.stringify(extra).slice(0, 700)); } };
const J = (o) => JSON.stringify(o);
const partRows = (nonce, name, value) => { const t = J(value); const out = []; for (let at = 0, n = 1; at < t.length || n === 1; at += 400000, n++) out.push({ step_name: "P|" + nonce + "|" + name + "|" + String(n).padStart(3, "0"), result_ref: t.slice(at, at + 400000) }); return out; };
const intentRows = (prefix, value) => [{ step_name: prefix + "001", result_ref: J(value) }];
const jrows = (objs) => objs.map((o) => ({ j: J(o) }));
const JOB = "2110000000000000001", GRID = "2110000000000000100", NONCE = "abcd1234";
const baseEntry = (extra) => Object.assign({ jobId: JOB, organizationId: "1123598813738675201", grId: GRID, grNo: "GR-1", plantId: "1123598813738675202", prevStatus: "Received",
  dbNow: "2026-10-15 10:00:00", attempts: 0, rowVersion: 3, unlockOk: "YES", partPrefix: "P|" + NONCE + "|", poLocks: {}, jitter: 2, r0Waits: 0, leaseUntil: "2026-10-15 10:10:00",
  manifest: { po_ids: ["2", "1"] } }, extra || {});

// ------------------------------------------------------------------ entry
{
  const { commitEntry } = load("entry.js", ["commitEntry"]);
  const guard = { jobId: JOB, tenantId: "000000", leaseOwner: "PUB|x", nonce: "00ff00ff" };
  const manifest = { v: 1, job_id: JOB, gr_id: GRID, gr_no: "GR'1", plant_id: "5", nonce: NONCE, previous_status: "Received", po_ids: ["2", "1"],
    counts: { lines: 3, movements: 3, fifo: 2, waDelete: 0, waRestate: 0, putaway: 0, transit: 0, qi: 0, batches: 0, poLines: 2, onOrder: 2 },
    parts: { ENGINE: ["x"], COST: ["x"], DOCS: ["x"], PO: ["x"], CHECK: ["x"] } };
  const job = (o) => [Object.assign({ db_now: "2026-10-15 10:00:00", lease_until: "2026-10-15 10:10:00", id: JOB, organization_id: "9", command: "REVERT_GR", job_status: "READY_TO_COMMIT", is_deleted: 0,
    row_version: 3, attempt_count: 0, idempotency_key: "K1", correlation_id: "GR|" + GRID, prev_status: "Received", due: 1, lease_live: 0, progress_percent: 60 }, o || {})];
  const gr = [{ gr_status: "Processing", lock_ref: "K1", gr_v2_job_id: JOB }];
  const pay = [{ prepared_payload: J(manifest) }];
  let r = commitEntry(guard, job(), [], pay, gr, []);
  ok(r.route === "GO" && r.phase === "A" && r.needR0 === "YES" && r.needR1 === "YES" && r.needR2 === "NO" && r.needR5 === "NO", "entry phase A", r);
  // the lease outlasts the engine call: 10 min + 0.6 s per movement, at most 90 min (the SPLIT hand-over carries the same)
  const lease = (n) => { const mm = JSON.parse(J(manifest)); mm.counts.movements = n; const x = commitEntry(guard, job(), [], [{ prepared_payload: J(mm) }], gr, []);
    return [x.jobRows[0].lease_expires_at, x.leaseUntil]; };
  ok(J(lease(undefined)) === J(["2026-10-15 10:10:00", "2026-10-15 10:10:00"]), "lease: no movements -> 10 min", lease(undefined));
  ok(J(lease(2500)) === J(["2026-10-15 10:35:00", "2026-10-15 10:35:00"]), "lease: 2,500 movements -> 35 min", lease(2500));
  ok(J(lease(20000)) === J(["2026-10-15 11:30:00", "2026-10-15 11:30:00"]), "lease: capped at 90 min", lease(20000));
  ok(r.poIdsSql === "0,2,1" && r.unlockOk === "YES" && r.prevStatus === "Received" && r.grNoSql === "GR''1" && r.jobRows[0].job_status === "COMMITTING_REVERT" && r.jobRows[0].lease_owner === "PUB|x", "entry fields + claim", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_REVERT", lease_owner: "SPLIT|n" }), [{ step_name: "R0_REVALIDATE", step_status: "DONE" }, { step_name: "R1_INVENTORY", step_status: "DONE" }], pay, [{ gr_status: "Processing" }], []);
  ok(r.route === "GO" && r.phase === "B" && r.needR2 === "YES" && r.needR3 === "NO" && r.needR4 === "YES" && r.needR5 === "YES" && r.unlockOk === "NO", "entry phase B", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_REVERT", lease_owner: "SPLIT|n" }), [{ step_name: "R1_INVENTORY", step_status: "DONE" }, { step_name: "R2_COSTING", step_status: "DONE" }, { step_name: "R4_PO", step_status: "DONE" }], pay, [{ gr_status: "Processing" }], []);
  ok(r.needR2 === "NO" && r.needR4 === "NO" && r.needR5 === "YES", "entry resume skips DONE steps", r);
  r = commitEntry(guard, job(), [], pay, [{ gr_status: "Received", lock_ref: "K1", gr_v2_job_id: JOB }], []);
  ok(r.route === "FAIL" && r.result_code === "GRV_NOT_LOCKED" && r.needUnlock === "NO", "entry lock lost -> FAILED, nothing put back", r);
  r = commitEntry(guard, job(), [], [{ prepared_payload: "{bad" }], gr, []);
  ok(r.route === "FAIL" && r.result_code === "GRV_INVALID_DATA" && r.needUnlock === "YES" && r.unlockRows[0].gr_status === "Received", "entry bad manifest -> back to Received", r);
  r = commitEntry(guard, job(), [{ step_name: "R1_INVENTORY", step_status: "DONE" }], [{ prepared_payload: "{bad" }], gr, []);
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW", "entry bad manifest after R1 -> review", r);
  r = commitEntry(guard, job({ prev_status: "Draft" }), [], pay, gr, []);
  ok(r.route === "FAIL" && r.result_code === "GRV_INVALID_DATA", "entry: a previous status that is not Completed / Received is invalid", r);
  r = commitEntry(guard, job({ command: "COMPLETE_GR" }), [], pay, gr, []);
  ok(r.route === "NO_WRITE" && /command/.test(r.result_message), "entry wrong command", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_REVERT", due: 0, next_attempt_at: "x" }), [], pay, gr, []);
  ok(r.route === "NO_WRITE" && /backoff/.test(r.result_message), "entry not due", r);
  const locks = [{ job_id: "GRPO|1", step_name: "HOLD|1", result_ref: "999", holder_status: "COMPLETED" }, { job_id: "GRPO|1", step_name: "FREE|1", result_ref: "999" },
    { job_id: "GRPO|1", step_name: "HOLD|2", result_ref: JOB, holder_status: "COMMITTING_REVERT" }, { job_id: "GRPO|2", step_name: "HOLD|1", result_ref: "555", holder_status: "COMMITTING_GR" }];
  r = commitEntry(guard, job(), [{ step_name: "R0_WAIT|1", step_status: "WAIT" }], pay, gr, locks);
  ok(r.poLocks["GRPO|1"].holder === JOB && r.poLocks["GRPO|1"].n === 2 && r.poLocks["GRPO|2"].held === "YES" && r.r0Waits === 1, "entry: a completion's hold counts as held", r.poLocks);
}

// ------------------------------------------------------------------ R0
{
  const { commitR0In } = load("r0_in.js", ["commitR0In"]);
  const { commitR0 } = load("r0.js", ["commitR0"]);
  const chk = { anchors: { "11|": "500", "12|b1": "600", "13|": "x" }, minLiveId: "400", itemIds: ["11", "12", "x13"], plantId: "5", names: { "11": "BOLT" } };
  const cost = { fifo: [{ id: "71", material_id: "11", initial: 5, available: 5 }], waDelete: [{ id: "81", material_id: "12", wa_quantity: 3, wa_cost_price: 2 }], waRestate: [] };
  const inp = commitR0In(baseEntry(), partRows(NONCE, "CHECK", chk), partRows(NONCE, "COST", cost));
  ok(inp.ok === "YES" && inp.itemIdsCsv === "0,11,12" && inp.minLiveIdSql === "400" && inp.fifoIdsSql === "0,71" && inp.waIdsSql === "0,81" && !inp.anchors["13|"] && inp.plantIdSql === "1123598813738675202", "R0 input: digits only", inp);
  ok(commitR0In(baseEntry(), [], []).ok === "NO", "R0 input: parts missing");
  const fifoOk = jrows([{ id: "71", fifo_initial_quantity: 5, fifo_available_quantity: 5, is_deleted: 0 }]);
  const waOk = jrows([{ id: "81", wa_quantity: "3.00000000", wa_cost_price: "2.0000", is_deleted: 0 }]);
  let r = commitR0(baseEntry(), inp, [{ item_id: "11", batch_id: "", max_id: "500", latest: "GRN GR-1" }], fifoOk, waOk);
  ok(r.route === "OK" && r.lockRows.length === 2 && r.lockRows[0].job_id === "GRPO|1" && r.lockRows[0].step_name === "HOLD|1" && r.stepRows[0].step_name === "R0_REVALIDATE", "R0 clean -> both PO locks in id order", r);
  r = commitR0(baseEntry(), inp, [{ item_id: "11", batch_id: "", max_id: "501", latest: "GDL GD-9" }], fifoOk, waOk);
  ok(r.route === "END" && r.result_code === "GRV_STALE" && r.job_status === "FAILED" && /Item BOLT has been used since this receipt \(latest: GDL GD-9\)/.test(r.result_message) && r.needUnlock === "YES" && r.unlockRows[0].gr_status === "Received", "R0 later movement -> FAILED, back to Received", r);
  ok(JSON.parse(r.jobRows[0].error_details).conflicts[0].type === "later_movement", "R0 conflicts in error_details", r.jobRows[0].error_details);
  r = commitR0(baseEntry(), inp, [{ item_id: "12", batch_id: "b2", max_id: "999", latest: "x" }], fifoOk, waOk);
  ok(r.route === "OK", "R0 a later movement of another batch is not this receipt's", r);
  r = commitR0(baseEntry(), inp, [], jrows([{ id: "71", fifo_initial_quantity: 5, fifo_available_quantity: 4, is_deleted: 0 }]), waOk);
  ok(r.result_code === "GRV_STALE" && /drawn down \(4 of 5 left\)/.test(r.result_message), "R0 FIFO layer drawn down", r.result_message);
  r = commitR0(baseEntry(), inp, [], jrows([{ id: "71", fifo_initial_quantity: 5, fifo_available_quantity: 5, is_deleted: 1 }]), waOk);
  ok(r.result_code === "GRV_STALE" && /no longer exists/.test(r.result_message), "R0 FIFO layer gone", r.result_message);
  r = commitR0(baseEntry(), inp, [], fifoOk, jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2.5, is_deleted: 0 }]));
  ok(r.result_code === "GRV_STALE" && /costing row for 12 has changed/.test(r.result_message), "R0 WA batch row changed", r.result_message);
  const busy = { "GRPO|1": { n: 2, holder: JOB, held: "YES" }, "GRPO|2": { n: 4, holder: "555", held: "YES" } };
  r = commitR0(baseEntry({ poLocks: busy, r0Waits: 3 }), inp, [], fifoOk, waOk);
  ok(r.route === "END" && r.result_code === "GRV_WAIT" && r.freeRows.length === 1 && r.freeRows[0].step_name === "FREE|2" && r.stepRows[0].step_name === "R0_WAIT|4" && r.jobRows[0].next_attempt_at === "2026-10-15 10:00:22", "R0 busy -> free mine + wait", r);
  r = commitR0(baseEntry({ poLocks: busy, r0Waits: 10 }), inp, [], fifoOk, waOk);
  ok(r.route === "END" && r.result_code === "GRV_PO_BUSY" && r.job_status === "FAILED" && r.needUnlock === "YES", "R0 busy 10 times -> FAILED", r);
  r = commitR0(baseEntry(), { ok: "NO", why: "parts missing" }, [], [], []);
  ok(r.result_code === "GRV_INVALID_DATA" && r.job_status === "FAILED", "R0 bad input", r);
}

// ------------------------------------------------------------------ R1
{
  const { commitR1In } = load("r1_in.js", ["commitR1In"]);
  const { commitR1 } = load("r1.js", ["commitR1"]);
  const mv = (k) => ({ movement_key: k, direction: "SUBTRACT", transaction_type: "GRN-R", material_id: "11", quantity: 5 });
  let i = commitR1In(baseEntry(), partRows(NONCE, "ENGINE", { operation_key: "GRV|" + JOB, movements: [mv("R1"), mv("R2")] }));
  ok(i.ok === "YES" && i.call === "YES" && i.movements.length === 2 && i.operationKey === "GRV|" + JOB, "R1 input", i);
  ok(commitR1In(baseEntry(), partRows(NONCE, "ENGINE", { operation_key: "GRV|" + JOB, movements: [mv("R|1")] })).ok === "NO", "R1 input refuses a key the engine refuses");
  ok(commitR1In(baseEntry(), partRows(NONCE, "ENGINE", { operation_key: "GRC|" + JOB, movements: [mv("R1")] })).ok === "NO", "R1 input refuses another operation key");
  const none = commitR1In(baseEntry(), partRows(NONCE, "ENGINE", { operation_key: "GRV|" + JOB, movements: [] }));
  ok(none.ok === "YES" && none.call === "NO", "R1 input: nothing to take back -> no call", none);
  const guard = { nonce: "00ff00ff" };
  let r = commitR1(baseEntry(), guard, none, {});
  ok(r.route === "OK" && r.needSplit === "YES" && r.splitRows[0].lease_owner === "SPLIT|00ff00ff" && r.stepRows[0].step_name === "R1_INVENTORY", "R1 no movements -> DONE + SPLIT", r);
  r = commitR1(baseEntry(), guard, i, { code: "200", result_code: "APPLIED", message: "2 movements" });
  ok(r.route === "OK" && r.needSplit === "YES" && r.splitRows[0].lease_expires_at === "2026-10-15 10:10:00", "R1 200 -> DONE + SPLIT", r);
  r = commitR1(baseEntry(), guard, i, { code: "409", result_code: "LOCK_BUSY" });
  ok(r.route === "END" && r.result_code === "GRV_WAIT" && r.needUnlock === "NO", "R1 409 -> wait", r);
  r = commitR1(baseEntry(), guard, i, { code: "400", result_code: "INSUFFICIENT_BALANCE", message: "x" });
  ok(r.route === "END" && r.result_code === "GRV_INVENTORY_INSUFFICIENT_BALANCE" && r.job_status === "FAILED" && r.unlockRows[0].gr_status === "Received", "R1 400 -> FAILED + back", r);
  r = commitR1(baseEntry(), guard, i, { code: "" });
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "R1 no answer -> review", r);
}

// ------------------------------------------------------------------ R2
{
  const { commitR2In } = load("r2_in.js", ["commitR2In"]);
  const { commitR2Plan } = load("r2_plan.js", ["commitR2Plan"]);
  const { commitR2Check } = load("r2_check.js", ["commitR2Check"]);
  const cost = { fifo: [{ id: "71", initial: 5, available: 5 }, { id: "72", initial: 2, available: 2 }], waDelete: [{ id: "81", wa_quantity: 3, wa_cost_price: 2 }],
    waRestate: [{ id: "91", material_id: "13", B: 4, C: 24 }] };
  const inp = commitR2In(baseEntry(), partRows(NONCE, "COST", cost));
  ok(inp.ok === "YES" && inp.fifoIdsSql === "0,71,72" && inp.waIdsSql === "0,81,91", "R2 input", inp);
  const fifo = jrows([{ id: "71", fifo_initial_quantity: 5, fifo_available_quantity: 5, is_deleted: 0 }, { id: "72", fifo_initial_quantity: 2, fifo_available_quantity: 2, is_deleted: 1 }]);
  const wa = jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2, is_deleted: 0 }, { id: "91", wa_quantity: "10.00000000", wa_cost_price: "5.00000000", is_deleted: 0 }]);
  let r = commitR2Plan(baseEntry({ attempts: 1 }), inp, [], fifo, wa);
  const set = r.waSetSlices[0].rows[0];
  ok(r.route === "GO" && r.fifoCount === 1 && r.fifoSlices[0].rows[0].id === "71" && r.waDelCount === 1 && r.waSetCount === 1 && r.needIntent === "YES", "R2 plan first run", r);
  ok(set.id === "91" && set.wa_quantity === "6.00000000" && set.wa_cost_price === "4.33333333", "R2 restate: q0 = 10 - 4, p0 = (5 x 10 - 24) / 6", set);
  const intent = JSON.parse(r.intentRows.map((x) => x.result_ref).join(""));
  ok(intent.wa[0].before.wa_quantity === "10.00000000" && r.intentRows[0].step_name === "R2|I|001", "R2 intent holds before + after", intent);
  r = commitR2Plan(baseEntry(), inp, intentRows("R2|I|", intent), fifo, jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2, is_deleted: 1 }, { id: "91", wa_quantity: "6.00000000", wa_cost_price: "4.33330000", is_deleted: 0 }]));
  ok(r.route === "GO" && r.waSetCount === 0 && r.waDelCount === 0 && r.needIntent === "NO", "R2 rerun: restated (rounded by the tenant) and removed rows are left alone", r);
  r = commitR2Plan(baseEntry(), inp, intentRows("R2|I|", intent), fifo, jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2, is_deleted: 0 }, { id: "91", wa_quantity: 11, wa_cost_price: 5, is_deleted: 0 }]));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && /changed by someone else/.test(r.result_message), "R2 rerun: a weighted average moved meanwhile -> review", r);
  r = commitR2Plan(baseEntry(), inp, [], jrows([{ id: "71", fifo_initial_quantity: 5, fifo_available_quantity: 1, is_deleted: 0 }]), wa);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && /drawn down to 1 of 5/.test(r.result_message), "R2 a FIFO layer drawn down after the stock went out -> review", r);
  r = commitR2Plan(baseEntry(), inp, [], fifo, jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2, is_deleted: 0 }, { id: "91", wa_quantity: 3, wa_cost_price: 5, is_deleted: 0 }]));
  ok(r.route === "END" && /below the 4 this receipt added/.test(r.result_message), "R2 weighted average below the receipt -> review", r.result_message);
  r = commitR2Plan(baseEntry(), inp, [], fifo, jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2, is_deleted: 0 }, { id: "91", wa_quantity: 5, wa_cost_price: 1, is_deleted: 0 }]));
  ok(r.route === "END" && /negative unit cost/.test(r.result_message), "R2 negative back-solved cost -> review", r.result_message);
  r = commitR2Plan(baseEntry(), inp, [], fifo, jrows([{ id: "81", wa_quantity: 3, wa_cost_price: 2, is_deleted: 0 }, { id: "91", wa_quantity: 4, wa_cost_price: 6, is_deleted: 0 }]));
  ok(r.route === "GO" && r.waSetSlices[0].rows[0].wa_quantity === "0.00000000" && r.waSetSlices[0].rows[0].wa_cost_price === "6.00000000", "R2 all of it was this receipt -> 0 at the old price", r.waSetSlices[0].rows[0]);
  const fifoB = jrows([{ id: "71", is_deleted: 1 }, { id: "72", is_deleted: 1 }]);
  r = commitR2Check(baseEntry(), inp, intentRows("R2|I|", intent), fifoB, jrows([{ id: "81", is_deleted: 1 }, { id: "91", wa_quantity: "6.00000000", wa_cost_price: "4.33333333" }]));
  ok(r.route === "OK" && r.stepRows[0].step_name === "R2_COSTING", "R2 check ok", r);
  r = commitR2Check(baseEntry(), inp, intentRows("R2|I|", intent), jrows([{ id: "71", is_deleted: 0 }, { id: "72", is_deleted: 1 }]), jrows([{ id: "81", is_deleted: 1 }, { id: "91", wa_quantity: "6.00000000", wa_cost_price: "4.33333333" }]));
  ok(r.route === "END" && r.result_code === "GRV_STEP_RETRY" && /FIFO layer 71/.test(r.result_message), "R2 check: a layer not removed -> retry", r);
}

// ------------------------------------------------------------------ R3
{
  const { commitR3In } = load("r3_in.js", ["commitR3In"]);
  const { commitR3Plan } = load("r3_plan.js", ["commitR3Plan"]);
  const { commitR3Check } = load("r3_check.js", ["commitR3Check"]);
  const docs = { putaway: ["31", "32"], transit: [{ id: "41", status: "Cancelled", open_qty: "0.00000000" }, { id: "42" }], qi: ["51"], batches: ["61", "x"] };
  const inp = commitR3In(baseEntry(), partRows(NONCE, "DOCS", docs));
  ok(inp.ok === "YES" && inp.toIdsSql === "0,31,32" && inp.itIdsSql === "0,41,42" && inp.batchIdsSql === "0,61", "R3 input: digits only", inp);
  const to = jrows([{ id: "31", is_deleted: 0, is_processing: 0 }, { id: "32", is_deleted: 1, is_processing: 0 }]);
  const it = jrows([{ id: "41", status: "In Transit", open_qty: 5 }, { id: "42", status: "Cancelled", open_qty: 0 }]);
  let r = commitR3Plan(baseEntry(), inp, to, it, jrows([{ id: "51", is_deleted: 0 }]), jrows([{ id: "61", is_deleted: 0 }]));
  ok(r.route === "GO" && r.toCount === 1 && r.toSlices[0].rows[0].id === "31" && r.itCount === 1 && r.itSlices[0].rows[0].status === "Cancelled" && r.itSlices[0].rows[0].open_qty === "0.00000000" && r.qiCount === 1 && r.batchCount === 1, "R3 plan", r);
  r = commitR3Plan(baseEntry(), inp, jrows([{ id: "31", is_deleted: 0, is_processing: 1, to_id: "TO-9" }, { id: "32", is_deleted: 1 }]), it, jrows([{ id: "51", is_deleted: 0 }]), jrows([{ id: "61", is_deleted: 0 }]));
  ok(r.route === "END" && r.result_code === "GRV_WAIT" && /TO-9/.test(r.result_message), "R3 a putaway being processed -> wait", r);
  r = commitR3Plan(baseEntry(), inp, to, it, [], jrows([{ id: "61", is_deleted: 0 }]));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && /inspection lot 51/.test(r.result_message), "R3 a document missing -> review", r);
  r = commitR3Check(baseEntry(), inp, jrows([{ id: "31", is_deleted: 1 }, { id: "32", is_deleted: 1 }]), jrows([{ id: "41", status: "Cancelled", open_qty: "0.00000000" }, { id: "42", status: "Cancelled", open_qty: 0 }]),
    jrows([{ id: "51", is_deleted: 1 }]), jrows([{ id: "61", is_deleted: 1 }]));
  ok(r.route === "OK" && r.stepRows[0].step_name === "R3_DOCS", "R3 check ok", r);
  r = commitR3Check(baseEntry(), inp, jrows([{ id: "31", is_deleted: 0 }, { id: "32", is_deleted: 1 }]), it, jrows([{ id: "51", is_deleted: 1 }]), jrows([{ id: "61", is_deleted: 1 }]));
  ok(r.route === "END" && r.result_code === "GRV_STEP_RETRY", "R3 check: a putaway not removed -> retry", r);
}

// ------------------------------------------------------------------ R4
{
  const { commitR4Plan } = load("r4_plan.js", ["commitR4Plan"]);
  const { commitR4Check } = load("r4_check.js", ["commitR4Check"]);
  const po = { poIds: ["1", "2"], poLines: [{ id: "11", po_id: "1", recv: 10, res: 10 }, { id: "12", po_id: "1", recv: 4, res: 4 }, { id: "21", po_id: "2", recv: 5, res: 5 }, { id: "22", po_id: "2", recv: 1, res: 0 }],
    onOrder: [{ po_line_id: "11", base: 10 }, { po_line_id: "21", base: 5 }] };
  const pol = jrows([
    { id: "11", purchase_order_id: "1", quantity: 10, received_qty: 10, created_received_qty: 0, outstanding_quantity: 0, line_status: "Completed" },
    { id: "12", purchase_order_id: "1", quantity: 10, received_qty: 10, created_received_qty: 2, outstanding_quantity: 0, line_status: "Completed" },
    { id: "13", purchase_order_id: "1", quantity: 1, received_qty: 0, created_received_qty: 0, outstanding_quantity: 1, line_status: "Issued", item_bundle_id: "B", item_id: "9" },
    { id: "14", purchase_order_id: "1", parent_id: "11", quantity: 1, received_qty: 5, line_status: "Issued" },
    { id: "21", purchase_order_id: "2", quantity: 5, received_qty: 3, created_received_qty: 0, outstanding_quantity: 2, line_status: "Processing" },
    { id: "22", purchase_order_id: "2", quantity: 2, received_qty: 2, created_received_qty: 0, outstanding_quantity: 0, line_status: "Draft" }]);
  const oo = jrows([{ id: "101", po_line_id: "11", open_qty: 0, received_qty: 10, scheduled_qty: 10 }, { id: "102", po_line_id: "11", open_qty: 0, received_qty: 10, scheduled_qty: 10 },
    { id: "201", po_line_id: "21", open_qty: 2, received_qty: 3, scheduled_qty: 5 }]);
  const poh = jrows([{ id: "1", po_status: "Completed", gr_status: "Fully Received", partially_received: "2 / 2", fully_received: "2 / 2" },
    { id: "2", po_status: "Processing", gr_status: "Partially Received", partially_received: "2 / 2", fully_received: "1 / 2" }]);
  let r = commitR4Plan(baseEntry(), partRows(NONCE, "PO", po), [], pol, oo, poh);
  const L = {};
  r.lineSlices.forEach((s) => s.rows.forEach((x) => (L[x.id] = x)));
  ok(r.route === "GO" && r.needIntent === "YES" && r.lineCount === 4 && r.ooCount === 3 && r.headerRows.length === 2, "R4 plan first run", r);
  ok(L["11"].received_qty === "0.00000000" && L["11"].outstanding_quantity === "10.00000000" && L["11"].line_status === "Issued" && L["11"].created_received_qty === "10.00000000", "R4 a fully reverted line -> Issued, reservation back", L["11"]);
  ok(L["12"].received_qty === "6.00000000" && L["12"].line_status === "Processing" && L["12"].created_received_qty === "6.00000000", "R4 a partly reverted line -> Processing", L["12"]);
  ok(L["21"].received_qty === "0.00000000" && L["21"].outstanding_quantity === "5.00000000" && L["21"].line_status === "Issued", "R4 more reverted than received -> clamped at 0", L["21"]);
  ok(L["22"].line_status === "Draft" && L["22"].received_qty === "1.00000000", "R4 a Draft line keeps its status", L["22"]);
  const O = {};
  r.ooSlices.forEach((s) => s.rows.forEach((x) => (O[x.id] = x)));
  ok(O["101"].received_qty === "0.00000000" && O["101"].open_qty === "10.00000000" && O["102"].open_qty === "10.00000000" && O["201"].received_qty === "0.00000000" && O["201"].open_qty === "5.00000000", "R4 every on-order row of the line", O);
  const H = {};
  r.headerRows.forEach((x) => (H[x.id] = x));
  ok(H["1"].po_status === "Processing" && H["1"].partially_received === "1 / 2" && H["1"].fully_received === "0 / 2" && H["1"].gr_status === "Created", "R4 PO 1: bundle item and child line not counted", H["1"]);
  ok(H["2"].po_status === "Processing" && H["2"].partially_received === "1 / 2" && H["2"].fully_received === "0 / 2", "R4 PO 2", H["2"]);
  const intent = JSON.parse(r.intentRows.map((x) => x.result_ref).join(""));
  const after = (rows, kind) => jrows(rows.map((x) => Object.assign({ id: x.id }, x.after)));
  r = commitR4Plan(baseEntry(), partRows(NONCE, "PO", po), intentRows("R4|I|", intent), after(intent.lines), after(intent.oo), after(intent.headers));
  ok(r.route === "GO" && r.lineCount === 0 && r.ooCount === 0 && r.headerRows.length === 0 && r.needIntent === "NO", "R4 rerun at after -> nothing to write", r);
  r = commitR4Plan(baseEntry(), partRows(NONCE, "PO", po), intentRows("R4|I|", intent), pol, oo, poh);
  ok(r.route === "GO" && r.lineCount === 4 && r.needIntent === "NO", "R4 rerun at before -> write from the intent", r);
  const moved = jrows([{ id: "11", purchase_order_id: "1", quantity: 10, received_qty: 7, created_received_qty: 0, line_status: "Completed" }]);
  r = commitR4Plan(baseEntry(), partRows(NONCE, "PO", po), intentRows("R4|I|", intent), moved, oo, poh);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "R4 rerun: a line moved by someone else -> review", r);
  r = commitR4Plan(baseEntry(), partRows(NONCE, "PO", po), [], jrows([{ id: "11", quantity: 10, received_qty: 10 }]), oo, poh);
  ok(r.route === "END" && /vanished/.test(r.result_message), "R4 a PO line gone -> review", r.result_message);
  const holds = { "GRPO|1": { n: 3, holder: JOB, held: "YES" }, "GRPO|2": { n: 1, holder: "555", held: "YES" } };
  r = commitR4Check(baseEntry({ poLocks: holds }), intentRows("R4|I|", intent), after(intent.lines), after(intent.oo), after(intent.headers));
  ok(r.route === "OK" && r.needFree === "YES" && r.freeRows.length === 1 && r.freeRows[0].job_id === "GRPO|1" && r.freeRows[0].step_name === "FREE|3", "R4 check -> frees this job's holds only", r);
  r = commitR4Check(baseEntry(), intentRows("R4|I|", intent), pol, oo, poh);
  ok(r.route === "END" && r.result_code === "GRV_STEP_RETRY", "R4 check: not written -> retry", r);
}

// ------------------------------------------------------------------ R5 + finish
{
  const { commitR5Plan } = load("r5_plan.js", ["commitR5Plan"]);
  const { commitR5Check } = load("r5_check.js", ["commitR5Check"]);
  const { commitFinish } = load("finish.js", ["commitFinish"]);
  let r = commitR5Plan(baseEntry(), [{ gr_status: "Processing" }]);
  ok(r.route === "GO" && r.needHeader === "YES" && r.headerRows[0].gr_status === "Created" && r.headerRows[0].previous_status === "Created" && r.headerRows[0].putaway_status === "" && r.headerRows[0].id === GRID, "R5 plan", r);
  r = commitR5Plan(baseEntry(), [{ gr_status: "Created" }]);
  ok(r.route === "GO" && r.needHeader === "NO", "R5 rerun: already Created", r);
  r = commitR5Plan(baseEntry(), [{ gr_status: "Completed" }]);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "R5 not Processing -> review", r);
  ok(commitR5Check(baseEntry(), [{ gr_status: "Created" }]).route === "OK", "R5 check ok");
  ok(commitR5Check(baseEntry(), [{ gr_status: "Processing" }]).result_code === "GRV_STEP_RETRY", "R5 check: not written -> retry");
  r = commitFinish(baseEntry(), [{ job_id: "GRPO|1", step_name: "HOLD|3", result_ref: JOB, holder_status: "COMMITTING_REVERT" }]);
  ok(r.needFree === "YES" && r.freeRows[0].step_name === "FREE|3" && r.jobRows[0].job_status === "COMPLETED" && /GR-1 reverted to Created/.test(r.result_message), "finish", r);
  r = commitFinish(baseEntry({ poLocks: { "GRPO|1": { n: 1, holder: JOB, held: "YES" } } }), [{ job_id: "GRPO|1", step_name: "HOLD|1", result_ref: JOB, holder_status: "COMMITTING_REVERT" }, { job_id: "GRPO|1", step_name: "FREE|1", result_ref: JOB }]);
  ok(r.freeRows.length === 0 && r.needFree === "NO", "finish after R4 freed in the same run: no second FREE", r);
}

// ------------------------------------------------------------------ R2 COST locks
{
  const { commitR2LockKeys } = load("r2_lock_keys.js", ["commitR2LockKeys"]);
  const { commitR2LockSeed } = load("r2_lock_seed.js", ["commitR2LockSeed"]);
  const { commitR2LockClaim } = load("r2_lock_claim.js", ["commitR2LockClaim"]);
  const { commitR2LockVerify } = load("r2_lock_verify.js", ["commitR2LockVerify"]);
  const { commitR2LockRelease } = load("r2_lock_release.js", ["commitR2LockRelease"]);
  const { commitR2LockReleased } = load("r2_lock_released.js", ["commitR2LockReleased"]);
  const e = baseEntry({ plantId: "5" });
  const OP = "GRV|" + JOB + "|R2";
  const k = commitR2LockKeys(e, { ok: "YES", fifo: [{ id: "71", material_id: "12" }], waDelete: [{ id: "81", material_id: "11" }], waRestate: [{ id: "91", material_id: "12" }, { id: "92", material_id: "x" }] });
  ok(k.need === "YES" && J(k.keys) === J(["COST|11|5", "COST|12|5"]) && k.keysJson === J(k.keys) && k.opKey === OP, "R2 lock keys: one per material, sorted, digits only", k);
  ok(commitR2LockKeys(e, { ok: "NO" }).need === "NO", "R2 lock keys: no input -> no lock");
  ok(commitR2LockKeys(baseEntry({ plantId: "0x" }), { ok: "YES", fifo: [{ id: "71", material_id: "12" }] }).need === "NO", "R2 lock keys: no plant -> no lock");
  const sd = commitR2LockSeed(e, k, [{ id: "1", lock_key: "cost|11|5", is_deleted: 0 }]);
  ok(sd.needSeed === "YES" && J(sd.addSlices[0].rows) === J([{ organization_id: e.organizationId, lock_key: "COST|12|5", balance_type: "COST", free_token: 1, lock_version: 0,
    owner_operation_id: "", last_owner_operation_id: "" }]), "R2 lock seed: only the missing key (case-insensitive), the engine's row", sd);
  ok(commitR2LockSeed(e, k, [{ id: "1", lock_key: "COST|11|5" }, { id: "2", lock_key: "COST|12|5" }]).needSeed === "NO", "R2 lock seed: nothing missing");
  let threw = "";
  try { commitR2LockSeed(e, k, [{ id: "1", lock_key: "COST|11|5", is_deleted: 1 }]); } catch (x) { threw = x.message; }
  ok(/soft-deleted/.test(threw), "R2 lock seed: a soft-deleted row on a key fails the run", threw);
  const row = (id, key, t, owner, last) => ({ id: id, lock_key: key, free_token: t, owner_operation_id: owner || "", last_owner_operation_id: last || "", db_now: "2026-10-16 21:00:00" });
  let c = commitR2LockClaim(e, k, [row("1", "COST|11|5", 1), row("2", "COST|12|5", 1)]);
  ok(c.route === "TAKE" && c.needTake === "YES" && J(c.ids) === J(["1", "2"]) && c.claimedAt === "2026-10-16 21:00:00", "R2 claim: both free -> TAKE in key order, DB clock", c);
  c = commitR2LockClaim(e, k, [row("1", "COST|11|5", 0, OP), row("2", "COST|12|5", 1)]);
  ok(c.route === "TAKE" && J(c.ids) === J(["2"]), "R2 claim: a key still held from a run that died is kept, the other taken", c);
  c = commitR2LockClaim(e, k, [row("1", "COST|11|5", 0, OP), row("2", "COST|12|5", 0, OP)]);
  ok(c.route === "HELD" && c.needTake === "NO" && c.ids.length === 0, "R2 claim: all held already -> HELD", c);
  c = commitR2LockClaim(e, k, [row("1", "COST|11|5", 1), row("2", "COST|12|5", 0, "IBA|GDC|9")]);
  ok(c.route === "BUSY" && c.needTake === "NO" && c.ids.length === 0 && /COST\|12\|5 \(IBA\|GDC\|9\)/.test(c.busy), "R2 claim: a key another operation holds -> BUSY, nothing taken", c);
  c = commitR2LockClaim(e, k, [row("1", "COST|11|5", 1)]);
  ok(c.route === "BUSY" && /COST\|12\|5 \(lock row not created yet\)/.test(c.busy), "R2 claim: a row the seed did not create -> BUSY", c);
  c = commitR2LockClaim(e, k, [row("1", "COST|11|5", 1), row("2", "COST|12|5", 0, "", OP)]);
  ok(c.route === "BUSY" && /not given back by GRV/.test(c.busy), "R2 claim: a row cleared without its GIVE -> BUSY (the exit gives it back)", c);
  let v = commitR2LockVerify(e, k, { route: "TAKE" }, [row("1", "COST|11|5", 0, OP), row("2", "COST|12|5", 0, OP)]);
  ok(v.route === "HELD" && v.needJobUpd === "NO", "R2 verify: both held by this revert -> on", v);
  v = commitR2LockVerify(e, k, { route: "TAKE" }, [row("1", "COST|11|5", 0, OP), row("2", "COST|12|5", 0, "IBA|X")]);
  ok(v.route === "END" && v.result_code === "GRV_WAIT" && v.job_status === "COMMITTING_REVERT" && v.jobRows[0].next_attempt_at === "2026-10-15 10:00:05" && v.jobRows[0].attempt_count === 0
    && v.jobRows[0].lease_owner === null, "R2 verify: a key not taken -> wait 5 s, not counted, lease released", v);
  v = commitR2LockVerify(e, k, { route: "BUSY", busy: "COST|12|5 (IBA|X)" }, []);
  ok(v.route === "END" && /held by another operation: COST\|12\|5/.test(v.result_message), "R2 verify: a busy claim -> wait", v);
  const held = [row("1", "COST|11|5", 0, OP), row("2", "COST|12|5", 0, "", OP), row("3", "COST|13|5", 0, "IBA|X"), row("4", "COST|14|5", 1, "", OP)].map((x, i) => Object.assign(x, { lock_version: i }));
  const r = commitR2LockRelease(e, held);
  ok(r.opKey === OP && r.needRelease === "YES" && J(r.plusIds) === J(["1", "2"]), "R2 release: its own row + a row cleared without its GIVE; not another's, not a free one", r);
  ok(J(r.clearSlices[0].rows) === J([{ id: "1", owner_operation_id: "", last_owner_operation_id: OP, last_released_at: "2026-10-16 21:00:00", lock_version: 1 }]),
    "R2 release: owner cleared (last owner, DB clock, version + 1) only on the owned row", r.clearSlices);
  ok(commitR2LockRelease(e, []).needRelease === "NO", "R2 release: nothing held");
  ok(commitR2LockReleased(e, []).route === "OK", "R2 released: none left -> on");
  const rr = commitR2LockReleased(e, [row("2", "COST|12|5", 0, "", OP)]);
  ok(rr.route === "END" && rr.result_code === "GRV_STEP_RETRY" && rr.jobRows[0].attempt_count === 1 && /not given back \(e\.g\. COST\|12\|5\)/.test(rr.result_message), "R2 released: a lock left -> counted retry", rr);
}

console.log("revert commit unit tests: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
