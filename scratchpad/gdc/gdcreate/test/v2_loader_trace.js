// v2_loader_trace.js <convert.out.json> <identity.json> <out.json>: the GD form's gdV2_func_processGDLineItem (repo
// GDfullJSON.json, its switch forced on) on one real SO conversion, as the form's mounted runs it after Convert to GD:
// GD_STOCK_CHECK is called for real on dev as the tenant's user (read-only), the page is mocked, the db answers the
// handler's few remaining reads from dev (read-only). Every fact row is wrapped so each field the builder reads is
// recorded, flagging reads of fields the facts do not carry. Writes the form state it ends with + the trace.
const fs = require("fs"), cp = require("child_process"), path = require("path");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [convFile, identFile, outFile, tablesFile] = process.argv.slice(2);
const STOCK_CHECK = "2105663605526925314";

const form = JSON.parse(fs.readFileSync(R + "Goods Delivery/GDfullJSON.json", "utf8"));
const findEv = (o) => { if (Array.isArray(o)) { for (const x of o) { const r = findEv(x); if (r) return r; } } else if (o && typeof o === "object") { if (o.eventScript) return o.eventScript; for (const v of Object.values(o)) { const r = findEv(v); if (r) return r; } } return null; };
let code = findEv(form).find((e) => e.name === "gdV2_func_processGDLineItem").func;
const patch = (from, to) => { if (code.split(from).length !== 2) throw new Error("patch point not unique: " + from.slice(0, 60)); code = code.replace(from, to); };
// FORCE_STOCK_CHECK=1 turns the global switch on; otherwise the run takes the convert switch, as Convert to GD does
if (process.env.FORCE_STOCK_CHECK === "1") patch("const STOCK_CHECK_ENABLED = false;", "const STOCK_CHECK_ENABLED = true;");
patch("return gdV2FactsMaps(Object.assign(gdV2MergeFacts(facts), { calls: requests.length }));", "return gdV2FactsMaps(__traceAll(Object.assign(gdV2MergeFacts(facts), { calls: requests.length })));");

// field-read tracing on the fact rows
const reads = {};
const SKIP = new Set(["then", "toJSON", "constructor", "length", "map", "filter", "forEach", "find", "some", "every", "reduce", "slice", "concat", "push", "indexOf", "includes", "sort", "join", "keys", "valueOf", "toString", "hasOwnProperty", "__proto__"]);
const wrap = (coll, row) => {
  if (!row || typeof row !== "object") return row;
  return new Proxy(row, {
    get(t, p) {
      const v = t[p];
      if (typeof p === "string" && !SKIP.has(p)) {
        const k = coll + "." + p;
        reads[k] = reads[k] || { present: 0, absent: 0 };
        if (p in t) reads[k].present++; else reads[k].absent++;
      }
      if (Array.isArray(v)) return v.map((x) => wrap(coll + "." + p + "[]", x));
      return v;
    },
  });
};
const __traceAll = (m) => Object.assign(m, {
  items: m.items.map((r) => wrap("item", r)),
  balances: { regular: m.balances.regular.map((r) => wrap("balance.regular", r)), batch: m.balances.batch.map((r) => wrap("balance.batch", r)), serial: m.balances.serial.map((r) => wrap("balance.serial", r)) },
  batches: m.batches.map((r) => wrap("batch", r)), reserved: m.reserved.map((r) => wrap("reserved", r)), bins: m.bins.map((r) => wrap("bin", r)),
});

