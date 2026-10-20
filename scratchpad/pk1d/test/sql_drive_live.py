"""sql_drive_live.py: PICKING_FC_DRIVE's three reads, tokens filled, run read-only on DEV - as built (no force complete exists on dev
yet, so the edits read is empty) and as must-match variants (the same subqueries with the force-complete filters relaxed, on jobs
that do exist), plus EXPLAIN of the edits subquery (the idempotency-key index). usage: python3 sql_drive_live.py"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

CODE = os.path.join(HERE, "..", "code")
FC_FILTER = """                AND e.causation_id = 'PICKING_FC'
                AND CAST(JSON_UNQUOTE(JSON_EXTRACT(e.request_payload, '$.causation_job_id')) AS UNSIGNED) = j.id"""
STEP_FILTER = "AND s.step_name IN ('FC_F0', 'FC_HOLD', 'FC_GDS', 'FC_ABORT', 'FC_REVIEW')"


def sql(name, **tokens):
    with open(os.path.join(CODE, name), encoding="utf-8") as f:
        t = f.read()
    for k, v in tokens.items():
        t = t.replace("{{node:%s}}" % k, v)
    assert "{{" not in t, name + ": a token is left"
    return t


def run(label, text, check):
    t0 = time.time()
    rows = q("--dev", text)
    ok = bool(check(rows))
    print("%-62s %s  rows=%d  %.2fs" % (label, "OK  " if ok else "FAIL", len(rows), time.time() - t0))
    return ok, rows


def main():
    good = True
    # A: tenant 496474, the latest CONFIRM_PICKING job (PI-20261020-0081, 500 picked lines)
    T, J = "496474", "2112396481570902018"
    job = q("--dev", "SELECT organization_id, picking_id, CAST(JSON_EXTRACT(prepared_payload, '$.gd_ids_all') AS CHAR) g FROM gd_async_job WHERE tenant_id = '%s' AND id = %s" % (T, J))[0]
    org, pick, gds = str(job["organization_id"]), str(job["picking_id"]), json.loads(job["g"])
    like = " OR ".join("e.idempotency_key LIKE 'GDE|%s|%%'" % g for g in gds)
    base = {"code_node_DRguard.data.tenantId": T, "code_node_DRguard.data.jobId": J, "code_node_DRentry.data.organizationId": org,
            "code_node_DRentry.data.edLikeSql": like, "code_node_DRentry.data.pickingId": pick, "code_node_DRentry.data.gdIdsAllSql": ",".join(gds)}
    ok, rows = run("drive_job.sql (a CONFIRM job: fc NULL, picking_no set)", sql("drive_job.sql", **base),
                   lambda r: len(r) == 1 and str(r[0]["id"]) == J and r[0]["picking_no"] and r[0]["fc"] is None and r[0]["lease_until"])
    good &= ok
    print("   ", {k: rows[0][k] for k in ("job_status", "operation", "picking_no", "snap_to_status", "gd_ids_all", "fc_steps", "lease_live")})
    ok, rows = run("drive_state.sql as built (no force-complete edits yet)", sql("drive_state.sql", **base),
                   lambda r: len(r) == 1 and str(r[0]["id"]) == J and r[0]["edits"] is None)
    good &= ok
    ok, rows = run("drive_f0.sql (the Picking, its rows, records aggregate, its GDs)", sql("drive_f0.sql", **base),
                   lambda r: [x["kind"] for x in r].count("P") == 1 and [x["kind"] for x in r].count("A") == 1 and [x["kind"] for x in r].count("G") == len(gds)
                   and [x["kind"] for x in r].count("R") > 0)
    good &= ok
    agg = [x for x in rows if x["kind"] == "A"][0]
    print("    rows R=%d, records count=%s sum=%s max=%s, picking %s" % ([x["kind"] for x in rows].count("R"), agg["a"], agg["b"], agg["c"],
                                                                         [x for x in rows if x["kind"] == "P"][0]["status"]))
    # the step read must match: the same subquery over this job's claim rows
    st = sql("drive_state.sql", **base).replace(STEP_FILTER, "AND s.step_name LIKE 'W0_CLAIM_%'")
    ok, rows = run("drive_state.sql steps subquery, must-match (W0_CLAIM_ rows)", st, lambda r: r[0]["steps"] and len(json.loads(r[0]["steps"])) > 0)
    good &= ok
    print("   ", json.loads(rows[0]["steps"])[:2])
    # B: tenant 711077's EDIT_GD jobs (FORM / CASCADE): the edits subquery must find them when the force-complete filters are relaxed
    T2, J2, org2 = "711077", "2111113621984813057", "2105190589240086530"
    gds2 = ["2110639610487418882", "2110625980264402945"]
    like2 = " OR ".join("e.idempotency_key LIKE 'GDE|%s|%%'" % g for g in gds2)
    b2 = dict(base, **{"code_node_DRguard.data.tenantId": T2, "code_node_DRguard.data.jobId": J2, "code_node_DRentry.data.organizationId": org2,
                       "code_node_DRentry.data.edLikeSql": like2})
    text = sql("drive_state.sql", **b2)
    assert FC_FILTER in text
    ok, rows = run("drive_state.sql edits subquery, must-match (FC filters relaxed)", text.replace(FC_FILTER, ""),
                   lambda r: r[0]["edits"] and len(json.loads(r[0]["edits"])) >= 3)
    good &= ok
    ed = json.loads(rows[0]["edits"])
    print("    %d edits; first: %s" % (len(ed), json.dumps(sorted(ed, key=lambda x: x["id"])[0])[:300]))
    ok, rows = run("drive_state.sql as built on 711077 (no PICKING_FC edits)", text, lambda r: r[0]["edits"] is None)
    good &= ok
    sub = text[text.index("FROM gd_async_job e"):text.index(") AS CHAR) AS edits")].replace("= j.id", "= 1")
    plan = q("--dev", "EXPLAIN SELECT e.id " + sub)
    print("    EXPLAIN edits:", [(p["table"], p["type"], p["key"], p["rows"]) for p in plan])
    good &= any(p["key"] == "Idempotency Key" and p["type"] == "range" for p in plan)
    print("ALL OK" if good else "SOMETHING FAILED")
    sys.exit(0 if good else 1)


if __name__ == "__main__":
    main()
