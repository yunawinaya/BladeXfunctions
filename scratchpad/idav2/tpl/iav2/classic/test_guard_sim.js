// node scratchpad/iav2/classic/test_guard_sim.js - runs the BUILT IA_SAVE v12 (and base v11) through lib/sim's FlowGram
// interpreter: the guard's refusals answer before any write, every other scenario runs node for node like v11 (same writes,
// same callee calls, same answer). Callees are stubs except CHECK_REQUIRED_FIELD (the real v8 JSON).
const fs = require("fs");
const path = require("path");
const IAV2 = path.join(__dirname, "..");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));
const V12 = path.join(IAV2, "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_SAVE.json");
const V11 = path.join(IAV2, "base", "IA_SAVE.v11.json");
const GUARD = new Set(["code_node_IAguardIn", "sql_node_IAguard", "code_node_IAguardStored"]);
const T = "000000";
const IA = "2112073133161844738";
const PARENT = "2094626841323700251";
const COMP = "2094626841323700252";
const DL = "1999999999999990001";
const BIN = "2018912822846582786";
const UOM = "2018906563477008392";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 700) + "\n  want " + JSON.stringify(want).slice(0, 700));
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
        if (r.stock_movement_no === "issued") r.stock_movement_no = "IA-0001";
        if (r.stock_movement_no === "draft") r.stock_movement_no = "Draft-0001";
        writes.push(["insert", table, r]);
        return r;
      }),
      update: (table, rows) => {
        for (const r of rows) writes.push(["update", table, r]);
        return { count: rows.length };
      },
    };
    const stored = () => ({ id: IA, item_assembly_status: sc.stored, stock_movement_no: "IA-0009", stock_movement: [] });
    super({
      dir: path.dirname(file), db,
      mocks: {
        sql: {
          sql_node_IAguard: (text) => {
            sql.push(text);
            if (!/h\.tenant_id = '000000'/.test(text) || !new RegExp("h\\.id = " + IA + "\\b").test(text)) throw new Error("guard SQL not filled: " + text);
            return sc.stored === null ? [] : [{ ia_id: IA, item_assembly_status: sc.stored }];
          },
        },
        read: {
          search_items: () => ({ total: sc.items.length, count: sc.items.length, data: sc.items }),
          get_persisted_ia: () => ({ count: 1, data: stored() }),
          get_ia: () => ({ count: 1, data: stored() }),
          search_movements: () => ({ total: 1, count: 1, data: [{ total_price: 6, movement: "OUT" }] }),
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
    if (name === "IA_SAVE") return JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (name === "CHECK_REQUIRED_FIELD") return JSON.parse(fs.readFileSync(path.join(IAV2, "base", "CHECK_REQUIRED_FIELD.v8.json"), "utf8"));
    throw new Error("no workflow " + name);
  }

  run(name, params) {
    const fail = this.sc && this.sc.fail === name;
    const stub = fail ? { code: "400", message: "Insufficient stock for item TES501 (Unrestricted). Available: 0, Requested: 1", errorMessage: "Insufficient quantity" } : {
      GLOBAL_INVENTORY_VALIDATION: { code: "200", message: "Sufficient stock" }, SUBTRACT_INVENTORY: { code: "200" },
      ADD_INVENTORY: { code: "200", unitPrice: 0 }, GENERATE_BATCH: { batch_number: "B-0001" }, HANDLING_UNIT: { code: "200" } }[name];
    if (fail && !stub) throw new Error("no stub " + name);
    if (stub) {
      this.calls.push([name, JSON.parse(JSON.stringify(params))]);
      return { returned: stub, ctx: null };
    }
    return super.run(name, params);
  }

  // the platform resolves a reference to a node that did not run to null (v11's code_batch_number relies on it)
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

const picks = (k, extra) => JSON.stringify(Array.from({ length: k }, (_, i) => Object.assign({ material_id: COMP, location_id: BIN, batch_id: null, balance_id: String(9000 + i),
  sm_quantity: 1, category: "Unrestricted" }, extra || {})));
const record = (page, nPicks, extra) => Object.assign({
  organization_id: "1123598813738675201", issuing_operation_faci: "1123598813738675202", stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: page === "Add" ? "" : "Draft", item_id: PARENT, item_name: "TES500", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-19",
  issued_by: "sim", project_id: "", batch_no: "", storage_location_id: "2018912759311265793", location_id: BIN, inventory_category: "Unrestricted",
  remarks: "", remarks_2: "", remarks_3: "", reference_documents: [], page_status: page,
  stock_movement: [{ item_selection: COMP, item_name: "TES501", total_quantity: nPicks, requested_qty: nPicks, quantity_uom: UOM, temp_qty_data: picks(nPicks),
    temp_hu_data: "", line_index: 1 }],
}, page === "Add" ? {} : { id: IA }, extra || {});
const ITEMS = [{ id: PARENT, material_code: "TES500", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", assembly_cost: 0 },
  { id: COMP, material_code: "TES501", stock_control: 1, item_batch_management: 0, batch_number_genaration: "" }];

function go(file, sc) {
  const e = new Sim(file, sc);
  const r = e.run("IA_SAVE", { allData: sc.allData, saveAs: sc.saveAs, pageStatus: sc.pageStatus });
  const steps = e.trace.filter((t) => t.startsWith("IA_SAVE ")).map((t) => t.slice(8));
  return { returned: r.returned, steps: steps, writes: e.writes, calls: e.calls, sqls: e.sqls };
}
const both = (sc) => ({ v11: go(V11, sc), v12: go(V12, sc) });
const noGuard = (steps) => steps.filter((s) => !GUARD.has(s) && !/^if_IAguard/.test(s));
const BUSY = "This Item Assembly is being processed in the background - please wait for it to finish.";
const sameAsV11 = (label, sc) => {
  const r = both(sc);
  eq(label + ": v12 answer == v11", r.v12.returned, r.v11.returned);
  eq(label + ": v12 steps minus the guard == v11 steps", noGuard(r.v12.steps), r.v11.steps);
  // the item date stamp is new Date() at run time (code_item_txn): masked
  const stamp = (w) => JSON.parse(JSON.stringify(w).replace(/"last_transaction_date":"[^"]*"/g, '"last_transaction_date":"<now>"'));
  eq(label + ": v12 writes == v11 (item date stamp masked)", stamp(r.v12.writes), stamp(r.v11.writes));
  eq(label + ": v12 callee calls == v11", r.v12.calls, r.v11.calls);
  return r;
};
const refusedBeforeAnything = (label, res, code, message) => {
  eq(label + ": answer", res.returned, { code: code, message: message });
  eq(label + ": nothing written, no callee", [res.writes.length, res.calls.length], [0, 0]);
  eq(label + ": stopped inside the guard (no classic node ran)", res.steps.filter((s) => !GUARD.has(s) && !/^if_IAguard/.test(s)), []);
};

// refusals
refusedBeforeAnything("Edit, stored Processing, Completed", go(V12, { stored: "Processing", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), items: ITEMS }),
  "400", BUSY);
refusedBeforeAnything("Edit, stored Processing, Draft", go(V12, { stored: "Processing", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 3), items: ITEMS }), "400",
  BUSY);
refusedBeforeAnything("Edit, stored Completed, saved as Draft (stale tab)",
  go(V12, { stored: "Completed", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 3, { item_assembly_status: "Draft" }), items: ITEMS }), "409",
  "This Item Assembly is already Completed and cannot be saved again.");
refusedBeforeAnything("Edit, stored Fully Posted, saved as Draft",
  go(V12, { stored: "Fully Posted", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 3), items: ITEMS }), "409",
  "This Item Assembly is already Fully Posted and cannot be saved again.");
const TOO_BIG = "This Item Assembly has 251 stock picks; this save can process at most 250 at once. Split it into smaller assemblies, or complete it from the web form if background completion is switched on.";
const addBig = go(V12, { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 251), items: ITEMS });
refusedBeforeAnything("Add, Completed, 251 picks", addBig, "400", TOO_BIG);
eq("Add: no stored read", addBig.sqls.length, 0);
const editBig = go(V12, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 251), items: ITEMS });
refusedBeforeAnything("Edit, stored Draft, Completed, 251 picks", editBig, "400", TOO_BIG);
eq("Edit: one stored read", editBig.sqls.length, 1);
refusedBeforeAnything("Clone, Completed, 251 picks", go(V12, { stored: "Completed", saveAs: "Completed", pageStatus: "Clone", allData: record("Clone", 251, { id: IA }),
  items: ITEMS }), "400", TOO_BIG);

