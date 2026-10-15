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
it("after pass B: every held edit of both passes released, in one loop", () => {
  const top = doc.nodes.map((n) => n.id), i = top.indexOf("if_CascadeB");
  assert.deepStrictEqual(top.slice(i + 1, i + 3), ["code_node_GdeRelease", "loop_node_GdeRelease"]);
  const loop = node("loop_node_GdeRelease");
  assert.strictEqual(loop.data.loopSeletVar.code, "{{node:code_node_GdeRelease.data.jobs}}");
  assert.deepStrictEqual(loop.blocks.map((n) => n.id), ["wf_GdeRelease"]);
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
  assert.deepStrictEqual(rel(null, null, null), { jobs: [], jobIds: [] });
});
it("the answer hands the form gdEditJobs", () => {
  const r = run(node("code_node_xtWJshxF"), { "node:code_node_9wKKlXUI.data.soData": { id: "5", so_no: "SO/1", auto_si: 0 }, "node:workflow_node_t3FvIVBF.data": null,
    "node:workflow_node_CascadeA.data.pickingReversalNote": "", "node:workflow_node_CascadeB.data.pickingReversalNote": null, "node:code_node_GdeRelease.data.jobIds": ["21", "22"] });
  assert.deepStrictEqual(r.data.gdEditJobs, ["21", "22"]); assert.strictEqual(r.data.so_no, "SO/1");
  const none = run(node("code_node_xtWJshxF"), { "node:code_node_9wKKlXUI.data.soData": { id: "5", so_no: "SO/1", auto_si: 0 }, "node:workflow_node_t3FvIVBF.data": null,
    "node:workflow_node_CascadeA.data.pickingReversalNote": null, "node:workflow_node_CascadeB.data.pickingReversalNote": null, "node:code_node_GdeRelease.data.jobIds": null });
  assert.deepStrictEqual(none.data.gdEditJobs, []);
});
console.log((count - failed) + "/" + count + " passed");
process.exit(failed ? 1 : 0);
