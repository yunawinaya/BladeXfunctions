"""test_cf_sql.py: lib/cf_sql.py cf_names_sql(col) on DEV, read-only. A CTE named t holds made-up header objects keyed the
way the database stores them (definition ids); su_code_custom_field stays the real dev table, where tenant 000000's SO header
has lsh_envelope 2114764172450934786 and lsh_restday 2114764243502444545 (created 2026-10-27).

usage: python3 scratchpad/salescf/test/test_cf_sql.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from cf_sql import cf_names_sql  # noqa: E402

DB = "/Users/yunawinaya/Developer/BladeXfunctions/.dbtools/db"
ENV = "2114764172450934786"
REST = "2114764243502444545"
TEXT = 'He said "hi" 你好 😀'


def lit(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'"


ROWS = [
    (1, json.dumps({ENV: True, REST: "Sun"}, ensure_ascii=False)),
    (2, json.dumps({"so_email": "x"})),
    (3, json.dumps({"1": "y"})),
    (4, None),
    (5, json.dumps({ENV: False})),
    (6, json.dumps({REST: TEXT}, ensure_ascii=False)),
]
WANT = {
    1: ("ids_to_names", {"lsh_envelope": True, "lsh_restday": "Sun"}),
    2: ("names_kept", {"so_email": "x"}),
    3: ("deleted_definition_dropped", {}),
    4: ("null_column", {}),
    5: ("false_kept", {"lsh_envelope": False}),
    6: ("unicode_kept", {"lsh_restday": TEXT}),
}

cte = "WITH t AS (" + " UNION ALL ".join(
    "SELECT %d AS id, %s AS cf" % (i, "CAST(NULL AS JSON)" if v is None else "CAST(%s AS JSON)" % lit(v)) for i, v in ROWS) + ")\n"
sql = cte + "SELECT t.id, " + cf_names_sql("t.cf") + " AS names FROM t ORDER BY t.id"
p = subprocess.run([DB, "--dev", "--json", sql], capture_output=True, text=True)
lines = [ln for ln in p.stdout.splitlines() if not ln.startswith("[DEV]")]
if p.returncode != 0 or not lines:
    print("FAIL the query did not run:", (p.stderr or p.stdout)[-1500:])
    sys.exit(1)
got = {int(r["id"]): (json.loads(r["names"]) if isinstance(r["names"], str) else r["names"]) for r in json.loads("\n".join(lines))}
fails = 0
for i, (name, want) in WANT.items():
    ok = got.get(i) == want and (i != 6 or json.dumps(got.get(i), ensure_ascii=False) == json.dumps(want, ensure_ascii=False))
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got %r want %r" % (got.get(i), want)))
    fails += 0 if ok else 1
long_lines = [ln for ln in cf_names_sql("t.cf").splitlines() if len(ln) > 160]
print(("ok   " if not long_lines else "FAIL ") + "every SQL line is at most 160 characters")
fails += 1 if long_lines else 0
print("ALL PASSED" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)
