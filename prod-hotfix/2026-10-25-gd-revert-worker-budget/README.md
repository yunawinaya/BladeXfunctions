# GD_REVERT_WORKER: run budget 20 s -> 240 s, 2026-10-25

**Paste into: GD_REVERT_WORKER (id 2112758130420088833).** Not GD_REVERT_SUBMIT / PREPARE / COMMIT, and not GD_COMPLETE_WORKER
or GD_CANCEL_WORKER.

GD Revert V2 belongs to session c8, which is not running. Session 42 took this one fix on the user's say-so (10-25). This
is the same change "GD Completed & Created V2" made to GD_COMPLETE_WORKER (README item 1 in `../2026-10-25-lsh-readiness/`).

## What changes

- A worker run takes up to 5 due revert jobs, but started no new one after 20 s. A 25-30 s job meant one job per run, and
  the rest waited for the next kick.
- Now it starts new ones until 240 s. A started job is never cut.
- Only the constant changes, in place in its 5 copies (no rebuild, so no response_json keys move). The builder source
  `scratchpad/gdrev/code/worker/_common.js` says 240 too.
- **Who benefits:**
  - The bulk Revert Completed button and the GD form already kick each job by its id, and such a run takes only that job.
  - The change helps id-less sweeps: the GD list's mount kick picking up jobs whose page was closed.
- **Prod usage:** 0 REVERT_GD jobs since 10-22, so there is no risk either way for LSH's 10-26 volume.

## Files

| File | What it is |
|---|---|
| `GD_REVERT_WORKER.json` | Paste this. Prod v5 with the 5 constants at 240; nothing else differs (checked) |
| `GD_REVERT_WORKER.prod_v5.json` | Prod's live v5 (2026-10-22 15:23:01), read 10-25; identical to dev v5 |

## Evidence

- `scratchpad/gdrev/test/test_worker_budget.js` runs the built pick node after a 100 s job.
  - v5 skips the next job; the fix claims it.
  - Past 240 s, it is left for the next tick. The first job of a run is always taken.
- Lint: same findings as v5. test_engine_409_wait, test_form_revert_follow and test_list_revert pass.
- Dev: published as v6 at 13:26 (the user's yes; backup v5_20261025-132420). Idle smoke OK: worker_route IDLE, nothing written.

## After the paste

**Pasted 2026-10-25 13:33:32 as prod v6: IDENTICAL** (checked by `wf --prod deployed`).

Check the target: `.dbtools/wf --prod deployed "Goods Delivery/RevertV2/GD_REVERT_WORKER.json"` must say IDENTICAL.
