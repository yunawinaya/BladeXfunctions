// node scratchpad/iasc/test/test_v13_sim.js - the BUILT IA_SAVE v13 (Item Assembly & BOM/SmallCycle/IA_SAVE.json) against the deployed v12
// (Item Assembly & BOM/AsyncV2/IA_SAVE.json) in the iav2 FlowGram interpreter: legacy saves run node for node like v12 (same answer,
// same steps minus the Small Cycle nodes, same writes minus the 7 new header props, same callee calls); the Small Cycle check merges,
// validates and stops with 400 before any write. Harness = scratchpad/iav2/classic/test_guard_sim.js.
const fs = require("fs");
const path = require("path");
const IASC = path.join(__dirname, "..");
const IAV2 = path.join(IASC, "..", "iav2");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));
const B = require(path.join(IASC, "code", "shared", "sc_bom.js"));
const REPO = path.join(IASC, "..", "..");
const V13 = process.env.IA_V13 || path.join(REPO, "Item Assembly & BOM", "SmallCycle", "IA_SAVE.json");
const V12 = path.join(REPO, "Item Assembly & BOM", "AsyncV2", "IA_SAVE.json");
const SC_NODES = new Set(["code_node_SCin", "sql_node_SCsource", "code_node_SCcheck"]);
const SC_PROPS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"];
const T = "000000";
const UID = "2109866916722085890";
const ORG = "1123598813738675201";
const IA = "2112073133161844738";
const PARENT = "2094626841323700251";
const COMP = "2094626841323700252";
const BIN = "2018912822846582786";
const UOM = "2018906563477008392";
const SO = "2112017989476458498";
const LINE = "2112017989484847107";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
  }
};
const yes = (label, v) => eq(label, !!v, true);

