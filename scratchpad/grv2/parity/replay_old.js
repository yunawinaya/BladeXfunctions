// node replay_old.js <ADD|SUBTRACT> <fixtures.jsonl...> [--engine-change] [--show N] [--detail out.json]
// node replay_old.js PAIRS <sub.jsonl> <add.jsonl> [--show N] [--detail out.json]
//
// Replays recorded OLD ADD_INVENTORY (v65) / SUBTRACT_INVENTORY (v58) calls through INVENTORY_BULK_APPLY's planner
// (scratchpad/gdc/engine/core.js, read-only) with the rows each call read, and compares what the engine would write with
// what the call computed or wrote. Each run lands in one bucket: identical | known:<causes> | DIFF:<causes> | ok-fail:<code>
// | skip:<reason>. --engine-change replays SUBTRACT with the requested change (no UNSUPPORTED_COSTING refusal when
// isMovingInv = 1 and a unit_price is given). PAIRS matches each putaway SUBTRACT with its ADD and replays the pair as
// ONE planBulk call (SUBTRACT then ADD, source dates passed explicitly), the way a V2 caller would.
// node replay_old.js CHAIN <fixtures.jsonl...>: every call of one document (same tenant + transaction_type + trx_no, one
// index run) as ONE planBulk call seeded with each row's first read - the V2 COMMIT's single APPLY - compared per movement
// and on each row's final values.
const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..", "..", "gdc", "engine", "core.js");
const coreSrc = fs.readFileSync(CORE, "utf8");
const loadCore = (src) => {
  const mod = { exports: {} };
  new Function("module", "exports", "require", src)(mod, mod.exports, require);
  return mod.exports;
};
const engine = loadCore(coreSrc);
const REFUSAL = "if ((wa.length > 0 && fifo.length > 0) || (u.method === FIFO && fifo.length === 0 && wa.length > 0) || (u.method === WA && wa.length === 0 && fifo.length > 0)) {";
if (coreSrc.split(REFUSAL).length !== 2) throw new Error("core.js UNSUPPORTED_COSTING condition not found exactly once");
const changed = loadCore(coreSrc.replace(REFUSAL, "if (!(isMovingInv === 1 && m.unit_price) && ((wa.length > 0 && fifo.length > 0) || (u.method === FIFO && fifo.length === 0 && wa.length > 0) || (u.method === WA && wa.length === 0 && fifo.length > 0))) {"));
const { q8 } = engine;

const argv = process.argv.slice(2);
const flag = (f) => argv.indexOf(f) >= 0;
const opt = (f, d) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : d);
const SHOW = Number(opt("--show", 3));
const DETAIL = opt("--detail", null);
const ENGINE_CHANGE = flag("--engine-change");
// --db a.jsonl[,b.jsonl]: rows the runs inserted, read back from the database (fetch_db_rows.py)
const DBROWS = {};
for (const f of (opt("--db", "") || "").split(",").filter(Boolean)) for (const l of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
  const x = JSON.parse(l);
  DBROWS[x.id] = x;
}
const mode = argv[0];
const files = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && ["--show", "--detail", "--db", "--rules", "--ids"].includes(all[i - 1])));
// --rules rules.json: the tenants' number rules {env: {default: {price, qty} | null, tenants: {tenant: {price, qty}}}};
// without it every tenant is taken as "Inventory Price" 4 dp / "Inventory Qty" 3 dp (prod's only rule set)
const RULES = opt("--rules", null) ? JSON.parse(fs.readFileSync(opt("--rules", null), "utf8")) : null;
const ruleFor = (rec) => {
  if (!RULES) return { price: 4, qty: 3 };
  const e = RULES[rec.env] || {};
  const t = (e.tenants || {})[rec.tenant];
  return t !== undefined ? t : e.default === undefined ? null : e.default;
};

// ------------------------------------------------------------------------------------------------- trace helpers
const s = (v) => (v === undefined || v === null ? "" : String(v));
const has = (rec, id) => !!rec.nodes[id];
const out = (rec, id) => (rec.nodes[id] && rec.nodes[id].resp ? rec.nodes[id].resp.data : undefined);
const cut = (rec, id) => !!(rec.nodes[id] && rec.nodes[id].cut);
const rowsOf = (d) => {
  if (!d) return [];
  const x = d.data;
  if (Array.isArray(x)) return x;
  return x && Object.keys(x).length ? [x] : [];
};
const countOf = (d) => (d ? Number(d.count || 0) : 0);
const capped = (d) => !!(d && Number(d.total || 0) > (Array.isArray(d.data) ? d.data.length : 0));
const traceCut = (rec, id) => {
  const d = out(rec, id);
  return cut(rec, id) || (d && Number(d.total || d.count || 0) > 0 && rowsOf(d).length === 0);
};
const num = (v) => (v === null || v === undefined || v === "" ? 0 : q8(v));
const eqN = (a, b) => Math.abs(num(a) - num(b)) < 1e-6;
const eqS = (a, b) => s(a) === s(b);
const day = (v) => {
  let t = s(v).trim().replace("T", " ").replace(/Z$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += " 00:00:00";
  return t.slice(0, 19);
};
const DIG = /^[0-9]{1,20}$/;

// the deployed engine's item adapter (code_node_IBplan bulkPlan), applied to the item the old call used
function adaptItem(it) {
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return {
    id: s(it.id),
    stock_control: Number(it.stock_control),
    based_uom: s(it.based_uom),
    material_costing_method: it.material_costing_method,
    purchase_unit_price: Number(it.purchase_unit_price || 0),
    item_batch_management: Number(it.item_batch_management || 0),
    table_uom_conversion: arr(it.table_uom_conversion).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_qty: Number(c.base_qty) })),
  };
}
// the deployed engine guard's per-movement refusals (code_node_IBguard bulkGuard)
function guard(m) {
  const t = (v) => s(v).trim();
  for (const f of ["material_id", "plant_id", "location_id"]) if (!DIG.test(t(m[f]))) return f + " not digits";
  if (t(m.batch_id) && !DIG.test(t(m.batch_id))) return "batch_id not digits";
  if (!DIG.test(t(m.organization_id))) return "organization_id not digits";
  if (m.direction === "ADD" && t(m.batch_number) && t(m.batch_number) !== "-" && !t(m.batch_id)) return "UNSUPPORTED_NEW_BATCH";
  return null;
}
const costRow = (p, r) => Object.assign({}, r, { id: s(r.id), material_id: s(p.material_id), plant_id: s(p.plant_id), organization_id: s(p.organization_id), batch_id: r.batch_id === undefined || r.batch_id === null || s(r.batch_id) === "0" ? null : s(r.batch_id) });
const balRow = (p, r, extra) => Object.assign({}, r, { id: s(r.id), material_id: s(p.material_id), location_id: s(p.location_id), plant_id: s(p.plant_id), organization_id: s(p.organization_id) }, extra || {});
const unionById = (...lists) => {
  const seen = {};
  const outRows = [];
  for (const l of lists) for (const r of l || []) if (!seen[s(r.id)]) (seen[s(r.id)] = true), outRows.push(r);
  return outRows;
};

// The platform stores decimal columns at the tenant's number rule (su_code_num_precision, prod + dev: "Inventory Qty"
// 3 dp, "Inventory Price" 4 dp, rounded half-up, store_raw_value 0). INVENTORY_BULK_APPLY's read-back
// (code_node_IBverify `same`) compares every planned update column and the created rows' value columns at 1e-8, so a
// planned value with more decimals than the rule comes back as REVIEW after the stock is written.
const RULE_DP = { unrestricted_qty: 3, reserved_qty: 3, block_qty: 3, qualityinsp_qty: 3, intransit_qty: 3, balance_quantity: 3, fifo_initial_quantity: 3, fifo_available_quantity: 3, wa_quantity: 3, wa_cost_price: 4, fifo_cost_price: 4 };
function storedAs(v, dp) {
  const t = Math.abs(q8(v)).toFixed(8);
  const scaled = BigInt(t.replace(".", ""));
  const unit = 10n ** BigInt(8 - dp);
  let r = (scaled / unit) * unit;
  if ((scaled % unit) * 2n >= unit) r += unit;
  return (q8(v) < 0 ? -1 : 1) * (Number(r) / 1e8);
}
const CREATE_COLS = { item_balance: Object.keys(RULE_DP).slice(0, 6), item_batch_balance: Object.keys(RULE_DP).slice(0, 6), fifo: ["fifo_initial_quantity"], wa: ["wa_quantity", "wa_cost_price"] };
function verifyRisk(plan, rule) {
  if (rule === undefined) rule = { price: 4, qty: 3 };
  if (!rule) return [];
  const bad = new Set();
  const check = (t, c, v) => {
    if (RULE_DP[c] === undefined || v === null || v === undefined || v === "") return;
    const dp = /cost_price/.test(c) ? rule.price : rule.qty;
    if (dp === undefined || dp === null) return;
    if (Math.abs(q8(v) - q8(storedAs(v, dp))) > 1e-8) bad.add(t + "." + c);
  };
  for (const t of Object.keys(CREATE_COLS)) {
    for (const u of plan.updates[t] || []) for (const c of Object.keys(u.after)) check(t, c, u.after[c]);
    for (const n of plan.creates[t] || []) for (const c of CREATE_COLS[t]) check(t + "(new)", c, n[c]);
  }
  return [...bad].sort();
}

