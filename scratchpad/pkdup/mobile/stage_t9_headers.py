"""stage_t9_headers.py: header values for the mobile test 9 run (classic PICKING_LOOP, V2 off) on dev 496474, then a
snapshot of every transfer_order column of the four Pickings (the "before" image the phone run is compared against).
  python3 stage_t9_headers.py            preview the UPDATEs (dbw without --execute)
  python3 stage_t9_headers.py --execute  write them, then save t9_header_snapshot.json next to this file"""
import json, os, subprocess, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

DBW = "/Users/yunawinaya/Developer/BladeXfunctions/.dbtools/dbw"
EXECUTE = "--execute" in sys.argv
PICKINGS = {"A": "2112405068145856513", "B": "2112405384618676225", "C": "2112405408744312834", "D": "2112405436422524930"}
lit = lambda v: "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"

entry = q("--dev", "SELECT JSON_EXTRACT(ref_doc, '$[0]') e FROM transfer_order WHERE to_id = 'PI-20260917-0312' LIMIT 1")[0]["e"]
entry = entry if isinstance(entry, str) else json.dumps(entry)
assert json.loads(entry).get("url"), entry

a = {
    "remarks": lit("T9-A remarks"), "remarks_2": lit("T9-A2"), "remarks_3": lit("T9-A3"),
    "ref_doc": "JSON_ARRAY(CAST(%s AS JSON))" % lit(entry),
    "di_driver_name": lit("T9 Driver A"), "di_ic_no": lit("T9-IC-A"), "di_driver_contact_no": lit("0120000009"),
    "di_freight_charges": "12.50", "di_transport_name": lit("T9 Transport A"), "di_tracking_number": lit("T9-TRK-A"),
    "di_shipping_company": lit("T9 Shipping Co A"), "di_pickup_date": lit("2026-10-21 09:00:00"),
    "di_est_arrival_date": lit("2026-10-22 10:00:00"), "di_est_delivery_date": lit("2026-10-23 12:00:00"),
    "di_validity_of_collection": lit("2026-10-25 18:00:00"), "area_id": "2021055944382435330", "project_id": "2092794137405882370",
}
sqls = ["UPDATE transfer_order SET " + ", ".join("%s = %s" % kv for kv in a.items())
        + " WHERE tenant_id = '496474' AND id = %s AND to_status = 'Created' AND is_deleted = 0" % PICKINGS["A"]]
for k in ("B", "C", "D"):
    sqls.append("UPDATE transfer_order SET remarks = %s, remarks_2 = %s WHERE tenant_id = '496474' AND id = %s AND to_status = 'Created' AND is_deleted = 0"
                % (lit("T9-" + k), lit("T9-" + k + "2"), PICKINGS[k]))

for sql in sqls:
    r = subprocess.run([DBW, "--dev"] + (["--execute"] if EXECUTE else []) + [sql], capture_output=True, text=True)
    print((r.stdout + r.stderr).strip().splitlines()[-1])

if EXECUTE:
    rows = q("--dev", "SELECT * FROM transfer_order WHERE tenant_id = '496474' AND id IN (%s) ORDER BY id" % ",".join(PICKINGS.values()))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "t9_header_snapshot.json")
    json.dump(rows, open(out, "w"), ensure_ascii=False, indent=1, default=str)
    for row in rows:
        print(row["to_id"], row["to_status"], "| remarks:", row["remarks"], "|", row["remarks_2"], "|", row["remarks_3"],
              "| area", row["area_id"], "project", row["project_id"], "| ref_doc entries:", len(json.loads(row["ref_doc"])) if row["ref_doc"] else 0)
    print("snapshot:", out, "(%d rows, %d columns)" % (len(rows), len(rows[0]) if rows else 0))
