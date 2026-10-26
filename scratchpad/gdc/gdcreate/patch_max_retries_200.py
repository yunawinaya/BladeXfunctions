"""patch_max_retries_200.py: GD_ASYNC_WORKER + GD_JOB_RECONCILE retry limit 60 -> 200, aligned with GD_BULK_COMMIT P3 (10-26 review).
At 60, one dead run after retry 60 exhausted a job the commit still allowed: Pick clamps a dead claim's count to min(n+1, 60)
and Claim exhausts at attempts >= 60. attempt_count is one shared counter, so all nodes that read it use one limit.
Applies on the 60 state (prod v15 / v9). Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_max_retries_200.py [--write]
"""
import json
import os
import re
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
EXPECT = {"GD_ASYNC_WORKER": 6, "GD_JOB_RECONCILE": 1}


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


for name, want in EXPECT.items():
    p = R + name + ".json"
    raw = open(p, encoding="utf-8").read()
    doc = json.loads(raw)
    assert render(doc) == raw, name + ": the repo file does not round-trip"
    changed = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("id") and isinstance(o.get("data"), dict):
                sc = o["data"].get("script")
                if isinstance(sc, dict) and isinstance(sc.get("code"), str) and '"max_retries":60' in sc["code"]:
                    assert re.search(r"retry\.max_retries", sc["code"]) and sc["code"].count('"max_retries":60') == 1
                    sc["code"] = sc["code"].replace('"max_retries":60', '"max_retries":200')
                    changed.append(o["id"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    assert len(changed) == want, "%s: %d nodes changed, %d expected" % (name, len(changed), want)
    print("%s: max_retries 60 -> 200 in %s" % (name, changed))
    if "--write" in sys.argv:
        open(p, "w", encoding="utf-8").write(render(doc))
print("written" if "--write" in sys.argv else "ok (dry): pass --write")
