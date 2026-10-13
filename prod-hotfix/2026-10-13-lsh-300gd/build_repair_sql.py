#!/usr/bin/env python3
"""SQL repair for Bytebase: finish what PICKING run 2109686904730554369 never ran for PI-20261013-1502
(LSH, 300 GDs GD-2610-244..543, confirmed 2026-10-13 00:45 MYT).

That run wrote the Picking (Completed, 2,096 records) and the GD lines, then died at
search_node_SiblingPickings (30 s statement timeout). It never ran the GD header roll-up, the Packing
creation (pMVdQBEQ -> gudzrvMQ -> add_node_LcxwYc7z) or the lock release. This script:

1. replays prod PICKING v77's own code_node_pMVdQBEQ and code_node_gudzrvMQ on the run's recorded
   inputs, plus the fetches that never ran, rebuilt from the database the way a search-node returns them;
2. checks itself against run 2109783579109232642, which created PACK-20261013-0493 (nothing has touched
   it since): the replay matches what that run recorded, and the rows this script would write equal
   that Packing's rows column for column;
3. writes repairs/R1_lsh_300gd.sql (BEFORE checks, one REPAIR transaction, AFTER checks);
4. previews the SELECT half of every INSERT read-only on prod.

Numbers: the platform does not read su_code_serial_increment back (after the 10-08 repair set it to
303, its next Packing was still 0302), so SQL cannot reserve numbers there. Every repaired Packing is
dated 20261013, the day of the confirm, and numbered after the highest PACK-20261013 number at run
time; run on 2026-10-13 itself, 500 numbers are skipped so the platform's later Packings that day
cannot reach them. The counter is left to the platform.

usage: python3 build_repair_sql.py      (LSH_CACHE=<dir> keeps the 13 MB trace between runs)
"""
import json, os, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import replay_tests as rt  # noqa: E402

RUN = 2109686904730554369        # PICKING, PI-20261013-1502, died at search_node_SiblingPickings
REF_RUN = 2109783579109232642    # PICKING that created PACK-20261013-0493 for GD-2610-237
REF_PACKING = 2109783869531230210
PICKING = 2109684632214704129
TENANT, ORG = "128671", 1996787068457861121
USER, DEPT = 2032373030763909122, 1996821057533001730  # joseph: the confirm that failed
RULE = 2048857875989835777
DAY, GAP = "20261013", 500
ID_TIME_MS = 1791850000000       # 2026-10-13 ~08:06 MYT; repair ids use worker 1001, the platform's use 33
OUT = os.path.join(HERE, "repairs", "R1_lsh_300gd.sql")
NOW8 = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"
EPS = 1e-6

PM_IN = ["get_node_V4PP8WJI", "get_node_jEllcWiJ", "code_node_Z5JH4g2u", "code_node_oHIIKfiw", "search_node_c7BtNx91"]
GZ_IN = ["code_node_pMVdQBEQ", "search_node_mUPqqQph", "search_node_i5v6z7Hu", "search_node_c7BtNx91", "search_node_FXknErTg"]


class Raw(str):
    """An SQL expression, written as is."""


# ---------------------------------------------------------------- inputs

def code(node_id):
    wf = json.load(open(os.path.join(HERE, "PICKING.BASE.json"), encoding="utf-8"))
    hit = []

    def walk(lst):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                if n["id"] == node_id:
                    hit.append(n)
                walk(n.get("blocks") or [])

    walk(wf["nodes"])
    return hit[0]["data"]["script"]["code"]


def recorded(run):
    """-> (workflow params, {node_id: recorded response}). A failed run ends with an entry without node_id."""
    cache = os.environ.get("LSH_CACHE")
    path = cache and os.path.join(cache, f"run_{run}.json")
    if path and os.path.exists(path):
        row = json.load(open(path))
    else:
        row = rt.db(f"SELECT request_json_data, nodes_data FROM su_code_workflow_inst WHERE id={run}")[0]
        if path:
            json.dump(row, open(path, "w"))
    params = json.loads(row["request_json_data"]).get("request_json") or {}
    nodes = {n["node_id"]: json.loads(n["response_json_data"])
             for n in json.loads(row["nodes_data"] or "[]") if n.get("node_id") and n.get("response_json_data")}
    return params, nodes


