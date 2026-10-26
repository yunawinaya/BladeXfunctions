"""patch_commit_own_run_ceiling.py [--write]: the own-run wait (patch_commit_own_run_wait.py) gets a ceiling, as GD_EDIT_COMMIT
E1 (GD Edit & Picking V2, 10-27): after 16 tries (about an hour of waits) it goes to review, never FAILED. Each own-run retry
touches the job row, so prod_health's "untouched for 15+ minutes" never flags it: without a ceiling, an engine marker that
never clears would hold the GD in Processing unseen. Another operation's lock keeps its 8 tries."""
import sys

S = "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/"
MODS = [("gdc/code/commit/c2.js", "C2_INVENTORY"), ("gdcan/code/commit/x2.js", "X2_INVENTORY"), ("gdrev/code/commit/r1.js", "R1_INVENTORY")]
OLD_CONST = "const LOCK_WAIT_TRIES = 8;\n"
NEW_CONST = "const LOCK_WAIT_TRIES = 8;\nconst OWN_RUN_TRIES = 16;\n"
OLD = ("    // our own operation's earlier run (e.g. one that crashed) holds it until its heartbeat is 20 min old: wait that out,\n"
       "    // never counted toward giving up (the engine then takes the operation over)\n"
       "    const ownRun = s(eng.message).indexOf(\"the same operation is still running\") >= 0;\n")
NEW = ("    // our own operation's earlier run (e.g. one that crashed) holds it until its heartbeat is 20 min old: wait that out, up to\n"
       "    // 16 tries (about an hour, as GD_EDIT_COMMIT E1), then review, never FAILED - so a marker that never clears is seen\n"
       "    const ownRun = s(eng.message).indexOf(\"the same operation is still running\") >= 0;\n"
       "    if (ownRun && entry.attempts >= OWN_RUN_TRIES) return stepEnd(entry, \"%s\", why, true);\n")
for m, step in MODS:
    path = S + m
    body = open(path, encoding="utf-8").read()
    if "OWN_RUN_TRIES" in body:
        print("already patched", m)
        continue
    assert body.count(OLD_CONST) == 1 and body.count(OLD) == 1, m
    body = body.replace(OLD_CONST, NEW_CONST).replace(OLD, NEW % step)
    print(("write " if "--write" in sys.argv else "would write ") + m)
    if "--write" in sys.argv:
        open(path, "w", encoding="utf-8").write(body)
