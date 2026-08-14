-- =============================================================================
-- Delivery Info consolidation — data migration
--
-- Folds the five per-method delivery sections (Self Pickup, Courier Service,
-- Company Truck, Shipping Service, 3rd Party Transporter) into the 13 shared
-- di_* columns, across 7 modules.
--
-- Field-level source map: DELIVERY_INFO_MIGRATION.md (Appendix A of
-- MOBILE_DELIVERY_PROJECT_MIGRATION.md carries the same table).
--
-- DECISIONS BAKED IN
--   * Re-runnable      — every column is written through COALESCE, so a second
--                        run only fills what is still empty. Values already in
--                        di_* are never overwritten.
--   * Non-destructive  — legacy columns are read only. Nothing is dropped or
--                        nulled, so you can verify and re-run, or walk away.
--   * Unmatched → NULL — di_driver_name and di_vehicle_number store master-record
--                        ids. A typed name/plate with no master match is left
--                        NULL and listed by the STEP 0 reports.
--   * shipping_method  — the old Shipping-Service sub-choice is NOT migrated.
--                        di_shipping_method is a standalone Shipping Method FK.
--
-- RUN ORDER:  STEP 0 (read-only reports)  →  STEP 1 (updates)  →  STEP 2 (verify)
-- =============================================================================


-- =============================================================================
-- CONFIG — verify these 9 physical table names before running
-- =============================================================================
--
--   quotation             Quotation         (method col: sqt_delivery_method_id)
--   sales_order           Sales Order       (method col: so_delivery_method)
--   goods_delivery        Goods Delivery    (method col: gd_delivery_method)
--   picking_plan          Picking Plan      (method col: to_delivery_method)
--   transfer_order        Picking           (method col: delivery_method)
--   purchase_return_head  Purchase Return   (method col: return_delivery_method)
--   sales_return          Sales Return      (method col: sr_delivery_method)
--
--   driver                Driver master     (id, driver_name, is_active, organization_id)
--   vehicle               Vehicle master    (id, vehicle_number, is_active, organization_id)
--
-- All nine table names confirmed. Two are not what you would guess:
--   Picking          ->  transfer_order        (NOT `picking`)
--   Purchase Return  ->  purchase_return_head  (NOT `purchase_return`)
-- =============================================================================


-- #############################################################################
-- STEP 0 — PRE-FLIGHT REPORTS (read-only, run these first)
-- #############################################################################

-- 0.1  How many rows will each module migrate, and how many are unmigratable?
--      Rows with a NULL/blank delivery method cannot be mapped — there is no way
--      to know which section their values came from. Expect these to stay empty.
SELECT 'Quotation' AS module, sqt_delivery_method_id AS delivery_method, COUNT(*) AS rows_affected
  FROM quotation       GROUP BY sqt_delivery_method_id
UNION ALL
SELECT 'Sales Order', so_delivery_method, COUNT(*)
  FROM sales_order     GROUP BY so_delivery_method
UNION ALL
SELECT 'Goods Delivery', gd_delivery_method, COUNT(*)
  FROM goods_delivery  GROUP BY gd_delivery_method
UNION ALL
SELECT 'Picking Plan', to_delivery_method, COUNT(*)
  FROM picking_plan    GROUP BY to_delivery_method
UNION ALL
SELECT 'Picking', delivery_method, COUNT(*)
  FROM transfer_order  GROUP BY delivery_method
UNION ALL
SELECT 'Purchase Return', return_delivery_method, COUNT(*)
  FROM purchase_return_head GROUP BY return_delivery_method
UNION ALL
SELECT 'Sales Return', sr_delivery_method, COUNT(*)
  FROM sales_return    GROUP BY sr_delivery_method
ORDER BY module, delivery_method;


-- 0.2  DRIVER NAMES WITH NO MASTER MATCH
--      These become NULL in di_driver_name. Seed the Driver master first if you
--      want them preserved, then re-run STEP 1 (it tops up empty columns only).
SELECT module, organization_id, driver_name, COUNT(*) AS occurrences
FROM (
  SELECT 'Quotation' AS module, organization_id,
         CASE sqt_delivery_method_id
           WHEN 'Self Pickup'           THEN cp_customer_pickup
           WHEN '3rd Party Transporter' THEN tpt_driver_name END AS driver_name
    FROM quotation
  UNION ALL
  SELECT 'Sales Order', organization_id,
         CASE so_delivery_method
           WHEN 'Self Pickup'           THEN cp_driver_name
           WHEN '3rd Party Transporter' THEN tpt_driver_name END
    FROM sales_order
  UNION ALL
  SELECT 'Goods Delivery', organization_id,
         CASE gd_delivery_method
           WHEN 'Self Pickup'           THEN driver_name
           WHEN 'Company Truck'         THEN driver_name
           WHEN '3rd Party Transporter' THEN tpt_driver_name END
    FROM goods_delivery
  UNION ALL
  SELECT 'Picking Plan', organization_id,
         CASE to_delivery_method
           WHEN 'Self Pickup'           THEN driver_name
           WHEN 'Company Truck'         THEN driver_name
           WHEN '3rd Party Transporter' THEN tpt_driver_name END
    FROM picking_plan
  UNION ALL
  SELECT 'Picking', organization_id,
         CASE delivery_method
           WHEN 'Self Pickup'           THEN driver_name
           WHEN 'Company Truck'         THEN ct_driver_name
           WHEN '3rd Party Transporter' THEN tpt_driver_name END
    FROM transfer_order
  UNION ALL
  SELECT 'Purchase Return', organization_id,
         CASE return_delivery_method
           WHEN 'Self Pickup'   THEN driver_name
           WHEN 'Company Truck' THEN driver_name2 END
    FROM purchase_return_head
  UNION ALL
  SELECT 'Sales Return', organization_id,
         CASE sr_delivery_method
           WHEN 'Self Pickup'           THEN sr_driver_name
           WHEN 'Company Truck'         THEN sr_driver_name
           WHEN '3rd Party Transporter' THEN tpt_driver_name END
    FROM sales_return
) src
WHERE src.driver_name IS NOT NULL
  AND src.driver_name <> ''
  AND NOT EXISTS (
        SELECT 1 FROM driver m
         WHERE m.driver_name     = src.driver_name
           AND m.organization_id = src.organization_id
           AND m.is_active       = 1)
