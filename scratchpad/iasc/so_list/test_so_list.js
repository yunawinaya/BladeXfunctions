// The SO list's Convert to GD plant check (scratchpad/iasc/so_list/patch_so_list.py) on both live bases (dev v540, prod v270):
//   structure  only onConfirm_selectPlant changes: minus the helper and its one call it is the base handler; func_handleConvertGD and every
//              other handler, widget and setting byte-identical
//   behaviour  onConfirm_selectPlant on a mock list: nothing in another plant -> the base handler's calls exactly; an Item Assembly or a
//              Pending production reservation in another plant -> named in one confirm (Continue converts, Cancel stops with the dialog
//              open); a cancelled IA or one in the chosen plant -> no confirm; a failed read -> converts as before; Sales Invoice untouched
//   node scratchpad/iasc/so_list/test_so_list.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const HERE = __dirname;

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
};
const yes = (label, v, info) => eq(label + (v ? "" : " " + JSON.stringify(info || "").slice(0, 600)), !!v, true);
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);

const PATCHER = process.env.SO_LIST_PATCHER || path.join(HERE, "patch_so_list.py");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "so-list-"));
const b = spawnSync("python3", [PATCHER, "--write"], { env: Object.assign({}, process.env, { SO_LIST_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800) || b.stdout.slice(-800));
const P = JSON.parse(spawnSync("python3", [PATCHER, "--patches"], { encoding: "utf8" }).stdout);
const EV = (doc, name) => (doc.config.eventScript.filter((e) => e.name === name)[0] || {}).func;

const ORG = "1001";
const PA = "2002";
const PB = "2003";
const SO1 = { id: "9001", so_no: "SO-1", plant_name: ORG };
const SO2 = { id: "9002", so_no: "SO-2", plant_name: ORG };

// the handler on a mock list: the dialog's plant, the list's selection, a db over the IA / reservation / dept rows
const run = async (func, o) => {
  const log = { calls: [], reads: [] };
  const rows = Object.assign({ sm_item_assembly: [], on_reserved_gd: [], blade_dept: [{ id: PA, dept_name: "Plant A" }, { id: PB, dept_name: "Plant B" }] }, o.rows || {});
  const db = {
    collection: (name) => {
      const q = { name: name };
      const chain = {
        field: (f) => ((q.field = f), chain),
        filter: (f) => ((q.filter = f), chain),
        where: (w) => ((q.where = w), chain),
        get: () => {
          log.reads.push(q);
          if (o.fail && o.fail(name)) return Promise.reject(new Error("down"));
          const leaves = q.filter ? q.filter[0].children : [];
          const ok = (r) => leaves.every((l) => (l.operator === "in" ? l.value.map(String).indexOf(String(r[l.prop])) >= 0 : String(r[l.prop]) === String(l.value)));
          return Promise.resolve({ data: (rows[name] || []).filter((r) => (r.is_deleted === undefined || r.is_deleted === 0) && ok(r)) });
        },
      };
      return chain;
    },
  };
  const values = { "dialog_select_plant.plant_id": o.plant === undefined ? PB : o.plant, "dialog_select_plant.organization_id": ORG };
  const self = {
    models: { _data: { selectedRecords: o.records || [SO1], doc_type: o.docType || "goods delivery" } },
    getValue: (k) => values[k],
    closeDialog: (k) => (log.calls.push(["closeDialog", k]), Promise.resolve()),
    triggerEvent: (name, args) => (log.calls.push(["triggerEvent", name, args]), Promise.resolve()),
    $alert: (m, t) => (log.calls.push(["$alert", t, m]), Promise.resolve()),
    $confirm: (m, t, opts) => {
      log.calls.push(["$confirm", t, m, opts.confirmButtonText, opts.cancelButtonText]);
      return o.cancel ? Promise.reject("cancel") : Promise.resolve("confirm");
    },
  };
  await new Function("db", "console", "return async function () {\n" + func.replace("(async () => {", "return (async () => {") + "\n};")(db, { log() {}, error() {} }).call(self);
  return log;
};
const converts = (log) => log.calls.filter((c) => c[0] === "triggerEvent" && c[1] === "func_handleConvertGD").length;
const confirms = (log) => log.calls.filter((c) => c[0] === "$confirm");

(async () => {
  for (const base of ["dev", "prod"]) {
    const OUT = JSON.parse(fs.readFileSync(path.join(dir, "so_list_" + base + ".json"), "utf8"));
    const BASE = JSON.parse(fs.readFileSync(path.join(HERE, "base", base === "dev" ? "so_list_dev_v540.json" : "so_list_prod_v270.json"), "utf8"));
    const L = base + ": ";
    // structure
    const changed = OUT.config.eventScript.filter((e) => JSON.stringify(e) !== JSON.stringify(BASE.config.eventScript.filter((x) => x.key === e.key)[0])).map((e) => e.name);
    eq(L + "only onConfirm_selectPlant changed", changed, ["onConfirm_selectPlant"]);
    eq(L + "func_handleConvertGD byte-identical (the GD session's)", EV(OUT, "func_handleConvertGD"), EV(BASE, "func_handleConvertGD"));
    const u = JSON.parse(JSON.stringify(OUT));
    const e = u.config.eventScript.filter((x) => x.name === "onConfirm_selectPlant")[0];
    yes(L + "the helper once, the call once", e.func.split(P.helper).length === 2 && e.func.split(P.call).length === 2);
    e.func = e.func.replace(P.helper, "").replace(P.call, "");
    yes(L + "minus the helper and its call: the base page exactly", JSON.stringify(canon(u)) === JSON.stringify(canon(BASE)));

    const NEW = EV(OUT, "onConfirm_selectPlant");
    const OLD = EV(BASE, "onConfirm_selectPlant");
    // nothing in another plant: the base handler's calls exactly
    for (const [label, o] of [["no IA, no reservation", {}],
      ["an IA in the chosen plant", { rows: { sm_item_assembly: [{ stock_movement_no: "IA-1", issuing_operation_faci: PB, source_so_id: "9001", item_assembly_status: "Draft", is_deleted: 0 }] } }],
      ["a cancelled IA in another plant", { rows: { sm_item_assembly: [{ stock_movement_no: "IA-1", issuing_operation_faci: PA, source_so_id: "9001", item_assembly_status: "Cancelled", is_deleted: 0 }] } }],
      ["a delivered (not Pending) production reservation", { rows: { on_reserved_gd: [{ doc_no: "PDR-1", plant_id: PA, parent_id: "9001", parent_no: "SO-1", doc_type: "Production", status: "Allocated", is_deleted: 0 }] } }],
      ["an IA of another SO", { rows: { sm_item_assembly: [{ stock_movement_no: "IA-9", issuing_operation_faci: PA, source_so_id: "7777", item_assembly_status: "Completed", is_deleted: 0 }] } }],
      // the user's scope (10-28): Item Assemblies and production only
      ["a Pending Sales Order reservation in another plant", { rows: { on_reserved_gd: [{ doc_no: "", plant_id: PA, parent_id: "9001", parent_no: "SO-1", doc_type: "Sales Order",
        status: "Pending", is_deleted: 0 }] } }]]) {
      const a = await run(NEW, o);
      const z = await run(OLD, o);
      eq(L + label + ": converts as before, nothing asked", [a.calls, converts(a)], [z.calls, 1]);
    }
    let r = await run(NEW, {});
    eq(L + "one read of each for all the selected SOs, set-based", r.reads.map((q) => q.name), ["sm_item_assembly", "on_reserved_gd"]);
    // an IA in another plant
    const ia = { sm_item_assembly: [{ stock_movement_no: "IA-2610-030", issuing_operation_faci: PA, source_so_id: "9001", item_assembly_status: "Completed", is_deleted: 0 }] };
    r = await run(NEW, { rows: ia });
    const c = confirms(r)[0] || [];
    yes(L + "an IA in another plant: one confirm naming the SO, the IA and both plants (Continue / Cancel)", confirms(r).length === 1 && /SO-1/.test(c[2]) && /IA-2610-030/.test(c[2]) &&
      /Plant A/.test(c[2]) && /Plant B/.test(c[2]) && c[3] === "Continue" && c[4] === "Cancel", c);
    eq(L + "  Continue: converts as before", converts(r), 1);
    r = await run(NEW, { rows: ia, cancel: true });
    eq(L + "  Cancel: no convert, the Select Plant dialog left open", [converts(r), r.calls.filter((x) => x[0] === "closeDialog").length], [0, 0]);
    // a Pending production reservation in another plant
    r = await run(NEW, { rows: { on_reserved_gd: [{ doc_no: "PDR/20260602/0115", plant_id: PA, parent_id: "9001", parent_no: "SO-1", doc_type: "Production", status: "Pending", is_deleted: 0 }] } });
    yes(L + "a Pending production reservation in another plant: named", confirms(r).length === 1 && /PDR\/20260602\/0115/.test(confirms(r)[0][2]) && /Plant A/.test(confirms(r)[0][2]), confirms(r));
    // two SOs, one hit each, one confirm
    r = await run(NEW, { records: [SO1, SO2], rows: { sm_item_assembly: [{ stock_movement_no: "IA-A", issuing_operation_faci: PA, source_so_id: "9001", item_assembly_status: "Draft", is_deleted: 0 },
      { stock_movement_no: "IA-B", issuing_operation_faci: PA, source_so_id: "9002", item_assembly_status: "Created", is_deleted: 0 }] } });
    yes(L + "several SOs: one confirm listing each", confirms(r).length === 1 && /SO-1/.test(confirms(r)[0][2]) && /SO-2/.test(confirms(r)[0][2]) && /IA-A/.test(confirms(r)[0][2]) && /IA-B/.test(confirms(r)[0][2]));
    // a failed read: converts as before, nothing asked
    for (const what of ["sm_item_assembly", "on_reserved_gd"]) {
      r = await run(NEW, { rows: ia, fail: (name) => name === what });
      eq(L + "the " + what + " read failed: converts as before, nothing asked", [converts(r), confirms(r).length], [1, 0]);
    }
    r = await run(NEW, { rows: ia, fail: (name) => name === "blade_dept" });
    yes(L + "the plant names unreadable: still asked, the plant ids shown", confirms(r).length === 1 && confirms(r)[0][2].indexOf(PA) >= 0);
    // untouched paths
    for (const [label, o] of [["Sales Invoice", { docType: "sales invoice", rows: ia }], ["no plant chosen", { plant: "", rows: ia }]]) {
      const a = await run(NEW, o);
      const z = await run(OLD, o);
      eq(L + label + ": as before, nothing read", [a.calls, a.reads.length], [z.calls, 0]);
    }
  }
  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})();
