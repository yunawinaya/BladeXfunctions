// test_convert_keep_following.js: the SO list's Convert (Goods Delivery/GDhandleConvertSOtoGD.js) keeps starting the GD Created
// V2 jobs the 2-minute follow leaves behind (Kenhin 10-27: a batch sharing stock goes one delivery at a time, 12 of 13 sat in
// Processing until a list was opened), in the background, while the page stays on the list, until each job ends or KEEP_MS
// passes. Page mocked as in scratchpad/soautogd/test_client.js; timers shortened by exact text replace.
// usage: node test_convert_keep_following.js [handler.js]   (the repo file by default; HEAD 16f2fa4d fails cases 1-2)
const fs = require("fs"), assert = require("assert");
const SRC = fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDhandleConvertSOtoGD.js", "utf8");
const IDS = { AUTO: "2076557490389835777", CHECK: "2112084100104495105", WORKER: "2104840667119411201" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// done(job, kicksSoFar) -> the job's status; the follow (FOLLOW_MS 60) ends with every job still waiting
async function convert({ jobs, done, keepMs, location, silentChecks }) {
  const code = SRC.replace("const FOLLOW_EVERY_MS = 3000;", "const FOLLOW_EVERY_MS = 1;").replace("const FOLLOW_MS = 120000;", "const FOLLOW_MS = 60;")
    .replace("const RECOVER_EVERY_MS = 5000;", "const RECOVER_EVERY_MS = 1;").replace("const RECOVER_MS = 300000;", "const RECOVER_MS = 2000;")
    .replace("const KEEP_MS = 1800000;", "const KEEP_MS = " + (keepMs || 3000) + ";").replace("const KEEP_EVERY_MS = 15000;", "const KEEP_EVERY_MS = 5;")
    .replace("const READ_GIVE_UP_MS = 20000;", "const READ_GIVE_UP_MS = 200;");
  let silent = silentChecks || 0;
  const log = { kicks: [], alerts: [], followEnded: false };
  const kicks = {};
  const ctx = {
    showLoading: () => {}, hideLoading: () => {}, refresh: async () => {}, getVarGlobal: () => "admin",
    $alert: async (msg, title) => { log.alerts.push({ msg: String(msg), title }); log.followEnded = true; },
    $confirm: async (msg, title, o) => { if (o && o.beforeClose) await o.beforeClose("cancel", {}, () => {}); },
    runWorkflow: (id, params, cb, err) => {
      // a kick counts when it is sent (a follow re-kick still in flight when the summary opens is not a background kick)
      if (id === IDS.WORKER) {
        log.kicks.push({ job: params.job_id, afterFollow: log.followEnded });
        kicks[params.job_id] = (kicks[params.job_id] || 0) + (log.followEnded ? 1 : 0);
      }
      setTimeout(() => {
        if (id === IDS.AUTO) return cb({ data: { code: "200", created: [], blocked: [], queued: jobs.map((j) => ({ so_no: "SO-" + j, job_id: j })) } });
        if (id === IDS.WORKER) return cb({ data: {} });
        if (id === IDS.CHECK && params.so_ids) return cb({ data: { busy_json: "[]" } });
        if (id === IDS.CHECK && params.job_ids) {
          if (log.followEnded && silent > 0) return silent--; // the platform did not send it: no answer, no error
          return cb({ data: { jobs_json: JSON.stringify(params.job_ids.map((j) => ({ job_id: j, gd_no: "", error_message: "", job_status: log.followEnded ? done(j, kicks[j] || 0) : "COMMITTING_GD" }))) } });
        }
        err && err("unexpected workflow " + id);
      }, 0);
    },
  };
  global.window = location === undefined ? { location: { pathname: "/so-list" } } : location;
  global.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, convert_gd_created: 1 }] }) }) }) };
  const records = jobs.map((j) => ({ id: j.replace(/\D/g, ""), so_no: "SO-" + j, customer_name: { id: "C1" } }));
  new Function(code).call(ctx, { selectedRecords: records, plantID: "P1", organizationID: "O1" });
  for (let k = 0; k < 4000 && !log.alerts.length; k++) await sleep(1);
  return log;
}
const after = (log, job) => log.kicks.filter((k) => k.afterFollow && (!job || k.job === job)).length;
const waitFor = async (cond, ms = 3000) => {
  for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await sleep(5);
};
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