GROUP BY module, organization_id, driver_name
ORDER BY occurrences DESC, module, driver_name;


-- 0.3  VEHICLE PLATES WITH NO MASTER MATCH
--      Company Truck is excluded for SQT / SO / GD / Picking — those four already
--      store a Vehicle id and are copied straight across, not looked up.
SELECT module, organization_id, vehicle_number, COUNT(*) AS occurrences
FROM (
  SELECT 'Quotation' AS module, organization_id,
         CASE sqt_delivery_method_id
           WHEN 'Self Pickup'           THEN vehicle_number
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END AS vehicle_number
    FROM quotation
  UNION ALL
  SELECT 'Sales Order', organization_id,
         CASE so_delivery_method
           WHEN 'Self Pickup'           THEN cp_vehicle_number
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END
    FROM sales_order
  UNION ALL
  SELECT 'Goods Delivery', organization_id,
         CASE gd_delivery_method
           WHEN 'Self Pickup'           THEN sp_vehicle_no
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END
    FROM goods_delivery
  UNION ALL
  SELECT 'Picking Plan', organization_id,
         CASE to_delivery_method
           WHEN 'Self Pickup'           THEN vehicle_no
           WHEN 'Company Truck'         THEN vehicle_no
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END
    FROM picking_plan
  UNION ALL
  SELECT 'Picking', organization_id,
         CASE delivery_method
           WHEN 'Self Pickup'           THEN sp_vehicle_no
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END
    FROM transfer_order
  UNION ALL
  SELECT 'Purchase Return', organization_id,
         CASE return_delivery_method
           WHEN 'Self Pickup'           THEN vehicle_no
           WHEN 'Company Truck'         THEN vehicle_no2
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END
    FROM purchase_return_head
  UNION ALL
  SELECT 'Sales Return', organization_id,
         CASE sr_delivery_method
           WHEN 'Self Pickup'           THEN sr_vehicle_no
           WHEN 'Company Truck'         THEN sr_vehicle_no
           WHEN '3rd Party Transporter' THEN tpt_vehicle_number END
    FROM sales_return
) src
WHERE src.vehicle_number IS NOT NULL
  AND src.vehicle_number <> ''
  AND NOT EXISTS (
        SELECT 1 FROM vehicle m
         WHERE m.vehicle_number  = src.vehicle_number
           AND m.organization_id = src.organization_id
           AND m.is_active       = 1)
GROUP BY module, organization_id, vehicle_number
ORDER BY occurrences DESC, module, vehicle_number;


