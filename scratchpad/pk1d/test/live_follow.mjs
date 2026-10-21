// live_follow.mjs <identity.json> <picking_id> <organization_id> <job_id> <out_dir> [--max-min=N]: the Picking list's follow
// loop for one force complete (Picking/AsyncV2/pkV2_listForceComplete.js followJobs), run in sequence from the CLI: WORKER
// {job_id}; then STATUS every 3 s; each id STATUS names in `kick` runs GD_EDIT_WORKER {job_id}, then the worker again; a
// re-kick every 15 s; until the job ends or N minutes (default 30) pass. Every call goes through scratchpad/gdc/tools/runas.mjs
// (the minted tenant user, DEV only); requests and answers land in <out_dir> (git-ignored: tenant data).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WF = { SUBMIT: "2109531449614647297", WORKER: "2109531412499251201", GD_EDIT_WORKER: "2110618789356687361" };
const TERMINAL = new Set(["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"]);
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [idFile, pickingId, orgId, jobId, outDir] = pos;
const maxMin = Number((process.argv.find((a) => a.startsWith("--max-min=")) || "--max-min=30").slice(10));
// --watch: after each worker call, the Picking's update_time / lock (scratchpad/pk1d/test/live_pk_lock.py)
const watch = process.argv.includes("--watch");
if (!idFile || ![pickingId, orgId, jobId].every((v) => /^[0-9]{1,20}$/.test(v || "")) || !outDir) {
  console.error("usage: node live_follow.mjs <identity.json> <picking_id> <organization_id> <job_id> <out_dir> [--max-min=N]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + " s";
let n = 0;

const call = (name, params) => {
  n++;
  const base = path.join(outDir, String(n).padStart(3, "0") + "." + name);
  fs.writeFileSync(base + ".req.json", JSON.stringify(params));
  const started = Date.now();
  const r = spawnSync(process.execPath, ["scratchpad/gdc/tools/runas.mjs", idFile, WF[name], base + ".req.json", base + ".out.json"], { encoding: "utf8" });
  const ms = Date.now() - started;
  let body = null;
  try {
    body = JSON.parse(fs.readFileSync(base + ".out.json", "utf8"));
  } catch (e) {
    body = null;
  }
  const d = body && body.data && typeof body.data === "object" ? body.data : null;
  const pick = (k) => (d && d[k] !== undefined && d[k] !== null && d[k] !== "" ? k + "=" + (Array.isArray(d[k]) ? "[" + d[k].join(",") + "]" : String(d[k]).slice(0, 160)) : "");
  const keys = ["route", "result_code", "job_status", "progress_percent", "kick", "result_message", "publish_route", "code", "message"];
  console.log(`${at()} #${n} ${name.padEnd(14)} ${String(ms).padStart(6)} ms  ${d ? keys.map(pick).filter(Boolean).join(" ") : "NO DATA " + ((r.stdout || "") + (r.stderr || "")).slice(0, 300)}`);
  if (watch && name === "WORKER") {
    const w = spawnSync("python3", ["scratchpad/pk1d/test/live_pk_lock.py", pickingId], { encoding: "utf8" });
    console.log(`${at()}    ${(w.stdout || w.stderr || "").trim()}`);
  }
  return d;
};

let kickedAt = Date.now();
let last = null;
call("WORKER", { job_id: jobId });
while (Date.now() - t0 < maxMin * 60000) {
  const st = call("SUBMIT", { picking_id: pickingId, organization_id: orgId, operation: "STATUS" });
  if (st && String(st.job_id) === jobId) last = st;
  if (st && String(st.job_id) === jobId && TERMINAL.has(String(st.job_status))) break;
  const kick = st && Array.isArray(st.kick) ? st.kick.map(String) : [];
  if (kick.length) {
    for (const id of kick) call("GD_EDIT_WORKER", { job_id: id });
    call("WORKER", { job_id: jobId });
    kickedAt = Date.now();
    continue;
  }
  sleep(3000);
  if (Date.now() - kickedAt >= 15000) {
    call("WORKER", { job_id: jobId });
    kickedAt = Date.now();
  }
}
console.log(`${at()} END job ${jobId}: ${last ? last.job_status + " " + (last.result_code || "") + " " + (last.result_message || "") : "no STATUS for the job"} (${n} calls)`);
process.exit(last && last.job_status === "COMPLETED" ? 0 : 1);
