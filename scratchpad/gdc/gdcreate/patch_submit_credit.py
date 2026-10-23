"""patch_submit_credit.py: GD_ASYNC_SUBMIT - the credit limit at the click (user 2026-10-23). The GD form sends needCL "required";
a new save then runs CREDIT_LIMIT_CHECK under PREPARE's own rule (picking_setup.full_cl_check = 1, not No Accounting, a customer)
and a Block (GD_CREDIT_LIMIT_BLOCKED) or an Override (GD_CREDIT_LIMIT_OVERRIDE) is answered before any job is made; the form
alerts the Block, asks about the Override and resubmits with needCL "not required". Callers that do not send needCL (SO_AUTO_GD)
are not asked here: PREPARE's background check (Block fails the job, Override passes) stays for them and as the safety net.

Structure: after the V2 fit refusal (a delivery that goes to the classic save is credit-checked there), an ask gate, the setup
read (the fit plan's digits-only tenant / organization), the plan, CREDIT_LIMIT_CHECK as PREPARE's workflow_node_CLchk000 calls
it, the decision and its refusal. The repo file is rendered the way it is kept: Prettier --parser json of the compact dump.

usage: python3 patch_submit_credit.py [--write]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
P = R + "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
RES = ["result_code", "result_message", "job_id", "job_status", "created", "idempotency_key", "payload_hash", "gd_id", "gd_no",
       "progress_message", "line_errors", "evidence"]
CREDIT_LIMIT_CHECK = "1990247316342333442"
NEW = ("code_node_GSclAsk", "if_GSclAsk", "sql_node_GSclSetup", "code_node_GSclPlan", "if_GSclNeed", "workflow_node_GScl",
       "code_node_GSclDec", "if_GSclStop", "return_node_GScl")


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
for nid in NEW:
    assert '"%s"' % nid not in text, nid + " already present"
assert not any(p.get("name") == "needCL" for p in doc["request_json"]), "needCL already a parameter"
keys, ints = set(), set()
collect(doc, keys, ints)
K._taken |= keys
K._rng.seed(20261023)

nodes = doc["nodes"]
pos = {n.get("id"): i for i, n in enumerate(nodes)}
for nid in ("condition_all_GSread", "if_GSfit", "condition_or_node_t7FDaGor"):
    assert nid in pos, nid + " not at the top level"
assert pos["if_GSfit"] + 1 == pos["condition_or_node_t7FDaGor"], "not the v12 order"

code = lambda f: open(os.path.join(HERE, "code", f), encoding="utf-8").read().rstrip("\n")
ids = K.Ids(1798410000000)
setup_sql = ("SELECT CAST(IFNULL((SELECT p.full_cl_check FROM picking_setup p\n"
             "  WHERE p.tenant_id = '{{node:code_node_GSfitPlan.data.tenantSql}}'\n"
             "    AND p.organization_id = '{{node:code_node_GSfitPlan.data.orgSql}}'\n"
             "    AND p.is_deleted = 0\n"
             "  ORDER BY p.id LIMIT 1), 0) AS CHAR) AS full_cl_check")
call = K.call(ids, "workflow_node_GScl", "CREDIT_LIMIT_CHECK (customer, the delivery total) - as PREPARE's workflow_node_CLchk000", "CREDIT_LIMIT_CHECK",
              CREDIT_LIMIT_CHECK, [("customer_id", "{{node:code_node_GSclPlan.data.customerId}}"), ("total", "{{node:code_node_GSclPlan.data.total}}"),
                                   ("document_type", "Goods Delivery")])
for p in call["data"]["body_params"]["list"]:
    if p["prop"] == "document_type":
        p["valueType"] = "value"
new_nodes = [
    K.code("code_node_GSclAsk", "Credit check asked? The GD form's new save (needCL required)", code("cl_ask.js"), ["ask"]),
    K.if_(ids, "if_GSclAsk", "IF the GD form asks for the credit check on a new save", "'{{node:code_node_GSclAsk.data.ask}}' == 'YES'", [
        K.sql("sql_node_GSclSetup", "Credit check setup: picking_setup.full_cl_check of the organization (PREPARE's row: the first by id)", setup_sql, ["full_cl_check"]),
        K.code("code_node_GSclPlan", "Credit check plan: full_cl_check = 1, not No Accounting, a customer; the delivery total", code("cl_plan.js"),
               ["needCL", "customerId", "total", "why"]),
        K.if_(ids, "if_GSclNeed", "IF the credit limit is checked", "'{{node:code_node_GSclPlan.data.needCL}}' == 'YES'", [
            call,
            K.code("code_node_GSclDec", "Credit check decision: Block -> GD_CREDIT_LIMIT_BLOCKED, Override -> GD_CREDIT_LIMIT_OVERRIDE (the form asks)",
                   code("cl_decide.js"), ["route"] + RES),
            K.if_(ids, "if_GSclStop", "IF the credit limit blocks or needs the user's override: answer, write nothing",
                  "'{{node:code_node_GSclDec.data.route}}' == 'STOP'",
                  [K.ret("return_node_GScl", "Return (credit limit: blocked / override to confirm, nothing written)",
                         [(f, "{{node:code_node_GSclDec.data.%s}}" % f) for f in RES])]),
        ]),
    ]),
]
doc["nodes"] = nodes[:pos["if_GSfit"] + 1] + new_nodes + nodes[pos["condition_or_node_t7FDaGor"]:]
param = {"key": K.key(), "name": "needCL", "title": "needCL",
         "description": "optional: required = check the credit limit now (the GD form's new save; picking_setup.full_cl_check = 1); not required = "
                        "the user accepted the Override; empty (other callers) = PREPARE's background check only",
         "bsonType": "string", "isExpand": False, "children": []}
doc["request_json"].append(param)

new_keys, new_ints = set(), set()
collect({"n": new_nodes + [param]}, new_keys, new_ints)
assert not (new_keys & keys), "a generated key collides: %s" % (new_keys & keys)
assert not (new_ints & ints), "a generated filter id collides: %s" % (new_ints & ints)
K.check_ids(doc)
out = render(doc)
json.loads(out)
print("GD_ASYNC_SUBMIT + credit at the click: %d chars (was %d), %d new nodes" % (len(out), len(raw), len(NEW)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
