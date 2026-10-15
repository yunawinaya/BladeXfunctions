#!/usr/bin/env python3
"""BUG-20261013-019 (Ascent AJ-08/2026-002): a document can be queued for accounting posting twice.

ACC_PRODUCER inserted every post_* request as a new PENDING task with no server-side check. The Stock
Adjustment form and list both pre-write posted_status "Pending Post" and call it; the list skips rows only by
its own stale copy of posted_status. A second click 10.5 s later queued the same AJs while the first task was
PROCESSING, and the agent posted both (SQL docKey 722 twice).

Fix, post_* requests only (every post_* payload is a JSON array of document ids; sync_* / free_query untouched):
- Drop ids already held by an in-flight task of the same agent + task_type: PROCESSING, or PENDING and still in
  the agent's Redis queue (a PENDING task that fell out of the queue is never polled, so it holds nothing).
- post_aj: also drop Stock Adjustments already "Fully Posted" (set only by the success callback) and put their
  posted_status back to "Posted", which the client overwrote with "Pending Post" before calling.
- Nothing left -> return without a task. Otherwise queue only the remaining ids, through a new branch whose add
  node is a copy of the default "Add Tasks" with the filtered payload.

  python3 build.py          # fetch enabled ACC_PRODUCER from prod and dev, patch, write ACC_PRODUCER.<env>.json
  python3 build.py --check  # same, print the node-level summary only
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WF_ID = 2013511169625042946

TASKS_TABLE = ("Integration Tasks:Table:2013513133809217537", "2013513133809217537")
SA_TABLE = ("Stock Adjustment:Table:1902274108952006658", "1902274108952006658")

IDS_CODE = """const taskType = {{workflowparams:task_type}};
const raw = {{workflowparams:payload}};

let ids = [];
if (typeof taskType === "string" && taskType.indexOf("post_") === 0) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw == null ? "" : raw);
  if (text.trim().indexOf("[") === 0) ids = text.match(/\\d{6,}/g) || [];
}

return {
  isPost: ids.length > 0 ? "Yes" : "No",
  ids: ids,
  ajIds: taskType === "post_aj" && ids.length > 0 ? ids : ["0"],
};"""

DECIDE_CODE = """const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const idsIn = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)).match(/\\d{6,}/g) || [];

const ids = {{node:code_node_PostGuardIds.data.ids}} || [];
const inflight = asList({{node:search_node_PostInflight.data.data}});
const posted = asList({{node:search_node_PostAjPosted.data.data}});

// A PENDING task that dropped out of the agent's Redis queue is never polled, so it no longer holds its documents.
const queued = new Set(idsIn({{node:get_cache_node_U9UnzO9f.data}}));
const busy = new Set();
for (const task of inflight) {
  if (task.status === "PROCESSING" || queued.has(String(task.id))) {
    idsIn(task.payload).forEach((id) => busy.add(id));
  }
}
const done = new Set(posted.map((row) => String(row.id)));

const keep = ids.filter((id) => !busy.has(id) && !done.has(id));
const restore = ids.filter((id) => done.has(id));

