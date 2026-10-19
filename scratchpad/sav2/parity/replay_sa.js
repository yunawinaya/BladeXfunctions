// SA engine parity. Replays the classic STOCK_ADJUSTMENT completions (each run's ADD_INVENTORY v65 / SUBTRACT_INVENTORY
// v58-v59 child calls, transaction_type "SA", isMovingInv 0) through INVENTORY_BULK_APPLY's planner -
// scratchpad/gdc/engine/core.js, required read-only from its path - with the rows each call read and the tenant's number
// rules (planBulk `precision`, as code_node_IBplan builds it), and compares what the engine would write with what the
// classic calls computed / wrote: item_balance, item_batch_balance, inventory_movement, fifo_costing_history,
// wa_costing_method. Adapted from scratchpad/sav2/tpl/smv2/parity/replay_old.js (LOT) + scratchpad/grv2/parity/
// replay_old.js (costing comparisons).
//
//   node replay_sa.js MOVES <sa.jsonl>            the CONTRACT §5 ENGINE movements built from each run's document vs the
//                                                 child calls the classic made (count, order, every field)
//   node replay_sa.js CALLS <sa.jsonl> [--db d]   (a) each child call alone, as one movement, with its own reads
//   node replay_sa.js DOC <sa.jsonl> [--db d]     (b) each SA run as ONE plan with the §5 movements (the V2 COMMIT A2's
//                                                 single APPLY), seeded with each row's first read, compared per
//                                                 movement and on every row's final values
// common: [--rules rules.json] (fetch_rules.py; none = "Inventory Price" 4 dp / "Inventory Qty" 3 dp half-up, prod's only
// rule set) [--raw] (plan at 8 dp, no number rule - NOT what the deployed engine does) [--show N] [--detail out.json]
// [--mutate NAME] (self-test: an in-memory core.js copy with one deliberate bug)
//
// Each case lands in one bucket: identical | known:<artefacts> | gap:<behaviour gaps> | DIFF:<unexplained> | ok-fail:<code>
// | pre-v65 classic only | skip:<reason>. "known:" = classic and V2 store the same thing, or the difference is in the
// replay (not the engine); "gap:" = a real behaviour difference V2 introduces (each named); anything else is unexplained.
"use strict";
const fs = require("fs");
const path = require("path");

const CORE = path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js");
const { q8, roundDec } = require(CORE);

const argv = process.argv.slice(2);
const flag = (f) => argv.indexOf(f) >= 0;
const opt = (f, d) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : d);
// --mutate <name>: SELF-TEST of this harness only (core.js itself is never written); each must surface as differences
const MUTATIONS = {
  "add-price-zero": ["up = q8(m.unit_price);\n        let tp = q8(up * u.baseQty);", "up = 0;\n        let tp = q8(up * u.baseQty);"],
  "no-batch-deduct": ['for (const c of QTY_COLS.slice(0, 5)) batchRow[c] = rc("item_batch_balance", c, q8(batchRow[c] || 0) - (c === categoryField ? u.baseQty : 0));', ""],
  "fifo-last-layer": ["return totalQty > 0 ? q8(totalCost / totalQty) : 0;", "return q8(sorted[sorted.length - 1].fifo_cost_price || 0);"],
  "fifo-no-consume": ['layer.fifo_available_quantity = rc("fifo_costing_history", "fifo_available_quantity", avail - take);', ""],
  "wa-no-reaverage": ['latest.wa_cost_price = rc("wa_costing_method", "wa_cost_price", q8((wc * wq + unitPrice * u.baseQty) / nq));', ""],
  "wa-sub-no-deduct": ['doc.wa_quantity = Math.max(0, rc("wa_costing_method", "wa_quantity", q8(doc.wa_quantity || 0) - q8(u.baseQty)));', ""],
  "fifo-seq-plus2": ["Math.max(...layers.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;", "Math.max(...layers.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 2 : 1;"],
  "no-rule-rounding": ["return r && r.dp !== null && r.dp !== undefined ? roundDec(v, r.dp, r.mode) : q8(v);\n  };\n  let seq", "return q8(v);\n  };\n  let seq"],
};
const MUTATE = opt("--mutate", null);
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
  return (ctxCache[k] = { prec: RAW ? undefined : prec, rule, st: RAW ? raw : rule, ruled: !!(prec.price || prec.qty) });
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
// a timestamp column written through the platform's add-node keeps only the DATE part of the string it is given - the
// classic add-nodes and INVENTORY_BULK_APPLY's alike
const datePartOnly = (stored, given) => day(stored) !== day(given) && s(stored).endsWith(" 00:00:00") && day(stored).slice(0, 10) === day(given).slice(0, 10);
const DATE_PART = "known:date column keeps the date part of the given string (same add-node path)";
const EPOCH = 1288834974657n;
const idMs = (id) => Number((BigInt(id) >> 22n) + EPOCH);
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
function guard(m, org) {
  const t = (v) => s(v).trim();
  for (const f of ["material_id", "plant_id", "location_id"]) if (!DIG.test(t(m[f]))) return f + " not digits";
  if (t(m.batch_id) && !DIG.test(t(m.batch_id))) return "batch_id not digits";
  if (!DIG.test(t(m.organization_id))) return "organization_id not digits";
  if (org !== undefined && t(m.organization_id) !== t(org)) return "organization_id differs from the operation's";
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
const FIFO_M = "First In First Out";
const WA_M = "Weighted Average";

const isSub = (r) => r.kind === "SUBTRACT";
const okCall = (r) => r.status === "Complete" && (isSub(r) ? SUB_OK.includes(r.exit) : r.exit === ADD_OK);
const itemOf = (r) => ((out(r, isSub(r) ? "code_node_TC1cqaOy" : "code_node_3XzQSsce") || {}).itemData || r.params.itemData || null);
const methodOf = (r) => s((itemOf(r) || {}).material_costing_method);
const addBatchId = (r) => s((out(r, "code_node_GMSJTmJr") || {}).batchId || r.params.batch_id);
const migrated = (r) => MIGRATION.some((id) => has(r, id));
const READ_NODES = {
  SUBTRACT: ["get_node_uaq6Z1ej", "get_node_GjRiq3dT", "search_node_L50IlXls", "search_node_FGjULf7c", "search_node_p2K6C5AB", "search_node_7tT1rozD", "search_node_7YQdabsq", "search_node_IXHaVq9k"],
  ADD: ["get_node_c4YkI6sb", "get_node_OppesjaR", "search_node_tu6khdXJ", "search_node_iUYUmyOO", "search_node_sE4TyFdE"],
};

// the rows the call read, keyed like the engine reads them (balances by the call's natural key, costing by material + plant)
function readsOf(r) {
  const p = r.params;
  if (isSub(r)) {
    // the engine reads every FIFO / WA row of material + plant; the classic call read them for the migration check and
    // again (batch-scoped or not) for the price - the price reads come after a migration, so they join only when none ran
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
    fifoLayers: unionById(rowsOf(out(r, "search_node_tu6khdXJ")), rowsOf(out(r, "search_node_iUYUmyOO"))).map((x) => costRow(p, x)),
    waRows: rowsOf(out(r, "search_node_sE4TyFdE")).map((x) => costRow(p, x)),
  };
}
// the movement exactly as the classic call was given it
function movementOf(r, key) {
  const m = Object.assign({}, r.params, { movement_key: key, direction: isSub(r) ? "SUBTRACT" : "ADD" });
  delete m.itemData;
  return m;
}

// ------------------------------------------------------------------------------------------------- CONTRACT §5 movements
// v2moves.js (shared with live/plan_check.js): the ENGINE movements built from the run's document and stored header
const V2MOVES = require(path.join(__dirname, "v2moves.js"));
const v2Movements = (run) => V2MOVES.v2Movements(run.o4.allData || {}, run.hdr || run.o4.allData || {});
const MOVE_STR = ["plant_id", "organization_id", "material_id", "material_uom", "transaction_type", "trx_no", "inventory_category", "location_id", "batch_id", "manufacturing_date", "expired_date", "doc_date"];
const MOVE_NUM = ["quantity", "isMovingInv", "unit_price"];
// null-strict: the trace drops null params (absent), so null / undefined match each other but never "" (an ADD would write
// "" into a date / remark column where the classic writes NULL)
const sameP = (a, b) => (a === null || a === undefined ? b === null || b === undefined : b !== null && b !== undefined && String(a) === String(b));
function cmpMove(m, r) {
  const p = r.params;
  const d = [];
  if (m.direction !== (isSub(r) ? "SUBTRACT" : "ADD")) d.push("direction " + m.direction + " vs " + r.kind);
  for (const c of MOVE_STR) if (!sameP(m[c], p[c])) d.push(c);
  for (const c of MOVE_NUM) if (!eqN(m[c], p[c])) d.push(c);
  for (const c of ["remark", "remark2", "remark3"]) {
    const want = m.direction === "ADD" ? m[c] : undefined;
    if (!sameP(want, p[c])) d.push(c);
  }
  return d;
}

// ------------------------------------------------------------------------------------------------- tally
const tally = {};
const causeTally = {};
const flagTally = {};
const examples = {};
const detail = [];
const dbTally = {};
const bump = (bucket, rec, info) => {
  tally[bucket] = (tally[bucket] || 0) + 1;
  (examples[bucket] = examples[bucket] || []).length < SHOW && examples[bucket].push(rec.id);
  if (DETAIL) detail.push({ id: rec.id, env: rec.env, tenant: rec.tenant, bucket, info });
};
const dbBump = (k, rec) => {
  dbTally[k] = dbTally[k] || { n: 0, ids: [] };
  dbTally[k].n++;
  if (dbTally[k].ids.length < SHOW) dbTally[k].ids.push(rec.id);
};
const PRE = "pre-v65 classic: ";
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
  bump(bucket, rec, { flags, diffs: diffs.slice(0, 20) });
}
// pre-v65 classic code rounded prices to 4 dp / quantities to 3 dp at every step: tag its differences apart
const tagPre = (calls, diffs) => {
  if (!calls.some((r) => r.code === "pre-v65")) return diffs;
  return diffs.map((d) => (d.cause.startsWith("known:") || d.cause.startsWith("gap:") ? d : Object.assign({}, d, { cause: PRE + d.cause })));
};

