// Node data (what nodes_data logs) of the old and the lean workflows at N lines, on payloads built from real recorded
// documents (templates kept in memory only). Calibrated first: the old workflow replayed on one recorded run must log
// about what that run logged. Usage: node size.js
const { MeterEngine } = require("./meter");
const { GrDB, mocks } = require("./grdb");
const F = require("./fixtures");

const clone = (o) => JSON.parse(JSON.stringify(o));
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./meter");
// the old GR_CREATED as it would run without its Phase 0 500-line refusal (the "before" at 2,000 lines)
const NOGUARD = path.join(F.FIX, "GR_CREATED_OLD_noguard.json");
{
  const doc = JSON.parse(fs.readFileSync(PATHS.GR_CREATED_OLD, "utf8"));
  doc.nodes = doc.nodes.filter((n) => n.id !== "if_GcSizeGuard");
  fs.writeFileSync(NOGUARD, JSON.stringify(doc));
}
const MB = (b) => (b / 1048576).toFixed(2) + " MB";

// read mocks for the old workflow's search / get nodes, from in-memory documents
function oldMocks(docs) {
  const m = mocks();
  const env = (rows) => ({ total: rows.length, count: rows.length, data: rows });
  m.read.search_origGR = () => env(docs.gr ? [docs.gr] : []);
  m.read.search_po = () => env(docs.pos);
  m.read.search_items = () => env(docs.items);
  m.read.get_gr = () => ({ count: 1, data: docs.gr });
  m.read.search_po_cancel = null;
  return m;
}

// ------------------------------------------------------------------------------------------------ calibration
function calibrate() {
  const runs = F.runs("prod", "GR_CREATED").filter((r) => r.exit_node === "ret_success" && F.nodeOf(r, "search_origGR"));
  runs.sort((a, b) => JSON.stringify(b.nodes).length - JSON.stringify(a.nodes).length);
  const run = runs[0];
  const docs = {
    gr: (() => { let d = F.respOf(run, "search_origGR").data.data; return Array.isArray(d) ? d[0] : d; })(),
    pos: F.respOf(run, "search_po").data.data,
    items: F.respOf(run, "search_items").data.data,
  };
  const { db, params } = F.createdCase(run);
  const e = new MeterEngine({ db, mocks: oldMocks(docs) });
  e.run("GR_CREATED_OLD", params);
  const real = (run.nodes || []).reduce((s, n) => s + (n && n.node_id ? String(n.request_json_data || "").length + String(n.response_json_data || "").length : 0), 0);
  const realTotal = JSON.stringify(run.nodes).length;
  console.log("calibration (prod run, " + F.flat(params.allData.table_gr).length + " lines): recorded nodes_data " + MB(realTotal) +
              " (req+resp " + MB(real) + "), meter on the old workflow " + MB(e.nodeData()));
  return { run, docs };
}

// ------------------------------------------------------------------------------------------------ N-line documents
function synth(t, N, nItems) {
  const ad = clone(t.run.req.request_json.allData);
  const lineT = clone(F.flat(ad.table_gr)[0]);
  delete lineT.children;
  const poT = clone(t.docs.pos[0]);
  const poLineT = clone(F.flat(poT.table_po)[0]);
  delete poLineT.children;
  const itemT = clone(t.docs.items[0]);
  const grT = clone(t.docs.gr);
  const grLineT = clone(F.flat(grT.table_gr)[0]);
  delete grLineT.children;
  const uom = String(lineT.ordered_qty_uom || "1");
  let n = 6000000000000000000n;
  const id = () => (n += 1n).toString();
  const po = Object.assign(clone(poT), { id: id(), table_po: [] });
  const items = [];
  for (let k = 0; k < nItems; k++) {
    const it = Object.assign(clone(itemT), { id: id() });
    it.table_uom_conversion = [Object.assign(clone((itemT.table_uom_conversion || [{}])[0] || {}), { alt_uom_id: uom, over_receive_tolerance: 0 })];
    items.push(it);
  }
  ad.table_gr = [];
  const gr = Object.assign(clone(grT), { id: id(), gr_status: "Created", table_gr: [] });
  for (let i = 0; i < N; i++) {
    const lid = id();
    po.table_po.push(Object.assign(clone(poLineT), { id: lid, quantity: 10, received_qty: 0, created_received_qty: 1, item_bundle_id: null, item_id: items[i % nItems].id }));
    const common = { po_line_item_id: lid, item_id: items[i % nItems].id, received_qty: 1, base_received_qty: 1, line_po_id: po.id, ordered_qty_uom: uom,
                     is_split: "No", parent_or_child: "Parent", item_bundle_id: null, location_id: lineT.location_id || "1", inv_category: "Unrestricted",
                     item_batch_no: lineT.item_batch_no || "-" };
    ad.table_gr.push(Object.assign(clone(lineT), common));
    gr.table_gr.push(Object.assign(clone(grLineT), common, { id: id() }));
  }
  ad.id = gr.id;
  ad.previous_status = "Created";
  ad.gr_status = "Created";
  return { ad, docs: { gr, pos: [po], items } };
}

