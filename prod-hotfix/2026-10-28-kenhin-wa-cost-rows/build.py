#!/usr/bin/env python3
"""Kenhin (528521): migrate the cost rows of Weighted Average items that still carry only FIFO rows, the way classic
SUBTRACT_INVENTORY_NEW's "Migrate Costing Incorrect Data" does (code_node_oz7GGSQA -> add_node_yOylfPVp "Add WA" ->
update_node_zI1Dn0Ne "Delete FIFO"). The stock engine refuses such items (UNSUPPORTED_COSTING), so GD Completed V2 cannot
complete a GD that carries one (GD/20261028/2216, B03-45, 2026-10-28 11:42).

Per key (material + plant + organization + batch):
- one wa_costing_method row: wa_quantity = the FIFO rows' available quantity (rows > 0), wa_cost_price = their weighted
  cost, batch as the key; created_at / updated_at '' and sub_tenant_id NULL, as the platform's own WA rows at Kenhin;
- the FIFO rows: is_deleted = 1.
Classic did exactly this for TY-KT06 at Kenhin on 2026-10-23 16:01:31 (FIFO 2058950403176185857 -> WA 2113541314787282945).

Writes migrate.sql (checks, guarded statements, after-checks) and rollback.sql. Read-only on prod.
usage: python3 build.py
"""
import json, os, subprocess
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "..", ".dbtools", "db")
TENANT = "528521"
ID_TIME_MS = 1793160000000            # 2026-10-28 ~12:00 MYT; repair ids use worker 1001
NOW8 = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"
Q8 = Decimal("0.00000001")
# V97: its second FIFO layer is MSR-20260924-0007 (999,999,999 at 52.00); merged it would cost 51.95 a unit. Kenhin decides.
EXCLUDE = {"V97"}


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr.strip()[-600:])
    return json.loads(out.stdout[out.stdout.find("["):])


def snowflake(i):
    return ((ID_TIME_MS - 1288834974657) << 22) | (1001 << 12) | i


def keys():
    """The keys the engine refuses for a WA item: FIFO rows and no WA row (same rule as engine/core.js, WA branch)."""
    return q(f"""
SELECT CAST(k.material_id AS CHAR) material_id, i.material_code code, k.plant_id, k.organization_id, k.batch_id
  FROM (SELECT material_id, plant_id, organization_id, IFNULL(CAST(batch_id AS CHAR), '') batch_id,
               SUM(src = 'F') fifo_n, SUM(src = 'W') wa_n
          FROM (SELECT material_id, plant_id, organization_id, batch_id, 'F' src FROM fifo_costing_history
                 WHERE tenant_id = '{TENANT}' AND is_deleted = 0
                UNION ALL
                SELECT material_id, plant_id, organization_id, batch_id, 'W' FROM wa_costing_method
                 WHERE tenant_id = '{TENANT}' AND is_deleted = 0) u
         GROUP BY material_id, plant_id, organization_id, IFNULL(CAST(batch_id AS CHAR), '')) k
  JOIN item i ON i.id = k.material_id AND i.tenant_id = '{TENANT}'
 WHERE i.material_costing_method = 'Weighted Average' AND k.wa_n = 0 AND k.fifo_n > 0
 ORDER BY i.material_code""")



def fifo_rows(k):
    batch = f"batch_id = {k['batch_id']}" if k["batch_id"] else "batch_id IS NULL"
    return q(f"""SELECT CAST(id AS CHAR) id, fifo_available_quantity avail, fifo_cost_price price, CAST(create_user AS CHAR) cu,
                        CAST(create_dept AS CHAR) cd FROM fifo_costing_history
                  WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND material_id = {k['material_id']}
                    AND plant_id = '{k['plant_id']}' AND organization_id = '{k['organization_id']}' AND {batch} ORDER BY id""")


def lit(v):
    return "NULL" if v is None else (str(v) if isinstance(v, (int, Decimal)) else "'" + str(v).replace("'", "''") + "'")


