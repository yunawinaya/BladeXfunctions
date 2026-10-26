# GD Edit V2: a failed INVENTORY_BULK_APPLY call no longer crashes COMMIT (2026-10-27)

> **PROD LIVE 2026-10-27 04:12:** GD_EDIT_COMMIT is enabled as prod version 15 (the dev v16 content), verified IDENTICAL.

| Workflow | id | Paste file | Prod now (= base here) | Dev |
|---|---|---|---|---|
| `GD_EDIT_COMMIT` | 2110618866011787266 | `GD_EDIT_COMMIT.json` | v14 (`GD_EDIT_COMMIT.base.json`) | v16, 2026-10-27 04:12, identical (v15 03:4x = the catch alone) |

SUBMIT, PREPARE and WORKER do not change.

## What was wrong

E1 called INVENTORY_BULK_APPLY (`workflow_node_GXe1`) with no try/catch. When the engine's run failed, a caught error inside
it still failed every calling run. The 10-26 case: a first-use lock seed lost its race at Kenhin GD 2097 and LSH
GD-2610-1473 in the GD session's flows. COMMIT and the worker crashed, and the job sat under its lease with the GD in
Processing until someone released it by hand. The GD session found the same gap in GD_EDIT_COMMIT.

## The change

The same shape as GD_BULK_COMMIT's `try_catch_P3invCal` (live since 10-23) and the GD session's C2 / X2 / R1 fix:

- **The catch:** `workflow_node_GXe1` runs inside `try_catch_GXe1`. Its catch block runs `code_node_GXe1crash`, which
  returns `{ crashed: "YES" }`.
- **E1's decision** (`code_node_GXe1`, `scratchpad/gde/code/commit/e1.js`) treats a failed call as a 409:
  - It is a counted wait: the lease is released and the job comes due again after 15·2^n s (capped at 300 s), up to 8 waits.
  - Past the waits it goes to review if the operation has intent rows (they are read after the call). Otherwise it is
    FAILED with nothing written: the GD goes back to its stored status, and a Draft's number is put back.
- **COMMIT's run still ends in an error for its caller,** so the worker run fails as before, but only after the job row is
  written.

The built diff shows real changes only in `code_node_GXe1` and `code_node_GXe1in` (both bundle e1.js; the 409 wait became
a shared `lockWait`, with the same rows and messages as before), plus the new try-catch and `code_node_GXe1crash`. Every
other change is a builder-renumbered `response_json` key.

## The engine's run marker: the wait is ~20 min, not 15 s

The live dev repro showed that a crashed engine run has already written its v12 run marker:
- the replay answers `409 LOCK_BUSY: the same operation is still running (run 1, last heartbeat ...)`;
- the engine holds that for 20 min after the heartbeat;
- E1 already counts that message as its own operation (never a clean fail), and its 8 waits (~22.5 min) outlast the hold.

So a caught crash recovers on its own in about 20 min, with the job visibly waiting. Before this fix it sat leased and
crashed, with the GD in Processing, until someone intervened.

**v16, the own-run ceiling** (an edge the GD session found; they adopted the same rule in GD_COMPLETE / CANCEL / REVERT_COMMIT):
- **The problem:** a job that had already waited 4+ times before a crash would use up its 8 tries inside the engine's
  20-min hold.
- **Own-run 409** ("the same operation is still running") now waits until 16 tries, then review, never FAILED. That is 40+
  min of 300 s waits past the 8.
- **Why a ceiling:** a waiting job is touched every ≤ 5 min, so prod_health never sees it as stuck. Without a cap, an
  engine marker that never cleared would park the GD in Processing forever.
- **Another operation's lock** still gives up at 8 tries: FAILED without intents, review with them.

## Evidence

- **`scratchpad/gde/test/test_commit.js` 75/75.** New cases:
  - a failed call waits like a 409, with the lease released;
  - past the waits with nothing written, it goes to FAILED, unlocks the GD and puts the Draft number back;
  - with intent rows, it waits and then goes to review.
  - The new mutants `e1_crash_review` and `e1_crash_stale_ops` are caught; all 22 mutants are caught.
- **The other offline GD Edit suites pass.** Lint findings are unchanged from v14, apart from informational notes for the
  try-catch containers. `check_refs` reports 0 problems, and the E1 nodes compile.
- **Live dev repro, GD/20261027/633, job 2114806880146108417:**
  1. The lock row `ITEM|2070758892513914881|2018912822846582786` (id 2109943282192715783) was soft-deleted, so the
     engine's seed throws.
  2. The user moved the line to bin A1-B3.
  3. At 03:50:28 COMMIT caught the failure: COMMITTING_GD, lease released, GDE_LOCK_WAIT, "INVENTORY_BULK_APPLY failed
     (caught), nothing written".
  4. The row was restored. At 03:51:13 the retry got the engine's run-marker 409 and waited.
  5. After the hold passed, the worker kick at 04:11 completed it, on attempt 3:
     - E1 "OK Applied 4 movements", and E0-E7 all DONE;
     - the GD is Created, on bin A1-B3;
     - stock moved exactly once: A1-B3 107 / 0 -> 106 / 1, and A1-B1 5320 / 5202 -> 5321 / 5201 (unrestricted / reserved).
- **v16 (the ceiling):** test_commit 76/76, with the new case "another operation's lock past 8 tries still gives up" and
  the mutant `e1_own_run_tries`; 23/23 mutants are caught. The built diff against v15 is only `code_node_GXe1` /
  `code_node_GXe1in` (e1.js).

## After the paste

`.dbtools/wf --prod deployed "Goods Delivery/EditV2/GD_EDIT_COMMIT.json"` must say `IDENTICAL` for 'GD_EDIT_COMMIT'
(2110618866011787266).
