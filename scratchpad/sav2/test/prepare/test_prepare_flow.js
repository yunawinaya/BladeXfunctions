// node test/prepare/test_prepare_flow.js
// The BUILT "Stock Adjustment/AsyncV2/SA_V2_PREPARE.json" run by the FlowGram interpreter (lib/sim/engine.js) with every sql-node
// mocked by node id (rows in the SQL's own shapes: JSON_OBJECT `j` text, ids as text, decimals as text) and the writes recorded:
//   FORM DIRECT (+ a Stock Count parity part), FORM COMPLETE edited with header edits / header-only edit / unedited, REVIEW of a
//   2,000-line Stock Count (the <= 50-entry split, PARK above 1,000 entries), and the failure paths: a job that does NOT own the
//   SA (no unlock), a missing SA (no unlock), a SUBMIT that never linked (the stray SA unlocked), an unknown prevStatus
//   (REQUIRES_REVIEW, no unlock), a review whose stock changed (FAILED + unlock -> Cancelled), an SC line without an id (FAILED +
//   unlock), a throw after the lock check (BROKEN + unlock).
// Node data per run is estimated as the platform records it: each node's inputs (code + substituted values / SQL text / write props)
// + its output; the 2,000-entry REVIEW must stay <= 25 MB (CONTRACT.md section 14).
const fs = require("fs");
const path = require("path");
const { Engine } = require("../../lib/sim/engine.js");
const { load, SAV2 } = require("./load.js");

const OUT = path.join(SAV2, "..", "..", "Stock Adjustment", "AsyncV2");
const F = load(["code/shared/sa_common.js", "code/shared/fingerprint.js"], ["saLineFingerprint", "scLineFingerprint", "saPartRows", "saJoinChunks", "saParseJ"]);

let fails = 0;
let passes = 0;
const ok = (label, cond, extra) => {
  if (cond) passes++;
  else fails++;
  console.log((cond ? "ok   " : "FAIL ") + label + (cond || extra === undefined ? "" : "\n     " + String(extra).slice(0, 1500)));
};

// ---------------------------------------------------------------- an Engine that also counts every node's inputs (nodes_data)
class SizedEngine extends Engine {
  node(n, ctx) {
    const d = n.data || {};
    let input = 0;
    const refs = (text) => {
      const seen = {};
      String(text || "").replace(/\{\{([^}]+)\}\}/g, (m, ref) => {
        if (seen[ref]) return m;
        seen[ref] = true;
        const v = this.resolve(ref, ctx);
        input += v === undefined ? 4 : JSON.stringify(v).length;
        return m;
      });
    };
    if (n.type === "code-node") {
      input += d.script.code.length;
      refs(d.script.code);
    } else if (n.type === "sql-node") {
      input += this.injectRaw(d.script.code, ctx).length;
    } else if (n.type === "add-node" || n.type === "update-node") {
      for (const p of d.props.list || []) refs(p.value);
    }
    ctx.inBytes = (ctx.inBytes || 0) + input;
    const before = ctx.bytes;
    super.node(n, ctx);
    const outB = ctx.bytes - before;
    const container = ["if", "ifBlock", "condition-or-node", "condition-or-node-item", "condition-all-node", "condition-all-node-item", "loop"].indexOf(n.type) >= 0;
    if (!container && input + outB > 0) (ctx.perNode = ctx.perNode || {})[n.id] = ((ctx.perNode || {})[n.id] || 0) + input + outB;
  }
}

// ---------------------------------------------------------------- fixtures in the SQL rows' shapes
const T = "000000";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const JOB = "2111111111111111111";
const SA = "2112222222222222222";
const SC = "2113333333333333333";
const KEY = "SA:" + ORG + ":" + SA + ":0a1b2c3d4e5f6a7b:1";
const id19 = (prefix, n) => prefix + String(n).padStart(19 - prefix.length, "0");
const j = (o) => ({ j: JSON.stringify(o) });
const hdrRow = (over) => j(Object.assign({ id: SA, adjustment_no: "SA/20261016/0042", adjustment_no_type: "2026902921863950338", stock_adjustment_status: "Processing",
  plant_id: PLANT, organization_id: ORG, adjustment_date: "2026-10-16 00:00:00", adjustment_type: "Write Off", adjusted_by: "tester", stock_count_id: null,
  acc_integration_type: "SQL Accounting V2", posted_status: "Unposted", project_id: null, reference_documents: [], adjustment_remarks: "", adjustment_remarks2: "",
  adjustment_remarks3: "", tenant_id: T, sa_v2_job_id: JOB, lock_ref: KEY }, over || {}));
const entry = (k, loc, q, mt, batch) => ({ balance_id: id19("2041", k), material_id: null, plant_id: PLANT, location_id: loc, batch_id: batch || null, balance_quantity: 500,
  unrestricted_qty: 500, block_qty: 0, qualityinsp_qty: 0, reserved_qty: 0, intransit_qty: 0, organization_id: ORG, tenant_id: T, category: "Unrestricted",
  movement_type: mt, sa_quantity: q });
