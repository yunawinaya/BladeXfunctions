"""IA_SAVE v15 = the deployed v14 (patch_v14.build(), pinned md5 of its written text = dev v26 = prod v12) + the IA transfer request
guard (ENH-20261027-001, spec IA-LT-06; the rule in code/shared/iatr_guard.js, the read in code/shared/iatr_sql.py). Inside the existing
stored-IA guard, before any other node reads or writes anything:
  code_node_IAguardIn       + trDraft / trTarget (code_fillback's Draft path and ia_target_status, compared as it compares them) and trRead
                            (a completion or a Created save: the stored read takes the IA's supply request)
  sql_node_IAguard          + iatr: the IA's latest request that is not Cancelled (JSON text), read only when trRead or the IA is stored
                            other than Draft (IF: a Draft save of a stored Draft never runs it)
  code_node_IAguardStored   after its own guards: a Created / Completed outcome while the request still moves -> refuse400 with the
                            request's message (the existing if_IAguard400 / return_node_IAguard400); a received one -> iatrPicks YES
  if_IAtrPicks (new)        after if_IAguard409: code_node_IAtrPicks (every pick of a request line at its destination bin) -> 400
                            return_node_IAtr400
Every other save (no Edit, a Draft outcome, no request or only Cancelled ones) runs v14's calls and writes: asserted by undoing every
change -> v14 node for node.

usage: python3 scratchpad/iasc/classic/patch_v15.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_SAVE.json)"""
import copy
import hashlib
import json
import os
import random
import re
import string
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(IASC, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(IASC, "..", "iav2", "lib"))
sys.path.insert(0, os.path.join(IASC, "code", "shared"))
import patch_v14 as P14  # noqa: E402
import v2build as V  # noqa: E402
import wfkit as K  # noqa: E402
import iatr_sql as Q  # noqa: E402

P13 = P14.P13
# Item Assembly & BOM/SmallCycle/IA_SAVE.json as patch_v14 writes it = DEV v26 = PROD v12 (10-28)
BASE_MD5 = "ca7c1589b882d74c6941f6abdc2ea52c"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
SEED = 20261028
FILTER_BASE = 1792600000000
IN, SQL, STORED, PICKS = "code_node_IAguardIn", "sql_node_IAguard", "code_node_IAguardStored", "code_node_IAtrPicks"
NEW_IDS = ["if_IAtrPicks", "if_IAtrPicks_t", "if_IAtrPicks_f", PICKS, "if_IAtrPicks400", "if_IAtrPicks400_t", "if_IAtrPicks400_f", "return_node_IAtr400"]

# ---- code_node_IAguardIn: code_fillback's outcome inputs, exactly as it compares them, and the read's gate
IN_PAIRS = [
    ('const iaGuardBig = iaGuardSaveAs !== "Draft" && iaGuardPicks > IA_CLASSIC_MAX_PICKS;\n',
     'const iaGuardBig = iaGuardSaveAs !== "Draft" && iaGuardPicks > IA_CLASSIC_MAX_PICKS;\n'
     '// IA transfer request (ENH-20261027-001): code_fillback\'s outcome inputs as it compares them - the Draft path (saveAs exactly "Draft",\n'
     '// as if_validate / if_persist test it) and ia_target_status Created - and whether the stored read takes the IA\'s supply request (a\n'
     '// completion or a Created save; the read adds an IA stored other than Draft, which a Draft-path save keeps Created)\n'
     'const iaGuardTrDraft = iaGuardIn.saveAs === "Draft";\n'
     'const iaGuardTrTarget = iaGuardDoc.ia_target_status === "Created";\n'),
    ('  bigMessage: iaGuardBig ? IA_TEXT.classicTooBig(iaGuardPicks, IA_CLASSIC_MAX_PICKS) : "",\n};',
     '  bigMessage: iaGuardBig ? IA_TEXT.classicTooBig(iaGuardPicks, IA_CLASSIC_MAX_PICKS) : "",\n'
     '  trDraft: iaGuardTrDraft ? "YES" : "NO",\n'
     '  trTarget: iaGuardTrTarget ? "YES" : "NO",\n'
     '  trRead: !iaGuardTrDraft || iaGuardTrTarget ? "YES" : "NO",\n};'),
]
IN_NEW = ["trDraft", "trTarget", "trRead"]
# ---- sql_node_IAguard: + the request (IF: never run for a Draft-path save of a stored Draft)
SQL_WAS = "SELECT CAST(h.id AS CHAR) AS ia_id, h.item_assembly_status, h.stock_movement_no\n"
SQL_NOW = ("SELECT CAST(h.id AS CHAR) AS ia_id, h.item_assembly_status, h.stock_movement_no,\n"
           "       IF('%s' = 'YES' OR h.item_assembly_status <> 'Draft',\n          %s,\n          NULL) AS iatr\n"
           % (V.N(IN, "data.trRead"), Q.request(V.N(IN, "data.tenantId"), V.N(IN, "data.iaId")).replace("\n", "\n          ")))
