-- Kenhin (528521) SO-1026-1162: its organization_id is empty, so Convert to GD refuses it ("sales order 2116048711493750785
-- not found": GD Created V2 reads the sales orders of the delivery's organization only). Its draft (DRAFT-SO-0197, submitted
-- for the credit-limit approval at 14:05) and its line both carry organization 2006752085806436353. Put that back.
-- Re-runnable: it only touches the row while the organization is still empty.

UPDATE sales_order
   SET organization_id = '2006752085806436353'
 WHERE id = 2116048711493750785
   AND tenant_id = '528521'
   AND so_no = 'SO-1026-1162'
   AND is_deleted = 0
   AND (organization_id IS NULL OR organization_id = '');
-- expect: 1 row affected

SELECT so_no, so_status, organization_id FROM sales_order WHERE id = 2116048711493750785;
-- expect: SO-1026-1162 | Issued | 2006752085806436353
