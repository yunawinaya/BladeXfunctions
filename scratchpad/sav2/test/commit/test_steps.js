// node test/commit/test_steps.js - unit tests of every SA_V2_COMMIT step decision (and the worker's release rule) on crafted
// inputs: each step function is loaded from the BUILT JSON node (exactly what ships), no database. Rule under test, per step:
// rows at the before-value -> write; at the after-value -> done (nothing written); anything else -> FAILED + unlock (phase A,
// nothing moved) or REQUIRES_REVIEW (phase B / a conflict).
const X = require("./fixture.js");
const { F, C, JOB, SAID, SCID, ORG, NONCE, KEY } = X;
let fails = 0, passes = 0;
const ok = (cond, what, extra) => { if (cond) passes++; else { fails++; console.log("FAIL", what, extra === undefined ? "" : JSON.stringify(extra).slice(0, 700)); } };
const L = (id, names) => X.loadNode("SA_V2_COMMIT", id, names);
const J = (o) => JSON.stringify(o);
const DB_NOW = "2026-10-16 10:00:00";
const guard = { route: "CONTINUE", jobId: JOB, tenantId: "000000", nonce: "00ff00ff00ff00ff00ff00ff", leaseOwner: "PUB|00ff00ff00ff00ff00ff00ff" };
const rowsOf = (c, name) => c.partStepRows.filter((r) => r.step_name.indexOf("P|" + NONCE + "|" + name + "|") === 0);
// a stored row as the platform keeps it: unit_price at the tenant's 2 dp, the decimals of a Stock Count line at 3 dp
const stored2 = (l) => Object.assign({}, l, { unit_price: Number((parseFloat(l.unit_price) || 0).toFixed(2)) });
const sc3 = (l) => Object.assign({}, l, { count_qty: l.count_qty === null ? null : Number(Number(l.count_qty).toFixed(3)) });

function entryOf(c, patch) {
  return Object.assign({ jobId: JOB, tenantId: "000000", organizationId: ORG, saId: SAID, saNo: c.header.adjustment_no, scId: c.manifest.sc_id || "0", action: c.kind, source: c.source,
    prevStatus: c.manifest.prevStatus, lineFingerprint: c.lineFp, incomingFingerprint: c.incomingFp, scFingerprint: c.manifest.scFingerprint, scAfterFingerprint: c.manifest.scAfterFingerprint,
    entryCount: c.movements.length, idempotencyKey: KEY, dbNow: DB_NOW, attempts: 0, rowVersion: 5, leaseUntil: "2026-10-16 10:10:00", unlockOk: "YES", partPrefix: "P|" + NONCE + "|",
    doneReorder: "NO" }, patch || {});
}

// ------------------------------------------------------------------ built JSON: the lists and the write nodes
{
  const doc = X.built("SA_V2_COMMIT");
  const code = (id) => X.nodeById(doc, id).data.script.code;
  const listIn = (id, name) => { const m = code(id).match(new RegExp("const " + name + " = (\\[[^\\]]*\\]);")); return m ? JSON.parse(m[1]) : null; };
  ok(J(listIn("code_node_SACa1plan", "SA_HDR")) === J(X.SA_HDR) && J(listIn("code_node_SACa1plan", "SA_LINE_COLS")) === J(X.SA_LINE_COLS),
    "built A1 carries the header props and the 19 line columns of the fixture");
  ok(J(listIn("code_node_SACa3rplan", "SC_PROPS")) === J(X.SC_PROPS), "built A3 carries update_node_sc's props minus the number props");
  const props = (id) => X.nodeById(doc, id).data.props.list.map((p) => p.prop);
  ok(J(props("update_node_SACa1full")) === J(["id"].concat(X.SA_HDR, ["stock_adjustment"])), "A1 COMPLETE write: id + header props + the subform", props("update_node_SACa1full"));
  ok(J(props("update_node_SACa1lines")) === J(["id", "stock_adjustment"]), "A1 REVIEW write: id + the subform only (no header prop NULLed)");
  for (const id of ["update_node_SACa1full", "update_node_SACa1lines"]) ok(["adjustment_no", "adjustment_no_type", "stock_adjustment_status"].every((k) => props(id).indexOf(k) < 0), id + " never writes the number / status");
  ok(J(props("update_node_SACa3rwrite")) === J(X.SC_PROPS) && props("update_node_SACa3rwrite").indexOf("stock_count_no") < 0, "A3 REVIEW write: the SC part's props, never the number");
  ok(J(props("update_node_SACa3lwrite")) === J(["id", "line_status"]) && /Adjustment Details\(Stock Count\):Table:1978655864896823297/.test(J(X.nodeById(doc, "update_node_SACa3lwrite").data.table_id)),
    "A3 PARITY: SC lines by id (line_status) on the sub-table");
  ok(J(props("update_node_SACa4status")) === J(["id", "stock_adjustment_status"]), "A4: status only");
  const unl = ["update_node_SACefunlock", "update_node_SACa0unlock", "update_node_SACa1plunlock", "update_node_SACa1unlock", "update_node_SACa2unlock"];
  ok(unl.every((id) => J(props(id)) === J(["id", "stock_adjustment_status"])), "every COMMIT unlock writes { id, stock_adjustment_status } only");
  const eng = X.nodeById(doc, "workflow_node_SACa2").data;
  ok(eng.workflow.source === "INVENTORY_BULK_APPLY:Workflow:2109916822821744641" && J(eng.body_params.list.map((p) => [p.prop, p.valueType === "value" ? p.value : "ref"])) === J([["operation_key", "ref"], ["mode", "APPLY"], ["organization_id", "ref"], ["movements", "ref"]]),
    "A2 calls INVENTORY_BULK_APPLY APPLY");
  const gateR = X.nodeById(doc, "cor_SACa4reorder").blocks[0].blocks.map((n) => n.id);
  const reo = X.nodeById(doc, "workflow_node_SACa4reorder").data;
  ok(J(gateR) === J(["add_node_SACa4marker", "workflow_node_SACa4reorder"]), "A4: the marker row is inserted BEFORE the reorder call", gateR);
  ok(reo.workflow.source === "REORDER_SET_REDIS:Workflow:2065256261729759233" && J(reo.body_params.list.map((p) => [p.prop, p.valueType === "value" ? p.value : "ref"])) === J([["document_type", "SA_COMPLETED"], ["latest_data", "ref"], ["organization_id", "ref"]]),
    "A4 calls REORDER_SET_REDIS SA_COMPLETED with organization_id");
  const a1blk = X.nodeById(doc, "ifBlock_TSACa1").blocks.map((n) => n.id);
  ok(a1blk.indexOf("cor_SACa1try") > a1blk.indexOf("if_SACa1plend") && a1blk.indexOf("cor_SACa1try") < a1blk.indexOf("cor_SACa1full") && a1blk.indexOf("cor_SACa1full") < a1blk.indexOf("cor_SACa1lines"),
    "A1: the A1_TRY marker gate sits between the plan's exit and the writes", a1blk);
  const errSql = X.nodeById(doc, "sql_node_SACa1err").data.script.code;
  ok(/FROM su_code_workflow_inst i/.test(errSql) && ["update_node_SACa1full", "update_node_SACa1lines"].every((id) => errSql.indexOf("'" + id + "'") >= 0 && X.nodeById(doc, id).type === "update-node"),
    "A1 error read: su_code_workflow_inst, current_node_id = the two A1 write nodes that exist");
  const steps = X.nodeById(doc, "sql_node_SACsteps").data.script.code;
  ok(/REGEXP '\^A\[0-9\]_'/.test(steps), "step SQL REGEXP '^A[0-9]_'");
  const cmp = require("fs").readFileSync(require("path").join(__dirname, "../../tpl/smv2/code/commit/_cmp.js"), "utf8").trimEnd();
  const withCmp = [];
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "code-node" && /const sameVal = /.test(n.data.script.code)) withCmp.push(n.data.script.code); Object.values(n).forEach(walk); } };
  walk(doc);
  ok(withCmp.length > 10 && withCmp.every((s) => s.indexOf(cmp) >= 0), "every sameVal in the built COMMIT is tpl's _cmp.js (f8's 16+ digit fix), " + withCmp.length + " nodes");
}

