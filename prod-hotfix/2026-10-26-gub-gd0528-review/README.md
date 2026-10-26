# 2026-10-26 GUB (900938): GD-26/10/0528 held for review by a false VERIFICATION_MISMATCH

## What happened
- **09:02:46** CREATE_GD_FROM_FORM job 2114523094264713218 (SO-26/10/0021) reached P3. Operation `GD|2114523094264713218|1`
  moved 70 units Unrestricted -> Reserved on item_balance 1979083526128324609 (material 1979082567809552385, bin
  1975932706692059138) and wrote both movements.
- **The engine's AFTER_MOVEMENT_INSERT check failed.** It compared the planned FIFO price with the stored one:
  - planned unit_price **99.93685714** vs stored **99.9369** (the column keeps 4 decimals);
  - planned total_price **6995.5799998** vs stored **6995.58**.
  - So it answered VERIFICATION_MISMATCH. The job went REQUIRES_REVIEW, the GD stayed hidden in Processing, and the
    operation kept its 8 locks (ITEM key + 7 RESERVATION keys) from 09:02:55.
- **Nothing is actually wrong with the stock.** The balance shows exactly the planned after-values (Reserved 44 -> 114,
  Unrestricted 9076 -> 9006, total 9120), both movements exist (ids 2114523147138109442 / ...443), and the 7 reservations
  (70) exist.
- **The only such review on prod since 10-20.** Prices with at most 4 decimals pass, e.g. GD|2114524711483478018|1 at 153.307 /
  176.4291.

## Repair (`repair.sql`, user runs; one transaction)
Records what a normal completion writes, using GD|2114524711483478018|1 as the template:
- effects VERIFIED, with movement ids on the two stock effects;
- the operation DONE / OK;
- its 8 locks released;
- the P3 step DONE;
- the job back to COMMITTING_GD, due now.

Preview, read-only: 9 / 1 / 8 / 1 / 1 rows. Then GUB's GD list (or any GUB GD creation) kicks the worker, which publishes the
GD (P6-P7: Created, SO projection, Picking).

## Fix to build: engine precision
INVENTORY_APPLY_OPERATION (prod v12) prices movements at up to 8 decimals but stores unit_price at 4. The after-insert check
must compare at the stored scale, the way the insert rounds. Any tenant can hit this when a FIFO cost has more than 4 decimals.
