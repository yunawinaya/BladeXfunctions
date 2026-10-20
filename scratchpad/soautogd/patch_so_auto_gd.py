"""patch_so_auto_gd.py [--write]: SO_AUTO_GD v17 -> v18. With the new `v2` input = "1", each delivery the GD form's own V2
route accepts goes to GD Created V2 (GD_ASYNC_SUBMIT, CREATE_GD_FROM_FORM) instead of the classic GOODS_DELIVERY save, whose
per-line child runs (GLOBAL_ALLOCATION + SUBTRACT/ADD_INVENTORY_NEW) took dev down on a 500-line SO (10-20). The rest stays
classic. New: code_v2plan (form functions copied verbatim from gdV2_onClick_save_as_created.js), if_v2route in the loop
(wf_v2submit + code_collect_v2 + set_results_v2), queued / queuedCount on the summary. Dry run unless --write."""
import copy
import json
import os
import re
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
WF = R + "Goods Delivery/SOconvertGDCreatedWorkflow.json"
FORM = R + "Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js"
CODE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "code")
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
SUBMIT = ("GD_ASYNC_SUBMIT", "2105133540498116609")

d = json.load(open(WF, encoding="utf8"))


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


def keys_and_ids(o, ks, ids):
    if isinstance(o, dict):
        if isinstance(o.get("key"), str):
            ks.add(o["key"])
        for k in ("id", "parentId"):
            if isinstance(o.get(k), int):
                ids.add(o[k])
        for v in o.values():
            keys_and_ids(v, ks, ids)
    elif isinstance(o, list):
        for v in o:
            keys_and_ids(v, ks, ids)


taken_keys, taken_ids = set(), set()
keys_and_ids(d, taken_keys, taken_ids)
_next = [1799200000001]


def nid():
    while _next[0] in taken_ids:
        _next[0] += 1
    taken_ids.add(_next[0])
    return _next[0]


def key(k):
    assert k not in taken_keys, k
    taken_keys.add(k)
    return k


loop = find(d, "loop_payloads")
assert [b["id"] for b in loop["blocks"]] == ["get_results", "wf_gd_head", "code_collect", "set_results"], "not the v17 base"
assert not find(d, "code_v2plan")

# 1. the v2 input
cb = next(p for p in d["request_json"] if p["name"] == "created_by")
v2 = dict(copy.deepcopy(cb), key=key("s2gc_req_v2"), name="v2", title="V2", value="workflowparams.v2", label="V2")
d["request_json"].append(v2)

# 2. code_v2plan after code_unique: the form's functions verbatim
form = open(FORM, encoding="utf8").read()


def extract(name):
    start = form.index("const %s = function %s(" % (name, name))
    return form[start:form.index("\n};\n", start) + 4]


uxc = json.loads(re.search(r"^const UXC = (\{.*\});$", form, re.M).group(1))
funcs = "const UXC = " + json.dumps({"header_fields": uxc["header_fields"]}) + ";\n" + "".join(extract(n) for n in ("gdV2Dec", "gdV2Route", "gdV2LineCount", "gdV2Payload"))
plan_code = open(os.path.join(CODE, "plan.js"), encoding="utf8").read().replace("@@GDV2_FUNCTIONS@@\n", funcs)
uniq = find(d, "code_unique")
plan = copy.deepcopy(uniq)
plan["id"] = "code_v2plan"
for f in ("title", "nodeName", "name"):
    plan["data"][f] = "V2 Plan: GD Created V2 or Classic per Delivery"
plan["data"]["script"]["code"] = plan_code
shape = uniq["data"]["response_json"][0]
plan["data"]["response_json"] = [dict(copy.deepcopy(shape), key=key(k), name=n, title=n, bsonType=t)
                                 for k, n, t in (("s2gc_v2_payloads", "payloads", "any"), ("s2gc_v2_blocked", "blocked", "any"),
                                                 ("s2gc_v2_count", "v2Count", "int"), ("s2gc_v2_classic", "classicCount", "int"))]
# the facts V2's own refusals depend on (handling units, pending reservations), read only when V2 is on
ids2 = copy.deepcopy(uniq)
ids2["id"] = "code_v2ids"
for f in ("title", "nodeName", "name"):
    ids2["data"][f] = "V2 Facts Input: Ids for V2's Own Refusals"
ids2["data"]["script"]["code"] = open(os.path.join(CODE, "v2ids.js"), encoding="utf8").read()
ids2["data"]["response_json"] = [dict(copy.deepcopy(shape), key=key(k), name=n, title=n, bsonType=t)
                                 for k, n, t in (("s2gc_v2ids_run", "run", "int"), ("s2gc_v2ids_org", "orgSql", "string"),
                                                 ("s2gc_v2ids_plant", "plantSql", "string"), ("s2gc_v2ids_lines", "soLineIdsSql", "string"))]
items_node = find(d, "sql_node_Items")
facts = copy.deepcopy(items_node)
facts["id"] = "sql_v2facts"
for f in ("title", "nodeName", "name"):
    facts["data"][f] = "V2 Facts: Handling-Unit Items and Pending SO Lines"
