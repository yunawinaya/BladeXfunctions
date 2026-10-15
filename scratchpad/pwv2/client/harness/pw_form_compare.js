// Putaway form, Phase 4: old (dev v364) vs new (built Putaway/PutawayFullJSON.json) handlers on the same input.
// usage: node pw_form_compare.js <fixtures_dir> [--only <step>] [--big]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeDb, makeForm, runCode, runValidator, settle, install, clone } = require("./mock");

const out = (...a) => process.stdout.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const FX = process.argv[2];
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const BIG = process.argv.includes("--big");
const C = path.join(__dirname, "..");
const ROOT = path.join(C, "..", "..", "..");
const fx = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), "utf8"));
const DEV_FORM = JSON.parse(fs.readFileSync(path.join(C, "pw_form_v364.json"), "utf8"));
const NEW_FORM = JSON.parse(fs.readFileSync(path.join(ROOT, "Putaway", "PutawayFullJSON.json"), "utf8"));
const STATE_MS_PER_COPY = 21000 / ((14000 * 13999) / 2); // the GR finding: 14,000 paths from an empty map ≈ 21 s

// ------------------------------------------------------------------ the forms under test
const itemsTable = (form) => form.list[2].tabs[0].list[0];
function formSpec(form) {
  const byKey = {};
  const handlers = {};
  form.config.eventScript.forEach((e) => {
    if (e.func) handlers[e.name] = e.func;
    byKey[e.key] = e.name;
  });
  const cols = itemsTable(form).tableColumns;
  const onChange = {};
  cols.forEach((c) => {
    const k = c.events && c.events.onChange;
    if (k && byKey[k]) onChange["table_putaway_item." + c.model] = byKey[k];
  });
  const validator = cols.find((c) => c.model === "putaway_qty").options.validator;
  const completed = byKey[form.list[5].list.find((b) => b.model === "button_completed").events.onClick];
  return { handlers, onChange, cols, validator, completed };
}
const OLD = formSpec(DEV_FORM);
const NEW = formSpec(NEW_FORM);
// the V2 handler with the switch on and test ids
const V2_ON = NEW.handlers.pwV2_onClick_completed
  .replace("const ASYNC_PUTAWAY_ENABLED = false;", "const ASYNC_PUTAWAY_ENABLED = true;")
  .replace('SUBMIT: "0", // PUTAWAY_ASYNC_SUBMIT', 'SUBMIT: "PW_SUBMIT", // PUTAWAY_ASYNC_SUBMIT')
  .replace('WORKER: "0", // PUTAWAY_ASYNC_WORKER', 'WORKER: "PW_WORKER", // PUTAWAY_ASYNC_WORKER');
if (V2_ON === NEW.handlers.pwV2_onClick_completed) throw new Error("could not switch the V2 handler on");
const CLASSIC_WF = "2031190421336195074";

// ------------------------------------------------------------------ the plan core (server contract), read-only
const SERVER = (() => {
  const src = ["adapter.js", "chain.js"].map((f) => fs.readFileSync(path.join(C, "..", "code", "prepare", f), "utf8")).join("\n");
  const ctx = vm.createContext({ console: { log() {} } });
  return vm.runInContext(src + "\n;({ pwRequestRows, pwRebuild, pwEligibility, pwAliases, pwFlat, pwTree })", ctx);
})();

// ------------------------------------------------------------------ fixtures -> the form model (as a record loads)
const TECH = new Set(["tenant_id", "create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "transfer_order_putaway_id"]);
// the line columns a loaded row carries (+ parent_id: bundle items arrive under their row with it, as recorded payloads show)
const SUB_COLS = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(C, "dev_schema", "transfer_order_putaway.schema_json.dev.json"), "utf8")).properties.table_putaway_item.properties).concat(["parent_id"]));
const empty = (v) => v === null || v === undefined || v === "";
function modelRow(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (empty(v) || TECH.has(k) || !SUB_COLS.has(k)) continue;
    o[k] = k === "select_serial_number" && typeof v === "string" ? JSON.parse(v) : v;
  }
  o.id = String(r.id);
  o.fm_key = String(r.id);
  return o;
}
function toModel(to) {
  const rows = to.lines.map(modelRow);
  const byId = {};
  rows.forEach((r) => (byId[r.id] = r));
  const top = [];
  rows.forEach((r) => {
    const p = r.parent_id && byId[r.parent_id];
    if (p) {
      r.parent_fm_key = p.fm_key;
      (p.children = p.children || []).push(r);
    } else top.push(r);
  });
  const header = {};
  for (const [k, v] of Object.entries(to.header)) if (!empty(v)) header[k] = v;
  return {
    ...header,
    table_putaway_item: top,
    table_putaway_records: to.records.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) if (!empty(v) && !TECH.has(k)) o[k] = v;
      o.fm_key = String(r.id);
      return o;
    }),
    split_dialog: {},
    confirm_split_dialog: {},
  };
}
// the stored TO as the plan core reads it (pwAdapt: null / "" columns left out, bundle items under children)
function storedTO(to) {
  const strip = (r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) if (!empty(v)) o[k] = typeof v === "number" || typeof v === "string" ? v : v;
    return o;
  };
  return { ...strip(to.header), table_putaway_item: SERVER.pwTree(to.lines.map(strip)), table_putaway_records: SERVER.pwTree(to.records.map(strip)) };
}

const PLANT = fx("plant.json");
const ITEMS = fx("items.json");
const BINS = PLANT.bin_location;
const SLS = PLANT.storage_location;
const defaultSL = SLS.find((s) => s.is_default === 1 && s.location_type === "Common");
const otherBins = BINS.filter((b) => b.storage_location_id !== (defaultSL && defaultSL.id));

