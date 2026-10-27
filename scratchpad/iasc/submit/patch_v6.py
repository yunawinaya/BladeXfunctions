"""IA_V2_SUBMIT v6 = the deployed v14 (patch_v5.build(), pinned md5 of its written text) + the IA output split in the background (plan 10-27,
phase 2; code/shared/os_split.js): IA V2 receives a split itself (a System Settings batch or no batch; a Manual batch stays the classic's).
  code_node_ISkeys        the parent at each payload split row's bin joins the duplicate-balance tuples; osRead / osBinIds / osIaId for the read
  condition_all_ISread    + sql_node_ISosRead when osRead: the rows' bins (payload + stored rows) and the stored IA's split, plant, item, bin
  code_node_ISgate        no longer refuses a split (v5's iaOsIneligible gone); after the classic gates: osMerge + osCompletion (STOP 400
                          IA_OS_INVALID), a duplicate balance at a row's bin -> NOT_ELIGIBLE, row 1 into the header's single fields, a System
                          split's date rule per group and its single GENERATE_BATCH skipped; movementCount = picks + rows
  after cor_ISbatch       a System split: GENERATE_BATCH once per group (IA_SAVE v14's cache loop, + organization_id) -> STOP 400 on an empty
                          number; code_node_ISosFinal (osFinal: the numbers on the rows) -> STOP 400 before any write
  code_node_ISpost        the header's batch_no = row 1's number for a System split
  the 3 IA writes         + output_split (the final rows; [] without a split)
  sql_node_ISheader       + output_split: the request's IF1 covers the split (PREPARE's / COMMIT's FP_HEADER_OS)
  code_node_ISlink        fingerprint.js with the output split (scratchpad/iav2/code/shared)
No split runs v14's nodes (the new prop, [] stored, and the fingerprint helper's extra function aside): asserted by undoing every change ->
v14 node for node.

usage: python3 scratchpad/iasc/submit/patch_v6.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json)"""
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
import patch_v5 as P5  # noqa: E402
import v2build as V  # noqa: E402
import wfkit as K  # noqa: E402
import sql as S  # noqa: E402

P4 = P5.P4
# Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json as patch_v5 writes it = DEV v14 (IDENTICAL, 10-27)
BASE_MD5 = "45fd3867f3ce84cc69f8e7c0e22ec54e"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
FILTER_BASE = 1792500000000
KEYS, GATE, POST, HDR, LINK = "code_node_ISkeys", "code_node_ISgate", "code_node_ISpost", "sql_node_ISheader", "code_node_ISlink"
READ, FINAL, GPICK, GNORM, GAPP = "sql_node_ISosRead", "code_node_ISosFinal", "code_ISosGenPick", "code_ISosGenNorm", "code_ISosGenAppend"
WRITES = ("add_node_ISia", "update_node_ISiaNum", "update_node_ISiaNoNum")
CACHE = "iaOsBatches_" + V.N(GATE, "data.osCacheKey")
NEW_IDS = ["cai_ISosRead", "cor_ISosRead", "cori_YISosRead", "cori_NISosRead", READ,
           "if_ISosGen", "ifBlock_TISosGen", "ifBlock_FISosGen", "set_ISosBatchesInit", "loop_ISosGen", GPICK, "workflow_node_ISosGenerate", GNORM,
           "if_ISosGenFailed", "ifBlock_TISosGenFailed", "ifBlock_FISosGenFailed", "code_node_ISosGenres", "return_node_ISosGen",
           "get_ISosBatches", GAPP, "set_ISosBatches", "get_ISosBatchesFinal",
           FINAL, "if_ISosFinalEnd", "ifBlock_TISosFinalEnd", "ifBlock_FISosFinalEnd", "code_node_ISosres", "return_node_ISos"]

# ---- code_node_ISkeys: the payload's split bins (dup tuples + the read's inputs)
KEYS_BASE = ('    plantId: "0", organizationId: "0", lineCount: 0, pickCount: 0 };\n',
             '    plantId: "0", organizationId: "0", lineCount: 0, pickCount: 0, osRead: "NO", osBinIds: "0", osIaId: "0" };\n')
