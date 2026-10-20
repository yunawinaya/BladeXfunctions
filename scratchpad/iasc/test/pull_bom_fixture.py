"""python3 scratchpad/iasc/test/pull_bom_fixture.py [tenant] - READ-ONLY dump of a dev tenant's active BOMs, their component
rows and items (with UOM conversions) for test/bulk_sc_bom.js. Dev 711077 holds a copy of a prod customer's BOMs, so the
fixture lives OUTSIDE the repo (FIXTURE below)."""
import json, os, sys, time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "iav2", "lib"))
from dbq import q  # noqa: E402

TENANT = sys.argv[1] if len(sys.argv) > 1 else "711077"
assert TENANT.isdigit()
FIXTURE = os.path.expanduser("~/Documents/ASC-dev/iasc-fixtures/bom%s.json" % TENANT)

heads = q("--dev", f"""SELECT CAST(id AS CHAR) id, CAST(parent_material_code AS CHAR) parent_material_code, parent_mat_bom_version,
       CAST(parent_mat_base_quantity AS CHAR) parent_mat_base_quantity, CAST(parent_mat_base_uom AS CHAR) parent_mat_base_uom,
       parent_mat_is_default, is_active, CAST(organization_id AS CHAR) organization_id
  FROM bill_of_materials WHERE tenant_id = '{TENANT}' AND is_deleted = 0 AND is_active = 1 ORDER BY id""")
rows = q("--dev", f"""SELECT CAST(c.bill_of_materials_id AS CHAR) bom_id, CAST(c.id AS CHAR) id, CAST(c.bom_material_code AS CHAR) bom_material_code,
       c.sub_material_name, c.sub_material_desc, CAST(c.sub_material_qty AS CHAR) sub_material_qty,
       CAST(c.sub_material_qty_uom AS CHAR) sub_material_qty_uom, c.sub_material_wastage, c.sub_material_remark,
       c.consume_type, c.bom_type, CAST(c.ref_bom_id AS CHAR) ref_bom_id
  FROM bill_of_materials_ttux02kq_sub c JOIN bill_of_materials b ON b.id = c.bill_of_materials_id
 WHERE b.tenant_id = '{TENANT}' AND b.is_deleted = 0 AND b.is_active = 1 AND c.is_deleted = 0
 ORDER BY c.bill_of_materials_id, c.id""", limit=500000)
items = q("--dev", f"""SELECT CAST(i.id AS CHAR) id, i.material_code, i.material_name, i.material_desc, CAST(i.based_uom AS CHAR) based_uom,
       i.serial_number_management, i.stock_control
  FROM item i WHERE i.tenant_id = '{TENANT}' AND i.is_deleted = 0
   AND (i.id IN (SELECT b.parent_material_code FROM bill_of_materials b WHERE b.tenant_id = '{TENANT}' AND b.is_deleted = 0)
        OR i.id IN (SELECT c.bom_material_code FROM bill_of_materials_ttux02kq_sub c WHERE c.tenant_id = '{TENANT}' AND c.is_deleted = 0))""", limit=500000)
convs = q("--dev", f"""SELECT CAST(u.Item_id AS CHAR) item_id, CAST(u.alt_uom_id AS CHAR) alt_uom_id, CAST(u.alt_qty AS CHAR) alt_qty,
       CAST(u.base_qty AS CHAR) base_qty, CAST(u.base_uom_id AS CHAR) base_uom_id
  FROM item_mji552rc_sub u WHERE u.tenant_id = '{TENANT}' AND u.is_deleted = 0""", limit=500000)

by_bom = {}
for r in rows:
    by_bom.setdefault(r.pop("bom_id"), []).append(r)
for h in heads:
    h["subform_sub_material"] = by_bom.get(h["id"], [])
by_item = {}
for c in convs:
    by_item.setdefault(c.pop("item_id"), []).append(c)
for it in items:
    it["table_uom_conversion"] = by_item.get(it["id"], [])
os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
with open(FIXTURE, "w") as f:
    json.dump({"tenant": TENANT, "pulledAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "boms": heads, "items": items}, f)
print(f"{FIXTURE}: {len(heads)} BOMs, {len(rows)} component rows, {len(items)} items, {len(convs)} conversions")