function dbTables({ setup = "real", items = ITEMS } = {}) {
  const base = PLANT.putaway_setup.map((s) => ({ ...s }));
  const setups = {
    real: base,
    fixed_random: base.map((s) => ({ ...s, default_strategy_id: "FIXED BIN", fallback_strategy_id: "RANDOM" })),
    fixed_only: base.map((s) => ({ ...s, default_strategy_id: "FIXED BIN", fallback_strategy_id: "FIXED BIN" })),
    manual: base.map((s) => ({ ...s, putaway_mode: "Manual" })),
    none: [],
  };
  return { putaway_setup: setups[setup], storage_location: SLS, bin_location: BINS, Item: items, blade_dept: [] };
}
// item default bins for FIXED BIN: a third match this plant, a fifth another plant (falls back), the rest none
function itemsWithBins(ids) {
  const I = clone(ITEMS);
  ids.forEach((id, k) => {
    if (!I[id]) return;
    const b = otherBins[k % Math.max(1, otherBins.length)] || BINS[0];
    if (k % 3 === 0) I[id].table_default_bin = [{ plant_id: PLANT.plant_id, bin_location: b.id, storage_location: b.storage_location_id }];
    else if (k % 5 === 0) I[id].table_default_bin = [{ plant_id: "999", bin_location: b.id, storage_location: b.storage_location_id }];
  });
  return I;
}

// ------------------------------------------------------------------ running
let fails = 0;
const check = (label, cond, extra) => {
  out((cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

// idle = nothing changed for ~0.5 s (mounted's own timers run at 100 / 200 / 300 ms)
async function waitIdle(form, dbApi) {
  let last = "";
  let quiet = 0;
  for (let i = 0; i < 20000; i++) {
    await settle(60);
    const snap = form.__snapshot();
    const now = JSON.stringify(snap.counts) + dbApi.log.length + snap.messages.length + snap.dialogs.length;
    quiet = now === last ? quiet + 1 : 0;
    if (quiet >= 8) return;
    last = now;
  }
  throw new Error("never idle");
}

function newForm(spec, models, tables, { mode = "Edit", latency = 0, extraHandlers = {}, workflow } = {}) {
  const dbApi = makeDb(tables, { latency });
  install(dbApi);
  globalThis.window.validationState = {};
  const form = makeForm(models, {
    mode,
    handlers: { ...spec.handlers, ...extraHandlers },
    onChange: spec.onChange,
    globals: { deptParentId: "0", nickname: "tester" },
    system: { deptIds: String(models.organization_id || "1") },
    workflow,
  });
  return { form, dbApi };
}

async function open(spec, models, tables, opts = {}) {
  const { form, dbApi } = newForm(spec, models, tables, opts);
  const t0 = process.hrtime.bigint();
  runCode(form, spec.handlers.mounted);
  await waitIdle(form, dbApi);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { form, dbApi, snap: form.__snapshot(), db: { ...dbApi.counts.c }, ms };
}

// ------------------------------------------------------------------ comparing
const colDefault = (cols, model, row, index, key) => {
  const c = cols.find((x) => x.model === model);
  const d = c.options[key];
  if (typeof d === "boolean") return d;
  const m = /^\{\{([\s\S]*)\}\}$/.exec(String(d || "").trim());
  if (!m) return !!d;
  try {
    return !!new Function("return (" + m[1] + ");")({ row, index });
  } catch (e) {
    return false;
  }
};
const STATE_COLS = (cols) => cols.filter((c) => c.type !== "input" || !c.options.hidden).map((c) => c.model);
// what each cell shows: the row's runtime state, else a column-level / table-level state, else the column's own default
function effectiveStates(snap, cols) {
  const res = {};
  const tableOff = snap.disabledState["table_putaway_item"] === true;
  const visit = (row, index, label) => {
    STATE_COLS(cols).forEach((model) => {
      const explicit = snap.disabledState["table_putaway_item.#" + row.fm_key + "." + model];
      const colLevel = snap.disabledState["table_putaway_item." + model];
      res[label + "." + model] = tableOff ? true : explicit !== undefined ? explicit : colLevel !== undefined ? colLevel : colDefault(cols, model, row, index, "disabled");
    });
    (row.children || []).forEach((ch, j) => visit(ch, j, label + "/" + j));
  };
  (snap.models.table_putaway_item || []).forEach((r, i) => visit(r, i, String(i)));
  return res;
}
const visibleCols = (snap, cols) =>
  new Set(cols.filter((c) => c.options.hidden !== true || snap.shown["table_putaway_item." + c.model]).map((c) => c.model));

function diffMaps(a, b) {
  const res = [];
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) res.push([k, a[k], b[k]]);
  });
  return res;
}
const rowsOf = (snap) => snap.models.table_putaway_item || [];
// rows by position; `ignore` = keys the new rows may carry on top of the old ones
function diffRows(a, b, ignore = new Set(["fm_key"])) {
  const res = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ra = a[i] || {};
    const rb = b[i] || {};
    new Set([...Object.keys(ra), ...Object.keys(rb)]).forEach((k) => {
      if (ignore.has(k)) return;
      if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) res.push([i, k, ra[k], rb[k]]);
    });
  }
  return res;
}
const rowAt = (snap, label) => {
  const [top, ...kids] = label.split("/");
  let row = rowsOf(snap)[Number(top)];
  kids.forEach((j) => (row = row && (row.children || [])[Number(j)]));
  return row || {};
};
// button_split's expression fix: a stored line's empty hu_data is not loaded into the row, which the old expression
// read as a handling unit (Split disabled on every stored line)
const bySplitFix = (B) => ([k, a, b]) => {
  const [label, model] = k.split(".");
  const row = rowAt(B.snap, label);
  return model === "button_split" && a === true && b === false && row.hu_data === undefined && !row.item_bundle_id;
};
// states compared by row position (an old split re-keys every row)
function stateDiff(A, B) {
  const ea = effectiveStates(A.snap, OLD.cols);
  const eb = effectiveStates(B.snap, NEW.cols);
  const vis = visibleCols(A.snap, OLD.cols);
  const all = diffMaps(ea, eb);
  const fix = all.filter(bySplitFix(B));
  const rest = all.filter((d) => !bySplitFix(B)(d));
  return { visible: rest.filter(([k]) => vis.has(k.split(".")[1])), hidden: rest.filter(([k]) => !vis.has(k.split(".")[1])), fix, cells: Object.keys(ea).length };
}
const optionsByIndex = (snap) => {
  const res = {};
  rowsOf(snap).forEach((r, i) => {
    Object.entries(snap.optionState).forEach(([k, v]) => {
      const p = "table_putaway_item.#" + r.fm_key + ".";
      if (k.startsWith(p)) res[i + "." + k.slice(p.length)] = v;
    });
  });
  Object.entries(snap.optionState).forEach(([k, v]) => {
    if (!k.includes("#")) res[k] = v;
  });
  return res;
};

