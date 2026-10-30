"""Read-only: after a backend JVM start (MYT), did any workflow get stuck on "script for node[X] is not loaded"?
Per group (the six GD workers, the reorder pair): their first runs since the start, how many ran at once (overlapping
start..end), and how many of them failed "is not loaded" since. Five or six GD first runs at once is the old trigger.

  python3 -I scratchpad/restart_check/check_after_restart.py --dev "2026-10-29 21:24:30"
  JVM start = status endpoint timestamp - uptime (ms): https://dev.mes.sudu.ai/api/su-code-service/test/status
"""
import datetime, json, os, subprocess, sys

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".dbtools", "db")
EPOCH = 1288834974657
MYT = datetime.timezone(datetime.timedelta(hours=8))
GROUPS = {"GD workers": ("GD_ASYNC_WORKER", "GD_PICKING_OUTBOX_CONSUMER", "GD_COMPLETE_WORKER", "GD_CANCEL_WORKER",
                         "GD_REVERT_WORKER", "GD_EDIT_WORKER"),
          "reorder pair": ("TRIGGER_REORDER", "PROCESS_REORDER")}

env = "--prod" if "--prod" in sys.argv else "--dev"
start = datetime.datetime.strptime(sys.argv[-1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=MYT)
lo = (int(start.timestamp() * 1000) - EPOCH) << 22


def q(sql):
    out = subprocess.run([DB, env, "--json", sql], capture_output=True, text=True, check=True)
    return json.loads(out.stdout[out.stdout.find("["):])


def at_once(iv):
    cur = best = 0
    for _, d in sorted([(s, 1) for s, e in iv] + [(e, -1) for s, e in iv], key=lambda x: (x[0], x[1])):
        cur += d
        best = max(best, cur)
    return best


stuck = q("SELECT workflow_name, SUBSTRING_INDEX(SUBSTRING_INDEX(error_msg, 'node[', -1), ']', 1) node, COUNT(*) n, "
          "DATE_FORMAT(MIN(create_time), '%m-%d %H:%i:%s') first, DATE_FORMAT(MAX(create_time), '%m-%d %H:%i:%s') last "
          f"FROM su_code_workflow_inst WHERE id >= {lo} AND error_msg LIKE '%is not loaded%' GROUP BY workflow_name, node")
print(f"{env[2:].upper()} since {sys.argv[-1]}: {len(stuck)} workflow(s) stuck on 'is not loaded'")
for r in stuck:
    print(f"  STUCK {r['workflow_name']} on {r['node']}: {r['n']} runs {r['first']} .. {r['last']}")
for g, names in GROUPS.items():
    inl = "(" + ",".join(f"'{n}'" for n in names) + ")"
    rows = q("SELECT i.workflow_name, i.start_date, i.end_date, DATE_FORMAT(i.create_time, '%m-%d %H:%i:%s') t FROM su_code_workflow_inst i "
             f"JOIN (SELECT workflow_name, MIN(id) id FROM su_code_workflow_inst WHERE id >= {lo} AND workflow_name IN {inl} "
             "GROUP BY workflow_name) f ON f.id = i.id ORDER BY i.start_date")
    iv = [(int(r["start_date"]), int(r["end_date"] or r["start_date"])) for r in rows]
    n_stuck = sum(1 for r in stuck if r["workflow_name"] in names)
    when = f", first at {rows[0]['t']}" if rows else ""
    print(f"  {g}: {len(rows)} of {len(names)} first-ran{when}, max {at_once(iv) if iv else 0} at once; stuck {n_stuck}")
