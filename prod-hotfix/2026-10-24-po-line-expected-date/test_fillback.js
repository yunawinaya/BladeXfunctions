// test_fillback.js <PO_SAVE.json>: runs that file's code_fillback with its placeholders filled and checks each line's
// po_expected_date: '' (what the form sends), null and a missing key take the header date; a line's own date is kept.
const fs = require("fs"), assert = require("assert");
const w = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const code = find(w, "code_fillback").data.script.code;
const HDR = "2026-10-26 00:00:00", OWN = "2026-11-09 00:00:00";
const line = (n, extra) => Object.assign({ id: "", line_index: n, item_id: "9" + n, quantity: 1, unit_price: 1, received_qty: 0 }, extra);
const entry = { id: "", po_status: "Issued", po_expected_date: HDR, organization_id: "1", plant_id: "2",
  table_po: [line(1, { po_expected_date: "" }), line(2, { po_expected_date: null }), line(3, {}), line(4, { po_expected_date: OWN })] };
// each placeholder becomes a parameter of the node's body; the test values are passed as arguments
const fill = {
  "{{workflowparams:allData}}": entry, "{{global:nickname}}": "tester", "{{node:code_pre.data.approvalData}}": null,
  "{{node:code_pre.data.docNo}}": "PO-TEST", "{{node:sql_po_owned.data}}": [], "{{node:wf_check_approval.data.data}}": null,
  "{{node:wf_check_approval.data.needApproval}}": 0,
};
const names = Object.keys(fill).map((_, i) => "__p" + i);
let body = code;
Object.keys(fill).forEach((k, i) => { body = body.split(k).join(names[i]); });
assert.ok(!/\{\{[^}]+\}\}/.test(body), "an unfilled placeholder is left");
const out = new Function(...names, body)(...Object.values(fill).map((v) => JSON.parse(JSON.stringify(v))));
// the node answers { entry, itemIDs }; entry.table_po holds the lines formatLine rebuilt
const rows = (out.entry && out.entry.table_po) || [];
const got = rows.map((r) => (r.po_expected_date === undefined ? "undefined" : r.po_expected_date));
const want = [HDR, HDR, HDR, OWN];
let ok = true;
for (let i = 0; i < want.length; i++) {
  const pass = got[i] === want[i];
  ok = ok && pass;
  console.log((pass ? "ok  " : "FAIL") + " line " + (i + 1) + " (" + ["''", "null", "missing", "own date"][i] + "): " + JSON.stringify(got[i]));
}
process.exit(ok && rows.length === 4 ? 0 : 1);
