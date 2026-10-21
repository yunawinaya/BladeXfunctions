// r0_live.js <plan.json>: GD_REVERT_COMMIT's R0 read (the built sql_node_RCr0rows) on dev, read-only, with the ids of a live plan
// (test/plan_live.js --out), then R0's comparison (rstep.js rvRevalidate) on what it returns: every row PREPARE planned must compare
// equal to its before-values, type for type. plan_live fakes the lock (Processing), so the GD row itself is the one expected conflict.
const fs = require("fs"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const P = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const m = P.manifest;
const wf = JSON.parse(fs.readFileSync(R + "Goods Delivery/RevertV2/GD_REVERT_COMMIT.json", "utf8"));
const find = (n, id) => { if (!n || typeof n !== "object") return null; if (n.id === id) return n; for (const v of Object.values(n)) { const f = find(v, id); if (f) return f; } return null; };
const sqlOf = (node) => { let best = ""; const walk = (v) => { if (typeof v === "string" && /\bSELECT\b/.test(v) && v.length > best.length) best = v; else if (v && typeof v === "object") Object.values(v).forEach(walk); }; walk(node.data); return best; };
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
for (const f of ["_common.js", "_cmp.js", "_rows.js", "rstep.js"]) vm.runInContext(fs.readFileSync(__dirname + "/../code/commit/" + f, "utf8"), sb);
const entry = { jobId: m.job_id, organizationId: m.organization_id, gdId: m.gd_id, partPrefix: "P|" + m.nonce + "|", unlockOk: "YES", siStatus: "", dbNow: "2026-10-21 10:00:00", jsAt: "0", attempts: 0, rowVersion: 3 };
const partRows = P.result.partRows.map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
const ids = vm.runInContext("rvIds", sb)(entry, partRows, ["res", "frag", "pend", "gdl", "snap", "gdh"]);
const tenant = JSON.parse(execFileSync(R + ".dbtools/db", ["--dev", "--json", "SELECT tenant_id FROM goods_delivery WHERE id = " + m.gd_id], { encoding: "utf8" }).replace(/^[^\[]*/, ""))[0].tenant_id;
const sql = sqlOf(find(wf, "sql_node_RCr0rows")).replace(/\{\{([^}]+)\}\}/g, (_, ref) => (ref.endsWith("tenantId") ? tenant : ids[ref.split(".").pop()]));
const out = execFileSync(R + ".dbtools/db", ["--dev", "--json", sql], { encoding: "utf8" });
const rows = JSON.parse(out.slice(out.indexOf("[")));
console.log("R0 read on dev:", rows.length, "row(s):", rows.map((r) => r.k).join(", "));
const res = vm.runInContext("rvRevalidate", sb)(entry, partRows, rows);
console.log("R0:", res.route, res.result_code || "", res.result_message);
// only the GD row differs (plan_live showed it Processing; on dev it is Completed)
assert.strictEqual(res.result_code, "GDR_STALE", "expected the faked lock to be the only conflict");
assert.ok(/^1 row\(s\) changed/.test(res.result_message) && /gdh /.test(res.result_message), res.result_message);
console.log("every other planned row compares equal to what COMMIT reads now");
