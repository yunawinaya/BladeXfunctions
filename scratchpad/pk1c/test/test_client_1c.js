// pkV2_onSave_Completed on a mock form: what it sends, when it falls back to the classic save, what it does after.
// Stage 1c copy of scratchpad/pkv2-legacy/test_client.js: a bin / batch move is submitted with its target.
const fs = require("fs");
const { eq, done } = require("../../gdc/pkv2tools/harness.js");

const SRC = fs.readFileSync("/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2/pkV2_onSave_Completed.js", "utf8")
  .replace("2109531449614647297", "111").replace("2109531412499251201", "222")
  .replace("(async () => {\n  const data", "return (async () => {\n  const data").replace("PK_V2_POLL_MS = 3000", "PK_V2_POLL_MS = 1")
  .replace("PK_V2_DRAIN_NEXT_MS = 1000", "PK_V2_DRAIN_NEXT_MS = 2").replace("PK_V2_DRAIN_SLOW_MS = 5000", "PK_V2_DRAIN_SLOW_MS = 10")
  .replace("PK_V2_DRAIN_FAILED_MS = 15000", "PK_V2_DRAIN_FAILED_MS = 20").replace("PK_V2_DRAIN_LOST_MS = 60000", "PK_V2_DRAIN_LOST_MS = 40")
  .replace("PK_V2_DRAIN_QUIET_MS = 180000", "PK_V2_DRAIN_QUIET_MS = 150");

