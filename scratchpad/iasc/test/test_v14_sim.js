// node scratchpad/iasc/test/test_v14_sim.js - IA_SAVE v14 (the IA output split, plan 10-27) against v13 (= the deployed v25) in the iav2
// FlowGram interpreter: a save without a split runs node for node like v13 (same answer, same steps minus the split's nodes, same writes
// minus output_split, same callee calls); a split completion numbers its groups, inserts one Batch row per batch and receives one
// ADD_INVENTORY per row; every refusal stops before what it guards. Builds both into a temp folder (IA_V13 / IA_V14 = given files).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IASC = path.join(__dirname, "..");
const IAV2 = path.join(IASC, "..", "iav2");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));

const built = (script, env) => {
  if (process.env[env]) return process.env[env];
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ia-" + env.toLowerCase() + "-"));
  const r = spawnSync("python3", [path.join(IASC, "classic", script), "--write"], { env: Object.assign({}, process.env, { IASC_OUT: out }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(script + ": " + r.stderr.slice(-1200));
  return path.join(out, "IA_SAVE.json");
};
const SRC13 = built("patch_v13.py", "IA_V13");
const SRC14 = built("patch_v14.py", "IA_V14");
const variant = (src, res, claim) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ia-v14v-")), "IA_SAVE.json");
  fs.writeFileSync(f, fs.readFileSync(src, "utf8").replace(/const RES_ENABLED = (true|false);/g, "const RES_ENABLED = " + res + ";")
    .replace(/const IA_CLAIM_ENABLED = (true|false);/g, "const IA_CLAIM_ENABLED = " + claim + ";"));
  return f;
};
const V13 = variant(SRC13, false, false);
const V14 = variant(SRC14, false, false);
const V13_CL = variant(SRC13, true, true);
const V14_CL = variant(SRC14, true, true);
const index = (doc) => {
  const out = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.id === "string" && n.type) out.add(n.id);
      Object.values(n).forEach(walk);
    }
  };
  walk(doc.nodes);
  return out;
};
const OLD_IDS = index(JSON.parse(fs.readFileSync(SRC13, "utf8")));
const OS_IDS = new Set([...index(JSON.parse(fs.readFileSync(SRC14, "utf8")))].filter((x) => !OLD_IDS.has(x)));

const T = "000000";
const UID = "2109866916722085890";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IA = "2112073133161844738";
const PARENT = "2094626841323700251";
const COMP = "2094626841323700252";
const BIN = "2018912822846582786";
const BIN2 = "2018912822846582787";
const BIN3 = "2018912822846582788";
const BIN_OTHER = "2018912822846582789";
const SL = "2018912759311265793";
const SL2 = "2018912759311265794";
const UOM = "2018906563477008392";
const CTN = "2018906563477008393";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1200) + "\n  want " + JSON.stringify(want).slice(0, 1200));
  }
};
const yes = (label, v) => eq(label, !!v, true);

