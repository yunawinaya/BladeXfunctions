"""Item Disassembly V2 integration (E phase 2): every cross-package contract field checked statically, writer vs reader vs CONTRACT.md, with
file:line citations (template tpl/iav2/test/integration/interfaces.py). Read-only: sources, CONTRACT.md, the BUILT JSONs.
usage: python3 scratchpad/idav2/test/integration/interfaces.py [--json out.json]
   1 request_payload (SUBMIT post.js / link.js; PREPARE's R8 link)   -> PREPARE / COMMIT / WORKER / SUBMIT-FACTS reads
   2 the manifest + counts (PREPARE plan.js)                          -> COMMIT entry
   3 the part names / prefix / step-name lengths                       -> COMMIT's part reads (built JSON)
   4 ENGINE_I / ENGINE_R movements + alloc                             -> CONTRACT section 5, COMMIT D1 re-PLAN / D2 / D3 (only unit_price, batch_id change)
   5 BATCH (+ items) rows                                              -> COMMIT D1 / D4 / failNoWrite; the 11 Batch insert columns
   6 LABELS / ITEMS                                                    -> COMMIT D1 word / D2 / D4 and the shared movekey.js
   7 job states each workflow writes vs the states each accepts / polls
   8 error codes named in the five built workflows vs CONTRACT section 10; the worker's hard codes vs section 8
   9 the worker <-> PREPARE / COMMIT calls (params, answer fields); the worker's IDA_LOCK_JOIN vs CONTRACT section 8
  10 every engine call (params, literal modes, op keys) vs the deployed INVENTORY_BULK_APPLY v10's request
  11 the document lock / correlation / ownership names across SUBMIT, WORKER, PREPARE, COMMIT, the classic v7
  12 the classic v7's guard (SQL = shared CLASSIC_GUARD, texts = IDA_TEXT) and SUBMIT's typed-number / BUSY texts"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(IDAV2, "..", ".."))
OUT = os.path.join(REPO, "Item Disassembly", "AsyncV2")
sys.dont_write_bytecode = True
results = []


def rel(p):
    return os.path.relpath(p, REPO)


def text(p):
    return open(p if os.path.isabs(p) else os.path.join(IDAV2, p), encoding="utf-8").read()


def cite(path, pattern, flags=0):
    """path:line of the first line matching `pattern`; raises when absent"""
    p = path if os.path.isabs(path) else os.path.join(IDAV2, path)
    for i, line in enumerate(open(p, encoding="utf-8").read().split("\n"), 1):
        if re.search(pattern, line, flags):
            return "%s:%d" % (rel(p), i)
    raise AssertionError("%s: no line matches %r" % (rel(p), pattern))


def check(name, ok, detail, cites):
    results.append({"ok": bool(ok), "name": name, "detail": "" if ok else detail, "cites": cites})
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "\n       " + detail))
    for c in cites:
        print("       " + c)


def literal_keys(src, start_re):
    """the top-level keys of the object literal that opens at `start_re` (balanced braces, strings skipped)"""
    m = re.search(start_re, src)
    assert m, start_re
    i = src.index("{", m.end() - 1)
    depth, j, keys, buf = 0, i, [], ""
    while j < len(src):
        c = src[j]
        if c in "\"'`":
            q = c
            j += 1
            while src[j] != q:
                j += 2 if src[j] == "\\" else 1
        elif c in "{[(":
            depth += 1
            if depth == 1:
                buf = ""
        elif c in "}])":
            depth -= 1
            if depth == 0:
                break
        if depth == 1 and c not in "{":
            buf += c
            k = re.match(r"^[\s,]*(\w+)\s*:", buf)
            if k and buf.rstrip().endswith(":") and k.group(1) not in keys:
                keys.append(k.group(1))
            if c == ",":
                buf = ""
        j += 1
    return keys


def doc(name):
    return json.load(open(os.path.join(OUT, name + ".json"), encoding="utf-8"))


def base_doc(fname):
    return json.load(open(os.path.join(IDAV2, "base", fname), encoding="utf-8"))


def walk(nodes):
    for n in nodes or []:
        yield n
        yield from walk(n.get("blocks"))


def req_names(d):
    return [r["name"] for r in d["request_json"]]


def resp_names(d):
    return [r["name"] for r in d["response_json"]]


CONTRACT = text("CONTRACT.md")


def contract_json(after):
    i = CONTRACT.index(after)
    j = CONTRACT.index("```json", i)
    k = CONTRACT.index("```", j + 7)
    return json.loads(CONTRACT[j + 7:k])


def reads(paths, var):
    out = set()
    for p in paths:
        out |= set(re.findall(r"\b%s\.(\w+)" % re.escape(var), text(p)))
    return sorted(out)


def code_of(d, node_id):
    for n in walk(d["nodes"]):
        if n["id"] == node_id:
            return n["data"]["script"]["code"]
    raise KeyError(node_id)


BUILT = {n: doc(n) for n in ("IDA_V2_SUBMIT", "IDA_V2_WORKER", "IDA_V2_PREPARE", "IDA_V2_COMMIT", "IDA_SAVE")}
ENGINE = base_doc("INVENTORY_BULK_APPLY.v10.json")
IDS = json.loads(text("ids.json"))

# ================================================================================================ 1 request_payload
post = text("code/submit/post.js")
written = literal_keys(post, r"const request = \{")
link_adds = re.findall(r"request\.(\w+) = ", text("code/submit/link.js"))
c3 = list(contract_json("**request_payload** (JSON text, SUBMIT only").keys())
check("1.1 SUBMIT writes exactly CONTRACT section 3's request_payload keys (%d); link fills %s" % (len(c3), ", ".join(link_adds)),
      sorted(written) == sorted(c3) and set(link_adds) <= set(written) and set(link_adds) == {"idaId", "idaNo", "issuedNo", "lineFingerprint"},
      "written %s / contract %s / link %s" % (sorted(written), sorted(c3), link_adds),
      [cite("code/submit/post.js", r"const request = \{") + "  (writer)", cite("code/submit/link.js", r"request\.lineFingerprint = ") + "  (link)",
       cite("CONTRACT.md", r"^\*\*request_payload\*\*") + "  (contract)"])
prep_reads = reads(["code/prepare/entry.js", "code/prepare/plan.js"], "req")
check("1.2 PREPARE reads only request keys SUBMIT writes: " + ", ".join(prep_reads), set(prep_reads) <= set(written),
      "read, not written: %s" % sorted(set(prep_reads) - set(written)),
      [cite("code/prepare/entry.js", r"req\.prevStatus") + "  (prevStatus)", cite("code/prepare/plan.js", r"s\(req\.action\) !== \"DIRECT\"") + "  (action, saveAs)",
       cite("code/prepare/plan.js", r"req\.idaId") + "  (idaId)", cite("code/prepare/plan.js", r"req\.idaNo") + "  (idaNo)",
       cite("code/prepare/plan.js", r"req\.lineFingerprint\)\.indexOf") + "  (lineFingerprint)", cite("code/prepare/plan.js", r"req\.uid") + "  (uid)"])
r8 = re.search(r"Object\.assign\(\{\}, req, \{ idaId: [^,]+, idaNo: [^,]+, issuedNo:", text("code/prepare/entry.js"))
check("1.3 PREPARE's unlinked-job FAILED (R8) writes the link back in the same keys (idaId, idaNo, issuedNo) the request carries", bool(r8) and {"idaId", "idaNo", "issuedNo"} <= set(written),
      "entry.js R8 link", [cite("code/prepare/entry.js", r"Object\.assign\(\{\}, req, \{ idaId")])
sql_keys = {}
for wf in ("IDA_V2_SUBMIT", "IDA_V2_WORKER", "IDA_V2_PREPARE", "IDA_V2_COMMIT"):
    for n in walk(BUILT[wf]["nodes"]):
        if n["type"] == "sql-node":
            for k in re.findall(r"JSON_EXTRACT\(\w+\.request_payload, '\$\.(\w+)'\)", n["data"]["script"]["code"]):
                sql_keys.setdefault(k, set()).add(wf.replace("IDA_V2_", "") + ":" + n["id"])
check("1.4 every SQL read of request_payload names a written key: " + "; ".join("%s <- %s" % (k, ", ".join(sorted(v))[:120]) for k, v in sorted(sql_keys.items())),
      set(sql_keys) <= set(written), "not written: %s" % sorted(set(sql_keys) - set(written)),
      [cite(os.path.join(IDAV2, "code/shared/sql.py"), r"\$\.issuedNo") + "  (FACTS number rule)", cite("build_worker.py", r"^IDA_PREV_COL") + "  (WORKER prev_status)",
       cite("commit/sql.py", r"prevStatus") + "  (COMMIT job read)"])
prev_ok = re.search(r'IDA_PREV_STATUSES = \["Draft"\]', text("code/shared/ida_common.js"))
check("1.5 prevStatus: SUBMIT writes the entry's stored status only when idaPrevStatusOk (Draft) - PREPARE / COMMIT / WORKER unlock to exactly that set",
      bool(prev_ok) and "idaPrevStatusOk(request.prevStatus)" in post, "IDA_PREV_STATUSES", [cite("code/shared/ida_common.js", r"IDA_PREV_STATUSES = "), cite("code/submit/post.js", r"idaPrevStatusOk\(request\.prevStatus\)")])

# ================================================================================================ 2 the manifest
plan = text("code/prepare/plan.js")
man_w = literal_keys(plan, r"const manifest = \{")
man_c = list(contract_json("`prepared_payload` (PREPARE, READY_TO_COMMIT").keys())
counts_w = literal_keys(plan, r"counts: \{")
counts_c = list(contract_json("`prepared_payload` (PREPARE, READY_TO_COMMIT")["counts"].keys())
entry_c = text("code/commit/entry.js")
m_reads = sorted(set(re.findall(r"\bm\.(\w+)", entry_c)))
c_reads = sorted(set(re.findall(r"\bc\.(\w+)", entry_c)))
check("2.1 PREPARE's manifest keys = CONTRACT section 5's (%d); COMMIT's entry reads %s (all written)" % (len(man_c), ", ".join(m_reads)),
      sorted(man_w) == sorted(man_c) and set(m_reads) <= set(man_w), "written %s / contract %s / read-not-written %s" % (sorted(man_w), sorted(man_c), sorted(set(m_reads) - set(man_w))),
      [cite("code/prepare/plan.js", r"const manifest = \{"), cite("code/commit/entry.js", r"const m = idaParseJ"), cite("CONTRACT.md", r"^`prepared_payload`")])
check("2.2 counts keys = CONTRACT's (%s); COMMIT reads counts.%s for the lease and the >= 1 movement rule" % (", ".join(counts_c), ", ".join(c_reads)),
      sorted(counts_w) == sorted(counts_c) and set(c_reads) <= set(counts_w), "written %s / contract %s / read %s" % (counts_w, counts_c, c_reads),
      [cite("code/prepare/plan.js", r"counts: \{ lines"), cite("code/commit/entry.js", r"num\(c\.movementsI\) >= 1")])
bm_ok = 'batchMode: rows.length ? "insert" : "none"' in plan and 'if (rows.length) parts.BATCH = { mode: "insert"' in plan
check("2.3 batchMode insert exactly when a BATCH part is written (PREPARE); COMMIT refuses insert without BATCH and BATCH without insert", bm_ok
      and 's(m.batchMode) === "insert" && !listed("BATCH")' in entry_c and 's(m.batchMode) !== "insert" && listed("BATCH")' in entry_c, "batchMode rule",
      [cite("code/prepare/plan.js", r'batchMode: rows\.length'), cite("code/commit/entry.js", r'listed\("BATCH"\)')])

# ================================================================================================ 3 parts
parts_w = re.search(r"IDA_PLAN_PARTS = \[([^\]]*)\]", text("code/prepare/plan.js") + text("code/prepare/ready.js") + text("code/prepare/adapter.js") + text("build_prepare.py"))
parts_w = parts_w.group(1).replace('"', "").replace("'", "").replace(" ", "").split(",") if parts_w else []
parts_c = re.search(r"PART in ([A-Z_`, ]+)", CONTRACT).group(1).replace("`", "").replace(" ", "").split(",")
parts_r = re.search(r"IDA_PARTS = \[([^\]]*)\]", entry_c).group(1).replace('"', "").replace(" ", "").split(",") + ["BATCH"]
commit_json = json.dumps(BUILT["IDA_V2_COMMIT"], ensure_ascii=False)
like = sorted(set(re.findall(r"LIKE CONCAT\('\{\{node:code_node_DCentry\.data\.partPrefix\}\}', '([A-Z_]+)\|%'\)", commit_json)))
check("3.1 part names: PREPARE writes %s = CONTRACT section 1; COMMIT requires %s and reads %s" % (parts_w, parts_r, like),
      sorted(parts_w) == sorted(parts_c) and set(parts_r) <= set(parts_w) and set(like) <= set(parts_w), "PREPARE %s / CONTRACT %s / COMMIT %s / reads %s" % (parts_w, parts_c, parts_r, like),
      [cite("code/prepare/plan.js", r"IDA_PLAN_PARTS|for \(const name of IDA_PLAN_PARTS\)"), cite("code/commit/entry.js", r"IDA_PARTS = \["), cite("CONTRACT.md", r"PREPARE parts")])
prefix_ok = 'idaPartRows(jobId, orgId, "P|" + nonce + "|" + name + "|"' in plan and 'partPrefix: valid ? "P|" + s(m.nonce) + "|"' in entry_c
nonce_len = re.search(r'\+ "00000000"\)\.slice\(0, 8\)', plan)
longest = max(len(p) for p in parts_w)
check("3.2 part step names P|<8-char nonce>|<PART>|<nnn>: PREPARE's prefix = COMMIT's partPrefix; the longest is %d chars (<= 23 CONTRACT, <= 32 varchar)" % (2 + 8 + 1 + longest + 4),
      prefix_ok and bool(nonce_len) and 2 + 8 + 1 + longest + 4 <= 23, "prefix %s nonce %s" % (prefix_ok, bool(nonce_len)),
      [cite("code/prepare/plan.js", r'"P\|" \+ nonce'), cite("code/commit/entry.js", r'partPrefix: valid \? "P\|"'), cite(os.path.join(IDAV2, "base", "columns.json"), r'"step_name"')])
chunk = re.search(r"IDA_CHUNK = (\d[\d_]*)", text("code/shared/ida_common.js"))
check("3.3 parts are chunked and joined by the ONE shared pair idaPartRows / idaJoinChunks (chunk %s chars); COMMIT joins with the same prefix it reads" % (chunk.group(1) if chunk else "?"),
      bool(chunk) and "idaJoinChunks(partRows, entry.partPrefix + \"BATCH|\")" in text("code/commit/d1_plan.js"), "shared chunking",
      [cite("code/shared/ida_common.js", r"IDA_CHUNK = "), cite("code/commit/d1_plan.js", r"idaJoinChunks\(partRows, entry\.partPrefix")])

gate = text("code/submit/gate.js")
leg = re.search(r"const IDA_V2_MAX_LEG = (\d+);", gate)
maxm = re.search(r"const IDA_MAX_MOVES = (\d+);", text("code/shared/ida_common.js"))
park = re.search(r"const IDA_PARK = (\d+);", text("code/shared/ida_common.js"))
alone = re.search(r"const IDA_PREPARE_ALONE_MOVES = (\d+);", text("build_worker.py"))
eng_max = re.search(r"MAX_MOVEMENTS = (\d+)", json.dumps(ENGINE))
leg_ok = leg and maxm and eng_max and int(leg.group(1)) <= int(maxm.group(1)) <= int(eng_max.group(1)) and "`IDA_V2_MAX_LEG`" in CONTRACT and "2,500 per leg" in CONTRACT
leg_text = "At most 2,500 can be completed in the background at once - please split the disassembly." in gate and leg and leg.group(1) == "2500"
leg_used = 'base.pickCount > IDA_V2_MAX_LEG' in gate and 'base.stockLines > IDA_V2_MAX_LEG' in gate and "IDA_V2_MAX_LEG" in json.dumps(BUILT["IDA_V2_SUBMIT"])
check("3.4 the per-leg sizes line up: SUBMIT's IDA_V2_MAX_LEG %s (picks and STOCK lines; CONTRACT section 1) <= PREPARE's IDA_MAX_MOVES %s <= the engine's MAX_MOVEMENTS %s; the worker "
      "runs PREPARE alone above %s moves and COMMIT PARKs above %s per leg" % (leg and leg.group(1), maxm and maxm.group(1), eng_max and eng_max.group(1), alone and alone.group(1),
                                                                         park and park.group(1)),
      bool(leg_ok) and bool(leg_text) and bool(leg_used) and bool(alone) and bool(park), "leg %s / text %s / used %s" % (bool(leg_ok), bool(leg_text), bool(leg_used)),
      [cite("code/submit/gate.js", r"const IDA_V2_MAX_LEG"), cite("code/submit/gate.js", r"base\.stockLines > IDA_V2_MAX_LEG"), cite("code/shared/ida_common.js", r"const IDA_MAX_MOVES"),
       cite("build_worker.py", r"const IDA_PREPARE_ALONE_MOVES"), cite("CONTRACT.md", r"IDA_V2_MAX_LEG")])

# ================================================================================================ 4 ENGINE_I / ENGINE_R / alloc
ei_c = contract_json("### ENGINE_I = the exact INVENTORY_BULK_APPLY request of op 1")
er_c = contract_json("### ENGINE_R = the receipt request template of op 2")
mi_w = literal_keys(plan, r"const mv = \{(?= movement_key: mk, direction: \"SUBTRACT\")")
mr_w = literal_keys(plan, r"const mv = \{(?= movement_key: mk, direction: \"ADD\")")
al_w = literal_keys(plan, r"alloc\.push\(\{")
check("4.1 the op-1 movement keys = CONTRACT ENGINE_I's (%d), in order" % len(ei_c["movements"][0]), mi_w == list(ei_c["movements"][0].keys()),
      "%s vs %s" % (mi_w, list(ei_c["movements"][0].keys())), [cite("code/prepare/plan.js", r'direction: "SUBTRACT"'), cite("CONTRACT.md", r"^### ENGINE_I")])
check("4.2 the op-2 movement keys = CONTRACT ENGINE_R's (%d), in order; alloc keys = CONTRACT's (%s)" % (len(er_c["movements"][0]), ", ".join(er_c["alloc"][0].keys())),
      mr_w == list(er_c["movements"][0].keys()) and al_w == list(er_c["alloc"][0].keys()), "movement %s vs %s / alloc %s vs %s" % (mr_w, list(er_c["movements"][0].keys()), al_w,
      list(er_c["alloc"][0].keys())), [cite("code/prepare/plan.js", r'direction: "ADD"'), cite("code/prepare/plan.js", r"alloc\.push\(\{"), cite("CONTRACT.md", r"^### ENGINE_R")])
alloc_r = sorted(set(re.findall(r"\ba\.(\w+)", text("code/commit/d3_plan.js")) + re.findall(r"\b(?:share_qty|base_qty)\b", text("code/shared/price.js"))))
check("4.3 COMMIT D3 reads alloc.%s (+ price.js idaAllocate share_qty / base_qty): all written" % ", ".join(alloc_r), set(alloc_r) <= set(al_w),
      "read not written %s" % sorted(set(alloc_r) - set(al_w)), [cite("code/commit/d3_plan.js", r"a\.batch_key"), cite("code/shared/price.js", r"share_qty")])
d3 = text("code/commit/d3_plan.js")
d1x = text("code/commit/d1_check.js") + text("code/commit/d1_decide.js") + text("code/commit/_d1.js") + text("code/commit/d1.js")
d3_only = "Object.assign({}, m, { unit_price: prices[allocAt[s(m.movement_key)]].unit_price })" in d3 and "o.batch_id = byKey[s(a.batch_key)]" in d3
rp = "Object.assign({}, m, { unit_price: 0 })" in d1x and "out.batch_id = om.byKey[keyOf[k]] || null" in d1x
check("4.4 COMMIT changes only unit_price and batch_id of PREPARE's R movements: D3 (idaAllocate + oursByKey) and D1's re-PLAN (batch ids, unit_price 0); never sends alloc",
      bool(d3_only) and bool(rp), "d3 %s / d1 re-PLAN %s" % (bool(d3_only), bool(rp)),
      [cite("code/commit/d3_plan.js", r"Object\.assign\(\{\}, m, \{ unit_price"), cite("code/commit/d3_plan.js", r"o\.batch_id = byKey"),
       (cite("code/commit/d1_check.js", r"unit_price: 0") if "unit_price: 0" in text("code/commit/d1_check.js") else cite("code/commit/d1_decide.js", r"unit_price: 0"))])

# ================================================================================================ 5 BATCH
bt_c = contract_json("### Batch kinds and the BATCH part")
row_c = list(bt_c["rows"][0].keys())
typed_w = literal_keys(plan, r"row = Object\.assign\(\{ key:") + ["material_id", "plant_id", "organization_id", "initial_quantity", "transaction_no", "remark", "remark2", "remark3",
                                                                    "manufacturing_date", "expired_date", "request"]
common_w = literal_keys(plan, r"const common = \{")
tail_w = literal_keys(plan, r"const tail = \{")
auto_w = literal_keys(plan, r"const row = Object\.assign\(\{(?= key: \"B\" \+ \(rows\.length \+ 1\), kind: \"AUTO\")")
typed_head = literal_keys(plan, r"row = Object\.assign\(\{(?= key: \"B\" \+ \(rows\.length \+ 1\), kind: \"TYPED\")")
row_w = auto_w + [k for k in common_w + ["initial_quantity"] + tail_w + ["request"] if k not in auto_w]
row_t = typed_head + [k for k in common_w + ["initial_quantity"] + tail_w + ["request"] if k not in typed_head]
check("5.1 a BATCH row = CONTRACT section 5's keys (%d): PREPARE's AUTO / TYPED rows (key, kind, insert, batch_number, line_ids + common + initial_quantity + tail + request)" % len(row_c),
      sorted(row_w) == sorted(row_c) and sorted(row_t) == sorted(row_c), "AUTO %s / TYPED %s / contract %s" % (sorted(row_w), sorted(row_t), sorted(row_c)),
      [cite("code/prepare/plan.js", r'kind: "TYPED", insert: true'), cite("code/prepare/plan.js", r'kind: "AUTO", insert: stock'), cite("CONTRACT.md", r"^### Batch kinds")])
b_reads = set()
for f in ("code/commit/_d1.js", "code/commit/d1_plan.js", "code/commit/d1_decide.js", "code/commit/d1_check.js", "code/commit/d1.js", "code/commit/d4.js", "code/commit/ours_end.js",
          "code/commit/_common.js", "code/commit/d3_plan.js"):
    b_reads |= set(re.findall(r"\br\.(\w+)", text(f)))
b_reads &= set(row_c) | {"rows", "items", "mode", "id", "item_category", "item_group_id", "numbers", "configs"}
check("5.2 COMMIT reads BATCH rows' %s: all written by PREPARE" % ", ".join(sorted(b_reads & set(row_c))), (b_reads & set(row_c)) <= set(row_w), "read not written %s" % sorted((b_reads & set(row_c)) - set(row_w)),
      [cite("code/commit/_d1.js", r"s\(r\.kind\) === \"TYPED\" && s\(r\.batch_number\)"), cite("code/commit/_d1.js", r"r\.line_ids")])
items_w = re.search(r"autoItems\.push\(\{ id: [^,]+, item_category: [^,]+, item_group_id:", plan)
check("5.3 BATCH.items = { id, item_category, item_group_id } of the AUTO items (bnNumber's itemRows), read by D1 as idaBatchnum's itemRows",
      bool(items_w) and "idaBatchnum(bncRows, part.items || []" in text("code/commit/d1_plan.js"), "items",
      [cite("code/prepare/plan.js", r"autoItems\.push\(\{ id"), cite("code/commit/d1_plan.js", r"idaBatchnum\(bncRows, part\.items")])
cols_c = re.findall(r"`BATCH_COLS` = ([a-z_,\s0-9]+?)\)", CONTRACT)
cols_c = [x.strip() for x in cols_c[0].replace("\n", " ").split(",")] if cols_c else []
ins_w = literal_keys(text("code/commit/_d1.js"), r"return \{(?= batch_number: plannedNumber)")
add_node = None
for n in walk(BUILT["IDA_V2_COMMIT"]["nodes"]):
    if n["type"] == "add-node" and n["data"]["table_id"]["source"].startswith("Batch:Table:"):
        add_node = [p["prop"] for p in n["data"]["props"]["list"]]
check("5.4 the Batch insert: COMMIT's batchRowOf %s = the add-node's props = CONTRACT BATCH_COLS (ADD_INVENTORY v65 add_node_F9KqZLfd's 11)" % ins_w,
      sorted(ins_w) == sorted(cols_c) == sorted(add_node or []), "batchRowOf %s / add-node %s / contract %s" % (ins_w, add_node, cols_c),
      [cite("code/commit/_d1.js", r"const batchRowOf"), cite("CONTRACT.md", r"`BATCH_COLS` = ")])

# ================================================================================================ 6 LABELS / ITEMS
lab_c = set(k for k in re.findall(r'"(\w+)"', re.search(r'LABELS = `?\{ "M1": \{ ([^}]*)\}', CONTRACT).group(1)) if not re.match(r"^\d+$|^out$|^in$", k))
lab_w = set(literal_keys(plan, r"labels\[mk\] = \{(?= pick: String\(k \+ 1\))")) | set(literal_keys(plan, r"labels\[mk\] = \{(?= pick: \"\")"))
lab_r = set(re.findall(r"\b(?:lab|l|label)\.(\w+)", text("code/shared/movekey.js") + text("code/commit/d1_word.js")))
check("6.1 LABELS M<n> / R<k> entries: PREPARE writes %s = CONTRACT; movekey.js / D1's word read %s" % (sorted(lab_w), sorted(lab_r & lab_c)), lab_w == lab_c and (lab_r & lab_c) <= lab_w,
      "written %s / contract %s / read %s" % (sorted(lab_w), sorted(lab_c), sorted(lab_r)), [cite("code/prepare/plan.js", r"labels\[mk\] = \{ pick: \"\""), cite("code/shared/movekey.js", r"bin")])
check("6.2 ITEMS = { itemDates: [{ id }] } (PREPARE, source first) read by D4 for the Item stamps", "ITEMS: { itemDates: itemDates }" in plan and "itemDates" in text("code/commit/d4.js"),
      "ITEMS", [cite("code/prepare/plan.js", r"ITEMS: \{ itemDates"), cite("code/commit/d4.js", r"itemDates")])

# ================================================================================================ 7 job states
def states_written(dirname):
    out = set()
    for f in sorted(os.listdir(os.path.join(IDAV2, dirname))):
        if f.endswith(".js"):
            out |= set(re.findall(r'job_status: "([A-Z_]+)"', text(os.path.join(dirname, f))))
    return out


w_sub = set(re.findall(r'job_status: "([A-Z_]+)"', post))
w_prep = states_written("code/prepare")
w_com = states_written("code/commit")
w_wrk = states_written("code/worker")
wk = text("code/worker/_common.js")
wk_states = re.search(r"states: \[([^\]]*)\]", wk)
wk_states = wk_states.group(1).replace('"', "").replace(" ", "").split(",") if wk_states else re.findall(r"'([A-Z_]+)'", re.search(r"j\.job_status IN \(([^)]*)\)", json.dumps(BUILT["IDA_V2_WORKER"])).group(1))
open_s = re.search(r"IDA_OPEN_JOB = \[([^\]]*)\]", text("code/shared/ida_common.js")).group(1).replace('"', "").replace(" ", "").split(",")
prep_accepts = "VALIDATING" in text("code/prepare/entry.js")
com_accepts = re.search(r'\["READY_TO_COMMIT", "COMMITTING_IDA"\]\.indexOf', entry_c)
check("7.1 states written - SUBMIT %s, WORKER %s, PREPARE %s, COMMIT %s - are CONTRACT section 1's; PREPARE takes VALIDATING, COMMIT READY_TO_COMMIT / COMMITTING_IDA, the worker polls %s"
      % (sorted(w_sub), sorted(w_wrk), sorted(w_prep), sorted(w_com), wk_states),
      w_sub == {"QUEUED"} and w_prep <= {"READY_TO_COMMIT", "FAILED", "REQUIRES_REVIEW", "VALIDATING"} and w_com <= {"COMMITTING_IDA", "COMPLETED", "FAILED", "REQUIRES_REVIEW", "READY_TO_COMMIT"}
      and prep_accepts and bool(com_accepts) and set(wk_states) == {"QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"}, "states",
      [cite("code/submit/post.js", r'job_status: "QUEUED"'), cite("code/commit/entry.js", r'"READY_TO_COMMIT", "COMMITTING_IDA"\]\.indexOf'), cite("code/prepare/entry.js", r"VALIDATING")])
check("7.2 SUBMIT's BUSY set IDA_OPEN_JOB %s = the worker's 4 running states + REQUIRES_REVIEW (the review blocks a new key); FACTS' SQL uses the same list" % open_s,
      set(open_s) == set(wk_states) | {"REQUIRES_REVIEW"} and "'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_IDA', 'REQUIRES_REVIEW'" in json.dumps(BUILT["IDA_V2_SUBMIT"]),
      "open %s" % open_s, [cite("code/shared/ida_common.js", r"IDA_OPEN_JOB = "), cite(os.path.join(IDAV2, "code/shared/sql.py"), r"REQUIRES_REVIEW")])
split_ok = 'lease_owner: "SPLIT|"' in text("code/commit/d2.js") or "SPLIT|" in text("code/commit/d2.js")
check("7.3 the D2 hand-over: COMMIT writes lease_owner SPLIT|<nonce> (<= 1,000 per leg) else PARK (due now, no lease); the worker re-calls COMMIT on SPLIT in the same tick",
      split_ok and "SPLIT|" in text("code/worker/split.js") and "SPLIT|" in entry_c, "split",
      [cite("code/commit/d2.js", r"SPLIT\|"), cite("code/worker/split.js", r"SPLIT\|"), cite("code/commit/entry.js", r"SPLIT\|")])

# ================================================================================================ 8 error codes
s10 = CONTRACT[CONTRACT.index("## 10. Error codes"):CONTRACT.index("## 11. The classic")]
NONCODE = {"IDA_TEXT", "IDA_PREV_STATUSES", "IDA_OPEN_JOB", "IDA_KEY_RE", "IDA_V2_SUBMIT", "IDA_V2_WORKER", "IDA_V2_PREPARE", "IDA_V2_COMMIT", "IDA_SAVE", "IDA_PARK",
           "IDA_MAX_MOVES", "IDA_CLASSIC_MAX_MOVES", "IDA_V2_MIN_MOVES", "IDA_LOCK_WAIT_TRIES", "IDA_RECEIPT_WAIT_S", "IDA_RECEIPT_RETRY_S", "IDA_OK_CATEGORIES", "IDA_RUNNING_JOB",
           "IDA_TERMINAL_JOB", "IDA_FINAL", "IDA_CHUNK", "IDA_AUTO_RULE", "IDA_BATCH_PLACEHOLDER", "IDA_PLAN_PARTS", "IDA_PARTS", "IDA_PREPARE_ALONE_MOVES"}
codes_c = set(re.findall(r"\b(IDA_[A-Z][A-Z0-9_]*[A-Z0-9]|JOB_[A-Z_]+[A-Z])\b", s10)) - NONCODE
bad = {}
for wf, d in BUILT.items():
    used = set()
    for n in walk(d["nodes"]):
        if n["type"] == "code-node":
            used |= set(re.findall(r'["\'](IDA_[A-Z][A-Z0-9_]*|JOB_[A-Z_]+)["\']', n["data"]["script"]["code"]))
    extra = sorted(x for x in used - NONCODE - codes_c if x != "IDA_INVENTORY_")
    if extra:
        bad[wf] = extra
check("8.1 every error code the five built workflows name is in CONTRACT section 10 (%d codes; IDA_INVENTORY_<engine code> the family)" % len(codes_c), not bad, str(bad),
      [cite("CONTRACT.md", r"^## 10\. Error codes")])
s8 = CONTRACT[CONTRACT.index("## 8. IDA_V2_WORKER"):CONTRACT.index("## 9. IDA_V2_PREPARE")]
h8 = sorted(set(re.findall(r"IDA_[A-Z_]+|JOB_ILLEGAL_TRANSITION", s8[s8.index("**Hard codes**"):s8.index("**Tick rule**")])))
w8 = re.search(r"hard: \[([^\]]*)\]", wk)
w8 = sorted(w8.group(1).replace('"', "").replace(" ", "").replace("\n", "").split(",")) if w8 else []
check("8.2 the worker's hard codes = CONTRACT section 8 (%d)" % len(h8), w8 == h8, "%s vs %s" % (w8, h8), [cite("code/worker/_common.js", r"hard: \["), cite("CONTRACT.md", r"\*\*Hard codes\*\*")])
fail_codes = set(re.findall(r'"(IDA_[A-Z_]+)"', text("code/prepare/plan.js") + text("code/prepare/ready.js") + text("code/prepare/entry.js")))
unhandled = sorted(c for c in fail_codes if c not in h8 and c not in ("IDA_PLAN_FAILED", "IDA_INVALID", "IDA_PREV_STATUS_UNKNOWN", "IDA_INVALID_DATA", "IDA_INVENTORY_"))
check("8.3 PREPARE's FAILED codes are final at PREPARE itself (it writes FAILED + unlock); the worker's hard list adds IDA_PLAN_FAILED as a retryable one only: PREPARE codes outside the hard list: %s" % unhandled,
      set(unhandled) <= {"IDA_INVALID"}, "codes %s" % unhandled, [cite("code/prepare/plan.js", r'fail\("IDA_INVALID'), cite("code/worker/_common.js", r"hard: \[")])

# ================================================================================================ 9 worker <-> PREPARE / COMMIT, IDA_LOCK_JOIN
calls = {}
for n in walk(BUILT["IDA_V2_WORKER"]["nodes"]):
    if n["type"] == "workflow-node":
        calls.setdefault(n["data"]["workflow"]["source"], sorted(b["prop"] for b in n["data"]["body_params"]["list"]))
answers = set(resp_names(BUILT["IDA_V2_PREPARE"])) | set(resp_names(BUILT["IDA_V2_COMMIT"]))
body = re.sub(r"\(r\) => [^)]*\)", "", text("code/worker/after_publish.js") + text("code/worker/after_prepare.js"))
wreads = set(re.findall(r"\br\.(\w+)", body))
ok_ids = calls.get("IDA_V2_PREPARE:Workflow:" + IDS["IDA_V2_PREPARE"]) == req_names(BUILT["IDA_V2_PREPARE"]) and calls.get("IDA_V2_COMMIT:Workflow:" + IDS["IDA_V2_COMMIT"]) == req_names(BUILT["IDA_V2_COMMIT"])
check("9.1 the worker calls PREPARE %s / COMMIT %s by their ids.json ids with %s (= their request_json); reads %s of their answers (declared)"
      % (IDS["IDA_V2_PREPARE"], IDS["IDA_V2_COMMIT"], req_names(BUILT["IDA_V2_PREPARE"]), sorted(wreads)), ok_ids and wreads <= answers,
      "calls %s / undeclared %s" % (calls, sorted(wreads - answers)), [cite("code/worker/after_prepare.js", r"r\.result_code|s\(r\.result_code\)"), cite("ids.json", r"IDA_V2_PREPARE")])
ns = {}
exec(re.search(r'(IDA_LOCK_JOIN = """.*?""")', CONTRACT, re.S).group(1), ns)
bw = text("build_worker.py")
bw_join = re.search(r'IDA_LOCK_JOIN = """(.*?)"""', bw, re.S)
joined = [(n["id"], ns["IDA_LOCK_JOIN"].replace("\\\\", "\\") in n["data"]["script"]["code"] or ns["IDA_LOCK_JOIN"] in n["data"]["script"]["code"])
          for n in walk(BUILT["IDA_V2_WORKER"]["nodes"]) if n["type"] == "sql-node" and "LEFT JOIN sm_item_disassembly g" in n["data"]["script"]["code"]]
check("9.2 IDA_LOCK_JOIN (g.is_deleted = 0, IDC| lock, offset 5): build_worker.py == CONTRACT section 8; all %d lock-joined worker reads carry it" % len(joined),
      bool(bw_join) and ns["IDA_LOCK_JOIN"] == bw_join.group(1).replace("\\\\", "\\") and all(x for _, x in joined) and len(joined) >= 7,
      "joined %s" % joined, [cite("build_worker.py", r'^IDA_LOCK_JOIN = """'), cite("CONTRACT.md", r'^IDA_LOCK_JOIN = """')])
id_col = re.search(r'^IDA_ID_COL = "(.*)"$', bw, re.M)
check("9.3 the worker's ida_id column = CONTRACT's IDA_ID_COL (Processing AND the latest lock = the job's key) and its prev_status = $.prevStatus",
      bool(id_col) and "lk.result_ref = j.idempotency_key" in id_col.group(1) and "'$.prevStatus'" in bw, "id col",
      [cite("build_worker.py", r"^IDA_ID_COL"), cite("build_worker.py", r"^IDA_PREV_COL")])

# ================================================================================================ 10 engine calls
eng_req = req_names(ENGINE)
eng_calls = []
for wf in ("IDA_V2_PREPARE", "IDA_V2_COMMIT"):
    for n in walk(BUILT[wf]["nodes"]):
        if n["type"] == "workflow-node":
            p = {b["prop"]: b["value"] for b in n["data"]["body_params"]["list"]}
            eng_calls.append((wf, n["id"], n["data"]["workflow"]["source"], sorted(p), p.get("mode")))
want_modes = {"workflow_node_DPplanI": "PLAN", "workflow_node_DPplanR": "PLAN", "workflow_node_DCd1plan": "PLAN", "workflow_node_DCd2": "APPLY", "workflow_node_DCd3": "APPLY"}
ok_eng = all(src == "INVENTORY_BULK_APPLY:Workflow:" + IDS["INVENTORY_BULK_APPLY"] and keys == sorted(eng_req) and want_modes.get(nid) == mode for _, nid, src, keys, mode in eng_calls)
check("10.1 the five engine calls (PREPARE PLAN I / R, COMMIT D1 re-PLAN R, D2 APPLY I, D3 APPLY R) pass exactly the engine v10 request %s with literal modes, to id %s"
      % (eng_req, IDS["INVENTORY_BULK_APPLY"]), ok_eng and len(eng_calls) == 5, str(eng_calls), [cite("build_prepare.py", r"PLAN"), cite("build_commit.py", r"APPLY")])
opkey = re.search(r"const idaOpKey = [^\n]*", text("code/shared/ida_common.js"))
guard_op = re.search(r"\^\[A-Za-z0-9\|:\._-\]\{1,32\}\$", json.dumps(ENGINE))
check("10.2 op keys IDC|<19-digit job>|I / R (25 chars) from the one shared idaOpKey (PREPARE's opKeyI / opKeyR, COMMIT D2 / D3 / OUT_TOTALS LIKE 'IDC|<job>|I|%') fit the engine's <= 32 rule",
      bool(opkey) and "idaOpKey(jobId, \"I\")" in plan and len("IDC|2113000000000000004|I") <= 32 and bool(guard_op), "op key",
      [cite("code/shared/ida_common.js", r"const idaOpKey"), cite("code/prepare/plan.js", r'idaOpKey\(jobId, "R"\)'), cite(os.path.join(IDAV2, "code/shared/sql.py"), r"IDC\|@JOB\|I\|%")])

# ================================================================================================ 11 lock / correlation / ownership
lock_job = re.search(r'const idaLockJob = [^\n]*"IDC\|"', text("code/shared/ida_common.js"))
corr = re.search(r'const idaCorrelation = [^\n]*"IDA\|"', text("code/shared/ida_common.js"))
sql_text = json.dumps(BUILT, ensure_ascii=False)
check("11.1 one lock / correlation naming: idaLockJob IDC|<idaId> (SUBMIT's LOCK|n rows), idaCorrelation IDA|<idaId>; every built read joins IDC| + SUBSTRING(correlation, 5) / 'IDC|<id>'",
      bool(lock_job) and bool(corr) and sql_text.count("CONCAT('IDC|', SUBSTRING(j.correlation_id, 5))") >= 8 and "SUBSTRING(j.correlation_id, 5)" in sql_text, "lock naming",
      [cite("code/shared/ida_common.js", r"const idaLockJob"), cite("code/shared/ida_common.js", r"const idaCorrelation"), cite("code/submit/post.js", r'step_name: "LOCK\|"')])
check("11.2 ownership: Processing + ida_v2_job_id + the latest LOCK result_ref = the job's key - SUBMIT writes all three (update / add props + LOCK row result_ref = guard.key), the worker / PREPARE / COMMIT read all three",
      "ida_v2_job_id" in json.dumps([p["prop"] for n in walk(BUILT["IDA_V2_SUBMIT"]["nodes"]) if n["type"] == "add-node" for p in n["data"]["props"]["list"]]) and "result_ref: guard.key" in post
      and "lock_ref" in text("code/commit/own.js") + text("code/commit/entry.js") + text("code/commit/_common.js"), "ownership",
      [cite("code/submit/post.js", r"result_ref: guard\.key"), cite(os.path.join(IDAV2, "code/shared/sql.py"), r"^OWNER")])

# ================================================================================================ 12 the classic v7 and SUBMIT texts
sys.path.insert(0, os.path.join(IDAV2, "code", "shared"))
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("ida_sql", os.path.join(IDAV2, "code", "shared", "sql.py"))
SQ = importlib.util.module_from_spec(spec)
spec.loader.exec_module(SQ)
guard_sql = code_of(BUILT["IDA_SAVE"], "sql_node_IDAguard")
cg = SQ.CLASSIC_GUARD if hasattr(SQ, "CLASSIC_GUARD") else ""
norm = lambda t: re.sub(r"\{\{[^}]+\}\}|@[A-Z]+|'@T'|'[0-9]+'", "X", " ".join(t.split()))
check("12.1 the v7 guard's SQL = the shared CLASSIC_GUARD (stored status only, no V2 table)", bool(cg) and norm(cg).replace("'X'", "X") == norm(guard_sql).replace("'X'", "X")
      and "gd_async_job" not in guard_sql, "v7 %s / shared %s" % (" ".join(guard_sql.split())[:200], " ".join(cg.split())[:200]),
      [cite(os.path.join(IDAV2, "code/shared/sql.py"), r"^CLASSIC_GUARD"), cite("classic/patch_v7.py", r"CLASSIC_GUARD")])
v7js = json.dumps(BUILT["IDA_SAVE"], ensure_ascii=False)
check("12.2 the v7 guard answers with the shared IDA_TEXT (busy / classicFinal / classicTooBig inlined from ida_common.js) and is not the 401 path",
      "This Item Disassembly is being processed in the background" in v7js and "classicFinal" in v7js and "classicTooBig" in v7js, "texts",
      [cite("classic/guard_stored.js", r"IDA_TEXT\.busy"), cite("classic/guard_in.js", r"classicTooBig")])
sub_js = json.dumps(BUILT["IDA_V2_SUBMIT"], ensure_ascii=False)
check("12.3 SUBMIT and PREPARE word a held typed number with the same IDA_TEXT pair (typedExists at the click, typedTaken after it) and code_validate's label (idaLineLabel)",
      "typedExists(" in sub_js and "typedTaken(idaLineLabel(" in json.dumps(BUILT["IDA_V2_PREPARE"]) and "idaLineLabel" in sub_js, "typed texts",
      [cite("code/submit/gate.js", r"typedExists"), cite("code/prepare/plan.js", r"typedTaken\(idaLineLabel")])

bad_n = sum(1 for r in results if not r["ok"])
print("%d interface checks, %d failed" % (len(results), bad_n))
if "--json" in sys.argv:
    json.dump(results, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
sys.exit(1 if bad_n else 0)