function fmt(r) {
  const c = r.snap.counts;
  const d = r.db || {};
  const item = Object.entries(d).filter(([k]) => k.startsWith("Item")).map(([k, v]) => `${k.replace("Item:", "")}=${v}`).join(" ");
  const ch = Object.entries(c).filter(([k]) => k.startsWith("onChange:")).map(([k, v]) => `${k.slice(9)}=${v}`).join(" ");
  return [
    `db=${d.total || 0}${item ? " (Item " + item + ")" : ""}`,
    `getValues=${c.getValues || 0}`,
    `setData=${c.setData || 0} (keys ${c["setData.keys"] || 0}, row-path ${c["setData.rowPathKeys"] || 0}, whole table ${c["setData.wholeTable"] || 0})`,
    `disabled=${c.disabled || 0} (${c["disabled.paths"] || 0} paths, ${c.stateCopies || 0} map-entry copies ≈ ${((c.stateCopies || 0) * STATE_MS_PER_COPY).toFixed(1)} ms)`,
    `setOptionData=${c.setOptionData || 0}`,
    `display=${c.display || 0}`,
    `onChange runs: ${ch || "0"}`,
  ].join(", ");
}

// a serial row's select options survive a split now (the old split re-keyed every row and the options were keyed by row)
const keptSerialOptions = (B) => ([k, a]) => {
  const [idx, col] = k.split(".");
  return a === undefined && col === "select_serial_number" && (rowsOf(B.snap)[Number(idx)] || {}).is_serialized_item === 1;
};
// the old strategy's whole-table write from its start-time copy lands after mounted's serial step when its reads are slow,
// and wipes the serial rows' selection (and the quantity it sets); the new one merges into the live table
const serialRaceFix = (B) => ([i, k, a, b]) => {
  const row = rowsOf(B.snap)[i] || {};
  if (row.is_serialized_item !== 1 || (k !== "putaway_qty" && k !== "select_serial_number")) return false;
  const sel = row.select_serial_number;
  return Array.isArray(sel) && sel.length > 0 && row.putaway_qty === sel.length && (k === "putaway_qty" ? a === 0 : a === undefined);
};
function sameOutcome(label, A, B, { rowIgnore, allowState = () => false, allowNote = "allowed state diffs", quiet = false } = {}) {
  const rowsAll = diffRows(rowsOf(A.snap), rowsOf(B.snap), rowIgnore);
  const rows = rowsAll.filter((d) => !serialRaceFix(B)(d));
  const hdr = diffMaps(clone({ ...A.snap.models, table_putaway_item: null, _data: null }), clone({ ...B.snap.models, table_putaway_item: null, _data: null }));
  const sd = stateDiff(A, B);
  const vis = sd.visible.filter((d) => !allowState(d));
  const optAll = diffMaps(optionsByIndex(A.snap), optionsByIndex(B.snap));
  const opt = optAll.filter((d) => !keptSerialOptions(B)(d));
  const shown = diffMaps(A.snap.shown, B.snap.shown);
  const msgs = JSON.stringify(A.snap.messages) === JSON.stringify(B.snap.messages);
  const ok = !rows.length && !hdr.length && !vis.length && !opt.length && !shown.length && msgs;
  check(label, ok, `rows ${rowsOf(A.snap).length}, cells ${sd.cells}` + (sd.fix.length ? `; Split enabled by the expression fix on ${sd.fix.length} rows` : "") + (sd.visible.length - vis.length ? `; ${allowNote} ${sd.visible.length - vis.length}` : "") + (optAll.length - opt.length ? `; serial options kept on ${optAll.length - opt.length} rows` : "") + (rowsAll.length - rows.length ? `; serial selections kept on ${new Set(rowsAll.filter((d) => !rows.includes(d)).map((d) => d[0])).size} rows (old: wiped by the strategy's late write)` : "") + (sd.hidden.length ? `; hidden-column state diffs ${sd.hidden.length} ${JSON.stringify(sd.hidden.slice(0, 2))}` : ""));
  if (!ok || !quiet) {
    if (rows.length) out("   rows:", JSON.stringify(rows.slice(0, 8)), rows.length);
    if (hdr.length) out("   header:", JSON.stringify(hdr.slice(0, 5)));
    if (vis.length) out("   visible states:", JSON.stringify(vis.slice(0, 8)), vis.length);
    if (opt.length) out("   options:", JSON.stringify(opt.slice(0, 3)).slice(0, 300), opt.length);
    if (shown.length) out("   shown:", JSON.stringify(shown));
    if (!msgs) out("   messages:", JSON.stringify(A.snap.messages), JSON.stringify(B.snap.messages));
  }
  return { ok, sd, rows };
}

