// node test/commit/test_steps.js - unit tests of every IA_V2_COMMIT step decision on crafted inputs; each step function is
// loaded from the BUILT JSON node (exactly what ships) with the unit loader's strip rule. Per step: rows at the after-value ->
// done (nothing written); at the before-value -> write; anything else -> FAILED + back to Draft (phase A, nothing moved) or
// REQUIRES_REVIEW (phase B). Plus the built JSON's write nodes, engine calls, gates and declared output types.
const X = require("./fixture.js");
const { JOB, IAID, ORG, PLANT, NONCE, KEY, PARENT, IANO } = X;
let fails = 0;
let passes = 0;
const ok = (cond, what, extra) => { if (cond) passes++; else { fails++; console.log("FAIL", what, extra === undefined ? "" : JSON.stringify(extra).slice(0, 900)); } };
const L = (id, names) => X.loadNode("IA_V2_COMMIT", id, names);
const J = (o) => JSON.stringify(o);
const DB_NOW = "2026-10-20 10:00:00";
const guard = { route: "CONTINUE", jobId: JOB, tenantId: "000000", nonce: "00ff00ff00ff00ff00ff00ff", leaseOwner: "PUB|00ff00ff00ff00ff00ff00ff" };
const rowsOf = (c, name) => c.partStepRows.filter((r) => r.step_name.indexOf("P|" + NONCE + "|" + name + "|") === 0);
const doc = X.built("IA_V2_COMMIT");
const node = (id) => X.nodeById(doc, id);
const props = (id) => node(id).data.props.list.map((p) => p.prop);

function entryOf(c, patch) {
  return Object.assign({ jobId: JOB, tenantId: "000000", organizationId: ORG, plantId: PLANT, iaId: IAID, iaNo: IANO, parentItemId: PARENT, prevStatus: "Draft", idempotencyKey: KEY, dbNow: DB_NOW,
    jsAt: String(Date.now()), attempts: 0, rowVersion: 5, leaseUntil: "2026-10-20 10:10:00", progress: 70, progressMessage: "Issuing the components", unlockOk: "YES", partPrefix: "P|" + NONCE + "|",
    batchMode: c.batchMode, movementsI: c.movements.length, lineFingerprint: c.fp, batchId: "", batchNumber: "", i2DoneAt: "", i2Called: "", intent: null, hasIntent: "NO", phase: "A" }, patch || {});
}
const batchRow = (id, o) => ({ j: J(Object.assign({ id: id, batch_number: X.BATCH_NO, material_id: PARENT, plant_id: PLANT, organization_id: ORG, transaction_no: IANO }, o || {})) });
const identity = { batch_number: X.BATCH_NO, material_id: PARENT, plant_id: PLANT, organization_id: ORG, transaction_no: IANO };

// ------------------------------------------------------------------ the built JSON: writes, calls, gates, order
{
  const unl = ["update_node_IACefunlock", "update_node_IACi0unlock", "update_node_IACi1deunlock", "update_node_IACi1ckunlock", "update_node_IACi1unlock", "update_node_IACi2unlock"];
  ok(unl.every((id) => J(props(id)) === J(["id", "item_assembly_status"]) && /Item Assembly:Table:2098256587713404929/.test(J(node(id).data.table_id))),
    "every COMMIT unlock writes { id, item_assembly_status } on sm_item_assembly only");
  const del = ["update_node_IACefbatch", "update_node_IACi0batch", "update_node_IACi1debatch", "update_node_IACi1ckbatch", "update_node_IACi1batch", "update_node_IACi2batch"];
  ok(del.every((id) => J(props(id)) === J(["id", "is_deleted"]) && /Batch:Table:1902719754154655746/.test(J(node(id).data.table_id))), "every Batch soft-delete writes { id, is_deleted }");
  for (const tag of ["ef", "i0", "i1de", "i1ck", "i1", "i2"]) {
    const blk = (tag === "ef" ? node("ifBlock_TIACentryend") : node("ifBlock_TIAC" + tag + "end")).blocks.map((n) => n.id);
    const u = blk.indexOf("cor_IAC" + tag + "unlock"), b = blk.indexOf("cor_IAC" + tag + "batch"), jb = blk.indexOf("cor_IAC" + tag + "job");
    ok(u >= 0 && u < b && b < jb, tag + ": a phase-A exit writes the unlock, then the Batch soft-delete, then the job", blk);
  }
  ok(J(props("add_node_IACi1add")) === J(X.BATCH_COLS) && /Batch:Table:/.test(J(node("add_node_IACi1add").data.table_id)), "I1 Batch insert = add_node_F9KqZLfd's 11 columns", props("add_node_IACi1add"));
  ok(J(props("update_node_IACi4status")) === J(["id", "item_assembly_status", "posted_status"]), "I4 header write: id, item_assembly_status, posted_status only");
  ok(J(props("update_node_IACi3prog")) === J(["id", "progress_percent", "progress_message"]), "I3 progress write: 3 columns (the lease kept)");
  ok(J(props("update_node_IACi4iwrite")) === J(["id", "last_transaction_date"]) && /Item:Table:1901546842240438273/.test(J(node("update_node_IACi4iwrite").data.table_id)), "I4 item dates by id");
  const call = (id) => { const d = node(id).data; return [d.workflow.source, d.body_params.list.map((p) => [p.prop, p.valueType === "value" ? p.value : "ref"])]; };
  const eng = "INVENTORY_BULK_APPLY:Workflow:2109916822821744641";
  ok(J(call("workflow_node_IACi2")) === J([eng, [["operation_key", "ref"], ["mode", "APPLY"], ["organization_id", "ref"], ["movements", "ref"]]]), "I2 = APPLY with the 4 params");
  ok(J(call("workflow_node_IACi3")) === J([eng, [["operation_key", "ref"], ["mode", "APPLY"], ["organization_id", "ref"], ["movements", "ref"]]]), "I3 = APPLY with the 4 params (receiptBaseQty / assemblyCost never sent)");
  ok(J(call("workflow_node_IACi1plan")) === J([eng, [["operation_key", "ref"], ["mode", "PLAN"], ["organization_id", "ref"], ["movements", "ref"]]]), "I1 re-PLAN = PLAN with the 4 params");
  const i1 = node("ifBlock_TIACi1").blocks.map((n) => n.id);
  ok(i1.indexOf("cor_IACi1intent") < i1.indexOf("cor_IACi1add") && i1.indexOf("cor_IACi1add") < i1.indexOf("cor_IACi1plan") && i1.indexOf("cor_IACi1plan") < i1.indexOf("cor_IACi1done"),
    "I1: intent BEFORE the insert, the re-PLAN after it, DONE last", i1);
  const i2 = node("ifBlock_TIACi2").blocks.map((n) => n.id);
  ok(i2.indexOf("cor_IACi2done") < i2.indexOf("cor_IACsplit"), "I2: DONE row, then the SPLIT / PARK hand-over", i2);
  const top = doc.nodes.map((n) => n.id);
  ok(["if_IACi0", "if_IACi1", "if_IACi2", "if_IACi3", "if_IACi4", "code_node_IACfinish"].every((id, i, a) => i === 0 || top.indexOf(a[i - 1]) < top.indexOf(id)), "step order I0 I1 I2 I3 I4 finish");
  ok(/REGEXP '\^I\[0-9\]_'/.test(node("sql_node_IACsteps").data.script.code) && /LIKE 'I1\|I\|%'/.test(node("sql_node_IACintent").data.script.code), "steps SQL REGEXP '^I[0-9]_'; the intent read apart");
  const out = node("sql_node_IACi3out").data.script.code;
  ok(/m\.id > \{\{node:code_node_IACguard\.data\.jobId\}\}/.test(out) && /operation_effect_key LIKE 'IAC\|\{\{node:code_node_IACguard\.data\.jobId\}\}\|I\|%'/.test(out) && /SUM\(m\.total_price\)/.test(out),
    "I3 reads op 1's stored rows: id > job, LIKE 'IAC|<job>|I|%', SUM in SQL");
  const ia = node("sql_node_IACia").data.script.code;
  ok(/g\.is_deleted = 0/.test(ia) && /CONCAT\('IAC\|', SUBSTRING\(j\.correlation_id, 4\)\)/.test(ia), "the entry's ownership read: live IA, the IAC| lock of the job's correlation");
  // every SQL node is tenant-scoped
  const sqls = [];
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "sql-node") sqls.push(n); Object.values(n).forEach(walk); } };
  walk(doc);
  ok(sqls.length >= 20 && sqls.every((n) => /tenant_id = '\{\{node:code_node_IACguard\.data\.tenantId\}\}'/.test(n.data.script.code)), "every SQL node (" + sqls.length + ") is tenant-scoped");
  ok(sqls.every((n) => /^\s*(SELECT|WITH)\b/i.test(n.data.script.code) && !/\bSET\b/i.test(n.data.script.code)), "every SQL starts with SELECT, no SET");
}

