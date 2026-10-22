"""The classic IA_REVERT v6 = v5 (classic_v5.py: the pinned base v4 + the 250-live-row guard) + RES-01 R5 (scratchpad/iasc/res01/RES01_PLAN.md)
for an IA that reserves (its stored material_hold_status set); every other IA reverts exactly as v5:
  after if_iaRvRefuse:        code_node_RESrvDue > if_RESrvDue > sql_node_RESrvOwn (its open holds + running hold tickets) > code_node_RESrvOpen >
                              if_RESrvOpen > return_node_RESrvOpen (a copy of the classic's refusal, code "409": its holds still open)
  after code_node_iaRvBuild:  code_node_RESrvMap (a component issued from Reserved comes back to Unrestricted); loop_iaRvAdd reads its adds
  after update_node_iaRvIa:   if_RESrvMark > update_node_RESrvMark (material_hold_status RESERVING: the next open or save reserves again)
  in code_node_iaRvPrep:     a component pairs without its category (lift_revert.py PAIR_WAS / PAIR_NOW: R6 live 10-22)
Asserted: every v5 node byte-identical except loop_iaRvAdd's source and that pairing key.

usage: python3 revert/classic_v6.py   (prints a summary; build_revert.py BUILDERS["IA_REVERT"] calls build())"""
import copy
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(IAV2, "lib"))
import v2build as V  # noqa: E402


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


V5 = _load(os.path.join(HERE, "classic_v5.py"), "iarv_classic_v5_for_v6")
IASC_SQL = _load(os.path.join(IAV2, "..", "iasc", "code", "shared", "sql.py"), "iasc_sql_for_v6")
LIFT = _load(os.path.join(HERE, "lift", "lift_revert.py"), "iarv_lift_for_v6")
RES_CODE = os.environ.get("HD_CODE") or os.path.join(IAV2, "..", "iasc", "res01", "code")
JS = os.path.join(IAV2, "code", "revert", "classic")
DUE, OWN, OPEN, MAP, MARK = "code_node_RESrvDue", "sql_node_RESrvOwn", "code_node_RESrvOpen", "code_node_RESrvMap", "update_node_RESrvMark"
RES_IDS = [DUE, "if_RESrvDue", "if_block_RESrvDueTrue", "if_block_RESrvDueFalse", OWN, OPEN, "if_RESrvOpen", "if_block_RESrvOpenTrue", "if_block_RESrvOpenFalse",
           "return_node_RESrvOpen", MAP, "if_RESrvMark", "if_block_RESrvMarkTrue", "if_block_RESrvMarkFalse", MARK]
FILTER_IDS = [1791000000201, 1791000000202, 1791000000203, 1791000000204, 1791000000205, 1791000000206, 1791000000207, 1791000000208]
LOOP_FROM, LOOP_TO = "{{node:code_node_iaRvBuild.data.adds}}", "{{node:code_node_RESrvMap.data.adds}}"
index, keys_of, rkey = V5.index, V5.keys_of, V5.rkey


