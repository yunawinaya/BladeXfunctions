// LOT engine parity. Replays the classic SUBTRACT_INVENTORY (v58) / ADD_INVENTORY (v65) calls SM_LOCATION_TRANSFER made
// (transaction_type "LOT") through INVENTORY_BULK_APPLY's planner - scratchpad/gdc/engine/core.js, required read-only from
// its path - with the rows each call read and the tenant's number rules (planBulk `precision`, as code_node_IBplan builds
// it), and compares what the engine would write with what the classic call computed / wrote.
// Adapted from scratchpad/grv2/parity/replay_old.js (GRN / TO - PA / GRN-R).
//
//   node replay_old.js SUBTRACT <sub.jsonl> [--db sub.db.jsonl]   (a) each SUBTRACT call alone, as one movement
//   node replay_old.js ADD <add.jsonl> [--db add.db.jsonl]        (a) each ADD call alone (its recorded unit_price + dates)
//   node replay_old.js PAIRS <sub.jsonl> <add.jsonl> [--db s,a]   (b) each SUBTRACT with the ADD its LOT run made next for
//        the same entry, as the two movements V2 sends - M<n> SUBTRACT (unpriced) + M<n>.2 ADD {unit_price_from "M<n>"}
//   node replay_old.js DOC <sub.jsonl> <add.jsonl> [--db s,a]     (c) every call of one LOT run as ONE plan (the V2 COMMIT's
//        single INVENTORY_BULK_APPLY), seeded with each row's first read, compared per movement and on final row values
// common: [--rules rules.json] (fetch_rules.py; default "Inventory Price" 4 dp / "Inventory Qty" 3 dp half-up = every prod
// tenant) [--raw] (plan at 8 dp, no number rule - NOT what the deployed engine does) [--show N] [--detail out.json]
//
// Each case lands in one bucket: identical | known:<artefacts> | gap:<behaviour gaps> | DIFF:<unexplained> | ok-fail:<code>
// | skip:<reason>. A cause starting "known:" is an artefact (classic and V2 store the same thing, or the difference is
// in the replay, not the engine); "gap:" is a real behaviour difference V2 would introduce; anything else is unexplained.
"use strict";
const fs = require("fs");
const path = require("path");

const CORE = path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js");
const { q8, roundDec } = require(CORE);

const argv = process.argv.slice(2);
const flag = (f) => argv.indexOf(f) >= 0;
const opt = (f, d) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : d);
// --mutate <name>: SELF-TEST of this harness only - plans with an in-memory copy of core.js carrying one deliberate bug
// (core.js itself is never written); every mutation must surface as differences, or the comparisons have no teeth
const MUTATIONS = {
  "add-price-zero": ["m.unit_price = src.unit_price;", "m.unit_price = 0;"],
  "no-batch-deduct": ['for (const c of QTY_COLS.slice(0, 5)) batchRow[c] = rc("item_batch_balance", c, q8(batchRow[c] || 0) - (c === categoryField ? u.baseQty : 0));', ""],
  "add-unrestricted-only": ['const col = cat === "Blocked" ? "block_qty" : cat === "Reserved" ? "reserved_qty" : cat === "Quality Inspection" ? "qualityinsp_qty" : cat === "In Transit" ? "intransit_qty" : "unrestricted_qty";', 'const col = "unrestricted_qty";'],
  "in-movement-no-dates": ['manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,\n      expired_date: m.expired_date === undefined ? null : m.expired_date,\n      unit_price: rc("inventory_movement", "unit_price", unitPrice),', 'manufacturing_date: null,\n      expired_date: null,\n      unit_price: rc("inventory_movement", "unit_price", unitPrice),'],
  "fifo-last-layer": ["return totalQty > 0 ? q8(totalCost / totalQty) : 0;", "return q8(sorted[sorted.length - 1].fifo_cost_price || 0);"],
  // not a bug: the ADD keeps its own (the entry's) dates instead of the SUBTRACT's - shows whether the date copy is visible
  "no-date-copy": ["m.manufacturing_date = src.manufacturing_date;\n      m.expired_date = src.expired_date;", ""],
};
const MUTATE = opt("--mutate", null);
const SYNTH_SC0 = flag("--synthetic-sc0");
let engine = require(CORE);
if (MUTATE) {
  const mu = MUTATIONS[MUTATE];
  if (!mu) throw new Error("unknown mutation " + MUTATE + " (" + Object.keys(MUTATIONS).join(", ") + ")");
  const src = fs.readFileSync(CORE, "utf8");
  if (src.split(mu[0]).length !== 2) throw new Error("mutation " + MUTATE + ": its pattern is not in core.js exactly once");
  const mod = { exports: {} };
  new Function("module", "exports", "require", src.replace(mu[0], mu[1]))(mod, mod.exports, require);
  engine = mod.exports;
}
const SHOW = Number(opt("--show", 3));
const DETAIL = opt("--detail", null);
const RAW = flag("--raw");
const VALUED = ["--show", "--detail", "--db", "--rules", "--mutate"];
const mode = argv[0];
const files = [];
for (let i = 1; i < argv.length; i++) {
  if (VALUED.includes(argv[i])) i++;
  else if (!argv[i].startsWith("--")) files.push(argv[i]);
}
const DBROWS = {};
for (const f of (opt("--db", "") || "").split(",").filter(Boolean)) {
  for (const l of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l);
    DBROWS[x.id] = x;
  }
}

// ------------------------------------------------------------------------------------------------- number rules
// rules.json {env: {tenant: [su_code_num_precision rows]}} -> planBulk's precision, exactly as code_node_IBplan builds it
const RULES = opt("--rules", null) ? JSON.parse(fs.readFileSync(opt("--rules", null), "utf8")) : null;
const DEFAULT_RULE_ROWS = [
  { scope_type: "1", rule_key: "Inventory Price", decimal_places: "4", precision_rule: "1", store_raw_value: "0" },
  { scope_type: "1", rule_key: "Inventory Qty", decimal_places: "3", precision_rule: "1", store_raw_value: "0" },
];
const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
  "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
