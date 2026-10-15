// PO form, Phase 1b: old (dev v848) vs new (built repo form) handlers on the same inputs, in the mock form / db.
// usage: node po_form_compare.js <fixtures_dir> [--only <step>] [--big] [--cascade none|fire|both]
"use strict";
const fs = require("fs");
const path = require("path");
const { makeDb, makeForm, compileForm, eventMaps, settle, install, clone, Filter, timers } = require("./mock");

const out = (...a) => process.stdout.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
console.log = () => {};
console.warn = () => {};
console.error = () => {};
const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(String(e && e.message ? e.message : e)));

const FX = process.argv[2];
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const ONLY = arg("--only", null);
const BIG = process.argv.includes("--big");
const CASCADES = arg("--cascade", "both") === "both" ? ["none", "fire"] : [arg("--cascade")];
const H = path.join(__dirname, "..");
const fx = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), "utf8"));

const OLD_FORM = JSON.parse(fs.readFileSync(path.join(H, "po_form_v848.json"), "utf8"));
const NEW_FORM = JSON.parse(fs.readFileSync(path.join(H, "..", "..", "Purchase Order", "POfullJSON.json"), "utf8"));
const SIDES = {
  old: { compiled: compileForm(OLD_FORM, Filter), maps: eventMaps(OLD_FORM) },
  new: { compiled: compileForm(NEW_FORM, Filter), maps: eventMaps(NEW_FORM) },
};

