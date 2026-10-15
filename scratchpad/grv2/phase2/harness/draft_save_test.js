// onClick_save_as_draft old vs new: what each writes, and the new Processing guard.
// usage: node draft_save_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const { makeDb, makeForm, runCode, settle, install } = require("./mock");
console.log = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const H = path.join(__dirname, "..");
const OLD = fs.readFileSync(path.join(H, "dev_handlers/onClick_save_as_draft__plc4vfy4.js"), "utf8");
const NEW = fs.readFileSync(path.join(H, "new_handlers/onClick_save_as_draft.js"), "utf8");
let fails = 0;
const check = (label, cond, extra) => {
  out((cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

const stored = { id: "GR1", gr_status: "Draft", gr_no: "Draft-GR-1", gr_v2_job_id: "2110000000000000001", gr_idem_key: "GRC:1:GR1:abc:1#uuid", plant_id: "P1" };
const formModels = (status) => ({
  id: "GR1",
  gr_no: "Draft-GR-1",
  gr_status: status,
  plant_id: "P1",
  organization_id: "O1",
  page_status: "Edit",
  gr_v2_job_id: "", // what a form opened before the job (or a copy) holds
  gr_idem_key: "",
  _data: { gr_item_tol: { 1: 0 } },
  dialog_select_item: { table: new Array(3).fill({ x: 1 }) },
  split_dialog: { table_split: [] },
  table_gr: [{ item_id: "I1", received_qty: 1, line_index: 1 }],
});

(async () => {
  for (const [tag, code] of [["old", OLD], ["new", NEW]]) {
    for (const storedStatus of ["Draft", "Processing"]) {
      const tables = { goods_receiving: [{ ...stored, gr_status: storedStatus }] };
      const dbApi = makeDb(tables);
      install(dbApi);
      const form = makeForm(formModels("Draft"), { mode: "Edit", globals: { deptParentId: "O1" }, system: { deptIds: "O1" } });
      form.parentGenerateForm = { $refs: { SuPageDialogRef: { hide() {} } }, refresh() {} };
      runCode(form, code);
      await settle(200);
      const upd = dbApi.log.filter((l) => l.key === "goods_receiving:update");
      const row = tables.goods_receiving[0];
      const sent = upd[0] ? Object.keys(upd[0].obj) : [];
      out(`   ${tag} stored=${storedStatus}: updates ${upd.length}, keys sent ${sent.length}, sends gr_v2_job_id ${sent.includes("gr_v2_job_id")}, dialogs/_data ${["_data", "dialog_select_item", "split_dialog"].filter((k) => sent.includes(k))}, stored after: status ${row.gr_status}, job ${row.gr_v2_job_id ? "kept" : "BLANKED"}, idem ${row.gr_idem_key ? "kept" : "BLANKED"}, messages ${JSON.stringify(form.__snapshot().messages)}`);
      if (tag === "new") {
        if (storedStatus === "Processing") check("new: a Processing receipt is refused, nothing written", upd.length === 0 && row.gr_status === "Processing");
        else check("new: Draft save keeps the stored job id / idempotency key and drops dialog + _data models", upd.length === 1 && !!row.gr_v2_job_id && !!row.gr_idem_key && !sent.includes("_data") && !sent.includes("dialog_select_item") && sent.includes("table_gr"));
      }
    }
  }
  // Add: nothing to keep, the two keys are simply not sent
  const tables = { goods_receiving: [] };
  const dbApi = makeDb(tables);
  install(dbApi);
  const form = makeForm({ ...formModels("Draft"), id: "", page_status: "Add", gr_no: "" }, { mode: "Add", globals: { deptParentId: "O1" }, system: { deptIds: "O1" } });
  form.parentGenerateForm = { $refs: { SuPageDialogRef: { hide() {} } }, refresh() {} };
  runCode(form, NEW);
  await settle(200);
  const add = dbApi.log.filter((l) => l.key === "goods_receiving:add");
  check("new Add: one add, without the two keys, gr_no 'draft'", add.length === 1 && !("gr_v2_job_id" in add[0].obj) && !("gr_idem_key" in add[0].obj) && add[0].obj.gr_no === "draft");
  out("failures:", fails);
  process.exit(fails ? 1 : 0);
})();