_types = {}


def as_fetched(row, table):
    """A DB row as a get/search-node hands it to a code-node: nulls dropped, JSON parsed, decimals numbers."""
    if table not in _types:
        _types[table] = {r["COLUMN_NAME"]: r["DATA_TYPE"] for r in rt.db(
            f"SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns "
            f"WHERE table_schema=DATABASE() AND table_name='{table}'")}
    out = {}
    for k, v in row.items():
        if v is None:
            continue
        t = _types[table].get(k)
        out[k] = json.loads(v) if t == "json" else float(v) if t == "decimal" else v
    return out


def search(rows):
    return rt.wrap({"total": len(rows), "count": len(rows), "data": rows})


def gd_masters(gd_ids):
    ids = ",".join(str(int(g)) for g in gd_ids)
    lines = defaultdict(list)
    for r in rt.db(f"SELECT * FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id IN ({ids}) "
                   f"AND is_deleted = 0 ORDER BY id"):
        lines[r["goods_delivery_id"]].append(as_fetched(r, "goods_delivery_fwii8mvb_sub"))
    out = []
    for h in rt.db(f"SELECT * FROM goods_delivery WHERE id IN ({ids}) AND is_deleted = 0 ORDER BY id"):
        g = as_fetched(h, "goods_delivery")
        g["table_gd"] = lines[h["id"]]
        out.append(g)
    return out


def packing_setup():
    # get_node_V4PP8WJI: organization_id only, and LSH has one row per plant; the run gets the first.
    [r] = rt.db(f"SELECT * FROM packing_setup WHERE organization_id = '{ORG}' AND is_deleted = 0 ORDER BY id LIMIT 1")
    return rt.wrap({"count": 1, "data": as_fetched(r, "packing_setup")})


def replay(params, nodes, now_ms):
    pm = rt.run(code("code_node_pMVdQBEQ"), params, {k: nodes[k] for k in PM_IN}, now_ms)
    nodes = dict(nodes, code_node_pMVdQBEQ=rt.wrap(pm))
    gz = rt.run(code("code_node_gudzrvMQ"), params, {k: nodes[k] for k in GZ_IN}, now_ms)
    return pm, gz


# ---------------------------------------------------------------- rows, as add_node_LcxwYc7z writes them

def none_if_empty(v):
    return None if v in ("", None) else v


def bigint(v):
    return None if v in ("", None) else int(v)


