// IA_REVERT_V2_COMMIT step functions on crafted inputs (no DB), and the COPY TRAP (f-brief, binding): the COST-lock owner of a
// revert job lives in four places - v2_lock_keys.js opKey (TAKE), v2_lock_release.js op (clear + GIVE) and the two literals of every
// release read in the BUILT COMMIT (owner_operation_id, last_owner_operation_id) - and all four must be IAV|<jobId>|C.
// usage: node commit_unit.js
const fs = require("fs");
const path = require("path");
const H = require("./_harness");
const ok = H.ok;
const J = (o) => JSON.stringify(o);
const C = (f) => "code/revert/commit/" + f;
const FILES = ["_common.js", "entry.js", "own.js", "result.js", "finish.js", "v0.js", "v1_in.js", "v1_ans.js", "v1.js", "v2_in.js", "v2_lock_keys.js", "v2_lock_seed.js", "v2_lock_claim.js",
  "v2_lock_verify.js", "v2_lock_release.js", "v2_lock_released.js", "v2_plan.js", "v2_check.js", "v3_in.js", "v3_plan.js", "v3_check.js", "v4_plan.js", "v4_check.js"].map(C);
const NAMES = ["commitEntry", "commitOwn", "commitResult", "commitFinish", "commitV0", "commitV1In", "commitV1Ans", "commitV1", "commitV2In", "commitV2LockKeys", "commitV2LockSeed",
  "commitV2LockClaim", "commitV2LockVerify", "commitV2LockRelease", "commitV2LockReleased", "commitV2Plan", "commitV2Check", "commitV3In", "commitV3Plan", "commitV3Check", "commitV4Plan",
  "commitV4Check", "iaMovesFingerprint", "iaRvCostOwner"];
const sb = H.loadSteps(FILES, NAMES);
const F = (name, ...a) => H.fromBox(sb[name](...a.map((x) => H.intoBox(sb, x))));
const JOB = "2112900000000000001";
const IA = "2120000000000000001";
const KEY = "IAV:TEST:KEY:0001";
const NONCE = "abcd1234";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const PARENT = "2120000000000000002";
const partRows = (name, value) => {
  const t = J(value);
  const out = [];
  for (let at = 0, n = 1; at < t.length || n === 1; at += 400000, n++) out.push({ step_name: "P|" + NONCE + "|" + name + "|" + String(n).padStart(3, "0"), result_ref: t.slice(at, at + 400000) });
  return out;
};
const jrows = (objs) => objs.map((o) => ({ j: J(o) }));
const entry = (o) => Object.assign({ jobId: JOB, tenantId: "000000", organizationId: ORG, iaId: IA, iaNo: "IA-1", plantId: PLANT, prevStatus: "Completed", idempotencyKey: KEY,
  movesFingerprint: "IM1:3:0123456789abcdef", movementCount: 3, costCount: 1, batchCount: 1, v1FinishedAt: "2026-10-19 12:00:00", progress: 85,
  progressMessage: "Restoring the costing rows, the batches and the Item Assembly", dbNow: "2026-10-19 12:00:10", jsAt: "0", attempts: 0, rowVersion: 6,
  leaseUntil: "2026-10-19 12:10:10", unlockOk: "NO", partPrefix: "P|" + NONCE + "|" }, o || {});
const entryA = (o) => entry(Object.assign({ progress: 70, progressMessage: "Taking back the stock of 3 movement(s)", unlockOk: "YES" }, o || {}));
const guard = { jobId: JOB, tenantId: "000000", leaseOwner: "PUB|ff", nonce: "00ff00ff" };

