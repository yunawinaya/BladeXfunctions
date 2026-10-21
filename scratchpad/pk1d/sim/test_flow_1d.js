// Picking V2 1d end to end on the REAL patched JSONs: a real CONFIRM picks first (SUBMIT -> WORKER -> PREPARE -> COMMIT), then
// FORCE_COMPLETE: SUBMIT -> WORKER (PREPARE -> PICKING_FC_DRIVE -> ... -> COMMIT). The screen is played as the list handler will:
// each tick the WORKER, then GD_EDIT_WORKER for every job STATUS names in kick. GD Edit V2 is the mini one (stubs_gde.js).
// SIZES=1 prints the largest request per workflow (a top-level call's node data, its nested runs included).
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../pk1c/sim/engine.js"));
const { DB } = require(path.join(__dirname, "../../pk1c/sim/db.js"));
const { install, switchesOn } = require(path.join(__dirname, "../../pk1c/sim/stubs.js"));
const { eq, truthy, done } = require(path.join(__dirname, "../../gdc/pkv2tools/harness.js"));
const { mocks1d } = require(path.join(__dirname, "mocks_1d.js"));
const { miniGde } = require(path.join(__dirname, "stubs_gde.js"));

const DIR = process.env.PK_OUT || path.join(__dirname, "../../../Picking/AsyncV2");
const ORG = "1901545950162329602", PLANT = "7001", ITEM = "6001", UOM = "12001";
const SIZES = {};
let FLOW = "";

// gds: [{ lines, qty, so: line -> SO line id }]; every line allocated at A-01 / B1, its reservation and stock reserved
function seed(opts) {
  const o = Object.assign({ gds: [{ lines: 3 }], qty: 5, packing: 0 }, opts || {});
  const db = new DB();
  db.t.setup.push({ id: "1", organization_id: ORG, picking_after: "Goods Delivery", allow_full_picking: 0, auto_completed_gd: 0, is_loading_bay: 0 });
  db.t.psetup.push({ id: "1", organization_id: ORG, packing_required: o.packing, auto_trigger_pkg: o.packing, packing_mode: "Basic" });
  db.t.rules.push({ id: "R1", department_id: ORG, is_default: 1, is_draft: 0 });
  db.t.items.push({ id: ITEM, based_uom: UOM, serial_number_management: 0 });
  db.t.bins.push({ id: "4001", plant_id: PLANT, bin_location_combine: "A-01" });
  db.t.batches.push({ id: "2001", material_id: ITEM, plant_id: PLANT, batch_number: "B1" });
  db.t.so.push({ id: "7101", customer_name: "C1", cust_billing_address: "A", cust_shipping_address: "B" });
  db.t.bal = { [ITEM + "|4001|2001"]: { Unrestricted: 100, Reserved: 0 } };
  const p = { id: "9001", to_id: "PI-1", to_status: "Created", is_processing: 0, is_deleted: 0, organization_id: ORG, plant_id: PLANT, is_loading_bay: 0, gd_no: [], delivery_no: "",
    so_no: "SO/1", created_by: "admin", customer_id: ["C1"], remarks: "", update_time: db.now + 8 * 3600 * 1000 - 3600 * 1000 };
  db.t.picking.push(p);
  let k = 0;
  o.gds.forEach((g, gi) => {
    const gdId = String(5001 + gi), gdNo = "GD/" + (gi + 1), q = g.qty || o.qty;
    db.t.gd.push({ id: gdId, gd_status: "Created", picking_status: "Created", delivery_no: gdNo, so_id: ["7101"], so_no: "SO/1", customer_name: "C1", plant_id: PLANT, organization_id: ORG,
      delivery_date: "2026-10-20", is_select_picking: 0, is_deleted: 0 });
    p.gd_no.push(gdId);
    for (let i = 0; i < g.lines; i++, k++) {
      const gl = String(600000 + k), sol = g.so ? g.so(i) : "SL" + k;
      const ent = [{ material_id: ITEM, location_id: "4001", batch_id: "2001", gd_quantity: q, unrestricted_qty: q, plant_id: PLANT, organization_id: ORG, is_deleted: 0 }];
      db.t.gdl.push({ id: gl, goods_delivery_id: gdId, material_id: ITEM, material_name: "Item " + k, gd_qty: q, base_qty: q, gd_order_quantity: q, gd_initial_delivered_qty: 0,
        picking_status: "Created", temp_qty_data: JSON.stringify(ent), view_stock: "Total: " + q + " PCS\n\nDETAILS:\n1. A-01: " + q + " PCS\n[Batch: B1]", good_delivery_uom_id: UOM,
        gd_order_uom_id: UOM, line_so_id: "7101", line_so_no: "SO/1", so_line_item_id: sol, plant_id: PLANT, organization_id: ORG, is_deleted: 0 });
      db.t.res.push({ id: String(900000 + k), doc_type: "Good Delivery", status: "Allocated", parent_id: "7101", parent_line_id: sol, parent_no: "SO/1", doc_no: gdNo, doc_id: gdId,
        doc_line_id: gl, material_id: ITEM, item_code: ITEM, item_name: "Item " + k, batch_id: "2001", bin_location: "4001", item_uom: UOM, reserved_qty: q, delivered_qty: 0, open_qty: q,
        reserved_date: "2026-10-20", line_no: i + 1, plant_id: PLANT, organization_id: ORG, target_gd_id: gdId, source_reserved_id: null, handling_unit_id: null, job_line_key: null, is_deleted: 0 });
      db.t.bal[ITEM + "|4001|2001"].Reserved += q;
      db.t.bal[ITEM + "|4001|2001"].Unrestricted -= q;
      db.t.lines.push({ id: String(800000 + k), transfer_order_id: "9001", item_code: ITEM, item_name: "Item " + k, item_desc: "", more_desc: "", item_uom: UOM, qty_to_pick: q,
        pending_process_qty: q, picked_qty: 0, line_status: "Open", gd_id: gdId, gd_no: gdNo, gd_line_id: gl, so_id: "7101", so_no: "SO/1", so_line_id: sol, source_bin: "4001",
        batch_no: "2001", row_type: "item", packing_conversion: 1, weight_conversion: 0.5, remark: "", is_deleted: 0 });
    }
  });
  db.t.bal[ITEM + "|4001|2001"].Unrestricted += 10000;
  p.delivery_no = db.t.gd.map((g) => g.delivery_no).join(", ");
  return db;
}

