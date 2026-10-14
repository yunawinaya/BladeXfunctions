#!/usr/bin/env python3
"""Read-only dev snapshot of everything a Packing completion can write, for any Packing, and a diff of two.

  python3 snap.py take <label> <packing_no> [tenant]   -> <label>.json in $SNAP_DIR or the current directory
  python3 snap.py diff <before> <after>                 -> changed / added / removed rows per table
Movements: this delivery's rows created after the before-snapshot's DB clock (not an id floor: dev has test ids far above
the snowflake range).
"""
import json, os, subprocess, sys, zlib

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".dbtools", "db")
HERE = os.environ.get("SNAP_DIR") or os.getcwd()


def q(sql):
    r = subprocess.run([DB, "--dev", "--json", "--limit", "0", sql], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr.strip()[-2000:])
    return json.loads(r.stdout)


def short(v):
    if isinstance(v, str) and len(v) > 160:
        return "<len %d crc %08x>" % (len(v), zlib.crc32(v.encode()))
    return v


def take(label, packing_no, T, since=None):
    p = q(f"SELECT CAST(id AS CHAR) id, CAST(REGEXP_SUBSTR(gd_id, '[0-9]+') AS CHAR) gd, CAST(so_id AS CHAR) so FROM packing WHERE tenant_id='{T}' AND packing_no='{packing_no}' AND is_deleted=0")
    if len(p) != 1:
        sys.exit(f"{packing_no}: {len(p)} Packings in tenant {T}")
    PID, GD = p[0]["id"], p[0]["gd"]
    g = q(f"SELECT delivery_no, CAST(plant_id AS CHAR) plant FROM goods_delivery WHERE tenant_id='{T}' AND id={GD}")[0]
    SOS = ",".join(json.loads(p[0]["so"] or "[]") and [str(x) for x in json.loads(p[0]["so"])] or ["0"])
    items = [r["m"] for r in q(f"SELECT DISTINCT CAST(material_id AS CHAR) m FROM goods_delivery_fwii8mvb_sub WHERE tenant_id='{T}' AND goods_delivery_id={GD} AND is_deleted=0 AND material_id IS NOT NULL AND material_id <> ''")]
    il = ",".join(items) or "0"
    now = q("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') n")[0]["n"]
    clock = since or now
    hus = f"(SELECT handling_unit_id FROM packing_hr4nq20g_sub WHERE tenant_id='{T}' AND packing_id={PID})"
    jobs = f"(SELECT id FROM gd_async_job WHERE tenant_id='{T}' AND (correlation_id='GD|{GD}' OR causation_id='{PID}'))"
    PL = g["plant"]
    Q = {
        "packing": f"SELECT * FROM packing WHERE tenant_id='{T}' AND id={PID}",
        "packing_hu": f"SELECT * FROM packing_hr4nq20g_sub WHERE tenant_id='{T}' AND packing_id={PID}",
        "packing_src": f"SELECT * FROM packing_jz8m9w3h_sub WHERE tenant_id='{T}' AND packing_id={PID}",
        "packing_husrc": f"SELECT * FROM packing_mudjw4xk_sub WHERE tenant_id='{T}' AND packing_id={PID}",
        "gd": f"SELECT * FROM goods_delivery WHERE tenant_id='{T}' AND id={GD}",
        "gd_lines": f"SELECT * FROM goods_delivery_fwii8mvb_sub WHERE tenant_id='{T}' AND goods_delivery_id={GD}",
        "so": f"SELECT * FROM sales_order WHERE tenant_id='{T}' AND id IN ({SOS})",
        "so_lines": f"SELECT * FROM sales_order_axszx8cj_sub WHERE tenant_id='{T}' AND sales_order_id IN ({SOS})",
        "reserved": f"SELECT * FROM on_reserved_gd WHERE tenant_id='{T}' AND plant_id={PL} AND material_id IN ({il})",
        "item_balance": f"SELECT * FROM item_balance WHERE tenant_id='{T}' AND plant_id={PL} AND material_id IN ({il})",
        "batch_balance": f"SELECT * FROM item_batch_balance WHERE tenant_id='{T}' AND plant_id={PL} AND material_id IN ({il})",
        "hu": f"SELECT * FROM handling_unit WHERE tenant_id='{T}' AND id IN {hus}",
        "hu_items": f"SELECT * FROM handling_unit_atu7sreg_sub WHERE tenant_id='{T}' AND handling_unit_id IN {hus}",
        "movements": f"SELECT * FROM inventory_movement WHERE tenant_id='{T}' AND plant_id={PL} AND trx_no='{g['delivery_no']}' AND create_time >= '{clock}'",
        "jobs": f"SELECT * FROM gd_async_job WHERE tenant_id='{T}' AND id IN {jobs}",
        "steps": f"SELECT * FROM gd_publish_step WHERE tenant_id='{T}' AND job_id IN {jobs}",
        "operations": f"SELECT * FROM inventory_operation WHERE tenant_id='{T}' AND operation_id LIKE 'PKG|%' AND source_document_id='{PID}'",
    }
    out = {"_clock": clock, "_packing_no": packing_no, "_tenant": T, "_ids": {"packing": PID, "gd": GD, "so": SOS, "plant": PL, "delivery_no": g["delivery_no"]}, "_items": items}
    for k, sql in Q.items():
        try:
            out[k] = {str(r["id"]): {c: short(v) for c, v in r.items()} for r in q(sql)}
        except SystemExit as e:
            out[k] = {"_error": str(e)[:300]}
    json.dump(out, open(os.path.join(HERE, label + ".json"), "w"), indent=1, ensure_ascii=False, default=str)
    print(label, out["_ids"], {k: len(v) for k, v in out.items() if not k.startswith("_")}, "clock", clock)


def diff(a, b):
    A = json.load(open(os.path.join(HERE, a + ".json")))
    B = json.load(open(os.path.join(HERE, b + ".json")))
    for t in [k for k in B if not k.startswith("_")]:
        ra, rb = A.get(t, {}), B[t]
        add = [i for i in rb if i not in ra]
        gone = [i for i in ra if i not in rb]
        chg = [i for i in rb if i in ra and ra[i] != rb[i]]
        if not (add or gone or chg):
            continue
        print(f"== {t}: {len(chg)} changed, {len(add)} added, {len(gone)} gone")
        for i in chg:
            cols = {c: (ra[i].get(c), rb[i].get(c)) for c in rb[i] if ra[i].get(c) != rb[i].get(c)}
            print("  ~", i, json.dumps(cols, ensure_ascii=False, default=str))
        for i in add:
            print("  +", i, json.dumps({c: v for c, v in rb[i].items() if v not in (None, "")}, ensure_ascii=False, default=str))
        for i in gone:
            print("  -", i)


if __name__ == "__main__":
    if sys.argv[1] == "take":
        label, pno = sys.argv[2], sys.argv[3]
        T = sys.argv[4] if len(sys.argv) > 4 else "000000"
        since = None
        base = os.path.join(HERE, label.rsplit("_", 1)[0] + "_before.json")
        if not label.endswith("_before") and os.path.exists(base):
            since = json.load(open(base))["_clock"]
        take(label, pno, T, since)
    else:
        diff(sys.argv[2], sys.argv[3])
