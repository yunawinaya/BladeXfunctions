"""Golden test (b) of the shared review chain's SQL + adapter (CONTRACT.md section 16), read-only.

For every recorded STOCK_COUNT Review run (fixtures/sc_runs_<env>.json, fetch_sc_runs.py) the REVIEW_READS of
code/shared/review_sql.py are run NOW on that run's environment with that run's tenant and prep id lists, adapted by
review_chain.js saReviewAdapt (node), and compared with what the classic build received in that run (the build's recorded
variableMap; trace Longs read as digit strings, as the code node saw them):
  SHAPE (always)   for every recorded row also read now, and every column the SQL selects: present in both or absent in
                   both (NULL / '' dropped), same JS type (string / number / array / object); costs rows the same; the
                   prefix the same count / shape (ONE object)
  VALUES           equal where the row has not changed since the run (its update_time is the recorded one); the columns
                   a row never changes (ids, FKs, tenant / org, create_*) always; costs rows: their key columns
Rows created or deleted since the run are counted, not compared.

usage: python3 test/prepare/test_review_shape.py [--dev] [--prod]   (default: both)
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(SAV2, "lib"))
sys.path.insert(0, os.path.join(SAV2, "code", "shared"))
from dbq import q  # noqa: E402
import review_sql as R  # noqa: E402

BIG = re.compile(r'"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))')


def J(text):
    """trace JSON with bare 16+ digit integers read as digit strings (what a code node received)"""
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(2) is None else m.group(1) + '"' + m.group(2) + '"', text))


NODE = """
const { load } = require(%s);
const m = load(["lib/lift/runtime.js", "code/shared/sa_common.js", "code/shared/review_chain.js"], ["saReviewAdapt"]);
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(input.map((reads) => m.saReviewAdapt(reads))));
""" % json.dumps(os.path.join(HERE, "load.js"))

TABLES = {"items": "item", "bins": "bin_location", "uoms": "unit_of_measurement", "batches": "batch", "prefix": "su_code_serial_no_rule",
          "balances": "item_balance", "batch_balances": "item_batch_balance"}
SEARCH = ["items", "balances", "batch_balances", "bins", "uoms", "batches"]

stats = {"runs": 0, "rows": 0, "rows_unchanged": 0, "cells": 0, "fail": 0, "new": 0, "gone": 0, "outside": 0}
fails = []


def jtype(v):
    return "str" if isinstance(v, str) else "num" if isinstance(v, (int, float)) and not isinstance(v, bool) else "list" if isinstance(v, list) else "obj" if isinstance(v, dict) else type(v).__name__


def fail(msg):
    stats["fail"] += 1
    if len(fails) < 60:
        fails.append(msg)


def compare_row(tag, got, want, cols, values, subcols=None):
    for k in cols:
        stats["cells"] += 1
        if (k in got) != (k in want):
            fail(f"{tag} {k}: present now={k in got} recorded={k in want} (now={json.dumps(got.get(k))[:80]} rec={json.dumps(want.get(k))[:80]})")
            continue
        if k not in got:
            continue
        if jtype(got[k]) != jtype(want[k]):
            fail(f"{tag} {k}: type now={jtype(got[k])} recorded={jtype(want[k])}")
            continue
        if subcols and k in subcols:
            g = {r.get("id"): r for r in got[k]}
            w = {r.get("id"): r for r in want[k]}
            if values is True and list(g) != list(w):
                fail(f"{tag} {k}: rows now={list(g)} recorded={list(w)}")
            for i in set(g) & set(w):
                compare_row(f"{tag} {k}[{i}]", g[i], w[i], subcols[k], values)
            continue
        if (values is True or (callable(values) and values(k))) and got[k] != want[k]:
            fail(f"{tag} {k}: now={json.dumps(got[k])[:80]} recorded={json.dumps(want[k])[:80]}")


BAL = ["id", "material_id", "plant_id", "location_id", "balance_quantity", "unrestricted_qty", "block_qty", "qualityinsp_qty", "reserved_qty", "intransit_qty",
       "organization_id", "tenant_id", "create_user", "create_time", "create_dept", "update_user", "update_time", "is_deleted", "material_uom"]
COLS = {"items": ["id", "material_code", "material_name", "item_batch_management", "material_costing_method", "purchase_unit_price", "table_uom_conversion"],
        "balances": BAL, "batch_balances": BAL[:4] + ["batch_id"] + BAL[4:], "bins": ["id", "bin_location_combine", "plant_id"], "uoms": ["id", "uom_name"],
        "batches": ["id", "batch_number"]}
# columns a row never changes after its insert: their values are compared even when the row changed since the run
IMMUTABLE = {"id", "material_id", "plant_id", "location_id", "batch_id", "organization_id", "tenant_id", "create_user", "create_time", "create_dept", "is_deleted",
             "material_uom"}


def cols_of(name):
    """the keys a read can produce (the JSON_OBJECT keys of its SQL - checked against the text)"""
    cols = COLS[name]
    for c in cols:
        assert ("'%s'," % c) in R.REVIEW_READS[name], (name, c)
    return cols


SUBCOLS = {"table_uom_conversion": ["id", "alt_uom_id", "base_uom_id", "alt_qty", "base_qty"]}


def main():
    envs = [e for e in ("--dev", "--prod") if e in sys.argv] or ["--dev", "--prod"]
    for env in envs:
        runs = json.load(open(os.path.join(HERE, "fixtures", f"sc_runs_{env[2:]}.json"), encoding="utf-8"))
        batch, metas = [], []
        for run in runs:
            prep = J(run["nodes"]["code_review_prep"]["response"])["data"]
            vm = J(run["nodes"]["code_review_build_sa"]["request"])["variableMap"]
            from_list = lambda a: ",".join(sorted({str(x) for x in (a or []) if re.fullmatch(r"[0-9]{1,20}", str(x)) and str(x) != "0"})) or "0"
            org = str(prep.get("orgIdSql") or J(run["request"])["workflowparams"].get("organizationId") or "0")
            tok = {"T": run["tenant"], "MID": from_list(prep.get("materialIds")), "LID": from_list(prep.get("locationIds")),
                   "UID": from_list(prep.get("baseUomIds")), "BID": from_list(prep.get("batchIds")), "ORG": org if re.fullmatch(r"[0-9]{1,20}", org) else "0"}
            assert re.fullmatch(r"[0-9]{6}", tok["T"])
            run["_mid"], run["_lid"] = set(tok["MID"].split(",")), set(tok["LID"].split(","))
            reads = {name: q(env, R.review_sql(name, **{k: tok[k] for k in R.REVIEW_TOKENS[name]})) for name in R.REVIEW_READS}
            # the current update_time of every recorded row (change detection)
            now_ut = {}
            for name, node in R.REVIEW_NODES.items():
                if name == "costs":
                    continue
                key = f"node:{node}.data.data"
                rec = vm.get(key)
                rec = rec if isinstance(rec, list) else [rec] if isinstance(rec, dict) and rec else []
                ids = [str(r["id"]) for r in rec if re.fullmatch(r"[0-9]{1,20}", str(r.get("id", "")))]
                if ids:
                    rows = q(env, f"SELECT CAST(id AS CHAR) id, {R.PLATFORM_DT('update_time')} ut FROM {TABLES[name]} WHERE tenant_id = '{tok['T']}' AND id IN ({','.join(ids)})")
                    now_ut[name] = {r["id"]: r["ut"] for r in rows}
            batch.append(reads)
            metas.append((run, vm, now_ut))
        out = json.loads(subprocess.run(["node", "-e", NODE], input=json.dumps(batch), capture_output=True, text=True, cwd=SAV2, check=True).stdout)
        for (run, vm, now_ut), ctx in zip(metas, out):
            stats["runs"] += 1
            tag = f"{env[2:]} {run['id']} ({run['tenant']})"
            for name in SEARCH:
                node = R.REVIEW_NODES[name]
                got = {r["id"]: r for r in ctx["node:" + node]["data"]["data"]}
                rec = vm.get(f"node:{node}.data.data") or []
                # an older (pre-v10) run's balance searches had no location filter: rows outside v10's filter are not expected now
                inside = lambda r: name not in ("balances", "batch_balances") or (str(r.get("material_id")) in run["_mid"] and str(r.get("location_id")) in run["_lid"])
                stats["outside"] += sum(1 for r in rec if not inside(r))
                want = {r["id"]: r for r in rec if inside(r)}
                stats["new"] += len(set(got) - set(want))
                stats["gone"] += len(set(want) - set(got))
                cols = cols_of(name)
                for i in set(got) & set(want):
                    stats["rows"] += 1
                    same = now_ut.get(name, {}).get(i) == want[i].get("update_time")
                    stats["rows_unchanged"] += same
                    compare_row(f"{tag} {name}[{i}]{'' if same else ' (changed since)'}", got[i], want[i], cols, True if same else (lambda c: c in IMMUTABLE),
                                SUBCOLS if name == "items" else None)
            # get_sa_prefix: ONE object with the same id
            pg = ctx["node:get_sa_prefix"]["data"]
            pw = vm.get("node:get_sa_prefix.data.data")
            if jtype(pg["data"]) != jtype(pw) or (isinstance(pw, dict) and pw.get("id") != pg["data"].get("id")):
                fail(f"{tag} prefix: now={json.dumps(pg)[:200]} recorded={json.dumps(pw)[:200]}")
            else:
                stats["cells"] += 1
            # sql_review_costs (v10 runs only): rows of text, NULL absent
            if "node:sql_review_costs.data" in vm:
                key = lambda r: (r.get("src"), r.get("material_id"), r.get("plant_id"), r.get("batch_id"))
                got = {key(r): r for r in ctx["node:sql_review_costs"]["data"]}
                want = {key(r): r for r in vm["node:sql_review_costs.data"] or []}
                for k in set(got) & set(want):
                    stats["rows"] += 1
                    # a cost row has no id or time here: its key columns are compared, the cost / rn values may have moved on
                    compare_row(f"{tag} costs{k}", got[k], want[k], ["src", "material_id", "plant_id", "batch_id", "cost", "rn", "rn_any"],
                                lambda c: c in ("src", "material_id", "plant_id", "batch_id"))
                stats["new"] += len(set(got) - set(want))
                stats["gone"] += len(set(want) - set(got))
    for f in fails:
        print("FAIL", f)
    print("review shape: %(runs)d runs, %(rows)d rows compared (%(rows_unchanged)d unchanged since the run: values too), %(cells)d cells, "
          "%(new)d rows new since, %(gone)d gone since, %(outside)d recorded rows outside v10's filter (older runs); %(fail)d failures" % stats)
    sys.exit(1 if stats["fail"] else 0)


if __name__ == "__main__":
    main()
