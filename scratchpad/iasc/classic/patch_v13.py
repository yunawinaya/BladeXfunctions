"""IA_SAVE v13 = the deployed v12 (Item Assembly & BOM/AsyncV2/IA_SAVE.json, pinned md5, = dev v12) + the Small Cycle check
(scratchpad/iasc/CONTRACT.md) after the required-field check, so it runs for Draft and Completed alike, before any write:
  code_node_SCin       read when an Edit (stored values kept for keys a payload leaves out) or when Small Cycle keys are present
  if_SCread            -> sql_node_SCsource: CLASSIC_SC_SOURCE (stored fields + the line of the link + its SO header)
  code_node_SCcheck    merge, link pair, NEW link eligibility (baseline from the server's read), existing link item, Flat / snapshot
  if_SCfailed          -> return_node_SC400 (a copy of v12's return_required_400: {code "400", message})
and the 4 header writes (add_ia, update_ia, add_draft, update_draft) gain the 7 Small Cycle props from code_node_SCcheck.
Every other v12 node is byte-identical (asserted); the write nodes differ only by the appended props (asserted).

usage: python3 scratchpad/iasc/classic/patch_v13.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_SAVE.json)"""
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
import v2build as V  # noqa: E402
import sql as S  # noqa: E402

BASE = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2", "IA_SAVE.json")
BASE_MD5 = "3faadd2358a747f3dff7b48ef305d2cf"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
SEED = 20261020
FILTER_BASE = 1792200000000
IN, SRC, CHK = "code_node_SCin", "sql_node_SCsource", "code_node_SCcheck"
NEW_IDS = [IN, "if_SCread", "if_SCread_t", "if_SCread_f", SRC, CHK, "if_SCfailed", "if_SCfailed_t", "if_SCfailed_f", "return_node_SC400"]
IN_FIELDS = ["need", "edit", "tenantId", "iaId", "lineId", "present"]
SC_PROPS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"]
CHK_FIELDS = ["route", "message"] + SC_PROPS
# IA_SAVE only (IA_V2_SUBMIT v4 declares IN_FIELDS / CHK_FIELDS as they are): the ids whose stored keys to read, the lines to write
CLASSIC_IN_FIELDS = IN_FIELDS + ["lineIds"]
CLASSIC_CHK_FIELDS = CHK_FIELDS + ["scLines"]
# the lines the 4 writes take: code_fillback's, with the stored sc_ref_key put back on a line a mobile save sent without one
LINES_FROM, LINES_TO = "{{node:code_fillback.data.allData.stock_movement}}", "{{node:code_node_SCcheck.data.scLines.stock_movement}}"
WRITES = {"add_ia": 25, "update_ia": 26, "add_draft": 24, "update_draft": 23}


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