// a stored SA line as FP_SA_LINES + the extra columns read it (unit_price a JSON number with its 8 decimals: saParseJ makes it 12.5)
const storedLine = (i, mat, entries, extra) => Object.assign({ id: id19("2114", i), line_index: String(i), material_id: mat, uom_id: "2018906563477008392",
  total_quantity: String(entries.reduce((t, e) => t + e.sa_quantity, 0)), unit_price: 12.5, balance_index: JSON.stringify(entries.map((e) => Object.assign({}, e, { material_id: mat }))),
  is_serialized_item: 0, material_name: "ITEM-" + i, material_desc: "", adjustment_reason: null, adj_summary: "Total: x", adjustment_remarks: "", plant_id: PLANT,
  item_category: "2018905941675634689", is_single_serial: 0, item_remark: i === 1 ? "first line" : "", item_remark2: "", item_remark3: "", project_id: null }, extra || {});
const jobRow = (req, over) => Object.assign({ db_now: "2026-10-16 18:00:00", id: JOB, organization_id: ORG, command: "COMPLETE_SA", job_status: "VALIDATING",
  lease_owner: "WRK|abc", lease_live: 1, row_version: 3, attempt_count: 0, idempotency_key: KEY, correlation_id: "SA|" + SA, request_payload: JSON.stringify(req),
  is_deleted: 0, linked_sa: null }, over || {});
const itemRow = (mat, code, extra) => j(Object.assign({ id: mat, material_code: code, material_name: code + " name", item_batch_management: 0, material_costing_method: "First In First Out",
  purchase_unit_price: "3.2500", table_uom_conversion: null }, extra || {}));
const binRow = (loc, name) => j({ id: loc, bin_location_combine: name, plant_id: PLANT });

// ---------------------------------------------------------------- the run: mocks, writes, the job read back
function runPrepare(sc) {
  const writes = [];
  const job = Object.assign({}, sc.job);
  const db = {
    tenantId: T,
    insert(table, rows) {
      writes.push({ op: "add", table, rows });
      return rows.map((r, i) => Object.assign({ id: "9" + String(writes.length) + String(i).padStart(17, "0") }, r));
    },
    update(table, rows) {
      writes.push({ op: "update", table, rows });
      if (table === "GD Async Job") for (const r of rows) for (const k of Object.keys(r)) if (k !== "__id") job[k] = r[k];
      return rows;
    },
  };
  const rows = (k) => () => sc.sql[k] || [];
  const mocks = { sql: { sql_node_SPjob: () => [sc.job], sql_node_SPback: () => [{ id: job.id, job_status: job.job_status, progress_message: job.progress_message,
    error_code: job.error_code, error_message: job.error_message }] }, read: {} };
  for (const k of ["hdr", "sclines", "parts", "lines"]) mocks.sql["sql_node_SP" + k] = rows(k);
  for (const k of ["items", "balances", "batch_balances", "bins", "uoms", "batches", "costs", "prefix"]) mocks.sql["sql_node_SPrv_" + k] = rows("rv_" + k);
  const eng = new SizedEngine({ dir: OUT, db, mocks });
  const r = eng.run("SA_V2_PREPARE", { job_id: JOB });
  const parts = {};
  for (const w of writes.filter((x) => x.op === "add" && x.table === "GD Publish Step")) for (const p of w.rows) parts[p.step_name] = p;
  const partRows = Object.values(parts);
  const manifest = job.prepared_payload ? F.saParseJ(job.prepared_payload) : null;
  const part = (name) => (manifest ? F.saJoinChunks(partRows, "P|" + manifest.nonce + "|" + name + "|") : null);
  const out = r.ctx.out;
  return { r, writes, job, manifest, part, out, sizes: { inputs: r.ctx.inBytes, outputs: r.ctx.bytes, total: r.ctx.inBytes + r.ctx.bytes, perNode: r.ctx.perNode },
    unlocks: writes.filter((w) => w.table === "Stock Adjustment") };
}

