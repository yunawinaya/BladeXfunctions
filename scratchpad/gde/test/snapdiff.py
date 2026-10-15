"""snapdiff.py <before.json> <after.json>: snap.py snapshots of one GD compared table by table - rows added / removed /
changed (by id) and which columns changed how often (clocks and editors ignored), with samples. Read-only, local files."""
import json, sys
from collections import Counter

IGNORE = {"update_time", "update_user"}
a, b = (json.load(open(p)) for p in sys.argv[1:3])


def norm(v):
    if v is None or v == "":
        return None
    try:
        return format(float(v), ".8f") if isinstance(v, (int, float)) or str(v).replace(".", "", 1).lstrip("-").isdigit() and len(str(v)) < 16 else v
    except (TypeError, ValueError):
        return v


for table in a:
    if not isinstance(a[table], list):
        continue
    before = {str(r.get("id")): r for r in a[table] if isinstance(r, dict) and r.get("id") is not None}
    after = {str(r.get("id")): r for r in b.get(table, []) if isinstance(r, dict) and r.get("id") is not None}
    added = [i for i in after if i not in before]
    gone = [i for i in before if i not in after]
    cols, samples = Counter(), {}
    changed = 0
    for i in before.keys() & after.keys():
        diff = [c for c in set(before[i]) | set(after[i]) if c not in IGNORE and norm(before[i].get(c)) != norm(after[i].get(c))]
        if diff:
            changed += 1
            for c in diff:
                cols[c] += 1
                samples.setdefault(c, (i, str(before[i].get(c))[:70], str(after[i].get(c))[:70]))
    if added or gone or changed:
        print(f"{table}: {len(before)} rows -> {len(after)}; added {len(added)}, removed {len(gone)}, changed {changed}")
        for c, n in cols.most_common():
            i, x, y = samples[c]
            print(f"    {c:28s} {n:5d}   e.g. {i}: {x!r} -> {y!r}")
    else:
        print(f"{table}: {len(before)} rows, unchanged")
