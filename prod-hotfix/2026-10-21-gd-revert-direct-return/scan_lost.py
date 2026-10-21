"""scan_lost.py <out.json>: read-only PROD scan for stock a classic GD revert never put back (GD_PROCESS_REVERT <= v13 returned
only reserved stock; a completion's "straight from Unrestricted" deliveries stayed out). Per Reverted gd_completion_snapshot:
the GD's GDL movements after the snapshot and before the revert (= that completion's), net base quantity out per item / batch /
bin / handling unit, less the revert's GDL-R returns (the half hour around the snapshot's update_time) = lost. GD_PROCESS_REVERT
v14's own rule (sql_node_inDirectOut). Also records each lost key's cost (Unrestricted outs' total / base qty), the reverting
user and the GD's org / plant / SO number for the repair builder."""
import datetime
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scratchpad", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402

EPOCH = 1288834974657
HALF = 1800000 << 22


def sf(dt8):
    """snowflake bound of a UTC+8 datetime string (the app's local time)"""
    t = datetime.datetime.strptime(str(dt8)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
    return (int(t.timestamp() * 1000) - EPOCH) << 22


esc = lambda s: str(s).replace("\\", "\\\\").replace("'", "''")
snaps = q("--prod", "SELECT CAST(s.id AS CHAR) AS id, s.tenant_id, CAST(s.gd_id AS CHAR) AS gd_id, s.create_time, s.update_time, CAST(s.update_user AS CHAR) AS reverted_by, "
                    "g.delivery_no, CAST(g.plant_id AS CHAR) AS plant_id, g.organization_id FROM gd_completion_snapshot s JOIN goods_delivery g ON g.id = s.gd_id AND g.tenant_id = s.tenant_id "
                    "WHERE s.snapshot_status = 'Reverted' AND s.is_deleted = 0 ORDER BY s.id")
out = []
for i, s in enumerate(snaps):
    T, no, sid, rv = s["tenant_id"], esc(s["delivery_no"]), int(s["id"]), sf(s["update_time"])
    comp = q("--prod", f"SELECT CAST(item_id AS CHAR) AS item, IFNULL(CAST(batch_number_id AS CHAR), '') AS batch, IFNULL(CAST(bin_location_id AS CHAR), '') AS bin, "
                       f"IFNULL(CAST(handling_unit_id AS CHAR), '') AS hu, UPPER(movement) AS mv, inventory_category AS cat, CAST(COALESCE(base_qty, quantity) AS CHAR) AS bq, "
                       f"CAST(IFNULL(total_price, 0) AS CHAR) AS tp, parent_trx_no, CAST(uom_id AS CHAR) AS uom, CAST(base_uom_id AS CHAR) AS buom, costing_method_id AS cm, CAST(id AS CHAR) AS id "
                       f"FROM inventory_movement WHERE id > {sid} AND id < {min(sid + HALF, rv)} AND tenant_id = '{T}' AND trx_no = '{no}' AND transaction_type = 'GDL' AND is_deleted = 0")
    back = q("--prod", f"SELECT CAST(item_id AS CHAR) AS item, IFNULL(CAST(batch_number_id AS CHAR), '') AS batch, IFNULL(CAST(bin_location_id AS CHAR), '') AS bin, "
                       f"IFNULL(CAST(handling_unit_id AS CHAR), '') AS hu, CAST(SUM(COALESCE(base_qty, quantity)) AS CHAR) AS bq FROM inventory_movement "
                       f"WHERE id > {rv - HALF} AND id < {rv + HALF} AND tenant_id = '{T}' AND trx_no = '{no}' AND transaction_type = 'GDL-R' AND UPPER(movement) = 'IN' AND is_deleted = 0 "
                       f"GROUP BY 1, 2, 3, 4")
    net = defaultdict(float)
    ucost = defaultdict(lambda: [0.0, 0.0])
    meta = {}
    for m in comp:
        k = (m["item"], m["batch"], m["bin"], m["hu"])
        sign = 1 if m["mv"] == "OUT" else -1
        net[k] += sign * float(m["bq"])
        if m["mv"] == "OUT" and m["cat"] == "Unrestricted":
            ucost[k][0] += float(m["tp"])
            ucost[k][1] += float(m["bq"])
            meta.setdefault(k, {"parent_no": m["parent_trx_no"], "buom": m["buom"], "cm": m["cm"], "out_ids": []})["out_ids"].append(m["id"])
    for r in back:
        net[(r["item"], r["batch"], r["bin"], r["hu"])] -= float(r["bq"])
    lost = [{"item": k[0], "batch": k[1], "bin": k[2], "hu": k[3], "qty": round(v, 8), "unit_cost": round(ucost[k][0] / ucost[k][1], 8) if ucost[k][1] else None,
             **meta.get(k, {})} for k, v in net.items() if v > 1e-9]
    if lost:
        out.append({"tenant": T, "gd_id": s["gd_id"], "gd_no": s["delivery_no"], "snapshot_id": s["id"], "completed": str(s["create_time"]), "reverted": str(s["update_time"]),
                    "reverted_by": s["reverted_by"], "plant_id": s["plant_id"], "org": s["organization_id"], "lost": lost})
        print("%s %s reverted %s: %s" % (T, s["delivery_no"], str(s["update_time"])[:16], ", ".join("%s/%s %g%s" % (l["item"][-6:], (l["batch"] or "-")[-6:], l["qty"], " HU" if l["hu"] else "") for l in lost)), flush=True)
    if (i + 1) % 25 == 0:
        print("... %d of %d snapshots" % (i + 1, len(snaps)), flush=True)
json.dump(out, open(sys.argv[1], "w"), indent=1)
print("%d of %d reverted completions lost stock; %g units in all" % (len(out), len(snaps), sum(l["qty"] for g in out for l in g["lost"])))
