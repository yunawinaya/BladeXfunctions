// node test/commit/test_l2.js - V2.1 bundles: COMMIT L2 with PREPARE's ALLOC part, on the BUILT LOT_V2_COMMIT.json code nodes
// (each node body up to its platform tail): DIRECT with ALLOC (the stored lines rewritten whole), the done-check after a re-run,
// the COMPLETE merge, COMPLETE without ALLOC (unchanged), and the entry's routing flags.
const fs = require("fs");
const path = require("path");
const BUILT = path.join(__dirname, "..", "..", "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_COMMIT.json");
const doc = JSON.parse(fs.readFileSync(BUILT, "utf8"));
const body = (id) => {
  let found = null;
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.id === id) found = n.data.script.code; Object.values(n).forEach(walk); } };
  walk(doc.nodes);
  if (!found) throw new Error("no node " + id);
  const lines = found.split("\n");
  return lines.slice(0, lines.findIndex((l) => l.includes("{{"))).join("\n");
};
const L2 = new Function("console", body("code_node_LCl2plan") + "\nreturn { commitL2Plan, commitL2Check, lotLineFingerprint, lotFlatRows, lotTreeRows };")({ log() {} });
const EN = new Function("console", body("code_node_LCentry") + "\nreturn { commitEntry };")({ log() {} });

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? "ok   " : "FAIL ") + label + (cond ? "" : " -> " + JSON.stringify(detail).slice(0, 400)));
};
const J = (o) => JSON.stringify(o);
const clone = (o) => JSON.parse(J(o));
const JOB = "2111005120857767938", LOT = "2105231525751984129", ORG = "1123598813738675201", NONCE = "abcd1234";
const P = "2105231525764567043", C1 = "2105231525764567044", C2 = "2105231525764567045", L = "2105231525764567047", BUNDLE = "2089258885490675714";
const BIN = "2018912822846582786", SRC = "2018912822846582700", M1 = "2070758892513914881", M2 = "2069242655534825474", M3 = "2064633018934157313";
const pick = (mat, qty) => J([{ material_id: mat, location_id: SRC, batch_id: null, balance_id: "", sm_quantity: qty, category: "Unrestricted", material_uom: "1940",
  plant_id: "1123598813738675202", organization_id: ORG, manufacturing_date: null, expired_date: null, is_deleted: 0 }]);
const ALLOC_TEXT = pick(M1, 6);
const allocRows = (lines, fingerprint) => [{ step_name: "P|" + NONCE + "|ALLOC|001", result_ref: J(fingerprint === undefined ? { lines: lines } : { lines: lines, fingerprint: fingerprint }) }];
const ALLOC_LINES = [{ id: C1, fm_key: "fmC1", temp_qty_data: ALLOC_TEXT, total_quantity: 6 }];
// the stored lines as sql_node_LCl2full reads them (every column), and as sql_node_LCl2lines (FP_LINES + total_quantity)
const full0 = [
  { id: P, item_selection: null, item_name: "IB/26/08/0002", requested_qty: "0.00000000", total_quantity: "2.00000000", quantity_uom: null, location_id: null,
    line_index: "1", temp_qty_data: "", item_bundle_id: BUNDLE, bundle_ratio: "0.00000000", parent_id: null, uom_options: "", is_serialized_item: 0 },
  { id: C1, item_selection: M1, item_name: "Child 1", requested_qty: "6.00000000", total_quantity: "0.00000000", quantity_uom: "1940", location_id: BIN,
    line_index: "2", temp_qty_data: "", item_bundle_id: BUNDLE, bundle_ratio: "3.00000000", parent_id: P, uom_options: "[{\"id\":\"1940\"}]", is_serialized_item: 0 },
  { id: C2, item_selection: M2, item_name: "Child 2", requested_qty: "2.00000000", total_quantity: "2.00000000", quantity_uom: "1940", location_id: BIN,
    line_index: "3", temp_qty_data: pick(M2, 2), item_bundle_id: BUNDLE, bundle_ratio: "1.00000000", parent_id: P, uom_options: "", is_serialized_item: 0 },
  { id: L, item_selection: M3, item_name: "Plain", requested_qty: "4.00000000", total_quantity: "4.00000000", quantity_uom: "1940", location_id: BIN,
    line_index: "4", temp_qty_data: pick(M3, 4), item_bundle_id: null, bundle_ratio: "0.00000000", parent_id: null, uom_options: "", is_serialized_item: 0 },
];
const FPCOLS = ["id", "line_index", "item_selection", "quantity_uom", "location_id", "temp_qty_data", "parent_id", "item_bundle_id", "total_quantity"];
const checkRows = (full) => full.map((r) => ({ j: J(FPCOLS.reduce((o, k) => Object.assign(o, { [k]: r[k] === undefined ? null : r[k] }), {})) }));
const fullRows = (full) => full.map((r) => ({ j: J(r) }));
const HDR = [{ j: J({ issuing_operation_faci: "1123598813738675202", issue_date: "2026-09-30 00:00:00", movement_type: "Location Transfer", movement_type_id: "",
  movement_reason: null, issued_by: "Zhen Xiang", reference_documents: null, organization_id: ORG, project_id: null, is_production_order: 0, production_order_id: null,
  remarks: "", remark: "", remark2: "", remark3: "" }) }];
