"""compare_runs.py <classic.json> <v2.json>: the form state the classic and the V2 line builders end with for the same
conversion - every table_gd line field by field (numbers compared as numbers), the shortfall dialog rows, the dialogs."""
import json
import sys

a, b = (json.load(open(f)) for f in sys.argv[1:3])


def norm(v):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return round(float(v), 8)
    if isinstance(v, str):
        try:
            return round(float(v), 8) if v.strip() not in ("",) and v.strip().lstrip("-").replace(".", "", 1).isdigit() and len(v) < 17 else v
        except ValueError:
            return v
    if isinstance(v, list):
        return [norm(x) for x in v]
    if isinstance(v, dict):
        return {k: norm(x) for k, x in sorted(v.items()) if k != "fm_key"}
    return v


diffs = []
la, lb = a.get("table_gd") or [], b.get("table_gd") or []
if len(la) != len(lb):
    diffs.append("line count classic %d vs V2 %d" % (len(la), len(lb)))
for i, (x, y) in enumerate(zip(la, lb)):
    for k in sorted(set(x) | set(y)):
        if norm(x.get(k)) != norm(y.get(k)):
            diffs.append("line %d %s: classic %s | V2 %s" % (i + 1, k, json.dumps(x.get(k))[:120], json.dumps(y.get(k))[:120]))
ia, ib = a.get("insufficient") or [], b.get("insufficient") or []
if norm(ia) != norm(ib):
    diffs.append("shortfall rows differ: classic %s | V2 %s" % (json.dumps(ia)[:300], json.dumps(ib)[:300]))
if a.get("dialogs") != b.get("dialogs"):
    diffs.append("dialogs: classic %s | V2 %s" % (a.get("dialogs"), b.get("dialogs")))
print("%d lines compared, %d field(s) per line on average; differences: %d" % (len(la), (sum(len(x) for x in la) // max(1, len(la))), len(diffs)))
for d in diffs[:60]:
    print("  " + d)
