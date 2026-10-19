// Test fixtures for SA_V2_COMMIT / SA_V2_WORKER: a COMPLETE_SA job as PREPARE would leave it (CONTRACT sections 3-5) -
// manifest, P parts, the stored Stock Adjustment / Stock Count rows - built with the controller's code/shared helpers.
const path = require("path");
const fs = require("fs");
const F = require(path.join(__dirname, "../../code/shared/fingerprint.js"));
const C = require(path.join(__dirname, "../../code/shared/sa_common.js"));

const REPO = path.join(__dirname, "..", "..", "..", "..");
const OUT = path.join(REPO, "Stock Adjustment", "AsyncV2");
const JOB = "2111100000000000001";
const SAID = "2111100000000000100";
const SCID = "2111100000000000200";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const NONCE = "abcd1234";
const KEY = "SA:" + ORG + ":" + SAID + ":0a1b2c3d4e5f6a7b:1";
// the builders' lists (build_commit.py); test_steps.js checks the built JSON carries exactly these
const SA_HDR = ["plant_id", "adjustment_date", "adjustment_type", "stock_count_id", "adjusted_by", "organization_id", "project_id", "acc_integration_type", "reference_documents",
  "adjustment_remarks", "adjustment_remarks2", "adjustment_remarks3", "posted_status"];
const SA_LINE_COLS = ["material_id", "material_name", "material_desc", "adjustment_reason", "total_quantity", "uom_id", "unit_price", "adj_summary", "adjustment_remarks", "balance_index",
  "line_index", "plant_id", "item_category", "is_single_serial", "is_serialized_item", "item_remark", "item_remark2", "item_remark3", "project_id"];
const SC_PROPS = ["id", "stock_count_status", "plant_id", "organization_id", "count_type", "count_method", "item_list", "start_date", "end_date", "assignees", "user_assignees",
  "work_group_assignees", "blind_count", "total_counted", "total_variance", "review_status", "adjustment_status", "stock_count_remark", "stock_count_remark2", "stock_count_remark3",
  "attachment", "previous_status", "table_stock_count"];

let seq = 0n;
const newId = () => (2112000000000000000n + ++seq).toString();
const mat = (i) => (2072251040571300000n + BigInt(i % 37)).toString();
const loc = (i) => (2065350054772500000n + BigInt(i % 11)).toString();

// one balance_index entry as the SA form stores it (the classic's fat balance copy, ~650 bytes)
const entryOf = (line, k, out) => ({ balance_id: (2051183829505900000n + BigInt(line * 100 + k)).toString(), material_id: mat(line), plant_id: PLANT, location_id: loc(line + k),
  batch_id: null, balance_quantity: 35, unrestricted_qty: 35, block_qty: 0, qualityinsp_qty: 0, reserved_qty: 0, intransit_qty: 0, organization_id: ORG, tenant_id: "000000",
  create_user: "1123598821738675201", create_time: "2026-05-04 14:15:08.763", create_dept: "1123598813738675202", update_user: "1123598821738675201",
  update_time: "2026-05-05 11:53:57.314", is_deleted: 0, material_uom: "2018906563477008392", fm_key: "um61e5u" + (k % 10), category: "Unrestricted", movement_type: out ? "OUT" : "In",
  sa_quantity: 1 + (k % 3) });

// a full SA line row (every column); unit_price with 4 dp (the sim's tenant rule stores 2)
function saLine(i, perLine, opts) {
  const o = opts || {};
  const entries = [];
  for (let k = 0; k < perLine; k++) entries.push(entryOf(i, k, (i + k) % 3 === 0));
  const total = entries.reduce((t, e) => t + e.sa_quantity, 0);
  const row = { material_id: mat(i), material_name: "Item " + (i % 37), material_desc: "", adjustment_reason: "Stock Count", total_quantity: String(total),
    uom_id: "2018906563477008392", unit_price: o.price === undefined ? 1.2345 + (i % 5) : o.price, adj_summary: "Total: " + total + " PCS", adjustment_remarks: "",
    balance_index: JSON.stringify(entries), line_index: String(i), plant_id: PLANT, item_category: "2018906563477008001", is_single_serial: 0, is_serialized_item: 0,
    item_remark: "r" + i, item_remark2: null, item_remark3: null, project_id: null };
  if (o.id) row.id = o.id;
  return row;
}
const fpRow = (l) => ({ j: JSON.stringify({ id: l.id, line_index: l.line_index, material_id: l.material_id, uom_id: l.uom_id, total_quantity: l.total_quantity, unit_price: l.unit_price,
  balance_index: l.balance_index, is_serialized_item: l.is_serialized_item }) });
const scFpRow = (l) => ({ j: JSON.stringify({ id: l.id, line_index: l.line_index, line_status: l.line_status, review_status: l.review_status, is_counted: l.is_counted, count_qty: l.count_qty,
  adjusted_qty: l.adjusted_qty, variance_qty: l.variance_qty }) });

