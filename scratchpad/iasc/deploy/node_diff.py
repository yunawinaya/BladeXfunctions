"""python3 scratchpad/iasc/deploy/node_diff.py <live.json> <built.json> [--full] - what a publish of <built.json> changes on top of the
live version (a `.dbtools/wf --dev backup` file): request_json / response_json, every node added, removed or changed (by id), and for
each changed field a unified diff of its text (code and SQL bodies unescaped); generated row keys in request_json / response_json
are set aside. --full prints whole diffs (default: 60 lines each)."""
import difflib, json, sys


def load(path):
    x = json.load(open(path, encoding="utf-8"))
    return json.loads(x) if isinstance(x, str) else x


def nodes(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if "id" in n and "type" in n and "data" in n:
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(doc.get("nodes", []))
    return out


def text(v):
    return v if isinstance(v, str) else json.dumps(v, indent=1, ensure_ascii=False, sort_keys=True)


def show(label, a, b, full):
    d = list(difflib.unified_diff(text(a).splitlines(), text(b).splitlines(), "live", "built", n=1, lineterm=""))
    print("  -- " + label)
    for line in d[2:] if full else d[2:62]:
        print("     " + line[:240])
    if not full and len(d) > 62:
        print("     ... %d more diff lines" % (len(d) - 62))


def nokeys(v):
    """request_json / response_json rows without their generated 8-char "key" (builders re-seed them; names and types decide)"""
    if isinstance(v, dict):
        return {k: nokeys(x) for k, x in v.items() if k != "key"}
    if isinstance(v, list):
        return [nokeys(x) for x in v]
    return v


def fields(n):
    out = dict({k: v for k, v in n.items() if k not in ("blocks", "data")}, **{"data." + k: v for k, v in n["data"].items()})
    for k in ("data.request_json", "data.response_json"):
        if k in out:
            out[k] = nokeys(out[k])
    return out


def main():
    live, built = load(sys.argv[1]), load(sys.argv[2])
    full = "--full" in sys.argv
    for k in ("request_json", "response_json", "config"):
        if nokeys(live.get(k)) != nokeys(built.get(k)):
            show(k, live.get(k), built.get(k), full)
        elif live.get(k) != built.get(k):
            print("  (%s: only generated row keys differ)" % k)
    a, b = nodes(live), nodes(built)
    print("only live:", sorted(set(a) - set(b)))
    print("only built:", sorted(set(b) - set(a)))
    for nid in sorted(set(a) & set(b)):
        fa, fb = fields(a[nid]), fields(b[nid])
        changed = sorted(k for k in set(fa) | set(fb) if fa.get(k) != fb.get(k))
        if changed:
            print("== %s (%s): %s" % (nid, a[nid]["type"], changed))
            for k in changed:
                show(k, fa.get(k, ""), fb.get(k, ""), full)
    if a.keys() != b.keys() or any(fields(a[i]) != fields(b[i]) for i in set(a) & set(b)):
        return
    print("no node differs")


if __name__ == "__main__":
    main()
