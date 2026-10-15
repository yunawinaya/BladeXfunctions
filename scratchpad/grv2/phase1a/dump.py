"""Readable dump of every node of a workflow JSON: code bodies, sql, filters, props, workflow-node params, end values."""
import json, sys


def rules_str(rules, depth=0):
    out = []
    for r in (rules or {}).get("list", []) if isinstance(rules, dict) else (rules or []):
        if r.get("type") == "branch":
            out.append("  " * depth + "BRANCH " + str(r.get("operator")))
            out.extend(rules_str({"list": r.get("children") or []}, depth + 1))
        else:
            out.append("  " * depth + "%s %s %s(%s)" % (r.get("prop"), r.get("operator"), r.get("value"), r.get("valueType")))
    return out


def dump(n, depth, out):
    d = n.get("data") or {}
    ind = "  " * depth
    out.append("%s### %s [%s] %s" % (ind, n.get("id"), n.get("type"), d.get("title", "")))
    t = n.get("type")
    if t == "code-node":
        out.append(ind + "  returns: " + ", ".join(r.get("name", "") for r in d.get("response_json") or []))
        out.append(ind + "  ---code---")
        for line in (d.get("script") or {}).get("code", "").split("\n"):
            out.append(ind + "  | " + line)
    elif t == "sql-node":
        out.append(ind + "  returns: " + ", ".join(r.get("name", "") for r in d.get("response_json") or []))
        for line in (d.get("script") or {}).get("code", "").split("\n"):
            out.append(ind + "  | " + line)
    elif t in ("get-node", "search-node", "update-node", "add-node", "delete-node"):
        tid = d.get("table_id") or {}
        out.append(ind + "  table: %s  limit=%s" % (tid.get("source"), d.get("limit")))
        for line in rules_str(tid.get("rules")):
            out.append(ind + "  where: " + line)
        for p in (d.get("props") or {}).get("list", []) or []:
            out.append(ind + "  prop %s = %s" % (p.get("prop"), p.get("value")))
        if d.get("of") or d.get("delete_source"):
            out.append(ind + "  of: " + json.dumps(d.get("of") or d.get("delete_source"))[:300])
        extra = {k: v for k, v in d.items() if k not in ("table_id", "props", "title", "isValidator", "nodeName", "name", "limit", "fields", "condition")}
        if extra:
            out.append(ind + "  extra: " + json.dumps(extra, ensure_ascii=False)[:600])
    elif t == "workflow-node":
        out.append(ind + "  workflow: " + str((d.get("workflow") or {}).get("source")))
        for p in (d.get("body_params") or {}).get("list", []) or []:
            out.append(ind + "  param %s = %s" % (p.get("prop"), p.get("value")))
    elif t == "if":
        out.append(ind + "  cond_type=%s expr=%s" % (d.get("condition_type"), (d.get("expression") or {}).get("code")))
        for line in rules_str(d.get("filter")):
            out.append(ind + "  filter: " + line)
    elif t in ("condition-or-node-item", "condition-all-node-item"):
        out.append(ind + "  cond_type=%s expr=%s" % (d.get("condition_type"), (d.get("expression") or {}).get("code")))
        for line in rules_str(d.get("filter")):
            out.append(ind + "  filter: " + line)
    elif t in ("end-node", "return-node"):
        out.append(ind + "  status=%s back=%s raw=%s" % (d.get("status_code"), d.get("back_data_type"), d.get("return_raw_data")))
        for p in (d.get("response_value") or {}).get("list", []) or []:
            out.append(ind + "  %s = %s" % (p.get("prop"), p.get("value")))
        extra = {k: v for k, v in d.items() if k not in ("title", "isValidator", "nodeName", "name", "response_value", "status_code", "back_data_type", "return_raw_data")}
        if extra:
            out.append(ind + "  extra: " + json.dumps(extra, ensure_ascii=False)[:800])
    elif t == "slot-node":
        out.append(ind + "  slot: " + json.dumps(d, ensure_ascii=False)[:3000])
    for b in n.get("blocks") or []:
        dump(b, depth + 1, out)


if __name__ == "__main__":
    wf = json.load(open(sys.argv[1]))
    out = ["REQUEST: " + json.dumps(wf.get("request_json"), ensure_ascii=False)[:3000], "RESPONSE: " + json.dumps(wf.get("response_json"), ensure_ascii=False)[:3000]]
    for n in wf["nodes"]:
        dump(n, 0, out)
    print("\n".join(out))
