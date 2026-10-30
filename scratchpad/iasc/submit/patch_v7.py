"""IA_V2_SUBMIT v7 = the deployed v15 (patch_v6.build(), pinned md5 of its written text = dev v15 = prod v14) + the IA transfer request
guard (ENH-20261027-001, spec IA-LT-06; the rule in code/shared/iatr_guard.js, the read in code/shared/iatr_sql.py), as IA_SAVE v15's:
  sql_node_ISfacts    + iatr: the IA's latest request that is not Cancelled (JSON text); a constant gate (a stored IA, a SUBMIT) makes it
                      Impossible WHERE for an Add and for every STATUS poll
  code_node_ISentry   a stored Draft / Created about to complete while its request still moves (or unreadable): STOP 400 IA_TR_LIVE /
                      IA_TR_UNREADABLE, nothing written (after the key job, STATUS, BUSY, STALE and final checks, as before)
  code_node_ISgate    a received request: every pick of its lines at its destination bin, else STOP 400 IA_TR_PICK - right after the
                      record is built, before the classic gates answer (IA_SAVE checks it in its guard, before code_fillback)
No new node. Every other submit runs v15's: asserted by undoing every change -> v15 (patch_v6) node for node.

usage: python3 scratchpad/iasc/submit/patch_v7.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json)"""
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
IAV2 = os.path.join(IASC, "..", "iav2")
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(IAV2, "lib"))
sys.path.insert(0, os.path.join(IASC, "code", "shared"))
import patch_v6 as P6  # noqa: E402
import v2build as V  # noqa: E402
import iatr_sql as Q  # noqa: E402

P4 = P6.P4
# Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json as patch_v6 writes it = DEV v15 = PROD v14 (10-28)
BASE_MD5 = "2bc31b85508e3646c83acb5739752257"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
SEED = 20261028
FACTS, ENTRY, GATE = "sql_node_ISfacts", "code_node_ISentry", "code_node_ISgate"
GUARD = "code_node_ISguard"
# ---- sql_node_ISfacts: + the request (a stored IA's SUBMIT only)
FACTS_WAS = "           AND b.is_deleted = 0) AS batch_cfg\n  FROM (SELECT NOW(3) AS t) n\n"
FACTS_NOW = ("           AND b.is_deleted = 0) AS batch_cfg,\n       %s AS iatr\n  FROM (SELECT NOW(3) AS t) n\n"
             % Q.request(V.N(GUARD, "data.tenantId"), V.N(GUARD, "data.iaId"),
                         gate="%s > 0 AND '%s' = 'SUBMIT'\n            AND " % (V.N(GUARD, "data.iaId"), V.N(GUARD, "data.operation"))).replace("\n", "\n       "))
FACTS_TITLE = ("Facts: this key's job; the stored IA, its lock, open / latest / linked jobs of either command, the number rule, the default batch config; DB clock",
               "Facts: this key's job; the stored IA, its lock, open / latest / linked jobs of either command, the number rule, the default batch config, "
               "its transfer request; DB clock")
# ---- code_node_ISentry: a request still moving refuses the completion
ENTRY_AT = "const submitEntry = function submitEntry(guard, factRows, formStatus) {\n"
ENTRY_PAIR = ('  if (stored === "Draft" || stored === "Created") return Object.assign(base, { action: "DIRECT", prevStatus: stored }, answer("GO", "", ""));\n',
              '  if (stored === "Draft" || stored === "Created") {\n'
              "    // IA transfer request (ENH-20261027-001, code/shared/iatr_guard.js): its supply request still moving (or unreadable) -> STOP 400,\n"
              "    // nothing written; a received one: the gate checks the picks\n"
              '    const tr = iatrgDecide(iatrgRequest(f.iatr), "COMPLETED", stored);\n'
              '    if (tr.refuse) return Object.assign(base, answer("STOP", "400", tr.message, { errorCode: tr.code }));\n'
              '    return Object.assign(base, { action: "DIRECT", prevStatus: stored }, answer("GO", "", ""));\n'
              "  }\n")