// ------------------------------------------------------------------------------------------------- tally
const tally = {};
const causeTally = {};
const examples = {};
const detail = [];
const readback = {};
const noteReadback = (rec, plan) => {
  const rb = verifyRisk(plan, ruleFor(rec));
  if (!rb.length) return;
  const k = rb.join(" ");
  readback[k] = readback[k] || { n: 0, ids: [] };
  readback[k].n++;
  if (readback[k].ids.length < SHOW) readback[k].ids.push(rec.id);
  readback.__runs = (readback.__runs || 0) + 1;
};
const bump = (bucket, rec, info) => {
  tally[bucket] = (tally[bucket] || 0) + 1;
  (examples[bucket] = examples[bucket] || []).length < SHOW && examples[bucket].push(rec.id);
  if (DETAIL) detail.push({ id: rec.id, env: rec.env, tenant: rec.tenant, bucket, info });
};
// diffs: [{cause, field, engine, old}]; a cause starting with "known:" is an expected difference
function settle(rec, diffs, flags) {
  for (const f of flags) causeTally["flag:" + f] = (causeTally["flag:" + f] || 0) + 1;
  if (!diffs.length) return bump(flags.length ? "identical (" + flags.join(", ") + ")" : "identical", rec);
  const causes = [...new Set(diffs.map((d) => d.cause))].sort();
  for (const c of causes) {
    causeTally[c] = (causeTally[c] || 0) + 1;
    (examples["cause " + c] = examples["cause " + c] || []).length < SHOW && examples["cause " + c].push(rec.id);
  }
  const unknown = causes.filter((c) => !c.startsWith("known:"));
  bump(unknown.length ? "DIFF:" + unknown.join("+") : causes.join("+"), rec, diffs.slice(0, 12));
}


// the rows the old call really inserted (database) vs what the engine would insert, after the platform's number rule
const dbTally = {};
const dbBump = (k, rec) => {
  dbTally[k] = dbTally[k] || { n: 0, ids: [] };
  dbTally[k].n++;
  if (dbTally[k].ids.length < SHOW) dbTally[k].ids.push(rec.id);
};
const at = (v, dp) => num(storedAs(v, dp));
// a stored decimal equals the engine's value either raw (tenant without a number rule, e.g. dev 000000) or at the rule
const sameStored = (dbv, v, dp) => Math.abs(num(dbv) - num(v)) < 1e-9 || Math.abs(num(dbv) - at(v, dp)) < 1e-9;
// a date column keeps only the date part of what it is given (GR revert passes an ISO timestamp, stored as midnight)
const sameDate = (dbv, v) => day(dbv) === day(v) || (s(dbv).endsWith(" 00:00:00") && day(dbv).slice(0, 10) === day(v).slice(0, 10));
const snowMs = (id) => Number((BigInt(id) >> 22n) + 1288834974657n);
function dbCheck(rec, plan, mvIndex) {
  const db = DBROWS[rec.id];
  if (!db) return;
  const p = rec.params;
  const mv = plan.movements[mvIndex];
  let gone = false; // the run's inserted rows were deleted after it (hard delete): nothing left to compare
  if (mv) {
    // ADD traces name the movement row they inserted; otherwise the matching row nearest the run's own window
    const mvId = s((out(rec, "code_node_4y6n6tGm") || {}).inventoryMovementId);
    if (mvId && !db.movements.some((r) => r.id === mvId)) gone = true;
    const inside = (r) => snowMs(r.id) >= rec.t0 && snowMs(r.id) <= rec.t1;
    const cands = db.movements
      .filter((r) => (mvId ? r.id === mvId : r.movement === mv.movement && eqS(r.transaction_type, mv.transaction_type) && eqS(r.trx_no, mv.trx_no) && eqS(r.bin_location_id, mv.bin_location_id) && eqS(r.batch_number_id || "", mv.batch_number_id || "")))
      .sort((a, b) => inside(b) - inside(a));
    const row = cands.find((r) => sameStored(r.quantity, mv.quantity, 3)) || cands[0];
    if (gone) dbBump("movement: the inserted row no longer exists (deleted after the run)", rec);
    else if (!row) dbBump("movement: not found in its window", rec);
    else {
      const bad = [];
      for (const [c, dp] of [["unit_price", 4], ["total_price", 4], ["quantity", 3], ["base_qty", 3], ["actual_qty", 3], ["actual_base_qty", 3]]) if (!sameStored(row[c], mv[c], dp)) bad.push(c);
      for (const c of ["inventory_category", "parent_trx_no", "plant_id", "organization_id", "uom_id", "base_uom_id", "item_id", "costing_method_id", "handling_unit_id"]) if (!eqS(row[c], mv[c])) bad.push(c);
      for (const c of ["manufacturing_date", "expired_date", "doc_date"]) if (!sameDate(row[c], mv[c])) bad.push(c);
      // a row edited after the run: the database no longer holds what was inserted - the trace's recorded insert decides
      const recRow = rowsOf({ data: out(rec, "add_node_3wRWQCyv") })[0];
      const recSame = recRow && bad.every((c) => (/date/.test(c) ? sameDate(recRow[c], mv[c]) : /price|qty/.test(c) ? sameStored(recRow[c], mv[c], /price/.test(c) ? 4 : 3) : eqS(recRow[c], mv[c])));
      const edited = s(row.update_time).slice(0, 19) > s(row.create_time).slice(0, 19);
      if (bad.length && (recSame || edited)) dbBump("movement: database row edited after the run (" + bad.join(",") + (recSame ? "; the recorded insert equals the engine" : "") + ")", rec);
      else dbBump(bad.length ? "movement: differs in " + bad.join(",") : "movement: identical", rec);
      if (DETAIL && bad.length) detail.push({ id: rec.id, bucket: "db.movement", info: bad.map((c) => [c, mv[c], row[c]]) });
    }
  }
  for (const f of plan.creates.fifo) {
    // the old ADD inserts the layer after its movement row: the first matching layer after it
    const mvId = s((out(rec, "code_node_4y6n6tGm") || {}).inventoryMovementId);
    const row = db.fifo
      .filter((r) => eqS(r.batch_id || "", f.batch_id || "") && sameStored(r.fifo_initial_quantity, f.fifo_initial_quantity, 3) && (!mvId || BigInt(r.id) > BigInt(mvId)))
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];
    if (!row) dbBump(gone ? "fifo layer: no longer exists (the run's rows were deleted after it)" : "fifo layer: not found in its window", rec);
    else {
      const bad = [];
      if (!sameStored(row.fifo_cost_price, f.fifo_cost_price, 4)) bad.push("fifo_cost_price");
      if (Number(row.fifo_sequence) !== Number(f.fifo_sequence)) bad.push("fifo_sequence");
      dbBump(bad.length ? "fifo layer: differs in " + bad.join(",") : "fifo layer: identical", rec);
      if (DETAIL && bad.length) detail.push({ id: rec.id, bucket: "db.fifo", info: [f, row] });
    }
  }
  for (const w of plan.creates.wa) {
    const row = db.wa.find((r) => eqS(r.batch_id || "", w.batch_id || ""));
    if (!row) dbBump(gone ? "wa row: no longer exists (the run's rows were deleted after it)" : "wa row: not found in its window", rec);
    else if (s(row.update_time).slice(0, 19) > s(row.create_time).slice(0, 19)) dbBump("wa row: updated since (later receipts restate it) - not comparable", rec);
    else {
      const bad = [];
      if (!sameStored(row.wa_cost_price, w.wa_cost_price, 4)) bad.push("wa_cost_price");
      if (!sameStored(row.wa_quantity, w.wa_quantity, 3)) bad.push("wa_quantity");
      dbBump(bad.length ? "wa row: differs in " + bad.join(",") : "wa row: identical", rec);
    }
  }
}
// ------------------------------------------------------------------------------------------------- ADD
const ADD_RET = { return_node_8ZcSkz7f: "VALIDATION_FAILED", return_node_ywhXsqEN: "ITEM_NOT_FOUND", return_node_EAFxgDzE: "401" };

function addInputs(rec) {
  const p = rec.params;
  const itemData = (out(rec, "code_node_3XzQSsce") || {}).itemData;
  const gm = out(rec, "code_node_GMSJTmJr");
  const batchId = gm ? gm.batchId || null : p.batch_id || null;
  const newBatch = has(rec, "add_node_F9KqZLfd") || !!(p.batch_number !== "-" && p.batch_number && !p.batch_id);
  const m = Object.assign({}, p, { movement_key: "m", direction: "ADD" });
  delete m.itemData;
  if (newBatch && batchId) m.batch_id = batchId; // the caller pre-creates the batch row and passes its id
  const fifoNode = has(rec, "search_node_iUYUmyOO") ? "search_node_iUYUmyOO" : "search_node_tu6khdXJ";
  return {
    itemData,
    batchId,
    newBatch,
    m,
    fifoNode,
    input: {
      operationKey: "R",
      items: itemData ? { [s(p.material_id)]: adaptItem(itemData) } : {},
      itemBalances: rowsOf(out(rec, "get_node_c4YkI6sb")).map((r) => balRow(p, r)),
      batchBalances: batchId ? rowsOf(out(rec, "get_node_OppesjaR")).map((r) => balRow(p, r, { batch_id: s(batchId) })) : [],
      fifoLayers: rowsOf(out(rec, fifoNode)).map((r) => costRow(p, r)),
      waRows: rowsOf(out(rec, "search_node_sE4TyFdE")).map((r) => costRow(p, r)),
      movements: [m],
      nowText: "",
    },
  };
}

