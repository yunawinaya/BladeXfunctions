"""python3 test/shared/fp_live.py - run code/shared/sql.py FP_SA_LINES / FP_SC_LINES read-only on dev for real documents and
fingerprint the rows with code/shared/fingerprint.js (node). Proves the SQL runs (columns, collation, ordering) and that a
JSON_OBJECT row and the same row as a plain object fingerprint the same.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(SAV2, "lib"))
sys.path.insert(0, os.path.join(SAV2, "code", "shared"))
from dbq import q  # noqa: E402
import sql as S  # noqa: E402

FP = os.path.join(SAV2, "code", "shared", "fingerprint.js")


def fp(fn, rows):
    js = "const F=require(%s);const rows=JSON.parse(require('fs').readFileSync(0,'utf8'));" \
         "const plain=rows.map(r=>F.saFpRows([r])[0]);process.stdout.write(JSON.stringify([F.%s(rows),F.%s(plain)]))" % (json.dumps(FP), fn, fn)
    r = subprocess.run(["node", "-e", js], input=json.dumps(rows), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def fill(text, **kw):
    for k, v in kw.items():
        text = text.replace("@" + k, str(v))
    return text


ok = True
sa = q("--dev", "SELECT CAST(h.id AS CHAR) AS id, h.tenant_id AS t, COUNT(l.id) AS n FROM stock_adjustment h JOIN stock_adjustment_1dknywqh_sub l "
                "ON l.stock_adjustment_id = h.id AND l.is_deleted = 0 WHERE h.is_deleted = 0 GROUP BY h.id, h.tenant_id ORDER BY n DESC LIMIT 3")
for d in sa:
    rows = q("--dev", fill(S.FP_SA_LINES, T=d["t"], SA=d["id"]))
    a, b = fp("saLineFingerprint", rows)
    print("SA %s tenant %s: %d rows %s %s" % (d["id"], d["t"], len(rows), a, "same" if a == b else "DIFFERS " + b))
    ok = ok and a == b and len(rows) == int(d["n"])
sc = q("--dev", "SELECT CAST(h.id AS CHAR) AS id, h.tenant_id AS t, COUNT(l.id) AS n FROM stock_count h JOIN stock_count_h4c9e1cl_sub l "
                "ON l.stock_count_id = h.id AND l.is_deleted = 0 WHERE h.is_deleted = 0 GROUP BY h.id, h.tenant_id ORDER BY n DESC LIMIT 3")
for d in sc:
    rows = q("--dev", fill(S.FP_SC_LINES, T=d["t"], SC=d["id"]))
    a, b = fp("scLineFingerprint", rows)
    print("SC %s tenant %s: %d rows %s %s" % (d["id"], d["t"], len(rows), a, "same" if a == b else "DIFFERS " + b))
    ok = ok and a == b and len(rows) == int(d["n"])
print("ok" if ok else "FAIL")
sys.exit(0 if ok else 1)
