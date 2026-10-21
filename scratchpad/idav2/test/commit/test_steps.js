// node test/commit/test_steps.js - unit tests of every IDA_V2_COMMIT step decision on crafted inputs; each step function is loaded from the
// BUILT JSON node (exactly what ships) with the unit loader's strip rule. Per step: rows at the after-value -> done (nothing written); at the
// before-value -> write; anything else -> FAILED + back to Draft (phase A, nothing moved) or REQUIRES_REVIEW (phase B); the D1 decision
// table rows 1-14 one by one. Plus the built JSON's write nodes, engine calls, gates, exit order and declared output types.
const X = require("./fixture.js");
X.utc8(__filename);
const { JOB, IDAID, ORG, PLANT, NONCE, KEY, IDANO } = X;
let fails = 0;
let passes = 0;
const ok = (cond, what, extra) => { if (cond) passes++; else { fails++; console.log("FAIL", what, extra === undefined ? "" : JSON.stringify(extra).slice(0, 1200)); } };
const L = (id, names) => X.loadNode("IDA_V2_COMMIT", id, names);
const J = (o) => JSON.stringify(o);
const DB_NOW = "2026-10-21 10:00:00";
const guard = { route: "CONTINUE", jobId: JOB, tenantId: "000000", nonce: "00ff00ff00ff00ff00ff00ff", leaseOwner: "PUB|00ff00ff00ff00ff00ff00ff" };
const rowsOf = (c, name) => c.partStepRows.filter((r) => r.step_name.indexOf("P|" + NONCE + "|" + name + "|") === 0);
const doc = X.built("IDA_V2_COMMIT");
const node = (id) => X.nodeById(doc, id);
const props = (id) => node(id).data.props.list.map((p) => p.prop);
const MIX = [{ kind: "none" }, { kind: "typed", number: "LOT-7", item: 50 }, { kind: "typed", number: "LOT-7", item: 50 }, { kind: "auto" }, { kind: "ns" }, { kind: "nsauto" }, { kind: "auto", alt: true }];
const mix = () => X.makeCase({ lines: MIX });
const bncRows = (running) => [{ j: J(X.bnc(running)) }];
const intentOf = (numbers, configs) => [{ step_name: "D1|I|001", result_ref: J({ numbers: numbers, configs: configs }) }];
const batchRow = (id, o) => ({ j: J(Object.assign({ id: id, batch_number: "LOT-7", material_id: X.itemId(50), plant_id: PLANT, organization_id: ORG, transaction_no: IDANO }, o || {})) });

function entryOf(c, patch) {
  return Object.assign({ jobId: JOB, tenantId: "000000", organizationId: ORG, plantId: PLANT, idaId: IDAID, idaNo: IDANO, prevStatus: "Draft", idempotencyKey: KEY, dbNow: DB_NOW,
    jsAt: String(Date.now()), attempts: 0, rowVersion: 5, leaseUntil: "2026-10-21 10:10:00", progress: 70, progressMessage: "Issuing the item being disassembled (1 source pick)", unlockOk: "YES",
    partPrefix: "P|" + NONCE + "|", batchMode: c.batchMode, needBatchRead: c.batchMode === "insert" ? "YES" : "NO", movementsI: c.movementsI.length, movementsR: c.movementsR.length,
    lineFingerprint: c.fp, d2DoneAt: "", op1Wrote: "NO", op2Wrote: "NO", opWrote: "NO", waitFrom: "", hasIntent: "NO", phase: "A" }, patch || {});
}
const ids = (r) => (r.batchDelSlices || []).reduce((a, sl) => a.concat(sl.rows.map((x) => x.id)), []);

// ------------------------------------------------------------------ the built JSON: writes, calls, gates, order
{
  const all = [];
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type) all.push(n); Object.values(n).forEach(walk); } };
  walk(doc);
  const unl = all.filter((n) => n.type === "update-node" && /Item Disassembly:Table:2106937624568991746/.test(J(n.data.table_id)) && n.id !== "update_node_DCd4status");
  ok(unl.length === 7 && unl.every((n) => J(n.data.props.list.map((p) => p.prop)) === J(["id", "item_disassembly_status"])), "every COMMIT unlock writes { id, item_disassembly_status } on Item Disassembly only",
    unl.map((n) => n.id));
  const del = all.filter((n) => n.type === "update-node" && /Batch:Table:1902719754154655746/.test(J(n.data.table_id)));
  ok(del.length === 7 && del.every((n) => J(n.data.props.list.map((p) => p.prop)) === J(["id", "is_deleted"]) && /data\.rows\.id/.test(J(n.data.table_id))),
    "every Batch soft-delete writes { id, is_deleted } from a <= 250-row slice", del.map((n) => n.id));
  for (const tag of ["ef", "d0", "d1pl", "d1de", "d1ck", "d1", "d2"]) {
    const blk = (tag === "ef" ? node("ifBlock_TDCentryend") : node("ifBlock_TDC" + tag + "end")).blocks.map((n) => n.id);
    const u = blk.indexOf("cor_DC" + tag + "unlock"), b = blk.indexOf("loop_DC" + tag + "bd"), jb = blk.indexOf("cor_DC" + tag + "job");
    ok(u >= 0 && u < b && b < jb, tag + ": a phase-A exit writes the unlock, then the Batch soft-delete slices, then the job", blk);
  }
  for (const tag of ["ef", "d0", "d2"]) ok(node("cor_DC" + tag + "ours").blocks[0].blocks[0].type === "condition-all-node", tag + ": the ours read is one fork-join behind its gate");
  ok(J(props("add_node_DCd1iwrite")) === J(X.BATCH_COLS) && /Batch:Table:/.test(J(node("add_node_DCd1iwrite").data.table_id)), "D1 Batch insert = add_node_F9KqZLfd's 11 columns", props("add_node_DCd1iwrite"));
  ok(J(props("update_node_DCd1cfg")) === J(["id", "running_number", "last_reset_date"]) && /Batch Number Configuration:Table:2058765580973846530/.test(J(node("update_node_DCd1cfg").data.table_id)),
    "D1 config write: id, running_number, last_reset_date");
  ok(J(props("update_node_DCd4status")) === J(["id", "item_disassembly_status", "posted_status"]), "D4 header write: id, item_disassembly_status, posted_status only");
  ok(J(props("update_node_DCd4lwrite")) === J(["id", "batch_number"]) && /Stock movement\(Item Disassembly\):Table:2107013922280640514/.test(J(node("update_node_DCd4lwrite").data.table_id)),
    "D4 line numbers: { id, batch_number } on the line collection");
  ok(J(props("update_node_DCd3prog")) === J(["id", "progress_percent", "progress_message"]), "D3 progress write: 3 columns (the lease kept)");
  ok(J(props("update_node_DCd4iwrite")) === J(["id", "last_transaction_date"]) && /Item:Table:1901546842240438273/.test(J(node("update_node_DCd4iwrite").data.table_id)), "D4 item dates by id");
  const call = (id) => { const d = node(id).data; return [d.workflow.source, d.body_params.list.map((p) => [p.prop, p.valueType === "value" ? p.value : "ref"])]; };
  const eng = "INVENTORY_BULK_APPLY:Workflow:2109916822821744641";
  ok(J(call("workflow_node_DCd2")) === J([eng, [["operation_key", "ref"], ["mode", "APPLY"], ["organization_id", "ref"], ["movements", "ref"]]]), "D2 = APPLY with the 4 params");
  ok(J(call("workflow_node_DCd3")) === J([eng, [["operation_key", "ref"], ["mode", "APPLY"], ["organization_id", "ref"], ["movements", "ref"]]]), "D3 = APPLY with the 4 params (alloc never sent)");
  ok(J(call("workflow_node_DCd1plan")) === J([eng, [["operation_key", "ref"], ["mode", "PLAN"], ["organization_id", "ref"], ["movements", "ref"]]]), "D1 re-PLAN = PLAN with the 4 params");
  const d1 = node("ifBlock_TDCd1").blocks.map((n) => n.id);
  const at = (x) => d1.indexOf(x);
  ok(at("cor_DCd1intent") > at("if_DCd1deend") && at("cor_DCd1intent") < at("cor_DCd1cfg") && at("cor_DCd1cfg") < at("loop_DCd1i") && at("loop_DCd1i") < at("condition_all_DCd1back")
    && at("condition_all_DCd1back") < at("cor_DCd1plan") && at("cor_DCd1plan") < at("cor_DCd1done"), "D1: decide -> intent -> configs -> Batch inserts -> read-back -> re-PLAN -> DONE", d1);
  const d2 = node("ifBlock_TDCd2").blocks.map((n) => n.id);
  ok(d2.indexOf("cor_DCd2done") < d2.indexOf("cor_DCsplit") && d2.indexOf("cor_DCsplit") < d2.indexOf("code_node_DCsplitres"), "D2: DONE row, then the SPLIT / PARK hand-over, then the answer", d2);
  const d4 = node("ifBlock_TDCd4").blocks.map((n) => n.id);
  ok(d4.indexOf("loop_DCd4l") < d4.indexOf("loop_DCd4i") && d4.indexOf("loop_DCd4i") < d4.indexOf("cor_DCd4status"), "D4: line numbers, item dates, then the header LAST", d4);
  const top = doc.nodes.map((n) => n.id);
  ok(["condition_all_DCfacts", "code_node_DCentry", "update_node_DCclaim", "if_DCd0", "if_DCd1", "if_DCd2", "if_DCd3", "if_DCd4", "code_node_DCfinish"].every((id, i, a) => i === 0 || top.indexOf(a[i - 1]) < top.indexOf(id)),
    "order: ONE facts fork-join, entry, claim, D0 D1 D2 D3 D4, finish", top);
  ok(node("condition_all_DCfacts").blocks.length === 7, "the entry reads 7 facts in ONE fork-join");
  ok(/REGEXP '\^D\[0-9\]_'/.test(node("sql_node_DCsteps").data.script.code) && /LIKE 'D1\|I\|%'/.test(node("sql_node_DCintent").data.script.code), "steps SQL REGEXP '^D[0-9]_'; the intent read apart");
  const out = node("sql_node_DCd3out").data.script.code;
  ok(/m\.id > \{\{node:code_node_DCguard\.data\.jobId\}\}/.test(out) && /operation_effect_key LIKE 'IDC\|\{\{node:code_node_DCguard\.data\.jobId\}\}\|I\|%'/.test(out) && /SUM\(m\.total_price\)/.test(out)
    && /m\.organization_id = '\{\{node:code_node_DCentry\.data\.organizationId\}\}'/.test(out), "D3 reads op 1's stored rows: id > job, LIKE 'IDC|<job>|I|%', the organization, SUM in SQL");
  const ida = node("sql_node_DCida").data.script.code;
  ok(/g\.is_deleted = 0/.test(ida) && /CONCAT\('IDC\|', SUBSTRING\(j\.correlation_id, 5\)\)/.test(ida), "the entry's ownership read: live IDA, the IDC| lock of the job's correlation");
  ok(/JSON_TABLE\('\{\{node:code_node_DCd1plan\.data\.hexSql\}\}'/.test(node("sql_node_DCd1hold").data.script.code) && /UNHEX/.test(node("sql_node_DCd1holdB").data.script.code),
    "D1's holders: the plan's hex-encoded numbers (no free text in SQL)");
  const sqls = all.filter((n) => n.type === "sql-node");
  ok(sqls.length >= 30 && sqls.every((n) => /tenant_id = '\{\{node:code_node_DCguard\.data\.tenantId\}\}'/.test(n.data.script.code)), "every SQL node (" + sqls.length + ") is tenant-scoped");
  ok(sqls.every((n) => /^\s*(SELECT|WITH)\b/i.test(n.data.script.code) && !/\bSET\b/i.test(n.data.script.code)), "every SQL starts with SELECT, no SET");
  ok(sqls.filter((n) => /FROM batch b/.test(n.data.script.code)).every((n) => /b\.organization_id = /.test(n.data.script.code) && /b\.is_deleted = 0/.test(n.data.script.code)),
    "every Batch read scopes the organization and live rows");
}