// everything else runs exactly like v11
let r = sameAsV11("Add, Completed, 250 picks", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 250), items: ITEMS });
eq("Add, 250 picks: completed", r.v12.returned.code, "200");
eq("Add, 250 picks: 250 SUBTRACT calls", r.v12.calls.filter((c) => c[0] === "SUBTRACT_INVENTORY").length, 250);
eq("Add: the guard read nothing", r.v12.sqls.length, 0);
r = sameAsV11("Edit, stored Draft, Completed, 250 picks", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 250), items: ITEMS });
eq("Edit, stored Draft: completed", r.v12.returned.code, "200");
r = sameAsV11("Add, Draft, 251 picks (Draft exempt)", { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 251), items: ITEMS });
eq("Draft 251: saved", [r.v12.returned.code, r.v12.writes.length], ["200", 1]);
r = sameAsV11("Edit, stored Draft, Draft, 900 picks", { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 900), items: ITEMS });
eq("Draft 900 (Edit): saved", r.v12.returned.code, "200");
r = sameAsV11("Clone of a Completed IA (source id kept), saved as Draft", { stored: "Completed", saveAs: "Draft", pageStatus: "Clone",
  allData: record("Clone", 3, { id: IA, item_assembly_status: "Completed" }), items: ITEMS });
eq("Clone + Draft: saved, no stored read", [r.v12.returned.code, r.v12.sqls.length], ["200", 0]);
r = sameAsV11("Edit, stored Completed, Completed (the classic's own 401 / 409)", { stored: "Completed", saveAs: "Completed", pageStatus: "Edit",
  allData: record("Edit", 3, { item_assembly_status: "Completed" }), items: ITEMS });