class Sim extends Engine {
  constructor(file, sc) {
    const writes = [];
    const calls = [];
    const sqls = [];
    sc.steps = sc.steps || [];
    let genNo = 0;
    let addNo = 0;
    const db = {
      tenantId: T,
      uid: UID,
      insert: (table, rows) => rows.map((r0, i) => {
        if (table === "GD Publish Step" && sc.steps.some((x) => x.job_id === r0.job_id && x.step_name === r0.step_name)) throw new Error("Duplicate entry for key 'Job Step'");
        const r = Object.assign({}, r0, { id: String(3000000000000000001n + BigInt(writes.length + i)) });
        if (r.stock_movement_no === "issued") r.stock_movement_no = "IA-0001";
        if (r.stock_movement_no === "draft") r.stock_movement_no = "Draft-0001";
        writes.push(["insert", table, r]);
        if (table === "GD Publish Step") sc.steps.push(Object.assign({ is_deleted: 0 }, r));
        return r;
      }),
      update: (table, rows) => {
        for (const r of rows) {
          writes.push(["update", table, r]);
          if (table === "GD Publish Step") sc.steps.filter((x) => x.id === r.id).forEach((x) => Object.assign(x, r));
        }
        return { count: rows.length };
      },
    };
    const stored = () => ({ id: IA, item_assembly_status: sc.stored, stock_movement_no: "IA-0009", stock_movement: [] });
    super({
      dir: path.dirname(file), db,
      mocks: {
        sql: {
          sql_node_IAguard: (text) => (sc.stored === null ? [] : [Object.assign({ ia_id: IA, item_assembly_status: sc.stored },
            /h\.stock_movement_no\b/.test(String(text || "")) ? { stock_movement_no: "IA-0009" } : {})]),
          sql_node_RESown: () => [{ j: JSON.stringify({ rows: null, live: 0 }) }],
          sql_node_IAclaimState: () => {
            const mine = sc.steps.filter((x) => x.job_id === "IAS|" + IA && /^CLAIM\|/.test(x.step_name));
            return [{ j: JSON.stringify({ max: mine.reduce((m, x) => Math.max(m, Number(x.step_name.slice(6))), 0), now: "2026-10-27 14:00:00" }) }];
          },
          sql_node_IAclaims: () => {
            const held = sc.steps.filter((x) => x.job_id === "IAS|" + IA && /^CLAIM\|/.test(x.step_name) && x.step_status === "HELD" && !Number(x.is_deleted));
            return [{ j: JSON.stringify({ claims: held.length ? held.map((x) => ({ id: x.id, name: x.step_name, started_at: x.started_at })) : null, status: sc.stored,
              now: "2026-10-27 14:00:00" }) }];
          },
          sql_node_SCsource: (text) => {
            sqls.push(["SCsource", text]);
            const iaId = (/h\.id = (\d+)/.exec(text) || [])[1];
            let st = iaId && iaId !== "0" ? Object.assign({ item_id: PARENT }, sc.scStored || {}) : null;
            // v14 reads the stored split, plant and bin with the same row (the mobile guard)
            if (st && /'output_split', h\.output_split, 'plant', CAST\(h\.issuing_operation_faci AS CHAR\), 'bin', CAST\(h\.location_id AS CHAR\)/.test(text)) {
              st = Object.assign(st, { output_split: sc.osStored === undefined ? null : sc.osStored, plant: sc.osPlant || PLANT, bin: sc.osBin || BIN });
            }
            return [{ j: JSON.stringify({ member: 1, stored: st, line: null, header: null, keys: null, hold: null }) }];
          },
          sql_node_OSbins: (text) => {
            sqls.push(["OSbins", text]);
            const q = text.replace(/\s+/g, " ");
            if (q.indexOf("FROM bin_location b WHERE b.id IN (") < 0 || q.indexOf("AND b.is_deleted = 0") < 0) throw new Error("bins SQL: " + q);
            const want = (/b\.id IN \(([0-9,]+)\)/.exec(q) || [])[1].split(",");
            const bins = want.filter((id) => sc.bins[id]).map((id) => Object.assign({ id: id }, sc.bins[id]));
            return [{ j: JSON.stringify({ bins: bins.length ? bins : null }) }];
          },
          sql_node_OSbatchRead: (text) => {
            sqls.push(["OSbatchRead", text]);
            const q = text.replace(/\s+/g, " ");
            if (q.indexOf("FROM batch b WHERE b.tenant_id = '" + T + "' AND b.id IN (") < 0 || q.indexOf("AND b.is_deleted = 0") < 0) throw new Error("batch read SQL: " + q);
            const want = (/b\.id IN \(([0-9,]+)\)/.exec(q) || [])[1].split(",");
            const rows = writes.filter((w) => w[1] === "Batch" && want.indexOf(w[2].id) >= 0 && (sc.batchDrop || []).indexOf(w[2].batch_number) < 0)
              .map((w) => ({ id: w[2].id, batch_number: w[2].batch_number, material_id: w[2].material_id }));
            return [{ j: JSON.stringify({ rows: rows.length ? rows : null }) }];
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
    this.sqls = sqls;
    this.next = { gen: () => (sc.genNumbers || ["B-0001", "B-0002", "B-0003"])[genNo++], add: () => (sc.addAnswers || [])[addNo++] || { code: "200", unitPrice: 0 } };
  }

  load(name) {
    if (name === "IA_SAVE") return JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (name === "CHECK_REQUIRED_FIELD") return JSON.parse(fs.readFileSync(path.join(IAV2, "base", "CHECK_REQUIRED_FIELD.v8.json"), "utf8"));
    throw new Error("no workflow " + name);
  }

  run(name, params) {
    const fixed = { GLOBAL_INVENTORY_VALIDATION: { code: "200", message: "Sufficient stock" }, SUBTRACT_INVENTORY: { code: "200" }, HANDLING_UNIT: { code: "200" } }[name];
    const stub = name === "GENERATE_BATCH" ? { batch_number: this.next.gen() } : name === "ADD_INVENTORY" ? this.next.add() : fixed;
    if (stub) {
      this.calls.push([name, JSON.parse(JSON.stringify(params))]);
      return { returned: stub, ctx: null };
    }
    return super.run(name, params);
  }

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

const picks = (k) => JSON.stringify(Array.from({ length: k }, (_, i) => ({ material_id: COMP, location_id: BIN, batch_id: null, balance_id: String(9000 + i),
  sm_quantity: 1, category: "Unrestricted" })));
const record = (page, nPicks, extra) => Object.assign({
  organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: page === "Add" ? "" : "Draft", item_id: PARENT, item_name: "TES500", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-19",
  issued_by: "sim", project_id: "", batch_no: "", storage_location_id: SL, location_id: BIN, inventory_category: "Unrestricted",
  remarks: "r1", remarks_2: "", remarks_3: "", reference_documents: [], page_status: page,
  stock_movement: [{ item_selection: COMP, item_name: "TES501", total_quantity: nPicks, requested_qty: nPicks, quantity_uom: UOM, temp_qty_data: picks(nPicks),
    temp_hu_data: "", line_index: 1 }],
}, page === "Add" ? {} : { id: IA }, extra || {});
const item = (extra) => Object.assign({ id: PARENT, material_code: "TES500", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", assembly_cost: 0,
  serial_number_management: 0, based_uom: UOM, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }, { alt_uom_id: CTN, base_qty: 12 }] }, extra || {});
const COMP_ITEM = { id: COMP, material_code: "TES501", stock_control: 1, item_batch_management: 0, batch_number_genaration: "" };
const PLAIN = [item(), COMP_ITEM];
const SYS = [item({ item_batch_management: 1, batch_number_genaration: "According To System Settings" }), COMP_ITEM];
const MAN = [item({ item_batch_management: 1, batch_number_genaration: "Manual Input" }), COMP_ITEM];
const BINS = { [BIN]: { plant: PLANT, sl: SL, active: 1 }, [BIN2]: { plant: PLANT, sl: SL, active: 1 }, [BIN3]: { plant: PLANT, sl: SL2, active: 1 },
  [BIN_OTHER]: { plant: "999", sl: SL, active: 1 } };
const row = (qty, bin, extra) => Object.assign({ os_qty: qty, os_storage_location_id: SL, os_location_id: bin, os_category: "Blocked", os_group: 1, os_batch_no: "",
  os_mfg_date: "2026-10-27 00:00:00.000", os_exp_date: "2028-10-27 00:00:00.000" }, extra || {});
const SPLIT3 = [row(500, BIN), row(300, BIN2), row(36, BIN3, { os_group: 2, os_category: "Unrestricted", os_mfg_date: "2026-10-20 00:00:00.000" })];

function go(file, sc) {
  const e = new Sim(file, Object.assign({ items: PLAIN, bins: BINS }, sc));
  let r;
  try {
    r = e.run("IA_SAVE", { allData: sc.allData, saveAs: sc.saveAs, pageStatus: sc.pageStatus });
  } catch (err) {
    r = { returned: { crashed: String(err.message).slice(0, 300) } };
  }
  const steps = e.trace.filter((t) => t.startsWith("IA_SAVE ")).map((t) => t.slice(8));
  return { returned: r.returned, steps: steps, writes: e.writes, calls: e.calls, sqls: e.sqls };
}
const header = (res) => res.writes.filter((w) => w[1] === "Item Assembly")[0];
const strip = (w) => JSON.parse(JSON.stringify(w, (k, v) => (k === "output_split" ? undefined : v)).replace(/"last_transaction_date":"[^"]*"/g, '"last_transaction_date":"<now>"'));
const sameAsV13 = (label, sc, files) => {
  const [a13, a14] = files || [V13, V14];
  const a = go(a13, JSON.parse(JSON.stringify(sc)));
  const b = go(a14, JSON.parse(JSON.stringify(sc)));
  eq(label + ": answer == v13", b.returned, a.returned);
  eq(label + ": steps minus the split's == v13", b.steps.filter((s) => !OS_IDS.has(s)), a.steps);
  eq(label + ": writes minus output_split == v13", strip(b.writes), strip(a.writes));
  eq(label + ": callee calls == v13", b.calls, a.calls);
  eq(label + ": no split read (bins / Batch rows)", b.sqls.filter((s) => s[0] !== "SCsource").length, 0);
  return b;
};
const named = (res, wf) => res.calls.filter((c) => c[0] === wf).map((c) => c[1]);
const batchRows = (res) => res.writes.filter((w) => w[1] === "Batch").map((w) => w[2]);
const refusedBeforeWrites = (label, res, code, re) => {
  eq(label + ": " + code, res.returned && res.returned.code, code);
  yes(label + ": its message (" + ((res.returned && res.returned.message) || "") + ")", re.test((res.returned && res.returned.message) || ""));
  eq(label + ": nothing written, no callee", [res.writes.length, res.calls.length], [0, 0]);
};

// ================================================================ no split: v13 node for node
let r = sameAsV13("Add, Completed, desktop (no split)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3, { output_split: [] }) });
eq("Add no split: completed, header output_split = []", [r.returned.code, header(r)[2].output_split], ["200", []]);
r = sameAsV13("Add, Completed, mobile (no key)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3) });
eq("mobile Add: output_split = []", header(r)[2].output_split, []);
r = sameAsV13("Edit, stored Draft, Completed, desktop", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3, { output_split: [] }) });
r = sameAsV13("Edit, Completed, mobile (no key), nothing stored", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), osStored: null });
eq("mobile Edit, legacy IA: output_split = []", header(r)[2].output_split, []);
r = sameAsV13("Add, Draft", { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, { output_split: [] }) });
r = sameAsV13("Edit, Draft (Created via the Draft path)", { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, { output_split: [], ia_target_status: "Created" }) });
r = sameAsV13("Clone, Draft", { stored: "Completed", saveAs: "Draft", pageStatus: "Clone", allData: record("Clone", 2, { id: IA, item_assembly_status: "Completed", output_split: [] }) });
r = sameAsV13("Add, Completed, a System batch item (no split): one GENERATE_BATCH, one ADD", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", items: SYS,
  allData: record("Add", 3, { output_split: [] }) });
