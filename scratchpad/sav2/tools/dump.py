"""Dump chosen nodes of a FlowGram workflow JSON: code bodies, if/condition rules, db props, workflow-node params.
usage: python3 dump.py <workflow.json> [node_id ...]   (no ids = every node's id/type/title + a one-line summary)"""
import json, sys

def walk(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and isinstance(o.get("data"), dict) and "type" in o:
            out[o["id"]] = o
        for v in o.values():
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)

def show(n):
    d = n["data"]
    print("=" * 100)
    print(n["id"], "[" + n["type"] + "]", d.get("title", ""))
    sc = d.get("script")
    if isinstance(sc, dict) and sc.get("code"):
        print("--- code:")
        print(sc["code"])
    rest = {k: v for k, v in d.items() if k not in ("script", "title", "outputs", "inputs", "inputsValues")}
    for k in ("inputsValues", "inputs"):
        if d.get(k):
            rest[k] = d[k]
    s = json.dumps(rest, ensure_ascii=False)
    print("--- data (", len(s), "chars):", s[:6000])

nodes = {}
wf = json.load(open(sys.argv[1]))
walk(wf, nodes)
ids = sys.argv[2:]
if not ids:
    for i, n in nodes.items():
        print(i, n["type"], n["data"].get("title", ""))
else:
    for i in ids:
        show(nodes[i]) if i in nodes else print("MISSING", i)
