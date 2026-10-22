"""check_form_saves.py <snowflake bound> [tenant]: every SI_SAVE run on DEV after the bound (read-only), its form state replayed
through the v387 SIcalculation (client/check_saved_form.js). Nothing listed = the lean form left every line and total where
v387's own calculation would have."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
from dbq import q  # noqa: E402

bound = sys.argv[1]
tenant = sys.argv[2] if len(sys.argv) > 2 else None
runs = q("--dev", "SELECT CAST(i.id AS CHAR) id, i.tenant_id t, i.status, i.create_time, CAST(i.create_user AS CHAR) u, i.run_time, LEFT(IFNULL(i.error_msg, ''), 200) err "
                  "FROM su_code_workflow_inst i WHERE i.workflow_id = 2029040374929154050 AND i.id > %s%s ORDER BY i.id" % (bound, (" AND i.tenant_id = '%s'" % tenant) if tenant else ""))
print("%d SI_SAVE runs after the bound" % len(runs))
for r in runs:
    req = q("--dev", "SELECT request_json_data FROM su_code_workflow_inst WHERE id = %s" % r["id"])[0]["request_json_data"]
    try:
        data = json.loads(req)
        d = (data.get("workflowparams") or data.get("request_json") or {}).get("data") or {}
        page, status = d.get("page_status"), d.get("si_status")
    except ValueError:
        page = status = "?"
    out = subprocess.run(["node", os.path.join(HERE, "..", "client", "check_saved_form.js")], input=req, capture_output=True, text=True)
    res = json.loads(out.stdout or "{}") if out.stdout else {"error": out.stderr[-300:]}
    verdict = ("ERROR " + res["error"]) if "error" in res else ("v387 = v388 calculation" if not res["oldVsNew"] else "v387 / v388 DISAGREE on %d values" % len(res["oldVsNew"])) + \
        ("" if "error" in res else ("; saved state is a fixed point" if not res["diffs"] else "; a fresh pass would change %d saved values" % len(res["diffs"])))
    print("  %s %s %s %-8s %s/%s %5.1f s | %d lines | %s%s" % (r["id"], str(r["create_time"])[:19], r["t"], r["status"], page, status, int(r["run_time"] or 0) / 1000,
                                                     res.get("lines", 0), verdict, (" | run error: " + r["err"]) if r["err"] else ""))
    for x in (res.get("oldVsNew") or [])[:8] + (res.get("diffs") or [])[:4]:
        print("      " + x)