eq("System no split: the single receipt's batch", [named(r, "GENERATE_BATCH").length, named(r, "ADD_INVENTORY").map((p) => p.batch_number)], [1, ["B-0001"]]);
r = sameAsV13("Edit, Completed, claim + holds ON", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3, { output_split: [] }) }, [V13_CL, V14_CL]);
r = sameAsV13("Add, Completed, the single receipt refused (400)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3, { output_split: [] }),
  addAnswers: [{ code: "400", errorMessage: "no bin" }] });
eq("single receipt refused: v13's answer", [r.returned.code, r.returned.message], ["400", "no bin"]);
r = sameAsV13("Edit, stored Processing (guard first)", { stored: "Processing", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3, { output_split: SPLIT3 }) });

// ================================================================ System split: 3 rows, 2 groups
const sys = { stored: "Draft", saveAs: "Completed", pageStatus: "Add", items: SYS, allData: record("Add", 3, { item_qty: 836, output_split: SPLIT3 }) };
r = go(V14, sys);
eq("System split: completed", r.returned.code, "200");
eq("System split: GENERATE_BATCH once per group, each with its dates", named(r, "GENERATE_BATCH"), [
  { item_id: PARENT, document_date: "2026-10-19", manufacturing_date: "2026-10-27 00:00:00.000", expired_date: "2028-10-27 00:00:00.000" },
  { item_id: PARENT, document_date: "2026-10-19", manufacturing_date: "2026-10-20 00:00:00.000", expired_date: "2028-10-27 00:00:00.000" }]);