// ------------------------------------------------------------------ scenario inputs
const TO16 = fx("to_2105558352827682817.json");
const TO_BUNDLE = fx("to_2101960464552890370.json");
const TO_HU = fx("to_2072259808180891650.json");
const TO200 = fx("to_2074350264504156162.json");

// traits on a copy of a TO's stored rows so every branch runs (dev has no serial / QI putaway lines)
function withTraits(to, { clearEvery = 0, serial = [], qi = [] } = {}) {
  const t = clone(to);
  t.lines.forEach((l, i) => {
    if (clearEvery && i % clearEvery === 1) {
      l.storage_location = null;
      l.target_location = null;
    }
    if (serial.includes(i)) {
      l.is_serialized_item = 1;
      l.serial_numbers = ["SN-" + i + "-A", "SN-" + i + "-B", "SN-" + i + "-C"].join(", ");
    }
    if (qi.includes(i)) l.qi_no = "QI-" + i;
  });
  return t;
}

// a 2,000-line stored TO from the 16-line TO's first line, one distinct item each
function bigTO(n) {
  const t = clone(TO16);
  const tmpl = t.lines[0];
  const ids = PLANT.synthetic_item_ids.slice(0, n);
  t.header.id = "2199000000000000001";
  t.lines = ids.map((itemId, k) => ({
    ...clone(tmpl),
    id: String(2199000000000100000n + BigInt(k)),
    item_code: itemId,
    item_name: (ITEMS[itemId] && ITEMS[itemId].material_code) || "ITEM-" + k,
    batch_no: k % 4 === 0 ? tmpl.batch_no : null,
    line_index: String(k + 1),
    parent_index: k,
    received_qty: 10 + (k % 7),
    qty_to_putaway: 10 + (k % 7),
    pending_process_qty: 10 + (k % 7),
    putaway_qty: 0,
    gr_line_id: String(2199000000000200000n + BigInt(k)),
  }));
  t.records = [];
  return t;
}

// ------------------------------------------------------------------ steps
async function openEquivalence() {
  out("\n== mounted (Edit open) + func_getPutawayStrategy — old vs new must be identical");
  const variants = [];
  for (const [name, to] of [["16-line Created", TO16], ["bundle In Progress", TO_BUNDLE], ["HU Created", TO_HU], ["200-line Created", TO200]]) {
    variants.push({ name, to, setup: "real" });
  }
  const t16 = withTraits(TO16, { clearEvery: 2, serial: [3, 8], qi: [5] });
  for (const setup of ["real", "fixed_random", "fixed_only", "manual", "none"]) variants.push({ name: "16-line, 8 rows without bins, 2 serial, 1 QI", to: t16, setup });
  const t200 = withTraits(TO200, { clearEvery: 2 });
  variants.push({ name: "200-line, 100 rows without bins", to: t200, setup: "fixed_random" });
  for (const v of variants) {
    const items = itemsWithBins(v.to.lines.map((l) => l.item_code).filter(Boolean));
    const tables = dbTables({ setup: v.setup, items });
    const A = await open(OLD, toModel(v.to), tables);
    const B = await open(NEW, toModel(v.to), tables);
    sameOutcome(`open ${v.name} — setup ${v.setup}`, A, B, { quiet: true });
    const filled = (R) => rowsOf(R.snap).filter((r) => r.storage_location && r.target_location).length;
    out(`   rows with storage + bin before ${v.to.lines.filter((l) => l.storage_location && l.target_location).length}, after: old ${filled(A)} / new ${filled(B)}`);
    out("   old: " + fmt(A));
    out("   new: " + fmt(B));
  }
  const A = await open(OLD, toModel(TO16), dbTables(), { mode: "View" });
  const B = await open(NEW, toModel(TO16), dbTables(), { mode: "View" });
  sameOutcome("View 16-line", A, B, { quiet: true });
  const addModel = { organization_id: TO16.header.organization_id, table_putaway_item: [], table_putaway_records: [], split_dialog: {}, confirm_split_dialog: {} };
  const AA = await open(OLD, addModel, dbTables(), { mode: "Add" });
  const BA = await open(NEW, addModel, dbTables(), { mode: "Add" });
  sameOutcome("Add (new putaway)", AA, BA, { quiet: true });

  out("\n== func_getPutawayStrategy, Add page (rows as onChange_GoodsReceiving builds them) — old vs new");
  const addRows = toModel(TO16).table_putaway_item.map((r, i) => {
    const o = { ...r, hu_data: "", remark: "", storage_location: i % 2 ? "" : r.storage_location, target_location: i % 2 ? "" : r.target_location };
    delete o.id;
    delete o.fm_key;
    return o;
  });
  for (const setup of ["real", "fixed_random", "fixed_only", "manual"]) {
    const items = itemsWithBins(addRows.map((r) => r.item_code));
    const res = [];
    for (const spec of [OLD, NEW]) {
      const { form, dbApi } = newForm(spec, { page_status: "Add", plant_id: PLANT.plant_id, table_putaway_item: clone(addRows), table_putaway_records: [], split_dialog: {} }, dbTables({ setup, items }), { mode: "Add" });
      runCode(form, spec.handlers.func_getPutawayStrategy, {});
      await waitIdle(form, dbApi);
      res.push({ snap: form.__snapshot(), db: { ...dbApi.counts.c } });
    }
    const d = diffRows(rowsOf(res[0].snap), rowsOf(res[1].snap));
    check(`Add strategy, setup ${setup}: rows identical`, d.length === 0 && JSON.stringify(res[0].snap.messages) === JSON.stringify(res[1].snap.messages), `db old ${res[0].db.total || 0} / new ${res[1].db.total || 0}; filled ${rowsOf(res[1].snap).filter((r) => r.storage_location && r.target_location).length}/${addRows.length}`);
    if (d.length) out("   ", JSON.stringify(d.slice(0, 4)));
  }
}