let fails = 0;
const check = (label, cond, extra) => {
  out((cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

// ------------------------------------------------------------------ fixtures
const ITEMS = fx("items.json").items;
const BIG_IDS = fx("items.json").big_ids;
const BUNDLES = fx("bundles.json");
const SUPP = fx("suppliers.json");
const ACC = fx("acc.json");
const POS = {};
for (const f of fs.readdirSync(FX).filter((f) => /^po_\d+\.json$/.test(f))) {
  const po = fx(f);
  POS[po.purchase_order_no] = po;
}
const PO50 = POS["PO/20261009/001"];
const PO10 = POS["PO/20260709/021"];
const POB = POS["PO/20260922/032"];
const PO2K = POS["PO/20261015/007"];

const PRICE_WF = "2067818102244966401";
// same request / response; live A/B on dev 2026-10-15: 12/12 PO requests identical
const PRICE_WF_BULK = "2110564019682578434";

// GET_ITEM_UNIT_PRICE as the dev v52 workflow answers (rules: history, price tag, default; an item whose UOM has no
// conversion row is left out), with history / price tags configured per test
function priceWorkflow(items, { history = {}, tags = {}, reject = null } = {}) {
  return (id, params) => {
    if (id !== PRICE_WF && id !== PRICE_WF_BULK) return { code: 200, data: {} };
    if (reject) return { __reject: reject };
    const data = [];
    for (const line of params.item_data || []) {
      const it = items[line.item_id];
      if (!it) continue;
      const uom = (it.table_uom_conversion || []).find((u) => String(u.alt_uom_id) === String(line.uom_id));
      const h = history[line.item_id + "|" + params.supp_cust_id];
      const tag = tags[line.item_id + "|" + params.supp_cust_id];
      if (h && uom) {
        data.push({ ...line, from: "Purchase History", unit_price: h.unit_price || line.unit_price || 0, from_historical: 1, max_price: parseFloat(uom.purchase_max_price || 0), min_price: parseFloat(uom.purchase_min_price || 0), max_qty: parseFloat(uom.max_purchase_qty || 0), min_qty: parseFloat(uom.min_purchase_qty || 0) });
      } else if (tag && uom) {
        data.push({ ...line, from: "Price Tag", use_price_tag: true, unit_price: tag.unit_price || line.unit_price || 0, from_historical: 0, max_price: tag.max_price || 0, min_price: tag.min_price || 0, min_qty: parseFloat(uom.min_purchase_qty || 0), max_qty: parseFloat(uom.max_purchase_qty || 0), quantity: parseFloat(line.quantity || 0), discount: tag.discount || line.discount || 0, discount_uom: tag.discount_type || line.discount_uom, tax_rate: tag.tax || line.tax_rate, tax_percent: tag.tax_percent || line.tax_percent });
      } else if (uom) {
        data.push({ ...line, from: "Default Purchase Unit Price", use_price_tag: false, unit_price: uom.purchase_unit_price || line.unit_price || 0, from_historical: 0, max_price: uom.purchase_max_price || 0, min_price: uom.purchase_min_price || 0, min_qty: uom.min_purchase_qty || 0, max_qty: uom.max_purchase_qty || 0, quantity: parseFloat(line.quantity || 0), discount: line.discount || 0, discount_uom: line.discount_uom, tax_rate: uom.mat_purchase_tax_id || line.tax_rate, tax_percent: uom.purchase_tax_percent || line.tax_percent });
      }
    }
    const r4 = (v) => (v === undefined || v === null || v === "" || isNaN(parseFloat(v)) ? null : Math.round(parseFloat(v) * 10000) / 10000);
    let need = data.some((d) => d.use_price_tag === true);
    for (const d of data) {
      const w = (params.item_data || []).find((x) => x.item_id === d.item_id && x.line_index === d.line_index);
      if (!w) continue;
      if (r4(d.unit_price) !== r4(w.unit_price) && r4(d.unit_price) !== 0) need = true;
      if (r4(d.discount) !== r4(w.discount)) need = true;
      if ((d.discount_uom || null) !== (w.discount_uom || null)) need = true;
      if (r4(d.tax_rate) !== r4(w.tax_rate)) need = true;
      if (r4(d.tax_percent) !== r4(w.tax_percent)) need = true;
    }
    return JSON.parse(JSON.stringify({ code: 200, data: { data, needOverwrite: need ? "Yes" : "No" }, msg: "ok", success: true }));
  };
}

function baseTables(extra = {}) {
  return {
    Item: ITEMS,
    item_bundle: BUNDLES,
    accounting_integration: ACC,
    currency: SUPP.currency,
    supplier_head: SUPP.suppliers,
    address_purpose: [{ id: "AP1", purpose_name: "Shipping" }],
    plant_address: [],
    country: [],
    state: [],
    ...extra,
  };
}

// ------------------------------------------------------------------ running
async function waitIdle(form, dbApi, maxMs = 120000) {
  let last = "";
  let stable = 0;
  const t0 = Date.now();
  for (;;) {
    await settle(timers.pending.size ? 10 : 2);
    const s = JSON.stringify(form.__snapshot().counts) + dbApi.log.length + "/" + timers.pending.size;
    if (s === last && timers.pending.size === 0) {
      if (++stable >= 4) return;
    } else stable = 0;
    last = s;
    if (Date.now() - t0 > maxMs) throw new Error("never idle");
  }
}

async function run(side, models, opt = {}) {
  const dbApi = makeDb(opt.tables || baseTables(), { latency: opt.latency || 0 });
  install(dbApi);
  const S = SIDES[side];
  const form = makeForm(models, {
    mode: opt.mode || "Edit",
    compiled: S.compiled,
    columnEvents: S.maps.columns,
    headerEvents: S.maps.header,
    cascade: opt.cascade || "none",
    db: dbApi.db,
    globals: { deptParentId: "0", nickname: "tester", ...(opt.globals || {}) },
    system: { deptIds: String(models.organization_id || "1"), ...(opt.system || {}) },
    params: opt.params || {},
    workflow: opt.workflow,
    wfLatency: opt.wfLatency || 0,
    confirm: opt.confirm,
  });
  unhandled.length = 0;
  const t0 = process.hrtime.bigint();
  if (opt.before) await opt.before(form);
  const ret = opt.action(form);
  if (ret && typeof ret.then === "function") await ret.catch((e) => form.__errors.push("action: " + e.message));
  await waitIdle(form, dbApi, opt.maxMs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { form, snap: form.__snapshot(), db: { ...dbApi.counts.c }, maxInflight: dbApi.stats().maxInflight, ms, unhandled: unhandled.slice(), side };
}

// ------------------------------------------------------------------ normalising + comparing
const STATE_COLS = ["item_id", "item_name", "quantity_uom", "unit_price", "discount", "discount_uom", "tax_preference", "tax_percent", "tax_inclusive"];
const colExpr = (maps, model) => (maps.tableColumns.find((c) => c.model === model) || { options: {} }).options.disabled;
const evalDisabled = (expr, row, form) => {
  if (typeof expr === "boolean") return expr;
  const m = /^\{\{([\s\S]*)\}\}$/.exec(String(expr || "").trim());
  if (!m) return !!expr;
  try {
    const r = new Function("args", "return " + m[1]).call(form, { row, index: 0 });
    return !!(typeof r === "function" ? r() : r);
  } catch (e) {
    return false;
  }
};

// rows in tree order with their position path; new keys differ between old and new runs, so rows are matched by position
function walkRows(rows, fn, prefix = "") {
  (rows || []).forEach((r, i) => {
    const p = prefix ? `${prefix}.children.${i}` : String(i);
    fn(r, p);
    walkRows(r.children, fn, p);
  });
}

function canon(r, opt = {}) {
  const snap = r.snap;
  const keyToPos = {};
  walkRows(snap.models.table_po, (row, p) => (keyToPos[row.fm_key] = p));
  const strip = (row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "fm_key" || k === "parent_fm_key" || k === "children") continue;
      if ((opt.ignore || []).includes(k)) continue;
      if (v === undefined) continue;
      o[k] = v;
    }
    if (row.children) o.children = row.children.map(strip);
    return o;
  };
  const header = {};
  for (const [k, v] of Object.entries(snap.models)) if (k !== "table_po" && v !== undefined) header[k] = v;
  const states = {};
  const S = SIDES[r.side];
  walkRows(snap.models.table_po, (row, p) => {
    STATE_COLS.forEach((c) => {
      const explicit = snap.disabledState["table_po.#" + row.fm_key + "." + c];
      states[p + "." + c] = explicit !== undefined ? explicit : evalDisabled(colExpr(S.maps, c), row, r.form);
    });
  });
  const otherStates = {};
  for (const [k, v] of Object.entries(snap.disabledState)) if (!k.startsWith("table_po.#")) otherStates[k] = v;
  const childHidden = snap.childHidden.map(([keys, flag, o]) => [keys.map((k) => keyToPos[k] || "?" + k), flag, o]);
  return { rows: (snap.models.table_po || []).map(strip), header, states, otherStates, shown: snap.shown, messages: snap.messages, dialogs: snap.dialogs, childHidden, errors: snap.errors };
}

function diffObj(a, b, pathPrefix = "", out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) === !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach((k) => diffObj(a[k], b[k], pathPrefix ? pathPrefix + "." + k : k, out));
    return out;
  }
  out.push([pathPrefix, a, b]);
  return out;
}

function sameOutcome(label, A, B, opt = {}) {
  const ca = canon(A, opt);
  const cb = canon(B, opt);
  const parts = ["rows", "header", "states", "otherStates", "shown", "messages", "dialogs", "childHidden", "errors"];
  const diffs = {};
  parts.forEach((p) => {
    const d = diffObj(ca[p], cb[p]).filter((x) => !(opt.allow || (() => false))(p, x));
    if (d.length) diffs[p] = d;
  });
  const ok = Object.keys(diffs).length === 0;
  check(label, ok, `rows ${ca.rows.length}` + (opt.note ? "; " + opt.note : ""));
  if (!ok) {
    for (const [p, d] of Object.entries(diffs)) out(`   ${p} (${d.length}):`, JSON.stringify(d.slice(0, 6)).slice(0, 900));
  }
  return { ok, diffs, ca, cb };
}

