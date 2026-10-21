"""IA_V2_SUBMIT v4 = the deployed v3 (Item Assembly & BOM/AsyncV2/IA_V2_SUBMIT.json, pinned md5, = dev v3) + the Small Cycle check:
  code_node_ISscIn     after if_ISkeysEnd: what to read (scIn on the form with the guard's id / page status)
  sql_node_ISsc        a branch of condition_all_ISread: CLASSIC_SC_SOURCE (the stored fields + the linked line + its SO header)
  code_node_ISsc       after if_ISgateEnd, BEFORE GENERATE_BATCH: scClassicCheck on the gate's record (saveAs Completed)
  if_ISscEnd           STOP -> code_node_ISscres + return_node_ISsc (copies of the gate's answer pair: route STOP, code 400, IA_SC_INVALID)
and the 3 document writes gain the 7 Small Cycle props from code_node_ISsc. Asserted: every other v3 node byte-identical; the write
nodes' props = IA_SAVE v13's add_ia / update_ia props minus posted_status (and the number props for update_node_ISiaNoNum) plus
ia_v2_job_id / ia_idem_key (risk review C1: one source for the document columns).

usage: python3 scratchpad/iasc/submit/patch_v4.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json)"""
import copy
import hashlib
import json
import os
import random
import string
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(IASC, "..", ".."))
sys.path.insert(0, os.path.join(IASC, "..", "iav2", "lib"))
sys.path.insert(0, os.path.join(IASC, "code", "shared"))
sys.path.insert(0, os.path.join(IASC, "classic"))
import v2build as V  # noqa: E402
import sql as S  # noqa: E402
import patch_v13 as P13  # noqa: E402

BASE = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2", "IA_V2_SUBMIT.json")
BASE_MD5 = "a375d5cc82d46f907c6b185cf83a2752"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
SEED = 20261021
FILTER_BASE = 1792300000000
G, GT, SCIN, SCQ, SC = "code_node_ISguard", "code_node_ISgate", "code_node_ISscIn", "sql_node_ISsc", "code_node_ISsc"
NEW_IDS = [SCIN, "cai_ISsc", SCQ, SC, "if_ISscEnd", "ifBlock_TISscEnd", "ifBlock_FISscEnd", "code_node_ISscres", "return_node_ISsc"]
SC_PROPS = P13.SC_PROPS
WRITES = {"add_node_ISia": ("add_ia", ()), "update_node_ISiaNum": ("update_ia", ()), "update_node_ISiaNoNum": ("update_ia", ("stock_movement_no", "stock_movement_no_type"))}
index, keys_of, canon = P13.index, P13.keys_of, P13.canon


def body(name):
    shared = "\n".join(V.include_js(CODE, "shared/" + f) for f in ("sc_bom.js", "sc_proj.js", "sc_check.js"))
    return shared + "\n" + V.raw(CODE, "submit/" + name)


