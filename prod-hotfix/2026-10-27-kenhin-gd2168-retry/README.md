# 2026-10-27 Kenhin GD/20261027/2168: retry the stuck GD Created V2 job

**Status:** DONE on prod, verified 14:26.
- **Dev test:** passed at 14:21.
- **Prod run:** the user ran `retry_2168.sql` at about 14:24. Its PART 1 preview had matched prod at 14:05 and again at
  14:23.
- **What the worker did:**
  - 14:24:23 (W0_CLAIM_17): took the RETRY, moving P3 to `|2`, attempt 2.
  - 14:24:38 (W0_CLAIM_20): applied `|2`, which ended DONE OK.
  - 14:25:05: the job was COMPLETED.
- **What prod shows:**
  - GD/20261027/2168 is Created.
  - 12 movements, all from `|2`: 6 OUT Unrestricted and 6 IN Reserved, 80 each way. `|1` has 0.
  - 6 reservations Allocated, 80 in total.
  - SO-1026-981: planned = ordered on all 6 lines.
  - No lock is held.
  - No Picking yet, like its normal peers 2166 / 2167.

## What happened (528521, job 2114948162857865218, SO-1026-981, 6 lines)
- **13:26:57** 2168's stock call (operation `GD|2114948162857865218|1`) stopped before its first write: REQUIRES_REVIEW
  VERIFICATION_MISMATCH "BEFORE_FIRST_WRITE: this run wrote no business row".
  - Cause: a classic desktop auto-complete changed 2 of its balance rows under its lock. Classic doesn't take engine locks.
  - Result: the job went to REQUIRES_REVIEW, and the GD stayed hidden as Processing.
- **Written by that call:** nothing. 0 movements, 18 effects UNCERTAIN with none applied, no balance row changed.
- **Its 12 locks:** released earlier by `../2026-10-27-kenhin-gd2168-review-locks/release_locks.sql` (user, done).
- **Still holding:** SO-1026-981 has no other GD and no newer job.
- **Stock:** each planned bin has ample Unrestricted stock (≥ 786k each, 10–20 needed), and no lock is held.

## The repair (`gen_retry.py` → `retry_2168.sql`)
It records the operation the way the engine records its own retryable rejection, then lets GD_BULK_COMMIT retry by
itself. Each UPDATE is guarded on the exact review state, and the job row is written last.
1. **Operation:** set to REJECTED + STALE_BEFORE_MUTATION, with `mutation_started_at` cleared.
   - The commit treats any non-DONE row carrying that timestamp as review.
   - The original message is kept at the end of `result_message`.
2. **Effects:** 18 set to NOT_APPLIED.
3. **Gate:** set to `REJECT|STALE_BEFORE_MUTATION|<same nonce>`, the shape of an engine rejection.
4. **P3 step:** set back to STARTED (same operation, attempt 1).
5. **Job:** set to COMMITTING_GD, due now, no lease, row_version + 1.

**Then the worker:**
- **First run:** GD_BULK_COMMIT reads REJECTED STALE_BEFORE_MUTATION and takes its own RETRY. It moves to operation `|2`,
  sets the job's attempt_count to 1 and backs off 2 s.
- **Next run:** it calls the engine with `|2`, then publishes (P6–P7E). That makes 2168 Created, and its Picking follows
  the usual way.

## Dev test (`scratchpad/gdc/retry_review/`, user's yes, tenant 000000, SO/20260910-034, 10 × TES511)
1. **Twin A, normal:** the conversion made GD/20261027/640, and GD Cancel V2 then cancelled it.
2. **Twin B, stopped like 2168:** the same SO converted again.
   - A guarded `+1` on its planned balance row went in while its call was MUTATING, playing the unlocked writer.
   - The engine stopped REQUIRES_REVIEW VERIFICATION_MISMATCH BEFORE_FIRST_WRITE (`OTHER:1`).
   - The `+1` was then taken back.
3. **Release and repair on twin B:**
   - Its 2 locks were released with the same statement as `release_locks.sql`.
   - `gen_retry.build()` produced the same statements as the prod file. Every preview line matched, and the UPDATEs wrote
     exactly 1 / 3 / 1 / 1 / 1 rows.
4. **The retry:**
   - The worker's first run took the RETRY.
   - The second run applied `GD|…|2` (DONE OK), then P6–P7E, and the job COMPLETED as GD/20261027/641.
   - Operation `|1` stayed REJECTED with 0 movements, and no lock is left.
5. **Twins compared** (`diff_twins_create.py`, A's delta vs B's): GD lines, reservations, SO, SO lines, balances and
   movements are the SAME.
   - Only delivery_date differs: it is the conversion time.
   - So does item.last_transaction_date: A had already moved it to today.
6. Dev's backend restarted at 14:19:29 (about 1 minute). Kicks sent then got "Gateway Timeout" and never reached the
   worker, so they only delayed the result.

## Run on prod
1. **PART 1 (read-only):** every result must match the line above it.
2. **PART 2:** run one UPDATE at a time. Each must report exactly the row count shown (1 / 18 / 1 / 1 / 1). If one
   doesn't, stop and send it to me. A stop before UPDATE 5 leaves the job in review, which is harmless.
3. **PART 3:** the checks.
4. **The worker:** any Kenhin GD list that is open starts it within 2 minutes. Expect 2168 Created within a few minutes.
   I then check that `|2` is DONE with 12 movements (6 OUT / IN pairs), that the job is COMPLETED, and that no lock is
   held.

**Rollback:** none is needed before UPDATE 5. After it, the job runs by itself, and the engine re-checks stock under its
locks.
