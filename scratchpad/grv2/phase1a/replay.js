// Phase 1a replay: every cached PO_SAVE run (dev v39 + prod v22) through the NEW nodes, compared with what the run recorded.
// Inputs are the run's own payload and the rows its get / search nodes read (projected to the new sql-nodes' shapes).
// Usage: node replay.js <runs dir> <new workflow json> [--verbose]
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");

const runsDir = process.argv[2];
const NEW = L.readWorkflow(process.argv[3]);
// the versions a recorded run must have executed for its outputs to be the reference: dev v39 / prod v22
const REF = { dev: L.readWorkflow(path.join(__dirname, "base", "PO_SAVE.v39.json")).idx, prod: L.readWorkflow(process.argv[4]).idx };
const VERBOSE = process.argv.includes("--verbose");
const N = NEW.idx;

const stats = {};
const fails = [];
function ok(cat) {
  stats[cat] = stats[cat] || { ok: 0, fail: 0, skip: 0 };
  stats[cat].ok++;
}
function skip(cat) {
  stats[cat] = stats[cat] || { ok: 0, fail: 0, skip: 0 };
  stats[cat].skip++;
}
function fail(cat, run, detail) {
  stats[cat] = stats[cat] || { ok: 0, fail: 0, skip: 0 };
  stats[cat].fail++;
  fails.push(cat + " " + run + " " + detail);
}
const J = (x) => JSON.stringify(x === undefined ? null : x);
function eq(a, b) {
  return J(canon(a)) === J(canon(b));
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    // a recorded code-node output omits null-valued keys; absent and null both write NULL
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined && v[k] !== null) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const dataOf = (node) => (node && node.out && typeof node.out === "object" ? node.out.data : undefined);
const one = (x) => (Array.isArray(x) ? x[0] : x);
const rowsOf = (node) => {
  const d = dataOf(node);
  const x = d && typeof d === "object" && "data" in d ? d.data : d;
  return Array.isArray(x) ? x : x ? [x] : [];
};
const s8 = (v) => (v === undefined || v === null || v === "" ? null : Number(v).toFixed(8));
const str = (v) => (v === undefined || v === null ? null : String(v));
const flatten = (rows) => {
  const out = [];
  for (const r of rows || []) {
    out.push(r);
    for (const c of Array.isArray(r.children) ? r.children : []) out.push(c);
  }
  return out;
};

// decode a multi-layer alt_uom to its compact one-layer form (what the new fillback writes)
function compactAlt(v) {
  if (v === undefined || v === null || v === "") return v;
  try {
    let x = v;
    for (let i = 0; i < 64 && typeof x === "string"; i++) x = JSON.parse(x);
    const keep = (c) => (c && typeof c === "object" ? { alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id } : c);
    return JSON.stringify(Array.isArray(x) ? x.map(keep) : keep(x));
  } catch (e) {
    return v;
  }
}

// VALIDATE_QUANTITY's verdict with the v39 nodes (Check Doc No -> Map Validate Quantity) on a payload
function v39Qty(a, tenant) {
  const B = REF.dev;
  const ctx = { params: { allData: a }, out: {}, loops: {}, system: { tenantId: tenant }, global: { nickname: null } };
  for (const nid of ["code_check_doc_no", "code_map_validate_qty"]) ctx.out[nid] = { data: L.runCode(B[nid].data.script.code, ctx, L.declared(B[nid])) };
  const m = ctx.out.code_map_validate_qty.data;
  return L.validateQuantity(m.lineItem, m.itemFields, m.quantityFields);
}

const WRITTEN_HEADER = (N.update_po.data.props.list || []).map((p) => p.prop).filter((p) => p !== "id" && p !== "table_po");

