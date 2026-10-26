// test_gd_form.js: the GD form's onChange_soID fills the header custom fields (custom_fields) from the first SO, on a NEW
// delivery whose box is still empty, through the one SO read it already makes. Runs the handler from
// out/<env>/form_goods_delivery.json with a mocked page and db.
// Run: node scratchpad/salescf/test/test_gd_form.js [dev|prod]
const fs = require("fs"), assert = require("assert"), path = require("path");
const ENV = process.argv[2] || "dev";
const F = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", ENV, "form_goods_delivery.json"), "utf8"));
const H = F.config.eventScript.filter((e) => e.name === "onChange_soID");
assert.strictEqual(H.length, 1);
const SO = { id: "11", so_description: "x", custom_fields_m07krnod: { lsh_envelope: false, lsh_resthour: "12-1" } };

async function run({ isAdd = true, isCopy = false, current = {}, soIds = ["11"] }) {
  const calls = { reads: [], set: [] };
  const values = { custom_fields: current };
  globalThis.db = { collection: (name) => ({ where() { return this; }, async get() { calls.reads.push(name); return { data: [SO] }; } }) };
  const ctx = {
    isAdd, isCopy,
    getValue: (k) => values[k],
    setData: (o) => { calls.set.push(o); Object.assign(values, o); return Promise.resolve(); },
    display: () => {}, hide: () => {}, triggerEvent: () => Promise.resolve(),
  };
  const log = console.log;
  console.log = () => {};
  try {
    new Function(H[0].func).call(ctx, { value: soIds });
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    console.log = log;
  }
  calls.cf = calls.set.filter((o) => "custom_fields" in o).map((o) => o.custom_fields);
  return calls;
}

let n = 0;
const ok = (t) => { n++; console.log("ok", t); };
(async () => {
  let c = await run({});
  assert.deepStrictEqual(c.cf, [{ lsh_envelope: false, lsh_resthour: "12-1" }]);
  ok("new_gd_filled: a new delivery takes its first SO's header custom fields (false kept)");

  c = await run({ isAdd: false });
  assert.deepStrictEqual(c.cf, []);
  ok("edit_keeps: a stored delivery is not refilled");

  c = await run({ current: { lsh_restday: "Mon" } });
  assert.deepStrictEqual(c.cf, []);
  ok("user_value_kept: values already in the box are not overwritten");

  c = await run({ current: { lsh_envelope: false } });
  assert.deepStrictEqual(c.cf, []);
  ok("false_is_a_value: {lsh_envelope:false} is not an empty box");

  c = await run({});
  assert.deepStrictEqual(c.reads, ["sales_order"]);
  ok("no_second_fetch: still one SO read");

  c = await run({ soIds: [] });
  assert.deepStrictEqual(c.cf, []);
  ok("no SO picked: the header custom fields are left alone");
  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
