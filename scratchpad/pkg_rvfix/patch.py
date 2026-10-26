# Code nodes read numbers that the platform passes as strings (response_json bsonType "string"): row_version grew by
# concatenation (0 -> 1 -> 2 -> 22 -> 222 per normal job, +~2 digits per retry) toward the INT limit, and the step-retry
# counter would read "1" + 1 = "11". Coerce at the use sites. Usage: python3 patch.py
import os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out")
EDITS = {"PACKING_BULK_COMMIT.json": [("entry.rowVersion +", "(Number(entry.rowVersion) || 0) +", 21), ("const n = entry.attempts;", "const n = Number(entry.attempts) || 0;", 16)],
         "PACKING_ASYNC_WORKER.json": [("const rv = pick.rvBase;", "const rv = Number(pick.rvBase) || 0;", 1)]}
for name, edits in EDITS.items():
    t = open(os.path.join(ROOT, "Packing/AsyncV2", name)).read()
    open(os.path.join(os.path.dirname(__file__), "base", name), "w").write(t)
    for old, new, n in edits:
        if t.count(old) != n:
            sys.exit(f"{name}: {old!r} expected {n}, found {t.count(old)}")
        t = t.replace(old, new)
    open(os.path.join(OUT, name), "w").write(t)
print("ok")