// ------------------------------------------------------------------ entry
{
  const { commitEntry } = L("code_node_IACentry", ["commitEntry"]);
  const c = X.makeCase({ batch: true });
  const job = (p) => [Object.assign({ db_now: DB_NOW, lease_until: "2026-10-20 10:10:00", id: JOB, organization_id: ORG, command: "COMPLETE_IA", job_status: "READY_TO_COMMIT", progress_percent: 60,
    attempt_count: 0, row_version: 5, idempotency_key: KEY, correlation_id: "IA|" + IAID, is_deleted: 0, lease_owner: "WRK|abc", lease_live: 1, due: 1, prev_status: "Draft", req_action: "DIRECT" }, p || {})];
  const pay = (m) => [{ prepared_payload: J(m || c.manifest) }];
  const ia = (p) => [Object.assign({ ia_id: IAID, item_assembly_status: "Processing", ia_v2_job_id: JOB, stock_movement_no: IANO, item_id: PARENT, lock_ref: KEY }, p || {})];
  const step = (name, ref, at) => ({ step_name: name, step_status: "DONE", result_ref: ref || "", finished_at: at || "2026-10-20 09:59:00" });
  let r = commitEntry(guard, job(), [], [], pay(), ia());
  ok(r.route === "GO" && r.phase === "A" && r.needI0 === "YES" && r.needI1 === "YES" && r.needI2 === "YES" && r.needI3 === "NO" && r.unlockOk === "YES" && r.progress === 70
    && r.jobRows[0].lease_owner === guard.leaseOwner && r.jobRows[0].row_version === 6 && r.jobRows[0].job_status === "COMMITTING_IA", "entry: READY -> phase A, I0 I1 I2, the lease claim", r);
  ok(typeof r.attempts === "number" && typeof r.rowVersion === "number" && typeof r.movementsI === "number" && r.partPrefix === "P|" + NONCE + "|" && r.parentItemId === PARENT, "entry: numbers stay numbers (declared any)");
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_owner: "SPLIT|x", lease_live: 1 }), [step("I0_REVALIDATE"), step("I1_BATCH", J({ batch_id: "2113000000000000008", batch_number: X.BATCH_NO })),
    step("I2_ISSUE", J({ called: "YES", summary: { movements: 12 } }), "2026-10-20 09:58:00")], [], pay(), ia());
  ok(r.route === "GO" && r.phase === "B" && r.needI3 === "YES" && r.needI4 === "YES" && r.unlockOk === "NO" && r.progress === 75 && r.batchId === "2113000000000000008" && r.i2DoneAt === "2026-10-20 09:58:00"
    && r.i2Called === "YES", "entry: I2 DONE + a SPLIT| lease -> phase B at 75, I1's batch, I2's time", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_owner: "PUB|old", lease_live: 0 }), [step("I0_REVALIDATE"), step("I1_BATCH", J({ batch_id: "2113000000000000008" })), step("I2_ISSUE"),
    step("I3_RECEIPT")], [], pay(), ia({ item_assembly_status: "Completed" }));
  ok(r.route === "GO" && r.phase === "B" && r.needI3 === "NO" && r.needI4 === "YES" && r.progress === 85, "entry: I3 DONE, the IA already Completed (I4 wrote it) -> phase B at 85, I4 only", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_owner: "PUB|other", lease_live: 1 }), [], [], pay(), ia());
  ok(r.route === "NO_WRITE" && r.result_code === "JOB_ROW_VERSION_CONFLICT", "entry: a foreign live lease -> NO_WRITE", r.result_code);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_owner: "", lease_live: 0, due: 0, next_attempt_at: "2026-10-20 10:05:00" }), [], [], pay(), ia());
  ok(r.route === "NO_WRITE" && r.result_code === "" && /not due/.test(r.result_message), "entry: backoff not over -> NO_WRITE", r.result_message);
  for (const st of ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "QUEUED"]) {
    r = commitEntry(guard, job({ job_status: st }), [], [], pay(), ia());
    ok(r.route === "NO_WRITE" && r.result_code === (st === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION") && r.jobRows.length === 0, "entry: " + st + " -> NO_WRITE", r.result_code);
  }
  ok(commitEntry(guard, job({ command: "REVERT_IA" }), [], [], pay(), ia()).route === "NO_WRITE" && commitEntry(guard, [], [], [], pay(), ia()).result_code === "IA_INVALID_DATA",
    "entry: a REVERT_IA job / no job -> NO_WRITE");
  r = commitEntry(guard, job(), [], [], pay(), ia({ item_assembly_status: "Draft" }));
  ok(r.route === "FAIL" && r.job_status === "FAILED" && r.result_code === "IA_NOT_LOCKED" && r.needUnlock === "NO" && r.needBatchDel === "NO", "entry: the IA no longer Processing -> FAILED, no unlock", r);
  r = commitEntry(guard, job(), [], [], pay(), []);
  ok(r.route === "FAIL" && r.result_code === "IA_NOT_LOCKED" && r.needUnlock === "NO" && /deleted/.test(r.result_message), "entry: the IA soft-deleted -> FAILED, no unlock", r.result_message);
  r = commitEntry(guard, job(), [], [], pay(), ia({ lock_ref: "another-key" }));
  ok(r.route === "FAIL" && r.needUnlock === "NO", "entry: the lock is another key's -> FAILED, no unlock", r);
  const bad = (patch, what) => {
    const m = Object.assign(JSON.parse(J(c.manifest)), patch);
    const x = commitEntry(guard, job(), [], [], pay(m), ia());
    ok(x.route === "FAIL" && x.result_code === "IA_INVALID_DATA" && x.needUnlock === "YES" && x.unlockRows[0].item_assembly_status === "Draft", "entry: " + what + " -> FAILED + back to Draft", x);
  };
  bad({ job_id: "2112100000000000002" }, "another job's manifest");
  bad({ ia_id: "2112073133161844739" }, "another IA's manifest");
  bad({ batchMode: "reuse_or_insert" }, "a Manual parent's batchMode");
  bad({ batchMode: "none" }, "a BATCH part with batchMode none");
  bad({ parts: Object.assign({}, c.manifest.parts, { LABELS: [] }) }, "a part missing");
  bad({ lineFingerprint: "SAF1:x" }, "no IF1 fingerprint");
  bad({ nonce: "x|y" }, "a bad nonce");
  r = commitEntry(guard, job({ prev_status: null }), [], [], [{ prepared_payload: "{broken" }], ia());
  ok(r.route === "FAIL" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO", "entry: no prevStatus + bad manifest -> REQUIRES_REVIEW, no unlock (no default)", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_live: 0 }), [step("I0_REVALIDATE"), step("I1_BATCH", J({ batch_id: "1" })), step("I2_ISSUE")], [], [{ prepared_payload: "{}" }], ia());
  ok(r.route === "REVIEW" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needBatchDel === "NO", "entry: a bad manifest after I2 -> REQUIRES_REVIEW, nothing else", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_live: 0 }), [step("I2_ISSUE"), step("I1_BATCH", J({ batch_id: "1" }))], [], pay(), ia({ item_assembly_status: "Draft" }));
  ok(r.route === "REVIEW" && r.needUnlock === "NO", "entry: phase B and the IA Draft -> REQUIRES_REVIEW", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_live: 0 }), [step("I2_ISSUE")], [], pay(), ia());
  ok(r.route === "REVIEW" && /without an I1_BATCH/.test(r.result_message), "entry: a batch parent's I2 DONE without I1 DONE -> REQUIRES_REVIEW", r.result_message);
  // the I1 insert without its DONE row, then the IA lost its lock: the Batch row is looked up by the intent
  const intentRows = [{ step_name: "I1|I|001", result_ref: J(identity) }];
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_live: 0 }), [step("I0_REVALIDATE")], intentRows, pay(), []);
  ok(r.route === "FAIL" && r.needOursRead === "YES" && r.oursItem === PARENT && r.oursOrg === ORG && r.hasIntent === "YES", "entry: FAILED with an intent and no I1 DONE -> read the Batch rows by the intent", r);
  r = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_live: 0 }), [step("I0_REVALIDATE"), step("I1_BATCH", J({ batch_id: "2113000000000000008" }))], intentRows, pay(), []);
  ok(r.route === "FAIL" && r.needOursRead === "NO" && J(r.batchDelRows) === J([{ id: "2113000000000000008", is_deleted: 1 }]), "entry: FAILED after I1 DONE -> its batch_id soft-deleted", r.batchDelRows);
  const { commitEntryEnd } = L("code_node_IACefend", ["commitEntryEnd"]);
  const e2 = commitEntry(guard, job({ job_status: "COMMITTING_IA", lease_live: 0 }), [step("I0_REVALIDATE")], intentRows, pay(), []);
  const end = commitEntryEnd(e2, [batchRow("2113000000000000008"), batchRow("2111000000000000001"), batchRow("2113000000000000009", { transaction_no: "GR-1" })]);
  ok(end.needBatchDel === "YES" && J(end.batchDelRows) === J([{ id: "2113000000000000008", is_deleted: 1 }]) && end.job_status === "FAILED" && end.needUnlock === "NO",
    "entry end: only the intent's identity with id > job is removed (not an older row, not another document's)", end);
  const rv = commitEntry(guard, job({ prev_status: "Completed" }), [step("I0_REVALIDATE"), step("I1_BATCH", J({ batch_id: "2113000000000000008" }))], [], pay(), ia({ item_assembly_status: "Draft" }));
  ok(commitEntryEnd(Object.assign({}, rv, { job_status: "REQUIRES_REVIEW" }), [batchRow("2113000000000000008")]).needBatchDel === "NO", "entry end: a review removes nothing");
  // ruling 10 R2: op 1 already has engine rows (the run died after its APPLY, before I2 DONE) -> no phase-A failure may claim
  // "nothing moved": REQUIRES_REVIEW, no unlock, no Batch soft-delete
  const s1 = [step("I0_REVALIDATE"), step("I1_BATCH", J({ batch_id: "2113000000000000008", batch_number: X.BATCH_NO }))];
  const lost = job({ job_status: "COMMITTING_IA", lease_owner: "PUB|dead", lease_live: 0 });
  for (const [label, op1] of [["an intent row", { intents: 1, review: 0, done_summary: null }], ["its IBA|DONE row", { intents: 0, review: 0, done_summary: J({ movements: 12 }) }]]) {
    for (const [what, facts, payload] of [["the IA soft-deleted", [], pay()], ["the IA unlocked meanwhile", ia({ item_assembly_status: "Draft" }), pay()], ["an unusable manifest", ia(), [{ prepared_payload: "{}" }]]]) {
      r = commitEntry(guard, lost, s1, [], payload, facts, [op1]);
      const d = r.jobRows.length ? JSON.parse(r.jobRows[0].error_details) : {};
      ok(r.op1Wrote === "YES" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RECONCILIATION_MISMATCH" && r.needUnlock === "NO" && r.needBatchDel === "NO" && r.needOursRead === "NO"
        && d.step === "I2_ISSUE" && /^IA_(NOT_LOCKED|INVALID_DATA)$/.test(d.wouldFail) && commitEntryEnd(r, [batchRow("2113000000000000008")]).needBatchDel === "NO",
        "entry R2: op 1 has " + label + ", " + what + " -> REQUIRES_REVIEW, no unlock, the Batch row kept", r);
    }
  }
  r = commitEntry(guard, lost, s1, [], pay(), [], [{ intents: 0, review: 0, done_summary: null }]);
  ok(r.op1Wrote === "NO" && r.job_status === "FAILED" && r.needBatchDel === "YES", "entry R2: op 1 without any row -> the clean FAILED as before", r);
  // ruling 10 R4: I3's wait window is recovered from the job's error_details only for I3's own IA_WAIT
  const waitJob = (code, details) => job({ job_status: "COMMITTING_IA", lease_live: 0, error_code: code, error_details: details });
  const s2 = s1.concat([step("I2_ISSUE")]);
  const wf = (jb) => commitEntry(guard, jb, s2, [], pay(), ia(), [{ intents: 1, review: 0, done_summary: J({ movements: 12 }) }]).waitFrom;
  ok(wf(waitJob("IA_WAIT", J({ step: "I3_RECEIPT", why: "409", waitFrom: "2026-10-20 09:41:07", waited: 3 }))) === "2026-10-20 09:41:07", "entry R4: I3's IA_WAIT -> waitFrom carried");
  ok(wf(waitJob("IA_STEP_RETRY", J({ step: "I3_RECEIPT", waitFrom: "2026-10-20 09:41:07" }))) === "" && wf(waitJob("IA_WAIT", J({ step: "I2_ISSUE", waitFrom: "2026-10-20 09:41:07" }))) === ""
    && wf(waitJob("IA_WAIT", "{broken")) === "" && wf(waitJob("IA_WAIT", J({ step: "I3_RECEIPT", waitFrom: "yesterday" }))) === "" && wf(waitJob(null, null)) === "",
    "entry R4: anything else (another code / step, unreadable, a malformed time, a reset job) -> no window yet");
}

