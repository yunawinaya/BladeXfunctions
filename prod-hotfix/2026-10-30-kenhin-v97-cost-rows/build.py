#!/usr/bin/env python3
"""Kenhin (528521): migrate V97's cost rows the way classic SUBTRACT_INVENTORY_NEW v25 "Migrate Costing Incorrect Data" does
(code_node_oz7GGSQA -> add_node_yOylfPVp "Add WA" -> update_node_zI1Dn0Ne "Delete FIFO"), so GD Completed V2 can complete
GD/20261030/2341 (refused 2026-10-30 11:23:05, UNSUPPORTED_COSTING "FIFO 2, WA 0"). Same shape as
../2026-10-28-kenhin-wa-cost-rows/, which left V97 out; the user chose classic's result on 10-30.

- one wa_costing_method row: wa_quantity = the FIFO rows' available quantity (rows > 0), wa_cost_price = their weighted cost,
  each step rounded to 8 dp as the live node's q8 does;
- the FIFO rows: is_deleted = 1.
Both statements only act while the FIFO rows still hold the planned quantities.

Writes migrate.sql, rollback.sql and plan.json. Read-only on prod.   usage: python3 build.py
"""
import json, os, subprocess
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "..", ".dbtools", "db")
TENANT = "528521"
CODES = {"V97"}
ID_TIME_MS = 1793332800000            # 2026-10-30 ~12:00 MYT; repair ids use worker 1001
NOW8 = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"
Q8 = Decimal("0.00000001")


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr.strip()[-600:])
    return json.loads(out.stdout[out.stdout.find("["):])


