"""patch_cache_key_per_run.py <file>... [--write]: a run's Redis key name gets a random tag (10-27).

The convert / post workflows named their run's cache <PREFIX>:<uid>:<date>:<HHMMSS>, so two runs of one user whose naming
node ran in the same second shared one cache. Kenhin, 10-26 15:58:17: the auto-SI runs of GD-2610-2094 and 2093
(GD_Convert_SI, both 'GD_CONVERT_SI:2006752085990985729:2026-10-26:155817') both reported SI/20261026/0856, 2094's invoice;
2093's own is 0857. What the shared value holds: GD_Convert_SI the run's results (number, success / failure); SO_Convert_SI
and PO_CONVERT_PI the loop cursor and the created invoices; SI_POST and MI_CREATE a loop index.

Every code node that builds such a name gets ':' + 8 random characters. Text-level replace of each node's code string; the
patch asserts nothing else changes. Dry run unless --write.
Applied 10-27 to GD_Convert_SI, SO_Convert_SI and PO_CONVERT_PI. SI_POST is out of scope (user): never patch it. MI_CREATE's
patched copy (scratchpad/gdc/deploy_cache_key/MI_CREATE.json) is not published: dev has an unpublished v14 draft."""
import json
import re
import sys

TIME = "const time = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS"
TAG = "${Math.random().toString(36).slice(2, 10)}"
WHY = "// the random tag: two runs of one user in the same second shared one key (GD-2610-2093 reported 2094's invoice, 10-26)\n"


def code_nodes(o):
    if isinstance(o, dict):
        s = o.get("data", {}).get("script") if isinstance(o.get("data"), dict) else None
        if isinstance(s, dict) and isinstance(s.get("code"), str):
            yield o
        for v in o.values():
            yield from code_nodes(v)
    elif isinstance(o, list):
        for v in o:
            yield from code_nodes(v)


def patch(path, write):
    raw = open(path, encoding="utf-8").read()
    W = json.loads(raw)
    changed = {}
    for n in code_nodes(W):
        code = n["data"]["script"]["code"]
        if TIME not in code:
            continue
        if TAG in code:
            print("  %s: already tagged" % n["id"])
            continue
        assert code.count("${time}`") == 1, (path, n["id"], "one key name per node")
        new = code.replace("${time}`", "${time}:" + TAG + "`")
        new = re.sub(r'(// Example: "[A-Za-z_]+:12345:2024-02-24:143022)"', r'\1:k3f9x0ab"', new)
        assert new.count("return {") == 1, (path, n["id"])
        new = new.replace("return {", WHY + "return {")
        lit_old, lit_new = json.dumps(code, ensure_ascii=False), json.dumps(new, ensure_ascii=False)
        assert raw.count(lit_old) == 1, (path, n["id"], "the code string is not stored once, as json.dumps writes it")
        raw = raw.replace(lit_old, lit_new)
        changed[n["id"]] = (code, new)
    if not changed:
        print("%s: nothing to patch" % path)
        return []
    W2 = json.loads(raw)
    for n in code_nodes(W2):
        if n["id"] in changed:
            assert n["data"]["script"]["code"] == changed[n["id"]][1]
            n["data"]["script"]["code"] = changed[n["id"]][0]
    assert W2 == W, path + ": something besides the key-name code changed"
    for nid, (old, new) in changed.items():
        print("=====", path, nid)
        print(new)
    if write:
        open(path, "w", encoding="utf-8").write(raw)
        print("written", path)
    return list(changed)


if __name__ == "__main__":
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    assert files, "usage: patch_cache_key_per_run.py <file>... [--write]"
    for f in files:
        patch(f, "--write" in sys.argv)
    if "--write" not in sys.argv:
        print("dry run: pass --write")