async function validatorEquivalence() {
  out("\n== putaway_qty validator — old vs new per cell (callback, validationState)");
  const to = withTraits(TO16, { serial: [3] });
  let same = 0;
  let total = 0;
  const gv = { old: 0, new: 0 };
  for (let i = 0; i < to.lines.length; i++) {
    for (const value of [0, 1, 5, 9.5, 10, 1e6, -1, "abc"]) {
      const res = [];
      for (const [tag, code] of [["old", OLD.validator], ["new", NEW.validator]]) {
        const { form } = newForm(tag === "old" ? OLD : NEW, toModel(to), dbTables());
        const r = await runValidator(form, code, { field: `table_putaway_item.${i}.putaway_qty` }, value);
        gv[tag] += form.__snapshot().counts.getValues || 0;
        res.push(JSON.stringify([r, globalThis.window.validationState]));
      }
      total++;
      if (res[0] === res[1]) same++;
      else out(`   DIFF row ${i} value ${value}: ${res[0]} | ${res[1]}`);
    }
  }
  check(`validator: ${same}/${total} cells identical`, same === total, `getValues calls: old ${gv.old}, new ${gv.new}`);
  const { form } = newForm(OLD, toModel(TO16), dbTables());
  const key = form.models.table_putaway_item[2].fm_key;
  let oldRes;
  try {
    oldRes = await runValidator(form, OLD.validator, { field: `table_putaway_item.${key}.putaway_qty` }, 1);
  } catch (e) {
    oldRes = "throws " + e.constructor.name;
  }
  const newRes = await runValidator(form, NEW.validator, { field: `table_putaway_item.${key}.putaway_qty` }, 1);
  out(`   rule.field by fm_key: old ${oldRes} | new ${newRes}`);
}

// the user types quantities: the platform writes the cell (runs its onChange), then validates it
async function typeQty(run, spec, entries) {
  for (const [i, qty] of entries) {
    await run.form.setData({ [`table_putaway_item.${i}.putaway_qty`]: qty });
    await runValidator(run.form, spec.validator, { field: `table_putaway_item.${i}.putaway_qty` }, qty);
  }
  await waitIdle(run.form, run.dbApi);
}

async function trig(run, name, args) {
  if (!run.spec.handlers[name]) throw new Error("no handler " + name);
  runCode(run.form, run.spec.handlers[name], args);
  await waitIdle(run.form, run.dbApi);
}

// split row r into `parts` dialog rows (store_in_qty, storage location / bin of the plant, remark)
async function splitRow(run, r, parts) {
  const isResplit = rowsOf(run.form.__snapshot())[r].is_split === "Yes";
  await trig(run, "onClick_split_item", { rowIndex: r });
  if (isResplit) await trig(run, "onConfirm_edit_split", {});
  await run.form.setData({ "split_dialog.no_of_split": parts.length });
  await trig(run, "onClick_confirm_split", {});
  const rows = clone(run.form.getValue("split_dialog.table_split"));
  parts.forEach((p, k) => Object.assign(rows[k], p));
  await run.form.setData({ "split_dialog.table_split": rows });
  await trig(run, "onClick_save_split", {});
}

// integer parts that add up exactly (onClick_save_split compares the sum with !==)
function dialogParts(total, n) {
  const each = Math.floor(total / n);
  return Array.from({ length: n }, (_, k) => ({
    store_in_qty: k < n - 1 ? each : total - each * (n - 1),
    storage_location: (otherBins[k % otherBins.length] || BINS[0]).storage_location_id,
    target_bin: (otherBins[k % otherBins.length] || BINS[0]).id,
    remark: "split " + (k + 1),
  }));
}

const IDENTITY_KEYS = new Set(["fm_key", "id", "parent_line_id", "item_bundle_id", "children", "project_id", "hierarchyState", "parent_id", "parent_fm_key", "gr_line_id"]);

