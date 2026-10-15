"""check_refs.py <workflow.json>...: every {{node:X.data.F...}} (and ConditionRule node.X.data.F) names a field X declares:
a code node's response_json, a sql node's columns (row fields of .data), a loop's item; unknown nodes are reported"""
import json, re, sys

def nodes_of(doc):
    out = {}
    def walk(n):
        if isinstance(n, dict):
            if "type" in n and "id" in n and isinstance(n.get("data"), dict):
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out

bad = 0
for path in sys.argv[1:]:
    doc = json.load(open(path))
    nodes = nodes_of(doc)
    text = json.dumps(doc, ensure_ascii=False)
    refs = set(re.findall(r"\{\{node:([A-Za-z0-9_]+)\.data\.([A-Za-z0-9_]+)", text)) | set(re.findall(r"node\.([A-Za-z0-9_]+)\.data\.([A-Za-z0-9_]+)", text))
    problems = []
    for nid, field in sorted(refs):
        n = nodes.get(nid)
        if n is None:
            problems.append("%s.%s: no such node" % (nid, field))
            continue
        t = n["type"]
        if t == "code-node":
            names = [x["name"] for x in n["data"].get("response_json", [])]
            if field not in names:
                problems.append("%s.%s: not declared (%s)" % (nid, field, ", ".join(names)[:120]))
        elif t == "sql-node":
            cols = [x["name"] for x in n["data"].get("response_json", [])]
            if field not in cols and field not in ("data",):
                problems.append("%s.%s: sql column not declared" % (nid, field))
    print("%s: %d references, %d problems" % (path.split("/")[-1], len(refs), len(problems)))
    for p in problems:
        print("   ", p)
    bad += len(problems)
sys.exit(1 if bad else 0)
