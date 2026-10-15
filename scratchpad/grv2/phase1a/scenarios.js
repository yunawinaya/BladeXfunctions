// OLD (v39 base) vs NEW (patched) PO_SAVE on identical in-memory worlds: final PO / lines / on-order / PREQ state, outcome,
// sub-workflow calls, and node data. The template header + line come from a recorded dev payload (passed in, not stored).
// Usage: node scenarios.js <template run json> <old wf json> <new wf json> [--sizes]
"use strict";
const fs = require("fs");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World } = require("./world.js");

const [tplFile, oldFile, newFile] = process.argv.slice(2);
const OLD = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));
const tpl = L.loadRun(tplFile).allData;
const clone = (x) => JSON.parse(JSON.stringify(x));
let failures = 0;
const results = [];
function check(name, cond, detail) {
  results.push((cond ? "ok   " : "FAIL ") + name + (cond || !detail ? "" : "  " + detail));
  if (!cond) failures++;
}

const ORG = "1900000000000000001";
const UOM_BASE = "1800000000000000001";
const UOM_BOX = "1800000000000000002";
function makeWorld(nItems, opts) {
  const w = new World(Object.assign({ tenantId: "000000" }, opts || {}));
  for (let i = 0; i < nItems; i++) {
    const id = String(1700000000000000000n + BigInt(i + 1));
    w.items[id] = { id: id, material_code: "IT" + i, table_uom_conversion: [{ alt_uom_id: UOM_BASE, base_qty: 1 }, { alt_uom_id: UOM_BOX, base_qty: 12 }] };
  }
  return w;
}

// the form's alt_uom for a line: one JSON layer per form load since it was written
const altUomOf = (layers) => {
  let v = JSON.stringify([{ alt_uom_id: UOM_BASE, alt_qty: 1, base_qty: 1, base_uom_id: UOM_BASE, purchase_unit_price: 3, sales_price_1: 4, id: "1" },
    { alt_uom_id: UOM_BOX, alt_qty: 1, base_qty: 12, base_uom_id: UOM_BASE, purchase_unit_price: 30, sales_price_1: 40, id: "2" }]);
  for (let i = 1; i < layers; i++) v = JSON.stringify(v);
  return v;
};

function newPayload(nLines, opts) {
  opts = opts || {};
  const tl = (tpl.table_po || [])[0] || {};
  const h = clone(tpl);
  for (const k of ["id", "create_time", "update_time", "create_user", "update_user", "create_dept", "approve_flow_id", "workflow_inst_id", "linked_so_id"]) delete h[k];
  Object.assign(h, { page_status: "Add", po_status: opts.status || "Issued", previous_status: "", purchase_order_no: "", purchase_order_no_type: "2000000000000000009",
    organization_id: ORG, po_plant: ORG, po_supplier_id: "1600000000000000001", preq_id: opts.preqId ? [opts.preqId] : [], preq_no: "", auto_pi: 0, create_pi: "No",
    approval_condition: {}, partially_received: "", fully_received: "" });
  const lines = [];
  let total = 0;
  for (let i = 0; i < nLines; i++) {
    const l = clone(tl);
    for (const k of ["id", "children", "line_status", "line_index"]) delete l[k];
    const qty = (i % 7) + 1;
    Object.assign(l, { fm_key: "fm" + i, item_id: String(1700000000000000000n + BigInt((i % (opts.distinctItems || nLines)) + 1)), item_name: "IT" + i, item_desc: "Item " + i,
      quantity: qty, quantity_uom: i % 3 === 0 ? UOM_BOX : UOM_BASE, unit_price: 2.5, gross: 2.5 * qty, discount: 0, discount_amount: 0, tax_amount: 0, po_amount: 2.5 * qty,
      received_qty: 0, created_received_qty: 0, invoice_qty: 0, return_quantity: 0, created_return_qty: 0, posted_qty: 0, min_price: 0, max_price: 0, min_qty: 0, max_qty: 0,
      preq_id: opts.preqId || "", preq_line_id: opts.preqId ? String(1500000000000000000n + BigInt(i + 1)) : "", alt_uom: altUomOf(1),
      table_uom_conversion: "", outstanding_quantity: qty });
    total += 2.5 * qty;
    lines.push(l);
  }
  h.table_po = lines;
  h.po_total = total;
  h.po_total_gross = total;
  return h;
}