-- 0.4  COLLISION GATE for NULL-delivery-method rows
--      STEP 1B can only be trusted if NO row has two candidate source columns
--      populated at once. Every conflict_rows value must be 0.
--      A non-zero row means that module/field genuinely cannot be resolved
--      without the delivery method — exclude it from 1B and handle by hand.
SELECT 'Quotation' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(ct_driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(cp_customer_pickup AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(ct_vehicle_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(vehicle_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_shipping_company AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_est_delivery_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_shipping_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(cs_est_arrival_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(ct_delivery_cost,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(ss_freight_charges,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Quotation' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS conflict_rows
  FROM quotation
 WHERE (sqt_delivery_method_id IS NULL OR sqt_delivery_method_id = '')
   AND ((NULLIF(CAST(cs_tracking_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_tracking_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(ct_driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(cp_driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(cp_driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(ct_vehicle_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(cp_vehicle_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(cs_courier_company AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_shipping_company AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(cs_shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_est_delivery_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_shippping_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_est_arrival_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((CAST(COALESCE(cs_freight_charges,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(ct_delivery_cost,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(ss_freight_charges,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Sales Order' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_order
 WHERE (so_delivery_method IS NULL OR so_delivery_method = '')
   AND ((NULLIF(CAST(cs_tracking_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_tracking_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((NULLIF(CAST(ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(sp_vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(est_delivery_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM goods_delivery
 WHERE (gd_delivery_method IS NULL OR gd_delivery_method = '')
   AND ((CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((NULLIF(CAST(ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(est_delivery_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking Plan' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM picking_plan
 WHERE (to_delivery_method IS NULL OR to_delivery_method = '')
   AND ((CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(sp_vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(est_delivery_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_shipping_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_est_arrival_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(ss_freight_charges,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Picking' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS conflict_rows
  FROM transfer_order
 WHERE (delivery_method IS NULL OR delivery_method = '')
   AND ((NULLIF(CAST(tracking_number AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ss_tracking_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Purchase Return' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM purchase_return_head
 WHERE (return_delivery_method IS NULL OR return_delivery_method = '')
   AND ((NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(driver_name2 AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Purchase Return' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM purchase_return_head
 WHERE (return_delivery_method IS NULL OR return_delivery_method = '')
   AND ((NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Purchase Return' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM purchase_return_head
 WHERE (return_delivery_method IS NULL OR return_delivery_method = '')
   AND ((NULLIF(CAST(driver_contact AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(driver_contact_no2 AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Purchase Return' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM purchase_return_head
 WHERE (return_delivery_method IS NULL OR return_delivery_method = '')
   AND ((NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(vehicle_no2 AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Purchase Return' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM purchase_return_head
 WHERE (return_delivery_method IS NULL OR return_delivery_method = '')
   AND ((NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(estimated_arrival2 AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Purchase Return' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM purchase_return_head
 WHERE (return_delivery_method IS NULL OR return_delivery_method = '')
   AND ((CAST(COALESCE(freight_charge,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_driver_name' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(sr_driver_name AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_ic_no' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(sr_driver_contact_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(sr_vehicle_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(sr_shipping_date AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(sr_est_delivery_date AS CHAR),'') IS NOT NULL)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((CAST(COALESCE(sr_freight_charges,0) AS DECIMAL(18,4)) <> 0) + (CAST(COALESCE(sr_delivery_cost,0) AS DECIMAL(18,4)) <> 0)) > 1
UNION ALL
SELECT 'Sales Return' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS conflict_rows
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND ((NULLIF(CAST(sr_tracking_no AS CHAR),'') IS NOT NULL) + (NULLIF(CAST(sr_tracking_number AS CHAR),'') IS NOT NULL)) > 1
ORDER BY conflict_rows DESC, module, di_field;


-- 0.5  RESIDUAL CONFLICTS — list the actual rows
--      Run only for any module/field still non-zero in 0.4 after the zero-aware fix.
--      Example: Sales Return freight (both columns hold a real, non-zero value).
--      Decide per row, set di_freight_charges by hand, then run STEP 1B — it only
--      fills columns that are still empty, so your manual values are preserved.
SELECT id, sr_delivery_method, sr_freight_charges, sr_delivery_cost
  FROM sales_return
 WHERE (sr_delivery_method IS NULL OR sr_delivery_method = '')
   AND (CAST(COALESCE(sr_freight_charges,0) AS DECIMAL(18,4)) <> 0)
   AND (CAST(COALESCE(sr_delivery_cost,0)  AS DECIMAL(18,4)) <> 0);


-- #############################################################################
-- STEP 1 — MIGRATION
--
-- Run inside a transaction so you can roll back if a count looks wrong:
--   START TRANSACTION;  … run the 7 updates …  -- then COMMIT; or ROLLBACK;
--
-- Guard pattern:
--   COALESCE(NULLIF(col,''), …)  for text columns  (treats '' as empty)
--   COALESCE(col, …)             for date and decimal columns
-- #############################################################################

-- -----------------------------------------------------------------------------
-- 1.1  QUOTATION
--      Company Truck already stores Driver and Vehicle ids — copied straight.
-- -----------------------------------------------------------------------------
UPDATE quotation d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    CASE d.sqt_delivery_method_id
      WHEN 'Company Truck' THEN d.ct_driver_name
      ELSE (SELECT MIN(m.id) FROM driver m
             WHERE m.organization_id = d.organization_id AND m.is_active = 1
               AND m.driver_name = CASE d.sqt_delivery_method_id
                     WHEN 'Self Pickup'           THEN d.cp_customer_pickup
                     WHEN '3rd Party Transporter' THEN d.tpt_driver_name END)
    END),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.sqt_delivery_method_id
      WHEN 'Self Pickup'           THEN d.cp_ic_no
      WHEN 'Company Truck'         THEN d.ct_ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.sqt_delivery_method_id
      WHEN 'Self Pickup'           THEN d.driver_contact_no
      WHEN 'Company Truck'         THEN d.ct_driver_contact_no
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    CASE d.sqt_delivery_method_id
      WHEN 'Company Truck' THEN d.ct_vehicle_number
      ELSE (SELECT MIN(m.id) FROM vehicle m
             WHERE m.organization_id = d.organization_id AND m.is_active = 1
               AND m.vehicle_number = CASE d.sqt_delivery_method_id
                     WHEN 'Self Pickup'           THEN d.vehicle_number
                     WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)
    END),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.sqt_delivery_method_id WHEN 'Self Pickup' THEN d.pickup_date END),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection,
    CASE d.sqt_delivery_method_id WHEN 'Self Pickup' THEN d.validity_of_collection END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.sqt_delivery_method_id
      WHEN 'Courier Service'  THEN d.courier_company
      WHEN 'Shipping Service' THEN d.ss_shipping_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.sqt_delivery_method_id
      WHEN 'Courier Service'  THEN d.shipping_date
      WHEN 'Company Truck'    THEN d.ct_est_delivery_date
      WHEN 'Shipping Service' THEN d.ss_shipping_date END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.sqt_delivery_method_id
      WHEN 'Courier Service'  THEN d.cs_est_arrival_date
      WHEN 'Shipping Service' THEN d.est_arrival_date END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    CASE d.sqt_delivery_method_id
      WHEN 'Courier Service'  THEN d.freight_charges
      WHEN 'Company Truck'    THEN d.ct_delivery_cost
      WHEN 'Shipping Service' THEN d.ss_freight_charges END),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''),
    CASE d.sqt_delivery_method_id
      WHEN 'Courier Service'  THEN d.cs_tracking_number
      WHEN 'Shipping Service' THEN d.ss_tracking_number END),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.sqt_delivery_method_id WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.sqt_delivery_method_id IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- -----------------------------------------------------------------------------
-- 1.2  SALES ORDER
--      NOTE: ss_shippping_date really has three p's — that is the column name.
-- -----------------------------------------------------------------------------
UPDATE sales_order d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    CASE d.so_delivery_method
      WHEN 'Company Truck' THEN d.ct_driver_name
      ELSE (SELECT MIN(m.id) FROM driver m
             WHERE m.organization_id = d.organization_id AND m.is_active = 1
               AND m.driver_name = CASE d.so_delivery_method
                     WHEN 'Self Pickup'           THEN d.cp_driver_name
                     WHEN '3rd Party Transporter' THEN d.tpt_driver_name END)
    END),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.so_delivery_method
      WHEN 'Self Pickup'           THEN d.cp_ic_no
      WHEN 'Company Truck'         THEN d.ct_ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.so_delivery_method
      WHEN 'Self Pickup'           THEN d.cp_driver_contact_no
      WHEN 'Company Truck'         THEN d.ct_driver_contact_no
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    CASE d.so_delivery_method
      WHEN 'Company Truck' THEN d.ct_vehicle_number
      ELSE (SELECT MIN(m.id) FROM vehicle m
             WHERE m.organization_id = d.organization_id AND m.is_active = 1
               AND m.vehicle_number = CASE d.so_delivery_method
                     WHEN 'Self Pickup'           THEN d.cp_vehicle_number
                     WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)
    END),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.so_delivery_method WHEN 'Self Pickup' THEN d.cp_pickup_date END),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection,
    CASE d.so_delivery_method WHEN 'Self Pickup' THEN d.validity_of_collection END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.so_delivery_method
      WHEN 'Courier Service'  THEN d.cs_courier_company
      WHEN 'Shipping Service' THEN d.ss_shipping_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.so_delivery_method
      WHEN 'Courier Service'  THEN d.cs_shipping_date
      WHEN 'Company Truck'    THEN d.ct_est_delivery_date
      WHEN 'Shipping Service' THEN d.ss_shippping_date END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.so_delivery_method
      WHEN 'Courier Service'  THEN d.est_arrival_date
      WHEN 'Shipping Service' THEN d.ss_est_arrival_date END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    CASE d.so_delivery_method
      WHEN 'Courier Service'  THEN d.cs_freight_charges
      WHEN 'Company Truck'    THEN d.ct_delivery_cost
      WHEN 'Shipping Service' THEN d.ss_freight_charges END),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''),
    CASE d.so_delivery_method
      WHEN 'Courier Service'  THEN d.cs_tracking_number
      WHEN 'Shipping Service' THEN d.ss_tracking_number END),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.so_delivery_method WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.so_delivery_method IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- -----------------------------------------------------------------------------
-- 1.3  GOODS DELIVERY
--      Self Pickup and Company Truck SHARE driver_name / ic_no / driver_contact_no.
--      Only one method is ever populated per row, so the shared read is safe.
--      Company Truck's vehicle_no already stores a Vehicle id.
-- -----------------------------------------------------------------------------
UPDATE goods_delivery d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = CASE d.gd_delivery_method
              WHEN 'Self Pickup'           THEN d.driver_name
              WHEN 'Company Truck'         THEN d.driver_name
              WHEN '3rd Party Transporter' THEN d.tpt_driver_name END)),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.gd_delivery_method
      WHEN 'Self Pickup'           THEN d.ic_no
      WHEN 'Company Truck'         THEN d.ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.gd_delivery_method
      WHEN 'Self Pickup'           THEN d.driver_contact_no
      WHEN 'Company Truck'         THEN d.driver_contact_no
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    CASE d.gd_delivery_method
      WHEN 'Company Truck' THEN d.vehicle_no
      ELSE (SELECT MIN(m.id) FROM vehicle m
             WHERE m.organization_id = d.organization_id AND m.is_active = 1
               AND m.vehicle_number = CASE d.gd_delivery_method
                     WHEN 'Self Pickup'           THEN d.sp_vehicle_no
                     WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)
    END),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.gd_delivery_method WHEN 'Self Pickup' THEN d.pickup_date END),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection,
    CASE d.gd_delivery_method WHEN 'Self Pickup' THEN d.validity_of_collection END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.gd_delivery_method
      WHEN 'Courier Service'  THEN d.courier_company
      WHEN 'Shipping Service' THEN d.shipping_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.gd_delivery_method
      WHEN 'Courier Service'  THEN d.shipping_date
      WHEN 'Company Truck'    THEN d.est_delivery_date
      WHEN 'Shipping Service' THEN d.shipping_date END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.gd_delivery_method
      WHEN 'Courier Service'  THEN d.est_arrival_date
      WHEN 'Shipping Service' THEN d.est_arrival_date END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    CASE d.gd_delivery_method
      WHEN 'Courier Service'  THEN d.freight_charges
      WHEN 'Company Truck'    THEN d.delivery_cost
      WHEN 'Shipping Service' THEN d.freight_charges END),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''),
    CASE d.gd_delivery_method
      WHEN 'Courier Service'  THEN d.tracking_number
      WHEN 'Shipping Service' THEN d.tracking_number END),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.gd_delivery_method WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.gd_delivery_method IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- -----------------------------------------------------------------------------
-- 1.4  PICKING PLAN   (table: picking_plan)
--      Same shape as Goods Delivery, EXCEPT vehicle_no here is free text for
--      both Self Pickup and Company Truck — no id shortcut.
-- -----------------------------------------------------------------------------
UPDATE picking_plan d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = CASE d.to_delivery_method
              WHEN 'Self Pickup'           THEN d.driver_name
              WHEN 'Company Truck'         THEN d.driver_name
              WHEN '3rd Party Transporter' THEN d.tpt_driver_name END)),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.to_delivery_method
      WHEN 'Self Pickup'           THEN d.ic_no
      WHEN 'Company Truck'         THEN d.ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.to_delivery_method
      WHEN 'Self Pickup'           THEN d.driver_contact_no
      WHEN 'Company Truck'         THEN d.driver_contact_no
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = CASE d.to_delivery_method
              WHEN 'Self Pickup'           THEN d.vehicle_no
              WHEN 'Company Truck'         THEN d.vehicle_no
              WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.to_delivery_method WHEN 'Self Pickup' THEN d.pickup_date END),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection,
    CASE d.to_delivery_method WHEN 'Self Pickup' THEN d.validity_of_collection END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.to_delivery_method
      WHEN 'Courier Service'  THEN d.courier_company
      WHEN 'Shipping Service' THEN d.shipping_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.to_delivery_method
      WHEN 'Courier Service'  THEN d.shipping_date
      WHEN 'Company Truck'    THEN d.est_delivery_date
      WHEN 'Shipping Service' THEN d.shipping_date END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.to_delivery_method
      WHEN 'Courier Service'  THEN d.est_arrival_date
      WHEN 'Shipping Service' THEN d.est_arrival_date END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    CASE d.to_delivery_method
      WHEN 'Courier Service'  THEN d.freight_charges
      WHEN 'Company Truck'    THEN d.delivery_cost
      WHEN 'Shipping Service' THEN d.freight_charges END),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''),
    CASE d.to_delivery_method
      WHEN 'Courier Service'  THEN d.tracking_number
      WHEN 'Shipping Service' THEN d.tracking_number END),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.to_delivery_method WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.to_delivery_method IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- -----------------------------------------------------------------------------
-- 1.5  PICKING   (table: transfer_order)
--      Company Truck uses ct_* driver columns (unlike GD/PP) and vehicle_no
--      already stores a Vehicle id. Shipping Service uses ss_* columns.
-- -----------------------------------------------------------------------------
UPDATE transfer_order d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = CASE d.delivery_method
              WHEN 'Self Pickup'           THEN d.driver_name
              WHEN 'Company Truck'         THEN d.ct_driver_name
              WHEN '3rd Party Transporter' THEN d.tpt_driver_name END)),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.delivery_method
      WHEN 'Self Pickup'           THEN d.ic_no
      WHEN 'Company Truck'         THEN d.ct_ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.delivery_method
      WHEN 'Self Pickup'           THEN d.driver_contact_no
      WHEN 'Company Truck'         THEN d.ct_driver_contact_no
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    CASE d.delivery_method
      WHEN 'Company Truck' THEN d.vehicle_no
      ELSE (SELECT MIN(m.id) FROM vehicle m
             WHERE m.organization_id = d.organization_id AND m.is_active = 1
               AND m.vehicle_number = CASE d.delivery_method
                     WHEN 'Self Pickup'           THEN d.sp_vehicle_no
                     WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)
    END),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.delivery_method WHEN 'Self Pickup' THEN d.pickup_date END),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection,
    CASE d.delivery_method WHEN 'Self Pickup' THEN d.validity_of_collection END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.delivery_method
      WHEN 'Courier Service'  THEN d.courier_company
      WHEN 'Shipping Service' THEN d.shipping_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.delivery_method
      WHEN 'Courier Service'  THEN d.shipping_date
      WHEN 'Company Truck'    THEN d.est_delivery_date
      WHEN 'Shipping Service' THEN d.ss_shipping_date END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.delivery_method
      WHEN 'Courier Service'  THEN d.est_arrival_date
      WHEN 'Shipping Service' THEN d.ss_est_arrival_date END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    CASE d.delivery_method
      WHEN 'Courier Service'  THEN d.freight_charges
      WHEN 'Company Truck'    THEN d.delivery_cost
      WHEN 'Shipping Service' THEN d.ss_freight_charges END),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''),
    CASE d.delivery_method
      WHEN 'Courier Service'  THEN d.tracking_number
      WHEN 'Shipping Service' THEN d.ss_tracking_number END),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.delivery_method WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.delivery_method IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- -----------------------------------------------------------------------------
-- 1.6  PURCHASE RETURN
--      The ragged one. No Shipping Service section, no validity_of_collection,
--      no tracking number, no 3rd-Party driver name — those stay NULL.
--      estimated_ariival is misspelled in the source schema (single 'r', double 'i').
--      Company Truck's "Estimated Arrival" (estimated_arrival2) is really a
--      DELIVERY date, so it maps to di_est_delivery_date.
--      freight_charge was a plain text input — ROUND() guards against non-2dp values.
-- -----------------------------------------------------------------------------
UPDATE purchase_return_head d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = CASE d.return_delivery_method
              WHEN 'Self Pickup'   THEN d.driver_name
              WHEN 'Company Truck' THEN d.driver_name2 END)),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.return_delivery_method
      WHEN 'Self Pickup'           THEN d.cp_ic_no
      WHEN 'Company Truck'         THEN d.ct_ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.return_delivery_method
      WHEN 'Self Pickup'           THEN d.driver_contact
      WHEN 'Company Truck'         THEN d.driver_contact_no2
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = CASE d.return_delivery_method
              WHEN 'Self Pickup'           THEN d.vehicle_no
              WHEN 'Company Truck'         THEN d.vehicle_no2
              WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.return_delivery_method WHEN 'Self Pickup' THEN d.pickup_date END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.return_delivery_method WHEN 'Courier Service' THEN d.courier_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.return_delivery_method
      WHEN 'Courier Service' THEN d.shipping_date
      WHEN 'Company Truck'   THEN d.estimated_arrival2 END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.return_delivery_method WHEN 'Courier Service' THEN d.estimated_ariival END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    ROUND(CASE d.return_delivery_method
      WHEN 'Courier Service' THEN d.freight_charge
      WHEN 'Company Truck'   THEN d.delivery_cost END, 2)),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.return_delivery_method WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.return_delivery_method IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- -----------------------------------------------------------------------------
-- 1.7  SALES RETURN
--      SR shares columns aggressively: Self Pickup and Company Truck share
--      sr_driver_name / sr_driver_contact_no / sr_vehicle_no, and Courier and
--      Shipping Service share sr_shipping_date / sr_freight_charges /
--      sr_est_arrival_date. Safe — only one method is populated per row.
--      It has TWO tracking columns: sr_tracking_no (Courier) and
--      sr_tracking_number (Shipping Service).
-- -----------------------------------------------------------------------------
UPDATE sales_return d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''),
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = CASE d.sr_delivery_method
              WHEN 'Self Pickup'           THEN d.sr_driver_name
              WHEN 'Company Truck'         THEN d.sr_driver_name
              WHEN '3rd Party Transporter' THEN d.tpt_driver_name END)),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''),
    CASE d.sr_delivery_method
      WHEN 'Self Pickup'           THEN d.cp_ic_no
      WHEN 'Company Truck'         THEN d.ct_ic_no
      WHEN '3rd Party Transporter' THEN d.tpt_ic_no END),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''),
    CASE d.sr_delivery_method
      WHEN 'Self Pickup'           THEN d.sr_driver_contact_no
      WHEN 'Company Truck'         THEN d.sr_driver_contact_no
      WHEN '3rd Party Transporter' THEN d.tpt_driver_contact_no END),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''),
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = CASE d.sr_delivery_method
              WHEN 'Self Pickup'           THEN d.sr_vehicle_no
              WHEN 'Company Truck'         THEN d.sr_vehicle_no
              WHEN '3rd Party Transporter' THEN d.tpt_vehicle_number END)),
  d.di_pickup_date = COALESCE(d.di_pickup_date,
    CASE d.sr_delivery_method WHEN 'Self Pickup' THEN d.sr_pickup_date END),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection,
    CASE d.sr_delivery_method WHEN 'Self Pickup' THEN d.validity_of_collection END),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''),
    CASE d.sr_delivery_method
      WHEN 'Courier Service'  THEN d.courier_company
      WHEN 'Shipping Service' THEN d.shipping_company END),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date,
    CASE d.sr_delivery_method
      WHEN 'Courier Service'  THEN d.sr_shipping_date
      WHEN 'Company Truck'    THEN d.sr_est_delivery_date
      WHEN 'Shipping Service' THEN d.sr_shipping_date END),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date,
    CASE d.sr_delivery_method
      WHEN 'Courier Service'  THEN d.sr_est_arrival_date
      WHEN 'Shipping Service' THEN d.sr_est_arrival_date END),
  d.di_freight_charges = COALESCE(d.di_freight_charges,
    ROUND(CASE d.sr_delivery_method
      WHEN 'Courier Service'  THEN d.sr_freight_charges
      WHEN 'Company Truck'    THEN d.sr_delivery_cost
      WHEN 'Shipping Service' THEN d.sr_freight_charges END, 2)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''),
    CASE d.sr_delivery_method
      WHEN 'Courier Service'  THEN d.sr_tracking_no
      WHEN 'Shipping Service' THEN d.sr_tracking_number END),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''),
    CASE d.sr_delivery_method WHEN '3rd Party Transporter' THEN d.tpt_transport_name END)
WHERE d.sr_delivery_method IN
      ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- #############################################################################
-- STEP 1B — FALLBACK for rows with NO delivery method
--
-- Rows whose delivery method is NULL/blank are skipped by STEP 1, because the
-- CASE has no branch to take. Their legacy values are still present — the only
-- thing missing is which section they came from.
--
-- This pass drops the method entirely and COALESCEs across every candidate
-- column instead. That is only sound when at most ONE candidate is populated
-- per row, which is what STEP 0.4 proves.
--
--   >>> DO NOT RUN THIS UNTIL STEP 0.4 RETURNS ALL ZEROS <<<
--
-- Candidate order follows the section order in STEP 1 (Self Pickup → Courier →
-- Company Truck → Shipping Service → 3rd Party). With 0.4 clean the order is
-- irrelevant; it only matters if a conflict slipped through.
--
-- Same guarantees as STEP 1: re-runnable, legacy columns untouched, unmatched
-- driver/vehicle lookups left NULL.
-- #############################################################################

-- Quotation
UPDATE quotation d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), NULLIF(d.ct_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.cp_customer_pickup,''), NULLIF(d.tpt_driver_name,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.cp_ic_no,''), NULLIF(d.ct_ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.driver_contact_no,''), NULLIF(d.ct_driver_contact_no,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), NULLIF(d.ct_vehicle_number,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.vehicle_number,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.pickup_date),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection, d.validity_of_collection),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.courier_company,''), NULLIF(d.ss_shipping_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.shipping_date, d.ct_est_delivery_date, d.ss_shipping_date),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.cs_est_arrival_date, d.est_arrival_date),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.freight_charges,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.ct_delivery_cost,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.ss_freight_charges,0) AS DECIMAL(18,4)),0)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''), NULLIF(d.cs_tracking_number,''), NULLIF(d.ss_tracking_number,'')),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.sqt_delivery_method_id IS NULL OR d.sqt_delivery_method_id = '';

-- Sales Order
UPDATE sales_order d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), NULLIF(d.ct_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.cp_driver_name,''), NULLIF(d.tpt_driver_name,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.cp_ic_no,''), NULLIF(d.ct_ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.cp_driver_contact_no,''), NULLIF(d.ct_driver_contact_no,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), NULLIF(d.ct_vehicle_number,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.cp_vehicle_number,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.cp_pickup_date),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection, d.validity_of_collection),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.cs_courier_company,''), NULLIF(d.ss_shipping_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.cs_shipping_date, d.ct_est_delivery_date, d.ss_shippping_date),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.est_arrival_date, d.ss_est_arrival_date),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.cs_freight_charges,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.ct_delivery_cost,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.ss_freight_charges,0) AS DECIMAL(18,4)),0)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''), NULLIF(d.cs_tracking_number,''), NULLIF(d.ss_tracking_number,'')),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.so_delivery_method IS NULL OR d.so_delivery_method = '';

