// SC form at 2,000 lines (Phase C): the base v497 mounted (Stock Count / Review modes) and Sync against the built ones, on a
// STATEFUL form: setData writes values (row paths and whole tables), disabled keeps a flag per path, and a row-path write of
// adjusted_qty runs onAdjustedQtyChange as the platform does. Same final table, intended flags, far fewer platform calls.
// Sync is checked under both platform behaviours of a whole-table write: no onChange (A) and onChange per changed row (B).
//   node test/test_sc_2k.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.scFormBase);
const BUILT = H.readJSON(H.FILES.scForm);
const fn = (doc, name) => H.sourceOf(H.byName(doc, name));
const ADJ_CHANGE = fn(BASE, "onAdjustedQtyChange");

const pathGet = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const pathSet = (o, p, v) => {
  const ks = p.split(".");
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]];
  a[ks[ks.length - 1]] = v;
};

function stateful(w, values, opts) {
  opts = opts || {};
  const flags = {};
  const calls = { setData: 0, disabled: 0, rowPathWrites: 0, onChange: 0 };
  const self = {
    models: {},
    isAdd: false, isEdit: !opts.view, isView: !!opts.view,
    getValue: (k) => H.clone(pathGet(values, k)),
    getValues: () => H.clone(values),
    setData: async (o) => {
      calls.setData++;
      const fired = [];
      for (const [k, v] of Object.entries(o)) {
        const m = /^table_stock_count\.(\d+)\.(\w+)$/.exec(k);
        if (m) {
          calls.rowPathWrites++;
          pathSet(values, k, H.clone(v));
          if (m[2] === "adjusted_qty") fired.push({ value: v, rowIndex: Number(m[1]) });
        } else if (k === "table_stock_count" && opts.wholeTableFires) {
          const before = values.table_stock_count || [];
          values.table_stock_count = H.clone(v);
          v.forEach((row, i) => {
            if (!before[i] || before[i].adjusted_qty !== row.adjusted_qty) fired.push({ value: row.adjusted_qty, rowIndex: i });
          });
        } else {
          values[k] = H.clone(v);
        }
      }
      for (const a of fired) {
        calls.onChange++;
        await H.compile(w, ADJ_CHANGE, false).call(self, a);
      }
    },
    disabled: (f, v) => {
      calls.disabled++;
      for (const p of Array.isArray(f) ? f : [f]) flags[p] = v;
    },
    display: () => {}, hide: () => {}, showLoading: () => {}, hideLoading: () => w.rec("hideLoading"),
    getVarGlobal: () => "1001", getVarSystem: () => "2002", getParamsVariables: (k) => (opts.params || {})[k],
    onDropdownVisible: () => Promise.resolve({}), getComponent: () => ({ options: {} }), getOptionData: () => [], setOptionData: () => {},
    runWorkflow: () => {},
    $message: { success: (x) => w.rec("msg.success", x), warning: (x) => w.rec("msg.warning", x), error: (x) => w.rec("msg.error", x), info: () => {} },
    $alert: () => Promise.resolve(),
    parentGenerateForm: { refresh: () => {} },
  };
  return { self, flags, calls };
}

async function run(code, values, opts) {
  const w = H.world({ db: opts && opts.db });
  const s = stateful(w, values, opts);
  H.compile(w, code, false).call(s.self);
  await H.drain(w);
  return Object.assign(s, { values: values, trace: w.trace });
}

const STATUSES = ["Pending", "Counted", "Approved", "Adjusted", "Recount", "Recounted", "Cancel"];
const line = (i) => ({
  id: String(80000 + i), line_index: i + 1, material_id: "M" + (i % 700), location_id: "L" + (i % 37), batch_id: i % 50 === 0 ? "B" + (i % 3) : null,
  plant_id: "P1", count_qty: (i * 7) % 23, system_qty: (i * 5) % 19, adjusted_qty: i % 9 === 0 ? null : (i % 5) - 2, variance_qty: 0,
  line_status: STATUSES[i % STATUSES.length], review_status: i % 4 === 0 ? "Approved" : "", is_counted: 1, balance_distribution: "", variance_percentage: "",
});
const doc = (n, o) => Object.assign({ id: "500", plant_id: "P1", organization_id: "O1", blind_count: 0, count_type: "Location", table_stock_count: Array.from({ length: n }, (_, i) => line(i)) }, o || {});

