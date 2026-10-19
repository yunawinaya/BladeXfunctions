// pkV2_onSave_Completed on a mock form: what it sends, when it falls back to the classic save, what it does after.
// Stage 1c copy of scratchpad/pkv2-legacy/test_client.js: a bin / batch move is submitted with its target.
const fs = require("fs");
const { eq, done } = require("../../gdc/pkv2tools/harness.js");

const SRC = fs.readFileSync("/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2/pkV2_onSave_Completed.js", "utf8")
  .replace("2109531449614647297", "111").replace("2109531412499251201", "222")
  .replace("(async () => {\n  const data", "return (async () => {\n  const data");

async function click(values, answers) {
  const log = { calls: [], events: [], msgs: [], closed: 0, refreshed: 0 };
  const queue = (answers || []).slice();
  const ctx = {
    models: { _data: {} },
    getValues: () => JSON.parse(JSON.stringify(values)),
    getVarGlobal: (k) => (k === "nickname" ? "picker" : "1"),
    getVarSystem: () => "1",
    showLoading: () => {},
    hideLoading: () => {},
    triggerEvent: async (name) => log.events.push(name),
    $message: { success: (m) => log.msgs.push("S " + m), error: (m) => log.msgs.push("E " + m), warning: (m) => log.msgs.push("W " + m) },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.closed++ } }, refresh: () => log.refreshed++, hide: () => {} },
    runWorkflow: (id, params, ok, fail) => {
      log.calls.push({ id, params });
      const a = id === "222" ? { ok: { data: {} } } : queue.shift();
      if (a && a.ok) ok(a.ok);
      else fail(a ? a.fail : "no answer");
    },
  };
  await new Function("db", "window", SRC).call(ctx, {}, {});
  return log;
}

const form = (rows, extra) => Object.assign({ id: "9001", page_status: "Edit", to_status: "Created", organization_id: "77", remarks: "x", di_driver_name: "Ali", table_picking_items: rows }, extra || {});
const row = (id, picked, extra) => Object.assign({ id: id, row_type: "item", item_code: "IT", item_uom: "U1", picking_uom: "U2", source_bin: "B1", line_status: "Open", picked_qty: picked, remark: "" }, extra || {});
const queued = { ok: { data: { route: "QUEUED", result_code: "200", job_id: "555", job_status: "QUEUED" } } };
const sentTargets = (log) => (log.calls[0] ? JSON.parse(log.calls[0].params.payload).lines.map((l) => [l.target_location_id, l.target_batch_id]) : "nothing submitted");

(async () => {
  let log = await click(form([row("1", 2), row("2", 0), { id: "H", row_type: "header", picked_qty: 9 }, { id: "B", item_bundle_id: "BUN", children: [row("3", 1)] }]), [queued]);
  const sent = log.calls[0].params;
  const payload = JSON.parse(sent.payload);
  eq("sends the picked lines only (bundle child included, header + bundle row skipped)", payload.lines.map((l) => [l.row_id, l.qty, l.pick_uom]), [["1", 2, "U2"], ["3", 1, "U2"]]);
  eq("params", [sent.picking_id, sent.organization_id, sent.operation, sent.confirmed_by, /^PK-9001-/.test(sent.idempotency_key)], ["9001", "77", "CONFIRM", "picker", true]);
  eq("header patch carries the form's header fields", [payload.header_patch.remarks, payload.header_patch.di_driver_name], ["x", "Ali"]);
  eq("queued: dialog closed, worker kicked with the job", [log.closed, log.calls[1].id, log.calls[1].params.job_id, log.events], [1, "222", "555", []]);

  log = await click(form([row("1", 2)]), [{ ok: { data: { route: "NOT_ELIGIBLE", result_code: "NOT_ELIGIBLE", result_message: "Auto Complete GD uses the classic save" } } }]);
  eq("NOT_ELIGIBLE: the classic onSave_Completed runs", [log.events, log.closed], [["onSave_Completed"], 0]);

  log = await click(form([row("1", 2, { target_location: "B9" })]), [queued]);
  eq("a bin move: submitted with its target, not the classic save (1c)", [log.events, sentTargets(log)],
    [[], [["B9", ""]]]);
  log = await click(form([row("1", 2, { batch_no: "T1", target_batch: "T2" })]), [queued]);
  eq("a batch move: submitted with its target batch (1c)", [log.events, sentTargets(log)],
    [[], [["", "T2"]]]);
  const bayText = "Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked items: IT. Set a loading bay bin on every picked line before completing.";
  log = await click(form([row("1", 2)]), [{ ok: { data: { route: "REJECT", result_code: "400", result_message: bayText } } }]);
  eq("Loading Bay without a bay bin: SUBMIT's (classic) message, the form stays open", [log.events, log.closed, log.msgs], [[], 0, ["E " + bayText]]);

  log = await click(form([row("1", 2)], { page_status: "Add", id: null }), []);
  eq("a new Picking: classic save", log.events, ["onSave_Completed"]);

  log = await click(form([row("1", 0)]), []);
  eq("nothing picked: the old message, nothing sent", [log.calls.length, log.msgs], [0, ["E Cannot complete picking. At least one item must have picked quantity greater than 0."]]);

  log = await click(form([row("1", 2)]), [{ ok: { data: { route: "REJECT", result_code: "400", result_message: "This Picking is still being confirmed in the background (job 9)." } } }]);
  eq("rejected: the server's message, dialog stays", [log.closed, log.msgs[0]], [0, "E This Picking is still being confirmed in the background (job 9)."]);

  log = await click(form([row("1", 2)]), [{ fail: "timeout" }, { fail: "timeout" }]);
  eq("no answer twice: one retry with the same key, then a message", [log.calls.length, log.calls[0].params.idempotency_key === log.calls[1].params.idempotency_key, /did not complete/.test(log.msgs[0])], [2, true, true]);
  done();
})();
