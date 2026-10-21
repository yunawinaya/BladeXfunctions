"""patch_list_page.py [--write]: the GD list page (Bulk Actions/Sales & Distribution/Goods Delivery/GDlistPageJSON.json, dev page
1902688873696313346) gets GD Revert V2: bulk_GDRevertCompleted = RevertCompletedWorkflow.js (REVERT_V2_ENABLED) and the mount nudge
(Goods Delivery/CompleteV2/gdc_list_mounted.js) also ticks GD_REVERT_WORKER. The workflow ids come from Goods Delivery/RevertV2/
ids.json (GDREV_IDS overrides it for a dry run) and replace the placeholders in both .js files (written back with --write). Each
handler in the page must still be the committed (git HEAD) text, so nobody's later edit is overwritten; replaced as an exact string
in the file (formatting kept)."""
import json
import os
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PAGE = R + "Bulk Actions/Sales & Distribution/Goods Delivery/GDlistPageJSON.json"
REVERT = R + "Bulk Actions/Sales & Distribution/Goods Delivery/RevertCompletedWorkflow.js"
MOUNTED = R + "Goods Delivery/CompleteV2/gdc_list_mounted.js"
IDS = json.load(open(os.environ.get("GDREV_IDS") or R + "Goods Delivery/RevertV2/ids.json"))
for k in ("GD_REVERT_SUBMIT", "GD_REVERT_WORKER"):
    assert IDS.get(k, "").isdigit(), k + " has no workflow id in ids.json"
SUBS = {"__GD_REVERT_SUBMIT_ID__": IDS["GD_REVERT_SUBMIT"], "__GD_REVERT_WORKER_ID__": IDS["GD_REVERT_WORKER"]}


def head(path):
    return subprocess.run(["git", "-C", R, "show", "HEAD:" + os.path.relpath(path, R)], capture_output=True, text=True, check=True).stdout


def filled(path):
    t = open(path, encoding="utf-8").read()
    for a, b in SUBS.items():
        t = t.replace(a, b)
    assert "__GD_REVERT_" not in t, path
    return t


raw = open(PAGE, encoding="utf-8").read()
page = json.loads(raw)
scripts = page["config"]["eventScript"]
by_name = {s.get("name"): i for i, s in enumerate(scripts)}
i_revert = by_name["bulk_GDRevertCompleted"]
i_mount = next(i for i, s in enumerate(scripts) if "gdc_worker_kick_at" in (s.get("func") or ""))
out = raw
texts = {path: filled(path) for path in (REVERT, MOUNTED)}  # read before --write rewrites the files
for i, path in ((i_revert, REVERT), (i_mount, MOUNTED)):
    old, new = scripts[i]["func"], texts[path]
    if old == new:
        continue
    assert old == head(path), "the page's %s is not the committed %s: rebuild on the live page" % (scripts[i].get("name"), os.path.basename(path))
    eo, en = json.dumps(old, ensure_ascii=False), json.dumps(new, ensure_ascii=False)
    assert out.count(eo) == 1, "the handler text is not unique in the page file"
    out = out.replace(eo, en)
check = json.loads(out)
assert check["config"]["eventScript"][i_revert]["func"] == texts[REVERT] and check["config"]["eventScript"][i_mount]["func"] == texts[MOUNTED]
print("GD list page: bulk_GDRevertCompleted %d -> %d chars, mounted %d -> %d chars" % (len(scripts[i_revert]["func"]), len(texts[REVERT]), len(scripts[i_mount]["func"]), len(texts[MOUNTED])))
if "--write" in sys.argv:
    open(PAGE, "w", encoding="utf-8").write(out)
    for path in (REVERT, MOUNTED):
        open(path, "w", encoding="utf-8").write(texts[path])
    print("wrote the page and both .js files (ids filled)")