// ------------------------------------------------------------------ the shared exits (failNoWrite / stepEnd / waits)
{
  const fx = L("code_node_IACi2", ["failNoWrite", "stepEnd", "lockWait", "stepWait", "reviewEnd", "jobRow"]);
  const c = X.makeCase({ batch: true });
  let r = fx.failNoWrite(entryOf(c), "IA_X", "msg", "why", ["2113000000000000008", "2113000000000000008", "bad"]);
  ok(r.job_status === "FAILED" && J(r.unlockRows) === J([{ id: IAID, item_assembly_status: "Draft" }]) && J(r.batchDelRows) === J([{ id: "2113000000000000008", is_deleted: 1 }])
    && r.jobRows[0].progress_percent === 0 && r.jobRows[0].progress_message === "Not completed: msg" && r.jobRows[0].finished_at, "failNoWrite: FAILED, Draft, our Batch row once", r);
  r = fx.failNoWrite(entryOf(c, { unlockOk: "NO" }), "IA_X", "msg", "why", ["2113000000000000008"]);
  ok(r.needUnlock === "NO" && r.needBatchDel === "YES", "failNoWrite: not owned -> no unlock (the Batch row still removed)");
  r = fx.failNoWrite(entryOf(c, { op1Wrote: "YES" }), "IA_INVENTORY_INSUFFICIENT", "msg", "why", ["2113000000000000008"]);
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RECONCILIATION_MISMATCH" && r.needUnlock === "NO" && r.needBatchDel === "NO" && JSON.parse(r.jobRows[0].error_details).wouldFail === "IA_INVENTORY_INSUFFICIENT",
    "failNoWrite R2: op 1 has engine rows -> REQUIRES_REVIEW, no unlock, no Batch soft-delete (every phase-A exit)", r);
  // RES-01 Created (BA, 10-22): a Created IA's job unlocks back to Created
  r = fx.failNoWrite(entryOf(c, { prevStatus: "Created" }), "IA_X", "msg", "why", ["2113000000000000008"]);
  ok(r.job_status === "FAILED" && r.needUnlock === "YES" && JSON.stringify(r.unlockRows) === JSON.stringify([{ id: IAID, item_assembly_status: "Created" }]), "failNoWrite: prevStatus Created -> FAILED, unlocked to Created", r);
  for (const p of ["In Progress", "", "Completed"]) {
    r = fx.failNoWrite(entryOf(c, { prevStatus: p }), "IA_X", "msg", "why", ["2113000000000000008"]);
    ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO" && r.needBatchDel === "NO", "failNoWrite: prevStatus " + J(p) + " -> review, nothing else");
  }
  r = fx.stepEnd(entryOf(c, { attempts: 1, progress: 75 }), "I3_RECEIPT", "x", false);
  ok(r.job_status === "COMMITTING_IA" && r.jobRows[0].attempt_count === 2 && r.jobRows[0].next_attempt_at === "2026-10-20 10:00:04" && r.jobRows[0].progress_percent === 75 && r.result_code === "IA_STEP_RETRY",
    "stepEnd: retry 2 after 4 s at the pass's progress", r.jobRows[0]);
  r = fx.stepEnd(entryOf(c, { attempts: 3 }), "I4_FINISH", "x", false);
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RECONCILIATION_MISMATCH" && r.jobRows[0].error_message === X.C.IA_TEXT.review, "stepEnd: after 3 retries -> REQUIRES_REVIEW");
  r = fx.lockWait(entryOf(c, { attempts: 4 }), "409");
  ok(r.jobRows[0].attempt_count === 5 && r.jobRows[0].next_attempt_at === "2026-10-20 10:04:00" && r.result_code === "IA_LOCK_WAIT", "lockWait: 15 s x 2^4 = 240 s, counted", r.jobRows[0]);
  r = fx.stepWait(entryOf(c, { attempts: 2 }), "I3_RECEIPT", "409", 10);
  ok(r.jobRows[0].attempt_count === 2 && r.jobRows[0].next_attempt_at === "2026-10-20 10:00:10" && r.result_code === "IA_WAIT", "stepWait: 10 s, not counted", r.jobRows[0]);
}