class Sim extends Engine {
  constructor(file, sc) {
    const writes = [];
    const calls = [];
    const sqls = [];
    const db = {
      tenantId: T,
      uid: UID,
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
          sql_node_IAguard: () => (sc.stored === null ? [] : [{ ia_id: IA, item_assembly_status: sc.stored }]),
          // RES-01 R4: this IA's own holds (Allocated / in flight) and its live hold tickets, read before a completion issues
          sql_node_RESown: (text) => {
            sqls.push(text);
            const q = text.replace(/\s+/g, " ");
            if (q.indexOf("r.doc_type = 'Item Assembly' AND r.doc_id = '" + IA + "'") < 0 || q.indexOf("p.job_id = 'IAH|" + IA + "'") < 0 ||
              q.indexOf("r.organization_id = '" + ORG + "'") < 0) throw new Error("RES SQL not filled: " + q);
            // the hold lease against IA_HOLD's own clock (UTC+8), never NOW() (UTC on prod; review M7)
            if (/\bNOW\(\)/.test(q) || q.indexOf("p.started_at > CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') - INTERVAL 10 MINUTE") < 0) throw new Error("RES SQL clock: " + q);
            return [{ j: JSON.stringify({ rows: (sc.res && sc.res.rows) || null, live: (sc.res && sc.res.live) || 0 }) }];
          },
          sql_node_SCsource: (text) => {
            sqls.push(text);
            if (!/'000000'/.test(text)) throw new Error("SC SQL not filled: " + text);
            const lineId = (/l\.id = IF\((\d+) > 0/.exec(text) || [])[1];
            const iaId = (/h\.id = (\d+)/.exec(text) || [])[1];
            const st = iaId && iaId !== "0" && sc.scStored ? sc.scStored : null;
            const want = lineId && lineId !== "0" ? lineId : st && st.source_so_line_id;
            const line = want && sc.lines && sc.lines[want] ? sc.lines[want] : null;
            // the stored keys of the payload lines that came without one (x.id IN (...)), non-empty only
            const ids = ((/x\.id IN \(([0-9,]+)\)/.exec(text) || [])[1] || "").split(",").filter((x) => x && x !== "0");
            const hasSql = (m, x) => !!m && Object.prototype.hasOwnProperty.call(m, x);
            const keys = ids.filter((x) => iaId && iaId !== "0" && (hasSql(sc.storedLines, x) || hasSql(sc.storedReq, x)))
              .map((x) => ({ id: x, k: hasSql(sc.storedLines, x) ? sc.storedLines[x] : "", r: hasSql(sc.storedReq, x) ? sc.storedReq[x] : null,
                q: hasSql(sc.storedRef, x) ? sc.storedRef[x] : null }));
            // FIX-03: whether the session user is assigned to the IA's organisation (sc.member 0 = not assigned)
            if (/'hold', h\.material_hold_status/.test(text) !== true) throw new Error("SC SQL does not read the stored hold status: " + text);
            return [{ j: JSON.stringify({ member: sc.member === undefined ? 1 : sc.member, stored: st, line: line, header: line && sc.headers ? sc.headers[line.sales_order_id] || null : null,
              keys: keys.length ? keys : null, hold: iaId && iaId !== "0" && st ? (sc.hold === undefined ? null : sc.hold) : null }) }];
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
  }

  load(name) {
    if (name === "IA_SAVE") return JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (name === "CHECK_REQUIRED_FIELD") return JSON.parse(fs.readFileSync(path.join(IAV2, "base", "CHECK_REQUIRED_FIELD.v8.json"), "utf8"));
    throw new Error("no workflow " + name);
  }

  run(name, params) {
    const stub = { GLOBAL_INVENTORY_VALIDATION: { code: "200", message: "Sufficient stock" }, SUBTRACT_INVENTORY: { code: "200" },
      ADD_INVENTORY: { code: "200", unitPrice: 0 }, GENERATE_BATCH: { batch_number: "B-0001" }, HANDLING_UNIT: { code: "200" } }[name];
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
    if (nd.type === "if" || (nd.type === "code-node" && SC_NODES.has(nd.id))) this.trace.push(ctx.name + " " + nd.id);
    return super.node(nd, ctx);
  }
}

const picks = (k) => JSON.stringify(Array.from({ length: k }, (_, i) => ({ material_id: COMP, location_id: BIN, batch_id: null, balance_id: String(9000 + i),
  sm_quantity: 1, category: "Unrestricted" })));
const record = (page, nPicks, extra) => Object.assign({
  organization_id: ORG, issuing_operation_faci: "1123598813738675202", stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: page === "Add" ? "" : "Draft", item_id: PARENT, item_name: "TES500", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-19",
  issued_by: "sim", project_id: "", batch_no: "", storage_location_id: "2018912759311265793", location_id: BIN, inventory_category: "Unrestricted",
  remarks: "", remarks_2: "", remarks_3: "", reference_documents: [], page_status: page,
  stock_movement: [{ item_selection: COMP, item_name: "TES501", total_quantity: nPicks, requested_qty: nPicks, quantity_uom: UOM, temp_qty_data: picks(nPicks),
    temp_hu_data: "", line_index: 1 }],
}, page === "Add" ? {} : { id: IA }, extra || {});
const ITEMS = [{ id: PARENT, material_code: "TES500", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", assembly_cost: 0 },
  { id: COMP, material_code: "TES501", stock_control: 1, item_batch_management: 0, batch_number_genaration: "" }];
const HEADERS = { [SO]: { id: SO, so_no: "SO/1", so_status: "Issued", organization_id: ORG, customer_id: "7", customer_name: "C", is_deleted: 0 } };
const LINES = { [LINE]: { id: LINE, sales_order_id: SO, item_name: PARENT, so_quantity: "100", so_item_uom: UOM, delivered_qty: "0", line_status: "Issued", is_deleted: 0, line_index: 1 } };

function go(file, sc) {
  const e = new Sim(file, Object.assign({ items: ITEMS, lines: LINES, headers: HEADERS }, sc));
  const r = e.run("IA_SAVE", { allData: sc.allData, saveAs: sc.saveAs, pageStatus: sc.pageStatus });
  const steps = e.trace.filter((t) => t.startsWith("IA_SAVE ")).map((t) => t.slice(8));
  return { returned: r.returned, steps: steps, writes: e.writes, calls: e.calls, sqls: e.sqls };
}
// the Small Cycle nodes and RES-01's enrolment (code_node_RESenrol / if_RESenrol: no write while the switch is off)
const isSc = (s) => SC_NODES.has(s) || /^(if|code_node)_(SC|RES)/.test(s);
const header = (res) => res.writes.filter((w) => w[1] === "Item Assembly")[0];
const strip = (w) => JSON.parse(JSON.stringify(w, (k, v) => (SC_PROPS.indexOf(k) >= 0 ? undefined : v)).replace(/"last_transaction_date":"[^"]*"/g, '"last_transaction_date":"<now>"'));
const sameAsV12 = (label, sc) => {
  const a = go(V12, sc);
  const b = go(V13, sc);
  eq(label + ": answer == v12", b.returned, a.returned);
  eq(label + ": steps minus Small Cycle == v12", b.steps.filter((s) => !isSc(s)), a.steps);
  eq(label + ": writes minus the 7 props == v12", strip(b.writes), strip(a.writes));
  eq(label + ": callee calls == v12", b.calls, a.calls);
  return b;
};
const scOf = (res) => {
  const h = header(res);
  return h ? SC_PROPS.map((k) => (h[2] || {})[k] === undefined ? "<absent>" : h[2][k]) : null;
};
const refused = (label, res, re) => {
  eq(label + ": 400", res.returned && res.returned.code, "400");
  yes(label + ": message", re.test((res.returned && res.returned.message) || ""));
  eq(label + ": nothing written, no callee", [res.writes.length, res.calls.length], [0, 0]);
};
const EMPTY = ["", "", "", "", "", "", null];

// ---------------------------------------------------------------- legacy saves run like v12
let r = sameAsV12("Add, Completed, 3 picks, no SC keys", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3) });
eq("Add legacy: completed", r.returned.code, "200");
eq("Add legacy: no SC read", r.sqls.length, 0);
eq("Add legacy: the 7 props written empty", scOf(r), EMPTY);
r = sameAsV12("Edit, stored Draft, Completed, legacy payload", { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), scStored: {} });
eq("Edit legacy: one SC read", r.sqls.length, 1);
r = sameAsV12("Add, Draft, legacy", { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2) });
eq("Add Draft legacy: props empty", scOf(r), EMPTY);
r = sameAsV12("Clone, Draft, legacy", { stored: "Completed", saveAs: "Draft", pageStatus: "Clone", allData: record("Clone", 2, { id: IA, item_assembly_status: "Completed" }) });
eq("Clone legacy: no stored read", r.sqls.length, 0);
r = go(V13, { stored: "Processing", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), scStored: {} });
eq("guard refusal still first (Processing)", [r.returned.code, r.writes.length, r.steps.filter(isSc)], ["400", 0, []]);

