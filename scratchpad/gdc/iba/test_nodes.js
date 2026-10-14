// node test_nodes.js — runs the INVENTORY_BULK_APPLY code-node bodies the way the platform does (placeholders replaced by
// JSON text, the body run as a function) on mock reads: PLAN, a fresh APPLY, a resume after a half-written run, a busy lock.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const CODE = path.join(__dirname, "code");
function body(file, subs) {
  let src = fs.readFileSync(path.join(CODE, file), "utf8");
  src = src
    .split("\n")
    .map((l) => {
      const m = l.trim().match(/^\/\/@include (.+)$/);
      if (!m) return l;
      return fs
        .readFileSync(path.join(CODE, m[1]), "utf8")
        .split("\n")
        .filter((x) => !x.startsWith("if (typeof module"))
        .join("\n");
    })
    .join("\n");
  for (const [k, v] of Object.entries(subs || {})) src = src.split(k).join(v);
  return src;
}
function getPath(o, parts) {
  let c = o;
  for (const p of parts) c = c === undefined || c === null ? undefined : c[p];
  return c;
}
function run(file, ctx, subs) {
  const src = body(file, subs).replace(/\{\{(node|workflowparams|system):([^}]+)\}\}/g, (all, kind, ref) => {
    let v;
    if (kind === "workflowparams") v = getPath(ctx.params, ref.split("."));
    else if (kind === "system") v = ctx.system[ref];
    else {
      const parts = ref.split(".");
      const out = ctx.nodes[parts[0]];
      v = out === undefined ? undefined : getPath({ data: out }, parts.slice(1));
    }
    return v === undefined ? "null" : JSON.stringify(v);
  });
  return Function(src)();
}

const ORG = "2105190589240086530";
const PLANT = "2105200506810306561";
const OP = "GDC|9001";
const mv = (k, mat, loc, qty, extra) =>
  Object.assign({ movement_key: k, direction: "SUBTRACT", plant_id: PLANT, organization_id: ORG, material_id: mat, quantity: qty, material_uom: "11", location_id: loc, inventory_category: "Reserved", transaction_type: "GDL", trx_no: "GD/T/1", parent_trx_no: "SO/T/1", doc_date: "2026-10-13 00:00:00", isMovingInv: 0, handling_unit_id: "" }, extra || {});
const movements = [
  mv("L1", "501", "901", 3),
  mv("L2", "501", "901", 4),
  mv("L3", "502", "902", 2, { batch_id: "701" }),
  mv("R1", "503", "903", 1, { isMovingInv: 1 }),
  Object.assign(mv("R2", "503", "903", 1, { isMovingInv: 1, direction: "ADD", inventory_category: "Unrestricted" }), { unit_price_from: "R1" }),
];
const items = [
  { id: "501", stock_control: "1", based_uom: "11", material_costing_method: "First In First Out", purchase_unit_price: "0.00000000", item_batch_management: "0", uom_conversion_json: '[{"alt_uom_id":"11","base_qty":1}]' },
  { id: "502", stock_control: "1", based_uom: "11", material_costing_method: "Weighted Average", purchase_unit_price: "0", item_batch_management: "1", uom_conversion_json: "[]" },
  { id: "503", stock_control: "1", based_uom: "11", material_costing_method: "Fixed Cost", purchase_unit_price: "2.50000000", item_batch_management: "0", uom_conversion_json: "[]" },
];
const balRow = (id, mat, loc, r, u) => ({ id, material_id: mat, location_id: loc, plant_id: PLANT, organization_id: ORG, unrestricted_qty: String(u || 0), reserved_qty: String(r), block_qty: "0", qualityinsp_qty: "0", intransit_qty: "0", balance_quantity: String(r + (u || 0)) });
const reads0 = () => ({
  bal: [balRow("1001", "501", "901", 10), balRow("1002", "502", "902", 5), balRow("1003", "503", "903", 2, 1)],
  batch: [Object.assign(balRow("2001", "502", "902", 5), { batch_id: "701", manufacturing_date: "2026-07-13 00:00:00", expired_date: null, remark: "keep me", remark2: null, remark3: null })],
  fifo: [
    { id: "3001", material_id: "501", plant_id: PLANT, organization_id: ORG, batch_id: "0", fifo_sequence: "1", fifo_cost_price: "2", fifo_initial_quantity: "4", fifo_available_quantity: "4" },
    { id: "3002", material_id: "501", plant_id: PLANT, organization_id: ORG, batch_id: "0", fifo_sequence: "2", fifo_cost_price: "3", fifo_initial_quantity: "9", fifo_available_quantity: "9" },
  ],
  wa: [{ id: "4001", material_id: "502", plant_id: PLANT, organization_id: ORG, batch_id: "701", wa_quantity: "5", wa_cost_price: "1.5", created_at: "2026-01-01 00:00:00" }],
});