// ---------------------------------------------------------------- entry
{
  const manifest = { v: 1, job_id: JOB, ia_id: IA, ia_no: "IA-1", plant_id: PLANT, nonce: NONCE, movesFingerprint: "IM1:3:0123456789abcdef",
    parts: { ENGINE: ["x"], COST: ["x"], BATCH: ["x"], HDR: ["x"], LABELS: ["x"] }, counts: { movements: 3, fifo: 1, waDelete: 0, waRestate: 0, batches: 1 } };
  const job = (o) => [Object.assign({ db_now: "2026-10-19 12:00:00", lease_until: "2026-10-19 12:10:00", id: JOB, organization_id: ORG, command: "REVERT_IA", job_status: "READY_TO_COMMIT",
    is_deleted: 0, row_version: 3, attempt_count: 0, idempotency_key: KEY, correlation_id: "IA|" + IA, prev_status: "Completed", due: 1, lease_live: 0, lease_owner: "WRK|w", progress_percent: 60,
    line_count: 3 }, o || {})];
  const ia = (o) => [Object.assign({ ia_id: IA, item_assembly_status: "Processing", ia_v2_job_id: JOB, stock_movement_no: "IA-1", lock_ref: KEY }, o || {})];
  const pay = [{ prepared_payload: J(manifest) }];
  let r = F("commitEntry", guard, job(), [], pay, ia());
  ok(r.route === "GO" && r.phase === "A" && r.needV0 === "YES" && r.needV1 === "YES" && r.needV2 === "NO" && r.needV4 === "NO" && r.unlockOk === "YES" && r.partPrefix === "P|" + NONCE + "|"
    && r.jobRows[0].job_status === "COMMITTING_REVERT" && r.jobRows[0].lease_owner === "PUB|ff" && r.jobRows[0].progress_percent === 70 && r.jobRows[0].row_version === 4, "entry phase A + the lease claim", r);
  const steps = (names) => names.map((n) => ({ step_name: n, step_status: "DONE", finished_at: n === "V1_INVENTORY" ? "2026-10-19 11:59:00" : "2026-10-19 11:58:00" }));
  r = F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT", lease_owner: "SPLIT|x" }), steps(["V0_REVALIDATE", "V1_INVENTORY"]), pay, ia());
  ok(r.route === "GO" && r.phase === "B" && r.needV2 === "YES" && r.needV3 === "YES" && r.needV4 === "YES" && r.needV1 === "NO" && r.unlockOk === "NO" && r.v1FinishedAt === "2026-10-19 11:59:00"
    && r.jobRows[0].progress_percent === 85, "entry phase B (after a SPLIT hand-over): V2 V3 V4, never an unlock, V1's finish time", r);
  r = F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT" }), steps(["V0_REVALIDATE", "V1_INVENTORY", "V2_COST", "V3_BATCH"]), pay, ia({ item_assembly_status: "Draft" }));
  ok(r.route === "GO" && r.needV2 === "NO" && r.needV3 === "NO" && r.needV4 === "YES", "entry resume: DONE steps skipped; Draft under this job's key is fine in phase B", r);
  r = F("commitEntry", guard, job(), [], pay, ia({ item_assembly_status: "Completed" }));
  ok(r.route === "FAIL" && r.result_code === "IA_RV_NOT_LOCKED" && r.needUnlock === "NO" && r.jobRows[0].job_status === "FAILED", "entry: lock lost before V1 -> FAILED, nothing put back", r);
  r = F("commitEntry", guard, job(), [], [{ prepared_payload: "{bad" }], ia());
  ok(r.route === "FAIL" && r.result_code === "IA_RV_INVALID_DATA" && r.needUnlock === "YES" && r.unlockRows[0].item_assembly_status === "Completed", "entry: bad manifest before V1 -> FAILED + Completed again", r);
  r = F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT" }), steps(["V1_INVENTORY"]), [{ prepared_payload: "{bad" }], ia());
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "entry: bad manifest after V1 -> REQUIRES_REVIEW", r);
  r = F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT" }), steps(["V1_INVENTORY"]), pay, ia({ ia_v2_job_id: "999" }));
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW", "entry: after V1 the IA belongs to another job -> REQUIRES_REVIEW", r);
  r = F("commitEntry", guard, job({ prev_status: "Draft" }), [], [{ prepared_payload: "{bad" }], ia());
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RV_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO", "entry: owned + prevStatus unknown -> REVIEW, no unlock", r);
  // fix wave R2: a phase-A failure once the engine operation IAV|<job> has an intent / DONE row -> REQUIRES_REVIEW, no unlock
  const ops = (n) => [{ op_rows: String(n) }];
  r = F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT" }), steps(["V0_REVALIDATE"]), pay, [], ops(2));
  ok(r.route === "REVIEW" && r.opWrote === "YES" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RV_RECONCILIATION_MISMATCH" && r.needUnlock === "NO"
    && JSON.parse(r.jobRows[0].error_details).step === "V1_INVENTORY", "R2 entry: IA gone before V1 DONE but IAV|<job> wrote -> REQUIRES_REVIEW, no unlock", r);
  r = F("commitEntry", guard, job(), [], [{ prepared_payload: "{bad" }], ia(), ops(1));
  ok(r.route === "REVIEW" && r.needUnlock === "NO" && r.unlockRows.length === 0, "R2 entry: a bad manifest with engine rows -> REVIEW, nothing put back", r);
  r = F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT" }), steps(["V0_REVALIDATE"]), pay, [], ops(0));
  ok(r.route === "FAIL" && r.opWrote === "NO" && r.job_status === "FAILED" && r.result_code === "IA_RV_NOT_LOCKED", "R2 entry: no engine row -> the clean FAILED as before", r);
  ok(F("commitEntry", guard, job(), [], pay, ia(), ops(3)).route === "GO", "R2 entry: an owned IA with engine rows runs on (V1 replays the operation)");
  const jw = (code, det) => job({ job_status: "COMMITTING_REVERT", error_code: code, error_details: det === undefined ? null : J(det) });
  const st2 = steps(["V0_REVALIDATE", "V1_INVENTORY"]);
  ok(F("commitEntry", guard, jw("IA_RV_WAIT", { step: "V2_COST", why: "x", waitFrom: "2026-10-19 15:00:00" }), st2, pay, ia()).v2WaitFrom === "2026-10-19 15:00:00"
    && F("commitEntry", guard, jw("IA_RV_STEP_RETRY", { step: "V2_COST", waitFrom: "2026-10-19 15:00:00" }), st2, pay, ia()).v2WaitFrom === ""
    && F("commitEntry", guard, jw(null), st2, pay, ia()).v2WaitFrom === "" && F("commitEntry", guard, jw("IA_RV_WAIT", "{bad"), st2, pay, ia()).v2WaitFrom === "",
  "R4 entry: the wait start is carried only while the job is in a V2 wait (a reset / another error starts a new window)");
  ok(F("commitEntry", guard, job({ command: "COMPLETE_IA" }), [], pay, ia()).route === "NO_WRITE", "entry: another command -> answer only");
  ok(/backoff/.test(F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT", due: 0, next_attempt_at: "x" }), [], pay, ia()).result_message), "entry: not due -> answer only");
  ok(F("commitEntry", guard, job({ job_status: "COMMITTING_REVERT", lease_owner: "PUB|other", lease_live: 1 }), [], pay, ia()).result_code === "JOB_ROW_VERSION_CONFLICT", "entry: a live foreign lease -> answer only");
  ok(F("commitEntry", guard, job({ job_status: "COMPLETED" }), [], pay, ia()).route === "NO_WRITE", "entry: a COMPLETED job is not run again");
  ok(F("commitOwn", guard, [{ id: JOB, job_status: "COMMITTING_REVERT", lease_owner: "PUB|ff" }]).route === "GO" && F("commitOwn", guard, [{ id: JOB, job_status: "COMMITTING_REVERT", lease_owner: "PUB|x" }]).route === "LOST",
    "own: this run's lease -> GO, another's -> LOST");
}
// ---------------------------------------------------------------- V0
{
  const moves = [{ id: "2120000000000000010", transaction_type: "IA", movement: "OUT", item_id: "5", base_qty: "1.00000000" }];
  const fp = F("iaMovesFingerprint", moves);
  let r = F("commitV0", entryA({ movesFingerprint: fp }), moves);
  ok(r.route === "OK" && r.stepRows[0].step_name === "V0_REVALIDATE", "V0: IM1 unchanged -> DONE", r);
  r = F("commitV0", entryA(), moves);
  ok(r.route === "END" && r.result_code === "IA_RV_ROWS_CHANGED" && r.job_status === "FAILED" && r.unlockRows[0].item_assembly_status === "Completed" && r.unlockRows[0].id === IA,
    "V0: IM1 changed -> FAILED IA_RV_ROWS_CHANGED + Completed again", r);
  r = F("commitV0", entryA({ unlockOk: "NO", movesFingerprint: fp }), moves);
  ok(r.result_code === "IA_RV_NOT_LOCKED" && r.needUnlock === "NO", "V0: not owned -> FAILED, no unlock", r);
}
// ---------------------------------------------------------------- V1
{
  const mv = (k, d) => ({ movement_key: k, direction: d, material_id: "5", quantity: 1, transaction_type: "IA-R" });
  const eng = { operation_key: "IAV|" + JOB, mode: "APPLY", organization_id: ORG, movements: [mv("M1", "SUBTRACT"), mv("M2", "ADD")] };
  const inp = F("commitV1In", entryA(), partRows("ENGINE", eng));
  ok(inp.ok === "YES" && inp.needCall === "YES" && inp.operationKey === "IAV|" + JOB && J(inp.keys) === J(["M1", "M2"]) && inp.count === 2, "V1 input", inp);
  ok(F("commitV1In", entryA(), partRows("ENGINE", Object.assign({}, eng, { operation_key: "IAC|" + JOB + "|I" }))).ok === "NO", "V1 input: another operation key is refused");
  ok(F("commitV1In", entryA(), partRows("ENGINE", Object.assign({}, eng, { organization_id: "9" }))).ok === "NO", "V1 input: another organization is refused");
  const none = F("commitV1In", entryA(), partRows("ENGINE", Object.assign({}, eng, { movements: [] })));
  ok(none.ok === "YES" && none.needCall === "NO", "V1 input: no movement -> no call", none);
  const ans = (o) => F("commitV1Ans", { needCall: "YES" }, o);
  ok(J(ans({ code: "409", result_code: "LOCK_BUSY" })) === J({ code: "409", result_code: "LOCK_BUSY", message: "", need409: "YES", need400: "NO" }), "V1 answer: 409 -> read the intents");
  ok(ans({ code: 400, msg: "boom" }).need409 === "YES" && ans({ code: 400, msg: "boom" }).message === "boom", "V1 answer: the platform's 400 envelope (no result_code) -> transient, msg kept");
  ok(ans({ code: "400", result_code: "INSUFFICIENT" }).need400 === "YES", "V1 answer: 400 with a result_code -> read LABELS");
  const labels = partRows("LABELS", { M1: { item_code: "FG-1", bin: "FG-01", category: "Blocked", side: "out" } });
  const V1 = (e, a, ops, cnt) => F("commitV1", e, guard, { ok: "YES", needCall: "YES", why: "", keys: ["M1", "M2"], count: cnt || 2 }, a, ops || { intents: "0" }, labels);
  let r = V1(entryA(), { code: "200", result_code: "APPLIED", message: "2 movements" });
  ok(r.route === "OK" && r.path === "SPLIT" && r.splitRows[0].lease_owner === "SPLIT|00ff00ff" && r.splitRows[0].lease_expires_at === "2026-10-19 12:10:10" && r.splitRows[0].progress_percent === 80
    && r.splitRows[0].attempt_count === 0 && r.stepRows[0].step_name === "V1_INVENTORY", "V1 200 -> DONE + SPLIT, progress 80", r);
  r = V1(entryA({ movementCount: 1001 }), { code: "200", result_code: "REPLAYED" });
  ok(r.path === "PARK" && r.splitRows[0].lease_owner === null && r.splitRows[0].next_attempt_at === "2026-10-19 12:00:10", "V1 above 1,000 movements -> PARK (due now, no lease)", r.splitRows[0]);
  r = F("commitV1", entryA(), guard, { ok: "YES", needCall: "NO", why: "", keys: [], count: 0 }, {}, {}, []);
  ok(r.route === "OK" && r.path === "SPLIT", "V1 nothing to take back -> DONE + SPLIT", r);
  r = V1(entryA(), { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M1)" });
  ok(r.route === "END" && r.result_code === "IA_RV_INVENTORY_INSUFFICIENT" && r.jobRows[0].error_message === "Insufficient quantity - FG-1, bin FG-01 (Blocked)" && r.unlockRows[0].item_assembly_status === "Completed",
    "V1 400 -> FAILED IA_RV_INVENTORY_<code>, mapped, Completed again", r);
  r = V1(entryA({ attempts: 2 }), { code: "409", result_code: "LOCK_BUSY", message: "COST|9|1 held" });
  ok(r.route === "END" && r.result_code === "IA_RV_LOCK_WAIT" && r.jobRows[0].next_attempt_at === "2026-10-19 12:01:10" && r.jobRows[0].attempt_count === 3 && r.needUnlock === "NO",
    "V1 409 (no intents) -> lock wait 15 s x 2^2", r.jobRows[0]);
  r = V1(entryA({ attempts: 8 }), { code: "409", result_code: "LOCK_BUSY" });
  ok(r.result_code === "IA_RV_INVENTORY_LOCK_BUSY" && r.job_status === "FAILED" && r.needUnlock === "YES" && r.jobRows[0].error_message === "The stock of its components stayed locked by another operation: nothing was moved, please try again later.",
    "V1 409 after 8 waits -> FAILED IA_RV_INVENTORY_LOCK_BUSY + Completed again", r);
  r = V1(entryA(), { code: "", result_code: "" }, { intents: "2" });
  ok(r.result_code === "IA_RV_STEP_RETRY" && r.job_status === "COMMITTING_REVERT" && r.needUnlock === "NO", "V1 no answer WITH intents -> a counted retry, never an unlock", r);
  r = V1(entryA({ attempts: 3 }), { code: "", result_code: "" }, { intents: "2" });
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RV_RECONCILIATION_MISMATCH", "V1 no answer with intents, retries spent -> REQUIRES_REVIEW", r);
  r = V1(entryA(), { code: "500", result_code: "REQUIRES_REVIEW", message: "x" });
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "V1 500 -> REQUIRES_REVIEW at once", r);
}
// ---------------------------------------------------------------- V2 COST (part, locks, plan, check)
const OP = "IAV|" + JOB + "|C";
{
  const cost = { material_id: PARENT, plant_id: PLANT,
    fifo: [{ id: "71", material_id: PARENT, before: { fifo_initial_quantity: "2.00000000", fifo_available_quantity: "2.00000000" }, after: { is_deleted: 1 } }],
    waDelete: [{ id: "81", material_id: PARENT, before: { wa_quantity: "2.00000000", wa_cost_price: "0.00000000" }, after: { is_deleted: 1 } }],
    waRestate: [{ id: "91", material_id: PARENT, before: { wa_quantity: "10.00000000", wa_cost_price: "5.00000000" }, after: { wa_quantity: "6.00000000", wa_cost_price: "4.33333333" } }] };
  const inp = F("commitV2In", entry(), partRows("COST", cost));
  ok(inp.ok === "YES" && inp.fifoIdsSql === "0,71" && inp.waIdsSql === "0,81,91" && J(inp.materials) === J([PARENT]), "V2 input", inp);
  ok(F("commitV2In", entry(), partRows("COST", { fifo: [{ id: "x", before: {}, after: {} }] })).ok === "NO", "V2 input: a row without a digit id is refused");
  const k = F("commitV2LockKeys", entry(), inp);
  ok(k.need === "YES" && J(k.keys) === J(["COST|" + PARENT + "|" + PLANT]) && k.keysJson === J(k.keys) && k.opKey === OP, "V2 lock keys: COST|<parent>|<plant>, owner IAV|<job>|C", k);
  ok(F("commitV2LockKeys", entry({ plantId: "x" }), inp).need === "NO" && F("commitV2LockKeys", entry(), { ok: "NO" }).need === "NO", "V2 lock keys: no plant / no input -> no lock");
  const KEYX = "COST|" + PARENT + "|" + PLANT;
  const sd = F("commitV2LockSeed", entry(), k, []);
  ok(sd.needSeed === "YES" && J(sd.addSlices[0].rows) === J([{ organization_id: ORG, lock_key: KEYX, balance_type: "COST", free_token: 1, lock_version: 0, owner_operation_id: "", last_owner_operation_id: "" }]),
    "V2 lock seed: the engine's row, free_token 1", sd);
  ok(F("commitV2LockSeed", entry(), k, [{ id: "1", lock_key: KEYX.toLowerCase(), is_deleted: 0 }]).needSeed === "NO", "V2 lock seed: present (case-insensitive) -> no seed");
  let threw = "";
  try {
    sb.commitV2LockSeed(H.intoBox(sb, entry()), H.intoBox(sb, k), H.intoBox(sb, [{ id: "1", lock_key: KEYX, is_deleted: 1 }]));
  } catch (x) {
    threw = String(x.message);
  }
  ok(/IA_RV_LOCK_SEED/.test(threw), "V2 lock seed: a soft-deleted row on the key fails the run", threw);
  const row = (t, owner, last) => ({ id: "1", lock_key: KEYX, free_token: t, owner_operation_id: owner || "", last_owner_operation_id: last || "", db_now: "2026-10-19 12:00:20", lock_version: 3 });
  let c = F("commitV2LockClaim", entry(), k, [row(1)]);
  ok(c.route === "TAKE" && J(c.ids) === J(["1"]) && c.claimedAt === "2026-10-19 12:00:20", "V2 claim: free -> TAKE, the DB clock", c);
  ok(F("commitV2LockClaim", entry(), k, [row(0, OP)]).route === "HELD", "V2 claim: still held by this revert (a run that died) -> HELD");
  c = F("commitV2LockClaim", entry(), k, [row(0, "IAV|" + JOB)]);
  ok(c.route === "BUSY" && /IAV\|2112900000000000001\)/.test(c.busy), "V2 claim: held by the ENGINE operation IAV|<job> itself is NOT this lock's owner -> BUSY (no nesting)", c);
  ok(F("commitV2LockClaim", entry(), k, []).route === "BUSY" && F("commitV2LockClaim", entry(), k, [row(0, "", OP)]).route === "BUSY", "V2 claim: no row yet / cleared without its GIVE -> BUSY");
  let v = F("commitV2LockVerify", entry(), k, { route: "TAKE" }, [row(0, OP)]);
  ok(v.route === "HELD" && v.needJobUpd === "NO", "V2 verify: held by IAV|<job>|C -> on", v);
  v = F("commitV2LockVerify", entry(), k, { route: "BUSY", busy: KEYX + " (IBA|GDC|9)" }, []);
  ok(v.route === "END" && v.result_code === "IA_RV_WAIT" && v.jobRows[0].next_attempt_at === "2026-10-19 12:00:15" && v.jobRows[0].attempt_count === 0 && v.jobRows[0].lease_owner === null
    && v.job_status === "COMMITTING_REVERT", "V2 verify: BUSY -> wait 5 s, not counted, lease released", v);
  ok(JSON.parse(v.jobRows[0].error_details).waitFrom === "2026-10-19 12:00:10", "R4 V2 verify: the first wait stores its start (waitFrom = now)", v.jobRows[0].error_details);
  v = F("commitV2LockVerify", entry({ dbNow: "2026-10-19 15:00:00" }), k, { route: "BUSY", busy: KEYX }, []);
  ok(v.result_code === "IA_RV_WAIT" && JSON.parse(v.jobRows[0].error_details).waitFrom === "2026-10-19 15:00:00",
    "R4 V2 verify: a first wait 3 hours after V1 DONE is a wait, not a review (the window starts now)", v);
  v = F("commitV2LockVerify", entry({ dbNow: "2026-10-19 15:30:00", v2WaitFrom: "2026-10-19 15:00:00" }), k, { route: "TAKE" }, [row(0, "IBA|X")]);
  ok(v.result_code === "IA_RV_WAIT" && JSON.parse(v.jobRows[0].error_details).waitFrom === "2026-10-19 15:00:00", "R4 V2 verify: not taken, 1,800 s exactly after the first wait -> still a wait, start kept", v);
  v = F("commitV2LockVerify", entry({ dbNow: "2026-10-19 15:30:01", v2WaitFrom: "2026-10-19 15:00:00" }), k, { route: "BUSY", busy: KEYX }, []);
  ok(v.job_status === "REQUIRES_REVIEW" && v.result_code === "IA_RV_COST_TIMEOUT" && /1801 s after V2's first wait/.test(v.result_message),
    "R4 V2 verify: still busy 1,801 s after the first wait -> REQUIRES_REVIEW IA_RV_COST_TIMEOUT", v);
  const rel = F("commitV2LockRelease", entry(), [row(0, OP), Object.assign(row(0, "", OP), { id: "2" }), Object.assign(row(0, "IBA|X"), { id: "3" }), Object.assign(row(1, "", OP), { id: "4" })]);
  ok(rel.opKey === OP && J(rel.plusIds) === J(["1", "2"]) && J(rel.clearSlices[0].rows) === J([{ id: "1", owner_operation_id: "", last_owner_operation_id: OP, last_released_at: "2026-10-19 12:00:20", lock_version: 4 }]),
    "V2 release: its own row cleared + given back, a row cleared without its GIVE given back; not another's, not a free one", rel);
  ok(F("commitV2LockRelease", entry(), []).needRelease === "NO", "V2 release: nothing held");
  ok(F("commitV2LockReleased", entry(), []).route === "OK" && F("commitV2LockReleased", entry(), [row(0, "", OP)]).result_code === "IA_RV_STEP_RETRY", "V2 released: none left -> on; else a counted retry");
  const fifoAt = (o) => jrows([Object.assign({ id: "71", fifo_initial_quantity: 2, fifo_available_quantity: 2, is_deleted: 0 }, o || {})]);
  const waAt = (d, s) => jrows([Object.assign({ id: "81", wa_quantity: 2, wa_cost_price: 0, is_deleted: 0 }, d || {}), Object.assign({ id: "91", wa_quantity: 10, wa_cost_price: 5, is_deleted: 0 }, s || {})]);
  let p = F("commitV2Plan", entry(), inp, fifoAt(), waAt());
  ok(p.route === "GO" && p.fifoCount === 1 && p.waDelCount === 1 && p.waSetCount === 1 && J(p.waSetSlices[0].rows) === J([{ id: "91", wa_quantity: "6.00000000", wa_cost_price: "4.33333333" }])
    && J(p.fifoSlices[0].rows) === J([{ id: "71", is_deleted: 1 }]), "V2 plan: every row at before -> the classic's writes", p);
  p = F("commitV2Plan", entry(), inp, fifoAt({ is_deleted: 1 }), waAt({ is_deleted: 1 }, { wa_quantity: 6, wa_cost_price: 4.3333 }));
  ok(p.route === "GO" && p.fifoCount + p.waDelCount + p.waSetCount === 0, "V2 plan: a re-run finds every row at after (the restate rounded by the tenant) -> nothing to write", p);
  p = F("commitV2Plan", entry(), inp, fifoAt({ fifo_available_quantity: 1.5 }), waAt());
  ok(p.route === "END" && p.job_status === "REQUIRES_REVIEW" && p.result_code === "IA_RV_COST_CHANGED" && /1.5 of 2 left/.test(p.result_message), "V2 plan: a layer drawn down meanwhile -> REQUIRES_REVIEW IA_RV_COST_CHANGED", p);
  p = F("commitV2Plan", entry(), inp, fifoAt(), waAt({}, { wa_quantity: 11 }));
  ok(p.result_code === "IA_RV_COST_CHANGED", "V2 plan: the running average moved meanwhile -> IA_RV_COST_CHANGED", p);
  p = F("commitV2Plan", entry(), inp, [], waAt());
  ok(p.result_code === "IA_RV_COST_CHANGED" && /is gone/.test(p.result_message), "V2 plan: a row gone -> IA_RV_COST_CHANGED", p);
  const zero = F("commitV2In", entry(), partRows("COST", { material_id: PARENT, fifo: [], waDelete: [{ id: "81", before: { wa_quantity: "2.00000000", wa_cost_price: "0.00000000" }, after: { is_deleted: 1 } }], waRestate: [] }));
  ok(F("commitV2Plan", entry(), zero, [], jrows([{ id: "81", wa_quantity: 2, wa_cost_price: 0, is_deleted: 0 }])).waDelCount === 1, "V2 plan: a zero cost price ('0E-8' read as 0.00000000) still matches its before-value");
  let ck = F("commitV2Check", entry(), inp, fifoAt({ is_deleted: 1 }), waAt({ is_deleted: 1 }, { wa_quantity: "6.00000000", wa_cost_price: "4.33333333" }));
  ok(ck.route === "OK" && ck.stepRows[0].step_name === "V2_COST", "V2 check: all at after -> DONE", ck);
  ck = F("commitV2Check", entry(), inp, fifoAt(), waAt({ is_deleted: 1 }, { wa_quantity: "6.00000000", wa_cost_price: "4.33333333" }));
  ok(ck.result_code === "IA_RV_STEP_RETRY", "V2 check: a layer not removed -> retry", ck);
}
// ---------------------------------------------------------------- V3, V4, finish, result
{
  const inp = F("commitV3In", entry(), partRows("BATCH", { batchDeletes: ["61", "62"] }));
  ok(inp.ok === "YES" && inp.idsSql === "0,61,62", "V3 input", inp);
  ok(F("commitV3In", entry(), partRows("BATCH", { batchDeletes: ["x"] })).ok === "NO", "V3 input: a non-digit id is refused");
  let p = F("commitV3Plan", entry(), inp, jrows([{ id: "61", is_deleted: 0 }, { id: "62", is_deleted: 1 }]));
  ok(p.route === "GO" && p.batchCount === 1 && J(p.batchSlices[0].rows) === J([{ id: "61", is_deleted: 1 }]), "V3 plan: what is not removed yet", p);
  p = F("commitV3Plan", entry(), inp, jrows([{ id: "61", is_deleted: 0 }]));
  ok(p.route === "END" && p.job_status === "REQUIRES_REVIEW", "V3 plan: a batch row gone -> review", p);
  ok(F("commitV3Check", entry(), inp, jrows([{ id: "61", is_deleted: 1 }, { id: "62", is_deleted: 1 }])).route === "OK", "V3 check ok");
  ok(F("commitV3Check", entry(), inp, jrows([{ id: "61", is_deleted: 0 }, { id: "62", is_deleted: 1 }])).result_code === "IA_RV_STEP_RETRY", "V3 check: not removed -> retry");
  const hdr = partRows("HDR", { id: IA, before: { item_assembly_status: "Processing" }, after: { item_assembly_status: "Draft", posted_status: "" } });
  const now = (o) => [Object.assign({ ia_id: IA, item_assembly_status: "Processing", posted_status: "Unposted", ia_v2_job_id: JOB, lock_ref: KEY }, o || {})];
  p = F("commitV4Plan", entry(), hdr, now());
  ok(p.route === "GO" && p.needHeader === "YES" && J(p.headerRows) === J([{ id: IA, item_assembly_status: "Draft", posted_status: "" }]), "V4 plan: Processing under this job -> Draft + posted blank (number kept)", p);
  ok(F("commitV4Plan", entry(), hdr, now({ item_assembly_status: "Draft" })).needHeader === "NO", "V4 plan: already Draft -> done");
  ok(F("commitV4Plan", entry(), hdr, now({ lock_ref: "other" })).job_status === "REQUIRES_REVIEW", "V4 plan: Processing under another lock -> review");
  ok(F("commitV4Plan", entry(), hdr, now({ item_assembly_status: "Completed" })).job_status === "REQUIRES_REVIEW", "V4 plan: Completed by someone else -> review");
  ok(F("commitV4Check", entry(), { item_assembly_status: "Draft", posted_status: "" }, now({ item_assembly_status: "Draft", posted_status: null })).route === "OK", "V4 check: Draft, posted blank -> DONE");
  ok(F("commitV4Check", entry(), { item_assembly_status: "Draft", posted_status: "" }, now()).result_code === "IA_RV_STEP_RETRY", "V4 check: still Processing -> retry");
  const fin = F("commitFinish", entry());
  ok(fin.jobRows[0].job_status === "COMPLETED" && fin.jobRows[0].progress_percent === 100 && fin.jobRows[0].lease_owner === null && fin.jobRows[0].finished_at && /IA-1 reverted to Draft/.test(fin.result_message),
    "finish: COMPLETED 100, lease released", fin);
  const res = F("commitResult", guard, entry({ phase: "B" }), { job_status: "COMPLETED", result_message: "x" }, "DONE");
  ok(res.path === "DONE" && JSON.parse(res.evidence).workflow === "IA_REVERT_V2_COMMIT", "result", res);
}
// ---------------------------------------------------------------- the COPY TRAP: four owner strings, one value
{
  const doc = JSON.parse(fs.readFileSync(path.join(H.IAV2, "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_REVERT_V2_COMMIT.json"), "utf8"));
  const sqls = [];
  const take = [];
  const give = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.type === "sql-node" && /FROM inventory_balance_lock/.test(n.data.script.code) && /free_token = 0/.test(n.data.script.code)) sqls.push(n);
      if (n.type === "workflow-node" && /INVENTORY_LOCK_TOKENS/.test(n.data.workflow.source)) (/TAKE/.test(n.data.title) ? take : give).push(n);
      Object.values(n).forEach(walk);
    }
  };
  walk(doc.nodes);
  const opKey = F("commitV2LockKeys", entry(), { ok: "YES", materials: [PARENT] }).opKey;
  const relOp = F("commitV2LockRelease", entry(), []).opKey;
  ok(opKey === OP && relOp === OP && F("iaRvCostOwner", JOB) === OP, "COPY TRAP: TAKE opKey = release op = IAV|<job>|C", { opKey: opKey, relOp: relOp });
  ok(sqls.length === 5, "COPY TRAP: every release read of the built COMMIT found (v2lk, v2pl, v2, v2fin + its read-back)", sqls.map((n) => n.id));
  for (const n of sqls) {
    const filled = n.data.script.code.split("{{node:code_node_IVCguard.data.jobId}}").join(JOB);
    const lits = filled.match(/owner_operation_id = '([^']*)'/g) || [];
    ok(lits.length === 2 && lits.every((l) => l.indexOf("'" + OP + "'") > 0), "COPY TRAP: " + n.id + " names IAV|<job>|C twice (owner_operation_id, last_owner_operation_id)", lits);
  }
  ok(take.length === 1 && take[0].data.body_params.list.find((p) => p.prop === "operation_id").value === "{{node:code_node_IVCv2lkeys.data.opKey}}", "COPY TRAP: TAKE's operation_id is the lock keys' opKey", take.map((n) => n.id));
  ok(give.length === 4 && give.every((g) => /^\{\{node:code_node_IVC[a-z0-9]+rel\.data\.opKey\}\}$/.test(g.data.body_params.list.find((p) => p.prop === "operation_id").value)
    && g.data.body_params.list.find((p) => p.prop === "claimed_at").value === ""), "COPY TRAP: every GIVE's operation_id is its release plan's op, claimed_at ''", give.map((n) => n.id));
}
H.done("commit unit");
