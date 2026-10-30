"""Build the prod paste: the ENABLED prod Picking list page (v77) with only its mounted handler (eventScript 1) replaced by
PPonMountedListPage.one_by_one.js. Asserts the base handler is still prod v77's and nothing else differs.
usage: python3 make_handler.py && python3 build.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
base = json.load(open(os.path.join(HERE, "PickingListPageFullJSON.prod_v77.base.json")))
old = open(os.path.join(HERE, "PPonMountedListPage.prod_v77.js")).read()
new = open(os.path.join(HERE, "PPonMountedListPage.one_by_one.js")).read()


def diff_paths(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        return [x for k in sorted(set(a) | set(b)) for x in diff_paths(a.get(k), b.get(k), p + "/" + k)]
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [x for i in range(len(a)) for x in diff_paths(a[i], b[i], p + "/" + str(i))]
    return [] if a == b else [p]


entry = base["config"]["eventScript"][1]
assert entry.get("name") == "mounted" and entry["func"] == old, "eventScript 1 is not prod v77's mounted handler"
paste = json.loads(json.dumps(base))
paste["config"]["eventScript"][1]["func"] = new
assert diff_paths(base, paste) == ["/config/eventScript/1/func"]
json.dump(paste, open(os.path.join(HERE, "PickingListPageFullJSON.prod_paste.json"), "w"), ensure_ascii=False, indent=1)
print("PickingListPageFullJSON.prod_paste.json = prod v77 + eventScript 1 (mounted)")
