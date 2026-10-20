// test_commit_lease.js: pre-cut lease fix (bladexfunctions-af, 2026-10-20). The engine resumes a second run of the same
// operation as if the first had died, so a COMMIT must not be taken over while it may still be applying stock: the COMMIT
// job reads stamp a 30-minute lease; the workers' own 10-minute claim, and their poll on an expired lease, stay as they are.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const nodes = (f) => { const out = []; const w = (l) => { for (const x of l || []) { out.push(x); w(x.blocks); } }; w(JSON.parse(fs.readFileSync(R + f, "utf8")).nodes); return out; };
const code = (f, id) => { const n = nodes(f).filter((x) => x.id === id)[0]; assert.ok(n, f + " " + id); return n.data.script.code; };
const LEASE = (m) => "DATE_FORMAT(n.t + INTERVAL " + m + " MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until";
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0]); } };

// The user's call (10-20): GD Edit V2 only. Picking V2 stays at 10 until a re-check before its Picking write exists: a resumed
// COMMIT past P0 writes the Picking without one, and PICKING_LOOP takes a stale Picking lock over at 15 minutes.
for (const [f, id, m] of [["Goods Delivery/EditV2/GD_EDIT_COMMIT.json", "sql_node_GXjob", 30], ["Picking/AsyncV2/PICKING_BULK_COMMIT.json", "sql_node_PCjob", 10]]) {
  it(f + " " + id + ": the COMMIT lease is " + m + " minutes", () => {
    const c = code(f, id);
    assert.ok(c.indexOf(LEASE(m)) >= 0 && c.indexOf(LEASE(m === 30 ? 10 : 30)) < 0, "lease_until is not now + " + m + " min");
  });
  if (m === 10) continue;
  it(f + ": no other node stamps a 10-minute lease", () => {
    for (const x of nodes(f)) {
      const c = ((x.data || {}).script || {}).code || "";
      assert.ok(c.indexOf("INTERVAL 10 MINUTE") < 0, x.id);
    }
  });
}
for (const [f, poll, tick] of [["Goods Delivery/EditV2/GD_EDIT_WORKER.json", null, null], ["Picking/AsyncV2/PICKING_ASYNC_WORKER.json", "sql_node_PWpoll", "sql_node_PWtick"]]) {
  it(f + ": the worker still claims for 10 minutes and polls only expired leases", () => {
    const all = nodes(f).map((x) => ((x.data || {}).script || {}).code || "").join("\n");
    assert.ok(all.indexOf(LEASE(10)) >= 0, "worker claim lease");
    assert.ok(all.indexOf("(j.lease_expires_at IS NULL OR j.lease_expires_at <= NOW(3))") >= 0, "poll respects the job's lease");
  });
}
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
