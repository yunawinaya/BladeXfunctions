# 2026-10-26 Stock engine verifies at the stored scale + GD worker claim herd

> **SUPERSEDED - do not paste.** Replaced by `../2026-10-26-stock-locks/` (same engine precision fix, plus one ordered TAKE
> and one stock call per GD worker run). Never pasted to prod.

Two independent fixes from the day's open items:
- the engine's false VERIFICATION_MISMATCH (GUB GD-26/10/0528);
- the 161 GD worker runs that died on the claim insert at LSH.

## Paste (prod)
| Workflow | prod id | live now | file | differs only in |
|---|---|---|---|---|
| INVENTORY_APPLY_OPERATION | 2105133980371554305 | v12 | INVENTORY_APPLY_OPERATION.json | sql_node_e7OzTOyD, code_node_8rCPo75P, code_node_FyT3zuFi, code_node_p0sOD8ej, code_node_Pf6NFe7B, code_node_ncZJyNmS |
| INVENTORY_OPERATION_RECONCILE | 2105134048113758209 | v11 | INVENTORY_OPERATION_RECONCILE.json | code_node_mDGats0w |
| GD_ASYNC_WORKER | 2104840667119411201 | v16 | GD_ASYNC_WORKER.json | sql_node_oAHg7l6A, sql_node_WKwait, code_node_Qo8Suk1M, code_node_JsJ91wA5 |

- **Order:** any. If one at a time, do INVENTORY_APPLY_OPERATION first, since it ends the false reviews.
- **No node is added:** the engine's chain expression (su_code_workflow.el_expression) stays at 65,209 of its 65,535 bytes. It
  holds only node types and ids, and is unchanged on dev after the publish.
- **After the paste:** `.dbtools/wf --prod deployed "prod-hotfix/2026-10-26-engine-precision-worker-herd/<file>"` for each
  must say IDENTICAL.

## 1. The engine compares stored decimals at the scale the platform stores them
- **Cause.** The platform rounds every stock decimal on write to the tenant's number rule (su_code_num_precision):
  - "Inventory Price": movement unit_price / total_price;
  - "Inventory Qty": the 4 movement quantities and the 6 item_balance / item_batch_balance quantities.
  - All 80 prod tenants have 4 / 3 decimals, half-up.
- **The bug.** The engine plans at 8 decimals and its checks compared exactly. So a FIFO price with more than 4 decimals failed
  the after-insert check although the stock was right. The GD went to REQUIRES_REVIEW holding its keys.
- **Prod evidence.**
  - Last 30 days: 82,016 movements and 42,750 balance rows. None has a price beyond 4 decimals or a quantity beyond 3.
  - GUB: planned 99.93685714 / 6995.5799998, stored 99.9369 / 6995.58.
- **Changes.**
  - The balance read under lock also returns the tenant's rules (one extra column, `num_rules`, declared). It reads them the way
    INVENTORY_BULK_APPLY already does: group rules plus per-column rules on inventory_movement, item_balance and
    item_batch_balance.
  - Revalidate keeps them in plan.scale, and in the stored mutation plan for the reconcile.
  - The 4 checks (pre-write, balance, movement, final) and the reconcile accept a stored value when it is either:
    - the planned value exactly; or
    - on the rule's scale and the planned value rounded:
      - rule 1, half up: within half a step (either side of a tie);
      - rules 2 / 3: within one step.
  - A column rule wins over its group rule. No rule, or store_raw_value, means an exact compare. A plan stored before this
    change has no scale and gets the seeded 4 / 3.
- **What stays the same.** The values written are unchanged, since the platform rounds them anyway.
- **Not affected:** INVENTORY_BULK_APPLY (GD complete / cancel and the other V2 modules) already plans at the tenant's rules.

## 2. GD worker: a waiting job is retried by the run that claimed it last
- **What happened.** LSH 06:51-08:31: 161 GD_ASYNC_WORKER runs died on `Duplicate entry ... W0_CLAIM_<n>`. 154 of them were on a
  job a stock lock left waiting (claim number above 5).
  - 121 were ticks (no job_id). Every tick plans its retry passes on the same 3 oldest due jobs, sleeps until the same
    next_attempt_at, and wakes with the others. All but one lose the claim, a median 78 s into the run.
  - The other 40 were job_id runs dying on a first pass at that moment.
  - None since 08:31, but it returns whenever GDs pile up on shared stock.
- **Changes.**
  - The tick read also returns `last_claim_owner`, the owner of the job's highest W0_CLAIM_<n> row (declared). It uses the
    Job Step index: a range of at most 135 rows on prod.
  - The retry-pass sleep (WKwait) runs only in the run that made that claim. The others no longer hold a connection for up
    to 30 s.
  - Pick:
    - a retry pass works a waiting job only in the run that claimed it last;
    - a first pass leaves a waiting job that came due under 10 s ago to that run;
    - after 10 s, any run takes it (its retrier ended or died).

## Tests
- `scratchpad/gdc/gdcreate/test/test_engine_precision.js`: 190 pass, failing before the patch. It runs every copy of the check
  (4 engine nodes + the reconcile) on:
  - the GUB values;
  - ties;
  - a wrong rounding step and an off-scale value;
  - tenants at 2 / 6 decimals, rules 2 / 3, raw, and column rules;
  - the rule parser.
- `test/replay_engine_precision.js`: 16 pass. It re-runs the engine nodes on the outputs recorded by the real GUB run
  2114523131413663745:
  - the old code reproduces prod's REVIEW exactly;
  - the new code answers OK, and still answers REVIEW for a price one step off;
  - Revalidate is identical apart from plan.scale;
  - the balance and pre-write checks are unchanged.
- `test/test_worker_sweep_retry.js`: all pass, including 10 new cases (6 failing before the patch).
- **Prod, read-only:**
  - the new balance read on GUB's parameters returns `1:Inventory Price:::4:1:0;1:Inventory Qty:::3:1:0`;
  - the new tick read on an LSH job returns its last claimer (W0_CLAIM_408);
  - EXPLAIN of the claim lookup: range on Job Step.
- **Lint:** no new findings. The one new UNDECLARED, `lastClaimOwner`, is the known pattern of its 19 siblings nested in Pick's
  `item`.
- **Dev:** published as INVENTORY_APPLY_OPERATION v14, INVENTORY_OPERATION_RECONCILE v13 and GD_ASYNC_WORKER v20, identical
  to these files. The engine's v13 publish replaced an abandoned 10-23 designing draft, which is backed up; prod has no draft.
  End-to-end at 10:18-10:23:
  1. GD/20261026/624 was cancelled through GD Cancel V2;
  2. SO_AUTO_GD SO/20260720-062 gave job 2114543329771573249;
  3. the worker took it to COMPLETED: GD/20261026/625 Created.
  - Engine run 2114543370770894850 read the rules from the platform, carried and stored plan.scale, and its balance / movement /
    final checks answered OK.
  - The worker's tick read returned its own last claim.

Scripts: `scratchpad/gdc/gdcreate/patch_engine_precision.py`, `patch_worker_claim_herd.py`.
