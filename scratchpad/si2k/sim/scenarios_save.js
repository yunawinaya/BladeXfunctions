// Synthetic SI_SAVE paths through v83 and v84 (same comparison as replay_save.js), plus node data at 2,000 lines.
// Usage: node scenarios_save.js <old SI_SAVE json> <new SI_SAVE json>
"use strict";
const fs = require("fs");
const { World, clone } = require("./world_save.js");
const R = require("./replay_save.js");

const [oldFile, newFile] = process.argv.slice(2);
const OLD = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));
const { Engine } = require("./engine.js");

let seq = 2200000000000000000n;
const nid = () => (++seq).toString();
const TENANT = "128671";
const ORG = "1996821057533001730";

// an order with n lines (bundles: every 7th line is a bundle row with 3 items, nested or flat), and a delivery of it
function makeDocs(n, opts) {
  opts = opts || {};
  const so = { id: nid(), so_no: "SO-SIM-" + seq, so_status: "Issued", organization_id: ORG, table_so: [] };
  const gd = { id: nid(), delivery_no: "GD-SIM-" + seq, gd_status: "Completed", organization_id: ORG, so_id: [so.id], table_gd: [] };
  const siLines = [];
  for (let i = 0; i < n; i++) {
    const bundle = opts.bundles && i % 7 === 3;
    const soLine = { id: nid(), item_name: bundle ? undefined : nid(), item_id: "ITEM-" + i, so_quantity: 10, invoice_qty: opts.preInvoiced ? 4 : 0,
      return_qty: opts.returns ? 2 : 0 };
    if (bundle) soLine.item_bundle_id = nid();
    if (opts.preInvoiced) soLine.si_status = "Partially Invoiced";
    const gdLine = { id: nid(), material_id: bundle ? undefined : soLine.item_name, material_name: "Item " + i, gd_qty: opts.gdQty || 6, invoice_qty: 0,
      so_line_item_id: soLine.id, line_so_id: so.id, return_qty: opts.returns ? 1 : 0 };
    if (bundle) gdLine.item_bundle_id = soLine.item_bundle_id;
    const siLine = { material_id: gdLine.material_id || "", material_name: gdLine.material_name, item_bundle_id: soLine.item_bundle_id || "",
      invoice_qty: (opts.invQty !== undefined ? opts.invQty : 6).toFixed(8), unit_price: "10.10000000", gross: "60.60000000", si_amount: "60.60000000",
      tax_amount: "0.00000000", discount_amount: "0.00000000", si_discount: "0.00000000", so_order_quantity: "10.00000000", line_so_id: so.id,
      line_so_no: so.so_no, so_line_id: soLine.id, line_gd_id: gd.id, line_gd_no: gd.delivery_no, gd_line_id: gdLine.id, si_tax_rate_id: "",
      tax_percent: 0, line_index: i + 1 };
    if (opts.zeroEvery && i % opts.zeroEvery === 0) siLine.invoice_qty = 0;
    if (bundle) {
      soLine.children = [];
      gdLine.children = [];
      siLine.children = [];
      for (let c = 0; c < 3; c++) {
        const sc = { id: nid(), item_name: nid(), item_id: "ITEM-" + i + "-" + c, so_quantity: 10, invoice_qty: 0, item_bundle_id: soLine.item_bundle_id };
        const gc = { id: nid(), material_id: sc.item_name, material_name: "Item " + i + "-" + c, gd_qty: opts.gdQty || 6, invoice_qty: 0,
          so_line_item_id: sc.id, line_so_id: so.id, item_bundle_id: soLine.item_bundle_id };
        soLine.children.push(sc);
        gdLine.children.push(gc);
        siLine.children.push({ material_id: gc.material_id, material_name: gc.material_name, item_bundle_id: soLine.item_bundle_id,
          invoice_qty: (opts.invQty !== undefined ? opts.invQty : 6).toFixed(8), unit_price: "1.00000000", gross: "6.00000000", si_amount: "6.00000000",
          line_so_id: so.id, so_line_id: sc.id, line_gd_id: gd.id, gd_line_id: gc.id, si_tax_rate_id: "" });
      }
      if (opts.flatBundles) {
        // the form's flat shape: the items follow their bundle row, linked by parent_id
        for (const arr of [[so.table_so, soLine], [gd.table_gd, gdLine]]) {
          const [list, row] = arr;
          const kids = row.children;
          delete row.children;
          list.push(row);
          for (const k of kids) list.push(Object.assign({}, k, { parent_id: row.id }));
        }
        const kids = siLine.children;
        delete siLine.children;
        siLines.push(siLine);
        for (const k of kids) siLines.push(k);
        continue;
      }
    }
    so.table_so.push(soLine);
    gd.table_gd.push(gdLine);
    siLines.push(siLine);
  }
  for (const doc of [so, gd]) for (const l of doc.table_so || doc.table_gd) for (const k of Object.keys(l)) if (l[k] === undefined) delete l[k];
  for (const l of siLines) for (const k of Object.keys(l)) if (l[k] === undefined) delete l[k];
  return { so, gd, siLines };
}