function replay(file) {
  const run = L.loadRun(file);
  const rid = path.basename(file, ".json");
  const env = rid.startsWith("prod") ? "prod" : "dev";
  const n = run.nodes;
  const a = run.allData;
  if (!a || typeof a !== "object") return skip("payload");
  const ctx = { params: { allData: a }, out: {}, loops: {}, system: { tenantId: run.meta.tenant_id }, global: { nickname: null } };
  const exec = (nid) => {
    const node = N[nid];
    ctx.out[nid] = { data: L.runCode(node.data.script.code, ctx, L.declared(node)) };
    return ctx.out[nid].data;
  };
  const isDraft = a.po_status == "Draft";
  // a recorded node is a reference only when the run executed the same script as the reference version
  const same = (nid) => {
    const rec = n[nid];
    const ref = REF[env][nid];
    if (!rec || !ref) return false;
    const code = rec.req && typeof rec.req === "object" ? rec.req.code : undefined;
    return code !== undefined && ref.data && ref.data.script && code === ref.data.script.code;
  };

  // ------------------------------------------------ pre-save gates
  const pre = exec("code_pre");
  // CHECK_REQUIRED_FIELD: old input vs new input -> same verdict
  const reqOld = isDraft ? n.code_draft_required : n.code_required;
  const wfReq = isDraft ? n.wf_draft_check_required : n.wf_check_required;
  const reqNew = isDraft ? L.checkRequiredField(pre.draftRequiredEntry, pre.draftRequiredFields) : L.checkRequiredField(pre.requiredEntry, pre.requiredFields);
  if (wfReq) {
    const rec = (dataOf(wfReq) || {}).data || {};
    eq({ status: rec.status, message: rec.message }, reqNew) ? ok("gate.required") : fail("gate.required", rid, J(rec) + " vs " + J(reqNew));
    if (reqOld && same(isDraft ? "code_draft_required" : "code_required")) {
      const o = dataOf(reqOld);
      const old = L.checkRequiredField(o.data, o.required_fields);
      eq(old, reqNew) ? ok("gate.required.sameAsOldInput") : fail("gate.required.sameAsOldInput", rid, J(old) + " vs " + J(reqNew));
    }
  }
  if (isDraft) {
    // draft doc marker: the fillback entry is checked below
  } else {
    if (n.wf_validate_qty && same("code_map_validate_qty")) {
      const rec = (dataOf(n.wf_validate_qty) || {}).data || {};
      const mine = L.validateQuantity(pre.lineItem, pre.itemFields, pre.quantityFields);
      if (env === "dev") eq({ status: rec.status, message: rec.message }, mine) ? ok("gate.qty") : fail("gate.qty", rid, J(rec) + " vs " + J(mine));
      else {
        // prod v22 names the item by its id in this message (fixed in dev v39, the base): the reference is v39 on this payload
        const ref = v39Qty(a, run.meta.tenant_id);
        eq(ref, mine) ? ok("gate.qty (v39 on the prod payload)") : fail("gate.qty (v39 on the prod payload)", rid, J(ref) + " vs " + J(mine));
        rec.status === mine.status ? ok("gate.qty status (prod recorded)") : fail("gate.qty status (prod recorded)", rid, rec.status + " vs " + mine.status);
      }
    }
    if (n.code_count_lines && same("code_count_lines") && same("code_filter_lines")) {
      const rec = dataOf(n.code_count_lines).length;
      rec === pre.lineCount ? ok("gate.lineCount") : fail("gate.lineCount", rid, rec + " vs " + pre.lineCount);
    }
    if (n.code_direct_pi_zero && same("code_direct_pi_zero")) {
      const rec = dataOf(n.code_direct_pi_zero);
      eq({ piConfirm: rec.piConfirm, gateOut: rec.gateOut }, { piConfirm: pre.piConfirm, gateOut: pre.piGateOut }) ? ok("gate.piZero") : fail("gate.piZero", rid, J(rec));
    }
    if (n.code_map_approval_data && same("code_map_approval_data")) {
      const rec = dataOf(n.code_map_approval_data);
      const oldPo = rec.poData;
      const same = oldPo.min_price_result === pre.minPriceResult && oldPo.max_price_result === pre.maxPriceResult &&
        oldPo.amount_result === pre.approvalData.amount_result && rec.message === pre.priceMessage;
      same ? ok("gate.price") : fail("gate.price", rid, J([oldPo.min_price_result, oldPo.max_price_result, rec.message]) + " vs " + J([pre.minPriceResult, pre.maxPriceResult, pre.priceMessage]));
      // CHECK_APPROVAL: every PO config, the old whole-PO input and the new slim one decide the same
      let agree = true;
      for (let m = 0; m < 64 && agree; m++) {
        const cfg = { po_issued: m & 1, po_convert: (m >> 1) & 1, po_min_price: (m >> 2) & 1, po_max_price: (m >> 3) & 1, po_amount: (m >> 4) & 1,
          po_document_status: m & 32 ? "issued" : "draft" };
        const o = L.checkApprovalPO(oldPo, cfg);
        const s = L.checkApprovalPO(pre.approvalData, cfg);
        const pick = (r) => ({ need: r.needApproval, ac: r.poData.approval_condition, st: r.poData.po_status, no: r.poData.purchase_order_no });
        if (!eq(pick(o), pick(s))) agree = false;
      }
      agree ? ok("gate.approval(64 configs)") : fail("gate.approval(64 configs)", rid, "differs");
    }
    if (n.code_map_err && same("code_map_err")) {
      const gr = rowsOf(n.search_draft_gr).map((r) => ({ kind: "GR", doc_no: r.gr_no }));
      const pi = rowsOf(n.search_draft_pi).map((r) => ({ kind: "PI", doc_no: r.purchase_invoice_no }));
      ctx.out.sql_draft_grpi = { data: gr.concat(pi) };
      const mine = exec("code_map_err");
      const rec = dataOf(n.code_map_err);
      eq(rec, mine) ? ok("gate.draftGRPI") : fail("gate.draftGRPI", rid, J(rec) + " vs " + J(mine));
    }
  }
  // the run's own outcome: a gate failure must be the same gate with the same message
  const endNode = Object.keys(n).find((k) => /^end_/.test(k) && k !== "end");
  if (run.meta.status === "Fail" && /^end_/.test(run.meta.current_node_id || "")) {
    const cur = run.meta.current_node_id;
    const msg = String(run.meta.error_msg || "");
    let mine = null;
    if (isDraft) mine = reqNew.status === "Failed" ? ["end_draft_400", reqNew.message] : null;
    else if (reqNew.status === "Failed") mine = ["end_required_400", reqNew.message];
    else {
      const q = L.validateQuantity(pre.lineItem, pre.itemFields, pre.quantityFields);
      if (q.status !== "Passed") mine = ["end_qty_401", same("code_map_validate_qty") && env === "dev" ? q.message : undefined];
      else if (pre.lineCount == 0) mine = ["end_empty_401", "'Line Item cannot be empty'"];
      else if (cur === "end_draft_404") mine = ["end_draft_404", (ctx.out.code_map_err || { data: {} }).data.message];
      else if (cur === "end_price_min_402" && pre.minPriceResult === "failed") mine = ["end_price_min_402", pre.priceMessage];
      else if (cur === "end_price_max_402" && pre.maxPriceResult === "failed") mine = ["end_price_max_402", pre.priceMessage];
    }
    if (!mine) fail("outcome.gate", rid, cur + " not reproduced");
    else if (mine[0] !== cur) fail("outcome.gate", rid, cur + " vs " + mine[0]);
    else if (msg && mine[1] !== undefined && !msg.startsWith(String(mine[1]).slice(0, 150)) && !String(mine[1]).startsWith(msg.slice(0, 150))) fail("outcome.gate", rid, J(msg.slice(0, 120)) + " vs " + J(String(mine[1]).slice(0, 120)));
    else ok("outcome.gate");
    return;
  }
  if (!n.code_fillback) return skip("noFillback");
  if (!same("code_fillback")) return skip("fillback.otherVersion");

  // ------------------------------------------------ fillback
  // CHECK_APPROVAL's answer as the slim call returns it: needApproval + (approval) the header fields it handed back
  if (n.wf_check_approval) {
    const rec = dataOf(n.wf_check_approval) || {};
    const back = rec.data && typeof rec.data === "object" ? rec.data : null;
    const slim = back ? Object.assign({}, pre.approvalData) : null;
    if (back) for (const k of ["po_status", "purchase_order_no", "approval_condition", "previous_status", "preq_id"]) if (k in back) slim[k] = back[k];
    ctx.out.wf_check_approval = { data: rec.needApproval === "Yes" ? { needApproval: "Yes", data: slim } : { needApproval: rec.needApproval } };
  }
  // the fresh read of the stored lines: in a replay, the values the run wrote (GR / PI did not move in between)
  const readBack = one((dataOf(n.get_one_po) || {}).data);
  ctx.out.sql_po_owned = {
    data: a.page_status == "Edit" && readBack
      ? flatten(readBack.table_po).map((r) => ({ id: str(r.id), received_qty: s8(r.received_qty), created_received_qty: s8(r.created_received_qty), invoice_qty: s8(r.invoice_qty),
        return_quantity: s8(r.return_quantity), created_return_qty: s8(r.created_return_qty), line_status: r.line_status, head_po_status: readBack.po_status }))
      : [],
  };
  const fb = exec("code_fillback");
  const recEntry = dataOf(n.code_fillback).entry;
  // header fields Add / Update Data write
  const hdrDiff = [];
  for (const k of WRITTEN_HEADER) {
    if (env === "prod" && k === "approval_condition") continue; // prod v22 did not clear it
    if (!eq(recEntry[k], fb.entry[k])) hdrDiff.push(k + ": " + J(recEntry[k]) + " vs " + J(fb.entry[k]));
  }
  hdrDiff.length ? fail("fillback.header", rid, hdrDiff.slice(0, 3).join("; ")) : ok("fillback.header");
  // lines: every key, with the deliberate differences normalised (alt_uom one layer, outstanding clamped at 0)
  const recLines = flatten(recEntry.table_po);
  const newLines = flatten(fb.entry.table_po);
  if (recLines.length !== newLines.length) fail("fillback.lines", rid, recLines.length + " vs " + newLines.length + " lines");
  else {
    let bad = null;
    let altFixed = 0;
    let clamped = 0;
    let ownedRestored = 0;
    recLines.forEach((r, i) => {
      const x = Object.assign({}, newLines[i]);
      const y = Object.assign({}, r);
      delete x.children;
      delete y.children;
      if ("alt_uom" in y) {
        if (y.alt_uom !== x.alt_uom) altFixed++;
        y.alt_uom = compactAlt(y.alt_uom);
      }
      if (typeof y.outstanding_quantity === "number" && y.outstanding_quantity < 0) {
        clamped++;
        y.outstanding_quantity = 0;
      }
      for (const k of ["received_qty", "created_received_qty", "invoice_qty", "return_quantity", "created_return_qty"]) {
        // the stored value replaces the form's: equal unless the form row lacked the key (stored NULL / 0)
        if (!(k in y) && (x[k] === null || x[k] === 0)) delete x[k];
        if (k in y && x[k] !== y[k] && Number(x[k] || 0) === Number(y[k] || 0)) x[k] = y[k];
        if (k in y && x[k] !== y[k]) ownedRestored++;
      }
      if (!bad && !eq(x, y)) {
        const keys = new Set(Object.keys(x).concat(Object.keys(y)));
        const d = [...keys].filter((k) => !eq(x[k], y[k])).map((k) => k + ": " + J(y[k]).slice(0, 60) + " vs " + J(x[k]).slice(0, 60));
        bad = "line " + i + " " + d.slice(0, 4).join("; ");
      }
    });
    bad ? fail("fillback.lines", rid, bad) : ok("fillback.lines");
    if (altFixed) ok("fillback.alt_uom normalised (deliberate)");
    if (clamped) ok("fillback.outstanding clamped (deliberate)");
  }
  if (run.meta.status !== "Complete") return ok("stopped at its write (" + run.meta.current_node_id + "): fillback checked");
  if (n.code_map_item_ids && same("code_map_item_ids")) {
    const rec = dataOf(n.code_map_item_ids).itemIDs;
    eq(rec, fb.itemIDs) ? ok("txnDate.itemIDs") : fail("txnDate.itemIDs", rid, J(rec) + " vs " + J(fb.itemIDs));
  }

  // ------------------------------------------------ the saved PO: id + header
  if (n.add_po) ctx.out.add_po = { data: rowsOf(n.add_po) };
  const gl = exec("code_get_latest");
  const oldLatest = (dataOf(n.code_get_latest) || {}).poData || {};
  eq(String(oldLatest.id), gl.poData.id) ? ok("latest.id") : fail("latest.id", rid, J(oldLatest.id) + " vs " + J(gl.poData.id));
  const oldPo = (n.code_resolve_latest ? dataOf(n.code_resolve_latest).poData : oldLatest) || {};
  ctx.out.sql_po_head = {
    data: [{ id: str(oldPo.id), purchase_order_no: oldPo.purchase_order_no, po_status: oldPo.po_status, po_plant: str(oldPo.po_plant),
      organization_id: oldPo.organization_id, po_supplier_id: oldPo.po_supplier_id,
      preq_id_json: Array.isArray(oldPo.preq_id) ? JSON.stringify(oldPo.preq_id.map(String)) : null,
      po_total: s8(oldPo.po_total), auto_pi: oldPo.auto_pi === undefined || oldPo.auto_pi === null ? null : String(oldPo.auto_pi), create_pi: oldPo.create_pi }],
  };
  const rl = exec("code_resolve_latest");
  const head = rl.poData;
  const hk = ["id", "purchase_order_no", "po_status", "po_plant", "organization_id", "po_supplier_id", "create_pi"];
  const hd = hk.filter((k) => !eq(str(oldPo[k]), str(head[k])));
  if (Number(oldPo.po_total || 0) !== Number(head.po_total || 0)) hd.push("po_total");
  if (Number(oldPo.auto_pi || 0) !== Number(head.auto_pi || 0)) hd.push("auto_pi");
  if (!eq((oldPo.preq_id || []).map(String), head.preq_id)) hd.push("preq_id");
  hd.length ? fail("latest.header", rid, hd.join(",")) : ok("latest.header");
  // nodes that read the header, unchanged code: same answer on the slim header
  for (const nid of ["code_direct_pi_gate", "code_map_returned"]) {
    if (!n[nid] || !same(nid)) continue;
    if (n.wf_direct_pi_save) ctx.out.wf_direct_pi_save = n.wf_direct_pi_save.out;
    const mine = exec(nid);
    eq(dataOf(n[nid]), mine) ? ok(nid) : fail(nid, rid, J(dataOf(n[nid])) + " vs " + J(mine));
  }

  // ------------------------------------------------ on-order reconcile
  if (n.code_onorder_diff && same("code_onorder_diff")) {
    const full = one(rowsOf(n.get_po_full));
    const lines = [];
    for (const r of full.table_po || []) {
      lines.push(Object.assign({}, r, { parent_id: null }));
      for (const c of Array.isArray(r.children) ? r.children : []) lines.push(Object.assign({}, c, { parent_id: c.parent_id || r.id }));
    }
    ctx.out.sql_oo_lines = { data: lines.map((r) => ({ id: str(r.id), item_id: r.item_id === undefined || r.item_id === "" ? null : str(r.item_id),
      quantity: s8(r.quantity), quantity_uom: str(r.quantity_uom), preq_id: str(r.preq_id), preq_line_id: str(r.preq_line_id), parent_id: str(r.parent_id) })) };
    ctx.out.sql_oo_items = { data: rowsOf(n.search_items).map((r) => ({ id: str(r.id),
      uom_json: JSON.stringify((r.table_uom_conversion || []).map((c) => ({ alt_uom_id: str(c.alt_uom_id), base_qty: c.base_qty }))) })) };
    ctx.out.sql_onorder = { data: rowsOf(n.search_onorder).map((r) => ({ id: str(r.id), po_id: str(r.po_id), po_line_id: str(r.po_line_id),
      material_id: str(r.material_id), purchase_order_number: r.purchase_order_number,
      purchase_order_line: r.purchase_order_line === undefined || r.purchase_order_line === null ? null : String(r.purchase_order_line), received_qty: s8(r.received_qty) })) };
    const dd = exec("code_onorder_diff");
    const rec = dataOf(n.code_onorder_diff);
    const flat = (sl) => (sl || []).reduce((acc, s) => acc.concat(s.rows), []);
    const sameSet = eq(rec.toAdd, flat(dd.addSlices)) && eq(rec.toUpdate, flat(dd.updateSlices)) && eq(rec.toDelete, flat(dd.deleteSlices));
    const flags = ["hasAdds", "hasUpdates", "hasDeletes", "hasPreq"].every((k) => rec[k] === dd[k]);
    sameSet && flags ? ok("onorder.diff") : fail("onorder.diff", rid, J(rec).slice(0, 300) + " vs " + J(dd).slice(0, 300));
    // ------------------------------------------------ PREQ
    if (n.code_map_preq && same("code_map_preq")) {
      ctx.out.search_preq = n.search_preq.out;
      const mine = exec("code_map_preq");
      const r2 = dataOf(n.code_map_preq);
      eq(r2, mine) ? ok("preq.update") : fail("preq.update", rid, J(r2).slice(0, 300) + " vs " + J(mine).slice(0, 300));
    }
  }
  // ------------------------------------------------ approval: the record re-issued after approval
  if (n.code_map_updated_po && same("code_map_updated_po")) {
    if (a.page_status != "Add" && a.page_status != "Clone") ctx.out.get_po_snap = { data: { data: oldLatest } };
    const mine = exec("code_map_updated_po");
    eq(dataOf(n.code_map_updated_po), mine) ? ok("approval.updatedPO") : fail("approval.updatedPO", rid, "differs");
  }
}

const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort();
let errors = 0;
for (const f of files) {
  try {
    replay(path.join(runsDir, f));
  } catch (e) {
    errors++;
    fails.push("ERROR " + f + " " + e.message.split("\n")[0]);
  }
}
const runsBy = files.reduce((acc, f) => ((acc[f.split("_")[0]] = (acc[f.split("_")[0]] || 0) + 1), acc), {});
console.log("runs", JSON.stringify(runsBy), "errors", errors);
for (const [k, v] of Object.entries(stats).sort()) console.log(("  " + k).padEnd(44), "ok", String(v.ok).padStart(4), " fail", String(v.fail).padStart(3), v.skip ? " skip " + v.skip : "");
if (fails.length) {
  console.log("FAILURES (" + fails.length + "):");
  for (const x of fails.slice(0, VERBOSE ? 500 : 40)) console.log("  " + x);
}
process.exit(fails.length ? 1 : 0);