// ------------------------------------------------------------------ entry
{
  const { commitEntry } = L("code_node_DCentry", ["commitEntry"]);
  const c = mix();
  const job = (p) => [Object.assign({ db_now: DB_NOW, lease_until: "2026-10-21 10:10:00", id: JOB, organization_id: ORG, command: "COMPLETE_IDA", job_status: "READY_TO_COMMIT", progress_percent: 60,
    attempt_count: 0, row_version: 5, idempotency_key: KEY, correlation_id: "IDA|" + IDAID, is_deleted: 0, lease_owner: "WRK|abc", lease_live: 1, due: 1, prev_status: "Draft", req_action: "DIRECT" }, p || {})];
  const pay = (m) => [{ prepared_payload: J(m || c.manifest) }];
  const ida = (p) => [Object.assign({ ida_id: IDAID, item_disassembly_status: "Processing", ida_v2_job_id: JOB, stock_movement_no: IDANO, lock_ref: KEY }, p || {})];
  const step = (name, ref, at) => ({ step_name: name, step_status: "DONE", result_ref: ref || "", finished_at: at || "2026-10-21 09:59:00" });
  const none = [{ intents: 0, review: 0, done_summary: null }];
  let r = commitEntry(guard, job(), [], [], pay(), ida(), none, none);
  ok(r.route === "GO" && r.phase === "A" && r.needD0 === "YES" && r.needD1 === "YES" && r.needD2 === "YES" && r.needD3 === "NO" && r.unlockOk === "YES" && r.progress === 70
    && r.jobRows[0].lease_owner === guard.leaseOwner && r.jobRows[0].row_version === 6 && r.jobRows[0].job_status === "COMMITTING_IDA" && r.progressMessage === "Issuing the item being disassembled (1 source pick)",
    "entry: READY -> phase A, D0 D1 D2, the lease claim", r);
  // the job-sized lease: 600 s + 0.6 s per movement of both legs (1 + 5 = 6 -> 604 s)
  ok(r.leaseUntil === "2026-10-21 10:10:04" && r.jobRows[0].lease_expires_at === "2026-10-21 10:10:04", "entry: lease = db_now + idaLeaseSeconds(movementsI + movementsR)", r.leaseUntil);
  const big = Object.assign(JSON.parse(J(c.manifest)), { counts: Object.assign({}, c.manifest.counts, { movementsI: 1, movementsR: 2000 }) });
  ok(commitEntry(guard, job(), [], [], pay(big), ida(), none, none).leaseUntil === "2026-10-21 10:30:01", "entry: 2,001 movements -> 1,801 s lease (2,000 lines = 30 min)");
  const huge = Object.assign(JSON.parse(J(c.manifest)), { counts: Object.assign({}, c.manifest.counts, { movementsI: 5000, movementsR: 5000 }) });
  ok(commitEntry(guard, job(), [], [], pay(huge), ida(), none, none).leaseUntil === "2026-10-21 11:30:00", "entry: the lease caps at 5,400 s");
  // phase B of more than IDA_PARK receipts takes the cap; up to IDA_PARK keeps the job-sized lease (phase A above stays job-sized at 2,001)
  const phaseB = (m) => commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "", lease_live: 0 }), [step("D0_REVALIDATE"), step("D1_BATCH"), step("D2_ISSUE", J({ called: "YES" }))],
    [], pay(m), ida(), [{ intents: 1, review: 0, done_summary: J({ movements: 1 }) }], none);
  const at1000 = Object.assign(JSON.parse(J(c.manifest)), { counts: Object.assign({}, c.manifest.counts, { movementsI: 1, movementsR: 1000 }) });
  let pb = phaseB(big);
  ok(pb.phase === "B" && pb.leaseUntil === "2026-10-21 11:30:00" && pb.jobRows[0].lease_expires_at === "2026-10-21 11:30:00", "entry: phase B of 2,000 receipts -> the 5,400 s cap", pb);
  pb = phaseB(at1000);
  ok(pb.phase === "B" && pb.leaseUntil === "2026-10-21 10:20:01", "entry: phase B of 1,000 receipts keeps the job-sized lease (1,001 movements -> 1,201 s)", pb.leaseUntil);
  ok(typeof r.attempts === "number" && typeof r.rowVersion === "number" && typeof r.movementsR === "number" && r.partPrefix === "P|" + NONCE + "|" && r.needBatchRead === "YES", "entry: numbers stay numbers (declared any)");
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "SPLIT|x", lease_live: 1 }), [step("D0_REVALIDATE"), step("D1_BATCH"), step("D2_ISSUE", J({ called: "YES" }), "2026-10-21 09:58:00")],
    [], pay(), ida(), [{ intents: 1, review: 0, done_summary: J({ movements: 1 }) }], none);
  ok(r.route === "GO" && r.phase === "B" && r.needD3 === "YES" && r.needD4 === "YES" && r.unlockOk === "NO" && r.progress === 75 && r.d2DoneAt === "2026-10-21 09:58:00" && r.progressMessage === "Source issued; receiving the recovered components",
    "entry: D2 DONE + a SPLIT| lease -> phase B at 75", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "PUB|old", lease_live: 0 }), [step("D0_REVALIDATE"), step("D1_BATCH"), step("D2_ISSUE"), step("D3_RECEIPT")], [], pay(),
    ida({ item_disassembly_status: "Completed" }), none, none);
  ok(r.route === "GO" && r.phase === "B" && r.needD3 === "NO" && r.needD4 === "YES" && r.progress === 85 && r.skipNote === "", "entry: D3 DONE, the IDA already Completed (D4 wrote it) -> phase B at 85, D4 only", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "PUB|old", lease_live: 0 }), [step("D0_REVALIDATE"), step("D1_BATCH"), step("D2_ISSUE"),
    step("D3_RECEIPT", J({ out_rows: 1, out_total: "1", movements: 5, result_code: "OK", skipped: ["R3"], skipped_count: 1 }))], [], pay(), ida(), none, none);
  ok(r.skipNote === " (1 receipt skipped, stock control 0: R3)" && r.progressMessage === "Components received; finishing (1 receipt skipped, stock control 0: R3)" && r.jobRows[0].progress_message === r.progressMessage,
    "entry: an earlier D3 DONE with a skip -> the note rides the claim's progress message", r);
  // fix round 1 (review Minor 1): a READY_TO_COMMIT claim starts COMMIT's count at 0; a resumed COMMITTING_IDA keeps its own
  r = commitEntry(guard, job({ attempt_count: 3 }), [], [], pay(), ida(), none, none);
  ok(r.route === "GO" && r.attempts === 0 && r.jobRows[0].attempt_count === 0, "entry: READY_TO_COMMIT with PREPARE's 3 attempts -> the claim writes attempt_count 0", r.jobRows[0]);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "", lease_live: 0, attempt_count: 2 }), [step("D0_REVALIDATE")], [], pay(), ida(), none, none);
  ok(r.route === "GO" && r.attempts === 2 && r.jobRows[0].attempt_count === 2, "entry: a COMMITTING_IDA resume keeps its attempt_count (2)", r.jobRows[0]);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "PUB|other", lease_live: 1 }), [], [], pay(), ida(), none, none);
  ok(r.route === "NO_WRITE" && r.result_code === "JOB_ROW_VERSION_CONFLICT", "entry: a foreign live lease -> NO_WRITE", r.result_code);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_owner: "", lease_live: 0, due: 0, next_attempt_at: "2026-10-21 10:05:00" }), [], [], pay(), ida(), none, none);
  ok(r.route === "NO_WRITE" && r.result_code === "" && /not due/.test(r.result_message), "entry: backoff not over -> NO_WRITE", r.result_message);
  for (const st of ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "QUEUED", "VALIDATING"]) {
    r = commitEntry(guard, job({ job_status: st }), [], [], pay(), ida(), none, none);
    ok(r.route === "NO_WRITE" && r.result_code === (st === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION") && r.jobRows.length === 0, "entry: " + st + " -> NO_WRITE", r.result_code);
  }
  ok(commitEntry(guard, job({ command: "COMPLETE_IA" }), [], [], pay(), ida(), none, none).route === "NO_WRITE" && commitEntry(guard, [], [], [], pay(), ida(), none, none).result_code === "IDA_INVALID_DATA",
    "entry: another command / no job -> NO_WRITE");
  r = commitEntry(guard, job(), [], [], pay(), ida({ item_disassembly_status: "Draft" }), none, none);
  ok(r.route === "FAIL" && r.job_status === "FAILED" && r.result_code === "IDA_NOT_LOCKED" && r.needUnlock === "NO" && r.needBatchDel === "NO" && r.needOursRead === "NO", "entry: no longer Processing -> FAILED, no unlock", r);
  r = commitEntry(guard, job(), [], [], pay(), [], none, none);
  ok(r.route === "FAIL" && r.result_code === "IDA_NOT_LOCKED" && r.needUnlock === "NO" && /deleted/.test(r.result_message), "entry: the IDA soft-deleted -> FAILED, no unlock", r.result_message);
  r = commitEntry(guard, job(), [], [], pay(), ida({ lock_ref: "another-key" }), none, none);
  ok(r.route === "FAIL" && r.needUnlock === "NO", "entry: the lock is another key's -> FAILED, no unlock", r);
  r = commitEntry(guard, job(), [], [], pay(), ida({ ida_v2_job_id: "2112100000000000009" }), none, none);
  ok(r.route === "FAIL" && r.needUnlock === "NO", "entry: another job's ida_v2_job_id -> FAILED, no unlock", r);
  const bad = (patch, what) => {
    const m = Object.assign(JSON.parse(J(c.manifest)), patch);
    const x = commitEntry(guard, job(), [], [], pay(m), ida(), none, none);
    ok(x.route === "FAIL" && x.result_code === "IDA_INVALID_DATA" && x.needUnlock === "YES" && x.unlockRows[0].item_disassembly_status === "Draft" && x.unlockRows[0].id === IDAID, "entry: " + what + " -> FAILED + back to Draft", x);
  };
  bad({ job_id: "2112100000000000002" }, "another job's manifest");
  bad({ ida_id: "2112073133161844739" }, "another IDA's manifest");
  bad({ action: "REVERT" }, "action not DIRECT");
  bad({ batchMode: "reuse_or_insert" }, "an unknown batchMode");
  bad({ batchMode: "none" }, "a BATCH part with batchMode none");
  bad({ parts: Object.assign({}, c.manifest.parts, { LABELS: [] }) }, "a part missing");
  bad({ parts: Object.assign({}, c.manifest.parts, { BATCH: undefined }) }, "batchMode insert without a BATCH part");
  bad({ lineFingerprint: "IF1:x" }, "no DF1 fingerprint");
  bad({ nonce: "x|y" }, "a bad nonce");
  bad({ organization_id: "1123598813738675299" }, "another organization");
  bad({ counts: Object.assign({}, c.manifest.counts, { movementsR: 0 }) }, "counts.movementsR 0");
  bad({ counts: Object.assign({}, c.manifest.counts, { movementsI: 0 }) }, "counts.movementsI 0");
  r = commitEntry(guard, job({ prev_status: null }), [], [], [{ prepared_payload: "{broken" }], ida(), none, none);
  ok(r.route === "FAIL" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO", "entry: no prevStatus + bad manifest -> REQUIRES_REVIEW, no unlock (no default)", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_live: 0 }), [step("D0_REVALIDATE"), step("D1_BATCH"), step("D2_ISSUE")], [], [{ prepared_payload: "{}" }], ida(), none, none);
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needBatchDel === "NO", "entry: a bad manifest after D2 -> REQUIRES_REVIEW, nothing else", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_live: 0 }), [step("D2_ISSUE"), step("D1_BATCH")], [], pay(), ida({ item_disassembly_status: "Draft" }), none, none);
  ok(r.route === "REVIEW" && r.needUnlock === "NO", "entry: phase B and the IDA Draft -> REQUIRES_REVIEW", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_live: 0 }), [step("D2_ISSUE"), step("D1_BATCH")], [], pay(), [], none, none);
  ok(r.route === "REVIEW" && r.needUnlock === "NO" && /deleted/.test(r.result_message), "entry: phase B and the IDA soft-deleted -> REQUIRES_REVIEW, no unlock", r.result_message);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_live: 0 }), [step("D2_ISSUE")], [], pay(), ida(), none, none);
  ok(r.route === "REVIEW" && /without a D1_BATCH/.test(r.result_message), "entry: batchMode insert, D2 DONE without D1 DONE -> REQUIRES_REVIEW", r.result_message);
  // a D1 intent of an earlier pass and the IDA lost its lock: the ours read
  const intent = intentOf({ B3: "Batch-00631" }, []);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IDA", lease_live: 0 }), [step("D0_REVALIDATE")], intent, pay(), [], none, none);
  ok(r.route === "FAIL" && r.needOursRead === "YES" && r.hasIntent === "YES" && r.job_status === "FAILED", "entry: FAILED with a D1 intent -> read ours", r);
  ok(commitEntry(guard, job(), [], [{ step_name: "D1|I|001", result_ref: "{broken" }], pay(), ida(), none, none).hasIntent === "BAD", "entry: an unreadable intent -> hasIntent BAD");
  // IA ruling 10 R2, extended to op 2: an engine row of EITHER operation -> no phase-A failure may claim "nothing moved"
  const lost = job({ job_status: "COMMITTING_IDA", lease_owner: "PUB|dead", lease_live: 0 });
  for (const [label, op1, op2] of [["op 1 intent", [{ intents: 1, review: 0, done_summary: null }], none], ["op 1 DONE", [{ intents: 0, review: 0, done_summary: J({ movements: 1 }) }], none],
    ["op 1 REVIEW", [{ intents: 0, review: 1, done_summary: null }], none], ["op 2 intent", none, [{ intents: 2, review: 0, done_summary: null }]]]) {
    for (const [what, facts, payload] of [["the IDA soft-deleted", [], pay()], ["the IDA unlocked meanwhile", ida({ item_disassembly_status: "Draft" }), pay()], ["an unusable manifest", ida(), [{ prepared_payload: "{}" }]]]) {
      r = commitEntry(guard, lost, [step("D0_REVALIDATE"), step("D1_BATCH")], intent, payload, facts, op1, op2);
      const d = r.jobRows.length ? JSON.parse(r.jobRows[0].error_details) : {};
      ok(r.opWrote === "YES" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_RECONCILIATION_MISMATCH" && r.needUnlock === "NO" && r.needBatchDel === "NO" && r.needOursRead === "NO"
        && /^IDA_(NOT_LOCKED|INVALID_DATA)$/.test(d.wouldFail) && d.step === (label.indexOf("op 2") === 0 ? "D3_RECEIPT" : "D2_ISSUE"), "entry R2: " + label + ", " + what + " -> REQUIRES_REVIEW, no unlock, no soft-delete", r);
    }
  }
  r = commitEntry(guard, lost, [step("D0_REVALIDATE"), step("D1_BATCH")], intent, pay(), [], none, none);
  ok(r.opWrote === "NO" && r.job_status === "FAILED" && r.needOursRead === "YES", "entry R2: neither operation has a row -> the clean FAILED (+ ours)", r);
  // ruling 10 R4: D3's wait window is recovered from the job's error_details only for D3's own IDA_WAIT
  const waitJob = (code, details) => job({ job_status: "COMMITTING_IDA", lease_live: 0, error_code: code, error_details: details });
  const s2 = [step("D0_REVALIDATE"), step("D1_BATCH"), step("D2_ISSUE")];
  const wf = (jb) => commitEntry(guard, jb, s2, [], pay(), ida(), [{ intents: 1, review: 0, done_summary: J({ movements: 1 }) }], none).waitFrom;
  ok(wf(waitJob("IDA_WAIT", J({ step: "D3_RECEIPT", why: "409", waitFrom: "2026-10-21 09:41:07", waited: 3 }))) === "2026-10-21 09:41:07", "entry R4: D3's IDA_WAIT -> waitFrom carried");
  ok(wf(waitJob("IDA_STEP_RETRY", J({ step: "D3_RECEIPT", waitFrom: "2026-10-21 09:41:07" }))) === "" && wf(waitJob("IDA_WAIT", J({ step: "D2_ISSUE", waitFrom: "2026-10-21 09:41:07" }))) === ""
    && wf(waitJob("IDA_WAIT", "{broken")) === "" && wf(waitJob("IDA_WAIT", J({ step: "D3_RECEIPT", waitFrom: "yesterday" }))) === "" && wf(waitJob(null, null)) === "",
    "entry R4: anything else (another code / step, unreadable, a malformed time, a reset job) -> no window yet");
  // a non-batch job: no D1, no batch reads
  const nb = X.makeCase({ n: 4 });
  r = commitEntry(guard, job(), [], [], [{ prepared_payload: J(nb.manifest) }], ida(), none, none);
  ok(r.route === "GO" && r.needD1 === "NO" && r.needBatchRead === "NO" && r.batchMode === "none", "entry: batchMode none -> no D1, no batch reads", r);
}

