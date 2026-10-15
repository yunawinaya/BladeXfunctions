// node steps.js <guard|resolve|rows|batchadd> <in.json> <out.json>: one PO_LINE_IMPORT code body (as built, tail cut), or the PO
// form's own onConfirm_batchAddItem (deployed form, repo copy) in a mock form, on JSON input. Used by dev_parity.py.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");
const [step, inFile, outFile] = process.argv.slice(2);
const IN = JSON.parse(fs.readFileSync(inFile, "utf8"));
const strip = (t) => { const l = t.split("\n"); const at = l.findIndex((x) => /^const res = /.test(x)); return l.slice(0, at).join("\n"); };
const load = (file, name) => new Function(strip(fs.readFileSync(path.join(__dirname, "..", "code", file), "utf8")) + "\nreturn " + name + ";")();
const write = (o) => fs.writeFileSync(outFile, JSON.stringify(o));
console.log = () => {};

if (step === "guard") write(load("guard.js", "importGuard")(IN));
else if (step === "resolve") write(load("resolve.js", "importResolve")(IN.guard, IN.items));
else if (step === "rows") write(load("rows.js", "importRows")(IN.resolved, IN.priced));
else if (step === "batchadd") {
  // IN: { itemArray (the dialog's items), priced (the price answer), supplierId, plantId }
  const form = JSON.parse(fs.readFileSync(path.join(ROOT, "Purchase Order", "POfullJSON.json"), "utf8"));
  const code = form.config.eventScript.find((e) => e.name === "onConfirm_batchAddItem").func;
  const model = { table_po: [], po_supplier_id: IN.supplierId, po_plant: IN.plantId };
  const self = {
    getValue: (k) => JSON.parse(JSON.stringify(model[k] === undefined ? null : model[k])),
    setData: async (o) => { Object.assign(model, JSON.parse(JSON.stringify(o))); },
    closeDialog() {}, disabled() {}, $alert() {},
    triggerEvent: (name) => (name === "POcalculation" ? {} : Promise.resolve()),
    runWorkflow: (id, params, ok) => {
      const byLine = {};
      for (const p of IN.priced) byLine[p.line_index] = p;
      const sent = params.item_data.map((d) => byLine[d.line_index]).filter(Boolean);
      setTimeout(() => ok({ data: { data: sent, needOverwrite: "No" } }), 0);
    },
  };
  new Function(code).call(self, { itemArray: IN.itemArray });
  setTimeout(() => write({ table_po: model.table_po }), 400);
}