// prod kept running the code before v65 / v58 (toFixed(4) prices, toFixed(3) quantities) until 2026-09-22 18:12
const preV65 = (rec) => rec.code === "pre-v65";
function addCase(rec) {
  if (preV65(rec)) return bump("skip:ran pre-v65 code", rec);
  const p = rec.params;
  const x = addInputs(rec);
  const flags = [];
  if (!x.itemData && rec.exit !== "return_node_8ZcSkz7f" && rec.exit !== "return_node_ywhXsqEN") return bump("skip:no-item-in-trace", rec);
  for (const id of ["get_node_c4YkI6sb", "get_node_OppesjaR", x.fifoNode, "search_node_sE4TyFdE"]) if (traceCut(rec, id)) return bump("skip:trace-cut", rec, id);
  if (x.newBatch) flags.push("new-batch pre-created");
  const g = guard(x.m);
  if (g) flags.push("guard:" + g);
  const plan = engine.planBulk(x.input);

  if (rec.status !== "Complete") {
    if (plan.ok && /minimum not match/.test(rec.error) && plan.movements.some((x) => num(x.unit_price) < 0 || num(x.total_price) < 0)) return bump("DIFF:negative unit_price (old add-node refused it; engine plans it)", rec, { exit: rec.exit, error: rec.error });
    return bump(plan.ok ? "DIFF:old-run-failed-engine-ok" : "ok-fail:" + plan.failure.code, rec, { exit: rec.exit, error: rec.error });
  }
  if (ADD_RET[rec.exit]) {
    const want = ADD_RET[rec.exit];
    const got = plan.ok ? plan.results[0].code : plan.failure.code;
    return bump(got === want ? "ok-fail:" + want : "DIFF:expected-" + want + "-got-" + got, rec);
  }
  if (rec.exit !== "return_node_ealaqKXT") return bump("skip:exit " + rec.exit, rec);
  if (!plan.ok) return settle(rec, [{ cause: "engine-failed:" + plan.failure.code, field: "plan", engine: plan.failure.message, old: "ok" }], flags);

  noteReadback(rec, plan);
  dbCheck(rec, plan, 0);
  const diffs = [];
  const r = plan.results[0];
  const mv = plan.movements[0];
  const uom = out(rec, "code_node_mvszWJ8p") || {};
  const pr = out(rec, "code_node_BzebhJnQ") || {};
  if (!eqN(r.unit_price, pr.unitPrice)) diffs.push({ cause: "price", field: "unit_price", engine: r.unit_price, old: pr.unitPrice });
  if (!eqN(r.total_price, pr.totalPrice)) diffs.push({ cause: "price", field: "total_price", engine: r.total_price, old: pr.totalPrice });
  if (!eqS(r.batch_id, x.batchId)) diffs.push({ cause: "batch_id", field: "result.batch_id", engine: r.batch_id, old: x.batchId });

  // inventory_movement: the row the old add-node wrote (recorded), else its props rebuilt from the code outputs
  const recMv = rowsOf({ data: out(rec, "add_node_3wRWQCyv") })[0];
  if (recMv) recMv.__recorded = true;
  const oldMv = recMv || {
    transaction_type: p.transaction_type, trx_no: p.trx_no, inventory_category: p.inventory_category, parent_trx_no: p.parent_trx_no, movement: "IN",
    plant_id: p.plant_id, organization_id: p.organization_id, doc_date: p.doc_date, manufacturing_date: p.manufacturing_date, expired_date: p.expired_date,
    unit_price: pr.unitPrice, total_price: pr.totalPrice, quantity: uom.altQty, base_qty: uom.baseQty, uom_id: uom.altUOM, base_uom_id: uom.baseUOM,
    item_id: p.material_id, bin_location_id: p.location_id, batch_number_id: x.batchId, costing_method_id: uom.costingMethod,
    actual_qty: uom.altQty, actual_base_qty: uom.baseQty, handling_unit_id: p.handling_unit_id,
  };
  if (!recMv) flags.push("movement rebuilt (not recorded)");
  compareMovement(mv, oldMv, diffs);

  // item_balance
  const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
  const ibCount = countOf(out(rec, "get_node_c4YkI6sb"));
  if (ibCount > 0) {
    const fin = out(rec, "code_node_t7V3DsPG") || {};
    const u = plan.updates.item_balance[0];
    for (const c of QTY) if (!u || !eqN(u.after[c], fin[c])) diffs.push({ cause: "item_balance", field: c, engine: u && u.after[c], old: fin[c] });
  } else {
    const created = rowsOf({ data: out(rec, "add_node_MmpuGQao") })[0] || out(rec, "code_node_aFO7peip") || {};
    const c0 = plan.creates.item_balance[0];
    for (const c of QTY) if (!c0 || !eqN(c0[c], created[c])) diffs.push({ cause: "item_balance(new)", field: c, engine: c0 && c0[c], old: created[c] });
    if (c0 && created.material_uom !== undefined && !eqS(c0.material_uom, created.material_uom)) diffs.push({ cause: "item_balance(new)", field: "material_uom", engine: c0.material_uom, old: created.material_uom });
  }

  // item_batch_balance
  if (x.batchId) {
    const bbCount = countOf(out(rec, "get_node_OppesjaR"));
    if (bbCount > 0) {
      const fin = out(rec, "code_node_YUVUnD8B") || {};
      const u = plan.updates.item_batch_balance[0];
      for (const c of QTY) if (!u || !eqN(u.after[c], fin[c])) diffs.push({ cause: "batch_balance", field: c, engine: u && u.after[c], old: fin[c] });
      for (const c of ["remark", "remark2", "remark3"]) {
        const a = u && u.after[c];
        const b = fin[c]; // absent = the old code returned null/undefined -> the update-node wrote NULL
        if (eqS(a, b) && !(a === "" && (b === undefined || b === null))) continue;
        if ((b === undefined || b === null) && a === "") diffs.push({ cause: "known:remark NULL->''", field: c, engine: a, old: null });
        else diffs.push({ cause: "batch_balance.remark", field: c, engine: a, old: b });
      }
    } else {
      const created = rowsOf({ data: out(rec, "add_node_J7moAYDJ") })[0];
      const c0 = plan.creates.item_batch_balance[0];
      if (!created) flags.push("batch balance add not recorded");
      const want = created || Object.assign({}, out(rec, "code_node_aFO7peip") || {}, { doc_date: p.doc_date, manufacturing_date: p.manufacturing_date, expired_date: p.expired_date, remark: p.remark, remark2: p.remark2, remark3: p.remark3, batch_id: x.batchId });
      for (const c of QTY) if (!c0 || !eqN(c0[c], want[c])) diffs.push({ cause: "batch_balance(new)", field: c, engine: c0 && c0[c], old: want[c] });
      for (const c of ["doc_date", "manufacturing_date", "expired_date"]) if (c0 && day(c0[c]) !== day(want[c])) diffs.push({ cause: "batch_balance(new).date", field: c, engine: c0[c], old: want[c] });
      for (const c of ["remark", "remark2", "remark3"]) if (c0 && !eqS(c0[c], want[c])) diffs.push({ cause: "batch_balance(new).remark", field: c, engine: c0[c], old: want[c] });
      if (c0 && !eqS(c0.batch_id, want.batch_id)) diffs.push({ cause: "batch_balance(new)", field: "batch_id", engine: c0.batch_id, old: want.batch_id });
    }
  } else if (plan.updates.item_batch_balance.length || plan.creates.item_batch_balance.length) diffs.push({ cause: "batch_balance.unexpected", field: "-", engine: 1, old: 0 });

  // costing rows
  const isMovingInv = Number((out(rec, "code_node_3XzQSsce") || {}).isMovingInv || 0);
  const method = uom.costingMethod;
  if (isMovingInv === 0 && method === "First In First Out") {
    const seq = (out(rec, "code_node_EbBqqUx8") || {}).sequenceNumber;
    const f = plan.creates.fifo[0];
    if (!f) diffs.push({ cause: "fifo.missing", field: "fifo", engine: null, old: seq });
    else {
      if (!eqN(f.fifo_cost_price, pr.unitPrice)) diffs.push({ cause: "fifo", field: "fifo_cost_price", engine: f.fifo_cost_price, old: pr.unitPrice });
      if (!eqN(f.fifo_initial_quantity, uom.baseQty) || !eqN(f.fifo_available_quantity, uom.baseQty)) diffs.push({ cause: "fifo", field: "qty", engine: f.fifo_initial_quantity, old: uom.baseQty });
      if (!eqS(f.batch_id, x.batchId)) diffs.push({ cause: "fifo", field: "batch_id", engine: f.batch_id, old: x.batchId });
      if (Number(f.fifo_sequence) !== Number(seq)) diffs.push({ cause: fifoSeqCause(rec, x, f.fifo_sequence, seq), field: "fifo_sequence", engine: f.fifo_sequence, old: seq });
    }
    if (capped(out(rec, x.fifoNode))) flags.push("fifo read hit 100 cap");
  } else if (isMovingInv === 0 && method === "Weighted Average") {
    const wc = out(rec, "code_node_40n1pYig");
    if (wc) {
      const u = plan.updates.wa[0];
      if (!u) diffs.push({ cause: "wa.missing-update", field: "wa", engine: null, old: wc.latestWaId });
      else {
        if (!eqS(u.id, wc.latestWaId)) diffs.push({ cause: waTieCause(rec, u.id, wc.latestWaId), field: "wa.id", engine: u.id, old: wc.latestWaId });
        if (!eqN(u.after.wa_quantity, wc.newWaQuantity)) diffs.push({ cause: "wa", field: "wa_quantity", engine: u.after.wa_quantity, old: wc.newWaQuantity });
        if (!eqN(u.after.wa_cost_price, wc.newWaCostPrice)) diffs.push({ cause: "wa", field: "wa_cost_price", engine: u.after.wa_cost_price, old: wc.newWaCostPrice });
      }
      if (capped(out(rec, "search_node_sE4TyFdE"))) flags.push("wa read hit 100 cap");
    } else {
      const w = plan.creates.wa[0];
      if (!w) diffs.push({ cause: "wa.missing-create", field: "wa", engine: null, old: "add" });
      else {
        if (!eqN(w.wa_cost_price, pr.unitPrice) || !eqN(w.wa_quantity, uom.baseQty)) diffs.push({ cause: "wa(new)", field: "wa", engine: [w.wa_cost_price, w.wa_quantity], old: [pr.unitPrice, uom.baseQty] });
        if (!eqS(w.batch_id, x.batchId)) diffs.push({ cause: "wa(new)", field: "batch_id", engine: w.batch_id, old: x.batchId });
      }
    }
  } else if (plan.creates.fifo.length || plan.creates.wa.length || plan.updates.fifo.length || plan.updates.wa.length) {
    diffs.push({ cause: "costing.unexpected", field: "costing", engine: [plan.creates.fifo.length, plan.creates.wa.length, plan.updates.fifo.length, plan.updates.wa.length], old: 0 });
  }
  if (isMovingInv === 1 && Number(p.unit_price || 0) === 0) flags.push("zero price");
  settle(rec, diffs, flags);
}

