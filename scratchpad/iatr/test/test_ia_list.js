// The Item Assembly list patch (scratchpad/iatr/ia_client/patch_ia_list.py) against the live dev v36 (base/rr_IA_LIST_v36.json; it
// carries v7's Transfer Request column and delete guard):
//   structure  the cancel guard once; minus it == v36; the Transfer Request column still last
//   delete     (v36's, v7's guard) an IA whose request is live or received -> refused, nothing deleted; a cancelled one or none -> deleted
//   cancel     (Task 10) a Created IA whose request is open (Requested / In Progress / Processing) -> left, said why; a received one or none
//              -> cancelled as v36; every selected IA's requests read once; unreadable -> nothing sent
//   node scratchpad/iatr/test/test_ia_list.js   (IATR_IA_LIST_PATCHER=<copy of patch_ia_list.py> tests another patcher)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1200) + "\n  want " + JSON.stringify(want).slice(0, 1200));
};
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);
const PATCHER = process.env.IATR_IA_LIST_PATCHER || path.join(IATR, "ia_client", "patch_ia_list.py");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-ial-"));
const b = spawnSync("python3", [PATCHER, "--write"], { env: Object.assign({}, process.env, { IATR_UI_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800));
const OUT = JSON.parse(fs.readFileSync(path.join(dir, "list", "IAlistPage.json"), "utf8"));
const BASE = JSON.parse(fs.readFileSync(path.join(IATR, "base", "rr_IA_LIST_v36.json"), "utf8"));
const P = JSON.parse(spawnSync("python3", [PATCHER, "--patches"], { encoding: "utf8" }).stdout);
const cpOf = (doc) => {
  let hit = null;
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if (x.model === "custom_7rq6zmn4" && x.options && x.options.customProps) hit = x.options.customProps;
      Object.values(x).forEach(walk);
    }
  };
  walk(doc.list);
  return hit;
};
const EV = (doc, name) => doc.config.eventScript.filter((e) => e.name === name)[0];

eq("column: Transfer Request still last (v36's)", cpOf(OUT).columns.slice(-1)[0].name, "transfer_request_no");
{
  const u = JSON.parse(JSON.stringify(OUT));
  const e = EV(u, "onItemAssemblyCancel");
  for (const [o, nw] of P.cancel.slice().reverse()) {
    eq("undo: a cancel change once (" + o.slice(0, 40).replace(/\n/g, " ") + ")", e.func.split(nw).length - 1, 1);
    e.func = e.func.replace(nw, o);
  }
  eq("everything else: v36", JSON.stringify(canon(u)) === JSON.stringify(canon(BASE)), true);
}

const wait = async () => {
  for (let i = 0; i < 120; i++) await new Promise((r) => setImmediate(r));
};
// ---------------------------------------------------------------- delete (v36's own: v7's guard)
const runDelete = async (doc, row, reqs) => {
  const log = { reads: [], updates: [], messages: [], runs: [] };
  const list = {
    showLoading() {}, hideLoading() {}, refresh() {},
    $confirm: () => Promise.resolve(),
    $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => log.messages.push(k + ": " + x) }), {}),
    runWorkflow: (id, params, ok) => {
      log.runs.push(id);
      setImmediate(() => ok({ data: { code: "200", message: "ok" } }));
    },
  };
  const db = {
    collection: (name) => {
      const q = { name: name, where: null, field: null };
      const chain = {
        where: (w) => ((q.where = w), chain),
        field: (f) => ((q.field = f), chain),
        get: () => {
          log.reads.push(q);
          if (name === "sm_item_assembly") return Promise.resolve({ data: [{ item_assembly_status: row.item_assembly_status, material_hold_status: "", organization_id: "O1" }] });
          return Promise.resolve({ data: reqs || [] });
        },
        doc: (id) => ({ update: (x) => (log.updates.push([name, id, x]), Promise.resolve()) }),
      };
      return chain;
    },
  };
  new Function("console", "db", "return function () {\n" + EV(doc, "delete").func + "\n};")({ log() {}, error() {} }, db).call(list, { row: row });
  await wait();
  return log;
};
// ---------------------------------------------------------------- cancel (the list's selection; IA_HOLD CANCEL one at a time)
const RES_HOLD = "2112752274794217473";
const runCancel = async (doc, selected, stored, reqs, opt) => {
  const o = opt || {};
  const log = { reads: [], messages: [], runs: [], confirms: [], alerts: [], refreshed: 0 };
  const list = {
    getComponent: () => ({ $refs: { crud: { tableSelect: selected } } }),
    showLoading() {}, hideLoading() {}, refresh: () => log.refreshed++,
    $confirm: (text) => (log.confirms.push(text), Promise.resolve()),
    $alert: (html) => (log.alerts.push(html), Promise.resolve()),
    $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => log.messages.push(k + ": " + x) }), {}),
    runWorkflow: (id, params, ok) => {
      log.runs.push([id, params.operation, params.ia_id]);
      setImmediate(() => ok({ data: { code: "200", message: "ok", result_json: JSON.stringify({ cancelled: true }) } }));
    },
  };
  const inOf = (q) => {
    const kids = (((q.filter || [])[0] || {}).children || []);
    const leaf = kids.filter((k) => k.operator === "in")[0];
    return leaf ? { prop: leaf.prop, value: leaf.value.map(String) } : null;
  };
  const db = {
    collection: (name) => {
      const q = { name: name };
      const chain = {
        field: (f) => ((q.field = f), chain),
        filter: (f) => ((q.filter = f), chain),
        where: (w) => ((q.where = w), chain),
        limit: (x) => ((q.limit = x), chain),
        get: () => {
          log.reads.push(q);
          if (name === "sm_location_transfer" && o.reqsThrow) return Promise.reject(new Error("db down"));
          const rows = name === "sm_item_assembly" ? stored : name === "sm_location_transfer" ? reqs : [];
          const f = inOf(q);
          return Promise.resolve({ data: f ? rows.filter((r) => f.value.indexOf(String(r[f.prop])) >= 0) : rows });
        },
      };
      return chain;
    },
  };
  new Function("console", "db", "setTimeout", "return function () {\n" + EV(doc, "onItemAssemblyCancel").func + "\n};")({ log() {}, error() {} }, db, (f) => setImmediate(f)).call(list, {});
  await wait();
  return log;
};
const ia = (id, no, status) => ({ id: id, stock_movement_no: no, item_assembly_status: status || "Created", organization_id: "O1" });
const rq = (iaId, no, status) => ({ source_ia_id: iaId, stock_movement_no: no, stock_movement_status: status, transfer_purpose: "IA_SUPPLY", is_deleted: 0 });
const reqReads = (r) => r.reads.filter((q) => q.name === "sm_location_transfer");

