# SUBTRACT_INVENTORY_NEW: WA issue after an in-run costing migration (2026-10-26)

**Paste target:** `SUBTRACT_INVENTORY_NEW`, id `2031973476128071681`.
**Paste file:** `SUBTRACT_INVENTORY_NEW.json` (146,141 chars, sha256 `76b2b9942687…`).
**Base:** prod v28 (enabled 2026-10-22 16:27:57, sha `4d509be4a4aa`), saved here as `SUBTRACT_INVENTORY_NEW.prod_v28.json`. Dev ran the
same v28; dev is now v29 = this file.

## The bug

`search_node_7bvv7f8g` reads the item's WA row *before* the costing-migration block. When the migration then writes that row,
the two WA readers act on the stale lookup:

| Case | Migration | v28 result |
|---|---|---|
| WA item with only a FIFO row at the plant | `code_node_oz7GGSQA` + `add_node_yOylfPVp` add the WA row | price 0; `code_node_fVEv7HuP` throws "No Weighted Average costing record". The issue fails once per item and plant. |
| WA item with FIFO and WA rows | `code_node_YqMfJIMz` + `update_node_aw5PNoxu` merge FIFO into the WA row | pre-merge price, and the WA quantity is written back as pre-merge minus the issue: the merged FIFO quantity is lost silently |

Kenhin (528521) hit the first case 3 times: on 10-23 (PI-20261023-0307, 0310) and on 10-26 (PI-20261026-0315, item V131 on
GD/20261026/2091). Each time, the auto-complete died half-way inside classic PICKING, and the Picking was left locked. The WA rows
that "appeared" afterwards were written by the migration in the same failing run.

## The change (3 code nodes, nothing else)

- `code_node_7l9u4Zca` (WA Unit Price): when the migration ran, the price is the migrated row's `wa_cost_price`.
- `code_node_fVEv7HuP` (process WA Data), and its classic-lock copy `code_node_fVEv7HuPCLp`, deduct from one of these:
  - the merged row: its id and merged quantity;
  - the row the migration added: its id comes from `add_node_yOylfPVp`.
- A node of a branch that did not run reads null, so items without a migration behave exactly as before. When there is no WA
  row and no migration, the named error is still thrown.

## Evidence

- `test_subtract_wa.js`: 9/9 on the paste file. On v28, 6 of them fail, the migration cases.
- Lint: only new CONDITIONAL notes (informational; every read is null-guarded).
- Dev v29 live smoke on 10-26 16:15: a 1-unit WA issue of test item WEIGHTED (tenant 000000, trx TEST-SUBTRACT-WA-20261026).
  - The run answered 200 at the WA price 0.1667.
  - The WA row went 2 → 1, the balance 1 → 0, and the movement was OUT 1 at 0.1667.
  - Dev has no FIFO-only WA item, so the migration path itself is covered by the test only. If the add-node's id came back in
    another shape, that case falls back to today's error, never to a wrong write.
- Kenhin's 8 items at risk all have a FIFO row and no WA row at plant 2006975338995011586: V112, V97, B01-SOLO (M), B03-3, V127,
  B09N, BG10 and CY01-95. With this file live, they convert on their first issue instead of failing.

## After the paste

**Pasted 2026-10-26, enabled 16:20:09 as prod "v25"** (the platform's own number for the paste). Verified on
'SUBTRACT_INVENTORY_NEW' (id=2031973476128071681):
- All 260 nodes are present, and every script is identical to this file, including the 3 fixed nodes.
- `wf deployed` still reports DIFFERS, for one reason only: the prod designer added empty default fields on save to 6 nodes
  the fix did not touch (`database_id` / `sql` on 5 sql-nodes, `workflow_id` / `workflow_name` on `workflow_node_CLseed`).
- Kenhin health check after the paste: BALANCE, GD-STOCK, JOBS and LOCKS are clean. The CRASHES flag is the recovered 15:58
  GD/20261026/2097 commit.

The Picking pre-check in `../2026-10-26-kenhin-wa-precheck/` is shelved. It checks WA rows only, so it would block exactly
these self-healing items.
