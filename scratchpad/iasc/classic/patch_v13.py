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
import wfkit as K  # noqa: E402
import sql as S  # noqa: E402

BASE = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2", "IA_SAVE.json")
BASE_MD5 = "3faadd2358a747f3dff7b48ef305d2cf"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
# RES-01's shared cores (the completion split): scratchpad/iasc/res01/code
RES_CODE = os.environ.get("HD_CODE") or os.path.join(IASC, "res01", "code")
SEED = 20261020
FILTER_BASE = 1792200000000
IN, SRC, CHK = "code_node_SCin", "sql_node_SCsource", "code_node_SCcheck"
ENROL = "code_node_RESenrol"
NUM = "code_node_IAnumIssue"
DUE, OWN, SPLIT = "code_node_RESdue", "sql_node_RESown", "code_node_RESsplit"
# MIN-02 (BA 10-22): the completion claim (code/classic/claim_*.js): taken in if_persist's completion block right after the batch
# number (GENERATE_BATCH crashes the run on a refusal: before the claim, so a retry is never blocked by it) and before the header,
# freed before each later return (a failed issue, a failed receipt) and at the block's end
CL_IN, CL_STATE, CL_ROW, CL_ADD, CL_READ, CL_WIN = ("code_node_IAclaimIn", "sql_node_IAclaimState", "code_node_IAclaimRow", "add_node_IAclaim", "sql_node_IAclaims",
                                                    "code_node_IAclaimWin")
# BA rev 1.2 C2: each exit writes how the completion ended on the claim (code/classic/claim_exit.js)
CL_EXIT = "code_node_IAclaimExit"
CL_EXIT_FIELD = {"Sub": "sub", "Add": "add", "Done": "done"}
CL_EXITS = {"if_subtract_failed": "Sub", "if_add_failed": "Add"}
CL_IDS = [CL_IN, "if_IAclaim", "if_IAclaim_t", "if_IAclaim_f", CL_STATE, CL_ROW, CL_ADD, CL_READ, CL_WIN, CL_EXIT, "if_IAclaimLose", "if_IAclaimLose_t", "if_IAclaimLose_f",
          "update_node_IAclaimFreeLose", "return_node_IAclaim409"] + [x for k in list(CL_EXITS.values()) + ["Done"] for x in
                                                                       ("cor_IAclaimFree" + k, "cori_YIAclaimFree" + k, "cori_NIAclaimFree" + k, "update_node_IAclaimFree" + k)]
CL_FILTER_BASE = 1792300000000
NEW_IDS = [IN, "if_SCread", "if_SCread_t", "if_SCread_f", SRC, CHK, "if_SCfailed", "if_SCfailed_t", "if_SCfailed_f", "return_node_SC400",
           ENROL, "if_RESenrol", "if_RESenrol_t", "if_RESenrol_f", "update_node_RESenrol",
           DUE, "if_RESdue", "if_RESdue_t", "if_RESdue_f", OWN, SPLIT, "if_RESbusy", "if_RESbusy_t", "if_RESbusy_f", "return_node_RES409",
           "if_RESreserved", "if_RESreserved_t", "if_RESreserved_f", "return_node_RES400"] + CL_IDS + [
           NUM, "if_IAnumIssue", "if_IAnumIssue_t", "if_IAnumIssue_f", "update_node_IAnumIssue"]