function chain(params, steps, reads, lockRows, mvRows) {
  const ctx = { params, system: { tenantId: "711077", uuid: "a1b2c3d4-e5f6-0000-0000-000000000000" }, nodes: {} };
  ctx.nodes.code_node_IBguard = run("guard.js", ctx);
  if (ctx.nodes.code_node_IBguard.route === "REJECT") return { ctx, end: "REJECT" };
  ctx.nodes.sql_node_IBops = steps.length ? steps : [{ db_now: "2026-10-13 10:00:00" }];
  ctx.nodes.code_node_IBstate = run("state.js", ctx);
  if (ctx.nodes.code_node_IBstate.route !== "PLAN") {
    ctx.nodes.sql_node_IBlk1 = lockRows;
    ctx.nodes.code_node_IBseed = run("lock_seed.js", ctx);
    const seeded = lockRows.concat(ctx.nodes.code_node_IBseed.rowsToAdd.map((r, i) => Object.assign({ id: String(5000 + i), is_deleted: 0, db_now: "2026-10-13 10:00:01" }, r)));
    ctx.nodes.sql_node_IBlk2 = seeded.map((r) => Object.assign({}, r, { db_now: "2026-10-13 10:00:01" }));
    ctx.nodes.code_node_IBclaim = run("lock_claim.js", ctx);
    if (ctx.nodes.code_node_IBclaim.route === "BUSY") return { ctx, end: "BUSY" };
    const op = ctx.nodes.code_node_IBguard.operationKey;
    ctx.nodes.sql_node_IBlk3 = seeded.map((r) => Object.assign({}, r, { free_token: 0, owner_operation_id: op }));
    ctx.nodes.code_node_IBlkv = run("lock_verify.js", ctx);
  }
  ctx.nodes.sql_node_IBitems = items;
  ctx.nodes.sql_node_IBbal = reads.bal;
  ctx.nodes.sql_node_IBbatch = reads.batch;
  ctx.nodes.sql_node_IBfifo = reads.fifo;
  ctx.nodes.sql_node_IBwa = reads.wa;
  if (ctx.nodes.code_node_IBstate.route === "RESUME") ctx.nodes.sql_node_IBmv = mvRows || [];
  ctx.nodes.code_node_IBplan = run("plan.js", ctx);
  return { ctx };
}
// what the write loops would leave in the tables (slices run through slice.tpl.js, as the loop does)
function applyWrites(ctx, reads, onlySlices) {
  const plan = ctx.nodes.code_node_IBplan;
  const out = JSON.parse(JSON.stringify(reads));
  const tables = { ib: "bal", bb: "batch", bbr: "batch", ff: "fifo", wa: "wa" };
  const written = { mv: [] };
  for (const key of ["ib", "bb", "bbr", "ff", "wa", "mv"]) {
    const slices = plan[key + "Slices"] || [];
    let idx = "0";
    for (let i = 0; i < slices.length; i++) {
      if (onlySlices && onlySlices[key] !== undefined && i >= onlySlices[key]) break;
      ctx.nodes["get_cache_x"] = idx;
      const sl = run("slice.tpl.js", ctx, { __LIST__: key, __SRC__: "code_node_IBplan", __IDX__: "get_cache_x" });
      for (const r of sl.rows) {
        if (key === "mv") written.mv.push(r);
        else {
          const row = out[tables[key]].find((x) => x.id === r.id);
          Object.assign(row, r);
        }
      }
      idx = sl.nextIndex;
    }
  }
  return { tables: out, movements: written.mv };
}

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log("ok", name);
};