// ================================================================ FORM DIRECT
{
  const lines = [
    storedLine(1, "2072251040571387906", [entry(1, "2065350054772584449", 3, "In"), entry(2, "2065350054772584450", 2, "Out")]),
    storedLine(2, "2072251040571387907", [entry(3, "2065350054772584449", 5, "OUT", "2056919801992785922"), Object.assign(entry(4, "2065350054772584451", 0, "In"))]),
  ];
  const fp = F.saLineFingerprint(lines.map(j));
  const req = { v: 1, source: "FORM", action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Add", saId: SA, saNo: "SA/20261016/0042", issuedNo: "SA/20261016/0042",
    scId: "", lineFingerprint: fp, incomingFingerprint: fp, edited: 0, scFingerprint: "", organizationId: ORG, plantId: PLANT, lineCount: 2, entryCount: 3, movementCount: 3, nonce: "ab12cd34", parts: {} };
  const sc = { job: jobRow(req), sql: { hdr: [hdrRow()], lines: lines.map(j), parts: [], sclines: [],
    rv_items: [itemRow("2072251040571387906", "FG-1"), itemRow("2072251040571387907", "FG-2")], rv_bins: [binRow("2065350054772584449", "A1-B1"), binRow("2065350054772584450", "A1-B2")] } };
  const x = runPrepare(sc);
  ok("DIRECT: READY_TO_COMMIT, lease kept (no PARK), progress 60", x.job.job_status === "READY_TO_COMMIT" && x.job.progress_percent === 60 && x.job.lease_owner === "WRK|abc",
    JSON.stringify({ s: x.job.job_status, e: x.job.error_code, m: x.job.error_message, w: x.writes.map((w) => w.table) }));
  const m = x.manifest || {};
  ok("DIRECT: manifest = this job's plan (job, sa, action, SAF1 fingerprints, nonce, counts)", m.job_id === JOB && m.sa_id === SA && m.action === "DIRECT" && m.source === "FORM" &&
    m.lineFingerprint === fp && m.incomingFingerprint === fp && /^[0-9A-Za-z]{8}$/.test(m.nonce) && m.counts.movements === 3 && m.sa_no === "SA/20261016/0042", JSON.stringify(m).slice(0, 600));
  ok("DIRECT: parts ENGINE / LABELS / HDR / ITEMS / REORDER; no SALINES, no SC", ["ENGINE", "LABELS", "HDR", "ITEMS", "REORDER"].every((k) => (m.parts[k] || []).length) &&
    !m.parts.SALINES && !m.parts.SC && m.sc_id === "", JSON.stringify(m.parts));
  const eng = x.part("ENGINE");
  const mv = eng.movements;
  ok("DIRECT: ENGINE = SAC|<job>, APPLY, the job's organization, 3 movements (sa_quantity 0 skipped), classic order", eng.operation_key === "SAC|" + JOB && eng.mode === "APPLY" &&
    eng.organization_id === ORG && mv.length === 3 && mv.map((v) => v.movement_key + v.direction).join() === "M1ADD,M2SUBTRACT,M3SUBTRACT", JSON.stringify(mv.map((v) => v.direction)));
  ok("DIRECT: movement fields (stored number, header date, line uom, unit_price, entry category, plant, batch null / digits, remarks on ADD only)",
    mv[0].trx_no === "SA/20261016/0042" && mv[0].doc_date === "2026-10-16 00:00:00" && mv[0].material_uom === "2018906563477008392" && mv[0].unit_price === 12.5 &&
    mv[0].inventory_category === "Unrestricted" && mv[0].plant_id === PLANT && mv[0].batch_id === null && mv[0].remark === "first line" && mv[0].remark2 === null &&
    !("remark" in mv[1]) && mv[2].batch_id === "2056919801992785922" && mv[2].quantity === 5 && mv[0].isMovingInv === 0 && mv[0].transaction_type === "SA", JSON.stringify(mv[0]));
  const lb = x.part("LABELS");
  ok("DIRECT: LABELS map each key to its line, item code and bin", lb.M1.line_index === "1" && lb.M1.item_code === "FG-1" && lb.M1.bin === "A1-B1" && lb.M1.side === "in" &&
    lb.M2.side === "out" && lb.M3.item_code === "FG-2" && lb.M3.bin === "2065350054772584449" === false && lb.M3.line_id === id19("2114", 2), JSON.stringify(lb));
  const hd = x.part("HDR");
  ok("DIRECT: HDR Processing -> Completed", hd.id === SA && hd.before.stock_adjustment_status === "Processing" && hd.after.stock_adjustment_status === "Completed");
  const it = x.part("ITEMS");
  ok("DIRECT: ITEMS one date per material (code_node_WFXy3gHI)", it.itemDates.length === 2 && /^\d{4}-\d{2}-\d{2}T/.test(it.itemDates[0].last_transaction_date), JSON.stringify(it));
  const ro = x.part("REORDER");
  ok("DIRECT: REORDER SA_COMPLETED with the lines and the organization", ro.document_type === "SA_COMPLETED" && ro.organization_id === ORG && ro.latest_data.length === 2);
  ok("DIRECT: no unlock written", x.unlocks.length === 0);
  const rvOnly = ["balances", "batch_balances", "uoms", "batches", "costs", "prefix"].map((k) => "sql_node_SPrv_" + k);
  ok("DIRECT: the six review-only reads did not run (items / bins did: LABELS)", rvOnly.every((k) => !(k in x.out)) && "sql_node_SPrv_items" in x.out && "sql_node_SPrv_bins" in x.out,
    JSON.stringify(Object.keys(x.out).filter((k) => /SPrv/.test(k))));
  // + a Stock Count parity part
  const sc2 = JSON.parse(JSON.stringify(sc));
  sc2.sql.hdr = [hdrRow({ stock_count_id: SC })];
  const req2 = Object.assign({}, req, { scId: SC });
  sc2.job = jobRow(req2);
  const x2 = runPrepare(sc2);
  ok("DIRECT with stock_count_id: SC = { mode PARITY, scId }, manifest.sc_id", x2.manifest && x2.manifest.sc_id === SC && x2.part("SC").mode === "PARITY" && x2.part("SC").scId === SC,
    JSON.stringify(x2.manifest && x2.manifest.parts));
}