const fmtCounts = (r) => {
  const c = r.snap.counts;
  const d = r.db;
  const item = Object.entries(d).filter(([k]) => k.startsWith("Item:") && !k.includes("Ids")).map(([k, v]) => `${k.slice(5)}=${v}`).join(" ");
  const onChange = Object.entries(c).filter(([k]) => k.startsWith("onChange:")).reduce((s, [, v]) => s + v, 0);
  return [
    `db=${d.total || 0} (Item ${item || "0"}${d["Item:maxInIds"] ? ", max ids/query " + d["Item:maxInIds"] : ""})`,
    `wf=${c.runWorkflow || 0} (${c["runWorkflow.items"] || 0} items)`,
    `setData=${c.setData || 0} (row-path keys ${c["setData.rowPathKeys"] || 0}, whole table ${c["setData.wholeTable"] || 0})`,
    `getValues=${c.getValues || 0}`,
    `disabled=${c.disabled || 0} (${c["disabled.paths"] || 0} paths, state copies ${c.stateCopies || 0})`,
    `refreshOptions=${c.refreshFieldOptionData || 0} (${c["refreshFieldOptionData.paths"] || 0} paths)`,
    `triggerEvent=${c.triggerEvent || 0}`,
    `POcalculation calls=${c["run:POcalculation"] || 0} (computed ${c["calc:POcalculation"] || 0})`,
    `cascade onChange=${onChange}`,
    `row scans=${c.scan || 0}`,
    `table refreshes=${c.tableWatcherRuns || 0}`,
    `${r.ms.toFixed(0)} ms`,
  ].join(", ");
};

module.exports = { run, sameOutcome, fmtCounts, check, out, canon, diffObj, walkRows, priceWorkflow, baseTables, SIDES, ITEMS, BIG_IDS, BUNDLES, SUPP, ACC, POS, PO50, PO10, POB, PO2K, PRICE_WF, CASCADES, BIG, ONLY, clone, fails: () => fails };

// ------------------------------------------------------------------ scenarios
const STEPS = {};

// alt_uom as PO_SAVE stores it (one JSON layer, four keys): what both sides send on save
const altUomSaved = (v) => {
  if (v === undefined || v === null || v === "") return v;
  try {
    let x = v;
    for (let i = 0; i < 64 && typeof x === "string"; i++) x = JSON.parse(x);
    const keep = (c) => (c && typeof c === "object" ? { alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id } : c);
    return JSON.stringify(Array.isArray(x) ? x.map(keep) : keep(x));
  } catch (e) {
    return v;
  }
};

const asLoaded = (po, patch = {}) => ({ ...clone(po), page_status: undefined, ...patch });

STEPS.mounted = async () => {
  out("\n== mounted — old (per-line LineItem_onChange_fillback + option refresh) vs new");
  const cases = [
    ["Edit Issued, 50 lines", asLoaded(PO50), "Edit"],
    ["Edit Draft, bundles (nested)", asLoaded(POB, { po_status: "Draft" }), "Edit"],
    ["View Completed, 10 lines", asLoaded(PO10, { po_status: "Completed" }), "View"],
    ["Clone, 10 lines", asLoaded(PO10), "Clone"],
    ["Add, empty", { table_po: [], organization_id: PO50.organization_id }, "Add"],
  ];
  // alt_uom shapes as stored on prod: layered, '', NULL, 'null'
  cases[0][1].table_po[0].alt_uom = JSON.stringify(JSON.stringify(cases[0][1].table_po[0].alt_uom));
  cases[0][1].table_po[1].alt_uom = "";
  cases[0][1].table_po[2].alt_uom = null;
  cases[0][1].table_po[3].alt_uom = "null";
  if (BIG) cases.push(["Edit Issued, 2,000 lines", asLoaded(PO2K), "Edit"]);
  for (const [label, models, mode] of cases) {
    for (const cascade of CASCADES) {
      const A = await run("old", models, { mode, cascade, action: (f) => f.__run("mounted") });
      const B = await run("new", models, { mode, cascade, action: (f) => f.__run("mounted") });
      sameOutcome(`${label} [cascade ${cascade}]: identical except alt_uom`, A, B, { ignore: ["alt_uom"] });
      // the alt_uom each side would save (PO_SAVE / onClick_save_* normalise it to one layer)
      const saved = (r) => {
        const o = [];
        walkRows(r.snap.models.table_po, (row) => o.push(altUomSaved(row.alt_uom)));
        return o;
      };
      const sa = saved(A);
      const sb = saved(B);
      const differ = sa.map((v, i) => [i, v, sb[i]]).filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b));
      const grew = [];
      walkRows(A.snap.models.table_po, (row, p) => {
        const before = (function find(rows, pp) {
          let hit;
          walkRows(rows, (r2, p2) => (p2 === pp ? (hit = r2) : 0));
          return hit;
        })(models.table_po, p);
        if (before && typeof before.alt_uom === "string" && row.alt_uom !== before.alt_uom) grew.push(p);
      });
      check(`${label} [cascade ${cascade}]: new keeps alt_uom as loaded`, (() => {
        let same = true;
        walkRows(B.snap.models.table_po, (row, p) => {
          let before;
          walkRows(models.table_po, (r2, p2) => (p2 === p ? (before = r2) : 0));
          if (before && JSON.stringify(before.alt_uom) !== JSON.stringify(row.alt_uom)) same = false;
        });
        return same;
      })(), `old re-encoded ${grew.length} lines; saved alt_uom differs on ${differ.length} lines ${JSON.stringify(differ.slice(0, 4)).slice(0, 300)}`);
      if (cascade === CASCADES[0]) {
        out("   old: " + fmtCounts(A));
        out("   new: " + fmtCounts(B));
      }
    }
  }
};