function engine(db, gdeOpts) {
  const e = new Engine({ dir: DIR, db: db, mocks: mocks1d() });
  e.st = install(e);
  switchesOn(e);
  // STAGE.FORCE_COMPLETE on, whatever the file ships
  const load0 = e.load.bind(e);
  e.load = (name) => {
    const doc = load0(name);
    if (name !== "PICKING_ASYNC_SUBMIT") return doc;
    const walk = (l) => { for (const n of l || []) { if (n.id === "code_node_PSdecide") return n; const r = walk(n.blocks); if (r) return r; } return null; };
    const n = walk(doc.nodes);
    if (n.data.script.code.indexOf("FORCE_COMPLETE: true }") >= 0) return doc;
    if (n.data.script.code.indexOf("FORCE_COMPLETE: false }") < 0) throw new Error("STAGE.FORCE_COMPLETE is not where the sim expects it");
    n.data.script.code = n.data.script.code.replace("FORCE_COMPLETE: false }", "FORCE_COMPLETE: true }");
    return doc;
  };
  e.gde = miniGde(db, gdeOpts);
  e.hooks1d = {};
  e.calls1d = [];
  const run1 = e.run.bind(e);
  let depth = 0, acc = 0;
  e.run = (name, params) => {
    e.calls1d.push(name);
    if (name === "GD_EDIT_SUBMIT") return { returned: e.gde.submit(params || {}), ctx: { bytes: 0 } };
    if (name === "GD_EDIT_WORKER") throw new Error("a workflow called GD_EDIT_WORKER: only the screen kicks it");
    if (e.hooks1d[name]) e.hooks1d[name](params);
    depth++;
    let r;
    try { r = run1(name, params); } finally { depth--; }
    acc += (r && r.ctx && r.ctx.bytes) || 0;
    if (depth === 0) { const k = FLOW + " " + name + (name === "PICKING_ASYNC_WORKER" && r.ctx && r.ctx.out && r.ctx.out.code_node_PWmid ? ":" + r.ctx.out.code_node_PWmid.route : ""); SIZES[k] = Math.max(SIZES[k] || 0, acc); acc = 0; }
    return r;
  };
  return e;
}