eq("System split: one Batch row per group (ADD_INVENTORY's columns, the IA number, the group's base qty)", batchRows(r).map((b) => { const x = Object.assign({}, b); delete x.id; return x; }), [
  { batch_number: "B-0001", material_id: PARENT, initial_quantity: 800, transaction_no: "IA-0001", plant_id: PLANT, organization_id: ORG, remark: "r1", remark2: "", remark3: "",
    manufacturing_date: "2026-10-27 00:00:00.000", expired_date: "2028-10-27 00:00:00.000" },
  { batch_number: "B-0002", material_id: PARENT, initial_quantity: 36, transaction_no: "IA-0001", plant_id: PLANT, organization_id: ORG, remark: "r1", remark2: "", remark3: "",
    manufacturing_date: "2026-10-20 00:00:00.000", expired_date: "2028-10-27 00:00:00.000" }]);
const ids = batchRows(r).map((b) => b.id);
const adds = named(r, "ADD_INVENTORY");
eq("System split: ADD_INVENTORY once per row in table order (bin, category, qty, its batch and Batch row id, its dates)",
  adds.map((p) => [p.location_id, p.inventory_category, p.quantity, p.batch_number, p.batch_id, p.manufacturing_date, p.expired_date]), [
    [BIN, "Blocked", 500, "B-0001", ids[0], "2026-10-27 00:00:00.000", "2028-10-27 00:00:00.000"],
    [BIN2, "Blocked", 300, "B-0001", ids[0], "2026-10-27 00:00:00.000", "2028-10-27 00:00:00.000"],
    [BIN3, "Unrestricted", 36, "B-0002", ids[1], "2026-10-20 00:00:00.000", "2028-10-27 00:00:00.000"]]);
