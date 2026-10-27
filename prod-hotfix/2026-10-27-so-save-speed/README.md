# SO save speed: small saves go classic, faster credit check (2026-10-27)

**Asked by the user:** SO Save V2 is live on prod and saves feel slower than the classic SO save. Find out why and fix it.

**Why it was slower (prod, measured):** classic SO_SAVE took a median of 1.72 s (5,160 saves, 10-09 to 10-22). V2 takes
6.39 s for a 1-5 line SO (472 saves, 10-24 to 10-27). V2 runs classic's checks first, then queues a job that runs as
6 more workflow runs (RUN, WORKER, PREPARE, 2-3 COMMIT phases), each with its own start-up and bookkeeping writes.

**Change: two workflows.**
- **SO_SAVE_SUBMIT** (`code_node_SSentry`): a save of 100 lines or fewer answers NOT_ELIGIBLE (`SOV2_SMALL`) once the
  busy checks have passed. All three save buttons already run the classic SO_SAVE on NOT_ELIGIBLE, so the form is
  unchanged. A sales order held by a V2 job still answers BUSY (classic SO_SAVE does not check `is_processing`). Above
  100 lines nothing changes. Also: 7 empty "NO" branches lose 3 keys, because the platform's publish refuses them as
  they were ("NO: 请配置条件节点条件!"); they hold no nodes, so nothing runs differently.
- **CREDIT_LIMIT_CHECK**: the "Get Customer Data" get-node (471 ms median on prod) becomes one SQL read of the 5 columns
  the check uses. The get-node loaded the customer's address subform, and on prod `customer_skgkxqcn_sub` (177k rows) has
  no index on `Customer_id`, so every call scanned it. The check's answers are unchanged. 12 workflows call it (SO, GD,
  SI and quotation saves).

**Tests (dev):**
- SUBMIT: 20 offline scenarios (only small, unheld saves change); platform dry-runs at 3 / 100 / 101 lines; a real
  Save as Draft through SUBMIT then classic SO_SAVE (SO/0016, tenant 000000): SUBMIT 97 ms + SO_SAVE 490 ms, no V2 job.
- CREDIT_LIMIT_CHECK: 432 offline comparisons; 51 of 51 answers identical to v15 on dev, including a customer of
  another tenant, a deleted customer and a missing one. Whole check 104 ms -> ~70 ms on dev (the SQL read takes ~1 ms).
- Dev live since 11:29 / 11:32: CREDIT_LIMIT_CHECK v16, SO_SAVE_SUBMIT "v5" (numbered below v6 by the publish route).

## Paste (user), in this order

1. Workflow **CREDIT_LIMIT_CHECK**, id **`1990247316342333442`**: paste `CREDIT_LIMIT_CHECK.prod_paste.json`.
   It is prod v15 (= `CREDIT_LIMIT_CHECK.prod_v15_base.json`) with the change above.
2. Workflow **SO_SAVE_SUBMIT**, id **`2112758477792346114`**: paste `SO_SAVE_SUBMIT.prod_paste.json`.
   It is prod v6 (= `SO_SAVE_SUBMIT.prod_v6_base.json`) with the change above. The new version may be numbered below
   v6; the enabled one is the live one.

## After the paste

- `.dbtools/wf --prod deployed GlobalCreditLimitCheckWorkflow.json` and
  `.dbtools/wf --prod deployed "Sales Order/AsyncV2/SO_SAVE_SUBMIT.json"` must both say IDENTICAL.
- `python3 scratchpad/prod_health.py`.
- No data step: neither workflow writes anything new.

**Rollback:** paste the `*_base.json` file back into the same workflow (prod history also keeps v15 / v6).

**Not in this paste:** an index on `Customer_id` in `customer_skgkxqcn_sub` and `customer_wyjlo2tg_sub` on prod would
speed up every other read of a whole customer record (form loads too). That is a database change, not a paste.