function partRows(jobId, name, value) {
  return C.saPartRows(jobId, ORG, "P|" + NONCE + "|" + name + "|", value, "PAYLOAD");
}

// kind: "COMPLETE" (FORM, stored Draft -> edited lines, stock_count_id -> PARITY), "DIRECT" (FORM, no A1 / A3), "REVIEW"
function makeCase(kind, opts) {
  const o = Object.assign({ lines: 6, perLine: 2, prevStatus: kind === "REVIEW" ? "Cancelled" : "Draft", withSc: kind !== "DIRECT", scLines: 8 }, opts || {});
  seq = 0n;
  const review = kind === "REVIEW";
  const source = review ? "REVIEW" : "FORM";
  // stored SA lines (before the job): COMPLETE: the Draft's lines; DIRECT: the lines SUBMIT added; REVIEW: none
  const storedLines = [];
  // stored rows hold what the platform stored: unit_price at the sim's tenant rule (2 dp); lines a job writes carry 4 dp
  const stored2dp = (i) => Number((1.2345 + (i % 5)).toFixed(2));
  if (!review) for (let i = 1; i <= o.lines; i++) storedLines.push(saLine(i, o.perLine, { id: newId(), price: stored2dp(i) }));
  // the lines the job ends with: COMPLETE edits line 2's remark-free quantity, drops the last line, adds a new one
  let finalLines;
  if (kind === "COMPLETE") {
    finalLines = storedLines.slice(0, -1).map((l) => Object.assign({}, l));
    finalLines[1] = Object.assign(saLine(2, o.perLine + 1), { id: storedLines[1].id });
    finalLines.push(saLine(o.lines, o.perLine));
  } else if (review) {
    finalLines = [];
    for (let i = 1; i <= o.lines; i++) finalLines.push(saLine(i, o.perLine));
  } else finalLines = storedLines.map((l) => Object.assign({}, l));
  const lineFp = F.saLineFingerprint(storedLines);
  const incomingFp = F.saLineFingerprint(finalLines);
  const header = { id: SAID, stock_adjustment_status: "Processing", sa_v2_job_id: JOB, adjustment_no: "SA/20261016/0003", plant_id: PLANT, adjustment_date: "2026-10-16 00:00:00",
    adjustment_type: review ? "Stock Count" : "Write Off", stock_count_id: o.withSc ? SCID : null, adjusted_by: "tester", organization_id: ORG, project_id: null,
    acc_integration_type: "SQL Accounting V2", reference_documents: null, adjustment_remarks: "before", adjustment_remarks2: "", adjustment_remarks3: "", posted_status: "Unposted" };
  const docHeader = {};
  for (const k of SA_HDR) docHeader[k] = header[k];
  docHeader.adjustment_remarks = "edited at COMPLETE";
  // the Stock Count: REVIEW -> lines Approved with a variance (all approved ones become Adjusted); FORM -> PARITY
  const scLines = [];
  for (let i = 1; i <= (o.withSc ? o.scLines : 0); i++) {
    const approved = i % 4 !== 0;
    scLines.push({ id: (2111200000000000000n + BigInt(i)).toString(), line_index: String(i), line_status: approved ? "Approved" : i % 8 === 0 ? "Adjusted" : "Counted",
      review_status: approved ? "Approved" : "", is_counted: 1, count_qty: 5 + i * 0.125, adjusted_qty: null, variance_qty: approved ? 1.25 : 0, material_id: mat(i), balance_index: "[]" });
  }
  const scHeader = o.withSc ? { id: SCID, stock_count_no: "SC-0001", stock_count_status: "In Review", review_status: "In Review", adjustment_status: null } : null;
  // the review marks every Approved line Adjusted; line 1's count was edited in the form to 5 dp (the sim stores 3 dp)
  const scAfterLines = scLines.map((l) => (l.review_status === "Approved" && l.line_status !== "Adjusted" ? Object.assign({}, l, { line_status: "Adjusted" }) : Object.assign({}, l)));
  if (scAfterLines.length) scAfterLines[0].count_qty = 9.87654;
  const scPart = review ? Object.assign({ id: SCID, stock_count_status: "Completed", plant_id: PLANT, organization_id: ORG, count_type: "Full", count_method: "Blind", item_list: null,
    start_date: "2026-10-01 00:00:00", end_date: "2026-10-02 00:00:00", assignees: null, user_assignees: [], work_group_assignees: null, blind_count: 1, total_counted: String(o.scLines),
    total_variance: "9.87", review_status: "Completed", adjustment_status: scAfterLines.every((l) => l.line_status === "Adjusted") ? "Fully Adjusted" : "Partially Adjusted",
    stock_count_remark: "", stock_count_remark2: "", stock_count_remark3: "", attachment: null, previous_status: "In Review", table_stock_count: scAfterLines },
  { beforeFingerprint: F.scLineFingerprint(scLines), afterFingerprint: F.scLineFingerprint(scAfterLines) }) : o.withSc ? { mode: "PARITY", scId: SCID } : null;
  // ENGINE / LABELS: one movement per entry with sa_quantity > 0, in line then entry order
  const movements = [];
  const labels = {};
  finalLines.forEach((l, li) => {
    for (const e of JSON.parse(l.balance_index)) {
      const key = "M" + (movements.length + 1);
      const dir = C.saDirection(e.movement_type);
      movements.push({ movement_key: key, direction: dir, plant_id: PLANT, organization_id: ORG, material_id: l.material_id, quantity: e.sa_quantity, material_uom: l.uom_id,
        transaction_type: "SA", trx_no: header.adjustment_no, inventory_category: e.category || "Unrestricted", location_id: e.location_id, batch_id: null, manufacturing_date: null,
        expired_date: null, doc_date: header.adjustment_date, isMovingInv: 0, unit_price: parseFloat(l.unit_price) || 0,
        remark: dir === "ADD" ? l.item_remark : undefined, remark2: dir === "ADD" ? null : undefined, remark3: dir === "ADD" ? null : undefined });
      labels[key] = { line_index: l.line_index, line_id: l.id || "", item_code: "FG-" + l.line_index, item_name: l.material_name, bin: "A1-B" + li, bin_id: e.location_id,
        category: e.category || "Unrestricted", side: dir === "ADD" ? "in" : "out" };
    }
  });
  const items = [...new Set(finalLines.map((l) => l.material_id))].map((id) => ({ id: id, last_transaction_date: "2026-10-16T03:12:44.120Z" }));
  const parts = {
    ENGINE: { operation_key: "SAC|" + JOB, mode: "APPLY", organization_id: ORG, movements: movements },
    LABELS: labels,
    HDR: { id: SAID, before: { stock_adjustment_status: "Processing" }, after: { stock_adjustment_status: "Completed" } },
    ITEMS: { itemDates: items },
    REORDER: { document_type: "SA_COMPLETED", latest_data: finalLines, organization_id: ORG },
  };
  if (kind !== "DIRECT") parts.SALINES = { stock_adjustment: finalLines, header: review ? {} : docHeader, fingerprint: incomingFp };
  if (scPart) parts.SC = scPart;
  const rows = [];
  const names = {};
  for (const k of Object.keys(parts)) {
    const r = partRows(JOB, k, parts[k]);
    names[k] = r.map((x) => x.step_name);
    rows.push(...r);
  }
  const manifest = { v: 1, prepared_by: "SA_V2_PREPARE", job_id: JOB, sa_id: SAID, sa_no: header.adjustment_no, source: source, action: kind, prevStatus: o.prevStatus,
    sc_id: o.withSc ? SCID : "", organization_id: ORG, plant_id: PLANT, nonce: NONCE, lineFingerprint: lineFp, incomingFingerprint: incomingFp,
    scFingerprint: review ? scPart.beforeFingerprint : "", scAfterFingerprint: review ? scPart.afterFingerprint : "", parts: names,
    counts: { lines: finalLines.length, entries: movements.length, movements: movements.length, items: items.length } };
  const request = { v: 1, source: source, action: kind, prevStatus: o.prevStatus, saveAs: "Completed", pageStatus: review ? "Add" : "Edit", saId: SAID, saNo: header.adjustment_no,
    scId: review ? SCID : o.withSc ? SCID : "", lineFingerprint: lineFp, incomingFingerprint: incomingFp, edited: kind === "COMPLETE" ? 1 : 0, scFingerprint: manifest.scFingerprint,
    organizationId: ORG, plantId: PLANT, lineCount: finalLines.length, entryCount: movements.length, movementCount: movements.length, nonce: "ffff0000", parts: {} };
  return { kind, source, review, JOB, SAID, SCID, ORG, PLANT, NONCE, KEY, manifest, request, parts, partStepRows: rows, header, docHeader, storedLines, finalLines, scHeader, scLines,
    scAfterLines, scPart, movements, labels, items, lineFp, incomingFp };
}

function nodeById(doc, id) {
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.id === id && n.type) hit = n;
      else Object.values(n).forEach(walk);
    }
  };
  walk(doc);
  if (!hit) throw new Error("no node " + id);
  return hit;
}
const docs = {};
const built = (name) => docs[name] || (docs[name] = JSON.parse(fs.readFileSync(path.join(OUT, name + ".json"), "utf8")));
// the function definitions of one BUILT code node (exactly what ships), without its platform tail
function loadNode(name, id, names) {
  const code = nodeById(built(name), id).data.script.code;
  const lines = code.split("\n");
  const at = lines.findIndex((l) => /^const (res|guard|own|mid|pick|plan|claim) = /.test(l));
  const src = (at < 0 ? lines : lines.slice(0, at)).join("\n") + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(id + ": a platform token is left in the loaded body");
  return new Function(src)();
}

module.exports = { F, C, REPO, OUT, JOB, SAID, SCID, ORG, PLANT, NONCE, KEY, SA_HDR, SA_LINE_COLS, SC_PROPS, saLine, fpRow, scFpRow, partRows, makeCase, nodeById, built, loadNode, newId };
