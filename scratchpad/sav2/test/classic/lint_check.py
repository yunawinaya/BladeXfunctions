"""(c) Lint of both guarded classics: scratchpad/validate.py must report exactly the base's findings (all informational
CONDITIONAL, pre-existing) and nothing about a guard node; scratchpad/check_wf_js.py (node --check of every script / msg / if
expression) must be clean; plus the platform rules validate.py does not check, on the guard nodes: response_json declares
exactly the returned keys, no quoted placeholder in a code node, MVEL-only if expressions, non-empty true block, SQL starts with
SELECT / no SET / lines <= 160 / quoted tenant + bare digit ids, reads only stock_adjustment, refusal codes 400 (never 401).
usage: python3 test/classic/lint_check.py"""
import contextlib
import io
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True  # no __pycache__ next to the builders

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(os.path.dirname(HERE))
SCRATCH = os.path.dirname(SAV2)
sys.path.insert(0, SAV2)
sys.path.insert(0, SCRATCH)
import build_classic as B  # noqa: E402
import validate  # noqa: E402

fails = []


def ok(label, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + label + ("" if cond else "  " + str(extra)[:600]))
    if not cond:
        fails.append(label)


def findings(path):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        validate.check(path)
    return sorted(l.strip() for l in buf.getvalue().split("\n") if l.startswith("  "))


for name in ("STOCK_ADJUSTMENT", "STOCK_COUNT"):
    out_path = os.path.join(B.OUT_DIRS[name], name + ".json")
    got, want = findings(out_path), findings(B.BASE[name][0])
    ok("%s: validate.py findings == the base's (%d, all CONDITIONAL)" % (name, len(want)), got == want and all(f.startswith("CONDITIONAL") for f in got),
       sorted(set(got) ^ set(want)))
    ok("%s: no finding names a guard node" % name, not any(g in f for f in got for g in B.GUARD_IDS[name]))
    r = subprocess.run([sys.executable, os.path.join(SCRATCH, "check_wf_js.py"), out_path], capture_output=True, text=True)
    ok("%s: check_wf_js.py (node --check of scripts / msg / MVEL) clean" % name, r.returncode == 0, r.stdout[-600:])

    doc = json.load(open(out_path, encoding="utf-8"))
    nodes = {k: v for k, v in B.index(doc).items() if k in B.GUARD_IDS[name]}
    for nid, n in nodes.items():
        d = n["data"]
        if n["type"] == "code-node":
            body = d["script"]["code"]
            keys = validate.returned_keys(body)
            ok("%s %s: response_json == returned keys %s" % (name, nid, keys), keys is not None and sorted(keys) == sorted(r["name"] for r in d["response_json"]))
            ok("%s %s: no quoted placeholder" % (name, nid), not re.search(r"['\"`]\{\{", body))
            ok("%s %s: placeholders only allData / saveAs / createAdjustment (SC) / tenantId / own nodes" % (name, nid),
               set(re.findall(r"\{\{([^}]+)\}\}", body)) <= {"workflowparams:allData", "workflowparams:saveAs", "workflowparams:createAdjustment", "system:tenantId",
                                                             "node:sql_node_SAguard.data", "node:code_node_SAguard.data",
                                                             "node:sql_node_SCguard.data", "node:code_node_SCguard.data"})
        elif n["type"] == "sql-node":
            sql = d["script"]["code"]
            ok("%s %s: SELECT, no SET, lines <= 160" % (name, nid), re.match(r"\s*SELECT\b", sql) and not re.search(r"(?i)\bset\b", sql)
               and max(len(l) for l in sql.split("\n")) <= 160)
            phs = re.findall(r"('?)\{\{node:([^}]+)\}\}('?)", sql)
            ok("%s %s: tenantId hand-quoted, ids bare (digits from the guard node)" % (name, nid),
               all((q1, q2) == ("'", "'") if p.endswith(".tenantId") else (q1, q2) == ("", "") and re.search(r"\.(saId|scId)$", p) for q1, p, q2 in phs))
            tables = set(re.findall(r"(?i)\b(?:from|join)\s+([a-z0-9_]+)", sql))
            ok("%s %s: reads only stock_adjustment (never gd_async_job)" % (name, nid), tables == {"stock_adjustment"}, tables)
            ok("%s %s: tenant-scoped + is_deleted = 0" % (name, nid), "g.tenant_id = '" in sql and "g.is_deleted = 0" in sql)
        elif n["type"] == "if":
            expr = (d.get("expression") or {}).get("code") or ""
            ok("%s %s: MVEL only (no === / !==)" % (name, nid), "===" not in expr and "!==" not in expr)
            ok("%s %s: true block non-empty, false block empty" % (name, nid), len(n["blocks"][0]["blocks"]) == 1 and n["blocks"][1]["blocks"] == [])
        elif n["type"] == "return-node":
            lst = d["response_value"]["list"]
            ok("%s %s: status 200, { code \"400\" (value), message (field) }" % (name, nid),
               d["status_code"] == 200 and [(p["prop"], p["valueType"], p["value"]) for p in lst][0] == ("code", "value", "400") and lst[1]["valueType"] == "field")
        elif n["type"] == "end-node":
            ok("%s %s: back_data_type Default, code 400 (never 401), msg from the verdict" % (name, nid),
               d["back_data_type"] == "Default" and d["code"] == 400 and d["msg"]["code"] == "{{node:code_node_SCguardVerdict.data.message}}")
    ok("%s: no 401 anywhere in the guard nodes" % name, "401" not in json.dumps(list(nodes.values())))

print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
