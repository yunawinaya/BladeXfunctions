// The switched-on GR handlers, taken from the repo paste files, run against a mocked form / list: every server answer
// GR_COMPLETE_SUBMIT and GR_REVERT_SUBMIT can give, and the classic fallbacks.  node test_handlers.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const handler = (doc, name) => doc.config.eventScript.find((e) => e.name === name);

const grForm = read("Goods Receiving/GRfullJSON.json");
const grList = read("Bulk Actions/Procurement/Goods Receiving/GRlistPageJSON.json");
const pwForm = read("Putaway/PutawayFullJSON.json");
const pwList = read("Putaway/PutawayListPageJSON.json");
const GRC = handler(grForm, "grc_onClick_completed").func;
const GRV = handler(grList, "RevertCompletedGR").func;

let passes = 0, fails = 0;
const ok = (c, what, x) => { if (c) passes++; else { fails++; process.stdout.write("FAIL " + what + " " + (x === undefined ? "" : JSON.stringify(x).slice(0, 500)) + "\n"); } };
console.log = () => {};
const quietError = console.error;
console.error = () => {};
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 30; i++) await tick(); };

// ------------------------------------------------------------------ the wiring in the paste files
{
  const btn = JSON.stringify(grForm).match(/"model":"button_save_as_comp"/) ? null : null;
  const find = (n, m) => { if (n && typeof n === "object") { if (n.model === m) return n; for (const v of Object.values(n)) { const r = find(v, m); if (r) return r; } } return null; };
  const b = find(grForm, "button_save_as_comp");
  ok(b.events.onClick === handler(grForm, "grc_onClick_completed").key, "GR form: Save as Completed runs grc_onClick_completed");
  ok(!!handler(grForm, "onClick_workflowCompleted"), "GR form: the classic handler is still there for the fallback");
  ok(/const ASYNC_COMPLETE_ENABLED = true;/.test(GRC) && /SUBMIT: "2110545633913245697"/.test(GRC), "GR form: switch on, SUBMIT id");
  ok(/const ASYNC_REVERT_ENABLED = true;/.test(GRV) && /SUBMIT: "2110563805617885185"/.test(GRV) && /WORKER: "2110563842980745217"/.test(GRV), "GR list: switch on, ids");
  const m = handler(grList, "mounted").func;
  ok(m.indexOf('"2110545675948560386"; // GR_COMPLETE_WORKER') > 0 && m.indexOf('"2110563842980745217"; // GR_REVERT_WORKER') > 0, "GR list mounted: both workers kicked");
  const pw = handler(pwForm, "pwV2_onClick_completed").func;
  ok(/const ASYNC_PUTAWAY_ENABLED = true;/.test(pw) && /SUBMIT: "2110545826201112577"/.test(pw) && /WORKER: "2110545857423511553"/.test(pw), "Putaway form: switch on, ids");
  ok(handler(pwList, "mounted").func.indexOf('"2110545857423511553"; // PUTAWAY_ASYNC_WORKER') > 0, "Putaway list mounted: worker kicked");
  for (const [n, f] of [["grc", GRC], ["grv", GRV], ["pwv2", pw], ["grlist mounted", m], ["pwlist mounted", handler(pwList, "mounted").func]]) {
    try { new Function(f); ok(true); } catch (e) { ok(false, n + " does not parse", e.message); }
  }
}

// ------------------------------------------------------------------ GR form: grc_onClick_completed
const grValues = (n, extra) => Object.assign({
  page_status: "Add", id: "", organization_id: "1123598813738675201", gr_status: "Draft", gr_v2_job_id: "", gr_idem_key: "x", _data: {}, dialog_select_item: {},
  table_gr: Array.from({ length: n }, (_, i) => ({ item_id: "I" + i, received_qty: 1 })),
}, extra || {});
function grFormMock(values, answers) {
  const calls = [];
  const self = {
    calls, models: { _data: {} }, hidden: [], messages: [], triggered: [], loading: 0, closed: 0, confirms: 0, refreshed: 0,
    getValues: () => JSON.parse(JSON.stringify(values)),
    showLoading() { this.loading++; }, hideLoading() { this.loading = 0; },
    hide(p) { this.hidden.push(...p); },
    triggerEvent(name) { this.triggered.push(name); return Promise.resolve(); },
    $message: Object.assign((m) => self.messages.push(["msg", m]), { success: (m) => self.messages.push(["success", m]), error: (m) => self.messages.push(["error", m]), warning: (m) => self.messages.push(["warning", m]) }),
    $confirm() { this.confirms++; return answers.confirm === false ? Promise.reject(new Error("cancel")) : Promise.resolve(); },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => self.closed++ } }, refresh: () => self.refreshed++ },
    runWorkflow(id, params, ok_, err) {
      calls.push({ id, params: JSON.parse(JSON.stringify(params)) });
      const a = answers.byCall && answers.byCall[calls.length - 1];
      const ans = a !== undefined ? a : id === "2110545675948560386" ? { data: { processed: "1" } } : answers.submit;
      setTimeout(() => (ans === "THROW" ? err(new Error("network")) : ok_(ans)), 0);
    },
  };
  return self;
}
const runGrc = async (values, answers, preset) => {
  const f = grFormMock(values, answers);
  if (preset) Object.assign(f.models._data, preset);
  new Function(GRC).call(f);
  await settle();
  return f;
};
const submits = (f) => f.calls.filter((c) => c.id === "2110545633913245697");
const Q = (o) => ({ data: Object.assign({ route: "QUEUED", code: "200", job_id: "J1", gr_no: "GR/1", job_status: "QUEUED" }, o || {}) });