// ------------------------------------------------------------------ the exits: failNoWrite / stepEnd / waits / ours_end
{
  const fx = L("code_node_DCd2", ["failNoWrite", "stepEnd", "lockWait", "stepWait", "reviewEnd", "jobRow", "oursMap", "slicesOf"]);
  const c = mix();
  let r = fx.failNoWrite(entryOf(c), "IDA_X", "msg", "why", ["2113000000000000008", "2113000000000000008", "bad"]);
  ok(r.job_status === "FAILED" && J(r.unlockRows) === J([{ id: IDAID, item_disassembly_status: "Draft" }]) && J(ids(r)) === J(["2113000000000000008"])
    && r.jobRows[0].progress_percent === 0 && r.jobRows[0].progress_message === "Not completed: msg" && r.jobRows[0].finished_at && r.jobRows[0].lease_owner === null, "failNoWrite: FAILED, Draft, our Batch row once", r);
  const many = Array.from({ length: 600 }, (_, i) => String(2113000000000001000n + BigInt(i)));
  r = fx.failNoWrite(entryOf(c), "IDA_X", "msg", "why", many);
  ok(r.batchDelSlices.length === 3 && r.batchDelSlices.every((sl) => sl.rows.length <= 250) && ids(r).length === 600, "failNoWrite: 600 Batch rows -> 3 slices of <= 250", r.batchDelSlices.map((sl) => sl.rows.length));
  r = fx.failNoWrite(entryOf(c, { unlockOk: "NO" }), "IDA_X", "msg", "why", ["2113000000000000008"]);
  ok(r.needUnlock === "NO" && r.needBatchDel === "YES", "failNoWrite: not owned -> no unlock (the Batch row still removed)");
  for (const side of ["op1Wrote", "op2Wrote"]) {
    r = fx.failNoWrite(entryOf(c, { opWrote: "YES", [side]: "YES" }), "IDA_INVENTORY_INSUFFICIENT", "msg", "why", ["2113000000000000008"]);
    ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_RECONCILIATION_MISMATCH" && r.needUnlock === "NO" && r.needBatchDel === "NO" && JSON.parse(r.jobRows[0].error_details).wouldFail === "IDA_INVENTORY_INSUFFICIENT",
      "failNoWrite R2 (" + side + "): engine rows -> REQUIRES_REVIEW, no unlock, no Batch soft-delete", r);
  }
  for (const p of ["In Progress", "", "Completed"]) {
    r = fx.failNoWrite(entryOf(c, { prevStatus: p }), "IDA_X", "msg", "why", ["2113000000000000008"]);
    ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO" && r.needBatchDel === "NO", "failNoWrite: prevStatus " + J(p) + " -> review, nothing else");
  }
  r = fx.stepEnd(entryOf(c, { attempts: 1, progress: 75 }), "D3_RECEIPT", "x", false);
  ok(r.job_status === "COMMITTING_IDA" && r.jobRows[0].attempt_count === 2 && r.jobRows[0].next_attempt_at === "2026-10-21 10:00:04" && r.jobRows[0].progress_percent === 75 && r.result_code === "IDA_STEP_RETRY",
    "stepEnd: retry 2 after 4 s at the pass's progress", r.jobRows[0]);
  r = fx.stepEnd(entryOf(c, { attempts: 3 }), "D4_FINISH", "x", false);
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_RECONCILIATION_MISMATCH" && r.jobRows[0].error_message === X.C.IDA_TEXT.review, "stepEnd: after 3 retries -> REQUIRES_REVIEW");
  r = fx.lockWait(entryOf(c, { attempts: 4 }), "409");
  ok(r.jobRows[0].attempt_count === 5 && r.jobRows[0].next_attempt_at === "2026-10-21 10:04:00" && r.result_code === "IDA_LOCK_WAIT", "lockWait: 15 s x 2^4 = 240 s, counted", r.jobRows[0]);
  r = fx.lockWait(entryOf(c, { attempts: 6 }), "409");
  ok(r.jobRows[0].next_attempt_at === "2026-10-21 10:05:00", "lockWait: capped at 300 s", r.jobRows[0]);
  r = fx.stepWait(entryOf(c, { attempts: 2 }), "D3_RECEIPT", "409", 10);
  ok(r.jobRows[0].attempt_count === 2 && r.jobRows[0].next_attempt_at === "2026-10-21 10:00:10" && r.result_code === "IDA_WAIT", "stepWait: 10 s, not counted", r.jobRows[0]);
  // "ours": the identity of a planned row with insert true, id > job, this IDA's number; k rows of one identity own k ids
  const rows = c.batchRows;
  const om = fx.oursMap(rows, { B2: "Batch-00631", B3: "Batch-00632", B4: "Batch-00633" }, [batchRow("2113000000000000008"), batchRow("2111000000000000001"),
    batchRow("2113000000000000009", { transaction_no: "GR-1" }), batchRow("2113000000000000010", { batch_number: "lot-7  " }), batchRow("2113000000000000011", { batch_number: "Batch-00632", material_id: X.itemId(6) })], JOB, IDANO);
  ok(J(om.byKey) === J({ B1: "2113000000000000008" }) && J(om.extra) === J(["2113000000000000010"]) && om.all.length === 2 && om.missing.length === 2,
    "oursMap: older / other documents' rows are not ours; a case / trailing-space twin is extra; an insert-false row has no ours", om);
  const { commitOursEnd } = L("code_node_DCd2end", ["commitOursEnd"]);
  const src = Object.assign(fx.failNoWrite(entryOf(c), "IDA_INVENTORY_INSUFFICIENT", "msg", "why", []), { needOursRead: "YES" });
  const intent = intentOf({ B2: "Batch-00631", B3: "Batch-00632", B4: "Batch-00633" }, []);
  const oursRows = [batchRow("2113000000000000008"), batchRow("2113000000000000012", { batch_number: "Batch-00631", material_id: X.itemId(4) }),
    batchRow("2113000000000000013", { batch_number: "Batch-00633", material_id: X.itemId(7) }), batchRow("2113000000000000014", { batch_number: "OTHER-1", material_id: X.itemId(9) })];
  let e = commitOursEnd(entryOf(c), src, rowsOf(c, "BATCH"), intent, oursRows);
  ok(J(ids(e)) === J(["2113000000000000008", "2113000000000000012", "2113000000000000013"]) && e.needBatchDel === "YES" && e.needUnlock === "YES" && e.job_status === "FAILED",
    "exit: FAILED + an intent -> ours (and only ours) soft-deleted, after the unlock", e);
  e = commitOursEnd(entryOf(c), src, [], intent, oursRows);
  ok(e.needBatchDel === "NO" && /unreadable/.test(e.result_message), "exit: the BATCH part unreadable -> nothing removed (runbook)", e.result_message);
  e = commitOursEnd(entryOf(c), src, rowsOf(c, "BATCH"), [], oursRows);
  ok(e.needBatchDel === "NO" && !/unreadable/.test(e.result_message), "exit: no intent -> nothing of ours exists, nothing removed");
  e = commitOursEnd(entryOf(c), src, rowsOf(c, "BATCH"), [{ step_name: "D1|I|001", result_ref: "{x" }], oursRows);
  ok(e.needBatchDel === "NO" && /unreadable/.test(e.result_message), "exit: an unreadable intent -> nothing removed");
  e = commitOursEnd(entryOf(c), Object.assign({}, src, { job_status: "REQUIRES_REVIEW" }), rowsOf(c, "BATCH"), intent, oursRows);
  ok(e.needBatchDel === "NO", "exit: a review removes nothing");
}