async function splitScenarios(to, label, { big = false } = {}) {
  out(`\n== split — ${label}: open, type quantities, split, re-split, cancel, split another line (old vs new)`);
  const runs = {};
  for (const [tag, spec] of [["old", OLD], ["new", NEW]]) {
    const r = await open(spec, toModel(to), dbTables());
    runs[tag] = { ...r, spec };
  }
  const A = runs.old;
  const B = runs.new;
  const n = rowsOf(A.snap).length;
  const qtyRows = Array.from({ length: Math.min(n, big ? 2000 : n) }, (_, i) => i).filter((i) => i % 3 !== 2).map((i) => [i, (i % 4) + 1]);
  for (const R of [A, B]) await typeQty(R, R.spec, qtyRows);
  for (const R of [A, B]) R.snap = R.form.__snapshot();
  sameOutcome(`${label}: after typing ${qtyRows.length} quantities`, A, B, { quiet: true });

  const steps = [];
  const pending = (R, i) => rowsOf(R.form.__snapshot())[i].pending_process_qty;
  const stamp = (R) => ({ ...R.form.__snapshot().counts });
  const delta = (a, b, k) => (b[k] || 0) - (a[k] || 0);
  const row1 = 1;
  // a plain line at or after position 5 once the earlier splits have shifted the rows
  const plainAt = (R, from) => rowsOf(R.form.__snapshot()).findIndex((r, i) => i >= from && r.parent_or_child !== "Child" && r.is_split !== "Yes");
  const plan = [
    ["split line 2 in 2", async (R) => splitRow(R, row1, dialogParts(pending(R, row1), 2))],
    ["re-split line 2 in 3", async (R) => splitRow(R, row1, dialogParts(pending(R, row1), 3))],
    ["re-split line 2, then cancel", async (R) => {
      await trig(R, "onClick_split_item", { rowIndex: row1 });
      await trig(R, "onConfirm_edit_split", {});
      await trig(R, "onClick_cancel_split", {});
    }],
    ["split another line in 2", async (R) => {
      const at = plainAt(R, 5);
      await splitRow(R, at, dialogParts(pending(R, at), 2));
    }],
  ];
  // the cancelled re-split line: target category / serial select unlocked at the cancel (old: when another line was split)
  const unlockedAtCancel = ([k, a, b]) => {
    const [lbl, col] = k.split(".");
    return lbl === String(row1) && (col === "target_inv_category" || col === "select_serial_number") && a === true && b === false;
  };
  for (const [name, fn] of plan) {
    const before = { old: stamp(A), new: stamp(B) };
    await fn(A);
    await fn(B);
    A.snap = A.form.__snapshot();
    B.snap = B.form.__snapshot();
    const res = sameOutcome(`${label}: ${name}`, A, B, { rowIgnore: IDENTITY_KEYS, quiet: true, allowState: unlockedAtCancel, allowNote: "unlocked at the cancel (old: at the next split)" });
    const pairs = [["old", A, before.old], ["new", B, before.new]].map(([t, R, b]) => {
      const c = R.snap.counts;
      return `${t}: disabled paths ${delta(b, c, "disabled.paths")}, map-entry copies ${delta(b, c, "stateCopies")} (≈ ${(delta(b, c, "stateCopies") * STATE_MS_PER_COPY).toFixed(1)} ms), getValues ${delta(b, c, "getValues")}`;
    });
    out("   " + pairs.join(" | "));
    steps.push({ name, res });
  }
  // what the new rows carry that the old ones lost
  const kept = rowsOf(B.snap).map((r, i) => {
    const o = rowsOf(A.snap)[i] || {};
    return Object.keys(r).filter((k) => IDENTITY_KEYS.has(k) && JSON.stringify(r[k]) !== JSON.stringify(o[k]));
  });
  const parentRow = rowsOf(B.snap).findIndex((r) => r.is_split === "Yes");
  const kids = rowsOf(B.snap).filter((r) => r.parent_or_child === "Child");
  const storedIds = new Set(to.lines.map((l) => String(l.id)));
  check(
    `${label}: every non-split row keeps its stored id + fm_key, split rows carry parent_line_id = the split line's id`,
    rowsOf(B.snap).every((r) => (r.parent_or_child === "Child" ? storedIds.has(String(r.parent_line_id)) && r.id === undefined : storedIds.has(String(r.id)) && r.fm_key === String(r.id))),
    `split parents ${rowsOf(B.snap).filter((r) => r.is_split === "Yes").length}, split rows ${kids.length}; old rows with an id: ${rowsOf(A.snap).filter((r) => r.id).length} of ${rowsOf(A.snap).length}`,
  );
  out(`   keys the new rows keep and the old lost: ${JSON.stringify([...new Set(kept.flat())])}; first split parent row ${parentRow}`);
  return { A, B };
}

// ------------------------------------------------------------------ confirmation: classic payload vs the V2 request
const NO_JOB = { data: { route: "STATUS", code: "200", job_id: "", job_status: "" } };
function serverAnswer(stored, captured) {
  return (id, params) => {
    if (params.operation === "STATUS") {
      captured.status = params;
      return NO_JOB;
    }
    if (id === CLASSIC_WF) {
      captured.classic = params;
      return { data: { code: "200", message: "Putaway saved successfully" } };
    }
    if (id === "PW_WORKER") {
      captured.worker = params;
      return { data: { processed: 1 } };
    }
    captured.submits = (captured.submits || []).concat([params]);
    const storedById = {};
    SERVER.pwFlat(stored.table_putaway_item).forEach((l) => (storedById[String(l.id)] = l));
    const req = SERVER.pwRequestRows(params.request, storedById);
    captured.req = req;
    if (!req.ok) return { data: { route: "STOP", code: "400", message: req.message } };
    const reasons = SERVER.pwEligibility({ to: { data: stored }, itemFlags: {} }, req, []);
    captured.reasons = reasons;
    if (reasons.length) return { data: { route: "NOT_ELIGIBLE", code: "300", reason: reasons.map((r) => r.text).join("; ") } };
    return { data: { route: "QUEUED", code: "200", job_id: "777", job_status: "QUEUED", to_no: stored.to_id } };
  };
}

// the rows the classic puts away (qfSZO0bi): not Cancelled, not a split parent, putaway_qty > 0
const PUT_FIELDS = ["item_code", "batch_no", "item_uom", "source_bin", "source_inv_category", "target_inv_category", "target_location", "storage_location", "remark", "putaway_qty"];
function putRows(allData) {
  const rows = SERVER.pwFlat(allData.table_putaway_item || []);
  return rows
    .filter((r) => r.line_status !== "Cancelled" && !(r.parent_or_child === "Parent" && r.is_split === "Yes") && (parseFloat(r.putaway_qty) || 0) > 0)
    .map((r) => {
      const o = { line: String(r.line_index).split(" - ")[0] };
      PUT_FIELDS.forEach((f) => (o[f] = empty(r[f]) ? "" : f === "putaway_qty" ? Number(r[f]) : String(r[f])));
      return o;
    });
}