def canon(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def body(name):
    shared = "\n".join(V.include_js(CODE, "shared/" + f) for f in ("sc_bom.js", "sc_proj.js", "sc_check.js"))
    return shared + "\n" + V.raw(CODE, "classic/" + name)


def build():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "AsyncV2/IA_SAVE.json is not the pinned v12"
    base = json.loads(raw)
    old = index(base)
    for nid in NEW_IDS:
        assert '"%s"' % nid not in raw, nid + " already in v12"
    assert str(FILTER_BASE)[:7] not in raw
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
        # scLines carries the line array, typed like code_fillback's allData
        return [{"key": key(), "name": n, "title": "", "description": "", "bsonType": "any" if n == "scLines" else "string", "isExpand": False, "children": []}
                for n in names]

    def code(nid, t, text, names):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(title(t))
        d["script"] = {"type": "javascript", "code": text}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def sql(nid, t, text, names):
        d = {"database_id": "", "sql": "", "params": {}}
        d.update(title(t))
        d["script"] = {"type": "sql", "code": V.wrap_sql(text)}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "sql-node", "data": d, "blocks": []}

    tpl_if = old["if_idem_blocked"]
    assert tpl_if["data"]["condition_type"] == "Expression" and [b["data"]["title"] for b in tpl_if["blocks"]] == ["true", "false"]

    def if_(nid, t, expr, yes):
        assert yes
        n = copy.deepcopy(tpl_if)
        n["id"] = nid
        n["data"].update(title(t))
        fid[0] += 2
        n["data"]["filter"]["list"][0].update({"id": fid[0] - 1, "parentId": fid[0]})
        n["data"]["expression"]["code"] = expr
        n["blocks"][0].update({"id": nid + "_t", "blocks": list(yes)})
        n["blocks"][1].update({"id": nid + "_f", "blocks": []})
        return n

    r400 = copy.deepcopy(old["return_required_400"])
    lst = r400["data"]["response_value"]["list"]
    assert r400["data"]["status_code"] == 200 and [p["prop"] for p in lst] == ["code", "message"] and lst[0]["value"] == "400"
    r400["id"] = "return_node_SC400"
    r400["data"].update(title("Return Refused 400 (Small Cycle)"))
    lst[1]["value"] = V.N(CHK, "data.message")

    nodes = [
        code(IN, "Small Cycle: stored fields to keep (Edit) or a link to check?", body("sc_in.js"), CLASSIC_IN_FIELDS),
        if_("if_SCread", "IF Small Cycle data to read", "'%s' == 'YES'" % V.N(IN, "data.need"), [
            sql(SRC, "Small Cycle: the stored fields and the linked SO line + header",
                V.sub(S.CLASSIC_SC_SOURCE_KEYS, T=V.N(IN, "data.tenantId"), IA=V.N(IN, "data.iaId"), LINE=V.N(IN, "data.lineId"), IDS=V.N(IN, "data.lineIds")),
                ["j"])]),
        code(CHK, "Small Cycle: merge, link and snapshot checks", body("sc_check.js"), CLASSIC_CHK_FIELDS),
        if_("if_SCfailed", "IF the Small Cycle check refused", "'%s' == 'STOP'" % V.N(CHK, "data.route"), [r400]),
    ]
    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("if_required_failed")
    assert top[i + 1] == "if_validate", top[i - 2:i + 3]
    doc["nodes"] = doc["nodes"][:i + 1] + nodes + doc["nodes"][i + 1:]
    got = index(doc)
    for nid, count in WRITES.items():
        props = got[nid]["data"]["props"]["list"]
        assert len(props) == count and not set(p["prop"] for p in props) & set(SC_PROPS), nid
        # a FIELD prop as the template: the last one (posted_status on add_ia / update_ia) is a literal value
        tpl = [p for p in props if p["valueType"] == "field" and p["prop"] == "item_id"][0]
        for p in SC_PROPS:
            e = copy.deepcopy(tpl)
            e.update({"prop": p, "propLabel": p, "value": V.N(CHK, "data." + p)})
            props.append(e)
        lp = [p for p in props if p["prop"] == "stock_movement"]
        assert len(lp) == 1 and lp[0]["value"] == LINES_FROM, (nid, lp)
        lp[0]["value"] = LINES_TO
    assert sorted(set(got) - set(old)) == sorted(NEW_IDS), sorted(set(got) - set(old))
    rev = copy.deepcopy(doc)
    ri = index(rev)
    for nid, count in WRITES.items():
        ri[nid]["data"]["props"]["list"] = ri[nid]["data"]["props"]["list"][:count]
        for p in ri[nid]["data"]["props"]["list"]:
            if p["prop"] == "stock_movement":
                p["value"] = LINES_FROM
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "v12 node changed: " + nid
    new_keys = []
    for nd in nodes:
        new_keys.extend(sorted(keys_of(nd, set())))
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & keys_of(base, set()), "a new key repeats or collides with v12's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_SAVE.json")
    print("IA_SAVE v13: %d chars, %d nodes" % (len(text), len(index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