// what the form sends when it opens a stored PO and saves it again (Edit): the read-back + form-only keys
function editPayload(world, poId, mutate) {
  const rb = clone(world.readback(poId));
  rb.page_status = "Edit";
  rb.previous_status = rb.po_status;
  (rb.table_po || []).forEach((l, i) => {
    l.fm_key = "e" + i;
    if (l.alt_uom) l.alt_uom = JSON.stringify(l.alt_uom); // the mounted re-stringify
  });
  if (mutate) mutate(rb);
  return rb;
}

function runBoth(name, world, payload, opts) {
  // two independent copies of the same world, one per workflow version
  const rebind = () => {
    const fresh = new World({ tenantId: world.tenantId, itemPadBytes: world.itemPadBytes, approvalConfig: world.approvalConfig, slotResult: world.slotResult });
    for (const k of ["po", "onorder", "items", "preq", "drafts", "its", "alias", "calls", "seqNo"]) fresh[k] = clone(world[k]);
    fresh.seq = world.seq;
    return fresh;
  };
  const a = rebind();
  const b = rebind();
  const ro = new Engine(OLD, a, {}).run({ allData: clone(payload) });
  const rn = new Engine(NEW, b, { maxRowsPerWrite: (opts || {}).maxRows }).run({ allData: clone(payload) });
  return { old: ro, new: rn, wOld: a, wNew: b, base: world };
}

const compactAlt = (v) => {
  if (v === undefined || v === null || v === "") return v;
  try {
    let x = v;
    for (let i = 0; i < 64 && typeof x === "string"; i++) x = JSON.parse(x);
    const keep = (c) => (c && typeof c === "object" ? { alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id } : c);
    return JSON.stringify(Array.isArray(x) ? x.map(keep) : keep(x));
  } catch (e) {
    return v;
  }
};

// state comparison with the deliberate differences named: alt_uom one layer; GR / PI owned columns; outstanding >= 0
const OWNED_HEADER = ["gr_status", "partially_received", "fully_received", "pi_status", "pi_posted_status"];
function compareState(name, r, allow) {
  allow = allow || {};
  const so = r.wOld.snapshot();
  const sn = r.wNew.snapshot();
  const diffs = [];
  const poIds = new Set(Object.keys(so.po).concat(Object.keys(sn.po)));
  for (const id of poIds) {
    const a = so.po[id];
    const b = sn.po[id];
    if (!a || !b) {
      diffs.push("po " + id + " only in " + (a ? "old" : "new"));
      continue;
    }
    const before = r.base && r.base.po[id] ? r.base.po[id].header : null;
    for (const k of new Set(Object.keys(a.header).concat(Object.keys(b.header)))) {
      if (k === "approval_condition" && allow.approvalCondition) continue;
      // Edit leaves the header columns other flows own as they were stored (OLD wrote the form's copy)
      if (before && OWNED_HEADER.includes(k)) {
        if (JSON.stringify(b.header[k]) !== JSON.stringify(before[k])) diffs.push("header." + k + " (owned) changed: " + JSON.stringify(before[k]) + " -> " + JSON.stringify(b.header[k]));
        continue;
      }
      if (JSON.stringify(a.header[k]) !== JSON.stringify(b.header[k])) diffs.push("header." + k + ": " + JSON.stringify(a.header[k]) + " vs " + JSON.stringify(b.header[k]));
    }
    if (a.lines.length !== b.lines.length) diffs.push("lines " + a.lines.length + " vs " + b.lines.length);
    a.lines.forEach((la, i) => {
      const lb = b.lines[i] || {};
      for (const k of new Set(Object.keys(la).concat(Object.keys(lb)))) {
        let va = la[k];
        let vb = lb[k];
        if (k === "alt_uom") va = compactAlt(va);
        if (k === "outstanding_quantity" && typeof va === "number" && va < 0) va = 0;
        if (allow.owned && ["received_qty", "created_received_qty", "invoice_qty", "outstanding_quantity"].includes(k)) continue;
        if (JSON.stringify(va) !== JSON.stringify(vb)) diffs.push("line " + i + "." + k + ": " + JSON.stringify(va).slice(0, 50) + " vs " + JSON.stringify(vb).slice(0, 50));
      }
    });
  }
  const oo = (s) => s.onorder.map((x) => JSON.stringify(Object.keys(x).sort().reduce((o, k) => ((o[k] = x[k]), o), {}))).sort();
  if (JSON.stringify(oo(so)) !== JSON.stringify(oo(sn))) diffs.push("on-order rows differ (" + so.onorder.length + " vs " + sn.onorder.length + ")");
  if (JSON.stringify(so.preq) !== JSON.stringify(sn.preq)) diffs.push("PREQ differs");
  const calls = (s) => JSON.stringify(s.calls.map((c) => (c.wf === "SO_SAVE" ? { wf: c.wf, lines: (c.allData.table_so || []).length } : c)));
  if (calls(so) !== calls(sn)) diffs.push("sub-workflow calls differ " + calls(so).slice(0, 200) + " vs " + calls(sn).slice(0, 200));
  const oc = (x) => JSON.stringify(x.outcome);
  if (oc(r.old) !== oc(r.new) && !allow.outcome) diffs.push("outcome " + oc(r.old) + " vs " + oc(r.new));
  check(name, diffs.length === 0, diffs.slice(0, 6).join(" | "));
  return diffs;
}

