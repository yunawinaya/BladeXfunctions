# 2026-10-27 GD Complete / Cancel / Revert: wait out our own engine run, never give up on it

**Status:**
- **Dev:** LIVE, v14 / v12 / v9 (04:00:30-33), IDENTICAL to these paste files. It includes the 16-try ceiling below.
- **Prod: LIVE, verified IDENTICAL by name and id:** GD_COMPLETE_COMMIT v13 (04:16:11), GD_CANCEL_COMMIT v9 (04:18:41),
  GD_REVERT_COMMIT v8 (04:20:55).
- **Follows** `../2026-10-27-gd-commit-catch-engine/` (live on prod 03:41-03:48).
- **Dev live tests** on the commits this builds on all PASSED:
  - forced crash on GD/20261019/598: a counted retry, then COMPLETED once the engine marker went stale, 2 movements
    applied once;
  - cancel of GD/20261023/612;
  - revert of 598 back to Created.
- **Accepted edge:** a SECOND crash of the same job after its tries passed 8 (for example, inside a long own-run wait)
  ends at once: FAILED with nothing written, or review if the engine had written intent rows. It needs two crashes of one
  job within the hour.

| # | Paste into | id | Paste file | Prod base (rollback), checked IDENTICAL 10-27 |
|---|---|---|---|---|
| 1 | GD_COMPLETE_COMMIT | 2110182729927753730 | `1_GD_COMPLETE_COMMIT.json` | v12 = `1_GD_COMPLETE_COMMIT.prod_v12_base.json` |
| 2 | GD_CANCEL_COMMIT | 2112455779051212802 | `2_GD_CANCEL_COMMIT.json` | v8 = `2_GD_CANCEL_COMMIT.prod_v8_base.json` |
| 3 | GD_REVERT_COMMIT | 2112758315749605378 | `3_GD_REVERT_COMMIT.json` | v7 = `3_GD_REVERT_COMMIT.prod_v7_base.json` |

Each paste differs from its prod base in one node only: the step's decision (`code_node_CCc2` / `XCx2` / `RCr1`).

## Why (found by GD Edit & Picking V2 on GD_EDIT_COMMIT, seen on dev GD/20261019/598)
- **The hold:** after a caught engine crash, the job retries at once. But the crashed engine run may already have opened
  its run marker. The engine then answers 409 "the same operation is still running" until that marker's heartbeat is
  20 min old, and only then takes the operation over.
- **The gap in the live version:** it counts those answers toward its 8 tries (15 s doubling, capped at 5 min).
  - For a crash on a job's first try, that outlasts the hold: the 8th try lands at about 22.75 min, so the job
    succeeds.
  - A job that had already waited 4+ times on other operations' locks would run out of tries inside the hold. It would
    end FAILED, or in review if the engine had written intent rows. Before 10-27 03:41 it healed after its 30-min lease.

## The change (`scratchpad/gdc/patch_commit_own_run_wait.py`, in the builders' modules)
- **Our own operation:** when the engine's 409 says "the same operation is still running", that is this operation. The
  step keeps waiting (the same retry, lease released, GD kept locked) for up to 16 tries, about an hour.
- **Why the wait is finite:** the engine takes the operation over 20 min after the last heartbeat. A later run of the
  same operation is fenced and writes nothing.
- **The ceiling** (`patch_commit_own_run_ceiling.py`, as GD_EDIT_COMMIT E1): past 16 tries it goes to review, never
  FAILED. Each retry touches the job row, so without it a marker that never clears would hold the GD in Processing
  where prod_health's "untouched" check can't see it.
- **Unchanged:** another operation's lock gives up after 8 tries as before; every other answer decides as live.

## Tests
- **Offline:** `node scratchpad/gdc/test/test_commit_engine_crash.js` passes 48/48 on these files against today's prod.
  The new cases:
  - an own-run 409 keeps waiting at try 9 and at try 16, and goes to review at try 17 (with and without intent rows);
  - another operation's lock at try 9 still gives up.
- **Lint:** same as prod.

**After the paste:** for each file, `.dbtools/wf --prod deployed "prod-hotfix/2026-10-27-gd-commit-own-run-wait/<file>"`
must say IDENTICAL, with the name and id above.
