"""patch_max_retries_20.py: GD Created V2 - a job may retry 20 times instead of 6 (LSH 2026-10-26: SO conversions of 28 and ~20 at once
queue on the same items' stock locks - each holder keeps ~42-78 keys for ~19 s on average, 47 s at most - and a GD whose 7 calls
all meet a held key gives up after ~4 min, GD_TRANSIENT_RETRIES_EXHAUSTED, while the burst needed ~6.5 min to drain). Same edit as
patch_max_retries.py (10-23, 3 -> 6): GDC.retry.max_retries in every node that decides with it - GD_BULK_COMMIT (P3 before / after
the call), GD_ASYNC_WORKER (pick, claim, exhaust, after prepare / publish x2) and GD_JOB_RECONCILE. Backoff unchanged:
min(30 s, 2 s * 2^n), so retries 7-20 come every ~50 s: ~17 min of trying instead of ~4.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_max_retries_20.py [--write]
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
                if isinstance(sc, dict) and isinstance(sc.get("code"), str) and '"max_retries":6' in sc["code"]:
                    assert re.search(r"retry\.max_retries", sc["code"]), name + " " + o["id"] + ": carries the constant without using it"
                    assert sc["code"].count('"max_retries":6') == 1, name + " " + o["id"]
                    sc["code"] = sc["code"].replace('"max_retries":6', '"max_retries":20')
                    changed.append(o["id"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    assert len(changed) == want, "%s: %d nodes changed, %d expected" % (name, len(changed), want)
    out = render(doc)
    assert out.count('"max_retries":6') == 0 and '\\"max_retries\\":6' not in out
    print("%s: max_retries 6 -> 20 in %s" % (name, changed))
    if "--write" in sys.argv:
        open(p, "w", encoding="utf-8").write(out)
print("written" if "--write" in sys.argv else "ok (dry): pass --write")
