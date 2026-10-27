# SO Save V2 speed for large saves + credit check tenant scope (2026-10-27, second paste)

**Asked by the user:** after the first speed paste (small saves go classic), make SO Save V2 cheaper for the saves it
still handles (> 100 lines), make its workflows publishable, and fix CREDIT_LIMIT_CHECK.

**Changes** (all six live on dev since 13:52-13:58: COMMIT v6, PREPARE v5, WORKER v5, RUN v4, SUBMIT v7, CREDIT_LIMIT_CHECK
v18; built by `scratchpad/sosave_perf/build.py`):
- **Lines no longer rewritten for a date format.** PREPARE compared a stored `2026-10-20 00:00:00` with the form's
  `2026-10-20 00:00:00.000` as text, so unchanged lines were rewritten. Now a datetime compares by value. Replayed on 252
  real prod edit plans: line updates 1,464 -> 1,228; every dropped one was a date-format-only difference.
- **COMMIT's two full-table scans removed** (`sql_node_SCfind` / `SCfind2`): ~155 ms each on prod -> 0.0-0.1 ms, same
  rows on 120 recorded prod cases. A new Draft is still found again (live test).
- **Smaller scripts:** each code node keeps only the shared helpers it uses, and its first line now says so. COMMIT 1.29 MB
  -> 0.42 MB, PREPARE 0.97 -> 0.43, SUBMIT 0.42 -> 0.14, WORKER 0.29 -> 0.14, RUN 0.08 -> 0.04. Same outputs on 5,894
  recorded prod and dev runs.
- **Publishable again:** WORKER / PREPARE / COMMIT carried empty "NO" branches the platform's publish refuses
  ("NO: 请配置条件节点条件!"). They hold no nodes; nothing runs differently.
- **CREDIT_LIMIT_CHECK:** the customer read is scoped to the session's tenant. It read a customer of any tenant before
  (a cross-tenant read of credit figures). Of 12,597 prod checks (10-13..10-27), 11,639 were for a customer of the
  caller's own tenant and none for another tenant's; the other 958 named 266 customer ids that no longer exist in any
  tenant, so they answer "Customer Not Found" before and after. A total sent as text with thousands separators
  ("1,234.50") is now checked as 1234.5; it was read as 1 (no recorded prod total had a separator). `total` stays an int
  param: it is not truncated (checked on prod).

**Not in this paste:** folding COMMIT's phases (plan Task 6). It is measured and waits on your decision; nothing is built.

**Dev tests:** offline replays above; platform dry-runs; the credit check A/B on dev (57 plain requests answered the same,
12 with separators differ only in the amount now read). Live saves in tenant 496474 on this build: a 150-line edit of 1
line 5.3 s (1 line written), a 2,000-line edit of 1 line 23.6 s (1 line written), a new 150-line SO 5.4 s
(SO/20261027/104), a new 150-line Draft 4.9 s, that Draft issued 13.0 s (SO/20261027/105, 150 lines Issued). Every job
completed, no SO left held; the credit check ran inside three of them.

## Before the paste

A paste replaces the whole workflow, so a change someone made on prod after this folder was built would be lost. Check
that each base is still what prod runs:

```
for f in SO_SAVE_COMMIT SO_SAVE_PREPARE SO_SAVE_WORKER SO_SAVE_RUN SO_SAVE_SUBMIT CREDIT_LIMIT_CHECK; do
  .dbtools/wf --prod deployed "prod-hotfix/2026-10-27-so-save-v2-speed/$f.prod_base.json"
done
```

All six must say `IDENTICAL`. On a `DIFFERS`, stop: the folder is rebuilt on the new prod version first.

## Paste (user): IN THIS ORDER

The designer refuses a workflow whose called workflows still carry the old "NO" branches, so the called ones go first.

| # | Workflow | Id | File |
|---|---|---|---|
| 1 | SO_SAVE_COMMIT | `2112758624899170305` | `SO_SAVE_COMMIT.prod_paste.json` |
| 2 | SO_SAVE_PREPARE | `2112758585934086146` | `SO_SAVE_PREPARE.prod_paste.json` |
| 3 | SO_SAVE_WORKER | `2112758538274209793` | `SO_SAVE_WORKER.prod_paste.json` |
| 4 | SO_SAVE_RUN | `2113116286771331073` | `SO_SAVE_RUN.prod_paste.json` |
| 5 | SO_SAVE_SUBMIT | `2112758477792346114` | `SO_SAVE_SUBMIT.prod_paste.json` |
| 6 | CREDIT_LIMIT_CHECK | `1990247316342333442` | `CREDIT_LIMIT_CHECK.prod_paste.json` |

Each is the prod version enabled now (`*.prod_base.json`) with the changes above. New version numbers may come out below
the current ones; the enabled one is the live one.

## If a paste is refused midway

Leave the ones already pasted: no workflow's inputs or outputs changed, so a new workflow runs under an old caller and an
old one under a new caller. Send me the refusal message. To undo instead, paste `*.prod_rollback.json` for the ones
already pasted, last one first.

## After the paste

- `.dbtools/wf --prod deployed "Sales Order/AsyncV2/<name>.json"` for the five SO_SAVE_* and
  `.dbtools/wf --prod deployed GlobalCreditLimitCheckWorkflow.json`: all IDENTICAL.
- `python3 scratchpad/prod_health.py`.
- No data step.

**Rollback:** paste `*.prod_rollback.json` in the reverse order (6 -> 1). Each is the prod version from before this paste
with only the "NO" branches reshaped, because the designer refuses the exact old WORKER / PREPARE / COMMIT.

## Changing these workflows later

Their code nodes are trimmed: each holds only the shared helpers it used when built. Change them in
`scratchpad/sosave_perf/` (the live JSON in `base/` + `build.py`) and publish the rebuilt `out/`, not in the designer: a
call added there to a helper a node does not hold fails on that path alone. `build.py` refuses a trim that drops a used
helper.
