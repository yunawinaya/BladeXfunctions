"""IA_V2_SUBMIT v8 = v7 (patch_v7.build(), pinned md5 of its written text = dev v16) + transfer requests from a reserved IA
(scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 8; the rule in code/shared/iatr_guard2.js with scratchpad/iatr/code/shared/iatr_reserve.js's
rrStagingCheck, the read in code/shared/iatr_sql2.py), as IA_SAVE v16's, in v7's places:
  sql_node_ISfacts    iatr: ALL of the IA's supply requests (the items: the gate's own read); v7's constant gate kept
  code_node_ISentry   a stored Draft / Created about to complete while a request is in transit -> STOP 400 IA_TR_TRANSIT, while one is open
                      -> IA_TR_OPEN, unreadable -> IA_TR_UNREADABLE; nothing written
  code_node_ISgate    a completion after a receipt: every line a request can carry at the staging bin (D11), else STOP 400 IA_TR_STAGING -
                      right after the record is built, with this submit's items, before the classic gates answer
No new node. Every other submit runs v7's: asserted by undoing every change -> v7 node for node.

usage: python3 scratchpad/iasc/submit/patch_v8.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json)"""
import copy
import hashlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(IASC, "..", ".."))
IAV2 = os.path.join(IASC, "..", "iav2")
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(IAV2, "lib"))
sys.path.insert(0, os.path.join(IASC, "code", "shared"))
import patch_v7 as P7  # noqa: E402
import v2build as V  # noqa: E402
import iatr_sql as Q  # noqa: E402
import iatr_sql2 as Q2  # noqa: E402

P4 = P7.P4
# Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json as patch_v7 writes it = DEV v16 (10-29)
BASE_MD5 = "2bc87a52733f148c2b84fc2c9f0e682d"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
IATR_CODE = os.path.join(REPO, "scratchpad", "iatr", "code")
FACTS, ENTRY, GATE, GUARD = P7.FACTS, P7.ENTRY, P7.GATE, P7.GUARD
# ---- sql_node_ISfacts: all of the IA's requests (v7's gate kept)
FACTS_GATE = "%s > 0 AND '%s' = 'SUBMIT'\n            AND " % (V.N(GUARD, "data.iaId"), V.N(GUARD, "data.operation"))
INNER7 = Q.request(V.N(GUARD, "data.tenantId"), V.N(GUARD, "data.iaId"), gate=FACTS_GATE).replace("\n", "\n       ")
INNER8 = Q2.requests(V.N(GUARD, "data.tenantId"), V.N(GUARD, "data.iaId"), "0", gate=FACTS_GATE).replace("\n", "\n       ")
assert P7.FACTS_NOW.count(INNER7) == 1
FACTS_NOW = P7.FACTS_NOW.replace(INNER7, INNER8)
FACTS_TITLE = (P7.FACTS_TITLE[1], P7.FACTS_TITLE[1].replace("its transfer request; DB clock", "all of its transfer requests; DB clock"))
# ---- code_node_ISentry: v7's decision -> v8's
ENTRY_PAIR = (
    "    // IA transfer request (ENH-20261027-001, code/shared/iatr_guard.js): its supply request still moving (or unreadable) -> STOP 400,\n"
    "    // nothing written; a received one: the gate checks the picks\n"
    '    const tr = iatrgDecide(iatrgRequest(f.iatr), "COMPLETED", stored);\n',
    "    // transfer requests from a reserved IA (RESERVED_REQUEST_PLAN.md Task 8, code/shared/iatr_guard2.js): a request in transit or open\n"
    "    // (or unreadable) -> STOP 400, nothing written; after a receipt the gate checks the staging bin (D11)\n"
    '    const tr = iatrg2Decide(iatrg2Read(f.iatr), "COMPLETED", stored);\n')
# ---- code_node_ISgate: v7's picks -> v8's staging check
GATE_PAIR = (
    "  // IA transfer request (ENH-20261027-001, code/shared/iatr_guard.js): a received supply request -> every pick of its lines at its\n"
    "  // destination bin (the entry refused one still moving), before the classic gates answer, as IA_SAVE's guard does\n"
    "  const trFacts = list(R.facts)[0] || {};\n"
    "  const trReq = iatrgRequest(trFacts.iatr);\n"
    '  if (iatrgDecide(trReq, "COMPLETED", s(trFacts.item_assembly_status)).picks) {\n'
    "    const tp = iatrgPicks(lines, trReq);\n",
    "  // transfer requests from a reserved IA (RESERVED_REQUEST_PLAN.md Task 8, code/shared/iatr_guard2.js): a completion after a receipt ->\n"
    "  // every line a request can carry at the staging bin (D11; this submit's items), before the classic gates answer, as IA_SAVE's guard\n"
    "  // does (the entry refused one in transit or open)\n"
    "  const trFacts = list(R.facts)[0] || {};\n"
    "  const trReq = iatrg2Read(trFacts.iatr);\n"
    '  if (iatrg2Decide(trReq, "COMPLETED", s(trFacts.item_assembly_status)).picks) {\n'
    "    const tp = iatrg2Staging(lines, trReq, byItem);\n")


