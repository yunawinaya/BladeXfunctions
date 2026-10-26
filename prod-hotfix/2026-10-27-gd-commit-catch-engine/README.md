# 2026-10-27 GD Complete / Cancel / Revert: a failed stock-engine call no longer parks the job for 30 minutes

**Status:**
- **Prod: LIVE, verified IDENTICAL by name and id:** GD_COMPLETE_COMMIT v12 (03:41:50), GD_CANCEL_COMMIT v8 (03:45:04),
  GD_REVERT_COMMIT v7 (03:48:20).
  - The designer saves a try-catch without the blocks' `key` and the try block's empty `data` (as GD_BULK_COMMIT prod v31
    does).
  - The builders now emit that form, so the paste files here and the repo files equal prod exactly. The test still
    passes 30/30 on them.
- **Dev:** LIVE since 03:32 (v12 / v10 / v7), functionally the same, but still in the earlier form with `key` / `data`, so
  `wf --dev deployed` says DIFFERS until the normalized files are republished there.

| # | Paste into | id | Paste file | Prod base (rollback), checked IDENTICAL 10-27 03:40 |
|---|---|---|---|---|
| 1 | GD_COMPLETE_COMMIT | 2110182729927753730 | `1_GD_COMPLETE_COMMIT.json` | v11 = `1_GD_COMPLETE_COMMIT.prod_v11_base.json` |
| 2 | GD_CANCEL_COMMIT | 2112455779051212802 | `2_GD_CANCEL_COMMIT.json` | v7 = `2_GD_CANCEL_COMMIT.prod_v7_base.json` |
| 3 | GD_REVERT_COMMIT | 2112758315749605378 | `3_GD_REVERT_COMMIT.json` | v6 = `3_GD_REVERT_COMMIT.prod_v6_base.json` |

Each paste differs from its prod base only in 5 nodes: the step's decision node (`code_node_CCc2` / `XCx2` / `RCr1`), and
the new try-catch around the engine call with its two blocks and the catch's `code_node_<X>crash`. The engine call node
itself is unchanged.

## What happened (prod, 10-26)
- **The incidents:** Kenhin GD 2097 (15:58) and LSH GD-2610-1473 (17:25).
- **The race:** the first use of a new stock lock key by two runs at once. INVENTORY_LOCK_SEED's insert lost the race on
  the duplicate. INVENTORY_BULK_APPLY caught it and answered 409, with nothing applied.
- **Why it stalled:** a caught error still fails every calling run. The commit and the worker crashed, and the job kept
  its 30-minute lease with the GD in Processing. 1473 was released by hand (`../2026-10-26-gd1473-dead-lease/`).
- **Frequency:** prod since 10-23 has 567 seed runs, 2 of which lost the race. GD Created had the same failure once
  (10-23) and has caught it since (GD_BULK_COMMIT `try_catch_P3invCal`).

## The change (`scratchpad/gdc/patch_commit_catch_engine_kits.py`, applied to the builders)
- **The catch:** the engine call runs inside a try-catch, the same shape GD_BULK_COMMIT runs live.
- **The decision:** a caught failure is decided as a 409 from the operation's intent rows. It becomes a counted retry,
  with the lease released, the GD kept locked, and 15 s of backoff growing to 5 min. After 8 tries it goes to review
  if the engine wrote intent rows; otherwise the job FAILS with nothing written and the GD is released.
- **Every other answer** (200 / 409 / 400 / review / none) decides exactly as before.
- **Recovery time:**
  - The 10-26 race ends the engine's run marker, so the retry claims at once: about 15 s plus the next kick.
  - A crash after the engine started its run waits for the engine's 20-minute heartbeat rule. That is still sooner than
    the 30-minute lease, and nobody has to release anything.
- **Also in this change:** the one-stock-call worker fix (`../2026-10-27-gd-workers-one-stock-call/`) was only in the
  worker JSON files. It is now in the three builders too, so a rebuild cannot revert it; the workers rebuild identical to
  live.

## Tests
- **Offline:** `node scratchpad/gdc/test/test_commit_engine_crash.js` passes 30/30. It runs each commit's own decision
  code on the real C2 entry of a dev run. The old versions fail the crash cases.
- **Lint:** the only addition is 3 UNUSED notes per commit for the try-catch shell nodes, the same as GD_BULK_COMMIT's.
- **Build check:** `scratchpad/gdc/tools/build_diff.py` shows only the 5 nodes per commit.
- **Live on dev, forced crash** (GD/20261019/598, job 2114803040298545153): its COST lock row was soft-deleted, so
  INVENTORY_BULK_APPLY threw ("IBA_LOCK_SEED: soft-deleted lock rows occupy …") before writing anything.
  - Commit run 2114803077673988097 caught it.
  - The job: COMMITTING_GD, attempt 1, lease cleared, due 15 s later, error GDC_LOCK_WAIT "INVENTORY_BULK_APPLY failed
    (caught), nothing written". The GD stayed Processing. **PASSED.**
  - Before this change it would have kept a 30-minute lease.
  - The row was restored. The next kick got the engine's 409 "the same operation is still running" (the forced throw
    left its run marker open), which was counted as retry 2.
  - Resume after the engine's 20-minute heartbeat: see below.
- **Live on dev, normal cancel** (GD/20261023/612, job 2114803388639686657): COMPLETED in one worker run (4.8 s); X2
  "OK Applied 2 movements"; the GD is "-Cancelled". **PASSED.**

**After the paste:** for each file, `.dbtools/wf --prod deployed "prod-hotfix/2026-10-27-gd-commit-catch-engine/<file>"`
must say IDENTICAL, with the name and id above.