// ------------------------------------------------------------------ I0
{
  const { commitI0 } = L("code_node_IACi0", ["commitI0"]);
  const c = X.makeCase({});
  const hdr = (p) => [{ j: J(Object.assign({}, c.header, p || {})) }];
  const lines = (f) => c.lines.map((l) => ({ j: J(f ? f(l) : l) }));
  ok(commitI0(entryOf(c), hdr(), lines()).route === "OK", "I0: stored = planned -> DONE");
  ok(commitI0(entryOf(c), hdr(), lines().reverse()).route === "OK", "I0: row order does not matter");
  let r = commitI0(entryOf(c), hdr(), lines((l) => (l.line_index === "2" ? Object.assign({}, l, { temp_qty_data: "[]" }) : l)));
  ok(r.job_status === "FAILED" && r.result_code === "IA_LINES_CHANGED" && r.needUnlock === "YES", "I0: a pick removed -> FAILED IA_LINES_CHANGED + Draft", r.result_message);
  r = commitI0(entryOf(c), hdr({ item_qty: "4.00000000" }), lines());
  ok(r.result_code === "IA_LINES_CHANGED", "I0: the header's item_qty changed -> FAILED");
  r = commitI0(entryOf(c), hdr({ stock_movement_no: "IA-2610-0043" }), lines());
  ok(r.result_code === "IA_LINES_CHANGED" && /number/.test(r.result_message), "I0: the IA number changed -> FAILED", r.result_message);
  r = commitI0(entryOf(c), hdr({ item_assembly_status: "Draft" }), lines());
  ok(r.result_code === "IA_NOT_LOCKED", "I0: not Processing -> FAILED IA_NOT_LOCKED");
  r = commitI0(entryOf(c), hdr({ ia_v2_job_id: "2112100000000000002" }), lines());
  ok(r.result_code === "IA_NOT_LOCKED", "I0: another job's -> FAILED IA_NOT_LOCKED");
  ok(commitI0(entryOf(c), [], lines()).result_code === "IA_NOT_LOCKED", "I0: the header missing (deleted) -> FAILED");
}

// ------------------------------------------------------------------ I1
{
  const { commitI1Decide } = L("code_node_IACi1decide", ["commitI1Decide"]);
  const { commitI1Check } = L("code_node_IACi1check", ["commitI1Check"]);
  const { commitI1 } = L("code_node_IACi1", ["commitI1"]);
  const c = X.makeCase({ batch: true });
  const e = (p) => entryOf(c, p);
  const withIntent = { hasIntent: "YES", intent: identity };
  let d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  ok(d.route === "GO" && d.needIntent === "YES" && d.needInsert === "YES" && d.intentRows[0].step_name === "I1|I|001" && d.intentRows[0].step_status === "INTENT"
    && J(JSON.parse(d.intentRows[0].result_ref)) === J(identity) && J(Object.keys(d.insertRows[0])) === J(X.BATCH_COLS) && d.insertRows[0].initial_quantity === "3.00000000",
    "I1 decide: nothing yet -> the intent (= the identity) and ONE row of the 11 columns", d);
  d = commitI1Decide(e(withIntent), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), [batchRow("2113000000000000008")]);
  ok(d.route === "GO" && d.needIntent === "NO" && d.needInsert === "NO" && J(d.ours) === J(["2113000000000000008"]), "I1 decide: ours (intent, id > job) -> adopt, nothing written", d);
  d = commitI1Decide(e(withIntent), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  ok(d.needIntent === "NO" && d.needInsert === "YES", "I1 decide: an intent without its row -> insert again, no second intent (unique Job Step)", d);
  d = commitI1Decide(e(withIntent), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), [batchRow("2113000000000000008"), batchRow("2113000000000000009")]);
  ok(d.job_status === "FAILED" && d.result_code === "IA_BATCH_FAILED" && d.batchDelRows.length === 2, "I1 decide: two of ours -> FAILED, both soft-deleted", d);
  for (const [label, rows] of [["another document's row", [batchRow("2111000000000000001", { transaction_no: "GR-2610-0007" })]], ["a case / trailing-space variant", [batchRow("2111000000000000001", { batch_number: X.BATCH_NO.toUpperCase() + "  ", plant_id: "1" })]],
    ["this IA's row from before the job", [batchRow("2111000000000000001")]]]) {
    d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), rows);
    ok(d.job_status === "FAILED" && d.result_code === "IA_BATCH_DUPLICATE" && d.result_message.indexOf("2111000000000000001") >= 0 && d.needBatchDel === "NO" && d.needInsert === "NO",
      "I1 decide: the number held by " + label + " -> FAILED IA_BATCH_DUPLICATE, nothing removed", d);
  }
  d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), [batchRow("2111000000000000001", { batch_number: "1016-005-0004" })]);
  ok(d.needInsert === "YES", "I1 decide: another number of the item -> insert");
  d = commitI1Decide(e({ hasIntent: "YES", intent: Object.assign({}, identity, { batch_number: "X" }) }), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  ok(d.job_status === "REQUIRES_REVIEW", "I1 decide: an intent that is not the part's row -> REQUIRES_REVIEW");
  ok(commitI1Decide(e({ hasIntent: "BAD" }), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []).job_status === "REQUIRES_REVIEW", "I1 decide: an unreadable intent -> REQUIRES_REVIEW");
  ok(commitI1Decide(e({ parentItemId: "2094626841323700299" }), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []).result_code === "IA_INVALID_DATA", "I1 decide: the part is another item's -> FAILED");
  ok(commitI1Decide(e(), [], rowsOf(c, "ENGINE_R"), []).result_code === "IA_INVALID_DATA", "I1 decide: no BATCH part -> FAILED");
  d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  let k = commitI1Check(e(), d, [batchRow("2113000000000000008"), batchRow("2111000000000000001", { transaction_no: "GR-1" })]);
  ok(k.route === "GO" && k.batchId === "2113000000000000008" && k.needPlan === "YES" && k.planKey === "IAC|" + JOB + "|R" && k.planMovements[0].batch_id === "2113000000000000008"
    && k.planMovements[0].unit_price === 0 && J(Object.keys(k.planMovements[0])) === J(Object.keys(c.r1)), "I1 check: one of ours read back -> the re-PLAN of R1 with its batch_id, unit_price 0", k);
  k = commitI1Check(e(), d, []);
  ok(k.job_status === "COMMITTING_IA" && k.result_code === "IA_STEP_RETRY", "I1 check: none read back -> retry");
  k = commitI1Check(e({ attempts: 3 }), d, []);
  ok(k.job_status === "FAILED" && k.result_code === "IA_BATCH_FAILED" && k.needBatchDel === "NO", "I1 check: none after 3 retries -> FAILED");
  k = commitI1Check(e(), d, [batchRow("2113000000000000008"), batchRow("2113000000000000009")]);
  ok(k.job_status === "FAILED" && k.batchDelRows.length === 2, "I1 check: inserted twice -> FAILED, both removed");
  const chk = commitI1Check(e(), d, [batchRow("2113000000000000008")]);
  const labels = rowsOf(c, "LABELS");
  let r = commitI1(e(), chk, { code: "200", result_code: "OK", r1Code: "200" }, []);
  ok(r.route === "OK" && r.stepRows[0].step_name === "I1_BATCH" && J(JSON.parse(r.stepRows[0].result_ref)) === J({ batch_id: "2113000000000000008", batch_number: X.BATCH_NO }) && r.batchId === "2113000000000000008",
    "I1: re-PLAN 200 + R1 200 -> DONE {batch_id, batch_number}", r);
  r = commitI1(e(), chk, { code: "200", result_code: "OK", r1Code: "401", r1Message: "Skipping inventory update for item (stock control = 0)" }, labels);
  ok(r.job_status === "FAILED" && r.result_code === "IA_PLAN_SKIPPED" && /into bin FG-01/.test(r.jobRows[0].error_message) && /: nothing was moved\.$/.test(r.jobRows[0].error_message) && r.batchDelRows.length === 1,
    "I1: R1 401 -> FAILED IA_PLAN_SKIPPED (worded) + our row removed", r.jobRows[0].error_message);
  r = commitI1(e(), chk, { code: "400", result_code: "DUPLICATE_BALANCE", message: "More than one item_batch_balance row for x (movement R1)" }, labels);
  ok(r.result_code === "IA_INVENTORY_DUPLICATE_BALANCE" && /FG-01/.test(r.jobRows[0].error_message) && r.batchDelRows.length === 1, "I1: 400 -> FAILED IA_INVENTORY_<code>, worded, our row removed", r.jobRows[0].error_message);
  r = commitI1(e(), chk, { code: "", result_code: "" }, []);
  ok(r.result_code === "IA_STEP_RETRY" && r.needBatchDel === "NO", "I1: no answer -> retry (the row kept for the next pass)");
  r = commitI1(e({ attempts: 3 }), chk, { code: "409", result_code: "LOCK_BUSY" }, []);
  ok(r.result_code === "IA_PLAN_FAILED" && r.batchDelRows.length === 1, "I1: transient after 3 retries -> FAILED IA_PLAN_FAILED, our row removed");
}

