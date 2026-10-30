# 2026-10-30 Stock engine reports the FIFO layers an issue used (INVENTORY_BULK_APPLY v14, "A1")

**Status:** PROD LIVE 10-30 15:25:12 as v14 = the paste (verify.py). First runs: 4 at 035843, 15:30:24-15:32:07, all Complete,
no 'is not loaded', no reviews. The health check after the paste showed only the known baseline CHECKs. DEV v14 has been live since 15:20 (= repo), and the live tests PASSED. No flow asks for the layers until the
consignment / subcontract PO flows ship.

## Why
- The consignment / subcontract PO developer needs the FIFO layers each dispatch drew, so that a return can be posted at its original prices. The engine answered with one averaged price only.
- User, 10-30: build it as an opt-in flag (their option A1).

## What changes
- A SUBTRACT movement sent with `report_layers: true` gets `fifo_layers` in its result: `[{id, sequence, quantity, cost}]`, oldest first.
  - The flag also accepts 1, "1" and "true".
  - `id` is null for a layer made earlier in the same operation.
  - Stock that no layer covers is a last entry `{id: null, sequence: null, quantity, cost, uncovered: true}`.
  - Only a FIFO issue that draws layers (isMovingInv 0) has the field.
- The field is part of the stored answer, so PLAN, RESUME and REPLAY all give it.
- Only `code_node_IBplan` changes (`engine/core.js` is inside it). A caller that doesn't send the flag gets exactly v13's answer.
- Builders:
  - `scratchpad/gdc/engine/core.js`;
  - `scratchpad/gdc/iba/patch_layers_report.py` (repo / dev);
  - `build.py` here (prod: prod's deployed v13 + the new plan code; it refuses if prod's plan code isn't our v13).

## Tests
- Offline:
  - `scratchpad/gdc/engine/test_core.js`: 37/37, 6 of them new;
  - `scratchpad/gdc/iba/test_nodes.js`: 14/14 (APPLY, RESUME from the intent, the DONE row and REPLAY all carry the layers);
  - `test_lock_leak.js` 17/17, `test_run_marker.js` 18/18 (v11 control);
  - `test_migration_twins.js` 400/400;
  - linter: the same findings as v13.
- **Common path** (`scratchpad/gdc/engine/compare_cores.js`): without the flag, 300 recorded prod calls (200 SUBTRACT, 100 ADD) give plans identical to v13's. With the flag, the 37 FIFO issues among them report layers that add up to their quantity and total price.
- **Dev live** (000000, `scratchpad/gdc/iba/live_layers/live_test.py`):
  - P: PLAN of P-00001 over 4 layers (1 + 10 + 10 + 1 @ 80 = 1,760 = total price, nothing written);
  - A: ABC-TEA issue 2 + receipt back (it names layer 1 at 95.4545; the layer went from 11 to 9; the receipt made layer 2; the DONE row keeps the layers);
  - R: REPLAY gives the same answer;
  - S: 32 items / 64 movements in 1.5 s, no layers on category moves, locks back.

## Paste
1. **When:** a quiet hour. Every V2 stock flow calls the engine, and concurrent first runs right after a publish have stuck workflows before ("script for node is not loaded").
2. Run `python3 verify.py` first. It must say "= v13 (not pasted)". If it doesn't, someone changed prod: run `python3 build.py` again, which refuses if the plan code moved.
3. Paste `INVENTORY_BULK_APPLY.prod_paste.json` into INVENTORY_BULK_APPLY (id 2109916822821744641), then save and enable.
4. Run `python3 verify.py` right after and again a few minutes later. It should report "= the paste", no 'is not loaded' and no reviews.
- **Rollback:** paste `INVENTORY_BULK_APPLY.prod_v13.base.json`, which is prod's enabled v13 as read on 10-30.