// ------------------------------------------------------------------------------------------------- explained causes
// a non-batch SUBTRACT whose classic price / consumption reads (material + plant, EVERY batch) held batch rows - the
// engine prices and consumes from the non-batch rows only (core.js fifoFor / waFor key on batch_id)
const mixedRead = (r) => isSub(r) && !s(r.params.batch_id) && rowsOf(out(r, "search_node_p2K6C5AB")).concat(rowsOf(out(r, "search_node_7YQdabsq"))).some((x) => s(x.batch_id) !== "" && s(x.batch_id) !== "0");
const MIXED_GAP = "gap:non-batch SUBTRACT - classic read every batch's FIFO/WA rows, the engine only the non-batch ones";
const REMARK_GAP = "gap:cosmetic - existing batch row remark NULL -> '' (engine remarkOf)";
// prod SUBTRACT_INVENTORY v58 code_node_4yvZMf0Q declares wa_quantity bsonType int: the WA quantity after a fractional
// issue is floored (memory project_lowcode_bsontype_int_truncates; fixed in dev v59, prod paste pending)
const WA_INT_GAP = "gap:fix - classic prod v58 floors the WA quantity (4yvZMf0Q bsonType int); the engine keeps the decimal";
const SHORTFALL = "FIFO shortfall";

// ------------------------------------------------------------------------------------------------- movement rows
const MV_STR = ["transaction_type", "trx_no", "inventory_category", "movement", "plant_id", "organization_id", "uom_id", "base_uom_id", "item_id", "bin_location_id", "batch_number_id", "costing_method_id"];
const MV_NULLISH = ["parent_trx_no", "handling_unit_id"]; // classic writes '' where the engine writes NULL
const MV_NUM = ["unit_price", "total_price", "quantity", "base_qty", "actual_qty", "actual_base_qty"];
const MV_DATE = ["doc_date", "manufacturing_date", "expired_date"];
// old = the classic movement: recorded (what the platform stored) or rebuilt from the code outputs (computed, before the rule)
function compareMovement(mv, old, recorded, diffs, ctx, side, call) {
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
    else diffs.push({ cause: side + " movement." + c, field: c, engine: mv[c], old: old[c], call });
  }
}
// the OUT movement row the classic SUBTRACT inserted (its add-node is not traced): read back from the database
function dbCheckOut(r, mv, ctx) {
  const db = DBROWS[r.id];
  if (!db || !mv) return;
  const inside = (x) => idMs(x.id) >= r.t0 && idMs(x.id) <= r.t1;
  const cands = db.movements
    .filter((x) => x.movement === mv.movement && eqS(x.transaction_type, mv.transaction_type) && eqS(x.trx_no, mv.trx_no) && eqS(x.bin_location_id, mv.bin_location_id) && eqS(x.batch_number_id || "", mv.batch_number_id || "") && eqS(x.item_id, mv.item_id))
    .sort((a, b) => inside(b) - inside(a));
  const row = cands.find((x) => Math.abs(n8(x.quantity) - n8(ctx.rule("inventory_movement", "quantity", mv.quantity))) < EPS) || cands[0];
  if (!row) return dbBump(db.movements.length ? "OUT movement: not found in its window" : "OUT movement: no row of the item left in the call's window (deleted since)", r);
  const bad = [];
  for (const c of MV_NUM) if (Math.abs(n8(row[c]) - n8(ctx.rule("inventory_movement", c, mv[c]))) >= EPS) bad.push(c);
  for (const c of ["inventory_category", "plant_id", "organization_id", "uom_id", "base_uom_id", "item_id", "costing_method_id"]) if (!eqS(row[c], mv[c])) bad.push(c);
  const nullish = MV_NULLISH.filter((c) => !eqS(row[c], mv[c]));
  for (const c of nullish) if (s(row[c]) !== "" && s(mv[c]) !== "") bad.push(c);
  for (const c of MV_DATE) if (day(row[c]) !== day(mv[c]) && !(s(row[c]).endsWith(" 00:00:00") && day(row[c]).slice(0, 10) === day(mv[c]).slice(0, 10))) bad.push(c);
  const edited = s(row.update_time).slice(0, 19) > s(row.create_time).slice(0, 19);
  // the item master's base UOM changed after the run and its movement rows were restated in place (update_time kept)
  const uomOnly = bad.length && bad.every((c) => c === "uom_id" || c === "base_uom_id");
  const restated = uomOnly && db.item_now && eqS(row.base_uom_id, db.item_now.based_uom) && !eqS(db.item_now.based_uom, (itemOf(r) || {}).based_uom);
  if (Number(row.is_deleted)) dbBump("OUT movement: row soft-deleted since" + (bad.length ? " (differs in " + bad.join(",") + ")" : " (identical)"), r);
  else if (restated) dbBump("OUT movement: row restated to the item's later base UOM (item master changed after the run; trace = engine)", r);
  else if (bad.length && edited) dbBump("OUT movement: row edited after the run (" + bad.join(",") + ")", r);
  else dbBump(bad.length ? (r.code === "pre-v65" ? PRE : "") + "OUT movement: database row differs in " + bad.join(",") : "OUT movement: database row identical" + (nullish.length ? " (" + nullish.map((c) => c + " " + JSON.stringify(row[c]) + " vs engine " + JSON.stringify(mv[c])).join(", ") + ")" : ""), r);
  if (DETAIL && bad.length) detail.push({ id: r.id, bucket: "db.OUT", info: bad.map((c) => [c, mv[c], row[c]]) });
}

