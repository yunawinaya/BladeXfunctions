# 2026-10-28 PTS (tenant 035843) GD/2610/1010: a GD Cancel V2 stuck at its last step on a duplicate number

**Status:** DONE. Run on prod and verified 2026-10-28 ~19:00 (PART 3: 2 / 1 / 4 / 16).
- The first GD's 6 movements and its 1 Picking row are untouched.
- **The cancel finished at 19:25:40:** the job is COMPLETED (X0-X7 all DONE), and the GD is Cancelled as `GD/2610/1010-Cancelled-2`
  with every line Cancelled.

## What happened
- **Two GDs share GD/2610/1010.**
  - The first (2115351788000514049) was created at 15:55, then completed, reverted and cancelled at 16:15. It became
    `GD/2610/1010-Cancelled`.
  - The second (2115361119882317825) was created at 16:32 by GD Created V2. The form (LHPANG, SO/2610/1008) submitted the
    number already filled in, and nothing refused it.
- **The cancel:** CANCEL_GD job 2115361765603807234 (16:35) did X0-X5: the stock was released, and its Picking and
  movements were renamed to `GD/2610/1010-Cancelled`.
- **The failure:** X6 (`update_node_XCx6head`, the GD header) then failed at 16:35 and again at 17:05 with "Next serial number is
  already in use". The first GD already has that number.
- **The state:** the GD stays Processing. Every retry fails the same way.

## The repair (`repair.sql`)
- **The new number:** the second GD's cancelled number becomes `GD/2610/1010-Cancelled-2` everywhere X5 put
  `GD/2610/1010-Cancelled`, and in the cancel's stored plan. That covers:
  - the GD and NUM parts of the plan (2 rows);
  - Picking header PI/2610/1017-Cancelled and its 4 rows;
  - the GD's own 16 stock movements, by id (`movements.json`: its create operation and its cancel operation).
- **Nothing of the first GD changes:** its 6 movements and 1 Picking row keep their number.
- **The job itself is untouched.** The next GD_CANCEL_WORKER run at PTS, nudged by a PTS user's GD list, finishes:
  - X6: the header Cancelled with `GD/2610/1010-Cancelled-2`, plus the lines;
  - X7: item dates and the reorder update. Then the job is COMPLETED.

## Run, in order
1. **PART 1:** checks; all must match.
2. **PART 2:** expect rows affected 2 / 1 / 4 / 16. Every statement is guarded, so a second run does nothing.
3. **PART 3:** after-checks.
4. **Then:** I check the job and the GD once PTS's worker has run.

## The cause, fixed separately
The user typed the cancelled number into the new GD, as PTS and 681409 often do. That is allowed, so the fix is in the cancel: it now
takes the first free "-Cancelled-<n>". See `../2026-10-28-gd-cancel-reused-number/`.