// ---------------------------------------------------------------- merge: a legacy (mobile) payload keeps the stored values
const STORED = { source_so_id: SO, source_so_line_id: LINE, source_so_context_json: JSON.stringify({ v: 1, lineId: LINE, orderedQty: "100", history: [{ op: "LINK" }] }),
  bom_consumption_mode: "STANDARD", source_bom_id: "", bom_snapshot_json: "", planned_output_qty: "5.00000000", item_id: PARENT };
r = sameAsV12("Edit, Draft, mobile payload on a linked IA", { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2), scStored: STORED });
eq("mobile Draft keeps the stored link", scOf(r).slice(0, 2).concat([scOf(r)[6]]), [SO, LINE, "5.00000000"]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, { item_id: "999" }), scStored: STORED });
refused("mobile payload changing the FG of a linked IA", r, /item of this Item Assembly was changed/);
const goneLine = Object.assign({}, LINES[LINE], { is_deleted: 1 });
r = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 3), scStored: STORED, lines: { [LINE]: goneLine } });
eq("a removed source line does not block completion", r.returned.code, "200");

// ---------------------------------------------------------------- new links
const link = (extra) => Object.assign({ source_so_id: SO, source_so_line_id: LINE, source_so_context_json: "", bom_consumption_mode: "STANDARD",
  source_bom_id: "", bom_snapshot_json: "", planned_output_qty: "5" }, extra || {});
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link()) });
eq("Add Draft linked: saved", r.returned.code, "200");
let p = scOf(r);
eq("linked: pair + planned written", [p[0], p[1], p[6]], [SO, LINE, "5.00000000"]);
let ctx = JSON.parse(p[2]);
eq("linked: baseline from the server's read + LINK", [ctx.v, ctx.lineId, ctx.orderedQty, ctx.uomId, ctx.headerStatus, ctx.history.map((h) => h.op)], [1, LINE, "100", UOM, "Issued", ["LINK"]]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add",
  allData: record("Add", 2, link({ source_so_context_json: JSON.stringify({ v: 1, lineId: LINE, orderedQty: "999", history: [] }) })) });
