"""patch_loop_cover.py [--write]: PICKING_LOOP (Picking/PickingLoopWorkflow.json, dev v87) double-Picking guard.

Inserts, at the top level right after the GD busy check (if_GdBusy) and before the loop:
  code_node_CoverIds  the GD lines this call puts on a live Picking (an Add, or a Draft saved as Created / Completed)
  if_CoverCheck       only then: sql_node_Cover (what OTHER live Pickings hold of those lines) -> code_node_Cover
                      (verdict) -> if_CoverOver -> return 400 + message, nothing written.
Code from scratchpad/pkdup/code/. The file is Prettier-formatted: the nodes are inserted as text after if_GdBusy and the
result must parse to exactly the intended document. Prints what changes; writes only with --write."""
import json, sys

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = ROOT + "Picking/PickingLoopWorkflow.json"
CODE = ROOT + "scratchpad/pkdup/code/"


def rj(key, name, title, bson):
    return {"key": key, "name": name, "title": title, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def code_node(nid, title, code, outs):
    return {"id": nid, "type": "code-node", "data": {"language": "javascript", "code": "", "timeout": 30000, "title": title, "isValidator": True,
            "nodeName": title, "name": title, "script": {"type": "javascript", "code": code}, "response_json": outs}, "blocks": []}


def if_node(nid, title, prop, label, fid, true_blocks):
    return {"id": nid, "type": "if", "data": {"title": title, "isValidator": True, "nodeName": title, "name": title, "condition_type": "ConditionRule",
            "expression": {"type": "javascript", "code": ""},
            "filter": {"list": [{"id": fid + 1, "parentId": fid, "isTop": True, "prop": prop, "operator": "numberEqual", "valueType": "value", "value": 1,
                                 "type": "leaf", "level": 1, "propLabel": label, "valueLabel": "", "operatorLabel": "Equal"}]}},
            "blocks": [{"id": "if_block_" + nid[3:] + "T", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_blocks},
                       {"id": "if_block_" + nid[3:] + "F", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


ids = code_node("code_node_CoverIds", "Double Picking: the GD lines this call puts on a live Picking", open(CODE + "cover_ids.js").read(), [
    rj("cvids001", "check", "Check (1 = read what other Pickings hold)", "int"),
    rj("cvids002", "lineIdCsv", "GD line ids (digits, comma-separated)", "string"),
    rj("cvids003", "gdIdCsv", "GD ids (digits, comma-separated)", "string"),
    rj("cvids004", "ownIdCsv", "This call's own Picking ids (digits, or 0)", "string"),
    rj("cvids005", "mine", "Quantity per GD line this call adds", "any")])
title_sql = "Double Picking: what other live Pickings already hold of these GD lines"
sql = {"id": "sql_node_Cover", "type": "sql-node", "data": {"database_id": "", "sql": "", "params": {}, "title": title_sql, "isValidator": True,
       "nodeName": title_sql, "name": title_sql, "script": {"type": "sql", "code": open(CODE + "cover.sql").read().rstrip("\n")},
       "response_json": [rj("cvsql001", "gd_line_id", "GD line id", "string"), rj("cvsql002", "gd_qty", "GD quantity", "string"),
                         rj("cvsql003", "delivery_no", "GD number", "string"), rj("cvsql004", "item_name", "Item", "string"),
                         rj("cvsql005", "covered", "Held by other live Pickings", "string"), rj("cvsql006", "pickings", "Those Pickings", "string")]}, "blocks": []}
verdict = code_node("code_node_Cover", "Double Picking: verdict", open(CODE + "cover_verdict.js").read(), [
    rj("cvver001", "over", "Over (1 = refuse)", "int"), rj("cvver002", "message", "Message", "string")])
ret = {"id": "return_node_Cover", "type": "return-node", "data": {"return_data": {}, "status_code": 200, "title": "Return Data", "isValidator": True,
       "nodeName": "Return Data", "name": "Return Data", "response_value": {"list": [
           {"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "", "valueType": "value", "valueTypeLabel": "", "value": "400", "valueLabel": ""},
           {"prop": "message", "operator": "", "valueType": "field", "value": "{{node:code_node_Cover.data.message}}", "valueLabel": "", "propLabel": "message"}]},
       "return_raw_data": 0}, "blocks": []}
if_over = if_node("if_CoverOver", "IF these lines are already on other Pickings: answer 400, nothing written", "node.code_node_Cover.data.over", "over", 1791970000011, [ret])
if_check = if_node("if_CoverCheck", "IF a Picking goes live in this call: check its GD lines are not on other Pickings already", "node.code_node_CoverIds.data.check",
                   "check", 1791970000001, [sql, verdict, if_over])


def node_end(text, start):
    """index just past the JSON object that opens at text[start] == '{'"""
    depth, i, in_str = 0, start, False
    while True:
        c = text[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1


raw = open(PATH, encoding="utf-8").read()
doc = json.loads(raw)
top = [n["id"] for n in doc["nodes"]]
assert "code_node_CoverIds" not in raw, "already patched"
i = top.index("if_GdBusy")
assert top[i + 1] == "code_node_uPSc7Syb", top[i: i + 3]
anchor = raw.index('"id": "if_GdBusy"')
start = raw.rindex("{", 0, anchor)
assert raw[start - 5: start] == "\n    ", "if_GdBusy is not a top-level node at indent 4"
end = node_end(raw, start)
assert json.loads(raw[start:end])["id"] == "if_GdBusy"
assert raw[end] == ",", "if_GdBusy is not followed by another node"
pretty = lambda n: "\n".join(("    " + l) for l in json.dumps(n, ensure_ascii=False, indent=2).split("\n"))
out = raw[:end] + ",\n" + ",\n".join(pretty(n) for n in (ids, if_check)) + raw[end:]
want = json.loads(raw)
want["nodes"][i + 1: i + 1] = [ids, if_check]
assert json.loads(out) == want, "the inserted text does not parse to the intended document"
print("PICKING_LOOP: + code_node_CoverIds, if_CoverCheck { sql_node_Cover, code_node_Cover, if_CoverOver { return_node_Cover } } after if_GdBusy")
print("top level now:", [n["id"] for n in want["nodes"]][: i + 4], "...")
print("%d -> %d bytes" % (len(raw), len(out)))
if "--write" in sys.argv:
    open(PATH, "w", encoding="utf-8").write(out)
    print("written", PATH)
else:
    print("dry run (--write to save)")
