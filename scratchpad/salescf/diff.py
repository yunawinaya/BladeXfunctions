"""diff.py: what build.py changed in a workflow or form, node by node (base/<env>/ vs out/<env>/): added / removed nodes,
changed code (unified diff), changed or added write-node props, changed form handlers. For reviewers; read-only.

usage: python3 scratchpad/salescf/diff.py [--env dev|prod] NAME [NAME ...]
"""
import difflib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def nodes(o, out):
    if isinstance(o, dict):
        if "id" in o and "type" in o and isinstance(o.get("data"), dict):
            out[o["id"]] = o
        for v in o.values():
            nodes(v, out)
    elif isinstance(o, list):
        for v in o:
            nodes(v, out)
    return out


def udiff(a, b, label):
    return "\n".join(difflib.unified_diff(a.splitlines(), b.splitlines(), label + " (base)", label + " (out)", lineterm="", n=1))


def main():
    args = sys.argv[1:]
    env = "dev"
    if "--env" in args:
        env = args[args.index("--env") + 1]
        args = [a for i, a in enumerate(args) if a != "--env" and (i == 0 or args[i - 1] != "--env")]
    for name in args:
        base = json.loads(open(os.path.join(HERE, "base", env, name + ".json"), encoding="utf-8").read())
        out = json.loads(open(os.path.join(HERE, "out", env, name + ".json"), encoding="utf-8").read())
        print("=" * 100 + "\n%s (%s)" % (name, env))
        if name.startswith("form_"):
            hb = {e.get("name"): e.get("func") or "" for e in base["config"]["eventScript"]}
            ho = {e.get("name"): e.get("func") or "" for e in out["config"]["eventScript"]}
            for h in ho:
                if hb.get(h) != ho[h]:
                    print(udiff(hb.get(h, ""), ho[h], "handler " + h))
            continue
        nb, no = nodes(base, {}), nodes(out, {})
        for nid in no:
            if nid not in nb:
                d = no[nid]["data"]
                print("+ NEW %s %s: %s" % (no[nid]["type"], nid, d.get("title") or ""))
                sc = d.get("script")
                if isinstance(sc, dict) and sc.get("code"):
                    print("  " + sc["code"].replace("\n", "\n  "))
                if no[nid]["type"] == "if":
                    print("  expression:", d.get("expression", {}).get("code"))
        for nid in nb:
            if nid not in no:
                print("- REMOVED", nid)
        for nid in nb:
            if nid not in no:
                continue
            db, do = nb[nid]["data"], no[nid]["data"]
            sb = (db.get("script") or {}).get("code", "") if isinstance(db.get("script"), dict) else ""
            so = (do.get("script") or {}).get("code", "") if isinstance(do.get("script"), dict) else ""
            if sb != so:
                print(udiff(sb, so, "%s %s" % (nb[nid]["type"], nid)))
            pb = {p.get("prop"): p.get("value") for p in (db.get("props") or {}).get("list", [])} if isinstance(db.get("props"), dict) else {}
            po = {p.get("prop"): p.get("value") for p in (do.get("props") or {}).get("list", [])} if isinstance(do.get("props"), dict) else {}
            for k in po:
                if pb.get(k) != po[k]:
                    print("~ PROP %s %s: %s -> %s" % (nid, k, pb.get(k), po[k]))
            rb = [f.get("name") for f in db.get("response_json") or [] if isinstance(f, dict)]
            ro = [f.get("name") for f in do.get("response_json") or [] if isinstance(f, dict)]
            if rb != ro:
                print("~ DECLARED %s: + %s" % (nid, [x for x in ro if x not in rb]))


if __name__ == "__main__":
    main()