// ------------------------------------------------------------------ D0
{
  const { commitD0 } = L("code_node_DCd0", ["commitD0"]);
  const c = mix();
  const hdr = (p) => [{ j: J(Object.assign({}, c.header, p || {})) }];
  const lines = (f) => c.lines.map((l) => ({ j: J(f ? f(l) : l) }));
  let r = commitD0(entryOf(c), hdr(), lines());
  ok(r.route === "OK" && r.stepRows[0].step_name === "D0_REVALIDATE" && r.stepRows[0].result_ref === c.fp, "D0: stored = planned -> DONE (ref = the fingerprint)", r);
  ok(commitD0(entryOf(c), hdr(), lines().reverse()).route === "OK", "D0: row order does not matter");
  r = commitD0(entryOf(c), hdr(), lines((l) => (l.line_index === "2" ? Object.assign({}, l, { batch_number: "LOT-8" }) : l)));
  ok(r.job_status === "FAILED" && r.result_code === "IDA_LINES_CHANGED" && r.needUnlock === "YES", "D0: a typed batch number changed -> FAILED IDA_LINES_CHANGED + Draft", r.result_message);
  r = commitD0(entryOf(c), hdr(), lines((l) => (l.line_index === "3" ? Object.assign({}, l, { location_id: X.binOf(99) }) : l)));
  ok(r.result_code === "IDA_LINES_CHANGED", "D0: a target bin changed -> FAILED");
  r = commitD0(entryOf(c), hdr({ temp_qty_data: J([Object.assign({}, c.picks[0], { sm_quantity: 9 })]) }), lines());
  ok(r.result_code === "IDA_LINES_CHANGED", "D0: a source pick changed -> FAILED");
  r = commitD0(entryOf(c), hdr({ stock_movement_no: "IDA-2610-0043" }), lines());
  ok(r.result_code === "IDA_LINES_CHANGED" && /number/.test(r.result_message), "D0: the IDA number changed -> FAILED", r.result_message);
  r = commitD0(entryOf(c), hdr({ item_disassembly_status: "Draft" }), lines());
  ok(r.result_code === "IDA_NOT_LOCKED", "D0: not Processing -> FAILED IDA_NOT_LOCKED");
  r = commitD0(entryOf(c), hdr({ ida_v2_job_id: "2112100000000000002" }), lines());
  ok(r.result_code === "IDA_NOT_LOCKED", "D0: another job's -> FAILED IDA_NOT_LOCKED");
  ok(commitD0(entryOf(c), [], lines()).result_code === "IDA_NOT_LOCKED", "D0: the header missing (deleted) -> FAILED");
  ok(commitD0(entryOf(c, { hasIntent: "YES" }), [], lines()).needOursRead === "YES", "D0: FAILED with an intent -> read ours");
}