facts["data"]["script"]["code"] = open(os.path.join(CODE, "v2facts.sql"), encoding="utf8").read().rstrip("\n")
ishape = items_node["data"]["response_json"][0]
facts["data"]["response_json"] = [dict(copy.deepcopy(ishape), key=key(k), name=n, title=n) for k, n in (("s2gc_v2f_kind", "kind"), ("s2gc_v2f_id", "id"))]
facts_if = {"id": "if_v2facts", "type": "if",
            "data": {"title": "IF V2 On", "isValidator": True, "nodeName": "IF V2 On", "name": "IF V2 On", "condition_type": "Expression",
                     "filter": {"list": [{"id": nid(), "parentId": nid(), "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "",
                                          "type": "leaf", "level": 1}]},
                     "expression": {"type": "javascript", "code": "'{{node:code_v2ids.data.run}}' == '1'"}},
            "blocks": [{"id": "if_v2facts_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": [facts]},
                       {"id": "if_v2facts_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}
top = d["nodes"]
at = next(i for i, n in enumerate(top) if n["id"] == "code_unique") + 1
top[at:at] = [ids2, facts_if, plan]
loop["data"]["loopSeletVar"]["code"] = "{{node:code_v2plan.data.payloads}}"

# 3. the V2 branch: submit, collect, cache
head = find(d, "wf_gd_head")
sub = copy.deepcopy(head)
sub["id"] = "wf_v2submit"
for f in ("title", "nodeName", "name"):
    sub["data"][f] = "Submit to GD Created V2 (GD_ASYNC_SUBMIT)"
sub["data"]["workflow"]["source"] = "%s:Workflow:%s" % SUBMIT
sub["data"]["workflow"]["rules"]["collectionId"] = SUBMIT[1]
for leaf in sub["data"]["workflow"]["rules"]["list"]:
    leaf["id"], leaf["parentId"] = nid(), nid()
pshape = head["data"]["body_params"]["list"][0]
sub["data"]["body_params"]["list"] = [dict(copy.deepcopy(pshape), prop=p, propLabel=p, value=v) for p, v in (
    ("organization_id", "{{workflowparams:organization_id}}"), ("plant_id", "{{node:loop_payloads.v2Plant}}"),
    ("idempotency_key", "{{node:loop_payloads.v2Key}}"), ("payload", "{{node:loop_payloads.v2Payload}}"))]
col = copy.deepcopy(find(d, "code_collect"))
col["id"] = "code_collect_v2"
for f in ("title", "nodeName", "name"):
    col["data"][f] = "Collect V2 Submit Result"
col["data"]["script"]["code"] = open(os.path.join(CODE, "collect_v2.js"), encoding="utf8").read()
col["data"]["response_json"][0]["key"] = key("s2gc_results_v2")
setr = copy.deepcopy(find(d, "set_results"))
setr["id"] = "set_results_v2"
setr["data"]["custom_wkbocgni"]["code"] = "{{node:code_collect_v2.data.results}}"
cond = {"id": "if_v2route", "type": "if",
        "data": {"title": "IF Route V2", "isValidator": True, "nodeName": "IF Route V2", "name": "IF Route V2", "condition_type": "Expression",
                 "filter": {"list": [{"id": nid(), "parentId": nid(), "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "",
                                      "type": "leaf", "level": 1}]},
                 "expression": {"type": "javascript", "code": "'{{node:loop_payloads.route}}' == 'V2'"}},
        "blocks": [{"id": "if_v2route_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": [sub, col, setr]},
                   {"id": "if_v2route_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": loop["blocks"][1:]}]}
loop["blocks"] = [loop["blocks"][0], cond]

# 4. the summary: queued / queuedCount
summ = find(d, "code_summary")["data"]
summ["script"]["code"] = open(os.path.join(CODE, "summary.js"), encoding="utf8").read()
rj = summ["response_json"]
rj.insert(next(i for i, r in enumerate(rj) if r["name"] == "blocked") + 1,
          dict(copy.deepcopy(next(r for r in rj if r["name"] == "created")), key=key("s2gc_sum_queued"), name="queued", title="queued"))
rj.append(dict(copy.deepcopy(next(r for r in rj if r["name"] == "createdCount")), key=key("s2gc_sum_queuedcount"), name="queuedCount", title="queuedCount"))
ret = find(d, "ret_summary")["data"]["response_value"]["list"]
cshape = next(r for r in ret if r["prop"] == "created")
ret.insert(next(i for i, r in enumerate(ret) if r["prop"] == "blocked") + 1,
           dict(copy.deepcopy(cshape), prop="queued", propLabel="queued", value="{{node:code_summary.data.queued}}"))
ret.append(dict(copy.deepcopy(cshape), prop="queuedCount", propLabel="queuedCount", value="{{node:code_summary.data.queuedCount}}"))
wr = d["response_json"]
wr.insert(next(i for i, r in enumerate(wr) if r["name"] == "blocked") + 1,
          dict(copy.deepcopy(next(r for r in wr if r["name"] == "created")), key=key("s2gc_res_queued"), name="queued", title="queued"))
wr.append(dict(copy.deepcopy(next(r for r in wr if r["name"] == "createdCount")), key=key("s2gc_res_queuedcount"), name="queuedCount", title="queuedCount"))

out = subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(d, ensure_ascii=False), capture_output=True, text=True, check=True).stdout
print("SO_AUTO_GD v18: %d chars (v17 %d)" % (len(out), len(open(WF, encoding="utf8").read())))
if "--write" in sys.argv:
    open(WF, "w", encoding="utf8").write(out)
    print("wrote", WF)
