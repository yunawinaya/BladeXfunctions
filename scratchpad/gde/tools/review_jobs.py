"""review_jobs.py [--dev|--prod] [--tenant T]: every background (V2) job left REQUIRES_REVIEW, read-only.
One line per job: tenant, command, job id, its delivery / Picking, how long it has waited, the steps done, the reason. A job
under review keeps its delivery frozen (GD_EDIT_SUBMIT, GOODS_DELIVERY, the Picking guards and PACKING_SAVE all treat it as
busy) until someone repairs it - see Goods Delivery/EditV2/README.md "A job under review". Nothing is written."""
import sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

env = "--prod" if "--prod" in sys.argv else "--dev"
tenant = sys.argv[sys.argv.index("--tenant") + 1] if "--tenant" in sys.argv else ""
assert tenant == "" or tenant.isdigit(), "--tenant takes digits"
rows = q(env, """SELECT j.tenant_id, j.command, CAST(j.id AS CHAR) AS id, j.correlation_id, CAST(j.picking_id AS CHAR) AS picking_id, j.picking_no,
       TIMESTAMPDIFF(MINUTE, COALESCE(j.finished_at, j.update_time), NOW()) AS waited_min, j.error_code, LEFT(j.error_message, 160) AS why,
       (SELECT GROUP_CONCAT(p.step_name ORDER BY p.id SEPARATOR ' ') FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci) AND p.step_status = 'DONE' AND p.is_deleted = 0
           AND p.step_name NOT LIKE 'W0_CLAIM_%%') AS done_steps,
       g.delivery_no, g.gd_status
  FROM gd_async_job j
  LEFT JOIN goods_delivery g
    ON g.tenant_id = j.tenant_id AND j.correlation_id REGEXP '^GD\\\\|[0-9]{1,20}$' AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
 WHERE j.job_status = 'REQUIRES_REVIEW' AND j.is_deleted = 0 %s
 ORDER BY j.tenant_id, j.id""" % ("AND j.tenant_id = '%s'" % tenant if tenant else ""))
if not rows:
    print("no job under review (%s%s)" % (env[2:], ", tenant " + tenant if tenant else ""))
for r in rows:
    what = ("GD " + str(r.get("delivery_no") or r.get("correlation_id") or "") + " (" + str(r.get("gd_status") or "?") + ")") if r.get("delivery_no") or str(r.get("correlation_id") or "").startswith("GD|") else ""
    if r.get("picking_id") and str(r.get("picking_id")) != "0":
        what += (" " if what else "") + "Picking " + str(r.get("picking_no") or r.get("picking_id"))
    print("%s %-16s job %s  %s  waited %s min  done: %s\n    %s: %s" % (r["tenant_id"], r["command"], r["id"], what or str(r.get("correlation_id") or ""), r.get("waited_min"),
                                                                   r.get("done_steps") or "-", r.get("error_code") or "-", r.get("why") or "-"))
print("%d job(s) under review" % len(rows))