-- Goods Delivery
UPDATE goods_delivery d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.driver_name,''), NULLIF(d.tpt_driver_name,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.driver_contact_no,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), NULLIF(d.vehicle_no,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.sp_vehicle_no,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.pickup_date),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection, d.validity_of_collection),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.courier_company,''), NULLIF(d.shipping_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.shipping_date, d.est_delivery_date),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.est_arrival_date),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.freight_charges,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.delivery_cost,0) AS DECIMAL(18,4)),0)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''), NULLIF(d.tracking_number,'')),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.gd_delivery_method IS NULL OR d.gd_delivery_method = '';

-- Picking Plan
UPDATE picking_plan d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.driver_name,''), NULLIF(d.tpt_driver_name,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.driver_contact_no,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.vehicle_no,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.pickup_date),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection, d.validity_of_collection),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.courier_company,''), NULLIF(d.shipping_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.shipping_date, d.est_delivery_date),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.est_arrival_date),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.freight_charges,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.delivery_cost,0) AS DECIMAL(18,4)),0)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''), NULLIF(d.tracking_number,'')),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.to_delivery_method IS NULL OR d.to_delivery_method = '';

-- Picking
UPDATE transfer_order d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.driver_name,''), NULLIF(d.ct_driver_name,''), NULLIF(d.tpt_driver_name,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.ic_no,''), NULLIF(d.ct_ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.driver_contact_no,''), NULLIF(d.ct_driver_contact_no,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), NULLIF(d.vehicle_no,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.sp_vehicle_no,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.pickup_date),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection, d.validity_of_collection),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.courier_company,''), NULLIF(d.shipping_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.shipping_date, d.est_delivery_date, d.ss_shipping_date),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.est_arrival_date, d.ss_est_arrival_date),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.freight_charges,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.delivery_cost,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.ss_freight_charges,0) AS DECIMAL(18,4)),0)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''), NULLIF(d.tracking_number,''), NULLIF(d.ss_tracking_number,'')),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.delivery_method IS NULL OR d.delivery_method = '';

