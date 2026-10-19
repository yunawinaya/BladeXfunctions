// test_so_save_v2.js: GD Edit V2 batch 5 in SO_SAVE (Sales Order/SOsaveWorkflow.json) - one cascade_ref per save into both
// SO_CASCADE passes; pass A's held GD edits released + committed before pass B appends; every held edit released after; the
// jobs handed to the form. Runs the new code nodes as the platform renders them and checks the wiring.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const doc = JSON.parse(fs.readFileSync(R + "Sales Order/SOsaveWorkflow.json", "utf8"));
const SUBMIT = "GD_EDIT_SUBMIT:Workflow:2110618741159940097", WORKER = "GD_EDIT_WORKER:Workflow:2110618789356687361";
const all = []; const walk = (l) => { for (const n of l || []) { all.push(n); walk(n.blocks); } }; walk(doc.nodes);
const node = (id) => all.filter((n) => n.id === id)[0];
const run = (n, values) => {
  const body = n.data.script.code.replace(/\{\{([^}]+)\}\}/g, (m, k) => { if (!(k in values)) throw new Error(n.id + ": no value for " + k); return JSON.stringify(values[k]); });
  return new Function(body)();
};
const params = (n) => n.data.body_params.list.map((x) => [x.prop, x.valueType, x.value]);
let failed = 0, count = 0;
const it = (name, f) => { count++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };
const CREF = /^[A-Za-z0-9|:_.-]{1,80}$/;   // GD_EDIT_SUBMIT's guard

it("one reference per save, right after start, in the shape GD_EDIT_SUBMIT accepts", () => {
  assert.strictEqual(doc.nodes[1].id, "code_node_CascadeRef");
  const r = run(node("code_node_CascadeRef"), { "system:uuid": "3f2a9c1e-77aa-4b6e-9d2c-0a1b2c3d4e5f", "workflowparams:allData.id": "2110639355872194561" });
  assert.strictEqual(r.cascadeRef, "SO|2110639355872194561|3f2a9c1e77aa4b6e9d2c0a1b"); assert.ok(CREF.test(r.cascadeRef)); assert.strictEqual(r.releaseOp, "RELEASE");
  const junk = run(node("code_node_CascadeRef"), { "system:uuid": "x'; --", "workflowparams:allData.id": "12'34" });
  assert.ok(CREF.test(junk.cascadeRef), junk.cascadeRef);
});
it("CascadeRef also hands the stored SO id, digits only (0 for a new order), for the linked-documents read", () => {
  assert.strictEqual(run(node("code_node_CascadeRef"), { "system:uuid": "u1", "workflowparams:allData.id": "2110639355872194561" }).soIdSql, "2110639355872194561");
  assert.strictEqual(run(node("code_node_CascadeRef"), { "system:uuid": "u1", "workflowparams:allData.id": "12'34" }).soIdSql, "1234");
  assert.strictEqual(run(node("code_node_CascadeRef"), { "system:uuid": "u1", "workflowparams:allData.id": null }).soIdSql, "0");
  assert.ok(node("code_node_CascadeRef").data.response_json.some((r) => r.name === "soIdSql"));
});
it("the linked-documents read: right after CascadeRef, tenant-scoped, deliveries and picking plans not Cancelled, none for a new order", () => {
  assert.strictEqual(doc.nodes[2].id, "sql_node_CascadeDocs");
  const sql = node("sql_node_CascadeDocs").data.script.code;
  for (const x of ["FROM goods_delivery g", "g.tenant_id = '{{system:tenantId}}'", "COALESCE(g.gd_status, '') <> 'Cancelled'", "g.is_deleted = 0",
    "FROM picking_plan p", "p.tenant_id = '{{system:tenantId}}'", "COALESCE(p.to_status, '') <> 'Cancelled'", "p.is_deleted = 0",
    "JSON_CONTAINS(g.so_id, '{{node:code_node_CascadeRef.data.soIdSql}}')", "JSON_CONTAINS(g.so_id, JSON_QUOTE('{{node:code_node_CascadeRef.data.soIdSql}}'))",
    "JSON_CONTAINS(p.so_id, '{{node:code_node_CascadeRef.data.soIdSql}}')", "'{{node:code_node_CascadeRef.data.soIdSql}}' <> '0'"]) assert.ok(sql.includes(x), x);
  assert.deepStrictEqual(node("sql_node_CascadeDocs").data.response_json.map((r) => r.name), ["linked"]);
});
const prevSo = { id: "5", table_so: [{ id: "1", item_name: "m", so_item_uom: "u", so_quantity: 3, so_item_price: 1, so_amount: 3 }] };
const gateA = (docs) => run(node("code_node_CascadeGate"), { "node:get_node_rvjWbHBF.data.data": prevSo, "workflowparams:allData": { id: "5" },
  "node:code_node_rPqQy5CD.data.table": { table_so: [{ id: "1", item_name: "m", so_item_uom: "u", so_quantity: 1, so_item_price: 1, so_amount: 1 }] },
  "node:sql_node_CascadeDocs.data": docs });
