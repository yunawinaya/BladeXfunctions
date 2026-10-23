// node scratchpad/ptguard/test/test_guard.js
// Runs the code-node bodies exactly as shipped in prod-hotfix/2026-10-23-pt-duplicate-guard/SM_PLANT_TRANSFER.json:
// each {{...}} placeholder is replaced by the JSON of a test value (null when not given), as the platform injects it.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WF = path.join(__dirname, "..", "..", "..", "prod-hotfix", "2026-10-23-pt-duplicate-guard", "SM_PLANT_TRANSFER.json");
const doc = JSON.parse(fs.readFileSync(WF, "utf8"));
const nodes = {};
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (n && typeof n === "object") {
    if (typeof n.id === "string" && n.type) nodes[n.id] = n;
    Object.keys(n).forEach((k) => k !== "data" && walk(n[k]));
  }
})(doc);

const run = (id, values) => {
  const node = nodes[id];
  assert.ok(node, "no node " + id);
  const code = node.data.script.code.replace(/\{\{([^}]+)\}\}/g, (m, k) => JSON.stringify(k in values ? values[k] : null));
  const out = new Function(code)();
  const declared = node.data.response_json.map((r) => r.name).sort();
  Object.keys(out).forEach((k) => assert.ok(declared.includes(k), id + " returns undeclared " + k));
  return out;
};

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log("ok -", name);
};

const line = (item, qty, entries, extra) => Object.assign({ item_selection: item, batch_no: "B-" + item, category: "Unrestricted", total_quantity: qty,
  quantity_uom: "U1", temp_qty_data: JSON.stringify(entries), temp_hu_data: "[]" }, extra || {});
const entry = (mat, bin, qty, extra) => Object.assign({ material_id: mat, batch_id: "BT" + mat, location_id: bin, category: "Unrestricted",
  sm_quantity: qty, unrestricted_qty: 500, update_time: "2026-10-23 07:45:39.735" }, extra || {});
const pt = (extra) => Object.assign({ id: "", page_status: "Add", organization_id: "1996787068457861121", issuing_operation_faci: "111", receiving_operation_faci: "222",
  stock_movement: [line("M1", 20, [entry("M1", "L1", 20)]), line("M2", 5, [entry("M2", "L2", 3), entry("M2", "L3", 2)])] }, extra || {});
const ctx = (allData, saveAs, pageStatus, more) => Object.assign({ "workflowparams:allData": allData, "workflowparams:saveAs": saveAs,
  "workflowparams:pageStatus": pageStatus, "system:tenantId": "128671", "system:uid": "2100416000389419010", "system:uuid": "9f1c-77ab-XY" }, more || {});
const KEY = "PT:1996787068457861121:new-abc123:0a1b2c3d4e5f6a7b";