function bytes(res) {
  return Object.values(res.sizes).reduce((s, x) => s + x.in + x.out, 0);
}

// ---------------------------------------------------------------- scenarios
const sizes = [];
function sized(label, r) {
  sizes.push({ label: label, old: bytes(r.old), new: bytes(r.new), oldNodes: r.old.sizes, newNodes: r.new.sizes });
}

for (const n of [3, 500, 1000, 2000]) {
  // S1 Add + Issue
  const w = makeWorld(n);
  const r1 = runBoth("add", w, newPayload(n), { maxRows: 250 });
  compareState("S1 Add + Issue, " + n + " lines: same PO, lines, on-order", r1);
  check("S1 " + n + " lines: on-order rows = lines", r1.wNew.onorder.length === n, r1.wNew.onorder.length + " rows");
  sized("Issue (Add) " + n, r1);
  // S2 Edit + Issue of that PO, a GR received some lines after the form loaded it
  const base = r1.wNew;
  const poId = Object.keys(base.po)[0];
  const payload = editPayload(base, poId, (p) => {
    p.table_po[0].quantity = 9;
    p.table_po[0].gross = 22.5;
  });
  for (const l of base.po[poId].lines.slice(0, Math.min(5, n))) {
    l.received_qty = 2;
    l.created_received_qty = 1;
    l.invoice_qty = 1;
  }
  const r2 = runBoth("edit", base, payload, { maxRows: 250 });
  const d2 = compareState("S2 Edit + Issue, " + n + " lines (GR moved after load): same except owned columns", r2, { owned: true });
  const nl = r2.wNew.po[poId].lines;
  const ol = r2.wOld.po[poId].lines;
  check("S2 " + n + ": NEW keeps the GR's received / created_received / invoice", nl.slice(0, Math.min(5, n)).every((l) => l.received_qty === 2 && l.created_received_qty === 1 && l.invoice_qty === 1),
    JSON.stringify(nl[0]).slice(0, 200));
  check("S2 " + n + ": OLD reverted them to the form's 0 (the stale-blob bug)", ol.slice(0, Math.min(5, n)).every((l) => Number(l.received_qty) === 0));
  check("S2 " + n + ": NEW outstanding = quantity - received", Number(nl[0].outstanding_quantity) === Math.max(0, nl[0].quantity - 2), String(nl[0].outstanding_quantity));
  sized("Issue (Edit) " + n, r2);
}

