// (b) Interpreter runs of the BUILT guarded classics (lib/sim/engine.js) with mocked SQL rows / reads / callees.
//   node test/classic/test_guard_flow.js
// 1. guard scenarios stop at the base's first node (code_node_O4tWJ5JH / cond_save_as); each runs twice: JSON-text injection
//    (the engine's) and by-reference injection with the request deep-frozen and the guard nodes in strict mode (a guard
//    that mutated the request would throw) - both must agree.
// 2. parity: pass-through requests run to the END of the base and of the guarded file - same answer, same writes, same
//    callee calls, same node trace minus the guard nodes.
// Texts are read from CONTRACT.md section 10 (whitespace-normalized), never retyped here.
"use strict";
const fs = require("fs");
const path = require("path");
const { Engine } = require("../../lib/sim/engine");
const { eq, truthy, done } = require("../../lib/harness");

const SAV2 = path.join(__dirname, "..", "..");
const REPO = path.join(SAV2, "..", "..");
const BUILT = { STOCK_ADJUSTMENT: path.join(REPO, "Stock Adjustment", "AsyncV2", "STOCK_ADJUSTMENT.json"), STOCK_COUNT: path.join(REPO, "Stock Count", "AsyncV2", "STOCK_COUNT.json") };
const BASE = { STOCK_ADJUSTMENT: path.join(SAV2, "base", "STOCK_ADJUSTMENT.v24.json"), STOCK_COUNT: path.join(SAV2, "base", "STOCK_COUNT.v10.json") };
const CHECK = path.join(SAV2, "base", "CHECK_REQUIRED_FIELD.v8.json");
const GUARD = {
  STOCK_ADJUSTMENT: ["code_node_SAguard", "sql_node_SAguard", "code_node_SAguardVerdict", "if_SAguardRefuse", "ifBlock_TSAguardRefuse", "ifBlock_FSAguardRefuse", "return_node_SAguardRefuse"],
  STOCK_COUNT: ["code_node_SCguard", "sql_node_SCguard", "code_node_SCguardVerdict", "if_SCguardRefuse", "if_SCguardRefuse_true", "if_SCguardRefuse_false", "end_SCguardRefuse"],
};
const ANCHOR = { STOCK_ADJUSTMENT: "code_node_O4tWJ5JH", STOCK_COUNT: "cond_save_as" };
const T = "000000";
const SA_ID = "2110229114286899201";
const SC_ID = "2110229071278505985";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const MAT = "2064633018934157313";
const MAT2 = "2069242655534825474";
const UOM = "1901805375573839875";
const LOC = "2100000000000000101";
const LOC2 = "2100000000000000102";

// ------------------------------------------------------------------------------------------------ texts (CONTRACT §10)
const contract = fs.readFileSync(path.join(SAV2, "CONTRACT.md"), "utf8");
const sec10 = contract.slice(contract.indexOf("## 10. Error codes"), contract.indexOf("## 11. "));
const quoted = [...sec10.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " "));
const pick = (start) => {
  const t = quoted.filter((q) => q.startsWith(start));
  if (t.length !== 1) throw new Error("CONTRACT §10: " + t.length + " texts start with " + start);
  return t[0];
};
const TXT = {
  SA_BUSY: pick("This Stock Adjustment is being processed"),
  SA_SC_BUSY: pick("A Stock Adjustment from this Stock Count is being processed"),
  SA_TOO_BIG: pick("This Stock Adjustment has <n> entries."),
  SC_TOO_BIG: pick("This review has <n> approved lines"),
  LINE: pick("Line <n> holds too many bins"),
};
const fill = (t, n, bytes) => t.replace("<n>", String(n)).replace("<bytes>", String(bytes));

// ------------------------------------------------------------------------------------------------ the interpreter
class Halt {
  constructor(value, ctx) {
    this.value = value;
    this.ctx = ctx;
  }
}
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

class GuardEngine extends Engine {
  // o: { files, db, sql, read, stubs, stopAt, inject: "json" | "ref", strictGuard: [ids] }
  constructor(o) {
    super({ dir: "", db: o.db, mocks: { sql: o.sql || {}, read: o.read || {} } });
    this.files = o.files;
    this.stopAt = o.stopAt || null;
    this.inject = o.inject || "json";
    this.strictGuard = new Set(o.strictGuard || []);
    this.stubs = o.stubs || {};
    this.calls = [];
  }
  load(name) {
    if (!this.files[name]) throw new Error("no file for workflow " + name);
    return JSON.parse(fs.readFileSync(this.files[name], "utf8"));
  }
  run(name, params) {
    try {
      return super.run(name, params);
    } catch (e) {
      if (e instanceof Halt) return { returned: e.value, ctx: e.ctx, halted: true };
      throw e;
    }
  }
  ref(prop) {
    return prop.replace(/^node\./, "node:").replace(/^workflowparams\./, "workflowparams:");
  }
  leaf(l, ctx) {
    const v = this.resolve(this.ref(l.prop), ctx);
    const has = v !== undefined && v !== null;
    if (l.operator === "equal") return has && typeof v !== "object" && String(v) === String(l.value);
    if (l.operator === "notEqual") return !(has && typeof v !== "object" && String(v) === String(l.value));
    if (l.operator === "numberEqual") return has && v !== "" && Number(v) === Number(l.value);
    if (l.operator === "isNotNull") return has && v !== "";
    throw new Error("operator " + l.operator + " not simulated");
  }
  node(n, ctx) {
    const d = n.data || {};
    if (this.stopAt && n.id === this.stopAt) throw new Halt({ reached: n.id }, ctx);
    if (n.type === "end-node" && d.back_data_type === "Default") {
      this.trace.push(ctx.name + " " + n.id);
      const msg = d.msg && typeof d.msg === "object" ? this.value(d.msg.code, ctx) : d.msg;
      throw new Halt({ envelope: { code: d.code, success: false, data: null, msg: msg === undefined ? null : msg } }, ctx);
    }
    if (n.type === "end-node" && d.back_data_type === "OutputParams") {
      this.trace.push(ctx.name + " " + n.id);
      const data = {};
      for (const f of d.response_value.list) data[f.prop] = clone(this.value(f.value, ctx));
      throw new Halt({ envelope: { code: 200, success: true, data: data } }, ctx);
    }
    if (n.type === "if" && d.condition_type === "ConditionRule") {
      const ok = (d.filter.list || []).every((l) => this.leaf(l, ctx));
      this.block(n.blocks[ok ? 0 : 1].blocks, ctx);
      return;
    }
    if (n.type === "condition-or-node") {
      const items = n.blocks.filter((b) => !b.data.isDefault);
      const chosen = items.find((b) => ((b.data.filter || {}).list || []).every((l) => this.leaf(l, ctx))) || n.blocks.find((b) => b.data.isDefault);
      if (chosen) this.block(chosen.blocks, ctx);
      return;
    }
    if (n.type === "workflow-node") {
      const callee = d.workflow.source.split(":Workflow:")[0];
      if (this.stubs[callee]) {
        const params = {};
        for (const b of d.body_params.list) params[b.prop] = clone(this.value(b.value, ctx));
        this.calls.push([n.id, callee, params]);
        this.record(n, ctx, this.stubs[callee](params));
        return;
      }
    }
    if (n.type === "code-node" && this.inject === "ref") {
      // the platform's runtime lookup (_meta.cmpData[...]): the code sees the values themselves, not JSON text
      const strict = this.strictGuard.has(n.id);
      const src = (strict ? '"use strict";\n' : "") + d.script.code.replace(/\{\{([^}]+)\}\}/g, (_, r) => "__ref(" + JSON.stringify(r) + ")");
      let res;
      try {
        res = new Function("console", "__ref", src)({ log: () => {}, error: () => {} }, (r) => this.resolve(r, ctx));
      } catch (e) {
        throw new Error("code node " + n.id + " failed: " + e.message);
      }
      const kept = {};
      for (const r of d.response_json || []) if (res && r.name in res) kept[r.name] = clone(res[r.name] === undefined ? null : res[r.name]);
      this.record(n, ctx, kept);
      return;
    }
    return super.node(n, ctx);
  }
}