// ================================================================ FORM COMPLETE
{
  const old = [storedLine(1, "2072251040571387906", [entry(1, "2065350054772584449", 3, "In")]), storedLine(2, "2072251040571387907", [entry(2, "2065350054772584450", 2, "Out")])];
  const oldRows = old.map((l) => F.saParseJ(JSON.stringify(l)));
  const fpOld = F.saLineFingerprint(old.map(j));
  // the DOC lines = the filled-back form lines (O4tWJ5JH output: null keys stripped, line_index numbers, unit_price q8)
  const docLine = (l, over) => {
    const o = {};
    for (const k of Object.keys(l)) if (l[k] !== null) o[k] = l[k];
    return Object.assign(o, { line_index: Number(l.line_index) }, over || {});
  };
  const mkDoc = (lines, header) => ({ v: 1, saId: SA, header: header, lines: lines, fingerprint: F.saLineFingerprint(lines) });
  const docHeader = (over) => Object.assign({ plant_id: PLANT, adjustment_date: "2026-10-16 00:00:00.000", adjustment_type: "Write Off", stock_count_id: null, adjusted_by: "tester",
    organization_id: ORG, project_id: null, acc_integration_type: "SQL Accounting V2", reference_documents: [], adjustment_remarks: "", adjustment_remarks2: "", adjustment_remarks3: "",
    posted_status: "Unposted" }, over || {});
  const run = (doc, edited) => {
    const names = F.saPartRows(JOB, ORG, "S|ab12cd34|DOC|", doc, "PAYLOAD");
    const req = { v: 1, source: "FORM", action: "COMPLETE", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Edit", saId: SA, saNo: "SA/20261016/0042", issuedNo: "",
      scId: "", lineFingerprint: fpOld, incomingFingerprint: doc.fingerprint, edited: edited, scFingerprint: "", organizationId: ORG, plantId: PLANT, nonce: "ab12cd34",
      parts: { DOC: names.map((r) => r.step_name) } };
    return runPrepare({ job: jobRow(req), sql: { hdr: [hdrRow()], lines: old.map(j), parts: names, sclines: [], rv_items: [itemRow("2072251040571387906", "FG-1")], rv_bins: [] } });
  };
  // edited lines + header edits (a new date) + a new line without an id
  const newLines = [docLine(oldRows[0], { balance_index: JSON.stringify([Object.assign(entry(1, "2065350054772584449", 4, "In"), { material_id: "2072251040571387906" })]), total_quantity: "4" }),
    docLine(oldRows[1]), { material_id: "2072251040571387908", uom_id: "2018906563477008392", total_quantity: "1", unit_price: 0, line_index: 3, plant_id: PLANT,
      balance_index: JSON.stringify([Object.assign(entry(5, "2065350054772584452", 1, "In"), { material_id: "2072251040571387908" })]), material_name: "NEW" }];
  delete newLines[1].item_remark2; // a key the form line lacks (the stored value is kept for an existing line)
  const doc = mkDoc(newLines, docHeader({ adjustment_date: "2026-10-20 00:00:00.000", adjustment_remarks: "edited" }));
  const x = run(doc, 1);
  const m = x.manifest || {};
  const sl = x.part("SALINES");
  ok("COMPLETE edited: READY, SALINES listed, incomingFingerprint = the DOC part's", x.job.job_status === "READY_TO_COMMIT" && !!sl && m.incomingFingerprint === doc.fingerprint &&
    m.lineFingerprint === fpOld && sl.fingerprint === doc.fingerprint && m.edited === 1, JSON.stringify({ s: x.job.job_status, e: x.job.error_message, p: m.parts }));
  ok("COMPLETE edited: SALINES rows carry all 19 columns; existing ids kept, the new line without one; a lacking column = the stored value / insert default",
    sl.stock_adjustment.length === 3 && sl.stock_adjustment.every((r) => ["material_id", "material_name", "material_desc", "adjustment_reason", "total_quantity", "uom_id", "unit_price",
      "adj_summary", "adjustment_remarks", "balance_index", "line_index", "plant_id", "item_category", "is_single_serial", "is_serialized_item", "item_remark", "item_remark2",
      "item_remark3", "project_id"].every((k) => k in r)) && sl.stock_adjustment[0].id === id19("2114", 1) && !("id" in sl.stock_adjustment[2]) &&
      sl.stock_adjustment[1].item_remark2 === "" && sl.stock_adjustment[2].material_desc === "" && sl.stock_adjustment[2].adjustment_reason === null &&
      F.saLineFingerprint(sl.stock_adjustment) === doc.fingerprint, JSON.stringify(sl.stock_adjustment[2]));
  ok("COMPLETE edited: SALINES header = the 13 DOC header props (the edits included)", Object.keys(sl.header).length === 13 && sl.header.adjustment_date === "2026-10-20 00:00:00.000" &&
    sl.header.adjustment_remarks === "edited", JSON.stringify(sl.header));
  const mv = x.part("ENGINE").movements;
  ok("COMPLETE edited: movements from the DOC lines, doc_date = the edited date as the DB reads it back, the stored number",
    mv.length === 3 && mv[0].quantity === 4 && mv[0].doc_date === "2026-10-20 00:00:00" && mv.every((v) => v.trx_no === "SA/20261016/0042") && mv[2].material_id === "2072251040571387908",
    JSON.stringify(mv.map((v) => [v.quantity, v.doc_date, v.trx_no])));
  // a header-only edit: the lines unchanged, a new date -> SALINES still listed (controller ruling 2)
  const same = old.map((l) => docLine(F.saParseJ(JSON.stringify(l))));
  const xh = run(mkDoc(same, docHeader({ adjustment_date: "2026-10-21 00:00:00.000" })), 0);
  const slh = xh.part("SALINES");
  ok("COMPLETE header-only edit: SALINES listed (edited 0) with the header change named", xh.job.job_status === "READY_TO_COMMIT" && !!slh &&
    JSON.stringify(slh.headerChanged) === JSON.stringify(["adjustment_date"]) && xh.part("ENGINE").movements[0].doc_date === "2026-10-21 00:00:00",
    JSON.stringify({ s: xh.job.job_status, e: xh.job.error_message, h: slh && slh.headerChanged }));
  // nothing changed: no SALINES
  const xu = run(mkDoc(same, docHeader()), 0);
  ok("COMPLETE unedited, header unchanged: no SALINES", xu.job.job_status === "READY_TO_COMMIT" && !xu.manifest.parts.SALINES,
    JSON.stringify({ s: xu.job.job_status, e: xu.job.error_message, p: xu.manifest && xu.manifest.parts }));
  // a DOC line id the SA no longer has
  const bad = run(mkDoc([docLine(oldRows[0], { id: "2999999999999999999" })].concat([docLine(oldRows[1])]), docHeader()), 1);
  ok("COMPLETE with a foreign line id: FAILED SA_LINES_CHANGED + unlock to Draft", bad.job.job_status === "FAILED" && bad.job.error_code === "SA_LINES_CHANGED" &&
    bad.unlocks.length === 1 && bad.unlocks[0].rows[0].stock_adjustment_status === "Draft", JSON.stringify({ s: bad.job.job_status, c: bad.job.error_code, u: bad.unlocks }));
}

