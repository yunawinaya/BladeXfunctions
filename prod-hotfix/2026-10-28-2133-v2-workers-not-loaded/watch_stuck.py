"""watch_stuck.py: read-only; every 2 min, any prod run that failed "script for node[X] is not loaded" in the last 3 min.
On the first hit it names each stuck workflow and the paste in this folder that fixes it, then exits.

  python3 watch_stuck.py [--hours 12]
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rename_stuck_nodes import HERE, REPO, STUCK, enabled  # noqa: E402

EPOCH = 1288834974657
MYT = datetime.timezone(datetime.timedelta(hours=8))


def db(sql):
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), "--prod", "--json", sql],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


def canon(o):
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def bound(minutes):
    ms = int((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)).timestamp() * 1000)
    return (ms - EPOCH) << 22


def todo(node):
    for name, wf_id, old, new in STUCK:
        if old == node:
            base = [f for f in os.listdir(HERE) if f.startswith(name + ".prod_v") and f.endswith(".base.json")][0]
            same = canon(json.loads(enabled(wf_id)["script_json"])) == canon(json.load(open(os.path.join(HERE, base), encoding="utf-8")))
            return f"paste {name}.json ({old} -> {new})" if same else f"{name} changed since the build: rebuild, then paste"
        if new == node:
            return "stuck on the NEW id too: rename again"
    return "no paste in this folder: build one"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=12)
    end = time.time() + ap.parse_args().hours * 3600
    errors = 0
    while time.time() < end:
        try:
            rows = db("SELECT w.name, SUBSTRING_INDEX(SUBSTRING_INDEX(i.error_msg, 'node[', -1), ']', 1) AS node, COUNT(*) AS n, "
                      "GROUP_CONCAT(DISTINCT i.tenant_id) AS tenants, DATE_FORMAT(MIN(i.create_time), '%H:%i:%s') AS since "
                      "FROM su_code_workflow_inst i JOIN su_code_workflow w ON w.id = i.workflow_id "
                      f"WHERE i.id > {bound(3)} AND i.status = 'Fail' AND i.error_msg LIKE '%is not loaded%' GROUP BY w.name, node")
            errors = 0
        except subprocess.CalledProcessError as e:
            # a failed read (timeout, connection) is retried next round; only a run of them stops the watch
            errors += 1
            print(f"{datetime.datetime.now(MYT).strftime('%H:%M:%S')} read failed ({errors}): {(e.stderr or '').strip()[-200:]}", flush=True)
            if errors >= 5:
                return 2
            time.sleep(120)
            continue
        if rows:
            now = datetime.datetime.now(MYT).strftime("%H:%M:%S")
            for r in rows:
                print(f"{now} STUCK {r['name']} on {r['node']} since {r['since']} ({r['n']} runs, tenants {r['tenants']}): "
                      f"{todo(r['node'])}", flush=True)
            return 1
        time.sleep(120)
    print("no stuck workflow within the watch", flush=True)


if __name__ == "__main__":
    sys.exit(main())