// ------------------------------------------------------------------------------------------------ guard SQL mocks
// Each mock reads the SQL text the node ACTUALLY ran (placeholders filled by the engine), checks every value that reached it
// is digits, and answers what MySQL would from `state.sa` (the stock_adjustment rows: id, tenant_id, status, sc, is_deleted).
const sqlTemplate = (wf, id) => {
  let hit = null;
  const walk = (x) => {
    if (x && typeof x === "object") {
      if (x.id === id) hit = x;
      Object.values(x).forEach(walk);
    }
  };
  walk(JSON.parse(fs.readFileSync(BUILT[wf], "utf8")));
  return hit.data.script.code;
};
const SA_SQL = sqlTemplate("STOCK_ADJUSTMENT", "sql_node_SAguard");
const SC_SQL = sqlTemplate("STOCK_COUNT", "sql_node_SCguard");
const guardSql = (state) => ({
  sql_node_SAguard: (sql) => {
    state.sql.push(sql);
    const t = (sql.match(/g\.tenant_id = '([^']*)'/) || [])[1];
    const id = (sql.match(/g\.id = (\S+)/) || [])[1];
    if (!/^[0-9]+$/.test(t) || !/^[0-9]+$/.test(id)) throw new Error("a non-digit value reached sql_node_SAguard: " + sql);
    if (sql !== SA_SQL.replace("{{node:code_node_SAguard.data.tenantId}}", t).replace("{{node:code_node_SAguard.data.saId}}", id)) throw new Error("unexpected SQL " + sql);
    return state.sa.filter((r) => r.tenant_id === t && r.id === id && r.is_deleted === 0).map((r) => ({ stock_adjustment_status: r.stock_adjustment_status }));
  },
  sql_node_SCguard: (sql) => {
    state.sql.push(sql);
    const t = (sql.match(/g\.tenant_id = '([^']*)'/) || [])[1];
    const sc = (sql.match(/g\.stock_count_id = (\S+)/) || [])[1];
    const pos = (sql.match(/AND (\S+) > 0/) || [])[1];
    if (!/^[0-9]+$/.test(t) || !/^[0-9]+$/.test(sc) || pos !== sc) throw new Error("a non-digit value reached sql_node_SCguard: " + sql);
    if (sql !== SC_SQL.replace("{{node:code_node_SCguard.data.tenantId}}", t).split("{{node:code_node_SCguard.data.scId}}").join(sc)) throw new Error("unexpected SQL " + sql);
    const n = Number(sc) > 0 ? state.sa.filter((r) => r.tenant_id === t && r.stock_count_id === sc && r.stock_adjustment_status === "Processing" && r.is_deleted === 0).length : 0;
    return [{ busy_count: n }];
  },
});
const row = (o) => Object.assign({ id: SA_ID, tenant_id: T, stock_adjustment_status: "Draft", stock_count_id: null, is_deleted: 0 }, o);

// one guard scenario, both injection modes; returns the JSON-mode result (the two must agree)
function scenario(wf, req, rows, opt) {
  const o = opt || {};
  const results = [];
  for (const mode of ["json", "ref"]) {
    const state = { sa: rows || [], sql: [] };
    const r0 = clone(req);
    const params = mode === "ref" ? deepFreeze(clone(req)) : clone(req);
    const e = new GuardEngine({ files: BUILT, db: { tenantId: o.tenant === undefined ? T : o.tenant }, sql: guardSql(state), stopAt: ANCHOR[wf], inject: mode,
      strictGuard: mode === "ref" ? GUARD[wf] : [] });
    let r;
    try {
      r = e.run(wf, params);
    } catch (err) {
      r = { returned: { crashed: err.message }, ctx: { out: {} } };
    }
    results.push({ mode, returned: r.returned, out: r.ctx.out, trace: e.trace.map((x) => x.split(" ")[1]), sql: state.sql, params: r.ctx.params, before: r0 });
  }
  const [a, b] = results;
  const same = JSON.stringify([a.returned, a.trace, a.sql, a.out]) === JSON.stringify([b.returned, b.trace, b.sql, b.out]);
  if (!same) {
    console.log("     json:", JSON.stringify([a.returned, a.trace, a.out]).slice(0, 600));
    console.log("     ref :", JSON.stringify([b.returned, b.trace, b.out]).slice(0, 600));
  }
  a.modesAgree = same;
  return a;
}
const reached = (wf) => ({ reached: ANCHOR[wf] });
const refusedSA = (msg) => ({ code: "400", message: msg });
const refusedSC = (msg) => ({ envelope: { code: 400, success: false, data: null, msg: msg } });

