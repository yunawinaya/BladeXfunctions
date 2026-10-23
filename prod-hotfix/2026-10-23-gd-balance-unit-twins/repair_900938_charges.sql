-- Optional prod repair 2026-10-23, tenant 900938: item CHARGES (1986606718841827330). Its only stock balance row is on unit UNIT
-- while the item's base unit is KGS; the item converts 1 UNIT = 1 KGS, so the stored quantity is already in base units.
-- GD Created V2 refuses it ("the stock balance at this bin is in unit ... but the item's base unit is unit ..."): 3 refusals
-- of SO-26/10/0546 on 10-23 12:14-12:17. Classic never compared the units (1,097 GD lines used CHARGES, the last 10-22).
-- Only the unit reference changes. Ask the client first whether CHARGES should be stock-controlled at all (a charge line).

-- 1. preview (1 row)
SELECT CAST(b.id AS CHAR) AS balance_id, b.material_uom, b.unrestricted_qty, b.reserved_qty
  FROM item_balance b
 WHERE b.tenant_id = '900938' AND b.id = 1988168826256633858 AND b.material_id = 1986606718841827330
   AND b.material_uom = 1963082541029847042 AND b.is_deleted = 0;

-- 2. update: UNIT (1963082541029847042) -> KGS (1963082541029847049), the item's base unit
UPDATE item_balance
   SET material_uom = 1963082541029847049
 WHERE tenant_id = '900938' AND id = 1988168826256633858 AND material_id = 1986606718841827330
   AND material_uom = 1963082541029847042 AND is_deleted = 0;
