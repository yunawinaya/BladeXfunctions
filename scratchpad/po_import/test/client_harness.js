// onUpload_poLines (as embedded in the built repo POfullJSON.json) in a mocked PO form.  node test/client_harness.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");
const form = JSON.parse(fs.readFileSync(path.join(ROOT, "Purchase Order", "POfullJSON.json"), "utf8"));
const H = form.config.eventScript.find((e) => e.name === "onUpload_poLines");
const CODE = H.func;
let passes = 0, fails = 0;
const ok = (c, what, x) => { if (c) passes++; else { fails++; process.stdout.write("FAIL " + what + " " + (x === undefined ? "" : JSON.stringify(x).slice(0, 500)) + "\n"); } };
console.log = () => {};
console.error = () => {};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };

// the wiring
{
  const find = (n, m) => { if (n && typeof n === "object") { if (n.model === m) return n; for (const v of Object.values(n)) { const r = find(v, m); if (r) return r; } } return null; };
  const up = find(form, "import_po_lines");
  ok(up && up.el === "su-fm-excel-parse" && up.events.onUploadSuccess === H.key && up.options.action === "/su-code-service/io/convertExcelToJson" && /\.xlsx/.test(up.options.accept), "form: Import Lines upload -> onUpload_poLines", up && up.events);
  ok(/"import_po_lines",/.test(form.config.eventScript.find((e) => e.name === "mounted").func), "form: hidden in View");
  ok(/PO_LINE_IMPORT_ID = "2110564093187756034"/.test(CODE), "handler: PO_LINE_IMPORT id");
}

const answer = (o) => ({ data: Object.assign({ code: "200", message: "", rows: JSON.stringify([{ item_id: "A", quantity: 2, unit_price: 3 }, { item_id: "B", quantity: 1 }, { item_id: "A", quantity: 5 }]),
  alt_uom: JSON.stringify({ A: "[A-uoms]", B: "[B-uoms]" }), tax_open: "[1]", count: "3" }, o || {}) });
async function run(o) {
  const model = Object.assign({ organization_id: "9", po_supplier_id: "77", po_plant: "5", table_po: [{}], import_po_lines: [{ x: 1 }] }, o.model || {});
  const self = {
    isView: !!o.view, calls: [], msgs: [], alerts: [], confirms: [], disabledPaths: [], calcs: 0, sets: [],
    getValue: (k) => JSON.parse(JSON.stringify(model[k] === undefined ? null : model[k])),
    getVarGlobal: () => "9", getVarSystem: () => "9",
    setData: async (d) => { self.sets.push(Object.keys(d)); Object.assign(model, JSON.parse(JSON.stringify(d))); },
    showLoading() {}, hideLoading() {},
    triggerEvent: (n, a) => { if (n === "POcalculation") { self.calcs++; return { po_total: a.calcRows.length }; } return Promise.resolve(); },
    disabled: (p, v) => self.disabledPaths.push([p, v]),
    $message: Object.assign((m) => self.msgs.push(["msg", m]), { success: (m) => self.msgs.push(["success", m]), error: (m) => self.msgs.push(["error", m]), warning: (m) => self.msgs.push(["warning", m]) }),
    $alert: (m, t, opt) => { self.alerts.push([m, opt]); return Promise.resolve(); },
    $confirm: (m, t, opt) => { self.confirms.push([m, opt]); return o.confirm === "add" || o.confirm === undefined ? Promise.resolve("confirm") : Promise.reject(o.confirm); },
    runWorkflow: (id, p, okCb, errCb) => { self.calls.push({ id, p }); setTimeout(() => (o.throws ? errCb(new Error("network down")) : okCb(o.answer || answer())), 0); },
  };
  new Function(CODE).call(self, { value: o.value === undefined ? [{ "Item Code": "A", Quantity: 2 }] : o.value });
  await settle();
  await new Promise((r) => setTimeout(r, 80));
  return { self, model };
}

