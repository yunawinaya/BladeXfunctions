// GR form, Phase 2: old (dev v1472) vs new handlers on the same input, in the mock form/db.
// usage: node gr_form_compare.js <fixtures_dir> [--only <name>] [--big]
"use strict";
const fs = require("fs");
const path = require("path");
const { makeDb, makeForm, runCode, runValidator, settle, install, clone } = require("./mock");

// the handlers log whole tables; keep only the harness's own output
const out = (...a) => process.stdout.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
console.log = () => {};
console.warn = () => {};

const FX = process.argv[2];
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const BIG = process.argv.includes("--big");
const H = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(H, rel), "utf8");
const fx = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), "utf8"));

const OLD = {
  func_processGRLineItem: read("dev_handlers/func_processGRLineItem__z2qm43hg.js"),
  mounted: read("dev_handlers/mounted__mounted.js"),
  onChange_received_qty: read("dev_handlers/onChange_received_qty__xtp37jq1.js"),
  onChange_base_received_qty: read("dev_handlers/onChange_base_received_qty__vsq65nr3.js"),
  validator: read("dev_handlers/validator_received_qty.js"),
  onRowRemove_item: read("dev_handlers/onRowRemove_item__r1kz3acd.js"),
};
const NEW = {
  func_processGRLineItem: read("new_handlers/func_processGRLineItem.js"),
  mounted: read("new_handlers/mounted.js"),
  onChange_received_qty: read("new_handlers/onChange_received_qty.js"),
  onChange_base_received_qty: read("new_handlers/onChange_base_received_qty.js"),
  validator: read("new_handlers/validator_received_qty.js"),
  onRowRemove_item: read("new_handlers/onRowRemove_item.js"),
};
const SHARED = {
  onChange_plant: read("dev_handlers/onChange_plant__zug6defe.js"),
  onChange_Supplier: read("dev_handlers/onChange_Supplier__j8wra669.js"),
};
const PO_MAP = read("PoGrMap_new.js");

// column defaults (options.disabled) of table_gr in the dev form (old) and the built form (new)
const tableColumns = (form) => form.list[9].tabs[0].list[0].tableColumns;
const OLD_COLS = tableColumns(JSON.parse(read("gr_form_v1472.json")));
const NEW_COLS = tableColumns(JSON.parse(fs.readFileSync(path.join(H, "..", "..", "..", "Goods Receiving", "GRfullJSON.json"), "utf8")));
const STATE_COLS = ["item_batch_no", "manufacturing_date", "expired_date", "select_serial_number", "received_qty", "base_received_qty", "button_formula", "storage_location_id", "location_id", "inv_category"];
const columnDefault = (cols, model, row) => {
  const d = cols.find((c) => c.model === model).options.disabled;
  if (typeof d === "boolean") return d;
  const m = /^\{\{([\s\S]*)\}\}$/.exec(String(d || "").trim());
  if (!m) return !!d;
  try {
    return !!new Function("return (" + m[1] + ");")({ row });
  } catch (e) {
    return false;
  }
};
// what each cell shows: the explicit runtime state if one was written, else the column's own default
function effectiveStates(snap, cols) {
  const out = {};
  const visit = (row) => {
    STATE_COLS.forEach((c) => {
      const explicit = snap.disabledState["table_gr.#" + row.fm_key + "." + c];
      out[row.fm_key + "." + c] = explicit !== undefined ? explicit : columnDefault(cols, c, row);
    });
    (row.children || []).forEach(visit);
  };
  (snap.models.table_gr || []).forEach(visit);
  return out;
}

let fails = 0;
const report = [];
const check = (label, cond, extra) => {
  const line = (cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : "");
  out(line);
  if (!cond) fails++;
};

// ------------------------------------------------------------------ fixtures -> inputs
const BASE_PO = fx("po_50.json");
const BASE_ITEMS = fx("items_50.json");
const PLANT = fx("plant.json");
const PLANT_ID = PLANT.plant_id;
const CATS = PLANT.inventory_category.map((c) => ({ ...c, code: "inventory_category" }));

function convertPO(po) {
  const vm = {
    "node:search_node_PoGrGetAll.data.data": [po],
    "workflowparams:po_ids": [po.id],
    "workflowparams:is_multiple": "single",
    "workflowparams:plant_id": PLANT_ID,
    "workflowparams:received_by": "tester",
  };
  const src = PO_MAP.replace(/\{\{([^}]+)\}\}/g, (m, k) => JSON.stringify(vm[k]));
  const out = new Function(src)();
  if (out.result_code !== 200) throw new Error("convert failed " + out.message);
  return out.grData;
}

