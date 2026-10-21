"""Node-level proof: IA_SAVE v12 = base v11 + the guard nodes + code_validate's non-stock rule, nothing else (read-only).
usage: python3 scratchpad/iav2/classic/diff_v11.py [<v12 JSON>]   (default: Item Assembly & BOM/AsyncV2/IA_SAVE.json)
Checks (copy of scratchpad/smv2/classic/diff_v82.py): request_json / response_json / config / edges identical; every v11 node
present with byte-identical JSON except code_validate, whose only difference is patch_v12.FIX_OLD -> FIX_NEW in data.script.code
(its containers if_validate / if_validate_t differ only through it); the new ids are exactly patch_v12.GUARD_IDS; the top level is
start, the 3 guard nodes, then v11's top level in order; removing them and reverting the fix gives v11 exactly; no node of v12
other than the guard reads gd_async_job / gd_publish_step; code_receipt_prep untouched."""
import sys
sys.dont_write_bytecode = True
import copy
import difflib
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("ia_classic_patch_v12", os.path.join(HERE, "patch_v12.py"))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(IAV2, "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_SAVE.json")
base_raw, base = B.load_base()
out = json.load(open(path, encoding="utf-8"))
canon = B.canon
problems = []
for k in ("request_json", "response_json", "config", "edges"):
    if canon(base[k]) != canon(out[k]):
        problems.append("top-level %s differs" % k)
if set(out) != set(base):
    problems.append("top-level keys differ: %s" % sorted(set(out) ^ set(base)))
bi, oi = B.index(base), B.index(out)
changed = sorted(nid for nid, n in bi.items() if nid in oi and canon(n) != canon(oi[nid]))
rev = copy.deepcopy(out)
ri = B.index(rev)
ri[B.FIXED_NODE]["data"]["script"]["code"] = ri[B.FIXED_NODE]["data"]["script"]["code"].replace(B.FIX_NEW, B.FIX_OLD)
for nid, n in bi.items():
    if nid not in ri:
        problems.append("v11 node missing: " + nid)
    elif canon(n) != canon(ri[nid]):
        problems.append("v11 node changed beyond the fix: " + nid)
old_code = bi[B.FIXED_NODE]["data"]["script"]["code"]
new_code = oi[B.FIXED_NODE]["data"]["script"]["code"]
if old_code.count(B.FIX_OLD) != 1 or new_code != old_code.replace(B.FIX_OLD, B.FIX_NEW):
    problems.append(B.FIXED_NODE + ": the code is not v11's with exactly FIX_OLD -> FIX_NEW")
reverted = copy.deepcopy(oi[B.FIXED_NODE])
reverted["data"]["script"]["code"] = new_code.replace(B.FIX_NEW, B.FIX_OLD)
if canon(reverted) != canon(bi[B.FIXED_NODE]):
    problems.append(B.FIXED_NODE + ": differs from v11 outside its code")
if canon(oi["code_receipt_prep"]) != canon(bi["code_receipt_prep"]):
    problems.append("code_receipt_prep changed")
allowed_changed = {B.FIXED_NODE, "if_validate", "if_validate_t"}
if set(changed) - allowed_changed:
    problems.append("v11 nodes whose raw JSON differs beyond code_validate and its containers: %s" % sorted(set(changed) - allowed_changed))
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
    problems.append("output minus the guard nodes (fix reverted) != v11")
for nid, n in oi.items():
    text = json.dumps(n.get("data") or {}, ensure_ascii=False)
    if nid not in B.GUARD_IDS and nid not in bi:
        problems.append("unexpected node " + nid)
    if any(t in text for t in ("gd_async_job", "gd_publish_step", "ia_v2_job_id", "ia_idem_key", "inventory_balance_lock")):
        problems.append(nid + " names a V2 table / column")
guard_sql = oi[B.S]["data"]["script"]["code"]
print("v11 nodes (any type with a string id): %d; raw byte-identical: %d; differing only through %s's code: %s" % (len(bi), len(bi) - len(changed), B.FIXED_NODE,
      ", ".join(changed) or "none"))
print("with %s's patch reverted, all %d v11 nodes identical: %s" % (B.FIXED_NODE, len(bi), not any(p.startswith("v11 node") for p in problems)))
print("request_json / response_json / config / edges identical: %s" % (not any(p.startswith("top-level") for p in problems)))
print("%s code diff (v11 -> v12):" % B.FIXED_NODE)
for line in difflib.unified_diff(old_code.split("\n"), new_code.split("\n"), "v11", "v12", n=0, lineterm=""):
    print("   " + line)
print("new nodes: %d -> %s" % (len(new), ", ".join(new)))
print("guard SQL (the only SQL node):\n   " + guard_sql.replace("\n", "\n   "))
print("top level: %s ... (%d nodes; v11 had %d)" % (" > ".join(top_out[:6]), len(top_out), len(top_base)))
print("output minus the 3 top-level guard nodes, %s patch reverted == v11 (canonical JSON): %s" % (B.FIXED_NODE, "YES" if same else "NO"))
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