const lineFp = L2.lotLineFingerprint(checkRows(full0));
const entry = (x) => Object.assign({ jobId: JOB, organizationId: ORG, lotId: LOT, action: "DIRECT", partPrefix: "P|" + NONCE + "|", sPartPrefix: "S|0|", hasAlloc: "YES",
  lineFingerprint: lineFp, incomingFingerprint: "", attempts: 0, rowVersion: 3, dbNow: "2026-10-19 14:00:00", jsAt: "" }, x || {});
const after = (full, mutate) => { const f = clone(full); for (const r of f) mutate(r); return f; };
const allocated = after(full0, (r) => { if (r.id === C1) { r.temp_qty_data = ALLOC_TEXT; r.total_quantity = "6.00000000"; } });
// PREPARE's ALLOC.fingerprint over the merged lines: every row (FP_LINES' view) or the flat lines (yPlLXIZW's view)
const fpAll = L2.lotLineFingerprint(checkRows(allocated));
const fpFlat = L2.lotLineFingerprint(L2.lotFlatRows(allocated));
const ALLOC = allocRows(ALLOC_LINES, fpAll);

// ------------------------------------------------------------------ 1. DIRECT with ALLOC: the stored lines rewritten whole, the picks set by id
{
  const plan = L2.commitL2Plan(entry(), [], ALLOC, checkRows(full0), fullRows(full0), HDR);
  const sm = (plan.row || {}).stock_movement || [];
  const p0 = sm[0] || {};
  const c1 = (p0.children || []).filter((r) => r.id === C1)[0] || {};
  check("DIRECT + ALLOC: one write of the whole subform", plan.route === "GO" && plan.needWrite === "YES" && plan.lineCount === 4, plan);
  check("DIRECT + ALLOC: the tree (bundle parent, its children in line_index order, then the plain line)",
    sm.length === 2 && p0.id === P && J((p0.children || []).map((r) => r.id)) === J([C1, C2]) && sm[1].id === L, sm.map((r) => [r.id, (r.children || []).map((c) => c.id)]));
  check("DIRECT + ALLOC: the ALLOC picks on its line, every other column as stored",
    c1.temp_qty_data === ALLOC_TEXT && c1.total_quantity === "6.00000000" && c1.uom_options === "[{\"id\":\"1940\"}]" && c1.parent_id === P && c1.bundle_ratio === "3.00000000", c1);
  check("DIRECT + ALLOC: PO_SAVE's tree shape - fm_key = id on every row, each child with parent_fm_key = parent_id = its parent",
    L2.lotTreeRows(sm).every((r) => r.fm_key === r.id) && (p0.children || []).every((c) => c.parent_fm_key === P && c.parent_id === P)
    && !("parent_fm_key" in p0) && !("parent_fm_key" in sm[1]), L2.lotTreeRows(sm).map((r) => [r.id, r.fm_key, r.parent_fm_key, r.parent_id]));
  check("DIRECT + ALLOC: the header props written back as stored, no status",
    plan.row.issue_date === "2026-09-30 00:00:00" && plan.row.issued_by === "Zhen Xiang" && plan.row.movement_reason === null && !("stock_movement_status" in plan.row)
    && Object.keys(plan.row).length === 17, Object.keys(plan.row));
  check("DIRECT + ALLOC: expect = stored mode, target = ALLOC.fingerprint, the parents map", plan.expect.mode === "STORED" && plan.expect.target === fpAll
    && plan.expect.parents[C1] === P && plan.expect.parents[L] === "" && plan.expect.parents[P] === "", plan.expect);
  const flatPlan = L2.commitL2Plan(entry(), [], allocRows(ALLOC_LINES, fpFlat), checkRows(full0), fullRows(full0), HDR);
  check("DIRECT + ALLOC: an ALLOC.fingerprint over the flat lines is accepted too", flatPlan.route === "GO" && flatPlan.needWrite === "YES"
    && L2.commitL2Check(entry(), clone(flatPlan), checkRows(allocated)).route === "OK", flatPlan.result_message);
  const wrongFp = L2.commitL2Plan(entry(), [], allocRows(ALLOC_LINES, "LF1:4:0000000000000000"), checkRows(full0), fullRows(full0), HDR);
  check("DIRECT + ALLOC: an ALLOC.fingerprint the merged lines can never reach -> REQUIRES_REVIEW before writing", wrongFp.route === "END" && wrongFp.job_status === "REQUIRES_REVIEW"
    && wrongFp.needWrite === "NO", wrongFp.result_message);
  const noFp = L2.commitL2Plan(entry(), [], allocRows(ALLOC_LINES), checkRows(full0), fullRows(full0), HDR);
  check("DIRECT + ALLOC without a fingerprint: write, then checked against lineFingerprint with the ALLOC lines blank", noFp.needWrite === "YES" && noFp.expect.target === ""
    && L2.commitL2Check(entry(), clone(noFp), checkRows(allocated)).route === "OK"
    && L2.commitL2Check(entry(), clone(noFp), checkRows(after(allocated, (r) => { if (r.id === L) r.location_id = SRC; }))).route === "END", noFp.expect);
  const ok = L2.commitL2Check(entry(), clone(plan), checkRows(allocated));
  check("DIRECT + ALLOC: read back with the picks -> L2_LINES DONE", ok.route === "OK" && ok.stepRows[0].step_name === "L2_LINES", ok);
  const otherLine = L2.commitL2Check(entry(), clone(plan), checkRows(after(allocated, (r) => { if (r.id === L) r.location_id = SRC; })));
  check("DIRECT + ALLOC: another line read back changed -> retry", otherLine.route === "END" && otherLine.result_code === "LOT_STEP_RETRY", otherLine.result_message);
  const lostParent = L2.commitL2Check(entry(), clone(plan), checkRows(after(allocated, (r) => { if (r.id === C1) r.parent_id = null; })));
  check("DIRECT + ALLOC: a child read back without its parent -> retry", lostParent.route === "END" && lostParent.result_code === "LOT_STEP_RETRY", lostParent.result_message);
  const notWritten = L2.commitL2Check(entry(), clone(plan), checkRows(full0));
  check("DIRECT + ALLOC: picks not read back -> retry", notWritten.route === "END" && notWritten.result_code === "LOT_STEP_RETRY", notWritten.result_message);
  const badTotal = L2.commitL2Check(entry(), clone(plan), checkRows(after(allocated, (r) => { if (r.id === C1) r.total_quantity = "5.00000000"; })));
  check("DIRECT + ALLOC: picks read back but total_quantity off -> retry (the fingerprint has no total_quantity)", badTotal.route === "END"
    && /allocated line/.test(badTotal.result_message), badTotal.result_message);
  const rounded = L2.commitL2Check(entry(), clone(plan), checkRows(after(allocated, (r) => { if (r.id === C1) r.total_quantity = "6.000"; })));
  check("DIRECT + ALLOC: total_quantity compared numerically (tenant rounding)", rounded.route === "OK", rounded.result_message);
}
// ------------------------------------------------------------------ 2. the done-check after a re-run (the write already landed)
{
  const stored = after(allocated, (r) => { if (r.id === C1) r.total_quantity = "6.000"; });
  const plan = L2.commitL2Plan(entry(), [], ALLOC, checkRows(stored), fullRows(stored), HDR);
  check("re-run: the picks already stored -> no write", plan.route === "GO" && plan.needWrite === "NO" && plan.expect.mode === "STORED", plan);
  const ok = L2.commitL2Check(entry(), clone(plan), checkRows(stored));
  check("re-run: the check passes -> L2_LINES DONE", ok.route === "OK", ok.result_message);
  const changed = after(full0, (r) => { if (r.id === L) r.temp_qty_data = pick(M3, 3); });
  const r1 = L2.commitL2Plan(entry(), [], ALLOC, checkRows(changed), fullRows(changed), HDR);
  check("re-run: another line changed since the save -> REQUIRES_REVIEW", r1.route === "END" && r1.job_status === "REQUIRES_REVIEW", r1.result_message);
  const other = after(full0, (r) => { if (r.id === C1) r.temp_qty_data = pick(M1, 1); });
  const r2 = L2.commitL2Plan(entry(), [], ALLOC, checkRows(other), fullRows(other), HDR);
  check("re-run: the ALLOC line holds other picks -> REQUIRES_REVIEW", r2.route === "END" && r2.job_status === "REQUIRES_REVIEW" && /other picks/.test(r2.result_message), r2.result_message);
  const r3 = L2.commitL2Plan(entry(), [], allocRows([{ id: "2105231525764567099", temp_qty_data: ALLOC_TEXT, total_quantity: 6 }], fpAll), checkRows(full0), fullRows(full0), HDR);
  check("an ALLOC line that is not a stored line -> REQUIRES_REVIEW", r3.route === "END" && r3.job_status === "REQUIRES_REVIEW", r3.result_message);
  const r4 = L2.commitL2Plan(entry(), [], [], checkRows(full0), fullRows(full0), HDR);
  check("hasAlloc but no ALLOC rows -> REQUIRES_REVIEW", r4.route === "END" && r4.job_status === "REQUIRES_REVIEW", r4.result_message);
}
// ------------------------------------------------------------------ 3. COMPLETE with ALLOC: the picks merged into the S lines by id
{
  const form = (r, extra) => Object.assign({}, r, { fm_key: r.id }, extra || {});
  const sTree = [Object.assign(form(full0[0]), { children: [form(full0[1], { parent_fm_key: P, temp_qty_data: "" }), form(full0[2], { parent_fm_key: P })] }), form(full0[3])];
  const incoming = L2.lotLineFingerprint(L2.lotTreeRows(sTree));
  // the stored In Progress lines before the save: C1 held a pick the user cleared
  const storedBefore = after(full0, (r) => { if (r.id === C1) { r.temp_qty_data = pick(M1, 2); r.total_quantity = "2.00000000"; } });
  const e = entry({ action: "COMPLETE", hasAlloc: "YES", sPartPrefix: "S|ab12cd34|", lineFingerprint: L2.lotLineFingerprint(checkRows(storedBefore)), incomingFingerprint: incoming });
  const S = [{ step_name: "S|ab12cd34|LINES|001", result_ref: J({ v: 1, lotId: LOT, header: { remarks: "edited", issue_date: "2026-09-30 00:00:00" }, stock_movement: sTree, fingerprint: incoming }) }];
  const mergedTree = [Object.assign({}, sTree[0], { children: [Object.assign({}, sTree[0].children[0], { temp_qty_data: ALLOC_TEXT, total_quantity: "6.00000000" }),
    sTree[0].children[1]] }), sTree[1]];
  const mergedAll = L2.lotLineFingerprint(L2.lotTreeRows(mergedTree));
  const CALLOC = allocRows(ALLOC_LINES, mergedAll);
  const plan = L2.commitL2Plan(e, S, CALLOC, checkRows(storedBefore), [], []);
  const c1 = ((plan.row.stock_movement || [])[0].children || [])[0] || {};
  check("COMPLETE + ALLOC: one write, the S lines with the picks merged by id", plan.route === "GO" && plan.needWrite === "YES" && c1.id === C1 && c1.temp_qty_data === ALLOC_TEXT
    && c1.total_quantity === "6.00000000" && c1.fm_key === C1 && c1.parent_fm_key === P && plan.row.remarks === "edited", c1);
  check("COMPLETE + ALLOC: the target is ALLOC.fingerprint = the merged lines (not incomingFingerprint)", plan.expect.mode === "INCOMING" && plan.expect.target === mergedAll
    && L2.lotLineFingerprint(L2.lotTreeRows(plan.row.stock_movement)) === mergedAll && mergedAll !== incoming, plan.expect);
  check("COMPLETE + ALLOC: the tree goes out as sent (top-level rows, children nested, ids kept)", plan.row.stock_movement.length === 2 && plan.row.stock_movement[0].id === P
    && J(plan.row.stock_movement[0].children.map((r) => r.id)) === J([C1, C2]) && plan.row.stock_movement[1].id === L, plan.row.stock_movement.map((r) => r.id));
  check("COMPLETE + ALLOC: incomingFingerprint over every row, bundle parent included (SUBMIT's lotTreeRows)", L2.lotTreeRows(sTree).length === 4
    && incoming === L2.lotLineFingerprint(L2.lotTreeRows(sTree)) && incoming !== L2.lotLineFingerprint(L2.lotFlatRows(sTree)), incoming);
  const ok = L2.commitL2Check(e, clone(plan), checkRows(allocated));
  check("COMPLETE + ALLOC: read back merged -> L2_LINES DONE", ok.route === "OK", ok.result_message);
  const unmerged = L2.commitL2Check(e, clone(plan), checkRows(after(full0, () => {})));
  check("COMPLETE + ALLOC: read back without the picks -> retry", unmerged.route === "END" && unmerged.result_code === "LOT_STEP_RETRY", unmerged.result_message);
  const again = L2.commitL2Plan(e, S, CALLOC, checkRows(allocated), [], []);
  check("COMPLETE + ALLOC: re-run after the write (stored = target) -> write again (harmless)", again.route === "GO" && again.needWrite === "YES", again.result_message);
  const elsewise = L2.commitL2Plan(e, S, CALLOC, checkRows(after(full0, (r) => { if (r.id === L) r.location_id = SRC; })), [], []);
  check("COMPLETE + ALLOC: stored lines neither before nor after -> REQUIRES_REVIEW", elsewise.route === "END" && elsewise.job_status === "REQUIRES_REVIEW", elsewise.result_message);
  const missing = L2.commitL2Plan(e, S, allocRows([{ id: "2105231525764567099", temp_qty_data: ALLOC_TEXT, total_quantity: 6 }], mergedAll), checkRows(storedBefore), [], []);
  check("COMPLETE + ALLOC: no fingerprint in the ALLOC part -> the merged lines (every row) are the target", L2.commitL2Plan(e, S, allocRows(ALLOC_LINES), checkRows(storedBefore), [], [])
    .expect.target === mergedAll);
  const flatAlloc = L2.commitL2Plan(e, S, allocRows(ALLOC_LINES, L2.lotLineFingerprint(L2.lotFlatRows(mergedTree))), checkRows(storedBefore), [], []);
  check("COMPLETE + ALLOC: an ALLOC.fingerprint over the flat merged lines is accepted too", flatAlloc.route === "GO" && L2.commitL2Check(e, clone(flatAlloc), checkRows(allocated)).route === "OK",
    flatAlloc.result_message);
  const bad = L2.commitL2Plan(e, S, allocRows(ALLOC_LINES, incoming), checkRows(storedBefore), [], []);
  check("COMPLETE + ALLOC: an ALLOC.fingerprint the merged lines never reach -> REQUIRES_REVIEW before writing", bad.route === "END" && bad.job_status === "REQUIRES_REVIEW", bad.result_message);
  check("COMPLETE + ALLOC: an ALLOC line not in the S lines -> REQUIRES_REVIEW", missing.route === "END" && missing.job_status === "REQUIRES_REVIEW", missing.result_message);
}
// ------------------------------------------------------------------ 4. COMPLETE without ALLOC: as before (target = incomingFingerprint)
{
  // an unedited bundle COMPLETE: the S tree = the stored lines; SUBMIT's fingerprints both cover every row, bundle parent included
  const storedB = after(full0, (r) => { if (r.id === C1) { r.temp_qty_data = pick(M1, 6); r.total_quantity = "6.00000000"; } });
  const formB = (r, extra) => Object.assign({}, r, { fm_key: r.id }, extra || {});
  const treeB = [Object.assign(formB(storedB[0]), { children: [formB(storedB[1], { parent_fm_key: P }), formB(storedB[2], { parent_fm_key: P })] }), formB(storedB[3])];
  const incomingB = L2.lotLineFingerprint(L2.lotTreeRows(treeB));
  const eB = entry({ action: "COMPLETE", hasAlloc: "NO", sPartPrefix: "S|ab12cd34|", lineFingerprint: L2.lotLineFingerprint(checkRows(storedB)), incomingFingerprint: incomingB });
  const SB = [{ step_name: "S|ab12cd34|LINES|001", result_ref: J({ v: 1, lotId: LOT, header: {}, stock_movement: treeB, fingerprint: incomingB }) }];
  const planB = L2.commitL2Plan(eB, SB, [], checkRows(storedB), [], []);
  check("COMPLETE, unedited bundle: incomingFingerprint = lineFingerprint (every row) -> one write of the tree as sent", incomingB === eB.lineFingerprint && planB.route === "GO"
    && planB.needWrite === "YES" && planB.expect.target === incomingB && J(planB.row.stock_movement) === J(treeB), planB.result_message);
  const okB = L2.commitL2Check(eB, clone(planB), checkRows(storedB));
  check("COMPLETE, unedited bundle: read back -> L2_LINES DONE", okB.route === "OK", okB.result_message);
}
{
  const plain = [full0[3]];
  const sTree = [Object.assign({}, plain[0], { fm_key: "fm47", temp_qty_data: pick(M3, 3), total_quantity: 3 })];
  const incoming = L2.lotLineFingerprint(sTree);
  const e = entry({ action: "COMPLETE", hasAlloc: "NO", sPartPrefix: "S|ab12cd34|", lineFingerprint: L2.lotLineFingerprint(checkRows(plain)), incomingFingerprint: incoming });
  const S = [{ step_name: "S|ab12cd34|LINES|001", result_ref: J({ v: 1, lotId: LOT, header: {}, stock_movement: sTree, fingerprint: incoming }) }];
  const plan = L2.commitL2Plan(e, S, [], checkRows(plain), [], []);
  check("COMPLETE, no ALLOC: the S lines as sent, target incomingFingerprint", plan.route === "GO" && plan.needWrite === "YES" && plan.expect.target === incoming
    && J(plan.row.stock_movement) === J(sTree) && plan.expect.alloc.length === 0, plan);
  const ok = L2.commitL2Check(e, clone(plan), checkRows([Object.assign({}, plain[0], { temp_qty_data: pick(M3, 3), total_quantity: "3.00000000" })]));
  check("COMPLETE, no ALLOC: read back at incomingFingerprint -> DONE", ok.route === "OK", ok.result_message);
  const r = L2.commitL2Plan(entry({ action: "DIRECT", hasAlloc: "NO" }), [], [], checkRows(full0), [], []);
  check("DIRECT without ALLOC never reaches L2 (and refuses if it did)", r.route === "END" && r.job_status === "REQUIRES_REVIEW", r.result_message);
}
// ------------------------------------------------------------------ 5. the entry's routing (phase B after L1)
{
  const guard = { jobId: JOB, tenantId: "000000", leaseOwner: "PUB|00ff", nonce: "00ff" };
  const job = (action, x) => [Object.assign({ db_now: "2026-10-19 14:00:00", lease_until: "2026-10-19 14:10:00", id: JOB, organization_id: ORG, command: "SAVE_LOT",
    job_status: "COMMITTING_LOT", progress_percent: 80, attempt_count: 0, lease_owner: "SPLIT|aa", lease_live: 1, due: 1, row_version: 5, is_deleted: 0,
    idempotency_key: "LOT:K1", correlation_id: "LOT|" + LOT, line_count: 4, prev_status: action === "DIRECT" || action === "STAGE" ? "Draft" : "In Progress",
    req_action: action, req_save_as: { DIRECT: "Completed", STAGE: "In Progress", COMPLETE: "Completed", CANCEL: "Cancelled" }[action], req_nonce: "ab12cd34",
    line_fp: lineFp, incoming_fp: "LF1:1:00" }, x || {})];
  const steps = [{ step_name: "L0_REVALIDATE", step_status: "DONE" }, { step_name: "L1_INVENTORY", step_status: "DONE" }];
  const parts = (alloc) => Object.assign({ ENGINE: ["x"], LABELS: ["x"], IT: ["x"], HDR: ["x"], ITEMS: ["x"] }, alloc ? { ALLOC: ["P|" + NONCE + "|ALLOC|001"] } : {});
  const pay = (action, alloc) => [{ prepared_payload: J({ v: 1, job_id: JOB, lot_id: LOT, lot_no: "LOT-1", action: action, nonce: NONCE, lineCount: 4,
    parts: parts(alloc), counts: { itCreates: 0, itUpdates: 0 } }) }];
  const lot = (st) => [{ lot_id: LOT, stock_movement_status: st || "Processing", lot_v2_job_id: JOB, lock_ref: "LOT:K1" }];
  const r1 = EN.commitEntry(guard, job("DIRECT"), steps, pay("DIRECT", true), lot(), []);
  check("entry: DIRECT + ALLOC -> L2 due, whole stored lines read", r1.route === "GO" && r1.needL2 === "YES" && r1.needL2Full === "YES" && r1.hasAlloc === "YES", r1);
  const r2 = EN.commitEntry(guard, job("DIRECT"), steps, pay("DIRECT", false), lot(), []);
  check("entry: DIRECT without ALLOC -> no L2 (as before)", r2.route === "GO" && r2.needL2 === "NO" && r2.needL2Full === "NO" && r2.hasAlloc === "NO", r2);
  const r3 = EN.commitEntry(guard, job("COMPLETE"), steps, pay("COMPLETE", true), lot(), []);
  check("entry: COMPLETE + ALLOC -> L2 due on the S lines (no whole stored read)", r3.route === "GO" && r3.needL2 === "YES" && r3.needL2Full === "NO" && r3.hasAlloc === "YES", r3);
  const r4 = EN.commitEntry(guard, job("CANCEL"), steps, pay("CANCEL", true), lot(), []);
  check("entry: CANCEL + ALLOC -> manifest refused (after L1: REQUIRES_REVIEW)", r4.route === "REVIEW" && r4.job_status === "REQUIRES_REVIEW", r4);
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
