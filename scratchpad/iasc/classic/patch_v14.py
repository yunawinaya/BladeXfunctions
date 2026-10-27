"""IA_SAVE v14 = the deployed v25 (patch_v13.build(), pinned md5 of its written text) + the IA output split (plan 10-27,
code/shared/os_split.js): the finished good received into several bins / batches, one ADD_INVENTORY per row.
  top level, after if_SCfailed    code_node_OSmerge: the rows the save writes (a payload without the key keeps the stored ones, read
                                  by the Small Cycle source the Edit already makes) + the mobile guard -> 400
  if_validate (completion)        sql_node_OSbins (the rows' bins) + code_node_OScheck (the rows for the item) -> 401, before any write
  if_persist (completion)         a System Settings split: GENERATE_BATCH once per group (IDA_SAVE's cache loop), code_node_OSfinal
                                  (numbers on the rows) -> 400 before the claim; if_needs_batch_gen skips a split; after the header
                                  write its single Output Location fields = row 1 (update_node_OShead); the receipt: if_OSsplit true =
                                  one Batch row per batch (add + read back -> PARTIAL|RECEIPT|0/n) then ADD_INVENTORY per row (row k
                                  refused -> PARTIAL|RECEIPT|k/n, 400), false = v25's wf_add + if_add_failed (moved, unchanged)
  the 4 header writes             + output_split (Draft / Created: as merged; a completion: the final rows)
No split (every IA today) runs v25's nodes and writes, the new prop aside: asserted by undoing every change -> v25 node for node.

usage: python3 scratchpad/iasc/classic/patch_v14.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_SAVE.json)"""
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
import patch_v13 as P13  # noqa: E402
import v2build as V  # noqa: E402
import wfkit as K  # noqa: E402
import sql as S  # noqa: E402

# Item Assembly & BOM/SmallCycle/IA_SAVE.json as patch_v13 writes it = DEV v25 (IDENTICAL, 10-27)
BASE_MD5 = "a9c5931b8b85a813477c28638f752217"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
CODE = os.environ.get("IASC_CODE") or os.path.join(IASC, "code")
SEED = 20261027
FILTER_BASE = 1792400000000
BATCH = "Batch:Table:1902719754154655746"
BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date",
              "expired_date"]
MERGE, BINS, CHECK, FINAL, HEAD, PLAN, BIDS, BREAD, RCPT = ("code_node_OSmerge", "sql_node_OSbins", "code_node_OScheck", "code_node_OSfinal", "code_node_OShead",
                                                           "code_node_OSplan", "code_node_OSbatchIds", "sql_node_OSbatchRead", "code_node_OSreceipts")
GPICK, GNORM, GAPP, APICK, EXB, EXR = ("code_OSgenPick", "code_OSgenNorm", "code_OSgenAppend", "code_node_OSaddPick", "code_node_OSexitBatch", "code_node_OSexitRow")
CL_WIN = P13.CL_WIN
CACHE = "iaOsBatches_" + V.N(CHECK, "data.cacheKey")
WRITES_DRAFT = ("add_draft", "update_draft")
WRITES_DONE = ("add_ia", "update_ia")
NEEDS_GEN = ("{{node:code_batch_decide.data.needsGen}} == 1", "{{node:code_batch_decide.data.needsGen}} == 1 && '%s' != 'YES'" % V.N(MERGE, "data.split"))
ADD_ROW = ["location_id", "inventory_category", "quantity", "batch_number", "manufacturing_date", "expired_date"]


def ifs(*names):
    return [x for n in names for x in (n, n + "_t", n + "_f")]


NEW_IDS = ([MERGE] + ifs("if_OSfailed") + ["return_node_OS400"] +
           ifs("if_OSbinsRead") + [BINS, CHECK] + ifs("if_OScheckFailed") + ["return_node_OS401"] +
           ifs("if_OSgen") + ["set_OSbatchesInit", "loop_OSgen", GPICK, "wf_OSgenerate", GNORM] + ifs("if_OSgenFailed") +
           ["return_node_OSgen400", "get_OSbatches", GAPP, "set_OSbatches", "get_OSbatchesFinal", FINAL] + ifs("if_OSfinalFailed") + ["return_node_OSfinal400", HEAD] +
           ifs("if_OShead") + ["update_node_OShead"] + ifs("if_OSsplit") + [PLAN] + ifs("if_OSbatchIns") + ["add_node_OSbatch", BIDS, BREAD, RCPT] +
           ifs("if_OSreceiptsFailed") + [EXB, "cor_IAclaimFreeOSb", "cori_YIAclaimFreeOSb", "cori_NIAclaimFreeOSb", "update_node_IAclaimFreeOSb", "return_node_OSbatch400",
                                         "loop_OSadd", APICK, "wf_OSadd"] +
           ifs("if_OSaddFailed") + [EXR, "cor_IAclaimFreeOSa", "cori_YIAclaimFreeOSa", "cori_NIAclaimFreeOSa", "update_node_IAclaimFreeOSa", "return_node_OSadd400"])


