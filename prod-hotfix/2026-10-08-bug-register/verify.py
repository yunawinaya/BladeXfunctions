#!/usr/bin/env python3
"""Static checks for every <WF>.PROD.json against its <WF>.BASE.json:
  1. node diff  - which nodes were added / removed / changed (must match the README map)
  2. lint       - scratchpad/validate.py findings present in PROD but not in BASE
  3. syntax     - `node --check` on every added or changed code-node script
usage: python3 verify.py [WF ...]   (default: every *.PROD.json here)"""
import glob, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
VALIDATE = os.path.join(REPO, "scratchpad", "validate.py")


def index(d):
    out = {}

    def walk(lst):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                out[n["id"]] = n
                walk(n.get("blocks") or [])

    walk(d["nodes"])
    return out


def shallow(n):
    body = {k: v for k, v in n.items() if k != "blocks"}
    body["child_ids"] = [c.get("id") for c in n.get("blocks") or []]
    return json.dumps(body, sort_keys=True, ensure_ascii=False)


def lint(path):
    r = subprocess.run([sys.executable, VALIDATE, path], capture_output=True, text=True)
    lines = [l.strip() for l in r.stdout.splitlines()
             if re.match(r"\s*(MISSING|FORWARD|DIVERGENT|UNDECLARED|UNUSED)\b", l)]
    return set(lines)


def syntax_ok(code):
    stub = "(async function(){\n" + re.sub(r"\{\{[^}]*\}\}", "null", code) + "\n})();"
    fd, path = tempfile.mkstemp(suffix=".js")
    os.write(fd, stub.encode())
    os.close(fd)
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    os.unlink(path)
    return r.returncode == 0, r.stderr[:400]


def verify(name):
    base_p, prod_p = (os.path.join(HERE, f"{name}.{s}.json") for s in ("BASE", "PROD"))
    base, prod = (json.load(open(p, encoding="utf-8")) for p in (base_p, prod_p))
    ib, ip = index(base), index(prod)
    added = sorted(set(ip) - set(ib))
    removed = sorted(set(ib) - set(ip))
    changed = sorted(i for i in set(ib) & set(ip) if shallow(ib[i]) != shallow(ip[i]))
    top = [k for k in ("request_json", "response_json", "config", "edges")
           if json.dumps(base.get(k), sort_keys=True) != json.dumps(prod.get(k), sort_keys=True)]

    print(f"== {name}")
    print(f"   added:   {added or '-'}")
    print(f"   removed: {removed or '-'}")
    print(f"   changed: {changed or '-'}")
    if top:
        print(f"   top-level keys changed: {top}")

    ok = not removed
    new_findings = sorted(lint(prod_p) - lint(base_p))
    for f in new_findings:
        print(f"   NEW LINT: {f}")
        if not f.startswith("UNUSED"):
            ok = False

    for nid in added + changed:
        n = ip[nid]
        if n["type"] == "code-node":
            good, err = syntax_ok(n["data"]["script"]["code"])
            if not good:
                ok = False
                print(f"   SYNTAX FAIL {nid}: {err}")
    print(f"   {'OK' if ok else 'PROBLEMS'}")
    return ok


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(os.path.basename(p)[:-len(".PROD.json")]
                                   for p in glob.glob(os.path.join(HERE, "*.PROD.json")))
    results = [verify(n) for n in names]
    sys.exit(0 if all(results) else 1)
