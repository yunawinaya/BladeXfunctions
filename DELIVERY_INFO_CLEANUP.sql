-- =============================================================================
-- Delivery Info consolidation — LEGACY COLUMN CLEANUP
--
-- Companion to DELIVERY_INFO_MIGRATION.sql. That script is additive and
-- non-destructive; THIS ONE IS NOT. It nulls the legacy per-method delivery
-- columns once their values live in di_*.
--
--   >>>>>>  TAKE A BACKUP FIRST. NOTHING HERE IS REVERSIBLE.  <<<<<<
--
-- PREREQUISITES — all of these, in order, before running anything below:
--   1. DELIVERY_INFO_MIGRATION.sql has run and been committed (STEP 1 + 1B).
--   2. Its STEP 2 verification looked correct.
--   3. The di_* workflows are DEPLOYED and have been running long enough that
--      you trust them.
--   4. The forms no longer bind the five per-method sections, the converters no
--      longer map the legacy columns, and nothing branches on the five method
--      literals ("Self Pickup", "Courier Service", …) any more.
--
-- Step 4 matters most. Roughly 30 code sites still compare those literals by
-- name, and every form still binds the old sections (hidden). Clearing the data
-- underneath them gives you blank sections, not clean ones.
--
-- RUN ORDER:  C0 (gate)  →  C1 (clear everything)  →  C2 (verify)
--
-- DO NOT RUN THIS FILE AS ONE SCRIPT. C0 is a gate — its output must be read and
-- confirmed all-zero before C1 executes. Run one section at a time:
--   C0  is a single SELECT (82 UNION ALL branches) — safe to run whole.
--   C1  is 7 UPDATEs wrapped in a transaction — run the block, verify, COMMIT.
-- =============================================================================


-- #############################################################################
-- C0 — DATA-LOSS GATE  (read-only, must be ALL ZERO)
--
-- For every di_ field, counts rows where the di_ column is still empty but at
-- least one of its legacy sources still holds a value. Those are rows whose
-- data would be destroyed by C1.
--
-- A non-zero means the migration did not cover that module/field — go back and
-- fix the migration; do NOT proceed.
-- #############################################################################

