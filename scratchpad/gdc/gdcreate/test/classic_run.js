// classic_run.js <convert.out.json> <tables.json> <tenant> <out.json>: the GD form's classic func_processGDLineItem on one
// real SO conversion, its client db answered in memory from fetch_classic_tables.py (dev rows, client-shaped). Writes the
// form state it ends with, for compare_runs.py against the V2 run of the same conversion.
const fs = require("fs");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [convFile, tablesFile, tenant, outFile] = process.argv.slice(2);
const form = JSON.parse(fs.readFileSync(R + "Goods Delivery/GDfullJSON.json", "utf8"));
const findEv = (o) => { if (Array.isArray(o)) { for (const x of o) { const r = findEv(x); if (r) return r; } } else if (o && typeof o === "object") { if (o.eventScript) return o.eventScript; for (const v of Object.values(o)) { const r = findEv(v); if (r) return r; } } return null; };
const code = findEv(form).find((e) => e.name === "func_processGDLineItem").func;
const T = JSON.parse(fs.readFileSync(tablesFile, "utf8"));
const conv = JSON.parse(fs.readFileSync(convFile, "utf8")).data.data[0];
const dbCalls = [];
const eq = (a, b) => String(a) === String(b);
const leaf = (r, f) => f.type === "branch" ? (f.operator === "any" ? f.children.some((c) => leaf(r, c)) : f.children.every((c) => leaf(r, c)))
  : f.operator === "in" ? (Array.isArray(f.value) ? f.value : [f.value]).some((v) => eq(r[f.prop], v))
  : f.operator === "equal" || f.operator === "numberEqual" || !f.operator ? eq(r[f.prop], f.value)
  : (() => { throw new Error("operator " + f.operator); })();
const db = { collection: (name) => { const q = []; const api = {
  where: (o) => { for (const k of Object.keys(o)) if (o[k] !== undefined) q.push({ prop: k, operator: "equal", value: o[k] }); return api; },
  filter: (tree) => { q.push(...tree); return api; }, field: () => api, orderBy: () => api, limit: () => api,
  doc: (id) => ({ get: async () => { dbCalls.push(name + ".doc"); const r = (T[name] || []).find((x) => eq(x.id, id)); return { data: r ? [JSON.parse(JSON.stringify(r))] : [] }; } }),
  get: async () => { dbCalls.push(name); if (!T[name]) throw new Error("no rows for collection " + name); return { data: T[name].filter((r) => q.every((c) => leaf(r, c))).map((r) => JSON.parse(JSON.stringify(r))) }; },
}; return api; } };
const values = Object.assign({ table_gd: [] }, conv);
const setPath = (obj, key, val) => { const parts = key.split("."); let o = obj; for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] === undefined || o[parts[i]] === null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = val; };
const log = { messages: [], alerts: [], dialogs: [] };
let done = false;
const page = {
  getValue: (k) => k.split(".").reduce((o, p) => (o === undefined || o === null ? undefined : o[p]), values),
  setData: async (x) => { for (const [k, v] of Object.entries(x)) setPath(values, k, v); },
  showLoading: () => {}, hideLoading: () => { done = true; },
  $message: { error: (m) => log.messages.push("error: " + m), warning: (m) => log.messages.push("warning: " + m), success: () => {}, info: () => {} },
  $alert: async (m) => { log.alerts.push(String(m).slice(0, 300)); },
  display: () => {}, hide: () => {}, disabled: () => {}, openDialog: (n) => { log.dialogs.push(n); },
  getComponent: () => ({ hideChildRecord: () => {}, options: {} }),
  getVarGlobal: (k) => (k === "deptParentId" ? conv.organization_id : "admin"), getVarSystem: (k) => (k === "tenantId" ? tenant : conv.organization_id),
  triggerEvent: async () => {}, runWorkflow: (id, p, ok, err) => err("no workflow expected: " + id),
};
const allItems = JSON.parse(conv.all_item || "[]").map((item) => Object.assign({}, item, { altUOM: item.altUOM == null ? "" : item.altUOM.toString() }));
const quiet = { log: () => {}, warn: () => {}, error: (...a) => log.messages.push("console.error: " + a.map(String).join(" ").slice(0, 300)) };
const t0 = Date.now();
Function("db", "console", "window", "return async function () {\n" + code + "\n}")(db, quiet, {}).call(page, { allItems });
(async () => {
  for (let i = 0; i < 6000 && !done; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 500));
  const result = { lines_in: allItems.length, finished: done, ms: Date.now() - t0, db_calls: dbCalls, dialogs: log.dialogs, alerts: log.alerts, messages: log.messages.slice(0, 20),
    table_gd: values.table_gd, insufficient: ((values.dialog_insufficient || {}).table_insufficient || []) };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  const counts = {};
  for (const c of dbCalls) counts[c] = (counts[c] || 0) + 1;
  console.log(JSON.stringify({ lines_in: result.lines_in, table_gd: (values.table_gd || []).length, finished: done, ms: result.ms, db_calls: counts, dialogs: log.dialogs, messages: log.messages.slice(0, 5), insufficient: result.insufficient.length }));
})();
