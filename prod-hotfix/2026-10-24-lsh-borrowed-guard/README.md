# LSH (128671) "borrowed guard": GD crashes and leaked stock locks (2026-10-24)

Prod pastes of 11:06-11:08 MYT: PACKING_SAVE v31, GOODS_DELIVERY v181, GD_UNUSED_FN_NEW v52 (an LSH-only guard: PACKING_SAVE
takes COST|<material>|<plant> locks as `PKS|<28 hex>` and hands their context to GD_UNUSED_FN_NEW through GOODS_DELIVERY).

- Crash: GD_UNUSED_FN_NEW v52 `code_node_BGscope` throws "borrowed guard batch refused" whenever the stock batch answers
  anything but 200 (an ordinary refusal such as insufficient stock), so the Packing save fails with "A workflow error
  occurred". 7 PACKING_SAVE + 7 GOODS_DELIVERY runs failed 11:09-11:19.
- Leak: each crashed Packing save left its PKS locks held (the lock table has no expiry): 22 COST keys, 7 owners, at 11:25.
  The V2 engines claim the same COST keys, so V2 GD jobs on those items wait on LOCK_BUSY and then fail.
- Worse (bladexfunctions-22): a guard write at 11:24:44 marked 11,213 LSH gd_publish_step rows. That recovery is
  bladexfunctions-22's and the Packing session's (bladexfunctions-3d); nothing here touches gd_publish_step or gd_async_job.

Order:

1. PACKING_SAVE back to prod v58 (10-21): `prod-hotfix/2026-10-24-lsh-packing-guard-revert/RESTORE_PACKING_SAVE.v58_2026-10-21.json`
   (owned by the Packing session; identical to prod's v58 history row). This stops new locks, the crash path and the bad write.
2. Optional, for a clean known state: `revert/GOODS_DELIVERY.prod_v177.json` (keeps fa's v246 unit guard) and
   `revert/GD_UNUSED_FN_NEW.prod_v56.json` (keeps 9d's MIN-01 pre-check, off). With PACKING_SAVE at v58 their guard code is
   dormant (no guard context, `BGscope` skips), so this is not urgent; skip it if the guard's author fixes forward.
3. About a minute after step 1: `release_pks_locks.sql` (preview, release, check). It releases only PKS-owned COST locks
   claimed over 5 minutes ago, the way the guard's own release does.

`guard_today/` holds the three guard versions as pasted, for whoever fixes the guard forward.
