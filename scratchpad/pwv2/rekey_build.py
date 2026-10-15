"""Build one workflow and keep the live JSON's generated keys / filter ids wherever a node did not really change, so the
diff against the deployed version shows only the real changes (the builder's seeded key generator reshuffles every key
after an inserted node).

usage: python3 rekey_build.py NAME [--write] [--gr]     (the live JSON = the repo copy, IDENTICAL to dev before the change;
       --gr: a GR V2 workflow, scratchpad/grv2/build_grv2.py)
"""
import json
import os
import sys

import build_pwv2 as B

def norm(x):
    """a node's data without the generated parts: response_json keys, numeric filter / rule ids"""
    if isinstance(x, dict):
        return {k: norm(v) for k, v in x.items()
                if not (k == "key" and isinstance(v, str)) and not (k in ("id", "parentId") and (isinstance(v, int) or isinstance(v, str) and v.isdigit()))}
    if isinstance(x, list):
        return [norm(v) for v in x]
    return x


def nodes(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if "type" in n and "id" in n and "data" in n:
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def copy_keys(new, old):
    """response_json / request_json entries: the live key of the entry with the same name (children too)"""
    by = {e.get("name"): e for e in old or []}
    for e in new or []:
        o = by.get(e.get("name"))
        if o is None:
            continue
        e["key"] = o.get("key", e.get("key"))
        if e.get("children") and o.get("children"):
            copy_keys(e["children"], o["children"])


def main():
    name = [a for a in sys.argv[1:] if not a.startswith("--")][0]
    mod = B.G if "--gr" in sys.argv else B
    fn = dict(mod.BUILDERS)[name]
    doc = B.G.wrap_doc_sql(fn())
    path = os.path.join(mod.OUT, name + ".json")
    live = json.load(open(path, encoding="utf-8"))
    copy_keys(doc.get("request_json"), live.get("request_json"))
    copy_keys(doc.get("response_json"), live.get("response_json"))
    L, N = nodes(live), nodes(doc)
    same, changed = 0, []
    for nid, n in N.items():
        o = L.get(nid)
        if o is None or o["type"] != n["type"]:
            continue
        if norm(o["data"]) == norm(n["data"]):
            n["data"] = json.loads(json.dumps(o["data"]))
            same += 1
        else:
            copy_keys(n["data"].get("response_json"), o["data"].get("response_json"))
            changed.append(nid)
    B.K.check_ids(doc)
    added = sorted(set(N) - set(L))
    removed = sorted(set(L) - set(N))
    print(f"{name}: {len(N)} nodes; unchanged {same}; changed {len(changed)} {changed}; added {added}; removed {removed}")
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    if "--write" in sys.argv:
        open(path, "w", encoding="utf-8").write(text + "\n")
        print("wrote", path)
    else:
        out = os.path.join(os.environ.get("TMPDIR", "/tmp"), name + ".rekeyed.json")
        open(out, "w", encoding="utf-8").write(text + "\n")
        print("dry ->", out)


main()
