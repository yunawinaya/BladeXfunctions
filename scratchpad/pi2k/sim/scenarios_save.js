// PI_SAVE v19 vs v20 on synthetic invoices: every path (Add / Convert / Edit, Draft / Completed, 406 / 407 / 409 / 410),
// item bundles (nested and flat), split GR lines, credits, several orders and receipts, custom fields left out on an edit,
// manual numbering. Usage: node scenarios_save.js <old PI_SAVE json> <new PI_SAVE json>
"use strict";
const fs = require("fs");
const { World, clone } = require("./world.js");
const { compare } = require("./compare.js");

const OLD = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const NEW = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const FMT = "2026901594941353985";
let seq = 2200000000000000000n;
const nid = () => (++seq).toString();

function makePo(spec) {
  const id = nid();
  const lines = [];
  for (const l of spec.lines) {
    const lid = nid();
    lines.push({ id: lid, purchase_order_id: id, item_id: l.bundle ? null : l.item || nid(), item_name: "Item " + lid.slice(-3), quantity: l.qty,
      invoice_qty: l.inv === undefined ? 0 : l.inv, pi_status: l.st === undefined ? null : l.st, item_bundle_id: l.bundle || null, parent_id: null,
      unit_price: 10, line_index: String(lines.length + 1), alt_uom: "[]" });
    for (const c of l.children || []) {
      lines.push({ id: nid(), purchase_order_id: id, item_id: nid(), item_name: "Child", quantity: c.qty, invoice_qty: c.inv || 0, pi_status: c.st || null,
        item_bundle_id: l.bundle, parent_id: lid, unit_price: 5 });
    }
  }
  return { header: { id, purchase_order_no: "PO/SIM/" + id.slice(-5), po_status: "Issued", organization_id: ORG, pi_status: spec.st || null }, lines };
}

function makeGr(po, spec) {
  const id = nid();
  const lines = [];
  for (const l of spec.lines) {
    const pl = po.lines[l.poLine];
    const lid = nid();
    lines.push({ id: lid, goods_receiving_id: id, item_id: pl.item_id, item_name: pl.item_name, received_qty: l.qty, invoice_qty: l.inv || 0,
      pi_status: l.st || null, parent_or_child: l.poc === undefined ? "Parent" : l.poc, po_line_item_id: l.poLineId === null ? null : pl.id,
      line_po_id: po.header.id, line_index: l.idx || String(lines.length + 1), item_bundle_id: pl.item_bundle_id, parent_id: l.parentOf === undefined ? null : lines[l.parentOf].id });
  }
  return { header: { id, gr_no: "GR/SIM/" + id.slice(-5), gr_status: "Completed", po_id: [po.header.id], organization_id: ORG, plant_id: PLANT }, lines };
}

function header(extra) {
  return Object.assign({
    page_status: "Add", pi_status: "Completed", purchase_invoice_no: "", purchase_invoice_no_type: FMT, previous_status: "",
    plant_id: PLANT, organization_id: ORG, supplier_name: "2018905967793565706", invoice_date: "2026-10-21", pi_description: "Purchase",
    invoice_payment_term_id: "2018905925770833923", billing_address_state: "1912423051411390614", billing_address_country: "1912415171263885440",
    shipping_address_state: null, shipping_address_country: "1912415171263885440", agent_id: null, currency_code: "MYR", exchange_rate: 1,
    invoice_subtotal: 100, invoice_total: 100, remarks: "", custom_fields_d10wd6ob: { a: "x" }, acc_integration_type: "No Accounting Integration",
    created_source: "Web", pi_ref_doc: [], project_id: null, line_remark_x: undefined,
  }, extra || {});
}

function piLine(po, gr, poLine, grLine, qty, extra) {
  const pl = po.lines[poLine];
  const gl = gr ? gr.lines[grLine] : null;
  return Object.assign({
    material_id: pl.item_id, material_name: pl.item_name, invoice_qty: qty, received_qty: gl ? gl.received_qty : 0, order_qty: pl.quantity,
    line_po_id: po.header.id, po_line_id: pl.id, purchase_order_no: po.header.purchase_order_no,
    line_gr_id: gr ? gr.header.id : "", gr_line_id: gl ? gl.id : "", goods_receiving_no: gr ? gr.header.gr_no : "",
    order_unit_price: 10, invoice_amount: qty * 10, item_bundle_id: pl.item_bundle_id || "", custom_fields_y78jfz24: { c: "1" },
    fm_key: "fm" + pl.id.slice(-6), line_index: 0, available_inv_qty: 99,
  }, extra || {});
}

