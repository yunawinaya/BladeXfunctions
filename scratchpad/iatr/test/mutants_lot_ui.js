// node scratchpad/iatr/test/mutants_lot_ui.js - each mutant of the LOT form patcher (its patch texts in patch_lot_ui.py, or a handler
// source in lot_client/src) must make test_lot_ui_full.js or test_lot_rr.js fail. The test reads the mutated copy's build AND patch texts, so a mutant
// survives the structural undo and only the behaviour / wiring checks can kill it.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");
const SRC = path.join(IATR, "lot_client");
const MUTANTS = [
  // the user, 10-29: a request's Item Assembly link and number; the Production Order pair never shown
  ["patch_lot_ui.py", "the IA link not switched on", "iatr_link: 1, iatr_ia_no:", "iatr_ia_no:"],
  ["patch_lot_ui.py", "the IA link not locked", "'  this.disabled([\"iatr_link\", \"iatr_ia_no\"], true);\\n'", "''"],
  ["patch_lot_ui.py", "the IA link before Production Order No", "hdr[at + 1:at + 1] = [link, ia_no]", "hdr[at:at] = [link, ia_no]"],
  ["patch_lot_ui.py", "the Production Order switch shown again", "'      \"movement_reason\",\\n    ],\\n'),", "'      \"movement_reason\",\\n      \"is_production_order\",\\n    ],\\n'),"],
  // the user, 10-29: the opener after a save; one toast for a finished save
  ["patch_lot_ui.py", "the IA form refreshed after a save from View Transfer Request", "Object.prototype.hasOwnProperty.call(m, \"item_assembly_status\")", "false"],
  ["patch_lot_ui.py", "a finished save says saved twice", "'    if (js === \"COMPLETED\") {\\n      release();", "'    if (js === \"COMPLETED\") {\\n      kickLoop(job, name);\\n      release();"],
  ["patch_lot_ui.py", "the list no longer refreshed", "\\n  p.refresh();\\n};\\n\\n'", "\\n};\\n\\n'"],
  ["patch_lot_ui.py", "a request routed as an ordinary transfer", "'  if (!isNew && s(v.transfer_purpose) === \"IA_SUPPLY\") {\\n'", "'  if (false) {\\n'"],
  ["patch_lot_ui.py", "Save Picks sent to SUBMIT", "'    if (stored === \"Requested\" && saveAs === \"Draft\") return { why:", "'    if (false) return { why:"],
  ["patch_lot_ui.py", "a dispatch routed as an edit", "stored === \"Requested\" && saveAs === \"In Progress\" ? \"STAGE\"", "stored === \"Requested\" && saveAs === \"In Progress\" ? \"EDIT\""],
  ["patch_lot_ui.py", "a request's NOT_ELIGIBLE to the classic", "'    if (ctx.purpose) {\\n", "'    if (false) {\\n"],
  ["patch_lot_ui.py", "the request flag not carried", "'      purpose: route.purpose === true };\\n'", "'      purpose: false };\\n'"],
  ["patch_lot_ui.py", "the UI models sent as record fields", "\"cancel_status\", \"flex_2det1nd2\", \"flex_t6y2yh5r\", \"requested_status\", \"iatr_info\", \"button_view_ia\", \"iatr_link\", \"iatr_ia_no\"].concat(SAVE_BUTTONS);\\n'),",
    "\"cancel_status\", \"flex_2det1nd2\", \"flex_t6y2yh5r\"].concat(SAVE_BUTTONS);\\n'),"],
  ["patch_lot_ui.py", "a Requested request shows no buttons", "this.display([\"button_save_picks\", \"button_dispatch\", \"button_cancel_request\"]);", "this.display([]);"],
  ["patch_lot_ui.py", "a dispatched request shows no Receive", "this.display([\"button_receive\"]);", "this.display([]);"],
  ["patch_lot_ui.py", "a request shows the ordinary buttons too", "'    return;\\n  }\\n'),", "'  }\\n'),"],
  ["patch_lot_ui.py", "the request not shown on Edit", "'        showProductionOrder(data);\\n        showTransferRequest(data);\\n        showStatusHTML",
    "'        showProductionOrder(data);\\n        showStatusHTML"],
  ["patch_lot_ui.py", "the demand not locked", "this.disabled([\"stock_movement.item_selection\", \"stock_movement.location_id\", \"stock_movement.storage_location_id\"], true);", "this.disabled([], true);"],
  ["patch_lot_ui.py", "no Requested Qty", "\"button_view_ia\", \"stock_movement.requested_qty\", \"iatr_link\"", "\"button_view_ia\", \"iatr_link\""],
  ["patch_lot_ui.py", "no row-action lock", "'  if (data.stock_movement_status === \"Requested\") {\\n'", "'  if (false) {\\n'"],
  ["patch_lot_ui.py", "no Requested badge", "    Requested: \"requested_status\",\\n  };", "    Requisitioned: \"requested_status\",\\n  };"],
  ["patch_lot_ui.py", "no failure notice for Requested", " || data.stock_movement_status === \"Requested\")) {\\n'", ")) {\\n'"],
  ["patch_lot_ui.py", "Apply Target says nothing", "'  this.$message.warning(\"A transfer request", "'  console.log(\"A transfer request"],
  ["patch_lot_ui.py", "Dispatch without its permission", "names[\"lotIatr_onClick_dispatch\"], \"lot_ia_dispatch\")", "names[\"lotIatr_onClick_dispatch\"])"],
  ["patch_lot_ui.py", "Save Picks bound to the In Progress save", "button(draft_btn, \"button_save_picks\", \"Save Picks\", draft_btn[\"events\"][\"onClick\"])",
    "button(draft_btn, \"button_save_picks\", \"Save Picks\", ip_btn[\"events\"][\"onClick\"])"],
  ["patch_lot_ui.py", "the info without the required date", "'  if (data.required_date) parts.push(", "'  if (false) parts.push("],
  ["src/lotIatr_onClick_dispatch.js", "Dispatch runs the Completed save", "await this.triggerEvent(\"lotV2_onClick_save_inprogress\");", "await this.triggerEvent(\"lotV2_onClick_save_completed\");"],
  ["src/lotIatr_onClick_dispatch.js", "Dispatch unconfirmed", "  } catch (e) {\n    return;\n  }\n  await this.triggerEvent", "  } catch (e) {\n  }\n  await this.triggerEvent"],
  ["src/lotIatr_onClick_receive.js", "Receive runs the In Progress save", "await this.triggerEvent(\"lotV2_onClick_save_completed\");", "await this.triggerEvent(\"lotV2_onClick_save_inprogress\");"],
  ["src/lotIatr_onClick_cancelRequest.js", "Cancel asks the status", "operation: \"CANCEL\"", "operation: \"STATUS\""],
  ["src/lotIatr_onClick_cancelRequest.js", "Cancel names no request", "lot_id: s(v.id),", "lot_id: \"\","],
  ["src/lotIatr_onClick_cancelRequest.js", "a refused cancel closes the form", "  if (s(r.code) === \"200\") {", "  if (true) {"],
  ["src/lotIatr_onClick_viewIa.js", "View opens no IA", "data: { id: iaId }", "data: { id: \"\" }"],
  ["src/lotIatr_onClick_viewIa.js", "View IA not on the right", 'mode: "dialog", position: "rtl", title: "View"', 'mode: "dialog", title: "View"'],
  // reserved requests (Task 10): the pick dialog's add-back (test_lot_rr.js)
  ["patch_lot_ui.py", "picker: another line's holds counted", " || rrS(r.doc_line_id) !== rrS(lineItemData.source_ia_line_id)) continue;", ") continue;"],
  ["patch_lot_ui.py", "picker: another IA's holds counted", "rrS(r.doc_id) !== rrS(allData.source_ia_id) || ", ""],
  ["patch_lot_ui.py", "picker: the staging bin's holds counted", " || rrS(r.bin_location) === rrS(lineItemData.location_id)", ""],
  ["patch_lot_ui.py", "picker: a hold counted at every bin", "rrS(r.bin_location) !== rrS(row.location_id) || ", ""],
  ["patch_lot_ui.py", "picker: another batch's hold counted", " || rrS(r.batch_id) !== rrS(row.batch_id)) continue;", ") continue;"],
  ["patch_lot_ui.py", "picker: a Blocked hold counted", '(rrS(r.from_category) || \\"Unrestricted\\") !== \\"Unrestricted\\"', "false"],
  ["patch_lot_ui.py", "picker: a handling unit's hold counted", "rrS(r.handling_unit_id) || (rrS", "(rrS"],
  ["patch_lot_ui.py", "picker: a pack's units not converted", "          return c && parseFloat(c.base_qty) > 0 ? parseFloat(c.base_qty) : 0;", "          return 1;"],
  ["patch_lot_ui.py", "picker: nothing added back", "row.unrestricted_qty = (parseFloat(row.unrestricted_qty) || 0) + own;", "row.unrestricted_qty = (parseFloat(row.unrestricted_qty) || 0);"],
  ["patch_lot_ui.py", "picker: the reserved not lowered", "row.reserved_qty = Math.max(0, (parseFloat(row.reserved_qty) || 0) - own);", "row.reserved_qty = row.reserved_qty;"],
  // the Receive dialog and its receipts
  ["src/lotRr_onClick_receive.js", "receive: every request gets the dialog", 'if (!ia || s(ia.item_assembly_status) !== "Created") {', "if (false) {"],
  ["src/lotRr_onClick_receive.js", "receive: an unreadable IA received anyway", '    this.$message.error("The Item Assembly of this transfer request could not be read: please try again.");\n    return;\n',
    '    this.$message.error("The Item Assembly of this transfer request could not be read: please try again.");\n'],
  ["src/lotRr_onClick_receive.js", "receive: batches merged", "      const b = s(p.batch_id);", '      const b = "";'],
  ["src/lotRr_onClick_receive.js", "receive: good not filled in", "dispatched: by[b], good: by[b],", "dispatched: by[b], good: 0,"],
  ["src/lotRr_onClick_receive.js", "receive: batch ids shown", '      rows.forEach((r) => (r.batch = r.batch_id ? no[r.batch_id] || r.batch_id : ""));', "      rows.forEach((r) => (r.batch = r.batch_id));"],
  ["src/lotRr_onClick_receive.js", "receive: the rows outside the dialog", '"iatr_receive_dialog.iatr_receive_table": rows', "iatr_receive_table: rows"],
  ["src/lotRr_onConfirm_receive.js", "confirm: the sum not checked", "    if (Math.abs(good + defect - sent) > 1e-8) {", "    if (false) {"],
  ["src/lotRr_onConfirm_receive.js", "confirm: a defect without its reason", "    if (defect > 0 && !s(r.reason)) {", "    if (false) {"],
  ["src/lotRr_onConfirm_receive.js", "confirm: two reasons on a line", "      if (L.reason && L.reason !== s(r.reason)) {", "      if (false) {"],
  ["src/lotRr_onConfirm_receive.js", "confirm: a negative quantity", " || good < 0 || defect < 0) {", ") {"],
  ["src/lotRr_onConfirm_receive.js", "confirm: the batches not sent", "    if (L.batched) receipts[id].batches = L.batches;\n", ""],
  ["src/lotRr_onConfirm_receive.js", "confirm: the rows read outside the dialog", "(this.getValues().iatr_receive_dialog || {}).iatr_receive_table", "this.getValues().iatr_receive_table"],
  ["src/lotRr_onConfirm_receive.js", "confirm: the dialog left open", '  await this.closeDialog("iatr_receive_dialog");\n  await this.triggerEvent', "  await this.triggerEvent"],
  ["src/lotRr_onConfirm_receive.js", "confirm: the receipts not kept", '  this.models["_iatr_receipts"] = receipts;\n', ""],
  ["patch_lot_ui.py", "save: the receipts never sent", "    if (route.purpose === true && button.saveAs", "    if (false && route.purpose === true && button.saveAs"],
  ["patch_lot_ui.py", "save: an ordinary transfer's receipts sent", "    if (route.purpose === true && button.saveAs", "    if (button.saveAs"],
  ["patch_lot_ui.py", "save: the dialog sent with the record", '"iatr_ia_no", "iatr_receive_dialog"].concat(SAVE_BUTTONS);', '"iatr_ia_no"].concat(SAVE_BUTTONS);'],
  ["patch_lot_ui.py", "the dialog's confirm and cancel swapped", 'dialog["events"] = {"onCancel": names["lotRr_onCancel_receive"], "onConfirm": names["lotRr_onConfirm_receive"]}',
    'dialog["events"] = {"onCancel": names["lotRr_onConfirm_receive"], "onConfirm": names["lotRr_onCancel_receive"]}'],
  // the request's line
  ["patch_lot_ui.py", "info: never written again", "data.source_ia_rev);\\n  rrInfo(data, parts);\\n'),", "data.source_ia_rev);\\n'),"],
  ["patch_lot_ui.py", "info: no replacement", '    if (prevId) more.push("replacement for "', '    if (false) more.push("replacement for "'],
  ["patch_lot_ui.py", "info: no bins to count", '      more.push("bins to count: "', '      console.log("bins to count: "'],
  ["patch_lot_ui.py", "info: the dispatch entries missed", 'x.op === "DISPATCH"', 'x.op === "DISPATCHED"'],
  ["patch_lot_ui.py", "info: bins by id", "      const bin = named(bins, (r) => s(r.bin_location_combine));", "      const bin = {};"],
];
let survived = 0;
for (const [file, name, from, to] of MUTANTS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-uim-"));
  fs.mkdirSync(path.join(tmp, "lot_client", "src"), { recursive: true });
  fs.symlinkSync(path.join(IATR, "base"), path.join(tmp, "base"));
  fs.copyFileSync(path.join(SRC, "patch_lot_ui.py"), path.join(tmp, "lot_client", "patch_lot_ui.py"));
  for (const f of fs.readdirSync(path.join(SRC, "src"))) fs.copyFileSync(path.join(SRC, "src", f), path.join(tmp, "lot_client", "src", f));
  const target = path.join(tmp, "lot_client", file);
  const text = fs.readFileSync(target, "utf8");
  const k = text.split(from).length - 1;
  if (k !== 1) {
    console.log("BROKEN mutant (anchor found " + k + " times): " + name);
    survived++;
    continue;
  }
  fs.writeFileSync(target, text.replace(from, () => to));
  // killed by either test (test_lot_rr.js: the reserved-request layer)
  const env = Object.assign({}, process.env, { IATR_UI_PATCHER: path.join(tmp, "lot_client", "patch_lot_ui.py") });
  let r = { status: 0, stdout: "", stderr: "" };
  for (const test of ["test_lot_ui_full.js", "test_lot_rr.js"]) {
    r = spawnSync(process.execPath, [path.join(__dirname, test)], { env: env, encoding: "utf8", timeout: 120000 });
    if (r.status !== 0) break;
  }
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name + (/Traceback|AssertionError/.test(r.stdout + r.stderr) ? " (the build refused it)" : ""));
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
