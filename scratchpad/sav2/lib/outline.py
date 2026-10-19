"""Print a workflow's node tree: id, type, title; for db nodes the table and a short config summary."""
import json, sys

def title(n):
    d = n.get("data") or {}
    return d.get("title") or d.get("name") or d.get("nodeName") or ""

def summ(n):
    d = n.get("data") or {}
    t = n.get("type", "")
    out = []
    for k in ("tableId", "tableName", "workflowId", "workflowName"):
        if d.get(k):
            out.append(f"{k}={d[k]}")
    if t == "sql-node":
        sql = (d.get("sql") or d.get("script", {}).get("code") or d.get("sqlContent") or "")
        out.append("SQL: " + " ".join(str(sql).split())[:300])
    return " ".join(out)

def walk(nodes, depth, lines):
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        lines.append("  " * depth + f"{n.get('id')} [{n.get('type')}] {title(n)}  {summ(n)}")
        # condition-like children
        d = n.get("data") or {}
        for key in ("blocks",):
            if isinstance(n.get(key), list):
                walk(n[key], depth + 1, lines)
        for key in ("items", "conditions", "branches"):
            for it in d.get(key) or []:
                if isinstance(it, dict):
                    lines.append("  " * (depth + 1) + f"<{key[:-1]} {it.get('id', '')} {it.get('name', '') or it.get('title', '')}>")
                    walk(it.get("blocks") or it.get("nodes") or [], depth + 2, lines)

if __name__ == "__main__":
    wf = json.load(open(sys.argv[1]))
    lines = []
    walk(wf.get("nodes"), 0, lines)
    print("\n".join(lines))
