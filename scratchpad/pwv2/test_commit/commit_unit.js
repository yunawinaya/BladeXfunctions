// Unit tests of the PUTAWAY_BULK_COMMIT step functions on crafted inputs (no DB). TZ=Asia/Kuala_Lumpur node commit_unit.js
const fs = require("fs");
const path = require("path");
const P = path.join(__dirname, "..");
const strip = (t) => { const l = t.split("\n"); const at = l.findIndex((x) => /^const (res|guard|e|eng|S) = /.test(x)); return (at < 0 ? l : l.slice(0, at)).join("\n"); };
const load = (file, names, extras) => {
  const parts = [fs.readFileSync(path.join(P, "code/commit/_common.js"), "utf8"), fs.readFileSync(path.join(P, "code/commit/_cmp.js"), "utf8")];
  for (const x of extras || []) parts.push(fs.readFileSync(path.join(P, x), "utf8"));
  parts.push(strip(fs.readFileSync(path.join(P, "code/commit", file), "utf8")));
  const src = parts.join("\n") + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(file + ": a platform token is left");
  return new Function(src)();
};
let fails = 0, passes = 0;
const ok = (c, what, x) => { if (c) passes++; else { fails++; console.log("FAIL", what, x === undefined ? "" : JSON.stringify(x).slice(0, 600)); } };
const J = (o) => JSON.stringify(o);
const NONCE = "abcd1234", JOB = "2110000000000000009", TOID = "2105558352827682817", GRID = "2105558330853724162";
const partRows = (name, value) => [{ step_name: "P|" + NONCE + "|" + name + "|001", result_ref: J(value) }];
const jrows = (objs) => objs.map((o) => ({ j: J(o) }));
const entry = (x) => Object.assign({ jobId: JOB, tenantId: "000000", organizationId: "9", toId: TOID, toNo: "PA-1", grId: GRID, dbNow: "2026-10-15 10:00:00", attempts: 0, rowVersion: 3,
  unlockOk: "YES", partPrefix: "P|" + NONCE + "|", leaseUntil: "2026-10-15 10:10:00" }, x || {});
const TO = { id: TOID, to_status: "Completed", before: { to_status: "In Progress", update_time: "2026-10-15 09:00:00.123" },
  lines: [{ id: "L1", before: { pending_process_qty: "5.00000000", putaway_qty: "0.00000000", line_status: "Open" }, after: { pending_process_qty: "0.00000000", putaway_qty: "5.00000000", line_status: "Completed" } }],
  records: [{ transfer_order_putaway_id: TOID, line_index: "1", store_in_qty: "5.00000000", job_line_key: JOB + "|1" }] };
const IT = { updates: [{ id: "T1", transit_qty: "5.00000000", received_qty: "5.00000000", open_qty: "0.00000000", status: "Received", received_date: "2026-10-15", to_bin: "B9",
  to_category: "Unrestricted", target_doc_type: "Putaway", target_doc_id: TOID, target_doc_no: "PA-1", target_doc_line_id: "L1",
  before: { status: "Open", open_qty: 5, received_qty: 0, transit_qty: 5 } }], creates: [{ doc_id: GRID, transit_qty: "2.00000000", job_line_key: JOB + "|1" }] };

