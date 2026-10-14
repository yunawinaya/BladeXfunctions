"""Turn a compiled workflow's sql-nodes from `?` + params (which this backend never binds) into the inline-token form
the runtime executes: each `?` becomes '<token>' in order, params is emptied. Everything else is left as compiled.

usage: python3 inline_sql.py --dev <workflow id> <out.json>      (reads the enabled version)
"""
import json, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "pkv2tools"))
from dbq import q  # noqa: E402


def inline(node):
    d = node["data"]
    code = d["script"]["code"]
    params = d.get("params") or []
    if isinstance(params, dict):
        params = []
    marks = [m.start() for m in re.finditer(r"\?", code)]
    if len(marks) != len(params):
        raise ValueError(f"{node['id']}: {len(marks)} '?' but {len(params)} params")
    for tok in params:
        if not re.fullmatch(r"\{\{node:[A-Za-z0-9_.]+\}\}", tok):
            raise ValueError(f"{node['id']}: param {tok!r} is not a node token")
    out, last = [], 0
    for pos, tok in zip(marks, params):
        out.append(code[last:pos])
        out.append("'" + tok + "'")
        last = pos + 1
    out.append(code[last:])
    d["script"]["code"] = "".join(out)
    d["params"] = {}
    return len(params)


def main():
    env, wid, out = sys.argv[1], sys.argv[2], sys.argv[3]
    row = q(env, f"SELECT version_number, script_json FROM su_code_workflow_history WHERE data_id={int(wid)} AND status='enabled' ORDER BY version_number DESC LIMIT 1")[0]
    d = json.loads(row["script_json"])
    n = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("type") == "sql-node":
                n.append((o["id"], inline(o)))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(d)
    json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"from enabled v{row['version_number']}: {len(n)} sql-nodes inlined ({sum(c for _, c in n)} params) -> {out}")


if __name__ == "__main__":
    main()