function check(label, wf, req, rows, want, opt) {
  const r = scenario(wf, req, rows, opt);
  eq(label, r.returned, want);
  truthy(label + " - json / by-reference injection agree, request untouched", r.modesAgree && JSON.stringify(r.params) === JSON.stringify(r.before), r.returned);
  return r;
}

// ------------------------------------------------------------------------------------------------ SA payloads
// an entry as the SA dialog stores it (balance row copy + movement); ~330 bytes of JSON
const entry = (q, mt, extra) =>
  Object.assign({ balance_id: "2105231525751984129", material_id: MAT, plant_id: PLANT, location_id: LOC, batch_id: null, balance_quantity: "120.000", unrestricted_qty: "120.000",
    block_qty: "0.000", reserved_qty: "0.000", category: "Unrestricted", movement_type: mt || "In", sa_quantity: q, organization_id: ORG, tenant_id: T }, extra || {});
const entries = (n, q, mt) => Array.from({ length: n }, (_, i) => entry(q === undefined ? 1 : q, mt, { location_id: "21000000000000" + String(10000 + i) }));
const line = (ents, extra) => Object.assign({ material_id: MAT, uom_id: UOM, item_selection: MAT, total_quantity: "3", unit_price: "2.5", item_category: "Unrestricted",
  balance_index: typeof ents === "string" || Array.isArray(ents) && extra && extra.asArray ? ents : JSON.stringify(ents) }, extra && !extra.asArray ? extra : {});
const saDoc = (lines, extra) => Object.assign({ id: SA_ID, page_status: "Edit", plant_id: PLANT, organization_id: ORG, adjustment_no: "SA/20261016/0001", adjustment_no_type: "1994006139209117700",
  adjustment_date: "2026-10-16 00:00:00", adjustment_type: "Write Off", stock_adjustment_status: "Draft", stock_count_id: null, adjusted_by: "admin",
  acc_integration_type: "No Accounting Integration", stock_adjustment: lines }, extra || {});
const saReq = (doc, saveAs, pageStatus) => ({ allData: doc, saveAs: saveAs, pageStatus: pageStatus === undefined ? "Edit" : pageStatus });
const threeLines = () => [line([entry(2, "In")]), line([entry(1, "Out", { location_id: LOC2 })], { material_id: MAT2, item_selection: MAT2 }), line([entry(4, "In"), entry(1, "Out")])];
// n entries in lines of at most 50 (no line near the byte limit)
const manyLines = (n, q) => {
  const out = [];
  for (let left = n; left > 0; left -= 50) out.push(line(entries(Math.min(50, left), q)));
  return out;
};
// a balance_index TEXT of exactly `bytes` UTF-8 bytes (one entry; a remark of `pad` chars of `w` UTF-8 bytes, ASCII-topped)
const sizedIndex = (bytes, pad, w) => {
  const base = JSON.stringify([entry(1, "In", { remark: "" })]);
  const need = bytes - Buffer.byteLength(base, "utf8");
  const k = Math.floor(need / (w || 1));
  const t = JSON.stringify([entry(1, "In", { remark: (pad || "x").repeat(k) + "x".repeat(need - k * (w || 1)) })]);
  if (need < 0 || Buffer.byteLength(t, "utf8") !== bytes) throw new Error("cannot size " + bytes);
  return t;
};
const sa = (label, req, rows, want, opt) => check("SA " + label, "STOCK_ADJUSTMENT", req, rows, want, opt);
const STOP = reached("STOCK_ADJUSTMENT");

console.log("== STOCK_ADJUSTMENT guard");
// 1. stored Processing
let r = sa("stored Processing, Completed -> SA_BUSY (return node, code \"400\")", saReq(saDoc(threeLines()), "Completed"), [row({ stock_adjustment_status: "Processing" })], refusedSA(TXT.SA_BUSY));
eq("SA   ... the refusal ran only the guard (the classic never started)", r.trace, ["code_node_SAguard", "sql_node_SAguard", "code_node_SAguardVerdict"]);
sa("stored Processing, saved as Draft -> SA_BUSY (the Draft branch would flip the status)", saReq(saDoc(threeLines()), "Draft"), [row({ stock_adjustment_status: "Processing" })], refusedSA(TXT.SA_BUSY));
sa("stored Processing + 600 entries -> SA_BUSY wins", saReq(saDoc(manyLines(600)), "Completed"), [row({ stock_adjustment_status: "Processing" })], refusedSA(TXT.SA_BUSY));
sa("payload says Draft, STORED Processing -> SA_BUSY (the stored status decides)", saReq(saDoc(threeLines(), { stock_adjustment_status: "Draft" }), "Completed"), [row({ stock_adjustment_status: "Processing" })], refusedSA(TXT.SA_BUSY));
sa("Processing row of ANOTHER tenant with the same id -> passes", saReq(saDoc(threeLines()), "Completed"), [row({ stock_adjustment_status: "Processing", tenant_id: "496474" })], STOP);
sa("Processing row soft-deleted -> passes", saReq(saDoc(threeLines()), "Completed"), [row({ stock_adjustment_status: "Processing", is_deleted: 1 })], STOP);
for (const st of ["Draft", "Completed", "Cancelled", "Fully Posted", null]) sa("stored " + st + " -> passes", saReq(saDoc(threeLines()), "Completed"), [row({ stock_adjustment_status: st })], STOP);

