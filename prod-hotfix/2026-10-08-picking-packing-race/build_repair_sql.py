#!/usr/bin/env python3
"""SQL repair for Bytebase: create the two Packings that PICKING run 2108089351207522305 failed to
create (GD-2610-42, GD-2610-43), row for row what `add_node_LcxwYc7z` writes.

What the add-node writes was read off PACK-20261001-0002, the one Packing that same node created and
nothing touched afterwards: the header, one `packing_jz8m9w3h_sub` row per item, two
`packing_blade_dept` rows (plant + its org), one `packing_Customer` and one `packing_sales_order`
row; nothing on the GD or the Picking. Values come from the payload the failed run recorded.

The number comes from the Packing serial counter, locked for the transaction; the counter ends at
the highest number used. Ids use worker 1001 (the platform's are all worker 33), so they cannot
collide with platform ids.

Writes repairs/R1_create_packings_GD-2610-42_43.sql and previews every INSERT's SELECT read-only.
usage: python3 build_repair_sql.py"""
import json, os, sys
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import build_repair as br  # noqa: E402
import replay_tests as rt  # noqa: E402

OUT = os.path.join(HERE, "repairs", "R1_create_packings_GD-2610-42_43.sql")
TENANT, USER, DEPT = "128671", 2101835719508103169, 1996821057533001730  # wilson's run
ORG_DEPT = 1996787068457861121
RULE, COUNTER = 2048857875989835777, 2049040759151079425
NOW8 = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"
ORDER = ["2108074151607668738", "2108074166921072642"]  # GD-2610-42 first: it takes the lower number


def snowflake(seq, worker=1001):
    ts = datetime(2026, 10, 8, 14, 58, 29, tzinfo=timezone(timedelta(hours=8)))
    return ((int(ts.timestamp() * 1000) - 1288834974657) << 22) | (worker << 12) | seq


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return str(int(v))
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return f"{v:.8f}"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def bigint(v):
    return None if v in ("", None) else int(v)


def insert(table, cols, select_sql):
    return f"INSERT INTO {table} ({', '.join(cols)})\n{select_sql};"


def header(p, hid, offset):
    number = f"CAST(c.current_val AS UNSIGNED) + {offset}"
    packing_no = (f"CONCAT('PACK-', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y%m%d'), '-', "
                  f"LPAD({number}, GREATEST(4, CHAR_LENGTH({number})), '0'))")
    values = [
        ("id", lit(hid)), ("packing_status", lit("Created")), ("plant_id", lit(int(p["plant_id"]))),
        ("packing_no", packing_no), ("so_id", lit(json.dumps(p["so_id"]))), ("gd_id", lit(p["gd_id"])),
        ("to_id", lit(int(p["to_id"]))), ("so_no", lit(p["so_no"])), ("gd_no", lit(p["gd_no"])),
        ("customer_id", lit("[" + ",".join(str(int(c)) for c in p["customer_id"]) + "]")),
        ("organization_id", lit(p["organization_id"])), ("packing_mode", lit(p["packing_mode"])),
        ("assigned_to", lit("[]")), ("created_at", lit(p["created_at"] + " 00:00:00")),
        ("created_by", lit(p["created_by"])), ("remarks", lit(p["remarks"])),
        ("remarks_2", lit(p["remarks_2"])), ("remarks_3", lit(p["remarks_3"])),
        ("create_user", lit(USER)), ("create_dept", lit(DEPT)), ("create_time", NOW8),
        ("update_user", lit(USER)), ("update_time", NOW8), ("is_deleted", "0"), ("tenant_id", lit(TENANT)),
        ("total_item_count", "0"), ("total_hu_count", "0"), ("total_item_qty", "0"),
        ("packing_no_type", lit(RULE)), ("selected_hu_index", "-1"),
        ("di_shipping_method", lit(p["di_shipping_method"])), ("di_driver_name", lit(p["di_driver_name"])),
        ("di_ic_no", lit(p["di_ic_no"])), ("di_driver_contact_no", lit(p["di_driver_contact_no"])),
        ("di_shipping_company", lit(p["di_shipping_company"])), ("di_transport_name", lit(p["di_transport_name"])),
        ("di_vehicle_number", lit(bigint(p["di_vehicle_number"]))),
        ("di_tracking_number", lit(p["di_tracking_number"])), ("di_freight_charges", lit(float(p["di_freight_charges"] or 0))),
    ]
    for ts_col in ("di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection"):
        assert p[ts_col] == "", (ts_col, p[ts_col])  # empty date -> NULL, as the add-node stores it
    cols, exprs = zip(*values)
    sel = (f"SELECT {', '.join(f'{e} AS {c}' for c, e in values)}\nFROM su_code_serial_increment c\nWHERE c.id = {COUNTER}\n"
           f"  AND NOT EXISTS (SELECT 1 FROM packing x WHERE x.gd_id = {lit(p['gd_id'])} AND x.is_deleted = 0)\n"
           f"  AND EXISTS (SELECT 1 FROM goods_delivery g WHERE g.id = {int(p['gd_id'])} AND g.gd_status = 'Created' AND g.is_deleted = 0)")
    return "packing", list(cols), sel, hid


