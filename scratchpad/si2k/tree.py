"""tree.py <workflow json>: node tree in run order - type, id, title; loops with their source; workflow-nodes with the callee; reads with their table."""
import json, sys
doc = json.load(open(sys.argv[1]))
def callee(d):
    w = d.get("workflow")
    if isinstance(w, dict) and w.get("source"):
        return "-> " + w["source"].split(":")[0]
    for k in ("workflowId", "workflow_id", "workflowName", "subWorkflowId", "workflow"):
        if d.get(k):
            return "%s=%s" % (k, d[k] if not isinstance(d[k], dict) else d[k].get("name") or d[k].get("id"))
    return ",".join(k for k in d.keys() if "flow" in k.lower())
def table(d):
    for k in ("tableName", "table_name", "table", "collection", "dataSource"):
        v = d.get(k)
        if v:
            return "%s=%s" % (k, v if not isinstance(v, dict) else (v.get("name") or v.get("tableName") or v.get("value")))
    return ""
def walk(nodes, depth=0):
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        t, d = n.get("type"), n.get("data") or {}
        extra = ""
        if t == "workflow-node":
            extra = callee(d)
        elif t in ("search-node", "get-node", "add-node", "update-node", "delete-node", "sql-node"):
            extra = table(d)
        elif t == "loop":
            extra = json.dumps({k: v for k, v in d.items() if k not in ("title",)}, ensure_ascii=False)[:300]
        elif t in ("set-cache-node", "get-cache-node"):
            extra = json.dumps({k: v for k, v in d.items() if k not in ("title",)}, ensure_ascii=False)[:200]
        print("%s%-24s %-28s %s  %s" % ("  " * depth, t, n.get("id"), (d.get("title") or "")[:50], extra))
        walk(n.get("blocks"), depth + 1)
walk(doc["nodes"])
