"""Phase 0 guard tests: run each new guard code body under node with sample placeholder values, and each new guard
SQL read-only on dev against real rows. Usage: python3 test_guards.py"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
from lib import find, load  # noqa: E402

PH = re.compile(r"\{\{([^}]+)\}\}")
fails = 0


def run_js(body, values):
    def rep(m):
        key = m.group(1)
        if key not in values:
            raise KeyError(key)
        return values[key]
    src = "const __f = () => {\n" + PH.sub(rep, body) + "\n};\nprocess.stdout.write(JSON.stringify(__f()));"
    r = subprocess.run(["node", "-e", src], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:500])
    return json.loads(r.stdout)


def expect(label, got, want):
    global fails
    bad = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v}
    print(("ok   " if not bad else "FAIL ") + label + ("" if not bad else "  " + json.dumps(bad)))
    fails += 1 if bad else 0


def run_sql(label, text, values, env="--dev"):
    global fails
    def rep(m):
        key = m.group(1)
        if key not in values:
            raise KeyError(key)
        return values[key]
    try:
        rows = q(env, PH.sub(rep, text))
        print("ok   %s -> %s" % (label, json.dumps(rows, ensure_ascii=False)[:300]))
        return rows
    except BaseException as e:  # noqa: BLE001
        fails += 1
        print("FAIL %s %s" % (label, str(e)[:300]))
        return None


def lines(n, children=0):
    rows = [{"line_index": i + 1} for i in range(n)]
    if children:
        rows[0]["children"] = [{"line_index": "1-%d" % (k + 1)} for k in range(children)]
    return json.dumps(rows)


def gr_save_guards():
    for rel, p in (("Goods Receiving/GRsaveWorkflow.json", "Gr"), ("Goods Receiving/GRsaveAsCreatedWorkflow.json", "Gc")):
        doc = json.loads(load(rel))
        body = find(doc, "code_node_%sSizeGuard" % p)["data"]["script"]["code"]
        base = {"workflowparams:allData.table_gr": lines(3), "workflowparams:allData.id": '"2072178648650149890"',
                "workflowparams:pageStatus": '"Edit"'}
        expect(p + " edit 3 lines", run_js(body, base), {"tooBig": "NO", "check": "YES", "grId": "2072178648650149890"})
        expect(p + " add 500 lines", run_js(body, dict(base, **{"workflowparams:allData.table_gr": lines(500),
                                                               "workflowparams:allData.id": "", "workflowparams:pageStatus": '"Add"'})),
               {"tooBig": "NO", "check": "NO", "grId": "0"})
        expect(p + " 499 + 2 bundle items = 501", run_js(body, dict(base, **{"workflowparams:allData.table_gr": lines(499, 2)})),
               {"tooBig": "YES"})
        expect(p + " 2000 lines", run_js(body, dict(base, **{"workflowparams:allData.table_gr": lines(2000)})), {"tooBig": "YES"})
        expect(p + " no table_gr", run_js(body, dict(base, **{"workflowparams:allData.table_gr": ""})), {"tooBig": "NO"})
        expect(p + " bad id", run_js(body, dict(base, **{"workflowparams:allData.id": '"12; DROP"'})), {"check": "NO", "grId": "0"})
        sql_text = find(doc, "sql_node_%sProcGuard" % p)["data"]["script"]["code"]
        rows = run_sql(p + " stored status (dev 000000 GR)", sql_text,
                       {"system:tenantId": "000000", "node:code_node_%sSizeGuard.data.grId" % p: "2072178648650149890"})
        busy = find(doc, "code_node_%sProcBusy" % p)["data"]["script"]["code"]
        expect(p + " busy on Processing", run_js(busy, {"node:sql_node_%sProcGuard.data" % p: '[{"gr_status":"Processing"}]'}), {"busy": "YES"})
        expect(p + " not busy on Received", run_js(busy, {"node:sql_node_%sProcGuard.data" % p: json.dumps(rows or [])}), {"busy": "NO"})
        expect(p + " not busy on no row", run_js(busy, {"node:sql_node_%sProcGuard.data" % p: "[]"}), {"busy": "NO"})


def cancel_guard():
    doc = json.loads(load("Bulk Actions/Procurement/Goods Receiving/GRcancelWorkflow.json"))
    key = find(doc, "code_node_CcGuardKey")["data"]["script"]["code"]
    expect("cancel key single id", run_js(key, {"workflowparams:gr_id": '"2072178648650149890"'}), {"idsCsv": "2072178648650149890", "idCount": "1"})
    expect("cancel key array", run_js(key, {"workflowparams:gr_id": '["1","2"]'}), {"idsCsv": "1,2", "idCount": "2"})
    expect("cancel key injection", run_js(key, {"workflowparams:gr_id": '"1) OR (1=1"'}), {"idsCsv": "0", "idCount": "0"})
    expect("cancel key missing", run_js(key, {"workflowparams:gr_id": ""}), {"idsCsv": "0", "idCount": "0"})
    decide = find(doc, "code_node_CcGuardDecide")["data"]["script"]["code"]
    def case(label, rows, action, count, refuse):
        got = run_js(decide, {"node:sql_node_CcGuard.data": json.dumps(rows), "node:code_node_CcGuardKey.data.idCount": json.dumps(str(count)),
                              "workflowparams:action": json.dumps(action)})
        expect("cancel decide " + label, got, {"refuse": refuse})
    row = lambda st: [{"id": "1", "gr_no": "GR-1", "gr_status": st}]
    case("cancel Created", row("Created"), "cancel", 1, "NO")
    case("cancel Completed", row("Completed"), "cancel", 1, "YES")
    case("cancel already Cancelled", row("Cancelled"), "cancel", 1, "YES")
    case("cancel Processing", row("Processing"), "cancel", 1, "YES")
    case("delete Draft", row("Draft"), "delete", 1, "NO")
    case("delete Cancelled", row("Cancelled"), "delete", 1, "NO")
    case("delete Created", row("Created"), "delete", 1, "YES")
    case("delete gone", [], "delete", 1, "YES")
    sql_text = find(doc, "sql_node_CcGuard")["data"]["script"]["code"]
    run_sql("cancel stored status (dev 000000 GRs)", sql_text, {"system:tenantId": "000000",
            "node:code_node_CcGuardKey.data.idsCsv": "2072178648650149890,2074349379464069122"})


if __name__ == "__main__":
    cancel_guard()
    gr_save_guards()
    print("failures:", fails)
    sys.exit(1 if fails else 0)
