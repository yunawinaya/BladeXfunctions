"""Re-reads (read-only) the Stock Adjustment of every recorded classic run in fixtures/sa_runs_<env>.json with PREPARE's own
SQL (prepare/sql.py READS hdr + lines, tokens filled with the run's tenant and SA id) -> fixtures/sa_rows_<env>.json
{ "<run id>": { "hdr": [rows], "lines": [rows] } } for test_sa_golden.js (golden 3b: the FORM DIRECT path on stored rows).
The SA V2 columns do not exist before D's form publish and prod has no gd_publish_step yet: sa_v2_job_id and lock_ref are read as NULL here.

usage: python3 fetch_sa_rows.py <--prod|--dev>
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(SAV2, "lib"))
from dbq import q  # noqa: E402

spec = importlib.util.spec_from_file_location("sa_prepare_sql", os.path.join(SAV2, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PSQL)


def fill(sql, tenant, sa_id):
    sql = sql.replace(PSQL.ET, "'%s'" % tenant).replace(PSQL.SA, sa_id).replace("h.sa_v2_job_id", "NULL")
    # prod has no gd_publish_step before the full deployment: the lock facts are not needed here
    sql = re.sub(r"\(SELECT p\.result_ref FROM gd_publish_step p.*?LIMIT 1\)", "NULL", sql, flags=re.S)
    assert "{{" not in sql, sql[:200]
    return sql


def main():
    env = sys.argv[1]
    assert env in ("--prod", "--dev")
    runs = json.load(open(os.path.join(HERE, "fixtures", f"sa_runs_{env[2:]}.json"), encoding="utf-8"))
    out = {}
    for r in runs:
        ad = r.get("allData") or {}
        sa_id = str(ad.get("id") or "")
        if not sa_id:
            add = (r["nodes"].get("add_node_Yk7ukSPp") or {}).get("data")
            sa_id = str((add[0] if isinstance(add, list) and add else add or {}).get("id") or "")
        if not re.fullmatch(r"[0-9]{1,20}", sa_id) or not re.fullmatch(r"[0-9]{6}", r["tenant"]):
            continue
        out[r["id"]] = {"sa_id": sa_id, "hdr": q(env, fill(PSQL.READS["hdr"][0], r["tenant"], sa_id)),
                        "lines": q(env, fill(PSQL.READS["lines"][0], r["tenant"], sa_id))}
    path = os.path.join(HERE, "fixtures", f"sa_rows_{env[2:]}.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{env}: {len(out)} Stock Adjustments re-read -> {path}")


if __name__ == "__main__":
    main()
