// live_follow_dev.js <picking_id> <organization_id> [--drop-start]: DEV only, writes. The Picking list's Auto Pick & Complete as Kenhin met it
// on 10-27 - the worker started and its answer never awaited - then the list's own followGdCompletes (pkV2_listAutoPick.js) run
// against the live dev workflows: STATUS polled every 3 s, GD_COMPLETE_WORKER started per queued completion. Calls go through
// scratchpad/gdc/tools/runwf.mjs (the CLI user, tenant 000000). Then the re-kick follow (10-28): GD_COMPLETE_SUBMIT STATUS per
// started delivery every 15 s and GD_COMPLETE_WORKER {} while one runs. --drop-start withholds the per-job start, as if it lost
// the stock lock, so only the re-kick can complete the delivery.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..", "..");
const RUNWF = path.join(REPO, "scratchpad/gdc/tools/runwf.mjs");
const [pickingId, orgId] = process.argv.slice(2).filter((a) => a.indexOf("--") !== 0);
const DROP_START = process.argv.indexOf("--drop-start") > 0;
if (!/^\d+$/.test(pickingId || "") || !/^\d+$/.test(orgId || "")) throw new Error("usage: live_follow_dev.js <picking_id> <organization_id>");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pk1e-follow-"));
let n = 0;
const files = (params) => {
  const req = path.join(TMP, "req" + ++n + ".json");
  fs.writeFileSync(req, JSON.stringify(params));
  return [req, path.join(TMP, "out" + n + ".json")];
};
const callSync = (wf, params) => {
  const [req, out] = files(params);
  const r = spawnSync("node", [RUNWF, wf, req, out], { cwd: REPO, encoding: "utf8" });
  const last = String(r.stdout || "").trim().split("\n").pop();
  try {
    return JSON.parse(last);
  } catch (e) {
    return null;
  }
};
const background = [];
const callDetached = (wf, params, label) => {
  const [req, out] = files(params);
  const p = spawn("node", [RUNWF, wf, req, out], { cwd: REPO, stdio: "ignore" });
  background.push(new Promise((r) => p.on("exit", () => r(label))));
};
const log = [];
const ctx = {
  runWorkflow: (id, params, ok, fail) => {
    const t = new Date().toISOString().slice(11, 19);
    if (params.operation === "STATUS") {
      const r = callSync(id, params);
      const d = r && r.data;
      log.push(t + (params.gd_id ? " GD STATUS " + params.gd_id + " " + (d ? d.job_status + " " + (d.progress_message || "") : "no answer")
        : " STATUS " + (d ? d.job_status + " gd_complete=" + JSON.stringify((d.gd_complete || []).map((g) => g.gd_no + ":" + g.status)) : "no answer")));
      return d ? ok({ data: d }) : fail("no answer");
    }
    if (DROP_START && params.job_id && id === "2110182645714518018") {
      log.push(t + " start DROPPED " + JSON.stringify(params));
      return undefined;
    }
    log.push(t + " kick " + id + " " + JSON.stringify(params));
    callDetached(id, params, id + " " + (params.job_id || ""));
    return undefined;
  },
  $message: { success: (m) => log.push("toast S " + m), warning: (m) => log.push("toast W " + m), error: (m) => log.push("toast E " + m) },
};
const SRC = fs.readFileSync(path.join(REPO, "Picking/AsyncV2/pkV2_listAutoPick.js"), "utf8");
const body = SRC.slice(SRC.indexOf("const PK_V2_WF = {"), SRC.indexOf("\n};\n", SRC.indexOf("const followGdCompletes = async")) + 4);

(async () => {
  const key = "PKA-" + pickingId + "-live" + Date.now().toString(36);
  const sub = callSync("2109531449614647297", { picking_id: pickingId, organization_id: orgId, operation: "PICK_ALL_REMAINING", idempotency_key: key, payload: "{}",
    confirmed_by: "live-follow" });
  console.log("SUBMIT", JSON.stringify(sub && sub.data));
  if (!sub || !sub.data || sub.data.route !== "QUEUED") return;
  callDetached("2109531412499251201", { job_id: String(sub.data.job_id) }, "picking worker"); // its answer is never awaited
  await new Function("console", body + "\nreturn followGdCompletes(" + JSON.stringify(pickingId) + ", " + JSON.stringify(orgId) + ");")
    .call(ctx, { log: () => {}, error: (...a) => log.push("console.error " + a.join(" ")) });
  console.log(log.join("\n"));
  console.log("waiting for", background.length, "background run(s)...");
  console.log("finished:", (await Promise.all(background)).join(" | "));
})();
