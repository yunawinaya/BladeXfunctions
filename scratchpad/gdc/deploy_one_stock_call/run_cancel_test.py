"""run_cancel_test.py: dev test of GD_CANCEL_WORKER v6 (one commit call per run, patch_workers_one_stock_call.py; the user's yes
2026-10-27): bulk-cancel the given Created GDs while several worker runs go at once, as the GD list's bulk action and its drain do.

usage: python3 run_cancel_test.py <work dir> <gd_id> [<gd_id> ...]
Submits GD_CANCEL_SUBMIT per GD, starts a job_id run for the first two jobs plus 3 id-less sweeps at once, then 3 more sweeps every
time a round ends until every job is terminal (15 min at most). Writes each run's answer to <work dir> and prints, per worker run,
the jobs it moved, and a summary. Dev only, CLI session (tenant 000000).
"""
import json
import os
import subprocess
import sys
import time

REPO = "/Users/yunawinaya/Developer/BladeXfunctions"
RUNWF = REPO + "/scratchpad/gdc/tools/runwf.mjs"
SUBMIT, WORKER = "2112455664139866113", "2112455700319932418"
TERMINAL = ("COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED")
work, gd_ids = sys.argv[1], sys.argv[2:]
os.makedirs(work, exist_ok=True)
t0 = time.time()


def say(msg):
    print("%6.1fs %s" % (time.time() - t0, msg), flush=True)


def start(wf, req, name):
    rq, out = os.path.join(work, name + ".req.json"), os.path.join(work, name + ".out.json")
    open(rq, "w").write(json.dumps(req))
    return name, out, subprocess.Popen(["node", RUNWF, wf, rq, out], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def answer(out):
    try:
        return json.load(open(out)).get("data") or {}
    except Exception:
        return {}


def jobs(ids):
    sql = "SELECT CAST(id AS CHAR) id, job_status, IFNULL(error_code,'') code FROM gd_async_job WHERE id IN (%s)" % ",".join(ids)
    out = subprocess.run([REPO + "/.dbtools/db", "--dev", "--json", sql], cwd=REPO, capture_output=True, text=True).stdout
    i = out.find("[")
    return {r["id"]: r for r in (json.loads(out[i:]) if i >= 0 else [])}


ids = []
for n, gd in enumerate(gd_ids):
    name, out, p = start(SUBMIT, {"operation": "SUBMIT", "gd_id": gd, "source": "LIST"}, "submit_%d" % n)
    p.wait()
    a = answer(out)
    say("submit %s -> %s %s %s" % (gd, a.get("route"), a.get("job_id", ""), (a.get("message") or "")[:80]))
    if a.get("job_id"):
        ids.append(a["job_id"])
if not ids:
    sys.exit("no job queued")

runs = [start(WORKER, {"job_id": j}, "job_%s" % j[-6:]) for j in ids[:2]]
runs += [start(WORKER, {}, "sweep_0_%d" % k) for k in range(3)]
rnd = 0
while time.time() - t0 < 900:
    for _, _, p in runs:
        p.wait()
    st = jobs(ids)
    left = [j for j in ids if st.get(j, {}).get("job_status") not in TERMINAL]
    say("round %d done: %d of %d jobs terminal" % (rnd, len(ids) - len(left), len(ids)))
    if not left:
        break
    rnd += 1
    runs = [start(WORKER, {}, "sweep_%d_%d" % (rnd, k)) for k in range(3)]

moved_by_run = {}
for f in sorted(os.listdir(work)):
    if not (f.startswith("job_") or f.startswith("sweep_")) or not f.endswith(".out.json"):
        continue
    a = answer(os.path.join(work, f))
    try:
        js = json.loads(a.get("jobs") or "[]")
    except ValueError:
        js = []
    moved = [j["job_id"][-6:] + ":" + j.get("before", "") + ">" + j.get("job_status", "") for j in js if j.get("before") != j.get("job_status")]
    # a commit call leaves the job COMMITTING_GD (split / waiting) or COMPLETED
    moved_by_run[f[:-9]] = [m for m in moved if m.endswith(">COMPLETED") or m.endswith(">COMMITTING_GD")]
    say("%-12s %s processed=%s moved=%s" % (f[:-9], a.get("worker_route"), a.get("processed"), moved))
st = jobs(ids)
say("FINAL " + json.dumps({j[-6:]: st.get(j, {}).get("job_status") for j in ids}))
say("max commit calls by one run: %d" % max([len(v) for v in moved_by_run.values()] or [0]))