KEYS_GO_OLD = ('  return out(answer("GO", "", "", { ok: "YES", itemIdsSql: iaIdsSql(f.itemIds), pickPairsJson: iaTuples(pairs), costPairsJson: iaTuples(pairs.concat([[parent, "0"]])),\n'
               '    balTuplesJson: iaTuples(bals.concat([[parent, iaIdStr(a.location_id)]])), batchTuplesJson: iaTuples(batchBals), plantId: iaIdStr(a.issuing_operation_faci) || "0",\n'
               '    organizationId: org }));\n};\n')
KEYS_AT = "const submitKeys = function submitKeys(guard, entry, form) {\n"
KEYS_RET = ("  organizationId: res.organizationId, lineCount: res.lineCount, pickCount: res.pickCount\n};",
            "  organizationId: res.organizationId, lineCount: res.lineCount, pickCount: res.pickCount, osRead: res.osRead, osBinIds: res.osBinIds, osIaId: res.osIaId\n};")
KEYS_NEW = ("osRead", "osBinIds", "osIaId")
# ---- code_node_ISgate
WHY = (P5.WHY[1], P5.WHY[0])
GATE_BASE = ('    batchMfgDate: null, batchExpDate: null, batchOrg: "" };\n',
             '    batchMfgDate: null, batchExpDate: null, batchOrg: "", osSplit: "NO", osKind: "", osRows: [], osGroups: [], osGen: "NO", osGenGroups: [], osCacheKey: "" };\n')
GATE_TAIL_OLD = ('  const parent = byItem[iaIdStr(a.item_id)] || {};\n'
                 '  const needBatch = num(parent.item_batch_management) === 1 && parent.batch_number_genaration === IA_AUTO_BATCH;\n'
                 '  if (needBatch) {\n'
                 '    const msg = iaBatchPrecheck(parseJson(entry.batchCfg), a);\n'
                 '    if (msg) return out("STOP", "400", msg, "IA_BATCH_FAILED");\n'
                 '  }\n'
                 '  return out("GO", "", "", "", { allData: a, stockMovementNo: s(a.stock_movement_no), needBatch: needBatch ? "YES" : "NO", batchItemId: needBatch ? iaIdStr(a.item_id) : "",\n'
                 '    batchDocDate: needBatch ? a.item_assembly_date || null : null, batchMfgDate: needBatch ? a.manufacturing_date || null : null,\n'
                 '    batchExpDate: needBatch ? a.expired_date || null : null, batchOrg: needBatch ? base.organizationId : "" });\n'
                 '};\n')
GATE_AT = P5.HELPER_AT
GATE_CALL = ("dup: [{{node:sql_node_ISdup.data}}][0] });\n", "dup: [{{node:sql_node_ISdup.data}}][0],\n  os: [%s][0] });\n" % V.N(READ, "data"))
GATE_RET = ("  batchMfgDate: res.batchMfgDate, batchExpDate: res.batchExpDate, batchOrg: res.batchOrg\n};",
            "  batchMfgDate: res.batchMfgDate, batchExpDate: res.batchExpDate, batchOrg: res.batchOrg, osSplit: res.osSplit, osKind: res.osKind, osRows: res.osRows,\n"
            "  osGroups: res.osGroups, osGen: res.osGen, osGenGroups: res.osGenGroups, osCacheKey: res.osCacheKey\n};")
GATE_NEW = (("osSplit", "s"), ("osKind", "s"), ("osRows", "a"), ("osGroups", "a"), ("osGen", "s"), ("osGenGroups", "a"), ("osCacheKey", "s"))
# ---- code_node_ISpost
POST_PAIRS = [('  const batchNo = needBatch && obj(batchOut) ? s(batchOut.batch_number) : "";\n',
               '  const batchNo = needBatch && obj(batchOut) ? s(batchOut.batch_number) : s(gate.osBatchNo);\n'),
              ("needBatch: [{{node:code_node_ISgate.data.needBatch}}][0] },\n",
               "needBatch: [{{node:code_node_ISgate.data.needBatch}}][0],\n    osBatchNo: [%s][0] },\n" % V.N(FINAL, "data.batchNo"))]