def build():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "AsyncV2/IA_V2_SUBMIT.json is not the pinned v3"
    base = json.loads(raw)
    old = index(base)
    for nid in NEW_IDS:
        assert '"%s"' % nid not in raw, nid + " already in v3"
    taken = keys_of(base, set())
    rng = random.Random(SEED)
    fid = [FILTER_BASE]

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

    def code(nid, t, text, names):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(title(t))
        d["script"] = {"type": "javascript", "code": text}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    # the gate's answer pair is the template for the Small Cycle answer
    gres, gret, gif = old["code_node_ISgateres"], old["return_node_ISgate"], old["if_ISgateEnd"]
    src = gres["data"]["script"]["code"]
    call = src[src.index("const res = submitResult("):src.index("\nconsole.log(\"submit result\"")]
    small = call[call.index(", { route:") + 2:call.rindex("}, null);") + 1]
    sc_small = ("{ route: \"STOP\", code: \"400\", message: [%s][0], reason: \"\", errorCode: \"IA_SC_INVALID\", lineCount: [%s][0] }"
                % (V.N(SC, "data.message"), V.N(GT, "data.lineCount")))
    scres = copy.deepcopy(gres)
    scres["id"] = "code_node_ISscres"
    scres["data"].update(title("Result (Small Cycle refusal)"))
    scres["data"]["script"]["code"] = src.replace(small, sc_small, 1)
    assert scres["data"]["script"]["code"] != src
    for r in scres["data"]["response_json"]:
        r["key"] = key()
    scret = copy.deepcopy(gret)
    scret["id"] = "return_node_ISsc"
    scret["data"].update(title("Return (Small Cycle refusal)"))
    for p in scret["data"]["response_value"]["list"]:
        assert p["value"].startswith("{{node:code_node_ISgateres.data."), p
        p["value"] = p["value"].replace("code_node_ISgateres", "code_node_ISscres")
    scif = copy.deepcopy(gif)
    scif["id"] = "if_ISscEnd"
    scif["data"].update(title("IF the Small Cycle check refused: answer, write nothing"))
    fid[0] += 2
    scif["data"]["filter"]["list"][0].update({"id": fid[0] - 1, "parentId": fid[0]})
    scif["data"]["expression"]["code"] = "'%s' == 'STOP'" % V.N(SC, "data.route")
    scif["blocks"][0].update({"id": "ifBlock_TISscEnd", "blocks": [scres, scret]})
    scif["blocks"][1].update({"id": "ifBlock_FISscEnd", "blocks": []})

    sql = {"database_id": "", "sql": "", "params": {}}
    sql.update(title("Small Cycle: the stored fields and the linked SO line + header"))
    sql["script"] = {"type": "sql", "code": V.wrap_sql(V.sub(S.CLASSIC_SC_SOURCE, T=V.N(G, "data.tenantId"), IA=V.N(SCIN, "data.iaId"), LINE=V.N(SCIN, "data.lineId"),
                                                             ORG=V.N(SCIN, "data.org"), UID=V.N(SCIN, "data.uid")))}
    sql["response_json"] = resp(["j"])
    branch_tpl = old["condition_all_ISread"]["blocks"][0]
    branch = copy.deepcopy(branch_tpl)
    branch.update({"id": "cai_ISsc", "blocks": [{"id": SCQ, "type": "sql-node", "data": sql, "blocks": []}]})
    branch["data"].update({"title": "small cycle", "nodeName": "small cycle", "name": "small cycle"})

    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("if_ISkeysEnd")
    assert top[i + 1] == "condition_all_ISread", top[i:i + 3]
    doc["nodes"].insert(i + 1, code(SCIN, "Small Cycle: stored fields to keep (Edit) or a link to check?", body("sc_in.js"), P13.IN_FIELDS))
    reads = [n for n in doc["nodes"] if n["id"] == "condition_all_ISread"][0]
    reads["blocks"].append(branch)
    top = [n["id"] for n in doc["nodes"]]
    j = top.index("if_ISgateEnd")
    assert top[j + 1] == "cor_ISbatch", top[j:j + 3]
    doc["nodes"][j + 1:j + 1] = [code(SC, "Small Cycle: merge, link and snapshot checks (before GENERATE_BATCH)", body("sc_check.js"), P13.CHK_FIELDS), scif]
    got = index(doc)
    v13 = P13.index(P13.build())
    for nid, (cls, drop) in WRITES.items():
        props = got[nid]["data"]["props"]["list"]
        tpl = [p for p in props if p["prop"] == "item_id"][0]
        assert tpl["valueType"] == "field"
        for p in SC_PROPS:
            e = copy.deepcopy(tpl)
            e.update({"prop": p, "propLabel": p, "value": V.N(SC, "data." + p)})
            props.append(e)
        want = [p["prop"] for p in v13[cls]["data"]["props"]["list"] if p["prop"] not in ("posted_status", "id") + drop] + ["ia_v2_job_id", "ia_idem_key"]
        have = [p["prop"] for p in props if p["prop"] != "id"]
        assert sorted(have) == sorted(want), (nid, sorted(set(have) ^ set(want)))
    assert sorted(set(got) - set(old)) == sorted(NEW_IDS), sorted(set(got) - set(old))
    rev = copy.deepcopy(doc)
    ri = index(rev)
    for nid in WRITES:
        ri[nid]["data"]["props"]["list"] = ri[nid]["data"]["props"]["list"][:-len(SC_PROPS)]
    ri["condition_all_ISread"]["blocks"] = [b for b in ri["condition_all_ISread"]["blocks"] if b["id"] != "cai_ISsc"]
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "v3 node changed: " + nid
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_V2_SUBMIT.json")
    print("IA_V2_SUBMIT v4: %d chars, %d nodes" % (len(text), len(index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
