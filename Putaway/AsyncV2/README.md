# Putaway Completion V2 — Completed in the background (dev and prod)

Built 2026-10-14/15. A Putaway confirmation runs in the background, in steps that each check what they wrote.
On dev a 2,000-line Transfer Order is put away in about 2 s (SUBMIT) plus 85 s (worker) per confirmation. That covers
4,000 movements, the records, and 2,000+ in-transit rows. The classic PUTAWAY_LOOP → PUTAWAY takes about 0.75 s per
line, so roughly 25 min at 2,000 lines. **On prod since the 2026-10-22 full deployment** (desktop form). Checked
2026-10-25: prod = dev = repo for all four workflows, same ids.

| Workflow (id, version on dev and prod) | Role |
|---|---|
| PUTAWAY_ASYNC_SUBMIT `2110545826201112577` v5 | runs PUTAWAY_LOOP's and PUTAWAY's gates (lifted) against the **stored** pending quantities. Then it locks the TO (`is_processing 1`), writes the LOCK row and queues a `COMPLETE_PUTAWAY` job. `operation: STATUS` reports the latest job |
| PUTAWAY_ASYNC_WORKER `2110545857423511553` v3 | claims due jobs and calls PREPARE, then COMMIT twice (COMMIT splits after the stock step) |
| PUTAWAY_BULK_PREPARE `2110545896879329281` v5 | SQL reads (no row caps; in-transit rows still In Transit with every column, closed ones as keys only), PUTAWAY's code lifted verbatim, and INVENTORY_BULK_APPLY in PLAN mode: per row, SUBTRACT at the source bin + ADD at the target bin (`TO - PA`, isMovingInv 1, the line's price and dates) |
| PUTAWAY_BULK_COMMIT `2110545933231362050` v8 | P0 revalidation (stored pending, open in-transit rows, header `update_time`) · P1 stock (INVENTORY_BULK_APPLY, all or nothing) · P2 records (keyed by `job_line_key`), lines, `to_status` · P3 in-transit rows (close the consumed ones, insert remainders) · P4 GR `putaway_status` / `gr_status` · unlock |

Built from `scratchpad/pwv2/` (`python3 build_pwv2.py [--write] [NAME ...]`; for a small change
`python3 rekey_build.py NAME [--write]`, which keeps the live node keys so the diff shows only the real change).
Published with `.dbtools/wf_upload.mjs`.

**Mobile:** the store build calls the classic PUTAWAY_LOOP. The `hotfix/v2-background` OTA (2026-10-25) moves it to V2
(SUBMIT, then a per-job follower: worker `{ job_id }`, STATUS every 10 s with re-kicks; see
`MOBILE_PUTAWAY_V2_GUIDE.md`). For phones still on the old build, PUTAWAY_LOOP v19 (dev = prod) refuses a Completed
confirmation of more than 500 lines. It answers "under processing" while a V2 job of the TO is open or its GR is
`Processing`, and mobile keeps retrying on that answer. PUTAWAY (v35) checks against the stored `pending_process_qty`,
so a stale mobile copy cannot post a line V2 has already put away.

**Worker budget:** PUTAWAY_ASYNC_WORKER v3 has `worker_budget_seconds: 20`. A run always takes its first job and starts
no further job after 20 s. A `{ job_id }` kick (form, mobile follower) takes only that job, so the budget limits only
the id-less list sweep.

## What goes to the background