it("pass A: a changed line with nothing downstream -> no cascade and no tables; a delivery or plan -> the cascade; no answer -> the cascade", () => {
  const off = gateA([{ linked: 0 }]);
  assert.strictEqual(off.needsCascade, 0); assert.deepStrictEqual([off.prevTableSo, off.nextTableSo], [[], []]);
  const on = gateA([{ linked: 1 }]);
  assert.strictEqual(on.needsCascade, 1); assert.strictEqual(on.nextTableSo.length, 1); assert.strictEqual(on.prevTableSo.length, 1);
  assert.strictEqual(gateA(null).needsCascade, 1);
});
const gateB = (docs) => run(node("code_node_CascadeB_Gate"), { "node:get_node_rvjWbHBF.data.data": prevSo, "workflowparams:allData": { id: "5" },
  "node:code_node_9wKKlXUI.data.soData": { id: "5", table_so: [{ id: "1", item_name: "m" }, { id: "2", item_name: "n" }] }, "node:sql_node_CascadeDocs.data": docs });
it("pass B: a new line with nothing downstream -> no append and no tables; a delivery or plan -> the append; no answer -> the append", () => {
  const off = gateB([{ linked: 0 }]);
  assert.strictEqual(off.needsAppend, 0); assert.deepStrictEqual([off.prevTableSo, off.nextTableSo], [[], []]);
  assert.strictEqual(gateB([{ linked: 1 }]).needsAppend, 1); assert.strictEqual(gateB(null).needsAppend, 1);
});
it("both cascade passes carry it", () => {
  for (const id of ["workflow_node_CascadeA", "workflow_node_CascadeB"]) assert.ok(params(node(id)).some((p) => p[0] === "cascade_ref" && p[1] === "field" && p[2] === "{{node:code_node_CascadeRef.data.cascadeRef}}"), id);
});
it("before pass B: pass A's held edits, then a loop that releases and commits each", () => {
  const tb = node("if_CascadeB").blocks[0].blocks.map((n) => n.id);
  assert.deepStrictEqual(tb.slice(0, 3), ["code_node_GdeHeldA", "loop_node_GdeCommitA", "workflow_node_CascadeB"]);
  const loop = node("loop_node_GdeCommitA");
  assert.strictEqual(loop.data.loopSeletVar.code, "{{node:code_node_GdeHeldA.data.jobs}}");
  const rel = node("wf_GdeReleaseA"), ifr = node("if_GdeReleasedA"), commit = node("wf_GdeCommitA");
  assert.deepStrictEqual(loop.blocks.map((n) => n.id), ["wf_GdeReleaseA", "if_GdeReleasedA"]);
  assert.strictEqual(rel.data.workflow.source, SUBMIT);
  assert.deepStrictEqual(params(rel), [["operation", "field", "{{node:code_node_CascadeRef.data.releaseOp}}"], ["gd_id", "field", "{{node:loop_node_GdeCommitA.gd_id}}"],
    ["cascade_ref", "field", "{{node:code_node_CascadeRef.data.cascadeRef}}"]]);
  assert.strictEqual(ifr.data.filter.list[0].prop, "node.wf_GdeReleaseA.data.route"); assert.strictEqual(ifr.data.filter.list[0].value, "RELEASED");
  assert.deepStrictEqual(ifr.blocks[0].blocks.map((n) => n.id), ["wf_GdeCommitA"]);
  assert.strictEqual(commit.data.workflow.source, WORKER); assert.deepStrictEqual(params(commit), [["job_id", "field", "{{node:wf_GdeReleaseA.data.job_id}}"]]);
});
const heldA = (code, held) => run(node("code_node_GdeHeldA"), { "node:workflow_node_CascadeA.data.code": code, "node:workflow_node_CascadeA.data.heldJobs": held });
it("pass A's held edits only when pass A let the save through; malformed entries dropped", () => {
  const j = [{ job_id: "21", gd_id: "31", gd_no: "GD/1" }, { job_id: "x", gd_id: "31" }, null];
  assert.deepStrictEqual(heldA("200", j).jobs, [j[0]]);
  assert.deepStrictEqual(heldA("406", j).jobs, []);
  assert.deepStrictEqual(heldA(null, null).jobs, []);
});
it("after pass B: every held edit of both passes released and committed in this save (no kick needed), in one loop", () => {
  const top = doc.nodes.map((n) => n.id), i = top.indexOf("if_CascadeB");
  assert.deepStrictEqual(top.slice(i + 1, i + 4), ["code_node_GdeRelease", "loop_node_GdeRelease", "if_GdeOutcome"]);
  const loop = node("loop_node_GdeRelease");
  assert.strictEqual(loop.data.loopSeletVar.code, "{{node:code_node_GdeRelease.data.jobs}}");
  assert.deepStrictEqual(loop.blocks.map((n) => n.id), ["wf_GdeRelease", "if_GdeReleased"]);
  const ifr = node("if_GdeReleased"), commit = node("wf_GdeCommit");
  assert.strictEqual(ifr.data.filter.list[0].prop, "node.wf_GdeRelease.data.route"); assert.strictEqual(ifr.data.filter.list[0].value, "RELEASED");
  assert.deepStrictEqual(ifr.blocks[0].blocks.map((n) => n.id), ["wf_GdeCommit"]);
  assert.strictEqual(commit.data.workflow.source, WORKER); assert.deepStrictEqual(params(commit), [["job_id", "field", "{{node:wf_GdeRelease.data.job_id}}"]]);
  assert.strictEqual(node("wf_GdeRelease").data.workflow.source, SUBMIT);
  assert.deepStrictEqual(params(node("wf_GdeRelease")), [["operation", "field", "{{node:code_node_CascadeRef.data.releaseOp}}"], ["gd_id", "field", "{{node:loop_node_GdeRelease.gd_id}}"],
    ["cascade_ref", "field", "{{node:code_node_CascadeRef.data.cascadeRef}}"]]);
});
const rel = (codeA, heldA, heldB) => run(node("code_node_GdeRelease"), { "node:workflow_node_CascadeA.data.code": codeA, "node:workflow_node_CascadeA.data.heldJobs": heldA,
  "node:workflow_node_CascadeB.data.heldJobs": heldB });