function payload(docs, over) {
  const total = (docs.siLines.length * 60.6).toFixed(8);
  return Object.assign({
    page_status: "Convert", si_status: "Completed", invoice_type: "Credit", plant_id: ORG, organization_id: ORG, customer_id: "2100000000000000001",
    so_no_display: docs.so.so_no, gd_no_display: docs.gd.delivery_no, so_id: [docs.so.id], gd_id: [docs.gd.id], currency_code: "MYR",
    sales_invoice_no: "issued", sales_invoice_no_type: "2026901594941353985", sales_invoice_date: "2026-10-21", sales_person_id: "2100000000000000002",
    si_payment_term_id: "2100000000000000003", si_description: "Sales", posted_status: "Unposted", acc_integration_type: "No Accounting",
    previous_status: "", invoice_subtotal: total, invoice_total_discount: "0.00000000", invoice_taxes_amount: "0.00000000", invoice_total: total,
    myr_total_amount: total, si_area_id: "", table_si: docs.siLines,
  }, over || {});
}

function world(docs, rec, extra) {
  return () => {
    const w = new World(Object.assign({ get_node_oLOE8Qt7: { count: 1, data: { auto_post_si: 0, acc_integration_type: "No Accounting" } } }, rec || {}),
      { tenantId: TENANT });
    for (const d of [].concat(docs || [])) {
      w.addDoc(w.so, d.so, "table_so");
      w.addDoc(w.gd, d.gd, "table_gd");
    }
    if (extra) extra(w);
    return w;
  };
}

