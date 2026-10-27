"""The prod paste folder as handed over: each paste is the build, each rollback is the prod base with only the default
branches reshaped, and the README carries the steps the paste needs (the live check first, the order, a refusal midway,
what is not in it, where the workflows are built).

usage: python3 scratchpad/sosave_perf/test/check_prod_folder.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
FOLDER = os.path.join(REPO, "prod-hotfix", "2026-10-27-so-save-v2-speed")
ORDER = [("SO_SAVE_COMMIT", "2112758624899170305"), ("SO_SAVE_PREPARE", "2112758585934086146"), ("SO_SAVE_WORKER", "2112758538274209793"),
         ("SO_SAVE_RUN", "2113116286771331073"), ("SO_SAVE_SUBMIT", "2112758477792346114"), ("CREDIT_LIMIT_CHECK", "1990247316342333442")]
DEFAULT_KEYS = ("title", "filter", "expression", "displayContent", "isDefault")
fails = 0


def check(name, ok):
    global fails
    print(("ok   " if ok else "FAIL ") + name)
    fails += 0 if ok else 1


def load(*parts):
    return json.load(open(os.path.join(*parts)))


def reshaped(doc):
    """the build's reshape of the default branches the platform's publish refuses"""
    def walk(nodes):
        for n in nodes:
            d = n.get("data") or {}
            if (n["type"] == "condition-or-node-item" and d.get("isDefault") and not (d.get("filter") or {}).get("list")
                    and not n.get("blocks") and any(k in d for k in ("condition_type", "isValidator", "name", "nodeName"))):
                n["data"] = {k: d[k] for k in DEFAULT_KEYS if k in d}
            walk(n.get("blocks") or [])
    walk(doc["nodes"])
    return doc


for name, _ in ORDER:
    check(f"{name}.prod_paste.json is out/{name}.json", load(FOLDER, f"{name}.prod_paste.json") == load(ROOT, "out", f"{name}.json"))
    check(f"{name}.prod_rollback.json is the prod base with only the default branches reshaped",
          load(FOLDER, f"{name}.prod_rollback.json") == reshaped(load(FOLDER, f"{name}.prod_base.json")))

readme = open(os.path.join(FOLDER, "README.md")).read()
heads = [m.group(0) for m in re.finditer(r"^## .*$", readme, re.M)]
before = readme.find("## Before the paste")
paste = readme.find("## Paste")
check("README: a 'Before the paste' section comes before the paste table", 0 <= before < paste)
section = readme[before:paste]
check("README: it checks every prod base against prod with wf --prod deployed",
      "wf --prod deployed" in section and all(name in section for name, _ in ORDER) and "prod_base.json" in section and "IDENTICAL" in section)
rows = re.findall(r"^\| (\d) \| (\S+) \| `(\d+)` \|", readme, re.M)
check("README: the paste table is the six, children first, with their ids",
      [(int(n), w, i) for n, w, i in rows] == [(k + 1, w, i) for k, (w, i) in enumerate(ORDER)])
check("README: what to do when a paste is refused midway", "## If a paste is refused" in readme)
check("README: says the COMMIT-phase fold (Task 6) is not in this paste", "Task 6" in readme and "not in this paste" in readme.lower())
check("README: says the code nodes are trimmed and where they are built", "trimmed" in readme and "scratchpad/sosave_perf/build.py" in readme)
handoff = open(os.path.join(REPO, "Sales Order", "AsyncV2", "SO_SAVE_V2_HANDOFF.md")).read()
check("hand-off: names the builder of the live workflows", "scratchpad/sosave_perf/build.py" in handoff)

print("all passed" if not fails else f"{fails} FAILED")
raise SystemExit(1 if fails else 0)
