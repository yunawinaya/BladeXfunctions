"""Live, read-only: Revert V2's movement read (code/shared/sql.py RV_MOVES, used by SUBMIT / PREPARE / COMMIT V0) returns exactly what
the classic's sql_node_iaRvMovs returned in every recorded IA_REVERT run (fixtures: test/revert/fetch_runs.py, OUTSIDE the repo), on
the run's own environment and tenant; movement rows are append-only, so the rows written after the run (its own IA-R rows, later
cycles) are left out by id. Also the header fields code_node_iaRvPrep reads (FP_HEADER: item, plant, organization, number) =
the recorded get_node_iaRvIa's. An IA completed again since the run carries a new number, and RV_MOVES reads the header's current one,
so for it the run's own number is put in place of that sub-select (test only) and FP_HEADER compares item, plant and organization.
Prints counts only (no business data). usage: python3 test/revert/sql_live.py [fixture dir]
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(IAV2, "lib"))
from dbq import q  # noqa: E402
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("iarv_shared_sql_live", os.path.join(IAV2, "code", "shared", "sql.py"))
SH = importlib.util.module_from_spec(spec)
spec.loader.exec_module(SH)
FIXTURES = "/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/f"
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')
DEC = ("quantity", "base_qty", "unit_price", "total_price")


def P(text):
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', text))


def norm(row):
    o = {}
    for k, v in row.items():
        if v is None:
            continue
        o[k] = ("%.8f" % float(v)) if k in DEC else str(v)
    return o


def main():
    at = sys.argv[1] if len(sys.argv) > 1 else FIXTURES
    problems, checked = 0, 0
    for env in ("prod", "dev"):
        path = os.path.join(at, "runs_%s.jsonl" % env)
        if not os.path.exists(path):
            print("NOTICE: %s is absent - its %s checks are skipped (re-pull: python3 scratchpad/iav2/test/revert/fetch_runs.py --%s)" % (path, env, env))
            continue
        for line in open(path, encoding="utf-8"):
            r = P(line)
            rec = (r["nodes"].get("sql_node_iaRvMovs") or {}).get("resp")
            get = (r["nodes"].get("get_node_iaRvIa") or {}).get("resp")
            if not rec or not get or not (get.get("data") or {}).get("data"):
                print("skip %s %s (%s): no recorded movement read" % (env, r["id"], r["exit"]))
                continue
            ia = r["params"]["ia_id"]
            # the column the form publish creates (CONTRACT.md section 13 missing_cols)
            hdr_sql = SH.FP_HEADER.replace("'@T'", "'%s'" % r["tenant"]).replace("@IA", ia).replace("h.ia_v2_job_id", "NULL")
            hdr = q("--" + env, hdr_sql)
            h = P(hdr[0]["j"]) if hdr else {}
            g = get["data"]["data"]
            renumbered = bool(h) and str(h.get("stock_movement_no")) != str(g.get("stock_movement_no"))
            sql = SH.RV_MOVES.replace("'@T'", "'%s'" % r["tenant"]).replace("@IA", ia)
            if renumbered:
                # completed again since, under a new number: read the run's cycle by its own number (a test-only literal)
                no = str(g.get("stock_movement_no")).replace("'", "''")
                sql = sql.replace("m.trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.tenant_id = '%s' AND h.id = %s)" % (r["tenant"], ia), "m.trx_no = '%s'" % no)
                assert "m.trx_no = '%s'" % no in sql
            live = [x for x in q("--" + env, sql) if int(x["id"]) < int(r["id"])]
            want = rec["data"]
            same = [norm(x) for x in live] == [norm(x) for x in want]
            keys = ("item_id", "issuing_operation_faci", "organization_id") + (() if renumbered else ("stock_movement_no",))
            hdr_ok = bool(h) and [str(h.get(k)) for k in keys] == [str(g.get(k)) for k in keys]
            checked += 1
            problems += (not same) + (not hdr_ok)
            print("%s %s %s: RV_MOVES %d row(s) = the recorded sql_node_iaRvMovs (%d): %s; FP_HEADER = get_node_iaRvIa's item / plant / organization%s: %s%s"
                  % ("ok  " if same and hdr_ok else "FAIL", env, r["id"], len(live), len(want), "YES" if same else "NO", "" if renumbered else " / number",
                     "YES" if hdr_ok else "NO", " (completed again since under a new number: read by the run's own)" if renumbered else ""))
    print("checked %d recorded runs, problems: %d" % (checked, problems))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
