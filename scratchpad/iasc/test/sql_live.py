"""python3 scratchpad/iasc/test/sql_live.py - every Small Cycle SQL run READ-ONLY on dev (tenant 000000, a real SO line for a
BOM item) with the new IA columns replaced by stand-ins until the IA form publish creates them (--real once they exist).
Checks: the query runs, each row has a JSON column j, and the line / header / FG reads return the expected ids."""
import json, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "iav2", "lib"))
sys.path.insert(0, os.path.join(HERE, "..", "code", "shared"))
from dbq import q  # noqa: E402
from v2build import sub  # noqa: E402
import sql as S  # noqa: E402

REAL = "--real" in sys.argv
V = dict(T="000000", ORG="1123598813738675201", LINE="2112017989484847107", LINEQ="2112017989484847107", SO="2112017989476458498",
         ITEM="2098252135296131074", ITEMQ="2098252135296131074", IA="1")
# stand-ins are real columns of the same kinds (varchar ids / text / decimal), so types and collations are exercised
STAND_IN = {"h.planned_output_qty": "h.item_qty", "h.bom_consumption_mode": "h.page_status", "h.source_so_id": "h.item_id",
            "h.source_so_line_id": "h.item_id", "h.source_so_context_json": "h.remarks", "h.source_bom_id": "h.item_id", "h.bom_snapshot_json": "h.remarks_2"}


def run(name, text):
    t = sub(text, **{k: v for k, v in V.items() if "@" + k in text})
    if not REAL:
        for col, rep in STAND_IN.items():
            t = t.replace(col, rep)
    rows = q("--dev", t)
    js = [json.loads(r["j"]) if isinstance(r.get("j"), str) else r.get("j") for r in rows]
    assert all(isinstance(j, dict) for j in js), (name, rows[:2])
    print(f"ok   {name:12} rows={len(rows)}")
    return js


# varchar FK columns are compared as strings (a bigint = varchar join compares as DOUBLE and can match a neighbouring id)
for nm in ("P_LINE", "P_CAND"):
    assert "CAST(c.id AS CHAR) COLLATE utf8mb4_general_ci = s.customer_name" in getattr(S, nm) and "Customer c" not in getattr(S, nm), nm
line = run("P_LINE", S.P_LINE)
assert line[0]["line"]["id"] == V["LINE"] and line[0]["header"]["id"] == V["SO"], line
assert line[0]["line"]["item_name"] == V["ITEM"] and line[0]["header"]["customer_name"], line
gone = run("P_LINE gone", S.P_LINE.replace("@LINE", "1"))
assert gone[0]["line"] is None and gone[0]["header"]["id"] == V["SO"], gone
run("P_IAS", S.P_IAS)
fg = run("P_FG", S.P_FG)
assert fg[0]["id"] == V["ITEM"] and isinstance(fg[0]["table_uom_conversion"], list), fg
rel = run("P_RELINK", S.P_RELINK)
assert any(r["id"] == V["LINE"] for r in rel), rel
run("P_ORPHANS", S.P_ORPHANS)
rel0 = run("P_RELINK so 0", S.P_RELINK.replace("@SO", "0"))
assert [r["id"] for r in rel0] == [r["id"] for r in rel], "the line's own SO is used when so_id is not passed"
cand = run("P_CAND", S.P_CAND)
assert any(c["line"]["id"] == V["LINE"] for c in cand), [c["line"]["id"] for c in cand]
run("P_CAND_IAS", S.P_CAND_IAS)
run("R_IA", S.R_IA)
src = run("CLASSIC_SC_SOURCE", S.CLASSIC_SC_SOURCE)
assert src[0]["stored"] is None and src[0]["line"]["id"] == V["LINE"] and src[0]["header"]["id"] == V["SO"], src
none = run("CLASSIC_SC_SOURCE no link", S.CLASSIC_SC_SOURCE.replace("@LINE", "0"))
assert none[0]["line"] is None and none[0]["header"] is None, none
# IA_SAVE's stored-key read (a mobile save): a must-match case on a real line (no saved line has a key yet, so item_selection
# stands in for sc_ref_key), the parent filter (another IA: nothing) and the none case ("0")
KL = q("--dev", "SELECT CAST(id AS CHAR) id, CAST(sm_item_assembly_id AS CHAR) ia FROM sm_item_assembly_tlm8ve69_sub WHERE tenant_id = '000000' "
       "AND is_deleted = 0 AND item_selection <> '' ORDER BY id DESC LIMIT 1")[0]
KEYS = S.CLASSIC_SC_SOURCE_KEYS.replace("x.sc_ref_key <> ''", "x.item_selection <> ''").replace("'k', x.sc_ref_key", "'k', x.item_selection")
assert KEYS != S.CLASSIC_SC_SOURCE_KEYS


def keys(ia, ids):
    v = dict(V, IA=ia, IDS=ids)
    t = sub(KEYS, **{k: x for k, x in v.items() if "@" + k in KEYS})
    if not REAL:
        for col, rep in STAND_IN.items():
            t = t.replace(col, rep)
    return json.loads(q("--dev", t)[0]["j"])


hit = keys(KL["ia"], KL["id"])
assert hit["keys"] and [k["id"] for k in hit["keys"]] == [KL["id"]] and hit["keys"][0]["k"] and hit["stored"] is not None, hit["keys"]
print("ok   CLASSIC_SC_SOURCE_KEYS must-match: line %s of IA %s" % (KL["id"], KL["ia"]))
assert keys("1", KL["id"])["keys"] is None, "another IA's line must not match"
assert keys(KL["ia"], "0")["keys"] is None, "no ids: no keys"
print("ok   CLASSIC_SC_SOURCE_KEYS parent filter + none")
print("ok - Small Cycle SQL" + (" (real columns)" if REAL else " (stand-ins for the new IA columns)"))
