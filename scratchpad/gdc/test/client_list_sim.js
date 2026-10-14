// client_list_sim.js: gdc_list_func_bulkComplete on a mock list - SUBMIT answers per delivery, classic GOODS_DELIVERY
// answers, the user's prompt answers; prints every call, prompt and the summary
const fs = require("fs");
const code = fs.readFileSync(__dirname + "/../../../Goods Delivery/CompleteV2/gdc_list_func_bulkComplete.js", "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  const log = [];
  const rows = [
    { id: "1", delivery_no: "GD/Q", gd_status: "Created" },      // queued
    { id: "2", delivery_no: "GD/Z", gd_status: "Created" },      // 401 then queued
    { id: "3", delivery_no: "GD/NE", gd_status: "Created" },     // not eligible -> classic 200
    { id: "4", delivery_no: "GD/SI", gd_status: "Created" },     // 412 -> batch prompt (yes) -> queued
    { id: "5", delivery_no: "GD/BLK", gd_status: "Created" },    // 402
    { id: "6", delivery_no: "GD/C", gd_status: "Completed" },    // filtered out
  ];
  const submits = { "1": [{ route: "QUEUED", job_id: "J1" }], "2": [{ route: "STOP", code: "401", message: "zero?" }, { route: "QUEUED", job_id: "J2" }],
    "3": [{ route: "NOT_ELIGIBLE", reason: "it has handling-unit allocations" }], "4": [{ route: "STOP", code: "412", message: "inv?" }, { route: "QUEUED", job_id: "J4" }],
    "5": [{ route: "STOP", code: "402", message: "Block - over credit" }] };
  let ticks = 0;
  const page = {
    showLoading: () => {}, hideLoading: () => {}, refresh: () => log.push("refresh"),
    getComponent: () => ({ $refs: { crud: { tableSelect: rows } } }),
    $confirm: (m, t) => { log.push("confirm: " + (t || "") ); return Promise.resolve(); },
    $message: { success: (m) => log.push("SUCCESS " + m), warning: (m) => log.push("WARN " + m), error: (m) => log.push("ERROR " + m) },
    runWorkflow: (id, params, ok) => {
      if (id === "2110182609618337794") {
        const r = submits[params.gd_id].shift();
        log.push(`SUBMIT ${params.gd_id} ${JSON.stringify(params.answers)} -> ${r.route}${r.code ? " " + r.code : ""}`);
        return setTimeout(() => ok({ data: r }), 0);
      }
      if (id === "2110182645714518018") { ticks++; log.push("WORKER tick " + ticks); return setTimeout(() => ok({ data: { processed: ticks < 2 ? "3" : "0" } }), 0); }
      if (id === "2017151544868491265") { log.push(`CLASSIC GOODS_DELIVERY ${params.allData.id}`); return setTimeout(() => ok({ data: { code: "200" } }), 0); }
    },
  };
  global.db = { collection: () => ({ doc: (id) => ({ get: async () => ({ data: [{ id, delivery_no: "x" }] }) }) }) };
  new Function(code).call(page);
  for (let k = 0; k < 60; k++) await tick();
  console.log(log.join("\n"));
})();
