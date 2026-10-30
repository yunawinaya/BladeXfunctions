"""IA_SAVE v16 = v15 (patch_v15.build(), pinned md5 of its written text = dev v27) + transfer requests from a reserved IA
(scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 8; the rule in code/shared/iatr_guard2.js with scratchpad/iatr/code/shared/iatr_reserve.js's
rrStagingCheck, the read in code/shared/iatr_sql2.py). v15's guard read the IA's latest live request and refused a Created / Completed save
while it moved; v16, in the same nodes:
  code_node_IAguardIn       + trItems: the save's line items (digits), for the read
  sql_node_IAguard          iatr: ALL of the IA's supply requests + those items' stock / serial flags (v15's IF gate kept)
  code_node_IAguardStored   iatrg2Decide: any save while a request is in transit -> 400 IA_TR_TRANSIT; a completion while one is open ->
                            400 IA_TR_OPEN; a completion after a receipt -> iatrPicks YES; Created and Draft saves go on (D4)
  code_node_IAtrPicks       the staging check (D11): every line a request can carry at the staging bin, else 400 IA_TR_STAGING
No new node. Every save without a request (or with only Cancelled ones) runs v15's: asserted by undoing every change -> v15 node for node.

usage: python3 scratchpad/iasc/classic/patch_v16.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_SAVE.json)"""
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
import patch_v15 as P15  # noqa: E402
import v2build as V  # noqa: E402
import iatr_sql as Q  # noqa: E402
import iatr_sql2 as Q2  # noqa: E402

P13 = P15.P13
# Item Assembly & BOM/SmallCycle/IA_SAVE.json as patch_v15 writes it = DEV v27 (10-29)
BASE_MD5 = "d4e05469880ebaf55122bb6a337753fc"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
IATR_CODE = os.path.join(REPO, "scratchpad", "iatr", "code")
SEED = 20261030
IN, SQL, STORED, PICKS = P15.IN, P15.SQL, P15.STORED, P15.PICKS

# ---- code_node_IAguardIn: + the save's line items
IN_PAIRS = [
    ('const iaGuardTrTarget = iaGuardDoc.ia_target_status === "Created";\n',
     'const iaGuardTrTarget = iaGuardDoc.ia_target_status === "Created";\n'
     "// transfer requests from a reserved IA (RESERVED_REQUEST_PLAN.md Task 8): the save's line items (digits) for the read's stock / serial flags\n"
     "const iaGuardTrItems = Array.from(new Set((Array.isArray(iaGuardDoc.stock_movement) ? iaGuardDoc.stock_movement : [])\n"
     '  .map((l) => (l && l.item_selection !== undefined && l.item_selection !== null ? String(l.item_selection).trim() : "")).filter((x) => /^[0-9]{1,20}$/.test(x)))).join(",") || "0";\n'),
    ('  trRead: !iaGuardTrDraft || iaGuardTrTarget ? "YES" : "NO",\n};', '  trRead: !iaGuardTrDraft || iaGuardTrTarget ? "YES" : "NO",\n  trItems: iaGuardTrItems,\n};'),
]
IN_NEW = ["trItems"]
# ---- sql_node_IAguard: all of the IA's requests + the items' flags (v15's IF gate kept)
INNER15 = Q.request(V.N(IN, "data.tenantId"), V.N(IN, "data.iaId")).replace("\n", "\n          ")
INNER16 = Q2.requests(V.N(IN, "data.tenantId"), V.N(IN, "data.iaId"), V.N(IN, "data.trItems")).replace("\n", "\n          ")
assert P15.SQL_NOW.count(INNER15) == 1
SQL_NOW = P15.SQL_NOW.replace(INNER15, INNER16)
SQL_TITLE = (P15.SQL_TITLE[1], "IA V2 Guard: the stored status + all of the IA's transfer requests and its lines' items (a save while one moves, a completion)")
# ---- code_node_IAguardStored: v15's decision -> v16's
STORED_PAIR = (
    "// IA transfer request (ENH-20261027-001, code/shared/iatr_guard.js), after the guards above: made Created / Completed while its supply\n"
    "// request still moves -> 400; a received one -> its lines' picks checked at its destination bin (code_node_IAtrPicks). Draft: nothing\n"
    "const iaGuardTr = !iaGuardBusy && !iaGuardFinal && !iaGuardCancelled && !iaGuardBig\n"
    '  ? iatrgDecide(iatrgRequest(iaGuardTrRaw), iatrgOutcome(iaS(iaGuardOut.trDraft) === "YES", iaS(iaGuardOut.trTarget) === "YES", iaGuardStored), iaGuardStored)\n',
    "// transfer requests from a reserved IA (RESERVED_REQUEST_PLAN.md Task 8, code/shared/iatr_guard2.js), after the guards above: any save\n"
    "// while a request is in transit -> 400; a completion while one is open -> 400; a completion after a receipt -> its lines checked at the\n"
    "// staging bin (code_node_IAtrPicks, D11); Created and Draft saves go on\n"
    "const iaGuardTr = !iaGuardBusy && !iaGuardFinal && !iaGuardCancelled && !iaGuardBig\n"
    '  ? iatrg2Decide(iatrg2Read(iaGuardTrRaw), iatrg2Outcome(iaS(iaGuardOut.trDraft) === "YES", iaS(iaGuardOut.trTarget) === "YES", iaGuardStored), iaGuardStored)\n')
