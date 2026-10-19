"""Node-level proof: the guarded classic = base v82 + the guard nodes, nothing else.
usage: python3 classic/diff_v82.py [<guarded JSON>]   (default: Stock Movement/Location Transfer/AsyncV2/SM_LOCATION_TRANSFER.json)
Checks: request_json / response_json / config / edges identical; every v82 node present with byte-identical JSON (data + blocks);
the only new ids are build_classic.GUARD_IDS; the top-level order = start, the 3 guard nodes, then v82's top-level nodes in order;
removing the 3 top-level guard nodes gives v82 exactly."""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMV2 = os.path.dirname(HERE)
sys.path.insert(0, SMV2)
import build_classic as B  # noqa: E402

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SMV2, "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "SM_LOCATION_TRANSFER.json")
base_raw = open(B.BASE, encoding="utf-8").read()
assert hashlib.md5(base_raw.encode()).hexdigest() == "48690c5886be1917615d1133aeadcaac", "base is not dev v82"
base = json.loads(base_raw)
out = json.load(open(path, encoding="utf-8"))
canon = lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True)
problems = []
for k in ("request_json", "response_json", "config", "edges"):
    if canon(base[k]) != canon(out[k]):
        problems.append("top-level %s differs" % k)
if set(out) != set(base):
    problems.append("top-level keys differ: %s" % sorted(set(out) ^ set(base)))
bi, oi = B.index(base), B.index(out)
for nid, n in bi.items():
    if nid not in oi:
        problems.append("v82 node missing: " + nid)
    elif canon(n) != canon(oi[nid]):
        problems.append("v82 node changed: " + nid)
new = sorted(set(oi) - set(bi))
if new != sorted(B.GUARD_IDS):
    problems.append("new ids are not exactly the guard: %s" % new)
top_out = [n["id"] for n in out["nodes"]]
top_base = [n["id"] for n in base["nodes"]]
if top_out != top_base[:1] + B.TOP_IDS + top_base[1:]:
    problems.append("top-level order: %s" % top_out[:6])
stripped = dict(out, nodes=[n for n in out["nodes"] if n["id"] not in B.TOP_IDS])
if canon(stripped) != canon(base):
    problems.append("output minus the guard nodes != v82")
print("v82 nodes (any type with a string id): %d, all identical: %s" % (len(bi), not any(p.startswith("v82 node") for p in problems)))
print("new nodes: %d -> %s" % (len(new), ", ".join(new)))
print("top level: %s ... (%d nodes; v82 had %d)" % (" > ".join(top_out[:6]), len(top_out), len(top_base)))
print("output minus the 3 top-level guard nodes == v82 (canonical JSON): %s" % ("YES" if "output minus the guard nodes != v82" not in problems else "NO"))
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