// ================================================================ REVIEW of a 2,000-line Stock Count
function reviewScenario(n, opts) {
  const o = opts || {};
  const mats = [];
  for (let i = 0; i < 20; i++) mats.push(id19("2072", 251040571387900 + i));
  const locs = [];
  for (let i = 0; i < 110; i++) locs.push(id19("2065", 350054772584000 + i));
  const batchMat = (m) => mats.indexOf(m) % 4 === 3; // a quarter of the items are batch-managed
  const lines = [];
  for (let k = 0; k < n; k++) {
    // material 0 alone takes 150 Out lines (one build line of 150 entries: split 50 / 50 / 50); the rest spread
    const mi = k < 150 ? 0 : 1 + (k % 19);
    const mat = mats[mi];
    const loc = locs[k < 150 ? k % 110 : Math.floor(k / 19) % 110];
    const out = k < 150 || k % 3 === 0;
    const v = out ? -(1 + (k % 4)) : 2 + (k % 5);
    const line = { plant_id: PLANT, line_status: "Approved", location_id: loc, variance_percentage: "1.5%", item_category: "1998592021249802253", count_qty: 100 + v,
      variance_qty: v, id: id19("2110", 938239065001000 + k), review_status: "Approved", balance_distribution: "TOTAL: 100 (" + v + ")\n\nBreakdown:\n  • Unrestricted: 100 (" + v + ")",
      is_single: 0, material_name: "ITEM-" + mi, is_counted: 1, base_uom_id: "1998592672314834948", system_qty: 100, uom_id: "1998592672314834948", adjusted_qty: v,
      material_id: mat, line_index: String(k + 1), is_serialized: 0, table_uom_conversion: "[]", fm_key: "k" + k };
    if (batchMat(mat)) line.batch_id = id19("2056", 919801992785000 + k);
    lines.push(line);
  }
  if (o.unsaved) delete lines[5].id;
  // a Cancel line without an id: prep drops it before the write, so it never fails a review
  if (o.cancelNoId) lines.push(Object.assign({}, lines[0], { id: undefined, line_status: "Cancel", line_index: String(n + 1) }));
  const record = { tenant_id: T, plant_id: PLANT, count_method: "Ad Hoc Count", stock_count_no_type: "2027200132845858818", assignees: "User", total_counted: "0 / 0",
    item_list: [{ item_id: mats[0], uom_id: "1998592672314834948" }], total_variance: "0.00%", stock_count_no: "STC/20261016/0001", review_status: "In Review", id: SC,
    page_status: "Edit", stock_count_status: "In Progress", user_assignees: ["1123598821738675201"], count_type: "Item", blind_count: 0, organization_id: ORG,
    previous_status: "In Progress", draft_status: "<div>Draft</div>".repeat(40), table_stock_count: lines };
  const scLines = lines.map((l) => j({ id: l.id, line_index: l.line_index, line_status: "Approved", review_status: "Approved", is_counted: 1, count_qty: l.count_qty,
    adjusted_qty: l.adjusted_qty, variance_qty: l.variance_qty }));
  const partRows = F.saPartRows(JOB, ORG, "S|ab12cd34|SC|", record, "PAYLOAD");
  const balances = [];
  const batchBalances = [];
  for (const l of lines) {
    if (l.variance_qty >= 0) continue;
    const row = { id: id19("2041", 100000 + balances.length + batchBalances.length), material_id: l.material_id, plant_id: PLANT, location_id: l.location_id,
      balance_quantity: "500.00000000", unrestricted_qty: o.shortStock ? "0.00000000" : "500.00000000", block_qty: "0.00000000", qualityinsp_qty: "0.00000000",
      reserved_qty: "0.00000000", intransit_qty: "0.00000000", organization_id: ORG, tenant_id: T, create_user: "1123598821738675201", create_time: "2026-05-20 10:07:51.196",
      create_dept: ORG, update_user: "1123598821738675201", update_time: "2026-10-15 17:23:28.530", is_deleted: 0, material_uom: "1998592672314834948" };
    if (l.batch_id) batchBalances.push(j(Object.assign(row, { batch_id: l.batch_id })));
    else balances.push(j(row));
  }
  const fake = Object.assign({}, { items: mats.map((m, i) => itemRow(m, "FG-" + i, { item_batch_management: batchMat(m) ? 1 : 0, material_costing_method: i % 2 ? "Weighted Average" : "First In First Out" })),
    bins: locs.map((l, i) => binRow(l, "Z" + Math.floor(i / 10) + "-B" + (i % 10))), uoms: [j({ id: "1998592672314834948", uom_name: "UNIT" })],
    batches: lines.filter((l) => l.batch_id).map((l, i) => j({ id: l.batch_id, batch_number: "Batch-" + i })),
    costs: [j({ src: "FIFO", material_id: mats[2], plant_id: PLANT, cost: "5.00000000", rn: "1", rn_any: "1" })], prefix: [j({ id: "2026902921863950338", rule_name: "SA 1" })] });
  const reqFp = { lineFingerprint: F.saLineFingerprint([]), incomingFingerprint: "SAF1:9:0000000000000000", scFingerprint: F.scLineFingerprint(scLines) };
  const req = Object.assign({ v: 1, source: "REVIEW", action: "REVIEW", prevStatus: "Cancelled", saveAs: "Completed", pageStatus: "Edit", saId: SA, saNo: "SA/20261016/0042",
    issuedNo: "SA/20261016/0042", scId: SC, edited: 0, organizationId: ORG, plantId: PLANT, nonce: "ab12cd34", parts: { SC: partRows.map((r) => r.step_name) },
    createAdjustment: "Yes", nickname: "tester", adjustmentDate: "2026-10-16" }, reqFp);
  const sql = { hdr: [hdrRow({ adjustment_type: "Stock Count", stock_count_id: SC, posted_status: "Unposted" })], lines: [], parts: partRows, sclines: o.scChanged ? scLines.slice(1) : scLines,
    rv_items: fake.items, rv_balances: balances, rv_batch_balances: batchBalances, rv_bins: fake.bins, rv_uoms: fake.uoms, rv_batches: fake.batches, rv_costs: fake.costs, rv_prefix: fake.prefix };
  return { job: jobRow(req), sql, record };
}
{
  const t0 = Date.now();
  const sc = reviewScenario(2000);
  const x = runPrepare(sc);
  const ms = Date.now() - t0;
  const m = x.manifest || {};
  ok("REVIEW 2,000: READY_TO_COMMIT PARKED (> 1,000 entries): lease cleared, due now, attempt_count untouched", x.job.job_status === "READY_TO_COMMIT" && x.job.lease_owner === null &&
    x.job.lease_expires_at === null && x.job.next_attempt_at === "2026-10-16 18:00:00" && x.job.attempt_count === 0 && x.out.code_node_SPready.route === "PARK",
    JSON.stringify({ s: x.job.job_status, e: x.job.error_code, msg: x.job.error_message, lease: x.job.lease_owner, due: x.job.next_attempt_at }));
  const eng = x.part("ENGINE");
  ok("REVIEW 2,000: 2,000 movements, every key unique, every SUBTRACT priced 0, ADDs at the build's cost", eng.movements.length === 2000 &&
    new Set(eng.movements.map((v) => v.movement_key)).size === 2000 && eng.movements.filter((v) => v.direction === "SUBTRACT").every((v) => v.unit_price === 0), String(eng.movements.length));
  const sl = x.part("SALINES");
  const sizes = sl.stock_adjustment.map((r) => JSON.parse(r.balance_index).length);
  ok("REVIEW 2,000: SALINES lines of <= 50 entries (the 150-entry build line split in three), no ids, 19 columns, line_index 1..n",
    Math.max(...sizes) <= 50 && sizes.reduce((a, b) => a + b, 0) === 2000 && sl.stock_adjustment.every((r, i) => !("id" in r) && r.line_index === i + 1 && "project_id" in r) &&
      sl.stock_adjustment.filter((r) => r.material_id === sc.record.table_stock_count[0].material_id && JSON.parse(r.balance_index)[0].movement_type === "Out").length === 3,
    JSON.stringify(sizes.slice(0, 12)));
  ok("REVIEW 2,000: incomingFingerprint = SALINES' (PREPARE's own build), lineFingerprint = SUBMIT's empty one", m.incomingFingerprint === sl.fingerprint &&
    sl.fingerprint === F.saLineFingerprint(sl.stock_adjustment) && m.lineFingerprint === F.saLineFingerprint([]), JSON.stringify([m.incomingFingerprint, m.lineFingerprint]));
  const scp = x.part("SC");
  ok("REVIEW 2,000: SC part = the 23 update_node_sc props + before / after fingerprints; item_list / previous_status = the incoming record's", m.sc_id === SC && scp.id === SC &&
    Object.keys(scp).length === 25 && JSON.stringify(scp.item_list) === JSON.stringify(sc.record.item_list) && scp.previous_status === sc.record.previous_status &&
    scp.table_stock_count.every((l) => l.line_status === "Adjusted") && scp.adjustment_status === "Fully Adjusted" && scp.beforeFingerprint === m.scFingerprint &&
    scp.afterFingerprint === m.scAfterFingerprint && scp.afterFingerprint === F.scLineFingerprint(scp.table_stock_count), JSON.stringify(Object.keys(scp)));
  ok("REVIEW 2,000: no unlock", x.unlocks.length === 0);
  ok("REVIEW 2,000: the review-only reads ran", ["balances", "batch_balances", "uoms", "batches", "costs", "prefix"].every((k) => ("sql_node_SPrv_" + k) in x.out));
  const mb = (b) => (b / 1048576).toFixed(1) + " MB";
  const top = Object.entries(x.sizes.perNode).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + " " + mb(v)).join(", ");
  console.log("     node data at 2,000 entries: " + mb(x.sizes.total) + " (inputs " + mb(x.sizes.inputs) + ", outputs " + mb(x.sizes.outputs) + "); largest: " + top + "; interpreter " + ms + " ms");
  ok("REVIEW 2,000: node data <= 25 MB", x.sizes.total <= 25 * 1048576, mb(x.sizes.total));
  // 1,000 entries: no PARK (the lease is kept for COMMIT in the same tick)
  const x1 = runPrepare(reviewScenario(1000));
  ok("REVIEW 1,000: READY_TO_COMMIT without PARK (lease kept)", x1.job.job_status === "READY_TO_COMMIT" && x1.job.lease_owner === "WRK|abc" && x1.out.code_node_SPready.route === "OK",
    JSON.stringify({ s: x1.job.job_status, e: x1.job.error_message, lease: x1.job.lease_owner }));
  // stock moved since SUBMIT: the build fails -> FAILED + the SA back to Cancelled
  const xs = runPrepare(reviewScenario(60, { shortStock: true }));
  ok("REVIEW, stock gone since SUBMIT: FAILED SA_REVIEW_BUILD_FAILED (the classic 406 text) + unlock -> Cancelled", xs.job.job_status === "FAILED" &&
    xs.job.error_code === "SA_REVIEW_BUILD_FAILED" && /^Stock Adjustment not created\. /.test(xs.job.error_message) && xs.unlocks.length === 1 &&
    xs.unlocks[0].rows[0].stock_adjustment_status === "Cancelled" && xs.unlocks[0].rows[0].__id === SA, JSON.stringify({ s: xs.job.job_status, c: xs.job.error_code, m: xs.job.error_message }));
  const xu = runPrepare(reviewScenario(60, { unsaved: true }));
  ok("REVIEW with an SC line without an id: FAILED SA_SC_UNSAVED_LINES + unlock -> Cancelled", xu.job.job_status === "FAILED" && xu.job.error_code === "SA_SC_UNSAVED_LINES" &&
    xu.unlocks.length === 1 && xu.unlocks[0].rows[0].stock_adjustment_status === "Cancelled", JSON.stringify({ s: xu.job.job_status, m: xu.job.error_message }));
  const xk = runPrepare(reviewScenario(60, { cancelNoId: true }));
  ok("REVIEW with a Cancel line without an id (dropped by prep before the write): READY_TO_COMMIT", xk.job.job_status === "READY_TO_COMMIT",
    JSON.stringify({ s: xk.job.job_status, m: xk.job.error_message }));
  const xc = runPrepare(reviewScenario(60, { scChanged: true }));
  ok("REVIEW, Stock Count changed since SUBMIT: FAILED SA_SC_CHANGED + unlock", xc.job.job_status === "FAILED" && xc.job.error_code === "SA_SC_CHANGED" && xc.unlocks.length === 1,
    JSON.stringify({ s: xc.job.job_status, c: xc.job.error_code }));
}

