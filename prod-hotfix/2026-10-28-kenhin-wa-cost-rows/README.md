# 2026-10-28 Kenhin: Weighted Average items with only FIFO cost rows block GD completion

**Status:** RUN on prod, verified 2026-10-28 ~11:55.
- The 20 WA rows equal `plan.json`, and 0 of the 20 FIFO rows are still active.
- Only V97 is still refused (left out on purpose).
- GD/20261028/2216 then completed through GD Completed V2 at 11:53:00 (6 s) and was invoiced (SI/20261028/0964).
- B03-45's new WA row went 999,999 -> 998,784 (the 1,215 delivered), as the engine handles WA rows.

## What happened
- **The failure:** GD/20261028/2216 (B03-45 BWP KOPEK LOOSE - 4.5KG, 1,215) failed GD Completed V2 at 11:42 with
  `GDC_INVENTORY_UNSUPPORTED_COSTING`: "Item 2058889418392915989 has costing rows that need migration (FIFO 1, WA 0)".
- **Why:** the item is Weighted Average, but its only cost row is the FIFO layer from the 2026-05-26 opening load (999,999
  at 0). The stock engine refuses such items. The GD went back to Created and got no auto-invoice. It fails again on
  every retry until the rows are migrated: the accepted GD Completed V2 gap of 10-16.
- **Scope:** 21 Kenhin items are in this state. 9 are reserved by open GDs: 19 old ones (June to 1 Oct, never picked) and
  today's GD/20261028/2216.

## The fix (`migrate.sql`, built by `build.py`)
- **What it does:** exactly what classic SUBTRACT_INVENTORY_NEW's "Migrate Costing Incorrect Data" does. Per item:
  - add one `wa_costing_method` row: quantity = the FIFO rows' available quantity, cost = their weighted cost (0 for all
    20);
  - set the FIFO rows to `is_deleted = 1`.
- **Precedent:** classic did this for TY-KT06 at Kenhin on 2026-10-23 16:01:31.
- **Shape:** the WA rows copy the platform's own WA rows at Kenhin: `created_at` / `updated_at` '', `sub_tenant_id` NULL,
  the org as dept, and the FIFO row's creator as the user.

**V97 is left out on purpose.** Its second FIFO layer is MSR-20260924-0007: 999,999,999 at RM 52.00. Merged, V97 would cost
RM 51.95 a unit instead of 0. Kenhin should check that receipt first. No open GD of today needs V97.

## Run, in order
1. **PART 1 (checks):** 20 FIFO rows to retire, 0 WA rows already there.
2. **PART 2:** expect rows affected 20 (insert) / 20 (update). The statements are guarded, so a second run does nothing.
3. **PART 3 (after-checks):** 20 WA rows, 0 active FIFO rows.
4. **Then complete GD/20261028/2216 again** from the GD list (Complete). GD Completed V2 completes it and its auto-invoice
   is created.

**Rollback:** `rollback.sql` works only while the new WA rows are untouched, that is before any delivery uses them.
