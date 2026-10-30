// Item Assembly Setup (RESERVED_REQUEST_PLAN.md Task 2, design D12): the form's mount and save handlers against an in-memory db,
// and the built form (from the Picking Setup template).
//   node scratchpad/iatr/test/test_ia_setup.js
const fs = require("fs");
const path = require("path");

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
};
const SRC = path.join(__dirname, "..", "setup", "src");
const src = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

// an in-memory db: collection(name).where(q).get(), .doc(id).update(e), .add(e)
const makeDb = (tables) => {
  let seq = 1000;
  const match = (row, q) => Object.keys(q).every((k) => String(row[k]) === String(q[k]));
  return {
    tables: tables,
    collection: (name) => ({
      where: (q) => ({ get: async () => ({ data: (tables[name] || []).filter((r) => match(r, q)).map((r) => Object.assign({}, r)) }) }),
      doc: (id) => ({ update: async (e) => { const r = (tables[name] || []).find((x) => String(x.id) === String(id)); if (r) Object.assign(r, e); return { id: id }; } }),
      add: async (e) => { seq++; (tables[name] = tables[name] || []).push(Object.assign({ id: String(seq) }, e)); return { id: String(seq) }; },
    }),
  };
};
const makeThis = (values, globals) => {
  const calls = [];
  const self = {
    calls: calls,
    values: Object.assign({}, values),
    getValues: () => Object.assign({}, self.values),
    setData: (o) => { calls.push(["setData", o]); Object.assign(self.values, o); },
    getVarGlobal: (k) => (globals || {})[k],
    getVarSystem: (k) => (globals || {})["sys:" + k],
    hideLoading: () => calls.push(["hideLoading"]),
    $message: { success: (m) => calls.push(["success", m]), error: (m) => calls.push(["error", m]), warning: (m) => calls.push(["warning", m]) },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => calls.push(["hide"]) } }, refresh: () => calls.push(["refresh"]) },
  };
  return self;
};
const run = async (code, self, db) => {
  new Function("db", code).call(self, db);
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
const rowsOf = (db) => (db.tables.item_assembly_setup || []).map((r) => [String(r.plant_id), String(r.organization_id), r.transfer_request_enabled]);

(async () => {
  // ---------------------------------------------------------------- save
  let db = makeDb({ blade_dept: [{ id: "P1", parent_id: "ORG" }, { id: "P2", parent_id: "ORG" }, { id: "P3", parent_id: "ORG" }], item_assembly_setup: [] });
  let self = makeThis({ organization_id: "ORG", item_assembly_setup_id: "", transfer_request_enabled: 1 });
  await run(src("iaSetup_save.js"), self, db);
  eq("save: org with 3 plants → 3 rows identical", rowsOf(db), [["P1", "ORG", 1], ["P2", "ORG", 1], ["P3", "ORG", 1]]);
  self = makeThis({ organization_id: "ORG", item_assembly_setup_id: "1001", transfer_request_enabled: 0 });
  await run(src("iaSetup_save.js"), self, db);
  eq("save again: the same 3 rows updated, none added", rowsOf(db), [["P1", "ORG", 0], ["P2", "ORG", 0], ["P3", "ORG", 0]]);
  eq("save: closes and says so", self.calls.filter((c) => c[0] === "hide" || c[0] === "success").map((c) => c[0]), ["hide", "success"]);
  db = makeDb({ blade_dept: [], item_assembly_setup: [] });
  await run(src("iaSetup_save.js"), makeThis({ organization_id: "ORG", item_assembly_setup_id: "", transfer_request_enabled: 1 }), db);
  eq("save: org without plants → 1 row plant_id = org", rowsOf(db), [["ORG", "ORG", 1]]);
  db = makeDb({ blade_dept: [], item_assembly_setup: [] });
  self = makeThis({ organization_id: "", item_assembly_setup_id: "", transfer_request_enabled: 1 });
  await run(src("iaSetup_save.js"), self, db);
  eq("save: no organisation → nothing written, an error said", [rowsOf(db), self.calls.some((c) => c[0] === "error")], [[], true]);

  // ---------------------------------------------------------------- mount
  db = makeDb({ item_assembly_setup: [{ id: "9", organization_id: "ORG", plant_id: "P1", transfer_request_enabled: 1 }] });
  self = makeThis({}, { deptParentId: "ORG" });
  await run(src("iaSetup_onMounted.js"), self, db);
  eq("mount: reads the org's row, shows the switch", [self.values.organization_id, self.values.item_assembly_setup_id, self.values.transfer_request_enabled], ["ORG", "9", 1]);
  db = makeDb({ item_assembly_setup: [] });
  self = makeThis({}, { deptParentId: "0", "sys:deptIds": "ORG2,P9" });
  await run(src("iaSetup_onMounted.js"), self, db);
  eq("mount: an organisation-level login; no row → off", [self.values.organization_id, self.values.item_assembly_setup_id, self.values.transfer_request_enabled], ["ORG2", "", 0]);

  // ---------------------------------------------------------------- the built form
  const out = path.join(__dirname, "..", "..", "..", "Item Assembly & BOM", "Setup", "ItemAssemblySetup.json");
  const form = JSON.parse(fs.readFileSync(out, "utf8"));
  const models = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (o.type && o.model) models.push([o.type, o.model, !!(o.options || {}).hidden]);
    for (const k of Object.keys(o)) if (k !== "options") walk(o[k]);
  };
  walk(form.list);
  const ms = models.map((m) => m[1]);
  eq("form: the switch, the hidden ids and the buttons", ["transfer_request_enabled", "organization_id", "item_assembly_setup_id", "button_save", "button_cancel"].map((m) => ms.indexOf(m) >= 0),
    [true, true, true, true, true]);
  eq("form: no Picking Setup field left", ms.filter((m) => /pick|loading|strategy|scan|movement_type|split_policy|auto_/.test(m)), []);
  eq("form: the ids hidden, the switch shown", models.filter((m) => /organization_id|item_assembly_setup_id|transfer_request_enabled/.test(m[1])).map((m) => [m[1], m[2]]).sort(),
    [["item_assembly_setup_id", true], ["organization_id", true], ["transfer_request_enabled", false]]);
  const ev = (form.config.eventScript || []).map((e) => e.name);
  eq("form: the three handlers present, no picking handler", [["mounted", "onClick_save", "onClick_cancel"].every((e) => ev.indexOf(e) >= 0), ev.filter((e) => /icking|LoadingBay|FullPicking|plant_get/.test(e))],
    [true, []]);
  const fn = (name) => ((form.config.eventScript || []).find((e) => e.name === name) || {}).func || "";
  eq("form: the handlers are the src files", [fn("mounted") === src("iaSetup_onMounted.js"), fn("onClick_save") === src("iaSetup_save.js")], [true, true]);
  const keys = [];
  const walkKeys = (o) => {
    if (Array.isArray(o)) return o.forEach(walkKeys);
    if (!o || typeof o !== "object") return;
    if (typeof o.key === "string" && o.type) keys.push(o.key);
    for (const k of Object.keys(o)) walkKeys(o[k]);
  };
  walkKeys(form.list);
  eq("form: widget keys unique, 8 characters", [new Set(keys).size === keys.length, keys.every((k) => /^[a-z0-9]{8}$/.test(k))], [true, true]);

  // ---------------------------------------------------------------- the table form (its publish creates the columns), from Picking
  // Setup's table form: one grid of data-bound fields, no title, no button, no handler
  const tout = path.join(__dirname, "..", "..", "..", "Item Assembly & BOM", "Setup", "ItemAssemblySetupTable.json");
  const table = JSON.parse(fs.readFileSync(tout, "utf8"));
  const tm = [];
  const walkT = (o) => {
    if (Array.isArray(o)) return o.forEach(walkT);
    if (!o || typeof o !== "object") return;
    if (o.type && o.model) tm.push([o.type, o.model, (o.options || {}).dataBind === true]);
    for (const k of Object.keys(o)) if (k !== "options") walkT(o[k]);
  };
  walkT(table.list);
  eq("table: exactly the three columns, data-bound", tm.filter((m) => m[0] !== "grid").map((m) => [m[1], m[0], m[2]]).sort(),
    [["organization_id", "input", true], ["plant_id", "treeselect", true], ["transfer_request_enabled", "switch", true]]);
  eq("table: no handler code", (table.config.eventScript || []).filter((e) => (e.func || "").trim() !== "").map((e) => e.name), []);
  const tkeys = [];
  const walkTK = (o) => {
    if (Array.isArray(o)) return o.forEach(walkTK);
    if (!o || typeof o !== "object") return;
    if (typeof o.key === "string" && o.type) tkeys.push(o.key);
    for (const k of Object.keys(o)) walkTK(o[k]);
  };
  walkTK(table.list);
  eq("table: widget keys unique, 8 characters", [new Set(tkeys).size === tkeys.length, tkeys.every((k) => /^[a-z0-9]{8}$/.test(k))], [true, true]);

  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})();