// Item trait overrides so every branch of the line build runs (the dev tenant's own items have no inspection,
// serial or formula items).
function mixedTraits(po, items) {
  const lineItem = (i) => items[po.table_po[i].item_id];
  const set = (i, patch) => {
    const it = lineItem(i);
    if (it) Object.assign(it, patch);
  };
  set(0, { receiving_inspection: 1 });
  set(1, { serial_number_management: 1 });
  set(2, { formula: "qty*2" });
  set(3, { item_batch_management: 1, batch_number_genaration: "Manual" });
  set(4, { item_batch_management: 1, batch_number_genaration: "According To System Settings" });
  set(5, { table_default_bin: [{ plant_id: PLANT_ID, bin_location: "BIN-ITEM", storage_location: "SL-ITEM" }] });
  set(12, { receiving_inspection: 1, item_batch_management: 1, batch_number_genaration: "Manual" });
  const alt = (i, baseQty, tol) => {
    const it = lineItem(i);
    if (!it) return;
    it.table_uom_conversion.push({ alt_qty: 1, alt_uom_id: "ALT-" + i, base_qty: baseQty, base_uom_id: it.based_uom, over_receive_tolerance: tol });
    po.table_po[i].quantity_uom = "ALT-" + i;
  };
  alt(7, 12, 5);
  alt(11, 6, 0);
  po.table_po[11].received_qty = 3;
  po.table_po[11].quantity = 10;
  const t = lineItem(10);
  if (t && t.table_uom_conversion[0]) t.table_uom_conversion[0].over_receive_tolerance = 10;
  po.table_po[9].created_received_qty = po.table_po[9].quantity; // GR qty 0 -> left out
  delete items[po.table_po[6].item_id]; // not in the item master
}

function addBundle(po, items) {
  const ids = Object.keys(items);
  const bundle = { ...clone(po.table_po[0]), id: "B0000000000000000001", item_id: null, item_bundle_id: "BNDL1", quantity: 2, received_qty: 0, created_received_qty: 0 };
  const kid = (n, itemId) => ({ ...clone(po.table_po[0]), id: "B000000000000000000" + (n + 1), item_id: itemId, item_bundle_id: "BNDL1", parent_id: bundle.id, quantity: 4 * n, received_qty: 0, created_received_qty: 0 });
  po.table_po.splice(4, 0, bundle, kid(1, ids[1]), kid(2, ids[2]));
}

function scenario({ traits = "plain", putaway = null, defaults = false, bundle = false, po = BASE_PO, items = BASE_ITEMS }) {
  const P = clone(po);
  const I = clone(items);
  if (traits === "mixed") mixedTraits(P, I);
  if (bundle) addBundle(P, I);
  const gr = convertPO(P);
  const tables = {
    Item: I,
    purchase_order_2ukyuanr_sub: P.table_po.flatMap((l) => [l, ...(l.children || [])]),
    storage_location: defaults ? [{ id: "SL-DEF", plant_id: PLANT_ID, is_deleted: 0, is_default: 1, location_type: "Common" }] : [],
    bin_location: defaults ? [{ id: "BIN-DEF", storage_location_id: "SL-DEF", plant_id: PLANT_ID, is_default: 1, is_deleted: 0 }] : [],
    putaway_setup: putaway ? [{ id: "PS1", plant_id: PLANT_ID, is_deleted: 0, movement_type: "Good Receiving", ...putaway }] : [],
    blade_dict: CATS,
    accounting_integration: [],
    blade_dept: [],
    supplier_head: [{ id: gr.supplier_name, contact_list: [{ person_name: "A", phone_number: "1" }], currency_id: null, address_list: [] }],
    address_purpose: [{ id: "AP1", purpose_name: "Shipping" }],
    currency: [],
    country: [],
    state: [],
    purchase_order: [],
  };
  return { gr, tables };
}

// ------------------------------------------------------------------ running
async function waitIdle(form, dbApi) {
  let last = "";
  for (let i = 0; i < 4000; i++) {
    await settle(i < 5 ? 60 : 120);
    const now = JSON.stringify(form.__snapshot().counts) + dbApi.log.length;
    if (now === last) return;
    last = now;
  }
  throw new Error("never idle");
}

