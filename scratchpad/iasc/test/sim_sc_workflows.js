// node scratchpad/iasc/test/sim_sc_workflows.js [dir] - the BUILT SO_IA_PROJECTION and IA_SC_RELINK run end to end in the iav2 interpreter
// (scratchpad/iav2/lib/sim/engine.js) with SQL mocks that answer like MySQL and assert how the placeholders were filled.
const path = require("path");
const { Engine } = require(path.join(__dirname, "..", "..", "iav2", "lib", "sim", "engine.js"));

const DIR = process.argv[2] || path.join(__dirname, "..", "..", "..", "Item Assembly & BOM", "SmallCycle");
let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
};
const yes = (label, v) => eq(label, !!v, true);

const T = "000000";
const ORG = "1123598813738675201";
const SO = "2112017989476458498";
const LINE = "2112017989484847107";
const LINE2 = "2112017989484847199";
const ITEM = "2098252135296131074";
const EA = "100";
const world = () => ({
  lines: { [LINE]: { id: LINE, sales_order_id: SO, item_name: ITEM, so_quantity: "100", so_item_uom: EA, delivered_qty: "30", line_status: "Processing", is_deleted: 0, line_index: 1 } },
  header: { id: SO, so_no: "SO/1", so_status: "Processing", organization_id: ORG, customer_id: "7", customer_name: "Cust", is_deleted: 0 },
  fg: { id: ITEM, material_name: "FG", based_uom: EA, table_uom_conversion: [] },
  ias: [
    { id: "11", no: "IA-11", status: "Completed", item_id: ITEM, item_qty: "50", item_uom: EA, planned_output_qty: "60", mode: "FLAT", is_deleted: 0, source_so_id: SO, source_so_line_id: LINE, organization_id: ORG },
    { id: "12", no: "IA-12", status: "Draft", item_id: ITEM, item_qty: "40", item_uom: EA, planned_output_qty: null, mode: "STANDARD", is_deleted: 0, source_so_id: SO, source_so_line_id: LINE, organization_id: ORG },
  ],
});
const J = (o) => ({ j: JSON.stringify(o) });
const has = (sql, frag) => {
  if (sql.indexOf(frag) < 0) throw new Error("SQL is missing " + frag + ":\n" + sql);
};
const projMocks = (w, seen) => ({
  sql_node_SPline: (sql) => {
    has(sql, "l.tenant_id = '" + T + "'");
    const id = /l\.id = (\d+)/.exec(sql)[1];
    seen.line = id;
    const l = w.lines[id] || null;
    return [J({ line: l, header: w.header })];
  },
  sql_node_SPias: (sql) => {
    has(sql, "h.source_so_line_id = '");
    has(sql, "h.organization_id = '" + ORG + "'");
    const id = /h\.source_so_line_id = '(\d+)'/.exec(sql)[1];
    return w.ias.filter((x) => x.source_so_line_id === id).map(J);
  },
  sql_node_SPfg: (sql) => {
    has(sql, "i.id = " + ITEM);
    return [J(w.fg)];
  },
  sql_node_SPrelink: (sql) => {
    has(sql, "l.item_name = '" + ITEM + "'");
    return Object.keys(w.lines).map((k) => w.lines[k]).filter((l) => !l.is_deleted).map((l) => J({ id: l.id, line_index: l.line_index }));
  },
  sql_node_SPorphans: () => [],
  sql_node_SPcand: (sql) => {
    has(sql, "l.item_name = '" + ITEM + "'");
    return Object.keys(w.lines).map((k) => w.lines[k]).map((l) => J({ line: l, header: w.header }));
  },
  sql_node_SPcandIas: () => w.ias.map(J),
  sql_node_SPcfg: () => [J(w.fg)],
});
const run = (name, mocks, params, db) => {
  const eng = new Engine({ dir: DIR, db: db || { tenantId: T }, mocks: { sql: mocks, read: {} } });
  return eng.run(name, params).returned;
};
const P = (extra) => Object.assign({ operation: "SUMMARY", so_id: SO, so_line_id: LINE, item_id: ITEM, exclude_ia_id: "", organization_id: ORG,
  proposal_qty: "", proposal_uom_id: "", baseline: "" }, extra || {});
const parse = (r) => JSON.parse(r.result_json || "null");

