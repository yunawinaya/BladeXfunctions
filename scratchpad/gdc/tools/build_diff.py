# build_diff.py <builder dir> <builder module> [NAME ...]: each built workflow vs its repo file, node by node (only the nodes
# you meant to change may differ; see memory feedback_fetch_deployed_before_editing)
import json, os, re, sys
sys.argv = [sys.argv[0]] + sys.argv[1:]
mod_dir, mod_name = sys.argv[1], sys.argv[2]
names = sys.argv[3:]
sys.path.insert(0, mod_dir)
B = __import__(mod_name)
K = B.K
def nodes(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and isinstance(o.get("data"), dict): out[o["id"]] = o
        for v in o.values(): nodes(v, out)
    elif isinstance(o, list):
        for v in o: nodes(v, out)
    return out
for name, fn in B.BUILDERS:
    if names and name not in names: continue
    path = os.path.join(B.OUT, name + ".json")
    pub = json.load(open(path, encoding="utf-8"))
    K._taken.update(re.findall(r'"key": "([a-z0-9]{8})"', json.dumps(pub)))
    doc = B.wrap_doc_sql(fn()); B.keep_published(doc, pub)
    a, b = nodes(pub, {}), nodes(doc, {})
    diff = [i for i in sorted(set(a) | set(b)) if json.dumps(a.get(i, {}).get("data"), sort_keys=True) != json.dumps(b.get(i, {}).get("data"), sort_keys=True)]
    print(name, "| differs from the repo file in:", diff, "| only in repo:", sorted(set(a) - set(b)), "| only in build:", sorted(set(b) - set(a)))
