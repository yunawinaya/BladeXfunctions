// The Location Transfer list patch (scratchpad/iatr/lot_client/patch_lot_list.py) against the live v49 (base/lot_list_v49.json):
//   structure  minus the badge, the 3 columns, the Status filter and the 2 handlers' changes == v49; the columns last, keyed by the form's
//              widgets; the filter = the IA list's select with this transfer's statuses
//   behaviour  bulkCancel_LOT / bulkDelete_LOT on a mock list: a Requested request -> IA_TRANSFER_REQUEST CANCEL; In Progress as before
//              (V2); a request never deleted; ordinary selections exactly as v49
//   node scratchpad/iatr/test/test_lot_list.js   (IATR_LIST_PATCHER=<copy of patch_lot_list.py>: mutants_lot_list.js)
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

const PATCHER = process.env.IATR_LIST_PATCHER || path.join(IATR, "lot_client", "patch_lot_list.py");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-list-"));
const b = spawnSync("python3", [PATCHER, "--write"], { env: Object.assign({}, process.env, { IATR_UI_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800));
const OUT = JSON.parse(fs.readFileSync(path.join(dir, "list", "LOTlist.json"), "utf8"));
const BASE = JSON.parse(fs.readFileSync(path.join(IATR, "base", "lot_list_v49.json"), "utf8"));
const FIELDS = JSON.parse(fs.readFileSync(path.join(IATR, "lot_client", "out", "fields", "LOTform.json"), "utf8"));
const P = JSON.parse(spawnSync("python3", [PATCHER, "--patches"], { encoding: "utf8" }).stdout);
const cpOf = (doc) => doc.list[0].tabs[0].list[0].options.customProps;
const EV = (doc, name) => doc.config.eventScript.filter((e) => e.name === name)[0];
const formKey = (m) => {
  let k = null;
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if (x.model === m && x.type) k = x.key;
      Object.values(x).forEach(walk);
    }
  };
  walk(FIELDS.list);
  return k;
};

// ================================================================ structure
const cp = cpOf(OUT);
eq("columns: the 3 appended last, keyed by the form's widgets", cp.columns.slice(-3).map((c) => [c.name, c.title, c.key]),
  [["source_ia_no", "Source Item Assembly", formKey("source_ia_no")], ["required_date", "Required Date", formKey("required_date")], ["requested_by", "Requested By", formKey("requested_by")]]);
eq("columns: every earlier column in its place", cp.columns.slice(0, -3).map((c) => c.name), cpOf(BASE).columns.map((c) => c.name));
const f = cp.filters[cp.filters.length - 1];
eq("filter: Status, a select on the status dictionary with this transfer's statuses", [f.name, f.title, f.multiple, f.component.name, f.component.rules[0].children[0].value,
  f.component.rules[0].children[1].children.map((c) => c.value)], ["stock_movement_status", "Status", true, "select", "1914242988707749889",
  ["Draft", "Requested", "Processing", "In Progress", "Completed", "Cancelled"]]);
eq("filter: unique leaf ids", new Set(f.component.rules[0].children[1].children.map((c) => c.id)).size, 6);
const st = cp.columns.filter((c) => c.name === "stock_movement_status")[0].configCustom.content;
eq("status column: the Requested badge, cyan", [/v-if="scope.value==='Requested'"/.test(st), /#0891B2/.test(st)], [true, true]);
{
  const u = JSON.parse(JSON.stringify(OUT));
  const c = cpOf(u);
  c.columns = c.columns.slice(0, -3);
  c.filters = c.filters.slice(0, -1);
  const s0 = c.columns.filter((x) => x.name === "stock_movement_status")[0];
  eq("undo: the badge once", s0.configCustom.content.endsWith(P.badge), true);
  s0.configCustom.content = s0.configCustom.content.slice(0, -P.badge.length);
  for (const [name, pairs] of [["bulkCancel_LOT", P.cancel], ["bulkDelete_LOT", P.delete]]) {
    const e = EV(u, name);
    e.func = pairs.reduce((fn, [o, nw]) => {
      eq("undo " + name + ": its change once", fn.split(nw).length - 1, 1);
      return fn.replace(nw, o);
    }, e.func);
  }
  eq("everything else: v49", JSON.stringify(canon(u)) === JSON.stringify(canon(BASE)), true);
}
for (const nm of ["bulkCancel_LOT", "bulkDelete_LOT"]) {
  let ok = true;
  try {
    new Function("console", "db", EV(OUT, nm).func);
  } catch (e) {
    ok = false;
  }
  eq("compiles: " + nm, ok, true);
}

// ================================================================ behaviour on a mock list
const SUBMIT = "2110992282596540417", WORKER = "2110992316335521793", CLASSIC = "2013133675374927874";
const wait = async () => {
  for (let i = 0; i < 80; i++) await new Promise((r) => setImmediate(r));
};
const run = async (doc, name, selected, opt) => {
  const o = opt || {};
  const log = { runs: [], messages: [], deleted: [], refreshed: 0, confirms: 0 };
  const list = {
    getComponent: () => ({ $refs: { crud: { tableSelect: JSON.parse(JSON.stringify(selected)) } } }),
    showLoading() {}, hideLoading() {},
    refresh: () => log.refreshed++,
    $confirm: () => {
      log.confirms++;
      return Promise.resolve();
    },
    $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => log.messages.push(k + ": " + x) }), {}),
    runWorkflow: (id, params, ok) => {
      log.runs.push([id, params]);
      const ans = o.answer ? o.answer(id, params) : id === SUBMIT ? { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED" }
        : id === WORKER ? { processed: "1", job_id: "J1", job_status: "COMPLETED" } : { code: "200", message: "ok" };
      setImmediate(() => ok({ data: ans }));
    },
  };
  const db = { collection: () => ({ doc: (id) => ({ update: (x) => { log.deleted.push([id, x]); return Promise.resolve(); } }) }) };
  new Function("console", "db", "return function () {\n" + EV(doc, name).func + "\n};")({ log() {}, error() {} }, db).call(list);
  await wait();
  return log;
};
const lot = (o) => Object.assign({ id: "2114100000000000001", stock_movement_no: "LOT-1", stock_movement_status: "In Progress", organization_id: "1123598813738675201", transfer_purpose: "",
  source_ia_id: "" }, o || {});