async function run(code, models, tables, { mode = "Add", args, handlers = {}, latency = 0 } = {}) {
  const dbApi = makeDb(tables, { latency });
  install(dbApi);
  const form = makeForm(models, {
    mode,
    handlers,
    globals: { deptParentId: "0", nickname: "tester" },
    system: { deptIds: String(models.organization_id || "1") },
  });
  globalThis.window.validationState = {};
  runCode(form, code, args);
  await waitIdle(form, dbApi);
  return { form, snap: form.__snapshot(), db: { ...dbApi.counts.c }, maxInflight: dbApi.stats().maxInflight };
}

const stripKeys = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "fm_key" ? undefined : x)));

function diffMaps(a, b) {
  const out = [];
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push([k, a[k], b[k]]);
  });
  return out;
}

function diffRows(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ra = a[i] || {};
    const rb = b[i] || {};
    new Set([...Object.keys(ra), ...Object.keys(rb)]).forEach((k) => {
      if (k === "fm_key") return;
      if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) out.push([i, k, ra[k], rb[k]]);
    });
  }
  return out;
}

// A cell only shows in a visible column; hidden columns (base qty, serial, formula unless displayed) are reported apart.
const visibleCols = (A, B) =>
  new Set(STATE_COLS.filter((c) => !OLD_COLS.find((x) => x.model === c).options.hidden || A.snap.shown["table_gr." + c] || B.snap.shown["table_gr." + c]));

// The serial / formula column expressions also cover lines no handler gave a state to (old: always enabled).
const expressionOnly = (A) => ([k, a, b]) => {
  const [fk, c] = k.split(".");
  return (c === "select_serial_number" || c === "button_formula") && A.snap.disabledState["table_gr.#" + fk + "." + c] === undefined && a === false && b === true;
};

function stateDiff(A, B) {
  const vis = visibleCols(A, B);
  const all = diffMaps(effectiveStates(A.snap, OLD_COLS), effectiveStates(B.snap, NEW_COLS));
  const hidden = all.filter(([k]) => !vis.has(k.split(".")[1]));
  const shown = all.filter(([k]) => vis.has(k.split(".")[1]));
  const byExpression = shown.filter(expressionOnly(A));
  return { hidden, byExpression, real: shown.filter((d) => !expressionOnly(A)(d)) };
}

function sameOutcome(label, A, B, { allowStates = () => false } = {}) {
  const rows = diffRows(A.snap.models.table_gr || [], B.snap.models.table_gr || []);
  const otherModels = diffMaps(
    stripKeys({ ...A.snap.models, table_gr: null, _data: null }),
    stripKeys({ ...B.snap.models, table_gr: null, _data: null }),
  );
  const sd = stateDiff(A, B);
  const dis = sd.real.filter((d) => !allowStates(d));
  const opt = diffMaps(A.snap.optionState, B.snap.optionState);
  const shown = diffMaps(A.snap.shown, B.snap.shown);
  const msgs = JSON.stringify(A.snap.messages) === JSON.stringify(B.snap.messages);
  const ok = !rows.length && !otherModels.length && !dis.length && !opt.length && !shown.length && msgs;
  check(
    label,
    ok,
    `rows ${A.snap.models.table_gr ? A.snap.models.table_gr.length : 0}, cells ${Object.keys(effectiveStates(A.snap, OLD_COLS)).length}, explicit states old ${Object.keys(A.snap.disabledState).length} / new ${Object.keys(B.snap.disabledState).length}, options ${Object.keys(A.snap.optionState).length}` +
      (sd.hidden.length ? `; hidden-column cells differing ${sd.hidden.length} (${[...new Set(sd.hidden.map(([k]) => k.split(".")[1]))]})` : "") +
      (sd.byExpression.length ? `; serial/formula buttons now disabled by the column expression ${sd.byExpression.length}` : ""),
  );
  if (!ok) {
    out("   rows:", JSON.stringify(rows.slice(0, 8)));
    out("   models:", JSON.stringify(otherModels.slice(0, 5)));
    out("   disabled:", JSON.stringify(dis.slice(0, 8)), dis.length);
    out("   options:", JSON.stringify(opt.slice(0, 3)).slice(0, 400), opt.length);
    out("   shown:", JSON.stringify(shown));
    out("   messages:", JSON.stringify(A.snap.messages), JSON.stringify(B.snap.messages));
  }
  return ok;
}