// read-only dev reads for the handler's own db calls
const sql = (q) => JSON.parse(cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", q], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const conv = JSON.parse(fs.readFileSync(convFile, "utf8")).data.data[0];
const ident = JSON.parse(fs.readFileSync(identFile, "utf8"));
const soIds = (conv.so_id || []).map(String);
const ids = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" && Math.abs(v) > 2 ** 53 ? String(v) : v])));
// the handler's own db reads: fetch_classic_tables.py's exact rows when given (plain JSON.parse rounds 19-digit ids, so a
// plant_id match fails silently); else read here (fine only for lookups by varchar columns)
const T = tablesFile ? JSON.parse(fs.readFileSync(tablesFile, "utf8")) : {
  sales_order: ids(sql("SELECT * FROM sales_order WHERE tenant_id = '" + ident.tenant_id + "' AND id IN (" + soIds.join(",") + ")")),
  picking_setup: ids(sql("SELECT * FROM picking_setup WHERE tenant_id = '" + ident.tenant_id + "' AND organization_id = '" + conv.organization_id + "' AND is_deleted = 0")),
};
const dbCalls = [];
const eq = (a, b) => String(a) === String(b);
const leaf = (r, f) => f.type === "branch" ? (f.operator === "any" ? f.children.some((c) => leaf(r, c)) : f.children.every((c) => leaf(r, c)))
  : f.operator === "in" ? (Array.isArray(f.value) ? f.value : [f.value]).some((v) => eq(r[f.prop], v)) : eq(r[f.prop], f.value);
const db = { collection: (name) => { const q = []; const api = {
  where: (o) => { for (const k of Object.keys(o)) if (o[k] !== undefined) q.push({ prop: k, operator: "equal", value: o[k] }); return api; },
  filter: (tree) => { q.push(...tree); return api; }, field: () => api, orderBy: () => api, limit: () => api,
  get: async () => { dbCalls.push(name); if (!T[name]) throw new Error("no rows for collection " + name); return { data: T[name].filter((r) => q.every((c) => leaf(r, c))).map((r) => Object.assign({}, r)) }; },
}; return api; } };

// the page
const values = Object.assign({ table_gd: [] }, conv, { page_status: "Add" }); // mounted sets it before triggering the loader
const setPath = (obj, key, val) => { const parts = key.split("."); let o = obj; for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] === undefined || o[parts[i]] === null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = val; };
const log = { messages: [], alerts: [], dialogs: [], triggers: [], stockCalls: 0, stockMs: [] };
let done = false;
const page = {
  getValue: (k) => k.split(".").reduce((o, p) => (o === undefined || o === null ? undefined : o[p]), values),
  setData: async (x) => { for (const [k, v] of Object.entries(x)) setPath(values, k, v); },
  showLoading: () => {}, hideLoading: () => { done = true; },
  $message: { error: (m) => log.messages.push("error: " + m), warning: (m) => log.messages.push("warning: " + m), success: () => {}, info: () => {} },
  $alert: async (m) => { log.alerts.push(String(m).slice(0, 300)); },
  display: () => {}, hide: () => {}, disabled: () => {}, openDialog: (n) => { log.dialogs.push(n); },
  getComponent: () => ({ hideChildRecord: () => {}, options: {} }),
  getVarGlobal: (k) => (k === "deptParentId" ? conv.organization_id : "admin"), getVarSystem: (k) => (k === "tenantId" ? ident.tenant_id : conv.organization_id),
  triggerEvent: async (n) => { log.triggers.push(n); },
  runWorkflow(id, params, ok, err) {
    if (id !== STOCK_CHECK) return err("unexpected workflow " + id);
    const t0 = Date.now();
    const tmp = path.join(path.dirname(outFile), "sc_" + process.pid + "_" + (++log.stockCalls) + ".json");
    fs.writeFileSync(tmp + ".req", JSON.stringify(params));
    cp.execFile("node", [R + "scratchpad/gdc/tools/runas.mjs", identFile, id, tmp + ".req", tmp], { maxBuffer: 1 << 28 }, (e) => {
      log.stockMs.push(Date.now() - t0);
      if (e) return err(String(e.message).slice(0, 200));
      const out = JSON.parse(fs.readFileSync(tmp, "utf8"));
      fs.unlinkSync(tmp); fs.unlinkSync(tmp + ".req");
      if (out.code !== 200 || !out.data) return err(out.msg || "no data");
      ok({ data: out.data });
    });
  },
};
const allItems = JSON.parse(conv.all_item || "[]").map((item) => Object.assign({}, item, { altUOM: item.altUOM == null ? "" : item.altUOM.toString() }));
const quiet = { log: () => {}, warn: (...a) => log.messages.push("warn: " + a.map(String).join(" ").slice(0, 200)), error: (...a) => log.messages.push("console.error: " + a.map(String).join(" ").slice(0, 300)) };
const t0 = Date.now();
Function("db", "console", "window", "__traceAll", "return async function () {\n" + code + "\n}")(db, quiet, {}, __traceAll).call(page, { allItems });
(async () => {
  for (let i = 0; i < 6000 && !done; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 500));
  const ms = Date.now() - t0;
  const absent = Object.entries(reads).filter(([, c]) => c.absent > 0).map(([k, c]) => k + " (absent " + c.absent + ", present " + c.present + ")");
  const result = { lines_in: allItems.length, finished: done, ms, stock_calls: log.stockCalls, stock_ms: log.stockMs, db_calls: dbCalls, triggers: log.triggers, dialogs: log.dialogs, alerts: log.alerts, messages: log.messages.slice(0, 20),
    table_gd: values.table_gd, insufficient: ((values.dialog_insufficient || {}).table_insufficient || []), reads, absent };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ lines_in: result.lines_in, table_gd: (values.table_gd || []).length, finished: done, ms, stock_calls: log.stockCalls, db_calls: dbCalls, triggers: log.triggers, dialogs: log.dialogs, alerts: log.alerts.length, messages: log.messages.slice(0, 5), insufficient: result.insufficient.length }));
  console.log("fields read that the facts do not carry:", absent.length ? "\n  " + absent.join("\n  ") : "none");
})();