const PRICE_COLUMNS = { unit_price: 1, total_price: 1, fifo_cost_price: 1, wa_cost_price: 1 };
const s = (v) => (v === undefined || v === null ? "" : String(v));
function precisionOf(rec) {
  const rows = RULES ? (RULES[rec.env] || {})[rec.tenant] || [] : DEFAULT_RULE_ROWS;
  const precision = { price: null, qty: null, columns: {} };
  for (const r of rows) {
    const m = Number(r.precision_rule);
    const dp = Number(r.decimal_places);
    if ([1, 2, 3].indexOf(m) < 0 || !(dp >= 0)) throw new Error("tenant " + rec.tenant + ": number rule the engine refuses (UNSUPPORTED_PRECISION) " + JSON.stringify(r));
    const rule = Number(r.store_raw_value) === 1 || dp >= 8 ? { dp: null, mode: m } : { dp: dp, mode: m };
    if (s(r.scope_type) === "2") {
      if (TABLE_OF[s(r.table_id)] && s(r.field_name)) precision.columns[TABLE_OF[s(r.table_id)] + "." + s(r.field_name)] = rule;
    } else if (s(r.rule_key) === "Inventory Price") precision.price = rule;
    else if (s(r.rule_key) === "Inventory Qty") precision.qty = rule;
  }
  return precision;
}
// the value the platform stores for a computed one: core.js rc() with the same rule
const storer = (prec) => (table, col, v) => {
  if (v === null || v === undefined || v === "") return v;
  const cols = prec.columns || {};
  const r = Object.prototype.hasOwnProperty.call(cols, table + "." + col) ? cols[table + "." + col] : PRICE_COLUMNS[col] ? prec.price : prec.qty;
  return r && r.dp !== null && r.dp !== undefined ? roundDec(v, r.dp, r.mode) : q8(v);
};
const ctxCache = {};
function ctxOf(rec) {
  const k = rec.env + "|" + rec.tenant;
  if (ctxCache[k]) return ctxCache[k];
  const prec = precisionOf(rec);
  const rule = storer(prec);
  const raw = (t, c, v) => (v === null || v === undefined || v === "" ? v : q8(v));
  return (ctxCache[k] = { prec: RAW ? undefined : prec, rule, st: RAW ? raw : rule });
}