(async () => {
  const N = 2000;
  const oldMounted = fn(BASE, "mounted");
  const newMounted = fn(BUILT, "mounted");

  // Stock Count mode, In Progress, Recount review
  for (const [scStatus, reviewStatus] of [["In Progress", "Recount"], ["In Progress", "To Be Reviewed"], ["Completed", "Recount"]]) {
    const tag = "count mode " + scStatus + "/" + reviewStatus;
    const o = await run(oldMounted, doc(N, { stock_count_status: scStatus, review_status: reviewStatus }), { params: { is_stock_count: 1 } });
    const n = await run(newMounted, doc(N, { stock_count_status: scStatus, review_status: reviewStatus }), { params: { is_stock_count: 1 } });
    check(tag + ": same final table", same(o.values.table_stock_count, n.values.table_stock_count));
    const rows = n.values.table_stock_count;
    if (scStatus === "In Progress") {
      check(tag + ": Approved / Adjusted lines left the table", !rows.some((r) => r.line_status === "Approved" || r.line_status === "Adjusted") && rows.length < N, rows.length);
      check(tag + ": every remaining line's count_qty enabled", rows.every((r, i) => n.flags[`table_stock_count.${i}.count_qty`] === false));
      const oldWrong = rows.filter((r, i) => o.flags[`table_stock_count.${i}.count_qty`] !== false).length;
      console.log("  (" + tag + ": the base left " + oldWrong + " remaining line(s) locked - flags set by index before the lines were removed)");
    }
    if (reviewStatus === "Recount") check(tag + ": Recount lines unlocked (is_counted 0)", rows.filter((r) => r.line_status === "Recount").every((r) => r.is_counted === 0));
    check(tag + ": platform calls " + o.calls.disabled + " disabled + " + o.calls.setData + " setData -> " + n.calls.disabled + " + " + n.calls.setData,
      // mounted itself: page_status + previous_status writes and 2 column-level disabled calls; the block adds 1 + 1
      n.calls.disabled <= 3 && n.calls.setData <= 3 && n.calls.rowPathWrites === 0, n.calls);
  }

  // Review mode
  for (const scStatus of ["In Progress", "Completed"]) {
    const tag = "review mode " + scStatus;
    const o = await run(oldMounted, doc(N, { stock_count_status: scStatus, review_status: "In Review" }), { params: { is_review: 1 } });
    const n = await run(newMounted, doc(N, { stock_count_status: scStatus, review_status: "In Review" }), { params: { is_review: 1 } });
    check(tag + ": same final table", same(o.values.table_stock_count, n.values.table_stock_count));
    const rows = n.values.table_stock_count;
    check(tag + ": Recounted lines' review_status cleared", rows.filter((r) => r.line_status === "Recounted").every((r) => r.review_status === ""));
    let bad = 0;
    rows.forEach((r, i) => {
      for (const f of ["review_status", "adjusted_qty", "review_sub_button"]) {
        let want = scStatus === "In Progress" ? r.line_status === "Pending" : undefined;
        if (f === "adjusted_qty" && r.line_status === "Adjusted") want = true;
        if (n.flags[`table_stock_count.${i}.${f}`] !== want) bad++;
      }
    });
    check(tag + ": flags = Pending locked, others open, Adjusted adjusted_qty locked", bad === 0, bad);
    const oldAdj = rows.filter((r, i) => r.line_status === "Adjusted" && o.flags[`table_stock_count.${i}.adjusted_qty`] !== true).length;
    console.log("  (" + tag + ": the base left adjusted_qty open on " + oldAdj + " Adjusted line(s) - its two loops raced)");
    check(tag + ": platform calls " + o.calls.disabled + " disabled + " + o.calls.setData + " setData -> " + n.calls.disabled + " + " + n.calls.setData,
      // mounted itself: 1 column-level disabled call + 2 writes; the block adds at most 3 + 1
      n.calls.disabled <= 4 && n.calls.setData <= 3 && n.calls.rowPathWrites === 0, n.calls);
  }

  // Sync: balances for most lines (some at other bins / plants, some missing), batch lines from item_batch_balance
  const lines = doc(N).table_stock_count;
  const balances = [];
  const batchBalances = [];
  lines.forEach((l, i) => {
    if (i % 41 === 0) return; // no balance row
    const row = { material_id: l.material_id, location_id: l.location_id, plant_id: "P1", organization_id: "O1", is_deleted: 0, balance_quantity: (i * 3) % 29,
      unrestricted_qty: (i * 3) % 29, reserved_qty: i % 7 === 0 ? 2 : 0, block_qty: i % 11 === 0 ? 1 : 0, qualityinsp_qty: 0, intransit_qty: i % 13 === 0 ? 3 : 0 };
    if (l.batch_id) batchBalances.push(Object.assign({ batch_id: l.batch_id }, row));
    else balances.push(row);
  });
  balances.push({ material_id: "M1", location_id: "L1", plant_id: "P9", organization_id: "O1", is_deleted: 0, balance_quantity: 999 });
  const match = (rows, f) => rows.filter((r) => f(r));
  const leafOk = (r, c) => (c.operator === "in" ? c.value.map(String).includes(String(r[c.prop])) : String(r[c.prop]) === String(c.value));
  const branchOk = (r, b) => (b.type === "branch" ? (b.operator === "any" ? b.children.some((c) => branchOk(r, c)) : b.children.every((c) => branchOk(r, c))) : leafOk(r, b));
  let reads = 0;
  const db = (collection, q) => {
    reads++;
    const src = collection === "item_batch_balance" ? batchBalances : balances;
    let out = match(src, (r) => (q.filter || []).every((b) => branchOk(r, b)));
    if (q.limit) out = out.slice(0, q.limit);
    return { data: out };
  };
  const oldSync = fn(BASE, "onClick_syncAll");
  const newSync = fn(BUILT, "onClick_syncAll");
  reads = 0;
  const o = await run(oldSync, doc(N), { db: db });
  const oldReads = reads;
  for (const fires of [false, true]) {
    reads = 0;
    const n = await run(newSync, doc(N), { db: db, wholeTableFires: fires });
    const tag = "Sync (whole-table write " + (fires ? "fires onChange" : "fires nothing") + ")";
    check(tag + ": same final table as the base (row paths + onAdjustedQtyChange)", same(o.values.table_stock_count, n.values.table_stock_count),
      (() => {
        const a = o.values.table_stock_count, b = n.values.table_stock_count;
        const i = a.findIndex((r, k) => !same(r, b[k]));
        return i < 0 ? null : { i, base: a[i], built: b[i] };
      })());
    check(tag + ": same message", same(o.trace.filter((t) => /^msg\./.test(t[0])), n.trace.filter((t) => /^msg\./.test(t[0]))));
    // B: the onChange runs (only rows whose adjusted_qty changed) write their own 2 paths each, as they would on the platform
    check(tag + ": 1 table write (base: " + o.calls.rowPathWrites + " row paths, " + o.calls.onChange + " onChange runs) -> " + n.calls.onChange + " onChange runs",
      n.calls.setData === 1 + n.calls.onChange && n.calls.rowPathWrites === 2 * n.calls.onChange && (fires ? n.calls.onChange < o.calls.onChange : n.calls.onChange === 0), n.calls);
    console.log("  (" + tag + ": reads " + oldReads + " OR-filter queries -> " + reads + " chunked IN queries with .limit)");
  }
  // a capped answer is re-read per material; a deleted balance row is never used
  {
    let calls = 0;
    const capped = (collection, q) => {
      calls++;
      const ids = q.filter[0].children[0].value;
      const out = db(collection, q).data;
      return { data: ids.length > 1 ? out.concat(Array.from({ length: q.limit - out.length }, () => ({ material_id: "X", location_id: "X", plant_id: "P1" }))) : out };
    };
    const n = await run(newSync, doc(N), { db: capped });
    check("Sync: a capped chunk is re-read per material and gives the same table", same(o.values.table_stock_count, n.values.table_stock_count) && calls > 40, calls);
    const del = (collection, q) => {
      const r = db(collection, q);
      if ((q.filter || []).some((b) => b.children && b.children.some((c) => c.prop === "is_deleted" && c.value === 0))) return r;
      return { data: [{ material_id: "M0", location_id: "L0", plant_id: "P1", is_deleted: 1, balance_quantity: 12345 }].concat(r.data) };
    };
    const d = await run(newSync, doc(N), { db: del });
    check("Sync: reads only is_deleted 0 rows", !JSON.stringify(d.values.table_stock_count).includes("12345"));
  }
  // an empty table and a read error both hide the loading mask (the base left it showing)
  {
    const e = await run(newSync, doc(0), { db: db });
    check("Sync: empty table hides the loading mask", e.trace.some((t) => t[0] === "hideLoading"));
    const x = await run(newSync, doc(5), { db: () => { throw new Error("read failed"); } });
    check("Sync: a read error hides the loading mask and reports", x.trace.some((t) => t[0] === "hideLoading") && x.trace.some((t) => t[0] === "msg.error"));
  }
  H.done("test_sc_2k");
})();
