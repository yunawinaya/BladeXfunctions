"""patch_max_retries_60.py: GD Created V2 - a job may retry 60 times instead of 20 (LSH 2026-10-26 07:31: after the 6 -> 20 paste,
big GDs still lost the stock race again and again - each call first checks that all its 33-81 keys are free, then takes them one by
one, and a smaller GD that grabs one key mid-way sends it back as a counted LOCK_CONFLICT retry; GD-2610-1466 (45 keys) reached
retry 13 in 12 minutes while smaller GDs completed). Same edit as patch_max_retries_20.py, 20 -> 60: about 48 minutes of trying.
LOCK_CONFLICT means nothing moved; a lock that never frees is caught by the watch (locks held 10+ min) long before 60.

usage: python3 patch_max_retries_60.py [--write]
"""
import json
import os
import re
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
EXPECT = {"GD_BULK_COMMIT": 2, "GD_ASYNC_WORKER": 6, "GD_JOB_RECONCILE": 1}


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
                if isinstance(sc, dict) and isinstance(sc.get("code"), str) and '"max_retries":20' in sc["code"]:
                    assert re.search(r"retry\.max_retries", sc["code"]), name + " " + o["id"] + ": carries the constant without using it"
                    assert sc["code"].count('"max_retries":20') == 1, name + " " + o["id"]
                    sc["code"] = sc["code"].replace('"max_retries":20', '"max_retries":60')
                    changed.append(o["id"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    assert len(changed) == want, "%s: %d nodes changed, %d expected" % (name, len(changed), want)
    out = render(doc)
    assert out.count('"max_retries":20') == 0 and '\\"max_retries\\":20' not in out
    print("%s: max_retries 20 -> 60 in %s" % (name, changed))
    if "--write" in sys.argv:
        open(p, "w", encoding="utf-8").write(out)
print("written" if "--write" in sys.argv else "ok (dry): pass --write")