(async () => {
  let { self, model } = await run({});
  ok(self.calls.length === 1 && self.calls[0].p.organization_id === "9" && self.calls[0].p.supplier_id === "77" && self.calls[0].p.plant_id === "5" && self.calls[0].p.rows.length === 1, "request: rows + org / supplier / plant", self.calls[0]);
  ok(model.table_po.length === 3 && model.table_po[0].alt_uom === "[A-uoms]" && model.table_po[1].alt_uom === "[B-uoms]" && model.table_po.every((r) => /^[a-z0-9]{6,}$/.test(r.fm_key)), "new PO: its empty row replaced by the 3 lines, alt_uom put back per item", model.table_po);
  ok(self.calcs === 1 && model.po_total === 3 && self.confirms.length === 0 && model.import_po_lines === "", "one POcalculation, nothing asked, upload cleared", [self.calcs, model.po_total, self.confirms.length]);
  ok(self.disabledPaths.length === 1 && self.disabledPaths[0][0].join() === "table_po.1.tax_percent" && self.disabledPaths[0][1] === false, "Tax Rate opened on the flagged line", self.disabledPaths);
  ok(self.msgs.some((m) => m[0] === "success" && /3 line\(s\) imported/.test(m[1])), "success message");

  const two = [{ item_id: "X", quantity: 1, fm_key: "k1" }, { item_id: "Y", quantity: 1, fm_key: "k2" }];
  ({ self, model } = await run({ model: { table_po: two }, confirm: "add" }));
  ok(model.table_po.length === 5 && model.table_po[0].item_id === "X" && model.table_po[2].item_id === "A" && self.confirms.length === 1 && self.confirms[0][1].distinguishCancelAndClose === true, "filled PO: Add after", model.table_po.map((r) => r.item_id));
  ({ self, model } = await run({ model: { table_po: two }, confirm: "cancel" }));
  ok(model.table_po.length === 3 && model.table_po[0].item_id === "A", "filled PO: Replace", model.table_po.map((r) => r.item_id));
  ({ self, model } = await run({ model: { table_po: two }, confirm: "close" }));
  ok(model.table_po.length === 2 && self.calcs === 0 && model.import_po_lines === "", "filled PO: dialog closed -> nothing changes", model.table_po.map((r) => r.item_id));

  const received = [{ item_id: "X", quantity: 5, received_qty: 2, fm_key: "k1" }, { item_id: "Y", quantity: 1, fm_key: "k2" }];
  ({ self, model } = await run({ model: { table_po: received }, confirm: "add" }));
  ok(model.table_po.length === 5 && /received, invoiced or returned/.test(self.confirms[0][0]) && !self.confirms[0][1].distinguishCancelAndClose, "lines in use: add only", self.confirms[0]);
  ({ self, model } = await run({ model: { table_po: received }, confirm: "cancel" }));
  ok(model.table_po.length === 2 && self.calcs === 0 && model.import_po_lines === "", "lines in use, cancelled -> nothing changes");

  ({ self, model } = await run({ answer: { data: { code: "400", message: "2 line(s) cannot be imported - nothing was added.", errors: JSON.stringify([{ row: 3, message: "Item Code <b>X</b> was not found" }]), error_count: "2" } } }));
  ok(self.alerts.length === 1 && /Row 3: Item Code &lt;b&gt;X&lt;\/b&gt; was not found/.test(self.alerts[0][0]) && /and 1 more/.test(self.alerts[0][0]) && self.alerts[0][1].dangerouslyUseHTMLString === true, "400: every listed row, escaped, + the rest counted", self.alerts);
  ok(model.table_po.length === 1 && self.calcs === 0 && model.import_po_lines === "", "400: table untouched, upload cleared");

  ({ self, model } = await run({ answer: { data: { data: answer().data } } }));
  ok(model.table_po.length === 3, "answer nested under data.data also read");

  ({ self, model } = await run({ throws: true }));
  ok(model.table_po.length === 1 && model.import_po_lines === "" && self.msgs.some((m) => m[0] === "error" && /network down/.test(m[1])), "workflow failure: error shown, nothing changes");

  ({ self, model } = await run({ view: true }));
  ok(self.calls.length === 0 && model.import_po_lines === "", "View: nothing runs");
  ({ self, model } = await run({ value: [] }));
  ok(self.calls.length === 0 && self.msgs.some((m) => m[0] === "warning"), "empty file: warning only");

  process.stdout.write("po import client tests: " + passes + " passed, " + fails + " failed\n");
  process.exit(fails ? 1 : 0);
})();
