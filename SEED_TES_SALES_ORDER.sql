-- ============================================================================
-- Draft Sales Order for the 100 TES items, 10 qty each          [DEV ONLY]
-- ----------------------------------------------------------------------------
-- Creates ONE Draft sales_order (placeholder no. SO/0222) for MRS-MAGIC at
-- ASAI HQ, with 100 lines - one per TES412-TES511 - at qty 10 and price 10.00.
--
-- Deliberately stops at Draft. Issue it from the UI so SO_SAVE (id
-- 1988908545345945602, v134) actually runs: it assigns the real dated number,
-- checks credit limit and approval, updates the reorder redis keys, and posts
-- to SQL Accounting V2 (ASAI's acc_integration_type). A SQL-written "Issued"
-- SO would skip every one of those.
--
-- PRIVILEGES: needs INSERT on bladex_boot - the .dbtools account cannot run it.
-- Guarded by NOT EXISTS throughout, so re-running inserts nothing.
--
-- Run it, check the counts at the bottom, then COMMIT.
-- ============================================================================

-- Columns here are utf8mb4_general_ci; pin the session so literals and user
-- variables match, or clients default to unicode_ci and throw "Illegal mix of
-- collations".
SET NAMES 'utf8mb4' COLLATE 'utf8mb4_general_ci';

START TRANSACTION;

-- ---------------------------------------------------------------- parameters
SET @org     = '1123598813738675201';   -- ASAI
SET @tenant  = '000000';
SET @plant   = 1123598813738675202;     -- ASAI HQ (where the TES stock sits)
SET @cust    = 2076477581747347458;     -- MRS-MAGIC
SET @payterm = 2071864753265176579;     -- MRS-MAGIC's customer_payment_term_id
SET @user    = 1123598821738675201;
SET @dept    = 1123598813738675202;
SET @qty     = 10.000;                  -- qty per line
SET @price   = 10.0000;                 -- unit price per line
SET @lo      = 412;                     -- TES number range
SET @hi      = 511;
SET @so_no   = 'SO/0222';               -- next free Draft placeholder (max is 221)
SET @so_type = 2000411064960356354;     -- serial rule "SO DOC 1"
SET @now     = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00');

-- derived
SET @nlines = (SELECT COUNT(*) FROM item
               WHERE organization_id = @org AND tenant_id = @tenant AND is_deleted = 0
                 AND material_code REGEXP '^TES[0-9]+$'
                 AND CAST(SUBSTRING(material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi);
SET @line_amt = @qty * @price;          -- 100.0000 per line
SET @so_total = @nlines * @line_amt;    -- 10,000.0000
SET @delivered_str = CONCAT('0 / ', @nlines);
SET @so_id = (SELECT MAX(id) + 1 FROM sales_order);

-- Sanity: refuse to build the SO unless all 100 items are there.
SELECT IF(@nlines = 100, CONCAT('ok: ', @nlines, ' items'),
          CONCAT('WARNING: expected 100 items, found ', @nlines)) AS precheck;

-- ============================================================================
-- 1. Header
-- ============================================================================
INSERT INTO sales_order (
  id, so_no, so_no_type, so_date, so_status, previous_status,
  customer_name, plant_name, so_payment_term,
  so_total_gross, so_total_discount, so_total_tax, so_total,
  myr_total_amount, exchange_rate,
  so_currency, total_gross_currency, total_discount_currency, total_tax_currency,
  total_amount_currency, exchange_rate_currency, exchange_rate_myr, total_amount_myr,
  ct_delivery_cost, ss_freight_charges, cs_freight_charges, di_freight_charges,
  si_status, production_status, partially_delivered, fully_delivered,
  overdue_inv_total_amount, outstanding_balance, customer_credit_limit, overdue_limit,
  acc_integration_type, sqt_id, access_group, custom_fields_m07krnod,
  so_type, create_si, created_source, so_created_by, so_description, is_accurate,
  -- these MUST be present, not NULL: SO_SAVE if-nodes call
  -- getPropValue(...).toString() on them and NPE on a null
  has_sr, auto_si, auto_gd,
  cust_billing_address, cust_shipping_address, so_remarks, so_tnc,
  so_payment_details, shipping_address_line_4, shipping_postal_code,
  billing_address_city, shipping_address_city, shipping_address_line_1,
  shipping_address_line_3, billing_address_line_1, billing_address_line_3,
  billing_address_line_4, billing_postal_code, billing_address_line_2,
  shipping_address_line_2, cp_vehicle_number, ct_driver_contact_no,
  cp_driver_contact_no, ss_tracking_number, cp_driver_name, sqt_no,
  tpt_vehicle_number, tpt_driver_contact_no, tpt_transport_name, ct_ic_no,
  tpt_ic_no, so_docno, cp_ic_no, cs_tracking_number, ss_shipping_method,
  billing_attention, shipping_attention, shipping_address_phone,
  shipping_address_name, billing_address_name, billing_address_phone,
  cust_po, so_remarks2, so_remarks3, price_tag_id, need_cl, so_remarks5,
  so_remarks4, so_delivery_term, tpt_driver_name, so_uuid,
  shipping_address_fax, billing_address_fax, wa_group, wa_number,
  shipping_address_code, billing_address_code, di_transport_name,
  di_tracking_number, di_ic_no, di_driver_contact_no,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, organization_id, sub_tenant_id
)
SELECT
  @so_id, @so_no, @so_type, DATE(@now), 'Draft', 'Draft',
  @cust, @plant, @payterm,
  @so_total, 0.0000, 0.0000, @so_total,
  @so_total, 1.000000,
  '----', '----', '----', '----',
  '----', '----', 'MYR', 'MYR',
  0.00, 0.00, 0.00, 0.00,
  'Not Created', 'Not Created', @delivered_str, @delivered_str,
  0.00, 0.00, 0.00, 0.00,
  'SQL Accounting V2', '[]', '[]', '{}',
  'Credit', 'No', 'Web', 'Admin', 'Sales Order', 1,
  0, 0, 0,
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '',
  @user, @dept, @now, @user, @now,
  0, @tenant, @org, @org
WHERE NOT EXISTS (
  SELECT 1 FROM sales_order x
  WHERE x.so_no = @so_no COLLATE utf8mb4_general_ci
    AND x.organization_id = @org AND x.is_deleted = 0
);

-- ============================================================================
-- 2. Lines - one per TES412-TES511, ordered by item number
--    NOTE the inverted naming: item_name holds the item ID, item_id the CODE.
-- ============================================================================
SET @line_base = (SELECT MAX(id) FROM sales_order_axszx8cj_sub);
INSERT INTO sales_order_axszx8cj_sub (
  id, sales_order_id, line_index, line_status,
  item_name, item_id, item_category_id,
  so_quantity, outstanding_quantity, so_item_uom, so_item_price,
  so_gross, so_discount, so_discount_amount, so_tax_amount, so_amount,
  unrestricted_qty, base_unrestricted_qty,
  delivered_qty, invoice_qty, posted_qty, production_qty, return_qty, planned_qty,
  production_planned_qty, production_status,
  packing_qty, packing_conversion, packing_uom,
  net_weight, weight_conversion,
  min_price, max_price, min_quantity, max_quantity,
  customer_id, payment_term_id, plant_id,
  access_group, hu_no, custom_fields,
  -- present-not-null: SO_SAVE / SI mapping read these via getPropValue
  so_tax_inclusive, from_historical,
  so_desc, more_desc, line_remark_1, line_remark_2, line_remark_3,
  table_uom_conversion, si_status, packing_status,
  source_po_line_item_id, further_description,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, organization_id, sub_tenant_id
)
SELECT
  @line_base + t.seq, @so_id, t.seq, 'Draft',
  t.item_id, t.material_code, t.item_category,
  @qty, @qty, t.based_uom, @price,
  @line_amt, 0.0000, 0.0000, 0.0000, @line_amt,
  t.avail, t.avail,
  0.000, 0.000, 0.000, 0.000, 0.000, 0.000,
  @qty, 'Not Created',
  @qty, 1.000, t.based_uom,
  0.000, 0.000,
  0.0000, 0.0000, 0.0000, 0.0000,
  @cust, @payterm, @plant,
  '[]', '[]', '{}',
  0, 0,
  '', '', '', '', '',
  '', '', '',
  '', '',
  @user, @dept, @now, @user, @now,
  0, @tenant, @org, @org
FROM (
  SELECT i.id AS item_id, i.material_code, i.based_uom, i.item_category,
         COALESCE((SELECT SUM(b.unrestricted_qty) FROM item_balance b
                   WHERE b.material_id = i.id AND b.plant_id = @plant
                     AND b.is_deleted = 0), 0) AS avail,
         ROW_NUMBER() OVER (ORDER BY CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED)) AS seq
  FROM item i
  WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
    AND i.material_code REGEXP '^TES[0-9]+$'
    AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi
    AND NOT EXISTS (SELECT 1 FROM sales_order_axszx8cj_sub l
                    WHERE l.sales_order_id = @so_id AND l.item_name = i.id
                      AND l.is_deleted = 0)
) t;

-- ============================================================================
-- 3. blade_dept junction - the plant's department chain (org + plant)
-- ============================================================================
SET @bd_base = (SELECT MAX(id) FROM sales_order_blade_dept);
INSERT INTO sales_order_blade_dept (
  id, sales_order_id, left_field, blade_dept_id,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, sub_tenant_id
)
SELECT
  @bd_base + t.seq, @so_id, 'plant_name', t.dept,
  @user, @dept, @now, @user, @now,
  0, @tenant, @org
FROM (
            SELECT 1 AS seq, 1123598813738675201 AS dept   -- ASAI (org)
  UNION ALL SELECT 2,        1123598813738675202           -- ASAI HQ (plant)
) t
WHERE NOT EXISTS (
  SELECT 1 FROM sales_order_blade_dept x
  WHERE x.sales_order_id = @so_id AND x.blade_dept_id = t.dept AND x.is_deleted = 0
);

-- ============================================================================
-- 4. Verify, then COMMIT
-- ============================================================================
SELECT
  @so_id                                                              AS so_id,
  @so_no                                                              AS so_no,
  (SELECT so_status FROM sales_order WHERE id = @so_id)               AS status,
  (SELECT so_total  FROM sales_order WHERE id = @so_id)               AS so_total,
  (SELECT COUNT(*) FROM sales_order_axszx8cj_sub
    WHERE sales_order_id = @so_id AND is_deleted = 0)                 AS n_lines,
  (SELECT SUM(so_quantity) FROM sales_order_axszx8cj_sub
    WHERE sales_order_id = @so_id AND is_deleted = 0)                 AS total_qty,
  (SELECT SUM(so_amount) FROM sales_order_axszx8cj_sub
    WHERE sales_order_id = @so_id AND is_deleted = 0)                 AS lines_amount,
  (SELECT COUNT(*) FROM sales_order_blade_dept
    WHERE sales_order_id = @so_id AND is_deleted = 0)                 AS dept_rows;

-- Expect: status Draft / so_total 10000.0000 / n_lines 100 / total_qty 1000.000
--         lines_amount 10000.0000 / dept_rows 2
-- COMMIT;      -- <- run once the numbers match
-- ROLLBACK;    -- <- if anything looks wrong