(async () => {
  // 1. three waiting jobs end one after another in the background (J1 on its 2nd kick, J2 on its 4th, J3 on its 6th); then quiet
  let log = await convert({ jobs: ["J1", "J2", "J3"], done: (j, k) => (k >= { J1: 2, J2: 4, J3: 6 }[j] ? "GD_COMMITTED" : "COMMITTING_GD") });
  assert.ok(/Being created in the background \(3\):<\/strong><br>SO-J1<br>SO-J2<br>SO-J3<br>They appear in the Goods Delivery list when done\. Keep this list open until then\./.test(log.alerts[0].msg), log.alerts[0].msg);
  await waitFor(() => after(log, "J3") >= 6);
  await sleep(50);
  const total = after(log);
  assert.deepStrictEqual([after(log, "J1"), after(log, "J2"), after(log, "J3")], [2, 4, 6], "each kicked until its job ended, then left alone");
  await sleep(200);
  assert.strictEqual(after(log), total, "no kick once every job ended");
  ok("waiting jobs are started again in the background until each ends; the summary says to keep the list open");

  // 2. a job that FAILS in the background stops being kicked; the others go on
  log = await convert({ jobs: ["J4", "J5"], done: (j, k) => (j === "J4" && k >= 1 ? "FAILED" : k >= 3 ? "COMPLETED" : "COMMITTING_GD") });
  await waitFor(() => after(log, "J5") >= 3);
  await sleep(100);
  assert.deepStrictEqual([after(log, "J4"), after(log, "J5")], [1, 3]);
  ok("an ended job (FAILED / review / confirmation / created) is not kicked again");

  // 3. leaving the list stops it
  const loc = { location: { pathname: "/so-list" } };
  log = await convert({ jobs: ["J6", "J9"], done: () => "COMMITTING_GD", location: loc });
  await sleep(60);
  loc.location.pathname = "/goods-delivery";
  await sleep(30);
  const atLeave = after(log);
  await sleep(200);
  assert.ok(atLeave >= 1 && after(log) <= atLeave + 1, "at most the beat in flight after leaving: " + atLeave + " -> " + after(log));
  ok("leaving the sales order list stops the background starts");

  // 4. KEEP_MS bounds it when a job never ends
  log = await convert({ jobs: ["J7", "J10"], done: () => "COMMITTING_GD", keepMs: 80 });
  await sleep(300);
  const atLimit = after(log);
  await sleep(200);
  assert.ok(atLimit >= 1 && after(log) === atLimit, "no kick after KEEP_MS: " + atLimit + " -> " + after(log));
  ok("a job that never ends stops being kicked after KEEP_MS");

  // 5. no page location (another harness's mock window {}): nothing in the background, nothing left running
  // (each case selects 2 sales orders: one selected sales order opens the Convert form instead)
  log = await convert({ jobs: ["J8", "J11"], done: () => "COMMITTING_GD", location: {} });
  await sleep(100);
  assert.strictEqual(after(log), 0);
  ok("without a page location nothing is started in the background");

  // 6. one run per background beat, for the oldest waiting job (one run per waiting job collided on the worker's claim gate,
  // LSH 10-27: a red "CLAIM GATE ... Duplicate entry" toast each)
  log = await convert({ jobs: ["J12", "J13", "J14"], done: () => "COMMITTING_GD", keepMs: 150 });
  await sleep(400);
  const bg = log.kicks.filter((k) => k.afterFollow);
  assert.ok(bg.length >= 3, "beats ran: " + bg.length);
  assert.ok(bg.every((k) => k.job === "J12"), "every background kick is the oldest waiting job: " + bg.map((k) => k.job).join(","));
  ok("each background beat starts one run, for the oldest waiting job");

  // 7. inside the 2-minute follow: every job once at the start (each run claims its own job), then one run per re-kick
  const inFollow = log.kicks.filter((k) => !k.afterFollow).map((k) => k.job);
  assert.deepStrictEqual(inFollow.slice(0, 3).sort(), ["J12", "J13", "J14"], "the start kicks every queued job: " + inFollow.join(","));
  assert.ok(inFollow.slice(3).every((j) => j === "J12"), "the follow's re-kicks start the oldest waiting job only: " + inFollow.join(","));
  ok("the follow starts every job once, then re-kicks one run for the oldest waiting job");

  // 8. a background check that never answers is given up and the beats go on
  log = await convert({ jobs: ["J15", "J16"], done: (j, k) => (k >= 3 ? "COMPLETED" : "COMMITTING_GD"), silentChecks: 2 });
  await waitFor(() => after(log, "J16") >= 3, 3000);
  assert.ok(after(log, "J15") >= 3 && after(log, "J16") >= 3, "beats went on past two silent checks: " + after(log, "J15") + "/" + after(log, "J16"));
  ok("a check with no answer is given up after READ_GIVE_UP_MS and the background starts go on");
  console.log(n + " passed");
})().catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; });
