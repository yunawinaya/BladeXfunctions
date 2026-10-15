# BUG-20261015-021: quotation save burns a number

`SQT_SAVE_V2` (table event, PreAdd + PreUpdate on Quotation) reset `sqt_no` to the `issued` sentinel whenever
`previous_status !== "Issued"`. SQT_SAVE's own follow-up update after numbering carries `previous_status` NULL
(new quotation) or `"Draft"` (Draft to Issued), so every issue threw away the number SQT_SAVE had just been
given and took the next one.

Prod runs 2026-09-15 to 10-14: 44 resets, all of a real issued number, in 6 tenants (954052 De Carton,
836238, 139314, 683894, 496474, 681409). None was a Draft number being promoted.

## Fix

`code_node_HbSgL6QL` Check Doc No numbers only a quotation with no number. SQT_SAVE's Check Doc No
already writes the sentinel for new and Draft to Issued saves, and web and mobile both save through SQT_SAVE.
Replaying all 233 prod runs: the 44 resets now keep their number, and the other 189 behave the same.

## Files

- `SQT_SAVE_V2.prod.json`: the prod working copy plus the one-line fix. **Paste into prod SQT_SAVE_V2.**
  It has no `su_code_workflow_history` rows in prod; the working copy is what runs.
- `build.py`: refetches prod and re-applies the patch, asserting on the baseline text.

Dev: nothing to deploy. Dev deleted SQT_SAVE_V2 on 2026-08-05, and dev SQT_SAVE numbers only when
`previous_status == "Draft"`.

Numbers already skipped stay skipped. Do not reset counters or renumber old quotations.
