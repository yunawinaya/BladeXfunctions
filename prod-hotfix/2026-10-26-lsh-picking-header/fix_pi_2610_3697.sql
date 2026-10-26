-- Prod 2026-10-26, LSH (tenant 128671): PI-2610-3697 shows In Progress although all 5 rows are Completed.
-- Two pickers confirmed different rows of it 14 ms apart (10:02:52, Picking V2 jobs 2114538217914109954: 2 rows, and
-- 2114538217968635905: 3 rows). Each job worked out the header from its own view, where the other's rows were still open,
-- so both wrote "In Progress". Rows, records (5, 36 picked = 36 to pick), GD-2610-1607 (Completed) and PACK-2610-1453
-- (Completed) are all right; only the header status is stale. Later confirms are refused ("enter a picked quantity").

-- 0. preview (expect 1 row: In Progress, is_processing 0, open_rows 0)
SELECT t.to_id, t.to_status, t.is_processing,
       (SELECT COUNT(*) FROM transfer_order_jz8m9w3h_sub r
         WHERE r.transfer_order_id = t.id AND r.is_deleted = 0 AND r.line_status <> 'Completed') AS open_rows
  FROM transfer_order t
 WHERE t.tenant_id = '128671' AND t.is_deleted = 0 AND t.to_id = 'PI-2610-3697';

-- 1. fix (expect 1 row)
UPDATE transfer_order t
   SET t.to_status = 'Completed'
 WHERE t.tenant_id = '128671' AND t.is_deleted = 0 AND t.to_id = 'PI-2610-3697'
   AND t.to_status = 'In Progress' AND t.is_processing = 0
   AND NOT EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub r
                    WHERE r.transfer_order_id = t.id AND r.is_deleted = 0 AND r.line_status <> 'Completed');

-- 2. check: preview 0 shows Completed
