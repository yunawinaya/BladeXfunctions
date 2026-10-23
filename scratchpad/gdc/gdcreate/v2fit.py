"""v2fit.py: the GD Created V2 fit, shared by GD_ASYNC_SUBMIT (patch_submit_v2fit.py) and SO_AUTO_GD
(scratchpad/soautogd/patch_so_auto_gd_v20.py): the JS library both copy verbatim, and the one read its facts come from.
Mirrors GD_BULK_PREPARE v17's reads: sql_node_rCfSqwDY (SETUP, HU), sql_node_tCdXcJ5e (ITEM), sql_node_UHFSm7AO (PEND).
Every argument is a placeholder the caller's own code node made digits-only (SO line ids quoted: parent_line_id is VARCHAR).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LIB_PATH = os.path.join(HERE, "code", "v2fit_lib.js")
COLUMNS = ["kind", "id", "f1", "f2", "f3", "f4", "f5"]


def lib():
    return open(LIB_PATH, encoding="utf-8").read().rstrip("\n") + "\n"


def fit_sql(org, plant, materials, auto_materials, so_lines, tenant=None):
    t = (lambda a: "\n   AND %s.tenant_id = '%s'" % (a, tenant)) if tenant else (lambda a: "")
    blank = "'' AS f2, '' AS f3, '' AS f4, '' AS f5"
    return f"""SELECT 'SETUP' AS kind, CAST(ps.id AS CHAR) AS id, COALESCE(CAST(ps.picking_mode AS CHAR), '') AS f1, {blank}
  FROM (SELECT p.id, p.picking_mode
          FROM picking_setup p
         WHERE p.organization_id = '{org}'{t("p")}
           AND p.is_deleted = 0
         ORDER BY p.id
         LIMIT 1) ps
UNION ALL
SELECT 'ITEM' AS kind, CAST(i.id AS CHAR) AS id,
       CASE WHEN i.stock_control = 0 AND i.show_delivery = 0 THEN 'NS' ELSE COALESCE(CAST(i.stock_control AS CHAR), '') END AS f1,
       COALESCE(CAST(i.material_costing_method AS CHAR), '') AS f2,
       COALESCE(CAST(i.item_batch_management AS CHAR), '') AS f3,
       COALESCE(CAST(i.serial_number_management AS CHAR), '') AS f4,
       COALESCE(CAST(i.purchase_unit_price AS CHAR), '') AS f5
  FROM item i
 WHERE i.organization_id = '{org}'{t("i")}
   AND i.is_deleted = 0
   AND i.id IN ({materials})
UNION ALL
SELECT 'HU' AS kind, CAST(hi.material_id AS CHAR) AS id, '' AS f1, {blank}
  FROM handling_unit h
  JOIN handling_unit_atu7sreg_sub hi
    ON hi.handling_unit_id = h.id
   AND hi.is_deleted = 0
 WHERE h.organization_id = '{org}'{t("h")}
   AND h.plant_id = {plant}
   AND h.is_deleted = 0
   AND (h.packing_id IS NULL OR h.packing_id = '')
   AND hi.material_id IN ({auto_materials})
 GROUP BY hi.material_id
UNION ALL
SELECT 'PEND' AS kind, CAST(r.parent_line_id AS CHAR) AS id, '' AS f1, {blank}
  FROM on_reserved_gd r
 WHERE r.organization_id = '{org}'{t("r")}
   AND r.plant_id = {plant}
   AND r.is_deleted = 0
   AND r.status = 'Pending'
   AND r.parent_line_id IN ({so_lines})
 GROUP BY r.parent_line_id"""