// ---------------------------------------------------------------- prep
t("prep: app Add Issued with a key -> key + fingerprint, SAVING", () => {
  const o = run("code_node_PTdupPrep", ctx(pt({ pt_idem_key: KEY }), "Issued", "Add"));
  assert.strictEqual(o.route, "GO");
  assert.strictEqual(o.guardOn, "YES");
  assert.strictEqual(o.isIssuedAdd, "YES");
  assert.strictEqual(o.keySql, KEY);
  assert.ok(/^PTFP1\.[0-9a-f]{16}\.2$/.test(o.fpSql), o.fpSql);
  assert.strictEqual(o.uuidSaving, KEY + "|" + o.fpSql + "|SAVING");
  assert.strictEqual(o.uuidSaved, KEY + "|" + o.fpSql + "|SAVED");
  assert.strictEqual(o.tenantId, "128671");
  assert.strictEqual(o.runKey, "9f1c77abXY");
  assert.ok(o.uuidSaving.length <= 255);
});
t("prep: a key with a pipe or too short -> INVALID 400", () => {
  for (const bad of ["PT:1|2:new-x:abc", "short", "x".repeat(129), "PT key with spaces"]) {
    const o = run("code_node_PTdupPrep", ctx(pt({ pt_idem_key: bad }), "Issued", "Add"));
    assert.strictEqual(o.route, "INVALID", bad);
    assert.strictEqual(o.code, "400");
    assert.strictEqual(o.result_code, "PT_IDEM_KEY_INVALID");
  }
});
t("prep: web ($_v) and Copy (Clone) never use a key; Issued still gets the fingerprint", () => {
  for (const [data, page] of [[pt({ pt_idem_key: KEY, $_v: 3 }), "Add"], [pt({ pt_idem_key: KEY }), "Clone"]]) {
    const o = run("code_node_PTdupPrep", ctx(data, "Issued", page));
    assert.strictEqual(o.keySql, "~none~");
    assert.ok(o.fpSql.startsWith("PTFP1."));
    assert.ok(o.uuidSaving.startsWith("-|PTFP1."));
    assert.strictEqual(o.isIssuedAdd, "YES");
  }
});
t("prep: an invalid key from the web or a Copy is ignored, not refused", () => {
  const o = run("code_node_PTdupPrep", ctx(pt({ pt_idem_key: "bad|key", $_v: 1 }), "Issued", "Add"));
  assert.strictEqual(o.route, "GO");
});
t("prep: keyless Issued (old app) -> fingerprint only", () => {
  const o = run("code_node_PTdupPrep", ctx(pt(), "Issued", "Add"));
  assert.strictEqual(o.guardOn, "YES");
  assert.strictEqual(o.keySql, "~none~");
  assert.ok(o.uuidSaving.startsWith("-|PTFP1.") && o.uuidSaving.endsWith("|SAVING"));
});
t("prep: Draft Add with a key -> key only, saved as SAVED; keyless Draft -> no guard", () => {
  const a = run("code_node_PTdupPrep", ctx(pt({ pt_idem_key: KEY }), "Draft", "Add"));
  assert.strictEqual(a.guardOn, "YES");
  assert.strictEqual(a.isIssuedAdd, "NO");
  assert.strictEqual(a.fpSql, "~none~");
  assert.strictEqual(a.uuidSaved, KEY + "|-|SAVED");
  const b = run("code_node_PTdupPrep", ctx(pt(), "Draft", "Add"));
  assert.strictEqual(b.guardOn, "NO");
  assert.strictEqual(b.uuidSaving, "");
  assert.strictEqual(b.uuidSaved, "");
});
t("prep: edits are never guarded; Draft / In Progress edits raise their checks", () => {
  const d = run("code_node_PTdupPrep", ctx(pt({ id: "2113450940668448769", pt_idem_key: KEY }), "Draft", "Edit"));
  assert.strictEqual(d.guardOn, "NO");
  assert.strictEqual(d.draftCheck, "YES");
  assert.strictEqual(d.editId, "2113450940668448769");
  const i = run("code_node_PTdupPrep", ctx(pt({ id: "2113450940668448769" }), "In Progress", "Edit"));
  assert.strictEqual(i.guardOn, "NO");
  assert.strictEqual(i.childCheck, "YES");
  assert.strictEqual(i.parentId, "2113450940668448769");
  const x = run("code_node_PTdupPrep", ctx(pt({ id: "2113450940668448769" }), "Issued", "Edit"));
  assert.strictEqual(x.draftCheck + x.childCheck + x.guardOn, "NONONO");
});
t("prep: no session tenant -> fail open (no guard, no checks)", () => {
  const o = run("code_node_PTdupPrep", ctx(pt({ pt_idem_key: KEY }), "Issued", "Add", { "system:tenantId": null }));
  assert.strictEqual(o.guardOn, "NO");
  assert.strictEqual(o.tenantId, "0");
  assert.strictEqual(o.route, "GO");
});
t("prep: no uuid -> a random run key; cache keys still end on the placeholder", () => {
  const o = run("code_node_PTdupPrep", ctx(pt(), "Issued", "Add", { "system:uuid": null }));
  assert.ok(/^[0-9a-z]{6,40}$/.test(o.runKey), o.runKey);
});
t("prep: fingerprint ignores availability snapshots and line order, but not qty / user / plants", () => {
  const fp = (data, more) => run("code_node_PTdupPrep", ctx(data, "Issued", "Add", more)).fpSql;
  const a = fp(pt());
  const shuffled = pt();
  shuffled.stock_movement = [line("M2", 5, [entry("M2", "L3", 2, { unrestricted_qty: 7 }), entry("M2", "L2", 3, { update_time: "x" })]),
    line("M1", 20.0, [entry("M1", "L1", "20.00000000")])];
  assert.strictEqual(fp(shuffled), a);
  const moreQty = pt();
  moreQty.stock_movement[0] = line("M1", 21, [entry("M1", "L1", 21)]);
  assert.notStrictEqual(fp(moreQty), a);
  assert.notStrictEqual(fp(pt(), { "system:uid": "42" }), a);
  assert.notStrictEqual(fp(pt({ receiving_operation_faci: "333" })), a);
  const hu = pt();
  hu.stock_movement[0].temp_hu_data = JSON.stringify([{ handling_unit_id: "H1", material_id: "M1", location_id: "L1", sm_quantity: 20 }]);
  assert.notStrictEqual(fp(hu), a);
});