# ---- code_node_ISgate: a received request's picks, right after the record is built
GATE_AT = "const submitGate = function submitGate(guard, entry, keys, form, R) {\n"
GATE_PAIRS = [
    ("  const g = f.more || {};\n",
     "  const g = f.more || {};\n"
     "  // IA transfer request (ENH-20261027-001, code/shared/iatr_guard.js): a received supply request -> every pick of its lines at its\n"
     "  // destination bin (the entry refused one still moving), before the classic gates answer, as IA_SAVE's guard does\n"
     "  const trFacts = list(R.facts)[0] || {};\n"
     "  const trReq = iatrgRequest(trFacts.iatr);\n"
     '  if (iatrgDecide(trReq, "COMPLETED", s(trFacts.item_assembly_status)).picks) {\n'
     "    const tp = iatrgPicks(lines, trReq);\n"
     '    if (!tp.ok) return out("STOP", "400", tp.message, tp.code);\n'
     "  }\n"),
    ("  os: [{{node:sql_node_ISosRead.data}}][0] });\n", "  os: [{{node:sql_node_ISosRead.data}}][0],\n  facts: [%s][0] });\n" % V.N(FACTS, "data")),
]


def units():
    """iatr_guard.js's top-level `const` statements (name -> text), in file order (patch_v6.os_units' rule)"""
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
    v6 = P6.build()
    text6 = json.dumps(v6, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text6.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v6's build is no longer the deployed v15"
    base = json.loads(text6)
    old = P4.index(base)
    assert "iatrg" not in text6 and "IATRG_" not in text6 and "AS iatr" not in text6
    taken = P4.keys_of(base, set())
    rng = random.Random(SEED)

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    doc = copy.deepcopy(base)
    got = P4.index(doc)

    def swap(nid, a, b):
        sc = got[nid]["data"]["script"]
        assert sc["code"].count(a) == 1, (nid, a[:80])
        sc["code"] = sc["code"].replace(a, b)

    # ---- the read
    fs = got[FACTS]["data"]
    assert fs["script"]["code"].count(FACTS_WAS) == 1 and V.wrap_sql(fs["script"]["code"]) == fs["script"]["code"], "the facts SQL changed"
    fs["script"]["code"] = V.wrap_sql(fs["script"]["code"].replace(FACTS_WAS, FACTS_NOW))
    rj = fs["response_json"]
    assert [r["name"] for r in rj][-1] == "batch_cfg" and "iatr" not in [r["name"] for r in rj], [r["name"] for r in rj]
    assert rj[-1]["title"] == rj[-1]["name"] and rj[-1]["bsonType"] == "string", rj[-1]
    rj.append(dict(copy.deepcopy(rj[-1]), key=key(), name="iatr", title="iatr"))
    assert fs["title"] == fs["nodeName"] == fs["name"] == FACTS_TITLE[0], fs["title"]
    fs.update({"title": FACTS_TITLE[1], "nodeName": FACTS_TITLE[1], "name": FACTS_TITLE[1]})
    # ---- the entry, the gate
    swap(ENTRY, *ENTRY_PAIR)
    swap(ENTRY, ENTRY_AT, uses(ENTRY_PAIR[1]) + ENTRY_AT)
    for a, b in GATE_PAIRS:
        swap(GATE, a, b)
    swap(GATE, GATE_AT, uses(GATE_PAIRS[0][1]) + GATE_AT)
    after = P4.index(doc)
    assert sorted(after) == sorted(old), sorted(set(after) ^ set(old))

    # identity: every change undone -> v15 node for node
    rev = copy.deepcopy(doc)
    ri = P4.index(rev)
    undo = [(ENTRY, uses(ENTRY_PAIR[1]) + ENTRY_AT, ENTRY_AT), (ENTRY, ENTRY_PAIR[1], ENTRY_PAIR[0]), (GATE, uses(GATE_PAIRS[0][1]) + GATE_AT, GATE_AT)] + \
        [(GATE, b, a) for a, b in GATE_PAIRS] + [(FACTS, V.wrap_sql(FACTS_NOW) if V.wrap_sql(FACTS_NOW) in ri[FACTS]["data"]["script"]["code"] else FACTS_NOW, FACTS_WAS)]
    for nid, a, b in undo:
        c = ri[nid]["data"]["script"]
        assert c["code"].count(a) == 1, ("undo", nid, a[:60])
        c["code"] = c["code"].replace(a, b)
    rd = ri[FACTS]["data"]
    rd["response_json"] = [r for r in rd["response_json"] if r["name"] != "iatr"]
    rd.update({"title": FACTS_TITLE[0], "nodeName": FACTS_TITLE[0], "name": FACTS_TITLE[0]})
    for nid, n in old.items():
        assert P4.canon(ri[nid]) == P4.canon(n), "v15 node changed: " + nid
    new_keys = [r["key"] for r in after[FACTS]["data"]["response_json"] if r["name"] == "iatr"]
    assert len(new_keys) == 1 and not set(new_keys) & P4.keys_of(base, set()), "the new key collides with v15's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_V2_SUBMIT.json")
    print("IA_V2_SUBMIT v7: %d chars, %d nodes" % (len(text), len(P4.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