STORED_TITLE = (P15.STORED_TITLE[1], "IA V2 Guard: Processing? Completed / Fully Posted saved as Draft? too many picks? a transfer request in transit, or open at a completion?")
# ---- code_node_IAtrPicks: the staging check (D11)
TITLES = {
    PICKS: ("IA transfer request: received - every pick of its lines at its destination bin?",
            "IA transfer request: received - every line a request can carry at the staging bin (D11)?"),
    "if_IAtrPicks": ("IF its transfer request was received: the picks of its lines to check", "IF a transfer request was received: the lines to check at the staging bin (D11)"),
    "if_IAtrPicks400": ("IF a pick of a request line is not at its destination bin (400, nothing written)",
                        "IF a line a request can carry is not at the staging bin (400, nothing written)"),
    "return_node_IAtr400": ("Return Refused 400 (IA transfer request: a pick not at its destination bin)", "Return Refused 400 (IA transfer request: a line not at the staging bin)"),
}


def units():
    """iatr_reserve.js's then iatr_guard2.js's top-level `const` statements (name -> text), in file order (patch_v15.units' rule)"""
    out, cur, last = {}, None, None
    text = V.include_js(IATR_CODE, "shared/iatr_reserve.js") + "\n\n" + V.include_js(CODE, "shared/iatr_guard2.js")
    for ln in text.split("\n"):
        m = re.match(r"^const (\w+)\s*=", ln)
        if m:
            cur = last = m.group(1)
            out[cur] = [ln]
        elif ln.startswith("//") or not ln.strip():
            cur = None
        elif cur:
            out[cur].append(ln)
        else:
            # code outside a unit: a statement a blank or comment line cut short
            assert not ln.startswith((" ", "\t", ")", "}", "]")), "a unit cut short: " + str(last) + ": " + ln[:60]
    return {k: "\n".join(v) for k, v in out.items()}


def uses(text):
    """the statements a text uses (and theirs), in file order"""
    u = units()
    used = lambda t: {k for k in u if re.search(r"\b%s\b" % k, t)}
    need, todo = set(), used(text)
    while todo:
        k = todo.pop()
        if k not in need:
            need.add(k)
            todo |= used(u[k]) - need
    assert need, "uses nothing of iatr_guard2.js"
    return "\n".join(u[k] for k in u if k in need) + "\n"


