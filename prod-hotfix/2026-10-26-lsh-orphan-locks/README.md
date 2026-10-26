# 2026-10-26 LSH: 5 orphaned stock operations held 81 keys

## What happened
1. **07:30:49-07:31:17.** Five GD creations' stock calls (INVENTORY_APPLY_OPERATION -> INVENTORY_LOCK_TOKENS, TAKE) froze
   inside the platform's atomic-count node, the step that takes each stock key.
   - The platform's own doc (`.su-code/docs/workflow/sdk/atomicCount.md`) says that node's distributed lock is taken inside
     the transaction and is not safe under real concurrency.
   - MySQL saw nothing: innodb_lock_wait_timeout is 50 s and deadlock detection is on.
   - One call (GD|2114497026472415234|11, SO-Lee-029873) had taken all its keys. The other four waited on keys it held.
2. **07:51:17-07:51:20.** The platform ended all five chains, 20 minutes after they started (its child-call limit).
3. **The bug.** GD_BULK_COMMIT treats a failed engine call as a counted retry with a NEW operation id. The frozen
   operation stays LOCKING and keeps its keys, and nothing ever calls it again; these locks have no expiry. Result:
   - 81 key rows were held for good (33 products, including cooking oil, salt, MSG, oyster and soy sauce, chicken stock and
     milk);
   - every GD needing them waited, including the five jobs themselves on their new operations;
   - GD-2610-1466 failed at 07:39:40 on the old 20-retry limit, and GD-2610-1470 waited.
4. The user's 07:51 lease UPDATE on job 2114497026472415234 did not free the keys. That job moved to |12 / |13.

## Repair
`repair.sql`, run by the user:
- releases the 81 rows still owned by the 5 orphans, the way the engine's own release leaves a row;
- marks the 5 operations REJECTED / LOCK_CONFLICT, as the engine's recovery does.

Checked before handing over:
- all 10 runs of the five chains had ended (0 InExecute);
- none of the operations ever started moving stock (`locked_at` / `mutation_started_at` NULL), so no stock is affected;
- the WHERE clauses only match rows still in the stuck state.

## Fix to build (not in this repair)
- **GD_BULK_COMMIT:** after a failed engine call whose operation is still LOCKING, call the same operation again so the
  engine's recovery releases its keys. Moving to a new id orphans them. This is where the 10-23 catch patch went wrong.
- **Engine (INVENTORY_LOCK_TOKENS):** don't rely on the platform atomic-count under concurrency; claim keys with unique
  inserts. Bigger, to plan.
- **Watch:** an operation LOCKING with an expired lease and no live run = orphan; alert on it.
