// node scratchpad/idav2/classic/test_guard_sim.js - runs the BUILT IDA_SAVE v7 (and base v6) through lib/sim's FlowGram interpreter: the
// guard's refusals answer before any write or callee, every other scenario runs node for node like v6 (same writes, same callee calls, same
// answer); the only difference on a completion is ADD_INVENTORY's unit_price on a non-base-UOM line (per base unit). Callees are stubs
// except CHECK_REQUIRED_FIELD (the real v8 JSON).
const fs = require("fs");
const path = require("path");
const IDAV2 = path.join(__dirname, "..");
const { Engine } = require(path.join(IDAV2, "lib", "sim", "engine.js"));
// IDA_SAVE_BUILT points the sim at another build (classic/mutants_v7.py)
const V7 = process.env.IDA_SAVE_BUILT || path.join(IDAV2, "..", "..", "Item Disassembly", "AsyncV2", "IDA_SAVE.json");
const V6 = path.join(IDAV2, "base", "IDA_SAVE.v6.json");
const GUARD = new Set(["code_node_IDAguardIn", "sql_node_IDAguard", "code_node_IDAguardStored"]);
const T = "000000";
const IDA = "2112073133161844738";
const SRC = "2105489115887079441";
const COMP = "2107721546371891202";
const COMP2 = "2107721718380298242";
const BIN = "2018912822846582786";
const RBIN = "2018912822846582999";
const SLOC = "2018912759311265793";
const UOM = "2018906563477008392";
const ALT = "2018906563477008777";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + String(JSON.stringify(got)).slice(0, 700) + "\n  want " + String(JSON.stringify(want)).slice(0, 700));
  }
};

class Sim extends Engine {
  constructor(file, sc) {
    const writes = [];
    const calls = [];
    const sql = [];
    const db = {
      tenantId: T,
      insert: (table, rows) => rows.map((r0, i) => {
        const r = Object.assign({}, r0, { id: String(3000000000000000001n + BigInt(writes.length + i)) });
        if (r.stock_movement_no === "issued") r.stock_movement_no = "IDA-0001";
        if (r.stock_movement_no === "draft") r.stock_movement_no = "Draft-0001";
        writes.push(["insert", table, r]);
        return r;
      }),
      update: (table, rows) => {
        for (const r of rows) writes.push(["update", table, r]);
        return { count: rows.length };
      },
    };
    const stored = () => ({ id: IDA, item_disassembly_status: sc.stored, stock_movement_no: "IDA-0009", stock_movement: [] });
    super({
      dir: path.dirname(file), db,
      mocks: {
        sql: {
          sql_node_IDAguard: (text) => {
            sql.push(text);
            if (!/h\.tenant_id = '000000'/.test(text) || !new RegExp("h\\.id = " + IDA + "\\b").test(text)) throw new Error("guard SQL not filled: " + text);
            return sc.stored === null ? [] : [{ ida_id: IDA, item_disassembly_status: sc.stored }];
          },
        },
        read: {
          search_items: () => ({ total: sc.items.length, count: sc.items.length, data: sc.items }),
          search_batches: () => ({ total: 0, count: 0, data: [] }),
          get_persisted_ida: () => ({ count: 1, data: stored() }),
          get_ida: () => ({ count: 1, data: stored() }),
          search_movements: () => ({ total: 1, count: 1, data: [{ total_price: 12, movement: "OUT" }] }),
        },
      },
    });
    this.file = file;
    this.sc = sc;
    this.writes = writes;
    this.calls = calls;
    this.sqls = sql;
  }

  load(name) {
    if (name === "IDA_SAVE") return JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (name === "CHECK_REQUIRED_FIELD") return JSON.parse(fs.readFileSync(path.join(IDAV2, "base", "CHECK_REQUIRED_FIELD.v8.json"), "utf8"));
    throw new Error("no workflow " + name);
  }

  run(name, params) {
    const fail = this.sc && this.sc.fail === name;
    const stub = fail ? { code: "400", message: "Insufficient stock for item FG (Unrestricted). Available: 0, Requested: 1", errorMessage: "Insufficient quantity" } : {
      GLOBAL_INVENTORY_VALIDATION: { code: "200", message: "Sufficient stock" }, SUBTRACT_INVENTORY: { code: "200" },
      ADD_INVENTORY: { code: "200" }, GENERATE_BATCH: { batch_number: "Batch-00631" }, HANDLING_UNIT: { code: "200" } }[name];
    if (fail && !stub) throw new Error("no stub " + name);
    if (stub) {
      this.calls.push([name, JSON.parse(JSON.stringify(params))]);
      return { returned: stub, ctx: null };
    }
    return super.run(name, params);
  }