def build():
    v15 = P15.build()
    text15 = json.dumps(v15, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text15.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v15's build is no longer the deployed v27"
    base = json.loads(text15)
    old = P13.index(base)
    assert "iatrg2" not in text15 and "IATRG2_" not in text15
    taken = P13.keys_of(base, set())
    rng = random.Random(SEED)

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    doc = copy.deepcopy(base)
    got = P13.index(doc)

    def swap(nid, a, b):
        sc = got[nid]["data"]["script"]
        assert sc["code"].count(a) == 1, (nid, a[:80])
        sc["code"] = sc["code"].replace(a, b)

    def retitle(nid, pair):
        d = got[nid]["data"]
        assert d["title"] == d["nodeName"] == d["name"] == pair[0], (nid, d["title"])
        d.update({"title": pair[1], "nodeName": pair[1], "name": pair[1]})

    def fresh(nid, inline):
        # every name a new unit defines is not already defined in the node
        code = got[nid]["data"]["script"]["code"]
        for name in re.findall(r"^const (\w+)\s*=", inline, re.M):
            assert not re.search(r"^\s*(const|let|var) %s\b" % name, code, re.M), (nid, name)

    # ---- the guard's input: + the line items
    for a, b in IN_PAIRS:
        swap(IN, a, b)
    rj = got[IN]["data"]["response_json"]
    assert "trItems" not in [r["name"] for r in rj]
    rj.append({"key": key(), "name": "trItems", "title": "", "description": "", "bsonType": "string", "isExpand": False, "children": []})
    # ---- the read
    sq = got[SQL]["data"]["script"]
    assert sq["code"].count(P15.SQL_NOW) == 1, "v15's request read is not in the node as written"
    sq["code"] = V.wrap_sql(sq["code"].replace(P15.SQL_NOW, SQL_NOW))
    retitle(SQL, SQL_TITLE)
    # ---- the decision: v15's inlined iatr_guard.js units and its call -> v16's
    decide15 = "".join(b for _, b in P15.STORED_PAIRS)
    units15 = P15.uses(decide15)
    decide16 = decide15.replace(STORED_PAIR[0], STORED_PAIR[1])
    assert decide16 != decide15
    units16 = uses(decide16)
    swap(STORED, units15 + P15.STORED_AT, P15.STORED_AT)
    fresh(STORED, units16)
    swap(STORED, P15.STORED_AT, units16 + P15.STORED_AT)
    swap(STORED, STORED_PAIR[0], STORED_PAIR[1])
    retitle(STORED, STORED_TITLE)
    # ---- the picks node: the staging check
    pc = got[PICKS]["data"]["script"]
    body15 = V.raw(CODE, "classic/iatr_picks.js")
    assert pc["code"] == P15.uses(body15) + body15, "v15's picks node is not as written"
    body16 = V.raw(CODE, "classic/iatr_staging.js")
    pc["code"] = uses(body16) + body16
    for nid, pair in TITLES.items():
        retitle(nid, pair)
    after = P13.index(doc)
    assert sorted(after) == sorted(old), sorted(set(after) ^ set(old))

    # identity: every change undone -> v15 node for node
    rev = copy.deepcopy(doc)
    ri = P13.index(rev)
    undo = [(IN, b, a) for a, b in IN_PAIRS] + [(STORED, STORED_PAIR[1], STORED_PAIR[0]), (STORED, units16 + P15.STORED_AT, units15 + P15.STORED_AT)]
    for nid, a, b in undo:
        c = ri[nid]["data"]["script"]
        assert c["code"].count(a) == 1, ("undo", nid, a[:60])
        c["code"] = c["code"].replace(a, b)
    rs = ri[SQL]["data"]["script"]
    rs["code"] = V.wrap_sql(rs["code"].replace(SQL_NOW, P15.SQL_NOW))
    ri[PICKS]["data"]["script"]["code"] = P15.uses(body15) + body15
    ri[IN]["data"]["response_json"] = [r for r in ri[IN]["data"]["response_json"] if r["name"] not in IN_NEW]
    for nid, pair in [(SQL, SQL_TITLE), (STORED, STORED_TITLE)] + list(TITLES.items()):
        ri[nid]["data"].update({"title": pair[0], "nodeName": pair[0], "name": pair[0]})
    for nid, n in old.items():
        assert P13.canon(ri[nid]) == P13.canon(n), "v15 node changed: " + nid
    new_keys = [r["key"] for r in after[IN]["data"]["response_json"] if r["name"] in IN_NEW]
    assert len(new_keys) == 1 and not set(new_keys) & P13.keys_of(base, set()), "the new key collides with v15's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_SAVE.json")
    print("IA_SAVE v16: %d chars, %d nodes" % (len(text), len(P13.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