const fmtCounts = (r) => {
  const c = r.snap.counts;
  const d = r.db;
  const item = Object.entries(d).filter(([k]) => k.startsWith("Item")).map(([k, v]) => `${k.replace("Item:", "")}=${v}`).join(" ");
  return [
    `db=${d.total || 0} (Item ${item || "0"}; max in flight ${r.maxInflight})`,
    `getValues=${c.getValues || 0}`,
    `setData=${c.setData || 0} (whole table ${c["setData.wholeTable"] || 0}, row-path keys ${c["setData.rowPathKeys"] || 0})`,
    `disabled=${c.disabled || 0} (${c["disabled.paths"] || 0} paths)`,
    `setOptionData=${c.setOptionData || 0} (${c["setOptionData.paths"] || 0} paths)`,
    `display=${c.display || 0} hide=${c.hide || 0}`,
    `triggerEvent=${c.triggerEvent || 0}`,
  ].join(", ");
};

// ------------------------------------------------------------------ scenarios
async function addEquivalence() {
  out("\n== func_processGRLineItem, Add (Convert to GR single) — old vs new must be identical");
  const variants = [];
  for (const traits of ["plain", "mixed"]) {
    for (const putaway of [null, { putaway_required: 1, category: "In Transit" }, { putaway_required: 1, category: "Unrestricted" }, { putaway_required: 0 }, { putaway_required: null, category: "Unrestricted" }]) {
      for (const defaults of [false, true]) {
        variants.push({ traits, putaway, defaults, bundle: traits === "mixed" });
      }
    }
  }
  for (const v of variants) {
    const { gr, tables } = scenario(v);
    const models = { ...gr, page_status: "Add" };
    const A = await run(OLD.func_processGRLineItem, models, tables);
    const B = await run(NEW.func_processGRLineItem, models, tables);
    sameOutcome(`Add ${v.traits} putaway=${v.putaway ? JSON.stringify(v.putaway) : "none"} defaults=${v.defaults} bundle=${v.bundle}`, A, B);
    if (v === variants[variants.length - 1] || (v.traits === "mixed" && v.putaway && v.putaway.category === "In Transit" && !v.defaults)) {
      out("   old: " + fmtCounts(A));
      out("   new: " + fmtCounts(B));
    }
  }
}

// rows as a multiple-convert Draft reads back from the DB (PO_Convert_GR add-node + platform defaults)
const asStoredRaw = (rows) =>
  rows.map((r) => ({
    parent_or_child: "Parent",
    is_split: "No",
    parent_index: 0,
    inspection_required: "",
    item_batch_no: "",
    base_received_qty: 0,
    to_received_qty: 0,
    inv_category: null,
    base_item_uom: null,
    storage_location_id: null,
    location_id: null,
    uom_conversion: 0,
    item_costing_method: "",
    ...r,
    children: r.children ? asStoredRaw(r.children) : undefined,
  }));

function editModels(gr, rows, status) {
  return {
    ...gr,
    id: "GR-ID-1",
    gr_no: status === "Draft" ? "Draft-GR-1" : "GR-1",
    gr_status: status,
    page_status: "Edit",
    from_convert: "Yes",
    table_gr: rows,
    table_sn_records: [],
    gr_billing_name: "",
  };
}

