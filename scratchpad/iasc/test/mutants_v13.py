"""python3 scratchpad/iasc/test/mutants_v13.py - each mutant of the IA_SAVE v13 Small Cycle nodes (code/classic) is built into a temp
folder and must make test/test_v13_sim.js fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    ("merge drops stored values", "shared/sc_check.js", "const pick = (k) => (has(k) ? a[k] : stored ? stored[k] : null);", "const pick = (k) => (has(k) ? a[k] : null);"),
    ("Clone treated as an Edit", "shared/sc_check.js", "const edit = page === \"Edit\" && digits(a.id);", "const edit = digits(a.id);"),
    ("present keys do not trigger a read", "shared/sc_check.js", "need: edit || present.length > 0 ? \"YES\" : \"NO\"", "need: edit ? \"YES\" : \"NO\""),
    ("new link eligibility skipped", "shared/sc_check.js", "if (!line || scS(line.id) !== out.source_so_line_id || !p.eligibleNew) {", "if (false) {"),
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
    ("restore: a line sent with its key read too", "classic/sc_in.js", '!Object.prototype.hasOwnProperty.call(l, "sc_ref_key") && /^[0-9]{1,20}$/', "/^[0-9]{1,20}$/"),
    ("restore: the checks see the lines as sent", "classic/sc_check.js", "allData: sent ? Object.assign({}, all, { stock_movement: lines }) : all,", "allData: all,"),
    ("restore: the writes take the lines as sent", "classic/sc_check.js", "scLines: { stock_movement: sent ? lines : all.stock_movement }", "scLines: { stock_movement: all.stock_movement }"),
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
