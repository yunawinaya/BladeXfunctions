// pwV2_onClick_completed (as embedded in the repo Putaway form): the SUBMIT request carries the form's attachments.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");
const form = JSON.parse(fs.readFileSync(path.join(ROOT, "Putaway", "PutawayFullJSON.json"), "utf8"));
const CODE = form.config.eventScript.find((e) => e.name === "pwV2_onClick_completed").func;
let pass = 0, fail = 0;
const ok = (c, what, x) => { if (c) pass++; else { fail++; console.log("FAIL", what, JSON.stringify(x).slice(0, 300)); } };
console.log = () => {};
const file = { key: "a.jpeg", url: "https://x/a.jpeg", name: "a.jpeg" };
async function run(refDoc) {
  const model = { id: "2110625387005267969", to_id: "TRF-1", page_status: "Edit", to_status: "Created", organization_id: "7", update_time: "2026-10-16 10:00:00",
    ref_doc: refDoc, table_putaway_item: [{ id: "11", putaway_qty: 2, target_location: "5", storage_location: "6", target_inv_category: "Unrestricted", line_status: "Open" }] };
  const calls = [];
  const self = {
    models: { _data: {} }, getValue: (k) => model[k], getVarGlobal: () => "admin", showLoading() {}, hideLoading() {}, hide() {}, triggerEvent: async () => {},
    $message: Object.assign(() => {}, { success() {}, error() {}, warning() {} }), parentGenerateForm: null,
    runWorkflow: (id, p, okCb) => { calls.push({ id, p }); setTimeout(() => okCb({ data: { route: "QUEUED", job_id: "9", job_status: "QUEUED" } }), 0); },
  };
  new Function(CODE).call(self, {});
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
  return calls.find((c) => c.p && c.p.operation === "SUBMIT");
}
(async () => {
  let s = await run([file]);
  ok(s && Array.isArray(s.p.request.ref_doc) && s.p.request.ref_doc[0].url === file.url && s.p.request.lines.length === 1, "form with a file: request.ref_doc sent", s && s.p.request);
  const k1 = s.p.idempotency_key;
  s = await run(JSON.stringify([file]));
  ok(s && s.p.request.ref_doc && s.p.request.ref_doc[0].url === file.url && s.p.idempotency_key === k1, "the field as a JSON string: same list, same key", s && s.p);
  s = await run(null);
  ok(s && !("ref_doc" in s.p.request), "no attachment field value: ref_doc not sent (the stored list stays)", s && s.p.request);
  ok(s.p.idempotency_key !== k1, "different attachments: different key", [k1, s.p.idempotency_key]);
  s = await run([]);
  ok(s && Array.isArray(s.p.request.ref_doc) && s.p.request.ref_doc.length === 0, "all files removed: [] sent (clears the list)", s && s.p.request);
  process.stdout.write("desktop handler ref_doc: " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
