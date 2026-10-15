"""Shared helpers for the Phase 0 classic-guard patches (plan: ~/.claude/plans/we-have-done-v2-sleepy-iverson.md).
Each patch loads a dev-IDENTICAL repo workflow, edits it in memory, and writes it back in the repo's own format
(Prettier over compact JSON, or indent-2 for the revert file)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, ".."))
from fmt import render  # noqa: E402


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def save(rel, doc, original_text):
    """Write `doc` in the same format the file had (Prettier-min or json indent 2)."""
    path = os.path.join(ROOT, rel)
    if render(json.loads(original_text)) == original_text:
        text = render(doc)
    else:
        assert json.dumps(json.loads(original_text), ensure_ascii=False, indent=2) == original_text.rstrip("\n"), rel + ": unknown format"
        text = json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if original_text.endswith("\n") else "")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def walk(node, fn):
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            walk(v, fn)


def find(doc, nid):
    hits = []
    walk(doc, lambda n: hits.append(n) if n.get("id") == nid and "type" in n else None)
    assert len(hits) == 1, "%s: %d matches" % (nid, len(hits))
    return hits[0]


def absent(doc, *nids):
    text = json.dumps(doc)
    for nid in nids:
        assert '"%s"' % nid not in text, nid + " already present (patch already applied?)"


def absent_num(doc, *nums):
    text = json.dumps(doc)
    for num in nums:
        assert str(num) not in text, "filter id %s already used" % num


def title(t):
    return {"title": t, "isValidator": True, "nodeName": t, "name": t}


def code(nid, t, body, outs):
    return {"id": nid, "type": "code-node",
            "data": dict({"language": "javascript", "code": "", "timeout": 30000}, **title(t),
                         script={"type": "javascript", "code": body},
                         response_json=[{"key": k, "name": n, "title": n, "description": "", "bsonType": "string",
                                         "isExpand": False, "children": []} for k, n in outs]),
            "blocks": []}


def sql(nid, t, text, outs):
    return {"id": nid, "type": "sql-node",
            "data": dict({"database_id": "", "sql": "", "params": {}}, **title(t),
                         script={"type": "sql", "code": text},
                         response_json=[{"key": k, "name": n, "title": n, "description": "", "bsonType": "string",
                                         "isExpand": False, "children": []} for k, n in outs]),
            "blocks": []}


def if_(nid, t, expr, fid, yes):
    assert yes, "an if node's true block must not be empty"
    return {"id": nid, "type": "if",
            "data": dict(title(t), condition_type="Expression",
                         filter={"list": [{"id": fid, "parentId": fid + 1, "isTop": True, "prop": "", "operator": "",
                                           "valueType": "", "value": "", "type": "leaf", "level": 1}]},
                         expression={"type": "javascript", "code": expr}),
            "blocks": [{"id": nid.replace("if_", "ifBlock_T"), "type": "ifBlock", "data": {"title": "true"}, "blocks": yes},
                       {"id": nid.replace("if_", "ifBlock_F"), "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


def ret400(nid, t, message_value, field=False, extra=()):
    """return-node answering code 400 + message (a literal, or a {{node:...}} reference when field=True)."""
    lst = [{"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "", "valueType": "value",
            "valueTypeLabel": "", "value": "400", "valueLabel": ""},
           {"prop": "message", "propLabel": "message", "operator": "", "valueType": "field" if field else "value",
            "value": message_value, "valueLabel": ""}]
    for p, v in extra:
        lst.append({"prop": p, "propLabel": p, "operator": "", "valueType": "value", "value": v, "valueLabel": ""})
    return {"id": nid, "type": "return-node",
            "data": dict({"return_data": {}, "status_code": 200}, **title(t), response_value={"list": lst}, return_raw_data=0),
            "blocks": []}


def insert_after_start(doc, nodes):
    assert doc["nodes"][0]["type"] == "start-node"
    doc["nodes"] = doc["nodes"][:1] + nodes + doc["nodes"][1:]


def replace_in_code(node, old, new, count=1):
    src = node["data"]["script"]["code"]
    assert src.count(old) == count, "%s: expected %d match(es) of %r, found %d" % (node["id"], count, old[:60], src.count(old))
    node["data"]["script"]["code"] = src.replace(old, new)
