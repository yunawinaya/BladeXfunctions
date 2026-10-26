// test_cf_box_layout.js: the GD and SI header custom-field boxes are laid out like the SO's (custom_fields_m07krnod on the SO
// form: 2 fields per row, the box's own "Custom Fields" label hidden). Only those two options change; the rest of the box,
// and the GD line column of the same model, stay as in base/<env>/.
// Run: node scratchpad/salescf/test/test_cf_box_layout.js [dev|prod]
const fs = require("fs"), assert = require("assert"), path = require("path");
const ENV = process.argv[2] || "dev";
const P = path.join(__dirname, "..");
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(P, dir, ENV, name + ".json"), "utf8"));
const boxes = (o, model, out = []) => {
  if (Array.isArray(o)) o.forEach((v) => boxes(v, model, out));
  else if (o && typeof o === "object") {
    if (o.type === "custom-fields" && o.model === model) out.push(o);
    Object.values(o).forEach((v) => boxes(v, model, out));
  }
  return out;
};
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

for (const [form, model] of [["form_goods_delivery", "custom_fields"], ["form_sales_invoice", "custom_fields_h35azf2l"]]) {
  const out = boxes(read("out", form), model), base = boxes(read("base", form), model);
  const header = (l) => l.filter((b) => !b.options.tableColumn);
  assert.strictEqual(header(out).length, 1, form + ": one header box");
  const o = header(out)[0], b = header(base)[0];
  assert.strictEqual(o.options.col, 2, form + ": 2 fields per row, like the SO");
  assert.strictEqual(o.options.hideLabel, true, form + ": the box label hidden, like the SO");
  const rest = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.options.col; delete c.options.hideLabel; return c; };
  assert.deepStrictEqual(rest(o), rest(b), form + ": nothing else in the box changed");
  assert.deepStrictEqual(out.filter((x) => x.options.tableColumn), base.filter((x) => x.options.tableColumn), form + ": line columns untouched");
  ok(form + ": header box col 2 + hideLabel, nothing else changed");
}
console.log(n + " passed");
