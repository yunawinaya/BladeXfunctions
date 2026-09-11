#!/usr/bin/env python3
"""Assert ItemSaveWorkflow's formatNumber map covers every decimal column.

The map in code_fillback is an ALLOW-LIST: a decimal column missing from it
reaches the DB as a raw float and the multipleOf check rejects the whole save.
Run after any Item column change:  python3 scratchpad/check_item_decimal_map.py [--prod]
"""
import json, re, subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = "--prod" if "--prod" in sys.argv else "--dev"

TABLE_OF = {
    "DEC_HEADER": "item",
    "DEC_UOM": "item_mji552rc_sub",
    "DEC_PACK": "item_vabbbwt2_sub",
    "DEC_SUP": "item_qd8nxw32_sub",
    "DEC_CUST": "item_i9q0d8uj_sub",
    "DEC_REORDER": "item_xerztv0n_sub",
}
SQL = ("SELECT table_name, column_name, numeric_scale FROM information_schema.columns "
       "WHERE table_schema=DATABASE() AND data_type IN ('decimal','double','float') "
       "AND table_name IN (%s)" % ",".join("'%s'" % t for t in TABLE_OF.values()))

db = json.loads(subprocess.run([os.path.join(ROOT, ".dbtools/db"), ENV, "--json", SQL],
                               capture_output=True, text=True).stdout)

wf = json.load(open(os.path.join(ROOT, "Item/ItemSaveWorkflow.json")))
script = [None]
def walk(bs):
    for n in bs:
        if n["id"] == "code_fillback":
            script[0] = n["data"]["script"]["code"]
        walk(n.get("blocks") or [])
walk(wf["nodes"])

bad = 0
for name, table in TABLE_OF.items():
    m = re.search(r"const %s = \{(.*?)\};" % name, script[0], re.S)
    mapped = {k: int(v) for k, v in re.findall(r"(\w+): (\d+)", m.group(1))}
    cols = {r["COLUMN_NAME"]: int(r["NUMERIC_SCALE"])
            for r in db if r["TABLE_NAME"].lower() == table}
    for label, items in (
        ("MISSING from map", sorted(set(cols) - set(mapped))),
        ("not a real column", sorted(set(mapped) - set(cols))),
        ("wrong scale", sorted(c for c in set(cols) & set(mapped) if cols[c] != mapped[c])),
    ):
        if items:
            bad += 1
            print("  %-18s %s %s: %s" % (name, table, label, items))
    print("  %-12s %-20s %2d columns  %s" % (name, table, len(cols), "OK" if not bad else "CHECK"))

print("ALL DECIMAL COLUMNS COVERED" if not bad else "COVERAGE PROBLEMS: %d" % bad)
sys.exit(1 if bad else 0)
