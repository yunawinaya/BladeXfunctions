// client_form_sim.js: gdc_onClick_save_as_completed on a mock form - each scenario's SUBMIT answers in order, the user's
// answers to the prompts, and what the handler did (calls, prompts, messages, classic fallback, worker start)
const fs = require("fs");
const code = fs.readFileSync(__dirname + "/../../../Goods Delivery/CompleteV2/gdc_onClick_save_as_completed.js", "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));
async function scenario(name, submits, userSays, values) {
  const log = [];
  let i = 0;
  const form = {
    models: { _data: {} },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.push("dialog closed") } }, refresh: () => log.push("list refreshed") },
    getValues: () => Object.assign({ id: "2106409056132841473", page_status: "Edit", delivery_no: "GD/1" }, values || {}),
    showLoading: () => {}, hideLoading: () => {},
    hide: (x) => log.push("hide " + x.length + " buttons"),
    runWorkflow: (id, params, ok) => {
      if (id === "2110182645714518018") { log.push("WORKER " + JSON.stringify(params)); setTimeout(() => ok({ data: { worker_route: "WORKED" } }), 0); return; }
      log.push("SUBMIT answers=" + JSON.stringify(params.answers) + " source=" + params.source + " form=" + (params.form ? "yes" : "no"));
      const r = submits[i++];
      setTimeout(() => ok(r === undefined ? null : { code: 200, data: r }), 0);
    },
    triggerEvent: async (n) => log.push("CLASSIC " + n),
    $confirm: (m) => { const yes = userSays.shift(); log.push("confirm(" + String(m).slice(0, 40) + ") -> " + yes); return yes ? Promise.resolve() : Promise.reject(new Error("cancel")); },
    $alert: (m, t, o) => { log.push("alert[" + o.type + "] " + String(m).slice(0, 50)); return Promise.resolve(); },
    $message: { success: (m) => log.push("ok: " + m), warning: (m) => log.push("warn: " + m), error: (m) => log.push("error: " + m) },
  };
  new Function(code).call(form);
  for (let k = 0; k < 20; k++) await tick();
  console.log("== " + name + "\n   " + log.join("\n   ") + "\n   is_processing=" + form.models._data.is_processing);
}
(async () => {
  const Q = { route: "QUEUED", code: "200", job_id: "J1", gd_no: "GD/1" };
  await scenario("queued", [Q], []);
  await scenario("not eligible -> classic", [{ route: "NOT_ELIGIBLE", code: "300", reason: "it has unsaved changes (order_remark)" }], []);
  await scenario("401 yes then 403 yes then queued", [{ route: "STOP", code: "401", message: "zero qty?" }, { route: "STOP", code: "403", message: "Override - over limit" }, Q], [true, true]);
  await scenario("401 cancel", [{ route: "STOP", code: "401", message: "zero qty?" }], [false]);
  await scenario("412 no -> skip invoice", [{ route: "STOP", code: "412", message: "invoice?" }, Q], [false]);
  await scenario("406 -> classic", [{ route: "STOP", code: "406", message: "picking?" }], []);
  await scenario("402 block", [{ route: "STOP", code: "402", message: "Block - over credit" }], []);
  await scenario("busy", [{ route: "BUSY", code: "409", message: "This delivery is already being completed - please wait for it to finish." }], []);
  await scenario("400 over 500 lines", [{ route: "STOP", code: "400", message: "This delivery has 1948 lines and unsaved changes (x). Save it as Created first, then complete it." }], []);
  await scenario("no response", [undefined], []);
  await scenario("new delivery (Add) -> classic", [], [], { id: "", page_status: "Add" });
})();
