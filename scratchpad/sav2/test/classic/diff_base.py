"""(a) Node-level proof: each guarded classic = its pinned base + the guard nodes, nothing else (smv2 classic/diff_v82.py).
usage: python3 test/classic/diff_base.py            (both built files under <repo>/Stock Adjustment|Stock Count/AsyncV2/)
Per workflow: the base file is the pinned snapshot (md5); request_json / response_json / config / edges and the top-level key
order are identical; every base node (any type with a string id) is present with identical JSON, key order included; the
only new ids are build_classic.GUARD_IDS; the top level = start, the guard nodes, then the base's top level in order; and the
output minus the top-level guard nodes, re-serialized as the platform stores it (compact), is the base FILE byte for byte."""
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ next to the builders

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, SAV2)
import build_classic as B  # noqa: E402

compact = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
canon = lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True)
total = 0
for name in ("STOCK_ADJUSTMENT", "STOCK_COUNT"):
    path, md5 = B.BASE[name]
    base_raw = open(path, encoding="utf-8").read()
    problems = []
    if hashlib.md5(base_raw.encode("utf-8")).hexdigest() != md5:
        problems.append("base is not the pinned snapshot")
    base = json.loads(base_raw)
    out_path = os.path.join(B.OUT_DIRS[name], name + ".json")
    out = json.load(open(out_path, encoding="utf-8"))
    if list(out) != list(base):
        problems.append("top-level keys / order differ: %s vs %s" % (list(out), list(base)))
    for k in ("request_json", "response_json", "config", "edges"):
        if compact(base[k]) != compact(out[k]):
            problems.append("top-level %s differs" % k)
    bi, oi = B.index(base), B.index(out)
    changed = [nid for nid, n in bi.items() if nid not in oi or compact(n) != compact(oi[nid])]
    problems += ["base node missing or changed: " + nid for nid in changed]
    new = sorted(set(oi) - set(bi))
    if new != sorted(B.GUARD_IDS[name]):
        problems.append("new ids are not exactly the guard: %s" % new)
    top_out = [n["id"] for n in out["nodes"]]
    top_base = [n["id"] for n in base["nodes"]]
    if top_out != top_base[:1] + B.TOP_IDS[name] + top_base[1:]:
        problems.append("top-level order: %s" % top_out[:7])
    if top_out[len(B.TOP_IDS[name]) + 1] != B.ANCHOR[name]:
        problems.append("the guard is not right before " + B.ANCHOR[name])
    stripped = dict(out, nodes=[n for n in out["nodes"] if n["id"] not in B.TOP_IDS[name]])
    same_bytes = compact(stripped) == base_raw
    if not same_bytes:
        problems.append("output minus the guard nodes != the base file bytes")
    if canon(stripped) != canon(base):
        problems.append("output minus the guard nodes != the base (canonical)")
    # the shipped file is exactly what lib/v2build.build writes for this builder now (build_classic / build_sa.py; no hand edit)
    rebuilt = B.V.wrap_doc_sql(dict(B.BUILDERS)[name]())
    if json.dumps(rebuilt, ensure_ascii=False, indent=1) + "\n" != open(out_path, encoding="utf-8").read():
        problems.append("the file on disk is not what build_classic.py builds")
    print("== %s  (%s)" % (name, os.path.relpath(out_path, os.path.join(SAV2, "..", ".."))))
    print("   base %s md5 %s: %d nodes, identical (JSON + key order): %d" % (os.path.basename(path), md5[:8], len(bi), len(bi) - len(changed)))
    print("   new nodes %d: %s" % (len(new), ", ".join(new)))
    print("   top level: %s ... (%d; base %d)" % (" > ".join(top_out[:6]), len(top_out), len(top_base)))
    print("   output minus the %d top-level guard nodes == base file bytes: %s" % (len(B.TOP_IDS[name]), "YES" if same_bytes else "NO"))
    print("   PROBLEMS: %d" % len(problems) + ("" if not problems else "\n     " + "\n     ".join(problems)))
    total += len(problems)
print("all passed" if not total else "%d PROBLEMS" % total)
sys.exit(1 if total else 0)
