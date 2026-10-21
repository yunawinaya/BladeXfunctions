"""dump.py <workflow json> [node id ...]: every node's full config (code bodies unescaped), in tree order."""
import json, sys
doc = json.load(open(sys.argv[1]))
only = set(sys.argv[2:])
def walk(nodes):
    for n in nodes or []:
        if isinstance(n, dict):
            yield n
            yield from walk(n.get("blocks"))
            d = n.get("data") or {}
            for key in ("items", "conditions", "branches"):
                for it in d.get(key) or []:
                    if isinstance(it, dict):
                        yield from walk(it.get("blocks") or it.get("nodes"))
for n in walk(doc["nodes"]):
    if only and n.get("id") not in only:
        continue
    t = n.get("type")
    d = dict(n.get("data") or {})
    print("=" * 100)
    print(n.get("id"), "[%s]" % t, d.get("title"))
    if t == "code-node":
        sc = d.pop("script", None) or {}
        code = sc.get("code") if isinstance(sc, dict) else sc
        rj = d.pop("response_json", None)
        print("response_json:", json.dumps([r.get("name") for r in (rj or [])]))
        print(code)
        rest = {k: v for k, v in d.items() if k not in ("title",)}
        if rest: print("other:", json.dumps(rest, ensure_ascii=False)[:600])
    elif t in ("start-node", "ifBlock", "condition-all-node-item"):
        pass
    else:
        print(json.dumps(d, ensure_ascii=False, indent=1)[:6000])