def child(table, cid, hid, values):
    cols = ["id", "packing_id"] + [c for c, _ in values] + [
        "create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id"]
    exprs = [lit(cid), "h.id"] + [e for _, e in values] + [lit(USER), lit(DEPT), NOW8, lit(USER), NOW8, "0", lit(TENANT)]
    sel = (f"SELECT {', '.join(f'{e} AS {c}' for c, e in zip(cols, exprs))}\nFROM packing h\nWHERE h.id = {hid}\n"
           f"  AND NOT EXISTS (SELECT 1 FROM {table} s WHERE s.id = {cid})")
    return table, cols, sel, cid


def item_values(r):
    return [
        ("item_code", lit(int(r["item_code"]))), ("item_name", lit(r["item_name"])), ("item_desc", lit(r["item_desc"])),
        ("gd_no", lit(r["gd_no"])), ("so_no", lit(r["so_no"])), ("batch_no", lit(bigint(r["batch_no"]))),
        ("item_uom", lit(bigint(r["item_uom"]))), ("storage_location", "NULL"), ("bin_location", lit(bigint(r["bin_location"]))),
        ("total_quantity", lit(float(r["total_quantity"]))), ("remark", lit(r["remark"])), ("line_status", lit(r["line_status"])),
        ("so_id", lit(bigint(r["so_id"]))), ("so_line_id", lit(bigint(r["so_line_id"]))), ("gd_id", lit(bigint(r["gd_id"]))),
        ("gd_line_id", lit(bigint(r["gd_line_id"]))), ("to_id", lit(bigint(r["to_id"]))), ("to_line_id", lit(bigint(r["to_line_id"]))),
        ("sub_tenant_id", "NULL"), ("select_item", "0"), ("qty_to_pick", lit(float(r["qty_to_pick"]))),
        ("remaining_qty", lit(float(r["remaining_qty"]))), ("picked_qty", lit(float(r["picked_qty"]))),
        ("remark_2", lit(r["remark_2"])), ("remark_3", lit(r["remark_3"])),
    ]


def statements(payload):
    by_gd = {p["gd_id"]: p for p in payload}
    seq = iter(range(1, 100))
    heads, children, ids = [], [], {}
    for offset, gd in enumerate(ORDER, start=1):
        p = by_gd[gd]
        hid = snowflake(next(seq))
        ids[p["gd_no"]] = hid
        heads.append(header(p, hid, offset))
    for gd in ORDER:
        p, hid = by_gd[gd], ids[by_gd[gd]["gd_no"]]
        for r in p["table_item_source"]:
            children.append(child("packing_jz8m9w3h_sub", snowflake(next(seq)), hid, item_values(r)))
        for dept in (int(p["plant_id"]), ORG_DEPT):
            children.append(child("packing_blade_dept", snowflake(next(seq)), hid,
                                  [("left_field", lit("plant_id")), ("blade_dept_id", lit(dept)), ("sub_tenant_id", "0")]))
        for cust in p["customer_id"]:
            children.append(child("packing_Customer", snowflake(next(seq)), hid,
                                  [("left_field", lit("customer_id")), ("Customer_id", lit(int(cust))), ("sub_tenant_id", "0")]))
        for so in p["so_id"]:
            children.append(child("packing_sales_order", snowflake(next(seq)), hid,
                                  [("left_field", lit("so_id")), ("sales_order_id", lit(int(so))), ("sub_tenant_id", "0")]))
    return heads, children, ids


def check_columns(stmts):
    for table, cols, _, _ in stmts:
        have = {r["COLUMN_NAME"] for r in rt.db(
            f"SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='{table}'")}
        missing = [c for c in cols if c not in have]
        assert not missing, (table, missing)
        assert len(cols) == len(set(cols)), (table, "duplicate column")


