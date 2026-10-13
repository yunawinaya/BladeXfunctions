// Runs Goods Delivery/GDhandleConvertSOtoGD.js (the SO list's func_handleConvertGD) against a fake page:
// batches, a batch with no answer, a setup gate, and a second click while a batch runs.
// usage: node test_convert_client.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "Goods Delivery", "GDhandleConvertSOtoGD.js"), "utf8");

const sos = (n) => Array.from({ length: n }, (_, i) => ({ id: String(1000 + i), so_no: `SO-${i + 1}`, customer_name: { id: "c" } }));

const page = (answer) => {
  const ctx = {
    calls: [], loading: [], alerts: [], refreshed: 0,
    showLoading(t) { ctx.loading.push(t); },
    hideLoading() {},
    getVarGlobal: () => "tester",
    refresh: async () => { ctx.refreshed += 1; },
    runWorkflow(id, params, ok, fail) {
      ctx.calls.push(params.so_ids);
      const a = answer(params.so_ids, ctx.calls.length);
      setTimeout(() => (a.fail ? fail(a.fail) : ok({ data: a })), a.delay || 1);
    },
    $alert: async (msg, title) => { ctx.alerts.push({ msg, title }); },
    // the user picks "Multiple GDs"
    $confirm: async (msg, title, opts) => { await opts.beforeClose("cancel", {}, () => {}); },
  };
  return ctx;
};

const run = (ctx, records) => {
  global.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, convert_gd_created: 1 }] }) }) }) };
  new Function(SRC).call(ctx, { selectedRecords: records, plantID: "p", organizationID: "o" });
};

const settle = (ctx, n = 1) =>
  new Promise((resolve) => { const t = setInterval(() => { if (ctx.alerts.length >= n) { clearInterval(t); resolve(); } }, 2); });

(async () => {
  global.window = {};

  // 12 SOs: batch 1 converts 3 and blocks 2, batch 2 gets no answer, batch 3 converts both.
  let ctx = page((ids, call) =>
    call === 2 ? { fail: "Gateway Timeout" }
      : { code: "200", created: ids.slice(0, call === 1 ? 3 : 2).map((id) => ({ so_no: "SO" + id, delivery_no: "GD" + id })),
          blocked: call === 1 ? ids.slice(3).map((id) => ({ so_no: "SO" + id, reason: "Insufficient stock" })) : [] });
  run(ctx, sos(12));
  await settle(ctx);
  assert.deepStrictEqual(ctx.calls.map((c) => c.length), [5, 5, 2]);
  assert.deepStrictEqual(ctx.loading, [
    "Converting to Goods Delivery: 0 of 12 sales orders done...",
    "Converting to Goods Delivery: 5 of 12 sales orders done...",
    "Converting to Goods Delivery: 10 of 12 sales orders done..."]);
  assert.strictEqual(ctx.alerts[0].title, "Converted with Exceptions");
  assert.ok(ctx.alerts[0].msg.includes("Created 5 goods deliveries"));
  assert.ok(ctx.alerts[0].msg.includes("Not converted (7)"));
  assert.ok(ctx.alerts[0].msg.includes("SO-6 — No answer from the server"));
  assert.strictEqual(ctx.refreshed, 1);
  assert.strictEqual(window.__soConvertGdBusy, false);
  console.log("  12 SOs: 3 calls of 5/5/2, progress per batch, the unanswered batch listed, the rest converted");

  // A setup gate refuses the first batch: no second call, its message shown.
  ctx = page(() => ({ code: "400", message: "Cannot convert to Goods Delivery. Please check your picking setup." }));
  run(ctx, sos(12));
  await settle(ctx);
  assert.strictEqual(ctx.calls.length, 1);
  assert.strictEqual(ctx.alerts[0].title, "Could Not Convert to Goods Delivery");
  assert.ok(ctx.alerts[0].msg.startsWith("Cannot convert to Goods Delivery"));
  console.log("  setup gate: stops after the first call and shows its message");

  // A second click while the first batch runs is refused; the first finishes on its own.
  ctx = page((ids) => ({ code: "200", created: ids.map((id) => ({ so_no: "SO" + id, delivery_no: "GD" + id })), blocked: [], delay: 30 }));
  run(ctx, sos(7));
  await new Promise((r) => setTimeout(r, 5));
  run(ctx, sos(7));
  await settle(ctx, 2);
  assert.strictEqual(ctx.alerts[0].title, "Conversion Running");
  assert.strictEqual(ctx.alerts[1].title, "Converted to Goods Deliveries");
  assert.deepStrictEqual(ctx.calls.map((c) => c.length), [5, 2]);
  assert.strictEqual(window.__soConvertGdBusy, false);
  console.log("  second click while running: refused, the first conversion completes (2 calls)");

  // Up to 5 SOs: one call, the plain loading text.
  ctx = page((ids) => ({ code: "200", created: ids.map((id) => ({ so_no: "SO" + id, delivery_no: "GD" + id })), blocked: [] }));
  run(ctx, sos(3));
  await settle(ctx);
  assert.deepStrictEqual(ctx.loading, ["Converting to Goods Delivery..."]);
  assert.strictEqual(ctx.alerts[0].title, "Converted to Goods Deliveries");
  console.log("  3 SOs: one call, plain loading text");
  console.log("all passed");
})().catch((e) => { console.error(e); process.exit(1); });
