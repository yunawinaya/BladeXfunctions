"""The columns of the tables the auto allocation reads (GLOBAL_ALLOCATION's searches and the classic loop's), with gdc's
fields.json kinds derived from the dev schema (read-only; the platform schema's fields only): bigint -> id, decimal -> dec, datetime -> dt3, timestamp -> dt,
date -> date, int / tinyint -> int, json -> json, else str. Writes lift/fields_alloc.json (schema only, no tenant data).

usage: python3 alloc_fields.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

# handling_unit / handling_unit_atu7sreg_sub: gdc's fields.json has them
TABLES = ["item_balance", "item_batch_balance", "bin_location", "unit_of_measurement", "batch"]
KIND = {"bigint": "id", "decimal": "dec", "datetime": "dt3", "timestamp": "dt", "date": "date", "int": "int", "tinyint": "int", "smallint": "int", "json": "json"}
out = {}
for t in TABLES:
    rows = q("--dev", "SELECT COLUMN_NAME c, DATA_TYPE dt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '%s' ORDER BY ORDINAL_POSITION" % t)
    assert rows, t
    # the platform returns its schema's fields and sub_tenant_id (as gdc's fields.json): a dropped field's *_d_xxxxx column is left out
    sj = q("--dev", "SELECT schema_json FROM su_code_tables WHERE table_name = '%s' AND is_deleted = 0" % t)
    assert len(sj) == 1, t
    props = set((json.loads(sj[0]["schema_json"]).get("properties") or {}).keys())
    out[t] = {r["c"]: [KIND.get(r["dt"], "str")] * 2 for r in rows if r["c"] in props or r["c"] == "sub_tenant_id"}
path = os.path.join(HERE, "..", "lift", "fields_alloc.json")
json.dump(out, open(path, "w"), indent=1)
print({t: len(c) for t, c in out.items()}, "->", os.path.normpath(path))