// 2. more than 500 entries, not Draft
sa("501 entries, Completed -> SA_CLASSIC_TOO_BIG", saReq(saDoc(manyLines(501)), "Completed"), [row({})], refusedSA(fill(TXT.SA_TOO_BIG, 501)));
sa("500 entries, Completed -> passes", saReq(saDoc(manyLines(500)), "Completed"), [row({})], STOP);
sa("2,000 entries, Completed -> SA_CLASSIC_TOO_BIG", saReq(saDoc(manyLines(2000)), "Completed"), [row({})], refusedSA(fill(TXT.SA_TOO_BIG, 2000)));
const mixed = manyLines(500).concat([line([0, "0", -1, null, "abc", "", "0.000"].map((q) => entry(q))), line([entry("2"), entry("0.5")])]);
sa("500 + 2 counted (\"2\", \"0.5\"), 7 not (0, \"0\", -1, null, \"abc\", \"\", \"0.000\") -> 502 -> refused", saReq(saDoc(mixed), "Completed"), [row({})], refusedSA(fill(TXT.SA_TOO_BIG, 502)));
const mixed2 = manyLines(500).concat([line([0, "0", -1, null, "abc", "", "0.000"].map((q) => entry(q)))]);
sa("500 + 7 entries without a positive sa_quantity -> 500 -> passes", saReq(saDoc(mixed2), "Completed"), [row({})], STOP);
sa("501 entries, saveAs missing (not Draft: the classic completes) -> refused", { allData: saDoc(manyLines(501)), pageStatus: "Edit" }, [row({})], refusedSA(fill(TXT.SA_TOO_BIG, 501)));
sa("501 entries, a new Add Completed -> refused", saReq(saDoc(manyLines(501), { id: undefined, page_status: "Add" }), "Completed", "Add"), [], refusedSA(fill(TXT.SA_TOO_BIG, 501)));
sa("501 entries, Completed & Post's call shape (pageStatus = page_status) -> refused", saReq(saDoc(manyLines(501)), "Completed", "Edit"), [row({})], refusedSA(fill(TXT.SA_TOO_BIG, 501)));

// 3. Draft is exempt from the cap
sa("501 entries saved as Draft -> passes", saReq(saDoc(manyLines(501)), "Draft"), [row({})], STOP);
sa("2,000 entries saved as Draft (Add) -> passes", saReq(saDoc(manyLines(2000), { id: undefined }), "Draft", "Add"), [], STOP);

// 4. a balance_index over 60,000 UTF-8 bytes (every saveAs)
const big = (bytes, pad, w) => saReq(saDoc([line([entry(1)]), line(sizedIndex(bytes, pad, w)), line([entry(1)])]), "Completed");
sa("line 2 balance_index 60,001 bytes -> SA_LINE_TOO_LARGE", big(60001), [row({})], refusedSA(fill(TXT.LINE, 2, 60001)));
sa("line 2 balance_index 60,000 bytes -> passes", big(60000), [row({})], STOP);
const d3 = big(60003);
d3.saveAs = "Draft";
sa("Draft with a 60,003-byte line -> refused too (the Draft write would truncate it)", d3, [row({})], refusedSA(fill(TXT.LINE, 2, 60003)));
sa("multi-byte: 60,003 UTF-8 bytes in fewer JS chars (3-byte pad) -> refused with the BYTE count", big(60003, "库", 3), [row({})], refusedSA(fill(TXT.LINE, 2, 60003)));
sa("multi-byte: 59,999 UTF-8 bytes (3-byte pad) -> passes", big(59999, "库", 3), [row({})], STOP);
const arr = saReq(saDoc([line([entry(1)]), line(JSON.parse(sizedIndex(61000)), { asArray: true })]), "Completed");
sa("balance_index sent as an ARRAY of 61,000 bytes -> refused (measured as its JSON text)", arr, [row({})], refusedSA(fill(TXT.LINE, 2, 61000)));
const both = saReq(saDoc(manyLines(501).concat([line(sizedIndex(60001))])), "Completed");
sa("501 entries AND a too-large line, Completed -> the entry cap is reported first", both, [row({})], refusedSA(fill(TXT.SA_TOO_BIG, 502)));
both.saveAs = "Draft";
sa("the same saved as Draft -> the too-large line", both, [row({})], refusedSA(fill(TXT.LINE, 12, 60001)));
sa("an unparseable 70,000-byte balance_index -> refused (0 entries, still too large)", saReq(saDoc([line("x".repeat(70000))]), "Completed"), [row({})], refusedSA(fill(TXT.LINE, 1, 70000)));

// 5. a new Add: no stored read hits a row
r = sa("a new Add (no id) -> passes", saReq(saDoc(threeLines(), { id: undefined, page_status: "Add" }), "Completed", "Add"), [row({ id: "0", stock_adjustment_status: "Processing" })], STOP);
truthy("SA   ... its stored read used id 0 (no row)", r.sql.length === 1 && / g\.id = 0\n/.test(r.sql[0]), r.sql);
sa("a Clone (id \"\") -> passes", saReq(saDoc(threeLines(), { id: "" }), "Completed", "Clone"), [], STOP);

// 6. a normal 3-line Completed
const normal = saReq(saDoc(threeLines()), "Completed");
r = sa("normal 3-line Completed (stored Draft) -> reaches code_node_O4tWJ5JH", normal, [row({})], STOP);
eq("SA   ... with allData / saveAs / pageStatus exactly as sent", r.params, normal);
eq("SA   ... guard outputs", [r.out.code_node_SAguard, r.out.code_node_SAguardVerdict], [{ saId: SA_ID, tenantId: T, entries: "4", reason: "", message: "" }, { refuse: "NO", reason: "", message: "" }]);
truthy("SA   ... the stored read was tenant + id scoped", r.sql.length === 1 && r.sql[0].includes("g.tenant_id = '" + T + "'") && r.sql[0].includes("g.id = " + SA_ID), r.sql);

