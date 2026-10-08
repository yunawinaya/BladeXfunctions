#!/usr/bin/env python3
"""One-off repair workflow: create the two Packings that PICKING run 2108089351207522305
(PI-20261008-1026, 2026-10-08 14:57) failed to create -- GD-2610-42 and GD-2610-43.

The add-node is a copy of PICKING's own `add_node_LcxwYc7z`, fed the exact payload that run's
`code_node_gudzrvMQ` recorded, so the platform does its usual bookkeeping (serial number, junction
rows, subform rows, tenant). It writes nothing unless the LSH Packing serial rule is visible --
i.e. it was called from an LSH session -- and it skips a GD that already has a Packing.

Before writing, the recorded payload is checked against the live GD rows (read-only).
Writes REPAIR_PACKING_PI1026.json.   usage: python3 build_repair.py
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOTFIX = os.path.join(HERE, "..", "2026-10-08-bug-register")
sys.path.insert(0, HOTFIX)
import build as hb  # noqa: E402
import replay_tests as rt  # noqa: E402

RUN = 2108089351207522305
GDS = {"2108074151607668738": "GD-2610-42", "2108074166921072642": "GD-2610-43"}
ORG = "1996787068457861121"
RULE_ID = "2048857875989835777"
OUT = os.path.join(HERE, "REPAIR_PACKING_PI1026.json")

PLAN_JS = """// The Packings PICKING run 2108089351207522305 (PI-20261008-1026) failed to create, as code_node_gudzrvMQ built them.
const recorded = __PAYLOAD__;
const RULE_ID = "__RULE__";
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const ruleOk = asList({{node:search_node_RpRule.data.data}}).some((r) => String(r.id) === RULE_ID);
const taken = new Set(asList({{node:search_node_RpExisting.data.data}}).map((p) => String(p.gd_id)));
const toCreate = recorded.filter((p) => !taken.has(String(p.gd_id)));
const go = ruleOk && toCreate.length > 0 ? 1 : 0;
const message = !ruleOk
  ? "Not an LSH session (the LSH Packing serial rule is not visible), nothing was written."
  : toCreate.length === 0
    ? "GD-2610-42 and GD-2610-43 already have a Packing, nothing was written."
    : "Packing created for " + toCreate.map((p) => p.gd_no).join(", ");
