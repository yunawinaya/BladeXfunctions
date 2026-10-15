// The 2k live GR requests as the browser would send them: the PO_Convert_GR answer opened in the Add form, the form's own
// func_processGRLineItem (from Goods Receiving/GRfullJSON.json) run in the phase-2 mock on real dev tables, and the header
// fields the form fills on open (numbering, addresses) taken from a recorded browser save in the same plant.
// usage: node build_gr2k_payload.js <tables.json> <convert.out.json> <template_wp.json> <out_dir>
"use strict";
const fs = require("fs");
const path = require("path");
const { makeDb, makeForm, runCode, settle, install } = require("../phase2/harness/mock");

const [TABLES, CONVERT, TEMPLATE, OUT] = process.argv.slice(2);
const REPO = path.join(__dirname, "..", "..", "..");
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
console.log = () => {};
console.warn = () => {};

const form = JSON.parse(fs.readFileSync(path.join(REPO, "Goods Receiving/GRfullJSON.json"), "utf8"));
const handler = (name) => form.config.eventScript.find((e) => e.name === name).func;
const tables = JSON.parse(fs.readFileSync(TABLES, "utf8"));
const conv = JSON.parse(fs.readFileSync(CONVERT, "utf8")).data;
const gr = (conv.data || conv).gr_data;
const tmpl = JSON.parse(fs.readFileSync(TEMPLATE, "utf8")).allData;

async function waitIdle(f, dbApi) {
  let last = "";
  for (let i = 0; i < 4000; i++) {
    await settle(i < 5 ? 60 : 120);
    const now = JSON.stringify(f.__snapshot().counts) + dbApi.log.length;
    if (now === last) return;
    last = now;
  }
  throw new Error("never idle");
}

(async () => {
  // header: the recorded save's form-filled fields, then everything the conversion answers
  const header = { ...tmpl };
  delete header.table_gr;
  const sameSupplier = String(header.supplier_name) === String(gr.supplier_name);
  // the numbering rule is filled by the form on open, not by the conversion
  const models = { ...header, ...gr, gr_no_type: gr.gr_no_type || header.gr_no_type, gr_no: "", gr_status: "Draft", previous_status: "", page_status: "Add" };
  if (!sameSupplier) {
    Object.keys(models).filter((k) => /^(billing|shipping)_|^supplier_(contact|email)|^gr_(billing|shipping)_address$/.test(k)).forEach((k) => (models[k] = ""));
  }
  const dbApi = makeDb(tables, { latency: 0 });
  install(dbApi);
  const f = makeForm(models, { mode: "Add", handlers: {}, globals: { deptParentId: "0", nickname: "admin" }, system: { deptIds: String(gr.organization_id) } });
  globalThis.window.validationState = {};
  runCode(f, handler("func_processGRLineItem"));
  await waitIdle(f, dbApi);
  const data = JSON.parse(JSON.stringify(f.__snapshot().models));

  const rows = data.table_gr || [];
  const keysOf = (r) => Object.keys(r).filter((k) => k !== "fm_key").sort();
  const want = keysOf(tmpl.table_gr[0]);
  const missing = want.filter((k) => !(k in rows[0]));
  const extra = keysOf(rows[0]).filter((k) => !want.includes(k));
  out("rows", rows.length, "| supplier same as template:", sameSupplier, "| line keys missing vs browser:", JSON.stringify(missing), "extra:", JSON.stringify(extra));
  const tally = (k) => JSON.stringify(rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {}));
  out("inv_category", tally("inv_category"), "| location_id", tally("location_id"), "| item_batch_no", tally("item_batch_no"), "| costing", tally("item_costing_method"));
  out("sum received", rows.reduce((s, r) => s + Number(r.received_qty || 0), 0), "| _data keys", JSON.stringify(Object.keys(data._data || {})));

  // Save as Created (onClick_save_as_created): getValues() as is
  const stamp = Date.now().toString(36);
  const created = { allData: data, saveAs: "Created", pageStatus: "Add", continueZero: "", continueOvercommit: "", idempotency_key: "GRCR-" + stamp + "-live2k" };
  fs.writeFileSync(path.join(OUT, "gr2k_created_req.json"), JSON.stringify(created));

  // Save as Completed V2 (grc_onClick_completed): recordOf + idemKey, lifted from the handler itself
  const grc = fs.readFileSync(path.join(REPO, "Goods Receiving/CompleteV2/grc_onClick_completed.js"), "utf8");
  const ctx = { models: { _data: { grc_page_token: "live2k" + stamp } } };
  const fns = new Function(grc.slice(grc.indexOf("const NOT_RECORD"), grc.indexOf("const kick")) + "\nreturn { recordOf, idemKey };").call(ctx);
  const rec = fns.recordOf(data);
  const submit = { operation: "SUBMIT", page_status: "Add", gr_id: "", idempotency_key: fns.idemKey(rec, 1), answers: { continueZero: "" }, form: rec };
  fs.writeFileSync(path.join(OUT, "gr2k_submit_req.json"), JSON.stringify(submit));
  out("created req", JSON.stringify(created).length, "bytes | submit req", JSON.stringify(submit).length, "bytes | key", submit.idempotency_key);
})().catch((e) => {
  process.stderr.write(String(e.stack || e) + "\n");
  process.exit(2);
});