// S3 Edit that removes 300 lines and adds 10: deletes in two slices
{
  const n = 800;
  const w = makeWorld(n + 10);
  const r1 = runBoth("add", w, newPayload(n), {});
  const base = r1.wNew;
  const poId = Object.keys(base.po)[0];
  const payload = editPayload(base, poId, (p) => {
    p.table_po.splice(100, 300);
    for (let i = 0; i < 10; i++) {
      const l = clone(p.table_po[0]);
      delete l.id;
      l.item_id = String(1700000000000000000n + BigInt(n + i + 1));
      l.fm_key = "new" + i;
      p.table_po.push(l);
    }
  });
  const r = runBoth("edit-remove", base, payload, { maxRows: 250 });
  compareState("S3 Edit: 300 lines removed, 10 added", r);
  const dels = r.new.writes.filter((x) => x.kind === "delete");
  check("S3 deletes in slices of <= 250", dels.length === 2 && dels.every((x) => x.rows.length <= 250) && dels.reduce((s, x) => s + x.rows.length, 0) === 300,
    JSON.stringify(dels.map((x) => x.rows.length)));
}

// S4 Draft (with an empty row) then Issue
{
  const w = makeWorld(5);
  const p = newPayload(5, { status: "Draft" });
  p.table_po.push({ fm_key: "blank", quantity: 0 });
  const r1 = runBoth("draft", w, p, {});
  compareState("S4 Draft Add with a blank row", r1);
  const base = r1.wNew;
  const poId = Object.keys(base.po)[0];
  const payload = editPayload(base, poId, (q) => {
    q.po_status = "Issued";
    q.previous_status = "Draft";
  });
  const r2 = runBoth("issue-draft", base, payload, {});
  compareState("S4 Draft -> Issue", r2);
}

// S5 bundle rows (children)
{
  const w = makeWorld(6);
  const p = newPayload(4);
  const bundle = clone(p.table_po[0]);
  for (const k of ["item_id", "item_name"]) delete bundle[k];
  bundle.item_bundle_id = "1400000000000000001";
  bundle.item_desc = "Bundle";
  bundle.children = [clone(p.table_po[1]), clone(p.table_po[2])];
  bundle.children[0].item_id = String(1700000000000000005n);
  bundle.children[1].item_id = String(1700000000000000006n);
  p.table_po.push(bundle);
  const r = runBoth("bundle", w, p, {});
  compareState("S5 bundle with 2 items", r);
  check("S5 bundle items are on order", r.wNew.onorder.length === 6, String(r.wNew.onorder.length));
}

// S6 from a PREQ
{
  const w = makeWorld(3);
  const preqId = "1500000000000000000";
  w.preq[preqId] = { id: preqId, preq_status: "Issued", preq_type: "Normal", table_pr: [1, 2, 3].map((i) => ({ id: String(1500000000000000000n + BigInt(i)), pr_line_qty: i, order_qty: 0 })) };
  const r = runBoth("preq", w, newPayload(3, { preqId: preqId }), {});
  compareState("S6 converted from a PREQ: same PREQ update", r);
  check("S6 PREQ completed", r.wNew.preq[preqId].preq_status === "Completed");
}

// S7 approval: held as Draft, approved, re-issued
{
  const w = makeWorld(3, { approvalConfig: { po_issued: 1, po_document_status: "draft" } });
  const r = runBoth("approval", w, newPayload(3), {});
  compareState("S7 approval (held as Draft, approved): same", r);
  const po = Object.values(r.wNew.po)[0];
  check("S7 approved PO is Issued with lines Issued", po.header.po_status === "Issued" && po.lines.every((l) => l.line_status === "Issued"), po.header.po_status);
  check("S7 approval_condition stored", JSON.stringify(po.header.approval_condition) === JSON.stringify(Object.values(r.wOld.po)[0].header.approval_condition));
}