// ---------------------------------------------------------------- decide (entry)
const row = (id, state, by, age, extra) => Object.assign({ id: id, stock_movement_no: "PT/" + id, stock_movement_status: "Issued", save_state: state,
  match_by: by, age_s: age }, extra || {});
t("decide: nothing found -> GO", () => {
  assert.strictEqual(run("code_node_PTdupDecide", { "node:sql_node_PTdupFind.data": [] }).route, "GO");
  assert.strictEqual(run("code_node_PTdupDecide", {}).route, "GO");
});
t("decide: SAVED -> REPLAY 200 with the earlier transfer", () => {
  const o = run("code_node_PTdupDecide", { "node:sql_node_PTdupFind.data": [row("101", "SAVED", "FP", 30)] });
  assert.deepStrictEqual([o.route, o.code, o.result_code, o.id, o.stock_movement_no, o.replayed], ["REPLAY", "200", "PT_ALREADY_SAVED", "101", "PT/101", "1"]);
  assert.strictEqual(o.message, "Plant Transfer already saved as PT/101");
});
t("decide: SAVING -> WAIT 400; SAVING for 30+ min -> STOP 400; unknown age -> WAIT", () => {
  assert.strictEqual(run("code_node_PTdupDecide", { "node:sql_node_PTdupFind.data": [row("101", "SAVING", "KEY", 80)] }).result_code, "PT_SAVE_IN_PROGRESS");
  const stop = run("code_node_PTdupDecide", { "node:sql_node_PTdupFind.data": [row("101", "SAVING", "KEY", 1800)] });
  assert.deepStrictEqual([stop.route, stop.code, stop.result_code], ["STOP", "400", "PT_SAVE_INCOMPLETE"]);
  assert.strictEqual(run("code_node_PTdupDecide", { "node:sql_node_PTdupFind.data": [row("101", "SAVING", "KEY", null)] }).route, "WAIT");
});
t("decide: a key match beats an older fingerprint match", () => {
  const o = run("code_node_PTdupDecide", { "node:sql_node_PTdupFind.data": [row("100", "SAVED", "FP", 600), row("105", "SAVING", "KEY", 20)] });
  assert.strictEqual(o.id, "105");
  assert.strictEqual(o.route, "WAIT");
});