// 7. odd shapes never crash (pass through to the classic, which fails or not exactly as before)
const odd = [
  ["allData missing", { saveAs: "Completed", pageStatus: "Edit" }],
  ["allData null", saReq(null, "Completed")],
  ["allData an array", saReq([1, 2], "Completed")],
  ["allData a number", saReq(5, "Completed")],
  ["stock_adjustment missing", saReq(saDoc(undefined), "Completed")],
  ["stock_adjustment an object", saReq(saDoc({ a: 1 }), "Completed")],
  ["stock_adjustment a string", saReq(saDoc("x"), "Completed")],
  ["lines null / number / string", saReq(saDoc([null, 3, "x", line([entry(1)])]), "Completed")],
  ["balance_index invalid JSON / empty / null / object / number / [null]", saReq(saDoc(["{bad", "", null, { a: 1 }, 7, "[null]"].map((b) => Object.assign(line([]), { balance_index: b }))), "Completed")],
  ["entries null / strings / arrays", saReq(saDoc([line([null, "x", [1], entry(1)])]), "Completed")],
  ["sa_quantity an object", saReq(saDoc([line([entry({ v: 1 })])]), "Completed")],
  ["pageStatus an object", saReq(saDoc(threeLines()), "Completed", { id: "1", name: "Edit" })],
];
for (const [label, req] of odd) sa("odd shape: " + label + " -> passes", req, [row({ stock_adjustment_status: "Processing", id: "0" })], STOP);
for (const [label, id] of [["id \"abc\"", "abc"], ["id with SQL text", "1 OR 1=1"], ["id -1", "-1"], ["id 21 digits", "123456789012345678901"], ["id 1.5", 1.5], ["id an unsafe 19-digit NUMBER", 2110229114286899201]]) {
  r = sa("odd id: " + label + " -> no stored read hits a row, passes", saReq(saDoc(threeLines(), { id: id }), "Completed"), [row({ stock_adjustment_status: "Processing" })], STOP);
  truthy("SA   ... " + label + ": the SQL got id 0", / g\.id = 0\n/.test(r.sql[0] || ""), r.sql);
}
sa("id a safe NUMBER -> used (stored Processing refused)", saReq(saDoc(threeLines(), { id: 2110229 }), "Completed"), [row({ id: "2110229", stock_adjustment_status: "Processing" })], refusedSA(TXT.SA_BUSY));
sa("allData as JSON TEXT with the id -> parsed: stored Processing refused", saReq(JSON.stringify(saDoc(threeLines())), "Completed"), [row({ stock_adjustment_status: "Processing" })], refusedSA(TXT.SA_BUSY));
sa("no session tenant -> no stored read hits a row (fail open), passes", saReq(saDoc(threeLines()), "Completed"), [row({ stock_adjustment_status: "Processing", tenant_id: "0" }), row({ stock_adjustment_status: "Processing" })], STOP, { tenant: "" });

// ------------------------------------------------------------------------------------------------ STOCK_COUNT
const scLine = (i, extra) => Object.assign({ id: "2111000000000" + String(100000 + i), material_id: MAT, location_id: LOC, plant_id: PLANT, uom_id: UOM, base_uom_id: UOM, batch_id: null,
  system_qty: 10, count_qty: 12, variance_qty: 2, adjusted_qty: null, is_counted: 1, line_status: "Approved", review_status: "Approved", item_category: "Unrestricted" }, extra || {});
const scLines = (n, extra) => Array.from({ length: n }, (_, i) => scLine(i, extra));
const scDoc = (lines, extra) => Object.assign({ id: SC_ID, page_status: "Edit", plant_id: PLANT, organization_id: ORG, stock_count_no: "SC/20261016/0001", stock_count_status: "Completed",
  count_type: "Full Count", review_status: "To Be Reviewed", table_stock_count: lines }, extra || {});
const scReq = (doc, saveAs, pageStatus, flag) => ({ allData: doc, saveAs: saveAs, pageStatus: pageStatus === undefined ? "Edit" : pageStatus, organizationId: ORG, nickname: "admin",
  adjustmentDate: "2026-10-16", proceedReview: "", createAdjustment: flag !== undefined ? flag : saveAs === "Review" ? "Yes" : "" });
const saRow = (o) => row(Object.assign({ stock_count_id: SC_ID, stock_adjustment_status: "Processing" }, o));
const sc = (label, req, rows, want, opt) => check("SC " + label, "STOCK_COUNT", req, rows, want, opt);
const PASS = reached("STOCK_COUNT");

console.log("== STOCK_COUNT guard");
for (const saveAs of ["Stock Count", "Issued", "Draft", "Review", "", "Something else"]) {
  r = sc("a Processing SA of this SC, saveAs \"" + saveAs + "\" -> SA_SC_BUSY (end node 400)", scReq(scDoc(scLines(3)), saveAs), [saRow({})], refusedSC(TXT.SA_SC_BUSY));
}
eq("SC   ... the refusal ran only the guard (the classic never started)", r.trace, ["code_node_SCguard", "sql_node_SCguard", "code_node_SCguardVerdict", "end_SCguardRefuse"]);
sc("busy + a Review of 600 approved variance lines -> SA_SC_BUSY wins", scReq(scDoc(scLines(600)), "Review"), [saRow({})], refusedSC(TXT.SA_SC_BUSY));
sc("two Processing SAs of this SC -> SA_SC_BUSY", scReq(scDoc(scLines(3)), "Stock Count"), [saRow({}), saRow({ id: "2110229114286899202" })], refusedSC(TXT.SA_SC_BUSY));
sc("a Processing SA of ANOTHER SC -> passes", scReq(scDoc(scLines(3)), "Review"), [saRow({ stock_count_id: "2110229071278505986" })], PASS);
sc("a Processing SA of this SC in ANOTHER tenant -> passes", scReq(scDoc(scLines(3)), "Review"), [saRow({ tenant_id: "496474" })], PASS);
sc("a soft-deleted Processing SA -> passes", scReq(scDoc(scLines(3)), "Review"), [saRow({ is_deleted: 1 })], PASS);
for (const st of ["Draft", "Completed", "Cancelled"]) sc("an SA of this SC that is " + st + " -> passes", scReq(scDoc(scLines(3)), "Review"), [saRow({ stock_adjustment_status: st })], PASS);

// the cap holds only when the classic would build an SA (code_review_prep's doProcess; CONTRACT §11 ruling 2026-10-16)
const pending = () => scLine(3000, { line_status: "Pending", review_status: null });
sc("Review, 501 approved variance lines, all approved -> SA_CLASSIC_TOO_BIG", scReq(scDoc(scLines(501)), "Review"), [], refusedSC(fill(TXT.SC_TOO_BIG, 501)));
sc("Review, 500 approved variance lines, all approved -> passes", scReq(scDoc(scLines(500)), "Review"), [], PASS);
sc("Review, 501 + a pending line, createAdjustment \"\" -> passes (no SA built)", scReq(scDoc(scLines(501).concat([pending()])), "Review", "Edit", ""), [], PASS);
sc("Review, 501 + a pending line, createAdjustment \"Yes\" -> refused", scReq(scDoc(scLines(501).concat([pending()])), "Review", "Edit", "Yes"), [], refusedSC(fill(TXT.SC_TOO_BIG, 501)));
sc("Review, 501, all approved, no flag -> refused (allApproved builds the SA)", scReq(scDoc(scLines(501)), "Review", "Edit", ""), [], refusedSC(fill(TXT.SC_TOO_BIG, 501)));
sc("Review, 501 + an Adjusted + a Cancel line, no flag -> refused (Cancel dropped, Adjusted counts as approved)",
  scReq(scDoc(scLines(501).concat([scLine(3100, { line_status: "Adjusted" }), scLine(3101, { line_status: "Cancel", review_status: null })])), "Review", "Edit", ""), [],
  refusedSC(fill(TXT.SC_TOO_BIG, 501)));