// ------------------------------------------------------------------ entry
{
  const { commitEntry } = L("code_node_SACentry", ["commitEntry"]);
  const mk = (kind, o) => {
    const c = X.makeCase(kind, o);
    const job = (p) => [Object.assign({ db_now: DB_NOW, lease_until: "2026-10-16 10:10:00", id: JOB, organization_id: ORG, command: "COMPLETE_SA", job_status: "READY_TO_COMMIT", progress_percent: 60,
      attempt_count: 0, row_version: 5, idempotency_key: KEY, correlation_id: "SA|" + SAID, is_deleted: 0, lease_owner: "WRK|abc", lease_live: 1, due: 1, prev_status: c.request.prevStatus,
      req_action: c.kind, req_source: c.source, req_edited: String(c.request.edited), req_sc_id: c.request.scId }, p || {})];
    const pay = (m) => [{ prepared_payload: J(m || c.manifest) }];
    const sa = (p) => [Object.assign({ sa_id: SAID, stock_adjustment_status: "Processing", sa_v2_job_id: JOB, adjustment_no: "SA/1", lock_ref: KEY }, p || {})];
    return { c, job, pay, sa };
  };
  let t = mk("COMPLETE");
  let r = commitEntry(guard, t.job(), [], t.pay(), t.sa());
  ok(r.route === "GO" && r.phase === "A" && r.needA0 === "YES" && r.needA1 === "YES" && r.needA2 === "YES" && r.needA3P === "NO" && r.needA4 === "NO" && r.unlockOk === "YES"
    && r.partPrefix === "P|abcd1234|" && r.scId === SCID && r.a0ScId === "0" && r.entryCount === t.c.movements.length, "entry COMPLETE phase A (A0 reads no Stock Count)", r);
  ok(r.jobRows[0].job_status === "COMMITTING_SA" && r.jobRows[0].lease_owner === guard.leaseOwner && r.jobRows[0].row_version === 6 && r.jobRows[0].progress_percent === 70, "entry lease claim row", r.jobRows);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "SPLIT|x", progress_percent: 80 }), [{ step_name: "A0_REVALIDATE", step_status: "DONE" }, { step_name: "A1_SA_LINES", step_status: "DONE" },
    { step_name: "A2_INVENTORY", step_status: "DONE" }], t.pay(), t.sa());
  ok(r.route === "GO" && r.phase === "B" && r.needA3P === "YES" && r.needA3R === "NO" && r.needA4 === "YES" && r.unlockOk === "NO" && r.jobRows[0].progress_percent === 85, "entry phase B (FORM + stock_count_id: PARITY)", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "PUB|old", lease_live: 0 }), [{ step_name: "A0_REVALIDATE", step_status: "DONE" }], t.pay(), t.sa());
  ok(r.route === "GO" && r.phase === "A" && r.needA0 === "NO" && r.needA1 === "YES" && r.triedA1 === "NO", "entry resume after A0: A1 next", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "PUB|old", lease_live: 0 }), [{ step_name: "A0_REVALIDATE", step_status: "DONE" }, { step_name: "A1_TRY", step_status: "TRY" }], t.pay(), t.sa());
  ok(r.route === "GO" && r.needA1 === "YES" && r.triedA1 === "YES", "entry: an A1_TRY row -> triedA1 (A1 reads the platform's error)", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "PUB|old", lease_live: 1 }), [], t.pay(), t.sa());
  ok(r.route === "NO_WRITE" && r.result_code === "JOB_ROW_VERSION_CONFLICT", "entry: a live foreign lease -> no write", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: null, lease_live: 0, due: 0, next_attempt_at: "2026-10-16 10:05:00" }), [], t.pay(), t.sa());
  ok(r.route === "NO_WRITE" && r.result_code === "" && /backoff/.test(r.result_message), "entry: not due -> no write", r);
  r = commitEntry(guard, t.job({ job_status: "COMPLETED" }), [], t.pay(), t.sa());
  ok(r.route === "NO_WRITE" && r.result_code === "", "entry: COMPLETED -> answer only", r);
  r = commitEntry(guard, t.job({ job_status: "FAILED" }), [], t.pay(), t.sa());
  ok(r.route === "NO_WRITE" && r.result_code === "JOB_ILLEGAL_TRANSITION", "entry: FAILED -> JOB_ILLEGAL_TRANSITION", r);
  r = commitEntry(guard, t.job(), [], [{ prepared_payload: "{bad" }], t.sa());
  ok(r.route === "FAIL" && r.result_code === "SA_INVALID_DATA" && r.needUnlock === "YES" && J(r.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Draft" }]) && r.jobRows[0].job_status === "FAILED",
    "entry: bad manifest before A2 -> FAILED + back to Draft", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "SPLIT|x" }), [{ step_name: "A2_INVENTORY", step_status: "DONE" }], [{ prepared_payload: "{bad" }], t.sa());
  ok(r.route === "REVIEW" && r.jobRows[0].job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "entry: bad manifest after A2 -> REQUIRES_REVIEW, no unlock", r);
  r = commitEntry(guard, t.job(), [], t.pay(), t.sa({ stock_adjustment_status: "Draft" }));
  ok(r.route === "FAIL" && r.result_code === "SA_NOT_LOCKED" && r.needUnlock === "NO" && r.jobRows[0].job_status === "FAILED", "entry: lock lost before A2 -> FAILED, no unlock", r);
  r = commitEntry(guard, t.job(), [], t.pay(), t.sa({ lock_ref: "another-key" }));
  ok(r.route === "FAIL" && r.result_code === "SA_NOT_LOCKED", "entry: latest SAC lock is another job's -> FAILED", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "SPLIT|x" }), [{ step_name: "A2_INVENTORY", step_status: "DONE" }], t.pay(), t.sa({ sa_v2_job_id: "999" }));
  ok(r.route === "REVIEW" && r.jobRows[0].error_code === "SA_RECONCILIATION_MISMATCH", "entry: lock lost after A2 -> REQUIRES_REVIEW", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "SPLIT|x" }), [{ step_name: "A2_INVENTORY", step_status: "DONE" }, { step_name: "A4_REORDER", step_status: "DONE" }],
    t.pay(), t.sa({ stock_adjustment_status: "Completed" }));
  ok(r.route === "GO" && r.phase === "B" && r.doneReorder === "YES", "entry: Completed after A2 is still ours; A4_REORDER recorded -> doneReorder", r);
  r = commitEntry(guard, t.job({ prev_status: "In Progress" }), [], [{ prepared_payload: "{bad" }], t.sa());
  ok(r.route === "FAIL" && r.jobRows[0].job_status === "REQUIRES_REVIEW" && r.result_code === "SA_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO", "entry: prevStatus unknown -> REQUIRES_REVIEW, no unlock", r);
  const noSal = JSON.parse(J(t.c.manifest));
  delete noSal.parts.SALINES;
  r = commitEntry(guard, t.job(), [], t.pay(noSal), t.sa());
  ok(r.route === "FAIL" && /SALINES/.test(r.result_message), "entry: edited COMPLETE without SALINES -> FAILED", r.result_message);
  const noSc = JSON.parse(J(t.c.manifest));
  delete noSc.parts.SC;
  r = commitEntry(guard, t.job(), [], t.pay(noSc), t.sa());
  ok(r.route === "FAIL" && /SC/.test(r.result_message), "entry: sc_id without the SC part -> FAILED", r.result_message);
  const wrongJob = Object.assign({}, t.c.manifest, { job_id: "123" });
  r = commitEntry(guard, t.job(), [], t.pay(wrongJob), t.sa());
  ok(r.route === "FAIL" && /job_id/.test(r.result_message), "entry: another job's manifest -> FAILED", r.result_message);
  t = mk("REVIEW");
  r = commitEntry(guard, t.job(), [], t.pay(), t.sa());
  ok(r.route === "GO" && r.needA1 === "YES" && r.scFingerprint === t.c.manifest.scFingerprint && r.a0ScId === SCID, "entry REVIEW phase A (A0 reads its Stock Count)", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "SPLIT|x" }), [{ step_name: "A2_INVENTORY", step_status: "DONE" }], t.pay(), t.sa());
  ok(r.needA3R === "YES" && r.needA3P === "NO" && r.needA4 === "YES", "entry REVIEW phase B", r);
  r = commitEntry(guard, t.job({ req_sc_id: "777" }), [], t.pay(), t.sa());
  ok(r.route === "FAIL" && J(r.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Cancelled" }]), "entry REVIEW: the request's SC is not the manifest's -> FAILED + Cancelled", r);
  t = mk("DIRECT");
  r = commitEntry(guard, t.job(), [], t.pay(), t.sa());
  ok(r.route === "GO" && r.needA1 === "NO" && r.scId === "0", "entry DIRECT: no A1", r);
  r = commitEntry(guard, t.job({ job_status: "COMMITTING_SA", lease_owner: "SPLIT|x" }), [{ step_name: "A2_INVENTORY", step_status: "DONE" }], t.pay(), t.sa());
  ok(r.needA3P === "NO" && r.needA3R === "NO" && r.needA4 === "YES", "entry DIRECT phase B: no A3", r);
}

// ------------------------------------------------------------------ A0
{
  const { commitA0 } = L("code_node_SACa0", ["commitA0"]);
  let c = X.makeCase("COMPLETE");
  let r = commitA0(entryOf(c), c.storedLines.map(X.fpRow), [], [{ other: 0 }]);
  ok(r.route === "OK" && r.stepRows[0].step_name === "A0_REVALIDATE", "A0 FORM at lineFingerprint -> DONE", r);
  r = commitA0(entryOf(c), c.finalLines.map((l, i) => X.fpRow(Object.assign({ id: String(i) }, l))), [], []);
  ok(r.route === "OK", "A0 FORM at incomingFingerprint -> DONE", r);
  r = commitA0(entryOf(c), c.storedLines.slice(1).map(X.fpRow), [], []);
  ok(r.route === "END" && r.result_code === "SA_LINES_CHANGED" && r.job_status === "FAILED" && J(r.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Draft" }]), "A0 FORM lines changed -> FAILED + Draft", r);
  c = X.makeCase("REVIEW");
  r = commitA0(entryOf(c), [], c.scLines.map(X.scFpRow), [{ other: "0" }]);
  ok(r.route === "OK", "A0 REVIEW at scFingerprint, no twin -> DONE", r);
  r = commitA0(entryOf(c), [], c.scAfterLines.map(X.scFpRow), [{ other: "0" }]);
  ok(r.route === "END" && r.result_code === "SA_SC_CHANGED" && J(r.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Cancelled" }]), "A0 REVIEW Stock Count changed -> FAILED + Cancelled", r);
  r = commitA0(entryOf(c), [], c.scLines.map(X.scFpRow), [{ other: "1" }]);
  ok(r.route === "END" && r.result_code === "SA_SC_CHANGED" && /other Processing/.test(r.result_message), "A0 REVIEW another Processing SA of the SC -> FAILED", r);
}

// ------------------------------------------------------------------ A1
{
  const { commitA1Plan, commitA1Check } = L("code_node_SACa1plan", ["commitA1Plan", "commitA1Check"]);
  let c = X.makeCase("COMPLETE");
  const sal = rowsOf(c, "SALINES");
  const hdrBefore = [{ j: J(c.header) }];
  const hdrAfter = [{ j: J(Object.assign({}, c.header, c.docHeader)) }];
  const afterLines = c.finalLines.map((l, i) => X.fpRow(stored2(Object.assign({ id: l.id || "9" + i }, l))));
  let r = commitA1Plan(entryOf(c), sal, c.storedLines.map(X.fpRow), hdrBefore);
  ok(r.route === "GO" && r.needFull === "YES" && r.needLines === "NO" && r.row.id === SAID && r.row.stock_adjustment.length === c.finalLines.length, "A1 COMPLETE at before -> the full write", r.result_message);
  ok(J(Object.keys(r.row)) === J(["id"].concat(X.SA_HDR, ["stock_adjustment"])) && r.row.adjustment_remarks === "edited at COMPLETE", "A1 COMPLETE row = id + the DOC header props + lines", Object.keys(r.row));
  ok(r.needTry === "YES" && r.markerRows[0].step_name === "A1_TRY" && r.markerRows[0].step_status === "TRY" && r.hdrBefore.adjustment_remarks === "before" && !("adjustment_date" in r.hdrBefore),
    "A1 write: the A1_TRY marker first; the header as read (strict props) kept for the check", r.markerRows);
  const plan = { header: r.header, expect: r.expect, hdrBefore: r.hdrBefore };
  r = commitA1Plan(entryOf(c), sal, afterLines, hdrAfter);
  ok(r.route === "GO" && r.needFull === "NO" && r.needLines === "NO", "A1 COMPLETE at after (unit_price stored at 2 dp) -> done, no write", r.result_message);
  r = commitA1Plan(entryOf(c), sal, afterLines, hdrBefore);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "A1 lines at after but never tried, header not -> REQUIRES_REVIEW (not our write)", r.result_message);
  r = commitA1Plan(entryOf(c, { triedA1: "YES" }), sal, afterLines, hdrBefore);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && /partial/.test(r.result_message), "A1 after A1_TRY: lines written, header not -> a partial write: REQUIRES_REVIEW", r.result_message);
  r = commitA1Plan(entryOf(c, { triedA1: "YES" }), sal, afterLines, [{ j: J(Object.assign({}, c.header, c.docHeader, { adjustment_date: "2026-10-15 16:00:00" })) }]);
  ok(r.route === "GO" && r.needFull === "NO" && r.needTry === "NO", "A1 after A1_TRY: lines + strict header at after, only the timestamp's stored form differs -> done (no false review)", r.result_message);
  const cascade = [{ current_node_id: "update_node_SACa1full", error_msg: "级联源数据缺少子租户字段：表[stock_adjustment_1dknywqh_sub]字段[sub_tenant_id]" }];
  r = commitA1Plan(entryOf(c, { triedA1: "YES" }), sal, c.storedLines.map(X.fpRow), hdrBefore, cascade);
  ok(r.route === "END" && r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED" && J(r.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Draft" }])
    && r.jobRows[0].error_message === "The Stock Adjustment's lines could not be saved: nothing was moved. The platform answered: " + cascade[0].error_msg,
    "A1 after A1_TRY with the lines still at before (the write threw) -> FAILED + Draft, SA_LINES_WRITE_FAILED with the platform's error", r.jobRows[0]);
  r = commitA1Plan(entryOf(c, { triedA1: "YES" }), sal, c.storedLines.map(X.fpRow), hdrBefore, []);
  ok(r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED" && r.jobRows[0].error_message === "The Stock Adjustment's lines could not be saved: nothing was moved.",
    "A1 after A1_TRY, no failed run found (died before the write) -> the same clean failure", r.jobRows[0]);
  r = commitA1Plan(entryOf(c), sal, c.storedLines.slice(2).map(X.fpRow), hdrBefore);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "A1 lines neither before nor after -> REQUIRES_REVIEW", r);
  r = commitA1Plan(entryOf(c), [{ step_name: "P|abcd1234|SALINES|001", result_ref: "{bad" }], c.storedLines.map(X.fpRow), hdrBefore);
  ok(r.route === "END" && r.job_status === "FAILED" && r.result_code === "SA_INVALID_DATA" && r.needUnlock === "YES", "A1 unreadable part -> FAILED + Draft", r);
  const short = JSON.parse(J(c.parts.SALINES));
  delete short.stock_adjustment[0].item_remark3;
  r = commitA1Plan(entryOf(c), X.partRows(JOB, "SALINES", short), c.storedLines.map(X.fpRow), hdrBefore);
  ok(r.route === "END" && r.job_status === "FAILED" && /lacks item_remark3/.test(r.result_message), "A1 a row without every column -> FAILED", r.result_message);
  const foreign = JSON.parse(J(c.parts.SALINES));
  foreign.stock_adjustment[0].id = "1234";
  r = commitA1Plan(entryOf(c), X.partRows(JOB, "SALINES", foreign), c.storedLines.map(X.fpRow), hdrBefore);
  ok(r.route === "END" && r.job_status === "FAILED" && /not lines of this/.test(r.result_message), "A1 a row id that is not this SA's line -> FAILED", r.result_message);
  r = commitA1Check(entryOf(c), plan, afterLines, hdrAfter);
  ok(r.route === "OK" && r.stepRows[0].step_name === "A1_SA_LINES", "A1 check at after (2 dp unit_price) -> DONE", r);
  r = commitA1Check(entryOf(c), plan, afterLines, [{ j: J(Object.assign({}, c.header, c.docHeader, { adjustment_remarks: "x" })) }]);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && r.result_code === "SA_RECONCILIATION_MISMATCH" && r.needUnlock === "NO", "A1 check: lines written, header off -> partial: REQUIRES_REVIEW", r);
  r = commitA1Check(entryOf(c), plan, c.storedLines.map(X.fpRow), hdrBefore);
  ok(r.route === "END" && r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED" && r.needUnlock === "YES" && r.unlockRows[0].stock_adjustment_status === "Draft",
    "A1 check: read back unchanged (lines + header as before) -> FAILED + Draft", r);
  r = commitA1Check(entryOf(c), plan, c.storedLines.map(X.fpRow), hdrAfter);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A1 check: lines as before but the header written -> partial: REQUIRES_REVIEW", r);
  r = commitA1Check(entryOf(c), plan, c.storedLines.slice(1).map(X.fpRow), hdrBefore);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A1 check: lines neither -> REQUIRES_REVIEW", r);
  const headerOnly = X.makeCase("COMPLETE");
  const hsal = JSON.parse(J(headerOnly.parts.SALINES));
  hsal.stock_adjustment = headerOnly.storedLines.map((l) => { const o = Object.assign({}, l); return o; });
  hsal.fingerprint = headerOnly.lineFp;
  r = commitA1Plan(entryOf(headerOnly, { incomingFingerprint: headerOnly.lineFp }), X.partRows(JOB, "SALINES", hsal), headerOnly.storedLines.map(X.fpRow), hdrBefore);
  ok(r.route === "GO" && r.needFull === "YES" && r.needTry === "YES", "A1 COMPLETE with a header-only edit -> write", r.result_message);
  const hplan = { header: r.header, expect: r.expect, hdrBefore: r.hdrBefore };
  r = commitA1Check(entryOf(headerOnly, { incomingFingerprint: headerOnly.lineFp }), hplan, headerOnly.storedLines.map(X.fpRow), hdrBefore);
  ok(r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED", "A1 header-only: the header read back unchanged -> FAILED + Draft", r);
  r = commitA1Plan(entryOf(headerOnly, { incomingFingerprint: headerOnly.lineFp, triedA1: "YES" }), X.partRows(JOB, "SALINES", hsal), headerOnly.storedLines.map(X.fpRow), hdrBefore);
  ok(r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED", "A1 header-only after A1_TRY, header not written -> FAILED + Draft", r);
  c = X.makeCase("REVIEW");
  const rsal = rowsOf(c, "SALINES");
  r = commitA1Plan(entryOf(c), rsal, [], [{ j: J(c.header) }]);
  ok(r.route === "GO" && r.needLines === "YES" && r.needFull === "NO" && r.needTry === "YES" && J(Object.keys(r.row)) === J(["id", "stock_adjustment"]), "A1 REVIEW at before (no lines) -> lines-only write", r.result_message);
  const rplan = { header: r.header, expect: r.expect, hdrBefore: r.hdrBefore };
  r = commitA1Check(entryOf(c), rplan, [], [{ j: J(c.header) }]);
  ok(r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED" && r.unlockRows[0].stock_adjustment_status === "Cancelled", "A1 REVIEW: no line inserted -> FAILED + Cancelled", r);
  r = commitA1Plan(entryOf(c, { triedA1: "YES" }), rsal, [], [{ j: J(c.header) }], [{ current_node_id: "update_node_SACa1lines", error_msg: "Data truncated" }]);
  ok(r.job_status === "FAILED" && r.result_code === "SA_LINES_WRITE_FAILED" && /Data truncated/.test(r.jobRows[0].error_message) && r.unlockRows[0].stock_adjustment_status === "Cancelled",
    "A1 REVIEW after A1_TRY, still no line -> FAILED + Cancelled with the platform's error", r);
  const rAfter = c.finalLines.map((l, i) => X.fpRow(stored2(Object.assign({ id: "77" + i }, l))));
  r = commitA1Plan(entryOf(c), rsal, rAfter, [{ j: J(c.header) }]);
  ok(r.route === "GO" && r.needLines === "NO", "A1 REVIEW lines at after (new ids, 2 dp) -> done: no second insert", r.result_message);
  r = commitA1Check(entryOf(c), rplan, rAfter, [{ j: J(c.header) }]);
  ok(r.route === "OK", "A1 REVIEW check -> DONE", r);
  const withId = JSON.parse(J(c.parts.SALINES));
  withId.stock_adjustment[0].id = "55";
  r = commitA1Plan(entryOf(c), X.partRows(JOB, "SALINES", withId), [], [{ j: J(c.header) }]);
  ok(r.route === "END" && r.job_status === "FAILED" && r.unlockRows[0].stock_adjustment_status === "Cancelled", "A1 REVIEW row with an id -> FAILED + Cancelled", r.result_message);
}

// ------------------------------------------------------------------ A2
{
  const { commitA2In } = L("code_node_SACa2in", ["commitA2In"]);
  const { commitA2Ans } = L("code_node_SACa2ans", ["commitA2Ans"]);
  const { commitA2 } = L("code_node_SACa2", ["commitA2"]);
  const c = X.makeCase("COMPLETE");
  const e = entryOf(c);
  const inp = commitA2In(e, rowsOf(c, "ENGINE"));
  ok(inp.ok === "YES" && inp.needCall === "YES" && inp.operationKey === "SAC|" + JOB && inp.count === c.movements.length && inp.keys[0] === "M1", "A2 input from the ENGINE part", inp);
  ok(commitA2In(e, X.partRows(JOB, "ENGINE", Object.assign({}, c.parts.ENGINE, { operation_key: "SAC|1" }))).ok === "NO", "A2 input: another operation key -> not ok");
  ok(commitA2Ans({ needCall: "YES" }, { code: "409", result_code: "LOCK_BUSY", message: "x" }).need409 === "YES" && commitA2Ans({ needCall: "YES" }, { code: "400", result_code: "INSUFFICIENT" }).need400 === "YES",
    "A2 answer flags");
  const DUP = "An error occurred: Duplicate entry '000000-1123598813738675201-COST|2072251040571300001|1123598813738675202' for key 'Lock Key'";
  const env = commitA2Ans({ needCall: "YES" }, { code: "400", result_code: undefined, message: undefined, msg: DUP });
  ok(env.message === DUP && env.need409 === "YES" && env.need400 === "NO" && env.result_code === "", "A2 answer: the platform envelope (400, no result_code) -> its msg passed through, intent rows read", env);
  const g = { nonce: "00ff00ff" };
  let r = commitA2(e, g, inp, { code: "200", result_code: "APPLIED", message: "ok" }, null, []);
  ok(r.route === "OK" && r.path === "SPLIT" && r.splitRows[0].lease_owner === "SPLIT|00ff00ff" && r.splitRows[0].attempt_count === 0 && r.splitRows[0].progress_percent === 80, "A2 200 -> DONE + SPLIT", r);
  r = commitA2(entryOf(c, { entryCount: 1001 }), g, inp, { code: "200", result_code: "REPLAYED" }, null, []);
  ok(r.route === "OK" && r.path === "PARK" && r.splitRows[0].lease_owner === null && r.splitRows[0].next_attempt_at === DB_NOW && r.splitRows[0].attempt_count === 0, "A2 > 1,000 entries -> PARK", r);
  r = commitA2(entryOf(c, { entryCount: 1000 }), g, inp, { code: "200", result_code: "REPLAYED" }, null, []);
  ok(r.path === "SPLIT", "A2 exactly 1,000 entries -> SPLIT");
  r = commitA2(e, g, inp, { code: "409", result_code: "LOCK_BUSY", message: "ITEM|1 held" }, { intents: "0" }, []);
  ok(r.route === "END" && r.result_code === "SA_LOCK_WAIT" && r.jobRows[0].next_attempt_at === "2026-10-16 10:00:15" && r.jobRows[0].attempt_count === 1 && r.needUnlock === "NO", "A2 409 -> wait 15 s", r);
  r = commitA2(entryOf(c, { attempts: 5 }), g, inp, { code: "409" }, { intents: 0 }, []);
  ok(r.jobRows[0].next_attempt_at === "2026-10-16 10:05:00", "A2 409 wait capped at 300 s", r.jobRows[0]);
  r = commitA2(entryOf(c, { attempts: 8 }), g, inp, { code: "409" }, { intents: 0 }, []);
  ok(r.route === "END" && r.job_status === "FAILED" && r.result_code === "SA_INVENTORY_LOCK_BUSY" && J(r.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Draft" }]), "A2 409 after 8 waits -> FAILED + Draft", r);
  r = commitA2(e, g, inp, { code: "409" }, { intents: "2" }, []);
  ok(r.route === "END" && r.result_code === "SA_LOCK_WAIT" && r.needUnlock === "NO" && r.job_status === "COMMITTING_SA", "A2 409 with intent rows (engine v12: the operation still runs) -> a lock wait, no unlock", r);
  r = commitA2(entryOf(c, { attempts: 8 }), g, inp, { code: "409" }, { intents: "2" }, []);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "A2 409 with intent rows after 8 waits -> REQUIRES_REVIEW, never FAILED / unlocked", r);
  r = commitA2(e, g, inp, {}, { intents: "2" }, []);
  ok(r.route === "END" && r.result_code === "SA_STEP_RETRY" && r.needUnlock === "NO", "A2 no answer with intent rows -> retry, no unlock", r);
  r = commitA2(e, g, inp, { code: "400", result_code: "INSUFFICIENT_QTY", message: "Insufficient quantity (movement M3)" }, null, rowsOf(c, "LABELS"));
  const l3 = c.labels.M3;
  ok(r.route === "END" && r.job_status === "FAILED" && r.result_code === "SA_INVENTORY_INSUFFICIENT_QTY" && r.jobRows[0].error_message === "Insufficient quantity - line " + l3.line_index + " (" + l3.item_code + "), bin " + l3.bin + " (Unrestricted)"
    && r.needUnlock === "YES", "A2 400 -> FAILED + mapped message + Draft", r.jobRows[0].error_message);
  r = commitA2(e, g, inp, { code: "400", result_code: "", message: DUP }, { intents: "0" }, []);
  ok(r.route === "END" && r.result_code === "SA_LOCK_WAIT" && r.jobRows[0].next_attempt_at === "2026-10-16 10:00:15" && r.jobRows[0].attempt_count === 1 && r.needUnlock === "NO"
    && r.jobRows[0].error_message.indexOf("Duplicate entry") >= 0, "A2 400 without a result_code -> transient: wait 15 s like a 409", r.jobRows[0]);
  r = commitA2(entryOf(c, { attempts: 8 }), g, inp, { code: "400", result_code: "", message: DUP }, { intents: "0" }, []);
  ok(r.job_status === "FAILED" && r.result_code === "SA_INVENTORY_LOCK_BUSY" && r.needUnlock === "YES" && JSON.parse(r.jobRows[0].error_details).why.indexOf("Duplicate entry") >= 0,
    "A2 400 without a result_code, 8 waits used -> FAILED SA_INVENTORY_LOCK_BUSY + Draft, the platform msg in the details", r.jobRows[0]);
  r = commitA2(e, g, inp, { code: "400", result_code: "", message: DUP }, { intents: "1" }, []);
  ok(r.route === "END" && r.result_code === "SA_STEP_RETRY" && r.needUnlock === "NO", "A2 400 without a result_code but with intent rows -> retry, never an unlock", r);
  r = commitA2(e, g, inp, { code: "500", result_code: "ERROR" }, null, []);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "A2 500 -> REQUIRES_REVIEW, no unlock", r);
  ok(commitA2Ans({ needCall: "YES" }, { code: null, result_code: null, message: null, msg: null }).need409 === "YES", "A2 answer: no answer at all -> read the intent rows");
  r = commitA2(e, g, inp, { code: "" }, { intents: "0" }, []);
  ok(r.route === "END" && r.result_code === "SA_LOCK_WAIT" && r.needUnlock === "NO", "A2 no answer, no intent row -> transient: wait like a lock", r);
  r = commitA2(e, g, inp, { code: "" }, { intents: "3" }, []);
  ok(r.route === "END" && r.result_code === "SA_STEP_RETRY" && r.job_status === "COMMITTING_SA", "A2 no answer with intent rows -> retry (not review)", r);
  r = commitA2(entryOf(c, { attempts: 3 }), g, inp, { code: "" }, { intents: "3" }, []);
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "A2 no answer with intent rows, retries spent -> REQUIRES_REVIEW", r);
  r = commitA2(entryOf(c, { attempts: 8 }), g, inp, { code: "" }, { intents: "0" }, []);
  ok(r.job_status === "FAILED" && r.result_code === "SA_INVENTORY_LOCK_BUSY" && r.needUnlock === "YES", "A2 no answer, no intent row, 8 waits used -> FAILED + Draft", r);
  r = commitA2(e, g, inp, { code: "403", result_code: "" }, { intents: "0" }, []);
  ok(r.job_status === "REQUIRES_REVIEW", "A2 another code -> REQUIRES_REVIEW at once", r);
  r = commitA2(entryOf(c, { prevStatus: "Posted" }), g, inp, { code: "400", result_code: "X", message: "bad" }, null, []);
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "SA_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO", "A2 400 with an unknown prevStatus -> REQUIRES_REVIEW, no unlock", r);
  r = commitA2(entryOf(c, { unlockOk: "NO" }), g, inp, { code: "400", result_code: "X", message: "bad" }, null, []);
  ok(r.job_status === "FAILED" && r.needUnlock === "NO", "A2 400 when the SA is not ours -> FAILED without unlock", r);
  r = commitA2(e, g, { ok: "YES", needCall: "NO", keys: [], count: 0 }, {}, null, []);
  ok(r.route === "OK" && r.path === "SPLIT", "A2 without movements -> DONE, no call", r);
  r = commitA2(e, g, { ok: "NO", why: "the ENGINE part ..." }, {}, null, []);
  ok(r.job_status === "FAILED" && r.result_code === "SA_INVALID_DATA" && r.needUnlock === "YES", "A2 unusable ENGINE part -> FAILED + Draft", r);
}