def units():
    """iatr_reserve.js's then iatr_guard2.js's top-level `const` statements (patch_v16.units' rule: a statement cut short is an error)"""
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
    v7 = P7.build()
    text7 = json.dumps(v7, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text7.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v7's build is no longer the deployed v16"
    base = json.loads(text7)
    old = P4.index(base)
    assert "iatrg2" not in text7 and "IATRG2_" not in text7
    doc = copy.deepcopy(base)
    got = P4.index(doc)

    def swap(nid, a, b):
        sc = got[nid]["data"]["script"]
        assert sc["code"].count(a) == 1, (nid, a[:80])
        sc["code"] = sc["code"].replace(a, b)

    def fresh(nid, inline):
        code = got[nid]["data"]["script"]["code"]
        for name in re.findall(r"^const (\w+)\s*=", inline, re.M):
            assert not re.search(r"^\s*(const|let|var) %s\b" % name, code, re.M), (nid, name)

    # ---- the read
    fs = got[FACTS]["data"]
    assert fs["script"]["code"].count(P7.FACTS_NOW) == 1, "v7's request read is not in the facts as written"
    fs["script"]["code"] = V.wrap_sql(fs["script"]["code"].replace(P7.FACTS_NOW, FACTS_NOW))
    assert fs["title"] == fs["nodeName"] == fs["name"] == FACTS_TITLE[0], fs["title"]
    fs.update({"title": FACTS_TITLE[1], "nodeName": FACTS_TITLE[1], "name": FACTS_TITLE[1]})
    # ---- the entry: v7's inlined iatr_guard.js units and its call -> v8's
    e7 = P7.ENTRY_PAIR[1]
    e8 = e7.replace(ENTRY_PAIR[0], ENTRY_PAIR[1])
    assert e8 != e7
    swap(ENTRY, P7.uses(e7) + P7.ENTRY_AT, P7.ENTRY_AT)
    fresh(ENTRY, uses(e8))
    swap(ENTRY, P7.ENTRY_AT, uses(e8) + P7.ENTRY_AT)
    swap(ENTRY, ENTRY_PAIR[0], ENTRY_PAIR[1])
    # ---- the gate
    g7 = P7.GATE_PAIRS[0][1]
    g8 = g7.replace(GATE_PAIR[0], GATE_PAIR[1])
    assert g8 != g7
    swap(GATE, P7.uses(g7) + P7.GATE_AT, P7.GATE_AT)
    fresh(GATE, uses(g8))
    swap(GATE, P7.GATE_AT, uses(g8) + P7.GATE_AT)
    swap(GATE, GATE_PAIR[0], GATE_PAIR[1])
    after = P4.index(doc)
    assert sorted(after) == sorted(old), sorted(set(after) ^ set(old))

    # identity: every change undone -> v7 node for node
    rev = copy.deepcopy(doc)
    ri = P4.index(rev)
    undo = [(ENTRY, ENTRY_PAIR[1], ENTRY_PAIR[0]), (ENTRY, uses(e8) + P7.ENTRY_AT, P7.uses(e7) + P7.ENTRY_AT),
            (GATE, GATE_PAIR[1], GATE_PAIR[0]), (GATE, uses(g8) + P7.GATE_AT, P7.uses(g7) + P7.GATE_AT)]
    for nid, a, b in undo:
        c = ri[nid]["data"]["script"]
        assert c["code"].count(a) == 1, ("undo", nid, a[:60])
        c["code"] = c["code"].replace(a, b)
    rd = ri[FACTS]["data"]
    rd["script"]["code"] = V.wrap_sql(rd["script"]["code"].replace(FACTS_NOW, P7.FACTS_NOW))
    rd.update({"title": FACTS_TITLE[0], "nodeName": FACTS_TITLE[0], "name": FACTS_TITLE[0]})
    for nid, n in old.items():
        assert P4.canon(ri[nid]) == P4.canon(n), "v7 node changed: " + nid
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_V2_SUBMIT.json")
    print("IA_V2_SUBMIT v8: %d chars, %d nodes" % (len(text), len(P4.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