def main():
    plan = []
    for n, k in enumerate([k for k in keys() if k["code"] not in EXCLUDE]):
        rows = fifo_rows(k)
        qty, cost = Decimal(0), Decimal(0)
        for r in rows:
            a = Decimal(r["avail"]).quantize(Q8)
            if a > 0:
                qty += a
                cost += (a * Decimal(r["price"])).quantize(Q8)
        price = (cost / qty).quantize(Q8, ROUND_HALF_UP) if qty > 0 else Decimal(0)
        assert price == 0, (k["code"], price)
        plan.append({"k": k, "fifo": rows, "id": snowflake(n), "qty": qty, "price": price,
                     "user": int(rows[0]["cu"]), "dept": int(rows[0]["cd"])})
    fifo_ids = [r["id"] for p in plan for r in p["fifo"]]
    exp_rows = ", ".join(f"({r['id']}, {Decimal(r['avail']).quantize(Q8)})" for p in plan for r in p["fifo"])
    cols = ["id", "wa_quantity", "material_id", "batch_id", "create_user", "create_dept", "create_time", "update_user",
            "update_time", "is_deleted", "tenant_id", "plant_id", "organization_id", "updated_at", "created_at", "wa_cost_price",
            "sub_tenant_id"]
    values = ",\n".join(
        "  ROW(" + ", ".join([str(p["id"]), str(p["qty"]), p["k"]["material_id"], p["k"]["batch_id"] or "NULL", str(p["user"]),
                             str(p["dept"]), NOW8, str(p["user"]), NOW8, "0", lit(TENANT), lit(p["k"]["plant_id"]),
                             lit(p["k"]["organization_id"]), "''", "''", str(p["price"]), "NULL"]) + ")" for p in plan)
    wa_ids = ", ".join(str(p["id"]) for p in plan)
    listing = "\n".join(f"--   {p['k']['code']:<18} FIFO {', '.join(r['id'] for r in p['fifo'])} -> WA {p['id']}  qty {p['qty']}  "
                        f"price {p['price']}" for p in plan)
    sql = f"""-- Kenhin (tenant {TENANT}): {len(plan)} Weighted Average items whose only cost rows are FIFO get one WA row each, and
-- their {len(fifo_ids)} FIFO rows are retired. Same as classic SUBTRACT_INVENTORY_NEW's "Migrate Costing Incorrect Data" (done
-- by classic for TY-KT06 on 2026-10-23). Unblocks GD Completed V2 for these items (GD/20261028/2216 first). Built by build.py.
{listing}

-- PART 1: checks (all must match)
SELECT COUNT(*) AS fifo_rows_to_retire FROM fifo_costing_history
 WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND (id, fifo_available_quantity) IN ({exp_rows});
--   expect: {len(fifo_ids)}
SELECT COUNT(*) AS wa_rows_already FROM wa_costing_method w JOIN fifo_costing_history f
    ON f.tenant_id = w.tenant_id AND f.material_id = w.material_id AND f.plant_id = w.plant_id AND f.organization_id = w.organization_id
 WHERE w.tenant_id = '{TENANT}' AND w.is_deleted = 0 AND f.id IN ({', '.join(fifo_ids)});
--   expect: 0

-- PART 2: the migration (expected rows affected: {len(plan)} / {len(fifo_ids)})
INSERT INTO wa_costing_method ({', '.join(cols)})
SELECT v.* FROM (VALUES
{values}
) AS v({', '.join(cols)})
WHERE NOT EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = v.tenant_id AND w.material_id = v.material_id
                     AND w.plant_id = v.plant_id AND w.organization_id = v.organization_id AND w.is_deleted = 0)
  AND EXISTS (SELECT 1 FROM fifo_costing_history f WHERE f.tenant_id = v.tenant_id AND f.material_id = v.material_id
                 AND f.plant_id = v.plant_id AND f.organization_id = v.organization_id AND f.is_deleted = 0);

UPDATE fifo_costing_history
   SET is_deleted = 1, update_time = {NOW8}
 WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND (id, fifo_available_quantity) IN ({exp_rows});

-- PART 3: after-checks
SELECT COUNT(*) AS wa_rows_added FROM wa_costing_method WHERE tenant_id = '{TENANT}' AND id IN ({wa_ids}) AND is_deleted = 0;
--   expect: {len(plan)}
SELECT COUNT(*) AS fifo_rows_still_active FROM fifo_costing_history WHERE tenant_id = '{TENANT}' AND id IN ({', '.join(fifo_ids)}) AND is_deleted = 0;
--   expect: 0
"""
    rollback = f"""-- Kenhin: undo migrate.sql, only while the WA rows are untouched (no delivery has used them since).
-- PART 1: expect {len(plan)} untouched WA rows
SELECT COUNT(*) AS untouched FROM wa_costing_method WHERE tenant_id = '{TENANT}' AND id IN ({wa_ids}) AND create_time = update_time;

-- PART 2: expected rows affected: {len(fifo_ids)} / {len(plan)}
UPDATE fifo_costing_history SET is_deleted = 0, update_time = {NOW8}
 WHERE tenant_id = '{TENANT}' AND is_deleted = 1 AND id IN ({', '.join(fifo_ids)});
DELETE FROM wa_costing_method WHERE tenant_id = '{TENANT}' AND id IN ({wa_ids}) AND create_time = update_time;
"""
    open(os.path.join(HERE, "migrate.sql"), "w").write(sql)
    open(os.path.join(HERE, "rollback.sql"), "w").write(rollback)
    json.dump([{"code": p["k"]["code"], "material_id": p["k"]["material_id"], "fifo": [r["id"] for r in p["fifo"]],
                "wa_id": str(p["id"]), "qty": str(p["qty"]), "price": str(p["price"])} for p in plan],
              open(os.path.join(HERE, "plan.json"), "w"), indent=1)
    print(f"{len(plan)} items, {len(fifo_ids)} FIFO rows -> migrate.sql / rollback.sql / plan.json")


if __name__ == "__main__":
    main()