// ------------------------------------------------------------------ entry
{
  const { commitEntry } = load("entry.js", ["commitEntry"]);
  const guard = { jobId: JOB, tenantId: "000000", leaseOwner: "PUB|x", nonce: "00ff00ff" };
  const m = { v: 1, job_id: JOB, to_id: TOID, to_no: "PA-1", gr_id: GRID, nonce: NONCE, counts: { rows: 1, itUpdates: 1, itCreates: 1 }, parts: { ENGINE: ["x"], TO: ["x"], IT: ["x"], GR: ["x"] } };
  const job = (o) => [Object.assign({ db_now: "2026-10-15 10:00:00", lease_until: "2026-10-15 10:10:00", id: JOB, organization_id: "9", command: "COMPLETE_PUTAWAY", job_status: "READY_TO_COMMIT",
    is_deleted: 0, row_version: 3, attempt_count: 0, idempotency_key: "K1", correlation_id: "TO|" + TOID, due: 1, lease_live: 0 }, o || {})];
  const pay = [{ prepared_payload: J(m) }];
  let r = commitEntry(guard, job(), [], pay, [{ is_processing: 1, lock_ref: "K1" }]);
  ok(r.route === "GO" && r.phase === "A" && r.needP0 === "YES" && r.needP1 === "YES" && r.needP2 === "NO" && r.toId === TOID && r.grId === GRID, "entry phase A", r);
  // the lease outlasts the engine call: 10 min + 0.6 s per movement, at most 90 min (the SPLIT hand-over carries the same)
  const lease = (n) => { const mm = JSON.parse(J(m)); mm.counts.movements = n; const x = commitEntry(guard, job(), [], [{ prepared_payload: J(mm) }], [{ is_processing: 1, lock_ref: "K1" }]);
    return [x.jobRows[0].lease_expires_at, x.leaseUntil]; };
  ok(J(lease(undefined)) === J(["2026-10-15 10:10:00", "2026-10-15 10:10:00"]), "lease: no movements -> 10 min", lease(undefined));
  ok(J(lease(2500)) === J(["2026-10-15 10:35:00", "2026-10-15 10:35:00"]), "lease: 2,500 movements -> 35 min", lease(2500));
  ok(J(lease(20000)) === J(["2026-10-15 11:30:00", "2026-10-15 11:30:00"]), "lease: capped at 90 min", lease(20000));
  r = commitEntry(guard, job({ job_status: "COMMITTING_PUTAWAY", lease_owner: "SPLIT|n" }), [{ step_name: "P1_INVENTORY", step_status: "DONE" }], pay, [{ is_processing: 1, lock_ref: "K1" }]);
  ok(r.route === "GO" && r.phase === "B" && r.needP2 === "YES" && r.needP3 === "YES" && r.needP4 === "YES" && r.unlockOk === "NO", "entry phase B", r);
  r = commitEntry(guard, job(), [], pay, [{ is_processing: 0, lock_ref: "K1" }]);
  ok(r.route === "FAIL" && r.result_code === "PWC_NOT_LOCKED" && r.needUnlock === "NO", "entry lock lost", r);
  r = commitEntry(guard, job(), [], [{ prepared_payload: "{" }], [{ is_processing: 1, lock_ref: "K1" }]);
  ok(r.route === "FAIL" && r.needUnlock === "YES" && r.unlockRows[0].is_processing === 0, "entry bad manifest -> released", r);
}
// ------------------------------------------------------------------ P0
{
  const { commitP0 } = load("p0.js", ["commitP0"]);
  const head = [{ is_processing: 1, to_status: "In Progress", update_time: "2026-10-15 09:00:00.123" }];
  const lines = jrows([{ id: "L1", pending_process_qty: 5, putaway_qty: 0, line_status: "Open" }]);
  const its = jrows([{ id: "T1", status: "Open", open_qty: 5, received_qty: 0, transit_qty: 5 }]);
  let r = commitP0(entry(), partRows("TO", TO), partRows("IT", IT), head, lines, its);
  ok(r.route === "OK" && r.stepRows[0].step_name === "P0_REVALIDATE", "P0 ok", r);
  r = commitP0(entry(), partRows("TO", TO), partRows("IT", IT), [{ update_time: "2026-10-15 09:05:00.000" }], lines, its);
  ok(r.route === "END" && r.result_code === "PWC_TO_CHANGED" && r.needUnlock === "YES", "P0 header changed -> FAILED + released", r);
  r = commitP0(entry(), partRows("TO", TO), partRows("IT", IT), head, jrows([{ id: "L1", pending_process_qty: 3, putaway_qty: 0, line_status: "Open" }]), its);
  ok(r.route === "END" && r.result_code === "PWC_TO_CHANGED", "P0 line changed", r);
  r = commitP0(entry(), partRows("TO", TO), partRows("IT", IT), head, lines, jrows([{ id: "T1", status: "Received", open_qty: 0, received_qty: 5, transit_qty: 5 }]));
  ok(r.route === "END" && r.result_code === "PWC_TRANSIT_CHANGED", "P0 in-transit consumed meanwhile", r);
}
// ------------------------------------------------------------------ P1
{
  const { commitP1In } = load("p1_in.js", ["commitP1In"]);
  const { commitP1 } = load("p1.js", ["commitP1"]);
  let r = commitP1In(entry(), partRows("ENGINE", { operation_key: "PWC|" + JOB, movements: [{ a: 1 }, { b: 2 }] }));
  ok(r.ok === "YES" && r.movements.length === 2, "P1 input", r);
  ok(commitP1In(entry(), partRows("ENGINE", { operation_key: "PWC|other", movements: [{}] })).ok === "NO", "P1 input: wrong key");
  const g = { nonce: "00ff00ff" };
  r = commitP1(entry(), g, { ok: "YES" }, { code: "200", result_code: "APPLIED" });
  ok(r.route === "OK" && r.needSplit === "YES" && r.splitRows[0].lease_owner === "SPLIT|00ff00ff", "P1 200", r);
  ok(commitP1(entry(), g, { ok: "YES" }, { code: "409" }).result_code === "PWC_WAIT", "P1 409 wait");
  r = commitP1(entry(), g, { ok: "YES" }, { code: "400", result_code: "VALIDATION" });
  ok(r.job_status === "FAILED" && r.needUnlock === "YES", "P1 400 -> FAILED + released", r);
  ok(commitP1(entry(), g, { ok: "YES" }, { code: "500" }).job_status === "REQUIRES_REVIEW", "P1 500 review");
}
// ------------------------------------------------------------------ P2
{
  const { commitP2Plan } = load("p2_plan.js", ["commitP2Plan"]);
  const { commitP2Check } = load("p2_check.js", ["commitP2Check"]);
  const e = entry({ unlockOk: "NO" });
  const stored = jrows([{ id: "R0", line_index: "1", store_in_qty: 2, create_time: "x", tenant_id: "000000", transfer_order_putaway_id: TOID, batch_no: 2105558352827682999 }]);
  let r = commitP2Plan(e, partRows("TO", TO), [{ to_status: "In Progress" }], jrows([{ id: "L1", pending_process_qty: "5.00000000", putaway_qty: "0.00000000", line_status: "Open" }]), stored);
  ok(r.route === "GO" && r.lineCount === 1 && r.needHeader === "YES" && r.headerRow.table_putaway_records.length === 2 && r.headerRow.table_putaway_records[0].create_time === undefined
    && r.headerRow.table_putaway_records[0].transfer_order_putaway_id === undefined && r.headerRow.to_status === "Completed", "P2 plan: line, stored + new records, status", r.headerRow);
  // the columns this confirmation leaves alone go back at their stored values (live 10-15: missing ones were stored NULL)
  r = commitP2Plan(e, partRows("TO", TO), [{ to_status: "In Progress" }], jrows([{ id: "L1", pending_process_qty: 5, putaway_qty: 0, line_status: "Open",
    target_location: "2018912822846582786", remark: "", is_split: "No", parent_or_child: "Parent" }]), stored);
  const w = r.lineSlices[0].rows[0];
  ok(J(Object.keys(w).sort()) === J(["id", "is_split", "line_status", "parent_or_child", "pending_process_qty", "putaway_qty", "remark", "target_location"])
    && w.is_split === "No" && w.parent_or_child === "Parent" && w.remark === "" && w.target_location === "2018912822846582786"
    && w.pending_process_qty === "0.00000000" && w.putaway_qty === "5.00000000" && w.line_status === "Completed", "P2 plan: untouched columns keep their stored values", w);
  // rerun: line at after, record present, status at after -> nothing to write
  r = commitP2Plan(e, partRows("TO", TO), [{ to_status: "Completed" }], jrows([{ id: "L1", pending_process_qty: "0", putaway_qty: "5", line_status: "Completed" }]),
    jrows([{ id: "R0" }, { id: "R1", job_line_key: JOB + "|1" }]));
  ok(r.route === "GO" && r.lineCount === 0 && r.needHeader === "NO", "P2 plan rerun: nothing to write", r);
  r = commitP2Plan(e, partRows("TO", TO), [{ to_status: "In Progress" }], jrows([{ id: "L1", pending_process_qty: "4", putaway_qty: "0", line_status: "Open" }]), stored);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "P2 plan: line changed by someone else -> review", r);
  r = commitP2Check(e, partRows("TO", TO), [{ to_status: "Completed" }], jrows([{ id: "L1", pending_process_qty: "0.000", putaway_qty: "5.000", line_status: "Completed" }]),
    jrows([{ id: "R0" }, { id: "R1", job_line_key: JOB + "|1" }]));
  ok(r.route === "OK" && r.stepRows[0].step_name === "P2_TO", "P2 check (3-dp stored values pass)", r);
  r = commitP2Check(e, partRows("TO", TO), [{ to_status: "Completed" }], jrows([{ id: "L1", pending_process_qty: "0", putaway_qty: "5", line_status: "Completed" }]),
    jrows([{ id: "R1", job_line_key: JOB + "|1" }, { id: "R2", job_line_key: JOB + "|1" }]));
  ok(r.route === "END" && /doubled/.test(r.result_message), "P2 check: record doubled", r.result_message);
}
// ------------------------------------------------------------------ P3
{
  const { commitP3Plan } = load("p3_plan.js", ["commitP3Plan"]);
  const { commitP3Check } = load("p3_check.js", ["commitP3Check"]);
  const e = entry({ unlockOk: "NO" });
  let r = commitP3Plan(e, partRows("IT", IT), jrows([{ id: "T1", status: "Open", open_qty: 5, received_qty: 0, transit_qty: 5 }]), []);
  ok(r.route === "GO" && r.updCount === 1 && r.addCount === 1 && r.updSlices[0].rows[0].status === "Received" && r.addSlices[0].rows[0].job_line_key === JOB + "|1", "P3 plan", r);
  r = commitP3Plan(e, partRows("IT", IT), jrows([Object.assign({ id: "T1" }, IT.updates[0], { before: undefined })]), jrows([{ id: "N1", job_line_key: JOB + "|1" }]));
  ok(r.route === "GO" && r.updCount === 0 && r.addCount === 0, "P3 plan rerun: all done", r);
  r = commitP3Plan(e, partRows("IT", IT), jrows([{ id: "T1", status: "Open", open_qty: 4, received_qty: 1, transit_qty: 5 }]), []);
  ok(r.route === "END" && r.job_status === "REQUIRES_REVIEW", "P3 plan conflict -> review", r);
  r = commitP3Check(e, partRows("IT", IT), jrows([Object.assign({ id: "T1" }, IT.updates[0])]), jrows([{ id: "N1", job_line_key: JOB + "|1" }]));
  ok(r.route === "OK", "P3 check", r);
}
// ------------------------------------------------------------------ P3 ids
{
  const { commitP3Ids } = load("p3_ids.js", ["commitP3Ids"]);
  const many = Array.from({ length: 250 }, (_, i) => ({ id: "21100000000" + String(i + 2).padStart(8, "0") }));
  const its = { updates: [{ id: "2110000000000000001" }, { id: "2110000000000000001" }, { id: "12a" }, { id: "" }].concat(many), creates: [] };
  const r = commitP3Ids(entry(), partRows("IT", its));
  const arr = JSON.parse(r.idsSql);
  ok(r.n === 251 && arr.length === 251 && arr.every((x) => /^[0-9]{1,20}$/.test(x)) && arr[0] === "2110000000000000001", "P3 ids: deduped, digits only", { n: r.n, first: arr[0] });
  ok(r.idsSql.split("\n").length === 3 && r.idsSql.indexOf("'") < 0, "P3 ids: 100 per line, nothing to escape", r.idsSql.split("\n").map((l) => l.length));
  ok(commitP3Ids(entry(), []).idsSql === "[]" && commitP3Ids(entry(), partRows("IT", { updates: [], creates: [{}] })).n === 0, "P3 ids: no part / no updates -> []");
}
// ------------------------------------------------------------------ P4 (lifted ds7jurnq)
{
  const { commitP4Plan } = load("p4_plan.js", ["commitP4Plan"], ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js"]);
  const { commitP4Check } = load("p4_check.js", ["commitP4Check"]);
  const e = entry({ unlockOk: "NO" });
  const GRP = partRows("GR", { id: GRID, putaway_status: "Completed", gr_status: "Received", before: { putaway_status: "In Progress", gr_status: "Received" } });
  // hdr as sql_node_PCp4head returns it: plain columns, no j
  const S = (otherStatus, auto) => ({ hdr: [{ is_processing: 1, to_status: "Completed", update_time: "2026-10-15 12:00:00.000" }], gr: jrows([{ id: GRID, gr_status: "Received", putaway_status: "In Progress" }]),
    others: jrows([{ id: TOID, to_status: "Completed" }, { id: "999", to_status: otherStatus }]), qi: jrows([]), setup: jrows([{ id: "5", auto_completed_gr: auto }]) });
  let r = commitP4Plan(e, GRP, S("Completed", 1));
  ok(r.route === "GO" && r.needGr === "YES" && r.grRows[0].putaway_status === "Completed" && r.grRows[0].gr_status === "Completed" && r.needUnlock === "YES", "P4: all TOs done + auto-complete", r);
  r = commitP4Plan(e, GRP, S("In Progress", 1));
  ok(r.grPutawayStatus === "In Progress" && r.grStatus === "Received" && r.needGr === "NO" && r.needUnlock === "YES", "P4: another TO still open (fresh read wins over the plan; receipt already there)", r);
  r = commitP4Plan(e, GRP, S("Completed", 0));
  ok(r.grRows[0].putaway_status === "Completed" && r.grRows[0].gr_status === "Received", "P4: no auto-complete", r.grRows);
  ok(commitP4Check(e, r, jrows([{ putaway_status: "Completed", gr_status: "Received" }]), [{ is_processing: 0 }]).route === "OK", "P4 check ok");
  ok(commitP4Check(e, r, jrows([{ putaway_status: "Completed", gr_status: "Received" }]), [{ is_processing: 1 }]).route === "END", "P4 check: still locked");
}
console.log("putaway commit unit tests:", passes, "passed,", fails, "failed");
process.exit(fails ? 1 : 0);