A saved, numbered putaway (Created / In Progress), up to 2,500 rows per confirmation:
- batch and non-batch lines, from In Transit to the target bin;
- split rows confirmed in the split dialog (each child refers to its parent line's id);
- items whose costing rows are waiting for migration, when the line has a unit price (INVENTORY_BULK_APPLY v7 moves
  them without touching costing rows).

Run by the classic save instead (at most 500 rows; above that the button stops with the reason):
- a putaway not saved yet, or a Draft;
- item bundles;
- split rows saved without confirming them;
- handling units;
- serial-numbered items;
- a costing-migration item without a unit price.

## Client (published to dev 2026-10-15: Putaway form v366, Putaway list page v33)

1. **Putaway form** — `Putaway/PutawayFullJSON.json`. Dev v365 already has the 2,000-line form work:
   - table settings as GD / Picking;
   - batched `disabled` calls in `mounted`;
   - one Item read per 500 ids in the putaway strategy;
   - a `putaway_qty` validator that reads only its own row;
   - split rows that keep their ids;
   - the hidden `job_line_key` columns.

   This paste switches on `pwV2_onClick_completed` (`ASYNC_PUTAWAY_ENABLED = true`, SUBMIT / WORKER ids). The classic
   `onClick_workflowComplete` stays as the fallback.
2. **Putaway list page** — `Putaway/PutawayListPageJSON.json`: `mounted` gets `pwV2_list_mounted_kick.js` added.

What the user sees:
- QUEUED: the dialog closes with "… is being completed in the background".
- Opening a putaway with a running job hides the save buttons and starts the worker again.
- REQUIRES_REVIEW: a warning to contact support.
- A failed job is reported once per browser, with its reason. The TO is left as it was before (unlocked), and the
  next click tries again.

There is no Quartz schedule. The worker runs when the form queues a job, when a putaway with an open job is opened, and
when the list opens (at most once every 2 minutes per browser).

## Deliberate differences from the classic completion

- Stock is all or nothing (the classic posts line by line).
- Records are keyed by `job_line_key` (`<job>|<n>`), so a re-run skips what it already wrote.
- Split children refer to the parent line's **id**. The classic matches `parent_index + 1` against `line_index`, which
  repeats in some receipts.
- Pending quantities are checked against the stored line, never the client's copy.
- The in-transit `target_doc_line_id` is the stored line id (the classic wrote `''`). Records carry the stored item
  description (the mobile client omits it).
- A COMMIT run's job lease is sized to the job (since 2026-10-19; dev GR_COMPLETE_COMMIT v8, PUTAWAY_BULK_COMMIT v8, GR_REVERT_COMMIT v7):
  10 min + 0.6 s per stock movement, at most 90 min. The engine's stock step takes about 0.14 s per lock key on dev
  (2026-10-19), so a 2,000-2,500-line job can post for 12-23 min. With the old flat 10 min, a re-kick after the lease ran
  out started a second run of the same job while the first was still posting, and the stock movements were duplicated.

## Tested

| Test | Result |
|---|---|
| Parity with 476 recorded PUTAWAY runs (prod + dev) | lifted bodies identical; 1,598 SUBTRACT/ADD calls identical; 465 routes the same (1 known split-child case); writes vs today's rows: 830 lines, 442 records, 767 in-transit updates, 30 in-transit creates the same |
| Twins, tenant 000000 plant …202, partial then final (classic vs V2) | every table the same, after the COMMIT v4 / v5 fixes found by this test |
| 2,000 lines, TRF-PA-20261015-0007 | partial 84.2 s, then final 84.7 s. 10,000 movements, 4,000 records, 5,092 in-transit rows Received (open 0), GR putaway Completed — reconciled |
| Node data | COMMIT at most 12.9 MiB per run (30.7 MiB before v6; a dev restart at 12:58 on 10-15 was ours). PREPARE v4 in-transit read on that receipt: 6.5 MB → 0.86 MB |
| After the v4 publish, TRF-PA-20261015-0006 (2.25 + 7.5) | COMPLETED in 1.6 s; balances, in-transit rows, records, TO and GR exact |
| Mobile classic next to desktop V2 on one TO (2026-10-16, receipts from GR V2; mobile's payload shape from prod runs: no line ids, `line_index`, records `[]`) | TRF-PA-20261016-0014: mobile classic 4 of 10, then V2 the rest. TRF-PA-20261016-0015: V2 3 of 10, then mobile classic the rest. Both Completed and reconciled (records = movements = 20, in-transit open 0, GR putaway Completed, balances = movement history). A mobile confirmation sent while V2 held the TO got 400 "The current putaway is under processing" and wrote nothing. Classic records carry an empty `job_line_key`; V2 only matches its own `<job>\|<n>` keys |
| Job-sized lease, TRF-PA-20261019-0017 (2026-10-20) | COMPLETED; both COMMIT runs claimed 603 s for 4 movements (10 min + 0.6 s each) |
| Unit / offline | `test_commit/commit_unit.js` 32, `test/plan_unit.js` 13, synthetic 2,000- and 2,500-row plans (`test/run_all.sh`) |
