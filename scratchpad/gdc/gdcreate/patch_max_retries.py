"""patch_max_retries.py: GD Created V2 - a job may retry 6 times instead of 3 (user 2026-10-23: LSH's GD-2610-1086 / 1087 completed
on attempt 3 of 3 under lock contention on a busy item; a 4th conflict fails the job, GD_TRANSIENT_RETRIES_EXHAUSTED, and the
user has to save again). GDC.retry.max_retries 3 -> 6 in every node that decides with it: GD_BULK_COMMIT (the P3 decisions
before / after the inventory call), GD_ASYNC_WORKER (pick, claim, exhaustion) and GD_JOB_RECONCILE. Backoff unchanged:
min(30 s, 2 s * 2^n) = 2, 4, 8, 16, 30, 30 s. GD_PICKING_OUTBOX_CONSUMER carries the constant but never reads it: untouched.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_max_retries.py [--write]
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
                if isinstance(sc, dict) and isinstance(sc.get("code"), str) and '"max_retries":3' in sc["code"]:
                    assert re.search(r"retry\.max_retries", sc["code"]), name + " " + o["id"] + ": carries the constant without using it"
                    assert sc["code"].count('"max_retries":3') == 1, name + " " + o["id"]
                    sc["code"] = sc["code"].replace('"max_retries":3', '"max_retries":6')
                    changed.append(o["id"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    assert len(changed) == want, "%s: %d nodes changed, %d expected" % (name, len(changed), want)
    out = render(doc)
    assert out.count('"max_retries":3') == 0 and '\\"max_retries\\":3' not in out
    print("%s: max_retries 3 -> 6 in %s" % (name, changed))
    if "--write" in sys.argv:
        open(p, "w", encoding="utf-8").write(out)
print("written" if "--write" in sys.argv else "ok (dry): pass --write")
