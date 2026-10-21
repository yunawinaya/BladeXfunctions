"""build_repair_sql.py <lost.json> <out_dir> [GD number ...]: PROD repair SQL (the user runs it; prod is SELECT-only for us) for stock a
classic GD revert never put back (scan_lost.py's findings; default GDs: JO-01054 JO-01069). Per lost key, what GD_PROCESS_REVERT v14
would have written through ADD_INVENTORY_NEW: a GDL-R IN Unrestricted movement at the cost it left at (doc_date = the revert's day),
the batch balance and the item balance + qty, and a FIFO layer (its batch's next sequence, initial = available = qty). Reads the live
balance rows (read-only) to pin their ids. Writes ONE file, R1_gd_revert_direct_return_<tenant>.sql, in the layout of the earlier
prod repairs: BEFORE checks (read-only, expected results in their comments), the REPAIR in one transaction (each key's statements are
guarded by its repair movement id, so a second run changes nothing), AFTER checks, and a commented-out ROLLBACK (per key, only while
its new layer is untouched). FIFO batch items only; anything else stops here."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scratchpad", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402

EPOCH = 1288834974657
NOW8 = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"
DIG = lambda v: str(v).isdigit()

lost_file, out_dir = sys.argv[1], sys.argv[2]
want = sys.argv[3:] or ["JO-01054", "JO-01069"]
found = [g for g in json.load(open(lost_file)) if g["gd_no"] in want]
assert sorted(g["gd_no"] for g in found) == sorted(want), "not in the scan: %s" % sorted(set(want) - set(g["gd_no"] for g in found))
ms = int(time.time() * 1000)
seq = iter(range(4096))
new_id = lambda: ((ms - EPOCH) << 22) | (1001 << 12) | next(seq)
num = lambda v: format(round(float(v), 8), ".8f").rstrip("0").rstrip(".") or "0"
s = lambda v: "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"

rows = []
for g in found:
    T, plant, org, user = g["tenant"], g["plant_id"], g["org"], g["reverted_by"]
    assert DIG(T) and DIG(plant) and DIG(org) and DIG(user), g["gd_no"]
    for l in g["lost"]:
        assert not l["hu"], "%s: handling-unit stock is not repaired here" % g["gd_no"]
        assert l.get("cm") == "First In First Out", "%s: costing %s is not handled here" % (g["gd_no"], l.get("cm"))
        assert DIG(l["item"]) and DIG(l["batch"]) and DIG(l["bin"]) and DIG(l["buom"]), (g["gd_no"], l)
        ibb = q("--prod", f"SELECT CAST(id AS CHAR) AS id FROM item_batch_balance WHERE tenant_id = '{T}' AND plant_id = {plant} AND location_id = {l['bin']} "
                          f"AND material_id = {l['item']} AND batch_id = {l['batch']} AND is_deleted = 0")
        ib = q("--prod", f"SELECT CAST(id AS CHAR) AS id FROM item_balance WHERE tenant_id = '{T}' AND plant_id = {plant} AND location_id = {l['bin']} "
                         f"AND material_id = {l['item']} AND is_deleted = 0")
        it = q("--prod", f"SELECT CAST(based_uom AS CHAR) AS buom, material_costing_method AS cm FROM item WHERE id = {l['item']}")
        assert len(ibb) == 1 and len(ib) == 1, "%s %s/%s: %d batch / %d item balance rows" % (g["gd_no"], l["item"], l["batch"], len(ibb), len(ib))
        assert it and it[0]["buom"] == l["buom"] and it[0]["cm"] == l["cm"], (g["gd_no"], l["item"], it)
        top = q("--prod", f"SELECT COALESCE(MAX(CAST(fifo_sequence AS UNSIGNED)), 0) AS s FROM fifo_costing_history WHERE tenant_id = '{T}' AND material_id = {l['item']} "
                          f"AND batch_id = {l['batch']} AND plant_id = {plant} AND organization_id = '{org}' AND is_deleted = 0")
        cost = float(l["unit_cost"] or 0)
        rows.append(dict(gd=g["gd_no"], T=T, plant=plant, org=org, user=user, dept=plant, item=l["item"], batch=l["batch"], bin=l["bin"], buom=l["buom"],
                         qty=float(l["qty"]), cost=cost, parent=l.get("parent_no") or "", doc_date=g["reverted"][:10] + " 00:00:00",
                         ibb=ibb[0]["id"], ib=ib[0]["id"], mv=new_id(), layer=new_id(),
                         seq=int(top[0]["s"]) + 1 + sum(1 for x in rows if (x["item"], x["batch"]) == (l["item"], l["batch"]))))

rep, rb = [], []
for r in rows:
    q8, done, mine = num(r["qty"]), f"(SELECT 1 FROM inventory_movement x WHERE x.id = {r['mv']})", f"tenant_id = '{r['T']}'"
    untouched = f"(SELECT 1 FROM fifo_costing_history y WHERE y.id = {r['layer']} AND y.fifo_available_quantity = y.fifo_initial_quantity)"
    rep += [f"-- {r['gd']}: item {r['item']} batch {r['batch']} bin {r['bin']}: +{q8} Unrestricted at {num(r['cost'])}",
            f"UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + {q8}, balance_quantity = balance_quantity + {q8}, update_user = {r['user']}, update_time = {NOW8}\n"
            f" WHERE {mine} AND id = {r['ibb']} AND is_deleted = 0 AND NOT EXISTS {done};",
            f"UPDATE item_balance SET unrestricted_qty = unrestricted_qty + {q8}, balance_quantity = balance_quantity + {q8}, update_user = {r['user']}, update_time = {NOW8}\n"
            f" WHERE {mine} AND id = {r['ib']} AND is_deleted = 0 AND NOT EXISTS {done};",
            "INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,\n"
            "       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)\n"
            f"SELECT {r['layer']}, {num(r['cost'])}, {q8}, {q8}, {r['item']}, {r['batch']},\n"
            f"       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.{mine} AND f.material_id = {r['item']}\n"
            f"              AND f.batch_id = {r['batch']} AND f.plant_id = {r['plant']} AND f.organization_id = {s(r['org'])} AND f.is_deleted = 0) AS CHAR),\n"
            f"       {r['plant']}, {s(r['org'])}, {r['user']}, {r['dept']}, {NOW8}, {r['user']}, {NOW8}, 0, {s(r['T'])}, NULL\n"
            f"  FROM DUAL WHERE NOT EXISTS {done};",
            "INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,\n"
            "       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,\n"
            "       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,\n"
            "       handling_unit_id)\n"
            f"SELECT {r['mv']}, 'GDL-R', {s(r['gd'])}, 'Unrestricted', {s(r['parent'])}, 'IN', '', {num(r['cost'])}, {num(r['qty'] * r['cost'])}, {q8},\n"
            f"       {q8}, {r['buom']}, {r['buom']}, {r['item']}, {r['bin']}, {r['batch']}, 'First In First Out', {r['user']}, {r['dept']}, {NOW8}, {r['user']},\n"
            f"       {NOW8}, 0, {s(r['T'])}, {r['plant']}, {s(r['org'])}, {s(r['doc_date'])}, NULL, NULL, NULL, {q8}, {q8},\n"
            "       NULL\n"
            f"  FROM DUAL WHERE NOT EXISTS {done};", ""]
    rb += [f"-- {r['gd']}: item {r['item']} batch {r['batch']}: -{q8}",
           f"UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - {q8}, balance_quantity = balance_quantity - {q8}, update_time = {NOW8}\n"
           f" WHERE {mine} AND id = {r['ibb']} AND EXISTS {done} AND EXISTS {untouched};",
           f"UPDATE item_balance SET unrestricted_qty = unrestricted_qty - {q8}, balance_quantity = balance_quantity - {q8}, update_time = {NOW8}\n"
           f" WHERE {mine} AND id = {r['ib']} AND EXISTS {done} AND EXISTS {untouched};",
           f"DELETE FROM fifo_costing_history WHERE {mine} AND id = {r['layer']} AND fifo_available_quantity = fifo_initial_quantity;",
           f"DELETE FROM inventory_movement WHERE {mine} AND id = {r['mv']} AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = {r['layer']});", ""]
T = rows[0]["T"]
n = len(rows)
ids = lambda k: ", ".join(sorted(set(str(r[k]) for r in rows)))
short = lambda v: "…" + str(v)[-6:]
per_batch, per_item = {}, {}
for r in rows:
    per_batch[(r["item"], r["batch"])] = per_batch.get((r["item"], r["batch"]), 0) + r["qty"]
    per_item[r["item"]] = per_item.get(r["item"], 0) + r["qty"]
deltas = lambda d, fmt: ", ".join(fmt(k) + " +" + num(v) for k, v in sorted(d.items()))
REPAIR_ROWS = (f"SELECT (SELECT COUNT(*) FROM inventory_movement WHERE id IN ({ids('mv')})) AS movements,\n"
               f"       (SELECT COUNT(*) FROM fifo_costing_history WHERE id IN ({ids('layer')})) AS layers;")
BATCHES = ("SELECT CAST(b.material_id AS CHAR) AS item, CAST(b.batch_id AS CHAR) AS batch, b.unrestricted_qty, b.balance_quantity,\n"
           "       (SELECT SUM(f.fifo_available_quantity) FROM fifo_costing_history f WHERE f.tenant_id = b.tenant_id AND f.material_id = b.material_id\n"
           "          AND f.batch_id = b.batch_id AND f.plant_id = b.plant_id AND f.is_deleted = 0) AS fifo_available\n"
           f"  FROM item_batch_balance b WHERE b.tenant_id = '{T}' AND b.id IN ({ids('ibb')}) ORDER BY b.material_id, b.batch_id;")
ITEMS = ("SELECT CAST(i.material_id AS CHAR) AS item, i.unrestricted_qty, i.balance_quantity,\n"
         "       (SELECT SUM(b.unrestricted_qty) FROM item_batch_balance b WHERE b.tenant_id = i.tenant_id AND b.material_id = i.material_id\n"
         "          AND b.location_id = i.location_id AND b.plant_id = i.plant_id AND b.is_deleted = 0) AS batches_unrestricted,\n"
         "       (SELECT SUM(b.balance_quantity) FROM item_batch_balance b WHERE b.tenant_id = i.tenant_id AND b.material_id = i.material_id\n"
         "          AND b.location_id = i.location_id AND b.plant_id = i.plant_id AND b.is_deleted = 0) AS batches_balance\n"
         f"  FROM item_balance i WHERE i.tenant_id = '{T}' AND i.id IN ({ids('ib')}) ORDER BY i.material_id;")
LAYERS = ("SELECT CAST(material_id AS CHAR) AS item, CAST(batch_id AS CHAR) AS batch, fifo_sequence, fifo_initial_quantity, fifo_available_quantity, fifo_cost_price\n"
          f"  FROM fifo_costing_history WHERE id IN ({ids('layer')}) ORDER BY id;")
MOVES = ("SELECT trx_no, transaction_type, movement, inventory_category, CAST(item_id AS CHAR) AS item, CAST(batch_number_id AS CHAR) AS batch, base_qty, unit_price, doc_date\n"
         f"  FROM inventory_movement WHERE id IN ({ids('mv')}) ORDER BY id;")
when = time.strftime("%Y-%m-%d %H:%M", time.gmtime(ms / 1000 + 8 * 3600))
gds = ", ".join(want)
out = [f"-- R1: stock the classic GD revert never put back, tenant {T}: {gds} ({n} keys, {num(sum(r['qty'] for r in rows))} units).",
       "-- Classic GD_PROCESS_REVERT <= v13 returned only reserved stock; what a completion took straight from Unrestricted stayed out",
       "-- (fixed in v14). Per key this writes what v14 would have written through ADD_INVENTORY_NEW: a GDL-R IN Unrestricted movement",
       "-- at the cost it left at (doc_date = the revert's day; user = who reverted), the batch balance and the item balance + qty, and",
       "-- a FIFO layer (its batch's next sequence, initial = available = qty). Generated %s MYT by build_repair_sql.py; see ../README.md." % when,
       "-- Each key's statements are guarded by its repair movement id: a second run changes nothing.",
       "",
       "-- ========== BEFORE (read-only) -- each must return what its comment says ==========",
       "",
       "-- B1: 1 row: 0 | 0 (the repair has not run; its ids are free)",
       REPAIR_ROWS, "",
       f"-- B2: {len(per_batch)} rows; fifo_available = balance_quantity on every row. Note unrestricted_qty and balance_quantity (A2 compares).",
       BATCHES, "",
       f"-- B3: {len(per_item)} rows; unrestricted_qty = batches_unrestricted and balance_quantity = batches_balance on every row. Note them (A3).",
       ITEMS, "",
       "-- ========== REPAIR (one transaction) ==========", "", "START TRANSACTION;", ""] + rep + ["COMMIT;", "",
       "-- ========== AFTER (read-only) ==========", "",
       f"-- A1: 1 row: {n} | {n}",
       REPAIR_ROWS, "",
       f"-- A2: {len(per_batch)} rows; fifo_available = balance_quantity again; unrestricted_qty and balance_quantity = B2 + "
       + deltas(per_batch, lambda k: short(k[0]) + "/" + short(k[1])) + " (other deliveries in between move them too)",
       BATCHES, "",
       f"-- A3: {len(per_item)} rows; the sums match again; unrestricted_qty and balance_quantity = B3 + " + deltas(per_item, short),
       ITEMS, "",
       f"-- A4: {n} rows (the new FIFO layers): fifo_sequence " + ", ".join(str(r["seq"]) for r in rows) + "; initial = available = "
       + ", ".join(num(r["qty"]) for r in rows) + "; cost " + ", ".join(num(r["cost"]) for r in rows),
       LAYERS, "",
       f"-- A5: {n} rows (the new movements): " + ", ".join("%s %s +%s" % (r["gd"], short(r["item"]), num(r["qty"])) for r in rows)
       + "; GDL-R | IN | Unrestricted; doc_date = the revert's day",
       MOVES, "",
       "-- ========== ROLLBACK (only to undo the repair: uncomment and run this block) ==========",
       "-- Undoes a key only while its new FIFO layer is untouched (nothing consumed from it yet); a key already consumed stays.",
       ""] + ["-- " + l if l else "--" for l in "\n".join(["START TRANSACTION;", ""] + rb + ["COMMIT;"]).split("\n")]
os.makedirs(out_dir, exist_ok=True)
name = "R1_gd_revert_direct_return_%s.sql" % T
open(os.path.join(out_dir, name), "w").write("\n".join(out) + "\n")
json.dump(rows, open(os.path.join(out_dir, "repair_rows.json"), "w"), indent=1)
print("%d keys from %s: %s units -> %s (+ repair_rows.json)" % (n, gds, num(sum(r["qty"] for r in rows)), os.path.join(out_dir, name)))
for r in rows:
    print("  %s item %s batch %s +%s at %s (batch balance %s, item balance %s, movement %s, layer %s)" % (r["gd"], r["item"], r["batch"], num(r["qty"]), num(r["cost"]), r["ibb"], r["ib"], r["mv"], r["layer"]))
