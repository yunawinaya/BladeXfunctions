"""Package F - the classic IA_REVERT v5 (CONTRACT.md RV9): the pinned deployed base (base/IA_REVERT.v4.json, dev v4 = prod v4) +
ONE guard, nothing else. It ships to prod in the full deployment whatever the switches, so every base node stays byte-identical
and in its order (test/revert/diff_v4.py proves it: the output minus the guard re-serializes to the base file's exact bytes).

Right after code_node_iaRvPrep, before if_iaRvRefuse:
  code_node_iaRvCap (prep's liveOut = the component rows, capped like the classic completion's picks; refuse kept) > if_iaRvCap > return_node_iaRvCap = a
  copy of the classic's own refusal return_node_iaRvRefuse (status 200, { code "400", message, conflicts [] }) with
  IA_TEXT.rvClassicTooBig(n, 250) as its message. A refused IA (not Completed, posted, not found) keeps the classic's refusal.
Reads nothing new (no SQL, no V2 table); never answers 401. Keys follow the base's own name-derived style, filter ids are fresh.

usage: python3 revert/classic_v5.py   (prints a summary; build_revert.py BUILDERS["IA_REVERT"] calls build())
"""
import copy
import hashlib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)
BASE = os.path.join(IAV2, "base", "IA_REVERT.v4.json")
BASE_MD5 = "89aa3b08fd6ab756bebe1f02542e29ec"
CAP_JS = os.path.join(IAV2, "code", "revert", "classic", "cap.js")
AFTER = "code_node_iaRvPrep"
BEFORE = "if_iaRvRefuse"
TOP_IDS = ["code_node_iaRvCap", "if_iaRvCap"]
GUARD_IDS = TOP_IDS + ["if_block_iaRvCapTrue", "if_block_iaRvCapFalse", "return_node_iaRvCap"]
FILTER_IDS = (1791000000101, 1791000000102)
CAP = 250


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


def load_base():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "IA_REVERT v4: the base is not the pinned snapshot"
    return raw, json.loads(raw)


def rkey(name, taken):
    """the base's response-key style (scratchpad/iarv/gen.py rkey): the name, lower-case alphanumerics, 8 characters"""
    base = re.sub(r"[^a-z0-9]", "", name.lower())[:8].ljust(8, "0")
    k, n = base, 0
    while k in taken:
        n += 1
        k = base[:6] + str(n).zfill(2)
    taken.add(k)
    return k


def build():
    raw, base = load_base()
    old = index(base)
    for nid in GUARD_IDS:
        assert '"%s"' % nid not in raw, nid + " already in the base"
    for fid in FILTER_IDS:
        assert str(fid) not in raw, fid
    taken = keys_of(base, set())
    tpl_if, tpl_ret, tpl_code = old[BEFORE], old["return_node_iaRvRefuse"], old[AFTER]
    lst = tpl_ret["data"]["response_value"]["list"]
    assert tpl_ret["data"]["status_code"] == 200 and [p["prop"] for p in lst] == ["code", "message", "conflicts"]
    assert [(p["valueType"], p["value"]) for p in lst] == [("value", "400"), ("field", "{{node:code_node_iaRvPrep.data.refuseMessage}}"), ("value", "[]")]
    assert tpl_if["data"]["condition_type"] == "Expression" and [b["data"]["title"] for b in tpl_if["blocks"]] == ["true", "false"]
    title = lambda t: {"title": t, "isValidator": True, "nodeName": t, "name": t}
    ret = copy.deepcopy(tpl_ret)
    ret["id"] = "return_node_iaRvCap"
    ret["data"].update(title("Return Too Large For The Classic Revert"))
    ret["data"]["response_value"]["list"][1]["value"] = "{{node:code_node_iaRvCap.data.message}}"
    iff = copy.deepcopy(tpl_if)
    iff["id"] = "if_iaRvCap"
    iff["data"].update(title("IF More Than 250 Component Rows"))
    iff["data"]["filter"]["list"][0].update({"id": FILTER_IDS[0], "parentId": FILTER_IDS[1]})
    iff["data"]["expression"]["code"] = "'{{node:code_node_iaRvCap.data.tooBig}}' == '1'"
    iff["blocks"][0].update({"id": "if_block_iaRvCapTrue", "blocks": [ret]})
    iff["blocks"][1].update({"id": "if_block_iaRvCapFalse", "blocks": []})
    body = open(CAP_JS, encoding="utf-8").read().rstrip("\n")
    assert "const CAP = %d;" % CAP in body
    d = {k: tpl_code["data"][k] for k in ("language", "code", "timeout")}
    d.update(title("Revert V2 Guard: More Than 250 Component Rows?"))
    d["script"] = {"type": "javascript", "code": body}
    d["response_json"] = [{"key": rkey(n, taken), "name": n, "title": n, "description": "", "bsonType": t, "isExpand": False, "children": []}
                          for n, t in (("tooBig", "int"), ("liveRows", "int"), ("message", "string"))]
    cap = {"id": "code_node_iaRvCap", "type": "code-node", "data": d, "blocks": []}
    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    at = top.index(AFTER) + 1
    assert top[at] == BEFORE, top
    doc["nodes"] = doc["nodes"][:at] + [cap, iff] + doc["nodes"][at:]
    got = index(doc)
    assert sorted(set(got) - set(old)) == sorted(GUARD_IDS), sorted(set(got) - set(old))
    canon = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    for nid, n in old.items():
        assert canon(got[nid]) == canon(n), "IA_REVERT v5: base node changed " + nid
    return doc


if __name__ == "__main__":
    doc = build()
    print("IA_REVERT v5: %d top-level nodes (base %d); guard %s after %s" % (len(doc["nodes"]), len(load_base()[1]["nodes"]), " > ".join(TOP_IDS), AFTER))
