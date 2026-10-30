"""Put the re-kick follow into the Picking form and list page: the repo files (= dev) and the two prod pastes.

Only one handler changes in each: the form's eventScript 14 (pkV2_onSave_Completed.js) and the list page's eventScript 24
(pkV2_listAutoPick.js). Each base's handler must still be the committed .js, and nothing else may differ from the base.
Run pull.py first (it writes the *.base.json files).   usage: python3 build.py
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
ITEMS = [
    # name, repo full JSON, handler index, handler .js, dev base, prod base
    ("PickingFullJSON", "Picking/PickingFullJSON.json", 14, "Picking/AsyncV2/pkV2_onSave_Completed.js", "dev_v439", "prod_v183"),
    ("PickingListPageFullJSON", "Picking/PickingListPageFullJSON.json", 24, "Picking/AsyncV2/pkV2_listAutoPick.js", "dev_v225", "prod_v76"),
]


def committed(path):
    return subprocess.run(["git", "show", "HEAD:" + path], capture_output=True, text=True, cwd=R, check=True).stdout


def diff_paths(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        return [x for k in sorted(set(a) | set(b)) for x in diff_paths(a.get(k), b.get(k), p + "/" + k)]
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [x for i in range(len(a)) for x in diff_paths(a[i], b[i], p + "/" + str(i))]
    return [] if a == b else [p]


def patched(base, idx, old, new, label):
    entry = base["config"]["eventScript"][idx]
    assert entry["func"] == old.rstrip(), label + ": eventScript %d is not the committed handler" % idx
    out = json.loads(json.dumps(base))
    out["config"]["eventScript"][idx]["func"] = new.rstrip()
    assert diff_paths(base, out) == ["/config/eventScript/%d/func" % idx], label
    return out


for name, repo, idx, js, dev, prod in ITEMS:
    old, new = committed(js), open(R + js).read()
    assert old != new, js + " is unchanged"
    # the repo file (= dev): an escaped-string replace keeps its formatting; the result must be the dev base + the handler
    raw = open(R + repo).read()
    for ascii_only in (False, True):
        o, n = json.dumps(old.rstrip(), ensure_ascii=ascii_only)[1:-1], json.dumps(new.rstrip(), ensure_ascii=ascii_only)[1:-1]
        if raw.count(o) == 1:
            break
    else:
        sys.exit(repo + ": the committed handler is not found exactly once")
    out = raw.replace(o, n)
    want = patched(json.load(open(os.path.join(HERE, "%s.%s.base.json" % (name, dev)))), idx, old, new, name + " dev")
    assert json.loads(out) == want, repo + ": not the dev base + the handler"
    open(R + repo, "w").write(out)
    print("repo", repo, "= %s + eventScript %d" % (dev, idx))
    # the prod paste: the ENABLED prod version + the same handler
    paste = patched(json.load(open(os.path.join(HERE, "%s.%s.base.json" % (name, prod)))), idx, old, new, name + " prod")
    path = os.path.join(HERE, name + ".prod_paste.json")
    json.dump(paste, open(path, "w"), ensure_ascii=False, indent=1)
    print("paste", os.path.basename(path), "= %s + eventScript %d" % (prod, idx))
