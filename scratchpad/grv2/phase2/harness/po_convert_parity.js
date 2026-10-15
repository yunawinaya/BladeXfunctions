// PO_Convert_GR code_node_PoGrMap: old (O(N^2) flatten) vs new (parent index) on every recorded dev run, then on
// synthetic POs with nested and flat bundles up to 2,000 lines. Output must be byte-identical.
// usage: node po_convert_parity.js <fixtures_dir>
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const FX = process.argv[2];
const HERE = __dirname;
const OLD = fs.readFileSync(path.join(HERE, "..", "PoGrMap_old.js"), "utf8");
const NEW = fs.readFileSync(path.join(HERE, "..", "PoGrMap_new.js"), "utf8");

function runNode(code, varMap) {
  const src = code.replace(/\{\{([^}]+)\}\}/g, (m, key) => {
    if (!(key in varMap)) {
      // runs recorded before a parameter existed: the engine resolves an absent param to null
      if (key.startsWith("workflowparams:")) return "null";
      throw new Error("missing placeholder " + key);
    }
    return JSON.stringify(varMap[key]);
  });
  return new Function(src)();
}

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

// 1. recorded dev runs
const runs = JSON.parse(fs.readFileSync(path.join(FX, "po_convert_runs.json"), "utf8"));
// the engine's answer omits null fields; gr_date is the run's own day
const stripDates = (o) =>
  JSON.parse(JSON.stringify(o, (k, v) => (k === "gr_date" ? "<date>" : v === null ? undefined : v)));
for (const run of runs) {
  const vm = run.variableMap;
  const a = runNode(OLD, vm);
  const b = runNode(NEW, vm);
  const same = JSON.stringify(a) === JSON.stringify(b);
  const recorded = run.response && run.response.data;
  const matchesRecorded = recorded ? JSON.stringify(stripDates(a)) === JSON.stringify(stripDates(recorded)) : null;
  const pos = (vm["node:search_node_PoGrGetAll.data.data"] || []).length;
  const lines = (vm["node:search_node_PoGrGetAll.data.data"] || []).reduce((n, po) => n + (po.table_po || []).length, 0);
  check(
    `run ${run.id} (${run.status}, ${pos} PO, ${lines} lines, code ${a.result_code})`,
    same,
    `old==new: ${same}; old==recorded answer (dates, nulls masked): ${matchesRecorded}`,
  );
}

// 2. synthetic POs: plain lines, nested bundles, flat bundles (children after / before their bundle), orphans
function synthPO(n, poId, mode) {
  const table_po = [];
  let id = 1;
  const line = (extra) => ({
    id: String(poId) + String(id++).padStart(5, "0"),
    item_id: "9" + String(id).padStart(18, "0"),
    item_name: "Item " + id,
    item_desc: "",
    more_desc: "",
    quantity: 10,
    quantity_uom: "111",
    received_qty: id % 7 === 0 ? 10 : id % 5 === 0 ? 3 : 0,
    created_received_qty: id % 11 === 0 ? 2 : 0,
    unit_price: 1.5,
    po_amount: 15,
    line_remark_1: "",
    line_remark_2: "",
    item_bundle_id: null,
    item_category_id: null,
    tariff_id: null,
    further_description: "",
    project_id: null,
    ...extra,
  });
  while (table_po.length < n) {
    const k = table_po.length;
    if (mode !== "plain" && k % 10 === 0) {
      const bundle = line({ item_id: null, item_bundle_id: "777" + k });
      const kids = [line({ item_bundle_id: "777" + k }), line({ item_bundle_id: "777" + k })];
      if (mode === "nested") {
        bundle.children = kids;
        table_po.push(bundle);
      } else if (mode === "flat-before") {
        kids.forEach((c) => (c.parent_id = bundle.id));
        table_po.push(...kids, bundle);
      } else {
        kids.forEach((c) => (c.parent_id = bundle.id));
        table_po.push(bundle, ...kids);
      }
    } else if (mode !== "plain" && k % 37 === 0) {
      table_po.push(line({ parent_id: "123" })); // child of no line in this PO
    } else {
      table_po.push(line({}));
    }
  }
  return {
    id: String(poId),
    purchase_order_no: "PO/SYN/" + poId,
    po_status: "Issued",
    organization_id: "1",
    po_supplier_id: "5",
    po_currency: "MYR",
    project_id: null,
    po_remark: "",
    table_po,
  };
}

for (const n of [50, 500, 2000]) {
  for (const mode of ["plain", "nested", "flat-after", "flat-before"]) {
    for (const multiple of ["single", "multiple"]) {
      const pos = [synthPO(n, 2100000000000000001, mode), synthPO(Math.ceil(n / 4), 2100000000000000002, mode)];
      const vm = {
        "node:search_node_PoGrGetAll.data.data": pos,
        "workflowparams:po_ids": pos.map((p) => p.id),
        "workflowparams:is_multiple": multiple,
        "workflowparams:plant_id": "42",
        "workflowparams:received_by": "tester",
      };
      const t0 = process.hrtime.bigint();
      const a = runNode(OLD, vm);
      const t1 = process.hrtime.bigint();
      const b = runNode(NEW, vm);
      const t2 = process.hrtime.bigint();
      const same = JSON.stringify(a) === JSON.stringify(b);
      const ms = (x) => (Number(x) / 1e6).toFixed(1);
      check(
        `synthetic ${mode.padEnd(11)} ${String(n).padStart(4)}+${Math.ceil(n / 4)} lines ${multiple.padEnd(8)}`,
        same,
        `old ${ms(t1 - t0)} ms, new ${ms(t2 - t1)} ms, out ${JSON.stringify(a).length} B`,
      );
    }
  }
}

console.log("failures:", fails);
process.exit(fails ? 1 : 0);
