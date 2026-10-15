"""Write lift/fields.json: the physical columns of the Goods Receiving header and line tables (dev), each with the kind
prepare/sql.py formats it by. Read-only (information_schema). Re-run after a column is added to either table.

kinds: id = bigint (emitted as a JSON number; the adapter reads 16+ digits as exact text, as the platform's serializer
       does, and a short one like gr_no_type -9999 stays a number), int, dec, str, json, dt (timestamp/datetime ->
       'YYYY-MM-DD HH:MM:SS'), dt3 (datetime(3) -> '... .mmm'), date.
Excluded: the JSON columns the platform answers from a subform table instead (table_gr; table_sn_records, whose rows
live in goods_receiving_v2dmqew8_sub - serial receipts are not V2-eligible, the adapter answers []).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402

TABLES = ["goods_receiving", "goods_receiving_eg6l4ywi_sub"]
EXCLUDE = {"goods_receiving": {"table_gr", "table_sn_records"}}


def kind(t):
    t = t.lower()
    if t.startswith("bigint"):
        return "id"
    if t.startswith(("int", "tinyint", "smallint", "mediumint")):
        return "int"
    if t.startswith("decimal"):
        return "dec"
    if t == "json":
        return "json"
    if t.startswith("datetime(") or t.startswith("timestamp("):
        return "dt3"
    if t.startswith(("datetime", "timestamp")):
        return "dt"
    if t == "date":
        return "date"
    return "str"


def main():
    out = {}
    for tbl in TABLES:
        rows = q("--dev", "SELECT column_name c, column_type t FROM information_schema.columns WHERE table_schema = DATABASE() "
                          f"AND table_name = '{tbl}' ORDER BY ordinal_position")
        out[tbl] = {r["c"]: kind(r["t"]) for r in rows if r["c"] not in EXCLUDE.get(tbl, set())}
    path = os.path.join(HERE, "..", "lift", "fields.json")
    json.dump(out, open(path, "w"), indent=1)
    print(path, {k: len(v) for k, v in out.items()})


if __name__ == "__main__":
    main()