sc("Review, 501 + a Recount line, no flag -> passes (not all approved)", scReq(scDoc(scLines(501).concat([scLine(3200, { line_status: "Recount" })])), "Review", "Edit", ""), [], PASS);
sc("Review, 501 + a pending line, createAdjustment \"yes\" -> passes (only \"Yes\", as the classic)", scReq(scDoc(scLines(501).concat([pending()])), "Review", "Edit", "yes"), [], PASS);
sc("Review, 600 lines not review-approved (no approvedItems), \"Yes\" -> passes", scReq(scDoc(scLines(600, { review_status: "Pending" })), "Review", "Edit", "Yes"), [], PASS);
sc("Review, 600 review-approved lines already Adjusted (no approvedItems), \"Yes\" -> passes", scReq(scDoc(scLines(600, { line_status: "Adjusted" })), "Review", "Edit", "Yes"), [], PASS);
const notCounted = [{ review_status: "Pending" }, { review_status: "" }, { line_status: "Adjusted" }, { line_status: "Recount" }, { line_status: "Cancel" }, { line_status: "Pending" },
  { variance_qty: 0 }, { variance_qty: -0 }].map((x, i) => scLine(1000 + i, x));
sc("500 + 8 lines outside itemsWithVariance (status / numeric 0), \"Yes\" -> passes", scReq(scDoc(scLines(500).concat(notCounted)), "Review"), [], PASS);
const counted = [{ variance_qty: "-2.5" }, { variance_qty: 3 }, { variance_qty: null }, { variance_qty: undefined }, { variance_qty: "" }, { variance_qty: "0" }, { variance_qty: "0.000" }]
  .map((x, i) => scLine(2000 + i, x));
sc("494 + 7 counted by the classic's strict variance_qty !== 0 (\"-2.5\", 3, null, missing, \"\", \"0\", \"0.000\") -> 501 -> refused",
  scReq(scDoc(scLines(494).concat(counted)), "Review"), [], refusedSC(fill(TXT.SC_TOO_BIG, 501)));
sc("600 approved variance lines saved as \"Stock Count\" -> passes (the cap is the Review's)", scReq(scDoc(scLines(600)), "Stock Count"), [], PASS);
sc("600 approved variance lines saved as Issued / Draft -> passes", scReq(scDoc(scLines(600)), "Issued"), [], PASS);
sc("a Review of 600 on a new SC (no id) -> refused", scReq(scDoc(scLines(600), { id: undefined }), "Review", "Add"), [], refusedSC(fill(TXT.SC_TOO_BIG, 600)));

// mobile: pageStatus an OBJECT, saveAs "Stock Count", empty flags, NULLed item_list / stock_count_no_type, no org / nickname / date
const mobile = (rows) => ({ allData: scDoc(scLines(50, { is_counted: 1, review_status: null, line_status: null }), { stock_count_status: "In Progress", item_list: null, stock_count_no_type: null }),
  pageStatus: { id: "1970062686583369729", name: "In Progress" }, saveAs: "Stock Count", proceedReview: "", createAdjustment: "" });
r = sc("mobile-shaped Stock Count save -> passes to cond_save_as", mobile(), [], PASS);
eq("SC   ... with every param exactly as sent (pageStatus object included)", r.params, mobile());
eq("SC   ... guard outputs", [r.out.code_node_SCguard, r.out.code_node_SCguardVerdict], [{ scId: SC_ID, tenantId: T, reviewLines: "0", buildsSa: "NO", reason: "", message: "" }, { refuse: "NO", reason: "", message: "" }]);
sc("mobile-shaped Stock Count save while an SA of it is Processing -> envelope code 400 + msg (what normalizeWorkflowResult shows)", mobile(), [saRow({})], refusedSC(TXT.SA_SC_BUSY));
r = sc("a new SC (no id) -> passes", scReq(scDoc(scLines(3), { id: undefined, page_status: "Add" }), "Draft", "Add"), [saRow({ stock_count_id: "0" })], PASS);
truthy("SC   ... its read used stock_count_id 0 AND 0 > 0 (no table access)", r.sql.length === 1 && /g\.stock_count_id = 0\n\s+AND 0 > 0\n/.test(r.sql[0]), r.sql);

const scOdd = [
  ["allData missing", { saveAs: "Stock Count", pageStatus: "Edit" }],
  ["allData null", scReq(null, "Review")],
  ["allData an array", scReq([1], "Review")],
  ["table_stock_count missing", scReq(scDoc(undefined), "Review")],
  ["table_stock_count null", scReq(scDoc(null), "Review")],
  ["table_stock_count an object", scReq(scDoc({ a: 1 }), "Review")],
  ["table_stock_count a string", scReq(scDoc("x"), "Review")],
  ["lines null / number / string / array", scReq(scDoc([null, 1, "x", [scLine(1)], scLine(2)]), "Review")],
  ["variance_qty an object / array", scReq(scDoc([scLine(1, { variance_qty: { a: 1 } }), scLine(2, { variance_qty: [2] })]), "Review")],
  ["saveAs null", scReq(scDoc(scLines(3)), null)],
  ["saveAs an object", scReq(scDoc(scLines(3)), { name: "Review" })],
];
for (const [label, req] of scOdd) sc("odd shape: " + label + " -> passes", req, [saRow({ stock_count_id: "0" })], PASS);
for (const [label, id] of [["id \"abc\"", "abc"], ["id with SQL text", "1) OR (1=1"], ["id 21 digits", "123456789012345678901"], ["id an unsafe 19-digit NUMBER", 2110229071278505985]]) {
  r = sc("odd id: " + label + " -> no read hits a row, passes", scReq(scDoc(scLines(3), { id: id }), "Stock Count"), [saRow({})], PASS);
  truthy("SC   ... " + label + ": the SQL got 0", /g\.stock_count_id = 0\n/.test(r.sql[0] || ""), r.sql);
}
sc("allData as JSON TEXT -> parsed: busy refused", scReq(JSON.stringify(scDoc(scLines(3))), "Stock Count"), [saRow({})], refusedSC(TXT.SA_SC_BUSY));