let keyN = 0;
const submit = (e, op, lines) => e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: op, idempotency_key: "KEY-1D-" + String(++keyN).padStart(12, "0"),
  payload: JSON.stringify({ lines: lines || [], header_patch: {} }), confirmed_by: "picker" }).returned;
const work = (e, jobId) => e.run("PICKING_ASYNC_WORKER", { job_id: jobId || "" }).returned;
const status = (e) => e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: "STATUS" }).returned;
const job = (db, id) => db.t.job.find((j) => j.id === id) || {};
const gdl = (db, id) => db.t.gdl.find((l) => l.id === id) || {};
const row = (db, id) => db.t.lines.find((l) => l.id === id) || {};
const bal = (db) => [db.t.bal[ITEM + "|4001|2001"].Unrestricted, db.t.bal[ITEM + "|4001|2001"].Reserved];
const edits = (db, gdId) => db.t.job.filter((j) => j.command === "EDIT_GD" && (!gdId || JSON.parse(j.request_payload).gd_id === gdId)).map((j) => j.job_status);
const FINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];

// picks: [[row id, qty]] confirmed in CONFIRMs of at most 500 lines
function confirm(e, db, picks) {
  for (let i = 0; i < picks.length; i += 500) {
    const r = submit(e, "CONFIRM", picks.slice(i, i + 500).map(([id, qty]) => ({ row_id: id, qty: qty })));
    if (r.route !== "QUEUED") throw new Error("confirm not queued: " + JSON.stringify(r).slice(0, 300));
    work(e, r.job_id);
    if (job(db, r.job_id).job_status !== "COMPLETED") throw new Error("confirm " + r.job_id + " ended " + job(db, r.job_id).job_status + ": " + job(db, r.job_id).error_message);
    db.advance(5);
  }
}

// the list handler: each tick the WORKER, then GD_EDIT_WORKER for every id STATUS names; quiet ticks (nothing to kick, the job not
// moving) -> the clock jumps (the user comes back later)
function follow(e, db, jobId, opt) {
  const o = Object.assign({ max: 400, jump: 1900 }, opt || {});
  let quiet = 0, last = "";
  for (let i = 0; i < o.max; i++) {
    if (o.beforeTick && o.beforeTick(i) === "STOP") return "STOPPED";
    work(e, jobId);
    const j = job(db, jobId);
    if (FINAL.includes(j.job_status)) return j.job_status;
    const st = status(e);
    for (const k of st.kick || []) e.gde.worker(k);
    const now = JSON.stringify([j.job_status, j.progress_message, edits(db)]);
    quiet = (st.kick || []).length === 0 && now === last ? quiet + 1 : 0;
    last = now;
    db.advance(quiet >= 3 ? o.jump : 3);
  }
  return "TIMEOUT";
}
const forceComplete = (e) => submit(e, "FORCE_COMPLETE", []);