// ------------------------------------------------------------------ D1: the decision table rows 1-14
{
  const { commitD1Plan } = L("code_node_DCd1plan", ["commitD1Plan"]);
  const { commitD1Decide } = L("code_node_DCd1decide", ["commitD1Decide"]);
  const { commitD1Word } = L("code_node_DCd1word", ["commitD1Word"]);
  const { commitD1Check } = L("code_node_DCd1check", ["commitD1Check"]);
  const { commitD1Ans } = L("code_node_DCd1ans", ["commitD1Ans"]);
  const { commitD1 } = L("code_node_DCd1", ["commitD1"]);
  const c = mix();
  const e = (p) => entryOf(c, p);
  const part = rowsOf(c, "BATCH");
  const NUMS = { B2: "Batch-00631", B3: "Batch-00632", B4: "Batch-00633" };
  const CFG = [{ id: X.BNC_ID, before: { running_number: 631, last_reset_date: null }, after: { running_number: 634, last_reset_date: null } }];
  const withIntent = intentOf(NUMS, CFG);
  const partWith = (f) => X.C.idaPartRows(JOB, ORG, "P|" + NONCE + "|BATCH|", f(JSON.parse(J(c.parts.BATCH))), "PAYLOAD");
  // plan: no intent -> the numbers of N GENERATE_BATCH calls, in AUTO row order (B3 line 4, B4 line 6 non-stock, B5 line 7)
  let p = commitD1Plan(e(), part, [], bncRows());
  ok(p.route === "GO" && p.hasIntent === "NO" && J(p.draft.numbers) === J(NUMS) && J(p.draft.configs) === J(CFG) && p.planned === 4, "D1 plan: no intent -> Batch-00631.. in AUTO row order, the config 631 -> 634", p);
  const hex = JSON.parse(p.hexSql).map((h) => Buffer.from(h, "hex").toString("utf8")).sort();
  ok(J(hex) === J(["Batch-00631", "Batch-00632", "Batch-00633", "LOT-7"]), "D1 plan: every planned number hex-encoded (TYPED + AUTO, insert false included)", hex);
  p = commitD1Plan(e(), part, withIntent, bncRows(700));
  ok(p.route === "GO" && p.hasIntent === "YES" && J(p.draft) === "{}" && JSON.parse(p.hexSql).length === 4, "D1 plan: an intent -> its numbers (the config's state is irrelevant)", p);
  // row 1: the part unreadable / a row without kind, key or (TYPED) number
  for (const [label, rows] of [["no part", []], ["a row without a key", partWith((b) => { b.rows[0].key = ""; return b; })], ["a row without a kind", partWith((b) => { b.rows[1].kind = ""; return b; })],
    ["a TYPED row without a number", partWith((b) => { b.rows[0].batch_number = " "; return b; })], ["another organization", partWith((b) => { b.rows[0].organization_id = "9"; return b; })],
    ["another transaction_no", partWith((b) => { b.rows[0].transaction_no = "IDA-X"; return b; })], ["mode none", partWith((b) => { b.mode = "none"; return b; })]]) {
    p = commitD1Plan(e(), rows, [], bncRows());
    ok(p.job_status === "FAILED" && p.result_code === "IDA_INVALID_DATA" && p.needUnlock === "YES" && p.needBatchDel === "NO", "D1 row 1: " + label + " -> FAILED IDA_INVALID_DATA, nothing removed", p.result_message);
  }
  // row 2: an intent exists but does not parse (or does not cover an AUTO row)
  p = commitD1Plan(e(), part, [{ step_name: "D1|I|001", result_ref: "{x" }], bncRows());
  ok(p.job_status === "REQUIRES_REVIEW" && p.result_code === "IDA_RECONCILIATION_MISMATCH" && p.needUnlock === "NO", "D1 row 2: an unreadable intent -> REQUIRES_REVIEW", p);
  p = commitD1Plan(e(), part, intentOf({ B2: "Batch-00631" }, CFG), bncRows());
  ok(p.job_status === "REQUIRES_REVIEW" && /no number for AUTO/.test(p.result_message), "D1 row 2: an intent without a number for an AUTO row -> REQUIRES_REVIEW", p.result_message);
  // row 3: batchnum refuses (no default configuration; a document date required)
  p = commitD1Plan(e(), part, [], []);
  ok(p.job_status === "FAILED" && p.result_code === "IDA_BATCH_CONFIG" && /^No default batch found: nothing was moved$/.test(p.jobRows[0].error_message) && p.needUnlock === "YES",
    "D1 row 3: no default batch_number_config -> FAILED IDA_BATCH_CONFIG with GENERATE_BATCH's text", p.jobRows[0]);
  const dateCfg = [{ j: J(Object.assign(X.bnc(), { batch_format: "B%Y%M%D-%3d", date_format: "Expired Date" })) }];
  const noExp = partWith((b) => { for (const r of b.rows) if (r.request) r.request.expired_date = null; return b; });
  p = commitD1Plan(e(), noExp, [], dateCfg);
  ok(p.job_status === "FAILED" && p.result_code === "IDA_BATCH_CONFIG" && /Expired Date is required/.test(p.jobRows[0].error_message), "D1 row 3: a date the format needs is missing -> FAILED with the batchnum text", p.jobRows[0].error_message);
  // decide: no intent, no holder -> the intent, the config, the planned rows with insert true (row 8)
  const plan0 = commitD1Plan(e(), part, [], bncRows());
  let d = commitD1Decide(e(), plan0, part, [], bncRows(), []);
  const ins = d.insertSlices.reduce((a, sl) => a.concat(sl.rows), []);
  ok(d.route === "GO" && d.needIntent === "YES" && d.intentRows[0].step_name === "D1|I|001" && d.intentRows[0].step_status === "INTENT" && J(JSON.parse(d.intentRows[0].result_ref)) === J({ numbers: NUMS, configs: CFG })
    && J(d.bncRows) === J([{ id: X.BNC_ID, running_number: 634, last_reset_date: null }]) && ins.length === 3 && J(ins.map((r) => r.batch_number)) === J(["LOT-7", "Batch-00631", "Batch-00633"])
    && J(Object.keys(ins[0])) === J(X.BATCH_COLS) && ins[0].initial_quantity === "4.00000000" && ins[2].initial_quantity === "24.00000000" && d.needEngR === "YES" && d.insertCount === 3,
    "D1 decide row 8: the intent (numbers + configs), the config's after-state, 3 Batch rows (the non-stock AUTO row consumes a number, no row)", d);
  ok(Object.keys(d.intentRows[0]).sort().join() === "attempt_count,error_code,error_message,finished_at,inventory_operation_id,job_id,organization_id,result_ref,started_at,step_name,step_status",
    "D1 decide: the intent rows carry STEP_PROPS");
  // row 4: no intent, a live org row holds a generated number (any item) -> FAILED, config NOT advanced
  d = commitD1Decide(e(), plan0, part, [], bncRows(), [batchRow("2111000000000000001", { batch_number: "batch-00632", material_id: X.itemId(77), transaction_no: "GR-9" })]);
  ok(d.job_status === "FAILED" && d.result_code === "IDA_BATCH_DUPLICATE" && d.jobRows[0].error_message === "Duplicate Batch Format found. (batch number Batch-00632) Nothing was moved." && d.needIntent === "NO"
    && d.bncRows.length === 0 && d.insertSlices.length === 0 && d.needBatchDel === "NO", "D1 row 4: a generated number held elsewhere -> FAILED IDA_BATCH_DUPLICATE, nothing written", d);
  // row 5: no intent, a live org row holds the TYPED number -> FAILED with code_validate's wording (LABELS)
  d = commitD1Decide(e(), plan0, part, [], bncRows(), [batchRow("2111000000000000001", { transaction_no: "GR-9", material_id: X.itemId(88) })]);
  ok(d.job_status === "FAILED" && d.result_code === "IDA_BATCH_DUPLICATE" && d.needLabels === "YES" && d.labelLine === X.lineId(2) && d.labelNumber === "LOT-7", "D1 row 5: a typed number taken -> FAILED, LABELS to word it", d);
  const w5 = commitD1Word(e(), d, rowsOf(c, "LABELS"));
  ok(w5.job_status === "FAILED" && w5.jobRows[0].error_message === "Line 2 (Part 50): Batch No LOT-7 already exists. Nothing was moved." && w5.route === "END", "D1 row 5: worded 'Line 2 (Part 50): Batch No LOT-7 already exists. Nothing was moved.'",
    w5.jobRows[0]);
  const pass = commitD1Word(e(), commitD1Decide(e(), plan0, part, [], bncRows(), []), []);
  ok(pass.route === "GO" && pass.needJobUpd === "NO", "D1 word: a clean decision passes through");
  // with an intent: ours adopted (nothing inserted again), configs forward only
  const ours3 = [batchRow("2113000000000000008"), batchRow("2113000000000000009", { batch_number: "Batch-00631", material_id: X.itemId(4) }),
    batchRow("2113000000000000010", { batch_number: "Batch-00633", material_id: X.itemId(7) })];
  const planI = commitD1Plan(e(), part, withIntent, bncRows(634));
  d = commitD1Decide(e(), planI, part, withIntent, bncRows(634), ours3);
  ok(d.route === "GO" && d.needIntent === "NO" && d.bncRows.length === 0 && d.insertSlices.length === 0 && d.adoptCount === 3, "D1 decide: an intent + every row of ours + the config at its after-state -> nothing written", d);
  d = commitD1Decide(e(), planI, part, withIntent, bncRows(631), ours3.slice(0, 1));
  const ins2 = d.insertSlices.reduce((a, sl) => a.concat(sl.rows), []);
  ok(d.needIntent === "NO" && J(d.bncRows) === J([{ id: X.BNC_ID, running_number: 634, last_reset_date: null }]) && J(ins2.map((r) => r.batch_number)) === J(["Batch-00631", "Batch-00633"]) && d.adoptCount === 1,
    "D1 decide: a crash after the first slice -> the config written again (at its before-state), only the missing rows inserted", d);
  d = commitD1Decide(e(), planI, part, withIntent, bncRows(700), ours3.slice(0, 1));
  ok(d.bncRows.length === 0, "D1 decide: a config moved past the after-state (another writer) -> never written back", d.bncRows);
  d = commitD1Decide(e(), planI, part, withIntent, [{ j: J(Object.assign(X.bnc(500), { last_reset_date: "2026-10-20" })) }], ours3);
  ok(d.bncRows.length === 0, "D1 decide: a config reset since (a later last_reset_date, neither before nor after) -> not written (GR c1_decide)", d.bncRows);
  d = commitD1Decide(e(), planI, part, withIntent, [{ j: J(Object.assign(X.bnc(600), { last_reset_date: null })) }], ours3);
  ok(J(d.bncRows) === J([{ id: X.BNC_ID, running_number: 634, last_reset_date: null }]), "D1 decide: a config behind its before-state (not ahead) -> the after-state written", d.bncRows);
  // row 3 (intent): a config the intent names is gone -> FAILED IDA_BATCH_CONFIG + ours
  d = commitD1Decide(e(), planI, part, withIntent, [], ours3);
  ok(d.job_status === "FAILED" && d.result_code === "IDA_BATCH_CONFIG" && /batch number configuration 2062365526375706626 no longer exists: nothing was moved/.test(d.jobRows[0].error_message) && ids(d).length === 3,
    "D1 row 3: the intent's config gone -> FAILED + ours soft-deleted", d);
  // row 6: intent exists, a holder that is not ours holds a planned number -> FAILED IDA_BATCH_DUPLICATE + ours
  for (const [label, foreign] of [["another document", { id: "2113000000000000020", batch_number: "Batch-00632", material_id: X.itemId(77), transaction_no: "GR-9" }],
    ["an older row of this IDA", { id: "2111000000000000002", batch_number: "LOT-7" }], ["this IDA's number on another item", { id: "2113000000000000021", batch_number: "LOT-7", material_id: X.itemId(99) }]]) {
    d = commitD1Decide(e(), planI, part, withIntent, bncRows(634), ours3.concat([batchRow(foreign.id, foreign)]));
    ok(d.job_status === "FAILED" && d.result_code === "IDA_BATCH_DUPLICATE" && J(ids(d)) === J(["2113000000000000008", "2113000000000000009", "2113000000000000010"]) && d.insertSlices.length === 0,
      "D1 row 6: " + label + " holds a planned number -> FAILED IDA_BATCH_DUPLICATE, ours soft-deleted, the foreign row kept", d);
  }
  // row 7: a planned row with two or more ours -> FAILED IDA_BATCH_FAILED, all of them soft-deleted
  d = commitD1Decide(e(), planI, part, withIntent, bncRows(634), ours3.concat([batchRow("2113000000000000030", { batch_number: "LOT-7 " })]));
  ok(d.job_status === "FAILED" && d.result_code === "IDA_BATCH_FAILED" && /inserted twice/.test(d.jobRows[0].error_message) && ids(d).length === 4, "D1 row 7: a row inserted twice -> FAILED, all four soft-deleted", d);
  // classic parity: a typed number equal to a generated one, two planned rows of ONE identity -> both are ours, no "twice"
  const tw = X.makeCase({ lines: [{ kind: "auto", item: 4 }, { kind: "auto", item: 4 }], lineFields: { 1: { batch_number: "Batch-00631" } } });
  const twPart = rowsOf(tw, "BATCH");
  const twIntent = intentOf({ B2: "Batch-00631" }, CFG);
  const twPlan = commitD1Plan(entryOf(tw), twPart, twIntent, bncRows(632));
  d = commitD1Decide(entryOf(tw), twPlan, twPart, twIntent, bncRows(632), [batchRow("2113000000000000040", { batch_number: "Batch-00631", material_id: X.itemId(4) }),
    batchRow("2113000000000000041", { batch_number: "Batch-00631", material_id: X.itemId(4) })]);
  ok(d.route === "GO" && d.adoptCount === 2 && d.insertSlices.length === 0, "D1: a typed number equal to a generated one (same item) -> two rows, both ours (classic parity)", d);
  // check (rows 7, 9, 10, 11)
  const engR = rowsOf(c, "ENGINE_R");
  let k = commitD1Check(e(), part, withIntent, bncRows(634), ours3, engR);
  const pm = k.planMovements;
  ok(k.route === "GO" && k.needPlan === "YES" && k.planKey === "IDC|" + JOB + "|R" && pm.length === 5 && pm.every((m) => m.unit_price === 0) && pm[1].batch_id === "2113000000000000008"
    && pm[2].batch_id === "2113000000000000008" && pm[3].batch_id === "2113000000000000009" && pm[4].batch_id === "2113000000000000010" && pm[0].batch_id === null && k.ours.length === 3
    && J(Object.keys(pm[0])) === J(Object.keys(c.movementsR[0])), "D1 check row 11: every R with batch_id = oursByKey[batch_key], unit_price 0, the part's key order", k);
  k = commitD1Check(e(), part, [], bncRows(634), ours3, engR);
  ok(k.result_code === "IDA_STEP_RETRY", "D1 row 9: the intent did not read back -> retry");
  k = commitD1Check(e(), part, withIntent, bncRows(634), ours3.slice(0, 2), engR);
  ok(k.result_code === "IDA_STEP_RETRY" && /did not read back/.test(k.result_message), "D1 row 9: an inserted planned row without its ours -> retry", k.result_message);
  k = commitD1Check(e({ attempts: 3 }), part, withIntent, bncRows(634), ours3.slice(0, 2), engR);
  ok(k.job_status === "FAILED" && k.result_code === "IDA_BATCH_FAILED" && ids(k).length === 2 && /could not be created \(missing after the insert\)/.test(k.jobRows[0].error_message),
    "D1 row 9: still missing after 3 retries -> FAILED IDA_BATCH_FAILED + ours soft-deleted", k.jobRows[0]);
  k = commitD1Check(e(), part, withIntent, bncRows(633), ours3, engR);
  ok(k.result_code === "IDA_STEP_RETRY" && /behind/.test(k.result_message), "D1 row 9: a config behind its after-state -> retry", k.result_message);
  k = commitD1Check(e(), part, withIntent, bncRows(634), ours3.concat([batchRow("2113000000000000031", { batch_number: "Batch-00633", material_id: X.itemId(7) })]), engR);
  ok(k.job_status === "FAILED" && k.result_code === "IDA_BATCH_FAILED" && ids(k).length === 4, "D1 row 7 (read-back): inserted twice -> FAILED, all of them soft-deleted", k);
  k = commitD1Check(e(), part, withIntent, bncRows(634), ours3.concat([batchRow("2113000000000000032", { batch_number: "BATCH-00631", material_id: X.itemId(70), transaction_no: "GD-1" })]), engR);
  ok(k.job_status === "FAILED" && k.result_code === "IDA_BATCH_DUPLICATE" && k.jobRows[0].error_message === "Duplicate Batch Format found. (batch number Batch-00631) Nothing was moved." && ids(k).length === 3,
    "D1 row 10: the post-insert re-check - another live org row (case-insensitive) holds one of our numbers -> FAILED IDA_BATCH_DUPLICATE, ours soft-deleted", k);
  const onlyNs = X.makeCase({ lines: [{ kind: "none" }, { kind: "nsauto" }] });
  k = commitD1Check(entryOf(onlyNs), rowsOf(onlyNs, "BATCH"), intentOf({ B1: "Batch-00631" }, CFG), bncRows(634), [], []);
  ok(k.route === "GO" && k.needPlan === "NO" && /skipped/.test(k.result_message), "D1 row 11 (ruling 21): no planned row inserts -> the re-PLAN is skipped", k);
  const fin0 = commitD1(entryOf(onlyNs), { needPlan: "NO", ours: [], result_message: k.result_message }, {}, [], { rows: 1, inserted: 0, adopted: 0 });
  ok(fin0.route === "OK" && J(JSON.parse(fin0.stepRows[0].result_ref)) === J({ rows: 1, inserted: 0, adopted: 0 }), "D1: no re-PLAN -> DONE {rows, inserted, adopted}", fin0);
  k = commitD1Check(e(), part, withIntent, bncRows(634), ours3, X.C.idaPartRows(JOB, ORG, "P|" + NONCE + "|ENGINE_R|", Object.assign({}, c.parts.ENGINE_R, { operation_key: "IDC|1|R" }), "PAYLOAD"));
  ok(k.job_status === "FAILED" && k.result_code === "IDA_INVALID_DATA" && ids(k).length === 3, "D1 check: another job's ENGINE_R -> FAILED + ours soft-deleted", k.result_message);
  // answer + rows 12-14
  const chk = commitD1Check(e(), part, withIntent, bncRows(634), ours3, engR);
  const okRes = chk.keys.map((key) => ({ movement_key: key, code: "200" }));
  let a = commitD1Ans({ needPlan: "YES", keys: chk.keys }, { code: "200", result_code: "OK", results: okRes });
  ok(a.allOk === "YES" && a.needLabels === "NO", "D1 answer: every R 200");
  let f = commitD1(e(), chk, a, [], { rows: 4, inserted: 3, adopted: 0 });
  ok(f.route === "OK" && f.stepRows[0].step_name === "D1_BATCH" && J(JSON.parse(f.stepRows[0].result_ref)) === J({ rows: 4, inserted: 3, adopted: 0 }), "D1 row 11: re-PLAN 200 + every R 200 -> DONE", f);
  a = commitD1Ans({ needPlan: "YES", keys: chk.keys }, { code: "200", result_code: "OK", results: J(okRes.map((r) => (r.movement_key === "R4" ? { movement_key: "R4", code: "401", message: "Skipping inventory update for item (stock control = 0)" } : r))) });
  ok(a.allOk === "NO" && a.refusedKey === "R4" && a.needLabels === "YES", "D1 answer: results as text, R4 401 -> refused, LABELS needed", a);
  f = commitD1(e(), chk, a, rowsOf(c, "LABELS"), { rows: 4, inserted: 3, adopted: 0 });
  ok(f.job_status === "FAILED" && f.result_code === "IDA_PLAN_SKIPPED" && /line 4 \(RM-0004\), into bin BIN-004/.test(f.jobRows[0].error_message) && /: nothing was moved\.$/.test(f.jobRows[0].error_message) && ids(f).length === 3,
    "D1 row 12: an R result not 200 -> FAILED IDA_PLAN_SKIPPED (LABELS-worded) + ours soft-deleted", f.jobRows[0].error_message);
  a = commitD1Ans({ needPlan: "YES", keys: chk.keys }, { code: "200", result_code: "OK", results: okRes.slice(0, 4) });
  ok(a.allOk === "NO" && a.refusedKey === "R5" && /no result/.test(a.refusedMessage), "D1 answer: a missing R result is a refusal", a);
  a = commitD1Ans({ needPlan: "YES", keys: chk.keys }, { code: "400", result_code: "DUPLICATE_BALANCE", message: "More than one item_batch_balance row for x (movement R2)" });
  f = commitD1(e(), chk, a, rowsOf(c, "LABELS"), { rows: 4 });
  ok(f.result_code === "IDA_INVENTORY_DUPLICATE_BALANCE" && /line 2 \(RM-0050\)/.test(f.jobRows[0].error_message) && ids(f).length === 3, "D1 row 13: 400 with a result_code -> FAILED IDA_INVENTORY_<code> + ours", f.jobRows[0].error_message);
  for (const ans of [{ code: "409", result_code: "LOCK_BUSY" }, {}, { code: 400, msg: "envelope" }]) {
    a = commitD1Ans({ needPlan: "YES", keys: chk.keys }, ans);
    f = commitD1(e(), chk, a, [], { rows: 4 });
    ok(f.result_code === "IDA_STEP_RETRY" && f.needBatchDel === "NO", "D1 row 14: " + J(ans) + " -> retry (ours kept for the next pass)", f.result_code);
    f = commitD1(e({ attempts: 3 }), chk, a, [], { rows: 4 });
    ok(f.result_code === "IDA_PLAN_FAILED" && ids(f).length === 3, "D1 row 14: " + J(ans) + " after 3 retries -> FAILED IDA_PLAN_FAILED + ours", f.result_code);
  }
  a = commitD1Ans({ needPlan: "YES", keys: chk.keys }, { code: "500", result_code: "X" });
  f = commitD1(e(), chk, a, [], { rows: 4 });
  ok(f.result_code === "IDA_PLAN_FAILED" && ids(f).length === 3, "D1 row 14: anything else -> FAILED IDA_PLAN_FAILED + ours");
}