// ------------------------------------------------------------------ A3 REVIEW + PARITY
{
  const A3 = L("code_node_SACa3rplan", ["commitA3ReviewPlan", "commitA3ReviewCheck", "commitA3ParityPlan", "commitA3ParityCheck"]);
  let c = X.makeCase("REVIEW");
  const e = entryOf(c, { unlockOk: "NO" });
  const part = rowsOf(c, "SC");
  const hdr0 = [{ j: J(c.scHeader) }];
  const hdr1 = [{ j: J(Object.assign({}, c.scHeader, { stock_count_status: c.scPart.stock_count_status, review_status: c.scPart.review_status, adjustment_status: c.scPart.adjustment_status })) }];
  let r = A3.commitA3ReviewPlan(e, part, c.scLines.map(X.scFpRow), hdr0);
  ok(r.route === "GO" && r.needWrite === "YES" && J(Object.keys(r.row)) === J(X.SC_PROPS) && r.row.id === SCID && r.row.table_stock_count.length === c.scLines.length, "A3 REVIEW at before -> the one SC update", r.result_message);
  const plan = { status: r.status, expect: r.expect };
  const stored = c.scAfterLines.map((l) => X.scFpRow(sc3(l)));
  r = A3.commitA3ReviewPlan(e, part, stored, hdr1);
  ok(r.route === "GO" && r.needWrite === "NO", "A3 REVIEW at after (count_qty stored at 3 dp) -> done", r.result_message);
  r = A3.commitA3ReviewPlan(e, part, stored, hdr0);
  ok(r.route === "GO" && r.needWrite === "YES", "A3 REVIEW lines at after, statuses not -> write again", r.result_message);
  r = A3.commitA3ReviewPlan(e, part, c.scLines.slice(1).map(X.scFpRow), hdr0);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A3 REVIEW lines neither -> REQUIRES_REVIEW", r);
  const noid = JSON.parse(J(c.scPart));
  delete noid.table_stock_count[0].id;
  r = A3.commitA3ReviewPlan(e, X.partRows(JOB, "SC", noid), c.scLines.map(X.scFpRow), hdr0);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW" && /no id/.test(r.result_message), "A3 REVIEW a part line without id -> REQUIRES_REVIEW (never re-inserted)", r.result_message);
  const lacks = JSON.parse(J(c.scPart));
  delete lacks.item_list;
  r = A3.commitA3ReviewPlan(e, X.partRows(JOB, "SC", lacks), c.scLines.map(X.scFpRow), hdr0);
  ok(r.route === "END" && /item_list/.test(r.result_message), "A3 REVIEW a part without every prop -> REQUIRES_REVIEW", r.result_message);
  r = A3.commitA3ReviewCheck(e, plan, stored, hdr1);
  ok(r.route === "OK" && r.stepRows[0].step_name === "A3_STOCK_COUNT", "A3 REVIEW check -> DONE", r);
  r = A3.commitA3ReviewCheck(e, plan, stored, hdr0);
  ok(r.route === "END" && r.result_code === "SA_STEP_RETRY", "A3 REVIEW check statuses off -> retry", r);
  // PARITY
  c = X.makeCase("COMPLETE");
  const pe = entryOf(c, { unlockOk: "NO" });
  const pp = rowsOf(c, "SC");
  r = A3.commitA3ParityPlan(pe, pp, c.scLines.map(X.scFpRow), [{ j: J(c.scHeader) }]);
  const approved = c.scLines.filter((l) => l.line_status === "Approved").map((l) => l.id);
  const allAdj = c.scLines.every((l) => l.line_status === "Approved" || l.line_status === "Adjusted");
  ok(r.route === "GO" && r.needLines === "YES" && J(r.lineSlices[0].rows.map((x) => x.id)) === J(approved) && r.lineSlices[0].rows.every((x) => x.line_status === "Adjusted")
    && r.needHeader === "YES" && r.headerRows[0].adjustment_status === (allAdj ? "Fully Adjusted" : "Partially Adjusted"), "A3 PARITY: the Approved ids -> Adjusted, the status recomputed", r);
  const marked = c.scLines.map((l) => Object.assign({}, l, { line_status: l.line_status === "Approved" ? "Adjusted" : l.line_status }));
  r = A3.commitA3ParityPlan(pe, pp, marked.map(X.scFpRow), [{ j: J(Object.assign({}, c.scHeader, { adjustment_status: "Partially Adjusted" })) }]);
  ok(r.route === "GO" && r.needLines === "NO" && r.needHeader === "NO", "A3 PARITY nothing Approved + status right -> done", r);
  r = A3.commitA3ParityPlan(pe, pp, [], []);
  ok(r.route === "GO" && r.needLines === "NO" && r.needHeader === "NO" && /not found/.test(r.result_message), "A3 PARITY Stock Count gone -> nothing to mark", r);
  r = A3.commitA3ParityCheck(pe, { lineCount: 6 }, marked.map(X.scFpRow), [{ j: J(Object.assign({}, c.scHeader, { adjustment_status: "Partially Adjusted" })) }]);
  ok(r.route === "OK", "A3 PARITY check -> DONE", r);
  r = A3.commitA3ParityCheck(pe, { lineCount: 6 }, c.scLines.map(X.scFpRow), [{ j: J(Object.assign({}, c.scHeader, { adjustment_status: "Partially Adjusted" })) }]);
  ok(r.route === "END" && r.result_code === "SA_STEP_RETRY", "A3 PARITY check Approved left -> retry", r);
  r = A3.commitA3ParityPlan(pe, X.partRows(JOB, "SC", { mode: "PARITY", scId: "1" }), c.scLines.map(X.scFpRow), [{ j: J(c.scHeader) }]);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A3 PARITY part of another SC -> REQUIRES_REVIEW", r);
}