// ---------------------------------------------------------------- A. one delivery: a partial line, a full line, an unpicked line
{
  FLOW = "A";
  const db = seed({ gds: [{ lines: 3 }], packing: 1 });
  const e = engine(db);
  confirm(e, db, [["800000", 2], ["800001", 5]]);
  eq("A: picked first: the Picking In Progress", db.t.picking[0].to_status, "In Progress");
  const r = forceComplete(e);
  eq("A: FORCE_COMPLETE queued", r.route, "QUEUED");
  const end = follow(e, db, r.job_id);
  const j = job(db, r.job_id);
  eq("A: COMPLETED with its message", [end, j.progress_message], ["COMPLETED", "PI-1 force completed: 1 delivery updated, 1 line(s) reduced, 1 removed"]);
  eq("A: the delivery shrunk to what was picked; the unpicked line removed",
    [[gdl(db, "600000").gd_qty, gdl(db, "600000").picking_status], [Number(gdl(db, "600001").gd_qty), gdl(db, "600001").picking_status], gdl(db, "600002").is_deleted],
    [["2.00000000", "Completed"], [5, "Completed"], 1]);
  eq("A: the shrunk line's allocation = its picks", JSON.parse(gdl(db, "600000").temp_qty_data).map((x) => [String(x.location_id), String(x.batch_id), Number(x.gd_quantity)]), [["4001", "2001", 2]]);
  eq("A: the unpicked quantity's stock back to Unrestricted (3 + 5)", bal(db), [10085 + 8, 7]);
  eq("A: reservations: the shrunk line keeps 2, the removed line's cancelled", [[db.t.res[0].open_qty, db.t.res[0].status], db.t.res[2].status], [[2, "Allocated"], "Cancelled"]);
  eq("A: the Picking Completed, unlocked; its rows closed", [db.t.picking[0].to_status, db.t.picking[0].is_processing, ["800000", "800001", "800002"].map((id) => [row(db, id).line_status, Number(row(db, id).pending_process_qty)])],
    ["Completed", 0, [["Completed", 0], ["Completed", 0], ["Cancelled", 0]]]);
  eq("A: the delivery header Completed", db.t.gd[0].picking_status, "Completed");
  const pk = db.t.packing.filter((x) => x.gd_id === "5001" && !x.is_deleted);
  eq("A: one Packing: what was picked, nothing of the removed line", [pk.length, pk.length ? pk[0].table_item_source.map((x) => [x.gd_line_id, x.picked_qty, x.line_status]) : []],
    [1, [["600000", 2, "Fully Picked"], ["600001", 5, "Fully Picked"]]]);
  eq("A: one edit job, COMPLETED; the GD's stock released once", [edits(db), e.gde.log.commits], [["COMPLETED"], ["5001"]]);
  truthy("A: no workflow ran GD_EDIT_WORKER", !e.calls1d.includes("GD_EDIT_WORKER"));
}

// ---------------------------------------------------------------- B. 8 deliveries sharing an SO line: each later one re-planned before its release
{
  FLOW = "B";
  const db = seed({ gds: Array.from({ length: 8 }, () => ({ lines: 2, so: (i) => (i === 0 ? "SL-SHARED" : null) })) });
  db.t.gdl.forEach((l, k) => { if (!l.so_line_item_id || l.so_line_item_id === "null") l.so_line_item_id = "SL-OWN-" + k; });
  db.t.lines.forEach((l) => { l.so_line_id = db.t.gdl.find((g) => g.id === l.gd_line_id).so_line_item_id; });
  const e = engine(db);
  confirm(e, db, db.t.lines.map((l, k) => [l.id, k % 2 ? 5 : 3]));
  const r = forceComplete(e);
  const end = follow(e, db, r.job_id);
  eq("B: COMPLETED", [end, job(db, r.job_id).error_message || null], ["COMPLETED", null]);
  eq("B: delivery 1 committed once; deliveries 2-8 re-planned once before release", db.t.gd.map((g) => edits(db, g.id).join("+")),
    ["COMPLETED"].concat(Array.from({ length: 7 }, () => "CANCELLED+COMPLETED")));
  eq("B: commits strictly in delivery order", e.gde.log.commits, db.t.gd.map((g) => g.id));
  eq("B: every first line shrunk to 3, every second kept at 5", db.t.gdl.map((l) => Number(l.gd_qty)), Array.from({ length: 16 }, (x, k) => (k % 2 ? 5 : 3)));
}

