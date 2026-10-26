"""patch_commit_own_run_wait.py [--write]: C2 / X2 / R1 never give up while the engine answers "the same operation is still
running" (10-27, found by GD Edit & Picking V2 on GD_EDIT_COMMIT and seen on dev GD/20261019/598).

A caught engine crash (patch_commit_catch_engine_kits.py) is retried at once, but the crashed run may already have opened its
run marker; the engine then answers 409 "the same operation is still running" until that marker's heartbeat is 20 min old,
and only then takes the operation over. The 8 tries (15 s doubling, 5 min cap) outlast that only when the crash came on the
job's first try: a job that had already waited 4+ times would be FAILED, or sent to review, inside the hold, where before
it healed after its 30-min lease. That answer is our own operation: wait it out without counting toward giving up (the
engine's takeover after 20 min makes the wait finite; a later run of the same operation is fenced). Edits the modules;
rebuild with each builder afterwards."""
import sys

S = "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/"
MODS = ["gdc/code/commit/c2.js", "gdcan/code/commit/x2.js", "gdrev/code/commit/r1.js"]
OLD = ("    const wrote = num((ops || {}).intents) > 0;\n"
       "    if (entry.attempts >= LOCK_WAIT_TRIES) return wrote ?")
NEW = ("    const wrote = num((ops || {}).intents) > 0;\n"
       "    // our own operation's earlier run (e.g. one that crashed) holds it until its heartbeat is 20 min old: wait that out,\n"
       "    // never counted toward giving up (the engine then takes the operation over)\n"
       "    const ownRun = s(eng.message).indexOf(\"the same operation is still running\") >= 0;\n"
       "    if (entry.attempts >= LOCK_WAIT_TRIES && !ownRun) return wrote ?")
for m in MODS:
    path = S + m
    body = open(path, encoding="utf-8").read()
    if "const ownRun" in body:
        print("already patched", m)
        continue
    assert body.count(OLD) == 1, m
    body = body.replace(OLD, NEW)
    print(("write " if "--write" in sys.argv else "would write ") + m)
    if "--write" in sys.argv:
        open(path, "w", encoding="utf-8").write(body)