async function editScenarios() {
  out("\n== mounted Edit — first open of a multiple-convert Draft (lines never enriched): old vs new identical");
  for (const v of [{ traits: "mixed", putaway: { putaway_required: 1, category: "In Transit" }, defaults: true, bundle: true }, { traits: "plain", putaway: null, defaults: false }]) {
    const { gr, tables } = scenario(v);
    const raw = asStoredRaw(gr.table_gr);
    const models = editModels(gr, raw, "Draft");
    const A = await run(OLD.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: OLD.func_processGRLineItem } });
    const B = await run(NEW.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: NEW.func_processGRLineItem } });
    sameOutcome(`Edit raw Draft ${v.traits} putaway=${JSON.stringify(v.putaway)} bundle=${!!v.bundle}`, A, B);
    out("   old: " + fmtCounts(A));
    out("   new: " + fmtCounts(B));
  }

  out("\n== mounted Edit — re-open of a saved converted GR (lines enriched + user edits)");
  for (const status of ["Draft", "Created"]) {
    const v = { traits: "mixed", putaway: { putaway_required: 1, category: "Unrestricted" }, defaults: true, bundle: true };
    const { gr, tables } = scenario(v);
    // what the Add form held after enrichment = what was saved
    const enriched = (await run(NEW.func_processGRLineItem, { ...gr, page_status: "Add" }, tables)).snap.models.table_gr;
    const saved = stripKeys(enriched);
    const manual = saved.findIndex((r) => r.item_batch_no === "" && r.item_id);
    const edits = [
      [1, "location_id", "BIN-USER"],
      [2, "inv_category", "Unrestricted"],
      [manual, "item_batch_no", "B-USER-123"],
      [8, "received_qty", 0.5],
      [10, "storage_location_id", "SL-USER"],
      [3, "to_received_qty", 999],
    ];
    edits.forEach(([i, k, val]) => (saved[i][k] = val));
    // a hierarchy split that the old re-enrich flattened
    saved[13] = { ...saved[13], is_split: "Yes", parent_or_child: "Parent", parent_index: 13 };
    const models = { ...editModels(gr, saved, status), gr_billing_address: "USER BILLING ADDRESS", supplier_contact_person: "USER CONTACT" };
    const A = await run(OLD.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: OLD.func_processGRLineItem } });
    const B = await run(NEW.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: NEW.func_processGRLineItem } });
    const header = (snap) => [snap.models.gr_billing_address, snap.models.supplier_contact_person];
    check(
      `Edit ${status}: saved supplier address / contact kept by new (old re-ran onChange_Supplier)`,
      JSON.stringify(header(B.snap)) === JSON.stringify(["USER BILLING ADDRESS", "USER CONTACT"]),
      `old -> ${JSON.stringify(header(A.snap))}, new -> ${JSON.stringify(header(B.snap))}`,
    );

    const kept = edits.concat([[13, "is_split", "Yes"]]).every(([i, k, val]) => {
      if (k === "to_received_qty") return true; // recomputed from the PO line by fetchReceivedQuantity in both
      return JSON.stringify(B.snap.models.table_gr[i][k]) === JSON.stringify(val);
    });
    const lostOld = edits.concat([[13, "is_split", "Yes"]]).filter(([i, k, val]) => k !== "to_received_qty" && JSON.stringify(A.snap.models.table_gr[i][k]) !== JSON.stringify(val));
    const newVsSaved = diffRows(saved, stripKeys(B.snap.models.table_gr)).filter(([, k]) => k !== "initial_received_qty" && k !== "to_received_qty");
    check(`Edit ${status}: new keeps every saved line field (only initial/to_received_qty refreshed from the PO lines)`, kept && newVsSaved.length === 0, `changed fields: ${newVsSaved.length}`);
    if (newVsSaved.length) out("   ", JSON.stringify(newVsSaved.slice(0, 10)));
    check(`Edit ${status}: old overwrote saved edits (the bug) — ${lostOld.length} of ${edits.length} edits lost`, lostOld.length > 0, JSON.stringify(lostOld.map(([i, k]) => `${i}.${k}`)));
    const recomputed = (snap) => snap.models.table_gr.map((r) => [r.initial_received_qty, r.to_received_qty]);
    const oldTo = diffRows(stripKeys(A.snap.models.table_gr), stripKeys(B.snap.models.table_gr)).filter(([, k]) => k === "to_received_qty").length;
    check(`Edit ${status}: initial_received_qty from the PO lines identical old vs new`, JSON.stringify(recomputed(A.snap).map((x) => x[0])) === JSON.stringify(recomputed(B.snap).map((x) => x[0])), `to_received_qty: old's re-enrich zeroed it on ${oldTo} lines after fetchReceivedQuantity set it; new keeps the PO-line figure`);
    // UI states: old applied them to its re-built rows; new to the saved rows
    const sd = stateDiff(A, B);
    const opt = diffMaps(A.snap.optionState, B.snap.optionState);
    const shown = diffMaps(A.snap.shown, B.snap.shown);
    check(
      `Edit ${status}: visible cell states identical old vs new`,
      sd.real.length === 0 && opt.length === 0 && shown.length === 0,
      `explicit states old ${Object.keys(A.snap.disabledState).length} / new ${Object.keys(B.snap.disabledState).length}; hidden-column cells differing ${sd.hidden.length}; ${JSON.stringify(sd.real.slice(0, 4))}`,
    );
    out("   old: " + fmtCounts(A));
    out("   new: " + fmtCounts(B));
    report.push({ status, sd, opt, shown });
  }

  out("\n== mounted Edit — non-converted GR: old vs new identical");
  {
    const { gr, tables } = scenario({ traits: "mixed", putaway: null, defaults: true });
    const enriched = stripKeys((await run(NEW.func_processGRLineItem, { ...gr, page_status: "Add" }, tables)).snap.models.table_gr);
    for (const status of ["Draft", "Created", "Completed"]) {
      const models = { ...editModels(gr, enriched, status), from_convert: "" };
      const A = await run(OLD.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED } });
      const B = await run(NEW.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED } });
      sameOutcome(`Edit non-converted ${status}`, A, B);
      if (status === "Draft") {
        out("   old: " + fmtCounts(A));
        out("   new: " + fmtCounts(B));
      }
    }
    const models = { ...editModels(gr, enriched, "Completed"), from_convert: "" };
    const A = await run(OLD.mounted, models, tables, { mode: "View", handlers: { ...SHARED } });
    const B = await run(NEW.mounted, models, tables, { mode: "View", handlers: { ...SHARED } });
    sameOutcome("View Completed", A, B);
  }
}

