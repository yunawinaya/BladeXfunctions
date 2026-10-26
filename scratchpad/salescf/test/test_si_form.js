// test_si_form.js: the SI form's onChange_soID fills the header custom fields (custom_fields_h35azf2l) from its source, on a
// NEW invoice whose box is still empty: the first delivery's when the lines came from one, else the order's. The handler
// runs from out/<env>/form_sales_invoice.json with a mocked page and db.
// Run: node scratchpad/salescf/test/test_si_form.js [out/<env>/form_sales_invoice.json]
const fs = require("fs"), assert = require("assert"), path = require("path");
const F = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "out", "dev", "form_sales_invoice.json"), "utf8"));
const H = F.config.eventScript.filter((e) => e.name === "onChange_soID");
assert.strictEqual(H.length, 1);
const SO = { id: "11", so_currency: "MYR", custom_fields_m07krnod: { lsh_envelope: true, lsh_restday: "Sun" }, di_shipping_method: "S1", di_vehicle_number: "V1" };
const GD = { id: "22", custom_fields: { lsh_envelope: false, lsh_receivehour: "8-5" }, di_shipping_method: "S2", di_vehicle_number: "V2" };

async function run({ isAdd = true, isCopy = false, gd = true, current = {} }) {
  const calls = { reads: [], set: [] };
  const values = { so_id: ["11"], gd_id: gd ? ["22"] : [], custom_fields_h35azf2l: current };
  const query = (name) => {
    const q = { fields: null, field(f) { this.fields = f; return this; }, where() { return this; },
      async get() { calls.reads.push({ name, fields: this.fields }); return { data: [name === "sales_order" ? SO : GD] }; } };
    return q;
  };
  const db = { collection: (name) => query(name) };
  const ctx = {
    isAdd, isCopy,
    getValue: (k) => values[k],
    setData: (o) => { calls.set.push(o); Object.assign(values, o); return Promise.resolve(); },
    display: () => {}, hide: () => {},
  };
  new Function("db", H[0].func).call(ctx, db);
  await new Promise((r) => setTimeout(r, 30));
  calls.cf = calls.set.filter((o) => "custom_fields_h35azf2l" in o).map((o) => o.custom_fields_h35azf2l);
  return calls;
}

let n = 0;
const ok = (t) => { n++; console.log("ok", t); };
(async () => {
  let c = await run({});
  assert.deepStrictEqual(c.cf, [{ lsh_envelope: false, lsh_receivehour: "8-5" }]);
  ok("new_si_from_gd: a new invoice from a delivery takes the delivery's header custom fields");

  c = await run({ gd: false });
  assert.deepStrictEqual(c.cf, [{ lsh_envelope: true, lsh_restday: "Sun" }]);
  ok("new_si_from_so: a new invoice from an order takes the order's");

  c = await run({ isAdd: false });
  assert.deepStrictEqual(c.cf, []);
  ok("edit_keeps: a stored invoice is not refilled");

  c = await run({ isCopy: true, isAdd: false, gd: false });
  assert.deepStrictEqual(c.cf, [{ lsh_envelope: true, lsh_restday: "Sun" }]);
  ok("a copied invoice counts as new");

  c = await run({ current: { lsh_restday: "Mon" } });
  assert.deepStrictEqual(c.cf, []);
  ok("user_value_kept: values already in the box are not overwritten");

  c = await run({ current: { lsh_envelope: false } });
  assert.deepStrictEqual(c.cf, []);
  ok("false_is_a_value: {lsh_envelope:false} is not an empty box");

  c = await run({});
  assert.deepStrictEqual(c.reads.map((r) => r.name).sort(), ["goods_delivery", "sales_order"]);
  assert.ok(/(^|,)custom_fields(,|$)/.test(c.reads.find((r) => r.name === "goods_delivery").fields), c.reads[1].fields);
  c = await run({ gd: false });
  assert.deepStrictEqual(c.reads.map((r) => r.name), ["sales_order"]);
  ok("no_second_fetch: the same reads as before; the delivery read's projection includes custom_fields");

  c = await run({ gd: true });
  const all = Object.assign({}, ...c.set);
  assert.strictEqual(all.si_shipping_method, "S2");
  ok("the shipping fill is unchanged");
  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