// ------------------------------------------------------------------ I2
{
  const { commitI2In } = L("code_node_IACi2in", ["commitI2In"]);
  const { commitI2Ans } = L("code_node_IACi2ans", ["commitI2Ans"]);
  const { commitI2 } = L("code_node_IACi2", ["commitI2"]);
  const c = X.makeCase({ batch: true });
  const e = (p) => entryOf(c, Object.assign({ batchId: "2113000000000000008" }, p || {}));
  const inp = commitI2In(e(), rowsOf(c, "ENGINE_I"));
  ok(inp.ok === "YES" && inp.needCall === "YES" && inp.operationKey === "IAC|" + JOB + "|I" && inp.count === c.movements.length && J(inp.movements) === J(c.movements), "I2 input: the ENGINE_I movements as planned");
  ok(commitI2In(e({ jobId: "2112100000000000002" }), rowsOf(c, "ENGINE_I")).ok === "NO", "I2 input: another job's operation key -> not ok");
  const ans = (o) => commitI2Ans({ needCall: "YES" }, o);
  ok(J(ans({ code: "409", result_code: "LOCK_BUSY" })) === J({ code: "409", result_code: "LOCK_BUSY", message: "", summary: {}, need409: "YES", need400: "NO" }), "I2 answer: 409 -> read the intents");
  ok(ans({ code: 400, success: false, data: null, msg: "boom" }).need409 === "YES" && ans({ code: 400, success: false, data: null, msg: "boom" }).message === "boom", "I2 answer: the envelope (400, no code) -> transient, msg kept");
  ok(ans({ code: "400", result_code: "INSUFFICIENT", message: "m" }).need400 === "YES", "I2 answer: 400 with a code -> LABELS");
  ok(J(ans({ code: "200", result_code: "OK", summary: J({ movements: 3, skipped: 1 }) }).summary) === J({ movements: 3, skipped: 1 }), "I2 answer: the summary (object or text)");
  const input = Object.assign({}, inp);
  let r = commitI2(e(), guard, input, { code: "200", result_code: "OK", summary: { movements: 12, skipped: 0 } }, null, [], null);
  // one stock call per worker run (prod 10-26: a lock lives until the top-level run ends): after op 1 the receipt (op 2) goes to the next run
  ok(r.route === "OK" && r.path === "PARK" && r.splitRows[0].lease_owner === null && r.splitRows[0].next_attempt_at === DB_NOW && r.splitRows[0].progress_percent === 75 &&
    r.splitRows[0].attempt_count === 0 && J(JSON.parse(r.stepRows[0].result_ref)) === J({ called: "YES", code: "200", result_code: "OK", summary: { movements: 12, skipped: 0 } }),
  "I2: 200 -> DONE (op 1's summary) + PARK at 75 (due now, no lease: op 2 in the next run), attempts 0", r);
  r = commitI2(e({ attempts: 5 }), guard, input, { code: "200", result_code: "REPLAYED", summary: { movements: 11, skipped: 1 } }, null, [], null);
  ok(r.route === "OK" && r.path === "PARK" && r.splitRows[0].attempt_count === 0 && /1 skipped/.test(r.result_message), "I2: REPLAYED with a 401 skip -> DONE + PARK, attempts reset",
    r.result_message);
  r = commitI2(e({ movementsI: 1001 }), guard, input, { code: "200", result_code: "OK" }, null, [], null);
  ok(r.path === "PARK" && r.splitRows[0].lease_owner === null && r.splitRows[0].next_attempt_at === DB_NOW, "I2: above 1,000 picks -> PARK (due now, no lease)");
  r = commitI2(e(), guard, Object.assign({}, input, { needCall: "NO", count: 0 }), {}, null, [], null);
  ok(r.route === "OK" && J(JSON.parse(r.stepRows[0].result_ref)) === J({ called: "NO", movements: 0 }) && r.path === "SPLIT" && r.splitRows[0].lease_owner === "SPLIT|" + guard.nonce,
    "I2: no stock pick -> DONE without a call + SPLIT (op 2 is then this run's only stock call)", r);
  r = commitI2(e(), guard, input, { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M3)" }, null, rowsOf(c, "LABELS"), null);
  ok(r.job_status === "FAILED" && r.result_code === "IA_INVENTORY_INSUFFICIENT" && /line 2 \(RM-0002\), bin A1-B2/.test(r.jobRows[0].error_message) && J(r.batchDelRows) === J([{ id: "2113000000000000008", is_deleted: 1 }])
    && r.needUnlock === "YES", "I2: 400 -> FAILED, worded, Draft, the Batch row removed", r);
  r = commitI2(e({ batchId: "" }), guard, input, { code: "400", result_code: "INSUFFICIENT", message: "m" }, null, [], { batchId: "2113000000000000009" });
  ok(J(r.batchDelRows) === J([{ id: "2113000000000000009", is_deleted: 1 }]), "I2: the Batch row I1 inserted in THIS pass is removed too");
  r = commitI2(e(), guard, input, { code: "409", result_code: "LOCK_BUSY" }, { intents: 0 }, [], null);
  ok(r.result_code === "IA_LOCK_WAIT" && r.jobRows[0].attempt_count === 1 && r.needUnlock === "NO", "I2: 409, no intent -> lock wait");
  r = commitI2(e({ attempts: 8 }), guard, input, { code: "409", result_code: "LOCK_BUSY" }, { intents: 0 }, [], null);
  ok(r.job_status === "FAILED" && r.result_code === "IA_INVENTORY_LOCK_BUSY" && r.needUnlock === "YES" && r.needBatchDel === "YES", "I2: 409 after 8 waits -> FAILED IA_INVENTORY_LOCK_BUSY");
  // engine v12: this operation's earlier run is still alive (a resumed pass): wait it out even with intent rows; review once the waits
  // are spent, never FAILED (that run may still be writing)
  const alive = { code: "409", result_code: "LOCK_BUSY", message: "the same operation is still running (run 3, last heartbeat 2026-10-21 17:30:00)" };
  r = commitI2(e(), guard, input, alive, { intents: 4 }, [], null);
  ok(r.result_code === "IA_LOCK_WAIT" && r.jobRows[0].attempt_count === 1 && r.needUnlock === "NO" && r.needBatchDel === "NO", "I2: v12 'the same operation is still running' WITH intent rows -> lock wait", r);
  r = commitI2(e({ attempts: 8 }), guard, input, alive, { intents: 0 }, [], null);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needBatchDel === "NO", "I2: v12 'the same operation is still running' after 8 waits -> REQUIRES_REVIEW, never FAILED", r);
  r = commitI2(e(), guard, input, { code: "", result_code: "" }, { intents: 1 }, [], null);
  ok(r.result_code === "IA_STEP_RETRY" && r.needUnlock === "NO" && r.needBatchDel === "NO", "I2: no answer WITH intent rows -> retry, never a failure");
  r = commitI2(e(), guard, input, { code: "500", result_code: "REQUIRES_REVIEW" }, null, [], null);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO" && r.needBatchDel === "NO", "I2: 500 -> REQUIRES_REVIEW at once, nothing else");
  ok(commitI2(e(), guard, Object.assign({}, input, { ok: "NO", why: "x" }), {}, null, [], null).result_code === "IA_INVALID_DATA", "I2: no ENGINE_I part -> FAILED");
}