async function confirmParity(to, label, { prepare } = {}) {
  const stored = storedTO(to);
  const captured = {};
  const R = await open(NEW, toModel(to), dbTables(), { extraHandlers: { pwV2_onClick_completed: V2_ON }, workflow: serverAnswer(stored, captured) });
  const run = { ...R, spec: { ...NEW, handlers: { ...NEW.handlers, pwV2_onClick_completed: V2_ON } } };
  if (prepare) await prepare(run);
  // the classic payload from the same screen
  runCode(run.form, NEW.handlers.onClick_workflowComplete);
  await waitIdle(run.form, run.dbApi);
  const classic = captured.classic && captured.classic.arrayData[0];
  // the V2 click
  const t0 = process.hrtime.bigint();
  runCode(run.form, V2_ON, {});
  await waitIdle(run.form, run.dbApi);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const sub = (captured.submits || [])[0];
  if (!sub) {
    check(`${label}: V2 submitted`, false, JSON.stringify(run.form.__snapshot().messages));
    return null;
  }
  const req = captured.req;
  check(`${label}: request passes the plan core's contract (pwRequestRows)`, req && req.ok, req && req.message);
  const rebuilt = SERVER.pwRebuild(clone(stored), req, SERVER.pwAliases(stored.table_putaway_item)).allData;
  const a = putRows(classic);
  const b = putRows(rebuilt);
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(`${label}: rows put away — classic payload == V2 request rebuilt by pwRebuild`, same, `${a.length} rows; eligibility ${captured.reasons && captured.reasons.length ? JSON.stringify(captured.reasons.map((x) => x.code)) : "eligible"}; client ${ms.toFixed(1)} ms`);
  if (!same) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      out("   first diff", i, JSON.stringify(a[i]), JSON.stringify(b[i]));
      break;
    }
  }
  return { sub, captured, run, classic };
}

async function confirmScenarios() {
  out("\n== confirmation — the V2 request vs the classic payload, routes, idempotency key");
  // 1. whole lines
  const typed = async (run) => typeQty(run, run.spec, rowsOf(run.form.__snapshot()).map((r, i) => [i, i % 3 === 2 ? 0 : Math.min(r.pending_process_qty, (i % 4) + 1)]));
  const r1 = await confirmParity(TO16, "16-line, whole lines", { prepare: typed });
  if (r1) {
    out("   sample request: " + JSON.stringify({ ...r1.sub, request: { ...r1.sub.request, lines: r1.sub.request.lines.slice(0, 2) } }));
    const snap = r1.run.form.__snapshot();
    check("QUEUED: dialog closed, worker kicked with the job id, buttons hidden", snap.dialogs.includes("page closed") && r1.captured.worker && r1.captured.worker.job_id === "777" && snap.shown.button_completed === false, JSON.stringify(snap.messages));
  }
  // 2. with a split and a re-split
  const splitAt = (run, idx, n) => splitRow(run, idx, dialogParts(rowsOf(run.form.__snapshot())[idx].pending_process_qty, n));
  const splitPrep = async (run) => {
    await typed(run);
    await splitAt(run, 1, 2);
    await splitAt(run, 4, 2);
    await splitAt(run, 1, 3);
  };
  const r2 = await confirmParity(TO16, "16-line, two split lines (one re-split)", { prepare: splitPrep });
  if (r2) {
    const lines = r2.sub.request.lines;
    out("   split entries: " + JSON.stringify(lines.filter((l) => l.parent_id).slice(0, 3)));
  }
  // 3. routes
  const routeCase = async (label, answer, expect) => {
    const stored = storedTO(TO16);
    const captured = {};
    const R = await open(NEW, toModel(TO16), dbTables(), {
      extraHandlers: { pwV2_onClick_completed: V2_ON },
      workflow: (id, params) => {
        if (params.operation === "STATUS") return NO_JOB;
        if (id === CLASSIC_WF) {
          captured.classic = true;
          return { data: { code: "200", message: "Putaway saved successfully" } };
        }
        if (id === "PW_WORKER") return { data: {} };
        captured.n = (captured.n || 0) + 1;
        return typeof answer === "function" ? answer(params, captured) : answer;
      },
    });
    const run = { ...R, spec: { ...NEW, handlers: { ...NEW.handlers, pwV2_onClick_completed: V2_ON } } };
    await typed(run);
    runCode(run.form, V2_ON, {});
    await waitIdle(run.form, run.dbApi);
    const snap = run.form.__snapshot();
    const ok = expect(snap, captured);
    check(`route ${label}`, ok, JSON.stringify(snap.messages).slice(0, 200));
    return { snap, captured, run };
  };
  await routeCase("NOT_ELIGIBLE -> the classic save runs", { data: { route: "NOT_ELIGIBLE", code: "300", reason: "x" } }, (s, c) => c.classic === true);
  await routeCase("BUSY -> warning, nothing else", { data: { route: "BUSY", code: "409", message: "The current putaway is under processing" } }, (s, c) => !c.classic && s.messages[0] === "warn: The current putaway is under processing");
  await routeCase("STOP -> error", { data: { route: "STOP", code: "400", message: "Putaway quantity (9) cannot be greater than the pending quantity" } }, (s, c) => !c.classic && /^error: Putaway quantity/.test(s.messages[0]));
  await routeCase("STATUS COMPLETED -> already completed, closed", { data: { route: "STATUS", code: "200", job_id: "5", job_status: "COMPLETED" } }, (s) => /already completed/.test(s.messages[0]) && s.dialogs.includes("page closed"));
  await routeCase("lost answer -> repeated once with the same key", (params, c) => {
    c.keys = (c.keys || []).concat([params.idempotency_key]);
    return c.n === 1 ? { error: "network" } : { data: { route: "QUEUED", code: "200", job_id: "9", job_status: "QUEUED" } };
  }, (s, c) => c.keys.length === 2 && c.keys[0] === c.keys[1] && s.dialogs.includes("page closed"));

  // 4. idempotency key: same click twice, FAILED -> next generation, content change, _data / dialog change
  {
    const keys = [];
    let answer = { data: { route: "BUSY", code: "409", message: "busy" } };
    const R = await open(NEW, toModel(TO16), dbTables(), {
      extraHandlers: { pwV2_onClick_completed: V2_ON },
      workflow: (id, params) => {
        if (params.operation === "STATUS") return NO_JOB;
        if (id === "PW_SUBMIT") keys.push(params.idempotency_key);
        return answer;
      },
    });
    const run = { ...R, spec: { ...NEW, handlers: { ...NEW.handlers, pwV2_onClick_completed: V2_ON } } };
    await typed(run);
    const click = async () => {
      runCode(run.form, V2_ON, {});
      await waitIdle(run.form, run.dbApi);
    };
    await click();
    await click();
    run.form.models._data = { ...(run.form.models._data || {}), unrelated: Date.now() };
    await run.form.setData({ "split_dialog.item_name": "changed" });
    await click();
    answer = { data: { route: "STATUS", code: "200", job_id: "1", job_status: "FAILED", error_message: "failed" } };
    await click();
    answer = { data: { route: "BUSY", code: "409", message: "busy" } };
    await click();
    await run.form.setData({ "table_putaway_item.0.putaway_qty": 2.5 });
    await waitIdle(run.form, run.dbApi);
    await click();
    check(
      "idempotency key: stable per content (repeat click, _data / dialog changes), new generation after FAILED, new key for new content",
      keys[0] === keys[1] && keys[1] === keys[2] && keys[2] === keys[3] && keys[4] !== keys[3] && /:2$/.test(keys[4]) && keys[5] !== keys[4],
      JSON.stringify(keys.map((k) => k.replace(/^PWC:[^:]*:[^:]*:/, "…:"))),
    );
    out("   key shape: " + keys[0].replace(/^PWC:[^:]*:[^:]*:/, "PWC:<organization_id>:<to id>:"));
  }
  // 5. switch off (as shipped): the classic runs, SUBMIT is never called
  {
    const calls = [];
    const R = await open(NEW, toModel(TO16), dbTables(), { workflow: (id, p) => (calls.push(id), { data: { code: "200", message: "ok" } }) });
    await typeQty({ ...R, spec: NEW }, NEW, [[0, 1]]);
    runCode(R.form, NEW.handlers.pwV2_onClick_completed, {});
    await waitIdle(R.form, R.dbApi);
    check("switch off: button_completed runs the classic onClick_workflowComplete (PUTAWAY_LOOP) only", calls.length === 1 && calls[0] === CLASSIC_WF, JSON.stringify(calls));
  }
}

