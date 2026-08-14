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