eq("System split: one unit price for every row (the issue's total / the output qty), 'IA', the IA number, the item UOM",
  [...new Set(adds.map((p) => [p.unit_price, p.transaction_type, p.trx_no, p.material_uom, p.material_id, p.plant_id, p.isMovingInv].join("|")))],
  [[Number((6 / 836).toFixed(8)), "IA", "IA-0001", UOM, PARENT, PLANT, "0"].join("|")]);
const h = header(r);
eq("System split: the header write stores the final rows (numbers, storage locations from the bins)", h[2].output_split.map((x) => [x.os_location_id, x.os_storage_location_id, x.os_batch_no]),
  [[BIN, SL, "B-0001"], [BIN2, SL, "B-0001"], [BIN3, SL2, "B-0002"]]);
eq("System split: item_qty stays the total", h[2].item_qty, 836);
const hu = r.writes.filter((w) => w[0] === "update" && w[1] === "Item Assembly" && w[2].batch_no !== undefined && w[2].location_id !== undefined);
eq("System split: then its single Output Location fields = row 1 (the IA's id, group 1's number)", hu.map((w) => [w[2].id, w[2].storage_location_id, w[2].location_id,
  w[2].inventory_category, w[2].batch_no, w[2].manufacturing_date, w[2].expired_date]), [[h[2].id, SL, BIN, "Blocked", "B-0001", "2026-10-27 00:00:00.000", "2028-10-27 00:00:00.000"]]);
eq("System split: components still issued (3 picks)", named(r, "SUBTRACT_INVENTORY").length, 3);
eq("System split: the bins read once by id", r.sqls.filter((s) => s[0] === "OSbins").map((s) => (/b\.id IN \(([0-9,]+)\)/.exec(s[1]) || [])[1]), [[BIN, BIN2, BIN3].join(",")]);
const order = r.writes.map((w) => w[1] + ":" + (w[1] === "Item Assembly" ? w[0] : ""));
yes("System split: the order: header -> its row-1 fields -> Batch rows (after the issue) ", order.indexOf("Item Assembly:insert") < order.indexOf("Item Assembly:update") &&
  order.indexOf("Item Assembly:update") < order.indexOf("Batch:"));
yes("System split: no single receipt (wf_add) step", r.steps.indexOf("wf_add") < 0 && r.steps.indexOf("wf_OSadd") >= 0);
// Edit + claim ON: the claim ends DONE
r = go(V14_CL, Object.assign({}, sys, { pageStatus: "Edit", allData: record("Edit", 3, { item_qty: 836, output_split: SPLIT3 }) }));
eq("System split, Edit, claim ON: completed, the claim DONE, the IA's stored number on the Batch rows", [r.returned.code,
  r.writes.filter((w) => w[1] === "GD Publish Step" && w[0] === "update").map((w) => w[2].result_ref), [...new Set(batchRows(r).map((b) => b.transaction_no))]],
  ["200", ["DONE"], ["IA-0009"]]);
