"""watch_lsh7.py: read-only prod watch of the 7 LSH jobs released 10-23 12:45 - prints each change, stops when all are terminal
(COMPLETED / FAILED / REQUIRES_REVIEW / CANCELLED) or after 40 minutes."""
import json, subprocess, time
IDS = "2113487054728990721,2113487059900567554,2113487077369843713,2113487080221970434,2113487081836777473,2113490602032238593,2113490605307990017"
SQL = ("SELECT gd_no, job_status, IFNULL(error_code, '') AS e, attempt_count AS a, DATE_FORMAT(update_time, '%%H:%%i:%%s') AS t "
       "FROM gd_async_job WHERE tenant_id = '128671' AND id IN (%s) ORDER BY gd_no" % IDS)
seen = {}
start = time.time()
while time.time() - start < 2400:
    out = subprocess.run([".dbtools/db", "--prod", "--json", SQL], capture_output=True, text=True).stdout
    rows = json.loads(out[out.index("["):]) if "[" in out else []
    for r in rows:
        key = (r["job_status"], r["e"], str(r["a"]))
        if seen.get(r["gd_no"]) != key:
            seen[r["gd_no"]] = key
            print("%s %s %s %s attempt %s" % (r["t"], r["gd_no"], r["job_status"], r["e"], r["a"]), flush=True)
    if rows and all(r["job_status"] in ("COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED") for r in rows):
        print("all 7 terminal", flush=True)
        break
    time.sleep(30)