def q8(v):
    return Decimal(v).quantize(Q8, ROUND_HALF_UP)


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
    for n, k in enumerate([k for k in keys() if k["code"] in CODES]):
        rows = fifo_rows(k)
        qty, cost = Decimal(0), Decimal(0)
        for r in rows:
            a = q8(r["avail"])
            if a > 0:
                qty = q8(qty + a)
                cost = q8(cost + a * q8(r["price"]))
        price = q8(cost / qty) if qty > 0 else Decimal(0)
        plan.append({"k": k, "fifo": rows, "id": snowflake(n), "qty": qty, "price": price,
                     "user": int(rows[0]["cu"]), "dept": int(rows[0]["cd"])})
    assert [p["k"]["code"] for p in plan] == sorted(CODES), [p["k"]["code"] for p in plan]
    fifo_ids = [r["id"] for p in plan for r in p["fifo"]]
    exp_rows = ", ".join(f"({r['id']}, {q8(r['avail'])})" for p in plan for r in p["fifo"])
    cols = ["id", "wa_quantity", "material_id", "batch_id", "create_user", "create_dept", "create_time", "update_user",
            "update_time", "is_deleted", "tenant_id", "plant_id", "organization_id", "updated_at", "created_at", "wa_cost_price",
            "sub_tenant_id"]
    values = ",\n".join(
        "  ROW(" + ", ".join([str(p["id"]), str(p["qty"]), p["k"]["material_id"], p["k"]["batch_id"] or "NULL", str(p["user"]),
                             str(p["dept"]), NOW8, str(p["user"]), NOW8, "0", lit(TENANT), lit(p["k"]["plant_id"]),
                             lit(p["k"]["organization_id"]), "''", "''", str(p["price"]), "NULL"]) + ")" for p in plan)
    wa_ids = ", ".join(str(p["id"]) for p in plan)
    fifo_unchanged = (f"(SELECT COUNT(*) FROM fifo_costing_history f WHERE f.tenant_id = '{TENANT}' AND f.is_deleted = 0 "
                      f"AND (f.id, f.fifo_available_quantity) IN ({exp_rows})) = {len(fifo_ids)}")
    listing = "\n".join(f"--   {p['k']['code']:<6} FIFO {', '.join(r['id'] for r in p['fifo'])} -> WA {p['id']}  qty {p['qty']}  "
                        f"price {p['price']}" for p in plan)
    sql = f"""-- Kenhin (tenant {TENANT}): V97 (Weighted Average) carries only FIFO cost rows, so GD Completed V2 refuses
-- GD/20261030/2341 (UNSUPPORTED_COSTING). Same as classic SUBTRACT_INVENTORY_NEW's "Migrate Costing Incorrect Data":
-- one WA row (the FIFO rows' available quantity at their weighted cost), FIFO rows retired. Built by build.py.
{listing}

-- PART 1: checks (all must match)
SELECT COUNT(*) AS fifo_rows_to_retire FROM fifo_costing_history
 WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND (id, fifo_available_quantity) IN ({exp_rows});
--   expect: {len(fifo_ids)}
SELECT COUNT(*) AS wa_rows_already FROM wa_costing_method
 WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND material_id IN ({', '.join(p['k']['material_id'] for p in plan)});
--   expect: 0
SELECT COUNT(*) AS new_id_taken FROM wa_costing_method WHERE id IN ({wa_ids});
--   expect: 0

-- PART 2: the migration (expected rows affected: {len(plan)}, then {len(fifo_ids)})
INSERT INTO wa_costing_method ({', '.join(cols)})
SELECT v.* FROM (VALUES
{values}
) AS v({', '.join(cols)})
WHERE NOT EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = v.tenant_id AND w.material_id = v.material_id
                     AND w.plant_id = v.plant_id AND w.organization_id = v.organization_id AND w.is_deleted = 0)
  AND {fifo_unchanged};

UPDATE fifo_costing_history
   SET is_deleted = 1, update_time = {NOW8}
 WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND (id, fifo_available_quantity) IN ({exp_rows})
   AND EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = '{TENANT}' AND w.id IN ({wa_ids}) AND w.is_deleted = 0);

-- PART 3: after-checks
SELECT CAST(id AS CHAR) id, wa_quantity, wa_cost_price FROM wa_costing_method WHERE tenant_id = '{TENANT}' AND id IN ({wa_ids}) AND is_deleted = 0;
--   expect: {'; '.join(f"{p['id']} {p['qty']} {p['price']}" for p in plan)}
SELECT COUNT(*) AS fifo_rows_still_active FROM fifo_costing_history WHERE tenant_id = '{TENANT}' AND id IN ({', '.join(fifo_ids)}) AND is_deleted = 0;
--   expect: 0
"""
    rollback = f"""-- Kenhin: undo migrate.sql, only while the WA row is untouched (no delivery has used it since).
-- PART 1: expect {len(plan)} untouched WA row(s)
SELECT COUNT(*) AS untouched FROM wa_costing_method WHERE tenant_id = '{TENANT}' AND id IN ({wa_ids}) AND create_time = update_time;

-- PART 2: expected rows affected: {len(fifo_ids)}, then {len(plan)}
UPDATE fifo_costing_history SET is_deleted = 0, update_time = {NOW8}
 WHERE tenant_id = '{TENANT}' AND is_deleted = 1 AND id IN ({', '.join(fifo_ids)})
   AND EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = '{TENANT}' AND w.id IN ({wa_ids}) AND w.create_time = w.update_time);
DELETE FROM wa_costing_method WHERE tenant_id = '{TENANT}' AND id IN ({wa_ids}) AND create_time = update_time;
"""
    open(os.path.join(HERE, "migrate.sql"), "w").write(sql)
    open(os.path.join(HERE, "rollback.sql"), "w").write(rollback)
    json.dump([{"code": p["k"]["code"], "material_id": p["k"]["material_id"], "fifo": [r["id"] for r in p["fifo"]],
                "wa_id": str(p["id"]), "qty": str(p["qty"]), "price": str(p["price"])} for p in plan],
              open(os.path.join(HERE, "plan.json"), "w"), indent=1)
    for p in plan:
        print(f"{p['k']['code']}: FIFO {', '.join(r['id'] + ' (' + str(q8(r['avail'])) + ' @ ' + str(q8(r['price'])) + ')' for r in p['fifo'])} "
              f"-> WA {p['id']} qty {p['qty']} price {p['price']}")


if __name__ == "__main__":
    main()
