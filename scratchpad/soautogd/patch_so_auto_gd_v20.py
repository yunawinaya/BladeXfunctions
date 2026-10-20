"""patch_so_auto_gd_v20.py [--write]: SO_AUTO_GD v19 -> v20. The V2 plan routes a delivery to the classic save on
GD_ASYNC_SUBMIT's own V2 fit (scratchpad/gdc/gdcreate/v2fit.py: item master flags, handling-unit stock, pending
reservations), copied verbatim, instead of v19's handling-unit / pending checks alone: sql_v2facts reads the fit's facts,
code_v2plan runs gdV2Fit, code_summary tells the user to convert again when SUBMIT answers GD_V2_USE_CLASSIC (a race).
Dry run unless --write."""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "gdc", "gdcreate"))
import v2fit  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
WF = R + "Goods Delivery/SOconvertGDCreatedWorkflow.json"
FORM = R + "Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js"
CODE = os.path.join(HERE, "code")
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

raw = open(WF, encoding="utf8").read()
d = json.loads(raw)


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


def keys(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("key"), str):
            out.add(o["key"])
        for v in o.values():
            keys(v, out)
    elif isinstance(o, list):
        for v in o:
            keys(v, out)
    return out


plan = find(d, "code_v2plan")
facts = find(d, "sql_v2facts")
summ = find(d, "code_summary")
assert plan and facts and summ, "not the v19 base"
assert "huMaterial" in plan["data"]["script"]["code"] and "gdV2Fit" not in plan["data"]["script"]["code"], "not the v19 plan"
taken = keys(d, set())

# 1. the fit read: v19's HU / PEND parts + SETUP and ITEM, the same text GD_ASYNC_SUBMIT runs (no tenant filter here)
facts["data"]["script"]["code"] = v2fit.fit_sql("{{node:code_v2ids.data.orgSql}}", "{{node:code_v2ids.data.plantSql}}", "{{node:code_gate.data.materialIdCsv}}",
                                                "{{node:code_gate.data.materialIdCsv}}", "{{node:code_v2ids.data.soLineIdsSql}}")
for f in ("title", "nodeName", "name"):
    facts["data"][f] = "V2 Facts: Picking Mode, Item Flags, Handling-Unit Items, Pending SO Lines (GD_ASYNC_SUBMIT's V2 fit)"
rj = facts["data"]["response_json"]
assert [r["name"] for r in rj] == ["kind", "id"]
for c in v2fit.COLUMNS[2:]:
    k = "s2gc_v2f_" + c
    assert k not in taken, k
    rj.append(dict(copy.deepcopy(rj[0]), key=k, name=c, title=c))

# 2. the plan: the form's functions + the fit library, verbatim
form = open(FORM, encoding="utf8").read()


def extract(name):
    start = form.index("const %s = function %s(" % (name, name))
    return form[start:form.index("\n};\n", start) + 4]


uxc = json.loads(re.search(r"^const UXC = (\{.*\});$", form, re.M).group(1))
funcs = "const UXC = " + json.dumps({"header_fields": uxc["header_fields"]}) + ";\n" + "".join(extract(n) for n in ("gdV2Dec", "gdV2Route", "gdV2LineCount", "gdV2Payload"))
code = open(os.path.join(CODE, "plan.js"), encoding="utf8").read()
assert code.count("@@GDV2_FUNCTIONS@@\n") == 1 and code.count("@@GDV2_FIT@@\n") == 1
plan["data"]["script"]["code"] = code.replace("@@GDV2_FUNCTIONS@@\n", funcs).replace("@@GDV2_FIT@@\n", v2fit.lib())

# 3. the summary: convert again after a GD_V2_USE_CLASSIC answer
summ["data"]["script"]["code"] = open(os.path.join(CODE, "summary.js"), encoding="utf8").read()

out = subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(d, ensure_ascii=False), capture_output=True, text=True, check=True).stdout
print("SO_AUTO_GD v20: %d chars (v19 %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(WF, "w", encoding="utf8").write(out)
    print("wrote", WF)
