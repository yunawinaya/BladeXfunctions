"""After the paste: is the enabled prod SO list the paste, and how fast do bulk SO -> GD converts go since (per batch: GDs,
seconds until the last one was created, seconds per GD)?   usage: python3 verify.py"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


r = q("SELECT CAST(id AS CHAR) id, version_number v, create_time t, page_json j FROM su_code_pages_history WHERE data_id = 1901872125787099137 AND status = 'enabled' ORDER BY id DESC LIMIT 1")[0]
live = json.loads(r["j"])
paste = json.load(open(os.path.join(HERE, "SO_list.prod_paste.json")))
base = json.load(open(os.path.join(HERE, "SO_list.prod_v272_base.json")))
print(f"SO list page: enabled v{r['v']} ({str(r['t'])[:19]}) " + ("= the paste" if live == paste else "= v272 (not pasted)" if live == base else "DIFFERS from both: check"))
# bulk converts (5+ GDs from one user in one minute) queued after the enable; prod stores these timestamps in UTC
rows = q("SELECT j.tenant_id t, DATE_FORMAT(MIN(j.create_time), '%m-%d %H:%i') batch, COUNT(*) gds, "
         "MAX(TIMESTAMPDIFF(SECOND, j.create_time, CONVERT_TZ(j.finished_at, '+00:00', '+08:00'))) last_s, "
         "SUM(j.job_status <> 'COMPLETED') not_done FROM gd_async_job j "
         f"WHERE j.id > {r['id']} AND j.command = 'CREATE_GD_FROM_FORM' AND j.correlation_id LIKE 'SOA:%' "
         "GROUP BY j.tenant_id, DATE_FORMAT(j.create_time, '%m-%d %H:%i'), j.create_user HAVING gds >= 5 ORDER BY MIN(j.id)")
for x in rows:
    per = (float(x["last_s"]) / int(x["gds"])) if x["last_s"] is not None else None
    print(f"  {x['t']} {x['batch']}: {x['gds']} GDs, last after {x['last_s']} s" + (f", {per:.1f} s per GD" if per else "") + (f", {x['not_done']} not completed yet" if int(x["not_done"]) else ""))
if not rows:
    print("  no bulk convert since the paste yet")
