// harness.mjs <handler.js> <fixture.json> <out.json>: run one GD form Batch Add (onConfirm_batchAddItem) offline against a
// fixture from make_fixture.py - a mock form, a mock client db that answers the old reads, and a mock GD_STOCK_CHECK that
// packs the same rows with the workflow's own stockPack - and record every form write, dialog, db read and workflow call.
import fs from 'node:fs';

const [handlerPath, fixturePath, outPath] = process.argv.slice(2);
const code = fs.readFileSync(handlerPath, 'utf8');
const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const STOCK_CHECK = '2105663605526925314';
const s = (v) => (v === undefined || v === null ? '' : String(v)).trim();

// the workflow's own pack function, from the repo copy of GD_STOCK_CHECK
const wf = JSON.parse(fs.readFileSync('/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_STOCK_CHECK.json', 'utf8'));
const findNode = (n, id) => {
  if (n && typeof n === 'object') {
    if (n.id === id) return n;
    for (const v of Object.values(n)) { const r = findNode(v, id); if (r) return r; }
  }
  return null;
};
const packCode = findNode(wf, 'code_node_JA3NJpip').data.script.code;
const stockPack = new Function(packCode.slice(packCode.indexOf('const stockPack'), packCode.indexOf('const reads = ')) + 'return stockPack;')();

const R = fx.reads;
const plantId = fx.so.plant_id, organizationId = fx.so.organization_id;
const guardOf = (mats, lines) => ({ plantId, organizationId, materialCount: mats.length, soLineCount: lines.length });
const allFacts = JSON.parse(stockPack(guardOf([], []), R).facts);

// the rows the old client reads see: the same facts, in the shapes the handler reads
const tables = {
  Item: allFacts.items,
  item_balance: allFacts.balances.regular,
  item_batch_balance: allFacts.balances.batch,
  item_serial_balance: allFacts.balances.serial,
  batch: allFacts.batches,
  on_reserved_gd: allFacts.reserved.map((r) => ({ ...r, plant_id: plantId })),
  handling_unit_atu7sreg_sub: allFacts.hu.map((m, i) => ({ id: 'hu' + i, material_id: m, is_deleted: 0 })),
  bin_location: allFacts.bins,
  picking_setup: fx.picking_setup,
};
const dbCalls = {};
const leafOk = (row, leaf) => {
  const v = row[leaf.prop];
  if (leaf.prop === 'is_deleted') return true;
  if (leaf.operator === 'in') return (leaf.value || []).map(String).includes(s(v));
  if (leaf.operator === 'equal' || leaf.operator === 'numberEqual') return s(v) === s(leaf.value);
  throw new Error('mock db: operator ' + leaf.operator);
};
const ruleOk = (row, rule) => (rule.type === 'branch' ? (rule.operator === 'all' ? rule.children.every((c) => ruleOk(row, c)) : rule.children.some((c) => ruleOk(row, c))) : leafOk(row, rule));
globalThis.db = {
  collection(name) {
    const preds = [];
    const q = {
      where(obj) { preds.push((row) => Object.entries(obj).every(([k, v]) => k === 'is_deleted' || s(row[k]) === s(v))); return q; },
      filter(rules) { preds.push((row) => rules.every((r) => ruleOk(row, r))); return q; },
      field() { return q; }, limit() { return q; }, skip() { return q; }, orderBy() { return q; },
      async get() {
        dbCalls[name] = (dbCalls[name] || 0) + 1;
        if (!tables[name]) throw new Error('mock db: no table ' + name);
        await new Promise((r) => setTimeout(r, 0));
        return { data: JSON.parse(JSON.stringify(tables[name].filter((row) => preds.every((p) => p(row))))) };
      },
    };
    return q;
  },
};
globalThis.window = {};

