"""Node-level proof: IDA_SAVE v7 = base v6 + the guard nodes + code_cost_alloc's per-base-unit price, nothing else (read-only).
usage: python3 scratchpad/idav2/classic/diff_v6.py [<v7 JSON>]   (default: Item Disassembly/AsyncV2/IDA_SAVE.json)
Checks (copy of tpl/iav2/classic/diff_v11.py): request_json / response_json / config / edges identical; every v6 node present with
byte-identical JSON except code_cost_alloc, whose only difference is patch_v7.FIX_OLD -> FIX_NEW in data.script.code (its containers
if_persist / if_persist_t differ only through it); the new ids are exactly patch_v7.GUARD_IDS; the top level is start, the 3 guard
nodes, then v6's top level in order; removing them and reverting the fix gives v6 exactly; the guard SQL is the only sql-node and no
other node names a V2 table / column; the four bodies SUBMIT lifts (code_fillback, code_required, code_item_ids, code_validate) are v6's."""
import sys
sys.dont_write_bytecode = True
import copy  # noqa: E402
import difflib  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("ida_classic_patch_v7", os.path.join(HERE, "patch_v7.py"))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

import hashlib  # noqa: E402

# the md5 of the reviewed v7 build (review b-review.md, 10-21): the publish ships exactly this file
REVIEWED_MD5 = "adc4d2a83420dd41c35919b499656b89"
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(IDAV2, "..", "..", "Item Disassembly", "AsyncV2", "IDA_SAVE.json")
base_raw, base = B.load_base()
out_bytes = open(path, "rb").read()
out = json.loads(out_bytes.decode("utf-8"))
canon = B.canon
problems = []
md5 = lambda t: hashlib.md5(t.encode("utf-8")).hexdigest()  # noqa: E731
raw = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
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
        problems.append("v6 node missing: " + nid)
    elif canon(n) != canon(ri[nid]):
        problems.append("v6 node changed beyond the fix: " + nid)
old_code = bi[B.FIXED_NODE]["data"]["script"]["code"]
new_code = oi[B.FIXED_NODE]["data"]["script"]["code"]
if old_code.count(B.FIX_OLD) != 1 or new_code != old_code.replace(B.FIX_OLD, B.FIX_NEW):
    problems.append(B.FIXED_NODE + ": the code is not v6's with exactly FIX_OLD -> FIX_NEW")
reverted = copy.deepcopy(oi[B.FIXED_NODE])
reverted["data"]["script"]["code"] = new_code.replace(B.FIX_NEW, B.FIX_OLD)
if canon(reverted) != canon(bi[B.FIXED_NODE]):
    problems.append(B.FIXED_NODE + ": differs from v6 outside its code")
for nid in ("code_fillback", "code_required", "code_item_ids", "code_validate", "code_idem_guard", "search_movements", "code_receipt_pick", "wf_add"):
    if canon(oi[nid]) != canon(bi[nid]):
        problems.append(nid + " changed")
allowed_changed = {B.FIXED_NODE, "if_persist", "if_persist_t"}
if set(changed) - allowed_changed:
    problems.append("v6 nodes whose raw JSON differs beyond code_cost_alloc and its containers: %s" % sorted(set(changed) - allowed_changed))
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
    problems.append("output minus the guard nodes (fix reverted) != v6")
sql_nodes = sorted(nid for nid, n in oi.items() if n.get("type") == "sql-node")
if sql_nodes != [B.S]:
    problems.append("sql-nodes: %s (only %s expected)" % (sql_nodes, B.S))
for nid, n in oi.items():
    text = json.dumps(n.get("data") or {}, ensure_ascii=False)
    if nid not in B.GUARD_IDS and nid not in bi:
        problems.append("unexpected node " + nid)
    if any(t in text for t in ("gd_async_job", "gd_publish_step", "ida_v2_job_id", "ida_idem_key", "inventory_balance_lock")):
        problems.append(nid + " names a V2 table / column")
returns = {nid: (n["data"]["status_code"], [p["prop"] for p in n["data"]["response_value"]["list"]], n["data"]["response_value"]["list"][0]["value"])
           for nid, n in oi.items() if nid in B.GUARD_IDS and n.get("type") == "return-node"}
want_returns = {"return_node_IDAguard400": (200, ["code", "message"], "400"), "return_node_IDAguard409": (200, ["code", "message"], "409"),
                "return_node_IDAguardBig": (200, ["code", "message"], "400")}
if returns != want_returns:
    problems.append("guard returns: %s" % returns)
raw_same = [nid for nid, n in bi.items() if nid in oi and raw(n) == raw(oi[nid])]
if sorted(set(bi) - set(raw_same)) != sorted(changed):
    problems.append("raw (key order kept) vs canonical identity disagree: %s" % sorted(set(bi) - set(raw_same)))
# the guard as the pinned sources build it (patch_v7.build() asserts SHARED_MD5): a shared edit or a hand edit of the built file shows here
fresh = B.index(B.build())
for nid in B.GUARD_IDS:
    if raw(oi[nid]) != raw(fresh[nid]):
        problems.append("guard node differs from patch_v7's pinned build: " + nid)
file_md5 = hashlib.md5(out_bytes).hexdigest()
if file_md5 != REVIEWED_MD5:
    problems.append("the built file is not the reviewed v7 (md5 %s, reviewed %s): review it before it ships" % (file_md5, REVIEWED_MD5))
guard_sql = oi[B.S]["data"]["script"]["code"]
print("v6 nodes (any type with a string id): %d; raw byte-identical (key order kept): %d; differing only through %s's code: %s"
      % (len(bi), len(raw_same), B.FIXED_NODE, ", ".join(changed) or "none"))
print("with %s's patch reverted, all %d v6 nodes identical: %s" % (B.FIXED_NODE, len(bi), not any(p.startswith("v6 node") for p in problems)))
print("request_json / response_json / config / edges identical: %s" % (not any(p.startswith("top-level") for p in problems)))
print("%s code diff (v6 -> v7):" % B.FIXED_NODE)
for line in difflib.unified_diff(old_code.split("\n"), new_code.split("\n"), "v6", "v7", n=0, lineterm=""):
    print("   " + line)
print("new nodes: %d -> %s" % (len(new), ", ".join(new)))
print("guard returns (status, props, code): %s" % ", ".join("%s %s" % (k, v[2]) for k, v in sorted(returns.items())))
print("guard SQL (the only SQL node):\n   " + guard_sql.replace("\n", "\n   "))
print("top level: %s ... (%d nodes; v6 had %d)" % (" > ".join(top_out[:6]), len(top_out), len(top_base)))
print("output minus the 3 top-level guard nodes, %s patch reverted == v6 (canonical JSON): %s" % (B.FIXED_NODE, "YES" if same else "NO"))
print("pinned shared sources (patch_v7.SHARED_MD5): %s" % ", ".join("%s %s" % kv for kv in sorted(B.SHARED_MD5.items())))
print("guard scripts == the pinned build: %s; their md5 (the publish checks these):" % (not any(p.startswith("guard node differs") for p in problems)))
for nid in (B.G, B.ST, B.S):
    print("   %-26s %s" % (nid, md5(oi[nid]["data"]["script"]["code"])))
print("   %-26s %s" % (B.FIXED_NODE, md5(new_code)))
print("file md5 %s: %s" % (file_md5, "the reviewed v7" if file_md5 == REVIEWED_MD5 else "NOT the reviewed v7 (" + REVIEWED_MD5 + ")"))
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