# ---- sql_node_ISheader (as iav2/code/shared/sql.py FP_HEADER_OS)
HDR_PAIR = ("'ia_v2_job_id', h.ia_v2_job_id) AS j", "'ia_v2_job_id', h.ia_v2_job_id, 'output_split', h.output_split) AS j")
# ---- code_node_ISlink: v14's fingerprint helper = today's fingerprint.js without the output split
FP_SPLIT_FN = ("// IA output split (plan 10-27): a split's rows in order (qty, bin, category, group, batch number, dates); only an IA with rows gets them,\n"
               "// so every other IA's fingerprint stays as it was\n"
               "const iaFpSplit = function iaFpSplit(v) {\n"
               "  const rows = iaFpEntries(v);\n"
               "  if (typeof rows === \"string\") return rows;\n"
               "  return rows.map((r) => (r && typeof r === \"object\" ? [iaFpQ8(r.os_qty), iaFpId(r.os_location_id), iaFpS(r.os_category), iaFpS(r.os_group), iaFpS(r.os_batch_no),\n"
               "    iaFpS(r.os_mfg_date), iaFpS(r.os_exp_date)] : [\"?\", iaFpS(r)]));\n"
               "};\n")
FP_HEADER = (("  return [iaFpS(h.item_id), iaFpQ8(h.item_qty), iaFpId(h.item_uom), iaFpId(h.location_id), iaFpS(h.inventory_category) || \"Unrestricted\", iaFpS(h.batch_no),\n"
              "    iaFpId(h.issuing_operation_faci)];\n"),
             ("  const base = [iaFpS(h.item_id), iaFpQ8(h.item_qty), iaFpId(h.item_uom), iaFpId(h.location_id), iaFpS(h.inventory_category) || \"Unrestricted\", iaFpS(h.batch_no),\n"
              "    iaFpId(h.issuing_operation_faci)];\n"
              "  const split = iaFpSplit(h.output_split);\n"
              "  return split.length ? base.concat([split]) : base;\n"))


def fp_texts():
    """(v14's embedded fingerprint.js, today's): today's file minus the output split must be what v14 embeds"""
    now = V.include_js(os.path.join(IAV2, "code"), "shared/fingerprint.js")
    assert now.count(FP_SPLIT_FN) == 1 and now.count(FP_HEADER[1]) == 1, "fingerprint.js changed"
    return now.replace(FP_SPLIT_FN, "").replace(FP_HEADER[1], FP_HEADER[0]), now


def os_units():
    """os_split.js's top-level `const` statements (name -> text), in file order (patch_v14.os_units)"""
    units, cur = {}, None
    for ln in V.include_js(CODE, "shared/os_split.js").split("\n"):
        m = re.match(r"^const (\w+)\s*=", ln)
        if m:
            cur = m.group(1)
            units[cur] = [ln]
        elif ln.startswith("//") or not ln.strip():
            cur = None
        elif cur:
            units[cur].append(ln)
    return {k: "\n".join(v) for k, v in units.items()}


def uses(text):
    """the os_split.js statements a text uses (and theirs), in file order"""
    units = os_units()
    used = lambda t: {k for k in units if re.search(r"\b%s\b" % k, t)}
    need, todo = set(), used(text)
    while todo:
        k = todo.pop()
        if k not in need:
            need.add(k)
            todo |= used(units[k]) - need
    assert need, "uses nothing of os_split.js"
    return "\n".join(units[k] for k in units if k in need) + "\n"


def raw(name):
    return V.raw(CODE, "submit/" + name)


