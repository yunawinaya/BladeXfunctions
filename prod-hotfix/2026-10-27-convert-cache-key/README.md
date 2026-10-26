# 2026-10-27 Convert workflows: one cache per run (the wrong invoice number on GD-2610-2093)

**Status:**
- **Dev:** LIVE, all three IDENTICAL to the repo: GD_Convert_SI v32 (03:04:55), SO_Convert_SI v60 (03:04:56),
  PO_CONVERT_PI v7 (03:05:48).
- **Prod:** LIVE, all three verified IDENTICAL by name and id: GD_Convert_SI v30 (03:15:30), SO_Convert_SI v41
  (03:14:55), PO_CONVERT_PI v7 (03:14:24).

| # | Paste into | id | Paste file | Prod base (rollback) |
|---|---|---|---|---|
| 1 | GD_Convert_SI | 2070069049332416514 | `1_GD_Convert_SI.json` | v29 = `1_GD_Convert_SI.prod_v29_base.json` (68's cf-si paste) |
| 2 | SO_Convert_SI | 2029006184569364481 | `2_SO_Convert_SI.json` | v40 = `2_SO_Convert_SI.prod_v40_base.json` (68's cf-si paste) |
| 3 | PO_CONVERT_PI | 2107312550576844801 | `3_PO_CONVERT_PI.json` | v6 = `3_PO_CONVERT_PI.prod_v6_base.json` |

The three bases were checked IDENTICAL to prod at 10-27 03:07. Each paste differs from its base only in one node: the one
that names the run's Redis key (GD_Convert_SI / SO_Convert_SI `code_node_YRozjK8Z`, PO_CONVERT_PI
`code_node_PoConvRedisName`).

## What happened (Kenhin 528521, 10-26 15:58, prod read-only)
- **The batch:** one user bulk-completed GDs with auto-SI. Each completion runs GD_Convert_SI headless.
- **The shared cache:** the run names its cache `GD_CONVERT_SI:<user>:<date>:<HHMMSS>`. The runs for GD-2610-2094 and
  GD-2610-2093 both named it in second 15:58:17 and shared `GD_CONVERT_SI:2006752085990985729:2026-10-26:155817`.
- **The result:** both reported SI/20261026/0856, which is 2094's invoice. 2093's own invoice, 0857, is right; only the
  completion's note was wrong.
- **What the shared value holds:**
  - GD_Convert_SI: the run's results. A run can report another run's number, or "could not be created" for an invoice
    it did create.
  - SO_Convert_SI and PO_CONVERT_PI: the loop cursor and the created invoices. Two same-second runs of one user could
    skip or repeat a document.
- **Exposure:** GD Complete V2's bulk Complete runs up to 12 auto-SIs at once under one user. The list converts need a
  double run within one second.

## The change (`scratchpad/gdc/patch_cache_key_per_run.py`)
- The name gets `:` + 8 random characters, so every run has its own cache. Nothing else changes.
- Code nodes already use `Math.random().toString(36)` (e.g. SO_AUTO_GD, PICKING_LOOP).
- **Not changed:**
  - SI_POST builds its keys the same way, but it is out of scope (user, 10-27).
  - MI_CREATE too (1 prod run, ever). Its patched copy sits unpublished in `scratchpad/gdc/deploy_cache_key/`, because
    dev holds an unpublished v14 draft of it.

## Tests
- **Offline:** `node scratchpad/gdc/test/test_cache_key_per_run.js <files>` runs each naming node twice in one second. It
  passes on these three files and on dev, and today's versions fail every "different keys" case.
- **Lint:** no new findings.
- **Live on dev (as admin@000000):** two GD_Convert_SI runs with GD Complete's auto-SI parameters.
  - GD/20260930/565 got SI/20261027/0170 and GD/20260921/550 got SI/20261027/0171. Each run reported its own invoice.
  - Keys: `...:030713:86lfyyau` and `...:030715:6s5y3vz3`. The two calls did not overlap, so the same-second case rests
    on the offline test.

**After the paste:** for each file, `.dbtools/wf --prod deployed "prod-hotfix/2026-10-27-convert-cache-key/<file>"` must
say IDENTICAL, with the name and id above.
