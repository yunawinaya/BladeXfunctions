"""Mutation check of the SUBMIT tests: each mutant is one exact change to the BUILT IDA_V2_SUBMIT.json (in every code node holding the text,
copied to a temp folder); test/submit/test_submit.js or test/submit/sim_submit.js must fail on every one (a mutant both pass = a blind spot).
usage: python3 scratchpad/idav2/test/submit/mutants.py"""
import sys
sys.dont_write_bytecode = True
import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
BUILT = os.path.join(HERE, "..", "..", "..", "..", "Item Disassembly", "AsyncV2", "IDA_V2_SUBMIT.json")
# (label, old text, new text): replaced in every code node that holds it
MUTANTS = [
    ("F4 typed-number check off", 'if (taken) return out("STOP", "400", taken, "IDA_INVALID");', ""),
    ("F4 case-sensitive", "held[idaBatchKey(h.batch_number)] = true;", "held[idaS(h.batch_number)] = true;"),
    ("F4 on non-stock lines too", 'if (!idaStockItem(it) || idaBatchKind(l, it) !== "TYPED") continue;', 'if (idaBatchKind(l, it) !== "TYPED") continue;'),
    ("young-lock rule off", "num(lock.young) === 1", "num(lock.young) === 2"),
    ("under review reads as busy", "rr ? IDA_TEXT.underReview : IDA_TEXT.busy", "IDA_TEXT.busy"),
    ("STALE off", "if (s(formStatus) !== stored) return", "if (false) return"),
    ("ALREADY_FINAL off", "if (IDA_FINAL.indexOf(stored) >= 0) return", "if (false) return"),
    ("number rule: never keep", "const keep = !add && issued && num(entry.issuedByJob) > 0 && num(entry.completedUnder) === 0;", "const keep = false;"),
    ("number rule: ignore COMPLETED", "&& num(entry.completedUnder) === 0;", ";"),
    ("NOT_ELIGIBLE / TOO_BIG at >= 250", "num(moves) > IDA_CLASSIC_MAX_MOVES", "num(moves) >= IDA_CLASSIC_MAX_MOVES"),
    ("Clone keeps the line ids", "for (const l of doc.stock_movement) delete l.id;", ""),
    ("Clone keeps the V2 fields", 'for (const k of ["ida_v2_job_id", "ida_idem_key"]) delete doc[k];', ""),
    ("Copy is not a Clone", 'pageIn === "Clone" || pageIn === "Copy" ? "Add" : pageIn', 'pageIn === "Clone" ? "Add" : pageIn'),
    ("dry run off", 'if (dry.error) return out("STOP", "400", s(dry.error), "IDA_BATCH_CONFIG");', ""),
    ("WA screen off", "if (noWa) {", "if (false) {"),
    ("recovery-line limit off", "if (lines.length > IDA_MAX_MOVES)", "if (false)"),
    ("pick limit off", "if (base.pickCount > IDA_MAX_MOVES)", "if (false)"),
    ("costing screen ignores recovery lines", ' || stock.some((l) => cost[idaIdStr(l.item_selection) + "|0"])', ""),
    ("dup screen ignores receipts", ' || stock.some((l) => dup["B|" + idaIdStr(l.item_selection) + "|" + idaIdStr(l.location_id) + "|"])', ""),
    ("no stock to receive off", 'if (!stock.length) return "no stock to receive";', ""),
    ("category screen off", 'if (odd) return idaCategory(odd.category) + " stock";', ""),
    ("HU screen off", 'if (idaHasHu(a)) return "handling units";', ""),
    ("due without the ownership read-back", "const ok = idaQueuedOk(guard, b) && s(link.ok) === \"YES\";", "const ok = s(link.ok) === \"YES\";"),
    ("line_count = lines, not moves", "line_count: request.moveCount,", "line_count: request.lineCount,"),
    ("issuedNo always the number", 'request.issuedNo = s(post.numberIssued) === "YES" ? idaNo : "";', "request.issuedNo = idaNo;"),
    ("no LOCK|n+1 (always LOCK|1)", "base.lockN = idaNextLock(lock);", "base.lockN = 1;"),
    ("required fields off", 'if (s(g.chk && g.chk.status) === "Failed") return out(', "if (false) return out("),
    ("Edit org from the form", 'const org = guard.pageStatus === "Edit" ? s(entry.organizationId) : guard.organizationId;', "const org = guard.organizationId;"),
    ("result QUEUED without link.ok (fix round 1)", "idaQueuedOk(guard, b) && linkOk === true", "idaQueuedOk(guard, b)"),
    ("link ignores the FP_HEADER row's id", " || s(h.id) !== s(g[0].id)", ""),
    ("the Draft BACK also runs for an Add", "backNow: yes(ok && !add)", "backNow: yes(ok)"),
    ("the Draft BACK never runs", "backNow: yes(ok && !add)", 'backNow: "NO"'),
    ("back rows swapped", 's(isAdd) === "YES" ? added : stored', 's(isAdd) === "YES" ? stored : added'),
    ("Cap 2,500 off (source picks)", "if (base.pickCount > IDA_V2_MAX_LEG) return", "if (false) return"),
    ("Cap 2,500 off (receipts)", "if (base.stockLines > IDA_V2_MAX_LEG) return", "if (false) return"),
    ("Cap 2,500 counts every recovery line", "if (base.stockLines > IDA_V2_MAX_LEG)", "if (lines.length > IDA_V2_MAX_LEG)"),
    ("Cap 2,500 at >= 2,500", "if (base.pickCount > IDA_V2_MAX_LEG)", "if (base.pickCount >= IDA_V2_MAX_LEG)"),
]

blind = []
with tempfile.TemporaryDirectory() as tmp:
    for label, old, new in MUTANTS:
        doc = json.load(open(BUILT, encoding="utf-8"))
        hit = [0]

        def walk(n):
            if isinstance(n, dict):
                if n.get("type") == "code-node":
                    c = n["data"]["script"]
                    k = c["code"].count(old)
                    if k:
                        hit[0] += k
                        c["code"] = c["code"].replace(old, new)
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(doc)
        assert hit[0] >= 1, label + ": the text is not in the build"
        built = os.path.join(tmp, "IDA_V2_SUBMIT.json")
        json.dump(doc, open(built, "w", encoding="utf-8"), ensure_ascii=False)
        env = dict(os.environ, IDA_SUBMIT_BUILT=built, TZ="Asia/Kuala_Lumpur")
        res = {}
        for t in ("test_submit.js", "sim_submit.js"):
            p = subprocess.run(["node", os.path.join(HERE, t)], env=env, capture_output=True, text=True)
            last = (p.stdout.strip().split("\n") or [""])[-1]
            res[t] = last if last.startswith(("OK", "FAILED")) else "CRASH " + (p.stderr.strip().split("\n") or [""])[-1][:60]
        killed = any(not v.startswith("OK") for v in res.values())
        if not killed:
            blind.append(label)
        print("%s %-40s x%-2d matrix: %-24s sim: %s" % ("killed" if killed else "BLIND ", label, hit[0], res["test_submit.js"][:24], res["sim_submit.js"]))
print("mutants: %d, killed: %d, blind: %d%s" % (len(MUTANTS), len(MUTANTS) - len(blind), len(blind), (" " + str(blind)) if blind else ""))
sys.exit(1 if blind else 0)