(async () => {
  let f = await runGrc(grValues(3), { submit: Q() });
  const s = submits(f);
  ok(s.length === 1 && s[0].params.operation === "SUBMIT" && s[0].params.page_status === "Add" && s[0].params.gr_id === "" && s[0].params.answers.continueZero === "", "grc: one SUBMIT", s);
  ok(!("gr_v2_job_id" in s[0].params.form) && !("_data" in s[0].params.form) && !("dialog_select_item" in s[0].params.form) && s[0].params.form.table_gr.length === 3, "grc: workflow-owned keys and dialogs not sent");
  ok(/^GRC:1123598813738675201:new-[a-z0-9]+:[0-9a-f]{16}:1$/.test(s[0].params.idempotency_key), "grc: key shape", s[0].params.idempotency_key);
  ok(f.hidden.join() === "button_save_as_draft,button_save_as_created,button_save_as_comp" && f.closed === 1 && f.messages.some((m) => m[0] === "success"), "grc QUEUED: buttons hidden, dialog closed, success");
  ok(f.calls.some((c) => c.id === "2110545675948560386" && c.params.job_id === "J1"), "grc QUEUED: worker started for the job");
  ok(f.triggered.length === 0 && f.models._data.grc_submitting === 0, "grc QUEUED: no classic save, released");

  f = await runGrc(grValues(3), { submit: { data: { route: "NOT_ELIGIBLE", reason: "serial items" } } });
  ok(f.triggered.join() === "onClick_workflowCompleted" && f.hidden.length === 0, "grc NOT_ELIGIBLE -> classic save", f.triggered);

  f = await runGrc(grValues(3), { byCall: [{ data: { route: "STOP", code: "401", message: "zero qty?" } }, Q()] });
  ok(submits(f).length === 2 && submits(f)[1].params.answers.continueZero === "Yes" && submits(f)[1].params.idempotency_key === submits(f)[0].params.idempotency_key && f.confirms === 1, "grc 401 -> confirm -> resubmit continueZero Yes, same key");

  f = await runGrc(grValues(3), { byCall: [{ data: { route: "STOP", code: "401", message: "zero qty?" } }], confirm: false });
  ok(submits(f).length === 1 && f.models._data.grc_submitting === 0 && f.loading === 0, "grc 401 cancelled -> nothing more, released");

  f = await runGrc(grValues(3), { submit: { data: { route: "STOP", code: "400", message: "Location is required" } } });
  ok(f.messages.some((m) => m[0] === "error" && m[1] === "Location is required") && f.models._data.grc_submitting === 0 && f.closed === 0, "grc 400 -> its message, released");

  f = await runGrc(grValues(3), { submit: { data: { route: "STATUS", job_status: "FAILED", error_message: "PO changed" } } });
  ok(f.messages.some((m) => m[0] === "error" && m[1] === "PO changed") && f.models._data.grc_gen === 2, "grc FAILED status -> its reason, next click = next generation");

  f = await runGrc(grValues(3), { submit: { data: { route: "STATUS", job_status: "FAILED", error_message: "PO changed" } } }, { grc_gen: 2, grc_page_token: "tok" });
  ok(/:2$/.test(submits(f)[0].params.idempotency_key), "grc: the generation is in the key", submits(f)[0].params.idempotency_key);

  f = await runGrc(grValues(3), { submit: { data: { route: "STATUS", job_status: "COMPLETED", gr_no: "GR/1" } } });
  ok(f.closed === 1 && f.messages.some((m) => m[0] === "success"), "grc COMPLETED status -> closes");

  f = await runGrc(grValues(3), { submit: { data: { route: "BUSY", message: "being processed" } } });
  ok(f.messages.some((m) => m[0] === "warning") && f.closed === 0, "grc BUSY -> warning");

  f = await runGrc(grValues(2501), { submit: Q() });
  ok(submits(f).length === 0 && f.messages.some((m) => m[0] === "error" && /2501 lines/.test(m[1])), "grc > 2,500 lines -> refused before SUBMIT");

  f = await runGrc(grValues(3), { byCall: ["THROW", Q()] });
  ok(submits(f).length === 2 && submits(f)[0].params.idempotency_key === submits(f)[1].params.idempotency_key && f.closed === 1, "grc lost answer -> once more with the same key");

  f = await runGrc(grValues(3), { submit: Q() }, { grc_submitting: 1 });
  ok(submits(f).length === 0 && f.messages.some((m) => m[0] === "warning"), "grc double click -> warning only");

  f = await runGrc(grValues(3, { page_status: "View" }), { submit: Q() });
  ok(submits(f).length === 0 && f.triggered.join() === "onClick_workflowCompleted", "grc view page -> classic");

  f = await runGrc(grValues(3, { page_status: "Edit", id: "2110637388722647042" }), { submit: Q() });
  ok(submits(f)[0].params.gr_id === "2110637388722647042" && /^GRC:1123598813738675201:2110637388722647042:/.test(submits(f)[0].params.idempotency_key), "grc Edit -> gr_id + key on the id");

  const k1 = (await runGrc(grValues(3), { submit: Q() }, { grc_page_token: "t" })).calls[0].params.idempotency_key;
  const k2 = (await runGrc(grValues(3), { submit: Q() }, { grc_page_token: "t" })).calls[0].params.idempotency_key;
  const k3 = (await runGrc(grValues(4), { submit: Q() }, { grc_page_token: "t" })).calls[0].params.idempotency_key;
  ok(k1 === k2 && k1 !== k3, "grc key: same content same key, new content new key");

  // ---------------------------------------------------------------- GR list: RevertCompletedGR
  const rec = (id, o) => Object.assign({ id, gr_no: "GR/" + id, gr_status: "Completed", organization_id: "9", pi_status: "", return_status: "", posted_status: "", putaway_status: "Completed" }, o || {});
  async function runGrv(selected, answers) {
    const calls = [];
    const self = {
      calls, messages: [], alerts: 0, alertTexts: [], refreshed: 0, loading: 0, confirmed: 0,
      getComponent: () => ({ $refs: { crud: { tableSelect: selected } } }),
      showLoading() { this.loading++; }, hideLoading() { this.loading = 0; }, refresh() { this.refreshed++; },
      $message: Object.assign((m) => self.messages.push(["msg", typeof m === "object" ? m.type + ":" + m.message : m]), { success: (m) => self.messages.push(["success", m]), error: (m) => self.messages.push(["error", m]) }),
      $confirm() { this.confirmed++; return answers.confirm === false ? Promise.reject(new Error("x")) : Promise.resolve(); },
      $alert(m) { this.alerts++; this.alertTexts.push(m); return Promise.resolve(); },
      runWorkflow(id, params, ok_, err) {
        calls.push({ id, params });
        let ans;
        if (id === "2110563805617885185" && params.operation === "STATUS") ans = (answers.status || (() => ({ data: { route: "STATUS", job_status: "QUEUED" } })))(params.gr_id);
        else if (id === "2110563805617885185") ans = answers.submit(params.gr_id);
        else if (id === "2110563842980745217") ans = { data: { processed: calls.filter((c) => c.id === id).length === 1 ? "1" : "0" } };
        else if (id === "2095079401411117057") ans = { data: { code: "200" } };
        setTimeout(() => ok_(ans), 0);
      },
    };
    global.db = { collection: () => ({ doc: (id) => ({ get: async () => ({ data: [rec(id)] }) }) }) };
    new Function(GRV).call(self);
    await settle();
    return self;
  }
  const sub = (s) => s.calls.filter((c) => c.id === "2110563805617885185" && c.params.operation === "SUBMIT");
  const stat = (s) => s.calls.filter((c) => c.id === "2110563805617885185" && c.params.operation === "STATUS");
  let g = await runGrv([rec("1"), rec("2")], { submit: () => ({ data: { route: "QUEUED", job_status: "QUEUED" } }) });
  ok(sub(g).length === 2 && sub(g).every((c) => c.params.operation === "SUBMIT" && c.params.source === "LIST" && /^GRV:9:\d:/.test(c.params.idempotency_key)), "grv: one SUBMIT per receipt", sub(g).map((c) => c.params));
  ok(g.calls.some((c) => c.id === "2110563842980745217") && g.messages.some((m) => m[0] === "success" && /2 Goods Receiving are being reverted/.test(m[1])), "grv QUEUED -> worker started, background message", g.messages);
  ok(!g.calls.some((c) => c.id === "2095079401411117057"), "grv QUEUED -> no classic revert");

  g = await runGrv([rec("1")], { submit: () => ({ data: { route: "NOT_ELIGIBLE", reason: "handling units" } }) });
  ok(g.calls.some((c) => c.id === "2095079401411117057" && c.params.gr_id === "1") && g.messages.some((m) => m[0] === "success" && /All 1/.test(m[1])), "grv NOT_ELIGIBLE -> classic revert", g.messages);

  // after the worker's tick: the queued receipts' jobs are asked once; a refusal found in the background is shown, as the classic showed it
  g = await runGrv([rec("1"), rec("2")], { submit: () => ({ data: { route: "QUEUED", job_status: "QUEUED" } }),
    status: (id) => ({ data: id === "1" ? { route: "STATUS", job_status: "FAILED", error_message: "Revert blocked: Item <A> has been used" } : { route: "STATUS", job_status: "COMPLETED" } }) });
  ok(stat(g).length === 2 && stat(g).every((c, i) => c.params.idempotency_key === sub(g)[i].params.idempotency_key), "grv after the tick: STATUS of each queued receipt, same key as its SUBMIT", stat(g).map((c) => c.params));
  ok(g.alerts === 1 && /^GR\/1: Revert blocked: Item &lt;A&gt; has been used$/.test(g.alertTexts[0]), "grv background refusal -> one alert, reason escaped; the completed one not listed", g.alertTexts);
  g = await runGrv([rec("1")], { submit: () => ({ data: { route: "QUEUED" } }), status: () => ({ data: { route: "STATUS", job_status: "REQUIRES_REVIEW", progress_message: "Under review: the revert stopped half-way" } }) });
  ok(g.alerts === 1 && /GR\/1: Under review/.test(g.alertTexts[0]), "grv REQUIRES_REVIEW -> alert", g.alertTexts);
  g = await runGrv([rec("1")], { submit: () => ({ data: { route: "QUEUED" } }), status: () => ({ data: { route: "STATUS", job_status: "COMMITTING_REVERT" } }) });
  ok(g.alerts === 0 && stat(g).length === 2, "grv still running -> no alert, asked again after the next tick", stat(g).length);
  g = await runGrv([rec("1")], { submit: () => ({ data: { route: "NOT_ELIGIBLE", reason: "handling units" } }) });
  ok(stat(g).length === 0, "grv classic revert -> no STATUS asked");

  g = await runGrv([rec("1"), rec("2")], { submit: (id) => ({ data: id === "1" ? { route: "QUEUED" } : { route: "STATUS", job_status: "FAILED", error_message: "stock used <b>" } }) });
  ok(g.messages.some((m) => m[0] === "msg" && /0 reverted, 1 being reverted in the background, 1 failed/.test(m[1]) && /stock used &lt;b&gt;/.test(m[1])), "grv mixed -> counts, reason escaped", g.messages);

  g = await runGrv([rec("1", { pi_status: "Issued" }), rec("2", { gr_status: "Created" })], { submit: () => ({ data: { route: "QUEUED" } }) });
  ok(sub(g).length === 0 && g.messages.some((m) => m[0] === "msg" && /None of the selected/.test(m[1])), "grv invoiced / not a receipt -> nothing submitted", g.messages);

  g = await runGrv([rec("1")], { submit: () => ({ data: { route: "QUEUED" } }), confirm: false });
  ok(sub(g).length === 0 && g.loading === 0, "grv cancelled confirm -> nothing submitted");

  g = await runGrv([], { submit: () => ({ data: { route: "QUEUED" } }) });
  ok(sub(g).length === 0 && g.messages.some((m) => m[0] === "error"), "grv no selection -> error");

  console.error = quietError;
  process.stdout.write("switch-on handler tests: " + passes + " passed, " + fails + " failed\n");
  process.exit(fails ? 1 : 0);
})();