// ------------------------------------------------------------------ A4 + finish
{
  const A4 = L("code_node_SACa4plan", ["commitA4Plan", "commitA4Check"]);
  const c = X.makeCase("COMPLETE");
  const e = entryOf(c, { unlockOk: "NO" });
  const P = (n) => rowsOf(c, n);
  const now = (st) => [{ j: J(Object.assign({}, c.header, { stock_adjustment_status: st })) }];
  let r = A4.commitA4Plan(e, P("HDR"), P("ITEMS"), P("REORDER"), now("Processing"));
  ok(r.route === "GO" && r.needStatus === "YES" && J(r.statusRows) === J([{ id: SAID, stock_adjustment_status: "Completed" }]) && r.itemCount === c.items.length && r.needReorder === "YES"
    && r.reorderRows[0].step_name === "A4_REORDER" && r.reorderRows[0].result_ref === "pre-call" && r.reorderLatest.length === c.finalLines.length, "A4 Processing -> items, the marker + reorder, Completed", r.result_message);
  r = A4.commitA4Plan(entryOf(c, { doneReorder: "YES" }), P("HDR"), P("ITEMS"), P("REORDER"), now("Processing"));
  ok(r.needReorder === "NO" && r.reorderRows.length === 0 && r.reorderLatest.length === 0 && r.itemSlices.length === 0 && r.needStatus === "YES", "A4 marker already there -> no second reorder call, the dates not written again", r);
  r = A4.commitA4Plan(e, P("HDR"), P("ITEMS"), P("REORDER"), now("Completed"));
  ok(r.route === "GO" && r.needStatus === "NO" && r.itemSlices.length === 0 && r.needReorder === "NO", "A4 already Completed -> done, nothing written", r);
  r = A4.commitA4Plan(e, P("HDR"), P("ITEMS"), P("REORDER"), now("Draft"));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A4 header neither Processing nor Completed -> REQUIRES_REVIEW", r);
  r = A4.commitA4Plan(e, P("HDR"), [], P("REORDER"), now("Processing"));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A4 ITEMS part missing -> REQUIRES_REVIEW", r);
  r = A4.commitA4Plan(e, P("HDR"), P("ITEMS"), X.partRows(JOB, "REORDER", Object.assign({}, c.parts.REORDER, { organization_id: "999" })), now("Processing"));
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "A4 REORDER part of another organization -> REQUIRES_REVIEW", r);
  r = A4.commitA4Check(e, { after: { stock_adjustment_status: "Completed" } }, now("Completed"));
  ok(r.route === "OK" && r.stepRows[0].step_name === "A4_FINISH", "A4 check Completed -> DONE", r);
  r = A4.commitA4Check(e, { after: { stock_adjustment_status: "Completed" } }, now("Processing"));
  ok(r.route === "END" && r.result_code === "SA_STEP_RETRY", "A4 check not Completed -> retry", r);
  const { commitFinish, endNow, doneRow, failNoWrite } = L("code_node_SACfinish", ["commitFinish", "endNow", "doneRow", "failNoWrite"]);
  r = commitFinish(e);
  ok(r.jobRows[0].job_status === "COMPLETED" && r.job_status === "COMPLETED" && r.jobRows[0].progress_percent === 100 && r.jobRows[0].finished_at === DB_NOW && r.jobRows[0].lease_owner === null,
    "finish -> COMPLETED 100, lease released (no jsAt: finished_at = db_now)", r);
  // endNow: db_now read at the START of the pass + the JS time since the entry ran (controller recipe, a6 / user "fix it everywhere")
  ok(endNow({ dbNow: DB_NOW, jsAt: String(Date.now() - 45000) }) === "2026-10-16 10:00:45", "endNow: db_now + 45 s since the entry", endNow({ dbNow: DB_NOW, jsAt: String(Date.now() - 45000) }));
  ok(endNow({ dbNow: "2026-10-16 23:59:50", jsAt: String(Date.now() - 20000) }) === "2026-10-17 00:00:10", "endNow crosses midnight");
  ok(endNow({ dbNow: DB_NOW }) === DB_NOW && endNow({ dbNow: DB_NOW, jsAt: "" }) === DB_NOW && endNow({ dbNow: DB_NOW, jsAt: "x" }) === DB_NOW, "endNow without jsAt -> db_now");
  ok(endNow({ dbNow: DB_NOW, jsAt: String(Date.now() + 60000) }) === DB_NOW, "endNow with a jsAt in the future -> db_now (never earlier)");
  ok(endNow({ dbNow: "", jsAt: String(Date.now() - 5000) }) === "", "endNow without db_now -> ''");
  const late = entryOf(c, { unlockOk: "YES", jsAt: String(Date.now() - 30000) });
  ok(commitFinish(late).jobRows[0].finished_at === "2026-10-16 10:00:30" && doneRow(late, "A4_FINISH", "x").finished_at === "2026-10-16 10:00:30" && doneRow(late, "A4_FINISH", "x").started_at === DB_NOW
    && failNoWrite(late, "SA_X", "m", "w").jobRows[0].finished_at === "2026-10-16 10:00:30", "finished_at = endNow on the job row, the step rows and FAILED (started_at stays db_now)");
  const { commitEntry } = L("code_node_SACentry", ["commitEntry"]);
  const before = Date.now();
  const en = commitEntry(guard, [], [], [], []);
  ok(Number(en.jsAt) >= before && Number(en.jsAt) <= Date.now(), "entry stamps jsAt (JS ms) on every answer", en.jsAt);
  ok(/"jsAt"/.test(J(X.nodeById(X.built("SA_V2_COMMIT"), "code_node_SACentry").data.response_json.map((x) => x.name))), "the entry node declares jsAt");
}

