"""COMMIT phase A's lookups (sql_node_SCfind / SCfind2), base against build, read-only on the database.

For each recorded COMMIT run: the values its placeholders had (from the run's code-node outputs) go into the base and the
built SQL; the base SQL must equal what the run recorded (so the substitution is the platform's), the two must return the
same rows, and the build's plan must read no sales_order rows for an edit and use the unique key / primary key for a new SO.
Probes (optional) are parameter sets that make a branch match real rows.

usage: python3 scratchpad/sosave_perf/test/sql_parity.py --dev|--prod <runs.json> [<probes.json>] [--analyze]
  runs.json: [{id, nodes_data}] COMMIT runs (keep prod data out of the repo); probes.json: [{label, values: {placeholder: value}}]
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(os.path.dirname(os.path.dirname(ROOT)), ".dbtools", "db")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
ENV = "--prod" if "--prod" in sys.argv else "--dev"
ANALYZE = "--analyze" in sys.argv
NODES = ("sql_node_SCfind", "sql_node_SCfind2")


def sql_of(file, node_id):
    def walk(nodes):
        for n in nodes:
            if n["id"] == node_id:
                return n["data"]["script"]["code"]
            hit = walk(n.get("blocks") or [])
            if hit:
                return hit
    return walk(json.load(open(os.path.join(ROOT, file)))["nodes"])


BASE = {n: sql_of("base/SO_SAVE_COMMIT.v10.json", n) for n in NODES}
NEW = {n: sql_of("out/SO_SAVE_COMMIT.json", n) for n in NODES}


def fill(sql, values):
    # the platform pastes each placeholder's value in as raw text
    return re.sub(r"\{\{([^}]+)\}\}", lambda m: str(values.get(m.group(1), "null")), sql)


def q(sql, explain=False):
    out = subprocess.run([DB, ENV, "--json", ("EXPLAIN ANALYZE " if explain == "analyze" else "EXPLAIN " if explain else "") + sql],
                         capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f"query failed: {out.stderr[-400:]}\n{sql[:600]}")
    return json.loads(out.stdout)


def rowset(rows):
    return sorted(json.dumps({k: r.get(k) for k in ("id", "so_no", "kind", "lock_ref")}, sort_keys=True) for r in rows)


def values_of(nodes_data):
    """placeholder -> value, from the run's code-node outputs"""
    vals = {}
    for n in json.loads(nodes_data or "[]"):
        if n.get("node_id") in ("code_node_SCguard", "code_node_SCgate", "code_node_SCa") and n.get("node_type") == "code-node":
            try:
                data = json.loads(n["response_json_data"])["data"]
            except Exception:
                continue
            for k, v in data.items():
                if isinstance(v, (str, int, float)):
                    vals[f"node:{n['node_id']}.data.{k}"] = v
    return vals


def plan_ok(plan, is_edit):
    """edit: no sales_order rows read; new SO: sales_order only through the unique key or the primary key"""
    s_rows = [r for r in plan if r.get("table") == "s"]
    if is_edit:
        return not s_rows and any("Impossible" in str(r.get("Extra")) for r in plan), s_rows
    # idx_tenant_deleted_status leads with id: a range on it is the same id range as on the primary key
    bad = [r for r in s_rows if r.get("key") not in ("Document Number", "PRIMARY", "idx_tenant_deleted_status")
           or r.get("type") not in ("const", "eq_ref", "ref", "range")]
    return not bad, bad


failures = 0
cases = 0
for r in (json.load(open(args[0])) if args else []):
    recorded = {n["node_id"]: n.get("request_json_data") for n in json.loads(r["nodes_data"] or "[]") if n.get("node_id") in NODES}
    vals = values_of(r["nodes_data"])
    for node in NODES:
        if node not in recorded:
            continue
        cases += 1
        old = fill(BASE[node], vals)
        if old.strip() != (recorded[node] or "").strip():
            print(f"FAIL run {r['id']} {node}: the base SQL with the run's values is not what the run recorded")
            failures += 1
            continue
        new = fill(NEW[node], vals)
        same = rowset(q(old)) == rowset(q(new))
        is_edit = str(vals.get("node:code_node_SCgate.data.isEdit")) == "YES"
        good, why = plan_ok(q(new, explain=True), is_edit)
        # an edit's lookup can never match (its temporary number names no SO, its draftSince is the sentinel): what the
        # run itself got back at the time must be empty
        resp = next((n for n in json.loads(r["nodes_data"] or "[]") if n.get("node_id") == node), {})
        try:
            got_then = json.loads(resp.get("response_json_data") or "{}").get("data") or []
        except Exception:
            got_then = None
        then_ok = not is_edit or got_then == []
        if not (same and good and then_ok):
            failures += 1
            print(f"FAIL run {r['id']} {node} ({'edit' if is_edit else 'new SO'}): same rows {same}, plan ok {good}, edit matched nothing then {then_ok} {json.dumps(why)[:300]}")
print(f"recorded cases: {cases}, failed {failures}")

probe_fail = 0
for p in (json.load(open(args[1])) if len(args) > 1 else []):
    for node in NODES:
        old, new = fill(BASE[node], p["values"]), fill(NEW[node], p["values"])
        a, b = rowset(q(old)), rowset(q(new))
        is_edit = str(p["values"].get("node:code_node_SCgate.data.isEdit")) == "YES"
        good, why = plan_ok(q(new, explain=True), is_edit)
        ok = a == b and good and (len(a) > 0) == p.get("expect_rows", True)
        if not ok:
            probe_fail += 1
        timing = ""
        if ANALYZE:
            t = lambda sql: re.findall(r"actual time=[0-9.]+\.\.([0-9.]+)", json.dumps(q(sql, explain="analyze")))
            timing = f"  old {max(map(float, t(old) or ['0'])):.1f} ms / new {max(map(float, t(new) or ['0'])):.1f} ms"
        print(f"{'ok  ' if ok else 'FAIL'} probe {p['label']} {node}: rows old {len(a)} new {len(b)} same {a == b}, plan ok {good}{timing}")
print(f"probes failed: {probe_fail}")
raise SystemExit(1 if failures or probe_fail or (not cases and len(args) < 2) else 0)
