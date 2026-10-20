"""check_t9.py: after the mobile test 9 run (classic PICKING_LOOP, V2 off) on dev 496474, read-only.
Diffs every transfer_order column of Pickings A-D against t9_header_snapshot.json, then lists the records, the GD lines'
picking statuses and the GD reservations."""
import collections, json, os, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
before = {str(r["id"]): r for r in json.load(open(os.path.join(HERE, "t9_header_snapshot.json")))}
ids = ",".join(before)
now = {str(r["id"]): r for r in q("--dev", "SELECT * FROM transfer_order WHERE tenant_id = '496474' AND id IN (%s)" % ids)}
norm = lambda v: None if v in (None, "") else str(v)
for pid, b in sorted(before.items(), key=lambda x: x[1]["to_id"]):
    a = now[pid]
    diff = [(k, b.get(k), a.get(k)) for k in sorted(set(b) | set(a)) if norm(b.get(k)) != norm(a.get(k))]
    print("==", b["to_id"], "changed columns:", len(diff))
    for k, x, y in diff:
        print("   %-28s %s -> %s" % (k, str(x)[:60], str(y)[:60]))
recs = q("--dev", "SELECT t.to_id, COUNT(*) n, SUM(r.store_out_qty) qty, SUM(r.confirmed_by IS NULL OR r.confirmed_by = '') no_by, "
                  "GROUP_CONCAT(DISTINCT r.confirmed_by) by_, SUM(COALESCE(r.job_line_key, '') <> '') keyed FROM transfer_order t "
                  "JOIN transfer_order_vrqs3cmr_sub r ON r.transfer_order_id = t.id AND r.is_deleted = 0 WHERE t.id IN (%s) GROUP BY t.to_id ORDER BY t.to_id" % ids)
print("== records"); [print("  ", r) for r in recs]
lines = q("--dev", "SELECT g.delivery_no, g.gd_status, g.picking_status hdr, l.material_id, l.gd_qty, l.picking_status, l.picked_qty FROM goods_delivery g "
                   "JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0 WHERE g.tenant_id = '496474' "
                   "AND g.delivery_no IN ('GD/20261020/088','GD/20261020/089','GD/20261020/090','GD/20261020/091') ORDER BY g.delivery_no, l.id")
print("== GD lines"); [print("  ", r) for r in lines]
res = q("--dev", "SELECT g.delivery_no, r.material_id, r.status, r.open_qty, r.delivered_qty FROM on_reserved_gd r JOIN goods_delivery g "
                 "ON r.target_gd_id = CAST(g.id AS CHAR) COLLATE utf8mb4_general_ci WHERE g.tenant_id = '496474' AND r.is_deleted = 0 "
                 "AND g.delivery_no IN ('GD/20261020/088','GD/20261020/089','GD/20261020/090','GD/20261020/091') ORDER BY g.delivery_no, r.material_id")
print("== reservations"); [print("  ", r) for r in res]
pk = q("--dev", "SELECT p.packing_no, p.packing_status, p.gd_no, p.create_time FROM packing p WHERE p.tenant_id = '496474' AND p.is_deleted = 0 "
                "AND p.create_time >= '2026-10-20 13:40:00' ORDER BY p.id")
print("== Packings since 13:40"); [print("  ", r) for r in pk]