// ------------------------------------------------------------------------------------------------- per-call comparisons
// SUBTRACT: price, the OUT movement, and what the classic computed for each row it updates (balances, FIFO, WA)
function cmpSub(r, res, mv, diffs, ctx) {
  const p = r.params;
  const calc = out(r, "code_node_mQnskse9") || {};
  const uom = out(r, "code_node_wBfvXM2G") || {};
  const cur = out(r, "code_node_DUBS9GZF") || {};
  if (!res || res.code !== "200") return diffs.push({ cause: "OUT result", field: "code", engine: res && res.code, old: "200", call: r.id });
  const d0 = diffs.length;
  if (!eqN(res.unit_price, calc.calculatedUnitPrice)) diffs.push({ cause: "OUT unit_price", field: "unit_price", engine: res.unit_price, old: calc.calculatedUnitPrice, call: r.id });
  if (!eqN(res.total_price, calc.totalPrice)) diffs.push({ cause: "OUT total_price", field: "total_price", engine: res.total_price, old: calc.totalPrice, call: r.id });
  const b = out(r, "code_node_MQ0uNcoG");
  const oldMv = {
    transaction_type: p.transaction_type, trx_no: p.trx_no, inventory_category: p.inventory_category, parent_trx_no: p.parent_trx_no, movement: "OUT",
    plant_id: p.plant_id, organization_id: p.organization_id, unit_price: calc.calculatedUnitPrice, total_price: calc.totalPrice,
    quantity: uom.altQty, base_qty: uom.baseQty, uom_id: uom.altUOM, base_uom_id: uom.baseUOM, item_id: p.material_id, bin_location_id: p.location_id,
    batch_number_id: b && b.batchId ? b.batchId : p.batch_id, costing_method_id: uom.costingMethod, manufacturing_date: cur.manufacturingDate,
    expired_date: cur.expiredDate, doc_date: p.doc_date, actual_qty: uom.actualAltQty, actual_base_qty: uom.actualBaseQty, handling_unit_id: p.handling_unit_id,
  };
  compareMovement(mv, oldMv, false, diffs, ctx, "OUT", r.id);
  if (mixedRead(r)) for (let i = d0; i < diffs.length; i++) if (/price/.test(diffs[i].field)) diffs[i].cause = MIXED_GAP;
  dbCheckOut(r, mv, ctx);
}
// ADD: price, the IN movement (recorded add-node row, else rebuilt)
function cmpAdd(r, res, mv, diffs, ctx) {
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
  compareMovement(mv, old, !!rec, diffs, ctx, "IN", r.id);
}

