// node scratchpad/iasc/client/test/mutants_tr.js - each mutant of the built ON form's tr_main (IA transfer request, v8: a request from a
// reserved IA, RESERVED_REQUEST_PLAN.md Task 9) must make test_tr_form.js or test_tr_reserve.js fail (run on a mutated copy through SC_FORM_ON)
// Equivalent (kept out): a STATUS that fails drawn anyway - trRender of nothing shows nothing.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const BUILT = path.join(__dirname, "..", "out", "on", "IAform.json");
const base = fs.readFileSync(BUILT, "utf8");
const J = (s) => JSON.stringify(s).slice(1, -1);
const TESTS = ["test_tr_reserve.js", "test_tr_form.js"];
const DUE = 'trS(res.request.status) === "Completed" && Array.isArray(res.gap) && res.gap.length && page === "Edit" &&\n  iaStatus === "Created");';
const RELOAD_OFFER = '      if (was !== "Completed" && trDue(res, st.page, st.iaStatus)) await trOffer(v, res);';
const MOUNT_OFFER = "      if (trDue(res, page, iaStatus) && !trOffered(trS(res.request.id))) await trOffer(v, res);";
const SETUP = '        if (page !== "Edit" || iaStatus !== "Created" || !(await trSetupOn(v))) return;';
const RECEIVED = '    if (editable && iaStatus === "Created") {';
const DEFECT_BIN = "      if (trS(p.location_id) !== trS(bin) || trS(p.handling_unit_id)) continue;";
const CLOSE_ON_OK = '      if (trS(((res && res.data) || {}).code) === "200") await this.closeDialog("tr_defect_dialog");';
const MUTANTS = [
  // mount: the setup (D12) and who asks
  ["a Draft without a request asks", SETUP, '        if (page !== "Edit" || !(await trSetupOn(v))) return;'],
  ["a viewed IA without a request asks", SETUP, '        if (iaStatus !== "Created" || !(await trSetupOn(v))) return;'],
  ["the setup never read", SETUP, '        if (page !== "Edit" || iaStatus !== "Created") return;'],
  ["another organisation's setup", ".where({ organization_id: trS(v.organization_id), is_deleted: 0 })", ".where({ is_deleted: 0 })"],
  ["a deleted setup row", ".where({ organization_id: trS(v.organization_id), is_deleted: 0 })", ".where({ organization_id: trS(v.organization_id) })"],
  ["a setup row with it off counts", "return ((res && res.data) || []).some((r) => r && Number(r.transfer_request_enabled) === 1);", "return ((res && res.data) || []).length > 0;"],
  ["an unreadable setup as on", '    console.error("IA transfer request: the setup could not be read", e);\n    return false;', '    console.error("IA transfer request: the setup could not be read", e);\n    return true;'],
  ["a linked IA not read", "      if (!trS(v.transfer_request_id)) {\n", "      if (true) {\n"],
  ["switched off", "const TR_ENABLED = true;", "const TR_ENABLED = false;"],
  // the section
  ["Request Materials when it may not", '    if (!(editable && res && trS(res.can_create) === "YES")) return;', "    if (!(editable && res)) return;"],
  ["a cancelled request re-offered at once", '    if (!offer) {\n      this.display(["tr_btn_new"]);\n      return;\n    }\n', ""],
  ["in transit not said", 'info = "In transit (" + no + "): this Item Assembly can\'t be changed until the request is received.";', 'info = "Transfer request " + no + " · " + st;'],
  ["Replace with nothing to replace", '      if (gap.length || trS(res.replace_ready) === "YES") show.push("tr_btn_replace");', '      show.push("tr_btn_replace");'],
  ["a viewed IA replaces / reports a defect", RECEIVED, '    if (iaStatus === "Created") {'],
  ["a Draft replaces / reports a defect", RECEIVED, "    if (editable) {"],
  ["the gap not said", '    if (gap.length) info += " " + gap.length + " line(s) still need materials: request a replacement.";\n', ""],
  ["the replacement's reservation not said", '    else if (trS(res.replace_ready) === "YES") info += " The missing materials are reserved: request the replacement.";\n', ""],
  ["a viewed request refreshed / cancelled", '    if (st === "Requested" && editable) show.push("tr_btn_refresh", "tr_btn_cancel");', '    if (st === "Requested") show.push("tr_btn_refresh", "tr_btn_cancel");'],
  ["stale not said", '    if (st === "Requested" && trS(r.stale) === "YES") info +=', "    if (false) info +="],
  ["the requests never listed", '  if (history.length > 1) info += " · Requests: "', '  if (false) info += " · Requests: "'],
  ["a lone request listed", '  if (history.length > 1) info += " · Requests: "', '  if (history.length > 0) info += " · Requests: "'],
  // RELOAD and its offer (D6)
  ["RELOAD does nothing", "      const res = await trAgain(v);\n      const st = trState();", "      const res = null;\n      const st = trState();"],
  ["RELOAD reads an IA without a request", "if (TR_ENABLED !== true || !trDigits(v.id) || !trS(v.transfer_request_id)) return;", "if (TR_ENABLED !== true || !trDigits(v.id)) return;"],
  ["offered again after an earlier receipt", RELOAD_OFFER, '      if (trDue(res, st.page, st.iaStatus)) await trOffer(v, res);'],
  ["no offer right after a Receive", RELOAD_OFFER, '      if (false && trDue(res, st.page, st.iaStatus)) await trOffer(v, res);'],
  ["offered at every open", MOUNT_OFFER, "      if (trDue(res, page, iaStatus)) await trOffer(v, res);"],
  ["never offered at open", MOUNT_OFFER, "      if (false && trDue(res, page, iaStatus)) await trOffer(v, res);"],
  ["the offer not remembered", '    localStorage.setItem(TR_OFFER + trS(res.request.id), "1");\n', ""],
  ["an unreadable storage offers at every open", '    return localStorage.getItem(TR_OFFER + id) === "1";\n  } catch (e) {\n    return true;', '    return localStorage.getItem(TR_OFFER + id) === "1";\n  } catch (e) {\n    return false;'],
  ["offered with nothing missing", DUE, DUE.replace(" && Array.isArray(res.gap) && res.gap.length", "")],
  ["offered in transit", DUE, DUE.replace('trS(res.request.status) === "Completed" && ', "")],
  ["offered on a viewed IA", DUE, DUE.replace(' && page === "Edit"', "")],
  ["offered on a Draft", DUE, DUE.replace(' &&\n  iaStatus === "Created"', "")],
  ["the offer accepted does nothing", "  if (ok) await trReplace(v, res);\n", ""],
  ["the offer's title", '"Request a replacement", "Allocate");', '"Replacement", "Allocate");'],
  // REPLACE
  ["a gap never allocated", '  if (gap.length) {\n    this.triggerEvent("sc_main"', '  if (false) {\n    this.triggerEvent("sc_main"'],
  ["the gap allocated without the staging bin", 'this.triggerEvent("sc_main", { scOp: "GAP", gap: gap, bin: trS(staging.bin) });', 'this.triggerEvent("sc_main", { scOp: "GAP", gap: gap, bin: "" });'],
  ["REPLACE when nothing is ready", '  if (!res || trS(res.replace_ready) !== "YES") return;', "  if (!res) return;"],
  ["REPLACE without the IA as shown", "expected_fp: trFp(v), storage_location_id: trS(staging.sl)", 'expected_fp: "", storage_location_id: trS(staging.sl)'],
  ["REPLACE to no bin", "storage_location_id: trS(staging.sl),\n      location_id: trS(staging.bin)", 'storage_location_id: trS(staging.sl),\n      location_id: ""'],
  ["REPLACE undated", 'required_date: trYmd(new Date()), idempotency_key: trKey("replace", v.id)', 'required_date: "", idempotency_key: trKey("replace", v.id)'],
  // Report Defect (D2)
  ["defect rows from every bin", DEFECT_BIN, "      if (trS(p.handling_unit_id)) continue;"],
  ["defect rows of handling-unit picks", DEFECT_BIN, "      if (trS(p.location_id) !== trS(bin)) continue;"],
  ["batch ids shown, not their numbers", '      rows.forEach((r) => (r.batch = r.batch_id ? no[r.batch_id] || r.batch_id : ""));', "      rows.forEach((r) => (r.batch = r.batch_id));"],
  ["the dialog never opens", '      await this.openDialog("tr_defect_dialog");\n', ""],
  ["the rows written outside the dialog", 'this.setData({ "tr_defect_dialog.tr_defect_table": rows });', "this.setData({ tr_defect_table: rows });"],
  ["the rows read outside the dialog", "trDefects((this.getValues().tr_defect_dialog || {}).tr_defect_table)", "trDefects(this.getValues().tr_defect_table)"],
  ["more than at the staging bin", "    if (q - trNum(r.at_bin) > 1e-8) return { why:", "    if (false) return { why:"],
  ["a defect without a reason", '    if (!trS(r.reason)) return { why: label + ": choose the reason for the defect." };\n', ""],
  ["two reasons on one line", "    if (d.reason !== trS(r.reason)) return { why:", "    if (false) return { why:"],
  ["nothing entered sent", '  if (!Object.keys(out).length) return { why: "Enter the defective quantity of at least one line." };\n', ""],
  ["batches sent as the line's quantity", "    if (trS(r.batch_id)) {\n      d.batches = d.batches || {};", "    if (false) {\n      d.batches = d.batches || {};"],
  ["the defects not as JSON text", "defects: JSON.stringify(d.defects)", "defects: d.defects"],
  ["the dialog closed on a refusal", CLOSE_ON_OK, '      await this.closeDialog("tr_defect_dialog");'],
  ["the dialog left open after a success", CLOSE_ON_OK, ""],
  ["the dialog's Cancel never closes", '      await this.closeDialog("tr_defect_dialog");\n      return;\n    }\n    if (op === "DEFECT")', '      return;\n    }\n    if (op === "DEFECT")'],
  // CREATE / VIEW / REFRESH / CANCEL / STORAGE (v7)
  ["View not on the right", 'mode: "dialog", position: "rtl", title: edit ? "Edit" : "View"', 'mode: "dialog", title: edit ? "Edit" : "View"'],
  ["View never editable", '      const edit = trS(r.status) === "In Progress";', "      const edit = false;"],
  ["Create without the IA as shown", "expected_fp: trFp(v), storage_location_id: sl", 'expected_fp: "", storage_location_id: sl'],
  ["the required date as typed", "      const date = trDate(v.tr_required_date);", "      const date = trS(v.tr_required_date).slice(0, 10);"],
  ["the link not set", "if (out.request && trDigits(out.request.id)) this.setData({ transfer_request_id:", "if (false) this.setData({ transfer_request_id:"],
  ["a refusal re-reads", "    await trAgain(v);\n    return true;\n  }\n  this.$message.error(trS(d.message) || failed);", "    return true;\n  }\n  await trAgain(v);\n  this.$message.error(trS(d.message) || failed);"],
  ["Refresh without the IA as shown", "      if (refresh) params.expected_fp = trFp(v);\n", ""],
  ["Cancel with a fingerprint", "      if (refresh) params.expected_fp = trFp(v);", "      if (true) params.expected_fp = trFp(v);"],
  ["no confirmation", "      if (!ok) return;\n", ""],
  ["the staging bin kept", '      this.setData({ tr_location_id: "" });', "      this.setData({});"],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  const a = J(from);
  const n = base.split(a).length - 1;
  if (n !== 1) {
    console.log("BROKEN mutant (anchor found " + n + " times): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tr-m-")), "IAform.json");
  fs.writeFileSync(f, base.replace(a, () => J(to)));
  const killed = TESTS.some((t) => spawnSync(process.execPath, [path.join(__dirname, t)], { env: Object.assign({}, process.env, { SC_FORM_ON: f, TZ: "Asia/Kuala_Lumpur" }),
    encoding: "utf8", timeout: 120000 }).status !== 0);
  if (killed) console.log("killed   " + name);
  else {
    survived++;
    console.log("SURVIVED: " + name);
  }
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