// deterministic pseudo-random
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function mutate(models, seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const m = clone(models);
  m.exchange_rate = pick([0, 1, 4.2, null, "3.5"]);
  walkRows(m.table_po, (row) => {
    if (r() < 0.8) row.quantity = pick([0, 1, 2, 3.5, 10, 12, "4", null, undefined]);
    if (r() < 0.8) row.unit_price = pick([0, 1.25, 9.99, 100, "12.5", null]);
    if (r() < 0.6) row.discount = pick([0, 1, 5, 50, 100000, "2", null]);
    if (r() < 0.6) row.discount_uom = pick(["Amount", "%", "", null, undefined]);
    if (r() < 0.6) row.tax_percent = pick([0, 6, 10, "8", "", null]);
    if (r() < 0.5) row.tax_inclusive = pick([0, 1, null]);
    if (r() < 0.2) delete row.gross;
  });
  return m;
}

// the bundle PO with its children as flat rows of their own (by parent_id, by parent_fm_key only, or both)
function flatten(po, how) {
  const m = clone(po);
  const rows = [];
  m.table_po.forEach((row) => {
    const kids = row.children || [];
    delete row.children;
    rows.push(row);
    kids.forEach((k) => {
      if (how === "fm_key") {
        delete k.parent_id;
        k.parent_fm_key = row.id;
      }
      rows.push(k);
    });
  });
  m.table_po = rows;
  return m;
}

const calcEdit = (row) => ({ value: row && row.quantity, row, rowIndex: 0, field: "quantity" });

STEPS.calc = async () => {
  out("\n== POcalculation — old vs new on identical tables (random amounts, discounts, tax, bundles nested / flat)");
  const bases = [["50 lines", PO50], ["10 lines tax+disc", PO10], ["bundles nested", POB], ["bundles flat by parent_id", flatten(POB, "id")], ["bundles flat by parent_fm_key", flatten(POB, "fm_key")]];
  for (const cascade of CASCADES) {
    let same = 0;
    let total = 0;
    let calcSame = 0;
    const firstDiff = [];
    for (const [label, base] of bases) {
      for (let seed = 1; seed <= 40; seed++) {
        const models = mutate(asLoaded(base), seed * 7919 + label.length);
        const A = await run("old", models, { cascade, action: (f) => f.__run("POcalculation", calcEdit(f.models.table_po[0])) });
        const B = await run("new", models, { cascade, action: (f) => f.__run("POcalculation", calcEdit(f.models.table_po[0])) });
        const ca = canon(A);
        const cb = canon(B);
        const d = ["rows", "header", "shown", "states", "errors"].flatMap((p) => diffObj(ca[p], cb[p]).map((x) => [p, ...x]));
        total++;
        if (!d.length) same++;
        else if (firstDiff.length < 3) firstDiff.push([label, seed, d.slice(0, 4)]);
        // calc mode: the same rows costed in place + the returned header, written in one go
        const C = await run("new", models, {
          cascade,
          action: async (f) => {
            const rows = clone(f.models.table_po);
            const header = f.triggerEvent("POcalculation", { calcRows: rows });
            await f.setData({ table_po: rows, ...header });
          },
        });
        const cc = canon(C);
        const dc = ["rows", "header", "shown", "errors"].flatMap((p) => diffObj(ca[p], cc[p]).map((x) => [p, ...x]));
        if (!dc.length) calcSame++;
        else if (firstDiff.length < 6) firstDiff.push(["calc-mode " + label, seed, dc.slice(0, 4)]);
      }
    }
    check(`[cascade ${cascade}] live recalculation identical on ${same}/${total} tables`, same === total);
    check(`[cascade ${cascade}] calc mode (rows + returned header in one write) identical on ${calcSame}/${total} tables`, calcSame === total);
    firstDiff.forEach((x) => out("   ", JSON.stringify(x).slice(0, 700)));
  }

  out("\n== POcalculation — one quantity edit, then the same edit with a bundle, at 50 / 2,000 lines");
  for (const [label, base] of BIG ? [["50 lines", PO50], ["2,000 lines", PO2K]] : [["50 lines", PO50]]) {
    const models = asLoaded(base);
    walkRows(models.table_po, (row, p) => {
      row.quantity = 5;
      row.unit_price = 2;
      row.gross = 10;
      row.po_amount = 10;
      row.discount_amount = 0;
      row.tax_amount = 0;
    });
    models.po_total = 10 * models.table_po.length;
    const edit = async (f) => {
      const row = f.models.table_po[3];
      row.quantity = 7; // the platform has written the typed value, then runs the column's onChange
      const r = f.__run("POcalculation", { value: 7, row, rowIndex: 3, field: "quantity" });
      if (r && r.then) await r;
    };
    for (const cascade of CASCADES) {
      const A = await run("old", models, { cascade, action: edit });
      const B = await run("new", models, { cascade, action: edit });
      sameOutcome(`${label}, quantity edit [cascade ${cascade}]`, A, B);
      if (cascade === CASCADES[0]) {
        out("   old: " + fmtCounts(A) + `, rows cloned ${A.snap.counts["getValues.rows"] || 0}`);
        out("   new: " + fmtCounts(B) + `, rows cloned ${B.snap.counts["getValues.rows"] || 0}`);
      }
    }
  }
};