SQL_TITLE = ("IA V2 Guard: the stored status (sm_item_assembly only)",
             "IA V2 Guard: the stored status + the IA's transfer request (a Created / Completed save)")
# ---- code_node_IAguardStored: after its own guards, the request's decision
STORED_AT = "// The STORED status decides: Processing = a background job holds it"
STORED_PAIRS = [
    ('let iaGuardStoredNo = "";\n',
     'let iaGuardStoredNo = "";\n// IA transfer request (ENH-20261027-001): the read\'s request column (absent = none)\nlet iaGuardTrRaw = null;\n'),
    ("  iaGuardStoredNo = iaS(row.stock_movement_no);\n",
     "  iaGuardStoredNo = iaS(row.stock_movement_no);\n  iaGuardTrRaw = row.iatr === undefined ? null : row.iatr;\n"),
    ('const iaGuardBig = !iaGuardBusy && !iaGuardFinal && !iaGuardCancelled && iaS(iaGuardOut.big) === "YES";\n',
     'const iaGuardBig = !iaGuardBusy && !iaGuardFinal && !iaGuardCancelled && iaS(iaGuardOut.big) === "YES";\n'
     "// IA transfer request (ENH-20261027-001, code/shared/iatr_guard.js), after the guards above: made Created / Completed while its supply\n"
     "// request still moves -> 400; a received one -> its lines' picks checked at its destination bin (code_node_IAtrPicks). Draft: nothing\n"
     "const iaGuardTr = !iaGuardBusy && !iaGuardFinal && !iaGuardCancelled && !iaGuardBig\n"
     '  ? iatrgDecide(iatrgRequest(iaGuardTrRaw), iatrgOutcome(iaS(iaGuardOut.trDraft) === "YES", iaS(iaGuardOut.trTarget) === "YES", iaGuardStored), iaGuardStored)\n'
     '  : { refuse: false, code: "", message: "", picks: false };\n'),
    ('  refuse400: iaGuardBusy || iaGuardBig ? "YES" : "NO",\n', '  refuse400: iaGuardBusy || iaGuardBig || iaGuardTr.refuse ? "YES" : "NO",\n'),
    (' : iaGuardBig ? iaS(iaGuardOut.bigMessage) : "",\n};',
     ' : iaGuardBig ? iaS(iaGuardOut.bigMessage) : iaGuardTr.message,\n  iatrPicks: iaGuardTr.picks ? "YES" : "NO",\n};'),
]
STORED_NEW = ["iatrPicks"]
STORED_TITLE = ("IA V2 Guard: Processing? Completed / Fully Posted saved as Draft? too many picks?",
                "IA V2 Guard: Processing? Completed / Fully Posted saved as Draft? too many picks? its transfer request still moving?")