// ------------------------------------------------------------------------------------------------- final row values
// every row the calls wrote: the engine's (update after / created row) vs the LAST classic call's value for it.
// classic created ids (FIFO layer / WA row inserted by an ADD of the group) are mapped to the engine's created rows.
function classicWrites(calls) {
  const nk = (p) => [s(p.material_id), s(p.location_id), s(p.plant_id), s(p.organization_id)].join("|");
  const ib = {};
  const bb = {};
  const fifoUpd = {}; // layer id -> {r, val}
  const fifoNew = []; // {r, cost, qty, batch, seq, dbId}
  const waUpd = {}; // wa id -> {r, qty, cost?}
  const waNew = []; // {r, cost, qty, batch, dbId}
  const flags = new Set();
  const track = (map, k, e) => {
    const prev = map[k];
    if (prev && (prev.created || prev.born)) e.born = prev.born || prev;
    map[k] = e;
  };
  for (const r of calls) {
    if (!okCall(r)) continue;
    const p = r.params;
    const k = nk(p);
    const uom = out(r, isSub(r) ? "code_node_wBfvXM2G" : "code_node_mvszWJ8p") || {};
    const method = s(uom.costingMethod || methodOf(r));
    if (isSub(r)) {
      const calc = out(r, "code_node_mQnskse9") || {};
      if (countOf(out(r, "get_node_uaq6Z1ej")) > 0) track(ib, k, { r, created: false, vals: Object.fromEntries(QTY.map((c) => [c, calc[QM[c]]])) });
      if (s(p.batch_id)) track(bb, k + "|" + s(p.batch_id), { r, created: false, vals: Object.fromEntries(QTY.map((c) => [c, calc[BM[c]]])) });
      const fp = out(r, "code_node_JuWVegvU");
      if (fp) {
        for (const u of fp.updates || []) fifoUpd[s(u.id)] = { r, val: u.fifo_available_quantity };
        if (n8(fp.remainingQty) > 0) flags.add(SHORTFALL);
      }
      const wp = out(r, "code_node_4yvZMf0Q");
      if (wp && s(wp.id)) waUpd[s(wp.id)] = Object.assign({}, waUpd[s(wp.id)] || {}, { r, qty: wp.wa_quantity, sub: true });
    } else {
      if (countOf(out(r, "get_node_c4YkI6sb")) > 0) track(ib, k, { r, created: false, vals: out(r, "code_node_t7V3DsPG") || {} });
      else {
        const row = rowsOf({ data: out(r, "add_node_MmpuGQao") })[0];
        track(ib, k, { r, created: true, recorded: !!row, vals: row || out(r, "code_node_aFO7peip") || {} });
      }
      const b = addBatchId(r);
      if (b) {
        if (countOf(out(r, "get_node_OppesjaR")) > 0) track(bb, k + "|" + b, { r, created: false, vals: out(r, "code_node_YUVUnD8B") || {}, remarks: true });
        else {
          const row = rowsOf({ data: out(r, "add_node_J7moAYDJ") })[0];
          track(bb, k + "|" + b, { r, created: true, recorded: !!row, vals: row || Object.assign({}, out(r, "code_node_aFO7peip") || {}, { manufacturing_date: p.manufacturing_date, expired_date: p.expired_date, doc_date: p.doc_date, remark: p.remark, remark2: p.remark2, remark3: p.remark3 }) });
        }
      }
      const pr = out(r, "code_node_BzebhJnQ") || {};
      const isMoving = Number((out(r, "code_node_3XzQSsce") || {}).isMovingInv || 0);
      const db = DBROWS[r.id] || { fifo: [], wa: [] };
      if (isMoving === 0 && method === FIFO_M) {
        const seq = (out(r, "code_node_EbBqqUx8") || {}).sequenceNumber;
        const dbRow = db.fifo.find((x) => eqS(x.batch_id || "", b || "") && Number(x.fifo_sequence) === Number(seq)) || db.fifo.find((x) => eqS(x.batch_id || "", b || ""));
        fifoNew.push({ r, cost: pr.unitPrice, qty: uom.baseQty, batch: b || null, seq, dbId: dbRow ? s(dbRow.id) : null, dbRow });
      } else if (isMoving === 0 && method === WA_M) {
        const wc = out(r, "code_node_40n1pYig");
        if (wc) waUpd[s(wc.latestWaId)] = { r, qty: wc.newWaQuantity, cost: wc.newWaCostPrice };
        else {
          const dbRow = db.wa.find((x) => eqS(x.batch_id || "", b || ""));
          waNew.push({ r, cost: pr.unitPrice, qty: uom.baseQty, batch: b || null, dbId: dbRow ? s(dbRow.id) : null, dbRow });
        }
      }
    }
  }
  return { ib, bb, fifoUpd, fifoNew, waUpd, waNew, flags };
}