// ------------------------------------------------------------------ I3
{
  const { commitI3Plan } = L("code_node_IACi3plan", ["commitI3Plan"]);
  const { commitI3Ans } = L("code_node_IACi3ans", ["commitI3Ans"]);
  const { commitI3 } = L("code_node_IACi3", ["commitI3"]);
  const c = X.makeCase({ batch: true, altUom: true, itemQty: 2.5 });
  const e = (p) => entryOf(c, Object.assign({ phase: "B", progress: 75, batchId: "2113000000000000008", i2DoneAt: "2026-10-20 09:50:00", i2Called: "YES", unlockOk: "NO" }, p || {}));
  const op1 = (n, o) => [Object.assign({ intents: 1, review: 0, done_summary: J({ movements: n, skipped: 0 }) }, o || {})];
  const out = (n, t) => [{ n: n, total: t }];
  let p = commitI3Plan(e(), rowsOf(c, "ENGINE_R"), out(12, "49.12340000"), op1(12));
  const want = X.C.iaQ8(49.1234 / 30 + 1.25);
  ok(p.route === "GO" && p.needCall === "YES" && p.price === want && p.operationKey === "IAC|" + JOB + "|R" && p.movements.length === 1 && p.movements[0].unit_price === want
    && p.movements[0].batch_id === "2113000000000000008" && J(Object.keys(p.movements[0])) === J(Object.keys(c.r1)) && p.movements[0].quantity === 2.5,
    "I3 plan: price = stored OUT total / base qty (2.5 x 12) + assembly cost; R1 with it and I1's batch_id, the part's key order", p);
  ok(J(commitI3Plan(e(), rowsOf(c, "ENGINE_R"), out(12, "49.12340000"), op1(12)).movements) === J(p.movements), "I3 plan: the same request on every pass");
  // Review Focus 4: a 401 skip inside op 1 - the DONE summary counts 11 code-200 results, 11 rows stored -> no review
  p = commitI3Plan(e(), rowsOf(c, "ENGINE_R"), out(11, "45.00000000"), op1(11, { done_summary: J({ movements: 11, skipped: 1 }) }));
  ok(p.route === "GO" && p.price === X.C.iaQ8(45 / 30 + 1.25), "I3 plan: a 401 skip (11 results of 12 picks) -> priced from the 11 stored rows, no review", p);
  for (const [label, o, rows] of [["op 1 under review", { review: 1 }, 12], ["op 1 without IBA|DONE", { done_summary: null }, 12], ["fewer stored rows than results", {}, 11]]) {
    p = commitI3Plan(e(), rowsOf(c, "ENGINE_R"), out(rows, "1.00000000"), op1(12, o));
    ok(p.job_status === "REQUIRES_REVIEW" && p.result_code === "IA_RECEIPT_COUNT_MISMATCH" && p.needCall === "NO", "I3 plan: " + label + " -> REQUIRES_REVIEW IA_RECEIPT_COUNT_MISMATCH, op 2 not called", p.result_message);
  }
  p = commitI3Plan(e({ i2Called: "NO" }), rowsOf(c, "ENGINE_R"), out(0, "0"), [{ intents: 0, review: 0, done_summary: null }]);
  ok(p.route === "GO" && p.price === 1.25, "I3 plan: no op 1 call (no stock pick) -> the assembly cost only");
  ok(commitI3Plan(e({ batchId: "" }), rowsOf(c, "ENGINE_R"), out(12, "1"), op1(12)).job_status === "REQUIRES_REVIEW", "I3 plan: a batch parent without I1's batch_id -> REQUIRES_REVIEW");
  ok(commitI3Plan(e(), [], out(12, "1"), op1(12)).job_status === "REQUIRES_REVIEW", "I3 plan: no ENGINE_R part -> REQUIRES_REVIEW");
  const nb = X.makeCase({});
  p = commitI3Plan(entryOf(nb, { phase: "B", i2Called: "YES", i2DoneAt: "2026-10-20 09:50:00" }), rowsOf(nb, "ENGINE_R"), out(12, "10"), op1(12));
  ok(p.movements[0].batch_id === null, "I3 plan: a non-batch parent's R1 keeps batch_id null");
  const plan = { price: want, outCount: 12, outTotal: "49.12340000" };
  ok(J(commitI3Ans({ needCall: "YES" }, { code: "200", result_code: "OK", results: [{ movement_key: "R1", code: "200", unit_price: 2.8875 }] })) === J({ code: "200", result_code: "OK", message: "", r1Code: "200",
    r1Message: "", r1Key: "R1", r1Price: "2.8875", needOps: "NO" }), "I3 answer: R1's code");
  ok(commitI3Ans({ needCall: "YES" }, { code: "200", results: J([{ movement_key: "R1", code: "401" }]) }).r1Code === "401" && commitI3Ans({ needCall: "YES" }, {}).needOps === "YES", "I3 answer: results as text; no answer -> transient");
  let r = commitI3(e(), plan, { code: "200", result_code: "OK", r1Code: "200" }, null);
  ok(r.route === "OK" && r.needProgress === "YES" && r.progressRows[0].progress_percent === 80 && r.progressRows[0].progress_message === "Assembled item received; finishing"
    && JSON.parse(r.stepRows[0].result_ref).unit_price === want, "I3: 200 + R1 200 -> DONE + progress 80", r);
  r = commitI3(e(), plan, { code: "200", result_code: "REPLAYED", r1Code: "200" }, null);
  ok(r.route === "OK", "I3: REPLAYED -> DONE");
  r = commitI3(e(), plan, { code: "200", result_code: "OK", r1Code: "401", r1Message: "Skipping" }, null);
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RECEIPT_REFUSED" && r.needUnlock === "NO", "I3: R1 401 -> REQUIRES_REVIEW IA_RECEIPT_REFUSED (never Completed without a receipt)");
  // ruling 10 R4: the 30-minute window starts at I3's FIRST transient answer (error_details.waitFrom), not at I2 DONE
  r = commitI3(e(), plan, { code: "409", result_code: "LOCK_BUSY" }, { intents: 0 });
  ok(r.job_status === "COMMITTING_IA" && r.result_code === "IA_WAIT" && r.jobRows[0].attempt_count === 0 && r.jobRows[0].next_attempt_at === "2026-10-20 10:00:10" && r.jobRows[0].progress_percent === 75
    && JSON.parse(r.jobRows[0].error_details).waitFrom === DB_NOW && JSON.parse(r.jobRows[0].error_details).step === "I3_RECEIPT", "I3: a first 409 -> wait 10 s, not counted, progress 75, the window starts now", r.jobRows[0]);
  r = commitI3(e({ i2DoneAt: "2026-10-20 03:59:00" }), plan, { code: "", result_code: "" }, { intents: 1 });
  ok(r.result_code === "IA_WAIT" && JSON.parse(r.jobRows[0].error_details).waitFrom === DB_NOW, "I3: a late first kick 6 hours after I2 DONE -> still a wait (the window starts at this first answer)", r.jobRows[0]);
  r = commitI3(e({ waitFrom: "2026-10-20 09:29:59" }), plan, { code: "", result_code: "" }, { intents: 1 });
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RECEIPT_TIMEOUT" && JSON.parse(r.jobRows[0].error_details).intents === 1 && JSON.parse(r.jobRows[0].error_details).waitFrom === "2026-10-20 09:29:59",
    "I3: no answer 1,801 s after the first wait -> REQUIRES_REVIEW IA_RECEIPT_TIMEOUT", r.jobRows[0]);
  r = commitI3(e({ waitFrom: "2026-10-20 09:30:00" }), plan, { code: "409" }, { intents: 0 });
  ok(r.result_code === "IA_WAIT" && JSON.parse(r.jobRows[0].error_details).waitFrom === "2026-10-20 09:30:00", "I3: exactly 1,800 s -> still a wait, the window kept", r.jobRows[0]);
  r = commitI3(e({ waitFrom: "2026-10-20 10:30:00" }), plan, { code: "409" }, {});
  ok(r.result_code === "IA_WAIT" && JSON.parse(r.jobRows[0].error_details).waitFrom === DB_NOW, "I3: a window start in the future (corrupt) -> a fresh window", r.jobRows[0]);
  ok(commitI3(e(), plan, { code: "400", result_code: "UNSUPPORTED_PRICE" }, null).result_code === "IA_RECEIPT_REFUSED" && commitI3(e(), plan, { code: "500", result_code: "REQUIRES_REVIEW" }, null).result_code === "IA_RECEIPT_REFUSED",
    "I3: 400 with a code / 500 -> REQUIRES_REVIEW IA_RECEIPT_REFUSED");
  ok(commitI3(e(), plan, { code: 400, msg: "envelope" }, null).result_code === "IA_WAIT", "I3: the envelope (400 without a code) -> wait");
}

