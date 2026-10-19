// PO busy guards: the message, the classic save's and the conversion's PO lists, from the built workflow JSON (no DB). node test_pobusy.js
const fs = require("fs");
const path = require("path");
const R = path.join(__dirname, "..", "..", "..", "..");
let fails = 0, passes = 0;
const ok = (c, what, extra) => { if (c) passes++; else { fails++; console.log("FAIL", what, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400)); } };
const node = (file, id) => {
  const d = JSON.parse(fs.readFileSync(path.join(R, file), "utf8"));
  let hit = null;
  const walk = (ns) => { for (const n of ns) { if (n.id === id) hit = n; walk(n.blocks || []); } };
  walk(d.nodes);
  return hit.data.script.code;
};
const run = (code, vals) => {
  const src = code.replace(/\{\{([^}]+)\}\}/g, (m, k) => (k in vals ? JSON.stringify(vals[k]) : (() => { throw new Error("no value for " + k); })()));
  return new Function(src)();
};
const msgSrc = fs.readFileSync(path.join(__dirname, "..", "msg.js"), "utf8");
const poBusyMessage = new Function(msgSrc + "\nreturn poBusyMessage;")();
ok(poBusyMessage([], false) === "" && poBusyMessage(null, true) === "", "no rows -> no message");
ok(poBusyMessage([{ id: "1", gr_no: "GR/1", po_id: "9", po_no: "PO/9" }], false) === "PO/9 is still being received in the background by GR/1. Please wait until it finishes, then try again.", "one row",
  poBusyMessage([{ id: "1", gr_no: "GR/1", po_id: "9", po_no: "PO/9" }], false));
ok(/then convert it again\.$/.test(poBusyMessage({ id: "1", gr_no: "GR/1", po_id: "9", po_no: "PO/9" }, true)), "single object row + convert wording");
const two = poBusyMessage([{ gr_no: "GR/1", po_no: "PO/9" }, { gr_no: "GR/1", po_no: "PO/9" }, { gr_no: "GR/2", po_id: "8" }], false);
ok(two === "These purchase orders are still being received in the background: PO/9 (GR/1), 8 (GR/2). Please wait until they finish, then try again.", "two, deduped, id when no number", two);
const many = poBusyMessage([1, 2, 3, 4, 5, 6, 7].map((i) => ({ gr_no: "GR/" + i, po_no: "PO/" + i })), true);
ok(/PO\/5 \(GR\/5\) and 2 more\. Please wait until they finish, then convert them again\.$/.test(many), "more than five", many);

// classic GOODS_RECEIVING: the PO list and when the check runs
const grKeys = node("Goods Receiving/GRsaveWorkflow.json", "code_node_GrPoBusyKeys");
const gk = (allData, saveAs) => run(grKeys, { "workflowparams:allData.po_id": allData.po_id, "workflowparams:allData.table_gr": allData.table_gr, "workflowparams:saveAs": saveAs });
let r = gk({ po_id: ["2111087164910899201"], table_gr: [{ line_po_id: "2111087164910899201" }, { line_po_id: "2111087187090378753" }] }, "Completed");
ok(r.need === "YES" && r.posJson === JSON.stringify(["2111087164910899201", "2111087187090378753"]), "classic: header + line POs, deduped", r);
ok(gk({ po_id: ["1"], table_gr: [] }, "Draft").need === "NO", "classic: Draft is not checked");
r = gk({ po_id: '["5", "x"]', table_gr: [{ line_po_id: "6", children: [{ line_po_id: "7" }] }, { line_po_id: "bad'" }] }, "Created");
ok(r.need === "YES" && r.posJson === JSON.stringify(["5", "6", "7"]), "classic: JSON-text header, bundle children, non-digits dropped", r);
r = gk({ po_id: null, table_gr: null }, "Completed");
ok(r.need === "NO" && r.posJson === '["0"]', "classic: no PO -> nothing to check", r);
const grChk = node("Goods Receiving/GRsaveWorkflow.json", "code_node_GrPoBusy");
r = run(grChk, { "node:sql_node_GrPoBusy.data": [{ id: "3", gr_no: "GR/3", po_id: "5", po_no: "PO/5" }] });
ok(r.busy === "YES" && /^PO\/5 is still being received in the background by GR\/3/.test(r.message), "classic: a Processing receipt refuses", r);
ok(run(grChk, { "node:sql_node_GrPoBusy.data": [] }).busy === "NO", "classic: none -> on");

// PO_Convert_GR: the selected POs, digits only
const cvKeys = node("Bulk Actions/Procurement/Purchase Order/POconvertGRWorkflow.json", "code_node_PoGrBusyKeys");
ok(run(cvKeys, { "workflowparams:po_ids": ["1", 2, "x", " 3 "] }).posJson === JSON.stringify(["1", "2", "3"]), "convert: digits only");
ok(run(cvKeys, { "workflowparams:po_ids": null }).posJson === '["0"]', "convert: none -> [\"0\"]");

// GR_CREATED: the check node
const gcChk = node("Goods Receiving/GRsaveAsCreatedWorkflow.json", "code_node_GcPoBusy");
r = run(gcChk, { "node:sql_node_GcPoBusy.data": { id: "3", gr_no: "GR/3", po_id: "5", po_no: "PO/5" } });
ok(r.busy === "YES" && /then try again\.$/.test(r.message), "created: a Processing receipt refuses", r);
console.log("po busy tests: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