return { toCreate, go, ruleId: RULE_ID, code: ruleOk ? "200" : "400", message };
"""


def recorded_payload():
    # A failed run's nodes_data ends with an error-file entry that has no node_id, so rt.trace() can't read it.
    entries = json.loads(rt.db(f"SELECT nodes_data FROM su_code_workflow_inst WHERE id={RUN}")[0]["nodes_data"])
    [entry] = [e for e in entries if e.get("node_id") == "code_node_gudzrvMQ"]
    out = json.loads(entry["response_json_data"])["data"]
    payload = out["packingDataList"]
    assert hb.canon(payload) == hb.canon(out["packingsToCreate"])
    assert {p["gd_id"]: p["gd_no"] for p in payload} == GDS, [p["gd_no"] for p in payload]
    return payload


def check_against_db(payload):
    ids = ",".join(GDS)
    gds = {str(r["id"]): r for r in rt.db(
        f"SELECT id, delivery_no, gd_status, picking_status, organization_id FROM goods_delivery "
        f"WHERE id IN ({ids}) AND is_deleted=0")}
    lines = rt.db(f"SELECT id, goods_delivery_id, material_id, picked_qty, picking_status "
                  f"FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id IN ({ids}) AND is_deleted=0")
    quoted = ",".join(f"'{g}'" for g in GDS)
    packs = rt.db(f"SELECT packing_no FROM packing WHERE gd_id IN ({quoted}) AND is_deleted=0")
    assert not packs, f"a Packing already exists: {packs}"
    for p in payload:
        g = gds[p["gd_id"]]
        assert (g["delivery_no"], g["gd_status"], g["organization_id"]) == (p["gd_no"], "Created", ORG), g
        mine = {str(l["id"]): l for l in lines if str(l["goods_delivery_id"]) == p["gd_id"]}
        assert set(mine) == {r["gd_line_id"] for r in p["table_item_source"]}, p["gd_no"]
        for r in p["table_item_source"]:
            line = mine[r["gd_line_id"]]
            assert str(line["material_id"]) == r["item_id"] and line["picking_status"] == "Completed"
            assert abs(float(line["picked_qty"]) - float(r["picked_qty"])) < 1e-9, (p["gd_no"], line, r)
        print(f"  {p['gd_no']}: Created GD, {len(mine)} line(s) match the recorded payload, no Packing yet")


def leaf(prop, value, label, parent, level, value_type="value", op="equal"):
    nid = hb.stable_int(f"rp|{prop}|{value}")
    return {"id": nid, "parentId": parent, "isTop": False, "prop": prop, "operator": op,
            "valueType": value_type, "value": value, "type": "leaf", "level": level,
            "propLabel": label, "valueLabel": "", "operatorLabel": "Equal"}


def branch(nid, parent, op, level, children, top=False):
    return {"id": nid, "parentId": parent, "isTop": top, "type": "branch", "operator": op,
            "prop": "", "valueType": "", "value": "", "level": level, "children": children}


def search_node(nid, title, source, collection_id, rules, limit):
    return {"id": nid, "type": "search-node", "data": {
        "table_id": {"source": source, "rules": {"collectionId": collection_id, "list": rules}},
        "condition": {}, "limit": limit, "title": title, "isValidator": True,
        "nodeName": title, "name": title}, "blocks": []}


def field_return(nid, code_ref, message_ref):
    node = hb.return_node(nid, code_ref, message_ref)
    for item in node["data"]["response_value"]["list"]:
        item["valueType"] = "field"
    return node


def build(picking, payload):
    start = copy.deepcopy(picking["nodes"][0])
    end = copy.deepcopy(picking["nodes"][-1])
    assert (start["type"], end["type"]) == ("start-node", "end-node")

    rule_src = hb.find(picking, "get_node_P2TpS5kS")[0]["data"]["table_id"]
    rule = search_node("search_node_RpRule", "Get LSH Packing Rule", rule_src["source"],
                       rule_src["rules"]["collectionId"], copy.deepcopy(rule_src["rules"]["list"]), 10)

    top, anyb = hb.stable_int("rp|existing|all"), hb.stable_int("rp|existing|any")
    existing = search_node(
        "search_node_RpExisting", "Get Existing Packing", "Packing:Table:1993515601863524353",
        "1993515601863524353",
        [branch(top, top + 1, "all", 1, [
            leaf("organization_id", ORG, "Organization ID", top, 2),
            branch(anyb, top, "any", 2, [leaf("gd_id", g, "Goods Delivery No", anyb, 3) for g in GDS])],
            top=True)], 10)

    plan_js = PLAN_JS.replace("__PAYLOAD__", json.dumps(payload, ensure_ascii=False)).replace("__RULE__", RULE_ID)
    plan = hb.code_node("code_node_RpPlan", "Plan Repair", plan_js,
                        ["toCreate", ("go", "int"), "ruleId", "code", "message"])
    to_create = copy.deepcopy(hb.find(picking, "code_node_gudzrvMQ")[0]["data"]["response_json"][4])
    assert to_create["name"] == "packingDataList"
    to_create.update(key="rpplan_tc", name="toCreate", title="toCreate", description="")
    to_create["children"][0]["key"] = "rpplan_tc_item"
    plan["data"]["response_json"][0] = to_create

    add_src = json.dumps(hb.find(picking, "add_node_LcxwYc7z")[0], ensure_ascii=False)
    n_rows = add_src.count("{{node:code_node_gudzrvMQ.data.packingDataList.")
    assert n_rows > 20 and add_src.count("{{node:get_node_P2TpS5kS.data.data.id}}") == 1
    add_src = (add_src.replace("{{node:code_node_gudzrvMQ.data.packingDataList.", "{{node:code_node_RpPlan.data.toCreate.")
               .replace("{{node:get_node_P2TpS5kS.data.data.id}}", "{{node:code_node_RpPlan.data.ruleId}}"))
    assert "gudzrvMQ" not in add_src and "P2TpS5kS" not in add_src
    add = json.loads(add_src)
    add["id"] = "add_node_RpPacking"

    done = field_return("return_node_RpDone", "{{node:code_node_RpPlan.data.code}}",
                        "{{node:code_node_RpPlan.data.message}}")
    skip = field_return("return_node_RpSkip", "{{node:code_node_RpPlan.data.code}}",
                        "{{node:code_node_RpPlan.data.message}}")
    go_leaf = {"id": hb.stable_int("rp|go"), "parentId": hb.stable_int("rp|go|p"), "isTop": True,
               "prop": "node.code_node_RpPlan.data.go", "operator": "numberEqual", "valueType": "value",
               "value": 1, "type": "leaf", "level": 1, "propLabel": "go", "valueLabel": "",
               "operatorLabel": "Equal"}
    gate = {"id": "if_RpGo", "type": "if", "data": {
        "title": "IF go", "isValidator": True, "nodeName": "IF go", "name": "IF go",
        "condition_type": "ConditionRule", "expression": {"type": "javascript", "code": ""},
        "filter": {"list": [go_leaf]}},
        "blocks": [{"id": "if_RpGo_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": [add, done]},
                   {"id": "if_RpGo_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}

    return {"request_json": [], "response_json": copy.deepcopy(picking["response_json"]), "config": {},
            "nodes": [start, rule, existing, plan, gate, skip, end], "edges": []}, n_rows


def main():
    picking = json.load(open(os.path.join(HERE, "PICKING.PROD.json"), encoding="utf-8"))
    payload = recorded_payload()
    print(f"recorded payload from run {RUN}: {[p['gd_no'] for p in payload]}")
    check_against_db(payload)
    wf, n_rows = build(picking, payload)
    hb.write(OUT, wf)
    print(f"wrote {os.path.basename(OUT)} (add-node: {n_rows} payload refs re-pointed to code_node_RpPlan)")


if __name__ == "__main__":
    main()
