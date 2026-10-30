"""rename_stuck_nodes.py: prod pastes for the five GD V2 workers stuck on "script for node[X] is not loaded" since 21:33:34
on 2026-10-28, after the prod backend restart at 21:31:41 MYT. Same platform bug and same fix as the morning's
../2026-10-28-v2-workers-not-loaded/ (memory: project_lowcode_script_not_loaded_after_restart): a republish under the
same node id does not clear it, a new node id does.

Each paste is the DEPLOYED prod version with only that node id renamed, everywhere it occurs (the node's id, the
{{node:...}} references, condition props). Nothing else changes.

  python3 rename_stuck_nodes.py     # writes <NAME>.prod_v<N>.base.json (deployed) + <NAME>.json (paste), checks each
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

STUCK = [  # (name, workflow id, stuck node id, new node id), in paste order
    ("GD_ASYNC_WORKER", "2104840667119411201", "code_node_1OvNTk9G3", "code_node_1OvNTk9G4"),
    ("GD_PICKING_OUTBOX_CONSUMER", "2105134245397041153", "code_node_3wpgxjXW4", "code_node_3wpgxjXW5"),
    ("GD_COMPLETE_WORKER", "2110182645714518018", "code_node_GWguard3", "code_node_GWguard4"),
    ("GD_CANCEL_WORKER", "2112455700319932418", "code_node_XWguard3", "code_node_XWguard4"),
    ("GD_REVERT_WORKER", "2112758130420088833", "code_node_RWguard4", "code_node_RWguard5"),
    ("GD_EDIT_WORKER", "2110618789356687361", "code_node_GEWguard2", "code_node_GEWguard3"),  # stuck 23:24-02:19 only
]


def enabled(wf_id):
    sql = ("SELECT version_number, create_time, script_json FROM su_code_workflow_history "
           f"WHERE data_id = {wf_id} AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), "--prod", "--json", sql],
                         capture_output=True, text=True, check=True).stdout
    rows = json.loads(out[out.find("["):])
    assert len(rows) == 1, f"{wf_id}: no enabled version"
    return rows[0]


def node_ids(o, acc):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str):
            acc.append(o["id"])
        for v in o.values():
            node_ids(v, acc)
    elif isinstance(o, list):
        for v in o:
            node_ids(v, acc)
    return acc


def token(node_id):
    return re.compile(r"(?<![A-Za-z0-9_])" + re.escape(node_id) + r"(?![A-Za-z0-9_])")


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def main():
    for name, wf_id, old, new in STUCK:
        row = enabled(wf_id)
        live = json.loads(row["script_json"])
        text = dump(live)
        ids = node_ids(live, [])
        assert ids.count(old) == 1, f"{name}: {old} is not exactly one node ({ids.count(old)})"
        assert new not in text, f"{name}: {new} already occurs"
        n_old = len(token(old).findall(text))
        renamed = token(old).sub(new, text)
        paste = json.loads(renamed)
        assert node_ids(paste, []).count(new) == 1 and not token(old).findall(renamed)
        assert len(token(new).findall(renamed)) == n_old
        # the rename is the only difference
        assert dump(json.loads(token(new).sub(old, renamed))) == text
        base_file = os.path.join(HERE, f"{name}.prod_v{row['version_number']}.base.json")
        paste_file = os.path.join(HERE, f"{name}.json")
        open(base_file, "w", encoding="utf-8").write(text)
        open(paste_file, "w", encoding="utf-8").write(renamed)
        print(f"{name} ({wf_id}): prod enabled v{row['version_number']} ({str(row['create_time'])[:19]}); "
              f"{old} -> {new}, {n_old} occurrence(s)")


if __name__ == "__main__":
    sys.exit(main())
