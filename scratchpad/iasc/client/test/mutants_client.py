"""python3 scratchpad/iasc/client/test/mutants_client.py - each mutant of the Small Cycle client sources (client/src) is built
into a temp folder (SC_SRC / SC_OUT_DIR) and must make at least one client test fail.
Equivalent in the mock (kept out, reasons): the prologue's scLegacy guard and the QTY echo guard defend against platform timing
(a same-tick stale read, an echo arriving mid-confirm) that the harness runs in a fixed order; scReadIds' check of a
malformed answer (the mock db always answers an array)."""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.dirname(HERE)
TESTS = ["test_sc_legacy.js", "test_sc_link.js", "test_sc_prepare.js", "test_sc_qty.js", "test_sc_variance.js", "test_sc_panel.js", "test_v2_double.js", "test_res_draft.js", "test_res_own.js", "test_res_mount.js", "test_res_close.js"]
# the double-click patch is JSON (src/v2_double_patch.json): its anchors are written as JSON string text
J = lambda s: json.dumps(s)[1:-1]
D = "v2_double_patch.json"
O = "sc_res_own.js"
OP = "res_own_patch.json"
M = "sc_main.js"
V = "sc_variance.js"
MUTANTS = [
    # RES-01 R4: the holds closed after a completion
    ("close: an IA that never reserved closed", "sc_close_after.js", 'if (s(data.page_status) !== "Edit" || !s(data.material_hold_status)) return;', 'if (s(data.page_status) !== "Edit") return;'),
    ("close: an IA that never reserved closed", "sc_close_after.js", ' || !s(data.material_hold_status)) return;', ") return;"),
    ("close: a clone or new IA closed", "sc_close_after.js", 'if (s(data.page_status) !== "Edit" || !s(', "if (!s("),
    ("close: another source", "sc_close_after.js", 'operation: "CLOSE", source: "COMPLETE" }', 'operation: "CLOSE", source: "FORM" }'),
    ("close: the classic completion never closes", "res_close_patch.json", J("    resCloseAfter(workflowResult.data, data);\n    this.$message.success"), J("    this.$message.success")),
    ("close: Complete & Post never closes", "res_close_patch.json", J("    resCloseAfter({ id: stockMovementId }, data);\n    await postToAccounting"), J("    await postToAccounting")),
    ("close: IA V2 never closes", "res_close_patch.json", J("      resCloseAfter({ id: job.iaId }, ctx.record);\n      if (ctx.mode"), J("      if (ctx.mode")),
    # RES-01 R3: an enrolled IA opened
    ("mount: the reservation on open ignores the switch (review I4)", M, 'if (hold === "RESERVING" && resOn()) resKick', 'if (hold === "RESERVING") resKick'),
    ("mount: Reserving not started again", M, '    if (hold === "RESERVING" && resOn()) resKick(v, "RECONCILE", true);\n', ""),
    ("mount: a completed IA in review told to save (review M10)", M, 'status === "REVIEW" && !draft ?', "false ?"),
    ("mount: a completed IA's holds never closed", M, '  } else if ((status === "Completed" || status === "Fully Posted") && RES_CLOSING.indexOf(hold) >= 0) resKick(v, "CLOSE", false);',
     "  }"),
    ("mount: a closed IA closed again", M, "RES_CLOSING.indexOf(hold) >= 0) resKick(", "true) resKick("),
    ("mount: another IA's holds counted", M, 'scReadMany("on_reserved_gd", "doc_id", [scS(v.id)], [', 'scReadMany("on_reserved_gd", "doc_type", ["Item Assembly"], ['),
    ("mount: holds in flight counted", M, '{ prop: "status", operator: "equal", value: "Allocated" },', ""),
    ("mount: a clone keeps its hold status", M, '    if (scS(v.material_hold_status) || scS(v.material_hold_at)) Object.assign(clear, { material_hold_status: "", material_hold_at: "" });\n', ""),
    ("mount: not-reservable lines figured", M, ': notHeld ? "not reserved" : scNumText(reserved);', ": scNumText(reserved);"),
    ("mount: the required ignores the reference", M, ": scNum(l.requested_qty) > 0 ? scNum(l.requested_qty) : scNum(l.total_quantity);", ": scNum(l.total_quantity);"),
    ("mount: the answer not kept in the form", M, "    await this.setData({ material_hold_status: scS(r.status), material_hold_at: scS(r.checkedAt) });\n", ""),
    # RES-01 R3: the IA's own holds added back where it reads free stock
    ("own holds: a clone's source counted (review I2)", O, 's(v.page_status) === "Edit" && ', ""),
    ("own holds: an IA that never reserved counted (review I4)", O, 's(v.material_hold_status) !== "" && ', ""),
    ("own holds: the form read for every IA (v36's calls)", O, '.some((r) => r && String(r.doc_type) === "Item Assembly") ? resOwnId(values()) : "")', ".length >= 0 ? resOwnId(values()) : \"\")"),
    ("own holds: another document's holds added", O, " || s(r.doc_id) !== s(iaId)", ""),
    ("own holds: a GD's holds added", O, ' || s(r.doc_type) !== "Item Assembly"', ""),
    ("own holds: any category", O, 'if ((s(r.from_category) || "Unrestricted") !== category || ', "if ("),
    ("own holds: units not converted", O, "* (conv && parseFloat(conv.base_qty) > 0 ? parseFloat(conv.base_qty) : 1)", "* 1"),
    ("own holds: a handling-unit row added", O, " || s(r.handling_unit_id)) return;", ") return;"),
    ("explode: no add-back", OP, J(") + resOwnHeld(reservationRes.data, resIa(), "), J(") + 0 * resOwnHeld(reservationRes.data, resIa(), ")),
    ("explode: the IA id never read", OP, J("const resIa = () => (resIaMemo === null ? (resIaMemo = resOwnIdOf(reservationRes.data, () => this.getValues() || {})) : resIaMemo);"),
     J('const resIa = () => "";')),
    ("component quantity: no add-back", OP, J(") + resOwnHeld(reservationRes.data, resOwnId(allData), "), J(") + 0 * resOwnHeld(reservationRes.data, resOwnId(allData), ")),
    ("component quantity: no conversions read", OP, J(' + (resOwnId(allData) ? ",based_uom,table_uom_conversion" : "")'), ""),
    ("picker: the reserved not reduced", OP, J("            row.reserved_qty = Math.max(0, (parseFloat(row.reserved_qty) || 0) - own);\n"), ""),
    # RES-01 R3: the reservation started after a Draft save
    ("draft hold: the switch ignored", "sc_draft_hold.js", "if (!RES_ENABLED || !/^[1-9]", "if (!/^[1-9]"),
    ("draft hold: an IA that never reserved is reserved", "sc_draft_hold.js", '!(isNew || s(data.material_hold_status) !== "")', "false"),
    ("draft hold: a big IA waited for", "sc_draft_hold.js", "if (picks > RES_WAIT_PICKS) {", "if (false) {"),
    ("draft hold: the result never shown", "sc_draft_hold.js", '    if (status === "FULL" || status === "NONE") this.$message.success(s(d.message));\n    else this.$message.warning(s(d.message));\n', ""),
    ("draft hold: a partial result shown as a success", "sc_draft_hold.js", "    else this.$message.warning(s(d.message));", "    else this.$message.success(s(d.message));"),
    ("draft hold: an answer without a result shown", "sc_draft_hold.js", "    if (!s(d.result_json)) return;\n", ""),
    ("draft hold: another source", "sc_draft_hold.js", 'operation: "RECONCILE", source: "SAVE" }', 'operation: "RECONCILE", source: "FORM" }'),
    ("double click: not claimed before the first await", D, J("\n    store({ ia_submitting: 1 });\n    const values"), J("\n    const values")),
    ("double click: a Cancel at the BOM check keeps the claim", D, J("return unclaim();\n"), J("return;\n")),
    ("double click: the classic route keeps the claim", D, J("  else unclaim();\n"), ""),
    ("post once: no per-job guard", D, J('    if (localStorage.getItem("ia_v2_posted_" + s(job.jobId))) return false;\n'), ""),
    ("post once: the stored status not checked", D, J('  return !!row && key(row.item_assembly_status) === "Completed"'), J("  return true || !!row && key(row.item_assembly_status) === \"Completed\"")),
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
    ("unlink: the prepared BOM dropped", M, '  await this.setData({ source_so_id: "", source_so_line_id: "" });\n  scKeep(null);',
     '  await this.setData({ source_so_id: "", source_so_line_id: "", bom_snapshot_json: "", source_bom_id: "", planned_output_qty: null });\n  scKeep(null);'),
    ("unlink: the context cleared", M, '  await this.setData({ source_so_id: "", source_so_line_id: "" });\n  scKeep(null);', '  await this.setData({ source_so_id: "", source_so_line_id: "", source_so_context_json: "" });\n  scKeep(null);'),
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
    ("render: 'still needed' never said", M, '        else row.sc_info_cover = lineQty(left) + " still needed";', "        else void 0;"),
    ("render: 'fully covered' never said", M, '        else if (left === 0) row.sc_info_cover = "fully covered";', '        else if (false) row.sc_info_cover = "fully covered";'),
    ("render: over the order never said", M, "        if (left < 0) row.sc_info_over = ", "        if (left < 0) void "),
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
    ("render: suggestion and after-this-IA on read-only pages", M, '    if (editable) {\n      if (sum.unavailable === "OVERLAP")', '    if (true) {\n      if (sum.unavailable === "OVERLAP")'),
    ("render: 'other' on read-only pages", M, '" in " + (editable ? "other " : "") + "open IAs"', '" in other open IAs"'),
    ("render: the suggestion always takes off the produced", M,
     'const done = scNum(sum.delivered) > scNum(sum.produced) ? scNumText(sum.delivered) + " delivered" : scNumText(sum.produced) + " produced";', 'const done = scNumText(sum.produced) + " produced";'),
    ("render: the server's EXCESS repeated", M, '.filter((w) => w.code !== "EXCESS")', ""),
    ("render: an inactive line's suggestion with a sum", M, '      else if (!sum.active) row.sc_info_suggest = lineQty(0) + ": the line has no remaining demand";\n', ""),
    ("render: warnings not marked", M, r'"\u26a0 " + swap(w.text)', "swap(w.text)"),
    ("render: an empty BOM part kept", M, '"prepared " + scS(snap.preparedAt).slice(0, 10) : ""].filter((x) => x).join(" · ");', '"prepared " + scS(snap.preparedAt).slice(0, 10) : ""].join(" · ");'),
    ("render: Prepare BOM named on a view", M, '"not prepared yet" + (editable ? ": press Prepare BOM" : "")', '"not prepared yet: press Prepare BOM"'),
    ("render: rows without a fact stay shown", M, "  if (off.length) this.hide(off);\n  // Use Suggestion only", "  // Use Suggestion only"),
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
    ("render: overlap ignored in After This IA", M, "const overlap = Math.min(scNum(sum.delivered), scNum(sum.produced)) > 0;", "const overlap = false;"),
    ("render: 'at least' dropped", M, '(overlap ? "at least " : "")', '""'),
    ("render: an unavailable figure shown as one", M, '      if (sum.unavailable === "OVERLAP") row.sc_info_suggest = ', "      if (false) row.sc_info_suggest = "),
    ("render: Use Suggested Qty never disabled", M, 'this.disabled(["sc_btn_suggest"], !(sum && sum.suggestion !== null));', 'this.disabled(["sc_btn_suggest"], false);'),
    ("suggest: an unavailable figure not explained", M, '  if (keep.unavailable === "OVERLAP") {', "  if (false) {"),
    ("entry: an unavailable figure not explained", M, '  } else if (sum && sum.totals && sum.totals.unavailable === "OVERLAP") {', "  } else if (false) {"),
    ("dialog: versions not shown", M, 'bom: (t.versions || []).join(", ") || scS(t.version)', "bom: scS(t.version)"),
    ("dialog: uses not shown", M, "uses: t.uses || 1,", "uses: 1,"),
    ("dialog: parents not shown", M, 'under: (t.parents || []).join(", ") || ', "under: "),
    ("dialog: no note", M, ', "sc_expand_dialog.sc_expand_note": SC_EXPAND_NOTE', ""),
    # UI-01: Actual Received in place of Output to Receive on a completed IA; the Production buttons; the BOM row; Use Suggestion said
    ("actual: never swapped", M, '  if ((page === "Edit" || page === "View") && (status === "Completed" || status === "Fully Posted")) {', "  if (false) {"),
    ("actual: View not swapped", M, '(page === "Edit" || page === "View") && (status', '(page === "Edit") && (status'),
    ("actual: Fully Posted not swapped", M, '(status === "Completed" || status === "Fully Posted")) {\n    await this.setData({ sc_actual', '(status === "Completed")) {\n    await this.setData({ sc_actual'),
    ("actual: swapped on any page", M, 'if ((page === "Edit" || page === "View") && (status === "Completed"', 'if ((true) && (status === "Completed"'),
    ("actual: the quantity not hidden", M, '    this.hide(["item_qty"]);\n', ""),
    ("actual: no value", M, "    await this.setData({ sc_actual: scNumText(v.item_qty) });\n", ""),
    ("display: no Production buttons", M, '"sc_btn_bom", "sc_prod_actions"]);\n    put(linked', '"sc_btn_bom"]);\n    put(linked'),
    ("display: Production buttons on a read-only page", M, '"sc_btn_suggest", "sc_btn_bom", "sc_prod_actions"]);\n  }', '"sc_btn_suggest", "sc_btn_bom"]);\n    put(true, ["sc_prod_actions"]);\n  }'),
    ("display: the BOM row left on an ordinary IA", M, '  if (!smallCycle) hide.push("sc_info_bom");\n', ""),
    ("suggest: both quantities not said", M, '  this.$message.success("Use Suggestion: ', '  void ("Use Suggestion: '),
    # FIX-06: Re-link sends the IA as opened; FIX-03: a refusal shows its reason, and only for that read
    ("relink: the link as opened not sent", M, "expected_line_id: scS(v.source_so_line_id), ", ""),
    ("relink: the status as opened not sent", M, ", expected_status: scS(v.item_assembly_status) });", " });"),
    ("projection: a refusal's reason dropped", M, '      if (scS(d.code) === "400") scStore({ sc_refused: scS(d.message) });\n', ""),
    ("projection: an old refusal kept", M, '  scStore({ sc_refused: "" });\n  try {\n    const res = await scRun(SC_WF_PROJECTION', '  try {\n    const res = await scRun(SC_WF_PROJECTION'),
    ("Select SO Line: the refusal's reason not shown", M, 'scAlert(scHtml(scWhyNot("The Sales Order lines could not be read.', 'scAlert(scHtml(("The Sales Order lines could not be read.'),
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