// ------------------------------------------------------------------ D2
{
  const { commitD2In } = L("code_node_DCd2in", ["commitD2In"]);
  const { commitD2Ans } = L("code_node_DCd2ans", ["commitD2Ans"]);
  const { commitD2 } = L("code_node_DCd2", ["commitD2"]);
  const c = mix();
  const e = (p) => entryOf(c, p);
  const inp = commitD2In(e(), rowsOf(c, "ENGINE_I"));
  ok(inp.ok === "YES" && inp.operationKey === "IDC|" + JOB + "|I" && inp.count === 1 && J(inp.movements) === J(c.movementsI), "D2 input: the ENGINE_I movements as planned");
  ok(commitD2In(e({ jobId: "2112100000000000002" }), rowsOf(c, "ENGINE_I")).ok === "NO", "D2 input: another job's operation key -> not ok");
  ok(commitD2In(e(), X.C.idaPartRows(JOB, ORG, "P|" + NONCE + "|ENGINE_I|", Object.assign({}, c.parts.ENGINE_I, { movements: [] }), "PAYLOAD")).ok === "NO", "D2 input: no movement -> not ok (each op >= 1)");
  const ans = (o) => commitD2Ans({ ok: "YES" }, o);
  ok(J(ans({ code: "409", result_code: "LOCK_BUSY" })) === J({ code: "409", result_code: "LOCK_BUSY", message: "", summary: {}, need409: "YES", need400: "NO" }), "D2 answer: 409 -> read the intents");
  ok(ans({ code: 400, success: false, data: null, msg: "boom" }).need409 === "YES" && ans({ code: 400, msg: "boom" }).message === "boom", "D2 answer: the envelope (400, no code) -> transient, msg kept");
  ok(ans({ code: "400", result_code: "INSUFFICIENT", message: "m" }).need400 === "YES", "D2 answer: 400 with a code -> LABELS");
  ok(J(ans({ code: "200", result_code: "OK", summary: J({ movements: 1, skipped: 0 }) }).summary) === J({ movements: 1, skipped: 0 }), "D2 answer: the summary (object or text)");
  let r = commitD2(e(), guard, inp, { code: "200", result_code: "OK", summary: { movements: 1, skipped: 0 } }, null, []);
  ok(r.route === "OK" && r.path === "SPLIT" && r.splitRows[0].lease_owner === "SPLIT|" + guard.nonce && r.splitRows[0].lease_expires_at === "2026-10-21 10:10:00" && r.splitRows[0].progress_percent === 75
    && r.splitRows[0].progress_message === "Source issued; receiving the recovered components" && r.splitRows[0].attempt_count === 0
    && J(JSON.parse(r.stepRows[0].result_ref)) === J({ called: "YES", code: "200", result_code: "OK", summary: { movements: 1, skipped: 0 } }), "D2: 200 -> DONE (op 1's summary) + SPLIT at 75, attempts 0", r);
  r = commitD2(e({ attempts: 5 }), guard, inp, { code: "200", result_code: "REPLAYED", summary: { movements: 1, skipped: 0 } }, null, []);
  ok(r.route === "OK" && r.splitRows[0].attempt_count === 0, "D2: REPLAYED -> DONE, attempts reset");
  for (const [label, p] of [["op 2 above 1,000", { movementsR: 1001 }], ["op 1 above 1,000", { movementsI: 1001 }]]) {
    r = commitD2(e(p), guard, inp, { code: "200", result_code: "OK" }, null, []);
    ok(r.path === "PARK" && r.splitRows[0].lease_owner === null && r.splitRows[0].next_attempt_at === DB_NOW && r.splitRows[0].attempt_count === 0, "D2: " + label + " -> PARK (due now, no lease)", r.splitRows[0]);
  }
  r = commitD2(e({ movementsI: 1000, movementsR: 1000 }), guard, inp, { code: "200", result_code: "OK" }, null, []);
  ok(r.path === "SPLIT", "D2: exactly 1,000 on both legs -> SPLIT");
  r = commitD2(e(), guard, inp, { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M1)" }, null, rowsOf(c, "LABELS"));
  ok(r.job_status === "FAILED" && r.result_code === "IDA_INVENTORY_INSUFFICIENT" && r.jobRows[0].error_message === "Insufficient quantity - source pick 1 (FG-0001), bin SRC-505 (Unrestricted)" && r.needUnlock === "YES"
    && r.needOursRead === "YES", "D2: 400 -> FAILED, worded, Draft, ours to read (the soft-delete)", r);
  r = commitD2(e(), guard, inp, { code: "409", result_code: "LOCK_BUSY" }, { intents: 0 }, []);
  ok(r.result_code === "IDA_LOCK_WAIT" && r.jobRows[0].attempt_count === 1 && r.needUnlock === "NO" && r.needOursRead === "NO", "D2: 409, no intent -> lock wait");
  r = commitD2(e({ attempts: 8 }), guard, inp, { code: "409", result_code: "LOCK_BUSY" }, { intents: 0 }, []);
  ok(r.job_status === "FAILED" && r.result_code === "IDA_INVENTORY_LOCK_BUSY" && r.needUnlock === "YES" && r.needOursRead === "YES" && r.jobRows[0].error_message === X.C.IDA_TEXT.lockBusy, "D2: 409 after 8 waits -> FAILED IDA_INVENTORY_LOCK_BUSY");
  r = commitD2(e(), guard, inp, { code: "", result_code: "" }, { intents: 1 }, []);
  ok(r.result_code === "IDA_STEP_RETRY" && r.needUnlock === "NO" && r.needOursRead === "NO", "D2: no answer WITH intent rows -> retry, never a failure");
  // engine v12: the same operation still running (a resumed pass over a live earlier run) -> the counted lock wait even with intent rows
  const same = { code: "409", result_code: "LOCK_BUSY", message: "the same operation is still running (run 1, last heartbeat 2026-10-21 09:59:30); retry later" };
  r = commitD2(e(), guard, inp, same, { intents: 1 }, []);
  ok(r.result_code === "IDA_LOCK_WAIT" && r.jobRows[0].attempt_count === 1 && r.needUnlock === "NO" && r.needOursRead === "NO", "D2: 409 same operation still running WITH intent rows -> lock wait", r);
  r = commitD2(e({ attempts: 8 }), guard, inp, same, { intents: 1 }, []);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needOursRead === "NO", "D2: 409 same operation still running after 8 waits -> REQUIRES_REVIEW, never FAILED", r);
  r = commitD2(e({ attempts: 8 }), guard, inp, same, { intents: 0 }, []);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needOursRead === "NO", "D2: 409 same operation still running, no intent rows, after 8 waits -> REQUIRES_REVIEW (was FAILED + Draft)", r);
  r = commitD2(e(), guard, inp, { code: "409", result_code: "LOCK_BUSY" }, { intents: 1 }, []);
  ok(r.result_code === "IDA_STEP_RETRY" && r.needUnlock === "NO", "D2: another 409 WITH intent rows -> retry as before", r);
  r = commitD2(e(), guard, inp, { code: "500", result_code: "REQUIRES_REVIEW" }, null, []);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needOursRead === "NO", "D2: 500 -> REQUIRES_REVIEW at once, nothing else");
  ok(commitD2(e(), guard, Object.assign({}, inp, { ok: "NO", why: "x" }), {}, null, []).result_code === "IDA_INVALID_DATA", "D2: no ENGINE_I part -> FAILED");
  const nb = X.makeCase({ n: 3 });
  ok(commitD2(entryOf(nb), guard, inp, { code: "400", result_code: "INSUFFICIENT", message: "m" }, null, []).needOursRead === "NO", "D2: a non-batch job's FAILED reads no ours");
}

