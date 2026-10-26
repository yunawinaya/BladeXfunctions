// test_p4_sibling.js [PICKING_BULK_COMMIT.json]: P4's check, run from the workflow file as built. Two jobs of Pickings that share
// a GD (Full Picking) write that GD's header one after the other (10-25 PI-2610-3490). A header another job wrote from newer
// facts is right: it is not a mismatch. A header at neither our value nor the fresh roll-up still retries. Retry rows carry
// numbers (the job row's attempts / row_version reach the check as text). Exit 0 only if every case holds.
const fs = require("fs");
const file = process.argv[2] || __dirname + "/../../../Picking/AsyncV2/PICKING_BULK_COMMIT.json";
const w = JSON.parse(fs.readFileSync(file, "utf8"));
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const code = find(w, "code_node_PCp4check").data.script.code;
const holders = [...new Set(code.match(/\{\{[^}]+\}\}/g))];
const names = holders.map((_, i) => "__p" + i);
let body = code;
holders.forEach((h, i) => { body = body.split(h).join(names[i]); });
// the job row as PCentry declares it: every field a string
const entry = { jobId: "2114267570730307585", organizationId: "1996787068457861121", dbNow: "2026-10-25 08:07:29", attempts: "0", rowVersion: "2", leaseUntil: "2026-10-25 08:17:25" };
const guard = { jobId: entry.jobId, nonce: "n1" };
const check = (plan, back, e) => {
  const vals = { "code_node_PCguard": guard, "code_node_PCentry": e || entry, "code_node_PCp4plan": plan, "sql_node_PCp4back": back };
  const arg = (h) => vals[Object.keys(vals).find((k) => h.indexOf(k) >= 0)];
  return new Function("console", ...names, body)({ log: () => {} }, ...holders.map((h) => JSON.parse(JSON.stringify(arg(h)))));
};
const H = (gd, ps) => ({ kind: "H", gd_id: gd, id: gd, material_id: "", item_bundle_id: "", picking_status: ps, gd_qty: "", gd_status: "Created" });
const L = (gd, id, ps) => ({ kind: "L", gd_id: gd, id: id, material_id: "9" + id, item_bundle_id: "", picking_status: ps, gd_qty: "5.00000000", gd_status: "" });
const A = "2114265952626544641", B = "2114266543704641538";
const plan = { rows: [{ id: A, picking_status: "In Progress" }, { id: B, picking_status: "In Progress" }], result_message: A + ": Created -> In Progress, " + B + ": Created -> In Progress" };
const cases = [
  ["our values read back", check(plan, [H(A, "In Progress"), L(A, "1", "Completed"), L(A, "2", "Created"), H(B, "In Progress"), L(B, "3", "Completed"), L(B, "4", "Created")]).route, "SPLIT"],
  ["a sibling wrote B Completed from newer facts (10-25)", check(plan, [H(A, "In Progress"), L(A, "1", "Completed"), L(A, "2", "Created"), H(B, "Completed"), L(B, "3", "Completed"), L(B, "4", "Completed")]).route, "SPLIT"],
  ["a sibling wrote B from stale facts (lines all Completed, header Created)", check({ rows: [{ id: B, picking_status: "Completed" }] }, [H(B, "Created"), L(B, "3", "Completed"), L(B, "4", "Completed")]).result_code, "PK_STEP_RETRY"],
  ["our write did not land (header still Created, fresh roll-up In Progress)", check({ rows: [{ id: A, picking_status: "In Progress" }] }, [H(A, "Created"), L(A, "1", "Completed"), L(A, "2", "Created")]).result_code, "PK_STEP_RETRY"],
];
const retry = check({ rows: [{ id: A, picking_status: "In Progress" }] }, [H(A, "Created"), L(A, "1", "Completed"), L(A, "2", "Created")], Object.assign({}, entry, { attempts: "1" }));
const row = (retry.jobRows || [])[0] || {};
cases.push(["a retry row carries numbers (attempts 1 -> 2, row_version 2 -> 4)", JSON.stringify([row.attempt_count, row.row_version]), JSON.stringify([2, 4])]);
let ok = true;
for (const [name, got, want] of cases) { const pass = got === want; ok = ok && pass; console.log((pass ? "ok   " : "FAIL ") + name + ": " + got); }
console.log(ok ? cases.length + "/" + cases.length + " passed" : "p4 sibling test FAILED");
process.exit(ok ? 0 : 1);
