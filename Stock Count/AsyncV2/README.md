# Stock Count Review V2 (background review for big counts)

A Stock Count **Review** from the web form that would create a Stock Adjustment with **more than 50 approved variance lines**
is completed in the background by Stock Adjustment V2 (`../../Stock Adjustment/AsyncV2/README.md`: workflows, jobs, locks,
error codes, runbook). The classic Review builds a Draft SA, marks the count lines Adjusted, and leaves the stock to a second,
synchronous SA completion (about 0.4 s per entry). V2 does it in one background job: the stock moves first, then the count is
updated.

Smaller reviews, reviews that create no SA, mobile, and anything not eligible keep the classic STOCK_COUNT path, which now has
a guard (see below). Built and switched ON on dev 2026-10-16; ships ON in the full deployment of the week of 2026-10-19.
Design: `scratchpad/sav2/CONTRACT.md` (§2, §7, §9, §11, §16).

## Pieces

| Piece | id | Role |
|---|---|---|
| SA_V2_SUBMIT (source REVIEW) | 2111074320177860610 | runs the classic review build (lifted verbatim) as a gate, then: review guard → job → a NEW SA header (Processing) → lock → the count as a part |
| SA_V2_WORKER / _PREPARE / _COMMIT | see the SA README | PREPARE rebuilds the review on fresh reads; COMMIT A1 writes the SA lines, A2 moves the stock, A3 writes the count, A4 finishes |
| STOCK_COUNT | 2066808904123076610 | the classic save (web AND mobile): deployed v10 plus guard nodes (`STOCK_COUNT.json`) |

Repo files: `STOCK_COUNT.json` (guarded classic), `SCform.json` (dev form v499), `SClistPage.json` (dev list v40), the handler
mirrors `scV2_onButtonReviewClick.js`, `scV2_mounted_block.js`, `scV2_list_mounted_kick.js`. Rebuild:
`python3 scratchpad/sav2/build_sa.py --write STOCK_COUNT` and `python3 scratchpad/sav2/client/build_client.py --on --write`.
**Without `--on` the client builds with the switches OFF.**

## What goes to V2

The Review button, after its confirmations, when all of these hold (else the classic review continues, unchanged):
- `ASYNC_SC_REVIEW_ENABLED` is true;
- the review creates an SA: approved lines, the adjustment confirmed (or every line approved), an approved line with a variance;
- more than `SC_V2_MIN_LINES` (50) approved variance lines;
- no serialized line.

SUBMIT's eligibility and limits are the SA's (NOT_ELIGIBLE → classic; over 5,000 entries or a bad build → stopped with the
classic's own message). A built SA line holds at most 50 entries: a larger group is split into several lines, never truncated.

**Outcome:**
- **Success:** a new SA, `Completed`, `adjustment_type` Stock Count, linked by `stock_count_id`; the approved lines are
  `Adjusted`; the count header is recomputed as the classic does.
- **FAILED** (e.g. stock changed and an Out no longer fits): nothing moved. The count is untouched and the form keeps the
  reviewer's decisions. The new SA is left `Cancelled`, holding its number and lines as the audit of the attempt. A retry
  creates another SA; number gaps are accepted.
- **Twin protection:** a second Review of the same count while one runs gets 409 (review guard `SCR|<scId>`).

## Switches (client constants; every copy must be set)

| Where | Handler | Constants |
|---|---|---|
| `SCform.json` | `scV2_onButtonReviewClick` (Review) | `ASYNC_SC_REVIEW_ENABLED`, `SC_V2_MIN_LINES` |
| `SCform.json` | `mounted` (the Processing view) | `SCR_BG_ENABLED` |
| `SClistPage.json` | `mounted` (worker kick) | `ASYNC_SC_REVIEW_ENABLED` |

- `scV2_onButtonReviewClick` is the live `onButtonReviewClick` body plus ONE inserted branch. Rollback without a rebuild: bind
  the Review button back to `onButtonReviewClick`, which is unchanged.
- While a Stock Adjustment from this count is Processing, the form is read-only: the review, sync, approve-all, count, draft,
  issue and select-stock buttons are hidden, and a banner follows the job. Opening the count re-kicks the worker. The count list
  kicks it on open, at most every 2 minutes per browser; the throttle is shared with the SA list.

## The guarded classic save (`STOCK_COUNT.json`)

New first nodes before `cond_save_as`. Refusals answer like the classic's own failures (end node, code 400 + msg), which the web
handlers and mobile both show:
- **Any save of a count that has a Processing Stock Adjustment:** "A Stock Adjustment from this Stock Count is being processed in
  the background - please wait for it to finish." This covers mobile's "Stock Count" saves.
- **A Review that would build an SA with more than 500 approved variance lines:** "This review has <n> approved lines with a
  variance. Review at most 500 lines at a time." It uses the classic's own predicates, so a review that declines the adjustment
  builds no SA and is never refused.

The guard reads only `allData.id`, the lines, `saveAs` and `createAdjustment` (mobile sends `pageStatus` as an object), and only
the `stock_adjustment` table. Every other node is byte-identical to v10.

## Mobile

Mobile never reviews and has no SA screen. It saves counts through the same classic STOCK_COUNT (`saveAs "Stock Count"`, the
whole count on every save), so it gets the guard above and nothing else changes. Mobile V2 is not needed for this.

## Known limits

- **Classic Review bins limit.** A classic Review groups one material + plant + direction + price into ONE SA line. A group of
  more than ~90 bins exceeds 60,000 bytes, and the guarded SA completion refuses that SA after the classic Review has already
  marked the lines Adjusted (before the guard, prod truncated the line silently). With V2 ON this needs a classic review of
  over 50 lines, i.e. one V2 doesn't take (e.g. serialized lines or HU entries); at 50 lines or fewer a group holds ≤ 50 bins.
- **Deliberate difference:** the classic marks the lines Adjusted before the stock moves; V2 marks them after.
- With the switch ON, opening a count in Edit / View reads `stock_adjustment` once more (the Processing check).

## Tested on dev (tenant 496474, 2026-10-16)

| Test | Result |
|---|---|
| T3 twins: classic Review + completion vs V2 Review (8 lines on FIFO / WA / batch / alternate-UOM items) | no difference in any of 11 tables, including the count header and lines |
| 2,000-line count STC/20261016/0013 (704 items) | classic Issued save 9.0 s, classic count save 7.7 s; V2 Review: SUBMIT 4.8 s, then 5 s / 72 s / 16 s in three worker runs; reconciled exactly (SA = the approved variances, 2,000 / 2,000 lines Adjusted, Fully Adjusted) |

Not yet measured: the 2,000-line count in the browser (opening it in each mode, Sync, Approve All) and the classic Review
without an adjustment at 2,000 lines.