// ------------------------------------------------------------------ D3
{
  const { commitD3Plan } = L("code_node_DCd3plan", ["commitD3Plan"]);
  const { commitD3Ans } = L("code_node_DCd3ans", ["commitD3Ans"]);
  const { commitD3 } = L("code_node_DCd3", ["commitD3"]);
  const c = mix();
  const e = (p) => entryOf(c, Object.assign({ phase: "B", progress: 75, unlockOk: "NO", d2DoneAt: "2026-10-21 09:50:00", op1Wrote: "YES", opWrote: "YES" }, p || {}));
  const op1 = (n, o) => [Object.assign({ intents: 1, review: 0, done_summary: J({ movements: n, skipped: 0 }) }, o || {})];
  const out = (n, t) => [{ n: n, total: t }];
  const NUMS = { B2: "Batch-00631", B3: "Batch-00632", B4: "Batch-00633" };
  const intent = intentOf(NUMS, []);
  const ours3 = [batchRow("2113000000000000008"), batchRow("2113000000000000009", { batch_number: "Batch-00631", material_id: X.itemId(4) }),
    batchRow("2113000000000000010", { batch_number: "Batch-00633", material_id: X.itemId(7) })];
  let p = commitD3Plan(e(), rowsOf(c, "ENGINE_R"), out(1, "21.35790000"), op1(1), rowsOf(c, "BATCH"), intent, ours3);
  const want = X.P.idaAllocate("21.35790000", c.alloc);
  const byKey = {};
  c.alloc.forEach((a, i) => { if (a.movement_key) byKey[a.movement_key] = want[i].unit_price; });
  ok(p.route === "GO" && p.needCall === "YES" && p.operationKey === "IDC|" + JOB + "|R" && p.movements.length === 5 && p.movements.every((m) => m.unit_price === byKey[m.movement_key])
    && p.movements[1].batch_id === "2113000000000000008" && p.movements[2].batch_id === "2113000000000000008" && p.movements[3].batch_id === "2113000000000000009" && p.movements[4].batch_id === "2113000000000000010"
    && p.movements[0].batch_id === null && J(Object.keys(p.movements[0])) === J(Object.keys(c.movementsR[0])) && J(p.keys) === J(["R1", "R2", "R3", "R4", "R5"]),
    "D3 plan: unit_price = idaAllocate per line, batch_id = oursByKey[batch_key] (the shared typed row on two lines), the part's key order", p);
  ok(Math.abs(want[want.length - 1].value - (21.3579 - 21.3579 * 12 / 14)) < 1e-9 && want[4].unit_price > 0 && c.alloc[4].movement_key === "" && c.alloc[5].movement_key === "",
    "D3 plan: the last line (alt UOM) takes the remainder; the non-stock lines keep their share, no movement", want);
  ok(p.movements[4].unit_price === X.C.idaQ8(want[6].value / 24), "D3 plan: the alt-UOM line priced per BASE unit (value / 24)", [p.movements[4].unit_price, want[6]]);
  ok(J(commitD3Plan(e(), rowsOf(c, "ENGINE_R"), out(1, "21.35790000"), op1(1), rowsOf(c, "BATCH"), intent, ours3.slice().reverse()).movements) === J(p.movements), "D3 plan: the same request on every pass (row order of the read irrelevant)");
  for (const [label, o, rows] of [["op 1 under review", { review: 1 }, 1], ["op 1 without IBA|DONE", { done_summary: null }, 1], ["fewer stored rows than results", {}, 0],
    ["op 1 skipped its pick (401: nothing issued)", { done_summary: J({ movements: 0, skipped: 1 }) }, 0]]) {
    const x = commitD3Plan(e(), rowsOf(c, "ENGINE_R"), out(rows, "1.00000000"), op1(1, o), rowsOf(c, "BATCH"), intent, ours3);
    ok(x.job_status === "REQUIRES_REVIEW" && x.result_code === "IDA_RECEIPT_COUNT_MISMATCH" && x.needCall === "NO", "D3 plan: " + label + " -> REQUIRES_REVIEW IDA_RECEIPT_COUNT_MISMATCH, op 2 not called", x.result_message);
  }
  let x = commitD3Plan(e(), rowsOf(c, "ENGINE_R"), out(1, "1"), op1(1), rowsOf(c, "BATCH"), intent, ours3.slice(0, 2));
  ok(x.job_status === "REQUIRES_REVIEW" && x.result_code === "IDA_RECONCILIATION_MISMATCH" && /without their Batch row/.test(x.result_message), "D3 plan: a batch line without its Batch row -> REQUIRES_REVIEW", x.result_message);
  x = commitD3Plan(e(), rowsOf(c, "ENGINE_R"), out(1, "1"), op1(1), rowsOf(c, "BATCH"), intent, ours3.concat([batchRow("2113000000000000011")]));
  ok(x.job_status === "REQUIRES_REVIEW" && /beyond their planned rows/.test(x.result_message), "D3 plan: two Batch rows of ours for one planned row -> REQUIRES_REVIEW", x.result_message);
  ok(commitD3Plan(e(), [], out(1, "1"), op1(1), rowsOf(c, "BATCH"), intent, ours3).job_status === "REQUIRES_REVIEW", "D3 plan: no ENGINE_R part -> REQUIRES_REVIEW");
  ok(commitD3Plan(e(), rowsOf(c, "ENGINE_R"), out(1, "1"), op1(1), [], intent, ours3).job_status === "REQUIRES_REVIEW", "D3 plan: no BATCH part (batch mode) -> REQUIRES_REVIEW");
  const nb = X.makeCase({ n: 3 });
  x = commitD3Plan(entryOf(nb, { phase: "B" }), rowsOf(nb, "ENGINE_R"), out(1, "10"), op1(1), [], [], []);
  ok(x.route === "GO" && x.movements.every((m) => m.batch_id === null), "D3 plan: a non-batch job's receipts keep batch_id null", x);
  // answer + decision
  const plan = { outCount: 1, outTotal: "21.35790000", moveCount: 5 };
  const all200 = ["R1", "R2", "R3", "R4", "R5"].map((k) => ({ movement_key: k, code: "200" }));
  let a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "OK", results: all200 });
  ok(a.allOk === "YES" && a.needOps === "NO", "D3 answer: every R 200");
  let r = commitD3(e(), plan, a, null);
  ok(r.route === "OK" && r.needProgress === "YES" && r.progressRows[0].progress_percent === 80 && r.progressRows[0].progress_message === "Components received; finishing"
    && J(JSON.parse(r.stepRows[0].result_ref)) === J({ out_rows: 1, out_total: "21.35790000", movements: 5, result_code: "OK", skipped: [], skipped_count: 0 }) && r.skipNote === "",
    "D3: 200 + every R 200 -> DONE + progress 80 (no skip)", r);
  a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "REPLAYED", results: J(all200) });
  ok(commitD3(e(), plan, a, null).route === "OK", "D3: REPLAYED (results as text) -> DONE");
  // controller ruling (fix round 1): a per-movement "401" (stock_control 0 after both PLANs) is tolerated like D2's - classic parity
  a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "OK", results: all200.map((q) => (q.movement_key === "R3" ? { movement_key: "R3", code: "401", message: "Skipping" } : q)) });
  ok(a.allOk === "YES" && J(a.skipped) === J(["R3"]) && a.refusedKey === "", "D3 answer: R3 401 -> tolerated, named in skipped", a);
  r = commitD3(e(), plan, a, null);
  const ref3 = JSON.parse(r.stepRows[0].result_ref);
  ok(r.route === "OK" && r.stepRows[0].step_name === "D3_RECEIPT" && J(ref3.skipped) === J(["R3"]) && ref3.skipped_count === 1 && r.skipNote === " (1 receipt skipped, stock control 0: R3)"
    && r.progressRows[0].progress_message === "Components received; finishing (1 receipt skipped, stock control 0: R3)" && /^4 recovered component\(s\) received/.test(r.result_message) && r.needUnlock === "NO",
    "D3: an R result 401 -> DONE, R3 named in the DONE ref, the progress message and the note (its share not received)", r);
  for (const bad of ["400", "500", "409", ""]) {
    a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "OK", results: all200.map((q) => (q.movement_key === "R3" ? { movement_key: "R3", code: bad, message: "x" } : q)) });
    r = commitD3(e(), plan, a, null);
    ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_RECEIPT_REFUSED" && /R3 answered/.test(r.result_message), "D3: a per-movement " + J(bad) + " inside a 200 -> still REQUIRES_REVIEW IDA_RECEIPT_REFUSED", r.result_message);
  }
  a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "OK", results: [{ movement_key: "R1", code: "401" }].concat(all200.slice(1, 4)) });
  ok(commitD3(e(), plan, a, null).result_code === "IDA_RECEIPT_REFUSED", "D3: a 401 plus a missing result -> REQUIRES_REVIEW (the missing one)");
  const many = ["R1", "R2", "R3", "R4", "R5"].map((k) => ({ movement_key: k, code: "401" }));
  r = commitD3(e(), plan, commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "OK", results: many }), null);
  ok(r.route === "OK" && JSON.parse(r.stepRows[0].result_ref).skipped_count === 5 && r.progressRows[0].progress_message.length <= 250, "D3: every receipt skipped -> DONE (as the classic), all five named", r.progressRows[0]);
  a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "200", result_code: "OK", results: all200.slice(1) });
  ok(commitD3(e(), plan, a, null).result_code === "IDA_RECEIPT_REFUSED", "D3: a missing R result -> REQUIRES_REVIEW IDA_RECEIPT_REFUSED");
  // IA ruling 10 R4: the 30-minute window starts at D3's FIRST transient answer
  a = commitD3Ans({ needCall: "YES", keys: p.keys }, { code: "409", result_code: "LOCK_BUSY" });
  ok(a.needOps === "YES", "D3 answer: 409 -> read op 2's intents");
  r = commitD3(e(), plan, a, { intents: 0 });
  ok(r.job_status === "COMMITTING_IDA" && r.result_code === "IDA_WAIT" && r.jobRows[0].attempt_count === 0 && r.jobRows[0].next_attempt_at === "2026-10-21 10:00:10" && r.jobRows[0].progress_percent === 75
    && JSON.parse(r.jobRows[0].error_details).waitFrom === DB_NOW && JSON.parse(r.jobRows[0].error_details).step === "D3_RECEIPT", "D3: a first 409 -> wait 10 s, not counted, progress 75, the window starts now", r.jobRows[0]);
  r = commitD3(e({ d2DoneAt: "2026-10-21 03:59:00" }), plan, commitD3Ans({ needCall: "YES", keys: p.keys }, {}), { intents: 1 });
  ok(r.result_code === "IDA_WAIT" && JSON.parse(r.jobRows[0].error_details).waitFrom === DB_NOW, "D3: a late first kick 6 hours after D2 DONE -> still a wait (the window starts at this first answer)");
  r = commitD3(e({ waitFrom: "2026-10-21 09:29:59" }), plan, commitD3Ans({ needCall: "YES", keys: p.keys }, {}), { intents: 1 });
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IDA_RECEIPT_TIMEOUT" && JSON.parse(r.jobRows[0].error_details).waitFrom === "2026-10-21 09:29:59" && r.needUnlock === "NO",
    "D3: no answer 1,801 s after the first wait -> REQUIRES_REVIEW IDA_RECEIPT_TIMEOUT", r.jobRows[0]);
  r = commitD3(e({ waitFrom: "2026-10-21 09:30:00" }), plan, a, { intents: 0 });
  ok(r.result_code === "IDA_WAIT" && JSON.parse(r.jobRows[0].error_details).waitFrom === "2026-10-21 09:30:00", "D3: exactly 1,800 s -> still a wait, the window kept");
  r = commitD3(e({ waitFrom: "2026-10-21 10:30:00" }), plan, a, {});
  ok(r.result_code === "IDA_WAIT" && JSON.parse(r.jobRows[0].error_details).waitFrom === DB_NOW, "D3: a window start in the future (corrupt) -> a fresh window");
  ok(commitD3(e(), plan, commitD3Ans({ needCall: "YES", keys: p.keys }, { code: 400, msg: "envelope" }), null).result_code === "IDA_WAIT", "D3: the envelope (400 without a code) -> wait");
  for (const ans of [{ code: "400", result_code: "UNSUPPORTED_PRICE" }, { code: "500", result_code: "REQUIRES_REVIEW" }]) {
    ok(commitD3(e(), plan, commitD3Ans({ needCall: "YES", keys: p.keys }, ans), null).result_code === "IDA_RECEIPT_REFUSED", "D3: " + ans.code + " -> REQUIRES_REVIEW IDA_RECEIPT_REFUSED");
  }
}