eq("stored Completed + Completed: the classic's 401", r.v12.returned.code, "401");
r = sameAsV11("Edit, stored row missing", { stored: null, saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), items: ITEMS });
r = sameAsV11("Edit, the pre-check refuses a pick (402)", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), items: ITEMS,
  fail: "GLOBAL_INVENTORY_VALIDATION" });
eq("pre-check refusal: the classic's 402, nothing written", [r.v12.returned.code, r.v12.writes.length], ["402", 0]);
r = sameAsV11("Add, SUBTRACT_INVENTORY refuses (400 after the header write, as v11)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3),
  items: ITEMS, fail: "SUBTRACT_INVENTORY" });
eq("SUBTRACT refusal: the classic's 400 with its errorMessage", [r.v12.returned.code, r.v12.returned.message], ["400", "Insufficient quantity"]);
// the mobile payload (IA_MOBILE_GUIDE.md Part 9): number no_type, numbers for quantities, temp_qty_data text, pageStatus Add / Edit
const mobile = (page) => record(page, 4, { stock_movement_no_type: 1934567890123456, item_qty: 5, inventory_category: "", page_status: undefined,
  stock_movement: [{ item_selection: COMP, item_name: "TES501", item_desc: "", requested_qty: 8.25, total_quantity: 4, quantity_uom: UOM, uom_options: "[]",
    stock_summary: "Total: 4", item_remark: "", item_remark_2: "", item_remark_3: "", project_id: "", balance_id: "", temp_qty_data: picks(4), temp_hu_data: "[]" }] });
r = sameAsV11("mobile Add, Completed", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: mobile("Add"), items: ITEMS });
eq("mobile Add: completed", r.v12.returned.code, "200");
r = sameAsV11("mobile Edit, Completed", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: mobile("Edit"), items: ITEMS });
eq("mobile Edit: completed, one stored read", [r.v12.returned.code, r.v12.sqls.length], ["200", 1]);
refusedBeforeAnything("mobile Edit of a Processing IA", go(V12, { stored: "Processing", saveAs: "Completed", pageStatus: "Edit", allData: mobile("Edit"), items: ITEMS }),
  "400", BUSY);
// the non-stock rule end to end: a DL line (stock_control 0, no picks) completes on v12 and moves nothing for it; v11 answered 401
const withDl = record("Add", 3);
withDl.stock_movement.push({ item_selection: DL, item_name: "Direct Labour", total_quantity: 2, requested_qty: 2, quantity_uom: UOM, temp_qty_data: "", temp_hu_data: "",
  line_index: 2 });
const dlItems = ITEMS.concat([{ id: DL, material_code: "DL", stock_control: 0, item_batch_management: 0 }]);
const dl = both({ stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: withDl, items: dlItems });
eq("non-stock line: v11 refused it (401)", dl.v11.returned.code, "401");
eq("non-stock line: v12 completes", dl.v12.returned.code, "200");
eq("non-stock line: only the stock line's 3 SUBTRACTs + 3 pre-checks + 1 ADD", dl.v12.calls.map((c) => c[0]).sort(),
  ["ADD_INVENTORY"].concat(Array(3).fill("GLOBAL_INVENTORY_VALIDATION"), Array(3).fill("SUBTRACT_INVENTORY")).sort());
eq("non-stock line: never sent to SUBTRACT", dl.v12.calls.filter((c) => c[0] === "SUBTRACT_INVENTORY" && c[1].material_id === DL).length, 0);
const add = dl.v12.calls.find((c) => c[0] === "ADD_INVENTORY")[1];
eq("non-stock line: the receipt price is the OUT total / qty (6 / 1)", [add.unit_price, add.quantity], [6, 1]);
// fix wave R5: an IA of non-stock lines only is refused (v11's own no-components text), before any write or callee
const onlyDl = record("Add", 0);
onlyDl.stock_movement = [{ item_selection: DL, item_name: "Direct Labour", total_quantity: 2, requested_qty: 2, quantity_uom: UOM, temp_qty_data: "", temp_hu_data: "",
  line_index: 1 }];
const nd = both({ stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: onlyDl, items: dlItems });
eq("R5: non-stock lines only -> v12 401 with v11's no-components text, nothing written, no callee",
  [nd.v12.returned, nd.v12.writes.length, nd.v12.calls.length],
  [{ code: "401", message: "There are no components to consume. Add at least one component line." }, 0, 0]);
eq("R5: v11 refused it too (401), nothing written", [nd.v11.returned.code, nd.v11.writes.length], ["401", 0]);
eq("R5: a mixed IA still completes on v12", dl.v12.returned.code, "200");

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