// Item copies with every trait the line build reads: a purchase-default alt UOM with its own price / tax / limits, a
// header-level purchase tax, a supplier description binding, min / max quantities.
function traitItems(ids, supplierId) {
  const items = {};
  ids.forEach((id, i) => {
    const it = clone(ITEMS[id]);
    const base = it.table_uom_conversion.find((u) => u.alt_uom_id === it.based_uom) || it.table_uom_conversion[0];
    if (base) {
      base.purchase_unit_price = i % 3 ? 10 + (i % 17) : base.purchase_unit_price;
      if (i % 4 === 0) Object.assign(base, { mat_purchase_tax_id: "TAX-SST", purchase_tax_percent: 6 });
      if (i % 9 === 0) Object.assign(base, { min_purchase_qty: 2, max_purchase_qty: 50, purchase_min_price: 1, purchase_max_price: 99 });
    }
    if (i % 7 === 0) {
      it.table_uom_conversion.push({ alt_uom_id: "ALT-BOX-" + i, alt_qty: 1, base_qty: 12, base_uom_id: it.based_uom, purchase_default_uom: 1,
        purchase_unit_price: 120 + i, mat_purchase_tax_id: i % 14 === 0 ? "TAX-SST" : null, purchase_tax_percent: i % 14 === 0 ? 6 : null,
        min_purchase_qty: 1, max_purchase_qty: 10, purchase_min_price: 100, purchase_max_price: 500 });
    }
    if (i % 5 === 0) it.mat_purchase_tax_id = "TAX-HDR";
    if (i % 11 === 0) it.table_sup_item_bind = [{ supplier_id: "OTHER", item_description: "not ours" }, { supplier_id: supplierId, item_description: "Supplier text " + i }];
    if (i % 6 === 0) it.further_description = "<p>more " + i + "</p>";
    items[id] = it;
  });
  return items;
}

// item_array entries as the Batch Add page builds them on each of its paths
const SHAPES = {
  click: ["id", "material_code", "material_name", "material_desc", "based_uom", "purchase_default_uom", "purchase_unit_price", "table_uom_conversion", "mat_purchase_tax_id", "item_category", "purchase_tax_percent", "item_batch_management", "stock_control", "further_description", "table_sup_item_bind"],
  codes: ["id", "material_code", "material_name", "material_desc", "based_uom", "table_uom_conversion", "item_category", "item_batch_management", "stock_control", "serial_number_management", "further_description"],
  header: ["id", "material_code", "material_name", "material_desc", "based_uom", "table_uom_conversion", "item_category", "item_batch_management", "stock_control", "table_sup_item_bind"],
};
const asPicked = (it, shape) => Object.fromEntries(SHAPES[shape].map((k) => [k, clone(it[k])]));

function priceSetup(items, supplierId) {
  const history = {};
  const tags = {};
  Object.keys(items).forEach((id, i) => {
    if (i % 3 === 0) history[id + "|" + supplierId] = { unit_price: 7.5 + i };
    else if (i % 8 === 1) tags[id + "|" + supplierId] = { unit_price: 4.4, max_price: 9, min_price: 1, discount: 1, discount_type: "Amount", tax: "TAX-TAG", tax_percent: 8 };
  });
  return { history, tags };
}

STEPS.batchAdd = async () => {
  out("\n== Batch Add confirm — old vs new (rows, prices, totals, cell states, messages)");
  const supplier = PO50.po_supplier_id;
  const sizes = BIG ? [50, 2000] : [50];
  for (const n of sizes) {
    const ids = BIG_IDS.slice(0, n);
    const items = traitItems(ids, supplier);
    const tables = baseTables({ Item: { ...ITEMS, ...items } });
    const wf = priceWorkflow({ ...ITEMS, ...items }, priceSetup(items, supplier));
    for (const [existing, shape] of [[0, "click"], [50, "codes"], [50, "header"]]) {
      if (n === 2000 && shape !== "click") continue;
      const models = asLoaded(PO50, { po_status: "Draft", table_po: existing ? clone(PO50.table_po).slice(0, existing) : [] });
      const itemArray = ids.map((id) => asPicked(items[id], shape));
      const oldRuns = {};
      for (const cascade of CASCADES) {
        const opt = { cascade, tables, workflow: wf, action: (f) => f.__run("onConfirm_batchAddItem", { itemArray: clone(itemArray) }) };
        // the old handlers' cascade at 2,000 lines is the storm itself (minutes in the mock): compared without it
        const oldCascade = n > 200 ? "none" : cascade;
        const A = oldRuns[oldCascade] || (oldRuns[oldCascade] = await run("old", models, { ...opt, cascade: oldCascade }));
        const B = await run("new", models, opt);
        sameOutcome(`${n} items (${shape} shape) onto ${existing} lines [cascade old ${oldCascade} / new ${cascade}]`, A, B);
        if (cascade === CASCADES[0] || n <= 200) {
          if (oldCascade === cascade) out("   old: " + fmtCounts(A));
          out("   new: " + fmtCounts(B));
        }
      }
    }
  }
  out("\n== Batch Add — price lookup failure, empty selection, an item without a usable UOM row");
  {
    const ids = BIG_IDS.slice(0, 20);
    const items = traitItems(ids, supplier);
    const tables = baseTables({ Item: { ...ITEMS, ...items } });
    const models = asLoaded(PO50, { po_status: "Draft", table_po: clone(PO50.table_po).slice(0, 5) });
    const itemArray = ids.map((id) => asPicked(items[id], "click"));
    const variants = [
      ["workflow 401", { workflow: priceWorkflow(items, { reject: { data: { code: 401, msg: "Validation Error:<br><br>Plant ID is required." } } }) }, itemArray],
      ["empty selection", { workflow: priceWorkflow(items) }, []],
      ["no base / default UOM row", { workflow: priceWorkflow(items) }, itemArray.map((x, i) => (i === 3 ? { ...x, table_uom_conversion: [] } : x))],
    ];
    for (const [label, o, arr] of variants) {
      const opt = { cascade: "none", tables, ...o, action: (f) => f.__run("onConfirm_batchAddItem", { itemArray: clone(arr) }) };
      const A = await run("old", models, opt);
      const B = await run("new", models, opt);
      sameOutcome(`${label}`, A, B, { note: `unhandled old ${A.unhandled.length} / new ${B.unhandled.length}` });
    }
  }
};


