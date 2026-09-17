// Executes SQT_CASCADE's code_sqtcd_diff and code_sqtcd_plan against mock data, with the
// {{...}} placeholders stubbed, so the append / remove / refusal paths can be checked
// without deploying. Extract the two scripts first:
//
//   python3 scratchpad/extract_sqtcd_nodes.py
//   node scratchpad/sqtcd_harness.js
//
// Add a case here whenever a block rule changes.

const fs = require("fs");
const sub = (src, map) => src.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
  if (!(k in map)) throw new Error("unstubbed placeholder: " + k);
  return JSON.stringify(map[k]);
});
const run = (src, map) => new Function(sub(src, map))();

const DIFF = fs.readFileSync("/tmp/h_code_sqtcd_diff.txt", "utf8");
const PLAN = fs.readFileSync("/tmp/h_code_sqtcd_plan.txt", "utf8");

const sqtLine = (id, qty, price, extra) => Object.assign({
  id, quantity: qty, unit_price: price, material_id: "ITEM" + id,
  material_name: "Item " + id, sqt_desc: "desc " + id, sqt_order_uom_id: "UOM1",
  sqt_discount: 0, sqt_discount_uom_id: "", sqt_taxes_rate_id: null,
  sqt_tax_rate_percent: 0, sqt_tax_inclusive: 0, line_index: id,
}, extra || {});

const soLine = (id, sqtLineId, qty, price, extra) => Object.assign({
  id, sqt_line_id: sqtLineId, so_quantity: qty, so_item_price: price,
  so_gross: qty * price, so_discount: 0, so_discount_uom: "", so_discount_amount: 0,
  so_tax_amount: 0, so_amount: qty * price, so_tax_percentage: 0, so_tax_inclusive: 0,
  so_item_uom: "UOM1", item_name: "ITEM" + sqtLineId, item_id: "Item " + sqtLineId,
  delivered_qty: 0, planned_qty: 0, invoice_qty: 0, min_price: 0, max_price: 0,
}, extra || {});

const SO = (lines) => ({
  id: "SO1", so_no: "SO/001", so_status: "Issued", customer_name: "C", plant_name: "P",
  so_date: "2026-09-17", so_payment_term: "T", acc_integration_type: "No Accounting",
  auto_si: 0, si_status: "Not Created", posted_status: null, exchange_rate: 0,
  create_si: "No", table_so: lines,
});

const plan = (passNo, changes, so, mapped) => run(PLAN, {
  "workflowparams:passNo": passNo,
  "node:code_sqtcd_diff.data.changes": changes,
  "node:wf_sqtcd_maplines.data.data": mapped || null,
  "node:search_sqtcd_sos.data.data": [so],
  "node:search_sqtcd_items.data.data": [],
  "node:get_sqtcd_approval.data.data": { approval_rules: [{ document_type: "SO", so_convert: 0, so_min_price: 1 }] },
  "node:search_sqtcd_draftgd.data.data": [],
  "node:search_sqtcd_draftsi.data.data": [],
  "workflowparams:confirmPickReversal": "",
  "workflowparams:raiseGdQty": "",
});
const diff = (passNo, prev, next) => run(DIFF, {
  "workflowparams:passNo": passNo,
  "workflowparams:prev_table_sqt": prev,
  "workflowparams:next_table_sqt": next,
});

let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + JSON.stringify(detail) : "")); } };

console.log("\n1) pass 1 -- remove a line that nothing has consumed");
{
  const prev = [sqtLine("A", 10, 100), sqtLine("B", 5, 50)];
  const next = [sqtLine("A", 10, 100)];
  const dd = diff(1, prev, next);
  t("diff sees one removal", dd.removedCount === 1 && dd.changeCount === 1, dd);
  const r = plan(1, dd.changes, SO([soLine("L1", "A", 10, 100), soLine("L2", "B", 5, 50)]));
  t("not blocked", r.blocked === 0, r.blockMessage);
  const out = r.soPayloads[0].allData;
  t("SO line dropped", out.table_so.length === 1 && out.table_so[0].sqt_line_id === "A", out.table_so.map(x=>x.sqt_line_id));
  t("total re-summed to 1000", Number(out.so_total) === 1000, out.so_total);
}

console.log("\n2) pass 1 -- removing a delivered line is refused");
{
  const dd = diff(1, [sqtLine("A", 10, 100), sqtLine("B", 5, 50)], [sqtLine("A", 10, 100)]);
  const r = plan(1, dd.changes, SO([soLine("L1","A",10,100), soLine("L2","B",5,50,{delivered_qty:3})]));
  t("blocked 406", r.blocked === 1 && r.blockCode === "406", r);
  t("message names the delivery", /already been delivered \(3\)/.test(r.blockMessage), r.blockMessage);
}

console.log("\n3) pass 1 -- a brand new line is invisible (pass 2's job)");
{
  const dd = diff(1, [sqtLine("A", 10, 100)], [sqtLine("A", 10, 100), sqtLine(undefined, 7, 20)]);
  t("no changes in pass 1", dd.changeCount === 0, dd);
}

console.log("\n4) pass 2 -- the new line is appended");
{
  const prev = [sqtLine("A", 10, 100)];
  const next = [sqtLine("A", 10, 100), sqtLine("B", 7, 20)];
  const dd = diff(2, prev, next);
  t("diff sees one addition", dd.addedCount === 1 && dd.changeCount === 1, dd);
  t("addedLineIds carries B", JSON.stringify(dd.addedLineIds) === '["B"]', dd.addedLineIds);
  const mapped = [soLine(undefined, "B", 7, 20)];
  const r = plan(2, dd.changes, SO([soLine("L1","A",10,100)]), mapped);
  t("not blocked", r.blocked === 0, r.blockMessage);
  const out = r.soPayloads[0].allData;
  t("SO now has 2 lines", out.table_so.length === 2, out.table_so.length);
  t("appended line has sqt_line_id B", out.table_so[1].sqt_line_id === "B", out.table_so[1].sqt_line_id);
  t("appended counters zeroed", out.table_so[1].delivered_qty === 0 && out.table_so[1].invoice_qty === 0, out.table_so[1]);
  t("total 1000 + 140 = 1140", Number(out.so_total) === 1140, out.so_total);
}

console.log("\n5) pass 1 -- price below min is refused with CHECK_APPROVAL's wording");
{
  const dd = diff(1, [sqtLine("A", 10, 100)], [sqtLine("A", 10, 20)]);
  const r = plan(1, dd.changes, SO([soLine("L1","A",10,100,{min_price:50})]));
  t("blocked", r.blocked === 1, r);
  t("verbatim wording", /Unit Price 20 is below Min Price 50/.test(r.blockMessage), r.blockMessage);
}

console.log("\n6) unconverted quotation is a no-op, never a refusal");
{
  const dd = diff(1, [sqtLine("A", 10, 100)], [sqtLine("A", 12, 100)]);
  const r = run(PLAN, {
    "workflowparams:passNo": 1, "node:code_sqtcd_diff.data.changes": dd.changes,
    "node:wf_sqtcd_maplines.data.data": null, "node:search_sqtcd_sos.data.data": [],
    "node:search_sqtcd_items.data.data": [], "node:get_sqtcd_approval.data.data": null,
    "node:search_sqtcd_draftgd.data.data": [], "node:search_sqtcd_draftsi.data.data": [],
    "workflowparams:confirmPickReversal": "", "workflowparams:raiseGdQty": "",
  });
  t("no-op, not blocked", r.blocked === 0 && r.soPayloads.length === 0, r);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