eq("new link: the baseline comes from the server's read, not the client", JSON.parse(scOf(r)[2]).orderedQty, "100");
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link()), headers: { [SO]: Object.assign({}, HEADERS[SO], { so_status: "Completed" }) } });
refused("new link to a completed SO", r, /cannot be linked/);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ source_so_id: "123" })) });
refused("new link with a mismatched SO id", r, /does not belong/);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ source_so_id: "" })) });
refused("half a link", r, /incomplete/);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ source_so_line_id: "5" })) });
refused("new link to a missing line", r, /cannot be linked/);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ organization_id: "" })) });
refused("new link from an IA without an organization", r, /no organization/);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link()), member: 0 });
refused("new link by a user not assigned to the IA's organisation (FIX-03)", r, /not assigned to this organisation/);
yes("the membership read: the session user and the IA's organisation (FIX-03)", r.sqls.some((s) => {
  const q = s.replace(/\s+/g, " ");
  return q.indexOf("u.id = " + UID + " LIMIT 1") >= 0 && q.indexOf("(p.id = " + ORG + " OR FIND_IN_SET('" + ORG + "', p.ancestors) > 0)") >= 0;
}));
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2), scStored: STORED, member: 0 });
eq("an existing link saved by a user outside the organisation: saved (only a new link reads the SO line)", r.returned.code, "200");
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ planned_output_qty: "" })) });
eq("planned cleared -> null", scOf(r)[6], null);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, { source_so_id: "", source_so_line_id: "" }), scStored: STORED });
p = scOf(r);
eq("unlink: pair cleared, history UNLINK", [p[0], p[1], JSON.parse(p[2]).history.map((h) => h.op)], ["", "", ["LINK", "UNLINK"]]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ bom_consumption_mode: "SIDEWAYS" })) });
refused("unknown mode", r, /mode/);
// ---------------------------------------------------------------- re-link through Edit, the item rule, the server owns the baseline and history
const LINE2 = "2112017989484847108";
const LINES2 = Object.assign({}, LINES, { [LINE2]: Object.assign({}, LINES[LINE], { id: LINE2, so_quantity: "80", line_index: 2 }) });
const STORED120 = Object.assign({}, STORED, { source_so_context_json: JSON.stringify({ v: 1, lineId: LINE, orderedQty: "120", uomId: UOM, history: [{ op: "LINK", lineId: LINE }] }) });
const clientCtx = (lineId, ops) => JSON.stringify({ v: 1, lineId: lineId, orderedQty: "1", history: ops.map((op) => ({ op: op })) });
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, link({ source_so_line_id: LINE2, source_so_context_json: clientCtx(LINE2, ["LINK", "RELINK"]) })),
  scStored: STORED120, lines: LINES2 });
eq("re-link through Edit: saved", r.returned.code, "200");
ctx = JSON.parse(scOf(r)[2] || "{}");
eq("re-link through Edit: the new line's baseline from the server, the stored history + one RELINK", [scOf(r)[1], ctx.lineId, ctx.orderedQty, (ctx.history || []).map((h) => h.op)],
  [LINE2, LINE2, "80", ["LINK", "RELINK"]]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, link({ source_so_line_id: LINE2 })), scStored: STORED120,
  lines: Object.assign({}, LINES2, { [LINE2]: Object.assign({}, LINES2[LINE2], { line_status: "Cancelled" }) }) });
refused("re-link through Edit to an ineligible line", r, /cannot be linked/);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, link({ source_so_context_json: clientCtx(LINE, ["LINK", "LINK"]) })), scStored: STORED120 });
ctx = JSON.parse(scOf(r)[2] || "{}");
eq("an unchanged link keeps the stored baseline and history, not the client's", [ctx.orderedQty, (ctx.history || []).length], ["120", 1]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, link({ source_so_context_json: clientCtx(LINE, ["LINK"]) })) });
eq("a new IA's link history is one LINK, whatever the client sent", (JSON.parse(scOf(r)[2] || "{}").history || []).map((h) => h.op), ["LINK"]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, { source_so_id: "", source_so_line_id: "", source_so_context_json: clientCtx("", []) }),
  scStored: STORED120 });
ctx = JSON.parse(scOf(r)[2] || "{}");
eq("unlink: the stored context + UNLINK, not the client's", [(ctx.history || []).map((h) => h.op), ctx.orderedQty], [["LINK", "UNLINK"], "120"]);
const UNLINKED = Object.assign({}, STORED, { source_so_id: "", source_so_line_id: "",
  source_so_context_json: JSON.stringify({ v: 1, lineId: "", orderedQty: "120", history: [{ op: "LINK" }, { op: "UNLINK" }] }) });
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2, { source_so_id: "", source_so_line_id: "", source_so_context_json: clientCtx("", ["LINK"]) }),
  scStored: UNLINKED });