async function click(values, answers, opts) {
  const log = { calls: [], events: [], msgs: [], closed: 0, refreshed: 0, gdcReads: {} };
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
      // the worker answers at once, or (opts.workerAnswers false) never: a long run's answer lost in the browser (Kenhin 10-27)
      if (id === "222") return (opts || {}).workerAnswers === false ? undefined : ok({ data: {} });
      // GD_COMPLETE_WORKER: the drain's {} run answers that it moved nothing (the completions' statuses come from opts.gdc)
      if (id === "2110182645714518018") return setTimeout(() => ok({ data: { worker_route: "IDLE", processed: "0", jobs: "[]" } }), 1);
      if (id === "2110182609618337794") {
        // GD_COMPLETE_SUBMIT STATUS: opts.gdc = gd_id -> the completion's job_status per read (the last repeats; COMPLETED if not given)
        const seq = ((opts || {}).gdc || {})[params.gd_id] || ["COMPLETED"];
        const k = (log.gdcReads[params.gd_id] = (log.gdcReads[params.gd_id] || 0) + 1);
        return ok({ data: { route: "STATUS", code: "200", gd_id: params.gd_id, job_status: seq[Math.min(k, seq.length) - 1] } });
      }
      const a = queue.shift();
      if (a && a.ok) ok(a.ok);
      else fail(a ? a.fail : "no answer");
    },
  };
  log.win = {};
  await new Function("db", "window", SRC).call(ctx, {}, log.win);
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

  // Auto Complete GD (stage 1e, hardened 10-27): the form follows the job through STATUS itself - a long worker run's answer can
  // be lost in the browser (Kenhin 14:50) - starts each queued completion once, names the ones left for a manual completion,
  // and stops a few polls after the list stops growing (P7 adds its entries just after the job is COMPLETED)
  // the follow, then the GD Complete drain (one {} run at a time) until every delivery handed over has ended
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 80));
    for (let i = 0; i < 100 && log.win && log.win.pkV2GdcDrain && log.win.pkV2GdcDrain.active; i++) await new Promise((r) => setTimeout(r, 5));
  };
  const st = (job_status, list) => ({ ok: { data: { route: "STATUS", job_status: job_status, gd_complete: list } } });
  const Q = (id, job) => ({ gd_id: id, gd_no: "GD-" + id, status: "QUEUED", job_id: job });
  const two = [Q("51", "881"), Q("52", "882")];
  log = await click(form([row("1", 2)]), [queued, st("COMMITTING_PICKING", []), st("COMPLETED", [Q("51", "881")]), st("COMPLETED", two), st("COMPLETED", two),
    st("COMPLETED", two), st("COMPLETED", two)], { workerAnswers: false });
  await settle();
  eq("auto complete: with the Picking worker's answer lost, the completions still go to the drain: {} runs, one at a time",
    [log.calls.filter((c) => c.id === "2110182645714518018").length >= 1, log.calls.filter((c) => c.id === "2110182645714518018").every((c) => !c.params.job_id)], [true, true]);
  eq("auto complete: the follow stops once the list is stable", log.calls.filter((c) => c.id === "111" && c.params.operation === "STATUS").length, 6);
  eq("auto complete: each started delivery is named once", log.msgs.filter((m) => /^S Completing/.test(m)), ["S Completing GD-51 in the background.", "S Completing GD-52 in the background."]);
  const nq = { gd_id: "53", gd_no: "GD-53", status: "NOT_QUEUED", job_id: "", code: "STOP 402", message: "Credit limit exceeded: complete it from the Goods Delivery list" };
  log = await click(form([row("1", 2)]), [queued, st("COMPLETED", [nq]), st("COMPLETED", [nq]), st("COMPLETED", [nq]), st("COMPLETED", [nq])]);
  await settle();
  eq("auto complete: a delivery left for a manual completion is named once, nothing started",
    [log.msgs.filter((m) => /^W /.test(m)), log.calls.filter((c) => c.id === "2110182645714518018").length],
    [["W Not completed automatically: GD-53 - Credit limit exceeded: complete it from the Goods Delivery list"], 0]);
  log = await click(form([row("1", 2)]), [queued, st("COMPLETED", []), st("COMPLETED", []), st("COMPLETED", []), st("COMPLETED", [])]);
  await settle();
  eq("no Auto Complete GD (nothing handed over): 4 STATUS reads, no GD worker", [log.calls.filter((c) => c.id === "111" && c.params.operation === "STATUS").length,
    log.calls.filter((c) => c.id === "2110182645714518018").length], [4, 0]);
  log = await click(form([row("1", 2)]), [queued, st("FAILED", [])]);
  await settle();
  eq("a FAILED job ends the follow at once", log.calls.filter((c) => c.params.operation === "STATUS").length, 1);

  // the GD Complete drain (10-29; it used to start each completion, then kick {} every 15 s): one {} run at a time; after a run
  // that moved nothing, the handed-over deliveries' completions are read and the ended ones dropped
  const gdcCalls = (log) => log.calls.filter((c) => c.id === "2110182609618337794").map((c) => [c.params.operation, c.params.gd_id, c.params.source]);
  const runs = (log) => log.calls.filter((c) => c.id === "2110182645714518018" && !c.params.job_id).length;
  const followed = [queued, st("COMPLETED", two), st("COMPLETED", two), st("COMPLETED", two), st("COMPLETED", two)];
  log = await click(form([row("1", 2)]), followed, { workerAnswers: false, gdc: { 52: ["COMMITTING_GD", "COMMITTING_GD", "COMPLETED"] } });
  await settle();
  eq("drain: a read after each idle run while one still completes, the ended one is not read again",
    [gdcCalls(log), runs(log)], [[["STATUS", "51", "PICKING"], ["STATUS", "52", "PICKING"], ["STATUS", "52", "PICKING"], ["STATUS", "52", "PICKING"]], 3]);
  log = await click(form([row("1", 2)]), followed, { workerAnswers: false });
  await settle();
  eq("drain: both ended at the first read: one run, then it stops", [gdcCalls(log).length, runs(log)], [2, 1]);
  log = await click(form([row("1", 2)]), followed, { workerAnswers: false, gdc: { 51: ["VALIDATING"] } });
  await settle();
  const n1 = runs(log);
  await new Promise((r) => setTimeout(r, 100));
  eq("drain: a completion that never ends: idle runs until the quiet limit (3 min, 150 ms here), then the lists' sweeps take over",
    [n1 >= 5 && n1 <= 30, runs(log) === n1, log.win.pkV2GdcDrain.active], [true, true, false]);
  done();
})();
