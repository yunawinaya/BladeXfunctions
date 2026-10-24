-- LSH (128671): release the two hand-placed outbox holds so the Picking consumer can close GD-2610-1254 / GD-2610-1256.
-- Both jobs are GD_COMMITTED (85%); their GD_COMMITTED events were set BLOCKED by hand at 11:33:24 MYT ("Temporary hold:
-- existing PI-2610-3256 and PI-2610-3261 ..." / "Temporary hold: manual picking exists ..."), so nothing finishes them.
-- Safe to release: LSH's Picking Setup has auto_trigger_to 0 and both GDs are picking_status Completed (manual Pickings
-- PI-2610-3256 / 3261 / 3269, all Completed), so the consumer answers NO_PICK (no Picking is created) and completes the jobs.
-- Mirrors a normal READY event: empty message, due now (next_attempt_at is TIMESTAMP: NOW()), version + 1.

-- 1. preview: expect the 2 BLOCKED rows
SELECT CAST(id AS CHAR) AS id, aggregate_no, dispatch_status, row_version, last_error_message
  FROM gd_outbox
 WHERE tenant_id = '128671' AND is_deleted = 0 AND id IN (2113805604324773890, 2113805585618178050);

-- 2. release: 2 rows
UPDATE gd_outbox
   SET dispatch_status = 'READY',
       last_error_message = '',
       next_attempt_at = NOW(),
       row_version = row_version + 1,
       update_time = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '128671' AND is_deleted = 0 AND id IN (2113805604324773890, 2113805585618178050)
   AND dispatch_status = 'BLOCKED' AND last_error_message LIKE 'Temporary hold:%';

-- 3. then, after about a minute (the consumer leaves an event alone for 60 s after it changes), open the LSH
--    Goods Delivery list once: it kicks the consumer, which closes both (event DONE, job COMPLETED).