SELECT 'Quotation' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ct_driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(cp_customer_pickup AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ct_vehicle_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(vehicle_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_validity_of_collection' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_validity_of_collection AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(validity_of_collection AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_shipping_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_est_delivery_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_shipping_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cs_est_arrival_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(ct_delivery_cost,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(ss_freight_charges,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Quotation' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_tracking_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cs_tracking_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_tracking_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ct_driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(cp_driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cp_driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ct_vehicle_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(cp_vehicle_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cp_pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_validity_of_collection' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_validity_of_collection AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(validity_of_collection AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cs_courier_company AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_shipping_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cs_shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_est_delivery_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_shippping_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_est_arrival_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(cs_freight_charges,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(ct_delivery_cost,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(ss_freight_charges,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Sales Order' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_tracking_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cs_tracking_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_tracking_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(sp_vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_validity_of_collection' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_validity_of_collection AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(validity_of_collection AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL OR NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(est_delivery_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_tracking_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tracking_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_validity_of_collection' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_validity_of_collection AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(validity_of_collection AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL OR NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(est_delivery_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_tracking_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tracking_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(sp_vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_validity_of_collection' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_validity_of_collection AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(validity_of_collection AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL OR NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(est_delivery_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_shipping_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(est_arrival_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_est_arrival_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(freight_charges,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(ss_freight_charges,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Picking' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_tracking_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tracking_number AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ss_tracking_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(driver_name2 AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(driver_contact AS CHAR),'') IS NOT NULL OR NULLIF(CAST(driver_contact_no2 AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(vehicle_no2 AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(estimated_arrival2 AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(estimated_ariival AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(freight_charge,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(delivery_cost,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_driver_name' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_driver_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_driver_name AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_ic_no' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_ic_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(cp_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(ct_ic_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_ic_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_driver_contact_no' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_driver_contact_no AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_driver_contact_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_driver_contact_no AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_vehicle_number' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_vehicle_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_vehicle_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(tpt_vehicle_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_pickup_date' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_pickup_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_pickup_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_validity_of_collection' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_validity_of_collection AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(validity_of_collection AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_shipping_company' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_shipping_company AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(courier_company AS CHAR),'') IS NOT NULL OR NULLIF(CAST(shipping_company AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_est_delivery_date' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_est_delivery_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_shipping_date AS CHAR),'') IS NOT NULL OR NULLIF(CAST(sr_est_delivery_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_est_arrival_date' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_est_arrival_date AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_est_arrival_date AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_freight_charges' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (di_freight_charges IS NULL)
   AND (CAST(COALESCE(sr_freight_charges,0) AS DECIMAL(18,4)) <> 0 OR CAST(COALESCE(sr_delivery_cost,0) AS DECIMAL(18,4)) <> 0)
UNION ALL
SELECT 'Sales Return' AS module, 'di_tracking_number' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_tracking_number AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(sr_tracking_no AS CHAR),'') IS NOT NULL OR NULLIF(CAST(sr_tracking_number AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_transport_name' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_transport_name AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(tpt_transport_name AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Quotation' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM quotation
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ss_shipping_method AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Order' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_order
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(ss_shipping_method AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Goods Delivery' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM goods_delivery
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_method AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking Plan' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM picking_plan
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_method AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Picking' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM transfer_order
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_method AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Purchase Return' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM purchase_return_head
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_method AS CHAR),'') IS NOT NULL)
UNION ALL
SELECT 'Sales Return' AS module, 'di_shipping_method' AS di_field, COUNT(*) AS would_lose_data
  FROM sales_return
 WHERE (NULLIF(CAST(di_shipping_method AS CHAR),'') IS NULL)
   AND (NULLIF(CAST(shipping_method AS CHAR),'') IS NOT NULL)
ORDER BY would_lose_data DESC, module, di_field;


-- #############################################################################
-- C1 — CLEAR ALL LEGACY DELIVERY COLUMNS
--
-- One statement per table: the per-method value columns AND the delivery-method
-- discriminator (plus delivery_method_text), cleared together. 7 statements,
-- 181 columns.
--
-- Only run with C0 all zero.
--
-- Includes the legacy Shipping-Service sub-choice column (ss_shipping_method /
-- shipping_method). It IS migrated into di_shipping_method by STEP 1/1B of the
-- migration, and C0 now gates it like every other field.
--
-- NOTE ON THE MERGE: the discriminator is the only thing that lets you re-derive
-- which delivery section a historical row used. Clearing it in the same pass as
-- the values closes that window — after this commits, the migration can never be
-- re-run and the original section is unrecoverable. That is the accepted
-- trade-off for running this as one pass; the backup is your only way back.
-- #############################################################################

START TRANSACTION;

-- Quotation  (28 value columns + 2 method columns = 30)
UPDATE quotation
SET
  ct_driver_name = NULL,
  cp_customer_pickup = NULL,
  tpt_driver_name = NULL,
  cp_ic_no = NULL,
  ct_ic_no = NULL,
  tpt_ic_no = NULL,
  driver_contact_no = NULL,
  ct_driver_contact_no = NULL,
  tpt_driver_contact_no = NULL,
  ct_vehicle_number = NULL,
  vehicle_number = NULL,
  tpt_vehicle_number = NULL,
  pickup_date = NULL,
  validity_of_collection = NULL,
  courier_company = NULL,
  ss_shipping_company = NULL,
  shipping_date = NULL,
  ct_est_delivery_date = NULL,
  ss_shipping_date = NULL,
  cs_est_arrival_date = NULL,
  est_arrival_date = NULL,
  freight_charges = NULL,
  ct_delivery_cost = NULL,
  ss_freight_charges = NULL,
  cs_tracking_number = NULL,
  ss_tracking_number = NULL,
  tpt_transport_name = NULL,
  ss_shipping_method = NULL,
  sqt_delivery_method_id = NULL,
  delivery_method_text = NULL;

-- Sales Order  (28 value columns + 2 method columns = 30)
UPDATE sales_order
SET
  ct_driver_name = NULL,
  cp_driver_name = NULL,
  tpt_driver_name = NULL,
  cp_ic_no = NULL,
  ct_ic_no = NULL,
  tpt_ic_no = NULL,
  cp_driver_contact_no = NULL,
  ct_driver_contact_no = NULL,
  tpt_driver_contact_no = NULL,
  ct_vehicle_number = NULL,
  cp_vehicle_number = NULL,
  tpt_vehicle_number = NULL,
  cp_pickup_date = NULL,
  validity_of_collection = NULL,
  cs_courier_company = NULL,
  ss_shipping_company = NULL,
  cs_shipping_date = NULL,
  ct_est_delivery_date = NULL,
  ss_shippping_date = NULL,
  est_arrival_date = NULL,
  ss_est_arrival_date = NULL,
  cs_freight_charges = NULL,
  ct_delivery_cost = NULL,
  ss_freight_charges = NULL,
  cs_tracking_number = NULL,
  ss_tracking_number = NULL,
  tpt_transport_name = NULL,
  ss_shipping_method = NULL,
  so_delivery_method = NULL,
  delivery_method_text = NULL;

-- Goods Delivery  (21 value columns + 2 method columns = 23)
UPDATE goods_delivery
SET
  driver_name = NULL,
  tpt_driver_name = NULL,
  ic_no = NULL,
  tpt_ic_no = NULL,
  driver_contact_no = NULL,
  tpt_driver_contact_no = NULL,
  vehicle_no = NULL,
  sp_vehicle_no = NULL,
  tpt_vehicle_number = NULL,
  pickup_date = NULL,
  validity_of_collection = NULL,
  courier_company = NULL,
  shipping_company = NULL,
  shipping_date = NULL,
  est_delivery_date = NULL,
  est_arrival_date = NULL,
  freight_charges = NULL,
  delivery_cost = NULL,
  tracking_number = NULL,
  tpt_transport_name = NULL,
  shipping_method = NULL,
  gd_delivery_method = NULL,
  delivery_method_text = NULL;

-- Picking Plan  (20 value columns + 2 method columns = 22)
UPDATE picking_plan
SET
  driver_name = NULL,
  tpt_driver_name = NULL,
  ic_no = NULL,
  tpt_ic_no = NULL,
  driver_contact_no = NULL,
  tpt_driver_contact_no = NULL,
  vehicle_no = NULL,
  tpt_vehicle_number = NULL,
  pickup_date = NULL,
  validity_of_collection = NULL,
  courier_company = NULL,
  shipping_company = NULL,
  shipping_date = NULL,
  est_delivery_date = NULL,
  est_arrival_date = NULL,
  freight_charges = NULL,
  delivery_cost = NULL,
  tracking_number = NULL,
  tpt_transport_name = NULL,
  shipping_method = NULL,
  to_delivery_method = NULL,
  delivery_method_text = NULL;

-- Picking  (28 value columns + 2 method columns = 30)
UPDATE transfer_order
SET
  driver_name = NULL,
  ct_driver_name = NULL,
  tpt_driver_name = NULL,
  ic_no = NULL,
  ct_ic_no = NULL,
  tpt_ic_no = NULL,
  driver_contact_no = NULL,
  ct_driver_contact_no = NULL,
  tpt_driver_contact_no = NULL,
  vehicle_no = NULL,
  sp_vehicle_no = NULL,
  tpt_vehicle_number = NULL,
  pickup_date = NULL,
  validity_of_collection = NULL,
  courier_company = NULL,
  shipping_company = NULL,
  shipping_date = NULL,
  est_delivery_date = NULL,
  ss_shipping_date = NULL,
  est_arrival_date = NULL,
  ss_est_arrival_date = NULL,
  freight_charges = NULL,
  delivery_cost = NULL,
  ss_freight_charges = NULL,
  tracking_number = NULL,
  ss_tracking_number = NULL,
  tpt_transport_name = NULL,
  shipping_method = NULL,
  delivery_method = NULL,
  delivery_method_text = NULL;

-- Purchase Return  (20 value columns + 2 method columns = 22)
UPDATE purchase_return_head
SET
  driver_name = NULL,
  driver_name2 = NULL,
  cp_ic_no = NULL,
  ct_ic_no = NULL,
  tpt_ic_no = NULL,
  driver_contact = NULL,
  driver_contact_no2 = NULL,
  tpt_driver_contact_no = NULL,
  vehicle_no = NULL,
  vehicle_no2 = NULL,
  tpt_vehicle_number = NULL,
  pickup_date = NULL,
  courier_company = NULL,
  shipping_date = NULL,
  estimated_arrival2 = NULL,
  estimated_ariival = NULL,
  freight_charge = NULL,
  delivery_cost = NULL,
  tpt_transport_name = NULL,
  shipping_method = NULL,
  return_delivery_method = NULL,
  delivery_method_text = NULL;

-- Sales Return  (22 value columns + 2 method columns = 24)
UPDATE sales_return
SET
  sr_driver_name = NULL,
  tpt_driver_name = NULL,
  cp_ic_no = NULL,
  ct_ic_no = NULL,
  tpt_ic_no = NULL,
  sr_driver_contact_no = NULL,
  tpt_driver_contact_no = NULL,
  sr_vehicle_no = NULL,
  tpt_vehicle_number = NULL,
  sr_pickup_date = NULL,
  validity_of_collection = NULL,
  courier_company = NULL,
  shipping_company = NULL,
  sr_shipping_date = NULL,
  sr_est_delivery_date = NULL,
  sr_est_arrival_date = NULL,
  sr_freight_charges = NULL,
  sr_delivery_cost = NULL,
  sr_tracking_no = NULL,
  sr_tracking_number = NULL,
  tpt_transport_name = NULL,
  shipping_method = NULL,
  sr_delivery_method = NULL,
  delivery_method_text = NULL;

-- >>> STOP. Before committing, run C2 (the STEP 2 coverage queries from
-- >>> DELIVERY_INFO_MIGRATION.sql). Coverage must be UNCHANGED from before C1.
-- >>> Then:   COMMIT;      -- or   ROLLBACK;   if anything looks wrong.

-- #############################################################################
-- C2 — VERIFY
-- #############################################################################

-- C2.1  Every legacy column should now be empty, and di_* should still hold data.
--       Run the STEP 2 queries from DELIVERY_INFO_MIGRATION.sql — coverage
--       numbers must be UNCHANGED from before the cleanup. If any dropped, C1
--       cleared something that had not been migrated.

-- C2.2  Re-run C0. Every count must still be 0 (trivially true once the legacy
--       columns are NULL, but it confirms nothing was missed).