// ------------------------------------------------------------------ D4
{
  const { commitD4Plan } = L("code_node_DCd4plan", ["commitD4Plan"]);
  const { commitD4Check } = L("code_node_DCd4check", ["commitD4Check"]);
  const c = mix();
  const e = (p) => entryOf(c, Object.assign({ phase: "B", progress: 85, unlockOk: "NO" }, p || {}));
  const own = (p) => [Object.assign({ db_now: DB_NOW, ida_id: IDAID, item_disassembly_status: "Processing", ida_v2_job_id: JOB, stock_movement_no: IDANO, lock_ref: KEY, lock_step: "LOCK|1" }, p || {})];
  const intent = intentOf({ B2: "Batch-00631", B3: "Batch-00632", B4: "Batch-00633" }, []);
  const lines = (nums) => c.lines.map((l, i) => ({ j: J({ id: l.id, batch_number: nums && nums[i] !== undefined ? nums[i] : l.batch_number }) }));
  const NUMBERED = ["-", "LOT-7", "LOT-7", "Batch-00631", "-", "Batch-00632", "Batch-00633"];
  let r = commitD4Plan(e(), rowsOf(c, "ITEMS"), own(), lines(), rowsOf(c, "BATCH"), intent);
  const lw = r.lineSlices.reduce((a, sl) => a.concat(sl.rows), []);
  const idsI = r.itemSlices.reduce((a, sl) => a.concat(sl.rows.map((x) => x.id)), []);
  ok(r.route === "GO" && r.needStatus === "YES" && J(r.statusRows) === J([{ id: IDAID, item_disassembly_status: "Completed", posted_status: "Unposted" }])
    && J(lw) === J([{ id: X.lineId(4), batch_number: "Batch-00631" }, { id: X.lineId(6), batch_number: "Batch-00632" }, { id: X.lineId(7), batch_number: "Batch-00633" }])
    && J(idsI) === J(c.itemIds) && new Set(r.itemSlices.reduce((a, sl) => a.concat(sl.rows.map((x) => x.last_transaction_date)), [])).size === 1 && r.needLines === "YES",
    "D4 plan: Processing -> every AUTO number into its line (the non-stock one too), item dates (one stamp, source first, non-stock included), the header Completed / Unposted", r);
  r = commitD4Plan(e(), rowsOf(c, "ITEMS"), own(), lines(["-", "LOT-7", "LOT-7", "Batch-00631"]), rowsOf(c, "BATCH"), intent);
  ok(r.lineCount === 2, "D4 plan: a line already holding its number is not written again", r.lineCount);
  const many = X.makeCase({ n: 600, pattern: (i) => ({ kind: i % 2 ? "auto" : "none" }) });
  const nums = {};
  many.batchRows.forEach((b, i) => { nums[b.key] = X.autoNumber(i); });
  r = commitD4Plan(entryOf(many, { phase: "B" }), rowsOf(many, "ITEMS"), own(), many.lines.map((l) => ({ j: J({ id: l.id, batch_number: l.batch_number }) })), rowsOf(many, "BATCH"), intentOf(nums, []));
  ok(r.lineSlices.length === 2 && r.lineSlices.every((sl) => sl.rows.length <= 250) && r.lineCount === 300 && r.itemSlices.length === 3 && r.itemCount === 601, "D4 plan: slices of <= 250 (300 AUTO lines, 601 items)",
    [r.lineSlices.map((sl) => sl.rows.length), r.itemSlices.map((sl) => sl.rows.length)]);
  r = commitD4Plan(e(), rowsOf(c, "ITEMS"), own({ item_disassembly_status: "Completed" }), lines(NUMBERED), rowsOf(c, "BATCH"), intent);
  ok(r.route === "GO" && r.needStatus === "NO" && r.itemSlices.length === 0 && r.lineSlices.length === 0, "D4 plan: Completed under this job + every AUTO line numbered -> nothing written again");
  r = commitD4Plan(e(), rowsOf(c, "ITEMS"), own({ item_disassembly_status: "Completed" }), lines(), rowsOf(c, "BATCH"), intent);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needStatus === "NO", "D4 plan: Completed but an AUTO line not numbered -> REQUIRES_REVIEW", r.result_message);
  for (const [label, p] of [["Draft", { item_disassembly_status: "Draft" }], ["deleted", { ida_id: null, item_disassembly_status: null, ida_v2_job_id: null }], ["another job's", { ida_v2_job_id: "2" }],
    ["another key's lock", { lock_ref: "k" }]]) {
    r = commitD4Plan(e(), rowsOf(c, "ITEMS"), own(p), lines(), rowsOf(c, "BATCH"), intent);
    ok(r.job_status === "REQUIRES_REVIEW" && r.needStatus === "NO" && r.jobRows[0].progress_percent === 0, "D4 plan: " + label + " -> REQUIRES_REVIEW, nothing written", r.result_message);
  }
  ok(commitD4Plan(e(), rowsOf(c, "ITEMS"), own(), lines(), rowsOf(c, "BATCH"), []).job_status === "REQUIRES_REVIEW", "D4 plan: no D1 intent (batch mode) -> REQUIRES_REVIEW (the numbers are unknown)");
  ok(commitD4Plan(e(), [], own(), lines(), rowsOf(c, "BATCH"), intent).job_status === "REQUIRES_REVIEW", "D4 plan: no ITEMS part -> REQUIRES_REVIEW");
  ok(commitD4Plan(e(), rowsOf(c, "ITEMS"), own(), lines().slice(0, 5), rowsOf(c, "BATCH"), intent).job_status === "REQUIRES_REVIEW", "D4 plan: an AUTO line gone -> REQUIRES_REVIEW");
  const nb = X.makeCase({ n: 3 });
  r = commitD4Plan(entryOf(nb, { phase: "B" }), rowsOf(nb, "ITEMS"), own(), [], [], []);
  ok(r.route === "GO" && r.lineCount === 0 && r.needLines === "NO" && r.needStatus === "YES", "D4 plan: a non-batch job -> no line writes, no line read-back", r);
  const plan = commitD4Plan(e(), rowsOf(c, "ITEMS"), own(), lines(), rowsOf(c, "BATCH"), intent);
  r = commitD4Check(e(), plan, own({ item_disassembly_status: "Completed" }), lines(NUMBERED));
  ok(r.route === "OK" && r.stepRows[0].step_name === "D4_FINISH" && r.stepRows[0].result_ref === "Completed / " + IDANO, "D4 check: Completed + numbered -> DONE");
  r = commitD4Check(e(), plan, own(), lines(NUMBERED));
  ok(r.result_code === "IDA_STEP_RETRY" && r.jobRows[0].progress_percent === 85, "D4 check: still Processing -> retry at 85 (D3 is done)", r.jobRows[0]);
  r = commitD4Check(e(), plan, own(), lines(NUMBERED), " (1 receipt skipped, stock control 0: R3)");
  ok(r.jobRows[0].progress_message === "Components received; finishing (1 receipt skipped, stock control 0: R3)", "D4: this pass's D3 skip note rides a retry row", r.jobRows[0]);
  r = commitD4Check(e({ skipNote: " (1 receipt skipped, stock control 0: R2)" }), plan, own(), lines(NUMBERED), null);
  ok(/R2\)$/.test(r.jobRows[0].progress_message), "D4: an earlier pass's note (the entry's) when D3 did not run now", r.jobRows[0]);
  const { commitFinish } = L("code_node_DCfinish", ["commitFinish"]);
  const fin = commitFinish(e(), " (1 receipt skipped, stock control 0: R3)");
  ok(fin.job_status === "COMPLETED" && fin.jobRows[0].progress_message === "Item Disassembly " + IDANO + " completed (1 receipt skipped, stock control 0: R3)" && fin.jobRows[0].progress_percent === 100,
    "finish: the COMPLETED job keeps the skipped receipts named", fin.jobRows[0]);
  ok(commitFinish(e(), null).jobRows[0].progress_message === "Item Disassembly " + IDANO + " completed", "finish: no skip -> the plain message");
  r = commitD4Check(e(), plan, own({ item_disassembly_status: "Completed" }), lines());
  ok(r.result_code === "IDA_STEP_RETRY" && /without their generated batch number/.test(r.result_message), "D4 check: Completed but a line not numbered -> retry", r.result_message);
}

// ------------------------------------------------------------------ declared output types (the platform keeps the declared keys; a number declared string would concatenate)
{
  const declared = {};
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "code-node") declared[n.id] = n.data.response_json; Object.values(n).forEach(walk); } };
  walk(doc);
  const check = (id, out) => {
    const bad = declared[id].filter((r) => out[r.name] !== undefined && out[r.name] !== null && (r.bsonType === "array" ? !Array.isArray(out[r.name]) : r.bsonType === "string" ? typeof out[r.name] !== "string" : false));
    const miss = Object.keys(out).filter((k) => !declared[id].some((r) => r.name === k));
    ok(!bad.length && !miss.length, id + ": every produced value matches its declared type, none undeclared", { bad: bad.map((r) => [r.name, r.bsonType, typeof out[r.name]]), miss: miss });
  };
  const c = mix();
  const { commitEntry } = L("code_node_DCentry", ["commitEntry"]);
  const none = [{ intents: 0, review: 0, done_summary: null }];
  check("code_node_DCentry", commitEntry(guard, [{ db_now: DB_NOW, lease_until: "2026-10-21 10:10:00", id: JOB, organization_id: ORG, command: "COMPLETE_IDA", job_status: "READY_TO_COMMIT", attempt_count: 0,
    row_version: 5, idempotency_key: KEY, correlation_id: "IDA|" + IDAID, is_deleted: 0, lease_live: 1, due: 1, prev_status: "Draft", req_action: "DIRECT" }], [], [], [{ prepared_payload: J(c.manifest) }],
  [{ ida_id: IDAID, item_disassembly_status: "Processing", ida_v2_job_id: JOB, stock_movement_no: IDANO, lock_ref: KEY }], none, none));
  const { commitD1Plan } = L("code_node_DCd1plan", ["commitD1Plan"]);
  const plan = commitD1Plan(entryOf(c), rowsOf(c, "BATCH"), [], bncRows());
  check("code_node_DCd1plan", plan);
  const { commitD1Decide } = L("code_node_DCd1decide", ["commitD1Decide"]);
  check("code_node_DCd1decide", commitD1Decide(entryOf(c), plan, rowsOf(c, "BATCH"), [], bncRows(), []));
  const { commitD1Check } = L("code_node_DCd1check", ["commitD1Check"]);
  const NUMS = { B2: "Batch-00631", B3: "Batch-00632", B4: "Batch-00633" };
  check("code_node_DCd1check", commitD1Check(entryOf(c), rowsOf(c, "BATCH"), intentOf(NUMS, []), bncRows(634), [batchRow("2113000000000000008"),
    batchRow("2113000000000000009", { batch_number: "Batch-00631", material_id: X.itemId(4) }), batchRow("2113000000000000010", { batch_number: "Batch-00633", material_id: X.itemId(7) })], rowsOf(c, "ENGINE_R")));
  const { commitD3Plan } = L("code_node_DCd3plan", ["commitD3Plan"]);
  check("code_node_DCd3plan", commitD3Plan(entryOf(c, { phase: "B" }), rowsOf(c, "ENGINE_R"), [{ n: 1, total: "10" }], [{ intents: 1, review: 0, done_summary: J({ movements: 1 }) }], rowsOf(c, "BATCH"),
    intentOf(NUMS, []), [batchRow("2113000000000000008"), batchRow("2113000000000000009", { batch_number: "Batch-00631", material_id: X.itemId(4) }),
      batchRow("2113000000000000010", { batch_number: "Batch-00633", material_id: X.itemId(7) })]));
  const { commitD2In } = L("code_node_DCd2in", ["commitD2In"]);
  check("code_node_DCd2in", commitD2In(entryOf(c), rowsOf(c, "ENGINE_I")));
  const { commitD4Plan } = L("code_node_DCd4plan", ["commitD4Plan"]);
  check("code_node_DCd4plan", commitD4Plan(entryOf(c, { phase: "B" }), rowsOf(c, "ITEMS"), [{ db_now: DB_NOW, ida_id: IDAID, item_disassembly_status: "Processing", ida_v2_job_id: JOB, stock_movement_no: IDANO,
    lock_ref: KEY }], c.lines.map((l) => ({ j: J({ id: l.id, batch_number: l.batch_number }) })), rowsOf(c, "BATCH"), intentOf(NUMS, [])));
}

console.log(fails ? fails + " FAILED, " + passes + " passed" : "all " + passes + " step checks passed");
process.exit(fails ? 1 : 0);