function fifoSeqCause(rec, x, engineSeq, oldSeq) {
  const rows = rowsOf(out(rec, x.fifoNode));
  const maxAll = rows.length ? Math.max(...rows.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;
  const nb = rows.filter((l) => !l.batch_id);
  const maxNb = nb.length ? Math.max(...nb.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;
  if (!x.batchId && Number(oldSeq) === maxAll && Number(engineSeq) === maxNb) return "known:non-batch FIFO sequence scope";
  return "fifo_sequence";
}
function waTieCause(rec, engineId, oldId) {
  const rows = rowsOf(out(rec, "search_node_sE4TyFdE"));
  const a = rows.find((r) => s(r.id) === s(engineId));
  const b = rows.find((r) => s(r.id) === s(oldId));
  if (a && b && (s(a.created_at) === s(b.created_at) || !a.created_at || !b.created_at)) return "known:WA newest-row tie-break";
  return "wa.id";
}

function compareMovement(mv, old, diffs) {
  const STR = ["transaction_type", "trx_no", "inventory_category", "parent_trx_no", "movement", "plant_id", "organization_id", "uom_id", "base_uom_id", "item_id", "bin_location_id", "batch_number_id", "costing_method_id", "handling_unit_id"];
  const NUM = ["unit_price", "total_price", "quantity", "base_qty", "actual_qty", "actual_base_qty"];
  const DATE = ["doc_date", "manufacturing_date", "expired_date"];
  for (const c of STR) if (!eqS(mv[c], old[c])) diffs.push({ cause: "movement." + c, field: c, engine: mv[c], old: old[c] });
  // a RECORDED row holds what the platform stored: the column's number rule (price 4 dp, qty 3 dp) applied to what the
  // add-node was given - the engine's add-node goes through the same rule
  const MV_DP = { unit_price: 4, total_price: 4, quantity: 3, base_qty: 3, actual_qty: 3, actual_base_qty: 3 };
  for (const c of NUM) {
    if (eqN(mv[c], old[c])) continue;
    if (old.__recorded && Math.abs(num(storedAs(mv[c], MV_DP[c])) - num(old[c])) < 1e-9) diffs.push({ cause: "known:platform number rule on write (" + MV_DP[c] + " dp)", field: c, engine: mv[c], old: old[c] });
    else diffs.push({ cause: "movement." + c, field: c, engine: mv[c], old: old[c] });
  }
  for (const c of DATE) if (day(mv[c]) !== day(old[c])) diffs.push({ cause: "movement." + c, field: c, engine: mv[c], old: old[c] });
}

// ------------------------------------------------------------------------------------------------- SUBTRACT
const SUB_RET = { return_node_rfb2MFbP: "VALIDATION_FAILED", return_node_UCNawDcR: "ITEM_NOT_FOUND", return_node_50mzzw0X: "401", return_node_Fj0eE8ac: "BALANCE_NOT_FOUND", return_node_UeAJPOPd: "INSUFFICIENT" };
const MIGRATION = ["code_node_YqMfJIMz", "code_node_oz7GGSQA"];

function subInputs(rec) {
  const p = rec.params;
  const itemData = (out(rec, "code_node_TC1cqaOy") || {}).itemData;
  const migrated = MIGRATION.some((id) => has(rec, id));
  const fifoAll = rowsOf(out(rec, "search_node_L50IlXls"));
  const waAll = rowsOf(out(rec, "search_node_FGjULf7c"));
  // the engine reads every FIFO / WA row of material + plant; the old call read them in the migration check and again
  // (batch-scoped or not) for the price - the price reads come after a migration, so they are only added when none ran
  const fifo = migrated ? fifoAll : unionById(fifoAll, rowsOf(out(rec, "search_node_p2K6C5AB")), rowsOf(out(rec, "search_node_7tT1rozD")));
  const wa = migrated ? waAll : unionById(waAll, rowsOf(out(rec, "search_node_7YQdabsq")), rowsOf(out(rec, "search_node_IXHaVq9k")));
  const m = Object.assign({}, p, { movement_key: "m", direction: "SUBTRACT" });
  delete m.itemData;
  return {
    itemData,
    migrated,
    m,
    input: {
      operationKey: "R",
      items: itemData ? { [s(p.material_id)]: adaptItem(itemData) } : {},
      itemBalances: rowsOf(out(rec, "get_node_uaq6Z1ej")).map((r) => balRow(p, r)),
      batchBalances: s(p.batch_id) ? rowsOf(out(rec, "get_node_GjRiq3dT")).map((r) => balRow(p, r, { batch_id: s(p.batch_id) })) : [],
      fifoLayers: fifo.map((r) => costRow(p, r)),
      waRows: wa.map((r) => costRow(p, r)),
      movements: [m],
      nowText: "",
    },
  };
}

function subCase(rec) {
  if (preV65(rec)) return bump("skip:ran pre-v58 code", rec);
  const p = rec.params;
  const x = subInputs(rec);
  const flags = [];
  if (!x.itemData && !["return_node_rfb2MFbP", "return_node_UCNawDcR"].includes(rec.exit)) return bump("skip:no-item-in-trace", rec);
  for (const id of ["get_node_uaq6Z1ej", "get_node_GjRiq3dT", "search_node_L50IlXls", "search_node_FGjULf7c", "search_node_p2K6C5AB", "search_node_7tT1rozD", "search_node_7YQdabsq", "search_node_IXHaVq9k"]) {
    if (traceCut(rec, id)) return bump("skip:trace-cut", rec, id);
  }
  const g = guard(x.m);
  if (g) flags.push("guard:" + g);
  if (capped(out(rec, "search_node_L50IlXls")) || capped(out(rec, "search_node_FGjULf7c"))) flags.push("costing read hit 100 cap");
  const isMovingInv = Number(p.isMovingInv === undefined || p.isMovingInv === null ? 0 : p.isMovingInv);
  const zero = !Number(p.unit_price || 0);
  if (isMovingInv === 1 && zero) flags.push("zero price");
  const plan = (ENGINE_CHANGE ? changed : engine).planBulk(x.input);

  if (rec.status !== "Complete") {
    if (plan.ok && /minimum not match/.test(rec.error) && plan.movements.some((x) => num(x.unit_price) < 0 || num(x.total_price) < 0)) return bump("DIFF:negative unit_price (old add-node refused it; engine plans it)", rec, { exit: rec.exit, error: rec.error });
    return bump(plan.ok ? "DIFF:old-run-failed-engine-ok" : "ok-fail:" + plan.failure.code, rec, { exit: rec.exit, error: rec.error });
  }
  if (SUB_RET[rec.exit]) {
    const want = SUB_RET[rec.exit];
    const got = plan.ok ? plan.results[0].code : plan.failure.code;
    return bump(got === want ? "ok-fail:" + want : "DIFF:expected-" + want + "-got-" + got, rec);
  }
  if (rec.exit !== "return_node_LbWU1lZh" && rec.exit !== "return_node_OR0LXjo9") return bump("skip:exit " + rec.exit, rec);
  if (x.migrated) flags.push("old migrated costing rows");
  if (!plan.ok) {
    if (plan.failure.code === "UNSUPPORTED_COSTING" && x.migrated) return settle(rec, [{ cause: "known:costing migration -> UNSUPPORTED_COSTING" + (zero ? " (zero price)" : " (price given)"), field: "plan", engine: plan.failure.code, old: "migrated" }], flags);
    return settle(rec, [{ cause: "engine-failed:" + plan.failure.code + (x.migrated ? "(old migrated)" : ""), field: "plan", engine: plan.failure.message, old: "ok" }], flags);
  }

  noteReadback(rec, plan);
  dbCheck(rec, plan, 0);
  const diffs = [];
  const r = plan.results[0];
  const mv = plan.movements[0];
  const uom = out(rec, "code_node_wBfvXM2G") || {};
  const calc = out(rec, "code_node_mQnskse9") || {};
  const cur = out(rec, "code_node_DUBS9GZF") || {};
  const priceCause = x.migrated ? "price(after old migration)" : zero && isMovingInv === 1 ? "price(zero-price costed)" : "price";
  if (!eqN(r.unit_price, calc.calculatedUnitPrice)) diffs.push({ cause: subPriceCause(rec, x, priceCause), field: "unit_price", engine: r.unit_price, old: calc.calculatedUnitPrice });
  if (!eqN(r.total_price, calc.totalPrice)) diffs.push({ cause: subPriceCause(rec, x, priceCause), field: "total_price", engine: r.total_price, old: calc.totalPrice });

  const QM = { unrestricted_qty: "unrestrictedQty", reserved_qty: "reservedQty", block_qty: "blockedQty", qualityinsp_qty: "qualityInspectionQty", intransit_qty: "inTransitQty", balance_quantity: "balanceQty" };
  if (countOf(out(rec, "get_node_uaq6Z1ej")) > 0) {
    const u = plan.updates.item_balance[0];
    for (const c of Object.keys(QM)) if (!u || !eqN(u.after[c], calc[QM[c]])) diffs.push({ cause: "item_balance", field: c, engine: u && u.after[c], old: calc[QM[c]] });
  } else if (plan.updates.item_balance.length) diffs.push({ cause: "item_balance.unexpected", field: "-", engine: 1, old: 0 });
  if (s(p.batch_id)) {
    const BM = { unrestricted_qty: "batchUnrestrictedQty", reserved_qty: "batchReservedQty", block_qty: "batchBlockedQty", qualityinsp_qty: "batchQualityInspectionQty", intransit_qty: "batchInTransitQty", balance_quantity: "batchBalanceQty" };
    const u = plan.updates.item_batch_balance[0];
    for (const c of Object.keys(BM)) if (!u || !eqN(u.after[c], calc[BM[c]])) diffs.push({ cause: "batch_balance", field: c, engine: u && u.after[c], old: calc[BM[c]] });
  }

  if (isMovingInv === 0) {
    const fp = out(rec, "code_node_JuWVegvU");
    const want = {};
    for (const u of (fp && fp.updates) || []) want[s(u.id)] = u.fifo_available_quantity;
    const got = {};
    for (const u of plan.updates.fifo) got[u.id] = u.after.fifo_available_quantity;
    for (const id of new Set(Object.keys(want).concat(Object.keys(got)))) if (!(id in want) || !(id in got) || !eqN(want[id], got[id])) diffs.push({ cause: "fifo", field: id, engine: got[id], old: want[id] });
    const wp = out(rec, "code_node_4yvZMf0Q");
    const u = plan.updates.wa[0];
    if (wp && (!u || !eqS(u.id, wp.id) || !eqN(u.after.wa_quantity, wp.wa_quantity))) diffs.push({ cause: "wa", field: "wa", engine: u && [u.id, u.after.wa_quantity], old: [wp.id, wp.wa_quantity] });
    if (!wp && u) diffs.push({ cause: "wa.unexpected", field: "wa", engine: u.id, old: null });
  } else if (plan.updates.fifo.length || plan.updates.wa.length || plan.creates.fifo.length || plan.creates.wa.length) {
    diffs.push({ cause: "costing.unexpected(isMovingInv 1)", field: "costing", engine: [plan.updates.fifo.length, plan.updates.wa.length], old: 0 });
  }

  const batchOut = out(rec, "code_node_MQ0uNcoG");
  const oldMv = {
    transaction_type: p.transaction_type, trx_no: p.trx_no, inventory_category: p.inventory_category, parent_trx_no: p.parent_trx_no, movement: "OUT",
    plant_id: p.plant_id, organization_id: p.organization_id, unit_price: calc.calculatedUnitPrice, total_price: calc.totalPrice,
    quantity: uom.altQty, base_qty: uom.baseQty, uom_id: uom.altUOM, base_uom_id: uom.baseUOM, item_id: p.material_id, bin_location_id: p.location_id,
    batch_number_id: batchOut ? batchOut.batchId : p.batch_id, costing_method_id: uom.costingMethod, manufacturing_date: cur.manufacturingDate,
    expired_date: cur.expiredDate, doc_date: p.doc_date, actual_qty: uom.actualAltQty, actual_base_qty: uom.actualBaseQty, handling_unit_id: p.handling_unit_id,
  };
  const before = diffs.length;
  compareMovement(mv, oldMv, diffs);
  for (let i = before; i < diffs.length; i++) if (/unit_price|total_price/.test(diffs[i].field)) diffs[i].cause = subPriceCause(rec, x, priceCause);

  if (rec.exit === "return_node_LbWU1lZh") {
    const ret = out(rec, "return_node_LbWU1lZh") || {};
    if (!eqN(r.unit_price, ret.unit_price)) diffs.push({ cause: subPriceCause(rec, x, priceCause), field: "response.unit_price", engine: r.unit_price, old: ret.unit_price });
    if (day(r.manufacturing_date) !== day(ret.manufacturing_date)) diffs.push({ cause: "response.dates", field: "manufacturing_date", engine: r.manufacturing_date, old: ret.manufacturing_date });
    if (day(r.expired_date) !== day(ret.expired_date)) diffs.push({ cause: "response.dates", field: "expired_date", engine: r.expired_date, old: ret.expired_date });
  }
  settle(rec, diffs, flags);
}

// a price the old call computed from rows the engine scopes differently (non-batch reads take every batch's rows)
function subPriceCause(rec, x, base) {
  if (x.migrated) return base;
  const p = rec.params;
  if (!s(p.batch_id)) {
    const fifo = rowsOf(out(rec, "search_node_p2K6C5AB"));
    const wa = rowsOf(out(rec, "search_node_7YQdabsq"));
    if (fifo.some((r) => r.batch_id) || wa.some((r) => r.batch_id)) return "known?:non-batch price read includes batch rows";
  }
  if (capped(out(rec, "search_node_p2K6C5AB")) || capped(out(rec, "search_node_7tT1rozD")) || capped(out(rec, "search_node_7YQdabsq")) || capped(out(rec, "search_node_IXHaVq9k"))) return "known:read beyond 100 cap";
  return base;
}

// ------------------------------------------------------------------------------------------------- PAIRS (putaway)
function pairs(subRecs, addRecs) {
  const key = (r) => [r.env, r.tenant, s(r.params.trx_no), s(r.params.material_id), s(r.params.batch_id), s(r.params.material_uom), num(r.params.quantity), s(r.params.plant_id)].join("|");
  const adds = {};
  for (const a of addRecs) (adds[key(a)] = adds[key(a)] || []).push(a);
  for (const k of Object.keys(adds)) adds[k].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const used = {};
  const matched = [];
  const subsSorted = subRecs.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const sub of subsSorted) {
    const cand = (adds[key(sub)] || []).find((a) => !used[a.id] && BigInt(a.id) > BigInt(sub.id) && Number(a.params.index) === Number(sub.params.index) + 1 && a.t0 - sub.t1 < 120000);
    if (!cand) {
      bump(sub.status === "Complete" && sub.exit === "return_node_LbWU1lZh" ? "pair:SUBTRACT without ADD" : "pair:SUBTRACT failed/exited (" + sub.exit + ")", sub);
      continue;
    }
    used[cand.id] = true;
    matched.push([sub, cand]);
  }
  for (const a of addRecs) if (!used[a.id]) bump("pair:ADD without SUBTRACT", a);

  for (const [sub, add] of matched) {
    if (preV65(sub) || preV65(add)) {
      bump("skip:ran pre-v58/v65 code", sub);
      continue;
    }
    const flags = [];
    const diffs = [];
    const sp = sub.params;
    const ap = add.params;
    const ret = out(sub, "return_node_LbWU1lZh") || {};
    // the classic putaway: the line price on both calls, the ADD's dates = the SUBTRACT's response dates (|| "")
    if (!eqN(sp.unit_price, ap.unit_price)) diffs.push({ cause: "caller:price differs between SUBTRACT and ADD", field: "unit_price", engine: ap.unit_price, old: sp.unit_price });
    if (s(ap.manufacturing_date) !== s(ret.manufacturing_date || "") || s(ap.expired_date) !== s(ret.expired_date || "")) diffs.push({ cause: "caller:ADD dates are not the SUBTRACT's", field: "dates", engine: [ap.manufacturing_date, ap.expired_date], old: [ret.manufacturing_date, ret.expired_date] });
    const subCalc = out(sub, "code_node_mQnskse9") || {};
    const addPr = out(add, "code_node_BzebhJnQ") || {};
    if (!Number(sp.unit_price || 0)) {
      flags.push("zero price");
      if (num(subCalc.calculatedUnitPrice) !== 0) flags.push("zero price: OUT costed " + (num(addPr.unitPrice) === 0 ? "/ IN 0" : "/ IN " + addPr.unitPrice));
    }
    const si = subInputs(sub);
    const ai = addInputs(add);
    if (si.migrated) flags.push("old migrated costing rows");
    // ONE plan: SUBTRACT source then ADD target; a row both calls read keeps the SUBTRACT's (earlier) read
    const keyB = (r) => [r.material_id, r.location_id, r.plant_id, r.organization_id].join("|");
    const keyT = (r) => [r.material_id, r.location_id, r.batch_id, r.plant_id, r.organization_id].join("|");
    const merge = (a, b, k) => {
      const seen = {};
      for (const r of a) seen[k(r)] = true;
      return a.concat(b.filter((r) => !seen[k(r)]));
    };
    const sameBin = keyB(si.input.itemBalances[0] || { material_id: sp.material_id, location_id: sp.location_id, plant_id: sp.plant_id, organization_id: sp.organization_id }) === keyB({ material_id: ap.material_id, location_id: ap.location_id, plant_id: ap.plant_id, organization_id: ap.organization_id });
    if (sameBin) flags.push("same bin");
    const addM = Object.assign({}, ai.m, { movement_key: "in" });
    const subM = Object.assign({}, si.m, { movement_key: "out" });
    const input = {
      operationKey: "R",
      items: Object.assign({}, ai.input.items, si.input.items),
      itemBalances: merge(si.input.itemBalances, ai.input.itemBalances, keyB),
      batchBalances: merge(si.input.batchBalances, ai.input.batchBalances, keyT),
      fifoLayers: si.input.fifoLayers,
      waRows: si.input.waRows,
      movements: [subM, addM],
      nowText: "",
    };
    const plan = (ENGINE_CHANGE ? changed : engine).planBulk(input);
    if (sub.exit === "return_node_50mzzw0X" && add.exit === "return_node_EAFxgDzE") {
      bump(plan.ok && plan.results.every((r) => r.code === "401") ? "ok-fail:401 (both)" : "DIFF:401 pair", sub);
      continue;
    }
    if (sub.status !== "Complete" || add.status !== "Complete" || sub.exit !== "return_node_LbWU1lZh" || add.exit !== "return_node_ealaqKXT") {
      bump("pair:old failed (" + sub.exit + " / " + add.exit + ")", sub);
      continue;
    }
    if (!plan.ok) {
      settle(sub, diffs.concat([{ cause: (si.migrated && plan.failure.code === "UNSUPPORTED_COSTING" ? "known:costing migration -> UNSUPPORTED_COSTING" : "engine-failed:" + plan.failure.code) + " (pair)", field: "plan", engine: plan.failure.code, old: "ok" }]), flags);
      continue;
    }
    noteReadback(sub, plan);
    const [ro, ri] = plan.results;
    if (!eqN(ro.unit_price, subCalc.calculatedUnitPrice)) diffs.push({ cause: "pair.OUT price", field: "unit_price", engine: ro.unit_price, old: subCalc.calculatedUnitPrice });
    if (!eqN(ri.unit_price, addPr.unitPrice) || !eqN(ri.total_price, addPr.totalPrice)) diffs.push({ cause: "pair.IN price", field: "unit_price", engine: [ri.unit_price, ri.total_price], old: [addPr.unitPrice, addPr.totalPrice] });
    const mvIn = plan.movements[1];
    const recMv = rowsOf({ data: out(add, "add_node_3wRWQCyv") })[0];
    if (recMv) {
      recMv.__recorded = true;
      const d0 = diffs.length;
      compareMovement(mvIn, recMv, diffs);
      for (let i = d0; i < diffs.length; i++) diffs[i].cause = "pair.IN " + diffs[i].cause;
    }
    // final row values: target rows = the ADD's computed values; source rows = the SUBTRACT's (unless the ADD touched them)
    const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
    const QM = { unrestricted_qty: "unrestrictedQty", reserved_qty: "reservedQty", block_qty: "blockedQty", qualityinsp_qty: "qualityInspectionQty", intransit_qty: "inTransitQty", balance_quantity: "balanceQty" };
    const findAfter = (table, id) => (plan.updates[table].find((u) => u.id === s(id)) || {}).after;
    const ib = rowsOf(out(add, "get_node_c4YkI6sb"))[0];
    if (ib) {
      const fin = out(add, "code_node_t7V3DsPG") || {};
      const a = findAfter("item_balance", ib.id);
      if (!sameBin || a) for (const c of QTY) if (!a || !eqN(a[c], fin[c])) diffs.push({ cause: "pair.target item_balance", field: c, engine: a && a[c], old: fin[c] });
    }
    const sb = rowsOf(out(sub, "get_node_uaq6Z1ej"))[0];
    if (sb && !sameBin) {
      const a = findAfter("item_balance", sb.id);
      for (const c of QTY) if (!a || !eqN(a[c], subCalc[QM[c]])) diffs.push({ cause: "pair.source item_balance", field: c, engine: a && a[c], old: subCalc[QM[c]] });
    }
    const tb = rowsOf(out(add, "get_node_OppesjaR"))[0];
    if (tb) {
      const fin = out(add, "code_node_YUVUnD8B") || {};
      const a = findAfter("item_batch_balance", tb.id);
      for (const c of QTY) if (!a || !eqN(a[c], fin[c])) diffs.push({ cause: "pair.target batch_balance", field: c, engine: a && a[c], old: fin[c] });
      // planBulk snaps a row's columns on its FIRST touch: when the SUBTRACT touched this row first, the remarks are not
      // in `after` and the engine leaves them as stored (the value the plan read)
      const seed = input.batchBalances.find((r) => s(r.id) === s(tb.id)) || {};
      if (a && !("remark" in a)) flags.push("remarks not rewritten (row first touched by the SUBTRACT)");
      for (const c of ["remark", "remark2", "remark3"]) {
        const ev = a && c in a ? a[c] : seed[c] === undefined ? null : seed[c];
        const ov = fin[c];
        if ((ev === null || ev === undefined) && (ov === null || ov === undefined)) continue;
        if (eqS(ev, ov) && !(ev === "" && (ov === undefined || ov === null))) continue;
        diffs.push({ cause: (ov === undefined || ov === null) && ev === "" ? "known:remark NULL->''" : "pair.target batch remark", field: c, engine: ev, old: ov });
      }
    } else if (s(ap.batch_id)) {
      const created = rowsOf({ data: out(add, "add_node_J7moAYDJ") })[0];
      const c0 = plan.creates.item_batch_balance[0];
      if (created) {
        for (const c of QTY) if (!c0 || !eqN(c0[c], created[c])) diffs.push({ cause: "pair.target batch_balance(new)", field: c, engine: c0 && c0[c], old: created[c] });
        for (const c of ["manufacturing_date", "expired_date"]) if (c0 && day(c0[c]) !== day(created[c])) diffs.push({ cause: "pair.target batch_balance(new).date", field: c, engine: c0[c], old: created[c] });
      }
    }
    if (plan.updates.fifo.length || plan.updates.wa.length || plan.creates.fifo.length || plan.creates.wa.length) diffs.push({ cause: "pair.costing.unexpected", field: "costing", engine: 1, old: 0 });
    settle(sub, diffs, flags);
  }
}


// ------------------------------------------------------------------------------------------------- CHAIN (one document)
const EPOCH = 1288834974657n;
const idMs = (id) => Number((BigInt(id) >> 22n) + EPOCH);
function chain(recs) {
  const groups = [];
  const byDoc = {};
  for (const r of recs.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
    const k = [r.env, r.tenant, s(r.params.transaction_type), s(r.params.trx_no)].join("|");
    const g = byDoc[k];
    const last = g && g[g.length - 1];
    // a new completion: the loop index starts again, or a long gap
    if (!g || r.t0 - last.t1 > 300000 || (Number(r.params.index) <= Number(last.params.index) && !(isSub(last) && !isSub(r)))) groups.push((byDoc[k] = [r]));
    else g.push(r);
  }
  for (const g of groups) chainGroup(g);
}
function isSub(r) {
  return has(r, "code_node_TC1cqaOy") || r.exit in SUB_RET || r.exit === "return_node_LbWU1lZh" || r.exit === "return_node_OR0LXjo9";
}
function chainGroup(g) {
  const head = g[0];
  const flags = ["lines " + (g.length <= 1 ? "1" : g.length <= 5 ? "2-5" : g.length <= 20 ? "6-20" : ">20")];
  if (g.some(preV65)) return bump("skip:ran pre-v58/v65 code", head);
  if (g.some((r) => r.status !== "Complete")) return bump("chain:skip (a call failed)", head);
  const startMs = head.t0;
  const items = {};
  const seed = { itemBalances: {}, batchBalances: {}, fifoLayers: {}, waRows: {} };
  const movements = [];
  const per = [];
  for (let i = 0; i < g.length; i++) {
    const r = g[i];
    const sub = isSub(r);
    const x = sub ? subInputs(r) : addInputs(r);
    if (x.itemData) Object.assign(items, x.input.items);
    for (const t of Object.keys(seed)) {
      for (const row of x.input[t]) {
        // a row created inside the document's window is one the plan makes itself
        if (idMs(row.id) >= startMs) continue;
        if (!seed[t][row.id]) seed[t][row.id] = row;
      }
    }
    const m = Object.assign({}, x.m, { movement_key: "k" + i });
    movements.push(m);
    per.push({ r, sub, x });
  }
  const input = {
    operationKey: "R",
    items,
    itemBalances: Object.values(seed.itemBalances),
    batchBalances: Object.values(seed.batchBalances),
    fifoLayers: Object.values(seed.fifoLayers),
    waRows: Object.values(seed.waRows),
    movements,
    nowText: "",
  };
  const plan = (ENGINE_CHANGE ? changed : engine).planBulk(input);
  const migrated = per.some(({ r }) => MIGRATION.some((id) => has(r, id)));
  if (migrated) flags.push("old migrated costing rows");
  if (!plan.ok) {
    const known = plan.failure.code === "UNSUPPORTED_COSTING" && migrated;
    return settle(head, [{ cause: known ? "known:costing migration -> UNSUPPORTED_COSTING (document)" : "chain.engine-failed:" + plan.failure.code, field: plan.failure.movement_key, engine: plan.failure.message, old: "ok" }], flags);
  }
  noteReadback(head, plan);
  const diffs = [];
  const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
  const QM = { unrestricted_qty: "unrestrictedQty", reserved_qty: "reservedQty", block_qty: "blockedQty", qualityinsp_qty: "qualityInspectionQty", intransit_qty: "inTransitQty", balance_quantity: "balanceQty" };
  const BM = { unrestricted_qty: "batchUnrestrictedQty", reserved_qty: "batchReservedQty", block_qty: "batchBlockedQty", qualityinsp_qty: "batchQualityInspectionQty", intransit_qty: "batchInTransitQty", balance_quantity: "batchBalanceQty" };
  const lastOld = { ib: {}, bb: {} }; // natural key -> the values the LAST call touching that row computed
  const oldFifo = [];
  const oldWa = {};
  const oldWaNew = [];
  const mvByKey = {};
  for (const mv of plan.movements) mvByKey[mv.operation_effect_key] = mv;
  per.forEach(({ r, sub, x }, i) => {
    const p = r.params;
    const res = plan.results[i];
    const ib = [s(p.material_id), s(p.location_id), s(p.plant_id)].join("|");
    if (r.exit === "return_node_50mzzw0X" || r.exit === "return_node_EAFxgDzE") {
      if (res.code !== "401") diffs.push({ cause: "chain.401", field: "k" + i, engine: res.code, old: "401" });
      return;
    }
    if (sub) {
      const calc = out(r, "code_node_mQnskse9") || {};
      if (!eqN(res.unit_price, calc.calculatedUnitPrice)) diffs.push({ cause: "chain.price", field: "k" + i, engine: res.unit_price, old: calc.calculatedUnitPrice });
      if (countOf(out(r, "get_node_uaq6Z1ej")) > 0) lastOld.ib[ib] = Object.fromEntries(QTY.map((c) => [c, calc[QM[c]]]));
      if (s(p.batch_id)) lastOld.bb[ib + "|" + s(p.batch_id)] = Object.fromEntries(QTY.map((c) => [c, calc[BM[c]]]));
      const uom = out(r, "code_node_wBfvXM2G") || {};
      const cur = out(r, "code_node_DUBS9GZF") || {};
      const b = out(r, "code_node_MQ0uNcoG");
      compareMovementChain(mvByKey["R|k" + i], { transaction_type: p.transaction_type, trx_no: p.trx_no, inventory_category: p.inventory_category, parent_trx_no: p.parent_trx_no, movement: "OUT", plant_id: p.plant_id, organization_id: p.organization_id, unit_price: calc.calculatedUnitPrice, total_price: calc.totalPrice, quantity: uom.altQty, base_qty: uom.baseQty, uom_id: uom.altUOM, base_uom_id: uom.baseUOM, item_id: p.material_id, bin_location_id: p.location_id, batch_number_id: b ? b.batchId : p.batch_id, costing_method_id: uom.costingMethod, manufacturing_date: cur.manufacturingDate, expired_date: cur.expiredDate, doc_date: p.doc_date, actual_qty: uom.actualAltQty, actual_base_qty: uom.actualBaseQty, handling_unit_id: p.handling_unit_id }, diffs, i);
    } else {
      const pr = out(r, "code_node_BzebhJnQ") || {};
      if (!eqN(res.unit_price, pr.unitPrice) || !eqN(res.total_price, pr.totalPrice)) diffs.push({ cause: "chain.price", field: "k" + i, engine: [res.unit_price, res.total_price], old: [pr.unitPrice, pr.totalPrice] });
      if (!eqS(res.batch_id, x.batchId)) diffs.push({ cause: "chain.batch_id", field: "k" + i, engine: res.batch_id, old: x.batchId });
      lastOld.ib[ib] = countOf(out(r, "get_node_c4YkI6sb")) > 0 ? out(r, "code_node_t7V3DsPG") : rowsOf({ data: out(r, "add_node_MmpuGQao") })[0] || out(r, "code_node_aFO7peip");
      if (x.batchId) lastOld.bb[ib + "|" + s(x.batchId)] = countOf(out(r, "get_node_OppesjaR")) > 0 ? out(r, "code_node_YUVUnD8B") : rowsOf({ data: out(r, "add_node_J7moAYDJ") })[0] || out(r, "code_node_aFO7peip");
      const rec = rowsOf({ data: out(r, "add_node_3wRWQCyv") })[0];
      if (rec) rec.__recorded = true;
      if (rec) compareMovementChain(mvByKey["R|k" + i], rec, diffs, i);
      const isMovingInv = Number((out(r, "code_node_3XzQSsce") || {}).isMovingInv || 0);
      const method = (out(r, "code_node_mvszWJ8p") || {}).costingMethod;
      if (isMovingInv === 0 && method === "First In First Out") oldFifo.push({ i, cost: pr.unitPrice, qty: (out(r, "code_node_mvszWJ8p") || {}).baseQty, batch: x.batchId, seq: (out(r, "code_node_EbBqqUx8") || {}).sequenceNumber });
      if (isMovingInv === 0 && method === "Weighted Average") {
        const wc = out(r, "code_node_40n1pYig");
        if (wc) oldWa[s(wc.latestWaId)] = wc;
        else oldWaNew.push({ i, cost: pr.unitPrice, qty: (out(r, "code_node_mvszWJ8p") || {}).baseQty, batch: x.batchId });
      }
    }
  });
  // final row values: engine (update after, or the created row) vs the last call's computed values
  const engIb = {};
  for (const u of plan.updates.item_balance) {
    const row = input.itemBalances.find((x) => s(x.id) === u.id);
    engIb[[row.material_id, row.location_id, row.plant_id].join("|")] = u.after;
  }
  for (const c of plan.creates.item_balance) engIb[[c.material_id, c.location_id, c.plant_id].join("|")] = c;
  const engBb = {};
  for (const u of plan.updates.item_batch_balance) {
    const row = input.batchBalances.find((x) => s(x.id) === u.id);
    engBb[[row.material_id, row.location_id, row.plant_id, row.batch_id].join("|")] = u.after;
  }
  for (const c of plan.creates.item_batch_balance) engBb[[c.material_id, c.location_id, c.plant_id, s(c.batch_id)].join("|")] = c;
  for (const [k, want] of Object.entries(lastOld.ib)) for (const c of QTY) if (!engIb[k] || !eqN(engIb[k][c], (want || {})[c])) diffs.push({ cause: "chain.item_balance", field: k + "." + c, engine: engIb[k] && engIb[k][c], old: (want || {})[c] });
  for (const [k, want] of Object.entries(lastOld.bb)) for (const c of QTY) if (!engBb[k] || !eqN(engBb[k][c], (want || {})[c])) diffs.push({ cause: "chain.batch_balance", field: k + "." + c, engine: engBb[k] && engBb[k][c], old: (want || {})[c] });
  if (plan.creates.fifo.length !== oldFifo.length) diffs.push({ cause: "chain.fifo.count", field: "fifo", engine: plan.creates.fifo.length, old: oldFifo.length });
  plan.creates.fifo.forEach((f, j) => {
    const o = oldFifo[j];
    if (!o) return;
    if (!eqN(f.fifo_cost_price, o.cost) || !eqN(f.fifo_initial_quantity, o.qty) || !eqS(f.batch_id, o.batch)) diffs.push({ cause: "chain.fifo", field: "k" + o.i, engine: [f.fifo_cost_price, f.fifo_initial_quantity, f.batch_id], old: [o.cost, o.qty, o.batch] });
    if (Number(f.fifo_sequence) !== Number(o.seq)) diffs.push({ cause: "chain.fifo_sequence", field: "k" + o.i, engine: f.fifo_sequence, old: o.seq });
  });
  for (const u of plan.updates.wa) {
    const o = oldWa[u.id];
    if (!o) diffs.push({ cause: "chain.wa.unexpected", field: u.id, engine: u.after, old: null });
    else if (!eqN(u.after.wa_quantity, o.newWaQuantity) || !eqN(u.after.wa_cost_price, o.newWaCostPrice)) diffs.push({ cause: "chain.wa", field: u.id, engine: [u.after.wa_quantity, u.after.wa_cost_price], old: [o.newWaQuantity, o.newWaCostPrice] });
  }
  for (const id of Object.keys(oldWa)) if (!plan.updates.wa.some((u) => u.id === id) && idMs(id) < startMs) diffs.push({ cause: "chain.wa.missing", field: id, engine: null, old: oldWa[id].newWaCostPrice });
  // a WA row the plan created and a later call updated: the engine's created row holds the final values
  const waRestatedNew = Object.keys(oldWa).filter((id) => idMs(id) >= startMs);
  if (plan.creates.wa.length !== oldWaNew.length) diffs.push({ cause: "chain.wa(new).count", field: "wa", engine: plan.creates.wa.length, old: oldWaNew.length + (waRestatedNew.length ? " (+" + waRestatedNew.length + " restated)" : "") });
  if (per.length > 1) flags.push("chained");
  settle(head, diffs, flags);
}
function compareMovementChain(mv, old, diffs, i) {
  if (!mv) return diffs.push({ cause: "chain.movement.missing", field: "k" + i, engine: null, old: "row" });
  const d0 = diffs.length;
  compareMovement(mv, old, diffs);
  for (let j = d0; j < diffs.length; j++) if (!diffs[j].cause.startsWith("known:")) diffs[j].cause = "chain." + diffs[j].cause;
}


// ------------------------------------------------------------------------------------------------- READBACK study
// node replay_old.js READBACK <fixtures.jsonl...> --rules rules.json [--per-call] [--ids a,b]: one plan per document (or
// per call), every value the engine writes stored at the tenant's number rule, and INVENTORY_BULK_APPLY's read-back
// (code_node_IBverify: planned update columns + created rows' valueFields, 1e-8) applied to it. Failing documents of GRN
// receipts are planned again with the price pre-rounded to the rule by the caller and compared with what the old stored.
const RB_CLASS = (k) =>
  k.startsWith("item_balance") ? "item_balance qty" : k.startsWith("item_batch_balance") ? "item_batch_balance qty" : k.startsWith("fifo(new)") ? "fifo create" : k.startsWith("fifo.") ? "fifo update" : k.startsWith("wa(new)") ? "wa create" : k.startsWith("wa.") ? "wa update" : k;
const decs = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const t = q8(v).toFixed(8).replace(/0+$/, "");
  return t.indexOf(".") < 0 ? 0 : t.length - t.indexOf(".") - 1;
};
function groupsOf(recs, perCall) {
  if (perCall) return recs.map((r) => [r]);
  const groups = [];
  const byDoc = {};
  for (const r of recs.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
    const k = [r.env, r.tenant, s(r.params.transaction_type), s(r.params.trx_no)].join("|");
    const g = byDoc[k];
    const last = g && g[g.length - 1];
    if (!g || r.t0 - last.t1 > 300000 || (Number(r.params.index) <= Number(last.params.index) && !(isSub(last) && !isSub(r)))) groups.push((byDoc[k] = [r]));
    else g.push(r);
  }
  return groups;
}
function groupInput(g) {
  const startMs = g[0].t0;
  const items = {};
  const seed = { itemBalances: {}, batchBalances: {}, fifoLayers: {}, waRows: {} };
  const movements = [];
  const per = [];
  g.forEach((r, i) => {
    const sub = isSub(r);
    const x = sub ? subInputs(r) : addInputs(r);
    if (x.itemData) Object.assign(items, x.input.items);
    for (const t of Object.keys(seed)) for (const row of x.input[t]) if (idMs(row.id) < startMs && !seed[t][row.id]) seed[t][row.id] = row;
    movements.push(Object.assign({}, x.m, { movement_key: "k" + i }));
    per.push({ r, sub, x });
  });
  return { per, input: { operationKey: "R", items, itemBalances: Object.values(seed.itemBalances), batchBalances: Object.values(seed.batchBalances), fifoLayers: Object.values(seed.fifoLayers), waRows: Object.values(seed.waRows), movements, nowText: "" } };
}
function readbackStudy(recs) {
  const perCall = flag("--per-call");
  const only = opt("--ids", "") ? new Set(opt("--ids", "").split(",")) : null;
  const unit = perCall ? "calls" : "documents";
  const inc = (o, k, id) => {
    o[k] = o[k] || { n: 0, ids: [] };
    o[k].n++;
    if (id && o[k].ids.length < SHOW) o[k].ids.push(id);
  };
  const skipped = {};
  const fail = {};
  const pre = {};
  const qty3 = {};
  let planned = 0;
  let withRule = 0;
  for (const g of groupsOf(recs.filter((r) => !only || only.has(r.id)), perCall)) {
    if (g.some(preV65)) { inc(skipped, "ran pre-v58/v65 code"); continue; }
    if (g.some((r) => r.status !== "Complete")) { inc(skipped, "a call failed in the old run"); continue; }
    const rule = ruleFor(g[0]);
    const { input, per } = groupInput(g);
    for (const { r, sub } of per) {
      const u = out(r, sub ? "code_node_wBfvXM2G" : "code_node_mvszWJ8p") || {};
      if (decs(u.baseQty) > 3 || decs(u.altQty) > 3) inc(qty3, "call quantity with more than 3 dp", r.id);
    }
    const plan = engine.planBulk(input);
    if (!plan.ok) { inc(skipped, "engine refused: " + plan.failure.code, g[0].id); continue; }
    planned++;
    if (rule) withRule++;
    const classes = [...new Set(verifyRisk(plan, rule).map(RB_CLASS))].sort();
    if (!classes.length) continue;
    for (const c of classes) inc(fail, c, g[0].id);
    inc(fail, "ANY", g[0].id);
    // caller-side: the GRN price pre-rounded to the rule. The engine recomputes a GRN price from po_quantity / po_amount /
    // exchange_rate (core.js:230-237), so the caller has to shape those: 1 / conversion / P4 gives exactly P4.
    const grn = per.map((p) => !p.sub && s(p.r.params.transaction_type) === "GRN" && p.r.exit === "return_node_ealaqKXT");
    if (!grn.some(Boolean)) { for (const c of classes) inc(pre, c + " | not a GRN document (price passed as given)", g[0].id); continue; }
    const stP = (v) => (rule && rule.price !== null && rule.price !== undefined ? storedAs(v, rule.price) : q8(v));
    const stQ = (v) => (rule && rule.qty !== null && rule.qty !== undefined ? storedAs(v, rule.qty) : q8(v));
    const vm = input.movements.map((m, i) => {
      if (!grn[i]) return m;
      const pr = out(per[i].r, "code_node_BzebhJnQ") || {};
      const u = out(per[i].r, "code_node_mvszWJ8p") || {};
      const P4 = stP(pr.unitPrice);
      const conv = q8(num(u.baseQty) / parseFloat(m.quantity));
      return Object.assign({}, m, P4 === 0 ? { po_quantity: 1, po_amount: 0, exchange_rate: 1 } : { po_quantity: 1, po_amount: conv, exchange_rate: P4 });
    });
    const vplan = engine.planBulk(Object.assign({}, input, { movements: vm }));
    if (!vplan.ok) { for (const c of classes) inc(pre, c + " | variant refused " + vplan.failure.code, g[0].id); continue; }
    const diff = new Set();
    let inexact = 0;
    const oldFifo = [];
    const oldWaNew = [];
    const oldWa = {};
    per.forEach((p, i) => {
      if (!grn[i]) return;
      const pr = out(p.r, "code_node_BzebhJnQ") || {};
      const u = out(p.r, "code_node_mvszWJ8p") || {};
      const res = vplan.results[i];
      const mv = vplan.movements.find((x) => x.operation_effect_key === "R|k" + i);
      if (Math.abs(num(res.unit_price) - stP(pr.unitPrice)) > 1e-9) inexact++;
      if (mv && Math.abs(stP(mv.unit_price) - stP(pr.unitPrice)) > 1e-9) diff.add("movement unit_price");
      if (mv && Math.abs(stP(mv.total_price) - stP(pr.totalPrice)) > 1e-9) diff.add("movement total_price");
      const isMovingInv = Number((out(p.r, "code_node_3XzQSsce") || {}).isMovingInv || 0);
      if (isMovingInv === 0 && u.costingMethod === "First In First Out") oldFifo.push({ cost: pr.unitPrice, qty: u.baseQty });
      if (isMovingInv === 0 && u.costingMethod === "Weighted Average") {
        const wc = out(p.r, "code_node_40n1pYig");
        if (wc) oldWa[s(wc.latestWaId)] = wc;
        else oldWaNew.push({ cost: pr.unitPrice, qty: u.baseQty });
      }
    });
    vplan.creates.fifo.forEach((f, j) => {
      const o = oldFifo[j];
      if (o && (Math.abs(stP(f.fifo_cost_price) - stP(o.cost)) > 1e-9 || Math.abs(stQ(f.fifo_initial_quantity) - stQ(o.qty)) > 1e-9)) diff.add("fifo layer");
    });
    for (const w of vplan.updates.wa) {
      const o = oldWa[w.id];
      if (!o) continue;
      if (Math.abs(stP(w.after.wa_cost_price) - stP(o.newWaCostPrice)) > 1e-9) diff.add("wa restate cost");
      if (Math.abs(stQ(w.after.wa_quantity) - stQ(o.newWaQuantity)) > 1e-9) diff.add("wa restate qty");
    }
    vplan.creates.wa.forEach((w, j) => {
      const o = oldWaNew[j];
      if (o && (Math.abs(stP(w.wa_cost_price) - stP(o.cost)) > 1e-9 || Math.abs(stQ(w.wa_quantity) - stQ(o.qty)) > 1e-9)) diff.add("new wa row");
    });
    const vclasses = [...new Set(verifyRisk(vplan, rule).map(RB_CLASS))].sort();
    const verdict = (vclasses.length ? "still fails (" + vclasses.join(", ") + ")" : "read-back passes") + "; stored rows " + (diff.size ? "differ from the old (" + [...diff].sort().join(", ") + ")" : "identical to the old") + (inexact ? "; price lever inexact" : "");
    for (const c of classes) inc(pre, c + " | " + verdict, g[0].id);
  }
  const pr = (title, o) => {
    console.log(title);
    for (const k of Object.keys(o).sort()) console.log(String(o[k].n).padStart(6) + " " + k + (o[k].ids.length ? "  e.g. " + o[k].ids.join(" ") : ""));
  };
  console.log("READBACK", recs.length, "runs from", files.map((f) => path.basename(f)).join(", "), "|", planned, unit, "planned (" + withRule + " in a tenant with a number rule)");
  pr("-- skipped " + unit, skipped);
  pr("-- " + unit + " whose read-back would answer REQUIRES_REVIEW, by table (ANY = at least one)", fail);
  pr("-- quantities entering the plan", qty3);
  pr("-- failing " + unit + " re-planned with the GRN price pre-rounded to the rule by the caller", pre);
}