t("guard refuses a bad request and a new batch", () => {
  assert.strictEqual(chain({ operation_key: "bad key!", mode: "APPLY", organization_id: ORG, movements }, [], reads0(), []).end, "REJECT");
  const nb = [Object.assign(mv("A", "501", "901", 1, { direction: "ADD" }), { batch_number: "NEW-1" })];
  const r = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements: nb }, [], reads0(), []);
  assert.strictEqual(r.ctx.nodes.code_node_IBguard.result_code, "UNSUPPORTED_NEW_BATCH");
});

t("PLAN: per-movement prices, nothing to write, no locks", () => {
  const { ctx } = chain({ operation_key: OP, mode: "PLAN", organization_id: ORG, movements }, [], reads0(), []);
  const p = ctx.nodes.code_node_IBplan;
  assert.strictEqual(p.route, "PLAN_OK", JSON.stringify(p).slice(0, 300));
  assert.strictEqual(p.code, "200");
  assert.deepStrictEqual(p.results.map((r) => r.unit_price), [2, 2.75, 1.5, 2.5, 2.5]);
  assert.strictEqual(ctx.nodes.code_node_IBclaim, undefined);
});

let fresh;
t("APPLY fresh: intent, sliced writes, read-back DONE, locks given back", () => {
  const reads = reads0();
  const { ctx } = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements }, [], reads, []);
  const p = ctx.nodes.code_node_IBplan;
  assert.strictEqual(ctx.nodes.code_node_IBclaim.route, "TAKE");
  assert.strictEqual(ctx.nodes.code_node_IBguard.lockKeys.join(","), "BATCH|502|902|701,ITEM|501|901,ITEM|502|902,ITEM|503|903");
  assert.strictEqual(p.route, "WRITE", JSON.stringify(p).slice(0, 300));
  assert.strictEqual(p.needIntent, "YES");
  assert.strictEqual(p.bb.length, 1); // SUBTRACT-only batch row: no remark columns
  assert.ok(!("remark" in p.bb[0]));
  assert.strictEqual(p.ib.find((r) => r.id === "1001").reserved_qty, "3");
  assert.strictEqual(p.ib.find((r) => r.id === "1003").unrestricted_qty, "2");
  assert.strictEqual(p.mv.length, 5);
  assert.strictEqual(p.mv[0].unit_price, "2");
  const w = applyWrites(ctx, reads);
  ctx.nodes.sql_node_IBbalB = w.tables.bal;
  ctx.nodes.sql_node_IBbatchB = w.tables.batch;
  ctx.nodes.sql_node_IBfifoB = w.tables.fifo;
  ctx.nodes.sql_node_IBwaB = w.tables.wa;
  ctx.nodes.sql_node_IBmvB = w.movements.map((m) => ({ operation_effect_key: m.operation_effect_key }));
  ctx.nodes.code_node_IBverify = run("verify.js", ctx);
  assert.strictEqual(ctx.nodes.code_node_IBverify.route, "DONE", ctx.nodes.code_node_IBverify.problems);
  ctx.nodes.code_node_IBdone = run("done_row.js", ctx);
  assert.strictEqual(ctx.nodes.code_node_IBdone.rows[0].step_name, "IBA|DONE");
  ctx.nodes.code_node_IBend = run("end.js", ctx);
  assert.strictEqual(ctx.nodes.code_node_IBend.code, "200");
  assert.strictEqual(ctx.nodes.code_node_IBend.release, "YES");
  assert.strictEqual(w.tables.batch[0].remark, "keep me");
  fresh = { ctx, reads, w };
});

t("REPLAY: a DONE operation answers its stored result", () => {
  const done = fresh.ctx.nodes.code_node_IBdone.rows[0];
  const { ctx } = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements }, [Object.assign({ db_now: "x" }, done)], reads0(), []);
  assert.strictEqual(ctx.nodes.code_node_IBstate.route, "REPLAY");
  assert.strictEqual(ctx.nodes.code_node_IBstate.storedResults.length, 5);
});