(async () => {
  // delete: v36's guard, unchanged
  const draft = { id: "4001", stock_movement_no: "IA-7", item_assembly_status: "Draft" };
  let r = await runDelete(OUT, draft, [{ stock_movement_no: "LOT-1", stock_movement_status: "Requested" }]);
  eq("delete, a Draft with a Requested request: refused, nothing deleted (v36)", [r.updates, r.messages], [[], ["error: Item Assembly IA-7 has transfer request LOT-1 (Requested): cancel the request first."]]);
  r = await runDelete(OUT, draft, [{ stock_movement_no: "LOT-1", stock_movement_status: "Completed" }]);
  eq("delete, a Draft whose request was received: refused (v36)", r.updates.length, 0);
  r = await runDelete(OUT, draft, [{ stock_movement_no: "LOT-1", stock_movement_status: "Cancelled" }]);
  eq("delete, a Draft with a cancelled request: deleted (v36)", r.updates.length > 0, true);

  // cancel
  const A = ia("4101", "IA-A");
  const B = ia("4102", "IA-B");
  r = await runCancel(OUT, [A, B], [A, B], [rq("4101", "LOT-1", "Requested")]);
  eq("cancel, one Created IA with a Requested request and one without: only the free one sent to IA_HOLD CANCEL", r.runs, [[RES_HOLD, "CANCEL", "4102"]]);
  eq("  the requests read once, for the Created ones, by purpose", reqReads(r).map((q) => [q.field, q.filter[0].children.map((k) => [k.prop, k.operator, k.value])]),
    [["source_ia_id,stock_movement_no,stock_movement_status", [["source_ia_id", "in", ["4101", "4102"]], ["transfer_purpose", "equal", "IA_SUPPLY"], ["is_deleted", "equal", 0]]]]);
  eq("  the confirm counts it, says the other is left", [/^Cancel 1 Item Assembly\?/.test(r.confirms[0] || ""), /1 of the selected has a transfer request open and is left as it is\./.test(r.confirms[0] || "")],
    [true, true]);
  eq("  the summary: the request named, the other cancelled", r.alerts, ["IA-A: transfer request LOT-1 is Requested: cancel the request first<br>IA-B: cancelled"]);
  for (const st of ["In Progress", "Processing"]) {
    r = await runCancel(OUT, [A, B], [A, B], [rq("4101", "LOT-1", st)]);
    eq("cancel, a request " + st + ": that IA left", r.runs.map((x) => x[2]), ["4102"]);
  }
  r = await runCancel(OUT, [A], [A], [rq("4101", "LOT-1", "Completed"), rq("4101", "LOT-0", "Cancelled")]);
  eq("cancel, a received request (and a cancelled one): cancelled as any Created IA", r.runs, [[RES_HOLD, "CANCEL", "4101"]]);
  r = await runCancel(OUT, [A, B], [A, B], [rq("4101", "LOT-1", "Requested"), rq("4102", "LOT-2", "In Progress")]);
  eq("cancel, every Created one with a request open: said, nothing asked or sent", [r.messages, r.confirms.length, r.runs.length],
    [["warning: Each selected Created Item Assembly has a transfer request open: cancel the request first."], 0, 0]);
  r = await runCancel(OUT, [A, B], [A, B], [], { reqsThrow: true });
  eq("cancel, the requests unreadable: said, nothing asked or sent", [r.messages, r.confirms.length, r.runs.length],
    [["error: The selected Item Assemblies' transfer requests could not be read: try again."], 0, 0]);
  const D = ia("4103", "IA-D", "Draft");
  for (const [label, sel, stored] of [["no request", [A, B], [A, B]], ["a Draft among them", [A, D], [A, D]]]) {
    const a = await runCancel(OUT, sel, stored, []);
    const z = await runCancel(BASE, sel, stored, []);
    eq("cancel with " + label + ": as v36 (the same runs, confirm and summary) plus the one requests read", [a.runs, a.confirms, a.alerts, reqReads(a).length],
      [z.runs, z.confirms, z.alerts, 1]);
    eq("  the requests of the Created ones only", reqReads(a)[0].filter[0].children[0].value, stored.filter((x) => x.item_assembly_status === "Created").map((x) => x.id));
  }
  r = await runCancel(OUT, [D], [D], [rq("4103", "LOT-1", "Requested")]);
  eq("cancel, only a Draft selected: v36's answer, no requests read", [r.messages, reqReads(r).length],
    [["warning: None of the selected Item Assemblies is Created: only a Created Item Assembly can be cancelled."], 0]);
  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})();
