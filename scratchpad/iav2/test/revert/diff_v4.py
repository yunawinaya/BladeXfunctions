"""Node-level proof: the built classic IA_REVERT v5 (Item Assembly & BOM/AsyncV2/IA_REVERT.json) = base/IA_REVERT.v4.json (the pinned
snapshot, dev v4 = prod v4) + the guard, nothing else (tpl/sav2 test/classic/diff_base.py's method).
  - the base is the pinned snapshot (md5); request_json / response_json / config / edges and the top-level key order are identical;
  - every base node (any type with a string id) is present with identical JSON, key order included;
  - the only new ids are classic_v5.GUARD_IDS; the top level = the base's with the two guard nodes right after code_node_iaRvPrep;
  - the output minus the guard, re-serialized as the platform stores it (compact), is the base FILE byte for byte;
  - the file on disk is exactly what build_revert.py builds now (no hand edit); the guard reads nothing (no SQL, no V2 table).
usage: python3 test/revert/diff_v4.py
"""
import hashlib
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(os.path.dirname(HERE))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


B = load(os.path.join(IAV2, "revert", "classic_v5.py"), "iarv_classic_v5_check")
# v6 = v5 + RES-01 R5 (revert/classic_v6.py): its nodes, and loop_iaRvAdd reading code_node_RESrvMap's adds
B6 = load(os.path.join(IAV2, "revert", "classic_v6.py"), "iarv_classic_v6_check")
RES_TOP = ["code_node_RESrvDue", "if_RESrvDue", "code_node_RESrvOpen", "if_RESrvOpen", "code_node_RESrvMap", "if_RESrvMark"]
R = load(os.path.join(IAV2, "build_revert.py"), "iarv_build_revert_check")
compact = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
canon = lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True)
problems = []
base_raw = open(B.BASE, encoding="utf-8").read()
if hashlib.md5(base_raw.encode("utf-8")).hexdigest() != B.BASE_MD5:
    problems.append("the base is not the pinned snapshot")
base = json.loads(base_raw)
out_path = os.path.join(R.OUT, "IA_REVERT.json")
out = json.load(open(out_path, encoding="utf-8"))
# the comparison with the base: loop_iaRvAdd's source as the base has it (v6 changes only that)
lp = B.index(out)["loop_iaRvAdd"]["data"]["loopSeletVar"]
if lp["code"] != B6.LOOP_TO:
    problems.append("loop_iaRvAdd does not read code_node_RESrvMap's adds: " + lp["code"])
lp["code"] = B6.LOOP_FROM
if list(out) != list(base):
    problems.append("top-level keys / order differ: %s vs %s" % (list(out), list(base)))
for k in ("request_json", "response_json", "config", "edges"):
    if compact(base[k]) != compact(out[k]):
        problems.append("top-level %s differs" % k)
bi, oi = B.index(base), B.index(out)
changed = [nid for nid, n in bi.items() if nid not in oi or compact(n) != compact(oi[nid])]
problems += ["base node missing or changed: " + nid for nid in changed]
new = sorted(set(oi) - set(bi))
if new != sorted(B.GUARD_IDS + B6.RES_IDS):
    problems.append("new ids are not exactly the guard + RES-01's: %s" % new)
top_out = [n["id"] for n in out["nodes"]]
top_base = [n["id"] for n in base["nodes"]]
at = top_base.index(B.AFTER) + 1
want = top_base[:at] + B.TOP_IDS + top_base[at:]
for after, ids in (("if_iaRvRefuse", RES_TOP[:4]), ("code_node_iaRvBuild", RES_TOP[4:5]), ("update_node_iaRvIa", RES_TOP[5:])):
    i = want.index(after) + 1
    want[i:i] = ids
if top_out != want:
    problems.append("top-level order: %s" % top_out)
stripped = dict(out, nodes=[n for n in out["nodes"] if n["id"] not in B.TOP_IDS + RES_TOP])
same_bytes = compact(stripped) == base_raw
if not same_bytes:
    problems.append("output minus the guard != the base file bytes")
if canon(stripped) != canon(base):
    problems.append("output minus the guard != the base (canonical)")
rebuilt = R.V.wrap_doc_sql(R.build_classic())
if json.dumps(rebuilt, ensure_ascii=False, indent=1) + "\n" != open(out_path, encoding="utf-8").read():
    problems.append("the file on disk is not what build_revert.py builds")
guard = [oi[nid] for nid in B.GUARD_IDS]
kinds = sorted(n["type"] for n in guard)
if kinds != sorted(["code-node", "if", "ifBlock", "ifBlock", "return-node"]):
    problems.append("guard node types: %s" % kinds)
text = compact(guard)
for word in ("sql-node", "gd_async_job", "gd_publish_step", "ia_v2_job_id", "workflow-node", "update-node", "add-node"):
    if word in text:
        problems.append("the guard holds " + word)
ret = oi["return_node_iaRvCap"]["data"]
if (ret["status_code"], [(p["prop"], p["valueType"], p["value"]) for p in ret["response_value"]["list"]]) != (
        200, [("code", "value", "400"), ("message", "field", "{{node:code_node_iaRvCap.data.message}}"), ("conflicts", "value", "[]")]):
    problems.append("the guard's answer is not the classic's refusal shape { code 400, message, conflicts [] }: %s" % ret)
print("== IA_REVERT v6 = v5 + RES-01 R5  (%s)" % os.path.relpath(out_path, os.path.join(IAV2, "..", "..")))
print("   base IA_REVERT.v4.json md5 %s: %d nodes, identical (JSON + key order): %d" % (B.BASE_MD5[:8], len(bi), len(bi) - len(changed)))
print("   new nodes %d: %s" % (len(new), ", ".join(new)))
print("   top level: ... %s > %s > %s > %s ... (%d; base %d)" % (B.AFTER, B.TOP_IDS[0], B.TOP_IDS[1], top_out[at + 2], len(top_out), len(top_base)))
print("   output minus the 2 top-level guard nodes == base file bytes: %s" % ("YES" if same_bytes else "NO"))
print("   PROBLEMS: %d" % len(problems) + ("" if not problems else "\n     " + "\n     ".join(problems)))
sys.exit(1 if problems else 0)
