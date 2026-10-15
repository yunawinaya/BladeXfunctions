// The PO form's save handlers, OLD (dev v847) vs NEW (patched), in a mock form runtime: validate calls, the payload sent,
// the prompts' re-sends (405 / 406 / 408 / 409 / 410), the 404 draft-cleanup retry, the live model left alone.
// Usage: node client_test.js <dev v847 form json> <patched form json> <template run json>
"use strict";
const fs = require("fs");
const L = require("./lib.js");

const [devFile, newFile, tplFile] = process.argv.slice(2);
const handlers = (file) => {
  const es = JSON.parse(fs.readFileSync(file, "utf8")).config.eventScript;
  return { issued: es.find((e) => e.name === "onClick_save_issued").func, draft: es.find((e) => e.name === "onClick_save_draft").func };
};
const OLD = handlers(devFile);
const NEW = handlers(newFile);
const tpl = L.loadRun(tplFile).allData;
const clone = (x) => JSON.parse(JSON.stringify(x));
let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "ok   " : "FAIL ") + name + (cond || !detail ? "" : "  " + detail));
  if (!cond) failures++;
};

function model(nLines, layers) {
  const m = clone(tpl);
  const tl = m.table_po[0];
  m.table_po = [];
  for (let i = 0; i < nLines; i++) {
    const l = clone(tl);
    l.fm_key = "fm" + i;
    l.quantity = (i % 5) + 1;
    let alt = JSON.stringify([{ alt_uom_id: "1", alt_qty: 1, base_qty: 1, base_uom_id: "1", purchase_unit_price: 2 }]);
    for (let k = 1; k < layers; k++) alt = JSON.stringify(alt);
    l.alt_uom = alt;
    l.table_uom_conversion = JSON.stringify([{ alt_uom_id: "1", base_qty: 1, big: "x".repeat(200) }]);
    m.table_po.push(l);
  }
  m.draft_status = "<div>draft</div>";
  m.issued_status = "<div>issued</div>";
  return m;
}

// answers: list of workflow answers, in call order: { ok: res } or { err: error }
async function runHandler(src, m, answers, confirmAnswer) {
  const calls = { validate: [], workflows: [], confirms: 0, alerts: 0, messages: [] };
  let pending = Promise.resolve();
  const ctx = {
    models: m,
    isEdit: false,
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide() {} } }, refresh() {} },
    getValues: () => m,
    getValue: (k) => m[k],
    showLoading() {},
    hideLoading() {},
    validate: async (paths) => {
      calls.validate.push(clone(paths));
    },
    $confirm: () => {
      calls.confirms++;
      return confirmAnswer === false ? Promise.reject(new Error("cancel")) : Promise.resolve();
    },
    $alert: async () => {
      calls.alerts++;
    },
    $message: { success: (x) => calls.messages.push("success:" + x), error: (x) => calls.messages.push("error:" + x), warning: () => {} },
    runWorkflow: (id, params, onOk, onErr) => {
      calls.workflows.push({ id: id, params: clone(params) });
      const a = answers.shift() || { ok: { data: { data: {} } } };
      const p = a.err ? onErr(a.err) : onOk(a.ok);
      pending = pending.then(() => p);
      return Promise.resolve(p);
    },
  };
  await new Function(src).call(ctx);
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  await pending;
  return calls;
}