// S8 internal trading supplier: > 500 lines refused before any write; <= 500 unchanged path
{
  const w = makeWorld(501);
  w.its.push({ id: "1300000000000000001", buyer_org_id: ORG, buyer_supplier_id: "1600000000000000001", is_active: 1, auto_create_so: 1, seller_org_id: "1300000000000000002",
    seller_customer_id: "1300000000000000003" });
  const r = runBoth("its", w, newPayload(501), {});
  check("S8 NEW: 501 lines to an internal supplier -> 400 before any write", r.new.outcome && r.new.outcome.code === 400 && r.new.outcome.end === "end_it_size_400" &&
    r.new.writes.filter((x) => x.kind !== "workflow").length === 0, JSON.stringify(r.new.outcome));
  check("S8 message names the line count", /501 lines/.test(r.new.outcome.msg || ""), r.new.outcome.msg);
}

// S8b internal trading at 20 lines with every item aliased: same SO_SAVE payload, linkage and PO link
{
  const w = makeWorld(20);
  w.its.push({ id: "1300000000000000001", buyer_org_id: ORG, buyer_supplier_id: "1600000000000000001", is_active: 1, auto_create_so: 1, seller_org_id: "1300000000000000002",
    seller_customer_id: "1300000000000000003" });
  for (let i = 0; i < 20; i++) {
    const id = String(1700000000000000000n + BigInt(i + 1));
    for (const uom of [UOM_BASE, UOM_BOX]) w.alias.push({ id: "17" + i + uom.slice(-1), buyer_org_id: ORG, seller_org_id: "1300000000000000002", is_active: 1, buyer_item_id: id,
      buyer_uom_id: uom, seller_item_id: id, seller_uom_id: uom, conversion_rate: 1 });
  }
  const p = newPayload(20);
  p.auto_so_confirmed = true;
  const r = runBoth("its-ok", w, p, {});
  compareState("S8b internal trading, 20 lines: same PO, on-order and SO_SAVE call", r);
  const so = r.wNew.calls.find((c) => c.wf === "SO_SAVE");
  const soOld = r.wOld.calls.find((c) => c.wf === "SO_SAVE");
  check("S8b SO_SAVE payload identical", so && soOld && JSON.stringify(so) === JSON.stringify(soOld), so ? "" : "no SO_SAVE call");
}

// S9 gates: the same end node and message
const gate = (name, mutate, opts) => {
  const w = makeWorld(3, opts);
  const p = newPayload(3);
  mutate(p, w);
  const r = runBoth("gate", w, p, {});
  check("S9 gate " + name + ": " + JSON.stringify(r.old.outcome && r.old.outcome.end), JSON.stringify(r.old.outcome) === JSON.stringify(r.new.outcome),
    JSON.stringify(r.old.outcome) + " vs " + JSON.stringify(r.new.outcome));
};
gate("no supplier", (p) => delete p.po_supplier_id);
gate("no lines", (p) => (p.table_po = []));
gate("qty 0", (p) => (p.table_po[1].quantity = 0));
gate("qty without item", (p) => Object.assign(p.table_po[1], { item_id: "", item_name: "", item_desc: "" }));
gate("all lines empty", (p) => p.table_po.forEach((l) => Object.assign(l, { item_id: "", item_name: "", item_desc: "", quantity: 0 })));
gate("min price, no approval", (p) => Object.assign(p.table_po[2], { min_price: 5 }));
gate("max price, no approval", (p) => Object.assign(p.table_po[0], { max_price: 1 }));
gate("zero total direct PI", (p) => Object.assign(p, { auto_pi: 1, po_total: 0 }));
gate("draft GR exists (Edit)", (p, w) => {
  w.po["1100000000000000001"] = { header: { id: "1100000000000000001", purchase_order_no: "PO-X", po_status: "Issued", organization_id: ORG }, lines: [] };
  Object.assign(p, { page_status: "Edit", id: "1100000000000000001", previous_status: "Issued", purchase_order_no: "PO-X" });
  w.drafts.push({ kind: "GR", no: "GR-D1", po_ids: ["1100000000000000001"] }, { kind: "PI", no: "PI-D1", po_ids: ["1100000000000000001"] });
});

