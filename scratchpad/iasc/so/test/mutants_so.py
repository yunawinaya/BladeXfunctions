"""python3 scratchpad/iasc/so/test/mutants_so.py - each mutant of the Small Cycle SO-side sources (so/src) is built into a temp
folder (SC_SO_SRC / SC_SO_OUT) and must make so/test/test_so.js fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SO = os.path.dirname(HERE)
P = "so_open_page.js"
L = "sli_load.js"
O = "sli_open.js"
PL = "sli_plant.js"
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
    ("page: Create shown on an ineligible line", L, "    if (r.eligibleNew && bom === true) this.display([\"sli_btn_create\"]);", "    if (true) this.display([\"sli_btn_create\"]);"),
    # the user's 10-28 notes: only an item with an active BOM; the plant first (an organisation-level SO); the IA form on the right
    ("page: Create shown for an item without a BOM", L, "    if (r.eligibleNew && bom === true) this.display", "    if (r.eligibleNew) this.display"),
    ("page: an item without a BOM opens the IA", L, "    if (!bom) {\n      this.$message.warning(", "    if (false) {\n      this.$message.warning("),
    ("page: a failed BOM read taken as no BOM", L, "    if (bom === null) {\n      this.$message.error(", "    if (false) {\n      this.$message.error("),
    ("page: an inactive BOM counts", L, '{ prop: "is_active", operator: "equal", value: 1 }, ', ""),
    ("page: another organisation's BOM counts", L, '{ prop: "organization_id", operator: "equal", value: org }, ', ""),
    ("page: an organisation-level SO opens without a plant", L, "      if (!own) {\n        await this.setData", "      if (false) {\n        await this.setData"),
    ("page: the organisation taken as the plant", L, '    return /^[0-9]{1,20}$/.test(p) && p !== scS(org) ? p : "";', '    return /^[0-9]{1,20}$/.test(p) ? p : "";'),
    # a plant-level login (the user, 10-28): its own plant, never asked
    ("page: a plant-level login asked for the plant", L, "    let plant = scLoginPlant() || scS(scArgs.plant);", "    let plant = scS(scArgs.plant);"),
    ("page: an organisation-level login taken as plant-level", L, 'return parent && parent !== "0" && /^[0-9]{1,20}$/.test(p) ? p : "";', 'return parent && /^[0-9]{1,20}$/.test(p) ? p : "";'),
    ("page: the login's last plant taken", L, 'scS(this.getVarSystem("deptIds")).split(",")[0].trim();', 'scS(this.getVarSystem("deptIds")).split(",").pop().trim();'),
    ("page: the IA form not on the right", L, 'mode: "dialog", position: "rtl", title: "Add Item Assembly"', 'mode: "dialog", title: "Add Item Assembly"'),
    ("page: the IA form without the plant", L, ",\n        issuing_operation_faci: plant },", " },"),
    ("page: Open not on the right", O, 'mode: "dialog", position: "rtl", title: edit', 'mode: "dialog", title: edit'),
    ("plant: the organisation accepted as the plant", PL, ' || scPlant === scS(this.getParamsVariables("organization_id"))', ""),
    ("plant: no plant accepted", PL, "if (!/^[0-9]{1,20}$/.test(scPlant) ||", "if ("),
    ("plant: the chosen plant not passed", PL, 'this.triggerEvent("sli_load", { action: "create", plant: scPlant });', 'this.triggerEvent("sli_load", { action: "create" });'),
    ("plant: the dialog left open", PL, '  this.closeDialog("sli_plant_dialog");\n', ""),
    # the figure tiles (the user, 10-29)
    ("tiles: the SO number small again", L, "'<div style=\"font-size:20px;font-weight:600", "'<div style=\"font-size:15px;font-weight:600"),
    ("tiles: never written", L, "    await this.setData({ sli_summary_html: scTiles(", "    if (false) await this.setData({ sli_summary_html: scTiles("),
    ("tiles: the unavailable message never written", L, "      await this.setData({ sli_summary_html: scMessage(", "      if (false) await this.setData({ sli_summary_html: scMessage("),
    ("tiles: names as markup", L, 'const scEsc = (v) => scS(v).replace(/&/g, "&amp;")', 'const scEsc = (v) => scS(v).replace(/&#/g, "&amp;")'),
    ("tiles: To Plan shows the ordered", L, ": [x.lineQty(t.suggestion), ", ": [x.lineQty(t.ordered), "),
    ("tiles: warnings dropped", L, "  const warn = x.warnings.length ?", "  const warn = false ?"),
    ("tiles: a dead line still plans", L, "    : !x.active ? [x.lineQty(0), ", "    : false ? [x.lineQty(0), "),
    ("page: Create opens on an ineligible line", L, "    if (!r.eligibleNew) {\n      this.$message.warning(", "    if (false) {\n      this.$message.warning("),
    ("page: orphans not listed", L, "    const orphans = Array.isArray(r.orphans) ? r.orphans : [];", "    const orphans = [];"),
    ("page: every IA 'Not counted'", L, '      counted: ROLE[scS(x.role)] || "Not counted", ia_id: scS(x.id) }));', '      counted: "Not counted", ia_id: scS(x.id) }));'),
    ("page: planned = the quantity", L, 'mode: MODE[scS(x.mode)] || "", planned: scQ8(x.planned),', 'mode: MODE[scS(x.mode)] || "", planned: scQ8(x.itemQty),'),
    # UI-01: an open IA's quantity to receive, a completed one's received
    ("page: an open IA's quantity shown as received", L, 'actual: scS(x.role) === "produced" ? scQ8(x.itemQty) : null', "actual: scQ8(x.itemQty)"),
    ("page: nothing to receive shown", L, 'to_receive: scS(x.role) === "open" ? scQ8(x.itemQty) : null', "to_receive: null"),
    ("page: an orphan Draft shown as received", L, "actual: DONE_ST[scS(x.status)] ? scQ8(x.item_qty) : null", "actual: scQ8(x.item_qty)"),
    ("page: an orphan's quantity to receive not shown", L, "to_receive: OPEN_ST[scS(x.status)] ? scQ8(x.item_qty) : null", "to_receive: null"),
    # FIX-03: a refusal shows its reason
    ("page: a refusal's reason dropped", L, 'if (scS(d.code) === "400") refused = scS(d.message);', ""),
    ("page: the create action ignored", L, '    if (scS(scArgs.action) !== "create") return;', "    return;"),
    ("page: no sc_entry", L, '      params: { sc_entry: "1" } });', "      params: {} });"),
    ("page: no Small Cycle mode", L, ', bom_consumption_mode: "STANDARD",\n', ",\n"),
    ("page: the warnings not shown", L, "    if (warnings.length) row.sli_summary_warn = ", "    if (false) row.sli_summary_warn = "),
    ("page: warnings not marked", L, r'"\u26a0 " + swap(w.text)', "swap(w.text)"),
    ("page: the suggestion always takes off the produced", L, 'const done = scQ8(t.delivered) > scQ8(t.produced) ? scQ8(t.delivered) + " delivered" : scQ8(t.produced) + " produced";',
     'const done = scQ8(t.produced) + " produced";'),
    ("page: an inactive line's suggestion with a sum", L, '        : !active ? lineQty(0) + ": the line has no remaining demand"\n', ""),
    ("page: the customer not shown", L, "      sli_summary_customer: scS(h.customer_name),\n", ""),
    ("page: rows without a fact stay shown", L, "  if (off.length) this.hide(off);\n};", "};"),
    ("page: units by id", L, "  const u = (id) => uoms[scS(id)] || scS(id);", "  const u = (id) => scS(id);"),
    ("open: a Draft only viewed", O, 'type: edit ? "edit" : "view"', 'type: "view"'),
    ("orphans: a Created IA's quantity to receive dropped (review 3)", "sli_load.js", "const OPEN_ST = { Draft: 1, Created: 1, Processing: 1 };", "const OPEN_ST = { Draft: 1, Processing: 1 };"),
    ("open: a Created IA only viewed (Created, BA 10-22)", O, '["Draft", "Created"].indexOf(String(scRow.status', '["Draft"].indexOf(String(scRow.status'),
    ("page: an unavailable figure shown as one", L, 'sli_summary_suggest: t.unavailable === "OVERLAP" ?', "sli_summary_suggest: false ?"),
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