// ================================================================ failures before / after the lock check
{
  const base = reviewScenario(60);
  const variant = (mut) => {
    const s = JSON.parse(JSON.stringify(base));
    mut(s);
    return runPrepare(s);
  };
  const notOwned = variant((s) => (s.sql.hdr = [hdrRow({ adjustment_type: "Stock Count", stock_count_id: SC, lock_ref: "SA:other-key:1" })]));
  ok("a job that does NOT own the SA (another key holds its latest lock): FAILED SA_NOT_LOCKED, NO unlock written", notOwned.job.job_status === "FAILED" &&
    notOwned.job.error_code === "SA_NOT_LOCKED" && notOwned.unlocks.length === 0, JSON.stringify({ s: notOwned.job.job_status, c: notOwned.job.error_code, u: notOwned.unlocks }));
  const otherJob = variant((s) => (s.sql.hdr = [hdrRow({ sa_v2_job_id: "2119999999999999999" })]));
  ok("an SA linked to another job: FAILED SA_NOT_LOCKED, NO unlock", otherJob.job.error_code === "SA_NOT_LOCKED" && otherJob.unlocks.length === 0);
  const notProcessing = variant((s) => (s.sql.hdr = [hdrRow({ stock_adjustment_status: "Cancelled" })]));
  ok("an SA no longer Processing: FAILED SA_NOT_LOCKED, NO unlock", notProcessing.job.error_code === "SA_NOT_LOCKED" && notProcessing.unlocks.length === 0);
  const gone = variant((s) => (s.sql.hdr = []));
  ok("the SA is gone: FAILED SA_NOT_FOUND, NO unlock", gone.job.job_status === "FAILED" && gone.job.error_code === "SA_NOT_FOUND" && gone.unlocks.length === 0);
  const stray = variant((s) => (s.job = Object.assign(s.job, { correlation_id: "", linked_sa: SA })));
  ok("SUBMIT stopped before link: FAILED SA_INVALID_REQUEST + the stray SA (Processing, this job, no later lock) back to prevStatus", stray.job.job_status === "FAILED" &&
    stray.job.error_code === "SA_INVALID_REQUEST" && stray.unlocks.length === 1 && stray.unlocks[0].rows[0].__id === SA && stray.unlocks[0].rows[0].stock_adjustment_status === "Cancelled",
    JSON.stringify({ s: stray.job.job_status, c: stray.job.error_code, u: stray.unlocks }));
  const strayNone = variant((s) => (s.job = Object.assign(s.job, { correlation_id: "", linked_sa: null })));
  ok("no correlation and no stray SA: FAILED, nothing unlocked", strayNone.job.job_status === "FAILED" && strayNone.unlocks.length === 0);
  const prevBad = variant((s) => {
    const r = JSON.parse(s.job.request_payload);
    r.prevStatus = "In Progress";
    s.job.request_payload = JSON.stringify(r);
  });
  ok("prevStatus not Draft / Cancelled: REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN, no unlock", prevBad.job.job_status === "REQUIRES_REVIEW" &&
    prevBad.job.error_code === "SA_PREV_STATUS_UNKNOWN" && prevBad.unlocks.length === 0, JSON.stringify({ s: prevBad.job.job_status, c: prevBad.job.error_code }));
  const notMine = variant((s) => (s.job.job_status = "QUEUED"));
  ok("a job not VALIDATING: answered (JOB_ILLEGAL_TRANSITION), nothing written", notMine.writes.length === 0 && notMine.r.returned.result_code === "JOB_ILLEGAL_TRANSITION",
    JSON.stringify(notMine.r.returned));
  const throws = variant((s) => (s.sql.parts = [{ step_name: s.sql.parts[0].step_name, result_ref: "{not json" }]));
  ok("an unreadable part after the lock check: FAILED SA_PLAN_BROKEN + unlock (this job owns the SA)", throws.job.job_status === "FAILED" &&
    throws.job.error_code === "SA_PLAN_BROKEN" && throws.unlocks.length === 1, JSON.stringify({ s: throws.job.job_status, c: throws.job.error_code, m: throws.job.error_message }));
  const reject = runPrepare(Object.assign(JSON.parse(JSON.stringify(base)), {}));
  ok("(control) the same scenario untouched: READY_TO_COMMIT", reject.job.job_status === "READY_TO_COMMIT");
}

console.log(`prepare flow: ${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