def render(heads, children, ids, payload):
    hids = ", ".join(str(v) for v in ids.values())
    all_ids = {t: [] for t in ("packing", "packing_jz8m9w3h_sub", "packing_blade_dept", "packing_Customer", "packing_sales_order")}
    for table, _, _, rid in heads + children:
        all_ids[table].append(str(rid))
    gd_ids = ", ".join(ORDER)
    out = [f"""-- R1: create the Packings PICKING never created for GD-2610-42 and GD-2610-43
--     (run 2108089351207522305, PI-20261008-1026, 2026-10-08 14:57 -- see ../README.md).
-- Generated by build_repair_sql.py from the payload that run recorded. Tenant 128671 (LSH).
-- Run when LSH is not actively picking/packing: the Packing serial counter is locked for the
-- few milliseconds the transaction takes.

-- ========== BEFORE (read-only) -- each must return what its comment says ==========

-- B1: 2 rows, both gd_status Created, picking_status Completed, packing_status empty
SELECT id, delivery_no, gd_status, picking_status, packing_status
FROM goods_delivery WHERE id IN ({gd_ids}) AND is_deleted = 0;

-- B2: 0 rows (no Packing for either GD yet)
SELECT id, packing_no, gd_no FROM packing WHERE gd_id IN ({", ".join(lit(g) for g in ORDER)}) AND is_deleted = 0;

-- B3: 0 rows (the repair's ids are free)
""" + "\nUNION ALL\n".join(
        f"SELECT '{t}' AS tbl, id FROM {t} WHERE id IN ({', '.join(v)})" for t, v in all_ids.items()) + f""";

-- B4: the counter, and the two numbers this repair will take (both must be unused: B5)
SELECT current_val,
       CAST(current_val AS UNSIGNED) + 1 AS for_gd_2610_42,
       CAST(current_val AS UNSIGNED) + 2 AS for_gd_2610_43
FROM su_code_serial_increment WHERE id = {COUNTER};

-- B5: 0 rows
SELECT packing_no FROM packing p, su_code_serial_increment c
WHERE c.id = {COUNTER} AND p.tenant_id = '{TENANT}' AND p.is_deleted = 0
  AND CAST(SUBSTRING_INDEX(p.packing_no, '-', -1) AS UNSIGNED) IN (CAST(c.current_val AS UNSIGNED) + 1, CAST(c.current_val AS UNSIGNED) + 2)
  AND p.packing_no LIKE CONCAT('PACK-', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y%m%d'), '-%');

-- ========== REPAIR (one transaction) ==========

START TRANSACTION;

-- lock the Packing serial counter until COMMIT
UPDATE su_code_serial_increment SET current_val = current_val WHERE id = {COUNTER};
"""]
    for (table, cols, sel, _), p_gd in zip(heads, ORDER):
        gd_no = next(p["gd_no"] for p in payload if p["gd_id"] == p_gd)
        out.append(f"-- {gd_no}\n" + insert(table, cols, sel) + "\n")
    for table, cols, sel, _ in children:
        out.append(insert(table, cols, sel) + "\n")
    out.append(f"""-- the counter ends at the highest number used (unchanged if no header was inserted)
UPDATE su_code_serial_increment
SET current_val = CAST(GREATEST(CAST(current_val AS UNSIGNED),
                  (SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(p.packing_no, '-', -1) AS UNSIGNED)), 0)
                   FROM packing p WHERE p.id IN ({hids}))) AS CHAR),
    update_time = {NOW8}
WHERE id = {COUNTER};

COMMIT;

-- ========== AFTER (read-only) ==========

-- A1: 2 rows, status Created, the numbers from B4
SELECT id, packing_no, packing_status, gd_no, so_no, to_id, create_time FROM packing WHERE id IN ({hids});

-- A2: per Packing: items 1, depts 2, customers 1, sales orders 1
SELECT h.packing_no,
  (SELECT COUNT(*) FROM packing_jz8m9w3h_sub s WHERE s.packing_id = h.id AND s.is_deleted = 0) AS items,
  (SELECT COUNT(*) FROM packing_blade_dept d WHERE d.packing_id = h.id AND d.is_deleted = 0) AS depts,
  (SELECT COUNT(*) FROM packing_Customer c WHERE c.packing_id = h.id AND c.is_deleted = 0) AS customers,
  (SELECT COUNT(*) FROM packing_sales_order o WHERE o.packing_id = h.id AND o.is_deleted = 0) AS sales_orders
FROM packing h WHERE h.id IN ({hids});

-- A3: current_val = B4's current_val + 2
SELECT current_val, update_time FROM su_code_serial_increment WHERE id = {COUNTER};

-- A4: 0 rows (no duplicate Packing numbers in LSH)
SELECT packing_no, COUNT(*) AS n FROM packing WHERE tenant_id = '{TENANT}' AND is_deleted = 0
GROUP BY packing_no HAVING COUNT(*) > 1;

-- A5 (later): the next Packing LSH creates must be numbered after these two.
""")
    return "\n".join(out)


def preview(heads, children):
    print("preview (the SELECT half of each INSERT, read-only on prod):")
    for table, cols, sel, _ in heads + children:
        rows = rt.db(sel)
        if table == "packing":
            print(f"  packing: {len(rows)} row  ->", {k: rows[0][k] for k in ("id", "packing_no", "gd_no", "so_no", "customer_id", "remarks_2")} if rows else "-")
        else:
            print(f"  {table}: {len(rows)} row (0 expected until its header exists)")


def main():
    payload = br.recorded_payload()
    br.check_against_db(payload)
    heads, children, ids = statements(payload)
    check_columns(heads + children)
    print(f"columns ok for {len(heads)} headers and {len(children)} child rows; header ids {ids}")
    preview(heads, children)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(render(heads, children, ids, payload))
    print(f"wrote {os.path.relpath(OUT, HERE)}")


if __name__ == "__main__":
    main()