// ---------------------------------------------------------------- C. 15 x 4 lines, two deliveries cancelled before the force complete (900938)
{
  FLOW = "C";
  const db = seed({ gds: Array.from({ length: 15 }, () => ({ lines: 4 })) });
  const e = engine(db);
  const cancelled = ["5004", "5011"];
  confirm(e, db, db.t.lines.filter((l) => !cancelled.includes(l.gd_id)).map((l, k) => [l.id, (k % 4) + 1]));
  for (const g of db.t.gd) if (cancelled.includes(g.id)) g.gd_status = "Cancelled";
  const r = forceComplete(e);
  const end = follow(e, db, r.job_id);
  eq("C: COMPLETED: 13 deliveries updated", [end, job(db, r.job_id).progress_message], ["COMPLETED", "PI-1 force completed: 13 deliveries updated, 52 line(s) reduced, 0 removed"]);
  eq("C: the cancelled deliveries untouched (no edit), their rows Cancelled", [cancelled.map((g) => edits(db, g).length), db.t.lines.filter((l) => cancelled.includes(l.gd_id)).every((l) => l.line_status === "Cancelled")],
    [[0, 0], true]);
  eq("C: every other row Completed", db.t.lines.filter((l) => !cancelled.includes(l.gd_id)).every((l) => l.line_status === "Completed"), true);
}

// ---------------------------------------------------------------- D. 2,000 lines in one delivery
{
  FLOW = "D";
  const db = seed({ gds: [{ lines: 2000, qty: 2 }] });
  const e = engine(db);
  confirm(e, db, db.t.lines.map((l, k) => [l.id, k % 4 === 3 ? 0 : k % 2 ? 2 : 1]).filter(([, q]) => q > 0));
  const r = forceComplete(e);
  const end = follow(e, db, r.job_id, { max: 600 });
  const j = job(db, r.job_id);
  eq("D: COMPLETED", [end, j.progress_message], ["COMPLETED", "PI-1 force completed: 1 delivery updated, 1000 line(s) reduced, 500 removed"]);
  eq("D: 1,500 lines left, 500 removed", [db.t.gdl.filter((l) => !l.is_deleted).length, db.t.gdl.filter((l) => l.is_deleted).length], [1500, 500]);
  eq("D: the delivery's edit was one job, run by its own worker calls (never inside a WORKER request)", [edits(db), e.calls1d.includes("GD_EDIT_WORKER")], [["COMPLETED"], false]);
}

// ---------------------------------------------------------------- E. a live delivery with nothing picked: refused, nothing written
{
  FLOW = "E";
  const db = seed({ gds: [{ lines: 2 }, { lines: 2 }] });
  const e = engine(db);
  confirm(e, db, [["800000", 2]]);
  const before = JSON.stringify([db.t.gdl, db.t.res, db.t.bal]);
  const r = forceComplete(e);
  const end = follow(e, db, r.job_id);
  const j = job(db, r.job_id);
  eq("E: FAILED PK_FC_GD_UNPICKED naming GD/2; Picking unlocked", [end, j.error_code, /GD\/2/.test(j.error_message || ""), db.t.picking[0].is_processing], ["FAILED", "PK_FC_GD_UNPICKED", true, 0]);
  eq("E: no edit job; the deliveries, reservations and stock unchanged", [edits(db).length, JSON.stringify([db.t.gdl, db.t.res, db.t.bal]) === before], [0, true]);
}

// ---------------------------------------------------------------- F1. a SUBMIT stop at delivery 5 of 8
{
  FLOW = "F1";
  const db = seed({ gds: Array.from({ length: 8 }, () => ({ lines: 1 })) });
  const e = engine(db, { submitStop: { 5005: { code: "409", message: "GDE_FC_STALE: line 600004 changed since the force complete was planned" } } });
  confirm(e, db, db.t.lines.map((l) => [l.id, 3]));
  const before = JSON.stringify([db.t.gdl, db.t.res, db.t.bal]);
  const r = forceComplete(e);
  const end = follow(e, db, r.job_id);
  const j = job(db, r.job_id);
  eq("F1: FAILED PK_FC_GD_CHANGED naming GD/5; Picking unlocked", [end, j.error_code, /GD\/5/.test(j.error_message || ""), db.t.picking[0].is_processing], ["FAILED", "PK_FC_GD_CHANGED", true, 0]);
  eq("F1: deliveries 1-4 held then cancelled; 6-8 never submitted", db.t.gd.map((g) => edits(db, g.id).join("+")), ["CANCELLED", "CANCELLED", "CANCELLED", "CANCELLED", "", "", "", ""]);
  eq("F1: nothing of the deliveries changed; all back to Created", [JSON.stringify([db.t.gdl, db.t.res, db.t.bal]) === before, db.t.gd.every((g) => g.gd_status === "Created")], [true, true]);
  eq("F1: the Picking still In Progress, rows as picked", [db.t.picking[0].to_status, db.t.lines.every((l) => l.line_status === "In Progress")], ["In Progress", true]);
}