// ------------------------------------------------------------------------------------------------- main
const load = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let n = 0;
if (mode === "PAIRS") {
  const subs = load(files[0]);
  const adds = load(files[1]);
  n = subs.length + adds.length;
  pairs(subs, adds);
} else if (mode === "READBACK") {
  const all = [].concat(...files.map(load));
  readbackStudy(all);
  process.exit(0);
} else if (mode === "CHAIN") {
  const all = [].concat(...files.map(load));
  n = all.length;
  chain(all);
} else {
  for (const f of files) {
    for (const rec of load(f)) {
      n++;
      try {
        (mode === "ADD" ? addCase : subCase)(rec);
      } catch (e) {
        bump("ERROR:" + e.message.slice(0, 80), rec);
      }
    }
  }
}
console.log(mode + (ENGINE_CHANGE ? " (engine change)" : ""), n, "runs from", files.map((f) => path.basename(f)).join(", "));
for (const k of Object.keys(tally).sort()) console.log(String(tally[k]).padStart(6), k);
console.log("-- causes / flags (runs)");
for (const k of Object.keys(causeTally).sort()) console.log(String(causeTally[k]).padStart(6), k);
console.log("-- example instance ids");
for (const k of Object.keys(examples).sort()) if (k !== "identical") console.log(k + ": " + examples[k].join(" "));
if (Object.keys(DBROWS).length) {
  console.log("-- inserted rows read back from the database vs the engine's (after the number rule)");
  for (const k of Object.keys(dbTally).sort()) console.log(String(dbTally[k].n).padStart(6) + " " + k + "  e.g. " + dbTally[k].ids.join(" "));
}
console.log("-- engine read-back would answer REVIEW (planned value finer than the column's number rule): " + (readback.__runs || 0) + " runs");
for (const k of Object.keys(readback).filter((x) => x !== "__runs").sort()) console.log(String(readback[k].n).padStart(6) + " " + k + "  e.g. " + readback[k].ids.join(" "));
if (DETAIL) fs.writeFileSync(DETAIL, JSON.stringify(detail, null, 1));