def header_row(p, hid, k):
    for col in ("di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection"):
        assert p[col] == "", (p["gd_no"], col, p[col])  # all empty here; '' -> NULL
    return [
        ("id", hid), ("k", k), ("gd_num", int(p["gd_id"])),  # k and gd_num drive the number and guards, not inserted
        ("packing_status", "Created"), ("plant_id", int(p["plant_id"])),
        ("packing_no", Raw("CONCAT('PACK-%s-', LPAD(s.num, GREATEST(4, CHAR_LENGTH(s.num)), '0'))" % DAY)),
        ("so_id", json.dumps([str(x) for x in p["so_id"]])), ("gd_id", str(p["gd_id"])), ("to_id", int(p["to_id"])),
        ("so_no", p["so_no"]), ("gd_no", p["gd_no"]),
        ("customer_id", "[" + ",".join(str(int(c)) for c in p["customer_id"]) + "]"),
        ("organization_id", str(p["organization_id"])), ("packing_mode", p["packing_mode"]), ("assigned_to", "[]"),
        ("created_at", p["created_at"] + " 00:00:00"), ("created_by", p["created_by"]),
        ("remarks", p["remarks"]), ("remarks_2", p["remarks_2"]), ("remarks_3", p["remarks_3"]),
        ("create_user", USER), ("create_dept", DEPT), ("create_time", Raw(NOW8)),
        ("update_user", USER), ("update_time", Raw(NOW8)), ("is_deleted", 0), ("tenant_id", TENANT),
        ("total_item_count", 0), ("total_hu_count", 0), ("total_item_qty", 0.0),
        ("packing_no_type", RULE), ("selected_hu_index", -1),
        # Delivery Info: text inputs keep '', the select fields store '' as NULL (as in the healthy batch)
        ("di_shipping_method", none_if_empty(p["di_shipping_method"])), ("di_driver_name", none_if_empty(p["di_driver_name"])),
        ("di_ic_no", p["di_ic_no"]), ("di_driver_contact_no", p["di_driver_contact_no"]),
        ("di_shipping_company", none_if_empty(p["di_shipping_company"])), ("di_transport_name", p["di_transport_name"]),
        ("di_vehicle_number", bigint(p["di_vehicle_number"])), ("di_tracking_number", p["di_tracking_number"]),
        ("di_freight_charges", float(p["di_freight_charges"] or 0)),
        ("packing_lock_user_name", ""), ("packing_lock_user_id", ""), ("idempotency_key", ""),
        ("packing_lock_session_id", ""),
    ]


def item_row(r, cid, hid):
    return [
        ("id", cid), ("packing_id", hid), ("item_code", int(r["item_code"])), ("item_name", r["item_name"]),
        ("item_desc", r["item_desc"]), ("gd_no", r["gd_no"]), ("so_no", r["so_no"]), ("batch_no", bigint(r["batch_no"])),
        ("item_uom", bigint(r["item_uom"])), ("bin_location", bigint(r["bin_location"])),
        ("total_quantity", float(r["total_quantity"])), ("remark", r["remark"]), ("line_status", r["line_status"]),
        ("so_id", bigint(r["so_id"])), ("so_line_id", bigint(r["so_line_id"])), ("gd_id", bigint(r["gd_id"])),
        ("gd_line_id", bigint(r["gd_line_id"])), ("to_id", bigint(r["to_id"])), ("to_line_id", bigint(r["to_line_id"])),
        ("create_user", USER), ("create_dept", DEPT), ("create_time", Raw(NOW8)), ("update_user", USER),
        ("update_time", Raw(NOW8)), ("is_deleted", 0), ("tenant_id", TENANT), ("select_item", 0),
        ("qty_to_pick", float(r["qty_to_pick"])), ("remaining_qty", float(r["remaining_qty"])),
        ("picked_qty", float(r["picked_qty"])), ("remark_2", r["remark_2"]), ("remark_3", r["remark_3"]),
    ]


def junction_row(cid, hid, left, fk_col, fk):
    return [("id", cid), ("packing_id", hid), ("left_field", left), (fk_col, int(fk)),
            ("create_user", USER), ("create_dept", DEPT), ("create_time", Raw(NOW8)), ("update_user", USER),
            ("update_time", Raw(NOW8)), ("is_deleted", 0), ("tenant_id", TENANT), ("sub_tenant_id", ORG)]


