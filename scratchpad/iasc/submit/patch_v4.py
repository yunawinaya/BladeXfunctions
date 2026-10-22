"""IA_V2_SUBMIT v4 = the deployed v3 (Item Assembly & BOM/AsyncV2/IA_V2_SUBMIT.json, pinned md5, = dev v3) + the Small Cycle check:
  code_node_ISscIn     after if_ISkeysEnd: what to read (scIn on the form with the guard's id / page status)
  sql_node_ISsc        a branch of condition_all_ISread: CLASSIC_SC_SOURCE (the stored fields + the linked line + its SO header)
  code_node_ISsc       after if_ISgateEnd, BEFORE GENERATE_BATCH: scClassicCheck on the gate's record (saveAs Completed)
  if_ISscEnd           STOP -> code_node_ISscres + return_node_ISsc (copies of the gate's answer pair: route STOP, code 400, IA_SC_INVALID)
and the 3 document writes gain the 7 Small Cycle props from code_node_ISsc; the job's first due is 600 s, not 120 s (POST_PATCH: a
submit stalled before its document write is never claimed early - peer -8c, IDA's fix; the final due write still makes it due at once). Asserted: every other v3 node byte-identical; the write
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
import wfkit as K  # noqa: E402
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
# node -> (v3 text, patched text) in its code
POST_PATCH = {
    "code_node_ISpost": ("next_attempt_at: iaDbAddSeconds(entry.dbNow, 120),", "next_attempt_at: iaDbAddSeconds(entry.dbNow, 600),"),
    "code_node_ISdue": ("(else it falls due in 120 s)", "(else it falls due in 600 s: a submit stalled before its document write is never claimed early)"),
}

# RES-01 Created (BA, 10-22): a Created IA completes in the background like a Draft, and a failed job puts it back to Created (its holds
# stand): every code node's shared IA_PREV_STATUSES, and the entry's action table (reverted in the identity check)
PREV = ('const IA_PREV_STATUSES = ["Draft"];', 'const IA_PREV_STATUSES = ["Draft", "Created"];')
ENTRY = ("code_node_ISentry",
         '  if (stored === "Draft") return Object.assign(base, { action: "DIRECT", prevStatus: "Draft" }, answer("GO", "", ""));',
         '  // RES-01 Created (BA, 10-22): a Created IA completes like a Draft; a failed job puts it back to Created\n'
         '  if (stored === "Draft" || stored === "Created") return Object.assign(base, { action: "DIRECT", prevStatus: stored }, answer("GO", "", ""));')
# RES-01 Created numbering (user 10-22): a Created IA completes under the number it was issued at Created (the post's keep rule; the entry's
# STALE check makes the form's status the stored one)
NUMBER_KEEP = ("code_node_ISpost",
               "  const keep = !add && issued && num(entry.issuedByJob) > 0 && num(entry.completedUnder) === 0;",
               "  // RES-01 Created numbering (user 10-22): a Created IA keeps the number it was issued at Created\n"
               "  const keep = !add && issued && ((num(entry.issuedByJob) > 0 && num(entry.completedUnder) === 0) || s(entry.storedStatus) === \"Created\");")
# 15 + MIN-02's BUSY answer (a copy of the gate's result node, like the Small Cycle refusal)
PREV_NODES = 16
# MIN-02 (BA 10-22): the background completion takes the normal save's completion claim (IAS|<ia> / CLAIM|<n>) right before its first write
# (after GENERATE_BATCH and the post's answers; before its lock and job) and frees it once the IA is Processing. Its row and win nodes are
# the normal save's own claim_row.js / claim_win.js with only their node references mapped (one rule, asserted below)
CL_IN, CL_STATE, CL_ROW, CL_ADD, CL_READ, CL_WIN = ("code_node_ISclaimIn", "sql_node_ISclaimState", "code_node_ISclaimRow", "add_node_ISclaim", "sql_node_ISclaims",
                                                    "code_node_ISclaimWin")
CL_MAP = [("code_node_IAclaimIn", CL_IN), ("sql_node_IAclaimState", CL_STATE), ("code_node_IAclaimRow", CL_ROW), ("sql_node_IAclaims", CL_READ),
          ("code_node_IAguardStored.data.stored", "code_node_ISentry.data.storedStatus")]
# BA rev 1.2 C2: the claim's end written on it (V2 once Processing, LOST when another completion held the IA)
CL_EXIT = "code_node_ISclaimExit"
CL_IDS = [CL_IN, "if_ISclaim", "ifBlock_TISclaim", "ifBlock_FISclaim", CL_STATE, CL_ROW, CL_ADD, CL_READ, CL_WIN, CL_EXIT, "if_ISclaimLose", "ifBlock_TISclaimLose",
          "ifBlock_FISclaimLose", "update_node_ISclaimFreeLose", "code_node_ISclaimres", "return_node_ISclaim"] + [
    x for k in ("Done",) for x in ("cor_ISclaimFree" + k, "cori_YISclaimFree" + k, "cori_NISclaimFree" + k, "update_node_ISclaimFree" + k)]
CL_FILTER_BASE = 1792400000000
NEW_IDS = NEW_IDS + CL_IDS


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

    # MIN-02: the claim; a loser answers BUSY 409 like the entry's BUSY (the gate's answer pair as the template, as the Small Cycle refusal)
    assert str(CL_FILTER_BASE)[:7] not in raw
    cids = K.Ids(CL_FILTER_BASE)

    def mapped(name):
        text = V.raw(CODE, "classic/" + name)
        for a, b in CL_MAP:
            if a in text:
                assert text.count("{{node:" + a) >= 1, (name, a)
                text = text.replace("{{node:" + a, "{{node:" + b)
        assert "code_node_IA" not in text and "sql_node_IA" not in text, (name, "an IA_SAVE node left")
        return text

    busy = ("{ route: \"BUSY\", code: \"409\", message: [%s][0], reason: \"\", errorCode: \"IA_BUSY\", lineCount: [%s][0] }"
            % (V.N(CL_WIN, "data.message"), V.N(GT, "data.lineCount")))
    clres = copy.deepcopy(gres)
    clres["id"] = "code_node_ISclaimres"
    clres["data"].update(title("Result (MIN-02: another completion holds the IA)"))
    clres["data"]["script"]["code"] = src.replace(small, busy, 1)
    assert clres["data"]["script"]["code"] != src
    for r in clres["data"]["response_json"]:
        r["key"] = key()
    clret = copy.deepcopy(gret)
    clret["id"] = "return_node_ISclaim"
    clret["data"].update(title("Return (MIN-02: another completion holds the IA)"))
    for p in clret["data"]["response_value"]["list"]:
        p["value"] = p["value"].replace("code_node_ISgateres", "code_node_ISclaimres")

    def free(nid, t, field):
        return K.update(cids, nid, t, V.STEP, ("id", "in", V.N(CL_EXIT, "data.%s.id" % field)),
                        [(p, V.N(CL_EXIT, "data.%s.%s" % (field, p))) for p in ("id", "step_status", "finished_at", "result_ref")])

    def free_gate(k):
        return V.gate(cids, "cor_ISclaimFree" + k, "MIN-02: our completion claim to free (" + k + ")?", CL_WIN, "needExit",
                      [free("update_node_ISclaimFree" + k, "GD Publish Step: our completion claim FREE / V2 (the IA is Processing)", "done")])

    def csql(nid, t, text):
        return K.sql(nid, t, V.wrap_sql(V.sub(text, T=V.N(CL_IN, "data.tenantId"), IAQ=V.N(CL_IN, "data.ia"))), ["j"])

    claim = [
        K.code(CL_IN, "MIN-02: a background completion of a stored IA: take its completion claim?", V.raw(CODE, "submit/claim_in.js"), ["claim", "ia", "tenantId", "org"]),
        K.if_(cids, "if_ISclaim", "IF MIN-02: take the IA's completion claim", V.is_(CL_IN, "claim", "YES"), [
            csql(CL_STATE, "MIN-02: the IA's highest claim number and the server clock", S.CLAIM_STATE),
            K.code(CL_ROW, "MIN-02: our claim row (IAS|<ia> / CLAIM|<n>, HELD)", mapped("claim_row.js"), ["rows", "name"], arrays=("rows",)),
            V.step_add(cids, CL_ADD, "GD Publish Step: our completion claim (a twin's insert fails on the unique key)", CL_ROW, "rows"),
            csql(CL_READ, "MIN-02: the IA's HELD claims and its status now", S.CLAIM_READ)]),
        K.code(CL_WIN, "MIN-02: is ours the lowest live claim, the IA unchanged?", mapped("claim_win.js"), ["route", "claimId", "message", "freeRows", "exitRows", "needExit"],
               arrays=("freeRows", "exitRows")),
        K.code(CL_EXIT, "C2: how this submit's claim ends (V2 / LOST)", V.raw(CODE, "submit/claim_exit.js"), ["done", "lost"], arrays=("done", "lost")),
        K.if_(cids, "if_ISclaimLose", "IF MIN-02: another completion holds the IA (or it changed): free ours, BUSY", V.is_(CL_WIN, "route", "LOSE"), [
            free("update_node_ISclaimFreeLose", "GD Publish Step: our completion claim FREE / LOST (another completion held the IA)", "lost"), clres, clret]),
    ]
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
    # MIN-02: the claim right before the first write (after GENERATE_BATCH and the post's answers), freed after the IA's write
    top = [n["id"] for n in doc["nodes"]]
    j = top.index("if_ISpostEnd")
    assert top[j + 1] == "cor_ISlock", top[j:j + 3]
    doc["nodes"][j + 1:j + 1] = claim
    top = [n["id"] for n in doc["nodes"]]
    j = top.index("cor_ISnonum")
    assert top[j - 2:j + 2] == ["cor_ISadd", "cor_ISnum", "cor_ISnonum", "condition_all_ISafter"], top[j - 2:j + 2]
    doc["nodes"].insert(j + 1, free_gate("Done"))
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
    for nid, (was, now) in POST_PATCH.items():
        sc = index(doc)[nid]["data"]["script"]
        assert sc["code"].count(was) == 1, nid
        sc["code"] = sc["code"].replace(was, now)
    prev_nodes = [nid for nid, n in index(doc).items() if isinstance((n.get("data") or {}).get("script"), dict) and PREV[0] in n["data"]["script"].get("code", "")]
    assert len(prev_nodes) == PREV_NODES and "code_node_ISpost" in prev_nodes and ENTRY[0] in prev_nodes, (len(prev_nodes), prev_nodes)
    for nid in prev_nodes:
        sc = index(doc)[nid]["data"]["script"]
        assert sc["code"].count(PREV[0]) == 1, nid
        sc["code"] = sc["code"].replace(PREV[0], PREV[1])
    esc = index(doc)[ENTRY[0]]["data"]["script"]
    assert esc["code"].count(ENTRY[1]) == 1
    esc["code"] = esc["code"].replace(ENTRY[1], ENTRY[2])
    nsc = index(doc)[NUMBER_KEEP[0]]["data"]["script"]
    assert nsc["code"].count(NUMBER_KEEP[1]) == 1, "the post's keep rule changed"
    nsc["code"] = nsc["code"].replace(NUMBER_KEEP[1], NUMBER_KEEP[2])
    rev = copy.deepcopy(doc)
    ri = index(rev)
    for nid, (was, now) in POST_PATCH.items():
        ri[nid]["data"]["script"]["code"] = ri[nid]["data"]["script"]["code"].replace(now, was)
    for nid in prev_nodes:
        ri[nid]["data"]["script"]["code"] = ri[nid]["data"]["script"]["code"].replace(PREV[1], PREV[0])
    ri[ENTRY[0]]["data"]["script"]["code"] = ri[ENTRY[0]]["data"]["script"]["code"].replace(ENTRY[2], ENTRY[1])
    ri[NUMBER_KEEP[0]]["data"]["script"]["code"] = ri[NUMBER_KEEP[0]]["data"]["script"]["code"].replace(NUMBER_KEEP[2], NUMBER_KEEP[1])
    for nid in WRITES:
        ri[nid]["data"]["props"]["list"] = ri[nid]["data"]["props"]["list"][:-len(SC_PROPS)]
    ri["condition_all_ISread"]["blocks"] = [b for b in ri["condition_all_ISread"]["blocks"] if b["id"] != "cai_ISsc"]
    cl_set = set(CL_IDS)
    rev["nodes"] = [n for n in rev["nodes"] if n["id"] not in cl_set]
    ri = index(rev)
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "v3 node changed: " + nid
    new_keys = []
    for nd in claim + [index(doc)["cor_ISclaimFreeDone"]]:
        new_keys.extend(sorted(keys_of(nd, set())))
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & keys_of(base, set()), "a claim key repeats or collides with v3's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_V2_SUBMIT.json")
    print("IA_V2_SUBMIT v4: %d chars, %d nodes" % (len(text), len(index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
