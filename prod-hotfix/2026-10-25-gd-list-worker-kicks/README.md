# GD list: queued completions keep moving after the page closes (2026-10-25, BA point 1)

## What was wrong

There is no scheduled worker (no Quartz, user decision 10-14). Only clients start the workers. The GD list's bulk Complete
queued each GD, then ran one worker without a job id, again and again while runs found work. That loop stops when the page
closes or a run errors.

Jobs left over then waited for the next time someone opened the GD list. At LSH since 10-24, 33 of 250 completion jobs waited
over 5 minutes, and one waited 2.4 hours (10-25 12:06 → 14:31). Paths that start the worker with the job's id (Picking,
Packing, Edit, GD create from the form) start in 1-5 s.

## Fix (GD list page 1902688873696313346: only the scripts `func_bulkComplete` and `mounted`)

- **Bulk Complete** (`Goods Delivery/CompleteV2/gdc_list_func_bulkComplete.js`):
  - Every queued GD gets its own worker run with its `job_id`, all started at once, up to 12. LSH queued at most 12 per click
    since 10-20.
  - Each run finishes on the server even if the page closes. A run for one job never touches another, so runs can't race for
    the same claim.
  - The id-less sweep follows 10 s later for anything still due.
- **GD list open** (`Goods Delivery/CompleteV2/gdc_list_mounted.js`):
  - Besides the kick when the list opens, the same kick of all five workers and the Picking consumer repeats every 2 minutes
    while the list stays open, in a background tab too.
  - It uses the same per-browser 2-minute throttle, so several tabs don't multiply it.
  - It stops when the page leaves the list. A re-opened list replaces it.
  - Any job left by a run that reached its budget or crashed (lease expired) moves on within about 2 minutes, as long as
    someone has the GD list open.

## Evidence

- `scratchpad/gdc/test/test_list_mounted.js` passes 8 of 8. The 2 new beat tests fail on the live script.
- `scratchpad/gdc/test/client_list_sim.js` checks that each queued job starts with its `job_id`, then the sweep. It fails on
  the live script.
- The worker takes `job_id`, as the form's queued branch already sends it (live on prod).
- Dev: the GD list page is published as v402, identical to the repo file, with both scripts equal to the repo `.js` files.

## Prod

1. In the designer, open the **Goods Delivery list page** (id 1902688873696313346), replace its page JSON with
   `GDlistPage.prod_v401_worker_kicks.json`, and publish. Prod v401 is identical to the dev v401 this was built on, so the
   file is prod's page with only the two scripts changed.
2. Tell me and I'll compare the prod page with the file.

`GDlistPage.prod_v401_live.json` is prod's page as it is now, kept to reverse the change.
