"""python3 test/lib_smoke.py - prove the verbatim copies are still verbatim.

lib/ (used directly) and tpl/smv2/ (templates, never edited) must equal the md5s recorded at copy time in tpl/smv2.MD5
(smv2 working tree, 2026-10-16 18:05). A difference means someone edited a copy - adapt into code/ instead.
Also reports whether smv2 itself has moved on since the copy (informational: f8 may have fixed something worth taking).
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(HERE)
SMV2 = os.path.join(os.path.dirname(SAV2), "smv2")


def md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()


bad, moved, checked = [], [], 0
for line in open(os.path.join(SAV2, "tpl", "smv2.MD5"), encoding="utf-8"):
    want, rel = line.strip().split(" ", 1)
    rel = rel.strip()
    lib_copy = os.path.join(SAV2, rel) if rel.startswith("lib/") else None
    tpl_copy = os.path.join(SAV2, "tpl", "smv2", "base_snapshot.py" if rel == "base/snapshot.py" else rel)
    for p in [x for x in (lib_copy, tpl_copy) if x]:
        if rel.startswith("lib/") and p == tpl_copy:
            continue  # lib/ was copied to sav2/lib only
        checked += 1
        if not os.path.exists(p) or md5(p) != want:
            bad.append(os.path.relpath(p, SAV2))
    src = os.path.join(SMV2, rel)
    if os.path.exists(src) and md5(src) != want:
        moved.append(rel)

print("checked %d copies" % checked)
if moved:
    print("INFO smv2 changed since the copy (review, then re-copy into tpl/ deliberately):", *moved, sep="\n  ")
if bad:
    print("FAIL edited copies:", *bad, sep="\n  ")
    sys.exit(1)
print("ok")
