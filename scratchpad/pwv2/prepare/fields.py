"""Write lift/fields.json: the physical columns of the Transfer Order Putaway header, its line sub-table and its records
sub-table (dev), each with the kind prepare/sql.py formats it by. Read-only (information_schema). Re-run after a column is
added to any of the three tables (the hidden job_line_key column on the records, for one).

kinds: id = bigint (emitted as a JSON number; the adapter reads 16+ digits as exact text, as the platform's serializer
       does), int, dec, str, json, dt (timestamp/datetime -> 'YYYY-MM-DD HH:MM:SS'), dt3 (datetime(3) -> '... .mmm'), date.
Excluded: the header's JSON columns the platform answers from the sub-tables instead (table_putaway_item,
table_putaway_records).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
from dbq import q  # noqa: E402

TABLES = ["transfer_order_putaway", "transfer_order_putaway_jz8m9w3h_sub", "transfer_order_putaway_vrqs3cmr_sub"]
EXCLUDE = {"transfer_order_putaway": {"table_putaway_item", "table_putaway_records"}}


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
