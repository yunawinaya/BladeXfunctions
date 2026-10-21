# GR Completion V2 — Save as Completed in the background (dev only)

Built 2026-10-14/15. A Goods Receiving is completed in the background, in steps that each check what they wrote. On dev a
2,000-line receipt completes in about 14 s (SUBMIT) plus 85–125 s (worker). That includes the Putaway Transfer Order and
2,000 in-transit rows. The classic path takes about 1.1 s per line, so roughly 37 min at 2,000 lines, and needs more node
data than the platform allows. **Prod has none of this.**

| Workflow (dev id, version) | Role |
|---|---|
| GR_COMPLETE_SUBMIT `2110545633913245697` v5 | runs GOODS_RECEIVING's gates in its order (same codes, same texts) on the form's data. Then it stores the receipt (`gr_status 'Processing'`, `gr_v2_job_id`), writes the LOCK row and queues a `COMPLETE_GR` job. `operation: STATUS` reports the latest job |
| GR_COMPLETE_WORKER `2110545675948560386` v3 | claims due jobs and calls PREPARE, then COMMIT twice (COMMIT splits after the stock step) |
| GR_COMPLETE_PREPARE `2110545716310347777` v4 | SQL reads (no row caps), GOODS_RECEIVING's code lifted verbatim, and INVENTORY_BULK_APPLY in PLAN mode. Produces the prepared payload |
| GR_COMPLETE_COMMIT `2110545758094004226` v6 | C0 PO locks `GRPO\|<po>` + the over-receive rule on fresh PO lines · C1 batch numbers (`batch_number_config` replayed, intent row, duplicate checks) · C1B GR lines · C2 stock (INVENTORY_BULK_APPLY, all or nothing) · C3 PO lines, on-order, PO headers · C4 Putaway TO + in-transit rows · C5 the receipt (Completed / Received), item dates, unlock |
| INVENTORY_BULK_APPLY `2109916822821744641` v7 | the shared set-based ADD/SUBTRACT engine (Balance Table/, bladexfunctions-8a's) |

Built from `scratchpad/grv2/` (`python3 build_grv2.py [--write] [NAME ...]`; for a small change use
`scratchpad/pwv2/rekey_build.py NAME --gr [--write]`, which keeps the live node keys so the diff shows only the real
change). Published with `.dbtools/wf_upload.mjs`.

Classic guards (dev): GOODS_RECEIVING (v100+) and GR_CREATED (v12+) refuse a receipt stored as `Processing`, and refuse
more than 500 lines before any write. Mobile still calls GOODS_RECEIVING, so a mobile receipt is limited to 500 lines.

## What goes to the background

Add, a stored Draft, or a stored Created receipt (edits made on the form are taken; SUBMIT keeps the stored
reservations to release them). Batch (auto and manual numbering) and non-batch items are taken. FIFO, Weighted Average
(since SUBMIT v5 / PREPARE v4) and Fixed costing are taken. Also covered: `stock_control 0` lines, Unrestricted and In
Transit, the loading bay, the auto Putaway TO and the in-transit ledger. Limit: 2,500 lines.

Run by the classic save instead (at most 500 lines; above that the button stops with the reason):
- item bundles; split lines (Split-Parent / Child);
- handling units; quality inspection, or items that need receiving inspection;
- serial-numbered items;
- lines with a negative price.

## Client (published to dev 2026-10-15: GR form v1474, GR list page v211)

1. **GR form** — `Goods Receiving/GRfullJSON.json`. It adds the event script `grc_onClick_completed`
   (= `grc_onClick_completed.js`) and binds `button_save_as_comp` → onClick to it. The classic `onClick_workflowCompleted`
   stays as the fallback.
2. **GR list page** — `Bulk Actions/Procurement/Goods Receiving/GRlistPageJSON.json`. Its `mounted` already starts
   GR_COMPLETE_WORKER (`grc_list_mounted_kick.js`), and the list already shows a purple `Processing` badge. The same
   paste also switches on Revert V2 (see `../RevertV2/README.md`).

Switch: `ASYNC_COMPLETE_ENABLED` at the top of the handler (`false` = classic everywhere). There is no Quartz schedule
(the user's decision, on cost). The worker runs when the form queues a job, and when the GR list opens (at most once
every 2 minutes per browser).

What the user sees:
- QUEUED: the dialog closes with "… is being completed in the background", and the list shows `Processing`.
- FAILED before any stock moved: the receipt goes back to the status it had before (Draft / Created; its lines stay
  saved) and this job's new batch rows are removed. Clicking Completed again with the same content shows why it failed;
  the click after that tries again.
- REQUIRES_REVIEW (something did not read back as written): the receipt stays `Processing`.

## Deliberate differences from the classic completion

- Stock is all or nothing. The classic writes the receipt Completed before its per-line loop and does not roll back.
- Batch numbers are taken only after every check has passed, so a refused save does not use one up.
- Generated batch numbers are checked twice: before the insert, and again after it (since dev GR_COMPLETE_COMMIT v9,
  2026-10-21). If another document took the number in between, for example a classic GENERATE_BATCH reading the
  same unlocked counter, the job fails with GRC_BATCH_DUPLICATE: our batch rows are removed, the receipt goes back to
  its status before the submit, and no stock moves. Live: GR/202610210023 (auto Batch-00630) completed normally.
- Two receipts of the same PO are serialised by the `GRPO|<po>` lock. Each PO slice is written from a fresh read and
  an intent row (before / after).
- On-order quantities are exact to 8 dp. The classic truncated them to whole numbers until GOODS_RECEIVING v101 on dev.
  Prod still truncates until the paste in `prod-hotfix/2026-10-15-int-decimal-truncation/`.
- Inventory movements carry `operation_effect_key` (`GRC|<job>|<movement>`), so the engine can replay safely.
- Since INVENTORY_BULK_APPLY v8 (dev 2026-10-16) the stock step also takes `COST|<material>|<plant>` for every receipt line
  of a FIFO / Weighted Average item. Two background jobs touching the same item at the same plant (GR, GD or Stock
  Adjustment) now run one after the other: under load the C2 step waits (`LOCK_BUSY`, retried), which is expected. Without
  it, concurrent receipts lost weighted-average updates and duplicated FIFO sequences (`scratchpad/sav2/race/EVIDENCE.md`).
- `previous_status` is `'Draft'` after Add → Completed; the classic writes `''`. This has no effect: the form resets
  it on open and Revert only reports it.
- A receipt being received in the background (`Processing`) has not written its PO quantities yet. Since 2026-10-19
  (dev: PO_Convert_GR v6, GOODS_RECEIVING v104, GR_CREATED v16, GR_COMPLETE_SUBMIT v9) four places refuse while another
  receipt of the same PO is `Processing`: converting that PO (402, the list's "Unable to Convert"), the classic save
  (mobile and desktop; every save but Draft), the Created save and this SUBMIT. All four answer "PO/… is still being received
  in the background by GR/…". Without the guard, a classic save landing while a job was between C0 and C3 received
  the same PO lines twice. A conversion meanwhile offered the full quantity again, and a Created save over-reserved.
  Two background receipts were already safe: C0 re-checks on a fresh read under the PO lock. Builders:
  `scratchpad/grv2/pobusy/patch_pobusy.py` (conversion, classic save), `phase2b/build.py`, `build_grv2.py`.
- A COMMIT run's job lease is sized to the job (since 2026-10-19; dev GR_COMPLETE_COMMIT v8, PUTAWAY_BULK_COMMIT v8, GR_REVERT_COMMIT v7):
  10 min + 0.6 s per stock movement, at most 90 min. The engine's stock step takes about 0.14 s per lock key on dev
  (2026-10-19), so a 2,000-2,500-line job can post for 12-23 min. With the old flat 10 min, a re-kick after the lease ran
  out started a second run of the same job while the first was still posting, and the stock movements were duplicated.

## Tested on dev (2026-10-15)

| Test | Result |
|---|---|
| Twins, tenant 000000 plant …202: PO/20261015/006 classic vs /007 V2, 7 lines (auto + manual batch, FIFO, Fixed) | PO, PO lines, balances, FIFO, movements, batches, TO and in-transit rows the same. Receipt rows differ only in identity columns. The only other differences are the on-order truncation and `previous_status` above |
| Weighted Average twins, tenant 496474 (4-dp price rule): GR/202610150001 classic vs /0002 V2 | WA row 75 @ 1.0044 + 1 @ 0.52 → 76 @ 0.9980 (classic), then → 77 @ 0.9918 (V2): both follow the formula and the tenant's rule. Movements identical |
| 2,000 lines Add → Completed, tenant 711077 (GR/202610150006) | 2,000 movements, FIFO layers and balance changes, PO Completed / Fully Received, on-order open 0 — reconciled exactly (after engine v7's fifo_sequence fix) |
| 2,000 lines Created → Completed, 711077 (GR/202610150007) | SUBMIT 10 s, worker 124 s, COMPLETED |
| 2,000 lines with putaway, 000000 plant …202 (GR/202610150005, re-run as GR/202610150007) | SUBMIT 13.8 s, worker 84–97 s. Status Received; one TO with 2,000 lines and 2,000 in-transit rows |
| Unit / offline | `test_commit/commit_unit.js` 68, `test_submit/submit_unit.js` 35. Parity with 371 recorded prod runs (624/624 ADD parameter sets, 1,500 batch numbers) |
| PO busy guards, 000000 plant …202, PO/20261019/021 (2 lines × 40), 2026-10-19 | While GR/202610190017 was `Processing`: the conversion (402), a second SUBMIT (STOP 400), a Created save (400) and a classic Completed save (400) all refused, naming it. Nothing was written: one receipt, one job, PO lines untouched. After it finished: conversion offered 30 per line, SUBMIT GR/…018 COMPLETED, classic GR/…019 saved, Created GR/…020 saved. PO lines 30 received + 10 reserved + 10 outstanding. Offline: `pobusy/test/test_pobusy.js` 14, GR_CREATED scenarios (+2) |

Largest run: COMMIT 13.4 MB node data (cap ~64 MB).
