"""python3 scratchpad/iasc/so/test/mutants_so.py - each mutant of the Small Cycle SO-side sources (so/src) is built into a temp
folder (SC_SO_SRC / SC_SO_OUT) and must make so/test/test_so.js fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SO = os.path.dirname(HERE)
P = "so_open_page.js"
L = "sli_load.js"
O = "sli_open.js"
A = "so_actions.json"
MUTANTS = [
    ("row action: an unsaved line opens the page", P, '} else if (!/^[0-9]{1,20}$/.test(scText(scRow.id)) || !scText(scRow.item_name)) {', "} else if (false) {"),
    ("row action: page id 0 still opens", P, "if (!/^[1-9][0-9]{0,19}$/.test(SC_PAGE)) {", "if (false) {"),
    ("row action: the line index for the line id", P, "      so_line_id: scText(scRow.id),", "      so_line_id: scText(scRow.line_index),"),
    ("row action: the action not passed", P, "      sc_action: SC_ACTION,", '      sc_action: "",'),
    ("hidden: Create IA on a Completed line", A, "['Completed', 'Cancelled'].indexOf(arguments[0].row.line_status) >= 0", "['Cancelled'].indexOf(arguments[0].row.line_status) >= 0"),
    ("hidden: Create IA on a Draft SO", A, "['Issued', 'Processing'].indexOf(this.getValue('so_status')) < 0", "['Draft', 'Issued', 'Processing'].indexOf(this.getValue('so_status')) < 0"),
    ("hidden: Linked IAs on an unsaved line", A, '"{{!(arguments[0] && arguments[0].row && arguments[0].row.id && arguments[0].row.item_name)}}"', '"{{!(arguments[0] && arguments[0].row && arguments[0].row.item_name)}}"'),
    ("page: this IA excluded", L, 'exclude_ia_id: "", organization_id: scP("organization_id"),', 'exclude_ia_id: scP("so_line_id"), organization_id: scP("organization_id"),'),
    ("page: a failed read shown as zeros", L, "    if (!r || !r.totals) {", "    if (!r) r = { totals: {}, ias: [], warnings: [] };\n    if (false) {"),
    ("page: Create shown on an ineligible line", L, "    if (r.eligibleNew) this.display([\"sli_btn_create\"]);", "    if (true) this.display([\"sli_btn_create\"]);"),
    ("page: Create opens on an ineligible line", L, "    if (!r.eligibleNew) {\n      this.$message.warning(", "    if (false) {\n      this.$message.warning("),
    ("page: orphans not listed", L, "    const orphans = Array.isArray(r.orphans) ? r.orphans : [];", "    const orphans = [];"),
    ("page: every IA 'Not counted'", L, '      counted: ROLE[scS(x.role)] || "Not counted", ia_id: scS(x.id) }));', '      counted: "Not counted", ia_id: scS(x.id) }));'),
    ("page: planned = actual", L, "planned: scQ8(x.planned), actual: scQ8(x.itemQty)", "planned: scQ8(x.itemQty), actual: scQ8(x.itemQty)"),
    ("page: the create action ignored", L, '    if (scS(scArgs.action) !== "create") return;', "    return;"),
    ("page: no sc_entry", L, '      params: { sc_entry: "1" } });', "      params: {} });"),
    ("page: no Small Cycle mode", L, ', bom_consumption_mode: "STANDARD" },', " },"),
    ("page: the warnings not shown", L, "    if (warnings.length) row.sli_summary_warn = ", "    if (false) row.sli_summary_warn = "),
    ("page: warnings not marked", L, r'"\u26a0 " + swap(w.text)', "swap(w.text)"),
    ("page: the suggestion always takes off the produced", L, 'const done = scQ8(t.delivered) > scQ8(t.produced) ? scQ8(t.delivered) + " delivered" : scQ8(t.produced) + " produced";',
     'const done = scQ8(t.produced) + " produced";'),
    ("page: an inactive line's suggestion with a sum", L, '        : !active ? lineQty(0) + ": the line has no remaining demand"\n', ""),
    ("page: the customer not shown", L, "      sli_summary_customer: scS(h.customer_name),\n", ""),
    ("page: rows without a fact stay shown", L, "  if (off.length) this.hide(off);\n};", "};"),
    ("page: units by id", L, "  const u = (id) => uoms[scS(id)] || scS(id);", "  const u = (id) => scS(id);"),
    ("open: a Draft only viewed", O, 'type: draft ? "edit" : "view"', 'type: "view"'),
]
survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="sc-so-mut-")
    src, out = os.path.join(tmp, "src"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(SO, "src"), src)
    path = os.path.join(src, rel)
    text = open(path, encoding="utf-8").read()
    if text.count(old) != 1:
        print("BROKEN mutant (anchor found %d times): %s" % (text.count(old), name))
        survived += 1
        continue
    open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
    env = dict(os.environ, SC_SO_SRC=src, SC_SO_OUT=out)
    b = subprocess.run([sys.executable, os.path.join(SO, "build_so_sc.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        shutil.rmtree(tmp, ignore_errors=True)
        continue
    r = subprocess.run(["node", os.path.join(HERE, "test_so.js")], env=env, capture_output=True, text=True, timeout=600)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