-- Purchase Return
UPDATE purchase_return_head d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.driver_name,''), NULLIF(d.driver_name2,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.cp_ic_no,''), NULLIF(d.ct_ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.driver_contact,''), NULLIF(d.driver_contact_no2,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.vehicle_no,''), NULLIF(d.vehicle_no2,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.pickup_date),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.courier_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.shipping_date, d.estimated_arrival2),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.estimated_ariival),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.freight_charge,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.delivery_cost,0) AS DECIMAL(18,4)),0)),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.return_delivery_method IS NULL OR d.return_delivery_method = '';

-- Sales Return
UPDATE sales_return d
SET
  d.di_driver_name = COALESCE(NULLIF(d.di_driver_name,''), 
    (SELECT MIN(m.id) FROM driver m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.driver_name = COALESCE(NULLIF(d.sr_driver_name,''), NULLIF(d.tpt_driver_name,'')))),
  d.di_ic_no = COALESCE(NULLIF(d.di_ic_no,''), NULLIF(d.cp_ic_no,''), NULLIF(d.ct_ic_no,''), NULLIF(d.tpt_ic_no,'')),
  d.di_driver_contact_no = COALESCE(NULLIF(d.di_driver_contact_no,''), NULLIF(d.sr_driver_contact_no,''), NULLIF(d.tpt_driver_contact_no,'')),
  d.di_vehicle_number = COALESCE(NULLIF(d.di_vehicle_number,''), 
    (SELECT MIN(m.id) FROM vehicle m
      WHERE m.organization_id = d.organization_id AND m.is_active = 1
        AND m.vehicle_number = COALESCE(NULLIF(d.sr_vehicle_no,''), NULLIF(d.tpt_vehicle_number,'')))),
  d.di_pickup_date = COALESCE(d.di_pickup_date, d.sr_pickup_date),
  d.di_validity_of_collection = COALESCE(d.di_validity_of_collection, d.validity_of_collection),
  d.di_shipping_company = COALESCE(NULLIF(d.di_shipping_company,''), NULLIF(d.courier_company,''), NULLIF(d.shipping_company,'')),
  d.di_est_delivery_date = COALESCE(d.di_est_delivery_date, d.sr_shipping_date, d.sr_est_delivery_date),
  d.di_est_arrival_date = COALESCE(d.di_est_arrival_date, d.sr_est_arrival_date),
  d.di_freight_charges = COALESCE(d.di_freight_charges, NULLIF(CAST(COALESCE(d.sr_freight_charges,0) AS DECIMAL(18,4)),0), NULLIF(CAST(COALESCE(d.sr_delivery_cost,0) AS DECIMAL(18,4)),0)),
  d.di_tracking_number = COALESCE(NULLIF(d.di_tracking_number,''), NULLIF(d.sr_tracking_no,''), NULLIF(d.sr_tracking_number,'')),
  d.di_transport_name = COALESCE(NULLIF(d.di_transport_name,''), NULLIF(d.tpt_transport_name,''))