// ------------------------------------------------------------------------------------------------ parity to the END
// the same pass-through request through the base and through the guarded file (by-reference injection, a fixed clock):
// same answer, same writes, same callee calls, same trace minus the guard nodes
class MemDB {
  constructor() {
    this.tenantId = T;
    this.log = [];
    this.seq = 0;
  }
  insert(table, rows) {
    const out = rows.map((r0) => {
      const x = Object.assign({}, r0);
      delete x.__id;
      x.id = "29" + String(++this.seq).padStart(17, "0");
      return x;
    });
    this.log.push(["insert", table, clone(out)]);
    return out;
  }
  update(table, rows) {
    this.log.push(["update", table, clone(rows)]);
    return { count: rows.length };
  }
}
const RealDate = Date;
const fixedClock = (fn) => {
  const at = RealDate.UTC(2026, 9, 16, 4, 0, 0);
  global.Date = class extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(at);
    }
    static now() {
      return at;
    }
  };
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
};
const STUBS = {
  SUBTRACT_INVENTORY: () => ({ code: "200", message: "ok" }),
  ADD_INVENTORY: () => ({ code: "200", message: "ok" }),
  REORDER_SET_REDIS: () => ({ code: "200" }),
};
function parity(label, wf, req, read, sql) {
  const runs = [BASE[wf], BUILT[wf]].map((file) => fixedClock(() => {
    const db = new MemDB();
    const state = { sa: [], sql: [] };
    const e = new GuardEngine({ files: { [wf]: file, CHECK_REQUIRED_FIELD: CHECK }, db: db, sql: Object.assign(guardSql(state), sql || {}), read: read || {}, stubs: STUBS, inject: "ref" });
    let res;
    try {
      res = e.run(wf, clone(req)).returned;
    } catch (err) {
      res = { crashed: err.message };
    }
    return { res, writes: db.log, calls: e.calls, trace: e.trace.map((x) => x.split(" ")[1]).filter((id) => GUARD[wf].indexOf(id) < 0), guard: e.trace.map((x) => x.split(" ")[1]).filter((id) => GUARD[wf].indexOf(id) >= 0) };
  }));
  const [b, g] = runs;
  truthy("PARITY " + wf + " " + label + ": answer / writes / calls / trace identical (" + b.trace.length + " nodes, " + b.writes.length + " writes, " + b.calls.length + " calls)",
    !b.res.crashed && JSON.stringify([b.res, b.writes, b.calls, b.trace]) === JSON.stringify([g.res, g.writes, g.calls, g.trace]), [b.res, g.res]);
  eq("PARITY " + wf + " " + label + ": the guarded run passed its 3 guard nodes first", g.guard, GUARD[wf].slice(0, 3));
  return b;
}
console.log("== parity: pass-through requests to the end, base vs guarded");
const storedSA = (doc) => ({ count: 1, data: Object.assign(clone(doc), { stock_adjustment_status: "Draft" }) });
const items = () => ({ count: 2, data: [{ id: MAT, material_code: "FG-1", material_name: "Item A" }, { id: MAT2, material_code: "FG-2", material_name: "Item B" }] });
const scStored = () => ({ count: 1, data: { id: SC_ID, table_stock_count: [{ id: "1", line_status: "Adjusted" }, { id: "2", line_status: "Approved" }] } });
let p = parity("Completed, Edit, 3 lines In/Out", "STOCK_ADJUSTMENT", saReq(saDoc(threeLines()), "Completed"), { get_node_Rs3nGg9f: () => storedSA(saDoc(threeLines())), search_node_SAItems: items });
eq("PARITY ... (sanity) the classic moved the 4 entries and answered 200", [p.calls.filter((c) => c[1] !== "REORDER_SET_REDIS").length, p.res.code], [4, "200"]);
parity("Completed, Add, with a stock_count_id", "STOCK_ADJUSTMENT", saReq(saDoc(threeLines(), { id: undefined, page_status: "Add", stock_count_id: SC_ID, adjustment_type: "Stock Count" }), "Completed", "Add"),
  { search_node_SAItems: items, get_node_jN1E0Ycx: scStored });
parity("Completed, Edit, 500 entries", "STOCK_ADJUSTMENT", saReq(saDoc(manyLines(500)), "Completed"), { get_node_Rs3nGg9f: () => storedSA(saDoc(manyLines(500))), search_node_SAItems: items });
parity("Draft, Edit, 501 entries", "STOCK_ADJUSTMENT", saReq(saDoc(manyLines(501)), "Draft"));
parity("Draft, Add", "STOCK_ADJUSTMENT", saReq(saDoc(threeLines(), { id: undefined }), "Draft", "Add"));
parity("Completed, Edit, required field missing (the classic's own 400)", "STOCK_ADJUSTMENT", saReq(saDoc(threeLines(), { adjustment_date: "" }), "Completed"));
p = parity("Completed, an invalid movement type (the classic's own 400)", "STOCK_ADJUSTMENT", saReq(saDoc([line([entry(1, "Sideways")])]), "Completed"),
  { get_node_Rs3nGg9f: () => storedSA(saDoc([line([entry(1, "Sideways")])])), search_node_SAItems: items });
eq("PARITY ... (sanity) the classic's own refusal", p.res, { code: "400", message: "Invalid Movement Type" });

const scStoredRead = () => ({ count: 1, data: { id: SC_ID, stock_count_no: "SC/20261016/0001" } });
parity("Draft, Edit", "STOCK_COUNT", scReq(scDoc(scLines(3)), "Draft"), { get_node_sc: scStoredRead });
p = parity("Draft, Edit, Count Type missing (the classic's own 406)", "STOCK_COUNT", scReq(scDoc(scLines(3), { count_type: "" }), "Draft"), { get_node_sc: scStoredRead });
eq("PARITY ... (sanity) the classic's own refusal", p.res, { envelope: { code: 406, success: false, data: null, msg: "Validation Error: Count Type" } });
parity("Issued, Add", "STOCK_COUNT", scReq(scDoc(scLines(3), { id: undefined, page_status: "Add" }), "Issued", "Add"));
p = parity("mobile Stock Count (pageStatus object)", "STOCK_COUNT", mobile(), { get_node_sc: scStoredRead });
eq("PARITY ... (sanity) the classic answered the stored SC", p.res.envelope && p.res.envelope.data.id, SC_ID);
p = parity("Review, 501 approved variance lines + a pending line, createAdjustment \"\" (no SA: the guard passes it)", "STOCK_COUNT",
  scReq(scDoc(scLines(501).concat([pending()])), "Review", "Edit", ""), { get_node_sc: scStoredRead });