// a CTN output: the Batch rows' initial quantity in the base UOM
r = go(V14, Object.assign({}, sys, { allData: record("Add", 3, { item_qty: 2.5, item_uom: CTN, output_split: [row(1.5, BIN), row(1, BIN2)] }) }));
eq("System split in CTN: Batch row initial_quantity = 30 (2.5 CTN x 12), ADD in CTN", [batchRows(r).map((b) => b.initial_quantity), named(r, "ADD_INVENTORY").map((p) => [p.quantity, p.material_uom])],
  [[30], [[1.5, CTN], [1, CTN]]]);

// ================================================================ Manual split: the typed number is the batch
r = go(V14, { stored: "Draft", saveAs: "Completed", pageStatus: "Add", items: MAN, allData: record("Add", 3, { item_qty: 10, batch_no: "Lot-A",
  output_split: [row(4, BIN, { os_batch_no: "Lot-A" }), row(3, BIN2, { os_batch_no: "LOT-a" }), row(3, BIN3, { os_batch_no: "Lot-B", os_group: 7 })] }) });
eq("Manual split: completed, no GENERATE_BATCH, one Batch row per number (first spelling)", [r.returned.code, named(r, "GENERATE_BATCH").length,
  batchRows(r).map((b) => [b.batch_number, b.initial_quantity])], ["200", 0, [["Lot-A", 7], ["Lot-B", 3]]]);
eq("Manual split: the rows take their batch's spelling and id", named(r, "ADD_INVENTORY").map((p) => [p.batch_number, p.batch_id]),
  [["Lot-A", batchRows(r)[0].id], ["Lot-A", batchRows(r)[0].id], ["Lot-B", batchRows(r)[1].id]]);

// ================================================================ non-batch split: bins only
r = go(V14, { stored: "Draft", saveAs: "Completed", pageStatus: "Add", items: PLAIN, allData: record("Add", 3, { item_qty: 10, manufacturing_date: "M", expired_date: "E",
  output_split: [row(6, BIN, { os_batch_no: "junk" }), row(4, BIN2)] }) });
eq("non-batch split: completed, no Batch row, no number, ADD per row with '-' (no blank Batch row), the header's dates",
  [r.returned.code, batchRows(r).length, named(r, "GENERATE_BATCH").length, named(r, "ADD_INVENTORY").map((p) => [p.location_id, p.quantity, p.batch_number, p.batch_id, p.manufacturing_date])],
  ["200", 0, 0, [[BIN, 6, "-", null, "M"], [BIN2, 4, "-", null, "M"]]]);
eq("non-batch split: no Batch read-back", r.sqls.filter((s) => s[0] === "OSbatchRead").length, 0);

