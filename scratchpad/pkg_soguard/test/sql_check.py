# Runs the drafts' new SQL read-only on dev for one Packing: as written (expects no SAVE_SO job), and with gd_async_job
# swapped for a one-row stand-in SAVE_SO job on the delivery's SO (expects it found).
# Usage: python3 -I sql_check.py <out dir> <packing id> <tenant> <org> <gd id> <so id>
import json, subprocess, sys, os
out, pid, tenant, org, gid, soid = sys.argv[1:7]
root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

def find(o, i):
    if isinstance(o, dict):
        if o.get("id") == i: return o
        for v in o.values():
            r = find(v, i)
            if r: return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, i)
            if r: return r

def db(sql):
    r = subprocess.run([os.path.join(root, ".dbtools/db"), "--dev", "--json", sql], capture_output=True, text=True)
    if r.returncode: sys.exit(r.stderr[-800:])
    return json.loads(r.stdout)

fake = ("(SELECT CAST(999 AS UNSIGNED) AS id, 'SAVE_SO' AS command, 'QUEUED' AS job_status, '%s' AS tenant_id, "
        "(CONCAT('SO|', '%s') COLLATE utf8mb4_general_ci) AS correlation_id, 0 AS is_deleted) j" % (tenant, soid))

sub = json.load(open(os.path.join(out, "PACKING_ASYNC_SUBMIT.json")))
q = find(sub, "sql_node_KSfacts")["data"]["script"]["code"]
for k, v in {"{{node:code_node_KSguard.data.tenantId}}": tenant, "{{node:code_node_KSguard.data.packingId}}": pid,
             "{{node:code_node_KSguard.data.organizationId}}": org, "{{node:code_node_KSguard.data.idempotencyKey}}": "none",
             "{{system:uid}}": "0"}.items():
    q = q.replace(k, v)
r = db(q)[0]
print("SUBMIT live:  so_job =", r.get("so_job"), "| other_job =", r.get("other_job"), "| gd_found =", r.get("gd_found"))
head, tail = q.split(") AS other_job,", 1)
so_part, rest = tail.split(") AS so_job,", 1)
so_part = so_part.replace("FROM gd_async_job j", "FROM " + fake, 1)
r = db(head + ") AS other_job," + so_part + ") AS so_job," + rest)[0]
print("SUBMIT stand-in: so_job =", r.get("so_job"))

ps = json.load(open(os.path.join(out, "PackingSaveWorkflowJSON.json")))
q = find(ps, "sql_node_PkJobChk")["data"]["script"]["code"]
for gd in (gid, ""):
    q2 = q.replace("{{node:code_node_PkPickId.data.tenantId}}", tenant).replace("{{node:code_node_PkPickId.data.gdDigits}}", gd)
    print("SAVE live (gd=%s):" % (gd or "''"), db(q2))
    print("SAVE stand-in (gd=%s):" % (gd or "''"), db(q2.replace("FROM gd_async_job j", "FROM " + fake, 1)))
