# Sales Invoice at 2,000 lines (lean save, conversions and cancel, dev 2026-10-21)

The SI path now runs a 2,000-line invoice synchronously, the way Purchase Invoice does (`Purchase Invoice/README.md`). Before
this change one SI_SAVE carried about 75 MB of node data at 2,000 lines, and a GD → SI conversion about 60 MB more in the same
request: the sizes that took dev down on 10-09 and 10-16. Nothing calls a workflow per line, so there is no background job:
SI_SAVE makes at most seven sub-calls (CHECK_REQUIRED_FIELD, CREDIT_LIMIT_CHECK, AR_SAVE, SI_POST, CP_SAVE, SI_TO_PI) and both
conversions call SI_SAVE once per invoice. Requests, responses, end codes (401-413) and messages are unchanged, and so are the
callers: the SI form, SO_SAVE's auto SI, the SO and Cash Sales list pages (SO_Convert_SI), the GD list page, GOODS_DELIVERY and
GD_COMPLETE_COMMIT (GD_Convert_SI), the SI list page (SI_CANCEL).

| What (dev version) | Change |
|---|---|
| SI_SAVE v84 (`SIsaveWorkflow.json`) | (1) v83's doc no → required fields → CHECK_REQUIRED_FIELD → invoice qty → fill-back chain (draft and completed) is one node, `code_si_prep`; each step is the old code with the platform's output filter between steps. The credit-limit downgrade of a convert is applied by `code_si_status`. (2) The SO / GD reads are sql-nodes holding only the line columns the check uses, read in parallel with the sales return setup. (3) The over-invoice check (410) and the SO / GD roll-up are one node, `code_si_check`, before the write. (4) The id, number and total are read back by sql. (5) The SO / GD invoiced quantity and status are written only for the lines that change, through the line collections (`sales_order_axszx8cj_sub`, `(Goods Delivery)`, as SR_SAVE does); v83 wrote every line back through `table_so` / `table_gd`. (6) Fix (user, 10-21): the SO / GD header status counts every line as it stands after the invoice, as SI_CANCEL does; v83 counted only the lines the invoice touched, leaving 75 prod SOs "Partially Invoiced" with every line fully invoiced |
| GD_Convert_SI v26 (`GDconvertSIworkflow.json`) | GDs, their lines, the SO headers and the SO lines behind the GD lines come from sql-nodes holding only the fields the mapping reads; the mapping code is unchanged. The loop hands SI_SAVE its own item; v25 re-read the whole list on every pass through a cache counter. GDs are taken in id order (user, 10-21): with several GDs on one invoice the header comes from the lowest-id GD, where the platform's read order was arbitrary |
| SO_Convert_SI v57 (`SOconvertSIworkflow.json`) | Same approach for the SOs and their lines; the loop's `{index, si_list}` state is kept for the result list |
| SI_CANCEL v10 (`SIcancelWorkflow.json`) | The invoice, its lines, the receivables, the SO and GD lines come from sql-nodes; v9's reversal code is unchanged; only the lines it changes are written, through the line collections |

Builders and proofs: `scratchpad/si2k/` (`build_si_save.py`, `build_si_convert.py`, `build_si_cancel.py`, code bodies in
`code/`, simulator in `sim/`, sql tests in `test/`). Recorded runs used for the replays are cached outside the repo
(`~/Documents/ASC-dev/si2k-cache`, customer data).

## Tested

| Test | Result |
|---|---|
| Recorded runs replayed through old vs lean (`sim/replay_save.js`, `replay_convert.js`, `replay_cancel.js`) | SI_SAVE 8,169 / 8,169 (dev + prod, 90 days): same outcome, same invoice rows, same SO / GD line counters, same sub-workflow payloads; only the SO / GD header status differs where the fix applies. SO_Convert_SI 317 / 317. GD_Convert_SI 1,310 / 1,310 with the GDs in id order. SI_CANCEL 295 / 295 |
| Synthetic paths (`sim/scenarios_save.js`, `scenarios_convert.js`) | SI_SAVE 32 / 32 (406, 407, 408, 409, 410, 411, 413, credit-limit downgrade, bundles nested and flat, deduct returns, cash payment, auto post, auto PI, edit draft → completed, drafts deleted, the header fix); conversions 36 / 36 |
| New sql reads vs the platform's own read (`test/test_sql_save.py`, `test_sql_recorded.py`, `test_sql_cv.py`) | identical: 12 tenant-000000 documents incl. bundles, the 1,948-line SO / GD of a recorded run, 63 conversion checks incl. 2,000-line GDs and SOs |
| Live on dev (`test/live_si.py`: the live SI_SAVE payload replayed through v83 against a snapshot, compared with what was stored) | GD/20260921/547 (4 lines, 000000) → SI/20261021/0167: invoice rows, 10 counters and the AR_SAVE payload identical to v83's; 1.8 s. GD/20261012/069 (2,000 lines, 496474) → SI/20261021/0025: 105 s, 5.5 + 7.0 MB; stored invoice = v83's on every column of the header and all 2,000 lines, 4,002 counters identical. Bundle GD/20261003/003 (1,948 lines, 711077) → SI/20261021/0003: 110 s, 5.4 + 7.0 MB, same result. SO/20261020/046 (2,004 lines, 496474) → SI/20261021/0026: 94 s, 4.9 + 5.5 MB, same, AR payload identical. SI_CANCEL of SI/20261021/0025: 170 s, 2.0 MB; all 4,000 SO / GD lines back to their state before the convert |

Time at 2,000 lines on dev (slower than prod since 10-16): 94-110 s per conversion, almost all of it the platform writing the
invoice lines and the SO / GD line counters; the rewritten nodes take seconds.

## Known, not changed

- The line "Fully Invoiced" status ignores returns under the "Deduct from Invoice" method (v83 behaviour).
- v83 cleared every blank column of every SO / GD line to NULL on each completed invoice (a whole-row subform write stores a
  missing key as NULL); the lean save writes only the counters, so this no longer happens.
- `goods_delivery_fwii8mvb_sub` has no index on `goods_delivery_id` on dev or prod: every GD-line read is a full scan (~78k rows
  on prod), old and new alike.
- SI_POST is unchanged (out of scope, user 10-21); on the SQL v1 / AutoCount v1 path it still rewrites the whole SO.
