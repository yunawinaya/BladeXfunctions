"""SM_LOCATION_TRANSFER guarded = base/SM_LOCATION_TRANSFER.v82.json + the SM V2 guard as the first nodes after start (before
if_UCLsQLO6 and if_LOTallocGate). CONTRACT.md section 11. Plus ONE user-approved body fix in code_node_OHjnEcVJ (its loop read
the undeclared `subformData`; quantities now compared as numbers). Nothing else changes: classic/diff_v82.py proves output minus
the guard nodes, with OHjnEcVJ's two lines reverted, == v82 (every node, request / response / config / edges).

Guard: allData.id digits -> ONE SQL (sm_location_transfer + its line table only, tenant-scoped) reads the STORED status and
line count; stored Processing -> 400 (LOT_BUSY text); stored In Progress saved as Draft -> 400 (LOT_IP_TO_DRAFT text; the
classic's update_node_WKLUE7ka would demote it without reversing In Transit); more than 500 flat lines (a Cancel: the stored
lines) -> 400 unless Draft. Return shape = the classic's own 400 return nodes (copied from return_node_LOTreconShort):
status_code 200, { code, message }.
"""
import copy
import json
import os
import random
import string

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "base", "SM_LOCATION_TRANSFER.v82.json")
CODE = os.path.join(HERE, "code", "classic")
GUARD_IDS = ["code_node_LOTguard", "if_LOTguardRead", "ifBlock_TLOTguardRead", "ifBlock_FLOTguardRead", "sql_node_LOTguard", "code_node_LOTguardStored",
             "if_LOTguardBusy", "ifBlock_TLOTguardBusy", "ifBlock_FLOTguardBusy", "return_node_LOTguardBusy", "if_LOTguardIpDraft", "ifBlock_TLOTguardIpDraft",
             "ifBlock_FLOTguardIpDraft", "return_node_LOTguardIpDraft", "if_LOTguardBig", "ifBlock_TLOTguardBig", "ifBlock_FLOTguardBig", "return_node_LOTguardBig",
             "if_LOTguardBigNew", "ifBlock_TLOTguardBigNew", "ifBlock_FLOTguardBigNew", "return_node_LOTguardBigNew"]
TOP_IDS = ["code_node_LOTguard", "if_LOTguardRead", "if_LOTguardBigNew"]
BUSY_TEXT = "This Location Transfer is being processed in the background - please wait for it to finish."
IP_DRAFT_TEXT = "An In Progress transfer can't be saved back to Draft."
# the one v82 node whose body changes (user-approved fix): code_node_OHjnEcVJ looped an undeclared `subformData`
# (ReferenceError on every production-order-linked save past Draft) and compared quantities with !==
FIXED_NODE = "code_node_OHjnEcVJ"
FIX_OLD = """for (const sm of subformData) {
  if (sm.total_quantity !== sm.requested_qty) {"""
FIX_NEW = """for (const sm of subFormData) {
  if (Math.abs((parseFloat(sm.total_quantity) || 0) - (parseFloat(sm.requested_qty) || 0)) > 1e-9) {"""
# user-approved (10-20): a STORED bundle child (the Cancel re-reads the stored doc) has parent_id but no parent_fm_key, so
# isBundleParent dropped it from flatLines and its In Transit stock was never moved back. A row with a real parent id (digits,
# not 0) is never a bundle parent. Client payloads carry parent_fm_key on children and no parent_id on parents: unchanged.
REAL_PARENT = '!/^[1-9][0-9]*$/.test(String(row.parent_id == null ? "" : row.parent_id))'
BUNDLE_NOTE = "// A stored child (the Cancel re-reads the stored doc) has a parent_id but no parent_fm_key.\n"
FIXES = [
    (FIXED_NODE, FIX_OLD, FIX_NEW),
    ("code_node_yPlLXIZW", "const isBundleParent = (row) =>\n  Boolean(row.item_bundle_id && !row.parent_fm_key)\n",
     BUNDLE_NOTE + "const isBundleParent = (row) =>\n  Boolean(row.item_bundle_id && !row.parent_fm_key && " + REAL_PARENT + ")\n"),
    ("code_node_LOTallocPrep", "const isBundleParent = (row) =>\n  Boolean(row.item_bundle_id && !row.parent_fm_key);\n",
     BUNDLE_NOTE + "const isBundleParent = (row) =>\n  Boolean(row.item_bundle_id && !row.parent_fm_key && " + REAL_PARENT + ");\n"),
]