truthy("PARITY ... (sanity) no Stock Adjustment inserted, the Stock Count updated",
  !p.writes.some((w) => w[1] === "Stock Adjustment") && p.writes.some((w) => w[0] === "update" && w[1] === "Stock Count"), p.writes.map((w) => w[1]));
parity("Review, all approved, no variance (no SA built)", "STOCK_COUNT", scReq(scDoc(scLines(3, { variance_qty: 0 })), "Review"), { get_node_sc: scStoredRead });
const reviewReads = {
  search_item: () => ({ data: [{ id: MAT, material_name: "Item A", item_batch_management: 0, material_costing_method: "Weighted Average", purchase_unit_price: "2.5" }] }),
  search_item_balance: () => ({ data: Array.from({ length: 500 }, (_, i) => ({ id: "2105" + String(i).padStart(15, "0"), material_id: MAT, location_id: "21000000000000" + String(10000 + i),
    plant_id: PLANT, unrestricted_qty: "100", balance_quantity: "100", is_deleted: 0 })) }),
  search_item_batch_balance: () => ({ data: [] }),
  search_bin_location: () => ({ data: [] }),
  search_uom: () => ({ data: [{ id: UOM, uom_name: "PCS" }] }),
  search_batch: () => ({ data: [] }),
  get_sa_prefix: () => ({ data: { id: "1994006139209117700" } }),
  get_node_sc: scStoredRead,
};
const reviewDoc = scDoc(scLines(500).map((l, i) => Object.assign(l, { location_id: "21000000000000" + String(10000 + i), variance_qty: i % 2 ? 2 : -1 })));
p = parity("Review, 500 approved variance lines (the classic builds its SA)", "STOCK_COUNT", scReq(reviewDoc, "Review"), reviewReads, { sql_review_costs: () => [] });
truthy("PARITY ... (sanity) the classic Review inserted one SA of 500 entries", (() => {
  const add = p.writes.find((w) => w[0] === "insert" && w[1] === "Stock Adjustment");
  return add && add[2][0].stock_adjustment.reduce((s, l) => s + JSON.parse(l.balance_index).length, 0) === 500;
})(), p.writes.map((w) => w[1]));

// ------------------------------------------------------------------------------------------------ the base's own predicates
// the base's code_review_prep and the guard on the same Review payloads: buildsSa == (doProcess === 1) and reviewLines ==
// itemsWithVariance.length - named cases + a seeded fuzz of line_status / review_status / variance_qty / createAdjustment
console.log("== code_review_prep (base) vs code_node_SCguard: doProcess / itemsWithVariance");
let seed = 20261016;
const rnd = (arr) => arr[(seed = (seed * 1103515245 + 12345) % 2147483648) % arr.length];
const fuzzDoc = (n) => scDoc(Array.from({ length: n }, (_, i) => scLine(i, { line_status: rnd(["Approved", "Approved", "Approved", "Adjusted", "Cancel", "Recount", "Pending", null]),
  review_status: rnd(["Approved", "Approved", "Pending", null, ""]), variance_qty: rnd([0, -0, 2, -1.5, "-1.5", "0", "0.000", null, undefined, ""]) })));
const prepCases = [["all approved 501", scLines(501), ""], ["501 + pending", scLines(501).concat([pending()]), ""], ["501 + pending, Yes", scLines(501).concat([pending()]), "Yes"],
  ["501 + Adjusted + Cancel", scLines(501).concat([scLine(3100, { line_status: "Adjusted" }), scLine(3101, { line_status: "Cancel", review_status: null })]), ""],
  ["501 + Recount", scLines(501).concat([scLine(3200, { line_status: "Recount" })]), ""], ["501 + pending, yes", scLines(501).concat([pending()]), "yes"],
  ["600 not review-approved", scLines(600, { review_status: "Pending" }), "Yes"], ["600 Adjusted", scLines(600, { line_status: "Adjusted" }), "Yes"],
  ["500 + notCounted", scLines(500).concat(notCounted), "Yes"], ["494 + counted", scLines(494).concat(counted), "Yes"], ["empty table", [], "Yes"],
  ["only Cancel lines", scLines(5, { line_status: "Cancel" }), ""]].map(([l, lines, f]) => [l, scDoc(lines), f]);
for (let i = 0; i < 40; i++) prepCases.push(["fuzz " + i, fuzzDoc(1 + (i * 37) % 700), rnd(["", "Yes", "yes", null])]);
let prepSame = 0;
const prepDiff = [];
for (const [label, doc, flag] of prepCases) {
  const req = scReq(doc, "Review", "Edit", flag);
  const base = new GuardEngine({ files: { STOCK_COUNT: BASE.STOCK_COUNT }, db: new MemDB(), stopAt: "code_review_required", inject: "ref" }).run("STOCK_COUNT", clone(req));
  const prep = base.ctx.out.code_review_prep;
  const g = new GuardEngine({ files: BUILT, db: { tenantId: T }, sql: guardSql({ sa: [], sql: [] }), stopAt: "cond_save_as", inject: "ref" }).run("STOCK_COUNT", clone(req));
  const got = [g.ctx.out.code_node_SCguard.buildsSa, Number(g.ctx.out.code_node_SCguard.reviewLines)];
  const want = [prep.doProcess === 1 ? "YES" : "NO", prep.itemsWithVariance.length];
  if (JSON.stringify(got) === JSON.stringify(want)) prepSame++;
  else prepDiff.push([label, got, want]);
}
eq("PREP " + prepCases.length + " Review payloads: the guard's buildsSa / count == the base code_review_prep's doProcess / itemsWithVariance", prepDiff, []);
truthy("PREP ... the cases cover both answers and the 500 boundary", prepCases.length === prepSame && new Set(prepCases.map(([, doc, flag]) => {
  const r0 = new GuardEngine({ files: BUILT, db: { tenantId: T }, sql: guardSql({ sa: [], sql: [] }), stopAt: "cond_save_as", inject: "ref" }).run("STOCK_COUNT", scReq(doc, "Review", "Edit", flag));
  return r0.ctx.out.code_node_SCguard.buildsSa + (Number(r0.ctx.out.code_node_SCguard.reviewLines) > 500 ? ">500" : "<=500");
})).size === 4);

done();