def units():
    """iatr_guard.js's top-level `const` statements (name -> text), in file order (patch_v14.os_units' rule)"""
    out, cur = {}, None
    for ln in V.include_js(CODE, "shared/iatr_guard.js").split("\n"):
        m = re.match(r"^const (\w+)\s*=", ln)
        if m:
            cur = m.group(1)
            out[cur] = [ln]
        elif ln.startswith("//") or not ln.strip():
            cur = None
        elif cur:
            out[cur].append(ln)
    return {k: "\n".join(v) for k, v in out.items()}


def uses(text):
    """the iatr_guard.js statements a text uses (and theirs), in file order"""
    u = units()
    used = lambda t: {k for k in u if re.search(r"\b%s\b" % k, t)}
    need, todo = set(), used(text)
    while todo:
        k = todo.pop()
        if k not in need:
            need.add(k)
            todo |= used(u[k]) - need
    assert need, "uses nothing of iatr_guard.js"
    return "\n".join(u[k] for k in u if k in need) + "\n"


def build():
    v14 = P14.build()
    text14 = json.dumps(v14, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text14.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v14's build is no longer the deployed v26"
    base = json.loads(text14)
    old = P13.index(base)
    for nid in NEW_IDS:
        assert '"%s"' % nid not in text14, nid + " already in v14"
    assert str(FILTER_BASE)[:7] not in text14 and "iatrg" not in text14 and "IATRG_" not in text14
    taken = P13.keys_of(base, set())
    rng = random.Random(SEED)
    ids = K.Ids(FILTER_BASE)

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    def title(t):
        return {"title": t, "isValidator": True, "nodeName": t, "name": t}

    def resp(names):
        return [{"key": key(), "name": n, "title": "", "description": "", "bsonType": "string", "isExpand": False, "children": []} for n in names]

    doc = copy.deepcopy(base)
    got = P13.index(doc)

    def swap(nid, a, b):
        sc = got[nid]["data"]["script"]
        assert sc["code"].count(a) == 1, (nid, a[:80])
        sc["code"] = sc["code"].replace(a, b)

    def declare(nid, names):
        rj = got[nid]["data"]["response_json"]
        assert not {r["name"] for r in rj} & set(names), nid
        rj.extend(resp(names))

    def retitle(nid, pair):
        d = got[nid]["data"]
        assert d["title"] == d["nodeName"] == d["name"] == pair[0], (nid, d["title"])
        d.update(title(pair[1]))

    # ---- the guard's input, read and decision
    for a, b in IN_PAIRS:
        swap(IN, a, b)
    declare(IN, IN_NEW)
    sq = got[SQL]["data"]["script"]
    assert sq["code"].count(SQL_WAS) == 1 and V.wrap_sql(sq["code"]) == sq["code"], "the guard's SQL changed"
    sq["code"] = V.wrap_sql(sq["code"].replace(SQL_WAS, SQL_NOW))
    declare(SQL, ["iatr"])
    retitle(SQL, SQL_TITLE)
    for a, b in STORED_PAIRS:
        swap(STORED, a, b)
    decide = "".join(b for _, b in STORED_PAIRS)
    swap(STORED, STORED_AT, uses(decide) + STORED_AT)
    declare(STORED, STORED_NEW)
    retitle(STORED, STORED_TITLE)
    # ---- a received request: the picks (a code node of its own: only such a save injects the payload a third time)
    tpl_if = old["if_IAguard400"]
    assert tpl_if["data"]["condition_type"] == "Expression" and [b["data"]["title"] for b in tpl_if["blocks"]] == ["true", "false"]

    def if_(nid, t, expr, yes):
        n = copy.deepcopy(tpl_if)
        n["id"] = nid
        n["data"].update(title(t))
        n["data"]["filter"]["list"][0].update({"id": ids(), "parentId": ids()})
        n["data"]["expression"]["code"] = expr
        n["blocks"][0].update({"id": nid + "_t", "blocks": list(yes)})
        n["blocks"][1].update({"id": nid + "_f", "blocks": []})
        return n

    r400 = copy.deepcopy(old["return_node_IAguard400"])
    lst = r400["data"]["response_value"]["list"]
    assert r400["data"]["status_code"] == 200 and [p["prop"] for p in lst] == ["code", "message"] and lst[0]["value"] == "400", lst
    r400["id"] = "return_node_IAtr400"
    r400["data"].update(title("Return Refused 400 (IA transfer request: a pick not at its destination bin)"))
    lst[1]["value"] = V.N(PICKS, "data.message")
    body = V.raw(CODE, "classic/iatr_picks.js")
    d = {"language": "javascript", "code": "", "timeout": 30000}
    d.update(title("IA transfer request: received - every pick of its lines at its destination bin?"))
    d["script"] = {"type": "javascript", "code": uses(body) + body}
    d["response_json"] = resp(["route", "message"])
    picks = if_("if_IAtrPicks", "IF its transfer request was received: the picks of its lines to check", "'%s' == 'YES'" % V.N(STORED, "data.iatrPicks"), [
        {"id": PICKS, "type": "code-node", "data": d, "blocks": []},
        if_("if_IAtrPicks400", "IF a pick of a request line is not at its destination bin (400, nothing written)", "'%s' == 'STOP'" % V.N(PICKS, "data.route"), [r400])])
    rt = got["if_IAguardRead"]["blocks"][0]["blocks"]
    assert [n["id"] for n in rt] == [SQL, STORED, "if_IAguard400", "if_IAguard409"], [n["id"] for n in rt]
    rt.append(picks)
    after = P13.index(doc)
    assert sorted(set(after) - set(old)) == sorted(NEW_IDS), sorted(set(after) ^ set(NEW_IDS) - set(old))

    # identity: every change undone -> v14 node for node
    rev = copy.deepcopy(doc)
    ri = P13.index(rev)
    ri["if_IAguardRead"]["blocks"][0]["blocks"] = [n for n in ri["if_IAguardRead"]["blocks"][0]["blocks"] if n["id"] != "if_IAtrPicks"]
    ri = P13.index(rev)
    undo = [(IN, b, a) for a, b in IN_PAIRS] + [(STORED, uses(decide) + STORED_AT, STORED_AT)] + [(STORED, b, a) for a, b in STORED_PAIRS]
    for nid, a, b in undo:
        c = ri[nid]["data"]["script"]
        assert c["code"].count(a) == 1, ("undo", nid, a[:60])
        c["code"] = c["code"].replace(a, b)
    rs = ri[SQL]["data"]["script"]
    rs["code"] = rs["code"].replace(V.wrap_sql(SQL_NOW), SQL_WAS) if V.wrap_sql(SQL_NOW) in rs["code"] else rs["code"].replace(SQL_NOW, SQL_WAS)
    for nid, names in ((IN, IN_NEW), (SQL, ["iatr"]), (STORED, STORED_NEW)):
        ri[nid]["data"]["response_json"] = [r for r in ri[nid]["data"]["response_json"] if r["name"] not in names]
    for nid, pair in ((SQL, SQL_TITLE), (STORED, STORED_TITLE)):
        ri[nid]["data"].update(title(pair[0]))
    assert sorted(ri) == sorted(old), sorted(set(ri) ^ set(old))
    for nid, n in old.items():
        assert P13.canon(ri[nid]) == P13.canon(n), "v14 node changed: " + nid
    new_keys = []
    for nid in NEW_IDS:
        if after[nid].get("type") != "ifBlock":
            new_keys.extend(sorted(P13.keys_of({k: v for k, v in after[nid].items() if k != "blocks"}, set())))
    for nid, names in ((IN, IN_NEW), (SQL, ["iatr"]), (STORED, STORED_NEW)):
        new_keys.extend(r["key"] for r in after[nid]["data"]["response_json"] if r["name"] in names)
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & P13.keys_of(base, set()), "a new key repeats or collides with v14's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_SAVE.json")
    print("IA_SAVE v15: %d chars, %d nodes" % (len(text), len(P13.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