// S10 legacy on-order rows without po_id under the same number are adopted, not deleted
{
  const w = makeWorld(3);
  const r1 = runBoth("add", w, newPayload(3), {});
  const base = r1.wNew;
  const poId = Object.keys(base.po)[0];
  for (const row of base.onorder) delete row.po_id; // written before po_id existed
  base.onorder.push({ id: "1200000000000000001", purchase_order_number: base.po[poId].header.purchase_order_no, material_id: "999", purchase_order_line: 9, organization_id: ORG,
    scheduled_qty: 1, open_qty: 1, received_qty: 0, is_deleted: 0 });
  const r = runBoth("legacy", base, editPayload(base, poId), {});
  compareState("S10 legacy on-order rows adopted, unmatched orphan kept", r);
  check("S10 orphan not deleted", r.wNew.onorder.some((x) => x.id === "1200000000000000001"));
}

// S11-S14 a form opened before another flow moved the PO; its Save as Issued (the form always sends Issued)
const ooRows = (rows) => rows.map((x) => JSON.stringify(Object.keys(x).sort().reduce((o, k) => ((o[k] = x[k]), o), {}))).sort();
const staleSetup = (n, extra) => {
  const r1 = runBoth("add", makeWorld(n + (extra || 0)), newPayload(n), {});
  const base = r1.wNew;
  return { base: base, poId: Object.keys(base.po)[0] };
};
{
  // S11 a Goods Receiving after the form loaded the PO
  const { base, poId } = staleSetup(4);
  const stale = editPayload(base, poId, (x) => (x.po_status = "Issued"));
  const po = base.po[poId];
  Object.assign(po.lines[0], { received_qty: po.lines[0].quantity, line_status: "Completed", outstanding_quantity: 0 });
  Object.assign(po.lines[1], { received_qty: 1, line_status: "Processing", outstanding_quantity: po.lines[1].quantity - 1 });
  Object.assign(po.header, { po_status: "Processing", gr_status: "Partially Received", partially_received: "2 / 4", fully_received: "1 / 4" });
  const r = runBoth("stale-gr", base, stale, {});
  const h = r.wNew.po[poId].header;
  const nl = r.wNew.po[poId].lines;
  const oh = r.wOld.po[poId].header;
  check("S11 stale form after a GR: NEW keeps po_status Processing", h.po_status === "Processing", h.po_status);
  check("S11 NEW keeps gr_status / partially / fully as GR wrote them", h.gr_status === "Partially Received" && h.partially_received === "2 / 4" && h.fully_received === "1 / 4",
    JSON.stringify([h.gr_status, h.partially_received, h.fully_received]));
  check("S11 NEW keeps the GR's line statuses and received", nl[0].line_status === "Completed" && nl[1].line_status === "Processing" && nl[2].line_status === "Issued" &&
    Number(nl[0].received_qty) === Number(po.lines[0].quantity) && Number(nl[1].received_qty) === 1, JSON.stringify(nl.map((l) => [l.line_status, l.received_qty])));
  check("S11 OLD reverted them (the bug)", oh.po_status === "Issued" && !oh.gr_status && r.wOld.po[poId].lines[0].line_status === "Issued",
    JSON.stringify([oh.po_status, oh.gr_status, r.wOld.po[poId].lines[0].line_status]));
  check("S11 NEW still runs the on-order + PREQ follow-up as OLD did", JSON.stringify(ooRows(r.wNew.onorder)) === JSON.stringify(ooRows(r.wOld.onorder)) &&
    JSON.stringify(r.wNew.calls) === JSON.stringify(r.wOld.calls), r.wNew.onorder.length + " vs " + r.wOld.onorder.length + " rows");
}
{
  // S12 a GR revert after the form loaded the PO fully received on line 0
  const { base, poId } = staleSetup(3);
  const po = base.po[poId];
  Object.assign(po.lines[0], { received_qty: po.lines[0].quantity, line_status: "Completed", outstanding_quantity: 0 });
  Object.assign(po.header, { po_status: "Processing", gr_status: "Partially Received", partially_received: "1 / 3", fully_received: "1 / 3" });
  const stale = editPayload(base, poId, (x) => (x.po_status = "Issued"));
  Object.assign(po.lines[0], { received_qty: 0, line_status: "Issued", outstanding_quantity: po.lines[0].quantity });
  Object.assign(po.header, { po_status: "Issued", gr_status: "", partially_received: "0 / 3", fully_received: "0 / 3" });
  const r = runBoth("stale-revert", base, stale, {});
  const nl = r.wNew.po[poId].lines[0];
  const h = r.wNew.po[poId].header;
  check("S12 stale form after a revert: NEW line back to Issued, 0 received", nl.line_status === "Issued" && Number(nl.received_qty) === 0, JSON.stringify([nl.line_status, nl.received_qty]));
  check("S12 NEW header as the revert left it", h.po_status === "Issued" && h.gr_status === "" && h.partially_received === "0 / 3" && h.fully_received === "0 / 3",
    JSON.stringify([h.po_status, h.gr_status, h.partially_received, h.fully_received]));
  check("S12 OLD kept the form's Completed line (the bug)", r.wOld.po[poId].lines[0].line_status === "Completed", r.wOld.po[poId].lines[0].line_status);
}
{
  // S13 a line added to a PO GR already moved to Processing
  const n = 3;
  const { base, poId } = staleSetup(n, 1);
  const po = base.po[poId];
  Object.assign(po.lines[0], { received_qty: 1, line_status: "Processing" });
  Object.assign(po.header, { po_status: "Processing", gr_status: "Partially Received", partially_received: "1 / 3", fully_received: "0 / 3" });
  const p = editPayload(base, poId, (x) => {
    x.po_status = "Issued";
    const l = clone(x.table_po[1]);
    for (const k of ["id", "line_status", "line_index"]) delete l[k];
    Object.assign(l, { fm_key: "new", item_id: String(1700000000000000000n + BigInt(n + 1)), received_qty: 0, created_received_qty: 0 });
    x.table_po.push(l);
  });
  const r = runBoth("new-line", base, p, {});
  const lines = r.wNew.po[poId].lines;
  const added = lines.find((l) => String(l.item_id) === String(1700000000000000000n + BigInt(n + 1)));
  check("S13 new line on a Processing PO: Issued, PO stays Processing, line 0 stays Processing",
    added && added.line_status === "Issued" && r.wNew.po[poId].header.po_status === "Processing" && lines[0].line_status === "Processing",
    JSON.stringify([added && added.line_status, r.wNew.po[poId].header.po_status, lines[0].line_status]));
  check("S13 the new line gets its on-order row", r.wNew.onorder.length === n + 1, r.wNew.onorder.length + " rows");
}
{
  // S14 a Purchase Return after the form loaded the PO
  const { base, poId } = staleSetup(3);
  const stale = editPayload(base, poId, (x) => (x.po_status = "Issued"));
  Object.assign(base.po[poId].lines[0], { return_quantity: 1, created_return_qty: 0.5 });
  const r = runBoth("stale-prt", base, stale, {});
  const nl = r.wNew.po[poId].lines[0];
  check("S14 stale form after a purchase return: NEW keeps return_quantity / created_return_qty", Number(nl.return_quantity) === 1 && Number(nl.created_return_qty) === 0.5,
    JSON.stringify([nl.return_quantity, nl.created_return_qty]));
  check("S14 OLD reverted them (the bug)", Number(r.wOld.po[poId].lines[0].return_quantity) === 0, String(r.wOld.po[poId].lines[0].return_quantity));
}

for (const x of results) console.log(x);
console.log("scenario checks:", results.length, "failures:", failures);
if (process.argv.includes("--sizes")) {
  console.log("\nnode data (bytes, recorded nodes: request + response):");
  for (const s of sizes) console.log(("  " + s.label).padEnd(26), "OLD", String(s.old).padStart(11), "  NEW", String(s.new).padStart(10), "  ratio", (s.old / s.new).toFixed(1));
  fs.writeFileSync(process.env.SIZES_OUT || "/dev/null", JSON.stringify(sizes, null, 1));
}
process.exit(failures ? 1 : 0);