function world(pos, grs, pis) {
  return () => {
    const w = new World({ tenantId: "000000", seed: "2300000000000000000", docFormatId: FMT });
    for (const p of pos) w.addPo(p.header, p.lines);
    for (const g of grs) w.addGr(g.header, g.lines);
    for (const p of pis || []) w.pi[p.id] = clone(p);
    return w;
  };
}

const S = [];
{
  const po = makePo({ lines: [{ qty: 10 }, { qty: 5 }, { qty: 8 }] });
  const gr = makeGr(po, { lines: [{ poLine: 0, qty: 10 }, { poLine: 1, qty: 5 }, { poLine: 2, qty: 8 }] });
  const mk = (extra, lines) => header(Object.assign({ table_pi: lines }, extra));
  const L = (i, q, x) => piLine(po, gr, i, i, q, x);
  S.push(["add completed, partial + full", world([po], [gr]), mk({}, [L(0, 4), L(1, 5), L(2, 0)])]);
  S.push(["convert completed", world([po], [gr]), mk({ page_status: "Convert", purchase_invoice_no: "issued" }, [L(0, 10), L(1, 5), L(2, 8)])]);
  S.push(["add draft", world([po], [gr]), mk({ pi_status: "Draft" }, [L(0, 4), L(1, 5)])]);
  S.push(["add draft, no plant (406)", world([po], [gr]), mk({ pi_status: "Draft", plant_id: null }, [L(0, 4)])]);
  S.push(["add completed, no invoice date (406)", world([po], [gr]), mk({ invoice_date: "" }, [L(0, 4)])]);
  S.push(["add completed, no lines (406)", world([po], [gr]), mk({}, [])]);
  S.push(["add completed, all zero (407)", world([po], [gr]), mk({}, [L(0, 0), L(1, 0)])]);
  S.push(["over-invoice GR (410)", world([po], [gr]), mk({}, [L(0, 11), L(1, 5)])]);
  S.push(["credit (negative qty)", world([po], [gr]), mk({}, [L(0, -3), L(1, 2)])]);
  S.push(["manual number", world([po], [gr]), mk({ purchase_invoice_no_type: -9999, purchase_invoice_no: "INV-001" }, [L(0, 2)])]);
  const stored = { id: "2300000000000000777", pi_status: "Draft", purchase_invoice_no: "Draft-PI/SIM/0001", purchase_invoice_no_type: FMT,
    custom_fields_d10wd6ob: { a: "stored" }, table_pi: [Object.assign(L(0, 4), { id: "2300000000000000778", custom_fields_y78jfz24: { c: "stored" } })] };
  const editLines = [Object.assign(L(0, 4), { id: "2300000000000000778" }), L(1, 1)];
  S.push(["edit draft -> completed", world([po], [gr], [stored]), mk({ page_status: "Edit", id: stored.id, previous_status: "Draft", purchase_invoice_no: stored.purchase_invoice_no }, editLines)]);
  S.push(["edit draft -> draft", world([po], [gr], [stored]), mk({ page_status: "Edit", id: stored.id, pi_status: "Draft", previous_status: "Draft", purchase_invoice_no: stored.purchase_invoice_no }, editLines)]);
  const keyless = editLines.map((l) => {
    const c = clone(l);
    delete c.custom_fields_y78jfz24;
    return c;
  });
  S.push(["edit, custom fields left out", world([po], [gr], [stored]), mk({ page_status: "Edit", id: stored.id, previous_status: "Draft", custom_fields_d10wd6ob: undefined }, keyless)]);
  S.push(["edit of a completed PI (409)", world([po], [gr], [Object.assign({}, stored, { pi_status: "Completed", purchase_invoice_no: "PI/SIM/0099" })]),
    mk({ page_status: "Edit", id: stored.id, previous_status: "Draft" }, editLines)]);
}
{
  // PO-only invoice (line_gr_id empty) and over-invoice against the PO
  const po = makePo({ lines: [{ qty: 10, inv: 4, st: "Partially Invoiced" }, { qty: 3 }] });
  const mk = (lines) => header({ table_pi: lines });
  const L = (i, q) => piLine(po, null, i, null, q);
  S.push(["po only", world([po], []), mk([L(0, 6), L(1, 1)])]);
  S.push(["po only over (410)", world([po], []), mk([L(0, 7)])]);
}
{
  // split GR lines: one combined PI line (gr_line_id "") spread over the Split-Parent rows
  const po = makePo({ lines: [{ qty: 20 }, { qty: 4 }] });
  const gr = makeGr(po, { lines: [{ poLine: 0, qty: 6, poc: "Split-Parent", idx: "1" }, { poLine: 0, qty: 9, poc: "Split-Parent", idx: "2", inv: 2 },
    { poLine: 0, qty: 3, poc: "Child", idx: "2-1" }, { poLine: 1, qty: 4 }] });
  const combined = Object.assign(piLine(po, gr, 0, 0, 12), { gr_line_id: "" });
  S.push(["split combined", world([po], [gr]), header({ table_pi: [combined, piLine(po, gr, 1, 3, 4)] })]);
  S.push(["split combined over (410)", world([po], [gr]), header({ table_pi: [Object.assign(piLine(po, gr, 0, 0, 14), { gr_line_id: "" })] })]);
}
{
  // item bundles: tree on the order / receipt, nested children on the invoice; and the flat shape
  const po = makePo({ lines: [{ qty: 2, bundle: "2089258885490675714", children: [{ qty: 2 }, { qty: 4 }] }, { qty: 6 }] });
  const gr = makeGr(po, { lines: [{ poLine: 0, qty: 2 }, { poLine: 1, qty: 2, parentOf: 0 }, { poLine: 2, qty: 4, parentOf: 0 }, { poLine: 3, qty: 6 }] });
  const parent = Object.assign(piLine(po, gr, 0, 0, 2), { material_id: "", item_bundle_id: "2089258885490675714" });
  const kids = [Object.assign(piLine(po, gr, 1, 1, 2), { parent_fm_key: parent.fm_key }), Object.assign(piLine(po, gr, 2, 2, 4), { parent_fm_key: parent.fm_key })];
  S.push(["bundle nested", world([po], [gr]), header({ table_pi: [Object.assign({}, parent, { children: kids }), piLine(po, gr, 3, 3, 6)] })]);
  S.push(["bundle flat", world([po], [gr]), header({ table_pi: [parent, ...kids, piLine(po, gr, 3, 3, 6)] })]);
  S.push(["bundle dropped at 0", world([po], [gr]), header({ table_pi: [Object.assign({}, parent, { invoice_qty: 0, children: kids }), piLine(po, gr, 3, 3, 6)] })]);
}
{
  // two orders, two receipts on one invoice
  const p1 = makePo({ lines: [{ qty: 5 }, { qty: 5 }] });
  const p2 = makePo({ lines: [{ qty: 7 }] });
  const g1 = makeGr(p1, { lines: [{ poLine: 0, qty: 5 }, { poLine: 1, qty: 5 }] });
  const g2 = makeGr(p2, { lines: [{ poLine: 0, qty: 7 }] });
  S.push(["two POs two GRs", world([p1, p2], [g1, g2]), header({ table_pi: [piLine(p1, g1, 0, 0, 5), piLine(p1, g1, 1, 1, 2), piLine(p2, g2, 0, 0, 7)] })]);
}

let bad = 0;
for (const [name, mk, data] of S) {
  const r = compare(OLD, NEW, mk, { data });
  const o = r.a.outcome || { crash: r.a.crash };
  console.log((r.same ? "ok   " : "FAIL ") + name.padEnd(40) + " -> " + (o.crash ? "crash " + o.crash : o.code + (o.msg ? " " + String(o.msg).slice(0, 70) : "")));
  if (!r.same) {
    bad++;
    for (const p of r.problems) console.log("     " + p);
  }
}
console.log(S.length + " scenarios, " + bad + " differ");