STEPS.bundles = async () => {
  out("\n== Batch Add Bundle confirm — old vs new");
  const list = Object.values(BUNDLES);
  const small = list.filter((b) => b.tenant_id === "000000");
  const big = list.filter((b) => b.tenant_id === "711077" && b.table_ib.length >= 400).slice(0, 4);
  const pk = list.filter((b) => b.tenant_id === "711077" && b.table_ib.length < 10).slice(0, 2);
  const org711 = PO2K.organization_id;
  const cases = [
    ["3 small bundles onto the bundle PO", asLoaded(POB, { po_status: "Draft" }), small, POB.organization_id],
    ["same bundle twice + a missing id", asLoaded(POB, { po_status: "Draft" }), [small[0], small[0], { id: "999", ib_no: "gone" }], POB.organization_id],
  ];
  if (BIG) cases.push([`4 bundles of ~485 lines + 2 small (${big.reduce((n, b) => n + b.table_ib.length, 0) + pk.reduce((n, b) => n + b.table_ib.length, 0)} children)`, asLoaded(PO2K, { po_status: "Draft", table_po: [] }), [...big, ...pk], org711]);
  for (const [label, models, bundles, org] of cases) {
    const children = bundles.reduce((n, b) => n + ((b.table_ib && b.table_ib.length) || 0), 0);
    const itemArray = bundles.map((b) => ({ id: b.id, ib_no: b.ib_no }));
    const oldRuns = {};
    for (const cascade of CASCADES) {
      const opt = { cascade, system: { deptIds: org }, action: (f) => f.__run("onConfirm_batchAddItemBundle", { itemArray: clone(itemArray) }) };
      const oldCascade = children > 200 ? "none" : cascade;
      const A = oldRuns[oldCascade] || (oldRuns[oldCascade] = await run("old", { ...models, organization_id: org }, { ...opt, cascade: oldCascade }));
      const B = await run("new", { ...models, organization_id: org }, opt);
      sameOutcome(`${label} [cascade old ${oldCascade} / new ${cascade}]`, A, B);
      if (cascade === CASCADES[0]) {
        out("   old: " + fmtCounts(A));
        out("   new: " + fmtCounts(B));
      }
    }
  }
};


STEPS.supplier = async () => {
  out("\n== Supplier change (Overwrite / Keep / close; needOverwrite Yes / No) — old vs new");
  const bases = [["50 lines", PO50], ["bundles", POB]];
  if (BIG) bases.push(["2,000 lines", PO2K]);
  for (const [label, po] of bases) {
    const tenant = po.tenant_id;
    const sups = SUPP.suppliers.filter((x) => x.tenant_id === tenant && String(x.id) !== String(po.po_supplier_id));
    const cur = (id) => SUPP.currency.find((c) => String(c.id) === String(id));
    const foreign = sups.find((x) => cur(x.currency_id) && !["MYR", "----"].includes(cur(x.currency_id).currency_code));
    const local = sups.find((x) => cur(x.currency_id) && ["MYR", "----"].includes(cur(x.currency_id).currency_code)) || sups[0];
    const newSup = foreign || local;
    const ids = [];
    walkRows(po.table_po, (r) => r.item_id && ids.push(r.item_id));
    const items = traitItems([...new Set(ids)], newSup.id);
    const tables = baseTables({ Item: { ...ITEMS, ...items } });
    const lines = (po.table_po || []).length;
    for (const need of ["auto", "No"]) {
      const base = priceWorkflow({ ...ITEMS, ...items }, priceSetup(items, newSup.id));
      const workflow = need === "auto" ? base : (id, params) => {
        const r = base(id, params);
        if (r.data) r.data.needOverwrite = "No";
        return r;
      };
      for (const answer of ["confirm", "cancel", "close"]) {
        const models = asLoaded(po, { po_status: "Draft", po_supplier_id: newSup.id });
        const args = { value: newSup.id, fieldModel: { item: { currency_id: newSup.currency_id, supplier_payment_term_id: newSup.supplier_payment_term_id, price_tag_id: newSup.price_tag_id } } };
        const oldRuns = {};
        for (const cascade of CASCADES) {
          const opt = { cascade, tables, workflow, confirm: () => answer, action: (f) => f.__run("POnumber_onChange_fillback_currency", clone(args)) };
          const oldCascade = lines > 200 ? "none" : cascade;
          const A = oldRuns[oldCascade] || (oldRuns[oldCascade] = await run("old", models, { ...opt, cascade: oldCascade }));
          const B = await run("new", models, opt);
          sameOutcome(`${label}, needOverwrite ${need}, ${answer} [cascade old ${oldCascade} / new ${cascade}]`, A, B, { note: `currency ${cur(newSup.currency_id) ? cur(newSup.currency_id).currency_code : "-"}` });
          if (cascade === CASCADES[0] && answer === "confirm" && need === "auto") {
            out("   old: " + fmtCounts(A));
            out("   new: " + fmtCounts(B));
          }
        }
      }
    }
  }
};


// a table whose derived fields are already consistent (as after a save), with tax on every line
function costed(po, patch = {}) {
  const m = asLoaded(po, { po_status: "Draft", ...patch });
  walkRows(m.table_po, (row, p) => {
    row.quantity = 3 + (Number(p.split(".")[0]) % 4);
    row.unit_price = 10;
    row.tax_preference = "TAX-SST";
    row.tax_percent = 6;
    row.tax_inclusive = 0;
    row.discount = 0;
  });
  return m;
}

async function settleCalc(side, models) {
  // the stored amounts, as the last save left them
  const r = await run(side, models, { action: (f) => f.__run("POcalculation") });
  return clone(r.snap.models);
}