// ------------------------------------------------------------------ I1 / I3: the IA output split (plan 10-27): a Batch row per group, one receipt per row
{
  const { commitI1Decide } = L("code_node_IACi1decide", ["commitI1Decide"]);
  const { commitI1Check } = L("code_node_IACi1check", ["commitI1Check"]);
  const { commitI1Ans } = L("code_node_IACi1ans", ["commitI1Ans"]);
  const { commitI1 } = L("code_node_IACi1", ["commitI1"]);
  const { commitI3Plan } = L("code_node_IACi3plan", ["commitI3Plan"]);
  const { commitI3Ans } = L("code_node_IACi3ans", ["commitI3Ans"]);
  const B1 = "1016-005-0003";
  const B2 = "1016-005-0004";
  const c = X.makeCase({ batch: true, itemQty: 10, split: [{ qty: 5, bin: X.BIN0, number: B1 }, { qty: 3, bin: "2113000000000000611", number: B1 },
    { qty: 2, bin: "2113000000000000612", cat: "Blocked", number: B2 }] });
  const e = (p) => entryOf(c, p);
  const idt = (n) => ({ batch_number: n, material_id: PARENT, plant_id: PLANT, organization_id: ORG, transaction_no: IANO });
  const row = (id, n, o) => batchRow(id, Object.assign({ batch_number: n }, o || {}));
  let d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  ok(d.route === "GO" && d.needIntent === "YES" && d.needInsert === "YES" && J(JSON.parse(d.intentRows[0].result_ref)) === J([idt(B1), idt(B2)]) &&
    J(d.insertRows.map((r) => [r.batch_number, r.initial_quantity])) === J([[B1, "8.00000000"], [B2, "2.00000000"]]), "split I1 decide: the intent = both identities, one row per group", d);
  d = commitI1Decide(e({ hasIntent: "YES", intent: [idt(B1), idt(B2)] }), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), [row("2113000000000000008", B1)]);
  ok(d.route === "GO" && d.needIntent === "NO" && J(d.insertRows.map((r) => r.batch_number)) === J([B2]) && J(d.ours) === J(["2113000000000000008"]),
    "split I1 decide: an earlier pass inserted group 1's row -> adopt it, insert group 2's only", d);
  d = commitI1Decide(e({ hasIntent: "YES", intent: [idt(B1), idt(B2)] }), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), [row("2113000000000000008", B1), row("2113000000000000009", B2)]);
  ok(d.route === "GO" && d.needInsert === "NO" && J(d.ours.slice().sort()) === J(["2113000000000000008", "2113000000000000009"]), "split I1 decide: both adopted -> nothing to insert", d);
  d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), [row("2111000000000000001", B2)]);
  ok(d.job_status === "FAILED" && d.result_code === "IA_BATCH_DUPLICATE" && /1016-005-0004/.test(d.result_message), "split I1 decide: group 2's number held by another row -> FAILED IA_BATCH_DUPLICATE", d);
  d = commitI1Decide(e({ hasIntent: "YES", intent: [idt(B1)] }), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  ok(d.job_status === "REQUIRES_REVIEW", "split I1 decide: an intent naming other rows -> REQUIRES_REVIEW", d);
  // each naming rule on its own: R2 names a batch nobody planned (B1 and B2 still taken); every receipt on B1 (B2 planned, taken by none)
  const engOf = (batchOf) => X.partRows(JOB, "ENGINE_R", Object.assign({}, c.parts.ENGINE_R, { batchOf: batchOf }));
  d = commitI1Decide(e(), rowsOf(c, "BATCH"), engOf({ R1: B1, R2: "X-1", R3: B2 }), []);
  ok(d.result_code === "IA_INVALID_DATA" && J(d).indexOf("a receipt names a batch the BATCH part does not plan") >= 0 && J(d).indexOf("that no receipt takes") < 0,
    "split I1 decide: a receipt naming a batch the BATCH part lacks -> FAILED (that rule)", d);
  d = commitI1Decide(e(), rowsOf(c, "BATCH"), engOf({ R1: B1, R2: B1, R3: B1 }), []);
  ok(d.result_code === "IA_INVALID_DATA" && J(d).indexOf("a planned Batch row that no receipt takes") >= 0 && J(d).indexOf("does not plan") < 0,
    "split I1 decide: a planned Batch row no receipt takes -> FAILED (that rule)", d);
  d = commitI1Decide(e(), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []);
  let k = commitI1Check(e(), d, [row("2113000000000000008", B1), row("2113000000000000009", B2)]);
  ok(k.route === "GO" && k.needPlan === "YES" && J(k.planMovements.map((m) => [m.movement_key, m.batch_id, m.unit_price, m.location_id])) ===
    J([["R1", "2113000000000000008", 0, X.BIN0], ["R2", "2113000000000000008", 0, "2113000000000000611"], ["R3", "2113000000000000009", 0, "2113000000000000612"]]) &&
    J(k.keys) === J(["R1", "R2", "R3"]) && J(k.batchIds) === J({ [B1.toLowerCase()]: "2113000000000000008", [B2.toLowerCase()]: "2113000000000000009" }),
  "split I1 check: both read back -> the re-PLAN of R1..R3, each with its group's batch_id", k);
  k = commitI1Check(e(), d, [row("2113000000000000008", B1)]);
  ok(k.result_code === "IA_STEP_RETRY", "split I1 check: group 2's row not read back -> retry", k);
  k = commitI1Check(e(), d, [row("2113000000000000008", B1), row("2113000000000000009", B2), row("2113000000000000010", B2)]);
  ok(k.job_status === "FAILED" && k.batchDelRows.length === 3, "split I1 check: group 2 inserted twice -> FAILED, all three removed", k);
  const chk = commitI1Check(e(), d, [row("2113000000000000008", B1), row("2113000000000000009", B2)]);
  const ans = (results) => commitI1Ans({ needPlan: "YES", keys: ["R1", "R2", "R3"] }, { code: "200", result_code: "OK", results: results });
  ok(ans([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "200" }, { movement_key: "R3", code: "200" }]).r1Code === "200", "split I1 answer: every receipt 200 -> 200");
  ok(ans([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "401", message: "no" }, { movement_key: "R3", code: "200" }]).r1Code === "401", "split I1 answer: R2 401 -> 401");
  ok(ans([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "200" }]).r1Code === "", "split I1 answer: R3 missing -> no code");
  let r = commitI1(e(), chk, { code: "200", result_code: "OK", r1Code: "200" }, []);
  ok(r.route === "OK" && J(JSON.parse(r.stepRows[0].result_ref).batch_ids) === J({ [B1.toLowerCase()]: "2113000000000000008", [B2.toLowerCase()]: "2113000000000000009" }) &&
    J(r.batchIds) === J(JSON.parse(r.stepRows[0].result_ref).batch_ids), "split I1: DONE with every group's batch id", r);
  r = commitI1(e(), chk, { code: "200", result_code: "OK", r1Code: "401", r1Message: "Skipping" }, []);
  ok(r.job_status === "FAILED" && r.batchDelRows.length === 2, "split I1: a receipt refused -> FAILED, both Batch rows removed", r);
  // I3: one price, every receipt with it and its group's batch id
  const e3 = (p) => entryOf(c, Object.assign({ phase: "B", progress: 75, batchId: "2113000000000000008", batchIds: { [B1.toLowerCase()]: "2113000000000000008", [B2.toLowerCase()]: "2113000000000000009" },
    i2DoneAt: "2026-10-20 09:50:00", i2Called: "YES", unlockOk: "NO" }, p || {}));
  const op1 = [{ intents: 1, review: 0, done_summary: J({ movements: 12, skipped: 0 }) }];
  const p = commitI3Plan(e3(), rowsOf(c, "ENGINE_R"), [{ n: 12, total: "40.00000000" }], op1);
  const price = X.C.iaQ8(40 / 10 + 1.25);
  ok(p.route === "GO" && p.needCall === "YES" && J(p.movements.map((m) => [m.movement_key, m.unit_price, m.batch_id, m.quantity])) ===
    J([["R1", price, "2113000000000000008", 5], ["R2", price, "2113000000000000008", 3], ["R3", price, "2113000000000000009", 2]]), "split I3 plan: one price over the whole output, each receipt its batch", p);
  ok(commitI3Plan(e3({ batchIds: { [B1.toLowerCase()]: "2113000000000000008" } }), rowsOf(c, "ENGINE_R"), [{ n: 12, total: "40" }], op1).job_status === "REQUIRES_REVIEW",
    "split I3 plan: a group without its I1 batch id -> REQUIRES_REVIEW");
  const a3 = (results) => commitI3Ans({ needCall: "YES", keys: ["R1", "R2", "R3"] }, { code: "200", result_code: "OK", results: results });
  ok(a3([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "200" }, { movement_key: "R3", code: "200" }]).r1Code === "200" &&
    a3([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "200" }, { movement_key: "R3", code: "401" }]).r1Code === "401" &&
    a3([{ movement_key: "R1", code: "200" }]).r1Code === "", "split I3 answer: every receipt 200 / one refused / one missing");
  // a non-batch split: I3 receipts without batch ids, no I1
  const nb = X.makeCase({ itemQty: 4, split: [{ qty: 3, bin: X.BIN0 }, { qty: 1, bin: "2113000000000000611" }] });
  const pn = commitI3Plan(entryOf(nb, { phase: "B", i2Called: "YES", i2DoneAt: "2026-10-20 09:50:00" }), rowsOf(nb, "ENGINE_R"), [{ n: 12, total: "8" }], op1);
  ok(pn.route === "GO" && J(pn.movements.map((m) => [m.movement_key, m.batch_id, m.quantity])) === J([["R1", null, 3], ["R2", null, 1]]), "split I3 plan (non-batch): R1 / R2, no batch", pn);
  // review 10-27 (1): the I1 intent holds every group's identity - 20 groups (the split's row cap) stored whole and read back by the entry
  const many = X.makeCase({ batch: true, itemQty: 20, split: Array.from({ length: 20 }, (_, i) => ({ qty: 1, bin: String(2113000000000000700n + BigInt(i)),
    number: "1016-005-" + String(100 + i).padStart(4, "0") })) });
  const dm = commitI1Decide(entryOf(many), rowsOf(many, "BATCH"), rowsOf(many, "ENGINE_R"), []);
  const refOf = (x) => (x.intentRows[0] || {}).result_ref || "";
  let back = null;
  try {
    back = JSON.parse(refOf(dm));
  } catch (x) {
    back = null;
  }
  ok(dm.needIntent === "YES" && Array.isArray(back) && back.length === 20 && back[19].batch_number === "1016-005-0119",
    "split I1 decide: 20 groups -> the whole intent stored (" + refOf(dm).length + " characters)", refOf(dm).slice(-80));
  const { commitEntry } = L("code_node_IACentry", ["commitEntry"]);
  const jobRows = [{ db_now: DB_NOW, lease_until: "2026-10-20 10:10:00", id: JOB, organization_id: ORG, command: "COMPLETE_IA", job_status: "COMMITTING_IA", progress_percent: 70, attempt_count: 0,
    row_version: 5, idempotency_key: KEY, correlation_id: "IA|" + IAID, is_deleted: 0, lease_owner: "", lease_live: 0, due: 1, prev_status: "Draft", req_action: "DIRECT" }];
  const iaRows = [{ ia_id: IAID, item_assembly_status: "Processing", ia_v2_job_id: JOB, stock_movement_no: IANO, item_id: PARENT, lock_ref: KEY }];
  const en = commitEntry(guard, jobRows, [], [{ step_name: "I1|I|001", step_status: "INTENT", result_ref: refOf(dm) }], [{ prepared_payload: J(many.manifest) }], iaRows);
  ok(en.hasIntent === "YES" && Array.isArray(en.intent) && en.intent.length === 20, "entry: a 20-group intent reads back whole (hasIntent YES)", { hasIntent: en.hasIntent, route: en.route });
  // review 10-27 (3): a refused receipt is named by its own key and row, not R1's
  const labRows = rowsOf(c, "LABELS");
  const ans3 = ans([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "200" }, { movement_key: "R3", code: "401", message: "Skipping: not stock controlled" }]);
  r = commitI1(e(), chk, ans3, labRows);
  const msgOf = (x) => ((x.jobRows || [])[0] || {}).error_message || "";
  ok(r.job_status === "FAILED" && /into bin FG-3/.test(msgOf(r)) && !/FG-1\b/.test(msgOf(r)) && /R3 401/.test(r.result_message), "split I1: R3 refused -> the message names R3's row",
    [msgOf(r), r.result_message]);
  r = commitI1(e(), chk, { code: "400", result_code: "INSUFFICIENT", message: "movements[2] Insufficient quantity" }, labRows);
  ok(r.job_status === "FAILED" && /into bin FG-3/.test(msgOf(r)), "split I1: a 400 naming movements[2] -> R3's row", msgOf(r));
  const { commitI3 } = L("code_node_IACi3", ["commitI3"]);
  const a33 = a3([{ movement_key: "R1", code: "200" }, { movement_key: "R2", code: "200" }, { movement_key: "R3", code: "401", message: "Skipping" }]);
  r = commitI3(e3(), p, a33, null);
  ok(r.job_status === "REQUIRES_REVIEW" && /R3 answered 401/.test(J(r)) && !/R1 answered/.test(J(r)), "split I3: R3 refused -> the review names R3", J(r).slice(0, 300));
}

