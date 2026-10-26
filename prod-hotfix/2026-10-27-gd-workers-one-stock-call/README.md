# 2026-10-27 GD Complete / Cancel / Revert workers: one stock call per run (the LSH freeze of 10-26 20:40-21:10)

**Status:**
- **Pasted and verified IDENTICAL:** GD_COMPLETE_WORKER prod v7 (00:43:49) and GD_CANCEL_WORKER prod v6 (00:43:05).
- **Pasted and verified IDENTICAL:** GD_REVERT_WORKER prod v7 (10-27 01:04:29), added on the user's request
  ("revert as well").

**Paste into (prod ids = dev ids):**

| Workflow | id | Paste file | Prod base (rollback) |
|---|---|---|---|
| GD_COMPLETE_WORKER | 2110182645714518018 | `GD_COMPLETE_WORKER.json` | v6 (10-25 14:17:14) = `GD_COMPLETE_WORKER.prod_v6_base.json` |
| GD_CANCEL_WORKER | 2112455700319932418 | `GD_CANCEL_WORKER.json` | v5 (10-25 14:23:52) = `GD_CANCEL_WORKER.prod_v5_base.json` |
| GD_REVERT_WORKER | 2112758130420088833 | `GD_REVERT_WORKER.json` | v6 (10-25 13:33:32) = `GD_REVERT_WORKER.prod_v6_base.json` (re-checked 00:52) |

GD_REVERT_WORKER tests:
- **Dev:** v7 (00:47:02), the same change; 21/21 offline cases across the three workers.
- **One sweep, two due reverts** (GD/20261019/598 + GD/20261021/606, tenant 000000): the sweep reverted 598 and left 606 QUEUED;
  a second sweep reverted 606. This is the rule working at runtime.
- **Real size:** GD/20261022/119 (1,999 lines, 496474) reverted in one run (218 s on dev). All 1,999 reservations are back to
  Allocated; the longest lock call took 43.6 s for the one 2k-key take.
- **Not eligible:** GD/20261012/069 (2,000 lines) was refused by SUBMIT (handling-unit stock goes to the classic revert).
  Nothing was written.

Both bases were re-checked IDENTICAL to prod at 10-27 00:42. Dev runs the paste files: GD_COMPLETE_WORKER v8 and
GD_CANCEL_WORKER v6 (10-27 00:35). The two pastes are independent, and either order is fine.

## What happened (prod, read-only)
- **The batch:** at 20:37 LSH bulk-completed about 30 GDs. Most finished in 1-3 min. GD-2610-1438, 1418, 1411, 1409 and 1263
  took about 32 min, and the cancel of GD-2610-1016 (20:52) took 17 min. All six finished between 21:09:57 and 21:10:20.
- **The cause:** two id-less sweeps each took several jobs in a row. The platform keeps every stock key a run took until the
  whole run ends.
  - W1 (2114698179025965057, from 20:38:29) completed 1401 / 1398 / 1389 / 1348, then waited for GD-2610-1438's keys.
  - W2 (2114698423432253441, from 20:39:28) completed 1410 / 1342 / 1345, then waited for GD-2610-1263's keys.
  - 1438 needed an item W2 held, and 1263 needed two items W1 held, so each waited for the other.
  - Their INVENTORY_LOCK_TOKENS calls waited about 30 min until the platform lock expired. The first was released at
    21:09:50, and everything queued behind them followed.
- **Damage:** none. No run failed, each job applied its stock once, and no repair is needed.

## The change (patch_workers_one_stock_call.py)
- **The rule:** the same as GD_ASYNC_WORKER v17 (10-26 morning). Once an iteration has called the commit (a publish or a
  resume), the next loop index is 9999, so the run takes no further job and its other iterations SKIP.
- **The nodes:** `code_node_GWsplit` / `code_node_XWsplit` return `nextIndex` (declared int), and
  `set_cache_GWidxN` / `set_cache_XWidxN` store it instead of Pick's.
- **Unchanged:** the split's second call (reservations, documents; no stock), prepare-only iterations, and every client.
- **Throughput:** bulk Complete still starts up to 12 single-job runs, then chains sweeps while they find work. Each sweep now
  publishes one GD, and none can hold one GD's keys while waiting for another's.

## Tests
- **Offline:** `scratchpad/gdc/test/test_workers_one_stock_call.js` runs the real Split / Pick code of both workers. It passes
  14/14 on the paste files; today's prod versions fail the 12 next-index cases.
- **Lint:** no new findings.
- **Dev, real size (10-27 00:36-00:38):** `scratchpad/gdc/deploy_one_stock_call/run_cancel_test.py` bulk-cancelled 9 test GDs.
  Two of them were the 100-line GD/20261026/630 + 631, which share the same 100 items.
  - The runs: 2 single-job runs plus 3 concurrent sweeps per round.
  - All 9 COMPLETED in 140 s.
  - Every worker run claimed exactly one job (10 claims for 9 jobs; 631 = its commit plus a later phase B).
  - INVENTORY_LOCK_TOKENS: 18 calls, longest 4.8 s. INVENTORY_BULK_APPLY: longest 18.9 s.
  - 4 of the 17 runs ended at the claim gate (a twin claim insert), which is the existing design when runs race for one job.
    The real list chains its sweeps one at a time.
- **Dev complete smoke:** GD/20261019/598 went QUEUED -> COMPLETED in one GD_COMPLETE_WORKER v8 run (4.9 s, no error).

After the paste, for each file: `.dbtools/wf --prod deployed "prod-hotfix/2026-10-27-gd-workers-one-stock-call/<file>"` must say
IDENTICAL with the id above.