# RES-01 R4: the pre-check and issue loops read the lines split by the IA's holds (code_node_RESsplit; the lines as sent when not due)
LOOPS = {"loop_precheck_lines": "{{node:code_fillback.data.allData.stock_movement}}", "loop_issue_lines": "{{node:code_fillback.data.allData.stock_movement}}"}
LOOPS_TO = "{{node:code_node_RESsplit.data.lines}}"
IN_FIELDS = ["need", "edit", "tenantId", "iaId", "lineId", "present", "org", "uid"]
SC_PROPS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"]
CHK_FIELDS = ["route", "message"] + SC_PROPS
# IA_SAVE only (IA_V2_SUBMIT v4 declares IN_FIELDS / CHK_FIELDS as they are): the ids whose stored keys to read, the lines to write
CLASSIC_IN_FIELDS = IN_FIELDS + ["lineIds", "res"]
CLASSIC_CHK_FIELDS = CHK_FIELDS + ["scLines"]
# the lines the 4 writes take: code_fillback's, with the stored sc_ref_key put back on a line a mobile save sent without one
LINES_FROM, LINES_TO = "{{node:code_fillback.data.allData.stock_movement}}", "{{node:code_node_SCcheck.data.scLines.stock_movement}}"
WRITES = {"add_ia": 25, "update_ia": 26, "add_draft": 24, "update_draft": 23}
# RES-01 Created (BA, 10-22): code_fillback writes the status the save asked for (reverted in the identity check)
FILLBACK = ("allData.item_assembly_status = saveAs;", open(os.path.join(CODE, "classic", "fillback_status.js"), encoding="utf-8").read().rstrip("\n"))
# RES-01 Cancel (user 10-22): the stored-status guard refuses any save of a Cancelled IA (reverted in the identity check)
GUARD_CANCELLED = json.load(open(os.path.join(CODE, "classic", "guard_cancelled.json"), encoding="utf-8"))
# RES-01 Created numbering (user 10-22): the guard reads the stored number, code_fillback's sentinels, a stored Draft becoming Created
# numbered right after its write (code/classic/number_created.json + number_issue.js)
NUMBER = json.load(open(os.path.join(CODE, "classic", "number_created.json"), encoding="utf-8"))


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
    assert str(FILTER_BASE)[:7] not in raw and str(CL_FILTER_BASE)[:7] not in raw
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
        return [{"key": key(), "name": n, "title": "", "description": "", "bsonType": "any" if n in ("scLines", "lines") else "string", "isExpand": False, "children": []}
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
                V.sub(S.CLASSIC_SC_SOURCE_KEYS, T=V.N(IN, "data.tenantId"), IA=V.N(IN, "data.iaId"), LINE=V.N(IN, "data.lineId"), IDS=V.N(IN, "data.lineIds"),
                      ORG=V.N(IN, "data.org"), UID=V.N(IN, "data.uid")),
                ["j"])]),
        code(CHK, "Small Cycle: merge, link and snapshot checks", body("sc_check.js"), CLASSIC_CHK_FIELDS),
        if_("if_SCfailed", "IF the Small Cycle check refused", "'%s' == 'STOP'" % V.N(CHK, "data.route"), [r400]),
    ]
    # RES-01 enrolment: after the Draft write (code_doc_id has the saved id), the header marked RESERVING; the form starts IA_HOLD
    up = copy.deepcopy(old["update_draft"])
    up["id"] = "update_node_RESenrol"
    up["data"].update(title("RES-01: mark the Draft RESERVING (enrolled; the form starts IA_HOLD)"))
    leaf = up["data"]["table_id"]["rules"]["list"][0]
    assert leaf["prop"] == "id" and leaf["operator"] == "in"
    fid[0] += 2
    leaf.update({"id": fid[0] - 1, "parentId": fid[0], "value": V.N(ENROL, "data.id")})
    tpl_p = [x for x in up["data"]["props"]["list"] if x["prop"] == "id"][0]
    up["data"]["props"]["list"] = [dict(tpl_p, value=V.N(ENROL, "data.id")), dict(tpl_p, prop="material_hold_status", propLabel="material_hold_status", value=V.N(ENROL, "data.hold"))]
    # RES-01 Created numbering (user 10-22): a stored Draft saved as Created takes its real number right after its write ('issued')
    upn = copy.deepcopy(old["update_draft"])
    upn["id"] = "update_node_IAnumIssue"
    upn["data"].update(title("RES-01: a Draft becoming Created takes its real number ('issued')"))
    leafn = upn["data"]["table_id"]["rules"]["list"][0]
    assert leafn["prop"] == "id" and leafn["operator"] == "in"
    fid[0] += 2
    leafn.update({"id": fid[0] - 1, "parentId": fid[0], "value": V.N(NUM, "data.id")})
    tpn = [x for x in upn["data"]["props"]["list"] if x["prop"] == "id"][0]
    typ = [x for x in old["update_ia"]["data"]["props"]["list"] if x["prop"] == "stock_movement_no_type"]
    assert len(typ) == 1 and typ[0]["value"] == "{{node:code_fillback.data.allData.stock_movement_no_type}}", typ
    upn["data"]["props"]["list"] = [dict(tpn, value=V.N(NUM, "data.id")), dict(tpn, prop="stock_movement_no", propLabel="stock_movement_no", value=V.N(NUM, "data.no")),
                                    copy.deepcopy(typ[0])]
    number = [code(NUM, "RES-01: a stored Draft saved as Created: its real number now?", V.raw(CODE, "classic/number_issue.js"), ["issue", "id", "no"]),
              if_("if_IAnumIssue", "IF RES-01: a Draft becoming Created takes its real number", "'%s' == 'YES'" % V.N(NUM, "data.issue"), [upn])]
    enrol = [code(ENROL, "RES-01: enrol this IA (holds on, saved as Created)?", V.raw(CODE, "classic/res_enrol.js"), ["enrol", "id", "hold"]),
             if_("if_RESenrol", "IF RES-01: an IA saved as Created to mark RESERVING", "'%s' == 'YES'" % V.N(ENROL, "data.enrol"), [up])]
    # RES-01 R4: before the pre-check, an IA that reserves reads its holds; its picks split (held part from Reserved); 409 while one runs
    r409 = copy.deepcopy(old["return_idem_409"])
    l409 = r409["data"]["response_value"]["list"]
    assert [x["prop"] for x in l409] == ["code", "message"] and l409[0]["value"] == "409"
    r409["id"] = "return_node_RES409"
    r409["data"].update(title("Return 409 (RES-01: the materials are being reserved)"))
    l409[1]["value"] = V.N(SPLIT, "data.message")
    r400res = copy.deepcopy(old["return_required_400"])
    r400res["id"] = "return_node_RES400"
    r400res["data"].update(title("Return Refused 400 (MIN-01: picked from Reserved stock)"))
    r400res["data"]["response_value"]["list"][1]["value"] = V.N(SPLIT, "data.message")
    split = [code(DUE, "RES-01: a completion of an IA that reserves?", V.raw(CODE, "classic/res_due.js"), ["due", "ia", "tenantId", "org"]),
             if_("if_RESdue", "IF RES-01: its own holds to read", "'%s' == 'YES'" % V.N(DUE, "data.due"), [
                 sql(OWN, "RES-01: this IA's own holds and its running hold tickets", V.sub(S.RES_OWN, T=V.N(DUE, "data.tenantId"), IAQ=V.N(DUE, "data.ia"),
                                                                                          ORG=V.N(DUE, "data.org")), ["j"])]),
             code(SPLIT, "RES-01: the picks split by its holds (held part from Reserved)", V.include_js(RES_CODE, "shared/split.js") + "\n" + V.raw(CODE, "classic/res_split.js"),
                  ["route", "message", "lines"]),
             if_("if_RESbusy", "IF RES-01: a reservation is running", "'%s' == 'BUSY'" % V.N(SPLIT, "data.route"), [r409]),
             # MIN-01 (with bladexfunctions-9d): a pick made from Reserved stock by hand -> 400 before any write
             if_("if_RESreserved", "IF MIN-01: a component picked from Reserved stock", "'%s' == 'STOP'" % V.N(SPLIT, "data.route"), [r400res])]
    # MIN-02: the claim (fork-free: each step needs the one before), the loser's 409, the frees on every later exit
    cids = K.Ids(CL_FILTER_BASE)
    r409c = copy.deepcopy(old["return_idem_409"])
    l409c = r409c["data"]["response_value"]["list"]
    assert [x["prop"] for x in l409c] == ["code", "message"] and l409c[0]["value"] == "409"
    r409c["id"] = "return_node_IAclaim409"
    r409c["data"].update(title("Return 409 (MIN-02: being completed in another window / changed)"))
    l409c[1]["value"] = V.N(CL_WIN, "data.message")

    def free(nid, t, field):
        return K.update(cids, nid, t, V.STEP, ("id", "in", V.N(CL_EXIT, "data.%s.id" % field)),
                        [(p, V.N(CL_EXIT, "data.%s.%s" % (field, p))) for p in ("id", "step_status", "finished_at", "result_ref")])

    def free_gate(k):
        return V.gate(cids, "cor_IAclaimFree" + k, "MIN-02: our completion claim to free (" + k + ")?", CL_WIN, "needExit",
                      [free("update_node_IAclaimFree" + k, "GD Publish Step: our completion claim FREE, how it ended (" + k + ")", CL_EXIT_FIELD[k])])

    claim = [
        K.code(CL_IN, "MIN-02: a completion of a stored IA (Edit): take its completion claim?", V.raw(CODE, "classic/claim_in.js"), ["claim", "ia", "tenantId", "org"]),
        if_("if_IAclaim", "IF MIN-02: take the IA's completion claim", "'%s' == 'YES'" % V.N(CL_IN, "data.claim"), [
            sql(CL_STATE, "MIN-02: the IA's highest claim number and the server clock", V.sub(S.CLAIM_STATE, T=V.N(CL_IN, "data.tenantId"), IAQ=V.N(CL_IN, "data.ia")), ["j"]),
            K.code(CL_ROW, "MIN-02: our claim row (IAS|<ia> / CLAIM|<n>, HELD)", V.raw(CODE, "classic/claim_row.js"), ["rows", "name"], arrays=("rows",)),
            V.step_add(cids, CL_ADD, "GD Publish Step: our completion claim (a twin's insert fails on the unique key)", CL_ROW, "rows"),
            sql(CL_READ, "MIN-02: the IA's HELD claims and its status now", V.sub(S.CLAIM_READ, T=V.N(CL_IN, "data.tenantId"), IAQ=V.N(CL_IN, "data.ia")), ["j"])]),
        K.code(CL_WIN, "MIN-02: is ours the lowest live claim, the IA unchanged?", V.raw(CODE, "classic/claim_win.js"),
               ["route", "claimId", "message", "freeRows", "exitRows", "needExit"], arrays=("freeRows", "exitRows")),
        K.code(CL_EXIT, "C2: how the completion ends, per exit, for its claim", V.raw(CODE, "classic/claim_exit.js"), ["done", "sub", "add", "lost"],
               arrays=("done", "sub", "add", "lost")),
        if_("if_IAclaimLose", "IF MIN-02: another completion holds the IA (or it changed): free ours, 409", "'%s' == 'LOSE'" % V.N(CL_WIN, "data.route"), [
            free("update_node_IAclaimFreeLose", "GD Publish Step: our completion claim FREE / LOST (another completion held the IA)", "lost"),
            r409c]),
    ]
    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("if_required_failed")
    assert top[i + 1] == "if_validate", top[i - 2:i + 3]
    doc["nodes"] = doc["nodes"][:i + 1] + nodes + doc["nodes"][i + 1:]
    top = [n["id"] for n in doc["nodes"]]
    j = top.index("code_doc_id")
    assert top[j + 1] == "return_ok", top[j - 1:j + 3]
    doc["nodes"] = doc["nodes"][:j + 1] + number + enrol + doc["nodes"][j + 1:]
    vt = index(doc)["if_validate"]["blocks"][0]["blocks"]
    vi = [n["id"] for n in vt].index("loop_precheck_lines")
    assert [n["id"] for n in vt][vi - 1] == "if_edit_guard"
    vt[vi:vi] = split
    # MIN-02: the claim in if_persist's completion block after GENERATE_BATCH, before the batch number's use and the header; a free before
    # each later return and at the block's end
    pt = index(doc)["if_persist"]["blocks"][0]["blocks"]
    assert [n["id"] for n in pt][:4] == ["code_batch_decide", "if_needs_batch_gen", "code_batch_number", "if_edit"] and pt[-1]["id"] == "update_item_txn", [n["id"] for n in pt]
    pt[2:2] = claim
    pt.append(free_gate("Done"))
    for nid, k in CL_EXITS.items():
        eb = index(doc)[nid]["blocks"][0]["blocks"]
        assert [n["type"] for n in eb] == ["return-node"], (nid, [n["id"] for n in eb])
        eb[0:0] = [free_gate(k)]
    for nid, was in LOOPS.items():
        lp = index(doc)[nid]["data"]["loopSeletVar"]
        assert lp["code"] == was, (nid, lp)
        lp["code"] = LOOPS_TO
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
    fb = got["code_fillback"]["data"]["script"]
    assert fb["code"].count(FILLBACK[0]) == 1, "code_fillback's status line changed"
    fb["code"] = fb["code"].replace(FILLBACK[0], FILLBACK[1])
    gs = got[GUARD_CANCELLED["node"]]["data"]["script"]
    for d in GUARD_CANCELLED["pairs"]:
        assert gs["code"].count(d["was"]) == 1, ("the stored-status guard changed", d["was"][:60])
        gs["code"] = gs["code"].replace(d["was"], d["now"])
    # RES-01 Created numbering: the guard's read returns the stored number (a column more, declared), the guard passes it on (storedNo)
    ns = got[NUMBER["sql"]["node"]]["data"]
    assert ns["script"]["code"].count(NUMBER["sql"]["was"]) == 1, "the guard's SQL changed"
    ns["script"]["code"] = ns["script"]["code"].replace(NUMBER["sql"]["was"], NUMBER["sql"]["now"])
    assert [x["name"] for x in ns["response_json"]] == ["ia_id", "item_assembly_status"], ns["response_json"]
    ns["response_json"].append(dict(ns["response_json"][1], key="n2610num", name="stock_movement_no"))
    ng = got[NUMBER["guard"]["node"]]["data"]
    for d in NUMBER["guard"]["pairs"]:
        assert ng["script"]["code"].count(d["was"]) == 1, ("the stored-status guard changed", d["was"][:60])
        ng["script"]["code"] = ng["script"]["code"].replace(d["was"], d["now"])
    stored_rj = [x for x in ng["response_json"] if x["name"] == "stored"]
    assert len(stored_rj) == 1 and "storedNo" not in [x["name"] for x in ng["response_json"]]
    ng["response_json"].insert(ng["response_json"].index(stored_rj[0]) + 1, dict(stored_rj[0], key="s2610num", name="storedNo"))
    for d in NUMBER["fillback"]:
        assert fb["code"].count(d["was"]) == 1, ("code_fillback's number sentinels changed", d["was"][:60])
        fb["code"] = fb["code"].replace(d["was"], d["now"])
    assert sorted(set(got) - set(old)) == sorted(NEW_IDS), sorted(set(got) - set(old))
    rev = copy.deepcopy(doc)
    ri = index(rev)
    for nid, was in LOOPS.items():
        ri[nid]["data"]["loopSeletVar"]["code"] = was
    vb = ri["if_validate"]["blocks"][0]
    vb["blocks"] = [n for n in vb["blocks"] if n["id"] not in {x["id"] for x in split}]
    cl_set = set(CL_IDS)
    for blk in [index(rev)["if_persist"]["blocks"][0]] + [index(rev)[nid]["blocks"][0] for nid in CL_EXITS]:
        blk["blocks"] = [n for n in blk["blocks"] if n["id"] not in cl_set]
    ri = index(rev)
    for nid, count in WRITES.items():
        ri[nid]["data"]["props"]["list"] = ri[nid]["data"]["props"]["list"][:count]
        for p in ri[nid]["data"]["props"]["list"]:
            if p["prop"] == "stock_movement":
                p["value"] = LINES_FROM
    rfb = ri["code_fillback"]["data"]["script"]
    rfb["code"] = rfb["code"].replace(FILLBACK[1], FILLBACK[0])
    rgs = ri[GUARD_CANCELLED["node"]]["data"]["script"]
    for d in GUARD_CANCELLED["pairs"]:
        rgs["code"] = rgs["code"].replace(d["now"], d["was"])
    rns = ri[NUMBER["sql"]["node"]]["data"]
    rns["script"]["code"] = rns["script"]["code"].replace(NUMBER["sql"]["now"], NUMBER["sql"]["was"])
    rns["response_json"] = [x for x in rns["response_json"] if x["name"] != "stock_movement_no"]
    rng = ri[NUMBER["guard"]["node"]]["data"]
    for d in NUMBER["guard"]["pairs"]:
        rng["script"]["code"] = rng["script"]["code"].replace(d["now"], d["was"])
    rng["response_json"] = [x for x in rng["response_json"] if x["name"] != "storedNo"]
    for d in NUMBER["fillback"]:
        rfb["code"] = rfb["code"].replace(d["now"], d["was"])
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "v12 node changed: " + nid
    new_keys = []
    cl_nodes = claim + [index(doc)["cor_IAclaimFree" + k] for k in list(CL_EXITS.values()) + ["Done"]]
    for nd in nodes + number + enrol + split + cl_nodes:
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
