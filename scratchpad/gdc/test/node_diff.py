"""node_diff.py NAME...: build each workflow as `build_gdc.py --write` would (published keys reserved, unchanged nodes kept) and
list the nodes it adds, changes and removes against the repo file (= live dev when `wf --dev deployed` says IDENTICAL)."""
import json
import os
import re
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("b", os.path.join(HERE, "..", "build_gdc.py"))
b = importlib.util.module_from_spec(spec)
names = sys.argv[1:]
sys.argv = ["build_gdc.py"]
spec.loader.exec_module(b)


def nodes(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and "type" in o and isinstance(o.get("data"), dict):
            out[o["id"]] = o
        for v in o.values():
            nodes(v, out)
    elif isinstance(o, list):
        for v in o:
            nodes(v, out)
    return out


for name, fn in b.BUILDERS:
    if name not in names:
        continue
    path = os.path.join(b.OUT, name + ".json")
    published = json.load(open(path, encoding="utf-8"))
    b.K._taken.update(re.findall(r'"key": "([a-z0-9]{8})"', json.dumps(published)))
    doc = b.wrap_doc_sql(fn())
    b.K.check_ids(doc)
    b.keep_published(doc, published)
    a, p = nodes(doc, {}), nodes(published, {})
    strip = lambda n: {k: v for k, v in n.items() if k != "blocks"}
    print("== %s: %d nodes (was %d)" % (name, len(a), len(p)))
    print("   added:  ", sorted(set(a) - set(p)))
    print("   removed:", sorted(set(p) - set(a)))
    print("   changed:", sorted(k for k in set(a) & set(p) if strip(a[k]) != strip(p[k])))
    order = lambda d: [n["id"] for n in d["nodes"]]
    if order(doc) != order(published):
        print("   top-level order changed")
    for k in ("request_json", "response_json"):
        if doc.get(k) != published.get(k):
            print("   %s changed" % k)