it("the release list: pass A's (when it let the save through) and pass B's, ids handed to the form", () => {
  const a = [{ job_id: "21", gd_id: "31" }], b = [{ job_id: "22", gd_id: "32" }];
  assert.deepStrictEqual(rel("200", a, b).jobIds, ["21", "22"]);
  assert.deepStrictEqual(rel("200", a, null).jobIds, ["21"]);
  assert.deepStrictEqual(rel(null, null, b).jobIds, ["22"]);
  assert.deepStrictEqual(rel(null, null, null), { jobs: [], jobIds: [], jobIdsSql: "0", any: "NO" });
  assert.strictEqual(rel("200", a, b).jobIdsSql, "21,22"); assert.strictEqual(rel("200", a, b).any, "YES");
});
it("after the loop, only when the save released any: the jobs' outcome read once (tenant-scoped, the ids from code)", () => {
  const ifo = node("if_GdeOutcome");
  assert.strictEqual(ifo.data.filter.list[0].prop, "node.code_node_GdeRelease.data.any"); assert.strictEqual(ifo.data.filter.list[0].value, "YES");
  assert.deepStrictEqual(ifo.blocks[0].blocks.map((n) => n.id), ["sql_node_GdeOutcome", "code_node_GdeNotes"]);
  const q = node("sql_node_GdeOutcome").data.script.code;
  assert.ok(/j\.tenant_id = '\{\{system:tenantId\}\}'/.test(q) && /j\.id IN \(\{\{node:code_node_GdeRelease\.data\.jobIdsSql\}\}\)/.test(q), q);
});
const notes = (jobs, rows) => run(node("code_node_GdeNotes"), { "node:code_node_GdeRelease.data.jobs": jobs, "node:sql_node_GdeOutcome.data": rows }).notes;
it("a released edit that did not complete is reported: failed, under review, still running; completed ones are not", () => {
  const jobs = [{ job_id: "21", gd_id: "31", gd_no: "GD/1" }, { job_id: "22", gd_id: "32", gd_no: "GD/2" }, { job_id: "23", gd_id: "33", gd_no: "GD/3" }, { job_id: "24", gd_id: "34" }];
  const n = notes(jobs, [{ id: "21", job_status: "COMPLETED" }, { id: "22", job_status: "FAILED", error_message: "Insufficient quantity" }, { id: "23", job_status: "REQUIRES_REVIEW" },
    { id: "24", job_status: "COMMITTING_GD" }]);
  assert.strictEqual(n.length, 3);
  assert.ok(/GD\/2 was not updated: Insufficient quantity/.test(n[0]), n[0]); assert.ok(/GD\/3 .*under review.*contact support/.test(n[1]), n[1]); assert.ok(/34 is still being updated/.test(n[2]), n[2]);
  assert.deepStrictEqual(notes(jobs.slice(0, 1), [{ id: "21", job_status: "COMPLETED" }]), []);
});
it("the answer hands the form gdEditJobs and gdEditNotes", () => {
  const ans = (notesV) => run(node("code_node_xtWJshxF"), { "node:code_node_9wKKlXUI.data.soData": { id: "5", so_no: "SO/1", auto_si: 0 }, "node:workflow_node_t3FvIVBF.data": null,
    "node:workflow_node_CascadeA.data.pickingReversalNote": "", "node:workflow_node_CascadeB.data.pickingReversalNote": null, "node:code_node_GdeRelease.data.jobIds": ["21"],
    "node:code_node_GdeNotes.data.notes": notesV });
  assert.deepStrictEqual(ans(["Goods Delivery GD/2 was not updated: x"]).data.gdEditNotes, ["Goods Delivery GD/2 was not updated: x"]);
  assert.deepStrictEqual(ans(null).data.gdEditNotes, []);
});
it("the answer hands the form gdEditJobs", () => {
  const r = run(node("code_node_xtWJshxF"), { "node:code_node_9wKKlXUI.data.soData": { id: "5", so_no: "SO/1", auto_si: 0 }, "node:workflow_node_t3FvIVBF.data": null,
    "node:workflow_node_CascadeA.data.pickingReversalNote": "", "node:workflow_node_CascadeB.data.pickingReversalNote": null, "node:code_node_GdeRelease.data.jobIds": ["21", "22"],
    "node:code_node_GdeNotes.data.notes": null });
  assert.deepStrictEqual(r.data.gdEditJobs, ["21", "22"]); assert.strictEqual(r.data.so_no, "SO/1");
  const none = run(node("code_node_xtWJshxF"), { "node:code_node_9wKKlXUI.data.soData": { id: "5", so_no: "SO/1", auto_si: 0 }, "node:workflow_node_t3FvIVBF.data": null,
    "node:workflow_node_CascadeA.data.pickingReversalNote": null, "node:workflow_node_CascadeB.data.pickingReversalNote": null, "node:code_node_GdeRelease.data.jobIds": null,
    "node:code_node_GdeNotes.data.notes": null });
  assert.deepStrictEqual(none.data.gdEditJobs, []);
});
console.log((count - failed) + "/" + count + " passed");
process.exit(failed ? 1 : 0);
