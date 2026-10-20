"""Node-level proof: the guarded classic = base v82 + the guard nodes + the exact-text body fixes of build_classic.FIXES, nothing else.
usage: python3 classic/diff_v82.py [<guarded JSON>]   (default: Stock Movement/Location Transfer/AsyncV2/SM_LOCATION_TRANSFER.json)
Checks: request_json / response_json / config / edges identical; with every fix reverted, every v82 node is byte-identical; each
fixed node differs from v82 only by its old -> new text in data.script.code; the only new ids are build_classic.GUARD_IDS; the top
level = start, the 3 guard nodes, then v82's top-level nodes in order; removing the guard nodes and reverting the fixes gives v82."""
import copy
import difflib
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
changed = sorted(nid for nid, n in bi.items() if nid in oi and canon(n) != canon(oi[nid]))


def reverted(doc):
    r = copy.deepcopy(doc)
    ri = B.index(r)
    for nid, old_text, new_text in B.FIXES:
        ri[nid]["data"]["script"]["code"] = ri[nid]["data"]["script"]["code"].replace(new_text, old_text)
    return r, ri


rev, ri = reverted(out)
for nid, n in bi.items():
    if nid not in ri:
        problems.append("v82 node missing: " + nid)
    elif canon(n) != canon(ri[nid]):
        problems.append("v82 node changed beyond the fixes: " + nid)
for nid, old_text, new_text in B.FIXES:
    old_code, new_code = bi[nid]["data"]["script"]["code"], oi[nid]["data"]["script"]["code"]
    if old_code.count(old_text) != 1 or new_code != old_code.replace(old_text, new_text):
        problems.append(nid + ": the code is not v82's with exactly its fix applied")
new = sorted(set(oi) - set(bi))
if new != sorted(B.GUARD_IDS):
    problems.append("new ids are not exactly the guard: %s" % new)
top_out = [n["id"] for n in out["nodes"]]
top_base = [n["id"] for n in base["nodes"]]
if top_out != top_base[:1] + B.TOP_IDS + top_base[1:]:
    problems.append("top-level order: %s" % top_out[:6])
stripped, _ = reverted(dict(out, nodes=[n for n in out["nodes"] if n["id"] not in B.TOP_IDS]))
same = canon(stripped) == canon(base)
if not same:
    problems.append("output minus the guard nodes (fixes reverted) != v82")
fixed = [f[0] for f in B.FIXES]
print("v82 nodes (any type with a string id): %d; byte-identical: %d; differing (fixed nodes + their containers): %s" % (len(bi), len(bi) - len(changed),
      ", ".join(changed) or "none"))
print("with the fixes of %s reverted, all %d v82 nodes identical: %s" % (", ".join(fixed), len(bi), not any(p.startswith("v82 node") for p in problems)))
for nid in fixed:
    print("%s code diff:" % nid)
    for line in difflib.unified_diff(bi[nid]["data"]["script"]["code"].split("\n"), oi[nid]["data"]["script"]["code"].split("\n"), "v82", "guarded", n=0, lineterm=""):
        print("   " + line)
print("new nodes: %d -> %s" % (len(new), ", ".join(new)))
print("top level: %s ... (%d nodes; v82 had %d)" % (" > ".join(top_out[:6]), len(top_out), len(top_base)))
print("output minus the 3 top-level guard nodes, fixes reverted == v82 (canonical JSON): %s" % ("YES" if same else "NO"))
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
