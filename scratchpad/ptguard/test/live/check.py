"""What the live test wrote (DEV, tenant 000000): every PTGUARD-* transfer incl. deleted twins, its pt_uuid, children,
stock movements per number, In Transit ledger rows, and the six test items' balances at both plants.

    python3 scratchpad/ptguard/test/live/check.py [snapshot-name]
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "..", "..", "..", ".dbtools", "db")
MATS = "2066341864143695874,2064262676831449089,2047134665199767554,2047206770768797698,2047206971399135233,2047235050834157570"


def q(sql):
    out = subprocess.run([DB, "--dev", "--json", "--limit", "500", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(re.sub(r"^\[(DEV|PROD)\][^\n]*\n", "", out))


docs = q("""SELECT CAST(h.id AS CHAR) id, h.stock_movement_no no, h.movement_type mt, h.stock_movement_status st, h.is_deleted del, h.remarks,
                   CAST(h.parent_id AS CHAR) parent, h.pt_uuid, h.create_time
              FROM plant_transfer h WHERE h.tenant_id = '000000' AND h.remarks LIKE 'PTGUARD-%' ORDER BY h.id""")
ids = [d["id"] for d in docs] or ["0"]
kids = q("""SELECT CAST(c.id AS CHAR) id, c.stock_movement_no no, c.stock_movement_status st, c.is_deleted del, CAST(c.parent_id AS CHAR) parent
              FROM plant_transfer c WHERE c.tenant_id = '000000' AND c.parent_id IN (%s) ORDER BY c.id""" % ",".join(ids))
nos = sorted({d["no"] for d in docs + kids if d["no"]} | {d["no"].replace("-Cancelled", "") for d in docs + kids if d["no"]})
mv = q("""SELECT trx_no, movement, inventory_category cat, COUNT(*) n, SUM(quantity) qty FROM inventory_movement
           WHERE tenant_id = '000000' AND is_deleted = 0 AND trx_no IN (%s) GROUP BY trx_no, movement, inventory_category ORDER BY trx_no"""
       % ",".join("'%s'" % n for n in nos)) if nos else []
led = q("""SELECT doc_no, status, COUNT(*) n, SUM(transit_qty) tq, SUM(open_qty) oq FROM in_transit_detail
            WHERE tenant_id = '000000' AND is_deleted = 0 AND doc_id IN (%s) GROUP BY doc_no, status""" % ",".join(ids))
bal = q("""SELECT CAST(material_id AS CHAR) mat, CAST(plant_id AS CHAR) plant, SUM(unrestricted_qty) unr, SUM(intransit_qty) transit
            FROM item_balance WHERE tenant_id = '000000' AND is_deleted = 0 AND material_id IN (%s)
             AND plant_id IN (1123598813738675202, 1123598813738675203) GROUP BY material_id, plant_id ORDER BY material_id, plant_id""" % MATS)
print("== PTGUARD documents")
for d in docs:
    print("  %-19s %-22s %-11s del=%s %-10s %s" % (d["id"], d["no"], d["st"], d["del"], d["remarks"], d["pt_uuid"]))
print("== receiving children")
for k in kids:
    print("  %-19s %-22s %-11s del=%s parent=%s" % (k["id"], k["no"], k["st"], k["del"], k["parent"]))
print("== stock movements")
for m in mv:
    print("  %-26s %-4s %-13s n=%s qty=%s" % (m["trx_no"], m["movement"], m["cat"], m["n"], m["qty"]))
print("== In Transit ledger")
for l in led:
    print("  %-22s %-11s n=%s transit=%s open=%s" % (l["doc_no"], l["status"], l["n"], l["tq"], l["oq"]))
print("== balances (item_balance, both plants)")
for b in bal:
    print("  %s @%s unrestricted=%s in_transit=%s" % (b["mat"], b["plant"][-3:], b["unr"], b["transit"]))
if len(sys.argv) > 1:
    snap = os.path.join(HERE, "out", sys.argv[1] + ".balances.json")
    os.makedirs(os.path.dirname(snap), exist_ok=True)
    json.dump(bal, open(snap, "w"), indent=1)
    print("saved", snap)
