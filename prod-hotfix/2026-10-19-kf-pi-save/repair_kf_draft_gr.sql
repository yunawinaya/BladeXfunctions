-- KF CORPORATE (tenant 073522, org 2064222911015276546), PROD.
-- Undo the GR invoicing left behind by the failed PI_SAVE completions of three Draft PIs:
--   2609288KQ84GGG -> GR-MY2610-018    2609288KQ84GGB -> GR-MY2610-028    2609288KQ84GGJ -> GR-MY2610-029
-- Order: paste the fixed PI_SAVE first, then run this, then Save as Completed on each of the three PIs.
-- Do NOT apply to GGD / GGA / SPWMS2026091010466 (Fully Posted; their GR figures are correct).

-- 1. Check: expect 6 rows, invoice_qty = received_qty, pi_status 'Fully Invoiced', only these three Draft PIs referencing them.
SELECT g.id, gr.gr_no, g.item_name, g.received_qty, g.invoice_qty, g.pi_status,
       (SELECT GROUP_CONCAT(CONCAT(p.purchase_invoice_no, ':', p.pi_status))
          FROM purchase_invoice_xpuy7o4q_sub l
          JOIN purchase_invoice p ON p.id = l.purchase_invoice_id AND p.is_deleted = 0
         WHERE l.gr_line_id = g.id AND l.is_deleted = 0) AS referencing_pis
  FROM goods_receiving_eg6l4ywi_sub g
  JOIN goods_receiving gr ON gr.id = g.goods_receiving_id
 WHERE g.tenant_id = '073522' AND g.is_deleted = 0
   AND g.id IN (2105856534511751170, 2105856534515945474, 2105932618167095300,
                2105932618167095301, 2105932618137735173, 2105932618141929474);

-- 2. GR lines back to uninvoiced. Expected: 6 rows affected.
UPDATE goods_receiving_eg6l4ywi_sub
   SET invoice_qty = 0, pi_status = ''
 WHERE tenant_id = '073522' AND is_deleted = 0
   AND id IN (2105856534511751170, 2105856534515945474, 2105932618167095300,
              2105932618167095301, 2105932618137735173, 2105932618141929474)
   AND invoice_qty = received_qty
   AND pi_status = 'Fully Invoiced'
   AND NOT EXISTS (SELECT 1
                     FROM purchase_invoice_xpuy7o4q_sub l
                     JOIN purchase_invoice p ON p.id = l.purchase_invoice_id
                    WHERE l.gr_line_id = goods_receiving_eg6l4ywi_sub.id AND l.is_deleted = 0 AND p.is_deleted = 0
                      AND p.pi_status <> 'Draft');

-- 3. GR headers back to uninvoiced (every line of these GRs is reset in step 2). Expected: 3 rows affected.
UPDATE goods_receiving
   SET pi_status = ''
 WHERE tenant_id = '073522' AND is_deleted = 0
   AND id IN (2105856534385922049, 2105932618049654785, 2105932618011906050)
   AND pi_status = 'Fully Invoiced'
   AND NOT EXISTS (SELECT 1 FROM goods_receiving_eg6l4ywi_sub g
                    WHERE g.goods_receiving_id = goods_receiving.id AND g.is_deleted = 0 AND g.invoice_qty > 0);

-- 4. Re-run step 1: expect invoice_qty 0 and pi_status '' on all 6 rows.
