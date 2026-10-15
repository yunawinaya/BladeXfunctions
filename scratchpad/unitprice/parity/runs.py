"""Loads recorded GET_ITEM_UNIT_PRICE runs (fetch_runs.py output) and segments each run's node trace into item iterations
and, per item, the rule evaluations with their outcome."""
import json

FX = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/unitprice_fx"
ITEM_START = "get_cache_node_tdVHbRri"
COND = {"condition_or_node_item_wre165cl": "HIST", "condition_or_item_B1EfjN3W": "TAG", "condition_or_item_FeNCuZVP": "MULTI",
        "condition_or_item_jLpmeUGE": "DEFAULT", "condition_or_node_item_adcZwnY7": "OTHER"}
HIT = {"set_cache_node_F1ErSYAQ": "HIST", "set_cache_node_ho8eeT9P": "TAG", "set_cache_node_ijvTh6k7": "DEFAULT"}
RAN = {"sql_node_AFi9JgU7": "hist_sql", "sql_node_IS2go2ob": "tag_sql", "get_node_CDjClJqM": "cust", "get_node_fXehyHHH": "supp",
       "code_node_qMnpwS8z": "default_code"}


def node_resp(nd, nid):
    if not nd:
        return None
    raw = json.loads(nd).get(nid)
    if raw is None:
        return None
    return json.loads(raw)


def segment(trace):
    """-> [ [ {cat, hit, ran:set} per rule evaluation ] per item iteration ]"""
    items, cur, rule = [], None, None
    for nid in trace:
        if nid == ITEM_START:
            cur = []
            items.append(cur)
            rule = None
            continue
        if cur is None:
            continue
        if nid == "get_cache_node_ZqgOlvfi":
            cur = None
            continue
        if nid in COND:
            if nid == "condition_or_node_item_wre165cl" or rule is None:
                rule = {"cat": None, "hit": False, "ran": set(), "seen": []}
                cur.append(rule)
            rule["seen"].append(COND[nid])
            rule["cat"] = COND[nid]
            continue
        if rule is not None:
            if nid in HIT:
                rule["hit"] = True
            if nid in RAN:
                rule["ran"].add(RAN[nid])
    return items


def load(env):
    runs = []
    for line in open("%s/runs_%s.jsonl" % (FX, env)):
        r = json.loads(line)
        r["env"] = env
        r["params"] = json.loads(r["req"]) if r.get("req") else None
        resp = json.loads(r["resp"]) if r.get("resp") else None
        r["response"] = resp
        r["trace_ids"] = json.loads(r["trace"]) if r.get("trace") else []
        r["cfg"] = node_resp(r.get("nd"), "get_node_eYdZ327G")
        r["items_out"] = node_resp(r.get("nd"), "sql_node_ItemUomPrices")
        r["proc"] = node_resp(r.get("nd"), "code_node_kaS0Zdzg")
        runs.append(r)
    return runs