const results = [];
function scenario(name, makeWorld, data, expect) {
  const res = R.compareRuns(OLD, NEW, makeWorld, { data });
  const code = res.a.crash ? "crash: " + res.a.crash : res.a.outcome.code + (res.a.outcome.data && res.a.outcome.data.pi_confirm ? "/pi_confirm " + res.a.outcome.data.pi_confirm : "") +
    (res.a.outcome.data && res.a.outcome.data.pi_trigger_failed ? "/pi_trigger_failed" : "");
  const ok = res.same && (!expect || code.startsWith(expect));
  const heads = (res.headerChanges || []).map((h) => "header " + h.from + " -> " + h.to + " " + JSON.stringify(h.lines)).join("; ");
  results.push([ok, name, code + (heads ? "  [" + heads + "]" : ""), res.problems.join(" | ").slice(0, 500)]);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------- paths
let d = makeDocs(5);
scenario("draft add", world(d), payload(d, { si_status: "Draft", page_status: "Add", sales_invoice_no: "" }), "200");
scenario("draft add, no plant -> 406", world(d), payload(d, { si_status: "Draft", page_status: "Add", plant_id: null }), "406");
scenario("completed, no date -> 406", world(d), payload(d, { sales_invoice_date: "" }), "406");
scenario("completed, all qty 0 -> 407", world(makeDocs(3)), payload(makeDocs(3), {}), undefined);
d = makeDocs(4, { invQty: 0 });
scenario("completed, all qty 0 -> 407 (same docs)", world(d), payload(d), "407");
d = makeDocs(9, { zeroEvery: 3 });
scenario("completed convert, some zero lines dropped", world(d), payload(d), "200");
d = makeDocs(12, { bundles: true });
scenario("completed convert, nested bundles", world(d), payload(d), "200");
d = makeDocs(12, { bundles: true, flatBundles: true });
scenario("completed convert, flat bundles", world(d), payload(d), "200");
d = makeDocs(12, { bundles: true, zeroEvery: 3 });
scenario("completed convert, bundles with zero bundle rows", world(d), payload(d), "200");
d = makeDocs(6, { gdQty: 4 });
scenario("over-invoice -> 410", world(d), payload(d), "410");
d = makeDocs(6, { returns: true });
scenario("deduct returns -> 410", world(d, { get_node_siSrSetup1: { count: 1, data: { return_billing_method: "Deduct from Invoice" } } }), payload(d), "410");
d = makeDocs(6, { returns: true, invQty: 5 });
scenario("deduct returns, within", world(d, { get_node_siSrSetup1: { count: 1, data: { return_billing_method: "Deduct from Invoice" } } }), payload(d), "200");
d = makeDocs(6, { preInvoiced: true, invQty: 6 });
scenario("second invoice on a partly invoiced order", world(d), payload(d), "200");
// v84 fix: half the order was fully invoiced by an earlier invoice, this one finishes the rest (v83 left the header Partially)
d = makeDocs(6, { invQty: 10, gdQty: 10 });
for (const [i, l] of d.so.table_so.entries()) if (i < 3) Object.assign(l, { invoice_qty: 10, si_status: "Fully Invoiced" });
scenario("second invoice finishes the order (header fix)", world(d),
  payload(d, { gd_id: [], gd_no_display: "", table_si: d.siLines.slice(3).map((l) => Object.assign({}, l, { line_gd_id: "", gd_line_id: "" })) }), "200");
d = makeDocs(6, { invQty: 10, gdQty: 10 });
for (const [i, l] of d.so.table_so.entries()) if (i < 2) Object.assign(l, { invoice_qty: 10, si_status: "Fully Invoiced" });
scenario("second invoice leaves one line open (header stays Partially)", world(d),
  payload(d, { gd_id: [], gd_no_display: "", table_si: d.siLines.slice(2, 5).map((l) => Object.assign({}, l, { line_gd_id: "", gd_line_id: "" })) }), "200");
d = makeDocs(6);
scenario("so-only invoice (no GD)", world(d), payload(d, { gd_id: [], gd_no_display: "", table_si: d.siLines.map((l) => Object.assign({}, l, { line_gd_id: "", gd_line_id: "" })) }), "200");
const d2 = makeDocs(5);
const two = [d, d2];
scenario("two SOs + two GDs", world(two), payload(d, { so_id: [d.so.id, d2.so.id], gd_id: [d.gd.id, d2.gd.id], table_si: d.siLines.concat(d2.siLines) }), "200");
d = makeDocs(5);
scenario("credit limit block -> 408", world(d, { workflow_node_G4KBFPGT: { result: "failed", message: "Block - over limit" } }),
  payload(d, { page_status: "Add", acc_integration_type: "SQL Accounting" }), "408");
scenario("credit limit override -> 409", world(d, { workflow_node_G4KBFPGT: { result: "failed", message: "Override - over limit" } }),
  payload(d, { page_status: "Add", acc_integration_type: "SQL Accounting" }), "409");
scenario("credit limit on a convert -> saved as Draft", world(d, { workflow_node_G4KBFPGT: { result: "failed", message: "Block - over limit" } }),
  payload(d, { acc_integration_type: "SQL Accounting" }), "200");
scenario("credit limit passes", world(d, { workflow_node_G4KBFPGT: { result: "success", message: "ok" } }), payload(d, { acc_integration_type: "SQL Accounting" }), "200");
const link = { search_si_sopo: { total: 1, count: 1, data: [{ source_doc_id: "2100000000000000099", source_doc_no: "PO-1", buyer_org_id: "11", seller_org_id: "22" }] },
  search_si_its: { total: 1, count: 1, data: [{ auto_create_pi: 1 }] } };
scenario("internal trading -> 411", world(d, link), payload(d), "200/pi_confirm 411");
scenario("internal trading confirmed -> auto PI", world(d, link), payload(d, { auto_pi_confirmed: true }), "200");
scenario("internal trading confirmed, PI fails -> 413", world(d, Object.assign({ wf_auto_pi: { data: { code: 500, message: "PI failed" } } }, link)),
  payload(d, { auto_pi_confirmed: true }), "200/pi_trigger_failed");
scenario("internal trading skipped", world(d, link), payload(d, { auto_pi_skip: true }), "200");
scenario("auto post", world(d, { get_node_oLOE8Qt7: { count: 1, data: { auto_post_si: 1, acc_integration_type: "AutoCount" } } }), payload(d), "200");
scenario("cash, unpaid -> customer payment", world(d), payload(d, { invoice_type: "Cash", page_status: "Add" }), "200");
const draftRec = { search_node_I3e7ZpkH: { total: 1, count: 1, data: [{ id: "2100000000000000777", si_status: "Draft" }] } };
scenario("other drafts deleted", world(d, draftRec), payload(d), "200");
const stored = { id: "2100000000000000555", sales_invoice_no: "Draft-SI-0007", si_status: "Draft", invoice_total: 303, organization_id: ORG, customer_id: "2100000000000000001",
  table_si: d.siLines.map((l, i) => Object.assign({}, l, { id: "21000000000000006" + String(i).padStart(2, "0") })) };
scenario("edit draft -> completed (receivable added)", world(d, {}, (w) => { w.si[stored.id] = clone(stored); }),
  payload(d, { page_status: "Edit", previous_status: "Draft", id: stored.id, sales_invoice_no: "Draft-SI-0007" }), "200");
scenario("edit draft -> draft", world(d, {}, (w) => { w.si[stored.id] = clone(stored); }),
  payload(d, { page_status: "Edit", previous_status: "Draft", si_status: "Draft", id: stored.id, sales_invoice_no: "Draft-SI-0007" }), "200");
scenario("edit cash -> customer payment from the entry", world(d, {}, (w) => { w.si[stored.id] = clone(stored); }),
  payload(d, { page_status: "Edit", previous_status: "Draft", id: stored.id, invoice_type: "Cash" }), "200");
scenario("manual number (-9999)", world(d), payload(d, { sales_invoice_no_type: -9999, sales_invoice_no: "MANUAL-1" }), "200");

for (const [ok, name, code, problems] of results) console.log((ok ? "ok   " : "FAIL ") + name.padEnd(52) + " " + code + (problems ? "  " + problems : ""));
console.log(results.filter((r) => r[0]).length + "/" + results.length + " scenarios identical");

// ---------------------------------------------------------------------------------------------------------------- 2,000 lines
for (const [label, opts] of [["2,000 lines", {}], ["2,000 lines, bundles", { bundles: true }]]) {
  const big = makeDocs(2000, opts);
  const params = { data: payload(big) };
  const sizes = [];
  for (const doc of [OLD, NEW]) {
    const w = world(big)();
    const e = new Engine(doc, w, {});
    const t0 = Date.now();
    const r = e.run(clone(params));
    const total = Object.values(e.sizes).reduce((t, x) => t + x.in + x.out, 0);
    const top = Object.entries(e.sizes).map(([k, x]) => [k, x.in + x.out]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    sizes.push([(total / 1e6).toFixed(1) + " MB", r.outcome.code, Date.now() - t0 + " ms", top.map(([k, v]) => k + " " + (v / 1e6).toFixed(1)).join(", ")]);
  }
  console.log(label + " (" + params.data.table_si.length + " top rows): v83 " + JSON.stringify(sizes[0]) + "\n      v84 " + JSON.stringify(sizes[1]));
}