// ---------------------------------------------------------------- F2. the engine refuses delivery 2's stock: review, the rest released
{
  FLOW = "F2";
  const db = seed({ gds: [{ lines: 1 }, { lines: 1 }, { lines: 1 }] });
  const e = engine(db, { engineRefuse: { 5002: 1 } });
  confirm(e, db, db.t.lines.map((l) => [l.id, 3]));
  const r = forceComplete(e);
  const end = follow(e, db, r.job_id);
  const j = job(db, r.job_id);
  eq("F2: REQUIRES_REVIEW with the edit's code; the Picking stays locked", [end, j.error_code, db.t.picking[0].is_processing], ["REQUIRES_REVIEW", "GDE_E1_REFUSED", 1]);
  eq("F2: delivery 1 committed, 2 refused, 3's hold cancelled", db.t.gd.map((g) => edits(db, g.id).join("+")), ["COMPLETED", "FAILED", "CANCELLED"]);
  eq("F2: 'stopped after 1 of 3'", /stopped after 1 of 3 deliveries/.test(j.progress_message), true);
}

// ---------------------------------------------------------------- F2b. the review runbook (README): the old steps re-review; the corrected ones finish it
{
  FLOW = "F2b";
  const reviewed = () => {
    const db = seed({ gds: [{ lines: 1 }, { lines: 1 }, { lines: 1 }] });
    const e = engine(db, { engineRefuse: { 5002: 1 } });
    confirm(e, db, db.t.lines.map((l) => [l.id, 3]));
    const r = forceComplete(e);
    if (follow(e, db, r.job_id) !== "REQUIRES_REVIEW") throw new Error("F2b: not under review");
    return { db, e, r };
  };
  const reopen = (db, jobId) => Object.assign(job(db, jobId), { job_status: "COMMITTING_PICKING", attempt_count: 0, next_attempt_at: db.now, lease_owner: null, lease_expires_at: null,
    error_code: null, error_message: null, finished_at: null });
  {
    // the first runbook: FC_REVIEW soft-deleted only -> the failed edit is not re-planned: under review again at once
    const { db, e, r } = reviewed();
    db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "FC_REVIEW").is_deleted = 1;
    reopen(db, r.job_id);
    let crashed = "";
    try { follow(e, db, r.job_id); } catch (err) { crashed = String(err.message); }
    eq("F2b: the first runbook does not resume it (the unique step key holds the soft-deleted FC_REVIEW)", /Duplicate entry/.test(crashed) || job(db, r.job_id).job_status === "REQUIRES_REVIEW", true);
  }
  {
    // the corrected runbook: FC_REVIEW renamed + soft-deleted, the failed edit soft-deleted, the job back to COMMITTING_PICKING
    const { db, e, r } = reviewed();
    const rv = db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "FC_REVIEW");
    Object.assign(rv, { step_name: "FC_REVIEW#" + rv.id, is_deleted: 1 });
    for (const x of db.t.job.filter((y) => y.command === "EDIT_GD" && y.job_status === "FAILED")) x.is_deleted = 1;
    reopen(db, r.job_id);
    eq("F2b: the corrected runbook resumes it: COMPLETED", follow(e, db, r.job_id), "COMPLETED");
    eq("F2b: every delivery committed once, in order", e.gde.log.commits, ["5001", "5002", "5003"]);
  }
}

