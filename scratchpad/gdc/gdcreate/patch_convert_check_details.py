"""patch_convert_check_details.py: GD_SO_CONVERT_CHECK - the asked jobs also carry error_details (the first 10 line errors and
their count, always valid JSON: PREPARE keeps up to 500, 118 KB seen on dev), so the GD form can name the lines a GD Created V2 job refused (user 2026-10-23: the form waits for PREPARE's
verdict instead of closing on "submitted"). Backward compatible: a new field in each jobs_json entry. Patched in place (keys
kept); build_convert_check.py carries the same change. Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_convert_check_details.py [--write]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r
    return None


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "error_details" not in raw, "already patched"
import re  # noqa: E402
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610232)

jobs = find(doc, "sql_node_SCjobs")["data"]
old = "       LEFT(IFNULL(j.error_message, ''), 500) AS error_message,\n"
assert jobs["script"]["code"].count(old) == 1, "jobs SQL"
jobs["script"]["code"] = jobs["script"]["code"].replace(old, old + "       IF(JSON_VALID(j.error_details), CAST(JSON_OBJECT('line_errors', IFNULL(JSON_EXTRACT(j.error_details, '$.line_errors[0 to 9]'), JSON_ARRAY()), 'line_error_count', IFNULL(JSON_LENGTH(j.error_details, '$.line_errors'), 0)) AS CHAR), '') AS error_details,\n")
names = [r["name"] for r in jobs["response_json"]]
proto = dict(jobs["response_json"][names.index("error_message")])
proto.update({"key": K.key(), "name": "error_details", "title": "error_details"})
jobs["response_json"].insert(names.index("error_message") + 1, proto)

res = find(doc, "code_node_SCresult")["data"]["script"]
old = "error_message: s(r.error_message), command: s(r.command),"
assert res["code"].count(old) == 1, "result mapping"
res["code"] = res["code"].replace(old, "error_message: s(r.error_message), error_details: s(r.error_details), command: s(r.command),")

out = render(doc)
json.loads(out)
print("GD_SO_CONVERT_CHECK + error_details: %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