// ---------------------------------------------------------------- twin read-backs
for (const [tag, add] of [["Iss", "add_node_5Wstw9z2"], ["Dr", "add_node_QyZ0Zyck"]]) {
  const twin = (mine, rows) => run("code_node_PTdupTwin" + tag, { ["node:" + add + ".data"]: mine === null ? null : [{ id: mine }],
    ["node:sql_node_PTdupTwin" + tag + ".data"]: rows });
  t("twin " + tag + ": alone or oldest -> keep", () => {
    assert.strictEqual(twin("200", [row("200", "SAVING", "FP", 0)]).lose, "NO");
    assert.strictEqual(twin("200", [row("200", "SAVING", "KEY", 0), row("201", "SAVING", "KEY", 0)]).lose, "NO");
  });
  t("twin " + tag + ": newer than another save -> lose, answer with the winner", () => {
    const o = twin("201", [row("200", "SAVING", "FP", 5), row("201", "SAVING", "FP", 0)]);
    assert.deepStrictEqual([o.lose, o.mine, o.route, o.id, o.result_code], ["YES", "201", "WAIT", "200", "PT_SAVE_IN_PROGRESS"]);
    const r = twin("201", [row("200", "SAVED", "KEY", 5), row("201", "SAVING", "KEY", 0)]);
    assert.deepStrictEqual([r.lose, r.route, r.code, r.replayed], ["YES", "REPLAY", "200", "1"]);
  });
  t("twin " + tag + ": own row not visible or no add answer -> keep (fail open)", () => {
    assert.strictEqual(twin("201", [row("200", "SAVING", "FP", 5)]).lose, "NO");
    assert.strictEqual(twin(null, [row("200", "SAVING", "FP", 5)]).lose, "NO");
  });
  t("twin " + tag + ": with a key, only key rows decide", () => {
    assert.strictEqual(twin("201", [row("200", "SAVED", "FP", 5), row("201", "SAVING", "KEY", 0)]).lose, "NO");
  });
}

// ---------------------------------------------------------------- saved stamp
t("saved: a new Issued transfer is stamped; anything else is not", () => {
  const prep = { isIssuedAdd: "YES", uuidSaved: KEY + "|PTFP1.x.2|SAVED" };
  const o = run("code_node_PTdupSaved", { "node:code_node_PTdupPrep.data": prep, "node:add_node_5Wstw9z2.data": [{ id: "2113450940668448769" }] });
  assert.deepStrictEqual(o, { stamp: "YES", id: "2113450940668448769", uuidSaved: prep.uuidSaved });
  assert.strictEqual(run("code_node_PTdupSaved", { "node:code_node_PTdupPrep.data": prep, "node:add_node_5Wstw9z2.data": null }).stamp, "NO");
  assert.strictEqual(run("code_node_PTdupSaved", { "node:code_node_PTdupPrep.data": { isIssuedAdd: "NO" },
    "node:add_node_5Wstw9z2.data": [{ id: "1" }] }).stamp, "NO");
});

// ---------------------------------------------------------------- Draft on a stored transfer
t("draft: only a stored Draft may be saved as Draft", () => {
  const st = (status) => run("code_node_PTdupDraftSt", { "node:sql_node_PTdupDraftSt.data": [{ id: "9", stock_movement_no: "PT/9", stock_movement_status: status }] });
  for (const bad of ["Issued", "In Progress", "Completed", "Created", "Cancelled"]) {
    const o = st(bad);
    assert.deepStrictEqual([o.route, o.code, o.result_code], ["REFUSE", "400", "PT_DRAFT_NOT_ALLOWED"], bad);
    assert.strictEqual(o.message, "PT/9 is " + bad + " and can't be saved back to Draft.");
  }
  assert.strictEqual(st("Draft").route, "GO");
  assert.strictEqual(st("").route, "GO");
  assert.strictEqual(run("code_node_PTdupDraftSt", { "node:sql_node_PTdupDraftSt.data": [] }).route, "GO");
});

// ---------------------------------------------------------------- receiving child twin
t("child: the oldest child stays, a newer one goes", () => {
  const c = (mine, ids) => run("code_node_PTdupChild", { "node:add_node_u455hdU9.data": [{ id: mine }],
    "node:sql_node_PTdupChild.data": ids.map((id) => ({ id: id, stock_movement_status: "Created" })) });
  assert.deepStrictEqual(c("301", ["300", "301"]), { lose: "YES", mine: "301", winner: "300" });
  assert.strictEqual(c("300", ["300", "301"]).lose, "NO");
  assert.strictEqual(c("300", ["300"]).lose, "NO");
  assert.strictEqual(c("302", ["300", "301"]).lose, "NO");
});

console.log(passed + " passed");