// the mock form
const values = { plant_id: plantId, organization_id: organizationId, table_gd: [], customer_name: '', reference_type: '', page_status: 'Add' };
const getPath = (path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), values);
const setPath = (path, v) => {
  const ks = String(path).split('.');
  let o = values;
  for (const k of ks.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[ks[ks.length - 1]] = v;
};
const log = { setData: [], disabled: [], dialogs: [], alerts: [], messages: [], wfCalls: 0, wfBad: [] };
let finish;
const done = new Promise((r) => { finish = r; });
const ctx = {
  getValue: (p) => JSON.parse(JSON.stringify(getPath(p) ?? null)),
  getValues: () => JSON.parse(JSON.stringify(values)),
  async setData(obj) { log.setData.push(JSON.parse(JSON.stringify(obj))); for (const [k, v] of Object.entries(obj)) setPath(k, JSON.parse(JSON.stringify(v))); },
  disabled(paths, flag) { log.disabled.push([flag, [...(Array.isArray(paths) ? paths : [paths])].sort()]); },
  display() {}, hide() {},
  showLoading() {}, hideLoading() { finish(); },
  openDialog(n) { log.dialogs.push(n); },
  async $alert(m) { log.alerts.push(String(m)); }, async $confirm() {},
  $message: { error: (m) => log.messages.push(['error', m]), warning: (m) => log.messages.push(['warning', m]), success() {}, info() {} },
  getVarSystem: () => organizationId, getVarGlobal: () => organizationId,
  getComponent: () => ({ hideChildRecord() {}, showChildRecord() {} }),
  runWorkflow(id, params, ok, err) {
    log.wfCalls += 1;
    setTimeout(() => {
      if (String(id) !== STOCK_CHECK) return err({ message: 'unknown workflow ' + id });
      if (process.env.HARNESS_STOCK_FAIL) return err({ message: 'GD_STOCK_CHECK down (harness)' });
      const mats = s(params.material_ids) ? s(params.material_ids).split(',') : [];
      const lines = s(params.so_line_ids) ? s(params.so_line_ids).split(',') : [];
      if (mats.length > 50 || lines.length > 50) { log.wfBad.push([mats.length, lines.length]); return ok({ data: { result_code: 'GD_VALIDATION_FAILED', result_message: 'over 50' } }); }
      if (s(params.plant_id) !== plantId || s(params.organization_id) !== organizationId) log.wfBad.push(['scope', params.plant_id, params.organization_id]);
      const M = new Set(mats), L = new Set(lines);
      const sub = {
        items: R.items.filter((r) => M.has(s(r.id)) && s(r.id) !== s(process.env.HARNESS_DROP_ITEM)), uom: R.uom.filter((r) => M.has(s(r.item_id))), pack: R.pack.filter((r) => M.has(s(r.item_id))),
        balances: R.balances.filter((r) => M.has(s(r.material_id))), batches: R.batches.filter((r) => M.has(s(r.material_id))),
        reserved: R.reserved.filter((r) => L.has(s(r.parent_line_id))), hu: R.hu.filter((r) => M.has(s(r.material_id))),
      };
      ok({ data: stockPack(guardOf(mats, lines), sub) });
    }, 5);
  },
};

// deterministic clock and randomness, so both runs mint the same keys in the same order
let tick = 1760000000000;
Date.now = () => (tick += 1);
let seed = 7;
Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const realLog = console.log, realErr = console.error;
const noise = [];
console.log = (...a) => { if (String(a[0]).startsWith('GD V2 stock check') || String(a[0]).startsWith('GD V2:') && !String(a[0]).includes('answered')) noise.push(a.map(String).join(' ').slice(0, 200)); };
console.error = (...a) => noise.push('ERR ' + a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 300));

const t0 = process.hrtime.bigint();
const twice = Number(process.env.HARNESS_TWICE || 0);
if (twice) {
  const first = fx.item_array.map((so) => ({ ...so, table_so: so.table_so.slice(0, twice) }));
  new Function(code).call(ctx, { referenceType: 'Document', itemArray: first });
  await done;
  await new Promise((r) => setTimeout(r, 50));
  values.customer_name = fx.so.customer_id;
  values.reference_type = 'Document';
}
const second = new Promise((r) => { finish = r; });
new Function(code).call(ctx, { referenceType: 'Document', itemArray: fx.item_array });
let timer;
const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('no hideLoading within 300 s')), 300000); });
try {
  await Promise.race([second, timeout]);
  await new Promise((r) => setTimeout(r, 50));
} finally {
  clearTimeout(timer);
  console.log = realLog; console.error = realErr;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
fs.writeFileSync(outPath, JSON.stringify({ ...log, dbCalls, notes: noise, ms }));
const rows = (log.setData.find((x) => Array.isArray(x.table_gd) && x.split_policy !== undefined) || {}).table_gd || [];
console.log(`${handlerPath.split('/').pop()}: ${log.setData.length} setData, ${rows.length} rows after the stock check, db reads ${JSON.stringify(dbCalls)}, ` +
  `GD_STOCK_CHECK calls ${log.wfCalls}${log.wfBad.length ? ' BAD ' + JSON.stringify(log.wfBad) : ''}, dialogs ${JSON.stringify(log.dialogs)}, alerts ${log.alerts.length}, ${ms.toFixed(0)} ms`);
for (const n of noise.slice(0, 6)) console.log('   ' + n);
