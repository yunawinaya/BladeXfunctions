"""Runs every sql-node of built workflow JSON READ-ONLY on dev (.dbtools/db refuses anything but a read) with the
{{node:...}} placeholders filled from a per-workflow dict, and checks the returned columns against the node's
response_json. Generic part of scratchpad/grv2/sqlcheck_grv2.py (same fill / walk / report; the values are an argument).

usage: python3 sqlcheck.py <dir with built JSON> <values.json> [NAME ...]
values.json: { "*": { "<last path segment>": "<text>", ... },          (every workflow)
               "<WORKFLOW NAME>": { ... },                           (overrides for that file)
               "missing_cols": { "<sql text>": "<replacement>" } }   (optional: columns dev does not have yet)
A placeholder {{node:x.data.key}} is filled by the value of its LAST segment ("key"); a missing value fails that node.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q  # noqa: E402


def fill(sql, vals, missing_cols=None):
    def rep(m):
        key = m.group(1).split(".")[-1]
        if key not in vals:
            raise KeyError(m.group(1))
        return vals[key]
    sql = re.sub(r"\{\{node:([^}]+)\}\}", rep, sql)
    for a, b in (missing_cols or {}).items():
        sql = sql.replace(a, b)
    return sql


def walk(n, out):
    if isinstance(n, dict):
        if n.get("type") == "sql-node":
            out.append(n)
        for v in n.values():
            walk(v, out)
    elif isinstance(n, list):
        for v in n:
            walk(v, out)


def run(json_dir, values, want=(), env="--dev", printer=print):
    """values: {"*": {...}, "<NAME>": {...}, "missing_cols": {...}}; returns the problem count"""
    bad = 0
    base = values.get("*", {})
    missing = values.get("missing_cols", {})
    for f in sorted(os.listdir(json_dir)):
        if not f.endswith(".json") or (want and f[:-5] not in want):
            continue
        name = f[:-5]
        vals = dict(base, **values.get(name, {}))
        nodes = []
        walk(json.load(open(os.path.join(json_dir, f), encoding="utf-8")), nodes)
        for n in nodes:
            declared = [r["name"] for r in n["data"]["response_json"]]
            try:
                rows = q(env, fill(n["data"]["script"]["code"], vals, missing))
                cols = list(rows[0].keys()) if rows else []
                miss = [c for c in cols if c not in declared]
                extra = [c for c in declared if rows and c not in cols]
                bad += bool(miss or extra)
                printer("%s %-20s %-26s rows=%-5d %s%s" % ("ok  " if not miss and not extra else "COLS", name[:20], n["id"], len(rows),
                                                          ("undeclared " + str(miss)) if miss else "", (" unreturned " + str(extra)) if extra else ""))
            except BaseException as e:
                bad += 1
                printer("FAIL %-20s %-26s %s" % (name[:20], n["id"], str(e)[:400]))
    printer("problems: %d" % bad)
    return bad


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(1 if run(sys.argv[1], json.load(open(sys.argv[2], encoding="utf-8")), sys.argv[3:]) else 0)
