// replay_engine_precision.js: re-runs INVENTORY_APPLY_OPERATION code nodes on the node outputs recorded by a real run, old
// (git HEAD) and new (working tree) code side by side. For the precision fix: GUB 900938 run 2114523131413663745 (10-26 09:02,
// GD-26/10/0528), whose movement check answered a false VERIFICATION_MISMATCH.
// usage: node replay_engine_precision.js <dir of `wf --prod trace <run> --node <id>` outputs, one <id>.txt per node>
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { execFileSync } = require("child_process");

const dir = process.argv[2];
if (!dir) throw new Error("usage: node replay_engine_precision.js <trace dir>");
const REPO = path.join(__dirname, "..", "..", "..", "..");
const FILE = "Goods Delivery/AsyncV2/INVENTORY_APPLY_OPERATION.json";
const find = (o, id) => {
  if (Array.isArray(o)) {
    for (const v of o) {
      const r = find(v, id);
      if (r) return r;
    }
  } else if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) {
      const r = find(v, id);
      if (r) return r;
    }
  }
  return null;
};
const docs = {
  old: JSON.parse(execFileSync("git", ["show", "HEAD:" + FILE], { cwd: REPO, maxBuffer: 1 << 28 }).toString()),
  new: JSON.parse(fs.readFileSync(path.join(REPO, FILE), "utf8")),
};
const recorded = (id) => {
  const t = fs.readFileSync(path.join(dir, id + ".txt"), "utf8");
  const i = t.indexOf("\n", t.indexOf("### "));
  return JSON.parse(t.slice(i + 1));
};
// bind every {{node:X.data[.key]}} to the recorded output of X (override: a function of it), then run the node body
const run = (version, id, override) => {
  const code = find(docs[version], id).data.script.code.replace(/\{\{node:([A-Za-z0-9_]+)\.data(?:\.([A-Za-z0-9_]+))?\}\}/g, (m, src, key) => {
    let v = recorded(src);
    if (override && override[src]) v = override[src](JSON.parse(JSON.stringify(v)));
    return JSON.stringify(key ? v[key] : v);
  });
  const log = console.log;
  console.log = () => {};
  try {
    return new Function(code)();
  } finally {
    console.log = log;
  }
};
const RULES = "1:Inventory Price:::4:1:0;1:Inventory Qty:::3:1:0"; // GUB's su_code_num_precision rows (prod, read 10-26)
const withScale = (scale) => ({ code_node_8rCPo75P: (o) => Object.assign(o, { plan: Object.assign(o.plan, { scale: scale }) }) });
// the platform leaves null values out of a node's recorded output: compare without them
const bare = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === null ? undefined : v)));
let n = 0;
const ok = (name, got, want) => {
  assert.deepStrictEqual(got, want, name + ": got " + JSON.stringify(got).slice(0, 400));
  n++;
  console.log("  ok " + name);
};

// 1. the replay reproduces the platform: old Revalidate = the recorded output, old movement check = the recorded REVIEW
const rvOld = run("old", "code_node_8rCPo75P");
ok("old Revalidate reproduces the recorded output", bare(rvOld), recorded("code_node_8rCPo75P"));
const mvOld = run("old", "code_node_Pf6NFe7B");
ok("old movement check reproduces the recorded REVIEW", bare(mvOld), recorded("code_node_Pf6NFe7B"));

// 2. new Revalidate with the new balance read (num_rules on its rows): the same output plus plan.scale (also stored)
const rvNew = run("new", "code_node_8rCPo75P", { sql_node_e7OzTOyD: (rows) => rows.map((r) => Object.assign(r, { num_rules: RULES })) });
const scale = { price: { dp: 4, rule: "1" }, qty: { dp: 3, rule: "1" }, columns: {} };
ok("new Revalidate plan.scale", rvNew.plan.scale, scale);
const stored = JSON.parse(rvNew.planRows[0].review_reason);
ok("new Revalidate stores the scale in the mutation plan", stored.mutation_plan.scale, scale);
const strip = (o) => {
  const c = JSON.parse(JSON.stringify(o));
  delete c.plan.scale;
  const j = JSON.parse(c.planRows[0].review_reason);
  delete j.mutation_plan.scale;
  c.planRows[0].review_reason = JSON.stringify(j);
  return c;
};
const canon = (o) => {
  const c = JSON.parse(JSON.stringify(o));
  c.planRows[0].review_reason = JSON.stringify(JSON.parse(c.planRows[0].review_reason));
  return c;
};
ok("new Revalidate otherwise identical (balances, movements, effects, gate, route)", bare(strip(rvNew)), canon(recorded("code_node_8rCPo75P")));
const rvNone = run("new", "code_node_8rCPo75P", { sql_node_e7OzTOyD: (rows) => rows.map((r) => Object.assign(r, { num_rules: "" })) });
ok("new Revalidate, no rule configured: scale nulls", rvNone.plan.scale, { price: null, qty: null, columns: {} });

// 3. the movement check: the GUB rows now verify
const mvNew = run("new", "code_node_Pf6NFe7B", withScale(scale));
ok("new movement check on GUB's stored rows: OK", mvNew.route, "OK");
ok("new movement check: both movement ids", Object.values(mvNew.movementIds).filter(Boolean).sort(), ["2114523147138109442", "2114523147138109443"]);
ok("new movement check, a plan stored before the fix (no scale): OK", run("new", "code_node_Pf6NFe7B").route, "OK");
ok("new movement check, rule not configured (exact): REVIEW as before", run("new", "code_node_Pf6NFe7B", withScale({ price: null, qty: null })).route, "REVIEW");
const wrong = run("new", "code_node_Pf6NFe7B", Object.assign(withScale(scale), { sql_node_gf5rUccM: (rows) => rows.map((r) => Object.assign(r, { unit_price: "99.93680000" })) }));
ok("new movement check, a stored price off by one step: REVIEW", wrong.route, "REVIEW");
ok("new movement check, the diff names unit_price", wrong.problems[0].diffs.map((d) => d.column), ["unit_price"]);

// 4. the balance and pre-write checks of the same run answer as recorded (both OK there)
for (const id of ["code_node_p0sOD8ej", "code_node_FyT3zuFi"]) {
  ok(id + " new = recorded", bare(run("new", id, withScale(scale))), recorded(id));
  ok(id + " old = recorded", bare(run("old", id)), recorded(id));
}
console.log("replay_engine_precision: " + n + " pass");