WHERE d.sr_delivery_method IS NULL OR d.sr_delivery_method = '';

-- #############################################################################
-- STEP 2 — POST-MIGRATION VERIFICATION
-- #############################################################################

-- 2.1  Coverage: rows that have a delivery method vs rows that ended up with
--      anything in di_*. A large gap means a source column was empty, not that
--      the migration failed — cross-check against the STEP 0 counts.
SELECT 'Quotation' AS module,
       COUNT(*) AS with_method,
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END) AS migrated
  FROM quotation
 WHERE sqt_delivery_method_id IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter')
UNION ALL
SELECT 'Sales Order', COUNT(*),
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END)
  FROM sales_order
 WHERE so_delivery_method IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter')
UNION ALL
SELECT 'Goods Delivery', COUNT(*),
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END)
  FROM goods_delivery
 WHERE gd_delivery_method IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter')
UNION ALL
SELECT 'Picking Plan', COUNT(*),
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END)
  FROM picking_plan
 WHERE to_delivery_method IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter')
UNION ALL
SELECT 'Picking', COUNT(*),
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END)
  FROM transfer_order
 WHERE delivery_method IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter')
UNION ALL
SELECT 'Purchase Return', COUNT(*),
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END)
  FROM purchase_return_head
 WHERE return_delivery_method IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter')