  // the platform resolves a reference to a node that did not run to null
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? "null" : JSON.stringify(v);
    });
  }

  node(nd, ctx) {
    const d = nd.data || {};
    if (nd.type === "if" && d.condition_type === "ConditionRule") {
      const leaf = d.filter.list[0];
      const v = this.resolve(leaf.prop.replace(/^(workflowparams|node)\./, "$1:"), ctx);
      const ok = leaf.operator === "equal" ? String(v) === String(leaf.value) : leaf.operator === "notEqual" ? String(v) !== String(leaf.value) : null;
      if (ok === null) throw new Error("operator " + leaf.operator);
      this.trace.push(ctx.name + " " + nd.id);
      return this.block(nd.blocks[ok ? 0 : 1].blocks, ctx);
    }
    if (nd.type === "if") this.trace.push(ctx.name + " " + nd.id);
    return super.node(nd, ctx);
  }
}

const picks = (k) => JSON.stringify(Array.from({ length: k }, (_, i) => ({ material_id: SRC, location_id: BIN, batch_id: null, balance_id: String(9000 + i), sm_quantity: 1,
  category: "Unrestricted" })));
const line = (i, extra) => Object.assign({ item_selection: i % 2 ? COMP2 : COMP, item_name: "C" + i, item_desc: "", requested_qty: 1, bom_ratio: 1, total_quantity: 1,
  quantity_uom: UOM, storage_location_id: SLOC, location_id: RBIN, batch_number: "-", item_remark: "", project_id: "" }, extra || {});
// a record of nPicks source picks (1 each) and nLines recovery lines: moves = nPicks + nLines
const record = (page, nPicks, nLines, extra) => Object.assign({
  organization_id: "1123598813738675201", issuing_operation_faci: "1123598813738675202", stock_movement_no: "", stock_movement_no_type: "2107022471794724866",
  item_disassembly_status: page === "Add" ? "" : "Draft", item_id: SRC, item_code: "FG-0001", item_name: "FG", item_desc: "", item_qty: nPicks, item_uom: UOM,
  item_disassembly_date: "2026-10-21", issued_by: "sim", project_id: "", remarks: "", remarks_2: "", remarks_3: "", reference_documents: [], stock_summary: "",
  temp_qty_data: picks(nPicks), temp_hu_data: [], page_status: page, stock_movement: Array.from({ length: nLines }, (_, i) => line(i)),
}, page === "Add" ? {} : { id: IDA }, extra || {});
const item = (id, extra) => Object.assign({ id: id, material_code: "M" + id.slice(-4), stock_control: 1, serial_number_management: 0, item_batch_management: 0,
  batch_number_genaration: "", material_costing_method: "First In First Out", based_uom: UOM, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }, extra || {});
const ITEMS = [item(SRC), item(COMP), item(COMP2)];

function go(file, sc) {
  const e = new Sim(file, sc);
  const r = e.run("IDA_SAVE", { allData: sc.allData, saveAs: sc.saveAs, pageStatus: sc.pageStatus });
  const steps = e.trace.filter((t) => t.startsWith("IDA_SAVE ")).map((t) => t.slice(9));
  return { returned: r.returned, steps: steps, writes: e.writes, calls: e.calls, sqls: e.sqls };
}
const both = (sc) => ({ v6: go(V6, sc), v7: go(V7, sc) });
const noGuard = (steps) => steps.filter((s) => !GUARD.has(s) && !/^if_IDAguard/.test(s));
const stamp = (w) => JSON.parse(JSON.stringify(w).replace(/"last_transaction_date":"[^"]*"/g, '"last_transaction_date":"<now>"'));
const BUSY = "This Item Disassembly is being processed in the background - please wait for it to finish.";
const TOO_BIG = "This Item Disassembly has 251 source picks and recovery lines - too big for the classic save, which handles at most 250 at once. "
  + "Complete it from the web form with background completion switched on, or split it into smaller disassemblies.";
const sameAsV6 = (label, sc) => {
  const r = both(sc);
  eq(label + ": v7 answer == v6", r.v7.returned, r.v6.returned);
  eq(label + ": v7 steps minus the guard == v6 steps", noGuard(r.v7.steps), r.v6.steps);
  eq(label + ": v7 writes == v6 (item date stamp masked)", stamp(r.v7.writes), stamp(r.v6.writes));
  eq(label + ": v7 callee calls == v6", r.v7.calls, r.v6.calls);
  return r;
};
const refusedBeforeAnything = (label, res, code, message) => {
  eq(label + ": answer", res.returned, { code: code, message: message });
  eq(label + ": nothing written, no callee", [res.writes.length, res.calls.length], [0, 0]);
  eq(label + ": stopped inside the guard (no v6 node ran)", noGuard(res.steps), []);
};

// refusals
refusedBeforeAnything("Edit, stored Processing, Completed", go(V7, { stored: "Processing", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, 3),
  items: ITEMS }), "400", BUSY);