def os_units():
    """os_split.js's top-level `const` statements (name -> text), in file order"""
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


def body(name, shared=True):
    """a classic body + the os_split.js statements it uses (and theirs), in file order"""
    text = V.raw(CODE, "classic/" + name)
    if not shared:
        return text
    units = os_units()
    used = lambda t: {k for k in units if re.search(r"\b%s\b" % k, t)}
    need, todo = set(), used(text)
    while todo:
        k = todo.pop()
        if k not in need:
            need.add(k)
            todo |= used(units[k]) - need
    assert need, name + ": uses nothing of os_split.js"
    return "\n".join(units[k] for k in units if k in need) + "\n" + text


def build():
    v13 = P13.build()
    text13 = json.dumps(v13, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text13.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v13's build is no longer the deployed v25"
    base = json.loads(text13)
    old = P13.index(base)
    for nid in NEW_IDS:
        assert '"%s"' % nid not in text13, nid + " already in v25"
    assert str(FILTER_BASE)[:7] not in text13
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

    def resp(names, arrays=(), objects=()):
        out = []
        for n in names:
            if n in arrays:
                out.append({"key": key(), "name": n, "title": n, "description": "", "bsonType": "array", "isExpand": True,
                            "children": [{"key": key(), "name": "items", "title": "", "description": "", "bsonType": "any", "isExpand": False, "isArrayItem": True,
                                          "children": []}]})
            else:
                out.append({"key": key(), "name": n, "title": "", "description": "", "bsonType": "any" if n in objects else "string", "isExpand": False, "children": []})
        return out

    def code(nid, t, text, names, arrays=(), objects=()):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(title(t))
        d["script"] = {"type": "javascript", "code": text}
        d["response_json"] = resp(names, arrays, objects)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def sql(nid, t, text):
        d = {"database_id": "", "sql": "", "params": {}}
        d.update(title(t))
        d["script"] = {"type": "sql", "code": V.wrap_sql(text)}
        d["response_json"] = resp(["j"])
        return {"id": nid, "type": "sql-node", "data": d, "blocks": []}

    tpl_if = old["if_idem_blocked"]
    assert tpl_if["data"]["condition_type"] == "Expression" and [b["data"]["title"] for b in tpl_if["blocks"]] == ["true", "false"]

    def if_(nid, t, expr, yes, no=()):
        assert yes
        n = copy.deepcopy(tpl_if)
        n["id"] = nid
        n["data"].update(title(t))
        n["data"]["filter"]["list"][0].update({"id": ids(), "parentId": ids()})
        n["data"]["expression"]["code"] = expr
        n["blocks"][0].update({"id": nid + "_t", "blocks": list(yes)})
        n["blocks"][1].update({"id": nid + "_f", "blocks": list(no)})
        return n

    def ret(tpl, nid, t, message):
        r = copy.deepcopy(old[tpl])
        lst = r["data"]["response_value"]["list"]
        assert r["data"]["status_code"] == 200 and [p["prop"] for p in lst] == ["code", "message"] and lst[0]["valueType"] == "value", tpl
        r["id"] = nid
        r["data"].update(title(t))
        lst[1]["value"] = message
        return r

    def callee(tpl, nid, t, values, extra=()):
        c = copy.deepcopy(old[tpl])
        c["id"] = nid
        c["data"].update(title(t))
        c["data"]["workflow"]["rules"]["list"][0].update({"id": ids(), "parentId": ids()})
        params = c["data"]["body_params"]["list"]
        for p in params:
            if p["prop"] in values:
                p["value"] = values[p["prop"]]
        assert set(values) <= {p["prop"] for p in params}, (tpl, sorted(set(values) - {p["prop"] for p in params}))
        tpl_p = [p for p in params if p["valueType"] == "field"][0]
        for prop, value in extra:
            assert prop not in {p["prop"] for p in params}
            params.append(dict(copy.deepcopy(tpl_p), prop=prop, propLabel=prop, value=value))
        return c

    def free_gate(tag, label, src):
        return V.gate(ids, "cor_IAclaimFree" + tag, "MIN-02: our completion claim to free (" + label + ")?", CL_WIN, "needExit", [
            K.update(ids, "update_node_IAclaimFree" + tag, "GD Publish Step: our completion claim FREE, how it ended (" + label + ")", V.STEP,
                     ("id", "in", V.N(src, "data.rows.id")), [(p, V.N(src, "data.rows." + p)) for p in ("id", "step_status", "finished_at", "result_ref")])])

    # ---- every save: the rows to write, the mobile guard
    merge = [code(MERGE, "Output split: the rows this save writes (no key = the stored ones) and the mobile guard", body("os_merge.js"),
                  ["route", "message", "split", "output_split", "count", "binIds", "tenantId"], arrays=("output_split",)),
             if_("if_OSfailed", "IF the output split was refused (unreadable, too many rows, a mobile save moving a split)", "'%s' == 'STOP'" % V.N(MERGE, "data.route"),
                 [ret("return_required_400", "return_node_OS400", "Return Refused 400 (output split)", V.N(MERGE, "data.message"))])]
    # ---- a completion: the rows checked for the item and its bins (before the idempotency guard's read, as code_validate)
    check = [if_("if_OSbinsRead", "IF a split completion: its rows' bins to read", "'%s' == 'YES'" % V.N(MERGE, "data.split"), [
                 sql(BINS, "Output split: the rows' bins (plant, storage location, active)", V.sub(S.OS_BINS, IDS=V.N(MERGE, "data.binIds")))]),
             code(CHECK, "Output split: the rows for the item (qty total, bins, batches, dates) and the groups to number", body("os_check.js"),
                  ["route", "message", "kind", "split", "output_split", "groups", "gen", "genGroups", "cacheKey"], arrays=("output_split", "groups", "genGroups")),
             if_("if_OScheckFailed", "IF the output split was refused (401, before any write)", "'%s' == 'STOP'" % V.N(CHECK, "data.route"),
                 [ret("return_validate_401", "return_node_OS401", "Return Refused 401 (output split)", V.N(CHECK, "data.message"))])]
    # ---- a System Settings split: one GENERATE_BATCH call per group (IDA_SAVE v7's cache loop), before the claim
    gen = callee("wf_generate_batch", "wf_OSgenerate", "Output split: Generate Batch (this group)",
                 {p: V.N(GPICK, "data." + p) for p in ("item_id", "document_date", "manufacturing_date", "expired_date")})
    number = [if_("if_OSgen", "IF a System Settings split: one batch number per group", "'%s' == 'YES'" % V.N(CHECK, "data.gen"), [
                  K.set_cache("set_OSbatchesInit", "Output split: no number yet", CACHE, "[]"),
                  K.loop(ids, "loop_OSgen", "Output split: a batch number per group (GENERATE_BATCH)", V.N(CHECK, "data.genGroups"), [
                      code(GPICK, "Output split: this group", body("os_gen_pick.js", False), ["index", "label", "item_id", "document_date", "manufacturing_date", "expired_date"]),
                      gen,
                      code(GNORM, "Output split: this group's number", body("os_gen_norm.js", False), ["batchNumber", "isError", "message"]),
                      if_("if_OSgenFailed", "IF no number for this group", "%s == 1" % V.N(GNORM, "data.isError"),
                          [ret("return_batch_400", "return_node_OSgen400", "Return Data (output split: no batch number)", V.N(GNORM, "data.message"))]),
                      K.get_cache("get_OSbatches", "Output split: the numbers so far", CACHE),
                      code(GAPP, "Output split: this group's number added", body("os_gen_append.js", False), ["generated"], arrays=("generated",)),
                      K.set_cache("set_OSbatches", "Output split: the numbers so far (+ this one)", CACHE, V.N(GAPP, "data.generated"))]),
                  K.get_cache("get_OSbatchesFinal", "Output split: every group's number", CACHE)]),
              code(FINAL, "Output split: the final rows (a System split's numbers on its groups)", body("os_final.js"),
                   ["route", "message", "split", "kind", "output_split", "groups"], arrays=("output_split", "groups")),
              if_("if_OSfinalFailed", "IF the split's numbers are missing or repeat (400, before the claim)", "'%s' == 'STOP'" % V.N(FINAL, "data.route"),
                  [ret("return_batch_400", "return_node_OSfinal400", "Return Data (output split: batch numbers)", V.N(FINAL, "data.message"))])]
    # ---- after the header write (the IA's id known): a split's single Output Location fields = row 1
    up = copy.deepcopy(old["update_draft"])
    up["id"] = "update_node_OShead"
    up["data"].update(title("Output split: the header's Output Location fields = row 1"))
    leaf = up["data"]["table_id"]["rules"]["list"][0]
    assert leaf["prop"] == "id" and leaf["operator"] == "in"
    leaf.update({"id": ids(), "parentId": ids(), "value": V.N(HEAD, "data.id")})
    tpl_p = [x for x in up["data"]["props"]["list"] if x["prop"] == "id"][0]
    up["data"]["props"]["list"] = [dict(tpl_p, prop=p, propLabel=p if p != "id" else tpl_p["propLabel"], value=V.N(HEAD, "data." + p))
                                   for p in ("id", "storage_location_id", "location_id", "inventory_category", "batch_no", "manufacturing_date", "expired_date")]
    head = [code(HEAD, "Output split: the header's Output Location fields (row 1)", body("os_head.js"),
                 ["need", "id", "storage_location_id", "location_id", "inventory_category", "batch_no", "manufacturing_date", "expired_date"]),
            if_("if_OShead", "IF a split: its header's Output Location fields to set", "'%s' == 'YES'" % V.N(HEAD, "data.need"), [up])]
    # ---- the receipt: a split = its Batch rows, then one ADD_INVENTORY per row; else v25's single receipt
    batch_add = K.add(ids, "add_node_OSbatch", "Output split: the Batch rows, one per batch (ADD_INVENTORY add_node_F9KqZLfd's columns)", BATCH,
                      [(c, V.N(PLAN, "data.batchRows." + c)) for c in BATCH_COLS])
    add_row = callee("wf_add", "wf_OSadd", "Output split: Add Inventory (this row)", {p: V.N(APICK, "data." + p) for p in ADD_ROW},
                     extra=[("batch_id", V.N(APICK, "data.batch_id"))])
    split_true = [
        code(PLAN, "Output split: the Batch rows to insert (one per batch)", body("os_plan.js"), ["needBatch", "batchRows", "tenantId"], arrays=("batchRows",)),
        if_("if_OSbatchIns", "IF a batch item: its Batch rows to insert", "'%s' == 'YES'" % V.N(PLAN, "data.needBatch"), [
            batch_add,
            code(BIDS, "Output split: the inserted Batch rows' ids", body("os_batch_ids.js"), ["ids", "count"]),
            sql(BREAD, "Output split: the inserted Batch rows read back", V.sub(S.OS_BATCH_READ, T=V.N(PLAN, "data.tenantId"), IDS=V.N(BIDS, "data.ids")))]),
        code(RCPT, "Output split: the receipts (one per row, its batch's id)", body("os_receipts.js"), ["route", "message", "receipts", "n", "marker"], arrays=("receipts",)),
        if_("if_OSreceiptsFailed", "IF the split's batches are not all there (PARTIAL|RECEIPT|0/n)", "'%s' == 'STOP'" % V.N(RCPT, "data.route"), [
            code(EXB, "C2: the claim's outcome (output split: no batch)", body("os_exit_batch.js", False), ["rows"], arrays=("rows",)),
            free_gate("OSb", "output split batches", EXB),
            ret("return_add_400", "return_node_OSbatch400", "Return Data (output split: the batches)", V.N(RCPT, "data.message"))]),
        K.loop(ids, "loop_OSadd", "Output split: one receipt per row (ADD_INVENTORY)", V.N(RCPT, "data.receipts"), [
            code(APICK, "Output split: this row's receipt", body("os_add_pick.js", False),
                 ["row", "n", "location_id", "inventory_category", "quantity", "batch_number", "batch_id", "manufacturing_date", "expired_date"]),
            add_row,
            if_("if_OSaddFailed", "IF this row's receipt was refused (PARTIAL|RECEIPT|k/n)", "'%s' == '400'" % V.N("wf_OSadd", "data.code"), [
                code(EXR, "C2: the claim's outcome (output split: row k of n)", body("os_exit_row.js", False), ["rows", "message"], arrays=("rows",)),
                free_gate("OSa", "output split row", EXR),
                ret("return_add_400", "return_node_OSadd400", "Return Data (output split: a row's receipt)", V.N(EXR, "data.message"))])])]

    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    i = top.index("if_SCfailed")
    assert top[i + 1] == "if_validate", top[i - 1:i + 3]
    doc["nodes"][i + 1:i + 1] = merge
    got = P13.index(doc)
    vt = got["if_validate"]["blocks"][0]["blocks"]
    assert [n["id"] for n in vt][:5] == ["code_item_ids", "search_items", "code_validate", "if_validate_failed", "if_edit_guard"], [n["id"] for n in vt]
    vt[4:4] = check
    pt = got["if_persist"]["blocks"][0]["blocks"]
    order = [n["id"] for n in pt]
    assert order == ["code_batch_decide", "if_needs_batch_gen", "code_node_IAclaimIn", "if_IAclaim", "code_node_IAclaimWin", "code_node_IAclaimExit", "if_IAclaimLose",
                     "code_batch_number", "if_edit", "code_persisted", "loop_issue_lines", "search_movements", "code_receipt_prep", "wf_add", "if_add_failed",
                     "code_hu_unloads", "loop_hu", "code_item_txn", "update_item_txn", "cor_IAclaimFreeDone"], order
    single = pt[13:15]
    pt[13:15] = [if_("if_OSsplit", "IF a split receipt (else the single receipt)", "'%s' == 'YES'" % V.N(MERGE, "data.split"), split_true, single)]
    pt[10:10] = head
    pt[2:2] = number
    ng = got["if_needs_batch_gen"]["data"]["expression"]
    assert ng["code"] == NEEDS_GEN[0], ng
    ng["code"] = NEEDS_GEN[1]
    sc = got["sql_node_SCsource"]["data"]["script"]
    assert sc["code"].count(S.OS_SC_STORED[0]) == 1, "the Small Cycle source's stored fields changed"
    sc["code"] = sc["code"].replace(S.OS_SC_STORED[0], S.OS_SC_STORED[1])
    for nid in WRITES_DRAFT + WRITES_DONE:
        props = got[nid]["data"]["props"]["list"]
        assert "output_split" not in {p["prop"] for p in props}, nid
        tpl = [p for p in props if p["valueType"] == "field" and p["prop"] == "item_id"][0]
        props.append(dict(copy.deepcopy(tpl), prop="output_split", propLabel="output_split",
                          value=V.N(MERGE if nid in WRITES_DRAFT else FINAL, "data.output_split")))
    after = P13.index(doc)
    assert sorted(set(after) - set(old)) == sorted(NEW_IDS), sorted(set(after) ^ set(NEW_IDS) - set(old))

    # identity: every change undone -> v25 node for node
    rev = copy.deepcopy(doc)
    rev["nodes"] = [n for n in rev["nodes"] if n["id"] not in {x["id"] for x in merge}]
    ri = P13.index(rev)
    vb = ri["if_validate"]["blocks"][0]
    vb["blocks"] = [n for n in vb["blocks"] if n["id"] not in {x["id"] for x in check}]
    pb = ri["if_persist"]["blocks"][0]
    out = []
    for n in pb["blocks"]:
        if n["id"] == "if_OSsplit":
            out.extend(n["blocks"][1]["blocks"])
        elif n["id"] not in {x["id"] for x in number + head}:
            out.append(n)
    pb["blocks"] = out
    ri = P13.index(rev)
    ri["if_needs_batch_gen"]["data"]["expression"]["code"] = NEEDS_GEN[0]
    rs = ri["sql_node_SCsource"]["data"]["script"]
    rs["code"] = rs["code"].replace(S.OS_SC_STORED[1], S.OS_SC_STORED[0])
    for nid in WRITES_DRAFT + WRITES_DONE:
        ri[nid]["data"]["props"]["list"] = [p for p in ri[nid]["data"]["props"]["list"] if p["prop"] != "output_split"]
    assert sorted(ri) == sorted(old), sorted(set(ri) ^ set(old))
    for nid, n in old.items():
        assert P13.canon(ri[nid]) == P13.canon(n), "v25 node changed: " + nid
    new_keys = []
    for nid in NEW_IDS:
        if nid in after and after[nid].get("type") != "ifBlock":
            new_keys.extend(sorted(P13.keys_of({k: v for k, v in after[nid].items() if k != "blocks"}, set())))
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & P13.keys_of(base, set()), "a new key repeats or collides with v25's"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_SAVE.json")
    print("IA_SAVE v14: %d chars, %d nodes" % (len(text), len(P13.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