function cmpFinals(calls, input, pl, diffs, ctx, startMs) {
  const cw = classicWrites(calls);
  const nk = (p) => [s(p.material_id), s(p.location_id), s(p.plant_id), s(p.organization_id)].join("|");
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
        if (born.recorded && datePartOnly(born.vals[c], got.vals[c])) diffs.push({ cause: DATE_PART, field: c, engine: got.vals[c], old: born.vals[c], call: born.r.id });
        else diffs.push({ cause: "batch_balance(new)." + c, field: c, engine: got.vals[c], old: born.vals[c], call: born.r.id });
      }
      for (const c of ["remark", "remark2", "remark3"]) {
        if (eqS(got.vals[c], born.vals[c])) continue;
        diffs.push({ cause: "batch_balance(new)." + c, field: c, engine: got.vals[c], old: born.vals[c], call: born.r.id });
      }
    }
    if (t === "item_batch_balance" && want.remarks && !got.created) {
      // the classic ADD rewrote the remarks (code_node_YUVUnD8B; an absent key = null/undefined -> NULL written)
      for (const c of ["remark", "remark2", "remark3"]) {
        const ev = got.vals[c];
        const ov = want.vals[c];
        if ((ev === null || ev === undefined) && (ov === null || ov === undefined)) continue;
        if (eqS(ev, ov) && !(ev === "" && (ov === undefined || ov === null))) continue;
        diffs.push({ cause: (ov === undefined || ov === null) && ev === "" ? REMARK_GAP : "batch_balance." + c, field: c, engine: ev, old: ov, call: want.r.id });
      }
    }
  };
  for (const [k, want] of Object.entries(cw.ib)) cmpRow("item_balance", k, want);
  for (const [k, want] of Object.entries(cw.bb)) cmpRow("item_batch_balance", k, want);
  for (const t of ["item_balance", "item_batch_balance"]) {
    const want = t === "item_balance" ? cw.ib : cw.bb;
    for (const k of Object.keys(eng[t])) if (!want[k]) diffs.push({ cause: (t === "item_balance" ? "item_balance" : "batch_balance") + " written only by the engine", field: k, engine: eng[t][k].vals, old: null, call: calls[0].id });
  }

  // FIFO: new layers in creation order (cost, quantity, batch, sequence; the DB row when the trace lacks the insert)
  const engFifoNew = pl.creates.fifo;
  if (engFifoNew.length !== cw.fifoNew.length) diffs.push({ cause: "fifo(new) count", field: "fifo", engine: engFifoNew.length, old: cw.fifoNew.length, call: calls[0].id });
  const newIdMap = {}; // classic created layer id -> engine created layer
  engFifoNew.forEach((f, j) => {
    const o = cw.fifoNew[j];
    if (!o) return;
    if (o.dbId) newIdMap[o.dbId] = f;
    const oc = o.dbRow ? n8(o.dbRow.fifo_cost_price) : n8(ctx.st("fifo_costing_history", "fifo_cost_price", o.cost));
    if (Math.abs(n8(ctx.st("fifo_costing_history", "fifo_cost_price", f.fifo_cost_price)) - oc) >= EPS) diffs.push({ cause: "fifo(new).fifo_cost_price", field: "M?", engine: f.fifo_cost_price, old: o.dbRow ? o.dbRow.fifo_cost_price : o.cost, call: o.r.id });
    const oq = o.dbRow ? n8(o.dbRow.fifo_initial_quantity) : n8(ctx.st("fifo_costing_history", "fifo_initial_quantity", o.qty));
    if (Math.abs(n8(ctx.st("fifo_costing_history", "fifo_initial_quantity", f.fifo_initial_quantity)) - oq) >= EPS) diffs.push({ cause: "fifo(new).fifo_initial_quantity", field: "qty", engine: f.fifo_initial_quantity, old: o.qty, call: o.r.id });
    if (!eqS(f.batch_id, o.batch)) diffs.push({ cause: "fifo(new).batch_id", field: "batch_id", engine: f.batch_id, old: o.batch, call: o.r.id });
    if (Number(f.fifo_sequence) !== Number(o.seq)) diffs.push({ cause: fifoSeqCause(o.r, f.fifo_sequence, o.seq), field: "fifo_sequence", engine: f.fifo_sequence, old: o.seq, call: o.r.id });
    if (!o.dbRow && DBROWS[o.r.id]) dbBump("fifo layer: not found in its call's window", o.r);
    else if (o.dbRow) dbBump("fifo layer: database row compared (cost, initial quantity, batch, sequence)", o.r);
  });
  // FIFO consumption: each layer's final available quantity = the last classic update of it
  const engFifoUpd = {};
  for (const u of pl.updates.fifo) engFifoUpd[u.id] = u.after.fifo_available_quantity;
  for (const [id, w] of Object.entries(cw.fifoUpd)) {
    const createdInRun = idMs(id) >= startMs;
    const ev = createdInRun ? (newIdMap[id] ? newIdMap[id].fifo_available_quantity : undefined) : engFifoUpd[id];
    if (ev === undefined) {
      diffs.push({ cause: createdInRun ? "fifo layer created in the run, consumed by classic, not mapped" : "fifo layer consumed by classic, not by the engine", field: id, engine: null, old: w.val, call: w.r.id });
      continue;
    }
    if (Math.abs(n8(ctx.st("fifo_costing_history", "fifo_available_quantity", ev)) - n8(ctx.st("fifo_costing_history", "fifo_available_quantity", w.val))) >= EPS) diffs.push({ cause: "fifo.fifo_available_quantity", field: id, engine: ev, old: w.val, call: w.r.id });
  }
  for (const id of Object.keys(engFifoUpd)) if (!cw.fifoUpd[id]) diffs.push({ cause: "fifo layer consumed only by the engine", field: id, engine: engFifoUpd[id], old: null, call: calls[0].id });
  // created layers consumed by the engine only (the classic created them and never touched them again)
  for (const o of cw.fifoNew) {
    const f = o.dbId ? newIdMap[o.dbId] : null;
    if (f && !cw.fifoUpd[o.dbId] && !eqN(f.fifo_available_quantity, f.fifo_initial_quantity)) diffs.push({ cause: "fifo(new) layer consumed only by the engine", field: o.dbId, engine: f.fifo_available_quantity, old: f.fifo_initial_quantity, call: o.r.id });
  }

  // WA: updates (SUBTRACT quantity / ADD re-average) on rows read; rows created in the run (ADD batch / first row)
  const engWaUpd = {};
  for (const u of pl.updates.wa) engWaUpd[u.id] = u.after;
  const newWaMap = {};
  if (pl.creates.wa.length !== cw.waNew.length) diffs.push({ cause: "wa(new) count", field: "wa", engine: pl.creates.wa.length, old: cw.waNew.length, call: calls[0].id });
  pl.creates.wa.forEach((w, j) => {
    const o = cw.waNew[j];
    if (!o) return;
    if (o.dbId) newWaMap[o.dbId] = w;
    if (!eqS(w.batch_id, o.batch)) diffs.push({ cause: "wa(new).batch_id", field: "batch_id", engine: w.batch_id, old: o.batch, call: o.r.id });
    // a created row later issued in the run: its final values are compared below (cw.waUpd), not the insert's
    if (o.dbId && cw.waUpd[o.dbId]) return dbBump("wa row: created and issued in the same run (final values compared)", o.r);
    if (o.dbRow) dbBump(waRowEdited(o.dbRow) ? "wa row: updated since (compared with the classic's computed insert)" : "wa row: database row compared (cost, quantity, batch)", o.r);
    const oc = o.dbRow && !waRowEdited(o.dbRow) ? n8(o.dbRow.wa_cost_price) : n8(ctx.st("wa_costing_method", "wa_cost_price", o.cost));
    const oq = o.dbRow && !waRowEdited(o.dbRow) ? n8(o.dbRow.wa_quantity) : n8(ctx.st("wa_costing_method", "wa_quantity", o.qty));
    if (Math.abs(n8(ctx.st("wa_costing_method", "wa_cost_price", w.wa_cost_price)) - oc) >= EPS) diffs.push({ cause: "wa(new).wa_cost_price", field: "cost", engine: w.wa_cost_price, old: o.dbRow ? o.dbRow.wa_cost_price : o.cost, call: o.r.id });
    if (Math.abs(n8(ctx.st("wa_costing_method", "wa_quantity", w.wa_quantity)) - oq) >= EPS) diffs.push({ cause: "wa(new).wa_quantity", field: "qty", engine: w.wa_quantity, old: o.dbRow ? o.dbRow.wa_quantity : o.qty, call: o.r.id });
    if (!o.dbRow && DBROWS[o.r.id]) dbBump("wa row: not found in its call's window", o.r);
  });
  for (const [id, w] of Object.entries(cw.waUpd)) {
    const createdInRun = idMs(id) >= startMs;
    const e = createdInRun ? newWaMap[id] : engWaUpd[id];
    if (!e) {
      diffs.push({ cause: createdInRun ? "wa row created in the run, updated by classic, not mapped" : waTieCause(calls, id, engWaUpd), field: id, engine: null, old: [w.qty, w.cost], call: w.r.id });
      continue;
    }
    const eq = n8(ctx.st("wa_costing_method", "wa_quantity", e.wa_quantity));
    const oq = n8(ctx.st("wa_costing_method", "wa_quantity", w.qty));
    if (Math.abs(eq - oq) >= EPS) diffs.push({ cause: w.sub && Number.isInteger(n8(w.qty)) && Math.abs(Math.floor(eq) - oq) < EPS ? WA_INT_GAP : "wa.wa_quantity", field: id, engine: e.wa_quantity, old: w.qty, call: w.r.id });
    if (w.cost !== undefined && Math.abs(n8(ctx.st("wa_costing_method", "wa_cost_price", e.wa_cost_price)) - n8(ctx.st("wa_costing_method", "wa_cost_price", w.cost))) >= EPS) diffs.push({ cause: "wa.wa_cost_price", field: id, engine: e.wa_cost_price, old: w.cost, call: w.r.id });
  }
  for (const id of Object.keys(engWaUpd)) if (!cw.waUpd[id]) diffs.push({ cause: "wa row updated only by the engine", field: id, engine: engWaUpd[id], old: null, call: calls[0].id });
  return cw.flags;
}
const waRowEdited = (row) => s(row.update_time).slice(0, 19) > s(row.create_time).slice(0, 19);
function fifoSeqCause(r, engineSeq, oldSeq) {
  const rows = rowsOf(out(r, "search_node_tu6khdXJ"));
  const nb = rows.filter((l) => !s(l.batch_id) || s(l.batch_id) === "0");
  const maxAll = rows.length ? Math.max(...rows.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;
  const maxNb = nb.length ? Math.max(...nb.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;
  if (!addBatchId(r) && Number(oldSeq) === maxAll && Number(engineSeq) === maxNb) return "gap:non-batch FIFO sequence - classic numbers after every batch's layers, the engine after the non-batch ones";
  return "fifo(new).fifo_sequence";
}
function waTieCause(calls, oldId, engWaUpd) {
  // the engine picked another newest row: equal created_at (sort keeps read order) is a tie-break, else unexplained
  const engIds = Object.keys(engWaUpd);
  for (const r of calls) {
    const rows = rowsOf(out(r, "search_node_sE4TyFdE")).concat(rowsOf(out(r, "search_node_7YQdabsq")), rowsOf(out(r, "search_node_IXHaVq9k")), rowsOf(out(r, "search_node_FGjULf7c")));
    const a = rows.find((x) => s(x.id) === s(oldId));
    const b = rows.find((x) => engIds.includes(s(x.id)));
    if (a && b && (s(a.created_at) === s(b.created_at) || !a.created_at || !b.created_at)) return "known:WA newest-row tie-break (equal created_at)";
  }
  return "wa row updated by classic, not by the engine";
}

function flagsOf(calls) {
  const f = new Set();
  for (const r of calls) {
    const p = r.params;
    if (r.code === "pre-v65") f.add("classic ran pre-v65 code");
    if (Object.values(r.nodes).some((n) => n.rebuilt)) f.add("costing read rebuilt from today's rows (rebuild_cut.py)");
    if (s(p.batch_id)) f.add("batch");
    f.add(r.kind + " " + (methodOf(r) || "?") + (s(p.batch_id) || (!isSub(r) && addBatchId(r)) ? " batch" : " non-batch"));
    if (s(p.material_uom) && s(p.material_uom) !== s((itemOf(r) || {}).based_uom)) f.add("alt UOM");
    if (!isSub(r) && countOf(out(r, "get_node_OppesjaR")) === 0 && addBatchId(r)) f.add("new batch balance row");
    if (!isSub(r) && countOf(out(r, "get_node_c4YkI6sb")) === 0) f.add("new item_balance row");
    if (!isSub(r) && n8(p.unit_price) !== 0) f.add("ADD non-zero price");
    if (!isSub(r) && n8(p.unit_price) === 0) f.add("ADD zero price");
    if (!isSub(r) && (s(p.remark) || s(p.remark2) || s(p.remark3))) f.add("ADD with line remarks");
    const g = guard(movementOf(r, "g"));
    if (g) f.add("engine guard refuses: " + g);
    if (mixedRead(r)) f.add("non-batch read held batch rows");
    if (isSub(r)) {
      const fp = out(r, "code_node_JuWVegvU");
      if (fp && n8(fp.remainingQty) > 0) f.add(SHORTFALL);
      const wp = out(r, "code_node_4yvZMf0Q");
      if (wp && !Number.isInteger(n8((out(r, "code_node_wBfvXM2G") || {}).baseQty))) f.add("WA issue of a fractional quantity");
    }
  }
  return [...f].sort();
}

// ------------------------------------------------------------------------------------------------- plan
// one plan over a list of classic calls: items + each row's first read (rows created inside the window are the plan's own)
function plan(calls, movements, ctx, startMs) {
  const items = {};
  const seed = { itemBalances: {}, batchBalances: {}, fifoLayers: {}, waRows: {} };
  for (const r of calls) {
    const it = itemOf(r);
    if (it) items[s(r.params.material_id)] = adaptItem(it);
    const rd = readsOf(r);
    for (const t of Object.keys(seed)) {
      for (const row of rd[t]) {
        if (idMs(row.id) >= startMs) continue;
        if (!seed[t][row.id]) seed[t][row.id] = row;
      }
    }
  }
  const input = { operationKey: "R", items, itemBalances: Object.values(seed.itemBalances), batchBalances: Object.values(seed.batchBalances), fifoLayers: Object.values(seed.fifoLayers), waRows: Object.values(seed.waRows), movements, nowText: "", precision: ctx.prec };
  return { input, plan: engine.planBulk(JSON.parse(JSON.stringify(input))) };
}
// a later call's read of a row the plan already holds must equal what the earlier calls left (else something outside the
// run changed it between two calls - the classic is not atomic; V2 reads once)
function readChain(calls, ctx) {
  const seen = {};
  const issues = [];
  const cw = { ib: {}, bb: {} };
  for (const r of calls) {
    if (!okCall(r)) continue;
    const rd = readsOf(r);
    for (const row of rd.itemBalances) {
      const prev = cw.ib[row.id];
      if (prev && QTY.some((c) => Math.abs(n8(ctx.st("item_balance", c, prev[c])) - n8(row[c])) >= EPS)) issues.push("item_balance " + row.id);
    }
    for (const row of rd.batchBalances) {
      const prev = cw.bb[row.id];
      if (prev && QTY.some((c) => Math.abs(n8(ctx.st("item_batch_balance", c, prev[c])) - n8(row[c])) >= EPS)) issues.push("item_batch_balance " + row.id);
    }
    if (isSub(r)) {
      const calc = out(r, "code_node_mQnskse9") || {};
      const ibRow = rd.itemBalances[0];
      if (ibRow) cw.ib[ibRow.id] = Object.fromEntries(QTY.map((c) => [c, calc[QM[c]]]));
      const bbRow = rd.batchBalances[0];
      if (bbRow) cw.bb[bbRow.id] = Object.fromEntries(QTY.map((c) => [c, calc[BM[c]]]));
    } else {
      const ibRow = rd.itemBalances[0];
      if (ibRow) cw.ib[ibRow.id] = out(r, "code_node_t7V3DsPG") || {};
      const bbRow = rd.batchBalances[0];
      if (bbRow) cw.bb[bbRow.id] = out(r, "code_node_YUVUnD8B") || {};
    }
    seen[r.id] = true;
  }
  return issues;
}

// ------------------------------------------------------------------------------------------------- modes
// parent exits where the classic moved nothing by design (the run is not a parity case)
const PARENT_STOP = {
  return_node_SAguardRefuse: "skip:guarded classic refused before any write (SA V2 guard v25: Processing / > 500 entries / a line > 60,000 bytes)",
  return_node_OVwXCPK5: "skip:classic refused before any movement (required fields)",
};
const INVALID_TYPE_EXIT = "return_node_XY9go0Ky"; // the classic loop's "Invalid" branch: it stops there, after the entries before it
// a child that FAILED (thrown error, e.g. SUBTRACT v59 code_node_4yvZMf0Q "No Weighted Average costing record") stops the
// classic like a code 400 does (the parent run then fails too): the engine must refuse the same movement
const childFail = (r) => r.status !== "Complete";
const failCode = (r) => (/No Weighted Average costing record/.test(s(r.error)) ? "NO_WA_RECORD" : "FAIL:" + s(r.error).slice(0, 60));
const stopsClassic = (r) => childFail(r) || (!okCall(r) && !!(SUB_RET[r.exit] || ADD_RET[r.exit]) && (SUB_RET[r.exit] || ADD_RET[r.exit]) !== "401");
const stopCode = (r) => (childFail(r) ? failCode(r) : (isSub(r) ? SUB_RET : ADD_RET)[r.exit] || r.exit);
function parentStop(run) {
  if (run.status !== "Complete" && !run.calls.some(childFail)) return "skip:classic run failed (" + s(run.error).slice(0, 80) + ")";
  if (PARENT_STOP[run.exit]) return PARENT_STOP[run.exit];
  if (run.saveAs === "Draft") return "skip:Draft save (moves nothing)";
  if (run.exit === INVALID_TYPE_EXIT) return "ok-fail:invalid movement_type (classic applied " + run.calls.length + " entr" + (run.calls.length === 1 ? "y" : "ies") + " first; V2 SUBMIT refuses SA_INVALID_MOVEMENT_TYPE before any write)";
  return null;
}
function sortedCalls(run) {
  return run.calls.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

// MOVES: the §5 ENGINE movements vs the classic's child calls
function movesMode(run) {
  const { ms, bad } = v2Movements(run);
  const calls = sortedCalls(run);
  const flags = [];
  const stop0 = parentStop(run);
  if (stop0) return bump(stop0, run);
  if (bad.length) flags.push("§5 builder: " + bad[0]);
  // the classic stops after the first child that answered code 400 (if_FRgRBcnT / if_nolDyGWp)
  const stop = calls.findIndex(stopsClassic);
  const expected = stop >= 0 ? stop + 1 : ms.length;
  const diffs = [];
  if (calls.length !== expected) diffs.push({ cause: "call count " + calls.length + " vs §5 movements " + ms.length + (stop >= 0 ? " (classic stopped at call " + (stop + 1) + ")" : ""), field: "count", engine: ms.length, old: calls.length });
  calls.forEach((r, i) => {
    const m = ms[i];
    if (!m) return diffs.push({ cause: "classic call without a §5 movement", field: "M" + (i + 1), engine: null, old: r.id });
    for (const f of cmpMove(m, r)) diffs.push({ cause: "movement field " + f, field: m.movement_key + "." + f, engine: m[f.split(" ")[0]], old: r.params[f.split(" ")[0]], call: r.id });
  });
  if (stop >= 0) flags.push("classic stopped at call " + (stop + 1) + " of " + ms.length + " (" + stopCode(calls[stop]) + ")");
  flags.push("movements " + (ms.length <= 1 ? "1" : ms.length <= 5 ? "2-5" : ms.length <= 20 ? "6-20" : ">20"));
  if (run.o4From !== "o4") flags.push("lines from the request (O4tWJ5JH output cut)");
  if (!ms.length) flags.push("no entry with sa_quantity > 0 (SUBMIT refuses)");
  settle(run, diffs, flags);
}

// (a) each child call alone, as one movement, with its own reads
function callsMode(run) {
  for (const r of sortedCalls(run)) {
    const ctx = ctxOf(r);
    if (!itemOf(r) && !["return_node_rfb2MFbP", "return_node_UCNawDcR", "return_node_8ZcSkz7f", "return_node_ywhXsqEN"].includes(r.exit)) {
      bump("skip:no item in the trace", r);
      continue;
    }
    const cut = READ_NODES[r.kind].find((id) => traceCut(r, id));
    if (cut) {
      bump("skip:trace cut (" + cut + ")", r);
      continue;
    }
    const flags = flagsOf([r]);
    const m = movementOf(r, "m");
    const g = guard(m);
    if (g) {
      bump(okCall(r) ? "gap:V2 guard REJECTs (" + g + "); classic completed" : "ok-fail:V2 guard REJECT (" + g + ")", r);
      continue;
    }
    const { input, plan: pl } = plan([r], [m], ctx, r.t0);
    const RET = isSub(r) ? SUB_RET : ADD_RET;
    if (r.status !== "Complete") {
      bump(pl.ok ? "DIFF:classic failed (" + r.error.slice(0, 60) + "), engine planned" : "ok-fail:" + pl.failure.code + " (classic failed: " + r.error.slice(0, 60) + ")", r, { error: r.error });
      continue;
    }
    if (RET[r.exit]) {
      const got = pl.ok ? pl.results[0].code : pl.failure.code;
      bump(got === RET[r.exit] ? "ok-fail:" + got : "DIFF:classic " + RET[r.exit] + ", engine " + got, r);
      continue;
    }
    if (!okCall(r)) {
      bump("skip:exit " + r.exit, r);
      continue;
    }
    if (!pl.ok) {
      settle(r, tagPre([r], [{ cause: migrated(r) ? "known:classic migrated costing rows -> engine UNSUPPORTED_COSTING" : "engine failed: " + pl.failure.code, field: "plan", engine: pl.failure.message, old: "ok", call: r.id }]), flags);
      continue;
    }
    const diffs = [];
    if (isSub(r)) cmpSub(r, pl.results[0], pl.movements[0], diffs, ctx);
    else cmpAdd(r, pl.results[0], pl.movements[0], diffs, ctx);
    cmpFinals([r], input, pl, diffs, ctx, r.t0);
    settle(r, tagPre([r], diffs), flags);
  }
}

// (b) each SA run as ONE plan with the §5 movements: the V2 COMMIT A2's single APPLY
const docLines = {};
function docMode(run) {
  const calls = sortedCalls(run);
  const stop0 = parentStop(run);
  if (stop0) return bump(stop0, run);
  const { ms } = v2Movements(run);
  const flags = flagsOf(calls);
  const n = ms.length;
  const size = "entries " + (n <= 1 ? "1" : n <= 5 ? "2-5" : n <= 20 ? "6-20" : ">20");
  flags.push(size);
  docLines[size] = (docLines[size] || 0) + 1;
  if (!calls.length) return bump(n ? "DIFF:classic made no call for " + n + " movements" : "skip:no movement (no entry with sa_quantity > 0)", run);
  const ctx = ctxOf(calls[0]);
  if (calls.some((r) => !itemOf(r) && okCall(r))) return bump("skip:no item in the trace", run);
  const cut = calls.map((r) => READ_NODES[r.kind].find((id) => traceCut(r, id))).find(Boolean);
  if (cut) return bump("skip:trace cut (" + cut + ")", run);
  const org = s((run.hdr || run.o4.allData || {}).organization_id);
  const refused = ms.map((m) => guard(m, org)).find(Boolean);
  const failed = calls.findIndex(stopsClassic);
  if (refused) return bump(failed >= 0 ? "ok-fail:V2 guard REJECT (" + refused + "), classic failed too" : "gap:V2 guard REJECTs the whole operation (" + refused + "); classic completed", run);
  if (calls.length > ms.length) return bump("DIFF:more classic calls (" + calls.length + ") than §5 movements (" + ms.length + ")", run);
  const { input, plan: pl } = plan(calls, ms, ctx, run.t0);
  if (failed >= 0) {
    // classic stopped the SA at this entry after applying the ones before it; V2 is all-or-nothing
    const r = calls[failed];
    const want = stopCode(r);
    const got = pl.ok ? "planned" : pl.failure.code;
    const atKey = "M" + (failed + 1);
    return bump(got === want && (pl.failure || {}).movement_key === atKey ? "ok-fail:" + want + " (classic applied " + failed + " entr" + (failed === 1 ? "y" : "ies") + " before stopping; V2 applies none)" : "DIFF:classic " + want + " at " + atKey + ", engine " + got + " at " + s((pl.failure || {}).movement_key), run);
  }
  if (calls.length < ms.length) flags.push("classic made " + calls.length + " calls for " + ms.length + " movements");
  if (!pl.ok) return settle(run, tagPre(calls, [{ cause: (calls.some(migrated) ? "known:classic migrated costing rows -> engine UNSUPPORTED_COSTING" : "engine failed: " + pl.failure.code) + " (document)", field: pl.failure.movement_key, engine: pl.failure.message, old: "ok", call: run.id }]), flags);
  const chain = readChain(calls, ctx);
  if (chain.length) flags.push("a row changed between two classic calls (outside the run)");
  const diffs = [];
  const res = {};
  for (const x of pl.results) res[x.movement_key] = x;
  const mvs = {};
  for (const m of pl.movements) mvs[m.operation_effect_key] = m;
  calls.forEach((r, i) => {
    const k = "M" + (i + 1);
    if ((isSub(r) ? SUB_RET : ADD_RET)[r.exit] === "401") {
      if (!res[k] || res[k].code !== "401") diffs.push({ cause: "401 (stock control 0)", field: k, engine: res[k] && res[k].code, old: "401", call: r.id });
      return;
    }
    if (isSub(r)) cmpSub(r, res[k], mvs["R|" + k], diffs, ctx);
    else cmpAdd(r, res[k], mvs["R|" + k], diffs, ctx);
  });
  for (const f of cmpFinals(calls, input, pl, diffs, ctx, run.t0)) flags.push(f);
  settle(run, tagPre(calls, diffs), [...new Set(flags)].sort());
}

// ------------------------------------------------------------------------------------------------- main
const load = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let nRuns = 0;
let nCalls = 0;
const FN = { MOVES: movesMode, CALLS: callsMode, DOC: docMode }[mode];
if (!FN) {
  console.error("usage: node replay_sa.js <MOVES|CALLS|DOC> <sa.jsonl>  [--db d.jsonl] [--rules rules.json] [--raw] [--show N] [--detail out.json] [--mutate NAME]");
  process.exit(2);
}
for (const f of files) {
  for (const run of load(f)) {
    nRuns++;
    nCalls += run.calls.length;
    for (const c of run.calls) Object.assign(c, { env: c.env || run.env, tenant: c.tenant || run.tenant });
    try {
      FN(run);
    } catch (e) {
      bump("ERROR:" + e.message.slice(0, 100), run, { stack: e.stack });
    }
  }
}
const unit = mode === "CALLS" ? "calls" : "SA runs";
console.log(mode + (RAW ? " (raw 8 dp, no number rule)" : " (tenant number rules" + (RULES ? " from " + path.basename(opt("--rules", "")) : ": default 4 / 3 dp") + ")") + (MUTATE ? " MUTATED " + MUTATE : ""), nRuns, "SA runs,", nCalls, "recorded child calls from", files.map((f) => path.basename(f)).join(", "));
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
if (Object.keys(docLines).length) {
  console.log("-- SA runs by entries");
  for (const k of Object.keys(docLines).sort()) console.log(String(docLines[k]).padStart(6), k);
}
console.log("-- examples (SA run / call instance id)");
for (const k of Object.keys(examples).sort()) if (k !== "identical") console.log(k + ":\n    " + examples[k].join("\n    "));
if (Object.keys(dbTally).length) {
  console.log("-- rows the classic inserted, read back from the database, vs the engine's");
  for (const k of Object.keys(dbTally).sort()) console.log(String(dbTally[k].n).padStart(6) + " " + k + "  e.g. " + dbTally[k].ids.join(" "));
}
const cls = { identical: 0, known: 0, gap: 0, pre: 0, diff: 0, okfail: 0, skip: 0, other: 0 };
for (const [k, v] of Object.entries(tally)) {
  const c = k === "identical" ? "identical" : k.startsWith("known:") ? "known" : k.startsWith("gap:") ? "gap" : k.startsWith("pre-v65 classic only") ? "pre" : k.startsWith("DIFF") ? "diff" : k.startsWith("ok-fail") ? "okfail" : k.startsWith("skip") ? "skip" : "other";
  cls[c] += v;
}
console.log("SUMMARY mode=" + mode + (MUTATE ? " mutate=" + MUTATE : "") + (RAW ? " raw" : "") + " total=" + total + " " + Object.entries(cls).map(([k, v]) => k + "=" + v).join(" "));
if (DETAIL) fs.writeFileSync(DETAIL, JSON.stringify(detail, null, 1));
