# Putaway: LSH readiness for 2026-10-26

Owner: the "PO GR Putaway V2" session. Scope: PUTAWAY_ASYNC_SUBMIT / WORKER and PUTAWAY_BULK_PREPARE / COMMIT (V2),
classic PUTAWAY_LOOP / PUTAWAY, the Putaway form and list, and the server side of the mobile `hotfix/v2-background`
OTA for Putaway. Updated 2026-10-25 13:23 MYT. **Nothing to paste.**

## Server state (checked 2026-10-25, read-only)

Same ids on dev and prod. Every row below has prod = dev = repo.

| Workflow | Id | Version |
|---|---|---|
| PUTAWAY_ASYNC_SUBMIT | `2110545826201112577` | v5 |
| PUTAWAY_ASYNC_WORKER | `2110545857423511553` | v3 |
| PUTAWAY_BULK_PREPARE | `2110545896879329281` | v5 |
| PUTAWAY_BULK_COMMIT | `2110545933231362050` | v8 |
| PUTAWAY_LOOP (classic) | `2031190421336195074` | v19 |
| PUTAWAY (classic) | `2031249915811270657` | v35 |

`.dbtools/wf --prod deployed Putaway/AsyncV2/PUTAWAY_ASYNC_WORKER.json` matches PICKING_ASYNC_WORKER (79 shared node ids)
and says DIFFERS. Compare the worker by its id instead (`su_code_workflow_history.data_id = 2110545857423511553`).

## Tomorrow's load

- LSH (128671) barely uses putaway. One plant (`1996821094283493377`) has putaway on, with auto TO and
  auto_completed_gr 1. It made 6 TOs on 10-23 (2 lines on average, at most 7). PUTAWAY_LOOP ran 44 times at LSH since
  10-13, all successful, 2 s on average, 11 s at most.
- The OTA moves every tenant's mobile Putaway to V2. Across prod since 10-13 there were ~270 PUTAWAY_LOOP runs, all
  successful: 073522 had 181, LSH 44, the rest 4-17 each.
- Prod V2 use so far: 4 COMPLETE_PUTAWAY jobs (073522, desktop, 10-23), all COMPLETED.

## The mobile OTA (Putaway side)

Mobile has done its part (sudu-mobile-expo-9a, commit `2b9c7e55`, PR #663):
- `followPutawayJob` kicks the worker `{ job_id }` at once, then calls STATUS every 10 s, re-kicking while the job runs.
  It stops at a final status, after 3 min idle, or after 10 min.
- The open screen re-kicks a running job.
- One `{}` list kick per 2 min, with no loop.
- Kicks and STATUS calls have timeouts.

The guide (`Putaway/AsyncV2/MOBILE_PUTAWAY_V2_GUIDE.md`) is corrected to match: Part 5 follower and no loop on
`processed`; the header and Part 7 now say prod V2 is on.

**Mixed fleet** (old-build phones, OTA phones, desktop) is safe. Classic PUTAWAY_LOOP v19 on prod answers "The current
putaway is under processing" when a V2 job of the TO is open (REQUIRES_REVIEW included) or its GR is `Processing`.
That still holds after the TO's `is_processing` passes its 900 s stale limit, and nothing is written. Old-build phones
retry on that answer.

Unchanged, by design: HU, bundle and serial lines, a TO not saved yet, and a costing-migration item without a unit
price answer NOT_ELIGIBLE, and the phone runs the classic call (at most 500 lines).

## Worker budget: kept at 20 s (user's decision, 10-25)

A worker run always takes its first job and starts no further job after 20 s. Every job someone follows is kicked by
its id (the mobile follower, the desktop form), and a `{ job_id }` run takes only that job, so the budget never delays
it. Only the id-less list sweep is limited, and putaway jobs are small (a few seconds), so a sweep still finishes
several. A stock-lock wait (engine 409) is a plain wait: the job retries 10 s later on the next kick, and the wait never
counts towards review.

## What to watch tomorrow

- `python3 scratchpad/prod_health.py --tenant 128671`. Its JOBS section shows COMPLETE_PUTAWAY jobs left open 15+ min
  or in REQUIRES_REVIEW; CRASHES shows PUTAWAY* runs.
- Putaway jobs by status:
  `SELECT tenant_id, job_status, COUNT(*), MIN(update_time) FROM gd_async_job WHERE command = 'COMPLETE_PUTAWAY' AND
  is_deleted = 0 AND create_time > CURDATE() GROUP BY tenant_id, job_status`
- A TO held by a phone that died mid-classic. Classic takes it over after 900 s; V2 SUBMIT refuses while it is younger:
  `SELECT id, to_id, update_time FROM transfer_order_putaway WHERE tenant_id = '128671' AND is_processing = 1 AND
  is_deleted = 0`
- Messages for the owner: a job FAILED or REQUIRES_REVIEW, or a TO in Processing with no open job.
