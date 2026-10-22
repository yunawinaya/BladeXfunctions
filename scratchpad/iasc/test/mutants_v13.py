"""python3 scratchpad/iasc/test/mutants_v13.py - each mutant of the IA_SAVE v13 Small Cycle nodes (code/classic) is built into a temp
folder and must make test/test_v13_sim.js fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    # RES-01 R4: a completion of an IA that reserves
    ("R4: the stored hold status ignored (review I4)", "classic/res_due.js", '.test(id) && stored !== "" && /^', ".test(id) && /^"),
    # (equivalent, kept out: res_due's page === "Edit" - for a Clone scIn already reads no stored row, iaId "0", so no hold status)
    ("R4: an IA that never reserved read", "classic/res_due.js", ' && stored !== "" &&', " &&"),
    # (the split itself: res01/code/shared/split.js, its mutants in res01/test/mutants_hold.py)
    ("R4: a busy split not refused", "classic/res_split.js", "return split.busy ? { route: \"BUSY\"", "return false ? { route: \"BUSY\""),
    ("R4: the split lines not used", "classic/res_split.js", '  : { route: "GO", message: "", lines: split.lines };', '  : { route: "GO", message: "", lines: lines };'),
    ("the screen's Reserved / Short written", "classic/sc_check.js", "    delete out.res_reserved;\n    delete out.res_short;\n", ""),
    # RES-01 R3: enrolment (holds on, a Draft, a new IA or one that reserves) and required_qty (kept for mobile, defaulted)
    ("enrolled whatever the switch", "classic/res_enrol.js", 'const on = ([{{node:code_node_SCin.data}}][0] || {}).res === "YES";', "const on = true;"),
    ("a completion enrolled", "classic/res_enrol.js", 'const enrol = on && status === "Created" &&', "const enrol = on &&"),
    ("a Draft enrolled (Created, BA 10-22)", "classic/res_enrol.js", 'status === "Created" && /^', '(status === "Created" || status === "Draft") && /^'),
    # RES-01 Created (BA, 10-22): code_fillback's status line (classic/fillback_status.js)
    ("Cancel: a Cancelled IA saved (user 10-22)", "classic/guard_cancelled.json", 'refuse409: iaGuardFinal || iaGuardCancelled ? \\"YES\\"', 'refuse409: iaGuardFinal ? \\"YES\\"'),
    ("Cancel: a Cancelled IA's save not stopped though refused", "classic/guard_cancelled.json", 'const iaGuardCancelled = !iaGuardBusy && iaGuardStored === \\"Cancelled\\";', 'const iaGuardCancelled = false;'),
    ("Created: the button's flag ignored", "classic/fillback_status.js", "allData.ia_target_status === 'Created' ||", "false ||"),
    ("Created: a stored Created IA demoted by a Draft save", "classic/fillback_status.js",
     "(pageStatus === 'Edit' && [{{node:code_node_IAguardStored.data.stored}}][0] === 'Created')", "false"),
    # (equivalent, kept out: fillback_status's pageStatus === 'Edit' - the stored-status guard itself only runs on an Edit of a stored IA,
    # so a Clone never reads its source's status; the check stays as a guard against that node's condition changing)
    ("Created: the flag counts on the completion path", "classic/fillback_status.js", "const iaCreated = saveAs === 'Draft' && (", "const iaCreated = ("),
    ("required_qty not kept for a line sent without it", "classic/sc_check.js", 'let v = numOf(has(l, "required_qty") ? l.required_qty : storedReq[String(l.id)]);',
     'let v = numOf(has(l, "required_qty") ? l.required_qty : undefined);'),
    ("required_qty defaulted to the quantity only", "classic/sc_check.js", "const x = v !== null ? v : numOf(l.requested_qty) > 0 ? numOf(l.requested_qty) : numOf(l.total_quantity);",
     "const x = v !== null ? v : numOf(l.total_quantity);"),
    ("switch off reads every line's stored values", "classic/sc_in.js", '(RES_ENABLED || !has(l, "sc_ref_key"))', '(true || !has(l, "sc_ref_key"))'),
    ("required_qty never follows the reference", "classic/sc_check.js",
     "  if (!manualOf(l) && v !== null && sr !== null && Math.abs(v - sr) < 1e-9 && sq !== null && sq > 0 && Math.abs(sr - sq) < 1e-9 && numOf(l.requested_qty) > 0) v = numOf(l.requested_qty);\n", ""),
    ("a typed required_qty follows the reference", "classic/sc_check.js", "&& v !== null && sr !== null && Math.abs(v - sr) < 1e-9 && sq", "&& v !== null && sr !== null && sq"),
    ("a required_qty set apart follows the reference", "classic/sc_check.js", "sq > 0 && Math.abs(sr - sq) < 1e-9 && numOf", "sq > 0 && numOf"),
    ("switch off writes required_qty", "classic/sc_check.js", 'return holdsOn ? Object.assign({}, out, { required_qty: reqOf(l), required_manual: manualOf(l) ? "1" : "" }) : out;',
     'return Object.assign({}, out, { required_qty: reqOf(l), required_manual: manualOf(l) ? "1" : "" });'),
    ("merge drops stored values", "shared/sc_check.js", "const pick = (k) => (has(k) ? a[k] : stored ? stored[k] : null);", "const pick = (k) => (has(k) ? a[k] : null);"),
    ("Clone treated as an Edit", "shared/sc_check.js", "const edit = page === \"Edit\" && digits(a.id);", "const edit = digits(a.id);"),
    ("present keys do not trigger a read", "shared/sc_check.js", "need: edit || present.length > 0 ? \"YES\" : \"NO\"", "need: edit ? \"YES\" : \"NO\""),
    ("new link eligibility skipped", "shared/sc_check.js", "if (!line || scS(line.id) !== out.source_so_line_id || !p.eligibleNew) {", "if (false) {"),
    # FIX-03: only a user assigned to the IA's organisation makes a new link
    ("a non-member makes a new link", "shared/sc_check.js", "if (!(Number(src.member) > 0)) return stop(", "if (false) return stop("),
    ("scIn: the organisation not passed", "shared/sc_check.js", 'org: digits(a.organization_id) ? scS(a.organization_id) : "0"', 'org: "0"'),
    ("scIn: the session user not passed", "shared/sc_check.js", 'uid: digits(input.uid) ? scS(input.uid) : "0"', 'uid: "0"'),
    ("classic: no session user", "classic/sc_in.js", ", uid: [{{system:uid}}][0] });", " });"),
    ("SO of the line not checked", "shared/sc_check.js", "if (scS(line.sales_order_id) !== out.source_so_id) return stop(", "if (false) return stop("),
    ("half a link allowed", "shared/sc_check.js", "if ((out.source_so_id === \"\") !== (out.source_so_line_id === \"\") || ", "if (("),
    ("an IA-side item change under a link not refused", "shared/sc_check.js", "} else if (stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) {", "} else if (false) {"),
    ("an SO-side item change refused", "shared/sc_check.js", "} else if (stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) {",
     "} else if ((stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) || (line && scS(line.item_name) !== scS(a.item_id))) {"),
    ("a removed line blocks completion", "shared/sc_check.js", "} else if (stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) {",
     "} else if (!line || Number(line.is_deleted) === 1) {"),
    ("an Edit moving the link skips the new-link checks", "shared/sc_check.js", 'const isNew = sin.edit !== "YES" || out.source_so_line_id !== storedLine;', 'const isNew = sin.edit !== "YES";'),
    ("RELINK recorded as LINK", "shared/sc_check.js", 'op: storedLine ? "RELINK" : "LINK"', 'op: "LINK"'),
    ("the client's history kept", "shared/sc_check.js", "const old = stored ? scParseJ(storedCtx) || {} : {};", "const old = scParseJ(out.source_so_context_json) || {};"),
    ("an unchanged link takes the client's context", "shared/sc_check.js", "    } else if (stored) {\n      out.source_so_context_json = storedCtx;\n    }", "    }"),
    ("an unlinked IA takes the client's context", "shared/sc_check.js", "  } else {\n    out.source_so_context_json = storedCtx;\n  }", "  }"),
    ("Flat without snapshot allowed", "shared/sc_check.js", "if (out.bom_consumption_mode === \"FLAT\" && !out.bom_snapshot_json) return stop(", "if (false) return stop("),
    ("snapshot not checked", "shared/sc_check.js", "if (!chk.ok) return stop(chk.message);", ""),
    ("drift never checked", "shared/sc_check.js", "{ completing: scS(input.saveAs) !== \"Draft\" }", "{ completing: false }"),
    ("drift checked on Draft", "shared/sc_check.js", "{ completing: scS(input.saveAs) !== \"Draft\" }", "{ completing: true }"),
    ("planned not fixed-scale", "shared/sc_check.js", "planned = scS(planned) === \"\" ? null : Math.max(0, scQ8(planned)).toFixed(8);", "planned = scS(planned) === \"\" ? null : planned;"),
    ("unlink leaves no history", "shared/sc_check.js", "} else if (storedLine) {", "} else if (false) {"),
    ("baseline kept from the client", "shared/sc_check.js", "out.source_so_context_json = JSON.stringify({ v: 1, soId: scS(header.id),", "out.source_so_context_json = out.source_so_context_json || JSON.stringify({ v: 1, soId: scS(header.id),"),
    ("unknown mode allowed", "shared/sc_check.js", "if (out.bom_consumption_mode && out.bom_consumption_mode !== \"STANDARD\" && out.bom_consumption_mode !== \"FLAT\") {", "if (false) {"),
    ("a new link from an IA without an organization allowed", "shared/sc_check.js", "if (!digits(scS(a.organization_id))) return stop(", "if (false) return stop("),
    ("restore: the stored keys never read", "classic/sc_in.js", 'res.lineIds = ids.length ? ids.join(",") : "0";', 'res.lineIds = "0";'),
    ("restore: a line sent with its key read too", "classic/sc_in.js", '(RES_ENABLED || !has(l, "sc_ref_key")) && /^[0-9]{1,20}$/', "/^[0-9]{1,20}$/"),
    ("restore: the checks see the lines as sent", "classic/sc_check.js", "allData: sent ? Object.assign({}, all, { stock_movement: lines }) : all,", "allData: all,"),
    ("restore: the writes take the lines as sent", "classic/sc_check.js", "scLines: { stock_movement: sent ? lines : all.stock_movement }", "scLines: { stock_movement: all.stock_movement }"),
    # MIN-01 (with bladexfunctions-9d): a pick from Reserved stock refused
    ("MIN-01: a Reserved pick let through", "classic/res_split.js", "if (pickedReserved) {", "if (false) {"),
    ("MIN-01: Reserved never recognised", "classic/res_split.js", 'String(p.category || "") === "Reserved" &&', 'String(p.category || "") === "Reserved!" &&'),
    ("MIN-01: a zero Reserved pick refused", "classic/res_split.js", ' && parseFloat(p.sm_quantity) > 0);', ");"),
    # RF-09 (BA 10-22): the manual-Required flag
    ("RF-09: a hand-typed Required follows the reference", "classic/sc_check.js", "  if (!manualOf(l) && v !== null && sr !== null", "  if (v !== null && sr !== null"),
    ("RF-09: the stored flag ignored (mobile)", "classic/sc_check.js", ': storedManual[String(l.id)] || "") === "1";', ': "") === "1";'),
    ("RF-09: the flag not written back", "classic/sc_check.js", 'required_manual: manualOf(l) ? "1" : ""', 'required_manual: ""'),
    ("RF-09: the stored flag never read", "classic/sc_check.js", '  if (x && x.m !== null && x.m !== undefined && String(x.m) !== "") storedManual[String(x.id)] = String(x.m);\n', ""),
    # MIN-02 (BA 10-22): the completion claim (the free gates are the builder's: pinned by the exit cases of test_v13_sim.js)
    ("MIN-02: shipped without the claim", "classic/claim_in.js", "const IA_CLAIM_ENABLED = true;", "const IA_CLAIM_ENABLED = false;"),
    # RES-01 Created numbering (user 10-22): a Created IA carries its real number
    ("number: a new Created IA numbered as a Draft", "classic/number_created.json", "allData.stock_movement_no = iaCreated ? 'issued' : 'draft';", "allData.stock_movement_no = 'draft';"),
    ("number: a Created IA's completion issued anew", "classic/number_created.json", "if (iaKeepNo) {", "if (false) {"),
    ("number: the stored number not read", "classic/number_created.json", "h.item_assembly_status, h.stock_movement_no", "h.item_assembly_status"),
    ("number: a Draft becoming Created not numbered", "classic/number_issue.js", 'stored === "Draft" &&', "false &&"),
    ("number: a Created IA renumbered at every save", "classic/number_issue.js", 'stored === "Draft" &&', 'stored !== "" &&'),
    ("number: Manual Input renumbered", "classic/number_issue.js", "a.stock_movement_no_type !== -9999 &&", ""),
    # BA rev 1.2 C2: how the claimed completion ended, on its claim (IA_HOLD CHECK reads it)
    ("C2: a refused issue marked done", "classic/claim_exit.js", 'rows(win.exitRows, "PARTIAL|SUBTRACT")', 'rows(win.exitRows, "DONE")'),
    ("C2: a refused receipt marked done", "classic/claim_exit.js", 'rows(win.exitRows, "PARTIAL|RECEIPT")', 'rows(win.exitRows, "DONE")'),
    ("C2: a finished completion unmarked", "classic/claim_exit.js", 'done: rows(win.exitRows, "DONE")', 'done: rows(win.exitRows, "")'),
    ("C2: a losing claim marked done", "classic/claim_exit.js", 'rows(win.freeRows, "LOST")', 'rows(win.freeRows, "DONE")'),
    ("MIN-02: a Clone or new IA claims", "classic/claim_in.js", 's(guard.check) === "YES" && ', ""),
    ("MIN-02: a live rival ignored", "classic/claim_win.js", "if (!me || !first || s(first.name) !== s(me.name)) {", "if (!me) {"),
    ("MIN-02: a dead run's claim blocks for ever", "classic/claim_win.js", "< CL_LEASE_MS);", "< Infinity);"),
    ("MIN-02: the IA's change under the claim ignored", "classic/claim_win.js", 'if (s(storedStatus) !== "" && s(st.status) !== s(storedStatus)) {', "if (false) {"),
    ("MIN-02: the claim numbers compared as text", "classic/claim_win.js", "Number(s(a.name).slice(6)) - Number(s(b.name).slice(6))", "s(a.name) < s(b.name) ? -1 : 1"),
    ("MIN-02: the highest number not counted", "classic/claim_row.js", "const n = (parseInt(st.max, 10) || 0) + 1;", "const n = 1;"),
    ("MIN-02: a loser's claim left HELD", "classic/claim_win.js", '"This Item Assembly is being completed in another window or by another user: refresh it to see the result.",\n      freeRows: free,',
     '"This Item Assembly is being completed in another window or by another user: refresh it to see the result.",\n      freeRows: [],'),
    ("MIN-02: the winner's claim never freed", "classic/claim_win.js", 'exitRows: free, needExit: "YES" };', 'exitRows: free, needExit: "NO" };'),
]
survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="sc-v13-mut-")
    code, out = os.path.join(tmp, "code"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(IASC, "code"), code)
    path = os.path.join(code, rel)
    text = open(path).read()
    if old not in text:
        print("BROKEN mutant (anchor not found): " + name)
        survived += 1
        continue
    open(path, "w").write(text.replace(old, new, 1))
    env = dict(os.environ, IASC_CODE=code, IASC_OUT=out)
    b = subprocess.run([sys.executable, os.path.join(IASC, "classic", "patch_v13.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        continue
    r = subprocess.run(["node", os.path.join(HERE, "test_v13_sim.js")], env=dict(os.environ, IA_V13=os.path.join(out, "IA_SAVE.json")), capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