def rows_for(packings, first_id):
    """-> {table: [row]} for these Packings (in this order), ids allocated in that order."""
    n = iter(range(10 ** 6))

    def nid():
        i = next(n)
        return ((first_id + i // 4096 - 1288834974657) << 22) | (1001 << 12) | (i % 4096)

    out = defaultdict(list)
    for k, p in enumerate(packings, start=1):
        hid = nid()
        out["packing"].append(header_row(p, hid, k))
        for r in p["table_item_source"]:
            out["packing_jz8m9w3h_sub"].append(item_row(r, nid(), hid))
        for dept in (ORG, int(p["plant_id"])):
            out["packing_blade_dept"].append(junction_row(nid(), hid, "plant_id", "blade_dept_id", dept))
        for c in p["customer_id"]:
            out["packing_Customer"].append(junction_row(nid(), hid, "customer_id", "Customer_id", c))
        for so in p["so_id"]:
            out["packing_sales_order"].append(junction_row(nid(), hid, "so_id", "sales_order_id", so))
    return out


# ---------------------------------------------------------------- SQL

def lit(v):
    if isinstance(v, Raw):
        return str(v)
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return str(int(v))
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return f"{v:.8f}"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


NOT_INSERTED = {"k", "gd_num"}


def multi_insert(table, rows, where, outer=None):
    """One INSERT ... SELECT over a VALUES list; columns equal in every row are written once as constants."""
    cols = [c for c, _ in rows[0]]
    lits = [[lit(v) for _, v in r] for r in rows]
    assert all([c for c, _ in r] == cols for r in rows)
    const = {c: lits[0][i] for i, c in enumerate(cols)
             if c not in NOT_INSERTED and all(row[i] == lits[0][i] for row in lits)}
    vary = [c for c in cols if c not in const]
    values = ",\n  ".join("ROW(" + ", ".join(row[i] for i, c in enumerate(cols) if c in vary) + ")" for row in lits)
    ins = [c for c in cols if c not in NOT_INSERTED]
    src = f"(VALUES\n  {values}\n) AS v({', '.join(vary)})"
    if outer:  # headers: number the rows that pass the guards, then insert
        sel = ", ".join(f"{const[c]} AS {c}" if c in const else f"s.{c}" for c in ins)
        body = (f"SELECT {sel}\nFROM (\n  SELECT v.*, n.base + ROW_NUMBER() OVER (ORDER BY v.k) AS num\n"
                f"  FROM {src}\n  CROSS JOIN ({outer}) n\n  {where}\n) s")
    else:
        sel = ", ".join(f"{const[c]} AS {c}" if c in const else f"v.{c}" for c in ins)
        body = f"SELECT {sel}\nFROM {src}\n{where}"
    return f"INSERT INTO {table} ({', '.join(ins)})\n{body};", body


NUMBER_BASE = (
    "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(x.packing_no, '-', 3), '-', -1) AS UNSIGNED)), 0)\n"
    f"         + IF(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) <= '{DAY[:4]}-{DAY[4:6]}-{DAY[6:]}', {GAP}, 0) AS base\n"
    f"    FROM packing x WHERE x.tenant_id = '{TENANT}' AND x.packing_no LIKE 'PACK-{DAY}-%'\n"
    "      AND ((x.id >> 12) & 1023) <> 1001")

HEADER_GUARD = (
    "WHERE NOT EXISTS (SELECT 1 FROM packing x WHERE x.id = v.id)\n"
    "    AND NOT EXISTS (SELECT 1 FROM packing x WHERE x.gd_id = v.gd_id AND x.is_deleted = 0)\n"
    f"    AND EXISTS (SELECT 1 FROM goods_delivery g WHERE g.id = v.gd_num AND g.tenant_id = '{TENANT}'\n"
    "                AND g.gd_status = 'Created' AND g.is_deleted = 0)")


def child_guard(table):
    return (f"WHERE EXISTS (SELECT 1 FROM packing h WHERE h.id = v.packing_id)\n"
            f"  AND NOT EXISTS (SELECT 1 FROM {table} x WHERE x.id = v.id)")


def statements(rows):
    out = [("packing", *multi_insert("packing", rows["packing"], HEADER_GUARD, NUMBER_BASE))]
    for table in ("packing_jz8m9w3h_sub", "packing_blade_dept", "packing_Customer", "packing_sales_order"):
        chunk = 500
        for i in range(0, len(rows[table]), chunk):
            out.append((table, *multi_insert(table, rows[table][i:i + chunk], child_guard(table))))
    return out


def check_columns(rows):
    for table, rs in rows.items():
        have = {r["COLUMN_NAME"] for r in rt.db(
            f"SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='{table}'")}
        cols = [c for c, _ in rs[0] if c not in NOT_INSERTED]
        assert not [c for c in cols if c not in have], (table, [c for c in cols if c not in have])
        assert len(cols) == len(set(cols)), (table, "duplicate column")


# ---------------------------------------------------------------- checks

JSON_COLS = {"so_id", "customer_id", "assigned_to"}  # packing's json columns


def same_value(mine, db, col):
    """mine: what this script writes; db: the column as .dbtools returns it (decimals and JSON as text)."""
    if isinstance(mine, Raw):
        return True
    if mine is None or db is None:
        return mine is None and db is None
    if isinstance(mine, float):
        return abs(mine - float(db)) < EPS
    if isinstance(mine, int):
        return str(mine) == str(db) or (isinstance(db, str) and abs(mine - float(db)) < EPS)
    if col in JSON_COLS:
        return json.loads(mine) == json.loads(db)
    return mine == db


def compare_rows(label, mine, db_rows, key):
    """Every column this script writes equals the platform's row; every other column is NULL there."""
    db_by = {str(r[key]): r for r in db_rows}
    assert len(mine) == len(db_rows), (label, len(mine), len(db_rows))
    for row in mine:
        m = dict(row)
        d = db_by[str(m[key])]
        for c, v in m.items():
            if c in NOT_INSERTED or c in ("id", "packing_id", "packing_no"):
                continue
            assert same_value(v, d[c], c), (label, c, v, d[c])
        unwritten = [c for c in d if c not in m and d[c] is not None and c not in ("id", "packing_id")]
        assert not unwritten, (label, "columns the platform filled that this script leaves NULL", unwritten)
    return len(mine)


def check_reference():
    """Run 2109783579109232642 created PACK-20261013-0493: same replay, same rows."""
    params, nodes = recorded(REF_RUN)
    now = rt.run_time_ms(REF_RUN)
    pm, gz = replay(params, nodes, now)
    assert rt.same_as_recorded(pm, nodes["code_node_pMVdQBEQ"]["data"]), "pMVdQBEQ replay differs from the run"
    assert rt.same_as_recorded(gz, nodes["code_node_gudzrvMQ"]["data"]), "gudzrvMQ replay differs from the run"

    # the GD masters rebuilt from the database give the same Packing for GD-2610-237
    rebuilt = dict(nodes, search_node_c7BtNx91=search(gd_masters(nodes["code_node_oHIIKfiw"]["data"]["gdIds"])),
                   get_node_V4PP8WJI=packing_setup())
    _, gz2 = replay(params, rebuilt, now)
    [p] = gz["packingsToCreate"]
    [p2] = [x for x in gz2["packingsToCreate"] if x["gd_id"] == p["gd_id"]]
    assert rt.same(p, p2), "GD masters rebuilt from the DB give a different Packing for GD-2610-237"

    [hdr] = rt.db(f"SELECT * FROM packing WHERE id = {REF_PACKING}")
    assert hdr["gd_no"] == p["gd_no"] == "GD-2610-237" and hdr["create_time"] == hdr["update_time"]
    rows = rows_for([p], ID_TIME_MS)
    rows["packing"][0] = [(c, REF_PACKING if c == "id" else v) for c, v in rows["packing"][0]]
    n = compare_rows("packing", rows["packing"], [hdr], "id")
    keys = {"packing_jz8m9w3h_sub": "gd_line_id", "packing_blade_dept": "blade_dept_id",
            "packing_Customer": "Customer_id", "packing_sales_order": "sales_order_id"}
    for table, key in keys.items():
        db_rows = rt.db(f"SELECT * FROM {table} WHERE packing_id = {REF_PACKING}")
        n += compare_rows(table, rows[table], db_rows, key)
    print(f"reference OK: replay of run {REF_RUN} = recorded; DB-rebuilt GD masters give the same Packing; "
          f"{n} rows equal PACK-20261013-0493's column for column")


def check_payload(pm, gz, gds):
    assert pm["shouldTriggerAutoPacking"] == 1 and not pm["huIdsAcrossGDs"]
    assert gz["hasCreates"] == 1 and gz["hasUpdates"] == 0 and not gz["packingsToUpdate"]
    packs = gz["packingsToCreate"]
    by_gd = {str(g["id"]): g for g in gds}
    assert len(packs) == len(gds) == 300 and {str(p["gd_id"]) for p in packs} == set(by_gd)
    rows, qty = 0, 0.0
    for p in packs:
        g = by_gd[str(p["gd_id"])]
        allocations = [(l, t) for l in g["table_gd"] if l.get("material_id")
                       for t in json.loads(l.get("temp_qty_data") or "[]") if float(t.get("gd_quantity") or 0) > 0]
        assert p["gd_no"] == g["delivery_no"] and not p["table_hu_source"]
        assert [str(c) for c in p["customer_id"]] == [str(g["customer_name"])]
        assert [str(s) for s in p["so_id"]] == [str(s) for s in g["so_id"]]
        assert p["created_by"] == "joseph" and p["created_at"] == "2026-10-12" and str(p["to_id"]) == str(PICKING)
        assert len(p["table_item_source"]) == len(allocations), p["gd_no"]
        for r, (l, t) in zip(p["table_item_source"], allocations):
            assert str(r["gd_line_id"]) == str(l["id"]) and abs(r["total_quantity"] - float(t["gd_quantity"])) < EPS
            assert r["line_status"] == "Fully Picked" and abs(r["picked_qty"] - r["total_quantity"]) < EPS
            assert abs(r["remaining_qty"]) < EPS and abs(r["qty_to_pick"]) < EPS
            rows += 1
            qty += r["total_quantity"]
    print(f"payload OK: {len(packs)} Packings, {rows} item rows, all Fully Picked, total {qty:.3f}, no HU rows")
    return sorted(packs, key=lambda p: p["gd_no"])


# ---------------------------------------------------------------- output

def render(stmts, rows, gd_ids):
    ids = {t: [dict(r)["id"] for r in rs] for t, rs in rows.items()}
    hids = ", ".join(str(i) for i in ids["packing"])
    gds = ", ".join(str(g) for g in gd_ids)
    gd_strs = ", ".join(f"'{g}'" for g in gd_ids)
    lo, hi = min(min(v) for v in ids.values()), max(max(v) for v in ids.values())
    n_items = len(rows["packing_jz8m9w3h_sub"])
    n_sos = len(rows["packing_sales_order"])
    qty = sum(dict(r)["total_quantity"] for r in rows["packing_jz8m9w3h_sub"])
    day = f"{DAY[:4]}-{DAY[4:6]}-{DAY[6:]}"
    head = f"""-- R1: finish what PICKING never ran for PI-20261013-1502 (LSH, 300 GDs GD-2610-244..543).
-- Run 2109686904730554369 (2026-10-13 00:45) wrote the Picking and the GD lines, then died at the
-- sibling-Picking lookup. Generated by build_repair_sql.py from prod PICKING v77's own Packing code,
-- replayed on that run's recorded inputs. Tenant 128671 (LSH). See ../README.md.
--
-- Writes, in one transaction:
--   300 Packings (one per GD; {n_items} item rows, 600 plant rows, 300 customer rows, {n_sos} SO rows),
--   the 300 GD headers' picking_status -> Completed,
--   PI-20261013-1502 is_processing -> 0.
-- Numbers are PACK-{DAY}-NNNN, continuing after the highest PACK-{DAY} number when it runs; run on
-- {day} itself, 500 numbers are skipped first (the platform keeps its own counter and would
-- reach the next ones later that day). Every guard makes a re-run a no-op.

-- ========== BEFORE (read-only) -- each must return what its comment says ==========

-- B1: 1 row: Created | Created | '' | 300
SELECT gd_status, picking_status, COALESCE(packing_status, '') AS packing_status, COUNT(*) AS gds
FROM goods_delivery WHERE id IN ({gds}) AND tenant_id = '{TENANT}' AND is_deleted = 0
GROUP BY 1, 2, 3;

-- B2: 1 row: Completed | 2147 | 0 (every line picked or description-only; no bundle rows)
SELECT COALESCE(picking_status, '') AS picking_status, COUNT(*) AS line_count, SUM(item_bundle_id IS NOT NULL) AS bundle_rows
FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id IN ({gds}) AND is_deleted = 0
GROUP BY 1;

-- B3: 0 rows (no Packing for any of the 300 GDs yet)
SELECT id, packing_no, gd_no FROM packing WHERE gd_id IN ({gd_strs}) AND is_deleted = 0;

-- B4: 0 rows (the repair's ids are free)
""" + "\nUNION ALL\n".join(
        f"SELECT '{t}' AS tbl, COUNT(*) AS n FROM {t} WHERE id BETWEEN {lo} AND {hi} HAVING COUNT(*) > 0"
        for t in ids) + f""";

-- B5: 1 row: Completed | 1 | 2096 records
SELECT t.to_id, t.to_status, t.is_processing,
       (SELECT COUNT(*) FROM transfer_order_vrqs3cmr_sub r WHERE r.transfer_order_id = t.id AND r.is_deleted = 0) AS records
FROM transfer_order t WHERE t.id = {PICKING};

-- B6: the first and last number this repair will use
SELECT CONCAT('PACK-{DAY}-', LPAD(n.base + 1, 4, '0')) AS first_no,
       CONCAT('PACK-{DAY}-', LPAD(n.base + 300, 4, '0')) AS last_no
FROM ({NUMBER_BASE}) n;

-- ========== REPAIR (one transaction) ==========

START TRANSACTION;

"""
    body = []
    for table, sql, _ in stmts:
        body.append(f"-- {table}\n{sql}\n")
    tail = f"""-- GD headers: every line is picking-Completed, so the roll-up (B3E0 / GOODS_DELIVERY) gives Completed
UPDATE goods_delivery g
SET g.picking_status = 'Completed', g.update_user = {USER}, g.update_time = {NOW8}
WHERE g.id IN ({gds}) AND g.tenant_id = '{TENANT}' AND g.is_deleted = 0
  AND g.gd_status = 'Created' AND g.picking_status = 'Created'
  AND NOT EXISTS (SELECT 1 FROM goods_delivery_fwii8mvb_sub l WHERE l.goods_delivery_id = g.id AND l.is_deleted = 0
                  AND COALESCE(l.picking_status, '') <> 'Completed');

-- the Picking's lock, held since the run died
UPDATE transfer_order
SET is_processing = 0, update_user = {USER}, update_time = {NOW8}
WHERE id = {PICKING} AND tenant_id = '{TENANT}' AND is_processing = 1 AND to_status = 'Completed';

COMMIT;

-- ========== AFTER (read-only) ==========

-- A1: 1 row: Created | 300 | the B6 numbers
SELECT packing_status, COUNT(*) AS packings, MIN(packing_no) AS first_no, MAX(packing_no) AS last_no
FROM packing WHERE id IN ({hids}) GROUP BY 1;

-- A2: 1 row: {n_items} | {qty:.3f} | 600 | 300 | {n_sos}
SELECT
  (SELECT COUNT(*) FROM packing_jz8m9w3h_sub s WHERE s.packing_id IN ({hids}) AND s.is_deleted = 0) AS items,
  (SELECT ROUND(SUM(s.total_quantity), 3) FROM packing_jz8m9w3h_sub s WHERE s.packing_id IN ({hids}) AND s.is_deleted = 0) AS qty,
  (SELECT COUNT(*) FROM packing_blade_dept d WHERE d.packing_id IN ({hids}) AND d.is_deleted = 0) AS depts,
  (SELECT COUNT(*) FROM packing_Customer c WHERE c.packing_id IN ({hids}) AND c.is_deleted = 0) AS customers,
  (SELECT COUNT(*) FROM packing_sales_order o WHERE o.packing_id IN ({hids}) AND o.is_deleted = 0) AS sales_orders;

-- A3: 1 row: Completed | 300
SELECT picking_status, COUNT(*) AS gds FROM goods_delivery WHERE id IN ({gds}) AND is_deleted = 0 GROUP BY 1;

-- A4: 1 row: Completed | 0
SELECT to_status, is_processing FROM transfer_order WHERE id = {PICKING};

-- A5: 0 rows (no duplicate Packing numbers in LSH)
SELECT packing_no, COUNT(*) AS n FROM packing WHERE tenant_id = '{TENANT}'
GROUP BY packing_no HAVING COUNT(*) > 1;

-- A6 (later the same day / next day): LSH's next Packings keep the platform's own numbering, and A5 stays empty.
"""
    return head + "\n".join(body) + "\n" + tail


def preview(stmts, rows):
    """Runs the SELECT half of every INSERT and checks each value MySQL returns against the payload."""
    print("preview (read-only on prod):")
    expected = {t: {str(dict(r)["id"]): r for r in rs} for t, rs in rows.items()}
    for table, _, body in stmts:
        now = rt.db(body)
        if table == "packing":
            got = now
            nums = sorted(r["packing_no"] for r in got)
            note = f"numbers {nums[0]} .. {nums[-1]}" if got else "-"
        else:
            # until the headers exist the children's guard holds them back; check them without it
            got = rt.db(body.replace("WHERE EXISTS (SELECT 1 FROM packing h WHERE h.id = v.packing_id)\n  AND ", "WHERE "))
            note = f"{len(now)} now (held back until the headers exist)"
        for g in got:
            for c, v in expected[table][str(g["id"])]:
                if c not in NOT_INSERTED and c not in ("create_time", "update_time", "packing_no"):
                    assert same_value(v, g[c], c), (table, g["id"], c, v, g[c])
        print(f"  {table}: {len(got)} rows, every value as built; {note}")


def main():
    check_reference()

    params, nodes = recorded(RUN)
    gd_ids = nodes["code_node_oHIIKfiw"]["data"]["gdIds"]
    gds = gd_masters(gd_ids)
    so_ids = sorted({str(s) for g in gds for s in g.get("so_id", [])})
    sos = [as_fetched(r, "sales_order") for r in rt.db(
        f"SELECT * FROM sales_order WHERE id IN ({','.join(so_ids)}) AND is_deleted = 0")]
    gd_strs = ",".join(f"'{g}'" for g in gd_ids)
    existing = rt.db(f"SELECT * FROM packing WHERE gd_id IN ({gd_strs}) AND is_deleted = 0")
    assert not existing, f"a Packing already exists: {[p['packing_no'] for p in existing]}"
    nodes.update(get_node_V4PP8WJI=packing_setup(), search_node_c7BtNx91=search(gds),
                 search_node_FXknErTg=search([]), search_node_mUPqqQph=search([]),
                 search_node_i5v6z7Hu=search(sos))
    pm, gz = replay(params, nodes, rt.run_time_ms(RUN))
    packs = check_payload(pm, gz, gds)

    rows = rows_for(packs, ID_TIME_MS)
    check_columns(rows)
    stmts = statements(rows)
    print("rows:", {t: len(r) for t, r in rows.items()}, "statements:", Counter(t for t, _, _ in stmts))
    preview(stmts, rows)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sql = render(stmts, rows, sorted(int(g) for g in gd_ids))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"wrote {os.path.relpath(OUT, HERE)} ({len(sql.encode()) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