def text(name):
    with open(os.path.join(CODE, name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def keys_of(n, out):
    if isinstance(n, dict):
        if isinstance(n.get("key"), str):
            out.add(n["key"])
        for v in n.values():
            keys_of(v, out)
    elif isinstance(n, list):
        for v in n:
            keys_of(v, out)
    return out


def index(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and "type" in n:
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def build():
    base_text = open(BASE, encoding="utf-8").read()
    base = json.loads(base_text)
    old = index(base)
    assert base["nodes"][0]["type"] == "start-node" and base["nodes"][1]["id"] == "if_UCLsQLO6" and base["nodes"][2]["id"] == "if_LOTallocGate"
    for nid in GUARD_IDS:
        assert '"%s"' % nid not in base_text, nid + " already in v82"
    taken = keys_of(base, set())
    rng = random.Random(20261016)
    fid = [1797600000000]
    assert "17976000000" not in base_text

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    def title(t):
        return {"title": t, "isValidator": True, "nodeName": t, "name": t}

    def resp(names):
        return [{"key": key(), "name": n, "title": n, "description": "", "bsonType": "string", "isExpand": False, "children": []} for n in names]

    def code(nid, t, body, names):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(title(t))
        d["script"] = {"type": "javascript", "code": body}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def sql(nid, t, body, names):
        d = {"database_id": "", "sql": "", "params": {}}
        d.update(title(t))
        d["script"] = {"type": "sql", "code": body}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "sql-node", "data": d, "blocks": []}

    def if_(nid, t, expr, yes):
        fid[0] += 2
        d = title(t)
        d.update({"condition_type": "Expression",
                  "filter": {"list": [{"id": fid[0] - 1, "parentId": fid[0], "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "", "type": "leaf",
                                       "level": 1}]},
                  "expression": {"type": "javascript", "code": expr}})
        return {"id": nid, "type": "if", "data": d,
                "blocks": [{"id": nid.replace("if_", "ifBlock_T"), "type": "ifBlock", "data": {"title": "true"}, "blocks": list(yes)},
                           {"id": nid.replace("if_", "ifBlock_F"), "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}

    def ret(nid, t, message, field):
        r = copy.deepcopy(old["return_node_LOTreconShort"])
        r["id"] = nid
        r["data"].update(title(t))
        lst = r["data"]["response_value"]["list"]
        assert [p["prop"] for p in lst] == ["code", "message"] and lst[0]["value"] == "400"
        lst[1]["valueType"] = "field" if field else "value"
        lst[1]["value"] = message
        return r

    G, S = "code_node_LOTguard", "code_node_LOTguardStored"
    nodes = [
        code(G, "SM V2 Guard: stored transfer to check? payload lines", text("guard.js"),
             ["check", "lotId", "tenantId", "saveAs", "payloadLines", "bigNoRead", "bigMessage"]),
        if_("if_LOTguardRead", "IF a stored Location Transfer (id digits)", "'{{node:%s.data.check}}' == 'YES'" % G, [
            sql("sql_node_LOTguard", "Stored status + line count", text("guard.sql"), ["stock_movement_status", "line_count"]),
            code(S, "SM V2 Guard: processing in the background? In Progress to Draft? too many lines?", text("stored.js"), ["busy", "ipToDraft", "big", "lines", "bigMessage"]),
            if_("if_LOTguardBusy", "IF Processing (a background save holds it)", "'{{node:%s.data.busy}}' == 'YES'" % S, [
                ret("return_node_LOTguardBusy", "Return Processing", BUSY_TEXT, False)]),
            if_("if_LOTguardIpDraft", "IF In Progress saved as Draft (its In Transit stock would be stranded)", "'{{node:%s.data.ipToDraft}}' == 'YES'" % S, [
                ret("return_node_LOTguardIpDraft", "Return In Progress to Draft", IP_DRAFT_TEXT, False)]),
            if_("if_LOTguardBig", "IF more than 500 lines (not Draft)", "'{{node:%s.data.big}}' == 'YES'" % S, [
                ret("return_node_LOTguardBig", "Return Too Many Lines", "{{node:%s.data.bigMessage}}" % S, True)]),
        ]),
        if_("if_LOTguardBigNew", "IF more than 500 lines (new transfer, not Draft)", "'{{node:%s.data.bigNoRead}}' == 'YES'" % G, [
            ret("return_node_LOTguardBigNew", "Return Too Many Lines", "{{node:%s.data.bigMessage}}" % G, True)]),
    ]
    doc = copy.deepcopy(base)
    doc["nodes"] = doc["nodes"][:1] + nodes + doc["nodes"][1:]
    at = index(doc)
    for nid, old_text, new_text in FIXES:
        fixed = at[nid]["data"]["script"]
        assert fixed["code"].count(old_text) == 1, nid + ": v82 body not as expected"
        fixed["code"] = fixed["code"].replace(old_text, new_text)
    assert "subformData" not in at[FIXED_NODE]["data"]["script"]["code"]
    got = index(doc)
    assert sorted(set(got) - set(old)) == sorted(GUARD_IDS), sorted(set(got) - set(old))
    return doc


BUILDERS = [("SM_LOCATION_TRANSFER", build)]

if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.join(HERE, "lib"))
    import v2build as V
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Stock Movement", "Location Transfer", "AsyncV2"), "--write" in sys.argv)