// ================================================================ Draft / Created: stored as sent, nothing numbered
r = go(V14, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", items: SYS, allData: record("Add", 2, { item_qty: 836, output_split: [row(" 500 ", BIN), row("", "")] }) });
eq("Draft with a split: saved, the rows normalised (an unfinished row kept), nothing numbered or read", [r.returned.code, header(r)[2].output_split.map((x) => [x.os_qty, x.os_location_id]),
  r.calls.length, r.sqls.filter((s) => s[0] !== "SCsource").length], ["200", [[500, BIN], [0, ""]], 0, 0]);

// ================================================================ mobile (no key) on a stored split
r = go(V14, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", items: SYS, allData: record("Edit", 2, { item_qty: 836 }), osStored: SPLIT3 });
eq("mobile Draft on a stored split: keeps its rows", [r.returned.code, header(r)[2].output_split.length], ["200", 3]);
r = go(V14, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", items: SYS, allData: record("Edit", 2, { item_qty: 836, location_id: BIN2 }), osStored: SPLIT3 });
refusedBeforeWrites("mobile moving a stored split's bin", r, "400", /split across bins: change its plant, item or bin on the desktop/);
r = go(V14, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", items: SYS, allData: record("Edit", 3, { item_qty: 836 }), osStored: SPLIT3 });
eq("mobile completing a stored split: received per row", [r.returned.code, named(r, "ADD_INVENTORY").length, batchRows(r).length], ["200", 3, 2]);

// ================================================================ refusals
r = go(V14, Object.assign({}, sys, { allData: record("Add", 3, { item_qty: 836, output_split: "[{" }) }));
refusedBeforeWrites("unreadable rows", r, "400", /could not be read/);
r = go(V14, Object.assign({}, sys, { allData: record("Add", 3, { item_qty: 836, output_split: Array.from({ length: 21 }, () => row(1, BIN)) }) }));
refusedBeforeWrites("21 rows", r, "400", /at most 20 rows/);
r = go(V14, Object.assign({}, sys, { allData: record("Add", 3, { item_qty: 835, output_split: SPLIT3 }) }));
refusedBeforeWrites("total != output qty (no pre-check, no number)", r, "401", /split total 836 is not the output quantity 835/);
r = go(V14, Object.assign({}, sys, { allData: record("Add", 3, { item_qty: 836, output_split: [row(500, BIN), row(336, BIN_OTHER)] }) }));
refusedBeforeWrites("a bin of another plant", r, "401", /Output row 2: its bin location is not a bin of this plant/);
r = go(V14, Object.assign({}, sys, { allData: record("Add", 3, { item_qty: 836, output_split: [row(836, BIN)] }) }));
refusedBeforeWrites("one row", r, "401", /at least 2 rows/);
r = go(V14, Object.assign({}, sys, { items: [item({ serial_number_management: 1 }), COMP_ITEM], allData: record("Add", 3, { item_qty: 836, output_split: SPLIT3 }) }));
refusedBeforeWrites("a serial item", r, "401", /Serial-numbered items cannot be split/);
r = go(V14, Object.assign({}, sys, { genNumbers: ["B-0001", "B-0001"] }));
eq("the same number for two groups: 400 before the claim, the header and any stock", [r.returned.code, /the same number B-0001/.test(r.returned.message), r.writes.length,
  named(r, "GENERATE_BATCH").length, named(r, "SUBTRACT_INVENTORY").length], ["400", true, 0, 2, 0]);
r = go(V14, Object.assign({}, sys, { genNumbers: ["B-0001", ""] }));
eq("no number for group 2: 400 (the loop's own stop), nothing written", [r.returned.code, /for group 2 of the output split/.test(r.returned.message), r.writes.length], ["400", true, 0]);
// after the header: the batches not read back / a row refused -> the claim says which (PARTIAL|RECEIPT|k/n)
const edit = Object.assign({}, sys, { pageStatus: "Edit", allData: record("Edit", 3, { item_qty: 836, output_split: SPLIT3 }) });
r = go(V14_CL, Object.assign({}, edit, { batchDrop: ["B-0002"] }));
eq("a Batch row not read back: 400 needs review, PARTIAL|RECEIPT|0/3, no ADD", [r.returned.code, /could not be created \(group 2\)/.test(r.returned.message),
  r.writes.filter((w) => w[1] === "GD Publish Step" && w[0] === "update").map((w) => w[2].result_ref), named(r, "ADD_INVENTORY").length], ["400", true, ["PARTIAL|RECEIPT|0/3"], 0]);
r = go(V14_CL, Object.assign({}, edit, { addAnswers: [{ code: "200" }, { code: "400", errorMessage: "Bin is frozen" }] }));
eq("row 2 of 3 refused: 400 naming it, PARTIAL|RECEIPT|2/3, rows 1-2 tried, row 3 never", [r.returned.code, r.returned.message,
  r.writes.filter((w) => w[1] === "GD Publish Step" && w[0] === "update").map((w) => w[2].result_ref), named(r, "ADD_INVENTORY").length], ["400",
  "Output row 2 of 3 could not be received: Bin is frozen. Rows 1 to 1 were received; this Item Assembly needs review.", ["PARTIAL|RECEIPT|2/3"], 2]);
r = go(V14_CL, Object.assign({}, edit, { addAnswers: [{ code: "400", errorMessage: "x" }] }));
eq("row 1 refused: no output row received", [r.returned.message, r.writes.filter((w) => w[1] === "GD Publish Step" && w[0] === "update").map((w) => w[2].result_ref)],
  ["Output row 1 of 3 could not be received: x. No output row was received; this Item Assembly needs review.", ["PARTIAL|RECEIPT|1/3"]]);

console.log((fails ? "FAILED " : "ok - ") + (n - fails) + "/" + n + " checks");
process.exit(fails ? 1 : 0);