UNION ALL
SELECT 'Sales Return', COUNT(*),
       SUM(CASE WHEN COALESCE(NULLIF(di_driver_name,''), NULLIF(di_shipping_company,''),
                              NULLIF(di_transport_name,''), NULLIF(di_vehicle_number,''),
                              di_est_delivery_date, di_est_arrival_date, di_pickup_date,
                              di_freight_charges) IS NOT NULL THEN 1 ELSE 0 END)
  FROM sales_return
 WHERE sr_delivery_method IN ('Self Pickup','Courier Service','Company Truck','Shipping Service','3rd Party Transporter');


-- 2.2  Referential check — every non-empty di_driver_name / di_vehicle_number
--      must resolve to a live master row. Expect ZERO rows.
SELECT 'Quotation' AS module, id, di_driver_name AS bad_driver_id
  FROM quotation
 WHERE NULLIF(di_driver_name,'') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM driver m WHERE m.id = quotation.di_driver_name)
UNION ALL
SELECT 'Sales Order', id, di_driver_name
  FROM sales_order
 WHERE NULLIF(di_driver_name,'') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM driver m WHERE m.id = sales_order.di_driver_name);
-- (repeat per table as needed, and the same shape against `vehicle` for di_vehicle_number)


-- 2.3  Spot-check one row per module per method before committing.
--      SELECT sqt_delivery_method_id, cp_customer_pickup, ct_driver_name, tpt_driver_name,
--             di_driver_name, di_vehicle_number, di_est_delivery_date, di_freight_charges
--        FROM quotation
--       WHERE sqt_delivery_method_id = 'Self Pickup' LIMIT 5;
