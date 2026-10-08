-- R9  BUG-002  Converted SIs saved Completed although the credit check returned Override
-- ---------------------------------------------------------------------------------------------
-- REPORT ONLY -- no SQL repair. 23 SIs since 2026-09-21 (22 Kenhin 528521, 1 tenant 551372).
-- 19 are already Fully Posted in SQL Accounting: leave them alone.
-- 4 are not posted. They already moved SO / GD invoice status and created the AR invoice, so a
-- SQL flip to Draft would leave those inconsistent. Handle them in the app once the customer's
-- credit position is settled (complete posting, or cancel and re-invoice):
--   SI/20261001/0037  Failed Post   (SQL Accounting: overdue 896.00 > 0.00)
--   SI/20261001/0051  Failed Post   (SQL Accounting: credit 12,319.20 > 5,000.00)
--   SI/20261002/0086  Unposted
--   SAI00446558       Unposted      (tenant 551372)
--
-- Not fixable in code: SUDU's own credit data disagrees with SQL Accounting for Kenhin. For
-- SI/20261001/0042 SUDU's check PASSED (allowed credit 10,000, overdue 0) while SQL Accounting
-- rejected it (overdue 1,240). Until the customer credit / overdue sync is corrected, such
-- invoices complete in SUDU and fail at posting even after this fix.
-- ---------------------------------------------------------------------------------------------

SELECT tenant_id, sales_invoice_no, si_status, posted_status, invoice_total, create_time
FROM sales_invoice
WHERE is_deleted = 0 AND id IN (
  2103007900954923010, 2105537083060916226, 2105542116003418114, 2105853826228686849,
  2105951920593178625, 2106952430406209537, 2106986038290419714, 2107304666927861762,
  2107319226556616706, 2107319718712053761, 2107321642547023874, 2107321815247491074,
  2107339362575454210, 2107339980069277697, 2107718130318053378, 2108022161141796866,
  2108022242020560897, 2108062923539746817, 2108063587581956098, 2108063638614052865,
  2108063764380258306, 2108063807032135681, 2108064724309643266)
ORDER BY posted_status, sales_invoice_no;
