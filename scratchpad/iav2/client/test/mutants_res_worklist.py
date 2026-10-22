"""python3 scratchpad/iav2/client/test/mutants_res_worklist.py - RES-01 MIN-03 in the IA list (the Reservation column, Retry
Reservation, the pending reservations finished on open): each mutant of the BUILT list page (Item Assembly & BOM/AsyncV2/IAlistPage.json,
the ON build) must make test/test_lists.js fail (IA_LIST = the mutated copy)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IAlistPage.json")
J = lambda s: json.dumps(s)[1:-1]
# a 4th element = a marker that appears once: the mutant changes the first occurrence of its anchor after it (Retry Reservation and the
# bulk Cancel share some lines)
RETRY = J("// RES-01 MIN-03 (BA 10-22): Retry Reservation, the list's worklist action")
CANCEL = J("// RES-01 Cancel from the list (user 10-22, like the Goods Delivery list)")
MUTANTS = [
    # Retry Reservation
    ("retry: the stale row trusted", J("      const ia = byId[id];\n"), J("      const ia = row;\n"), RETRY),
    ("retry: the stored read without the hold status", J('.field("id,stock_movement_no,item_assembly_status,material_hold_status,organization_id")'), J('.field("id")')),
    ("retry: the stored read not by the selected ids", J('{ prop: "id", operator: "in", value: ids }'), J('{ prop: "is_deleted", operator: "equal", value: 0 }'), RETRY),
    ("retry: the stored read capped at 1", J(".limit(ids.length)"), J(".limit(1)"), RETRY),
    ("retry: a failed read taken as nothing stored", J("  if (!stored) {"), J("  if (false) {"), RETRY),
    ("retry: Created never reconciled", J('status === "Created" && mark !== ""'), J('status === "Created" && false')),
    ("retry: a closed completed IA closed again", J("&& RES_CLOSING.indexOf(mark) >= 0"), J("&& true")),
    ("retry: any Draft reconciled", J('status === "Draft" && mark !== "" && mark !== "NONE" && mark !== "CLOSED"'), J('status === "Draft"')),
    ("retry: Cancelled never released", J('status === "Cancelled" && mark !== "" && mark !== "NONE"'), J('status === "Cancelled" && false')),
    ("retry: Cancelled reconciled", J('? "RELEASE_ALL"'), J('? "RECONCILE"')),
    ("retry: another source", J('operation: op, source: "LIST"'), J('operation: op, source: "FORM"')),
    ("retry: Processing not named", J('(status === "Processing" ? "being completed in the background" : "nothing to retry")'), J('"nothing to retry"')),
    ("retry: the list not refreshed", J("  if (sent) this.refresh();\n"), "", RETRY),
    # the bulk Cancel (user 10-22)
    ("cancel: the list's status trusted", J("      const ia = byId[id];\n"), J("      const ia = row;\n"), CANCEL),
    ("cancel: the selection's status counted", J('const todo = selected.filter((r) => s((byId[s(r && r.id)] || {}).item_assembly_status) === "Created");'),
     J('const todo = selected.filter((r) => s(r && r.item_assembly_status) === "Created");'), CANCEL),
    ("cancel: a non-Created one sent", J('      if (status !== "Created") {'), J("      if (false) {"), CANCEL),
    ("cancel: not asked first", J("    await this.$confirm(`Cancel ${n}"), J("    if (false) await this.$confirm(`Cancel ${n}"), CANCEL),
    ("cancel: busy not waited for", J('for (let i = 0; i < 3 && d && s(d.code) === "409"; i++) {'), J("for (let i = 0; i < 0; i++) {"), CANCEL),
    ("cancel: a release that did not finish reported as cancelled", J('r && r.cancelled === true ? "cancelled"'), J('r ? "cancelled"'), CANCEL),
    ("cancel: sent as the form", J('operation: "CANCEL", source: "LIST"'), J('operation: "CANCEL", source: "FORM"'), CANCEL),
    ("cancel: the list not refreshed", J("  if (sent) this.refresh();\n"), "", CANCEL),
    ("cancel: a failed read taken as nothing stored", J("  if (!stored) {"), J("  if (false) {"), CANCEL),
    # the pending ones finished on open
    ("kick: shipped off", J("const IA_RES_ENABLED = true;"), J("const IA_RES_ENABLED = false;")),
    ("kick: no throttle", J('due("ia_res_kick_at", 120000)'), J('due("ia_res_kick_at", 0)')),
    ("kick: not only the Reserving ones", J('{ prop: "material_hold_status", operator: "equal", value: "RESERVING" },\n'), ""),
    ("kick: not only Created", J('\n            { prop: "item_assembly_status", operator: "equal", value: "Created" },'), ""),
    ("kick: unbounded", J(".limit(10)"), J(".limit(5000)")),
    ("kick: another source", J('operation: "RECONCILE", source: "LIST" });'), J('operation: "RECONCILE", source: "FORM" });')),
    ("kick: refreshed for answers that changed nothing", J('if (s(d.code) === "200" && status !== "" && status !== "RESERVING") moved = true;'), J("moved = true;")),
    ("kick: never refreshed", J("    if (moved) this.refresh();\n"), ""),
    # MIN-05 (BA 10-22): the sweep of IAs deleted while still holding
    ("sweep: switched off with the reservation switch", J('const sweep = due("ia_res_sweep_at", 600000);'), J('const sweep = IA_RES_ENABLED === true && due("ia_res_sweep_at", 600000);')),
    ("sweep: no throttle", J('due("ia_res_sweep_at", 600000)'), J('due("ia_res_sweep_at", 0)')),
    ("sweep: never runs", J("    if (sweep) {"), J("    if (false) {")),
    ("sweep: a non-200 answer trusted", J('const r = s(d.code) === "200" ? JSON.parse('), J("const r = true ? JSON.parse(")),
    ("sweep: a malformed id released", J("        if (!digits(x && x.id) || !digits(x && x.org)) continue;\n"), ""),
    ("sweep: released from another source", J('operation: "RELEASE_ALL", source: "LIST" });'), J('operation: "RELEASE_ALL", source: "FORM" });')),
    # the Reservation column
    ("column: another field key", '"wsldpopa"', '"wsldpop0"'),
    ("column: a label lost", J(">Partially reserved</div>"), J(">Partial</div>")),
]
text = open(LIST, encoding="utf-8").read()
survived = 0
for m in MUTANTS:
    name, old, new = m[0], m[1], m[2]
    after = m[3] if len(m) > 3 else None
    if after is not None:
        i = text.find(old, text.find(after)) if text.count(after) == 1 else -1
        if i < 0:
            print("BROKEN mutant (marker or anchor not found): %s" % name)
            survived += 1
            continue
        mutated = text[:i] + new + text[i + len(old):]
    elif text.count(old) != 1:
        print("BROKEN mutant (anchor found %d times): %s" % (text.count(old), name))
        survived += 1
        continue
    else:
        mutated = text.replace(old, new, 1)
    fd, path = tempfile.mkstemp(prefix="ialist-mut-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(mutated)
    r = subprocess.run(["node", os.path.join(HERE, "test_lists.js")], env=dict(os.environ, IA_LIST=path, IA_EXPECT_ON="1"), capture_output=True, text=True, timeout=300)
    os.remove(path)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
