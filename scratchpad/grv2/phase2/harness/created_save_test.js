// onClick_save_as_created old vs new: the params each sends (identical apart from the Add-only idempotency key),
// the key stable across the 401 / 402 re-sends and across re-clicks after an error or a timeout, and the
// GR_CREATED duplicate answer closing the dialog like any 200.  usage: node created_save_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const { makeForm, runCode, settle } = require("./mock");
console.log = () => {};
console.error = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const H = path.join(__dirname, "..");
const OLD = fs.readFileSync(path.join(H, "dev_handlers/onClick_save_as_created__itvd5pnc.js"), "utf8");
const NEW = fs.readFileSync(path.join(H, "new_handlers/onClick_save_as_created.js"), "utf8");
let fails = 0;
const check = (label, cond, extra) => {
  out((cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};
const KEY_RE = /^[A-Za-z0-9:_.-]{8,128}$/;

// one form (one page open); each click runs the handler once; answers are handed out in order
function page(code, pageStatus) {
  const answers = [];
  const calls = [];
  const events = [];
  const form = makeForm({ id: pageStatus === "Edit" ? "GR1" : "", page_status: pageStatus, gr_status: pageStatus === "Edit" ? "Created" : "Draft", table_gr: [{ item_id: "I1", received_qty: 1 }] }, { mode: pageStatus });
  form.parentGenerateForm = { $refs: { SuPageDialogRef: { hide: () => events.push("dialog closed") } }, refresh: () => events.push("list refreshed") };
  form.runWorkflow = (id, params, ok, err) => {
    // allData compared without _data (the new handler keeps its key there; the cache from func_processGRLineItem too)
    const { _data, ...allData } = params.allData || {};
    calls.push(JSON.parse(JSON.stringify({ ...params, allData })));
    const a = answers.shift();
    setTimeout(() => (a === "TIMEOUT" ? err(new Error("timeout")) : ok(a)), 0);
  };
  form.$confirm = () => Promise.resolve();
  return {
    click: async (...ans) => {
      answers.push(...ans);
      runCode(form, code);
      await settle(60);
    },
    calls,
    events,
    messages: () => form.__snapshot().messages,
  };
}

const R = (code, extra = {}) => ({ data: { code, ...extra } });
const SCRIPT = [
  // first click: zero-qty confirm -> over-commit confirm -> a 400
  [R("401", { msg: "Some lines have zero received quantity. Proceed?" }), R("402", { msg: "over-commit?" }), R("400", { msg: "Item X is not valid" })],
  // second click (after fixing): a timeout
  ["TIMEOUT"],
  // third click: the first attempt had in fact saved -> GR_CREATED answers the duplicate
  [R(200, { message: "Goods Receiving GR/1 was already saved as Created.", id: "2110", gr_no: "GR/1", duplicate: "YES" })],
];

(async () => {
  for (const pageStatus of ["Add", "Edit"]) {
    const runs = {};
    for (const [tag, code] of [["old", OLD], ["new", NEW]]) {
      const p = page(code, pageStatus);
      for (const answers of SCRIPT) await p.click(...answers);
      runs[tag] = p;
    }
    const strip = (c) => {
      const { idempotency_key, ...rest } = c;
      return rest;
    };
    const sameParams = JSON.stringify(runs.old.calls.map(strip)) === JSON.stringify(runs.new.calls.map(strip));
    check(`${pageStatus}: old and new send the same ${runs.new.calls.length} calls apart from the key`, sameParams && runs.old.calls.length === runs.new.calls.length,
      JSON.stringify(runs.new.calls.map((c) => [c.continueZero, c.continueOvercommit])));
    const keys = runs.new.calls.map((c) => c.idempotency_key);
    if (pageStatus === "Add") {
      check("Add: every call carries the key, one key for all re-sends and re-clicks, valid for GR_CREATED",
        keys.every((k) => k === keys[0]) && KEY_RE.test(keys[0]) && !keys[0].includes("#"), `${keys.length} calls, key ${keys[0]}`);
      check("Add: old sends no key", runs.old.calls.every((c) => !("idempotency_key" in c)));
    } else {
      check("Edit: no key sent (params identical to old)", runs.new.calls.every((c) => !("idempotency_key" in c)));
    }
    check(`${pageStatus}: the duplicate answer closes the dialog with its message (as a normal 200)`,
      runs.new.events.join(",") === "dialog closed,list refreshed" && runs.new.messages().slice(-1)[0] === "ok: Goods Receiving GR/1 was already saved as Created."
        && JSON.stringify(runs.old.messages()) === JSON.stringify(runs.new.messages()),
      JSON.stringify(runs.new.messages()));
  }
  // a new page (the next new GR) gets a new key
  const a = page(NEW, "Add");
  await a.click(R(200, { message: "ok" }));
  const b = page(NEW, "Add");
  await b.click(R(200, { message: "ok" }));
  check("a new page open makes a new key", a.calls[0].idempotency_key !== b.calls[0].idempotency_key, `${a.calls[0].idempotency_key} / ${b.calls[0].idempotency_key}`);
  out("failures:", fails);
  process.exit(fails ? 1 : 0);
})();
