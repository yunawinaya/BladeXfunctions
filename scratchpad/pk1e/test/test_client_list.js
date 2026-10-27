// test_client_list.js [file]: the Picking list's Auto Pick & Complete (Picking/AsyncV2/pkV2_listAutoPick.js, or [file]) after a
// queued confirm: it follows the Picking job through STATUS - not the worker's answer, which a long run can lose in the browser
// (Kenhin 10-27) - and starts GD_COMPLETE_WORKER once for each delivery COMMIT handed to GD Complete V2 (stage 1e).
const fs = require("fs");
const { eq, done } = require("../../gdc/pkv2tools/harness.js");
const SRC = fs.readFileSync(process.argv[2] || __dirname + "/../../../Picking/AsyncV2/pkV2_listAutoPick.js", "utf8");

const has = (s) => SRC.indexOf(s) >= 0;
eq("the list defines followGdCompletes", has("const followGdCompletes = async"), true);
eq("the follow starts right after QUEUED, not from the worker's answer",
  /results\.push\(\{ to_id: pickingItem\.to_id, success: true, queued: true \}\);\s*followGdCompletes\(id, pickingItem\.organization_id \|\| organizationId\);/.test(SRC), true);
eq("the worker's callback no longer starts completions", /this\.refresh\(\);\s*this\.hide\("tabs_picking"\);\s*\}, \(e\)/.test(SRC), true);

(async () => {
  if (!has("const followGdCompletes = async")) return done();
  const start = SRC.indexOf("const PK_V2_WF = {");
  const end = SRC.indexOf("\n};\n", SRC.indexOf("const followGdCompletes = async")) + 4;
  const body = SRC.slice(start, end).replace("PK_V2_POLL_MS = 3000", "PK_V2_POLL_MS = 1");
  const run = async (answers) => {
    const log = { calls: [], msgs: [] };
    const queue = answers.slice();
    const ctx = {
      runWorkflow: (id, params, ok, fail) => {
        log.calls.push([id, params.operation || "", params.job_id || ""]);
        if (params.operation !== "STATUS") return undefined; // GD_COMPLETE_WORKER: fire-and-forget
        const a = queue.shift();
        if (a) ok(a);
        else fail("no answer");
      },
      $message: { success: (m) => log.msgs.push("S " + m), warning: (m) => log.msgs.push("W " + m), error: (m) => log.msgs.push("E " + m) },
    };
    await new Function("console", body + "\nreturn followGdCompletes('9001', '77');").call(ctx, { log: () => {}, error: () => {} });
    return log;
  };
  const st = (job_status, list) => ({ data: { route: "STATUS", job_status: job_status, gd_complete: list } });
  const Q = (id, job) => ({ gd_id: id, gd_no: "GD-" + id, status: "QUEUED", job_id: job });
  const two = [Q("51", "888"), Q("52", "889")];
  let log = await run([st("VALIDATING", []), st("COMPLETED", [Q("51", "888")]), st("COMPLETED", two), st("COMPLETED", two), st("COMPLETED", two), st("COMPLETED", two)]);
  eq("STATUS polled until the list is stable; each queued job started once", [log.calls.filter((c) => c[1] === "STATUS").length,
    log.calls.filter((c) => c[0] === "2110182645714518018").map((c) => c[2])], [6, ["888", "889"]]);
  eq("the user is told as each one starts", log.msgs, ["S Completing GD-51 in the background.", "S Completing GD-52 in the background."]);
  log = await run([st("COMPLETED", JSON.stringify([Q("51", "888")])), st("COMPLETED", JSON.stringify([Q("51", "888")])), st("COMPLETED", JSON.stringify([Q("51", "888")])),
    st("COMPLETED", JSON.stringify([Q("51", "888")]))]);
  eq("gd_complete as JSON text (a string-declared output) is read too", log.calls.filter((c) => c[0] === "2110182645714518018").map((c) => c[2]), ["888"]);
  log = await run([st("REQUIRES_REVIEW", [])]);
  eq("a job under review ends the follow, nothing started", [log.calls.length, log.msgs], [1, []]);
  done();
})();
