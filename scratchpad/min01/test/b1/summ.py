import json, sys
d = json.load(open(sys.argv[1]))
data = d.get("data") or {}
def load(v):
    if isinstance(v, str):
        try: return json.loads(v)
        except Exception: return v
    return v
print("response:", json.dumps(load(data.get("responseJsonData")), ensure_ascii=False)[:300])
nd = load(data.get("nodesData")) or []
ids = [n.get("node_id") for n in nd]
print("executed:", len(ids), "| CL:", [i for i in ids if i and "CL" in i])
want = sys.argv[2:]
for n in nd:
    if n.get("node_id") in want or (want == ["ALLCL"] and "CL" in (n.get("node_id") or "")):
        out = load(n.get("response_json_data") or n.get("output") or n.get("response"))
        print(" ", n.get("node_id"), "->", json.dumps(out, ensure_ascii=False)[:400])