STEPS.tax = async () => {
  out("\n== Tax handlers — old vs new");
  for (const [label, po] of BIG ? [["50 lines", PO50], ["2,000 lines", PO2K]] : [["50 lines", PO50]]) {
    const lines = po.table_po.length;
    const start = await settleCalc("old", costed(po));
    // Tax Rate picked on one line: the old refreshes the whole column's options, the new only that line's
    for (const cascade of CASCADES) {
      const edit = (f) => {
        const row = f.models.table_po[4];
        row.tax_percent = 10;
        return f.__run("onChange_tax_percent", { value: 10, row, rowIndex: 4, field: "tax_percent" });
      };
      const A = await run("old", start, { cascade, action: edit });
      const B = await run("new", start, { cascade, action: edit });
      sameOutcome(`${label}: Tax Rate edited on one line [cascade ${cascade}]`, A, B);
      if (cascade === CASCADES[0]) {
        out("   old: " + fmtCounts(A) + `, column refreshes ${A.snap.counts["refreshFieldOptionData.columnPaths"] || 0}`);
        out("   new: " + fmtCounts(B) + `, column refreshes ${B.snap.counts["refreshFieldOptionData.columnPaths"] || 0}`);
      }
    }
    // Tax Inclusive ticked on one line. The sync (every line follows) is keyed on "AutoCount Accounting V2" now; dev v848
    // keyed it on the legacy "AutoCount Accounting" (user 2026-10-15: V2 is the integration in use). So the new run
    // under each type is compared with the old run under the type that must behave the same.
    const sameType = (part, [k]) => part === "header" && k === "acc_integration_type";
    for (const [acc, oldAcc] of [["SQL Accounting V2", "SQL Accounting V2"], ["AutoCount Accounting V2", "AutoCount Accounting"], ["AutoCount Accounting", "SQL Accounting V2"]]) {
      const models = { ...start, acc_integration_type: acc };
      const oldModels = { ...start, acc_integration_type: oldAcc };
      const synced = acc === "AutoCount Accounting V2";
      for (const cascade of CASCADES) {
        const edit = (f) => {
          const row = f.models.table_po[2];
          row.tax_inclusive = 1;
          return f.__run("onChange_taxInclusive", { value: 1, row, rowIndex: 2, field: "tax_inclusive" });
        };
        const oldCascade = lines > 200 && synced ? "none" : cascade;
        const A = await run("old", oldModels, { cascade: oldCascade, action: edit });
        const B = await run("new", models, { cascade, action: edit });
        if (synced && oldCascade === "none") {
          // Deliberate: the old costs the table before its own write of the other lines lands, so their tax stays on
          // the old basis. The reference is a fresh recalculation of the synced table (= the old with a cascade).
          const truth = await run("old", { ...B.snap.models, acc_integration_type: oldAcc }, { action: (f) => f.__run("POcalculation") });
          sameOutcome(`${label}: Tax Inclusive ticked, AutoCount V2 [new ${cascade}] = a fresh recalculation of the synced lines`, truth, B, { allow: sameType });
          const res = sameOutcome(`${label}: Tax Inclusive ticked, AutoCount V2 [old none] differs only in the amounts it left stale`, A, B, {
            allow: (part, [k]) => (part === "rows" && /\.(tax_amount|po_amount)$/.test(k)) || (part === "header" && /^(po_total|po_total_tax|myr_total_amount|acc_integration_type)$/.test(k)),
          });
          const stale = diffObj(canon(A).rows, canon(B).rows).length;
          out(`   old left ${stale} line amounts stale (${diffObj(canon(A).header, canon(B).header).map(([k]) => k).join(", ")} too)`);
        } else {
          sameOutcome(`${label}: Tax Inclusive ticked, ${acc} = old under ${oldAcc} [cascade old ${oldCascade} / new ${cascade}]`, A, B, { allow: sameType });
        }
        if (cascade === CASCADES[0]) {
          out("   old: " + fmtCounts(A));
          out("   new: " + fmtCounts(B));
        }
      }
    }
  }
};

STEPS.plant = async () => {
  out("\n== onChange_plant — old vs new");
  const tables = baseTables({
    plant_address: [
      { id: "PA1", plant_id: PO50.po_plant, is_default: 1, plant_purpose: "AP1", address_line_1: "1 Jalan", address_city: "KL", address_postal_code: "50000", address_country_id: "C1", address_state: "S1", address_name: "Main", address_phone: "03" },
      { id: "PA2", plant_id: PO50.po_plant, is_default: 1, plant_purpose: "AP2", address_line_1: "2 Jalan,", address_city: "PJ" },
    ],
    country: [{ id: "C1", country_name: "Malaysia" }],
    state: [{ id: "S1", state_name: "Selangor" }],
  });
  for (const [label, po] of BIG ? [["50 lines", PO50], ["2,000 lines", PO2K]] : [["50 lines", PO50]]) {
    const models = asLoaded(po, { po_plant: PO50.po_plant });
    const A = await run("old", models, { tables, action: (f) => f.__run("onChange_plant", { value: PO50.po_plant }) });
    const B = await run("new", models, { tables, action: (f) => f.__run("onChange_plant", { value: PO50.po_plant }) });
    sameOutcome(`${label}: plant chosen`, A, B, { note: `getValues rows cloned: old ${A.snap.counts["getValues.rows"] || 0}, new ${B.snap.counts["getValues.rows"] || 0}` });
  }
};