function seedNew(db, docs) {
  F.loadPOs(db, docs.pos);
  F.loadItems(db, docs.items);
  F.loadGR(db, docs.gr);
}

function measure(t, N, nItems) {
  const s = synth(t, N, nItems);
  const rows = [];
  for (const mode of ["Add", "Edit"]) {
    const params = { allData: clone(s.ad), pageStatus: mode, saveAs: "Created", continueZero: "", continueOvercommit: "Yes" };
    if (mode === "Add") params.allData.id = "";
    const dbo = new GrDB();
    seedNew(dbo, s.docs);
    const eo = new MeterEngine({ db: dbo, mocks: oldMocks(s.docs) });
    const ro = eo.run(NOGUARD, clone(params)).returned;
    const dbn = new GrDB();
    seedNew(dbn, s.docs);
    const en = new MeterEngine({ db: dbn, mocks: mocks() });
    const rn = en.run("GR_CREATED", clone(params)).returned;
    rows.push({ wf: "GR_CREATED " + mode, N, oldB: eo.nodeData(), newB: en.nodeData(), oldW: eo.writeBytes, newW: en.writeBytes, codes: ro.code + "/" + rn.code,
                top: en.meter.slice().sort((a, b) => b.req + b.resp - a.req - a.resp).slice(0, 3).map((m) => m.id + " " + MB(m.req + m.resp)).join(", ") });
  }
  // cancel of the stored Created GR
  const dbo = new GrDB();
  seedNew(dbo, s.docs);
  const eo = new MeterEngine({ db: dbo, mocks: oldMocks(s.docs) });
  const p = { action: "cancel", gr_id: s.docs.gr.id, gr_no: s.docs.gr.gr_no, po_id: [s.docs.pos[0].id] };
  const ro = eo.run("GR_CANCEL_CREATED_OLD", clone(p)).returned;
  const dbn = new GrDB();
  seedNew(dbn, s.docs);
  const en = new MeterEngine({ db: dbn, mocks: mocks() });
  const rn = en.run("GR_CANCEL_CREATED", clone(p)).returned;
  rows.push({ wf: "GR_CANCEL_CREATED", N, oldB: eo.nodeData(), newB: en.nodeData(), oldW: eo.writeBytes, newW: en.writeBytes, codes: ro.code + "/" + rn.code,
              top: en.meter.slice().sort((a, b) => b.req + b.resp - a.req - a.resp).slice(0, 3).map((m) => m.id + " " + MB(m.req + m.resp)).join(", ") });
  return rows;
}

const t = calibrate();
console.log("template: GR line " + JSON.stringify(F.flat(t.run.req.request_json.allData.table_gr)[0]).length + " B, PO line " +
            JSON.stringify(F.flat(t.docs.pos[0].table_po)[0]).length + " B, item doc " + JSON.stringify(t.docs.items[0]).length + " B");
for (const [N, nItems] of [[500, 500], [2000, 2000], [2000, 100]]) {
  for (const r of measure(t, N, nItems)) {
    console.log(`${r.wf.padEnd(18)} ${String(N).padStart(5)} lines / ${String(nItems).padStart(4)} items: node data old ${MB(r.oldB).padStart(9)} -> new ${MB(r.newB).padStart(9)}` +
                ` | add/update payload old ${MB(r.oldW)} -> new ${MB(r.newW)} | answers ${r.codes} | biggest new: ${r.top}`);
  }
}