// ------------------------------------------------------------------ quantity handlers + validator
async function qtyScenarios() {
  out("\n== onChange_received_qty / onChange_base_received_qty / received_qty validator — old vs new");
  const { gr, tables } = scenario({ traits: "mixed", putaway: null, defaults: true, bundle: true });
  const built = await run(NEW.func_processGRLineItem, { ...gr, page_status: "Add" }, tables);
  const rows = stripKeys(built.snap.models.table_gr);
  const cache = built.snap.models._data;
  // a hierarchy split: parent + two children
  const split = (i) => {
    rows[i] = { ...rows[i], is_split: "Yes", parent_or_child: "Parent", parent_index: i };
    const kid = (n) => ({ ...rows[i], is_split: "No", parent_or_child: "Child", parent_index: i, received_qty: n, fm_key: undefined });
    rows.splice(i + 1, 0, kid(1), kid(2));
  };
  split(15);
  const baseModels = { ...gr, page_status: "Add", gr_status: "Draft", table_gr: rows };
  const tolItem = rows.findIndex((r) => r.item_id === BASE_PO.table_po[10].item_id);
  const altRow = rows.findIndex((r) => r.uom_conversion > 0);
  const bundleRow = rows.findIndex((r) => r.item_bundle_id && !r.item_id);
  const cases = [];
  for (const i of [0, 1, 3, tolItem, altRow, bundleRow, 15, 16, 17]) {
    if (i < 0) continue;
    for (const value of [1, 5, 9.5, 10, 11, 12.5, 1000, -1, 0]) cases.push([i, value]);
  }

  const runEvent = async (code, models, field, i, value, withCache) => {
    const dbApi = makeDb(tables);
    install(dbApi);
    const form = makeForm(models, { mode: "Add" });
    if (withCache) form.models._data = clone(cache);
    const row = form.models.table_gr[i];
    row[field] = value; // the platform has already written the typed value
    const log = [];
    const setData = form.setData.bind(form);
    form.setData = (o) => {
      log.push(o);
      return setData(o);
    };
    runCode(form, code, { value, rowIndex: i, row, field });
    await waitIdle(form, dbApi);
    return { log: stripKeys(log), msgs: form.__snapshot().messages, db: { ...dbApi.counts.c } };
  };

  for (const [handler, field] of [["onChange_received_qty", "received_qty"], ["onChange_base_received_qty", "base_received_qty"]]) {
    let same = 0;
    const dbOld = { total: 0 };
    const dbNewCached = { total: 0 };
    const dbNewCold = { total: 0 };
    for (const [i, value] of cases) {
      const a = await runEvent(OLD[handler], baseModels, field, i, value, false);
      const b = await runEvent(NEW[handler], baseModels, field, i, value, true);
      const c = await runEvent(NEW[handler], baseModels, field, i, value, false);
      dbOld.total += a.db.total || 0;
      dbNewCached.total += b.db.total || 0;
      dbNewCold.total += c.db.total || 0;
      const ok = JSON.stringify([a.log, a.msgs]) === JSON.stringify([b.log, b.msgs]) && JSON.stringify([a.log, a.msgs]) === JSON.stringify([c.log, c.msgs]);
      if (!ok) {
        out(`   DIFF ${handler} row ${i} value ${value}`, JSON.stringify(a.log), JSON.stringify(b.log), JSON.stringify(c.log), a.msgs, b.msgs);
      } else same++;
    }
    check(`${handler}: ${same}/${cases.length} edits identical (writes + messages)`, same === cases.length, `Item reads: old ${dbOld.total} (unprojected), new ${dbNewCached.total} with the cache, ${dbNewCold.total} without (projected)`);
  }

  // validator: the rule.field the edit path passes (row index) — and the fm_key form a full validate() passes
  let same = 0;
  let total = 0;
  const gv = { old: 0, new: 0 };
  const reads = { old: 0, new: 0 };
  for (const status of ["Draft", "Created"]) {
    for (const [i, value] of cases) {
      const results = [];
      for (const [tag, code] of [["old", OLD.validator], ["new", NEW.validator]]) {
        const dbApi = makeDb(tables);
        install(dbApi);
        globalThis.window.validationState = {};
        const form = makeForm({ ...baseModels, gr_status: status }, { mode: "Edit" });
        if (tag === "new") form.models._data = clone(cache);
        const log = [];
        const setData = form.setData.bind(form);
        form.setData = (o) => {
          log.push(o);
          return setData(o);
        };
        const res = await runValidator(form, code, { field: `table_gr.${i}.received_qty` }, value);
        await waitIdle(form, dbApi);
        gv[tag] += form.__snapshot().counts.getValues || 0;
        reads[tag] += dbApi.counts.get("total");
        results.push(JSON.stringify([res, log, form.__snapshot().messages, globalThis.window.validationState]));
      }
      total++;
      if (results[0] === results[1]) same++;
      else out(`   DIFF validator ${status} row ${i} value ${value}\n     ${results[0]}\n     ${results[1]}`);
    }
  }
  check(`received_qty validator: ${same}/${total} cells identical (callback, writes, messages, validationState)`, same === total, `getValues: old ${gv.old}, new ${gv.new}; Item reads: old ${reads.old}, new ${reads.new}`);

  // the fm_key form (a full-form validate) crashed in the old one; the new one reads the row by key
  {
    const dbApi = makeDb(tables);
    install(dbApi);
    const form = makeForm({ ...baseModels, gr_status: "Draft" }, { mode: "Edit" });
    const key = form.models.table_gr[3].fm_key;
    let oldRes;
    try {
      oldRes = await runValidator(form, OLD.validator, { field: `table_gr.${key}.received_qty` }, 1);
    } catch (e) {
      oldRes = "throws: " + e.message;
    }
    const newRes = await runValidator(form, NEW.validator, { field: `table_gr.${key}.received_qty` }, 1);
    out(`   rule.field by fm_key: old ${oldRes} | new ${newRes}`);
  }
}

