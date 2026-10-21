// consumer_sim.js <tenant> [event_id]: GD_PICKING_OUTBOX_CONSUMER as in the repo (Goods Delivery/AsyncV2/) on the workflow interpreter, its
// SQL run READ-ONLY on live dev, the Picking Setup read live, the other reads empty (Picking Format, internal trading, a targeted
// Picking), the writes and calls captured - nothing is written. No event_id = the POLL mode (the tenant's earliest due event).
const cp = require("child_process");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [tenant, eventId] = process.argv.slice(2);
if (!/^[0-9]+$/.test(tenant || "")) { console.error("usage: consumer_sim.js <tenant> [event_id]"); process.exit(2); }
const live = (sql) => JSON.parse(cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", sql], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const writes = [], calls = [];
const db = {
  tenantId: tenant,
  insert(table, rows) { writes.push(["add", table, rows]); return rows.map((r, i) => Object.assign({ id: "990000000000000" + i }, r)); },
  update(table, rows) { writes.push(["update", table, rows]); return rows.length; },
};
// the read-backs see the captured writes, as they would after a real write
const merged = (table, row) => Object.assign({}, row, ...writes.filter((w) => w[0] === "update" && w[1] === table).flatMap((w) => w[2]).filter((u) => String(u.id) === String(row.id)));
const consAdded = () => writes.filter((w) => w[0] === "add" && w[1] === "GD Event Consumption").flatMap((w) => w[2]).filter((c) => c.consumer_name === "GD_PICKING_OUTBOX_CONSUMER")
  .map((c, i) => Object.assign({ id: "980000000000000" + i, is_deleted: 0, error_code: "" }, c));
const sql = new Proxy({}, { get: (_, id) => (text) => {
  const rows = live(text);
  if (id === "sql_node_x1szzWtA") return rows.map((r) => merged("GD Outbox", r));
  if (id === "sql_node_nZiAGN1o") return rows.map((r) => merged("GD Async Job", r));
  if (id === "sql_node_AYKZAYQh" || id === "sql_node_53yZO25y") return rows.concat(consAdded()).map((r) => merged("GD Event Consumption", r));
  if (id === "sql_node_ZLm0SK0a") return rows.map((r) => {
    const o = merged("GD Outbox", r);
    const c = consAdded().map((x) => merged("GD Event Consumption", x))[0];
    const jobUpd = writes.filter((w) => w[0] === "update" && w[1] === "GD Async Job").flatMap((w) => w[2]).pop();
    return Object.assign(o, c ? { consumption_status: c.consumption_status, target_type: c.target_type, target_id: c.target_id, target_no: c.target_no } : {},
      jobUpd ? { job_status: jobUpd.job_status, picking_id: jobUpd.picking_id || r.picking_id, picking_no: jobUpd.picking_no || r.picking_no } : {});
  });
  return rows;
} });
const read = {
  get_node_pGRymwk1: (org) => {
    const rows = live("SELECT * FROM picking_setup WHERE tenant_id = '" + tenant + "' AND organization_id = '" + String(org).replace(/[^0-9]/g, "") + "' AND is_deleted = 0 ORDER BY id LIMIT 1");
    return rows.length ? { count: 1, data: rows[0] } : { count: 0, data: {} };
  },
  get_node_C45QoZpn: () => ({ count: 0, data: {} }),
  search_node_BKOU1jB9: () => ({ total: 0, count: 0, data: [] }),
  get_node_A56TxsP5: () => ({ count: 0, data: {} }),
};
const e = new Engine({ dir: process.env.CONSUMER_DIR || R + "Goods Delivery/AsyncV2", db: db, mocks: { sql: sql, read: read } });
const run0 = e.run.bind(e);
e.run = (name, p) => {
  if (name === "GD_PICKING_OUTBOX_CONSUMER") return run0(name, p);
  calls.push([name, p]);
  return { returned: { code: "200" }, ctx: {} };
};
const quiet = console.log;
const logs = [];
console.log = (...a) => logs.push(a.join(" "));
let out;
try {
  out = e.run("GD_PICKING_OUTBOX_CONSUMER", { event_id: eventId || "" });
} finally {
  console.log = quiet;
}
const plan = logs.filter((l) => /^consumer plan|^consumer pick|^consumer post/.test(l));
console.log((eventId || "POLL") + " -> " + JSON.stringify(out.returned).slice(0, 400));
for (const l of plan) console.log("  " + l.slice(0, 400));
for (const w of writes) console.log("  WRITE " + w[0] + " " + w[1] + " " + JSON.stringify(w[2]).slice(0, 300));
for (const c of calls) console.log("  CALL " + c[0]);