t("RESUME after a run died mid-way: only what is left is written, then DONE", () => {
  // the first run stored its intent, wrote item_balance only, and two movements, then died holding its locks
  const intent = fresh.ctx.nodes.code_node_IBplan.intentRows.map((r) => Object.assign({ db_now: "2026-10-13 10:05:00" }, r));
  const reads = reads0();
  const half = applyWrites(fresh.ctx, reads, { bb: 0, bbr: 0, ff: 0, wa: 0, mv: 0 });
  const op = OP;
  const lockRows = ["BATCH|502|902|701", "ITEM|501|901", "ITEM|502|902", "ITEM|503903"].map((k, i) => ({ id: String(6000 + i), lock_key: k, free_token: 0, owner_operation_id: op, is_deleted: 0, lock_version: 1, db_now: "2026-10-13 10:05:00" }));
  lockRows[3].lock_key = "ITEM|503|903";
  const { ctx } = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements }, intent, half.tables, lockRows, [{ operation_effect_key: OP + "|L1" }, { operation_effect_key: OP + "|L2" }]);
  assert.strictEqual(ctx.nodes.code_node_IBstate.route, "RESUME");
  assert.strictEqual(ctx.nodes.code_node_IBclaim.route, "HELD");
  const p = ctx.nodes.code_node_IBplan;
  assert.strictEqual(p.route, "WRITE", p.result_message);
  assert.strictEqual(p.needIntent, "NO");
  assert.strictEqual(p.ib.length, 0);
  assert.strictEqual(p.ff.length, 2);
  assert.strictEqual(p.mv.length, 3);
});

t("RESUME refuses a row someone else changed under the plan", () => {
  const intent = fresh.ctx.nodes.code_node_IBplan.intentRows.map((r) => Object.assign({ db_now: "x" }, r));
  const reads = reads0();
  reads.bal[0].reserved_qty = "9"; // neither before (10) nor after (3)
  const lockRows = ["BATCH|502|902|701", "ITEM|501|901", "ITEM|502|902", "ITEM|503|903"].map((k, i) => ({ id: String(6000 + i), lock_key: k, free_token: 0, owner_operation_id: OP, is_deleted: 0, lock_version: 1, db_now: "x" }));
  const { ctx } = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements }, intent, reads, lockRows, []);
  assert.strictEqual(ctx.nodes.code_node_IBplan.route, "REVIEW");
  ctx.nodes.code_node_IBend = run("end.js", ctx);
  assert.strictEqual(ctx.nodes.code_node_IBend.release, "NO");
});

t("BUSY: a key another operation holds stops before any take", () => {
  const lockRows = [{ id: "7000", lock_key: "ITEM|501|901", free_token: 0, owner_operation_id: "GD|123|1", is_deleted: 0, lock_version: 3 }];
  const r = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements }, [], reads0(), lockRows);
  assert.strictEqual(r.end, "BUSY");
});

t("FAIL under APPLY: nothing written, locks given back", () => {
  const reads = reads0();
  reads.bal[0].reserved_qty = "5";
  const { ctx } = chain({ operation_key: OP, mode: "APPLY", organization_id: ORG, movements }, [], reads, []);
  assert.strictEqual(ctx.nodes.code_node_IBplan.route, "FAIL");
  ctx.nodes.code_node_IBend = run("end.js", ctx);
  assert.strictEqual(ctx.nodes.code_node_IBend.code, "400");
  assert.strictEqual(ctx.nodes.code_node_IBend.release, "YES");
});

t("release plan clears only this operation's rows", () => {
  const ctx = { params: {}, system: {}, nodes: { code_node_IBguard: { operationKey: OP } } };
  ctx.nodes.sql_node_IBrel = [
    { id: "1", lock_key: "ITEM|1|1", free_token: 0, owner_operation_id: OP, lock_version: 4, db_now: "2026-10-13 10:09:00" },
    { id: "2", lock_key: "ITEM|1|2", free_token: 0, owner_operation_id: "GD|9|1", lock_version: 1 },
    { id: "3", lock_key: "ITEM|1|3", free_token: 1, owner_operation_id: "", lock_version: 1 },
  ];
  const r = run("release.js", ctx);
  assert.deepStrictEqual(r.plusIds, ["1"]);
  assert.strictEqual(r.clearRows[0].lock_version, 5);
  assert.strictEqual(r.clearRows[0].last_owner_operation_id, OP);
});

console.log(n + " passed");
