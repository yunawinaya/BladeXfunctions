// pkV2ShowJobState as embedded in the form's mounted: open job -> buttons hidden + notice; FAILED -> error once.
const fs = require("fs");
const { eq, done } = require("./harness");
const form = JSON.parse(fs.readFileSync("/Users/yunawinaya/Developer/BladeXfunctions/Picking/PickingFullJSON.json", "utf8"));
const mounted = form.config.eventScript.find((e) => e.key === "mounted").func;
const i = mounted.indexOf("const pkV2ShowJobState");
const j = mounted.indexOf("// Main execution function");
const helper = mounted.slice(i, j);

async function open(job, store) {
  const log = { hidden: [], msgs: [], calls: [] };
  const ctx = {
    getValue: (k) => ({ id: "9001", organization_id: "77" })[k],
    getVarGlobal: () => "1",
    getVarSystem: () => "1",
    hide: (x) => log.hidden.push(...x),
    $message: { warning: (m) => log.msgs.push("W " + m), error: (m) => log.msgs.push("E " + m) },
    runWorkflow: (id, params, ok) => {
      log.calls.push([id, params]);
      ok({ data: job });
    },
  };
  const window = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) } };
  // the helper is an arrow function: `this` is the form, bound when the surrounding script runs (as on the platform)
  await new Function("window", helper + "\nreturn pkV2ShowJobState;").call(ctx, window)();
  return log;
}

(async () => {
  const store = {};
  let log = await open({ route: "STATUS", job_id: "5", job_status: "COMMITTING_PICKING", result_message: "Saving 3 picked line(s)" }, store);
  eq("calls SUBMIT STATUS with the Picking", log.calls[0], ["2109531449614647297", { picking_id: "9001", organization_id: "77", operation: "STATUS" }]);
  eq("open job: save buttons hidden + notice", [log.hidden, log.msgs], [["button_save_as_draft", "button_created", "button_inprogress", "button_completed"], ["W This Picking is being saved in the background (Saving 3 picked line(s)). Reopen it in a moment."]]);
  log = await open({ job_id: "6", job_status: "FAILED", result_code: "PK_BUNDLE_SHORT", result_message: "An item bundle must be picked in full." }, store);
  eq("failed job: its reason, buttons stay", [log.hidden, log.msgs], [[], ["E The last confirmation was not saved: An item bundle must be picked in full."]]);
  log = await open({ job_id: "6", job_status: "FAILED", result_message: "x" }, store);
  eq("the same failed job again: not repeated", log.msgs, []);
  log = await open({ job_id: "7", job_status: "COMPLETED", result_code: "PK_CLAMPED", result_message: "1 line(s) were reduced" }, store);
  eq("a completed job with a reduced line: warned once", log.msgs, ["W 1 line(s) were reduced"]);
  log = await open({ job_id: "", job_status: "" }, store);
  eq("no job: nothing shown", [log.hidden, log.msgs], [[], []]);
  done();
})();