// ---------------------------------------------------------------- SO_IA_PROJECTION
let w = world();
let seen = {};
let r = run("SO_IA_PROJECTION", projMocks(w, seen), P({ operation: "" }));
eq("bad operation -> 400", [r.code, /operation/.test(r.message)], ["400", true]);
r = run("SO_IA_PROJECTION", projMocks(w, seen), P({ so_line_id: "12x" }));
eq("bad line id -> 400", r.code, "400");
r = run("SO_IA_PROJECTION", projMocks(w, seen), P({ organization_id: "" }));
eq("no organisation -> 400", r.code, "400");
r = run("SO_IA_PROJECTION", projMocks(w, seen), P(), { tenantId: "" });
eq("no session tenant -> 400", [r.code, /tenant/.test(r.message)], ["400", true]);
r = run("SO_IA_PROJECTION", projMocks(w, seen), P());
let x = parse(r);
eq("SUMMARY 200", r.code, "200");
eq("SUMMARY section 11 step 5 figures", [x.totals.ordered, x.totals.delivered, x.totals.produced, x.totals.open, x.totals.suggestion], [100, 30, 50, 40, 10]);
eq("SUMMARY carries the line and header", [x.line.id, x.header.so_no], [LINE, "SO/1"]);
eq("SUMMARY read the right line", seen.line, LINE);
r = run("SO_IA_PROJECTION", projMocks(w, seen), P({ exclude_ia_id: "12", proposal_qty: "50", proposal_uom_id: EA }));
x = parse(r);
eq("SUMMARY editing Draft 12 to 50: suggest 50, excess 0", [x.totals.suggestion, x.totals.excess], [50, 0]);
r = run("SO_IA_PROJECTION", projMocks(w, seen), P({ exclude_ia_id: "12", proposal_qty: "70", proposal_uom_id: EA }));
eq("SUMMARY excess 20 warns", [parse(r).totals.excess, parse(r).warnings.map((v) => v.code).indexOf("EXCESS") >= 0], [20, true]);
r = run("SO_IA_PROJECTION", projMocks(w, seen), P({ baseline: JSON.stringify({ v: 1, orderedQty: "120", uomId: EA }) }));
yes("SUMMARY baseline reduction warns", parse(r).warnings.some((v) => v.code === "REDUCED"));
w = world();
w.header.organization_id = "999";
r = run("SO_IA_PROJECTION", projMocks(w, {}), P());
eq("SUMMARY of another organization's line: 400, no figures", [r.code, r.result_json || "", /another organization/.test(r.message || "")], ["400", "", true]);
w = world();
w.lines[LINE].is_deleted = 1;
w.lines[LINE2] = Object.assign({}, w.lines[LINE], { id: LINE2, is_deleted: 0, line_index: 2 });
r = run("SO_IA_PROJECTION", projMocks(w, {}), P());
x = parse(r);
eq("SUMMARY removed line: LINE_REMOVED + the live candidate", [x.warnings.some((v) => v.code === "LINE_REMOVED"), x.candidates.map((c) => c.id)], [true, [LINE2]]);
w = world();
r = run("SO_IA_PROJECTION", projMocks(w, {}), P({ operation: "CANDIDATES", so_line_id: "" }));
x = parse(r);
eq("CANDIDATES: the line with its suggestion", [r.code, x.candidates.map((c) => [c.lineId, c.suggestion]), x.capped], ["200", [[LINE, 10]], "NO"]);

// ---------------------------------------------------------------- IA_SC_RELINK
const relink = (ia, lines, params) => {
  const writes = [];
  const db = { tenantId: T, update: (table, rows) => {
    writes.push({ table: table, rows: rows });
    rows.forEach((row) => Object.keys(row).forEach((k) => {
      if (k !== "__id") ia[k] = row[k];
    }));
    return rows.map((row) => ({ id: row.__id }));
  } };
  const mocks = {
    sql_node_RLia: (sql) => {
      has(sql, "h.id = " + ia.id);
      return [J(Object.assign({}, ia, { old_line_live: lines[ia.source_so_line_id] && !lines[ia.source_so_line_id].is_deleted ? 1 : 0 }))];
    },
    sql_node_RLline: (sql) => {
      const id = /l\.id = (\d+)/.exec(sql)[1];
      return [J({ line: lines[id] || null, header: world().header })];
    },
    sql_node_RLfg: () => [J(world().fg)],
    sql_node_RLback: () => [J(Object.assign({}, ia, { old_line_live: 1 }))],
  };
  const ret = run("IA_SC_RELINK", mocks, Object.assign({ ia_id: ia.id, so_line_id: LINE2, item_id: ITEM, organization_id: ORG }, params || {}), db);
  return { ret: ret, writes: writes };
};
const lines2 = () => {
  const l = world().lines;
  l[LINE].is_deleted = 1;
  l[LINE2] = Object.assign({}, l[LINE], { id: LINE2, is_deleted: 0, line_index: 2, so_quantity: "90" });
  return l;
};
const done = () => Object.assign({}, world().ias[0], { source_so_context_json: JSON.stringify({ v: 1, lineId: LINE, orderedQty: "100", history: [{ op: "LINK", lineId: LINE }] }) });
let o = relink(done(), lines2(), { ia_id: "x" });
eq("relink bad id -> 400, nothing written", [o.ret.code, o.writes.length], ["400", 0]);
o = relink(Object.assign(done(), { status: "Draft" }), lines2());
eq("relink a Draft -> 400 (edit it instead)", [o.ret.code, /Edit/.test(o.ret.message), o.writes.length], ["400", true, 0]);
o = relink(Object.assign(done(), { status: "Processing" }), lines2());
eq("relink while Processing -> 400 'being processed'", [o.ret.code, /being processed/.test(o.ret.message), o.writes.length], ["400", true, 0]);
o = relink(done(), world().lines);
eq("relink while the old line still exists -> 400", [o.ret.code, /still exists/.test(o.ret.message), o.writes.length], ["400", true, 0]);
const other = lines2();
other[LINE2].sales_order_id = "999";
o = relink(done(), other);
eq("relink to another SO -> 400", [o.ret.code, o.writes.length], ["400", 0]);
const diffItem = lines2();
diffItem[LINE2].item_name = "77";
o = relink(done(), diffItem);
eq("relink to another item -> 400", [o.ret.code, o.writes.length], ["400", 0]);
const ia = done();
o = relink(ia, lines2());
eq("relink repairs the orphan -> 200", [o.ret.code, o.writes.length, o.writes[0] && o.writes[0].rows.length], ["200", 1, 1]);
const ctx = JSON.parse(ia.source_so_context_json);
eq("relink writes the new line + baseline", [ia.source_so_line_id, ctx.lineId, ctx.orderedQty, ctx.history.map((h) => h.op)], [LINE2, LINE2, "90", ["LINK", "RELINK"]]);
eq("relink writes only the source columns", Object.keys(o.writes[0].rows[0]).sort(), ["__id", "source_so_context_json", "source_so_line_id"]);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
