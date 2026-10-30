# 2026-10-28 GD Cancel V2: a re-used GD number no longer gets the cancel stuck

**Status:** DEV v5 live, live test PASSED 2026-10-28 19:27. PROD: not pasted yet.

## What happened
- **Re-using a cancelled GD's number is common.** Users cancel a GD, then type its number into a new one
  (`delivery_no_type` -9999). On prod: 681409 has done it 85 times, PTS 58, five other tenants a few times.
- **The clash:** every cancel renames the GD to "<number>-Cancelled". For the second GD with that number the name is already taken, and the
  unique (organization, delivery_no) index refuses it.
- **Classic** fails at its first write, so nothing is changed and the GD can't be cancelled. PTS GD/2608/891 and GD/2609/904 were renamed
  "-Cancelled-1" by hand.
- **GD Cancel V2** renames the GD last (X6), after the stock is released, so the job was stuck in Processing: PTS GD/2610/1010
  (repaired today, `../2026-10-28-035843-gd1010-cancel/`).

## The fix: GD_CANCEL_PREPARE only (prod v4 -> v5)
- **A new read** (`sql_node_XPcnos`): the organization's numbers "<number>-Cancelled...", deleted rows included. It is a range on the
  "Document Number" index; on prod it reads 1 row.
- **The new name:** the plan uses "<number>-Cancelled" when it is free, otherwise the first free "-Cancelled-2", "-Cancelled-3", and so on.
  It is used everywhere the cancel writes the number: the GD, its Pickings and Packings, the stock movements, and the plan.
- **Nothing else changes.** COMMIT, SUBMIT, WORKER, the GD list and the form are untouched.
- **The common case is unchanged:** with no twin, the plan is byte-identical to v4's. This was checked on 3 dev GDs and 2 LSH prod GDs
  with header custom fields.
  - v5's plan code also carries the shared header custom-fields lines (live in GD Completed V2 and GD Edit V2 since 10-27). They change
    nothing in a cancel; this byte-identical check covers them.

## Tests
- **Offline:** workflow_sim, 23/23 on 3 dev GDs; the 2 new cases are a taken twin (-> "-Cancelled-3") and an empty read.
- **Offline, X5:** the shared-Picking tests (16) and the race test still pass.
- **Dev live** (tenant 496474, user's yes):
  - **Twin case:** GD/20261022/115, with a twin "GD/20261022/115-Cancelled" in place, ended COMPLETED as `GD/20261022/115-Cancelled-2`.
    So did Picking PI-20261022-0107 (header text and rows) and its 16 movements; nothing was written under the twin's name.
  - **Plain case:** GD/20261023/122 ended COMPLETED as `GD/20261023/122-Cancelled`.

## Paste
1. **GD_CANCEL_PREPARE** (prod id 2112455739305988098): paste `GD_CANCEL_PREPARE.paste.json`, then enable (v5).
   - Best when no cancel is running; a running one keeps the version it started with.
2. **Then I check:**
   - `.dbtools/wf --prod deployed "Goods Delivery/CancelV2/GD_CANCEL_PREPARE.json"` is IDENTICAL;
   - no "is not loaded" error on the cancel workflows;
   - the next cancel at any tenant is COMPLETED.

**Rollback:** paste `GD_CANCEL_PREPARE.prod_v4.json` (= prod v4, enabled 2026-10-25 14:24).

## Not changed, known
- **Classic cancel:** GDPP GDs, serial-numbered items and the classic phone app still clash. They fail cleanly with nothing written; the fix
  would be in classic GOODS_DELIVERY.
- **X5 on a shared Picking:** it re-applies another cancel's rename as "<number>-Cancelled". With a re-used number on a shared Picking
  that name can be wrong.
  - Only LSH and GUB have shared Pickings. LSH never re-uses numbers, and GUB last did in June (twice).
  - The rework is kept as `scratchpad/gdcan/x5_reused_numbers.patch` (applies on the live X5), not deployed.
