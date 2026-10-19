"""Small DSL that emits BladeX workflow JSON in the exact node shapes the deployed GD async workflows use.
Copy of scratchpad/grv2/wfkit.py; only change: js() reads scratchpad/smv2/code/<path> (HERE is smv2/lib)."""
import json, random, string, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_rng = random.Random(20261012)
_taken = set()


def key():
    while True:
        k = "".join(_rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in _taken and not k.isdigit():
            _taken.add(k)
            return k


class Ids:
    """13-digit filter ids, unique per workflow file."""

    def __init__(self, start):
        self.n = start

    def __call__(self):
        self.n += 1
        return self.n


def _title(d, title):
    d.update({"title": title, "isValidator": True, "nodeName": title, "name": title})
    return d


def resp(names, arrays=(), objects=()):
    out = []
    for n in names:
        if n in arrays:
            out.append({"key": key(), "name": n, "title": n, "description": "", "bsonType": "array", "isExpand": True,
                        "children": [{"key": key(), "name": "items", "title": "", "description": "", "bsonType": "any",
                                      "isExpand": False, "isArrayItem": True, "children": []}]})
        elif n in objects:
            out.append({"key": key(), "name": n, "title": n, "description": "", "bsonType": "any", "isExpand": False, "children": []})
        else:
            out.append({"key": key(), "name": n, "title": n, "description": "", "bsonType": "string", "isExpand": False, "children": []})
    return out


def code(nid, title, body, names, arrays=(), objects=()):
    return {"id": nid, "type": "code-node",
            "data": _title({"language": "javascript", "code": "", "timeout": 30000, "script": {"type": "javascript", "code": body},
                            "response_json": resp(names, arrays, objects)}, title),
            "blocks": []}


def sql(nid, title, text, names):
    d = {"database_id": "", "sql": "", "params": {}}
    _title(d, title)
    d["script"] = {"type": "sql", "code": text}
    d["response_json"] = resp(names)
    return {"id": nid, "type": "sql-node", "data": d, "blocks": []}


def if_(ids, nid, title, expr, true_nodes, false_nodes=()):
    assert true_nodes, "an if node's true block must not be empty"
    d = _title({}, title)
    d.update({"condition_type": "Expression",
              "filter": {"list": [{"id": ids(), "parentId": ids(), "isTop": True, "prop": "", "operator": "", "valueType": "",
                                   "value": "", "type": "leaf", "level": 1}]},
              "expression": {"type": "javascript", "code": expr}})
    return {"id": nid, "type": "if", "data": d,
            "blocks": [{"id": nid.replace("if_", "ifBlock_T"), "type": "ifBlock", "data": {"title": "true"}, "blocks": list(true_nodes)},
                       {"id": nid.replace("if_", "ifBlock_F"), "type": "ifBlock", "data": {"title": "false"}, "blocks": list(false_nodes)}]}


def when_yes(ids, nid, title, flag_ref, flag_label, yes_nodes):
    """condition-or-node: YES item when node.<flag_ref> == 'YES', NO default item empty (the GD write gate)"""
    yes = {"id": nid.replace("cor_", "cori_Y"), "type": "condition-or-node-item",
           "data": {"title": "YES", "filter": {"list": [{"id": ids(), "parentId": ids(), "isTop": True, "prop": flag_ref,
                                                          "operator": "equal", "valueType": "value", "value": "YES", "type": "leaf",
                                                          "level": 1, "propLabel": flag_label, "valueLabel": "", "operatorLabel": "Equal"}]},
                    "expression": {"code": ""}, "displayContent": "sdk.form.setCondition", "isValidator": True, "nodeName": "YES",
                    "name": "YES", "condition_type": "ConditionRule"},
           "blocks": list(yes_nodes)}
    no = {"id": nid.replace("cor_", "cori_N"), "type": "condition-or-node-item",
          "data": {"title": "NO", "isDefault": True, "filter": {"list": []}, "expression": {"code": ""},
                   "displayContent": "sdk.form.otherCondition"},
          "blocks": []}
    return {"id": nid, "type": "condition-or-node",
            "data": {"title": title, "filter": {"list": []}, "expression": {"code": ""}, "displayContent": "sdk.form.setCondition"},
            "blocks": [yes, no]}


def parallel(nid, title, branches):
    """condition-all-node: branches = [(item_id, title, [nodes])]; branches run in parallel, the block is a join"""
    items = []
    for iid, t, nodes in branches:
        items.append({"id": iid, "type": "condition-all-node-item",
                      "data": {"title": t, "filter": {"list": []}, "expression": {"code": "", "type": "javascript"},
                               "displayContent": "sdk.form.setCondition", "isValidator": True, "nodeName": t, "name": t,
                               "condition_type": "ConditionRule"},
                      "blocks": list(nodes)})
    return {"id": nid, "type": "condition-all-node",
            "data": {"title": title, "filter": {"list": []}, "expression": {"code": ""}, "displayContent": "sdk.form.setCondition"},
            "blocks": items}


def _rules(ids, coll, where):
    if where is None:
        return {"collectionId": coll, "list": [{"id": ids(), "parentId": ids(), "isTop": True, "prop": "", "operator": "", "valueType": "",
                                                "value": "", "type": "leaf", "level": 1}]}
    prop, op, value = where
    return {"collectionId": coll, "list": [{"id": ids(), "parentId": ids(), "isTop": True, "prop": prop, "operator": op, "valueType": "field",
                                            "value": value, "type": "leaf", "level": 1, "propLabel": "主键ID" if prop == "id" else prop,
                                            "valueLabel": "", "operatorLabel": {"in": "In", "equal": "Equal"}.get(op, op)}]}


def _props(props, labels=None):
    labels = labels or {}
    return {"modelName": "", "list": [{"prop": p, "operator": "", "valueType": "field", "value": v, "valueLabel": "",
                                       "propLabel": labels.get(p, "主键ID" if p == "id" else p)} for p, v in props]}


def update(ids, nid, title, source, where, props, labels=None):
    coll = source.split(":Table:")[1]
    d = {"table_id": {"source": source, "rules": _rules(ids, coll, where)}, "fields": [], "condition": {}}
    _title(d, title)
    d["props"] = _props(props, labels)
    return {"id": nid, "type": "update-node", "data": d, "blocks": []}


def add(ids, nid, title, source, props, labels=None):
    coll = source.split(":Table:")[1]
    d = {"table_id": {"source": source, "rules": _rules(ids, coll, None)}, "fields": []}
    _title(d, title)
    d["props"] = _props(props, labels)
    return {"id": nid, "type": "add-node", "data": d, "blocks": []}


def get_node(ids, nid, title, source, where):
    coll = source.split(":Table:")[1]
    d = {"table_id": {"source": source, "rules": _rules(ids, coll, where)}, "condition": {}}
    _title(d, title)
    return {"id": nid, "type": "get-node", "data": d, "blocks": []}


def search_node(ids, nid, title, source, where, limit=100):
    coll = source.split(":Table:")[1]
    d = {"table_id": {"source": source, "rules": _rules(ids, coll, where)}, "condition": {}, "limit": limit}
    _title(d, title)
    return {"id": nid, "type": "search-node", "data": d, "blocks": []}


def call(ids, nid, title, wf_name, wf_id, params):
    d = {"workflow_id": "", "workflow_name": "", "input_params": {}}
    _title(d, title)
    d.update({"workflow": {"source": "%s:Workflow:%s" % (wf_name, wf_id),
                           "rules": {"collectionId": wf_id, "list": [{"id": ids(), "parentId": ids(), "isTop": True, "prop": "", "operator": "",
                                                                      "valueType": "", "value": "", "type": "leaf", "level": 1}]}},
              "remote": True, "remoteType": "innerdatasource",
              "body_params": {"list": [{"prop": p, "propLabel": p, "operator": "", "operatorLabel": "", "valueType": "field",
                                        "valueTypeLabel": "", "value": v, "valueLabel": ""} for p, v in params]}})
    return {"id": nid, "type": "workflow-node", "data": d, "blocks": []}


def set_cache(nid, title, redis_key, value_js):
    d = {"cache_key": "", "cache_value": "", "expire_time": 3600}
    _title(d, title)
    d["custom_wkbocgni"] = {"type": "javascript", "code": value_js}
    d["redis_key"] = redis_key
    return {"id": nid, "type": "set-cache-node", "data": d, "blocks": []}


def get_cache(nid, title, redis_key):
    d = {"cache_key": ""}
    _title(d, title)
    d["redis_key"] = redis_key
    return {"id": nid, "type": "get-cache-node", "data": d, "blocks": []}


def loop(ids, nid, title, var_ref, body):
    d = _title({}, title)
    d.update({"loopType": "Var",
              "loopSeletSource": {"datasource": {"rules": {"collectionId": "", "list": [{"id": ids(), "parentId": ids(), "isTop": True, "prop": "",
                                                                                         "operator": "", "valueType": "", "value": "", "type": "leaf",
                                                                                         "level": 1}]}},
                                  "auto_refresh": 1, "auto_refresh_debounce": 100, "options": [],
                                  "props": {"value": "", "label": "", "image": "", "icon": "", "explain": ""}, "remote": False,
                                  "remoteType": "datasource"},
              "loopSeletVar": {"type": "markdown", "code": var_ref}})
    return {"id": nid, "type": "loop", "data": d, "blocks": list(body)}


def ret(nid, title, fields):
    d = {"return_data": {}, "status_code": 200}
    _title(d, title)
    d["response_value"] = {"list": [{"prop": p, "propLabel": p, "operator": "", "operatorLabel": "", "valueType": "field", "valueTypeLabel": "",
                                     "value": v, "valueLabel": ""} for p, v in fields]}
    d["return_raw_data"] = 0
    return {"id": nid, "type": "return-node", "data": d, "blocks": []}


def workflow(request, response, nodes):
    req = [{"key": key(), "name": n, "title": n, "description": desc, "bsonType": bt, "isExpand": False, "children": []}
           for n, bt, desc in request]
    res = [{"key": key(), "name": n, "title": n, "description": "", "bsonType": "string", "isExpand": False} for n in response]
    start = {"id": "start", "type": "start-node", "data": {"title": "Start Node", "isValidator": True, "nodeName": "Start Node", "name": "Start Node"}, "blocks": []}
    end = {"id": "end", "type": "end-node", "data": {"title": "End Node", "isValidator": True, "nodeName": "End Node", "name": "End Node"}, "blocks": []}
    return {"request_json": req, "response_json": res, "config": {}, "nodes": [start] + list(nodes) + [end], "edges": []}


def js(path):
    with open(os.path.join(ROOT, "code", path), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def check_ids(doc):
    seen = {}
    def walk(n):
        if isinstance(n, dict):
            if "type" in n and "id" in n and isinstance(n.get("id"), str):
                assert n["id"] not in seen, "duplicate node id " + n["id"]
                seen[n["id"]] = n["type"]
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return seen