// ---------------------------------------------------------------- F3. a crash after E1: a live lease (WAIT, no kick), then dead -> resumed, E1 REPLAYED
{
  FLOW = "F3";
  const db = seed({ gds: [{ lines: 2 }, { lines: 1 }] });
  const e = engine(db, { crashAfterE1: { 5001: 1 } });
  confirm(e, db, [["800000", 2], ["800001", 5], ["800002", 4]]);
  const r = forceComplete(e);
  let sawLiveWait = false;
  const end = follow(e, db, r.job_id, { beforeTick: () => {
    const x = db.t.job.find((y) => y.command === "EDIT_GD" && y.job_status === "COMMITTING_GD" && y.lease_expires_at > db.now);
    if (x && !(status(e).kick || []).includes(x.id)) sawLiveWait = true;
  } });
  eq("F3: COMPLETED after the resume", [end, job(db, r.job_id).error_message || null], ["COMPLETED", null]);
  eq("F3: while the crashed commit's lease lived, nothing kicked it", sawLiveWait, true);
  eq("F3: E1 replayed once; the stock released once (3)", [Object.keys(e.gde.log.e1).filter((k) => /replayed/.test(k)).length, bal(db)], [1, [10085 + 3 + 1, 11]]);
}

// ---------------------------------------------------------------- F4. the holds expire while nobody watches: re-planned, then committed
{
  FLOW = "F4";
  const db = seed({ gds: [{ lines: 1 }, { lines: 1 }, { lines: 1 }] });
  const e = engine(db);
  confirm(e, db, db.t.lines.map((l) => [l.id, 3]));
  const r = forceComplete(e);
  const first = follow(e, db, r.job_id, { beforeTick: () => (db.t.step.some((s) => s.job_id === r.job_id && s.step_name === "FC_HOLD") ? "STOP" : "") });
  db.advance(1801);
  const end = follow(e, db, r.job_id);
  eq("F4: stopped once every delivery was held, then COMPLETED", [first, end], ["STOPPED", "COMPLETED"]);
  eq("F4: the expired holds re-planned (CANCELLED, then COMPLETED); the released one committed", db.t.gd.map((g) => edits(db, g.id).join("+")),
    ["COMPLETED", "CANCELLED+COMPLETED", "CANCELLED+COMPLETED"]);
}

// ---------------------------------------------------------------- F5. a record lands after the deliveries were updated: COMMIT reviews
{
  FLOW = "F5";
  const db = seed({ gds: [{ lines: 2 }] });
  const e = engine(db);
  confirm(e, db, [["800000", 3]]);
  const r = forceComplete(e);
  e.hooks1d.PICKING_BULK_COMMIT = () => {
    if (!db.t.records.some((x) => x.id === "LATE")) db.t.records.push({ id: "LATE", transfer_order_id: "9001", gd_id: "5001", gd_line_id: "600001", store_out_qty: 1, source_bin: "4001", batch_no: "2001", is_deleted: 0 });
  };
  const end = follow(e, db, r.job_id);
  const j = job(db, r.job_id);
  eq("F5: REQUIRES_REVIEW PK_FC_STALE; the Picking locked and not written", [end, j.error_code, db.t.picking[0].is_processing, db.t.picking[0].to_status], ["REQUIRES_REVIEW", "PK_FC_STALE", 1, "In Progress"]);
  eq("F5: the delivery stays updated (committed before COMMIT)", [edits(db), gdl(db, "600001").is_deleted], [["COMPLETED"], 1]);
}

// ---------------------------------------------------------------- F6. twin drives: the second meets the first's lease and does nothing
{
  FLOW = "F6";
  const db = seed({ gds: [{ lines: 1 }, { lines: 1 }] });
  const e = engine(db);
  confirm(e, db, db.t.lines.map((l) => [l.id, 3]));
  const r = forceComplete(e);
  let twin = null;
  e.gde.log.hooks.submit = () => { if (!twin) twin = e.run("PICKING_FC_DRIVE", { job_id: r.job_id, lease_owner: "" }).returned; };
  const end = follow(e, db, r.job_id);
  eq("F6: the twin answered WAIT with no action", [twin && twin.route, twin && twin.actions], ["WAIT", 0]);
  eq("F6: one SUBMIT per delivery; COMPLETED", [e.gde.log.submit.filter((p) => (p.operation || "SUBMIT") === "SUBMIT").length, end], [2, "COMPLETED"]);
}

if (process.env.SIZES) for (const [k, v] of Object.entries(SIZES).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log("size " + k.padEnd(44) + Math.round(v / 1024) + " KB");
done();
