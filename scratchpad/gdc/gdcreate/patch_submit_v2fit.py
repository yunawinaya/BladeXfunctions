"""patch_submit_v2fit.py: GD_ASYNC_SUBMIT v11 -> v12. A new save (CREATE) that GD_BULK_PREPARE would refuse where the classic
save copes (item master flags, handling-unit stock, pending reservations: v2fit.py) is answered GD_V2_USE_CLASSIC before any
job is made, and the caller saves it the classic way (bladexfunctions-e1's finding, user 2026-10-20: the GD form had no
fallback once the dialog closed).

Structure: the fit plan and the fit read run as a third branch of condition_all_GSread (in parallel with the job read); after
the same sales order refusal (that one wins: a classic save of an order still saving would double it), a decision node and an
if-node answer the refusal. The repo file is rendered the way it is kept: Prettier --parser json of the compact dump.

usage: python3 patch_submit_v2fit.py [--write]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
sys.path.insert(0, HERE)
import wfkit as K  # noqa: E402
import v2fit  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
P = R + "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
RES = ["result_code", "result_message", "job_id", "job_status", "created", "idempotency_key", "payload_hash", "gd_id", "gd_no",
       "progress_message", "line_errors", "evidence"]
PLAN_OUT = ["linesJson", "tenantSql", "orgSql", "plantSql", "materialIdsSql", "autoMaterialIdsSql", "soLineIdsSql"]


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def collect(o, keys, ints):
    if isinstance(o, dict):
        if isinstance(o.get("key"), str):
            keys.add(o["key"])
        for k in ("id", "parentId"):
            if isinstance(o.get(k), int):
                ints.add(o[k])
        for v in o.values():
            collect(v, keys, ints)
    elif isinstance(o, list):
        for v in o:
            collect(v, keys, ints)


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
text = json.dumps(doc)
for nid in ("code_node_GSfitPlan", "sql_node_GSfit", "code_node_GSfit", "if_GSfit", "condition_all_GSread_item_2"):
    assert '"%s"' % nid not in text, nid + " already present"
keys, ints = set(), set()
collect(doc, keys, ints)
K._taken |= keys
K._rng.seed(20261020)

nodes = doc["nodes"]
pos = {n.get("id"): i for i, n in enumerate(nodes)}
for nid in ("condition_all_GSread", "if_GSsoBusy", "condition_or_node_t7FDaGor"):
    assert nid in pos, nid + " not at the top level"
assert pos["if_GSsoBusy"] + 1 == pos["condition_or_node_t7FDaGor"], "not the v11 order"
read = nodes[pos["condition_all_GSread"]]
assert [b["id"] for b in read["blocks"]] == ["condition_all_GSread_item_0", "condition_all_GSread_item_1"], "not the v11 read"

code = lambda f: open(os.path.join(HERE, "code", f), encoding="utf-8").read().rstrip("\n").replace("@@GDV2_FIT@@\n", v2fit.lib())
ref = lambda f: "{{node:code_node_GSfitPlan.data.%s}}" % f
sql_text = v2fit.fit_sql(ref("orgSql"), ref("plantSql"), ref("materialIdsSql"), ref("autoMaterialIdsSql"), ref("soLineIdsSql"), tenant=ref("tenantSql"))

ids = K.Ids(1798400000000)
plan = K.code("code_node_GSfitPlan", "V2 fit (plan): this save's lines, compact, and the digits-only ids of the fit read", code("fit_plan.js"), PLAN_OUT)
facts = K.sql("sql_node_GSfit", "V2 fit read: picking mode, item master flags, unpacked handling units, pending reservations of its lines", sql_text, v2fit.COLUMNS)
branch = K.parallel("x", "x", [("condition_all_GSread_item_2", "V2 fit facts", [plan, facts])])["blocks"][0]
read["blocks"].append(branch)
read["data"]["title"] = "Reads in parallel: this save's job by key + other unfinished saves of its sales orders + the V2 fit facts"
decide = K.code("code_node_GSfit", "V2 fit (decision): a new save GD_BULK_PREPARE would refuse where the classic save copes -> GD_V2_USE_CLASSIC",
                code("fit_decide.js"), ["route"] + RES)
refuse = K.if_(ids, "if_GSfit", "IF the classic save must take this delivery: answer GD_V2_USE_CLASSIC, write nothing",
               "'{{node:code_node_GSfit.data.route}}' == 'CLASSIC'",
               [K.ret("return_node_GSfit", "Return (use the classic save, nothing written)", [(f, "{{node:code_node_GSfit.data.%s}}" % f) for f in RES])])
doc["nodes"] = nodes[:pos["if_GSsoBusy"] + 1] + [decide, refuse] + nodes[pos["condition_or_node_t7FDaGor"]:]

new_keys, new_ints = set(), set()
collect({"n": [branch, decide, refuse]}, new_keys, new_ints)
assert not (new_keys & keys), "a generated key collides: %s" % (new_keys & keys)
assert not (new_ints & ints), "a generated filter id collides: %s" % (new_ints & ints)
K.check_ids(doc)
out = render(doc)
json.loads(out)
print("GD_ASYNC_SUBMIT v12: %d chars (v11 %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
