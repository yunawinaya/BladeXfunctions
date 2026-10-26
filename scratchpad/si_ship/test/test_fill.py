"""test_fill.py: offline check of the SI Shipping Method / Vehicle Number fill (read-only on dev, nothing runs on the platform).

Each converter's Map SI Data node (and SO_SAVE's auto-SI one) is run in node twice on the same dev data: the live version
(base/) and the patched one (out/, or out/prod/ with --prod). Its sql-node inputs come from the node's own SQL, filled the way
the workflow fills it; SO_SAVE's get-node input is the platform's own read (sudu-lowcode data query). Pass = the SI payloads are
identical except si_shipping_method / si_vehicle_number, which equal the source document's di_shipping_method / di_vehicle_number.

  python3 scratchpad/si_ship/test/test_fill.py [--prod]
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHIP = os.path.dirname(HERE)
R = os.path.abspath(os.path.join(SHIP, "..", ".."))
PROD = "--prod" in sys.argv
TENANT = "000000"
GD = "2095877730484424705"                            # GD/20260904/508: both fields set
SO_A, SO_B = "2107395955356266497", "2105910151874023426"  # SO/20261006-009, SO/20261002-006: different vehicles
BASES = {
    "GD_Convert_SI": ("prod/GD_Convert_SI.prod_v26.json" if PROD else "GD_Convert_SI.dev_v29.json"),
    "SO_Convert_SI": ("prod/SO_Convert_SI.prod_v38.json" if PROD else "SO_Convert_SI.dev_v58.json"),
    "SO_SAVE": ("prod/SO_SAVE.prod_v88.json" if PROD else "SO_SAVE.dev_v172.json"),
}
NEW = ("si_shipping_method", "si_vehicle_number")


def wf(path):
    return json.load(open(os.path.join(SHIP, path)))


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
    walk(doc["nodes"])
    return found[0]["data"]["script"]["code"]


def sql(text, **vals):
    def sub(m):
        key = m.group(1).split(".")[-1]
        return vals[key]
    text = re.sub(r"\{\{node:([^}]+)\}\}", sub, text)
    out = subprocess.run([os.path.join(R, ".dbtools", "db"), "--dev", "--json", text], capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr[-800:])
    return json.loads(out.stdout[out.stdout.find("["):])


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
    """old / new: lists of SI payloads; expect: per payload, the (shipping, vehicle) the source document holds"""
    ok = len(old) == len(new) == len(expect)
    for o, n, (ship, veh) in zip(old, new, expect):
        extra = {k: n.get(k) for k in NEW}
        # the invoice date is the run's own clock (to the second), so two runs can differ there
        rest_n = {k: v for k, v in n.items() if k not in NEW + ("sales_invoice_date",)}
        rest_o = {k: v for k, v in o.items() if k != "sales_invoice_date"}
        same = json.dumps(rest_o, sort_keys=True) == json.dumps(rest_n, sort_keys=True)
        if not same:
            print("    differs at:", sorted(k for k in set(rest_o) | set(rest_n) if json.dumps(rest_o.get(k)) != json.dumps(rest_n.get(k))))
        hit = str(extra["si_shipping_method"]) == str(ship) and str(extra["si_vehicle_number"]) == str(veh)
        ok = ok and same and hit and not any(k in o for k in NEW)
        print(f"  {name:<34} {n.get('so_no_display') or ''} {n.get('gd_no_display') or ''}: rest identical={same}  {extra}  expected=({ship}, {veh})")
    return ok


def source_vals(table, ids):
    rows = sql(f"SELECT CAST(id AS CHAR) id, di_shipping_method s, CAST(di_vehicle_number AS CHAR) v FROM {table} WHERE id IN ({ids}) ORDER BY id")
    return {r["id"]: (r["s"], r["v"]) for r in rows}


def gd_convert():
    base, out = wf("base/" + BASES["GD_Convert_SI"]), wf(("out/prod/" if PROD else "out/") + "GD_Convert_SI.json")
    reads = {}
    for doc in (base, out):
        heads = sql(code(doc, "sql_node_gdcvHeads"), idsSql=GD, tenantId=TENANT)
        so_ids = run_js(code(doc, "code_node_42o2wYvS"), {"{{node:sql_node_gdcvHeads.data}}": heads})["soIdsSql"]
        reads[id(doc)] = {
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
    old = run_js(code(base, "code_node_sQX9tldw"), reads[id(base)])["siList"]
    new = run_js(code(out, "code_node_sQX9tldw"), reads[id(out)])["siList"]
    return compare("GD_Convert_SI single", old, new, [source_vals("goods_delivery", GD)[GD]])


def so_convert():
    base, out = wf("base/" + BASES["SO_Convert_SI"]), wf(("out/prod/" if PROD else "out/") + "SO_Convert_SI.json")
    ids = f"{SO_A},{SO_B}"
    vals = source_vals("sales_order", ids)
    ok = True
    for mode in ("multiple", "single"):
        res = []
        for doc in (base, out):
            subs = {
                "{{node:sql_node_socvDone.data}}": sql(code(doc, "sql_node_socvDone"), idsSql=ids, tenantId=TENANT),
                "{{node:sql_node_socvLines.data}}": sql(code(doc, "sql_node_socvLines"), idsSql=ids, tenantId=TENANT),
                "{{node:get_node_yDMG0Sab.data.data}}": {"id": "1"},
                "{{node:get_node_srSetup1.data.data}}": None,
                "{{workflowparams:is_multiple}}": mode,
                "{{workflowparams:convert_to}}": "draft",
                "{{workflowparams:auto_pi}}": "",
                "{{workflowparams:plant_id}}": "",
            }
            res.append(run_js(code(doc, "code_node_sQX9tldw"), subs)["siList"])
        # single = one SI headed by the first SO in id order; multiple = one SI per SO, in id order
        order = sorted(vals)
        expect = [vals[i] for i in order] if mode == "multiple" else [vals[order[0]]]
        ok = compare(f"SO_Convert_SI {mode}", res[0], res[1], expect) and ok
    return ok


def so_save():
    base, out = wf("base/" + BASES["SO_SAVE"]), wf(("out/prod/" if PROD else "out/") + "SO_SAVE.json")
    scratch = os.environ.get("SCRATCH") or "/tmp"
    q = subprocess.run(["sudu-lowcode", "--full", "data", "query", "sales_order", "--where", json.dumps({"id": SO_A}), "--limit", "1",
                        "--format", "json"], capture_output=True, text=True, cwd=scratch)
    text = q.stdout
    doc = json.loads(text[text.find("{"):])
    rows = doc["data"]["rows"]
    assert rows and str(rows[0].get("id")) == SO_A, str(doc)[:500]
    subs = {"{{node:get_node_NCJ7taxf.data.data}}": rows[0], "{{node:get_node_jBUPqNPW.data.data}}": {"id": "1"}}
    old = run_js(code(base, "code_node_CVVyuAj3"), subs)["siData"]
    new = run_js(code(out, "code_node_CVVyuAj3"), subs)["siData"]
    old, new = (old if isinstance(old, list) else [old]), (new if isinstance(new, list) else [new])
    return compare("SO_SAVE auto SI", old, new, [source_vals("sales_order", SO_A)[SO_A]] * len(new))


if __name__ == "__main__":
    print("PROD builds" if PROD else "DEV builds")
    results = [gd_convert(), so_convert(), so_save()]
    print("PASS" if all(results) else "FAIL")
    sys.exit(0 if all(results) else 1)
