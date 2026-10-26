"""test_si_fill.py: the SI header custom fields from the converters (and SO_SAVE's automatic SI), read-only on DEV.

Each node is run in node twice on the same dev documents: the live version (base/<env>/) and the patched one (out/<env>/).
Its sql-node inputs come from that version's own SQL, filled the way the workflow fills it, so the patched id -> name SQL
really runs. Pass = the SI payloads are identical except custom_fields_h35azf2l, which equals the FIRST source document's
header custom fields by field name (false kept; a first document without values gives {}).
Modelled on scratchpad/si_ship/test/test_fill.py (bladexfunctions-22).

Dev test documents (tenant 000000, values written 2026-10-27):
  SO/20261006-009 2107395955356266497 {lsh_envelope: true,  lsh_restday: "Sun"}
  SO/20261002-006 2105910151874023426 {lsh_envelope: false, lsh_resthour: "12-1"}
  SO/20261002-005 2105905812508454914 {}  (same customer as -006, lower id)
  GD/20260904/508 2095877730484424705 {lsh_envelope: true,  lsh_receivehour: "8-5"}

  python3 scratchpad/salescf/test/test_si_fill.py [--prod] [gd|so|so_save ...]
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
R = os.path.abspath(os.path.join(PROJ, "..", ".."))
ENV = "prod" if "--prod" in sys.argv else "dev"
ONLY = [a for a in sys.argv[1:] if not a.startswith("--")]
TENANT = "000000"
GD = "2095877730484424705"
SO_A, SO_B, SO_EMPTY = "2107395955356266497", "2105910151874023426", "2105905812508454914"
NEW = "custom_fields_h35azf2l"
WANT = {
    SO_A: {"lsh_envelope": True, "lsh_restday": "Sun"},
    SO_B: {"lsh_envelope": False, "lsh_resthour": "12-1"},
    SO_EMPTY: {},
    GD: {"lsh_envelope": True, "lsh_receivehour": "8-5"},
}


def wf(kind, name):
    return json.loads(open(os.path.join(PROJ, kind, ENV, name + ".json"), encoding="utf-8").read())


def code(doc, nid):
    found = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("id") == nid:
                found.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    assert found, "no node " + nid
    return found[0]["data"]["script"]["code"]


def db(text):
    out = subprocess.run([os.path.join(R, ".dbtools", "db"), "--dev", "--json", text], capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr[-800:])
    return json.loads(out.stdout[out.stdout.find("\n[") + 1:] if out.stdout.startswith("[DEV]") else out.stdout)


def sql(text, **vals):
    return db(re.sub(r"\{\{node:([^}]+)\}\}", lambda m: vals[m.group(1).split(".")[-1]], text))


def run_js(body, subs):
    for k, v in subs.items():
        body = body.replace(k, json.dumps(v))
    left = re.findall(r"\{\{[^}]+\}\}", body)
    assert not left, left
    prog = "const f = async function () {\n" + body + "\n};\nf().then((r) => process.stdout.write(JSON.stringify(r)));"
    out = subprocess.run(["node", "-e", prog], capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr[-1500:])
    return json.loads(out.stdout)


def compare(name, old, new, expect):
    ok = len(old) == len(new) == len(expect)
    for o, n, want in zip(old, new, expect):
        rest_n = {k: v for k, v in n.items() if k not in (NEW, "sales_invoice_date")}
        rest_o = {k: v for k, v in o.items() if k != "sales_invoice_date"}
        same = json.dumps(rest_o, sort_keys=True) == json.dumps(rest_n, sort_keys=True)
        if not same:
            print("    differs at:", sorted(k for k in set(rest_o) | set(rest_n) if json.dumps(rest_o.get(k)) != json.dumps(rest_n.get(k))))
        got = n.get(NEW)
        hit = json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True)
        ok = ok and same and hit and NEW not in o
        print("  %-30s %s %s: rest identical=%s  %s=%s  expected=%s" % (name, n.get("so_no_display") or "", n.get("gd_no_display") or "",
                                                                       same, NEW, json.dumps(got), json.dumps(want)))
    return ok


def gd_convert():
    docs = {k: wf(k, "GD_Convert_SI") for k in ("base", "out")}
    res = {}
    for k, doc in docs.items():
        heads = sql(code(doc, "sql_node_gdcvHeads"), idsSql=GD, tenantId=TENANT)
        so_ids = run_js(code(doc, "code_node_42o2wYvS"), {"{{node:sql_node_gdcvHeads.data}}": heads})["soIdsSql"]
        subs = {
            "{{node:sql_node_gdcvDone.data}}": sql(code(doc, "sql_node_gdcvDone"), idsSql=GD, tenantId=TENANT),
            "{{node:sql_node_gdcvLines.data}}": sql(code(doc, "sql_node_gdcvLines"), idsSql=GD, tenantId=TENANT),
            "{{node:sql_node_gdcvSoHeads.data}}": sql(code(doc, "sql_node_gdcvSoHeads"), soIdsSql=so_ids, tenantId=TENANT),
            "{{node:sql_node_gdcvSoLines.data}}": sql(code(doc, "sql_node_gdcvSoLines"), idsSql=GD, tenantId=TENANT),
            "{{node:get_node_yDMG0Sab.data.data}}": {"id": "1"},
            "{{node:get_node_srSetup1.data.data}}": None,
            "{{workflowparams:is_multiple}}": "single",
            "{{workflowparams:convert_to}}": "draft",
            "{{workflowparams:source}}": "convert",
            "{{workflowparams:auto_pi}}": "",
        }
        res[k] = run_js(code(doc, "code_node_sQX9tldw"), subs)["siList"]
    return compare("GD_Convert_SI single", res["base"], res["out"], [WANT[GD]])


def so_convert(ids, mode):
    docs = {k: wf(k, "SO_Convert_SI") for k in ("base", "out")}
    res = {}
    for k, doc in docs.items():
        csv = ",".join(ids)
        subs = {
            "{{node:sql_node_socvDone.data}}": sql(code(doc, "sql_node_socvDone"), idsSql=csv, tenantId=TENANT),
            "{{node:sql_node_socvLines.data}}": sql(code(doc, "sql_node_socvLines"), idsSql=csv, tenantId=TENANT),
            "{{node:get_node_yDMG0Sab.data.data}}": {"id": "1"},
            "{{node:get_node_srSetup1.data.data}}": None,
            "{{workflowparams:is_multiple}}": mode,
            "{{workflowparams:convert_to}}": "draft",
            "{{workflowparams:auto_pi}}": "",
            "{{workflowparams:plant_id}}": "",
        }
        res[k] = run_js(code(doc, "code_node_sQX9tldw"), subs)["siList"]
    order = sorted(ids)  # single = one SI headed by the first SO in id order; multiple = one SI per SO, in id order
    expect = [WANT[i] for i in order] if mode == "multiple" else [WANT[order[0]]]
    return compare("SO_Convert_SI %s" % mode, res["base"], res["out"], expect)


def platform_read_so(so_id):
    """the SO as SO_SAVE's get-node sees it: the platform's own read (sudu-lowcode data query), which turns the stored
    definition ids into field names"""
    cwd = os.environ.get("SCRATCH") or "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/454339d2-8350-4882-9cef-f4897bdedf89/scratchpad"
    q = subprocess.run(["sudu-lowcode", "--full", "data", "query", "sales_order", "--where", json.dumps({"id": so_id}), "--limit", "1",
                        "--format", "json"], capture_output=True, text=True, cwd=cwd)
    doc = json.loads(q.stdout[q.stdout.find("{"):])
    rows = doc["data"]["rows"]
    assert rows and str(rows[0].get("id")) == so_id, str(doc)[:500]
    return rows[0]


def so_save():
    docs = {k: wf(k, "SO_SAVE") for k in ("base", "out")}
    ok = True
    for so in (SO_A, SO_B, SO_EMPTY):
        row = platform_read_so(so)
        read = row.get("custom_fields_m07krnod")
        read = json.loads(read) if isinstance(read, str) else (read or {})
        names = json.dumps(read, sort_keys=True) == json.dumps(WANT[so], sort_keys=True)
        print("  platform read %s custom_fields_m07krnod=%s by name: %s" % (so, json.dumps(read), names))
        subs = {"{{node:get_node_NCJ7taxf.data.data}}": row, "{{node:get_node_jBUPqNPW.data.data}}": {"id": "1"}}
        res = {k: run_js(code(doc, "code_node_CVVyuAj3"), subs)["siData"] for k, doc in docs.items()}
        old, new = [res["base"] if isinstance(res["base"], list) else [res["base"]], res["out"] if isinstance(res["out"], list) else [res["out"]]]
        ok = names and compare("SO_SAVE auto SI", old, new, [WANT[so]] * len(new)) and ok
    return ok


def explain_uses_primary():
    doc = wf("out", "SO_Convert_SI")
    text = re.sub(r"\{\{node:([^}]+)\}\}", lambda m: {"idsSql": SO_A, "tenantId": TENANT}[m.group(1).split(".")[-1]], code(doc, "sql_node_socvDone"))
    rows = db("EXPLAIN " + text)
    d = [r for r in rows if r.get("table") == "d"]
    ok = bool(d) and all(r.get("key") == "PRIMARY" for r in d)
    print("  EXPLAIN su_code_custom_field d:", [(r.get("type"), r.get("key")) for r in d], "OK" if ok else "FAIL")
    return ok


if __name__ == "__main__":
    print("%s builds" % ENV.upper())
    results = []
    if not ONLY or "gd" in ONLY:
        results.append(gd_convert())
    if not ONLY or "so" in ONLY:
        results += [so_convert([SO_A, SO_B], "multiple"), so_convert([SO_A, SO_B], "single"),
                    so_convert([SO_EMPTY, SO_B], "single"), explain_uses_primary()]
    if not ONLY or "so_save" in ONLY:
        results.append(so_save())
    print("PASS" if all(results) else "FAIL")
    sys.exit(0 if all(results) else 1)
