"""run_contention.py: dev test - two 100-line GD creations on the same stock, converted together, followed like the SO list does
(a worker kick per job every 15 s), to time the oldest-first wait (2026-10-26, user's request).

usage: python3 run_contention.py <work dir> <so_id_older> <so_id_younger> [max seconds, default 600]
Writes <work dir>/contention_log.txt (one line per poll) and prints the summary. Dev only: SO_AUTO_GD 2076557490389835777,
GD_ASYNC_WORKER 2104840667119411201 through scratchpad/gdc/tools/runwf.mjs (CLI session, tenant 000000).
"""
import json
import os
import subprocess
import sys
import time

REPO = "/Users/yunawinaya/Developer/BladeXfunctions"
RUNWF = REPO + "/scratchpad/gdc/tools/runwf.mjs"
SO_AUTO_GD = "2076557490389835777"
WORKER = "2104840667119411201"
work, so_a, so_b = sys.argv[1], sys.argv[2], sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 600
os.makedirs(work, exist_ok=True)
log = open(os.path.join(work, "contention_log.txt"), "w")


def say(msg):
    line = time.strftime("%H:%M:%S") + " " + msg
    print(line, flush=True)
    log.write(line + "\n")
    log.flush()


def runwf(wf, req, name, wait=True):
    rq, out = os.path.join(work, name + ".req.json"), os.path.join(work, name + ".out.json")
    open(rq, "w").write(json.dumps(req))
    p = subprocess.Popen(["node", RUNWF, wf, rq, out], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait:
        return p
    p.wait()
    try:
        return json.load(open(out))
    except Exception:
        return {}


def jobs(ids):
    sql = ("SELECT CAST(id AS CHAR) id, job_status, IFNULL(error_code,'') code, LEFT(IFNULL(error_message,''),110) msg, attempt_count, "
           "IFNULL(gd_no,'') gd_no FROM gd_async_job WHERE id IN (%s)" % ",".join(ids))
    out = subprocess.run([REPO + "/.dbtools/db", "--dev", "--json", sql], cwd=REPO, capture_output=True, text=True).stdout
    i = out.find("[")  # the [DEV] banner goes to stderr when captured: stdout is the JSON alone
    return {r["id"]: r for r in (json.loads(out[i:]) if i >= 0 else [])}


t0 = time.time()
conv = runwf(SO_AUTO_GD, {"so_ids": [so_a, so_b], "gd_type": "multiple", "plant_id": "1123598813738675202",
                          "organization_id": "1123598813738675201", "created_by": "contention test (GD session, dev)", "v2": "1"}, "conv")
queued = ((conv.get("data") or {}).get("queued") or [])
ids = [q["job_id"] for q in queued if q.get("job_id")]
say("convert: %s" % json.dumps([(q.get("so_no"), q.get("job_id")) for q in queued]))
if len(ids) != 2:
    say("expected 2 queued jobs, got %d: %s" % (len(ids), json.dumps(conv)[:600]))
    sys.exit(1)
ids.sort()  # snowflake ids: the smaller is the older job
say("older job %s, younger job %s" % (ids[0], ids[1]))
procs = [runwf(WORKER, {"job_id": j}, "kick0_%s" % j, wait=False) for j in ids]
done_at = {}
n = 0
while time.time() - t0 < limit:
    time.sleep(15)
    n += 1
    st = jobs(ids)
    parts = []
    for j in ids:
        r = st.get(j, {})
        parts.append("%s %s %s a%s %s" % (j[-6:], r.get("job_status"), r.get("code"), r.get("attempt_count"), (r.get("msg") or "")[:70]))
        if r.get("job_status") in ("COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED") and j not in done_at:
            done_at[j] = time.time() - t0
    say("t+%3ds | %s" % (time.time() - t0, " || ".join(parts)))
    if len(done_at) == 2:
        break
    for j in ids:  # the SO list's follow: a kick per unfinished job every 15 s
        if j not in done_at:
            procs.append(runwf(WORKER, {"job_id": j}, "kick%d_%s" % (n, j), wait=False))
for p in procs:
    try:
        p.wait(timeout=300)
    except Exception:
        pass
st = jobs(ids)
for j in ids:
    r = st.get(j, {})
    say("RESULT %s job %s: %s %s after %s s, gd %s" % ("older" if j == ids[0] else "younger", j, r.get("job_status"), r.get("code"),
                                                      round(done_at.get(j, -1)), r.get("gd_no")))