refusedBeforeAnything("Edit, stored Processing, Draft", go(V7, { stored: "Processing", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, 3), items: ITEMS }),
  "400", BUSY);
refusedBeforeAnything("Edit, stored Completed, saved as Draft (the stale tab)",
  go(V7, { stored: "Completed", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, 3, { item_disassembly_status: "Draft" }), items: ITEMS }), "409",
  "This Item Disassembly is already Completed and cannot be saved again.");
refusedBeforeAnything("Edit, stored Fully Posted, saved as Draft",
  go(V7, { stored: "Fully Posted", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, 3), items: ITEMS }), "409",
  "This Item Disassembly is already Fully Posted and cannot be saved again.");
const stale = both({ stored: "Completed", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, 3, { item_disassembly_status: "Draft" }), items: ITEMS });
eq("the stale-tab bug on v6: it wrote the Completed IDA back to Draft", [stale.v6.returned.code, stale.v6.writes.map((w) => [w[0], w[1], w[2].item_disassembly_status])],
  ["200", [["update", "Item Disassembly", "Draft"]]]);
const addBig = go(V7, { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 1, 250), items: ITEMS });
refusedBeforeAnything("Add, Completed, 251 moves (1 pick + 250 lines)", addBig, "400", TOO_BIG);
eq("Add: no stored read", addBig.sqls.length, 0);
refusedBeforeAnything("Add, Completed, 251 moves (3 picks + 248 lines)", go(V7, { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3, 248),
  items: ITEMS }), "400", TOO_BIG);
const editBig = go(V7, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, 250), items: ITEMS });
refusedBeforeAnything("Edit, stored Draft, Completed, 251 moves", editBig, "400", TOO_BIG);
eq("Edit: one stored read", editBig.sqls.length, 1);
refusedBeforeAnything("Clone, Completed, 251 moves", go(V7, { stored: "Completed", saveAs: "Completed", pageStatus: "Clone", allData: record("Clone", 1, 250, { id: IDA }),
  items: ITEMS }), "400", TOO_BIG);
eq("400, never 401, from a guard node", [addBig.returned.code, editBig.returned.code], ["400", "400"]);

// everything else runs exactly like v6
let r = sameAsV6("Add, Completed, 250 moves", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 1, 249), items: ITEMS });
eq("Add, 250 moves: completed (1 SUBTRACT, 249 ADDs)", [r.v7.returned.code, r.v7.calls.filter((c) => c[0] === "SUBTRACT_INVENTORY").length,
  r.v7.calls.filter((c) => c[0] === "ADD_INVENTORY").length], ["200", 1, 249]);
eq("Add: the guard read nothing", r.v7.sqls.length, 0);
r = sameAsV6("Edit, stored Draft, Completed, 250 moves", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 5, 245), items: ITEMS });
eq("Edit, stored Draft: completed after one stored read", [r.v7.returned.code, r.v7.sqls.length], ["200", 1]);
r = sameAsV6("Add, Draft, 300 moves (Draft exempt)", { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 1, 299), items: ITEMS });
eq("Draft 300 (Add): saved", [r.v7.returned.code, r.v7.writes.length], ["200", 1]);
r = sameAsV6("Edit, stored Draft, Draft, 900 moves", { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, 899), items: ITEMS });
eq("Draft 900 (Edit): saved", r.v7.returned.code, "200");
r = sameAsV6("Clone of a Completed IDA (source id kept), saved as Draft", { stored: "Completed", saveAs: "Draft", pageStatus: "Clone",
  allData: record("Clone", 1, 3, { id: IDA, item_disassembly_status: "Completed" }), items: ITEMS });