async function rowRemoveScenario() {
  out("\n== onRowRemove_item — old vs new final states after removing a line");
  const { gr, tables } = scenario({ traits: "mixed", putaway: null, defaults: true, bundle: true });
  for (const removeIndex of [0, 6, 20]) {
    const results = [];
    for (const [code, processCode] of [[OLD.onRowRemove_item, OLD.func_processGRLineItem], [NEW.onRowRemove_item, NEW.func_processGRLineItem]]) {
      const dbApi = makeDb(tables);
      install(dbApi);
      const form = makeForm({ ...gr, page_status: "Add" }, { mode: "Add" });
      runCode(form, processCode);
      await waitIdle(form, dbApi);
      const before = form.__snapshot().counts;
      form.models.table_gr.splice(removeIndex, 1); // the table removes the row, then calls the handler
      runCode(form, code, { removeIndex });
      await waitIdle(form, dbApi);
      const after = form.__snapshot();
      results.push({ after, calls: (after.counts.disabled || 0) - (before.disabled || 0), paths: (after.counts["disabled.paths"] || 0) - (before["disabled.paths"] || 0) });
    }
    const sd = stateDiff({ snap: results[0].after }, { snap: results[1].after });
    const d = sd.real;
    const onlyBundle = d.every(([k]) => {
      const fk = k.split(".")[0];
      const row = results[1].after.models.table_gr.find((r) => r.fm_key === fk);
      return row && row.item_bundle_id && /base_received_qty$/.test(k);
    });
    const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
    const models = (m) => JSON.stringify(canon(stripKeys({ ...m, _data: null })));
    check(
      `remove line ${removeIndex}: visible states identical except the bundle line's base qty (old re-enabled it, new keeps it locked)`,
      onlyBundle && models(results[0].after.models) === models(results[1].after.models),
      `diff ${JSON.stringify(d)}; disabled calls old ${results[0].calls} (${results[0].paths} paths), new ${results[1].calls} (${results[1].paths} paths)`,
    );
  }
}