// ------------------------------------------------------------------ scale
async function scale() {
  out("\n== scale: synthetic 2,000-line TO (2,000 distinct dev items)");
  const to = withTraits(bigTO(2000), { serial: Array.from({ length: 20 }, (_, k) => 50 + k * 90), qi: [7, 77, 777] });
  const toBins = withTraits(bigTO(2000), { clearEvery: 2, serial: Array.from({ length: 20 }, (_, k) => 50 + k * 90) });
  const items = itemsWithBins(PLANT.synthetic_item_ids);
  for (const [name, t, setup] of [["all lines with bins", to, "real"], ["1,000 lines without bins, FIXED BIN", toBins, "fixed_random"], ["1,000 lines without bins, RANDOM (dev setup)", toBins, "real"]]) {
    const tables = dbTables({ setup, items });
    const A = await open(OLD, toModel(t), tables);
    const B = await open(NEW, toModel(t), tables);
    sameOutcome(`open 2,000 lines, ${name}`, A, B, { quiet: true });
    const filled = (R) => rowsOf(R.snap).filter((r) => r.storage_location && r.target_location).length;
    out(`   rows with storage + bin before ${t.lines.filter((l) => l.storage_location && l.target_location).length}, after: old ${filled(A)} / new ${filled(B)}`);
    out(`   old: ${fmt(A)} (mock ${A.ms.toFixed(0)} ms)`);
    out(`   new: ${fmt(B)} (mock ${B.ms.toFixed(0)} ms)`);
  }
  // one validated cell
  for (const [tag, spec] of [["old", OLD], ["new", NEW]]) {
    const { form } = newForm(spec, toModel(to), dbTables());
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) await runValidator(form, spec.validator, { field: `table_putaway_item.${i}.putaway_qty` }, 1);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
    out(`   validator per cell (${tag}): getValues ${(form.__snapshot().counts.getValues || 0) / 50}, mock CPU ${ms.toFixed(2)} ms`);
  }
  await splitScenarios(to, "2,000 lines", { big: true });
  const typed = async (run) => typeQty(run, run.spec, rowsOf(run.form.__snapshot()).map((r, i) => [i, (i % 4) + 1]).filter(([i]) => !(i >= 50 && (i - 50) % 90 === 0)));
  const plain = bigTO(2000);
  const r = await confirmParity(plain, "2,000 lines, whole lines", { prepare: typed });
  if (r) out(`   request: ${r.sub.request.lines.length} entries, ${JSON.stringify(r.sub).length} bytes`);
}

(async () => {
  const steps = {
    open: openEquivalence,
    validator: validatorEquivalence,
    split: async () => {
      await splitScenarios(withTraits(TO16, { serial: [3], qi: [9] }), "16-line real TO");
      await splitScenarios(TO200, "200-line real TO");
    },
    confirm: confirmScenarios,
  };
  if (BIG) steps.scale = scale;
  for (const [name, fn] of Object.entries(steps)) {
    if (ONLY && ONLY !== name) continue;
    await fn();
  }
  out("\nfailures:", fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  process.stderr.write(String(e && e.stack) + "\n");
  process.exit(2);
});