const rq = (o) => lot(Object.assign({ id: "2114100000000000002", stock_movement_no: "LOT-REQ", stock_movement_status: "Requested", transfer_purpose: "IA_SUPPLY",
  source_ia_id: "2113088440365826050" }, o || {}));
const ids = (r, id) => r.runs.filter((q) => q[0] === id);
(async () => {
  let r = await run(OUT, "bulkCancel_LOT", [rq()]);
  const c = (ids(r, P.iatr_wf)[0] || [])[1] || {};
  eq("Cancel, a Requested request: IA_TRANSFER_REQUEST CANCEL, no LOT V2 / classic call", [ids(r, P.iatr_wf).length, ids(r, SUBMIT).length, ids(r, CLASSIC).length], [1, 0, 0]);
  eq("  for this request and its IA", [c.operation, c.ia_id, c.lot_id, c.organization_id, /^[A-Za-z0-9|:_.-]{8,128}$/.test(c.idempotency_key || "")],
    ["CANCEL", "2113088440365826050", "2114100000000000002", "1123598813738675201", true]);
  eq("  confirmed once, said, the list refreshed", [r.confirms, r.messages, r.refreshed], [1, ["success: Successfully cancelled 1 location transfer(s)."], 1]);
  r = await run(OUT, "bulkCancel_LOT", [rq()], { answer: (id) => (id === P.iatr_wf ? { code: "400", message: "Only a Requested transfer request can be cancelled here." } : {}) });
  eq("Cancel refused by the request workflow: the reason in the failure", r.messages, ["warning: Cancelled 0 LOT(s). Failed: 1 (LOT-REQ (Only a Requested transfer request can be cancelled here.))"]);
  r = await run(OUT, "bulkCancel_LOT", [lot(), rq()]);
  eq("Cancel, In Progress + Requested: one through LOT V2, one through the request workflow", [ids(r, SUBMIT).length, ids(r, P.iatr_wf).length, r.messages.filter((m) => /success/.test(m))],
    [1, 1, ["success: Successfully cancelled 2 location transfer(s)."]]);
  r = await run(OUT, "bulkCancel_LOT", [lot({ stock_movement_status: "Draft" })]);
  eq("Cancel, nothing cancellable: said, nothing called", [r.runs.length, r.messages], [0, ["error: Please select at least one In Progress location transfer or Requested transfer request."]]);
  r = await run(OUT, "bulkCancel_LOT", [lot({ stock_movement_status: "Requested", transfer_purpose: "" })]);
  eq("Cancel, a Requested transfer that is not a request: not cancellable here", r.runs.length, 0);
  for (const sel of [[lot()], [lot(), lot({ id: "2114100000000000009", stock_movement_no: "LOT-9" })]]) {
    const a = await run(OUT, "bulkCancel_LOT", sel);
    const z = await run(BASE, "bulkCancel_LOT", sel);
    eq("Cancel, ordinary In Progress x" + sel.length + ": every call and message as v49's", [a.runs.map((q) => q[0]), a.messages, a.refreshed], [z.runs.map((q) => q[0]), z.messages, z.refreshed]);
  }
  r = await run(OUT, "bulkDelete_LOT", [rq({ stock_movement_status: "Cancelled" })]);
  eq("Delete, a cancelled request: kept", [r.deleted, r.messages], [[], ["error: Please select at least one Draft or Cancelled location transfer."]]);
  r = await run(OUT, "bulkDelete_LOT", [rq({ stock_movement_status: "Cancelled" }), lot({ stock_movement_status: "Cancelled" })]);
  eq("Delete, a cancelled request + an ordinary cancelled transfer: only the ordinary one", r.deleted.map((d) => d[0]), ["2114100000000000001"]);
  for (const sel of [[lot({ stock_movement_status: "Draft" })], [lot({ stock_movement_status: "Cancelled" }), lot({ id: "2", stock_movement_status: "Completed" })]]) {
    const a = await run(OUT, "bulkDelete_LOT", sel);
    const z = await run(BASE, "bulkDelete_LOT", sel);
    eq("Delete, ordinary: as v49", [a.deleted, a.messages], [z.deleted, z.messages]);
  }
  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})();