(async () => {
  // 1. validate: one call with every quantity path, vs one call per line
  {
    const m = model(2000, 3);
    const o = await runHandler(OLD.issued, clone(m), []);
    const n = await runHandler(NEW.issued, clone(m), []);
    check("validate: OLD calls it once per line", o.validate.length === 2000, String(o.validate.length));
    check("validate: NEW calls it once with all 2,000 quantity paths", n.validate.length === 1 && n.validate[0].length === 2000 && n.validate[0][1999] === "table_po.1999.quantity",
      JSON.stringify(n.validate.map((x) => x.length)));
    const po = o.workflows[0].params.allData;
    const pn = n.workflows[0].params.allData;
    const sz = (x) => JSON.stringify(x).length;
    check("payload: NEW smaller (3-layer alt_uom, 2,000 lines): " + sz(po) + " -> " + sz(pn) + " bytes", sz(pn) < sz(po));
    // the same payload, field for field, except the deliberate drops / alt_uom layer
    const drops = ["table_uom_conversion", "supplier_id", "plant_id", "payment_term_id", "shipping_preference_id", "billing_state_id", "billing_country_id",
      "shipping_state_id", "shipping_country_id", "organization_id", "po_created_by"];
    let bad = null;
    po.table_po.forEach((l, i) => {
      const x = clone(l);
      for (const k of drops) delete x[k];
      let a = x.alt_uom;
      while (typeof a === "string") a = JSON.parse(a);
      x.alt_uom = JSON.stringify(a.map((c) => ({ alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id })));
      if (!bad && JSON.stringify(x) !== JSON.stringify(pn.table_po[i])) bad = i;
    });
    check("payload: lines identical except the dropped copies and one alt_uom layer", bad === null, "line " + bad);
    const hdr = (p) => Object.keys(p).filter((k) => k !== "table_po").sort().join(",");
    check("payload: header identical", hdr(po) === hdr(pn) && Object.keys(po).every((k) => k === "table_po" || JSON.stringify(po[k]) === JSON.stringify(pn[k])));
  }
  // 2. the prompts re-send the same slim object with their flag; the 404 retry too
  for (const [label, answer, flag] of [
    ["405 zero-total PI", { ok: { data: { data: { pi_confirm: 405, msg: "x" } } } }, "create_pi"],
    ["406 not eligible", { ok: { data: { data: { so_confirm: 406, msg: "x" } } } }, "auto_so_skip"],
    ["408 eligible", { ok: { data: { data: { so_confirm: 408, msg: "x" } } } }, "auto_so_confirmed"],
    ["409 unlink", { ok: { data: { data: { so_confirm: 409, msg: "x" } } } }, "unlink_confirmed"],
    ["410 swap", { ok: { data: { data: { so_confirm: 410, msg: "x" } } } }, "swap_confirmed"],
  ]) {
    const m = model(3, 2);
    const o = await runHandler(OLD.issued, clone(m), [clone(answer)]);
    const n = await runHandler(NEW.issued, clone(m), [clone(answer)]);
    const sent = n.workflows.map((w) => w.params.allData);
    check("prompt " + label + ": re-sent once with " + flag + ", same slim payload otherwise",
      n.workflows.length === 2 && o.workflows.length === 2 && sent[1][flag] !== undefined && sent[1][flag] !== sent[0][flag] &&
        JSON.stringify(Object.assign({}, sent[1], { [flag]: sent[0][flag] })) === JSON.stringify(sent[0]) && sent[1].table_po[0].table_uom_conversion === undefined,
      JSON.stringify(n.workflows.map((w) => Object.keys(w.params.allData).length)));
  }
  {
    const m = model(3, 2);
    const err = { err: { data: { code: 404, msg: "drafts" } } };
    const n = await runHandler(NEW.issued, clone(m), [err, { ok: {} }, { ok: { data: { data: {} } } }]);
    check("404 drafts: cleanup workflow, then the same slim payload again",
      n.workflows.length === 3 && n.workflows[1].id === "1998576990124572673" && JSON.stringify(n.workflows[2].params) === JSON.stringify(n.workflows[0].params),
      JSON.stringify(n.workflows.map((w) => w.id)));
    const c = await runHandler(NEW.issued, clone(m), [{ ok: { data: { data: { so_confirm: 406, msg: "x" } } } }], false);
    check("406 cancelled: nothing re-sent", c.workflows.length === 1);
  }
  // 3. the live model: only po_status changes (as before)
  {
    const m = model(3, 2);
    const before = JSON.stringify(Object.assign({}, m, { po_status: "Issued" }));
    await runHandler(NEW.issued, m, []);
    check("issued: the form model is not modified (other than po_status, as before)", JSON.stringify(m) === before);
  }
  // 4. empty table: no validate call at all (as before), required-field gate answers
  {
    const m = model(0, 1);
    const n = await runHandler(NEW.issued, clone(m), []);
    check("no lines: validate not called (validate([]) would check the whole form)", n.validate.length === 0, JSON.stringify(n.validate));
  }
  // 5. draft
  {
    const m = model(4, 3);
    const o = await runHandler(OLD.draft, clone(m), []);
    const n = await runHandler(NEW.draft, clone(m), []);
    const a = o.workflows[0].params.allData;
    const b = n.workflows[0].params.allData;
    check("draft: same status / header, slim lines", a.po_status === "Draft" && b.po_status === "Draft" && b.table_po.length === 4 && b.table_po[0].table_uom_conversion === undefined &&
      b.draft_status === undefined && a.draft_status === undefined);
  }
  console.log("client checks failures:", failures);
  process.exit(failures ? 1 : 0);
})();
