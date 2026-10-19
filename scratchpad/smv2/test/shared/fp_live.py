"""Live, read-only check of code/shared/sql.py FP_LINES + code/shared/fingerprint.js on dev LOTs:
  - FP_LINES runs (SELECT only, no SET keyword, lines <= 160 after wrap_sql) and returns one 'j' column;
  - lotLineFingerprint over its {j} rows == over the same lines read as plain columns (another representation);
  - the fingerprint is independent of the row order.
usage: python3 test/shared/fp_live.py [lot_id ...]   (default: the 5 newest live LOTs of dev, all tenants)
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(SMV2, "lib"))
sys.path.insert(0, os.path.join(SMV2, "code", "shared"))
from dbq import q  # noqa: E402
from v2build import sub, wrap_sql  # noqa: E402
import sql as SH  # noqa: E402

FP_JS = os.path.join(SMV2, "code", "shared", "fingerprint.js")
fails = 0


def node_fp(rows):
    r = subprocess.run(["node", "-e", "const f = require(%r); let t = ''; process.stdin.on('data', (c) => (t += c)); process.stdin.on('end', () => "
                        "{ const x = JSON.parse(t); process.stdout.write(JSON.stringify([f.lotLineFingerprint(x), f.lotLineFingerprint(x.slice().reverse())])); });" % FP_JS],
                       input=json.dumps(rows), capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-800:])
    return json.loads(r.stdout)


lots = sys.argv[1:] or [r["id"] for r in q("--dev", "SELECT CAST(h.id AS CHAR) AS id FROM sm_location_transfer h WHERE h.is_deleted = 0 ORDER BY h.id DESC LIMIT 5")]
for lot in lots:
    t = q("--dev", "SELECT tenant_id, stock_movement_no, stock_movement_status FROM sm_location_transfer WHERE id = %s" % int(lot))[0]
    text = sub(SH.FP_LINES, T=t["tenant_id"], LOT=str(int(lot)))
    wrapped = wrap_sql(text)
    ok_shape = re.match(r"(?i)\s*(select|with)\b", text) and not re.search(r"(?i)\bset\b", text) and max(len(x) for x in wrapped.split("\n")) <= 160 + 10
    rows = q("--dev", wrapped)
    plain = q("--dev", "SELECT CAST(l.id AS CHAR) AS id, l.line_index, l.item_selection, CAST(l.quantity_uom AS CHAR) AS quantity_uom, CAST(l.location_id AS CHAR) AS location_id, "
                       "l.temp_qty_data FROM sm_location_transfer_d2c7o1jd_sub l WHERE l.tenant_id = '%s' AND l.sm_location_transfer_id = %s AND l.is_deleted = 0" % (t["tenant_id"], int(lot)))
    a, a_rev = node_fp(rows)
    b, _ = node_fp(plain)
    good = bool(ok_shape) and all(list(r.keys()) == ["j"] for r in rows) and a == b == a_rev and a.startswith("LF1:%d:" % len(rows))
    fails += not good
    print("%s %s %-22s %-12s lines=%-4d %s" % ("ok  " if good else "FAIL", lot, t["stock_movement_no"], t["stock_movement_status"], len(rows), a if good else (a, b, a_rev, bool(ok_shape))))
print("all passed" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)
