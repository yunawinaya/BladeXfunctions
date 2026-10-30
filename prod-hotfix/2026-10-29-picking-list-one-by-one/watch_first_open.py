"""Read-only: every 60 s, the Picking list opens since the paste (a PICKING_ASYNC_WORKER run with job_id "", then the same
user's GD_EDIT_WORKER job_id "" and GD_COMPLETE_WORKER runs). Prints each open's gaps; exits on the first one-by-one open.
usage: python3 watch_first_open.py [--minutes 40]"""
import datetime, json, os, subprocess, sys, time

DB = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".dbtools", "db"))
PK, ED, GDC = "2109531412499251201", "2110618789356687361", "2110182645714518018"
SINCE = (int(datetime.datetime(2026, 10, 29, 2, 31, 46, tzinfo=datetime.timezone.utc).timestamp() * 1000) - 1288834974657) << 22


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    return None if out.returncode else json.loads(out.stdout[out.stdout.find("["):])


def params(r):
    try:
        return json.loads(r).get("workflowparams") or {}
    except Exception:
        return {}


minutes = float(sys.argv[sys.argv.index("--minutes") + 1]) if "--minutes" in sys.argv else 40
seen = set()
end = time.time() + minutes * 60
while time.time() < end:
    rows = q("SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, create_user_name u, tenant_id t, "
             "UNIX_TIMESTAMP(create_time) * 1000 ms, request_json_data r FROM su_code_workflow_inst "
             f"WHERE id > {SINCE} AND workflow_id IN ({PK}, {ED}, {GDC}) ORDER BY id")
    if rows is None:
        time.sleep(60)
        continue
    for r in rows:
        r["p"] = params(r["r"])
        r["ms"] = float(r["ms"])
    opens = [r for r in rows if r["wf"] == PK and r["p"].get("job_id") == ""]
    for o in opens:
        if o["id"] in seen:
            continue
        later = [r for r in rows if r["u"] == o["u"] and r["t"] == o["t"] and r["ms"] >= o["ms"] - 500 and r["ms"] <= o["ms"] + 130000 and r is not o]
        ed = next((r for r in later if r["wf"] == ED and r["p"].get("job_id") == ""), None)
        gdc = next((r for r in later if r["wf"] == GDC and (not ed or r["ms"] >= ed["ms"] - 500)), None)
        if not ed and time.time() * 1000 - o["ms"] < 70000:
            continue  # its GD Edit may still come
        seen.add(o["id"])
        g1 = (ed["ms"] - o["ms"]) / 1000 if ed else None
        g2 = (gdc["ms"] - ed["ms"]) / 1000 if ed and gdc else None
        kind = "TOGETHER (an old tab)" if g1 is not None and abs(g1) < 0.5 else "ONE BY ONE" if g1 is not None and g1 >= 0.9 else "no GD Edit seen"
        at = datetime.datetime.fromtimestamp(o["ms"] / 1000, datetime.timezone(datetime.timedelta(hours=8))).strftime("%H:%M:%S")
        print(f"{at} {o['t']} {o['u']}: {kind}; GD Edit +{g1 if g1 is not None else '-'} s, sweep +{g2 if g2 is not None else '- (throttled or none)'} s", flush=True)
        if kind == "ONE BY ONE":
            sys.exit(0)
    time.sleep(60)
print("no one-by-one open seen", flush=True)