// ------------------------------------------------------------------------------------------------- trace helpers
const has = (rec, id) => !!rec.nodes[id];
const out = (rec, id) => (rec.nodes[id] && rec.nodes[id].resp ? rec.nodes[id].resp.data : undefined);
const rowsOf = (d) => {
  if (!d) return [];
  const x = d.data;
  if (Array.isArray(x)) return x;
  return x && typeof x === "object" && Object.keys(x).length ? [x] : [];
};
const countOf = (d) => (d ? Number(d.count || 0) : 0);
const traceCut = (rec, id) => {
  const d = out(rec, id);
  return !!(rec.nodes[id] && rec.nodes[id].cut) || !!(d && Number(d.total || d.count || 0) > 0 && rowsOf(d).length === 0);
};
const n8 = (v) => (v === null || v === undefined || v === "" ? 0 : q8(v));
const EPS = 5e-9;
const eqN = (a, b) => Math.abs(n8(a) - n8(b)) < EPS;
const eqS = (a, b) => s(a) === s(b);
const day = (v) => {
  let t = s(v).trim().replace("T", " ").replace(/Z$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += " 00:00:00";
  return t.slice(0, 19);
};
// a timestamp column written through the platform's add-node keeps only the DATE part of the string it is given
// ("2025-12-31 16:00:00.000" is stored as 2025-12-31 00:00:00) - the classic add-nodes and INVENTORY_BULK_APPLY's alike
const datePartOnly = (stored, given) => day(stored) !== day(given) && s(stored).endsWith(" 00:00:00") && day(stored).slice(0, 10) === day(given).slice(0, 10);
const DATE_PART = "known:date column keeps the date part of the given string (same add-node path)";
const EPOCH = 1288834974657n;
const idMs = (id) => Number((BigInt(id) >> 22n) + EPOCH);
const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
const unionById = (...lists) => {
  const seen = {};
  const o = [];
  for (const l of lists) for (const r of l || []) if (!seen[s(r.id)]) (seen[s(r.id)] = true), o.push(r);
  return o;
};

// the deployed engine's item adapter (code_node_IBplan bulkPlan), applied to the item the classic call used
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
const DIG = /^[0-9]{1,20}$/;
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

// ------------------------------------------------------------------------------------------------- one classic call
const SUB_OK = ["return_node_LbWU1lZh", "return_node_OR0LXjo9"];
const SUB_RET = { return_node_rfb2MFbP: "VALIDATION_FAILED", return_node_UCNawDcR: "ITEM_NOT_FOUND", return_node_50mzzw0X: "401", return_node_Fj0eE8ac: "BALANCE_NOT_FOUND", return_node_UeAJPOPd: "INSUFFICIENT" };
const ADD_OK = "return_node_ealaqKXT";
const ADD_RET = { return_node_8ZcSkz7f: "VALIDATION_FAILED", return_node_ywhXsqEN: "ITEM_NOT_FOUND", return_node_EAFxgDzE: "401" };
const MIGRATION = ["code_node_YqMfJIMz", "code_node_oz7GGSQA"];
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const QM = { unrestricted_qty: "unrestrictedQty", reserved_qty: "reservedQty", block_qty: "blockedQty", qualityinsp_qty: "qualityInspectionQty", intransit_qty: "inTransitQty", balance_quantity: "balanceQty" };
const BM = { unrestricted_qty: "batchUnrestrictedQty", reserved_qty: "batchReservedQty", block_qty: "batchBlockedQty", qualityinsp_qty: "batchQualityInspectionQty", intransit_qty: "batchInTransitQty", balance_quantity: "batchBalanceQty" };

const isSub = (r) => r.__k === "S";
const okCall = (r) => r.status === "Complete" && (isSub(r) ? SUB_OK.includes(r.exit) : r.exit === ADD_OK);
const itemOf = (r) => ((out(r, isSub(r) ? "code_node_TC1cqaOy" : "code_node_3XzQSsce") || {}).itemData || r.params.itemData || null);
const addBatchId = (r) => s((out(r, "code_node_GMSJTmJr") || {}).batchId || r.params.batch_id);
const migrated = (r) => MIGRATION.some((id) => has(r, id));
const READ_NODES = { S: ["get_node_uaq6Z1ej", "get_node_GjRiq3dT", "search_node_L50IlXls", "search_node_FGjULf7c", "search_node_p2K6C5AB", "search_node_7tT1rozD", "search_node_7YQdabsq", "search_node_IXHaVq9k"], A: ["get_node_c4YkI6sb", "get_node_OppesjaR"] };

// the rows the call read, keyed like the engine reads them (balances by the call's natural key, costing by material + plant)
function readsOf(r) {
  const p = r.params;
  if (isSub(r)) {
    // the engine reads every FIFO / WA row of material + plant; the classic call read them for the migration check and again
    // (batch-scoped or not) for the price - the price reads come after a migration, so they only join when none ran
    const mig = migrated(r);
    const fifo = mig ? rowsOf(out(r, "search_node_L50IlXls")) : unionById(rowsOf(out(r, "search_node_L50IlXls")), rowsOf(out(r, "search_node_p2K6C5AB")), rowsOf(out(r, "search_node_7tT1rozD")));
    const wa = mig ? rowsOf(out(r, "search_node_FGjULf7c")) : unionById(rowsOf(out(r, "search_node_FGjULf7c")), rowsOf(out(r, "search_node_7YQdabsq")), rowsOf(out(r, "search_node_IXHaVq9k")));
    return {
      itemBalances: rowsOf(out(r, "get_node_uaq6Z1ej")).map((x) => balRow(p, x)),
      batchBalances: s(p.batch_id) ? rowsOf(out(r, "get_node_GjRiq3dT")).map((x) => balRow(p, x, { batch_id: s(p.batch_id) })) : [],
      fifoLayers: fifo.map((x) => costRow(p, x)),
      waRows: wa.map((x) => costRow(p, x)),
    };
  }
  const b = addBatchId(r);
  return {
    itemBalances: rowsOf(out(r, "get_node_c4YkI6sb")).map((x) => balRow(p, x)),
    batchBalances: b ? rowsOf(out(r, "get_node_OppesjaR")).map((x) => balRow(p, x, { batch_id: b })) : [],
    fifoLayers: [], // isMovingInv 1: the classic LOT ADD reads and writes no costing row
    waRows: [],
  };
}
// the movement exactly as the classic call was given it
function movementOf(r, key) {
  const m = Object.assign({}, r.params, { movement_key: key, direction: isSub(r) ? "SUBTRACT" : "ADD" });
  delete m.itemData;
  delete m.index;
  return m;
}
// the two movements V2 sends for one LOT entry: the ADD takes its price (and dates) from the SUBTRACT via unit_price_from
function v2Movements(pairs) {
  const ms = [];
  pairs.forEach(([S, A], i) => {
    const k = "M" + (i + 1);
    ms.push(movementOf(S, k));
    if (A) {
      const a = movementOf(A, k + ".2");
      delete a.unit_price;
      a.unit_price_from = k;
      ms.push(a);
    }
  });
  return ms;
}

// one plan over a list of classic calls: items + each row's first read (rows created inside the window are the plan's own)
function plan(calls, movements, ctx, startMs, tweakItem) {
  const items = {};
  const seed = { itemBalances: {}, batchBalances: {}, fifoLayers: {}, waRows: {} };
  for (const r of calls) {
    const it = itemOf(r);
    if (it) items[s(r.params.material_id)] = tweakItem ? tweakItem(adaptItem(it)) : adaptItem(it);
    const rd = readsOf(r);
    for (const t of Object.keys(seed)) {
      for (const row of rd[t]) {
        if (idMs(row.id) >= startMs) continue;
        if (!seed[t][row.id]) seed[t][row.id] = row;
      }
    }
  }
  const input = { operationKey: "R", items, itemBalances: Object.values(seed.itemBalances), batchBalances: Object.values(seed.batchBalances), fifoLayers: Object.values(seed.fifoLayers), waRows: Object.values(seed.waRows), movements, nowText: "", precision: ctx.prec };
  return { input, plan: engine.planBulk(input) };
}

// ------------------------------------------------------------------------------------------------- comparisons
// diffs: [{cause, field, engine, old, call}]
const MV_STR = ["transaction_type", "trx_no", "inventory_category", "movement", "plant_id", "organization_id", "uom_id", "base_uom_id", "item_id", "bin_location_id", "batch_number_id", "costing_method_id"];
const MV_NULLISH = ["parent_trx_no", "handling_unit_id"]; // classic writes '' where the engine writes NULL
const MV_NUM = ["unit_price", "total_price", "quantity", "base_qty", "actual_qty", "actual_base_qty"];
const MV_DATE = ["doc_date", "manufacturing_date", "expired_date"];
// old = the classic movement: recorded (what the platform stored) or rebuilt from the code outputs (computed, before the rule)
function compareMovement(mv, old, recorded, diffs, ctx, side, call, dateCause) {
  if (!mv) return diffs.push({ cause: side + " movement missing", field: "-", engine: null, old: "row", call });
  for (const c of MV_STR) if (!eqS(mv[c], old[c])) diffs.push({ cause: side + " movement." + c, field: c, engine: mv[c], old: old[c], call });
  for (const c of MV_NULLISH) {
    if (eqS(mv[c], old[c])) continue;
    diffs.push({ cause: s(mv[c]) === "" || s(old[c]) === "" ? "known:" + side + " movement." + c + " NULL vs ''" : side + " movement." + c, field: c, engine: mv[c], old: old[c], call });
  }
  for (const c of MV_NUM) {
    const e = n8(ctx.rule("inventory_movement", c, mv[c]));
    const o = recorded ? n8(old[c]) : n8(ctx.rule("inventory_movement", c, old[c]));
    if (Math.abs(e - o) < EPS) continue;
    diffs.push({ cause: side + " movement." + c, field: c, engine: mv[c], old: old[c], call });
  }
  for (const c of MV_DATE) {
    if (day(mv[c]) === day(old[c])) continue;
    if (recorded && datePartOnly(old[c], mv[c])) diffs.push({ cause: DATE_PART, field: c, engine: mv[c], old: old[c], call });
    else diffs.push({ cause: (dateCause && c !== "doc_date" && dateCause(c, null, mv[c], call)) || side + " movement." + c, field: c, engine: mv[c], old: old[c], call });
  }
}

// a non-batch SUBTRACT whose classic price read (search_node_p2K6C5AB / 7YQdabsq: material + plant, every batch) held
// batch rows - the engine prices from the non-batch rows only (core.js fifoFor / waFor key on batch_id)
const mixedPriceRead = (r) => isSub(r) && !s(r.params.batch_id) && rowsOf(out(r, "search_node_p2K6C5AB")).concat(rowsOf(out(r, "search_node_7YQdabsq"))).some((x) => s(x.batch_id) !== "" && s(x.batch_id) !== "0");
const MIXED_GAP = "gap:non-batch price - classic read every batch's FIFO/WA rows, the engine only the non-batch ones";
const REMARK_GAP = "gap:cosmetic - existing destination batch row remark NULL -> ''";
const GUARD_GAP = (g) => "gap:V2 guard REJECTs the whole operation (" + g + "); classic completed";
const isPriceDiff = (d) => /unit_price|total_price/.test(d.field);

// a SUBTRACT call vs the engine's result / OUT movement for it; returns the cause its price differences carry (the pair's
// ADD inherits the price)
function cmpSub(r, res, mv, all, ctx) {
  const diffs = [];
  cmpSub0(r, res, mv, diffs, ctx);
  const priceCause = mixedPriceRead(r) && diffs.some(isPriceDiff) ? MIXED_GAP : null;
  for (const d of diffs) all.push(priceCause && isPriceDiff(d) ? Object.assign(d, { cause: priceCause }) : d);
  return priceCause;
}
function cmpSub0(r, res, mv, diffs, ctx) {
  const p = r.params;
  const calc = out(r, "code_node_mQnskse9") || {};
  const uom = out(r, "code_node_wBfvXM2G") || {};
  const cur = out(r, "code_node_DUBS9GZF") || {};
  if (!res || res.code !== "200") return diffs.push({ cause: "OUT result", field: "code", engine: res && res.code, old: "200", call: r.id });
  if (!eqN(res.unit_price, calc.calculatedUnitPrice)) diffs.push({ cause: "OUT unit_price", field: "unit_price", engine: res.unit_price, old: calc.calculatedUnitPrice, call: r.id });
  if (!eqN(res.total_price, calc.totalPrice)) diffs.push({ cause: "OUT total_price", field: "total_price", engine: res.total_price, old: calc.totalPrice, call: r.id });
  const ret = out(r, "return_node_LbWU1lZh");
  if (ret) {
    if (!eqN(res.unit_price, ret.unit_price)) diffs.push({ cause: "OUT response.unit_price", field: "unit_price", engine: res.unit_price, old: ret.unit_price, call: r.id });
    for (const c of ["manufacturing_date", "expired_date"]) if (day(res[c]) !== day(ret[c])) diffs.push({ cause: "OUT response." + c, field: c, engine: res[c], old: ret[c], call: r.id });
  }
  const b = out(r, "code_node_MQ0uNcoG");
  const oldMv = {
    transaction_type: p.transaction_type, trx_no: p.trx_no, inventory_category: p.inventory_category, parent_trx_no: p.parent_trx_no, movement: "OUT",
    plant_id: p.plant_id, organization_id: p.organization_id, unit_price: calc.calculatedUnitPrice, total_price: calc.totalPrice,
    quantity: uom.altQty, base_qty: uom.baseQty, uom_id: uom.altUOM, base_uom_id: uom.baseUOM, item_id: p.material_id, bin_location_id: p.location_id,
    batch_number_id: b && b.batchId ? b.batchId : p.batch_id, costing_method_id: uom.costingMethod, manufacturing_date: cur.manufacturingDate,
    expired_date: cur.expiredDate, doc_date: p.doc_date, actual_qty: uom.actualAltQty, actual_base_qty: uom.actualBaseQty, handling_unit_id: p.handling_unit_id,
  };
  compareMovement(mv, oldMv, false, diffs, ctx, "OUT", r.id);
  dbCheck(r, mv, ctx);
}

// an ADD call vs the engine's result / IN movement for it; dateCause names an expected date difference (V2 pairs),
// priceCause the cause its SUBTRACT's price difference carries
function cmpAdd(r, res, mv, all, ctx, dateCause, priceCause) {
  const diffs = [];
  cmpAdd0(r, res, mv, diffs, ctx, dateCause);
  for (const d of diffs) all.push(priceCause && isPriceDiff(d) ? Object.assign(d, { cause: priceCause }) : d);
}
function cmpAdd0(r, res, mv, diffs, ctx, dateCause) {
  const p = r.params;
  const pr = out(r, "code_node_BzebhJnQ") || {};
  const uom = out(r, "code_node_mvszWJ8p") || {};
  if (!res || res.code !== "200") return diffs.push({ cause: "IN result", field: "code", engine: res && res.code, old: "200", call: r.id });
  if (!eqN(res.unit_price, pr.unitPrice)) diffs.push({ cause: "IN unit_price", field: "unit_price", engine: res.unit_price, old: pr.unitPrice, call: r.id });
  if (!eqN(res.total_price, pr.totalPrice)) diffs.push({ cause: "IN total_price", field: "total_price", engine: res.total_price, old: pr.totalPrice, call: r.id });
  if (!eqS(res.batch_id, addBatchId(r) || null)) diffs.push({ cause: "IN batch_id", field: "batch_id", engine: res.batch_id, old: addBatchId(r), call: r.id });
  const rec = rowsOf({ data: out(r, "add_node_3wRWQCyv") })[0];
  const old = rec || {
    transaction_type: p.transaction_type, trx_no: p.trx_no, inventory_category: p.inventory_category, parent_trx_no: p.parent_trx_no, movement: "IN",
    plant_id: p.plant_id, organization_id: p.organization_id, doc_date: p.doc_date, manufacturing_date: p.manufacturing_date, expired_date: p.expired_date,
    unit_price: pr.unitPrice, total_price: pr.totalPrice, quantity: uom.altQty, base_qty: uom.baseQty, uom_id: uom.altUOM, base_uom_id: uom.baseUOM,
    item_id: p.material_id, bin_location_id: p.location_id, batch_number_id: addBatchId(r) || null, costing_method_id: uom.costingMethod,
    actual_qty: uom.altQty, actual_base_qty: uom.baseQty, handling_unit_id: p.handling_unit_id,
  };
  compareMovement(mv, old, !!rec, diffs, ctx, "IN", r.id, dateCause);
}

// final values of every balance row the calls touched: the engine's (update after / created row) vs the LAST classic call's.
// A row the group's first touch created is a created row for the plan too, whatever later calls did to it; its dates and
// remarks are the ones the creating call wrote.
function cmpFinals(calls, input, pl, diffs, ctx, dateCause) {
  const nk = (p) => [s(p.material_id), s(p.location_id), s(p.plant_id), s(p.organization_id)].join("|");
  const lastIb = {};
  const lastBb = {};
  const track = (map) => (k, e) => {
    const prev = map[k];
    if (prev && (prev.created || prev.born)) e.born = prev.born || prev;
    map[k] = e;
  };
  const putIb = track(lastIb);
  const putBb = track(lastBb);
  for (const r of calls) {
    if (!okCall(r)) continue;
    const p = r.params;
    const k = nk(p);
    if (isSub(r)) {
      const calc = out(r, "code_node_mQnskse9") || {};
      if (countOf(out(r, "get_node_uaq6Z1ej")) > 0) putIb(k, { r, created: false, vals: Object.fromEntries(QTY.map((c) => [c, calc[QM[c]]])) });
      if (s(p.batch_id)) putBb(k + "|" + s(p.batch_id), { r, created: false, vals: Object.fromEntries(QTY.map((c) => [c, calc[BM[c]]])) });
    } else {
      if (countOf(out(r, "get_node_c4YkI6sb")) > 0) putIb(k, { r, created: false, vals: out(r, "code_node_t7V3DsPG") || {} });
      else {
        const row = rowsOf({ data: out(r, "add_node_MmpuGQao") })[0];
        putIb(k, { r, created: true, recorded: !!row, vals: row || out(r, "code_node_aFO7peip") || {} });
      }
      const b = addBatchId(r);
      if (b) {
        if (countOf(out(r, "get_node_OppesjaR")) > 0) putBb(k + "|" + b, { r, created: false, vals: out(r, "code_node_YUVUnD8B") || {}, remarks: true });
        else {
          const row = rowsOf({ data: out(r, "add_node_J7moAYDJ") })[0];
          putBb(k + "|" + b, { r, created: true, recorded: !!row, vals: row || Object.assign({}, out(r, "code_node_aFO7peip") || {}, { manufacturing_date: p.manufacturing_date, expired_date: p.expired_date, doc_date: p.doc_date }) });
        }
      }
    }
  }
  const eng = { item_balance: {}, item_batch_balance: {} };
  const seedKey = { item_balance: {}, item_batch_balance: {} };
  for (const row of input.itemBalances) seedKey.item_balance[row.id] = nk(row);
  for (const row of input.batchBalances) seedKey.item_batch_balance[row.id] = nk(row) + "|" + s(row.batch_id);
  for (const t of ["item_balance", "item_batch_balance"]) {
    for (const u of pl.updates[t]) {
      const seed = (t === "item_balance" ? input.itemBalances : input.batchBalances).find((x) => x.id === u.id) || {};
      eng[t][seedKey[t][u.id]] = { created: false, vals: Object.assign({}, seed, u.after) };
    }
    for (const c of pl.creates[t]) eng[t][nk(c) + (t === "item_batch_balance" ? "|" + s(c.batch_id) : "")] = { created: true, vals: c };
  }
  const cmpRow = (t, k, want) => {
    const got = eng[t][k];
    const side = t === "item_balance" ? "item_balance" : "batch_balance";
    if (!got) return diffs.push({ cause: side + " not written by the engine", field: k, engine: null, old: want.vals, call: want.r.id });
    const born = want.born || (want.created ? want : null);
    if (got.created !== !!born) diffs.push({ cause: side + (born ? " created by classic, updated by the engine" : " updated by classic, created by the engine"), field: k, engine: got.created, old: !!born, call: want.r.id });
    for (const c of QTY) {
      const e = n8(ctx.st(t, c, got.vals[c]));
      const o = want.recorded ? n8(want.vals[c]) : n8(ctx.st(t, c, want.vals[c]));
      if (Math.abs(e - o) >= EPS) diffs.push({ cause: side + (born ? "(new)." : ".") + c, field: k, engine: got.vals[c], old: want.vals[c], call: want.r.id });
    }
    if (t === "item_batch_balance" && born && got.created) {
      for (const c of ["manufacturing_date", "expired_date", "doc_date"]) {
        if (day(got.vals[c]) === day(born.vals[c])) continue;
        if (born.recorded && datePartOnly(born.vals[c], got.vals[c])) {
          diffs.push({ cause: DATE_PART, field: c, engine: got.vals[c], old: born.vals[c], call: born.r.id });
          continue;
        }
        diffs.push({ cause: (dateCause && c !== "doc_date" && dateCause(c, "new destination batch row", got.vals[c], born.r.id)) || "batch_balance(new)." + c, field: c, engine: got.vals[c], old: born.vals[c], call: born.r.id });
      }
      for (const c of ["remark", "remark2", "remark3"]) {
        if (eqS(got.vals[c], born.vals[c])) continue;
        diffs.push({ cause: s(got.vals[c]) === "" && s(born.vals[c]) === "" ? "known:batch_balance(new)." + c + " NULL vs ''" : "batch_balance(new)." + c, field: c, engine: got.vals[c], old: born.vals[c], call: born.r.id });
      }
    }
    if (t === "item_batch_balance" && want.remarks && !got.created) {
      // the classic ADD rewrote the remarks (code_node_YUVUnD8B; an absent key = it returned null/undefined -> NULL written);
      // the engine rewrites them only when the ADD is the row's first touch in the plan, else they stay as read
      for (const c of ["remark", "remark2", "remark3"]) {
        const ev = got.vals[c];
        const ov = want.vals[c];
        if ((ev === null || ev === undefined) && (ov === null || ov === undefined)) continue;
        if (eqS(ev, ov) && !(ev === "" && (ov === undefined || ov === null))) continue;
        diffs.push({ cause: (ov === undefined || ov === null) && ev === "" ? REMARK_GAP : "batch_balance." + c, field: c, engine: ev, old: ov, call: want.r.id });
      }
    }
  };
  for (const [k, want] of Object.entries(lastIb)) cmpRow("item_balance", k, want);
  for (const [k, want] of Object.entries(lastBb)) cmpRow("item_batch_balance", k, want);
  // a row the engine writes that no classic call wrote
  for (const t of ["item_balance", "item_batch_balance"]) {
    const want = t === "item_balance" ? lastIb : lastBb;
    for (const k of Object.keys(eng[t])) if (!want[k]) diffs.push({ cause: (t === "item_balance" ? "item_balance" : "batch_balance") + " written only by the engine", field: k, engine: eng[t][k].vals, old: null, call: calls[0].id });
  }
  const costing = [pl.updates.fifo.length, pl.updates.wa.length, pl.creates.fifo.length, pl.creates.wa.length];
  if (costing.some(Boolean)) diffs.push({ cause: "costing rows written (isMovingInv 1 writes none)", field: "fifo/wa", engine: costing, old: 0, call: calls[0].id });
}

// the OUT movement row the classic SUBTRACT inserted (its add-node is not traced): read back from the database
const dbTally = {};
const dbBump = (k, rec) => {
  dbTally[k] = dbTally[k] || { n: 0, ids: [] };
  dbTally[k].n++;
  if (dbTally[k].ids.length < SHOW) dbTally[k].ids.push(rec.id);
};
const snowMs = (id) => Number((BigInt(id) >> 22n) + EPOCH);
function dbCheck(r, mv, ctx) {
  const db = DBROWS[r.id];
  if (!db || !mv) return;
  const inside = (x) => snowMs(x.id) >= r.t0 && snowMs(x.id) <= r.t1;
  // a few LOT runs passed the serial sentinel 'issued' as trx_no (the document number was not resolved yet); those rows
  // hold the real number now, so the sentinel matches any trx_no
  const sentinel = !/[0-9]/.test(s(mv.trx_no));
  const cands = db.movements
    .filter((x) => x.movement === mv.movement && eqS(x.transaction_type, mv.transaction_type) && (sentinel || eqS(x.trx_no, mv.trx_no)) && eqS(x.bin_location_id, mv.bin_location_id) && eqS(x.batch_number_id || "", mv.batch_number_id || "") && eqS(x.item_id, mv.item_id))
    .sort((a, b) => inside(b) - inside(a));
  const row = cands.find((x) => Math.abs(n8(x.quantity) - n8(ctx.rule("inventory_movement", "quantity", mv.quantity))) < EPS) || cands[0];
  if (!row) return dbBump(db.movements.length ? "OUT movement: not found in its window" : "OUT movement: no row of the item left in the run's window (deleted since)", r);
  if (sentinel) dbBump("OUT movement: classic passed trx_no '" + s(mv.trx_no) + "' (serial sentinel); the stored row holds the real number", r);
  const bad = [];
  for (const c of MV_NUM) if (Math.abs(n8(row[c]) - n8(ctx.rule("inventory_movement", c, mv[c]))) >= EPS) bad.push(c);
  for (const c of ["inventory_category", "plant_id", "organization_id", "uom_id", "base_uom_id", "item_id", "costing_method_id"]) if (!eqS(row[c], mv[c])) bad.push(c);
  for (const c of MV_NULLISH) if (!eqS(row[c], mv[c]) && s(row[c]) !== "" && s(mv[c]) !== "") bad.push(c);
  for (const c of MV_DATE) if (day(row[c]) !== day(mv[c]) && !(s(row[c]).endsWith(" 00:00:00") && day(row[c]).slice(0, 10) === day(mv[c]).slice(0, 10))) bad.push(c);
  const edited = s(row.update_time).slice(0, 19) > s(row.create_time).slice(0, 19);
  if (Number(row.is_deleted)) dbBump("OUT movement: row soft-deleted since" + (bad.length ? " (differs in " + bad.join(",") + ")" : " (identical)"), r);
  else if (bad.length && edited) dbBump("OUT movement: row edited after the run (" + bad.join(",") + ")", r);
  else dbBump(bad.length ? "OUT movement: database row differs in " + bad.join(",") : "OUT movement: database row identical", r);
  if (DETAIL && bad.length) detail.push({ id: r.id, bucket: "db.OUT", info: bad.map((c) => [c, mv[c], row[c]]) });
}

// ------------------------------------------------------------------------------------------------- tally
const tally = {};
const causeTally = {};
const flagTally = {};
const examples = {};
const detail = [];
const bump = (bucket, rec, info) => {
  tally[bucket] = (tally[bucket] || 0) + 1;
  (examples[bucket] = examples[bucket] || []).length < SHOW && examples[bucket].push(rec.id);
  if (DETAIL) detail.push({ id: rec.id, env: rec.env, tenant: rec.tenant, bucket, info });
};
function settle(rec, diffs, flags) {
  for (const f of flags) flagTally[f] = (flagTally[f] || 0) + 1;
  if (!diffs.length) return bump("identical", rec, { flags });
  const causes = [...new Set(diffs.map((d) => d.cause))].sort();
  for (const c of causes) {
    causeTally[c] = (causeTally[c] || 0) + 1;
    (examples["cause " + c] = examples["cause " + c] || []).length < SHOW && examples["cause " + c].push(rec.id + " " + JSON.stringify(diffs.find((d) => d.cause === c)).slice(0, 400));
  }
  const kind = (c) => (c.startsWith("known:") ? "known" : c.startsWith("gap:") ? "gap" : c.startsWith(PRE) ? "pre" : "diff");
  const of = (k) => causes.filter((c) => kind(c) === k);
  const bucket = of("diff").length ? "DIFF:" + of("diff").join("+") : of("pre").length ? "pre-v65 classic only: " + of("pre").map((c) => c.slice(PRE.length)).join("+") : of("gap").length ? of("gap").join("+") : "known:" + causes.map((c) => c.slice(6)).join("+");
  bump(bucket, rec, { flags, diffs: diffs.slice(0, 16) });
}
function flagsOf(calls) {
  const f = new Set();
  for (const r of calls) {
    const p = r.params;
    if (r.code === "pre-v65") f.add("classic ran pre-v65 code");
    if (s(p.batch_id)) f.add("batch");
    if (p.inventory_category === "In Transit") f.add("In Transit");
    if (s(p.material_uom) && s(p.material_uom) !== s((itemOf(r) || {}).based_uom)) f.add("alt UOM");
    if (!isSub(r) && countOf(out(r, "get_node_OppesjaR")) === 0 && addBatchId(r)) f.add("new destination batch row");
    if (!isSub(r) && countOf(out(r, "get_node_c4YkI6sb")) === 0) f.add("new destination item_balance row");
    if (!isSub(r) && n8(p.unit_price) !== 0) f.add("non-zero price");
    if (isSub(r) && s(p.batch_id)) f.add("batch dates given: " + (p.manufacturing_date ? "mfg" : "-") + "/" + (p.expired_date ? "exp" : "-"));
    if (isSub(r)) f.add("costing " + s((itemOf(r) || {}).material_costing_method));
    const g = guard(movementOf(r, "g"));
    if (g) f.add("engine guard refuses: " + g);
    if (isSub(r) && mixedPriceRead(r)) f.add("non-batch price read held batch rows");
    if (isSub(r) && s(p.batch_id)) {
      const row = rowsOf(out(r, "get_node_GjRiq3dT"))[0] || {};
      if (row.manufacturing_date || row.expired_date) f.add("source batch row has dates");
    }
  }
  return [...f].sort();
}
// pre-v65 classic code rounded prices to 4 dp / quantities to 3 dp at every step: tag its differences apart
const PRE = "pre-v65 classic: ";
const tagPre = (calls, diffs) => {
  if (!calls.some((r) => r.code === "pre-v65")) return diffs;
  return diffs.map((d) => (d.cause.startsWith("known:") || d.cause.startsWith("gap:") ? d : Object.assign({}, d, { cause: PRE + d.cause })));
};

// ------------------------------------------------------------------------------------------------- (a) per call
function perCall(r) {
  const ctx = ctxOf(r);
  if (!itemOf(r) && !["return_node_rfb2MFbP", "return_node_UCNawDcR", "return_node_8ZcSkz7f", "return_node_ywhXsqEN"].includes(r.exit)) return bump("skip:no item in the trace", r);
  for (const id of READ_NODES[r.__k]) if (traceCut(r, id)) return bump("skip:trace cut (" + id + ")", r);
  const flags = flagsOf([r]);
  const g = guard(movementOf(r, "m"));
  if (g) return bump(okCall(r) ? GUARD_GAP(g) : "ok-fail:V2 guard REJECT (" + g + ")", r);
  const { input, plan: pl } = plan([r], [movementOf(r, "m")], ctx, r.t0);
  const RET = isSub(r) ? SUB_RET : ADD_RET;
  if (r.status !== "Complete") return bump(pl.ok ? "DIFF:classic failed, engine planned" : "ok-fail:" + pl.failure.code, r, { error: r.error });
  if (RET[r.exit]) {
    const got = pl.ok ? pl.results[0].code : pl.failure.code;
    return bump(got === RET[r.exit] ? "ok-fail:" + got : "DIFF:classic " + RET[r.exit] + ", engine " + got, r);
  }
  if (!okCall(r)) return bump("skip:exit " + r.exit, r);
  if (!pl.ok) return settle(r, tagPre([r], [{ cause: (migrated(r) ? "known:classic migrated costing rows -> engine UNSUPPORTED_COSTING" : "engine failed: " + pl.failure.code), field: "plan", engine: pl.failure.message, old: "ok", call: r.id }]), flags);
  const diffs = [];
  if (isSub(r)) cmpSub(r, pl.results[0], pl.movements[0], diffs, ctx);
  else cmpAdd(r, pl.results[0], pl.movements[0], diffs, ctx);
  cmpFinals([r], input, pl, diffs, ctx);
  settle(r, tagPre([r], diffs), flags);
}

// ------------------------------------------------------------------------------------------------- LOT runs
// every call of one LOT run, in order: SUB0 ADD0 SUB1 ADD1 ... (one index per entry, the SUBTRACT and its ADD share it).
// A run ends when the index goes back (the next save of the same document) or after 5 minutes.
function groupsOf(subs, adds) {
  const all = subs.map((r) => Object.assign(r, { __k: "S" })).concat(adds.map((r) => Object.assign(r, { __k: "A" }))).sort(byId);
  const groups = [];
  const open = {};
  for (const r of all) {
    const k = [r.env, r.tenant, s(r.params.trx_no)].join("|");
    const g = open[k];
    const last = g && g[g.length - 1];
    const idx = Number(r.params.index);
    const li = last ? Number(last.params.index) : -1;
    const cont = g && r.t0 - last.t1 <= 300000 && (idx > li || (idx === li && isSub(last) && !isSub(r)));
    if (cont) g.push(r);
    else groups.push((open[k] = [r]));
  }
  return groups;
}
// pairs in a run: [SUB, ADD] (ADD = the next call when it is the same entry), [SUB, null] for a SUBTRACT without its ADD
function pairsOf(g) {
  const pairs = [];
  const strays = [];
  for (let i = 0; i < g.length; i++) {
    const r = g[i];
    if (!isSub(r)) {
      strays.push(r);
      continue;
    }
    const nx = g[i + 1];
    const same = nx && !isSub(nx) && Number(nx.params.index) === Number(r.params.index) && eqS(nx.params.material_id, r.params.material_id) && eqN(nx.params.quantity, r.params.quantity) && eqS(nx.params.batch_id, r.params.batch_id) && eqS(nx.params.material_uom, r.params.material_uom);
    if (same) {
      pairs.push([r, nx]);
      i++;
    } else pairs.push([r, null]);
  }
  return { pairs, strays };
}
// a date the V2 ADD wrote that differs from classic is the unit_price_from date copy only when it IS the SUBTRACT's date
// (core.js l.125-126); anything else stays unexplained. subResByAdd: ADD call id -> its SUBTRACT's engine result
const datesGapFor = (subResByAdd) => (c, where, val, addId) => {
  const sr = subResByAdd[addId];
  return sr && day(val) === day(sr[c]) ? "gap:" + (where || "IN movement") + " " + c + " = the SUBTRACT's (classic: the entry's)" : null;
};

// classic hands the ADD the SUBTRACT's response price, and the entry's dates (not the SUBTRACT's): informational flags
function callerFlags(S, A, flags) {
  const ret = out(S, "return_node_LbWU1lZh") || {};
  if (!eqN(ret.unit_price, A.params.unit_price)) flags.push("classic ADD price != SUBTRACT response price");
  if (day(ret.manufacturing_date) !== day(A.params.manufacturing_date) || day(ret.expired_date) !== day(A.params.expired_date)) flags.push("classic ADD dates != SUBTRACT dates");
  if (s(S.params.location_id) === s(A.params.location_id)) flags.push("same bin");
}

function pairsMode(subs, adds) {
  for (const g of groupsOf(subs, adds)) {
    const { pairs, strays } = pairsOf(g);
    for (const a of strays) bump("pair:ADD without its SUBTRACT", a);
    for (const [S, A] of pairs) {
      const ctx = ctxOf(S);
      if (!A) {
        if (okCall(S)) bump("pair:SUBTRACT without its ADD", S);
        else {
          // classic stopped the LOT run here (the SUBTRACT returned 400): the engine must refuse the same movement
          const refused = guard(movementOf(S, "M1"));
          if (refused) {
            bump("ok-fail:V2 guard REJECT (" + refused + "), classic failed too", S);
            continue;
          }
          const { plan: pl } = plan([S], [movementOf(S, "M1")], ctx, S.t0);
          const got = pl.ok ? pl.results[0].code : pl.failure.code;
          bump(got === SUB_RET[S.exit] ? "ok-fail:" + got : "DIFF:classic " + (SUB_RET[S.exit] || S.exit) + ", engine " + got, S);
        }
        continue;
      }
      const flags = flagsOf([S, A]);
      callerFlags(S, A, flags);
      if (!itemOf(S) || !itemOf(A)) {
        bump("skip:no item in the trace", S);
        continue;
      }
      const cut = READ_NODES.S.find((id) => traceCut(S, id)) || READ_NODES.A.find((id) => traceCut(A, id));
      if (cut) {
        bump("skip:trace cut (" + cut + ")", S);
        continue;
      }
      if (!okCall(A)) {
        bump("pair:classic ADD failed (" + A.exit + ")", S);
        continue;
      }
      const ms = v2Movements([[S, A]]);
      const refused = ms.map(guard).find(Boolean);
      if (refused) {
        bump(GUARD_GAP(refused), S);
        continue;
      }
      if (SYNTH_SC0) {
        // synthetic: the same pair with the item's stock_control 0 - classic answers 401 on both calls (SUBTRACT
        // return_node_50mzzw0X, code "401" is not the LOT loop's "400" error; the ADD gets no price and answers 401 too)
        const sc = plan([S, A], v2Movements([[S, A]]), ctx, S.t0, (it) => Object.assign(it, { stock_control: 0 })).plan;
        const nothing = sc.ok && sc.movements.length === 0 && ["item_balance", "item_batch_balance", "fifo", "wa"].every((x) => !sc.updates[x].length && !sc.creates[x].length);
        bump(sc.ok && sc.results.map((x) => x.code).join(",") === "401,401" && nothing ? "synthetic stock_control 0: both movements 401, nothing written (= classic)" : "DIFF:synthetic stock_control 0: " + (sc.ok ? sc.results.map((x) => x.code).join(",") : sc.failure.code), S);
        continue;
      }
      const { input, plan: pl } = plan([S, A], ms, ctx, S.t0);
      if (!pl.ok) {
        settle(S, tagPre([S, A], [{ cause: (migrated(S) ? "known:classic migrated costing rows -> engine UNSUPPORTED_COSTING" : "engine failed: " + pl.failure.code) + " (pair)", field: pl.failure.movement_key, engine: pl.failure.message, old: "ok", call: S.id }]), flags);
        continue;
      }
      const diffs = [];
      const pc = cmpSub(S, pl.results[0], pl.movements[0], diffs, ctx);
      const datesGap = datesGapFor({ [A.id]: pl.results[0] });
      cmpAdd(A, pl.results[1], pl.movements[1], diffs, ctx, datesGap, pc);
      cmpFinals([S, A], input, pl, diffs, ctx, datesGap);
      settle(S, tagPre([S, A], diffs), flags);
    }
  }
}

function docMode(subs, adds) {
  const lines = {};
  for (const g of groupsOf(subs, adds)) {
    const head = g[0];
    const ctx = ctxOf(head);
    const { pairs, strays } = pairsOf(g);
    const flags = flagsOf(g);
    const n = pairs.length;
    flags.push("entries " + (n <= 1 ? "1" : n <= 5 ? "2-5" : n <= 20 ? "6-20" : ">20"));
    lines[flags[flags.length - 1]] = (lines[flags[flags.length - 1]] || 0) + 1;
    if (Number(head.params.index) !== 0) flags.push("run starts mid-way (index " + head.params.index + ")");
    if (strays.length) {
      bump("doc:ADD without its SUBTRACT in the run", head);
      continue;
    }
    if (g.some((r) => !itemOf(r))) {
      bump("skip:no item in the trace", head);
      continue;
    }
    const cut = g.map((r) => READ_NODES[r.__k].find((id) => traceCut(r, id))).find(Boolean);
    if (cut) {
      bump("skip:trace cut (" + cut + ")", head);
      continue;
    }
    for (const [S, A] of pairs) if (A) callerFlags(S, A, flags);
    const failed = pairs.findIndex(([S, A]) => !okCall(S) || (A && !okCall(A)));
    const lone = pairs.findIndex(([S, A]) => okCall(S) && !A);
    const ms = v2Movements(pairs);
    const refused = ms.map(guard).find(Boolean);
    if (refused) {
      bump(failed >= 0 ? "ok-fail:V2 guard REJECT (" + refused + "), classic failed too" : GUARD_GAP(refused), head);
      continue;
    }
    const { input, plan: pl } = plan(g, ms, ctx, head.t0);
    if (failed >= 0) {
      // classic stopped the run at this entry after applying the ones before it; V2 is all-or-nothing
      const [S, A] = pairs[failed];
      const want = !okCall(S) ? SUB_RET[S.exit] || S.exit : ADD_RET[A.exit] || A.exit;
      const got = pl.ok ? "planned" : pl.failure.code;
      const atKey = "M" + (failed + 1) + (!okCall(S) ? "" : ".2");
      bump(got === want && (pl.failure || {}).movement_key === atKey ? "ok-fail:" + want + " (classic applied " + failed + " entr" + (failed === 1 ? "y" : "ies") + " before stopping; V2 applies none)" : "DIFF:classic " + want + " at " + atKey + ", engine " + got + " at " + s((pl.failure || {}).movement_key), head);
      continue;
    }
    if (lone >= 0) flags.push("SUBTRACT without its ADD");
    if (!pl.ok) {
      settle(head, tagPre(g, [{ cause: (g.some(migrated) ? "known:classic migrated costing rows -> engine UNSUPPORTED_COSTING" : "engine failed: " + pl.failure.code) + " (document)", field: pl.failure.movement_key, engine: pl.failure.message, old: "ok", call: head.id }]), flags);
      continue;
    }
    const diffs = [];
    const res = {};
    for (const x of pl.results) res[x.movement_key] = x;
    const mvs = {};
    for (const m of pl.movements) mvs[m.operation_effect_key] = m;
    const subResByAdd = {};
    pairs.forEach(([S, A], i) => A && (subResByAdd[A.id] = res["M" + (i + 1)]));
    const datesGap = datesGapFor(subResByAdd);
    pairs.forEach(([S, A], i) => {
      const k = "M" + (i + 1);
      const pc = cmpSub(S, res[k], mvs["R|" + k], diffs, ctx);
      if (A) cmpAdd(A, res[k + ".2"], mvs["R|" + k + ".2"], diffs, ctx, datesGap, pc);
    });
    cmpFinals(g, input, pl, diffs, ctx, datesGap);
    settle(head, tagPre(g, diffs), flags);
  }
  return lines;
}

// ------------------------------------------------------------------------------------------------- main
const load = (f, k) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => Object.assign(JSON.parse(l), { __k: k }));
let n = 0;
let extra = null;
if (mode === "SUBTRACT" || mode === "ADD") {
  for (const f of files) {
    for (const r of load(f, mode === "SUBTRACT" ? "S" : "A")) {
      n++;
      try {
        perCall(r);
      } catch (e) {
        bump("ERROR:" + e.message.slice(0, 100), r);
      }
    }
  }
} else if (mode === "PAIRS" || mode === "DOC") {
  const subs = load(files[0], "S");
  const adds = load(files[1], "A");
  n = subs.length + adds.length;
  if (mode === "PAIRS") pairsMode(subs, adds);
  else extra = docMode(subs, adds);
} else {
  console.error("usage: node replay_old.js <SUBTRACT|ADD> <fixtures.jsonl> | <PAIRS|DOC> <sub.jsonl> <add.jsonl>  [--db a,b] [--rules rules.json] [--raw] [--show N] [--detail out.json] [--mutate NAME] [--synthetic-sc0]");
  process.exit(2);
}
const unit = mode === "PAIRS" ? "pairs" : mode === "DOC" ? "LOT runs" : "calls";
console.log(mode + (RAW ? " (raw 8 dp, no number rule)" : " (tenant number rules" + (RULES ? " from " + path.basename(opt("--rules", "")) : ": default 4 / 3 dp") + ")"), n, "recorded calls from", files.map((f) => path.basename(f)).join(", "));
console.log("-- " + unit + " by bucket");
let total = 0;
for (const k of Object.keys(tally).sort()) {
  console.log(String(tally[k]).padStart(6), k);
  total += tally[k];
}
console.log(String(total).padStart(6), "TOTAL " + unit);
console.log("-- causes (" + unit + " with the cause)");
for (const k of Object.keys(causeTally).sort()) console.log(String(causeTally[k]).padStart(6), k);
console.log("-- flags (" + unit + ")");
for (const k of Object.keys(flagTally).sort()) console.log(String(flagTally[k]).padStart(6), k);
if (extra) {
  console.log("-- LOT runs by entries");
  for (const k of Object.keys(extra).sort()) console.log(String(extra[k]).padStart(6), k);
}
console.log("-- examples (instance id of the SUBTRACT / call)");
for (const k of Object.keys(examples).sort()) if (k !== "identical") console.log(k + ":\n    " + examples[k].join("\n    "));
if (Object.keys(dbTally).length) {
  console.log("-- OUT movement rows read back from the database vs the engine's");
  for (const k of Object.keys(dbTally).sort()) console.log(String(dbTally[k].n).padStart(6) + " " + k + "  e.g. " + dbTally[k].ids.join(" "));
}
const cls = { identical: 0, known: 0, gap: 0, pre: 0, diff: 0, okfail: 0, synthetic: 0, other: 0 };
for (const [k, v] of Object.entries(tally)) {
  const c = k === "identical" ? "identical" : k.startsWith("known:") ? "known" : k.startsWith("gap:") ? "gap" : k.startsWith("pre-v65 classic only") ? "pre" : k.startsWith("DIFF") ? "diff" : k.startsWith("ok-fail") ? "okfail" : k.startsWith("synthetic") ? "synthetic" : "other";
  cls[c] += v;
}
console.log("SUMMARY mode=" + mode + (MUTATE ? " mutate=" + MUTATE : "") + (RAW ? " raw" : "") + " total=" + total + " " + Object.entries(cls).map(([k, v]) => k + "=" + v).join(" "));
if (DETAIL) fs.writeFileSync(DETAIL, JSON.stringify(detail, null, 1));
