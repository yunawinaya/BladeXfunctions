"""Read-only live check of code/shared/sql.py on DEV (.dbtools/db refuses anything but a read).

1. Every statement goes through lib/sqlcheck.py exactly as a built workflow's sql-node would: one FlowGram doc of sql-nodes whose
   placeholders {{node:code_node_DTshared.data.<name>}} sqlcheck fills, with missing_cols for the columns the form publish creates
   (CONTRACT.md section 13), and the returned columns checked against each node's response_json.
2. Must-match checks on dev IDA-2610-003 (2110985744909729793, tenant 000000, Completed by the classic on 10-16: 4 lines, 1 pick,
   typed Batch-00623 (auto, generated) / Batch-0003, blank Batch rows for its 2 non-batch lines): every read finds what it must,
   incl. BATCH_HOLDERS by hex (case-insensitive, trailing spaces ignored) and both JSON_TABLE reads.

python3 scratchpad/idav2/test/shared/sql_live.py [--keep <dir>]"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(IDAV2, "lib"))
import v2build as V  # noqa: E402
import wfkit as K  # noqa: E402
import sqlcheck  # noqa: E402
from dbq import q  # noqa: E402

spec = importlib.util.spec_from_file_location("ida_shared_sql", os.path.join(IDAV2, "code", "shared", "sql.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

MISSING = {"h.ida_v2_job_id": "NULL", "g.ida_v2_job_id": "NULL", "h.ida_idem_key": "NULL"}
T, IDA, ORG = "000000", "2110985744909729793", "1123598813738675201"
TYPED = ["2110985746692308994", "2110985747078184962"]          # Batch-00623 (ITEM-0037), Batch-0003 (ITEM-0038), transaction_no IDA-2610-003
PICK_BIN, LINE_BIN2 = "2018912822846582786", "2018912972444823554"
P = lambda name: "{{node:code_node_DTshared.data.%s}}" % name    # noqa: E731
TOK = dict(T=P("tenantId"), IDA=P("idaId"), JOB=P("jobId"), ORG=P("organizationId"), ITEMS=P("itemIdsSql"), HEX=P("hexJson"), KEY=P("key"))
JS_HELPERS = os.path.join(IDAV2, "code", "shared")
problems = []


def hexjson(numbers):
    r = subprocess.run(["node", "-e", "const C=require(process.argv[1]);process.stdout.write(C.idaHexJson(JSON.parse(process.argv[2])))",
                        os.path.join(JS_HELPERS, "ida_common.js"), json.dumps(numbers)], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def fingerprint(lines, header):
    r = subprocess.run(["node", "-e", "const F=require(process.argv[1]);const a=JSON.parse(process.argv[2]);process.stdout.write(F.idaLineFingerprint(a[0],a[1]))",
                        os.path.join(JS_HELPERS, "fingerprint.js"), json.dumps([lines, header])], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


# ------------------------------------------------------------------------------------------------ 1. sqlcheck over every statement
nodes = []
for name, (text, tokens, cols) in S.STATEMENTS.items():
    nodes.append(K.sql("sql_node_DT" + name.replace("_", "").lower(), name, V.sub(text, **{k: TOK[k] for k in tokens}), cols))
nodes.append(K.sql("sql_node_DTfacts", "FACTS", S.facts(V.sub, T=TOK["T"], IDA=TOK["IDA"], KEY=TOK["KEY"], ORG=TOK["ORG"]), S.FACTS_COLS))
for side in ("I", "R"):
    nodes.append(K.sql("sql_node_DTopstate" + side.lower(), "OP_STATE " + side, S.op_state(V.sub, T=TOK["T"], JOB=TOK["JOB"], SIDE=side), S.OP_STATE_COLS))
keep = sys.argv[sys.argv.index("--keep") + 1] if "--keep" in sys.argv else None
work = keep or tempfile.mkdtemp(prefix="idav2_sql_")
os.makedirs(work, exist_ok=True)
with open(os.path.join(work, "IDA_SHARED_SQL.json"), "w", encoding="utf-8") as f:
    json.dump({"nodes": nodes}, f, ensure_ascii=False, indent=1)
values = {"*": {"tenantId": T, "idaId": IDA, "jobId": IDA, "organizationId": ORG, "hexJson": hexjson(["batch-00623", "Batch-0003  "]),
                "itemIdsSql": "0,2070758892513914881,2107721324476432385,2107721546371891202,2107721718380298242,2107724107950784513",
                "key": "IDA:%s:%s:0000000000000000:1" % (ORG, IDA)}, "missing_cols": MISSING}
print("== lib/sqlcheck.py over %d statements (%s)" % (len(nodes), work))
if sqlcheck.run(work, values):
    problems.append("sqlcheck reported problems")


# ------------------------------------------------------------------------------------------------ 2. must-match checks
def run(label, text, tokens_vals):
    sql = sqlcheck.fill(V.sub(text, **tokens_vals), {}, MISSING)
    rows = q("--dev", sql)
    return rows


def expect(label, ok, detail=""):
    print("%s %s%s" % ("ok  " if ok else "FAIL", label, (" - " + detail) if detail else ""))
    if not ok:
        problems.append(label + (" - " + detail if detail else ""))


print("== must-match on IDA-2610-003 (%s)" % IDA)
base = dict(T=T, IDA=IDA)
lines = run("FP_LINES", S.FP_LINES, base)
expect("FP_LINES: 4 live lines", len(lines) == 4, "%d rows" % len(lines))
header = run("FP_HEADER", S.FP_HEADER, base)
h = json.loads(header[0]["j"]) if header else {}
expect("FP_HEADER: the header, number IDA-2610-003, Completed", h.get("stock_movement_no") == "IDA-2610-003" and h.get("item_disassembly_status") == "Completed")
fp1 = fingerprint([json.loads(r["j"]) for r in lines], [h])
fp2 = fingerprint([{"j": r["j"]} for r in reversed(lines)], [{"j": header[0]["j"]}])
expect("DF1 over the stored rows, any row order / form", fp1 == fp2 and fp1.startswith("DF1:4:"), fp1)
owner = run("OWNER", S.OWNER, base)
expect("OWNER: one row of this IDA", len(owner) == 1 and owner[0]["ida_id"] == IDA and owner[0]["item_disassembly_status"] == "Completed")
facts = q("--dev", sqlcheck.fill(S.facts(V.sub, T=T, IDA=IDA, KEY="IDA:x:y:0000000000000000:1", ORG=ORG), {}, MISSING))
expect("FACTS (stored): this IDA, no job", facts and facts[0]["ida_id"] == IDA and facts[0]["stock_movement_no"] == "IDA-2610-003" and facts[0]["issued_by_job"] == 0)
facts0 = q("--dev", sqlcheck.fill(S.facts(V.sub, T=T, IDA="0", KEY="IDA:x:y:0000000000000000:1", ORG=ORG), {}, MISSING))
expect("FACTS (add): no stored IDA for id 0", facts0 and facts0[0]["ida_id"] is None and facts0[0]["db_now"])
ids = sorted({h.get("item_id")} | {json.loads(r["j"])["item_selection"] for r in lines})
items = run("ITEMS", S.ITEMS, dict(T=T, ITEMS=",".join(ids)))
stored = run("ITEMS_STORED", S.ITEMS_STORED, base)
got_items = sorted(json.loads(r["j"])["id"] for r in items)
expect("ITEMS: the header item + 4 recovery items", got_items == ids, ",".join(got_items))
expect("ITEMS_STORED = ITEMS (subquery over the stored rows)", sorted(json.loads(r["j"])["id"] for r in stored) == got_items)
conv = [json.loads(r["j"])["table_uom_conversion"] for r in items]
expect("ITEMS: conversions as an array of {alt_uom_id text, base_qty}", all(isinstance(c, list) for c in conv)
       and all(isinstance(x["alt_uom_id"], str) for c in conv for x in c))
bins = sorted(json.loads(r["j"])["id"] for r in run("BINS_STORED", S.BINS_STORED, base))
expect("BINS_STORED: the pick bin and both line bins", bins == sorted({PICK_BIN, LINE_BIN2}), ",".join(bins))
pick_branch = q("--dev", sqlcheck.fill(V.sub("""SELECT CAST(t.loc AS UNSIGNED) AS loc
  FROM sm_item_disassembly h
  JOIN JSON_TABLE(IF(JSON_VALID(h.temp_qty_data), h.temp_qty_data, '[]'), '$[*]' COLUMNS (loc VARCHAR(32) PATH '$.location_id')) t
 WHERE h.tenant_id = '@T' AND h.id = @IDA AND h.is_deleted = 0 AND t.loc REGEXP '^[0-9]{1,20}$'""", **base), {}, {}))
expect("BINS_STORED's JSON_TABLE branch alone matches the pick bin", [str(r["loc"]) for r in pick_branch] == [PICK_BIN])
# in situ: the line branch no longer returns the pick bin, so only a live JSON_TABLE branch can bring it back
LINE_WHERE = "WHERE l.tenant_id = '@T' AND l.sm_item_disassembly_id = @IDA AND l.is_deleted = 0\n                UNION"
expect("BINS_STORED in-situ variant built", S.BINS_STORED.count(LINE_WHERE) == 1)
in_situ = S.BINS_STORED.replace(LINE_WHERE, LINE_WHERE.replace("l.is_deleted = 0", "l.is_deleted = 0 AND l.location_id <> %s" % PICK_BIN))
bins2 = sorted(json.loads(r["j"])["id"] for r in run("BINS_STORED in situ", in_situ, base))
expect("BINS_STORED in situ: the pick bin still comes back through the JSON_TABLE branch", bins2 == sorted({PICK_BIN, LINE_BIN2}), ",".join(bins2))
bnc = run("BNC", S.BNC, dict(T=T, ORG=ORG))
expect("BNC: the organization's default config", any(json.loads(r["j"])["id"] == "2062365526375706626" for r in bnc), "%d rows" % len(bnc))
holders = run("BATCH_HOLDERS", S.BATCH_HOLDERS, dict(T=T, ORG=ORG, HEX=hexjson(["batch-00623", "Batch-0003  "])))
expect("BATCH_HOLDERS by hex: lower-case + trailing spaces still match (JSON_TABLE)", sorted(json.loads(r["j"])["id"] for r in holders) == TYPED)
expect("BATCH_HOLDERS: an empty list matches nothing", run("BATCH_HOLDERS []", S.BATCH_HOLDERS, dict(T=T, ORG=ORG, HEX=hexjson([]))) == [])
expect("BATCH_HOLDERS: blanks are never sent", hexjson(["", "  "]) == "[]")
expect("BATCH_HOLDERS: an unknown number matches nothing", run("BATCH_HOLDERS x", S.BATCH_HOLDERS, dict(T=T, ORG=ORG, HEX=hexjson(["IDA-V2-NO-SUCH-BATCH"]))) == [])
expect("BATCH_HOLDERS: another organization's rows are not read", run("BATCH_HOLDERS org", S.BATCH_HOLDERS, dict(T=T, ORG="1", HEX=hexjson(["Batch-00623"]))) == [])
typed = run("BATCH_TYPED_STORED", S.BATCH_TYPED_STORED, base)
expect("BATCH_TYPED_STORED: the IDA's typed numbers' rows", sorted(json.loads(r["j"])["id"] for r in typed) == TYPED)
# each branch alone (stored text = D1's form, trimmed = SUBMIT's form) must match too, so neither can be dead
raw_only = S.BATCH_TYPED_STORED.replace(S._TYPED_UNION + S._TYPED_TRIMMED, "")
trim_only = S.BATCH_TYPED_STORED.replace(S._TYPED_RAW + S._TYPED_UNION, "")
expect("BATCH_TYPED_STORED single-branch variants built", raw_only != S.BATCH_TYPED_STORED and trim_only != S.BATCH_TYPED_STORED and "UNION" not in raw_only + trim_only)
expect("BATCH_TYPED_STORED stored-text branch alone", sorted(json.loads(r["j"])["id"] for r in run("typed raw", raw_only, base)) == TYPED)
expect("BATCH_TYPED_STORED trimmed branch alone", sorted(json.loads(r["j"])["id"] for r in run("typed trimmed", trim_only, base)) == TYPED)
ours = run("BATCH_OURS", S.BATCH_OURS, dict(T=T, ORG=ORG, JOB=IDA, IDA=IDA))
expect("BATCH_OURS: the classic's 4 rows of this number above the id bound (2 blank)", len(ours) == 4 and sum(1 for r in ours if json.loads(r["j"])["batch_number"] == "") == 2)
expect("BATCH_OURS: none above a later bound", run("BATCH_OURS later", S.BATCH_OURS, dict(T=T, ORG=ORG, JOB="2110985747485032449", IDA=IDA)) == [])
expect("LINES_BATCH: 4 lines", len(run("LINES_BATCH", S.LINES_BATCH, base)) == 4)
out = run("OUT_TOTALS", S.OUT_TOTALS, dict(T=T, JOB=IDA, ORG=ORG, IDA=IDA))
expect("OUT_TOTALS: no engine rows for a classic IDA (total a decimal 0)", out and out[0]["n"] == 0 and float(out[0]["total"]) == 0, str(out and out[0]["total"]))
classic = run("OUT_TOTALS classic", S.OUT_TOTALS.replace("\n   AND m.operation_effect_key LIKE 'IDC|@JOB|I|%'", ""), dict(T=T, JOB=IDA, ORG=ORG, IDA=IDA))
expect("OUT_TOTALS without the op-key bound: the classic's OUT row (20.00000000)", classic and classic[0]["n"] == 1 and classic[0]["total"] == "20.00000000")
for side in ("I", "R"):
    st = q("--dev", S.op_state(V.sub, T=T, JOB="0", SIDE=side))
    expect("OP_STATE %s: nothing for job 0" % side, st and st[0]["intents"] == 0 and st[0]["review"] == 0 and st[0]["done_summary"] is None)
guard = run("CLASSIC_GUARD", S.CLASSIC_GUARD, base)
expect("CLASSIC_GUARD: the stored status", guard == [{"ida_id": IDA, "item_disassembly_status": "Completed"}])

for p in problems:
    print("PROBLEM " + p)
print("problems: %d" % len(problems))
sys.exit(1 if problems else 0)