// ------------------------------------------------------------------ scale
function bigPO(n) {
  const items = fx("items_2000.json");
  const ids = Object.keys(items).slice(0, n);
  const po = clone(BASE_PO);
  const tmpl = po.table_po[0];
  po.table_po = ids.map((id, k) => ({
    ...clone(tmpl),
    id: "21" + String(k + 1).padStart(17, "0"),
    item_id: id,
    item_name: items[id].material_code,
    quantity: 10 + (k % 7),
    quantity_uom: items[id].based_uom,
    received_qty: k % 9 === 0 ? 2 : 0,
    created_received_qty: 0,
    line_index: String(k + 1),
  }));
  return { po, items };
}

async function scale() {
  for (const n of BIG ? [50, 2000] : [50]) {
    out(`\n== scale: ${n} lines (real items of the 2k test tenant)`);
    const { po, items } = bigPO(n);
    const { gr, tables } = scenario({ traits: "plain", putaway: { putaway_required: 1, category: "In Transit" }, defaults: true, po, items });
    const tAdd = Date.now();
    const A = await run(OLD.func_processGRLineItem, { ...gr, page_status: "Add" }, tables);
    const tOld = Date.now() - tAdd;
    const B = await run(NEW.func_processGRLineItem, { ...gr, page_status: "Add" }, tables);
    sameOutcome(`Add ${n} lines: old vs new identical`, A, B);
    out(`   old: ${fmtCounts(A)}\n   new: ${fmtCounts(B)}   (mock wall: old ${tOld} ms)`);

    const saved = stripKeys(B.snap.models.table_gr);
    for (const status of ["Draft", "Created"]) {
      const models = editModels(gr, saved, status);
      const E1 = await run(OLD.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: OLD.func_processGRLineItem } });
      const E2 = await run(NEW.mounted, models, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: NEW.func_processGRLineItem } });
      out(`   Edit ${status} re-open, converted:\n     old: ${fmtCounts(E1)}\n     new: ${fmtCounts(E2)}`);
    }
    const raw = editModels(gr, asStoredRaw(gr.table_gr), "Draft");
    const R1 = await run(OLD.mounted, raw, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: OLD.func_processGRLineItem } });
    const R2 = await run(NEW.mounted, raw, tables, { mode: "Edit", handlers: { ...SHARED, func_processGRLineItem: NEW.func_processGRLineItem } });
    sameOutcome(`Edit ${n}-line raw Draft (first open): old vs new identical`, R1, R2);
    out(`     old: ${fmtCounts(R1)}\n     new: ${fmtCounts(R2)}`);

    // one quantity edit + its validation
    const models = { ...gr, page_status: "Add", gr_status: "Draft", table_gr: saved };
    for (const [tag, code, cache] of [["old", OLD.validator, null], ["new", NEW.validator, B.snap.models._data]]) {
      const dbApi = makeDb(tables);
      install(dbApi);
      const form = makeForm(models, { mode: "Edit" });
      if (cache) form.models._data = clone(cache);
      const t0 = process.hrtime.bigint();
      await runValidator(form, code, { field: "table_gr.5.received_qty" }, 3);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      out(`   validator, 1 cell (${tag}): getValues ${form.__snapshot().counts.getValues || 0}, Item reads ${dbApi.counts.get("total")}, mock CPU ${ms.toFixed(1)} ms`);
    }
  }
}

(async () => {
  const steps = { addEquivalence, editScenarios, qtyScenarios, rowRemoveScenario, scale };
  for (const [name, fn] of Object.entries(steps)) {
    if (ONLY && ONLY !== name) continue;
    await fn();
  }
  out("\nfailures:", fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