def build():
    v5 = V5.build()
    raw = json.dumps(v5, ensure_ascii=False)
    for nid in RES_IDS:
        assert '"%s"' % nid not in raw, nid + " already in v5"
    for fid in FILTER_IDS:
        assert str(fid) not in raw, fid
    old = index(v5)
    taken = keys_of(v5, set())
    title = lambda t: {"title": t, "isValidator": True, "nodeName": t, "name": t}
    tpl_code, tpl_if, tpl_ret, tpl_up = old["code_node_iaRvPrep"], old["if_iaRvRefuse"], old["return_node_iaRvRefuse"], old["update_node_iaRvIa"]
    fid = iter(FILTER_IDS)

    def code(nid, t, body, names):
        d = {k: tpl_code["data"][k] for k in ("language", "code", "timeout")}
        d.update(title(t))
        d["script"] = {"type": "javascript", "code": body}
        d["response_json"] = [{"key": rkey(n, taken), "name": n, "title": n, "description": "", "bsonType": "any" if n == "adds" else "string", "isExpand": False, "children": []}
                              for n in names]
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def iff(nid, t, expr, yes, tid, fid_):
        n = copy.deepcopy(tpl_if)
        n["id"] = nid
        n["data"].update(title(t))
        n["data"]["filter"]["list"][0].update({"id": next(fid), "parentId": next(fid)})
        n["data"]["expression"]["code"] = expr
        n["blocks"][0].update({"id": tid, "blocks": list(yes)})
        n["blocks"][1].update({"id": fid_, "blocks": []})
        return n

    sql = {"id": OWN, "type": "sql-node", "data": dict(title("RES-01: its open holds, this IA's Delivered holds and running hold tickets (on_reserved_gd + gd_publish_step)"),
           database_id="", sql="", params={}, script={"type": "sql", "code": V.wrap_sql(V.sub(IASC_SQL.RES_REVERT_OWN, T="{{node:%s.data.tenantId}}" % DUE,
                                                                                            IAQ="{{node:%s.data.ia}}" % DUE, ORG="{{node:%s.data.org}}" % DUE))},
           response_json=[{"key": rkey("j", taken), "name": "j", "title": "j", "description": "", "bsonType": "string", "isExpand": False, "children": []}])}
    ret = copy.deepcopy(tpl_ret)
    ret["id"] = "return_node_RESrvOpen"
    ret["data"].update(title("Return Refused (RES-01: its holds are still open)"))
    lst = ret["data"]["response_value"]["list"]
    assert [p["prop"] for p in lst] == ["code", "message", "conflicts"]
    lst[0]["value"] = "409"
    lst[1]["value"] = "{{node:%s.data.message}}" % OPEN
    due = code(DUE, "RES-01: a revert of an IA that reserves?", V.raw(JS, "res_due.js"), ["due", "ia", "org", "tenantId", "hold"])
    gate = [due, iff("if_RESrvDue", "IF RES-01: its holds to check", "'{{node:%s.data.due}}' == 'YES'" % DUE, [sql], "if_block_RESrvDueTrue", "if_block_RESrvDueFalse"),
            code(OPEN, "RES-01: its holds still open?", V.raw(JS, "res_open.js"), ["route", "message"]),
            iff("if_RESrvOpen", "IF RES-01: its holds are still open", "'{{node:%s.data.route}}' == 'OPEN'" % OPEN, [ret], "if_block_RESrvOpenTrue", "if_block_RESrvOpenFalse")]
    rmap = code(MAP, "RES-01: a component issued from Reserved comes back to the bucket its hold came from", V.include_js(RES_CODE, "shared/revert.js") + "\n" + V.raw(JS, "res_map.js"),
                ["adds"])
    up = copy.deepcopy(tpl_up)
    up["id"] = MARK
    up["data"].update(title("RES-01: mark it RESERVING (the next open or save reserves again)"))
    leaf = up["data"]["table_id"]["rules"]["list"][0]
    assert leaf["prop"] == "id" and leaf["operator"] == "in"
    leaf.update({"id": next(fid), "parentId": next(fid), "value": "{{node:code_node_iaRvPrep.data.iaId}}"})
    tpl_p = up["data"]["props"]["list"][0]
    up["data"]["props"]["list"] = [dict(tpl_p, prop="id", propLabel="id", valueType="field", value="{{node:code_node_iaRvPrep.data.iaId}}"),
                                   dict(tpl_p, prop="material_hold_status", propLabel="material_hold_status", valueType="value", value="RESERVING")]
    mark = iff("if_RESrvMark", "IF RES-01: it reserves", "'{{node:%s.data.due}}' == 'YES'" % DUE, [up], "if_block_RESrvMarkTrue", "if_block_RESrvMarkFalse")
    doc = copy.deepcopy(v5)
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("if_iaRvRefuse") + 1
    doc["nodes"][i:i] = gate
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("code_node_iaRvBuild") + 1
    doc["nodes"][i:i] = [rmap]
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("update_node_iaRvIa") + 1
    assert top[i] == "return_node_iaRvSuccess", top[i - 1:i + 2]
    doc["nodes"][i:i] = [mark]
    lp = index(doc)["loop_iaRvAdd"]["data"]["loopSeletVar"]
    assert lp["code"] == LOOP_FROM, lp
    lp["code"] = LOOP_TO
    prep = index(doc)["code_node_iaRvPrep"]["data"]["script"]
    assert prep["code"].count(LIFT.PAIR_WAS) == 1, "the pairing key moved in v5"
    prep["code"] = prep["code"].replace(LIFT.PAIR_WAS, LIFT.PAIR_NOW)
    got = index(doc)
    assert sorted(set(got) - set(old)) == sorted(RES_IDS), sorted(set(got) - set(old))
    canon = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    rev = copy.deepcopy(doc)
    index(rev)["loop_iaRvAdd"]["data"]["loopSeletVar"]["code"] = LOOP_FROM
    index(rev)["code_node_iaRvPrep"]["data"]["script"]["code"] = prep["code"].replace(LIFT.PAIR_NOW, LIFT.PAIR_WAS)
    ri = index(rev)
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "IA_REVERT v6: a v5 node changed " + nid
    return doc


if __name__ == "__main__":
    doc = build()
    print("IA_REVERT v6: %d top-level nodes; RES-01 nodes %s" % (len(doc["nodes"]), ", ".join(RES_IDS[:1] + [MAP, MARK])))