// ------------------------------------------------------------------ worker: the release rule, the hard codes, no default
{
  const W = X.loadNode("SA_V2_WORKER", "code_node_SWclaim", ["saWorkerRelease", "PKC", "workerClaim", "SA_PREV_STATUSES"]);
  ok(J(W.saWorkerRelease(SAID, "Draft")) === J({ unlockRows: [{ id: SAID, stock_adjustment_status: "Draft" }], result_code: "" }), "worker release Draft");
  ok(J(W.saWorkerRelease(SAID, "Cancelled").unlockRows) === J([{ id: SAID, stock_adjustment_status: "Cancelled" }]), "worker release Cancelled");
  ok(J(W.saWorkerRelease(SAID, "In Progress")) === J({ unlockRows: [], result_code: "SA_PREV_STATUS_UNKNOWN" }) && W.saWorkerRelease(SAID, "").result_code === "SA_PREV_STATUS_UNKNOWN", "worker release unknown -> no unlock");
  ok(W.saWorkerRelease("0", "Draft").unlockRows.length === 0, "worker release of a job that does not own the SA -> nothing");
  ok(J(W.PKC.hard) === J(["SA_INVALID_REQUEST", "SA_INVALID_DATA", "SA_NOT_FOUND", "SA_SC_NOT_FOUND", "SA_NOT_LOCKED", "SA_NOT_ELIGIBLE", "SA_LINES_CHANGED", "SA_SC_CHANGED", "SA_SPLIT_REQUIRED",
    "SA_PLAN_BROKEN", "SA_REVIEW_BUILD_FAILED", "JOB_ILLEGAL_TRANSITION"]) && J(W.PKC.states) === J(["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"]), "worker hard codes + states (CONTRACT section 8)");
  ok(J(W.SA_PREV_STATUSES) === J(["Draft", "Cancelled"]), "worker prevStatus set Draft / Cancelled");
  const item = { jobId: JOB, jobStatus: "VALIDATING", prevStatus: "", attempts: 3, deadLease: "YES", deadOwner: "WRK|x", deadClaim: "NO", progressPercent: 10, progressMessage: "", nextAttemptAt: null,
    leaseOwner: "WRK|x", leaseExpiresAt: "x", errorCode: null, errorMessage: null, errorDetails: null };
  // (the built worker reads pick.saId: the build renames grId -> saId over the whole JSON)
  const r = W.workerClaim({ leaseOwner: "WRK|me" }, { route: "CLAIM", item: item, dbNow: DB_NOW, jobId: JOB, organizationId: ORG, saId: SAID, rvBase: 4, leaseUntil: "x" });
  ok(r.route === "EXHAUST" && r.failRows[0].job_status === "REQUIRES_REVIEW" && r.failRows[0].error_code === "SA_PREV_STATUS_UNKNOWN" && r.unlockRows.length === 0, "worker: exhausted with no prevStatus -> REQUIRES_REVIEW, no unlock (no default)", r);
  // endNow in the worker too (f8's LOT V2 change, the same recipe): the EXHAUST stamps = pick's db_now + the seconds since pick ran
  const W2 = X.loadNode("SA_V2_WORKER", "code_node_SWclaim", ["endNow", "workerClaim"]);
  const late = W2.workerClaim({ leaseOwner: "WRK|me" }, { route: "CLAIM", item: Object.assign({}, item, { prevStatus: "Draft" }), dbNow: DB_NOW, jsAt: String(Date.now() - 30000), jobId: JOB,
    organizationId: ORG, saId: SAID, rvBase: 4, leaseUntil: "x" });
  ok(late.failRows[0].job_status === "FAILED" && late.failRows[0].finished_at === "2026-10-16 10:00:30" && J(late.unlockRows) === J([{ id: SAID, stock_adjustment_status: "Draft" }]),
    "worker EXHAUST: FAILED + Draft, finished_at = endNow(pick)", late.failRows[0]);
  ok(W2.endNow({ dbNow: DB_NOW }) === DB_NOW, "worker endNow without jsAt -> db_now");
  const wdoc = X.built("SA_V2_WORKER");
  ok(["code_node_SWpick", "code_node_SWafterPrep", "code_node_SWpubAfter", "code_node_SWpub2After"].every((id) => X.nodeById(wdoc, id).data.response_json.some((r) => r.name === "jsAt")),
    "worker nodes that stamp jsAt declare it");
  const M = X.loadNode("SA_V2_WORKER", "code_node_SWmid", ["workerMid"]);
  const parked = M.workerMid({ leaseOwner: "WRK|me" }, { route: "PREPARE", jobId: JOB, dbNow: DB_NOW }, [{ id: JOB, job_status: "READY_TO_COMMIT", lease_owner: null, next_attempt_at: DB_NOW, lease_live: null }]);
  ok(parked.route === "END" && /PREPARE parked the job/.test(parked.result_message), "worker mid: READY_TO_COMMIT without a lease (PREPARE's PARK) -> no COMMIT call this tick", parked);
  ok(M.workerMid({ leaseOwner: "WRK|me" }, { route: "PUBLISH", jobId: JOB, dbNow: DB_NOW }, [{ id: JOB, job_status: "READY_TO_COMMIT", lease_owner: "WRK|me" }]).route === "PUBLISH", "worker mid: READY_TO_COMMIT under this run's lease -> PUBLISH");
  const text = J(X.built("SA_V2_WORKER"));
  ok(!/prevStatus\)?\s*\|\|\s*\\"/.test(text) && !/\|\| \\"Draft\\"/.test(text), "worker: no prevStatus default anywhere in the built JSON");
}

console.log(passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
