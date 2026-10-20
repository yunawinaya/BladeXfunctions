"""python3 scratchpad/iasc/client/test/mutants_client.py - each mutant of the Small Cycle client sources (client/src) is built
into a temp folder (SC_SRC / SC_OUT_DIR) and must make at least one client test fail.
Equivalent in the mock (kept out, reasons): the prologue's scLegacy guard and the QTY echo guard defend against platform timing
(a same-tick stale read, an echo arriving mid-confirm) that the harness runs in a fixed order; scReadIds' check of a
malformed answer (the mock db always answers an array)."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.dirname(HERE)
TESTS = ["test_sc_legacy.js", "test_sc_link.js", "test_sc_prepare.js", "test_sc_qty.js", "test_sc_variance.js", "test_sc_panel.js"]
M = "sc_main.js"
V = "sc_variance.js"
MUTANTS = [
    ("item prologue ignores the link", "sc_prologue_item.js", '/^[0-9]{1,20}$/.test(scText("source_so_line_id")) || scMode === "FLAT"', 'scMode === "FLAT"'),
    ("item prologue ignores an unprepared Flat", "sc_prologue_item.js", '|| scMode === "FLAT" || (scMode', '|| (scMode'),
    ("item prologue routes everything", "sc_prologue_item.js", 'if (/^[0-9]{1,20}$/.test(scText("source_so_line_id")) ||', 'if (true ||'),
    ("qty prologue never routes", "sc_prologue_qty.js", '  if (/^[0-9]{1,20}$/.test(scText("source_so_line_id")) || scMode === "FLAT" || (scMode === "STANDARD" && scText("bom_snapshot_json") !== "")) {',
     "  if (false) {"),
    ("qty prologue ignores the link", "sc_prologue_qty.js", '  if (/^[0-9]{1,20}$/.test(scText("source_so_line_id")) || scMode === "FLAT"', '  if (scMode === "FLAT"'),
    ("plant epilogue never routes", "sc_epilogue_plant.js", 'if ((scMode === "STANDARD" || scMode === "FLAT") && scText("bom_snapshot_json") !== "") {', "if (false) {"),
    ("mount block does nothing", "sc_mount_block.js", '  this.triggerEvent("sc_main", { scOp: "MOUNT"', '  return;\n  this.triggerEvent("sc_main", { scOp: "MOUNT"'),
    ("qty: every line untouched", M, "const untouched = Math.abs(scNum(l.total_quantity) - old) <= SC_EPS && !scS(l.temp_hu_data);", "const untouched = true;"),
    ("qty: HU lines re-allocated", M, "const untouched = Math.abs(scNum(l.total_quantity) - old) <= SC_EPS && !scS(l.temp_hu_data);", "const untouched = Math.abs(scNum(l.total_quantity) - old) <= SC_EPS;"),
    ("qty: serial lines not set apart", M, "    if (Number(r.serial) === 1) return serials.push(name);\n", ""),
    ("qty: no question before replacing picks", M, 'if (realloc.some((t) => scS(lines[t.index].temp_qty_data))) {', "if (false) {"),
    ("qty: non-stock lines stay", M, "      updates[`stock_movement.${i}.total_quantity`] = x.qty;\n      return;", "      return;"),
    ("qty: no re-allocation", M, "  if (again && plantId) await scAllocate(realloc, lines, plantId, scOrg(v));", ""),
    ("allocate: other lines' staged picks ignored", M, "(held.get(key) || 0) - (staged.get(key) || 0)", "(held.get(key) || 0)"),
    ("allocate: HU-held stock counted as loose", M, "(parseFloat(balance.unrestricted_qty) || 0) - (held.get(key) || 0) - (staged.get(key) || 0)", "(parseFloat(balance.unrestricted_qty) || 0) - (staged.get(key) || 0)"),
    ("prepare: a failure keeps nothing back", M, "  await scRestore(req);\n};\nconst scDiff", "};\nconst scDiff"),
    ("prepare: Flat never asks which to expand", M, 'if (req.mode === "FLAT" && req.expand === null) {', "if (false) {"),
    ("prepare: no difference list", M, "    const oldSnap = req.diffFrom ? scSnapOf(req.diffFrom) : null;", "    const oldSnap = null;"),
    ("prepare: an older run writes over a newer one", M, "  if (!scCurrent(seq)) return;\n  await scWriteLines(", "  await scWriteLines("),
    ("prepare: inactive BOMs read", M, '          { prop: "is_active", operator: "equal", value: 1 },\n', ""),
    ("prepare: the saved ticks not pre-set", M, "expand: saved[t.itemId] ? 1 : 0", "expand: 0"),
    ("stamp: lines rebuilt instead", M, "    if (!(v.stock_movement || []).length) {\n      if (qty", "    if (true) {\n      if (qty"),
    ("stamp: references not set", M, "    if (x) updates[`stock_movement.${i}.requested_qty`] = x.requested_qty;\n", ""),
    ("link: the suggestion not applied at 0", M, "  const qty = scQ8(v.item_qty) <= 0 ? await scIaQtyFromLine(v, row.suggestion, row.uom_id) : null;", "  const qty = null;"),
    ("link: no mode set", M, '  if (!scModeOf(v)) await scSetMode("STANDARD");\n  v = this.getValues();\n  // the new line', "  v = this.getValues();\n  // the new line"),
    ("unlink: Flat dropped too", M, '  if (scModeOf(v) !== "FLAT") {\n    Object.assign(updates, { bom_snapshot_json: "", source_bom_id: "", planned_output_qty: null });',
     '  if (true) {\n    Object.assign(updates, { bom_snapshot_json: "", source_bom_id: "", planned_output_qty: null });'),
    ("unlink: the context cleared", M, '  const updates = { source_so_id: "", source_so_line_id: "" };\n  if (scModeOf(v) !== "FLAT") {', '  const updates = { source_so_id: "", source_so_line_id: "", source_so_context_json: "" };\n  if (scModeOf(v) !== "FLAT") {'),
    ("mode: Standard unlinked keeps a snapshot", M, "legacyAfter: !scLinked(v) });", "legacyAfter: false });"),
    ("mode: no confirm before Flat", M, 'if (hasLines && !(await scAsk("Flat replaces', 'if (false && !(await scAsk("Flat replaces'),
    ("item: Keep Item does not put it back", M, "        scStore({ sc_item: prevItem });\n        await this.setData({ item_id: prevItem });\n", ""),
    ("item: Change Item keeps the link", M, '    // the context stays: the save adds the UNLINK to its history\n    await this.setData({ source_so_id: "", source_so_line_id: "" });\n    scKeep(null);\n  }\n  if (value && scModeOf(v) === "FLAT")',
     '  }\n  if (value && scModeOf(v) === "FLAT")'),
    ("clone: the link kept", M, '  const updates = { source_so_id: "", source_so_line_id: "", source_so_context_json: "", planned_output_qty: null };\n  if (scModeOf(v) !== "FLAT") {\n    Object.assign(updates, { bom_snapshot_json: "", source_bom_id: "" });\n    (v.stock',
     '  const updates = { planned_output_qty: null };\n  if (scModeOf(v) !== "FLAT") {\n    Object.assign(updates, { bom_snapshot_json: "", source_bom_id: "" });\n    (v.stock'),
    ("clone: Flat ticks dropped", M, 'expand: snap && snap.mode === "FLAT" ? snap.expand : [], prev: null });\n  }\n};', "expand: [], prev: null });\n  }\n};"),
    ("plant: a clone rebuilt before its policy", M, "  if (this.isCopy && Number(scState().sc_cloned) !== 1) return;\n", ""),
    ("entry: an ineligible line kept", M, "  if (sum && !sum.eligibleNew) {", "  if (false) {"),
    ("entry: the suggestion not converted", M, "const qty = a === null || b === null ? null : scQ8((scNum(sum.totals.suggestion) * a) / b);", "const qty = scQ8(sum.totals.suggestion);"),
    ("summary: always excludes this IA", M, '    exclude_ia_id: editDraft ? scS(v.id) : "",', "    exclude_ia_id: scS(v.id),"),
    ("display: Re-link on any read-only orphan", M, '(status === "Completed" || status === "Fully Posted"), ["sc_btn_relink"]);', 'true, ["sc_btn_relink"]);'),
    ("render: 'still needed' never said", M, "        if (left > 0) row.sc_info_cover = ", "        if (false) row.sc_info_cover = "),
    ("render: 'fully covered' never said", M, '        else if (left === 0) row.sc_info_cover = "fully covered";', '        else if (false) row.sc_info_cover = "fully covered";'),
    ("render: over the order never said", M, "        else row.sc_info_over = ", "        else void "),
    ("render: the customer not shown", M, "    row.sc_info_customer = sum.customer;\n", ""),
    ("render: delivered not shown", M, "    row.sc_info_delivered = lineQty(sum.delivered);\n", ""),
    ("display: no section on editable pages", M, 'put(true, ["sc_section", "bom_consumption_mode", "sc_actions", "sc_btn_line"]);', 'put(true, ["bom_consumption_mode", "sc_actions", "sc_btn_line"]);'),
    ("display: the section on every read-only page", M, 'put(smallCycle, ["sc_section", "bom_consumption_mode", "planned_output_qty", "sc_info", "sc_actions"]);',
     'put(true, ["sc_section"]);\n    put(smallCycle, ["bom_consumption_mode", "planned_output_qty", "sc_info", "sc_actions"]);'),
    ("render: never reads missing figures", M, "const scRenderOrRead = async (v) => (scLinked(v) && scState().sc_sum === undefined ? scRefresh(v) : scRender(v));", "const scRenderOrRead = async (v) => scRender(v);"),
    ("suggest: 0 applied", M, '  if (!(qty > 0)) return scAlert("Nothing is left', '  if (false) return scAlert("Nothing is left'),
    ("variance: Flat expanded line allowed", V, "    if (hit) {\n      await this.$alert(", "    if (false) {\n      await this.$alert("),
    ("variance: stale references allowed", V, "  if (stale.length) {", "  if (false) {"),
    ("variance: no Sales Order warnings", V, "  const warnings = /^[0-9]{1,20}$/.test(scS(data.source_so_line_id)) ? await scVarWarnings(data) : [];", "  const warnings = [];"),
    ("variance: unavailable figures hidden", V, '  if (warnings === null) parts.push(', '  if (false) parts.push('),
    ("variance: units by id", V, "      ((u && u.data) || []).forEach((x) => (names[scS(x.id)] = scS(x.uom_name)));", ""),
    ("variance: manual lines not listed", V, '      differences.push("Added: " + label(l) + " (" + actual + ")");', ""),
    ("variance: removed rows not listed", V, '    if (!seen[scS(r.key)]) differences.push("Removed: "', '    if (false) differences.push("Removed: "'),
    ("variance: enhanced branch off", V, "  if (!snap) return scBaseConfirmBomVariance(data);", "  return scBaseConfirmBomVariance(data);"),
    # the final review's fix pass (10-20)
    ("item: our own item coming back asks again", M, "  if (value && value === prevItem) return;\n", ""),
    ("item: an unknown previous item asks to drop the link", M, "  if (!prevItem && scLinked(v)) return;\n", ""),
    ("item: the link's context not used to know the item", M, " || scS((scParseJ(v.source_so_context_json) || {}).itemId);", ";"),
    ("item: the link not carried to the restore", M, "prev: Object.assign({ item_id: prevItem }, link.source_so_line_id ? link : {}) });", "prev: { item_id: prevItem } });"),
    ("restore: the link not put back", M, "  if (p.source_so_line_id) {\n    // the link dropped for this change comes back with the earlier item\n    scStore({ sc_sum: undefined });\n"
     "    await this.setData({ source_so_id: p.source_so_id, source_so_line_id: p.source_so_line_id });\n  }\n", ""),
    ("mode: Standard after Standard rebuilds", M, '  if (old !== "FLAT") {\n    scStore({ sc_mode: "STANDARD" });', '  if (false) {\n    scStore({ sc_mode: "STANDARD" });'),
    ("qty: the references written after the question", M, [
        ("  await this.setData(updates);\n  let again = realloc.length > 0;", "  let again = realloc.length > 0;"),
        ("  const plantId = scS(v.issuing_operation_faci);\n  if (again && plantId) await scAllocate", "  await this.setData(updates);\n  const plantId = scS(v.issuing_operation_faci);\n  if (again && plantId) await scAllocate")]),
    ("summary: proposal on read-only pages", M, "  const propose = scEditable(v) && scQ8(v.item_qty) > 0;", "  const propose = scQ8(v.item_qty) > 0;"),
    ("render: suggestion and after-this-IA on read-only pages", M, "    if (editable) {\n      if (sum.suggestion", "    if (true) {\n      if (sum.suggestion"),
    ("render: 'other' on read-only pages", M, '" in " + (editable ? "other " : "") + "open IAs"', '" in other open IAs"'),
    ("render: the suggestion always takes off the produced", M,
     'const done = scNum(sum.delivered) > scNum(sum.produced) ? scNumText(sum.delivered) + " delivered" : scNumText(sum.produced) + " produced";', 'const done = scNumText(sum.produced) + " produced";'),
    ("render: the server's EXCESS repeated", M, '.filter((w) => w.code !== "EXCESS")', ""),
    ("render: an inactive line's suggestion with a sum", M, '      else if (!sum.active) row.sc_info_suggest = lineQty(0) + ": the line has no remaining demand";\n', ""),
    ("render: warnings not marked", M, r'"\u26a0 " + swap(w.text)', "swap(w.text)"),
    ("render: an empty BOM part kept", M, '"prepared " + scS(snap.preparedAt).slice(0, 10) : ""].filter((x) => x).join(" · ");', '"prepared " + scS(snap.preparedAt).slice(0, 10) : ""].join(" · ");'),
    ("render: Prepare BOM named on a view", M, '"not prepared yet" + (editable ? ": press Prepare BOM" : "")', '"not prepared yet: press Prepare BOM"'),
    ("render: rows without a fact stay shown", M, "  if (off.length) this.hide(off);\n};", "};"),
    ("render: the baseline's unit not named", M, "ids.concat([(scParseJ(v.source_so_context_json) || {}).uomId])", "ids"),
    ("render: long unit ids not named", M, r"all.concat(scS(w.text).match(/\b[0-9]{15,20}\b/g) || [])", "all"),
    ("render: '1 sub-assemblies'", M, '(n === 1 ? " sub-assembly" : " sub-assemblies")', '" sub-assemblies"'),
    ("link: the client writes a history entry", M, "linkedAt: now, linkedBy: by, history: Array.isArray(old.history) ? old.history : [] };",
     'linkedAt: now, linkedBy: by, history: (Array.isArray(old.history) ? old.history : []).concat([{ op: "LINK" }]) };'),
    ("link: no figures read before the writes", M, "  scStore({ sc_sum: undefined });\n  await scRefresh(v);\n", ""),
    ("entry: the figures not kept", M, "  scKeep(sum, fa === null || fb === null ? null : fa / fb);\n", ""),
    ("entry: the client writes a LINK", M, "linkedAt: now, linkedBy: by,\n      history: [] });", 'linkedAt: now, linkedBy: by,\n      history: [{ op: "LINK" }] });'),
    ("prepare: the panel always re-reads the figures", M, "  scRedisplay(after);\n  await scRenderOrRead(after);\n};", "  scRedisplay(after);\n  await scRefresh(after);\n};"),
    ("link: no lines, planned left empty", M, '      } else if (scS(v.planned_output_qty) === "") await this.setData({ planned_output_qty: scQ8(v.item_qty) });\n      return scPrepare(', "      }\n      return scPrepare("),
    ("entry: an ineligible line keeps the mode", M, 'source_so_context_json: "", bom_consumption_mode: "" });', 'source_so_context_json: "" });'),
    ("entry: an ineligible line leaves the item unfilled", M, '    this.triggerEvent("onChange_assembledItem", { value: v.item_id, scLegacy: true });\n    return;', "    return;"),
    ("prepare: the header written apart from the lines", M, "  await this.setData(Object.assign({}, header || {}, { stock_movement: lines }));", "  if (header) await this.setData(header);\n  await this.setData({ stock_movement: lines });"),
    ("prepare: no serial cap notice", M, "    if (!req.legacyAfter) await scCapNotice(r.rows);\n", ""),
    ("cap: serial lines not counted", M, "if (picks + serials <= SC_CLASSIC_MAX_PICKS) return;", "if (picks <= SC_CLASSIC_MAX_PICKS) return;"),
    ("cap: told without a serial component", M, "  if (!serials) return;\n", ""),
]

survived = 0
for m in MUTANTS:
    name, rel, old = m[0], m[1], m[2]
    new = m[3] if len(m) > 3 else None
    tmp = tempfile.mkdtemp(prefix="sc-client-mut-")
    src, out = os.path.join(tmp, "src"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(CLIENT, "src"), src)
    path = os.path.join(src, rel)
    text = open(path, encoding="utf-8").read()
    pairs = old if isinstance(old, list) else [(old, new)]
    broken = [a for a, _ in pairs if text.count(a) != 1]
    if broken:
        print("BROKEN mutant (anchor not found once): %s" % name)
        survived += 1
        continue
    for a, b in pairs:
        text = text.replace(a, b, 1)
    open(path, "w", encoding="utf-8").write(text)
    env = dict(os.environ, SC_SRC=src, SC_OUT_DIR=out)
    b = subprocess.run([sys.executable, os.path.join(CLIENT, "build_client_sc.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        shutil.rmtree(tmp, ignore_errors=True)
        continue
    killed = []
    for t in TESTS:
        r = subprocess.run(["node", os.path.join(HERE, t)], env=env, capture_output=True, text=True, timeout=600)
        if r.returncode:
            killed.append(t)
            break
    if not killed:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
