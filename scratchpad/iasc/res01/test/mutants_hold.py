"""python3 scratchpad/iasc/res01/test/mutants_hold.py - each mutant of IA_HOLD's code (res01/code) is built into a temp folder and must
make test_hold_core.js (the core) or sim_hold.js (the built workflow) fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.dirname(HERE)
C = "shared/hold.js"
MUTANTS = [
    ("guard: no session user", "hold/guard.js", 'if (!digits(inp.uid)) return bad("no session user");', ""),
    ("guard: any operation", "hold/guard.js", 'if (op !== "RECONCILE" && op !== "RELEASE_ALL" && op !== "CLOSE") return bad(', "if (false) return bad("),
    ("plan: a non-member reserves (FIX-03)", "hold/plan.js", "if (!(Number(member) > 0)) return stop(", "if (false) return stop("),
    ("plan: another organisation's IA", "hold/plan.js", "if (hdS(ia.organization_id) !== hdS(g.org)) return stop(", "if (false) return stop("),
    ("plan: Processing not refused", "hold/plan.js", 'if (status === "Processing") return stop(', "if (false) return stop("),
    ("plan: a completed IA reserved", "hold/plan.js", 'if (!closing && status !== "Draft") return stop(', "if (false) return stop("),
    ("plan: a not-enrolled IA reserved", "hold/plan.js", 'if (g.op === "RECONCILE" && !hdS(ia.hold) && !rows.length) return stop(', "if (false) return stop("),
    ("plan: a live run ignored", "hold/plan.js", "if (live.length) return stop(", "if (false) return stop("),
    ("plan: a dead run's ticket blocks forever", "hold/plan.js", "< HD_LEASE_MS);", "< Infinity);"),
    ("delta: an unfinished run not resolved", "hold/delta.js", "const rec = hdRecover(rows, state);", "const rec = [];"),
    ("delta: uncertain taken as nothing to fear", "hold/delta.js", 'if (x.outcome === "UNCERTAIN") return void (uncertain = true);', 'if (x.outcome === "UNCERTAIN") return;'),
    ("moves: no screen", "hold/moves.js", "(delta.holds || []).forEach((h) => (bad[pk(h.frag)] ? notHeld.push({ lineId: h.frag.lineId, reason: bad[pk(h.frag)] }) : holds0.push(h)));",
     "(delta.holds || []).forEach((h) => holds0.push(h));"),
    ("moves: the duplicate screen off", "hold/moves.js", 'if (hdNum(b.item_rows) > 1 || hdNum(b.batch_rows) > 1) bad[key] = "DUPLICATE_BALANCE";', 'if (false) bad[key] = "DUPLICATE_BALANCE";'),
    ("moves: no cap", "hold/moves.js", "const cap = hdCap(holds0, balRows || [], items, releases);", "const cap = { holds: holds0, short: [] };"),
    ("moves: one ticket number for ever", "hold/moves.js", "const n = hdNum(st.ticket_max) + 1;", "const n = 1;"),
    ("mutex: the lowest ticket loses", "hold/mutex.js", "const first = live.slice().sort((a, b) => hdNum(a.n) - hdNum(b.n))[0];",
     "const first = live.slice().sort((a, b) => hdNum(b.n) - hdNum(a.n))[0];"),
    ("ans: a refusal taken as applied", "hold/ans.js", 'code === "200" ? "DONE" : code === "400" && rc ? "NOTHING" : "ASK"', 'code === "200" || rc ? "DONE" : "ASK"'),
    ("ans: no answer taken as nothing moved", "hold/ans.js", 'code === "400" && rc ? "NOTHING" : "ASK"', '"NOTHING"'),
    ("finish: uncertain not reviewed", "hold/finish.js", 'const review = outcome === "UNCERTAIN" ? "the stock move did not report back" :', "const review ="),
    ("finish: a refused move not reviewed", "hold/finish.js", '    : refused ? (closing ? "the reserved stock could not be released (" : "the stock changed while reserving (") + (hdS(ans.result_code) || "refused") + ")"\n', ""),
    ("core: the hold moves under the IA's own number", C, 'trx_no: ctx.iaNo + "/H",', "trx_no: ctx.iaNo,"),
    # R4: the completion split (shared/split.js)
    ("split: the held part issued as picked", "shared/split.js", 'sm_quantity: held, category: "Reserved" }', "sm_quantity: held, category: cat }"),
    ("split: another line's holds used", "shared/split.js", "const key = [s(l.id), s(l.item_selection), s(p.location_id)", "const key = [\"\", s(l.item_selection), s(p.location_id)"),
    ("split: the hold's category ignored", "shared/split.js", 's(r.batch_id), s(r.from_category) || "Unrestricted"].join("|");', 's(r.batch_id), "Unrestricted"].join("|");'),
    ("split: a used hold not taken off", "shared/split.js", "        left[key] = q8((left[key] || 0) - held * f);\n", ""),
    ("split: a live ticket ignored", "shared/split.js", "if (num(st.live) > 0 || rows.some(", "if (rows.some("),
    ("split: a hold in flight ignored", "shared/split.js", 'rows.some((r) => s(r.status) === "Processing" || s(r.status) === "Releasing")) return busy;', 'false) return busy;'),
    ("split: units not converted", "shared/split.js", "return c && num(c.base_qty) > 0 ? num(c.base_qty) : 1;", "return 1;"),
    ("split: a handling-unit pick split", "shared/split.js", "if (!(qty > 0) || s(p.handling_unit_id)) return void next.push(p);", "if (!(qty > 0)) return void next.push(p);"),
    ("split: no read taken as nothing held", "shared/split.js", 'if (!st || typeof st !== "object") return busy;', 'if (!st || typeof st !== "object") st = { rows: [], live: 0 };'),
    # R5: a reverted completion (shared/revert.js)
    ("revert: Reserved kept as Reserved", "shared/revert.js", 'inventory_category: p.cat }', "inventory_category: a.inventory_category }"),
    ("revert: every IA treated as reserving", "shared/revert.js", 'if (s(holdStatus) === "") return list.map((a) => a);', 'if (false) return list.map((a) => a);'),
    ("revert: an earlier cycle's rows counted (review I3)", "shared/revert.js", ".filter((d) => d && after(d.id))", ".filter((d) => d)"),
    ("revert: no exact match first (review I3)", "shared/revert.js", "    if (!e) return;\n", "    if (true) return;\n"),
    ("revert: a split part keeps its index (review I3)", "shared/revert.js", "j > 0 ? { index: ++next } : {}", "{}"),
    ("hold key: no unit (review M2)", "shared/hold.js", 'hdS(cat), hdS(uom)].join("|");', 'hdS(cat)].join("|");'),
    ("status: NONE while holding (review M3)", "shared/hold.js", 'need === 0 ? (holding ? "FULL" : "NONE")', 'need === 0 ? "NONE"'),
    ("CLOSE: the completion's split ignored (review M1)", "hold/delta.js", "hdClose(rowsAfter, net.net, items, split.used)", "hdClose(rowsAfter, net.net, items)"),
    ("CLOSE: no split pass (review M1)", "shared/hold.js", "want[x.split] || 0, left[x.pk] || 0", "0, left[x.pk] || 0"),
    ("finish: a newer save's mark overwritten (review I1)", "hold/finish.js", 'const again = !review && hdS(g.op) === "RECONCILE"', 'const again = false && hdS(g.op) === "RECONCILE"'),
    ("clock: the session's NOW() (review M7)", "sql_hold.py", "DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s')", "DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')"),
    # CLOSE (after completion)
    ("core: hdNet ignores the deliveries", C, "    net[pk] = hdQ8((net[pk] || 0) - hdNum(d.delivered_qty) * (hdFactor((items || {})[hdS(d.material_id)], d.item_uom) || 1));\n", ""),
    ("core: a CLOSE remainder written Processing", C, 'add.push({ doc_type: "Item Assembly", status: "Releasing",', 'add.push({ doc_type: "Item Assembly", status: "Processing",'),
    ("plan: CLOSE on any status", "hold/plan.js", 'if (closing && status !== "Completed" && status !== "Fully Posted") return stop(', "if (false) return stop("),
    ("plan: the number not checked", "hold/plan.js", "const safeNo = /^[A-Za-z0-9 ._#()\\/-]{1,64}$/.test(hdS(ia.no));", "const safeNo = true;"),
    ("delta: CLOSE reconciles instead", "hold/delta.js", '  if (g.op === "CLOSE") {\n', "  if (false) {\n"),
    ("delta: this cycle's deliveries not subtracted", "hold/delta.js", "const net = hdNet(consumedRows, items);",
     'const net = { net: (consumedRows || []).reduce((o, x) => (x.kind === "OUT" ? Object.assign(o, { [x.key]: hdNum(x.base) }) : o), {}), under: [] };'),
    ("moves: deliveries dropped", "hold/moves.js", "const deliver = (delta.deliver || []).map(", "const deliver = [].map("),
    ("moves: the engine called with no move", "hold/moves.js", 'out.needCall = moves.length ? "YES" : "NO";', 'out.needCall = "YES";'),
    ("finish: inserted rows taken as Processing", "hold/finish.js", 'status: hdS(r.status) || "Processing"', 'status: "Processing"'),
    ("finish: a restored remainder not counted as held", "hold/finish.js", "f.publish.concat(f.restore.filter((u) => !before[u.id]))", "f.publish"),
    ("finish: delivered rows counted as held", "hold/finish.js", "f.close.concat(f.drop).concat(mv.deliver || [])", "f.close.concat(f.drop)"),
    ("finish: CLOSE labelled by coverage", "hold/finish.js", ': closing ? "CLOSED" : again ? "RESERVING" : sum.status;', ': again ? "RESERVING" : sum.status;'),
    ("finish: over-consumption not reviewed", "hold/finish.js", '    : (delta.over || []).length ? "the completion used more reserved stock than', '    : false ? "the completion used more reserved stock than'),
    ("finish: the ticket never freed", "hold/finish.js", 'const won = hdS(mutex.route) === "WIN" && hdS(mutex.ticketId);', "const won = false;"),
    ("core: Processing rows counted as held", C, 'if (hdS(r.status) !== "Allocated" || Number(r.is_deleted) === 1) return;\n    const key = hdKey(',
     "if (Number(r.is_deleted) === 1) return;\n    const key = hdKey("),
    ("core: DONE does not close released rows", C, '      if (st === "Releasing") out.close.push(', '      if (false) out.close.push('),
    ("core: released stock not free again", C, "  (releases || []).forEach((r) => {\n    const factor = hdFactor((items || {})[r.frag.materialId], r.frag.uomId) || 1;",
     "  [].forEach((r) => {\n    const factor = hdFactor((items || {})[r.frag.materialId], r.frag.uomId) || 1;"),
    ("core: holds before releases", C, "  (releases || []).forEach((r, i) => {\n    const k = \"X\" + (i + 1);", "  [].forEach((r, i) => {\n    const k = \"X\" + (i + 1);"),
    ("core: handling-unit picks held", C, "        if (hdS(p.handling_unit_id)) return void (reasons.HANDLING_UNIT = 1);\n", ""),
    ("core: serial items held", C, '    if (Number(item.serial_number_management) === 1) return notHeld.push({ lineId: lineId, reason: "SERIAL" });\n', ""),
    ("core: a missing unit conversion taken as 1:1", C, "  return c && hdNum(c.base_qty) > 0 ? hdNum(c.base_qty) : null;", "  return c && hdNum(c.base_qty) > 0 ? hdNum(c.base_qty) : 1;"),
    ("core: the remainder of a release not kept", C, "    if (r.keepQty > HD_EPS) add.push(row(r.frag, r.keepQty, r.rows[0] && r.rows[0].id));\n", ""),
    # security review 10-21: only digit ids and our own operation keys reach SQL text; an unknown item is never held
    ("delta: client ids reach the SQL unchecked", "hold/delta.js", "const holds = d.holds.filter((h) => (idsOk(h.frag) ? true : (notHeld.push({ lineId: h.frag.lineId, reason: \"PICK\" }), false)));",
     "const holds = d.holds;"),
    ("core: foreign operation keys looked up", C, "  .filter((op, i, all) => HD_OP.test(op) && all.indexOf(op) === i);", "  .filter((op, i, all) => op && all.indexOf(op) === i);"),
    ("core: an unknown item held", C, '    if (!item) return notHeld.push({ lineId: lineId, reason: "ITEM" });\n', "    if (!item) {}\n"),
    ("finish: a 409 worded as changed stock", "hold/finish.js", '    : refused && hdS(ans.code) === "409" ? "the stock is busy with another operation"\n', ""),
    # live run 10-21 12:14: Number() rounded the 19-digit ids in the key list, so no balance was read
    ("delta: ids rounded in the key list", "hold/delta.js", 'out.keysJson = "[" + keys.map((k) => "[" + k.join(",") + "]").join(",") + "]";',
     "out.keysJson = JSON.stringify(keys.map((k) => k.map(Number)));"),
    ("core: a recorded DONE ignored", C, '  const outcome = hdNum(st.done) > 0 ? "DONE" : hdNum(st.intents) === 0 ? "NOTHING" : "UNCERTAIN";',
     '  const outcome = hdNum(st.intents) === 0 ? "NOTHING" : "UNCERTAIN";'),
]

survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="hd-mut-")
    code, out = os.path.join(tmp, "code"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(RES, "code"), code)
    path = os.path.join(code, rel)
    text = open(path, encoding="utf-8").read()
    if text.count(old) != 1:
        print("BROKEN mutant (anchor not found once): %s" % name)
        survived += 1
        continue
    open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
    env = dict(os.environ, HD_CODE=code, HD_OUT=out, HD_BUILT=os.path.join(out, "IA_HOLD.json"))
    b = subprocess.run([sys.executable, os.path.join(RES, "build_hold.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        shutil.rmtree(tmp, ignore_errors=True)
        continue
    killed = False
    for t in ["test_hold_core.js", "test_split.js", "test_revert.js", "sim_hold.js"]:
        r = subprocess.run(["node", os.path.join(HERE, t)], env=env, capture_output=True, text=True, timeout=300)
        if r.returncode:
            killed = True
            break
    if not killed:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