def build():
    v5 = P5.build()
    text5 = json.dumps(v5, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text5.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v5's build is no longer the deployed v14"
    base = json.loads(text5)
    old = P4.index(base)
    for nid in NEW_IDS:
        assert '"%s"' % nid not in text5, nid + " already in v14"
    assert str(FILTER_BASE)[:7] not in text5
    ids = K.Ids(FILTER_BASE)
    doc = copy.deepcopy(base)
    got = P4.index(doc)

    def code_of(nid):
        return got[nid]["data"]["script"]

    def swap(nid, a, b, where):
        sc = code_of(nid)
        assert sc["code"].count(a) == 1, (nid, where, a[:80])
        sc["code"] = sc["code"].replace(a, b)

    def declare(nid, names):
        rj = got[nid]["data"]["response_json"]
        tpl = [r for r in rj if r.get("bsonType") == "string"][0]
        have = {r["name"] for r in rj}
        for n, kind in names:
            assert n not in have, (nid, n)
            if kind == "a":
                rj.append(K.resp([n], arrays=(n,))[0])
            else:
                rj.append(dict(copy.deepcopy(tpl), key=K.resp([n])[0]["key"], name=n, title=n))

    # ---- keys: the payload's split bins into the dup tuples; the read's inputs
    swap(KEYS, *KEYS_BASE, "base")
    swap(KEYS, KEYS_GO_OLD, raw("os_keys_go.js"), "GO")
    swap(KEYS, KEYS_AT, raw("os_keys_helper.js") + KEYS_AT, "helper")
    swap(KEYS, *KEYS_RET, "return")
    declare(KEYS, [(n, "s") for n in KEYS_NEW])
    # ---- the read, in the gate's parallel reads (only with a split in play)
    q = V.wrap_sql(V.sub(S.OS_SUBMIT_READ, T=V.N("code_node_ISguard", "data.tenantId"), IA=V.N(KEYS, "data.osIaId"), IDS=V.N(KEYS, "data.osBinIds")))
    rd = got["condition_all_ISread"]
    rd["blocks"].append(K.parallel("x", "x", [("cai_ISosRead", "output split", [
        V.gate(ids, "cor_ISosRead", "A split in play: its bins and the stored IA's split to read?", KEYS, "osRead", [
            K.sql(READ, "Output split: the rows' bins (plant, storage location, active) and the stored IA's split, plant, item, bin", q, ["j"])])])])["blocks"][0])
    # ---- gate: v5's refusal gone; the split after the classic gates
    sc = code_of(GATE)
    assert sc["code"].count(P5.HELPER) == 1
    sc["code"] = sc["code"].replace(P5.HELPER, "")
    swap(GATE, *WHY, "eligibility")
    swap(GATE, *GATE_BASE, "base")
    swap(GATE, GATE_TAIL_OLD, raw("os_gate_tail.js"), "tail")
    units = uses(raw("os_gate_tail.js"))
    swap(GATE, GATE_AT, units + GATE_AT, "os units")
    swap(GATE, *GATE_CALL, "call")
    swap(GATE, *GATE_RET, "return")
    declare(GATE, GATE_NEW)
    # ---- a System split: GENERATE_BATCH once per group, then the final rows (STOP 400 before any write)
    res_tpl, ret_tpl = old["code_node_ISpostres"], old["return_node_ISpost"]
    src = res_tpl["data"]["script"]["code"]
    call = "const res = submitResult([{{node:code_node_ISguard.data}}][0], [{{node:code_node_ISentry.data}}][0], [{{node:code_node_ISpost.data}}][0], null);"
    assert src.count(call) == 1

    def answer(rid, tid, title, msg_ref):
        r = copy.deepcopy(res_tpl)
        r["id"] = rid
        r["data"].update({"title": "Result (" + title + ")", "nodeName": "Result (" + title + ")", "name": "Result (" + title + ")"})
        r["data"]["script"]["code"] = src.replace(call, call.replace("[{{node:code_node_ISpost.data}}][0]", "{ route: \"STOP\", code: \"400\", message: [%s][0], reason: \"\", "
                                                                     "errorCode: \"IA_BATCH_FAILED\", lineCount: [%s][0] }" % (msg_ref, V.N(GATE, "data.lineCount"))))
        for x in r["data"]["response_json"]:
            x["key"] = K.resp([x["name"]])[0]["key"]
        t = copy.deepcopy(ret_tpl)
        t["id"] = tid
        t["data"].update({"title": "Return (" + title + ")", "nodeName": "Return (" + title + ")", "name": "Return (" + title + ")"})
        for p in t["data"]["response_value"]["list"]:
            assert p["value"].startswith("{{node:code_node_ISpostres.data."), p
            p["value"] = p["value"].replace("code_node_ISpostres", rid)
        return [r, t]

    gen = copy.deepcopy(old["workflow_node_ISbatch"])
    gen["id"] = "workflow_node_ISosGenerate"
    gen["data"].update({"title": "Output split: Generate Batch (this group; GENERATE_BATCH v20 + organization_id)", "nodeName": "Output split: Generate Batch (this group)",
                        "name": "Output split: Generate Batch (this group)"})
    gen["data"]["workflow"]["rules"]["list"][0].update({"id": ids(), "parentId": ids()})
    gp = {p["prop"]: p for p in gen["data"]["body_params"]["list"]}
    assert sorted(gp) == ["document_date", "expired_date", "item_id", "manufacturing_date", "organization_id"], sorted(gp)
    for p in ("item_id", "document_date", "manufacturing_date", "expired_date"):
        gp[p]["value"] = V.N(GPICK, "data." + p)
    gp["organization_id"]["value"] = V.N(GATE, "data.organizationId")
    number = [K.if_(ids, "if_ISosGen", "IF a System Settings split: one batch number per group (GENERATE_BATCH, before any write)", "'%s' == 'YES'" % V.N(GATE, "data.osGen"), [
        K.set_cache("set_ISosBatchesInit", "Output split: no number yet", CACHE, "[]"),
        K.loop(ids, "loop_ISosGen", "Output split: a batch number per group (GENERATE_BATCH)", V.N(GATE, "data.osGenGroups"), [
            K.code(GPICK, "Output split: this group", raw("os_gen_pick.js"), ["index", "label", "item_id", "document_date", "manufacturing_date", "expired_date"]),
            gen,
            K.code(GNORM, "Output split: this group's number", raw("os_gen_norm.js"), ["batchNumber", "isError", "message"]),
            K.if_(ids, "if_ISosGenFailed", "IF no number for this group: answer STOP 400, write nothing", "%s == 1" % V.N(GNORM, "data.isError"),
                  answer("code_node_ISosGenres", "return_node_ISosGen", "output split: no batch number", V.N(GNORM, "data.message"))),
            K.get_cache("get_ISosBatches", "Output split: the numbers so far", CACHE),
            K.code(GAPP, "Output split: this group's number added", raw("os_gen_append.js"), ["generated"], arrays=("generated",)),
            K.set_cache("set_ISosBatches", "Output split: the numbers so far (+ this one)", CACHE, V.N(GAPP, "data.generated"))]),
        K.get_cache("get_ISosBatchesFinal", "Output split: every group's number", CACHE)]),
        K.code(FINAL, "Output split: the final rows (a System split's numbers on its groups; [] without a split) and row 1's number",
               uses(raw("os_final.js")) + raw("os_final.js"), ["route", "message", "split", "kind", "output_split", "groups", "batchNo"], arrays=("output_split", "groups")),
        K.if_(ids, "if_ISosFinalEnd", "IF the split's numbers are missing or repeat: answer STOP 400, write nothing", "'%s' == 'STOP'" % V.N(FINAL, "data.route"),
              answer("code_node_ISosres", "return_node_ISos", "output split: batch numbers", V.N(FINAL, "data.message")))]
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("cor_ISbatch")
    assert top[i + 1] == POST, top[i - 1:i + 3]
    doc["nodes"][i + 1:i + 1] = number
    got = P4.index(doc)
    # ---- post: row 1's number for a System split
    for a, b in POST_PAIRS:
        swap(POST, a, b, "post")
    # ---- the IA writes store the final rows
    for nid in WRITES:
        props = got[nid]["data"]["props"]["list"]
        assert "output_split" not in {p["prop"] for p in props}, nid
        tpl = [p for p in props if p["valueType"] == "field" and p["prop"] == "item_id"][0]
        props.append(dict(copy.deepcopy(tpl), prop="output_split", propLabel="output_split", value=V.N(FINAL, "data.output_split")))
    # ---- the read-back's header and the link's fingerprint cover the split
    swap(HDR, *HDR_PAIR, "header read")
    fp14, fp6 = fp_texts()
    swap(LINK, fp14, fp6, "fingerprint")
    after = P4.index(doc)
    assert sorted(set(after) - set(old)) == sorted(NEW_IDS), sorted(set(after) ^ set(NEW_IDS) - set(old))

    # identity: every change undone -> v14 node for node
    rev = copy.deepcopy(doc)
    rev["nodes"] = [n for n in rev["nodes"] if n["id"] not in {x["id"] for x in number}]
    ri = P4.index(rev)
    ri["condition_all_ISread"]["blocks"] = [b for b in ri["condition_all_ISread"]["blocks"] if b["id"] != "cai_ISosRead"]
    ri = P4.index(rev)
    undo = [(KEYS, KEYS_BASE[1], KEYS_BASE[0]), (KEYS, raw("os_keys_go.js"), KEYS_GO_OLD), (KEYS, raw("os_keys_helper.js") + KEYS_AT, KEYS_AT), (KEYS, KEYS_RET[1], KEYS_RET[0]),
            (GATE, units + GATE_AT, P5.HELPER + GATE_AT), (GATE, WHY[1], WHY[0]), (GATE, GATE_BASE[1], GATE_BASE[0]), (GATE, raw("os_gate_tail.js"), GATE_TAIL_OLD),
            (GATE, GATE_CALL[1], GATE_CALL[0]), (GATE, GATE_RET[1], GATE_RET[0]), (HDR, HDR_PAIR[1], HDR_PAIR[0]), (LINK, fp6, fp14)] + [(POST, b, a) for a, b in POST_PAIRS]
    for nid, a, b in undo:
        c = ri[nid]["data"]["script"]
        assert c["code"].count(a) == 1, ("undo", nid, a[:60])
        c["code"] = c["code"].replace(a, b)
    for nid, names in ((KEYS, KEYS_NEW), (GATE, [n for n, _ in GATE_NEW])):
        ri[nid]["data"]["response_json"] = [r for r in ri[nid]["data"]["response_json"] if r["name"] not in names]
    for nid in WRITES:
        ri[nid]["data"]["props"]["list"] = [p for p in ri[nid]["data"]["props"]["list"] if p["prop"] != "output_split"]
    assert sorted(ri) == sorted(old), sorted(set(ri) ^ set(old))
    for nid, n in old.items():
        assert P4.canon(ri[nid]) == P4.canon(n), "v14 node changed: " + nid
    new_keys = []
    for nid in NEW_IDS:
        if nid in after and after[nid].get("type") != "ifBlock":
            new_keys.extend(sorted(P4.keys_of({k: v for k, v in after[nid].items() if k != "blocks"}, set())))
    for nid in (KEYS, GATE):
        new_keys.extend(r["key"] for r in after[nid]["data"]["response_json"] if r["name"] in set(KEYS_NEW) | {n for n, _ in GATE_NEW})
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & P4.keys_of(base, set()), "a new key repeats or collides with v14's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_V2_SUBMIT.json")
    print("IA_V2_SUBMIT v6: %d chars, %d nodes" % (len(text), len(P4.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
