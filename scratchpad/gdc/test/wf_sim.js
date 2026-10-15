// wf_sim.js <NAME> <tenant> '<params json>': a built CompleteV2 workflow on the interpreter, its SQL run READ-ONLY on live
// dev, sub-workflows not run (answered {}), writes captured and printed (nothing is written)
const cp = require("child_process");
const { Engine } = require("../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [name, tenant, paramsJson] = process.argv.slice(2);
const writes = [];
const db = { tenantId: tenant, insert(t, rows) { writes.push(["add", t, rows]); return rows; }, update(t, rows) { writes.push(["update", t, rows]); return rows.length; } };
const sql = new Proxy({}, { get: (_, id) => (text) => JSON.parse(cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", text], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) });
const e = new Engine({ dir: R + (process.env.WF_DIR || "Goods Delivery/CompleteV2"), db, mocks: { sql, read: {} } });
const run0 = e.run.bind(e);
e.run = (n, p) => (n.startsWith("GD_COMPLETE_") && n !== name ? (writes.push(["call", n, p]), { returned: {}, ctx: {} }) : n === name ? run0(n, p) : (writes.push(["call", n, p]), { returned: {}, ctx: {} }));
const out = e.run(name, JSON.parse(paramsJson));
console.log(name, "->", JSON.stringify(out.returned).slice(0, 500));
console.log("  ran:", e.trace.map((t) => t.split(" ")[1]).join(" ").slice(0, 900));
for (const w of writes) console.log("  ", w[0], w[1], JSON.stringify(w[2]).slice(0, 200));
