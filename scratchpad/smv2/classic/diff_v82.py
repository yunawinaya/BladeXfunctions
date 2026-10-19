"""Node-level proof: the guarded classic = base v82 + the guard nodes + code_node_OHjnEcVJ's two-line body fix, nothing else.
usage: python3 classic/diff_v82.py [<guarded JSON>]   (default: Stock Movement/Location Transfer/AsyncV2/SM_LOCATION_TRANSFER.json)
Checks: request_json / response_json / config / edges identical; every v82 node present with byte-identical JSON (data + blocks)
except code_node_OHjnEcVJ, whose only difference is build_classic.FIX_OLD -> FIX_NEW in data.script.code; the only new ids are
build_classic.GUARD_IDS; the top-level order = start, the 3 guard nodes, then v82's top-level nodes in order; removing the 3
top-level guard nodes and reverting the fix gives v82 exactly."""
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
# raw comparison: OHjnEcVJ and the containers that hold it differ; with its code reverted every v82 node must be identical
changed = sorted(nid for nid, n in bi.items() if nid in oi and canon(n) != canon(oi[nid]))
rev = copy.deepcopy(out)
ri = B.index(rev)
ri[B.FIXED_NODE]["data"]["script"]["code"] = ri[B.FIXED_NODE]["data"]["script"]["code"].replace(B.FIX_NEW, B.FIX_OLD)
for nid, n in bi.items():
    if nid not in ri:
        problems.append("v82 node missing: " + nid)
    elif canon(n) != canon(ri[nid]):
        problems.append("v82 node changed beyond the fix: " + nid)
old_code = bi[B.FIXED_NODE]["data"]["script"]["code"]
new_code = oi[B.FIXED_NODE]["data"]["script"]["code"]
if new_code != old_code.replace(B.FIX_OLD, B.FIX_NEW) or old_code.count(B.FIX_OLD) != 1:
    problems.append(B.FIXED_NODE + ": the code is not v82's with exactly FIX_OLD -> FIX_NEW")
reverted = copy.deepcopy(oi[B.FIXED_NODE])
reverted["data"]["script"]["code"] = new_code.replace(B.FIX_NEW, B.FIX_OLD)
if canon(reverted) != canon(bi[B.FIXED_NODE]):
    problems.append(B.FIXED_NODE + ": differs from v82 outside its code")
new = sorted(set(oi) - set(bi))
if new != sorted(B.GUARD_IDS):
    problems.append("new ids are not exactly the guard: %s" % new)
top_out = [n["id"] for n in out["nodes"]]
top_base = [n["id"] for n in base["nodes"]]
if top_out != top_base[:1] + B.TOP_IDS + top_base[1:]:
    problems.append("top-level order: %s" % top_out[:6])
stripped = copy.deepcopy(dict(out, nodes=[n for n in out["nodes"] if n["id"] not in B.TOP_IDS]))
B.index(stripped)[B.FIXED_NODE]["data"]["script"]["code"] = new_code.replace(B.FIX_NEW, B.FIX_OLD)
same = canon(stripped) == canon(base)
if not same:
    problems.append("output minus the guard nodes (fix reverted) != v82")
print("v82 nodes (any type with a string id): %d; byte-identical: %d; differing only through %s's code: %s" % (len(bi), len(bi) - len(changed), B.FIXED_NODE,
      ", ".join(changed) or "none"))
print("with %s's two lines reverted, all %d v82 nodes identical: %s" % (B.FIXED_NODE, len(bi), not any(p.startswith("v82 node") for p in problems)))
print("%s code diff:" % B.FIXED_NODE)
for line in difflib.unified_diff(old_code.split("\n"), new_code.split("\n"), "v82", "guarded", n=0, lineterm=""):
    print("   " + line)
print("new nodes: %d -> %s" % (len(new), ", ".join(new)))
print("top level: %s ... (%d nodes; v82 had %d)" % (" > ".join(top_out[:6]), len(top_out), len(top_base)))
print("output minus the 3 top-level guard nodes, OHjnEcVJ fix reverted == v82 (canonical JSON): %s" % ("YES" if same else "NO"))
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
