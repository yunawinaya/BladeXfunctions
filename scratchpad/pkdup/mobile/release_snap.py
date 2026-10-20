"""release_snap.py <label>: read-only snapshot of the staged test GDs on dev 496474 and everything linked to them, written to
release_<label>.json next to this file (the before / after images of the release the user approved on 2026-10-20).
  python3 release_snap.py before
  python3 release_snap.py after
  python3 release_snap.py diff before after   (prints every changed row, by table and id)"""
import json, os, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
GD_NOS = ["GD/20261020/%03d" % n for n in range(84, 92)]
T = "'496474'"


def snap():
    nos = ",".join("'%s'" % n for n in GD_NOS)
    gds = q("--dev", "SELECT * FROM goods_delivery WHERE tenant_id = %s AND (delivery_no IN (%s) OR delivery_no IN (%s))"
            % (T, nos, ",".join("'%s-Cancelled'" % n for n in GD_NOS)))
    ids = [str(g["id"]) for g in gds]
    idl, ids_s = ",".join(ids), ",".join("'%s'" % i for i in ids)
    lines = q("--dev", "SELECT * FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id IN (%s)" % idl)
    so_line_ids = sorted({str(l["so_line_item_id"]) for l in lines if l.get("so_line_item_id")})
    res = q("--dev", "SELECT * FROM on_reserved_gd WHERE tenant_id = %s AND target_gd_id IN (%s)" % (T, ids_s))
    so_lines = q("--dev", "SELECT * FROM sales_order_axszx8cj_sub WHERE id IN (%s)" % ",".join(so_line_ids)) if so_line_ids else []
    so_ids = sorted({str(s["sales_order_id"]) for s in so_lines if s.get("sales_order_id")})
    sos = q("--dev", "SELECT * FROM sales_order WHERE id IN (%s)" % ",".join(so_ids)) if so_ids else []
    pick_ids = sorted({str(r["transfer_order_id"]) for r in q("--dev", "SELECT DISTINCT transfer_order_id FROM transfer_order_jz8m9w3h_sub WHERE gd_id IN (%s)" % ids_s)})
    picks = q("--dev", "SELECT * FROM transfer_order WHERE id IN (%s)" % ",".join(pick_ids)) if pick_ids else []
    pick_rows = q("--dev", "SELECT * FROM transfer_order_jz8m9w3h_sub WHERE transfer_order_id IN (%s)" % ",".join(pick_ids)) if pick_ids else []
    packs = q("--dev", "SELECT * FROM packing WHERE tenant_id = %s AND (gd_id IN (%s) OR gd_no IN (%s))" % (T, ids_s, nos))
    keys = sorted({(str(r["material_id"]), str(r["bin_location"]), str(r.get("batch_id") or "")) for r in res})
    bal = []
    for m, b, bt in keys:
        bal += q("--dev", "SELECT 'item_balance' src, id, material_id, location_id, NULL batch_id, unrestricted_qty, reserved_qty FROM item_balance "
                          "WHERE tenant_id = %s AND material_id = %s AND location_id = %s AND is_deleted = 0" % (T, m, b))
        if bt:
            bal += q("--dev", "SELECT 'item_batch_balance' src, id, material_id, location_id, batch_id, unrestricted_qty, reserved_qty FROM item_batch_balance "
                              "WHERE tenant_id = %s AND material_id = %s AND location_id = %s AND batch_id = %s AND is_deleted = 0" % (T, m, b, bt))
    moves = q("--dev", "SELECT * FROM inventory_movement WHERE tenant_id = %s AND (trx_no IN (%s) OR trx_no IN (%s))"
              % (T, nos, ",".join("'%s-Cancelled'" % n for n in GD_NOS)))
    return {"goods_delivery": gds, "gd_lines": lines, "on_reserved_gd": res, "so_lines": so_lines, "sales_order": sos,
            "transfer_order": picks, "picking_rows": pick_rows, "packing": packs, "balances": bal, "inventory_movement": moves}


def diff(a, b):
    for t in a:
        ka = {str(r["id"]): r for r in a[t]}
        kb = {str(r["id"]): r for r in b.get(t, [])}
        for i in sorted(set(ka) | set(kb)):
            x, y = ka.get(i), kb.get(i)
            if x is None or y is None:
                print(t, i, "ADDED" if x is None else "GONE"); continue
            ch = [(c, x.get(c), y.get(c)) for c in sorted(set(x) | set(y)) if str(x.get(c)) != str(y.get(c)) and c not in ("update_time",)]
            if ch:
                print(t, i, "; ".join("%s: %s -> %s" % (c, str(u)[:50], str(v)[:50]) for c, u, v in ch))


if sys.argv[1] == "diff":
    diff(json.load(open(os.path.join(HERE, "release_%s.json" % sys.argv[2]))), json.load(open(os.path.join(HERE, "release_%s.json" % sys.argv[3]))))
else:
    s = snap()
    json.dump(s, open(os.path.join(HERE, "release_%s.json" % sys.argv[1]), "w"), ensure_ascii=False, indent=1, default=str)
    print({k: len(v) for k, v in s.items()})
    for g in s["goods_delivery"]:
        print(g["delivery_no"], g["gd_status"], "pick:", g.get("picking_status"), "| lines", sum(1 for l in s["gd_lines"] if str(l["goods_delivery_id"]) == str(g["id"]) and not l["is_deleted"]))
    for p in s["transfer_order"]:
        print(p["to_id"], p["to_status"], "processing", p.get("is_processing"))
    for p in s["packing"]:
        print(p.get("packing_no"), p.get("packing_status"), p.get("gd_no"))