// ------------------------------------------------------------------ I4
{
  const { commitI4Plan } = L("code_node_IACi4plan", ["commitI4Plan"]);
  const { commitI4Check } = L("code_node_IACi4check", ["commitI4Check"]);
  const c = X.makeCase({ nonStock: 3 });
  const e = (p) => entryOf(c, Object.assign({ phase: "B", progress: 75, unlockOk: "NO" }, p || {}));
  const own = (p) => [Object.assign({ db_now: DB_NOW, ia_id: IAID, item_assembly_status: "Processing", ia_v2_job_id: JOB, stock_movement_no: IANO, lock_ref: KEY, lock_step: "LOCK|1" }, p || {})];
  let r = commitI4Plan(e(), rowsOf(c, "ITEMS"), own());
  const ids = r.itemSlices.reduce((a, sl) => a.concat(sl.rows.map((x) => x.id)), []);
  ok(r.route === "GO" && r.needStatus === "YES" && J(r.statusRows) === J([{ id: IAID, item_assembly_status: "Completed", posted_status: "Unposted" }]) && J(ids) === J(c.itemIds)
    && new Set(r.itemSlices.reduce((a, sl) => a.concat(sl.rows.map((x) => x.last_transaction_date)), [])).size === 1, "I4 plan: Processing -> item dates (one stamp, parent first, non-stock included) + Completed / Unposted", r);
  const many = X.makeCase({ lines: 600, picks: 1, nonStock: 0 });
  r = commitI4Plan(entryOf(many, { phase: "B" }), rowsOf(many, "ITEMS"), own());
  ok(r.itemSlices.length === 3 && r.itemSlices.every((sl) => sl.rows.length <= 250) && r.itemCount === 601, "I4 plan: slices of <= 250 (601 items)", r.itemSlices.map((sl) => sl.rows.length));
  r = commitI4Plan(e(), rowsOf(c, "ITEMS"), own({ item_assembly_status: "Completed" }));
  ok(r.route === "GO" && r.needStatus === "NO" && r.itemSlices.length === 0, "I4 plan: already Completed under this job -> nothing written again");
  for (const [label, p] of [["Draft", { item_assembly_status: "Draft" }], ["deleted", { ia_id: null, item_assembly_status: null, ia_v2_job_id: null }], ["another job's", { ia_v2_job_id: "2" }],
    ["another key's lock", { lock_ref: "k" }]]) {
    r = commitI4Plan(e(), rowsOf(c, "ITEMS"), own(p));
    ok(r.job_status === "REQUIRES_REVIEW" && r.needStatus === "NO" && r.jobRows[0].progress_percent === 0, "I4 plan: " + label + " -> REQUIRES_REVIEW, nothing written", r.result_message);
  }
  r = commitI4Check(e(), own({ item_assembly_status: "Completed" }));
  ok(r.route === "OK" && r.stepRows[0].step_name === "I4_FINISH", "I4 check: Completed -> DONE");
  r = commitI4Check(e(), own());
  ok(r.result_code === "IA_STEP_RETRY" && r.jobRows[0].progress_percent === 85, "I4 check: still Processing -> retry at 85 (I3 is done)", r.jobRows[0]);
}

// ------------------------------------------------------------------ declared output types (the platform keeps the declared keys; a number declared string would concatenate)
{
  const declared = {};
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "code-node") declared[n.id] = n.data.response_json; Object.values(n).forEach(walk); } };
  walk(doc);
  const check = (id, out) => {
    const bad = declared[id].filter((r) => out[r.name] !== undefined && out[r.name] !== null && (r.bsonType === "array" ? !Array.isArray(out[r.name]) : r.bsonType === "string" ? typeof out[r.name] !== "string" : false));
    const miss = Object.keys(out).filter((k) => !declared[id].some((r) => r.name === k));
    ok(!bad.length, id + ": every produced value matches its declared type", bad.map((r) => [r.name, r.bsonType, typeof out[r.name]]));
    return miss;
  };
  const c = X.makeCase({ batch: true });
  const { commitEntry } = L("code_node_IACentry", ["commitEntry"]);
  const e = commitEntry(guard, [{ db_now: DB_NOW, lease_until: "2026-10-20 10:10:00", id: JOB, organization_id: ORG, command: "COMPLETE_IA", job_status: "READY_TO_COMMIT", attempt_count: 0, row_version: 5,
    idempotency_key: KEY, correlation_id: "IA|" + IAID, is_deleted: 0, lease_live: 1, due: 1, prev_status: "Draft", req_action: "DIRECT" }], [], [], [{ prepared_payload: J(c.manifest) }],
  [{ ia_id: IAID, item_assembly_status: "Processing", ia_v2_job_id: JOB, stock_movement_no: IANO, item_id: PARENT, lock_ref: KEY }]);
  check("code_node_IACentry", e);
  const { commitI1Decide } = L("code_node_IACi1decide", ["commitI1Decide"]);
  check("code_node_IACi1decide", commitI1Decide(entryOf(c), rowsOf(c, "BATCH"), rowsOf(c, "ENGINE_R"), []));
  const { commitI3Plan } = L("code_node_IACi3plan", ["commitI3Plan"]);
  check("code_node_IACi3plan", commitI3Plan(entryOf(c, { phase: "B", batchId: "2113000000000000008", i2Called: "YES" }), rowsOf(c, "ENGINE_R"), [{ n: 12, total: "10" }],
    [{ intents: 1, review: 0, done_summary: J({ movements: 12 }) }]));
  const { commitI2In } = L("code_node_IACi2in", ["commitI2In"]);
  check("code_node_IACi2in", commitI2In(entryOf(c), rowsOf(c, "ENGINE_I")));
}

console.log(fails ? fails + " FAILED, " + passes + " passed" : "all " + passes + " step checks passed");
process.exit(fails ? 1 : 0);