return {
  proceed: keep.length > 0 ? "Yes" : "No",
  payload: JSON.stringify(keep),
  hasRestore: restore.length > 0 ? "Yes" : "No",
  restoreIds: restore.length > 0 ? restore : ["0"],
  skipped: ids.filter((id) => !keep.includes(id)).join(","),
};"""

REMAP_OLD = "               || {{node:add_node_Y5qUEWZx.data.id}}\n"
REMAP_NEW = REMAP_OLD + "               || {{node:add_node_PostGuardTask.data.id}}\n"


def field(key, name, bson="string"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False}


def array_field(key, item_key, name):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": "array", "isExpand": True,
            "children": [{"key": item_key, "name": "items", "title": "", "description": "", "bsonType": "string",
                          "isExpand": False, "isArrayItem": True, "children": []}]}


def code_node(nid, title, code, response):
    return {"id": nid, "type": "code-node", "data": {
        "language": "javascript", "code": "", "timeout": 30000, "title": title, "isValidator": True,
        "nodeName": title, "name": title, "script": {"type": "javascript", "code": code}, "response_json": response},
        "blocks": []}


def leaf(lid, parent, prop, op, value, value_type="value", level=1, top=True, label=""):
    return {"id": lid, "parentId": parent, "isTop": top, "prop": prop, "operator": op, "valueType": value_type,
            "value": value, "type": "leaf", "level": level, "propLabel": label or prop, "valueLabel": "",
            "operatorLabel": op}


def if_node(nid, title, prop, value, true_blocks, lid):
    return {"id": nid, "type": "if", "data": {
        "title": title, "isValidator": True, "nodeName": title, "name": title, "condition_type": "ConditionRule",
        "expression": {"type": "javascript", "code": ""},
        "filter": {"list": [leaf(lid, lid - 1, prop, "equal", value)]}},
        "blocks": [{"id": nid + "_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_blocks},
                   {"id": nid + "_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


def search_node(nid, title, table, children):
    return {"id": nid, "type": "search-node", "data": {
        "table_id": {"source": table[0], "rules": {"collectionId": table[1], "list": [
            {"id": children[0]["parentId"], "parentId": children[0]["parentId"] + 100000, "isTop": True, "prop": "",
             "operator": "all", "valueType": "value", "value": "", "type": "branch", "level": 1, "propLabel": "",
             "valueLabel": "", "operatorLabel": "all", "children": children}]}},
        "condition": {}, "limit": 500, "title": title, "isValidator": True, "nodeName": title, "name": title},
        "blocks": []}


def parallel_item(nid, title, lid, blocks):
    return {"id": nid, "type": "condition-all-node-item", "data": {
        "title": title, "filter": {"list": [{"id": lid, "parentId": lid - 1, "isTop": True, "prop": "",
                                             "operator": "", "valueType": "", "value": "", "type": "leaf", "level": 1}]},
        "expression": {"code": "true", "type": "javascript"}, "displayContent": "sdk.form.setCondition",
        "isValidator": True, "nodeName": title, "name": title, "condition_type": "Expression"}, "blocks": blocks}


def guard_nodes():
    inflight = search_node("search_node_PostInflight", "Post Guard: In-flight Tasks", TASKS_TABLE, [
        leaf(1792100000011, 1792100000010, "agent_id", "equal", "{{workflowparams:agent_id}}", "field", 2, False),
        leaf(1792100000012, 1792100000010, "task_type", "equal", "{{workflowparams:task_type}}", "field", 2, False),
        {"id": 1792100000015, "parentId": 1792100000010, "isTop": False, "prop": "", "operator": "any",
         "valueType": "value", "value": "", "type": "branch", "level": 2, "propLabel": "", "valueLabel": "",
         "operatorLabel": "any", "children": [
             leaf(1792100000013, 1792100000015, "status", "equal", "PENDING", "value", 3, False),
             leaf(1792100000014, 1792100000015, "status", "equal", "PROCESSING", "value", 3, False)]}])
    posted = search_node("search_node_PostAjPosted", "Post Guard: Fully Posted Stock Adjustments", SA_TABLE, [
        leaf(1792100000021, 1792100000020, "id", "numberEqualAny", "{{node:code_node_PostGuardIds.data.ajIds}}",
             "field", 2, False, "主键ID"),
        leaf(1792100000022, 1792100000020, "stock_adjustment_status", "equal", "Fully Posted", "value", 2, False)])
    parallel = {"id": "condition_all_PostGuard", "type": "condition-all-node", "data": {
        "title": "Post Guard: Lookups", "filter": {"list": []}, "expression": {"code": ""},
        "displayContent": "sdk.form.setCondition"}, "blocks": [
        parallel_item("condition_all_item_PostInflight", "In-flight Tasks", 1792100000031, [inflight]),
        parallel_item("condition_all_item_PostAjPosted", "Posted Stock Adjustments", 1792100000033, [posted])]}
    decide = code_node("code_node_PostGuardDecide", "Post Guard: Decide", DECIDE_CODE, [
        field("pgd0proc", "proceed"), field("pgd0payl", "payload"), field("pgd0hasr", "hasRestore"),
        array_field("pgd0rest", "pgd0rsti", "restoreIds"), field("pgd0skip", "skipped")])
    restore = {"id": "update_node_PostGuardRestore", "type": "update-node", "data": {
        "table_id": {"source": SA_TABLE[0], "rules": {"collectionId": SA_TABLE[1], "list": [
            leaf(1792100000041, 1792100000040, "id", "in", "{{node:code_node_PostGuardDecide.data.restoreIds}}",
                 "field", 1, True, "主键ID")]}},
        "fields": [], "condition": {}, "title": "Post Guard: Restore Posted Status", "isValidator": True,
        "nodeName": "Post Guard: Restore Posted Status", "name": "Post Guard: Restore Posted Status",
        "props": {"modelName": "", "list": [
            {"prop": "id", "valueType": "field", "value": "{{node:code_node_PostGuardDecide.data.restoreIds}}",
             "operator": "", "valueLabel": "", "propLabel": "主键ID", "operatorLabel": "", "valueTypeLabel": ""},
            {"prop": "posted_status", "operator": "", "valueType": "value", "value": "Posted", "valueLabel": "",
             "propLabel": "Posted Status"}]}}, "blocks": []}
    skip = {"id": "return_node_PostGuardSkip", "type": "return-node", "data": {
        "return_data": {}, "status_code": 200, "title": "Post Guard: Nothing To Queue", "isValidator": True,
        "nodeName": "Post Guard: Nothing To Queue", "name": "Post Guard: Nothing To Queue",
        "response_value": {"list": [
            {"prop": "task_id", "propLabel": "task_id", "operator": "", "operatorLabel": "", "valueType": "value",
             "valueTypeLabel": "", "value": "", "valueLabel": ""},
            {"prop": "skipped", "propLabel": "skipped", "operator": "", "operatorLabel": "", "valueType": "field",
             "valueTypeLabel": "", "value": "{{node:code_node_PostGuardDecide.data.skipped}}", "valueLabel": ""}]},
        "return_raw_data": 0}, "blocks": []}
    ids = code_node("code_node_PostGuardIds", "Post Guard: Document IDs", IDS_CODE, [
        field("pgi0ispo", "isPost"), array_field("pgi0ids0", "pgi0idsi", "ids"),
        array_field("pgi0ajid", "pgi0ajii", "ajIds")])
    gate = if_node("if_PostGuard", "IF Post Document", "node.code_node_PostGuardIds.data.isPost", "Yes", [
        parallel, decide,
        if_node("if_PostGuardRestore", "IF Restore Posted Status", "node.code_node_PostGuardDecide.data.hasRestore",
                "Yes", [restore], 1792100000063),
        if_node("if_PostGuardStop", "IF Nothing To Queue", "node.code_node_PostGuardDecide.data.proceed", "No",
                [skip], 1792100000065)], 1792100000061)
    return ids, gate


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def patch(doc, env):
    main = find(doc, "if_recovery_requested_no")["blocks"]
    at = [n["id"] for n in main].index("get_cache_node_U9UnzO9f")
    if main[at + 1]["id"] != "condition_or_dnkT1l4H":
        sys.exit(f"  {env}: expected the task-type branch right after Get Existing Redis")
    ids, gate = guard_nodes()
    main[at + 1:at + 1] = [ids, gate]

    branches = find(doc, "condition_or_dnkT1l4H")["blocks"]
    default = branches[-1]
    if not default["data"].get("isDefault") or [b["id"] for b in default["blocks"]] != ["add_node_Y5qUEWZx"]:
        sys.exit(f"  {env}: default branch is no longer just 'Add Tasks' -- baseline drifted")
    add = json.loads(json.dumps(default["blocks"][0]))
    add["id"] = "add_node_PostGuardTask"
    for k in ("title", "nodeName", "name"):
        add["data"][k] = "Add Post Task"
    payload = [p for p in add["data"]["props"]["list"] if p["prop"] == "payload"]
    if len(payload) != 1 or payload[0]["value"] != "{{workflowparams:payload}}":
        sys.exit(f"  {env}: Add Tasks payload mapping changed -- baseline drifted")
    payload[0]["value"] = "{{node:code_node_PostGuardDecide.data.payload}}"
    branch = {"id": "condition_or_item_PostGuard", "type": "condition-or-node-item", "data": {
        "title": "11. POST DOCUMENT", "filter": {"list": [
            leaf(1792100000051, 1792100000050, "node.code_node_PostGuardIds.data.isPost", "equal", "Yes",
                 label="isPost")]},
        "expression": {"code": ""}, "displayContent": "sdk.form.setCondition", "__index": 11, "isDefault": False,
        "isValidator": True, "nodeName": "11. POST DOCUMENT", "name": "11. POST DOCUMENT",
        "condition_type": "ConditionRule"}, "blocks": [add]}
    branches.insert(len(branches) - 1, branch)

    remap = find(doc, "code_node_fnhtlUlC")["data"]["script"]
    if remap["code"].count(REMAP_OLD) != 1:
        sys.exit(f"  {env}: Remap Redis Data baseline text not found exactly once")
    remap["code"] = remap["code"].replace(REMAP_OLD, REMAP_NEW)

    doc["response_json"].append(field("postguard_skipped", "skipped"))


def fetch(env):
    out = subprocess.run([os.path.join(ROOT, ".dbtools", "db"), f"--{env}", "--json",
                          f"SELECT version_number, create_time, script_json FROM su_code_workflow_history "
                          f"WHERE data_id={WF_ID} AND status='enabled' ORDER BY version_number DESC LIMIT 1"],
                         capture_output=True, text=True, check=True).stdout
    row = json.loads(out)[0]
    print(f"  {env}: ACC_PRODUCER enabled v{row['version_number']} ({str(row['create_time'])[:19]})")
    return json.loads(row["script_json"])


def node_ids(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and "type" in n and isinstance(n.get("data"), dict):
                out[n["id"]] = json.dumps(n["data"], sort_keys=True)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def main():
    for env in ("prod", "dev"):
        base = fetch(env)
        doc = json.loads(json.dumps(base))
        patch(doc, env)
        a, b = node_ids(base), node_ids(doc)
        print(f"    added   {sorted(set(b) - set(a))}")
        print(f"    removed {sorted(set(a) - set(b))}")
        print(f"    changed {sorted(k for k in set(a) & set(b) if a[k] != b[k])}")
        if "--check" not in sys.argv:
            out = os.path.join(HERE, f"ACC_PRODUCER.{env}.json")
            with open(out, "w") as f:
                f.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
            print(f"    wrote {os.path.relpath(out, ROOT)}")


main()