eq("an unlinked IA keeps its stored context (an earlier link's history), not the client's", (JSON.parse(scOf(r)[2] || "{}").history || []).map((h) => h.op), ["LINK", "UNLINK"]);
r = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2, { source_so_id: "", source_so_line_id: "", source_so_context_json: clientCtx("", ["LINK"]) }) });
eq("a new unlinked IA has no context, whatever the client sent", scOf(r)[2], "");
for (const saveAs of ["Draft", "Completed"]) {
  r = go(V13, { stored: "Draft", saveAs: saveAs, pageStatus: "Edit", allData: record("Edit", 3), scStored: STORED, lines: { [LINE]: Object.assign({}, LINES[LINE], { item_name: "888" }) } });
  eq("the SO line's item changed, the IA's not: " + saveAs + " is not blocked (a warning)", r.returned && r.returned.code, "200");
}


// ---------------------------------------------------------------- enhanced snapshot checks
(async () => {
  const bom = { id: "77", parent_material_code: PARENT, parent_mat_bom_version: "V1", parent_mat_base_quantity: "1", parent_mat_base_uom: UOM, parent_mat_is_default: 1,
    is_active: 1, subform_sub_material: [{ bom_material_code: COMP, sub_material_qty: "1", sub_material_qty_uom: UOM, sub_material_wastage: 0, consume_type: "USE", bom_type: "standard" }] };
  const items = [{ id: PARENT, material_name: "TES500", based_uom: UOM, table_uom_conversion: [] }, { id: COMP, material_name: "TES501", based_uom: UOM, table_uom_conversion: [] }];
  const res = await B.scResolve({ mode: "FLAT", itemId: PARENT, itemUomId: UOM, outputQty: 3, expand: [], fg: items[0] },
    { readBoms: async (ids) => (ids.indexOf(PARENT) >= 0 ? [bom] : []), readItems: async (ids) => items.filter((i) => ids.indexOf(i.id) >= 0) });
  const snap = JSON.stringify(res.snapshot);
  const key = res.rows[0].key;
  const enhanced = (extra, lineExtra) => {
    const rec = record("Edit", 3, Object.assign(link({ bom_consumption_mode: "FLAT", source_bom_id: "77", bom_snapshot_json: snap }), { item_qty: 3 }, extra || {}));
    rec.stock_movement[0] = Object.assign(rec.stock_movement[0], { sc_ref_key: key, requested_qty: 3 }, lineExtra || {});
    return rec;
  };
  let e = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: enhanced(), scStored: Object.assign({}, STORED, { bom_consumption_mode: "FLAT" }) });
  eq("enhanced Flat completes", e.returned.code, "200");
  eq("enhanced: snapshot + mode + root BOM written", [scOf(e)[3], scOf(e)[4], scOf(e)[5] === snap], ["FLAT", "77", true]);
  e = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: enhanced({ bom_snapshot_json: "" }), scStored: STORED });
  refused("Flat without a snapshot", e, /Prepare the Flat BOM/);
  e = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: enhanced({ source_bom_id: "78" }), scStored: STORED });
  refused("snapshot of another BOM", e, /no longer matches/);
  e = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: enhanced({}, { requested_qty: 2 }), scStored: STORED });
  refused("reference drift on Completed", e, /reference quantity/);
  e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: enhanced({}, { requested_qty: 2 }), scStored: STORED });
  eq("drift not checked on Draft", e.returned.code, "200");

  // a mobile save sends each line back with its id but without sc_ref_key: the stored key is put back (non-empty, by line id)
  const mobile = (lineExtra) => {
    const rec = enhanced({}, Object.assign({ id: "5001" }, lineExtra || {}));
    delete rec.stock_movement[0].sc_ref_key;
    return rec;
  };
  const lineOf = (res) => ((header(res) || [])[2] || {}).stock_movement || [];
  const FLAT_STORED = Object.assign({}, STORED, { bom_consumption_mode: "FLAT" });
  e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: mobile(), scStored: FLAT_STORED, storedLines: { 5001: key } });
  eq("mobile Draft save: the line's stored key written back", [e.returned.code, lineOf(e).map((l) => l.sc_ref_key)], ["200", [key]]);
  yes("mobile Draft save: the stored keys read for that line only", /x\.id IN \(5001\)/.test(e.sqls[0] || ""));
  e = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: mobile({ requested_qty: 2 }), scStored: FLAT_STORED, storedLines: { 5001: key } });
  refused("mobile Completed save: the restored key makes the drift check apply", e, /reference quantity/);
  e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: enhanced({}, { id: "5001", sc_ref_key: "" }), scStored: FLAT_STORED, storedLines: { 5001: key } });
  eq("desktop save with an empty key (sent): kept empty, nothing read for it", [lineOf(e).map((l) => l.sc_ref_key), /x\.id IN \(0\)/.test(e.sqls[0] || "")], [[""], true]);
  const fresh = mobile();
  delete fresh.stock_movement[0].id;
  e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: fresh, scStored: FLAT_STORED, storedLines: { 5001: key } });
  eq("a new line (no id): no key added", lineOf(e).map((l) => Object.prototype.hasOwnProperty.call(l, "sc_ref_key")), [false]);
  e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: mobile(), scStored: FLAT_STORED, storedLines: { 5001: "" } });
  eq("a stored empty key: the line left as sent", lineOf(e).map((l) => Object.prototype.hasOwnProperty.call(l, "sc_ref_key")), [false]);

  // ---------------------------------------------------------------- RES-01 R3: enrolment and required_qty (switch ON variant; the build ships OFF)
  {
    const os = require("os");
    const text = fs.readFileSync(V13, "utf8");
    const off = "const RES_ENABLED = false;";
    eq("RES-01: the build ships with the switch OFF, one constant", text.split(off).length - 1, 1);
    const ON = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ia-res-")), "IA_SAVE.json");
    fs.writeFileSync(ON, text.replace(off, "const RES_ENABLED = true;"));
    const enrolOf = (res) => res.writes.filter((w) => w[0] === "update" && w[1] === "Item Assembly" && w[2].material_hold_status !== undefined).map((w) => [w[2].id, w[2].material_hold_status]);
    const idOf = (res) => (res.writes.find((w) => w[0] === "insert" && w[1] === "Item Assembly") || [0, 0, {}])[2].id;
    let e = go(ON, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2) });
    eq("ON, a new Draft: saved, then marked RESERVING (its new id), after the Draft write", [e.returned.code, enrolOf(e), e.writes.map((w) => w[0] + " " + w[1]).slice(-1)[0]],
      ["200", [[idOf(e), "RESERVING"]], "update Item Assembly"]);
    e = go(ON, { stored: "Completed", saveAs: "Draft", pageStatus: "Clone", allData: record("Clone", 2, { id: IA, item_assembly_status: "Completed" }) });
    eq("ON, a clone saved as Draft: marked RESERVING (the clone, never the source)", enrolOf(e), [[idOf(e), "RESERVING"]]);
    e = go(ON, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2), scStored: {}, hold: "" });
    eq("ON, an Edit of an IA that never reserved: not enrolled", enrolOf(e), []);
    e = go(ON, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 2), scStored: {}, hold: "FULL" });
    eq("ON, an Edit of an enrolled IA: RESERVING again", enrolOf(e), [[IA, "RESERVING"]]);
    e = go(ON, { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", 3) });
    eq("ON, a completion: never enrolled", [e.returned.code, enrolOf(e)], ["200", []]);
    e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Add", allData: record("Add", 2) });
    eq("OFF (the build): a new Draft is not enrolled", enrolOf(e), []);
    // required_qty: kept for a line sent without it (mobile), defaulted when empty, written as q8 text
    // the desktop sends sc_ref_key on every line; line 5001 (as mobile would) leaves out required_qty
    const lines = [{ id: "5001", item_selection: COMP, item_name: "A", total_quantity: 4, requested_qty: 4, sc_ref_key: "", quantity_uom: UOM, temp_qty_data: picks(1), temp_hu_data: "", line_index: 1 },
      { id: "5002", item_selection: COMP, item_name: "B", total_quantity: 2, requested_qty: 5, required_qty: null, sc_ref_key: "", quantity_uom: UOM, temp_qty_data: picks(1), temp_hu_data: "", line_index: 2 },
      { id: "5003", item_selection: COMP, item_name: "C", total_quantity: 3, requested_qty: 0, required_qty: "", sc_ref_key: "", quantity_uom: UOM, temp_qty_data: picks(1), temp_hu_data: "", line_index: 3 },
      { id: "5004", item_selection: COMP, item_name: "D", total_quantity: 1, requested_qty: 1, required_qty: "2.5", sc_ref_key: "", quantity_uom: UOM, temp_qty_data: picks(1), temp_hu_data: "", line_index: 4 }];
    const reqOf = (res) => ((header(res) || [])[2] || {}).stock_movement.map((l) => (Object.prototype.hasOwnProperty.call(l, "required_qty") ? l.required_qty : "<absent>"));
    e = go(ON, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: lines }), scStored: {}, hold: "FULL", storedReq: { 5001: "7.00000000" } });
    eq("ON, required_qty: kept (7) for a line sent without it, defaulted to the reference (5) or the quantity (3), typed 2.5 kept", reqOf(e),
      ["7.00000000", "5.00000000", "3.00000000", "2.50000000"]);
    yes("ON, required_qty: the stored values read for every line with an id", /x\.id IN \(5001,5002,5003,5004\)/.test(e.sqls[0] || ""));
    // following the BOM reference: a stored requirement equal to the stored reference follows a new reference (a legacy re-scale, mobile),
    // unless the client changed it; one set apart from the reference stays
    const follow = [Object.assign({}, lines[0], { requested_qty: 20, total_quantity: 20 }), Object.assign({}, lines[1], { requested_qty: 20, required_qty: "10.00000000" }),
      Object.assign({}, lines[2], { requested_qty: 20, required_qty: "12" }), Object.assign({}, lines[3], { requested_qty: 20, required_qty: "7.00000000" })];
    e = go(ON, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: follow }), scStored: {}, hold: "FULL",
      storedReq: { 5001: "10.00000000", 5002: "10.00000000", 5003: "10.00000000", 5004: "7.00000000" }, storedRef: { 5001: "10.00000000", 5002: "10.00000000", 5003: "10.00000000", 5004: "10.00000000" } });
    eq("ON, required_qty follows a new reference while it was following (mobile, unchanged), not when typed or set apart", reqOf(e),
      ["20.00000000", "20.00000000", "12.00000000", "7.00000000"]);
    // the screen's Reserved / Short figures are display only: never written
    const shownLines = lines.map((l) => Object.assign({}, l, { res_reserved: "20", res_short: "5" }));
    const dropped = (res) => ((header(res) || [])[2] || {}).stock_movement.every((l) => !("res_reserved" in l) && !("res_short" in l));
    e = go(ON, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: shownLines }), scStored: {}, hold: "FULL" });
    yes("ON: the screen's Reserved / Short never written", dropped(e));
    e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: shownLines }), scStored: {}, hold: "FULL" });
    yes("OFF: the screen's Reserved / Short never written either", dropped(e));
    e = go(V13, { stored: "Draft", saveAs: "Draft", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: lines }), scStored: {}, hold: "FULL", storedReq: { 5001: "7.00000000" } });
    eq("OFF, required_qty: as sent (nothing kept or defaulted)", reqOf(e), ["<absent>", null, "", "2.5"]);
  }

  // ---------------------------------------------------------------- RES-01 R4: a completion issues the held part of each pick from Reserved
  {
    const os = require("os");
    const ON = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ia-res4-")), "IA_SAVE.json");
    fs.writeFileSync(ON, fs.readFileSync(V13, "utf8").replace("const RES_ENABLED = false;", "const RES_ENABLED = true;"));
    const pk = (qty, cat) => ({ material_id: COMP, location_id: BIN, batch_id: null, balance_id: "9001", sm_quantity: qty, category: cat || "Unrestricted" });
    const held = [{ id: "7001", status: "Allocated", doc_line_id: "5001", material_id: COMP, bin_location: BIN, batch_id: null, from_category: "Unrestricted", open_qty: "2", item_uom: UOM },
      { id: "7002", status: "Allocated", doc_line_id: "5001", material_id: COMP, bin_location: BIN, batch_id: null, from_category: "Blocked", open_qty: "1", item_uom: UOM }];
    const completeLine = { id: "5001", item_selection: COMP, item_name: "TES501", total_quantity: 5, requested_qty: 5, sc_ref_key: "", required_qty: "5", quantity_uom: UOM,
      temp_qty_data: JSON.stringify([pk(3), pk(2, "Blocked")]), temp_hu_data: "", line_index: 1 };
    const complete = (extra, sc) => go(ON, Object.assign({ stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, Object.assign({ stock_movement: [completeLine] }, extra || {})),
      scStored: {}, hold: "FULL", res: { rows: held, live: 0 } }, sc || {}));
    const called = (res, name) => res.calls.filter((c) => c[0] === name).map((c) => [c[1].category || c[1].inventory_category, c[1].quantity]);
    let e = complete();
    eq("R4: the held 2 (Unrestricted) and 1 (Blocked) checked and issued from Reserved, the rest as picked", [e.returned.code, called(e, "GLOBAL_INVENTORY_VALIDATION"), called(e, "SUBTRACT_INVENTORY")],
      ["200", [["Reserved", 2], ["Unrestricted", 1], ["Reserved", 1], ["Blocked", 1]], [["Reserved", 2], ["Unrestricted", 1], ["Reserved", 1], ["Blocked", 1]]]);
    eq("R4: the saved line keeps the picks as made", JSON.parse(((header(e) || [])[2] || {}).stock_movement[0].temp_qty_data).map((x) => [x.category, x.sm_quantity]),
      [["Unrestricted", 3], ["Blocked", 2]]);
    e = complete({ stock_movement: [Object.assign({}, completeLine, { total_quantity: 3, temp_qty_data: JSON.stringify([pk(1), pk(2)]) })] });
    eq("R4: two picks on one held stock: the hold (2) used once, in pick order", called(e, "SUBTRACT_INVENTORY"), [["Reserved", 1], ["Reserved", 1], ["Unrestricted", 1]]);
    e = complete({}, { res: { rows: held, live: 1 } });
    eq("R4: a reservation running (live ticket): 409, nothing written or moved", [e.returned.code, e.writes.length, e.calls.filter((c) => c[0] === "SUBTRACT_INVENTORY").length], ["409", 0, 0]);
    yes("R4: the 409 says why", /being reserved/.test(e.returned.message || ""));
    e = complete({}, { res: { rows: held.concat([{ id: "7003", status: "Releasing", doc_line_id: "5001", material_id: COMP, bin_location: BIN, batch_id: null, from_category: "Unrestricted",
      open_qty: "1", item_uom: UOM }]), live: 0 } });
    eq("R4: a hold in flight (Releasing): 409", [e.returned.code, e.writes.length], ["409", 0]);
    e = complete({}, { hold: "" });
    eq("R4: an IA that never reserved: nothing read, issued as picked", [e.sqls.some((s) => /on_reserved_gd/.test(s)), called(e, "SUBTRACT_INVENTORY")], [false, [["Unrestricted", 3], ["Blocked", 2]]]);
    e = go(ON, { stored: "Draft", saveAs: "Completed", pageStatus: "Clone", allData: record("Clone", 1, { id: IA, stock_movement: [completeLine] }), hold: "FULL", res: { rows: held, live: 0 } });
    eq("R4: a clone completed at once (the source's id in the payload): the source's holds never used", [e.sqls.some((s) => /on_reserved_gd/.test(s)), called(e, "SUBTRACT_INVENTORY")],
      [false, [["Unrestricted", 3], ["Blocked", 2]]]);
    e = complete({}, {});
    const offE = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: [completeLine] }), scStored: {}, hold: "FULL", res: { rows: held, live: 0 } });
    // review I4: the switch only makes holds; an IA that holds stock completes from it even with the switch off (never stranded)
    eq("R4, switch off, an IA that holds stock: still issued from its holds", [offE.returned.code, offE.sqls.some((s) => /on_reserved_gd/.test(s)), called(offE, "SUBTRACT_INVENTORY")],
      ["200", true, [["Reserved", 2], ["Unrestricted", 1], ["Reserved", 1], ["Blocked", 1]]]);
    const offN = go(V13, { stored: "Draft", saveAs: "Completed", pageStatus: "Edit", allData: record("Edit", 1, { stock_movement: [completeLine] }), scStored: {}, hold: "", res: { rows: held, live: 0 } });
    eq("R4, switch off, an IA that never reserved: nothing read, issued as picked", [offN.sqls.some((s) => /on_reserved_gd/.test(s)), called(offN, "SUBTRACT_INVENTORY")],
      [false, [["Unrestricted", 3], ["Blocked", 2]]]);
  }

  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.log("CRASH " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