STEPS.perLine = async () => {
  out("\n== Unchanged per-line handlers that now reach the new POcalculation — old vs new");
  const ids = [];
  walkRows(PO50.table_po, (r) => r.item_id && ids.push(r.item_id));
  const items = traitItems([...new Set(ids)], PO50.po_supplier_id);
  const allItems = { ...ITEMS, ...items };
  const tables = baseTables({
    Item: allItems,
    purchase_order_2ukyuanr_sub: PO50.table_po.map((r) => ({ ...r, unit_price: 3.3, quantity: 4 })),
  });
  const wf = priceWorkflow(allItems, priceSetup(items, PO50.po_supplier_id));
  const start = await settleCalc("old", costed(PO50));
  const startB = await settleCalc("old", costed(POB));
  const pickItem = Object.values(items)[7];
  const cases = [
    ["item picked on a line (reset + price lookup)", start, (f) => {
      const row = f.models.table_po[5];
      row.item_id = pickItem.id;
      return f.__run("LineItem_onChange_fillback", { value: pickItem.id, row, rowIndex: 5, field: "item_id", fieldModel: { item: clone(pickItem) } });
    }],
    ["item code cleared on a line", start, (f) => {
      const row = f.models.table_po[6];
      row.item_id = "";
      return f.__run("LineItem_onChange_fillback", { value: "", row, rowIndex: 6, field: "item_id" });
    }],
    ["quantity blur, normal line from the default price (Multipricing confirm)", start, (f) => {
      const row = f.models.table_po[8];
      row.quantity = 9;
      row.from_historical = 0;
      return f.__run("onBlur_quantity", { value: 9, row, rowIndex: 8, field: "quantity" });
    }],
    ["bundle parent quantity -> children spread", startB, (f) => {
      const row = f.models.table_po[0];
      row.quantity = 3;
      return f.__run("onBlur_quantity", { value: 3, row, rowIndex: 0, field: "quantity" });
    }],
    ["bundle child quantity -> ratio", startB, (f) => {
      const row = f.models.table_po[0].children[1];
      row.quantity = 5;
      return f.__run("onBlur_quantity", { value: 5, row, rowIndex: 0, field: "quantity" });
    }],
    ["row removed", start, (f) => {
      f.models.table_po.splice(10, 1);
      return f.__run("onRowRemove_item", { removeIndex: 10 });
    }],
    ["price history applied (2 lines added)", start, (f) => f.__run("onConfirm_applyPriceHistory", { selectedRecords: [{ id: PO50.table_po[0].id, quantity: 2, unit_price: 5 }, { id: PO50.table_po[1].id, quantity: 1, unit_price: 7 }] })],
    ["line price history applied", start, (f) => f.__run("onConfirm_applyLinePriceHistory", { selectedRecords: [{ id: PO50.table_po[2].id, quantity: 6, unit_price: 8 }], rowIndex: f.models.table_po[4].fm_key })],
    ["Tax Code cleared on a line", start, (f) => {
      const row = f.models.table_po[3];
      row.tax_preference = "";
      return f.__run("onChange_tax_rate", { value: "", row, rowIndex: 3, field: "tax_preference" });
    }],
  ];
  for (const [label, models, action] of cases) {
    for (const cascade of CASCADES) {
      for (const answer of label.includes("Multipricing") ? ["confirm", "cancel"] : ["confirm"]) {
        const opt = { cascade, tables, workflow: wf, confirm: () => answer, action };
        const A = await run("old", models, opt);
        const B = await run("new", models, opt);
        sameOutcome(`${label}${answer === "cancel" ? " (Keep)" : ""} [cascade ${cascade}]`, A, B, { note: `POcalculation computed old ${A.snap.counts["calc:POcalculation"] || 0} / new ${B.snap.counts["calc:POcalculation"] || 0}` });
      }
    }
  }
};


STEPS.storm = async () => {
  out("\n== Batch Add with the platform cascade: how the old grows (the 2,000-item run does not finish in the mock)");
  const supplier = PO50.po_supplier_id;
  for (const n of [25, 50, 100, 200]) {
    const ids = BIG_IDS.slice(0, n);
    const items = traitItems(ids, supplier);
    const tables = baseTables({ Item: { ...ITEMS, ...items } });
    const wf = priceWorkflow({ ...ITEMS, ...items }, priceSetup(items, supplier));
    const models = asLoaded(PO50, { po_status: "Draft", table_po: [] });
    const itemArray = ids.map((id) => asPicked(items[id], "click"));
    const opt = { cascade: "fire", tables, workflow: wf, action: (f) => f.__run("onConfirm_batchAddItem", { itemArray: clone(itemArray) }) };
    const A = await run("old", models, opt);
    const B = await run("new", models, opt);
    const ok = sameOutcome(`${n} items [cascade fire]`, A, B).ok;
    const line = (r) => `POcalculation computed ${r.snap.counts["calc:POcalculation"] || 0}, rows cloned ${r.snap.counts["getValues.rows"] || 0}, row-path keys ${r.snap.counts["setData.rowPathKeys"] || 0}, row scans ${r.snap.counts.scan || 0}, ${r.ms.toFixed(0)} ms`;
    out(`   old: ${line(A)}`);
    out(`   new: ${line(B)}`);
  }
};


STEPS.legacyIssue = async () => {
  out("\n== onClick_2jyomatr (legacy client Issue save, wired to no button) — the line-check dialog, old vs new");
  const base = asLoaded(PO10, { po_status: "Draft", page_status: "Edit" });
  const names = [["plain names", (n) => n], ["names with HTML", (n, i) => (i === 1 ? `<img src=x onerror="alert('x')"> & Co` : n)]];
  for (const [label, name] of names) {
    const models = clone(base);
    models.table_po.forEach((r, i) => {
      r.item_name = name(r.item_name, i);
      if (i < 3) r.quantity = 0;
    });
    models.table_po.push({ item_id: "", item_desc: "", item_name: "", quantity: 2 });
    const opt = { confirm: () => "cancel", action: (f) => f.__run("onClick_2jyomatr") };
    const A = await run("old", models, opt);
    const B = await run("new", models, opt);
    const msg = (r) => r.snap.messages.find((m) => m.startsWith("confirm")) || "";
    if (label === "plain names") sameOutcome(`${label}: identical (cancelled at the line check)`, A, B);
    else {
      check(`${label}: new escapes the item name in the HTML dialog`, !/<img/.test(msg(B)) && /&lt;img src=x onerror=&quot;alert\(&#39;x&#39;\)&quot;&gt; &amp; Co/.test(msg(B)) && /<img/.test(msg(A)),
        `old: ${msg(A).slice(80, 230)} | new: ${msg(B).slice(80, 260)}`);
    }
  }
};

if (require.main === module) {
  (async () => {
    for (const [name, fn] of Object.entries(STEPS)) {
      if (ONLY && ONLY !== name) continue;
      await fn();
    }
    out("\nfailures:", fails);
    process.exit(fails ? 1 : 0);
  })().catch((e) => {
    process.stderr.write(String(e && e.stack) + "\n");
    process.exit(2);
  });
}
