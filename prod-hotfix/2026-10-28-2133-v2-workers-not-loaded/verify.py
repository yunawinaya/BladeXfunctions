"""verify.py: after the pastes, is each enabled prod version the paste, and do its latest runs complete?

  python3 verify.py
"""
import datetime
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rename_stuck_nodes import HERE, REPO, STUCK, enabled  # noqa: E402

EPOCH = 1288834974657


def db(sql):
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), "--prod", "--json", sql],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


def canon(o):
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def main():
    since = int((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=20)).timestamp() * 1000)
    bound = (since - EPOCH) << 22
    for name, wf_id, old, new in STUCK:
        row = enabled(wf_id)
        live = canon(json.loads(row["script_json"]))
        paste = canon(json.load(open(os.path.join(HERE, f"{name}.json"), encoding="utf-8")))
        state = "= the paste" if live == paste else "not pasted" if old in live else "CHANGED since the build: rebuild"
        print(f"{name}: enabled v{row['version_number']} {state}; latest runs: {latest(wf_id, bound)}")


def latest(wf_id, bound):
    runs = db(f"SELECT DATE_FORMAT(create_time, '%H:%i:%s') AS t, status, LEFT(IFNULL(error_msg, ''), 60) AS err "
              f"FROM su_code_workflow_inst WHERE workflow_id = '{wf_id}' AND id >= {bound} ORDER BY id DESC LIMIT 6")
    return ", ".join(f"{r['t']} {r['status']}" + (" (not loaded)" if "is not loaded" in r["err"] else "") for r in runs) or "none"


if __name__ == "__main__":
    sys.exit(main())
