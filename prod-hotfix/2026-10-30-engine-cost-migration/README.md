# 2026-10-30 Stock engine migrates mismatched costing rows (INVENTORY_BULK_APPLY v13)

**Status:** PROD LIVE 10-30 12:48:09 as v13 = the paste (verify.py; the designer save added its empty defaults and dropped the
branch labels, nothing else). First runs: 4 GUB engine runs 12:48:18-12:48:43, all Complete, no 'is not loaded', no costing
refusals. DEV v13 LIVE 12:43 (= repo), live tests PASSED.

## Why
- V2 flows that move stock through INVENTORY_BULK_APPLY refused items whose costing rows do not match their costing method
  (`*_INVENTORY_UNSUPPORTED_COSTING`): GD Completed V2, GD Cancel V2, Picking V2 bin moves, IA Transfer Request (and the
  after-submit cases of LOT / SA / IA / IDA / Putaway). Classic's SUBTRACT_INVENTORY_NEW migrates such rows itself.
- Kenhin hit it twice (GD/20261028/2216, GD/20261030/2341), fixed by hand. On prod now: 141 such keys (GUB 81, 627085 57,
  035843 2, 073522 1). User, 10-30: the engine migrates (choice A).

## What changes
- Where it refused, the engine migrates the rows as classic does, then prices and moves the stock from the migrated rows:
  - a WA item with FIFO rows: one WA row (their available quantity at their weighted cost), or merged into its newest WA row;
  - a FIFO item with WA rows: the newest WA row becomes its next FIFO layer;
  - the other method's rows: `is_deleted = 1`;
  - values stored at the tenant's number rule (as the platform stores them).
- **User's choices (10-30):** price and deduct from the new FIFO layer (classic priced that stock-out at 0 and left the layer
  full); merge into the newest WA row (classic: the first one read; same with one WA row); Fixed Cost items with both kinds go
  through untouched (as classic).
- **Locks:** a migration happens only under the pair's COST lock. An unpriced category move takes none today, so a new probe
  (APPLY only, only when the request has such moves) finds the pairs whose rows need migrating and adds just their COST keys
  (one ordered take, as before). Every release covers those keys. Without the lock (a race) it refuses as before.
- Part of the stored plan: a resumed run finds a retired row gone and counts it done; the read-back checks it.
- Builders: `scratchpad/gdc/engine/core.js` (opt-in `migrateCosting`; other includers keep the refusal),
  `scratchpad/gdc/iba/code/*.js`, `scratchpad/gdc/iba/patch_cost_migration.py`.

## Tests
- `scratchpad/gdc/engine/test_core.js` 31/31 (10 migration cases); `test_migration_twins.js`: 400 random cases equal classic's own
  nodes (code_node_oz7GGSQA / code_node_YqMfJIMz); `scratchpad/gdc/iba/test_nodes.js` 13/13 (fresh APPLY + resume of a migration),
  `test_lock_leak.js` 17/17, `test_run_marker.js` 18/18; linter: same findings as v12.
- **Common path:** 200 SUBTRACT + 100 ADD recorded prod calls replay identically through the old and the new planner.
- **Dev live (000000, `scratchpad/gdc/iba/live_migration/live_test.py`):** T1 FIFO -> WA (ABC-TEA, 10 @ 5 + 1 @ 1000 -> WA 11 @
  95.4545, priced 95.4545); T2 WA -> FIFO on an unpriced category pair (probe -> COST lock taken and given back, layer 11 @ 95.4545);
  P1 PLAN mode (migration planned, nothing written); T3 32 items / 64 movements in 1.4 s, locks back; T4 replay of T3.

## Paste
1. **When:** a quiet hour. Every V2 stock flow calls the engine; concurrent first runs right after a publish have stuck
   workflows before ("script for node is not loaded").
2. Paste `INVENTORY_BULK_APPLY.prod_paste.json` into INVENTORY_BULK_APPLY (id 2109916822821744641), save, enable.
3. `python3 verify.py` right after and again a few minutes later: enabled = the paste, no 'is not loaded', no costing refusals.
- **Rollback:** paste `INVENTORY_BULK_APPLY.prod_v12.base.json`.
- **After it:** the 141 keys above migrate on their next V2 stock-out, with the costs classic would give (for example a WA item's
  cost becomes the weighted cost of its FIFO layers).
