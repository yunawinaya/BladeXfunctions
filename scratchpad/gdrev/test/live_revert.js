// live_revert.js classic|v2 <tenant> <gd_id> <workdir>: one live revert on DEV (writes: only with the user's yes).
//   classic: GD_REVERT_COMPLETED with the GD list's request ({ allData, pageStatus: "Edit" }; allData = the stored GD in the get-node
//            shape, gdc's adapter); prints the answer.
//   v2:      GD_REVERT_SUBMIT (LIST) -> GD_REVERT_WORKER { job_id }, then follows the job (SQL, read-only) to a terminal state, starting
//            the worker again every 60 s while it is not. GD Cancel V2's live_cancel.js with the revert's names.
const fs = require("fs"), vm = require("vm"), cp = require("child_process"), path = require("path");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [mode, tenant, gdId, dir] = process.argv.slice(2);
if (!/^(classic|v2)$/.test(mode || "") || !/^[0-9]+$/.test(tenant || "") || !/^[0-9]+$/.test(gdId || "") || !dir) {
  console.error("usage: live_revert.js classic|v2 <tenant> <gd_id> <workdir>");
  process.exit(2);
}
const ID = R + "scratchpad/gdc/tools/id" + tenant + ".json";
const IDS = JSON.parse(fs.readFileSync(R + "Goods Delivery/RevertV2/ids.json", "utf8"));
const CLASSIC = "2058819647368241153";
const live = (sql) => { const t = cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", sql], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); return JSON.parse(t.slice(t.indexOf("["))); };
let n = 0;
const call = (wf, req, label) => {
  const f = path.join(dir, "lr_" + mode + "_" + gdId + "_" + (++n));
  fs.writeFileSync(f + ".req.json", JSON.stringify(req));
  const t0 = Date.now();
  cp.execFileSync("node", [R + "scratchpad/gdc/tools/runas.mjs", ID, wf, f + ".req.json", f + ".out.json"], { stdio: ["ignore", "ignore", "inherit"], timeout: 20 * 60000 });
  const out = JSON.parse(fs.readFileSync(f + ".out.json", "utf8"));
  const d = out.data === undefined ? out : out.data;
  console.log("  " + label + " (" + Math.round((Date.now() - t0) / 1000) + " s): " + JSON.stringify(d).slice(0, 300));
  return d || {};
};
fs.mkdirSync(dir, { recursive: true });
if (mode === "classic") {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, RegExp, parseFloat };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(R + "scratchpad/gdc/code/prepare/adapter.js", "utf8") + "\nthis.gcAdapt = gcAdapt;", sb);
  const sqlMod = cp.execFileSync("python3", ["-c", "import sys,json; sys.path.insert(0,'" + R + "scratchpad/gdrev/prepare'); from sql import SQL; print(json.dumps({'hdr': SQL['hdr'], 'lines': SQL['lines']}))"], { encoding: "utf8" });
  const S = JSON.parse(sqlMod);
  const org = live("SELECT CAST(organization_id AS CHAR) AS o FROM goods_delivery WHERE tenant_id = '" + tenant + "' AND id = " + gdId)[0].o;
  const fill = (t) => t.replace(/\{\{node:code_node_GCentry\.data\.tenantId\}\}/g, tenant).replace(/\{\{node:code_node_GCentry\.data\.gdId\}\}/g, gdId).replace(/\{\{node:code_node_GCentry\.data\.organizationId\}\}/g, org);
  const gd = sb.gcAdapt({ organizationId: org, hdr: live(fill(S.hdr)), lines: live(fill(S.lines)) }).gd.data;
  if (gd.gd_status !== "Completed") throw new Error("GD is " + gd.gd_status);
  console.log("classic revert of " + gd.delivery_no + " (" + (gd.table_gd || []).length + " lines)");
  const t0 = Date.now();
  const r = call(CLASSIC, { allData: gd, pageStatus: "Edit" }, "GD_REVERT_COMPLETED");
  console.log("classic took " + Math.round((Date.now() - t0) / 1000) + " s; code " + r.code + " " + (r.message || r.msg || ""));
} else {
  const t0 = Date.now();
  const sub = call(IDS.GD_REVERT_SUBMIT, { operation: "SUBMIT", gd_id: gdId, source: "LIST" }, "GD_REVERT_SUBMIT");
  if (sub.route !== "QUEUED") { console.log("not queued: " + sub.route + " " + sub.message); process.exit(1); }
  const job = sub.job_id;
  const read = () => live("SELECT job_status, attempt_count, error_code, LEFT(error_message, 300) AS error_message, progress_message, lease_owner FROM gd_async_job WHERE tenant_id = '" + tenant + "' AND id = " + job)[0];
  // a worker run past 300 s outlives this call (Node fetch's headersTimeout); the run goes on, so keep following the job
  const kick = (label) => { try { call(IDS.GD_REVERT_WORKER, { job_id: job }, label); } catch (e) { console.log("  " + label + ": no answer (" + String(e.message).split("\n")[0].slice(0, 80) + "); following the job"); } };
  kick("GD_REVERT_WORKER");
  let j = read(), kicks = 1;
  const terminal = (s) => ["COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW"].indexOf(s) >= 0;
  while (!terminal(j.job_status) && Date.now() - t0 < 40 * 60000) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
    j = read();
    if (!terminal(j.job_status)) { kick("GD_REVERT_WORKER again (" + j.job_status + ")"); kicks++; j = read(); }
  }
  const steps = live("SELECT step_name, step_status, started_at, finished_at FROM gd_publish_step WHERE tenant_id = '" + tenant + "' AND job_id = '" + job + "' AND step_name LIKE 'R%' ORDER BY id");
  console.log("v2 job " + job + ": " + j.job_status + " " + (j.error_code || "") + " after " + Math.round((Date.now() - t0) / 1000) + " s, " + kicks + " worker start(s)");
  console.log("  " + (j.progress_message || "") + (j.error_message ? " | " + j.error_message : ""));
  console.log("  steps: " + steps.map((s) => s.step_name + (s.step_status === "DONE" ? "" : "(" + s.step_status + ")") + (s.finished_at ? " " + String(s.finished_at).slice(11, 19) : "")).join(", "));
}
