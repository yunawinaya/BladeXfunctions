"""The built GET_ITEM_UNIT_PRICE_BULK's sql-node texts, rendered with keys / plan values the way the platform substitutes them."""
import json, os, re

WF = "/Users/yunawinaya/Developer/BladeXfunctions/Purchase Order/GetItemUnitPriceBulk/GET_ITEM_UNIT_PRICE_BULK.json"


def _sqls():
    out = {}
    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                out[n["id"]] = n["data"]["script"]["code"]
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(json.load(open(WF)))
    return out


SQL = _sqls()


def render(node_id, keys, plan=None):
    vals = {"code_node_UPkeys": keys, "code_node_UPplan": plan or {}}
    def rep(m):
        node, field = m.group(1), m.group(2)
        v = vals[node][field]
        return "null" if v is None else str(v)
    s = re.sub(r"\{\{node:(code_node_UP\w+)\.data\.(\w+)\}\}", rep, SQL[node_id])
    assert "{{" not in s, s[:200]
    return s


def _types():
    out = {}
    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                out[n["id"]] = {r["name"]: r.get("bsonType", "string") for r in n["data"]["response_json"]}
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(json.load(open(WF)))
    return out


TYPES = _types()


def coerce(node_id, rows):
    """what a code node sees: each column converted to its declared bsonType (verified on the classic's recorded outputs:
    'decimal' -> number, 'string' -> the value's text, NULL -> null)"""
    t = TYPES[node_id]
    out = []
    for r in rows:
        o = {}
        for k, v in r.items():
            if v is None:
                o[k] = None
            elif t.get(k) == "decimal":
                f = float(v)
                o[k] = int(f) if f.is_integer() else f
            else:
                o[k] = v if isinstance(v, str) else str(v)
        out.append(o)
    return out
