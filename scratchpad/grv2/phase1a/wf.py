"""Small helpers for editing a FlowGram workflow document in place (Phase 1a, PO_SAVE)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "phase0"))
from fmt import render  # noqa: E402

CODE_DIR = os.path.join(HERE, "code")


def body(name):
    with open(os.path.join(CODE_DIR, name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def walk(node, fn, parent=None, key=None):
    if isinstance(node, dict):
        fn(node, parent, key)
        for k, v in list(node.items()):
            walk(v, fn, node, k)
    elif isinstance(node, list):
        for i, v in enumerate(list(node)):
            walk(v, fn, node, i)


def find(doc, nid):
    hits = []
    walk(doc, lambda n, p, k: hits.append(n) if n.get("id") == nid and "type" in n else None)
    assert len(hits) == 1, "%s: %d matches" % (nid, len(hits))
    return hits[0]


def locate(doc, nid):
    """(list holding the node, index)"""
    hits = []

    def fn(n, p, k):
        if isinstance(p, list) and n.get("id") == nid and "type" in n:
            hits.append((p, k))
    walk(doc, fn)
    assert len(hits) == 1, "%s: %d containers" % (nid, len(hits))
    return hits[0]


def remove(doc, nid):
    lst, i = locate(doc, nid)
    return lst.pop(i)


def insert_before(doc, nid, nodes):
    lst, i = locate(doc, nid)
    lst[i:i] = nodes


def insert_after(doc, nid, nodes):
    lst, i = locate(doc, nid)
    lst[i + 1:i + 1] = nodes


def absent(doc, *nids):
    text = json.dumps(doc)
    for nid in nids:
        assert '"%s"' % nid not in text, nid + " already present"


def title(t):
    return {"title": t, "isValidator": True, "nodeName": t, "name": t}


def resp(entries):
    """entries: (key, name, bsonType)"""
    out = []
    for k, n, t in entries:
        r = {"key": k, "name": n, "title": n, "description": "", "bsonType": t, "isExpand": False, "children": []}
        out.append(r)
    return out


def code(nid, t, script, entries):
    return {"id": nid, "type": "code-node",
            "data": dict({"language": "javascript", "code": "", "timeout": 30000}, **title(t),
                         script={"type": "javascript", "code": script}, response_json=resp(entries)),
            "blocks": []}


def sql(nid, t, script, entries):
    return {"id": nid, "type": "sql-node",
            "data": dict({"database_id": "", "sql": "", "params": {}}, **title(t),
                         script={"type": "sql", "code": script}, response_json=resp(entries)),
            "blocks": []}


def if_(nid, t, expr, fid, yes, no=()):
    assert yes, "an if node's true block must not be empty"
    return {"id": nid, "type": "if",
            "data": dict(title(t), condition_type="Expression",
                         filter={"list": [{"id": fid, "parentId": fid + 1, "isTop": True, "prop": "", "operator": "",
                                           "valueType": "", "value": "", "type": "leaf", "level": 1}]},
                         expression={"type": "javascript", "code": expr}),
            "blocks": [{"id": nid + "_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": list(yes)},
                       {"id": nid + "_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": list(no)}]}


def end_error(nid, code_value, msg_ref):
    """end-node answering an error code + message, the shape of end_required_400"""
    return {"id": nid, "type": "end-node",
            "data": {"title": "结束节点", "outputs": {"type": "object", "properties": {"result": {"type": "string"}}},
                     "isValidator": True, "nodeName": "结束节点", "name": "结束节点", "back_data_type": "Default",
                     "code": code_value, "msg": {"type": "javascript", "code": msg_ref}},
            "blocks": []}


def parallel(nid, t, branches):
    items = []
    for iid, bt, nodes in branches:
        items.append({"id": iid, "type": "condition-all-node-item",
                      "data": {"title": bt, "filter": {"list": []}, "expression": {"code": "", "type": "javascript"},
                               "displayContent": "sdk.form.setCondition", "isValidator": True, "nodeName": bt, "name": bt,
                               "condition_type": "ConditionRule"},
                      "blocks": list(nodes)})
    return {"id": nid, "type": "condition-all-node",
            "data": {"title": t, "filter": {"list": []}, "expression": {"code": ""}, "displayContent": "sdk.form.setCondition"},
            "blocks": items}


def loop(nid, t, var_ref, fid, nodes):
    d = title(t)
    d.update({"loopType": "Var",
              "loopSeletSource": {"datasource": {"rules": {"collectionId": "", "list": [{"id": fid, "parentId": fid + 1, "isTop": True, "prop": "",
                                                                                         "operator": "", "valueType": "", "value": "", "type": "leaf",
                                                                                         "level": 1}]}},
                                  "auto_refresh": 1, "auto_refresh_debounce": 100, "options": [],
                                  "props": {"value": "", "label": "", "image": "", "icon": "", "explain": ""}, "remote": False,
                                  "remoteType": "datasource"},
              "loopSeletVar": {"type": "markdown", "code": var_ref}})
    return {"id": nid, "type": "loop", "data": d, "blocks": list(nodes)}


def set_code(node, script):
    node["data"]["script"]["code"] = script


def replace_in_code(node, old, new, count=1):
    src = node["data"]["script"]["code"]
    assert src.count(old) == count, "%s: expected %d match(es) of %r, found %d" % (node["id"], count, old[:70], src.count(old))
    node["data"]["script"]["code"] = src.replace(old, new)


def set_expr(node, old, new):
    e = node["data"]["expression"]
    assert e["code"] == old, "%s expression is %r" % (node["id"], e["code"])
    e["code"] = new


def set_param(node, prop, old, new):
    hits = [p for p in node["data"]["body_params"]["list"] if p["prop"] == prop]
    assert len(hits) == 1 and hits[0]["value"] == old, "%s param %s is %r" % (node["id"], prop, hits[0]["value"] if hits else None)
    hits[0]["value"] = new


def leaves(rules):
    out = []
    for r in rules.get("list") or []:
        if r.get("type") == "branch":
            out.extend(leaves({"list": r.get("children") or []}))
        else:
            out.append(r)
    return out


def set_filter_value(node, prop, old, new):
    hits = [l for l in leaves(node["data"]["table_id"]["rules"]) if l.get("prop") == prop]
    assert len(hits) == 1 and hits[0]["value"] == old, "%s filter %s is %r" % (node["id"], prop, hits[0]["value"] if hits else None)
    hits[0]["value"] = new


def set_prop_value(node, prop, old, new):
    hits = [p for p in node["data"]["props"]["list"] if p["prop"] == prop]
    assert len(hits) == 1 and hits[0]["value"] == old, "%s prop %s is %r" % (node["id"], prop, hits[0]["value"] if hits else None)
    hits[0]["value"] = new


def repoint_all(node, old_prefix, new_prefix):
    """every {{node:old...}} placeholder inside one node's props / rules (not code)"""
    n = 0
    def fn(x, p, k):
        nonlocal n
        for kk, vv in list(x.items()):
            if isinstance(vv, str) and old_prefix in vv:
                x[kk] = vv.replace(old_prefix, new_prefix)
                n += 1
    walk(node["data"], fn)
    return n


def save(path, doc, original_text):
    assert render(json.loads(original_text)) == original_text, "base is not in the Prettier-min format"
    with open(path, "w", encoding="utf-8") as f:
        f.write(render(doc))