eq("Clone + Draft: saved, no stored read", [r.v7.returned.code, r.v7.sqls.length], ["200", 0]);
r = sameAsV6("Clone of a Completed IDA, Completed (small)", { stored: "Completed", saveAs: "Completed", pageStatus: "Clone",
  allData: record("Clone", 1, 3, { id: IDA, item_disassembly_status: "Completed" }), items: ITEMS });
eq("Clone + Completed: not refused by the guard, no stored read", r.v7.sqls.length, 0);
r = sameAsV6("Edit, stored Completed, Completed, the form says Completed (the classic's own 401)", { stored: "Completed", saveAs: "Completed", pageStatus: "Edit",
  allData: record("Edit", 1, 3, { item_disassembly_status: "Completed" }), items: ITEMS });
eq("stored + form Completed: the classic's 401", r.v7.returned.code, "401");
r = sameAsV6("Edit, stored Completed, Completed, the form says Draft (the classic's own 409)", { stored: "Completed", saveAs: "Completed", pageStatus: "Edit",
  allData: record("Edit", 1, 3), items: ITEMS });
eq("stored Completed, form Draft: the classic's 409", r.v7.returned.code, "409");
r = sameAsV6("Edit, stored row missing", { stored: null, saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, 3), items: ITEMS });
r = sameAsV6("Edit, the pre-check refuses a pick (402)", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, 3), items: ITEMS,
  fail: "GLOBAL_INVENTORY_VALIDATION" });
eq("pre-check refusal: the classic's 402, nothing written", [r.v7.returned.code, r.v7.writes.length], ["402", 0]);
r = sameAsV6("Add, SUBTRACT_INVENTORY refuses (400 after the header write, as v6)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 1, 3),
  items: ITEMS, fail: "SUBTRACT_INVENTORY" });
eq("SUBTRACT refusal: the classic's 400 with its errorMessage", [r.v7.returned.code, r.v7.returned.message], ["400", "Insufficient quantity"]);
r = sameAsV6("Add, an auto-batch line (GENERATE_BATCH + its Redis array, unchanged)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add",
  allData: record("Add", 1, 3, { stock_movement: [line(0, { batch_number: "Auto-generated batch number" }), line(1), line(2)] }),
  items: [item(SRC), item(COMP, { item_batch_management: 1, batch_number_genaration: "According To System Settings" }), item(COMP2)] });
eq("auto batch: GENERATE_BATCH called, its number received", [r.v7.calls.filter((c) => c[0] === "GENERATE_BATCH").length,
  r.v7.calls.find((c) => c[0] === "ADD_INVENTORY")[1].batch_number], [1, "Batch-00631"]);

// the price change end to end: a line in an alternate UOM (12 base units each); every base-UOM scenario above was byte-identical
const altItems = [item(SRC), item(COMP, { table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }, { alt_uom_id: ALT, base_qty: 12 }] }), item(COMP2)];
const altRec = record("Add", 1, 3, { stock_movement: [line(0, { quantity_uom: ALT, total_quantity: 2 }), line(1), line(2)] });
const alt = both({ stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: altRec, items: altItems });
const add6 = alt.v6.calls.filter((c) => c[0] === "ADD_INVENTORY").map((c) => c[1]);
const add7 = alt.v7.calls.filter((c) => c[0] === "ADD_INVENTORY").map((c) => c[1]);
// issued value 12 split by quantity over 2 + 1 + 1 -> line values 6, 3, 3
eq("alt UOM: v6 priced the 2-box line per box (6 / 2 = 3: ADD booked 3 x 24 base units = 72)", add6.map((p) => p.unit_price), [3, 3, 3]);
eq("alt UOM: v7 prices it per base unit (6 / 24 = 0.25: ADD books 0.25 x 24 = 6)", add7.map((p) => p.unit_price), [0.25, 3, 3]);
eq("alt UOM: every other ADD param identical", add7.map((p) => Object.assign({}, p, { unit_price: 0 })), add6.map((p) => Object.assign({}, p, { unit_price: 0 })));
eq("alt UOM: steps / writes / other calls identical", [noGuard(alt.v7.steps), stamp(alt.v7.writes), alt.v7.calls.filter((c) => c[0] !== "ADD_INVENTORY")],
  [alt.v6.steps, stamp(alt.v6.writes), alt.v6.calls.filter((c) => c[0] !== "ADD_INVENTORY")]);
eq("alt UOM: v7 answer == v6", alt.v7.returned, alt.v6.returned);

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
