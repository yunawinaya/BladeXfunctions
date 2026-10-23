# GD V2 vs classic: parity audit (2026-10-23)

## Why

Two V2 flows missed something the classic save does:

- GD Created V2 checked the credit limit only in the background, after the form had closed. It now checks at the click (fixed 10-23).
- GD Created V2 never stamped picking_status "Not Created" for setups with manual picking (fixed 10-23).

The user asked for a full check. **fa** (GD Created / Completed / Cancel / Revert V2) builds the inventory of what classic does and maps it onto its flows. **35** (GD Edit V2 + SO_CASCADE) maps its flows in its own section.

Verdicts:

- **MISSING:** a V2 bug.
- **DIFFERENT ON PURPOSE:** decided, with the reason.
- **OK:** V2 does it too.

Nothing is built or published before the user has seen the list.

## Classic inventory (fa)

**Baseline:** GOODS_DELIVERY **v245**, identical to the repo's `GDheadWorkflow.json` on dev and on prod. GD_UNUSED_FN_NEW **v56** is read live: the repo file is stale, and v56 only adds the MIN-01 `CLgd*` pre-check, which is switched off.

**What classic does, in order:**

1. GD busy with an async job; the same SO held by a background save.
2. GR gate (Completed): internal-trading auto-GR confirmation.
3. Zero-quantity question.
4. Picking and packing setup; item flags with UOM over-delivery tolerance.
5. Auto picking mode: GLOBAL_ALLOCATION for each line without stock selected.
6. Edit: a Picking In Progress refuses Created; multiple live Pickings.
7. Header fill-back (`IyJHrBst`): gd_total, line statuses, invalid data.
8. Picking reconcile / pick-reversal confirm (edit).
9. CHECK_REQUIRED_FIELD: customer, plant, SO, delivery date, number, item table.
10. Picking status: "Created" with auto trigger, "Not Created" with manual.
11. Credit limit: Block / Override / auto.
12. Completed gates: picking 405/406 (Force Complete closes the Picking), packing 407.
13. SO quantity check (`QtyCheckBatch`): item not found, SO line gone, over delivery.
14. Auto-SI confirmation.
15. Inventory pre-flight: GD_UNUSED_FN_NEW in check mode.
16. Reorder (REORDER_SET_REDIS): Created / Completed / Cancelled.
17. GD write; completion snapshot (Completed); SO lines and header.
18. GD_UNUSED_FN_NEW (reservations, stock, HU, Picking records).
19. Auto picking creation plus GD / line stamps.
20. Picker notifications: built, but gated on `saveAs == "Removed"`, so they **never run**.
21. Picking header sync.
22. Item last_transaction_date: **every save**.
23. After Completed: auto-GR (GD_TO_GR), auto-SI (GD_CONVERT_SI).

**Child workflows classic calls, and which V2 flows call them:**

| Classic call | V2 |
|---|---|
| CREDIT_LIMIT_CHECK | SUBMIT (since 10-23), PREPARE, COMPLETE_SUBMIT, GD_EDIT_SUBMIT |
| REORDER_SET_REDIS | BULK_COMMIT, COMPLETE_COMMIT, CANCEL_COMMIT, EDIT |
| GD_COMPLETION_SNAPSHOT | COMPLETE_COMMIT |
| GD_CONVERT_SI | COMPLETE_COMMIT |
| Push_Notification_v2 | GD_PICKING_OUTBOX_CONSUMER (see below) |
| CHECK_REQUIRED_FIELD | in-process in COMPLETE_SUBMIT and EDIT_SUBMIT; Created V2's SUBMIT guard checks the same fields |
| GD_TO_GR | none: an auto-GR delivery goes to the classic save (Completed V2 NOT_ELIGIBLE "auto-GR"; Edit V2 too) |
| GLOBAL_ALLOCATION / GD_UNUSED_FN_NEW | replaced: allocation lifted into PREPARE; stock through the engines |

**The form's other buttons:**

- "Created and Post" (`onClick_createdPost`) always runs the **classic** save, then the delivery-order sync, for tenant 128671 only. V2 isn't involved.
- Draft runs classic.
- Created runs `gde_` (Edit V2 for a saved GD, else Created V2).
- Completed runs `gdc_`.

## GD Created / Completed / Cancel / Revert V2 + SO_AUTO_GD (fa)

**Result:** 1 MISSING (Created V2), plus 1 difference for the user to decide. Both fixed earlier today are listed for completeness.

### MISSING

| # | Flow | Classic | V2 | Evidence |
|---|---|---|---|---|
| M1 | **GD Created V2** (form + SO_AUTO_GD) | `update_node_6J0zCjxf`: Item `last_transaction_date` = now for every material of the delivery, on every save | never written: no V2 Created workflow (SUBMIT / PREPARE / COMMIT / WORKER / consumer) writes it. Completed V2 (C6), Cancel V2 (X7) and Edit V2 (E7) do | prod since the cut (64 V2-created GDs from 10-23 01:31): **1** item's date is behind its delivery's date, **none is empty**. The column is a `timestamp` holding a date at midnight; a first count of 101 compared it with a datetime and was wrong. Only the date's presence is read (Item delete guard + form lock, per 35), so the impact so far is nil. |
| (fixed) | GD Created V2 | credit limit at the click | was background only | SUBMIT v13 + form, prod 10-23 |
| (fixed) | GD Created V2 | picking_status "Not Created" (manual picking) | not stamped | PREPARE v18 (35), prod 10-23 |

### DIFFERENT: the user decides

| # | Flow | Classic | V2 |
|---|---|---|---|
| D1 | GD Created V2 (Picking consumer) | builds "New Picking Assignment" / "Picking Assignment Cancelled" pushes but never sends them: the gate is `saveAs == "Removed"`, which no save sends, so they are switched off in effect | the consumer **sends** them when the Picking has assignees (and never with an empty recipient list). Prod since the cut: 0 sent (no assignees on V2 GDs); the 44 pushes on 528521 come from other modules |

### DIFFERENT ON PURPOSE / minor

| # | Flow | Note |
|---|---|---|
| d1 | GD Created V2 | The SUBMIT guard accepts an empty `so_id`, where classic's required check refuses "Sales Order". The form always fills it. LOW. |
| d2 | SO_AUTO_GD (headless convert) | Credit: classic sends needCL "auto" (Block refuses, Override passes with a note). V2 PREPARE does the same in the background (Block -> job FAILED `GD_CREDIT_LIMIT_BLOCKED`, Override passes). The Block arrives as a failed background job rather than an immediate refusal; the SO list follows jobs through GD_SO_CONVERT_CHECK. |
| d3 | GD Revert V2 | No Picking writes: classic GD_PROCESS_REVERT's Picking record writes apply to Picking Plan GDs only, which go to the classic revert. The GD lines' picking status is restored in R4 (lifted). Reorder and item date: classic revert does neither, and neither does V2. |

### OK: classic steps V2 performs

- **GD Created V2:**
  - Async-job / same-SO guards: SUBMIT.
  - Zero quantity: the form, since v1485.
  - Auto allocation: lifted into PREPARE.
  - Over-delivery tolerance, item and SO checks: PREPARE `J5T1G2s9`.
  - Required fields: the SUBMIT guard (customer, plant, date, number, lines).
  - gd_total: COMMIT.
  - Stock pre-flight: PREPARE plus engine validation.
  - Reservations and stock: engine + P2 / P7B.
  - SO lines and header: P7B.
  - Reorder: P7E.
  - Picking creation and GD / line stamps: consumer.
- **Not applicable to a new save** (edit paths, see 35's section): Picking In Progress, multiple Pickings, picking reconcile / reversal, picking header sync.
- **GD Completed V2 (+ Force Complete):**
  - Credit (SUBMIT, 402 / 403).
  - CHECK_REQUIRED_FIELD (in-process).
  - Auto-GR (to classic).
  - Picking / packing gates 405 / 406 / 407.
  - Force Complete closes Pickings (C4P).
  - QtyCheckBatch (lifted).
  - Auto-SI gate + GD_CONVERT_SI.
  - Snapshot (C1); stock (C2); reservations (C3); handling units (C3H); SO (C4); Picking records (C4P); GD (C5); item date + reorder (C6).
- **GD Cancel V2:** reservations, SO, Pickings, Packings, numbers, item date and reorder (X3-X7). Classic sends no cancel notification (gated off).

### Fix proposed (not built; the user decides)

- **M1:** add a last step to GD Created V2's commit, after P7B, that writes Item `last_transaction_date` for the delivery's materials, exactly as GD Completed V2's C6 does. Prod would then need a one-time repair of the stale rows.
- **D1:** either keep V2 sending picker notifications, or match classic (switch them off in the consumer).

## GD Edit V2 + SO_CASCADE (35)

**Result: nothing MISSING.** Two open items below, neither a bug today.

**Scope:** GD Edit V2 handles Save as Created on a saved delivery (Edit) and Draft → Created, through GD_EDIT_SUBMIT / WORKER / PREPARE / COMMIT. SO_CASCADE routes through it. The classic baseline is GOODS_DELIVERY **v245**, the live version on dev and prod (identical to the repo's `GDheadWorkflow.json`), Edit / Created path.

**How it was checked:**

- **Classic code, lifted:** GD Edit V2 runs 42 classic nodes, each byte-identical to its pinned deployed version: GOODS_DELIVERY v245, GD_UNUSED_FN_NEW v55, REORDER_SET_REDIS v21, GLOBAL_ALLOCATION v34. `test_lift.js` passes today.
- **Staleness:** `check_fresh.sh` finds only GD_UNUSED_FN_NEW moved (v56). None of the 4 nodes lifted from it changed; v56 only added the MIN-01 lock pre-check (10 `CLgd*` nodes, behind a switch that is off).
- **Traced:** every classic step below was traced to where V2 does it.
- **Twins** (classic vs V2 on the same edit, dev 10-15 / 10-16): a quantity edit, Draft → Created with auto-allocation, and removing and adding lines. GD, reservations, SO, Picking and stock matched.

| Classic step (GOODS_DELIVERY v245, Edit / Created) | GD Edit V2 | Verdict |
|---|---|---|
| GD busy (`if_GdProcBusy`) | SUBMIT: the GD lock, BUSY while Processing | OK |
| Zero-quantity question, invalid data, Picking In Progress / Picking blocks the edit / pick-reversal confirm | SUBMIT runs GOODS_DELIVERY's gates, lifted, in the same order with the same codes | OK |
| Required fields (CHECK_REQUIRED_FIELD) | SUBMIT, in-process | OK |
| Credit limit (CREDIT_LIMIT_CHECK when needCL = required: Block stops, Override asks unless auto-override) | SUBMIT calls the same workflow with needCL / clAutoOverride | OK |
| Item not found / SO line gone / validation message (QtyCheckBatch) | PREPARE, lifted | OK |
| Auto allocation (GLOBAL_ALLOCATION loop) | PREPARE runs the loop and GLOBAL_ALLOCATION v34 in-process on set-based reads | OK (only an exact tie can pick a different, equally valid bin or batch) |
| Full Picking: multiple Created Pickings (`if_j38KWlWo`) | not taken: more than one live Picking goes to the classic save | DIFFERENT ON PURPOSE |
| Inventory pre-flight (GD_UNUSED_FN_NEW in check mode) | PREPARE: the same planner, lifted, plus INVENTORY_BULK_APPLY PLAN; a shortage refuses, as in classic | OK |
| MIN-01 lock pre-check (GD_UNUSED_FN_NEW v56 `CLgd*`, switch off) | not in GD Edit V2 | OK today (open item 1) |
| Update GD data / Draft (`update_node_elLmtlLm` / `aJCo6wbf`) | E2 lines, E6 header | DIFFERENT ON PURPOSE: only changed cells are written; `delivery_cost` is kept |
| Picking merge into the GD (`if_PkMergeGd`) | PREPARE, lifted | OK |
| SO table + SO data (`update_node_wEJC3qKB` / `AFswLv4E`: planned_qty, SO status) | E4 | OK |
| Inventory + reservations (GD_UNUSED_FN_NEW, "GD Process Table") | E1 (engine) and E3, from the lifted planner | DIFFERENT ON PURPOSE: the stock moves first; reservations are read with no 1,000-row limit; new reservation rows carry `job_line_key`, so a rerun cannot add them twice |
| Picking update or create (auto_trigger_to 1), GD status and line stamps (`if_9xhwui06`, `update_node_StampGDLines`) | E5: UPDATE at the locked version, or the outbox guard for a CREATE; line stamps | OK (an unchanged Picking is not rewritten) |
| picking_status "Not Created" for manual-picking setups (`code_node_IyJHrBst` / `8pN1MyXz`) | PREPARE, lifted. Live proof in prod: GD-26/10/0499's Edit V2 job stamped its header and lines "Not Created" at 08:48 on 10-23 | OK (the rule GD Created V2 missed) |
| Picking header sync (`update_pick_hdr_sync`) | E5 | OK |
| Reorder signal (REORDER_SET_REDIS, Created) | E7_REORDER | OK (it runs after the writes) |
| Item transaction date (`update_node_6J0zCjxf`) | E7 item dates (E7_AFTER) | OK |
| Notifications (cancellations / assignments) | none | OK: classic's loops run only when saveAs = "Removed"; the Edit path sends "Created", so they never run on it |
| A Picking device lock older than 900 s | SUBMIT takes the lock over; classic answers "being processed on a device" | DIFFERENT ON PURPOSE |
| Completion snapshot, auto-GR, auto-SI, Force Complete closing the Picking | not on the Edit / Created path | N/A (Completed: fa's section) |

**Not taken by V2; these go to the classic save:**

- serial items;
- a Picking Plan GD;
- a loading-bay organization;
- more than one live Picking, or a shared Picking;
- internal-trading linkage;
- a plant change on a Draft.

Above 500 lines such an edit is refused with the reason. Three inventory refusals that classic handles fall back to the classic save: costing rows that need migration, a duplicate balance row, a negative price.

**SO_CASCADE:**

- Its V2 route is GD_EDIT_SUBMIT with source CASCADE, held until SO_SAVE releases it, so the rows above apply.
- It sends GD Edit V2 the same answers its classic route sends GOODS_DELIVERY: needCL "auto", continueZero "Yes", and the caller's confirmPickReversal. OK.
- Picking Plan deliveries go to classic PICKING_PLAN on both routes. OK.
- Deliveries over 1,000 lines are refused before GD_EDIT_SUBMIT, and the classic route keeps its 500-line cap. DIFFERENT ON PURPOSE (the 10-16 dev crash).
- A cascade abort cancels the held edits. DIFFERENT ON PURPOSE: classic has no hold.

**Open items (35):**

1. Before MIN-01 is switched on, GD Edit V2 needs the `CLgd` pre-check or a confirmed engine equivalent. To agree with 9d (MIN-01's ON list).
2. Bookkeeping: re-pin the lift to GD_UNUSED_FN_NEW v56. No lifted node changed, so `check_fresh.sh` then reads OK.

## Picking V2 (35)

**Result: nothing MISSING.** One cross-reference to fa's M1.

**Scope:** Picking V2 replaces three things on the web Picking form and list: the confirm (Save as Completed), the list's Auto Pick & Complete, and the list's Force Complete (1d). Workflows: PICKING_ASYNC_SUBMIT / WORKER / PREPARE / COMMIT, GD_REPLAN, PICKING_FC_DRIVE. The classic baseline is PICKING_LOOP **v89** and PICKING **v155**, the live versions on dev and prod (identical to the repo's `PickingLoopWorkflow.json` / `PickingProcessWorkflow.json`). Mobile confirms still run classic PICKING_LOOP; mobile Force Complete runs V2.

**How it was checked:**

- Every classic write, child call and refusal on the confirm path was traced to where V2 does it.
- V2's deliberate differences are listed in `Picking/AsyncV2/README.md`.
- **Live twins**, classic PICKING_LOOP vs V2 on identical GDs: 1a / 1b on 10-12 / 10-13; 1c on 10-16 (Loading Bay full and partial, bin swap, batch swap); 1d Force Complete on 10-21. They matched apart from the listed differences.

| Classic step (PICKING_LOOP v89 → PICKING v155, confirm) | Picking V2 | Verdict |
|---|---|---|
| A GD being saved in the background: 400 (`if_GdBusy`) | SUBMIT refuses busy deliveries and open jobs | OK |
| Lock state: processing / already Completed / Cancelled (`code_node_LockDecide`) | SUBMIT: the Picking must be In Progress; an open confirm or a fresh device lock refuses | OK |
| Required fields (CHECK_REQUIRED_FIELD: plant, Picking number, reference type, at least one item) | not run. V2 takes only stored Pickings (a new one goes to classic), and those fields are set when a Picking is made. Prod 10-23: all 231 open Pickings have all four | OK |
| Picking Plan pickings (picking_after = Sales Order) | NOT_ELIGIBLE: classic | DIFFERENT ON PURPOSE (not ported) |
| Loading Bay refusal (`code_node_iES7iMKA` 400) | SUBMIT and PREPARE, with classic's texts | OK |
| Size guard (too large for a full GD re-save) | V2 never re-saves a GD. Its own limits: 25 moved GDs / 500 moved-GD lines per confirm; Force Complete 25 GDs / 2,000 lines | DIFFERENT ON PURPOSE |
| Update Picking (`update_node_o19MykBA`), its records | P1 | OK (attributes come from the stored Picking line, not the browser; untouched lines keep their status) |
| GD lines' picking_status / prev_temp_qty_data (`update_node_JXfFIqqv`, classic `iES7iMKA` rules) | P3, the same rules | OK (`temp_qty_data` is not rewritten) |
| Full Picking picked qty (`update_node_MNPicked`, `MNRecompute`) | P3, recounted from every Picking's records | OK (a Completed line is also checked for over-picking: a fix) |
| GD header picking_status (`update_node_GdPickHdr`, B3E0 + rollUpPicking) | P4 | OK |
| Auto Complete GD: GOODS_DELIVERY saved as Completed | NOT_ELIGIBLE: classic | DIFFERENT ON PURPOSE (stage 1e, not built) |
| A move or Loading Bay: GOODS_DELIVERY re-save as Created ("Created from PICKING") | 1c: GD_REPLAN runs that path in-process (GD Edit V2's lifted code); only the moved GDs; writes only the stock (engine), the reservations and the moved lines' allocation | DIFFERENT ON PURPOSE (validated before any write; the cells a full re-save re-stamps are left as they are) |
| Item last_transaction_date (written by that GD re-save) | not written by a 1c move | OK once fa's M1 is fixed: only the date's presence is read (the Item delete guard and the Item form lock), and the GD's own save sets it. Today a V2-created GD's items lack it either way (M1) |
| Auto packing: add / update Packing (`add_node_LcxwYc7z`, `update_node_Mt4SJsF8`) | P5, chunks of ≤ 25 GDs | OK (it counts all this Picking's records, ignores a cancelled Packing; fixes) |
| Unlock (`update_node_y9ZhwG0a`) | P6 | OK |
| Force Complete (classic PICKING_LOOP isForceComplete 1: shrink in PICKING, then a GOODS_DELIVERY re-save per GD) | 1d: one GD Edit V2 job per delivery (classic's Edit path, lifted), then P1 / P4 / P5 | DIFFERENT ON PURPOSE (the user's decisions of 10-20: the SO gets the quantity back, unpicked lines are removed and their reservations released, Packing shows what was picked, rebuilt from the database, atomic until the first delivery commits). Classic remains for Full Picking, Auto Complete GD, Loading Bay, Picking Plan, serial / select picking / internal trading |
| Quantities | rounded to 8 decimals (classic: 3), with no false clamp from float residue | DIFFERENT ON PURPOSE (BUG-023) |

**Not replaced by V2, so still classic:** creating a Picking (Add / convert stamps), cancelling a Picking (the GD / Picking Plan resets), Draft saves, and mobile confirms.

**Open items (35):** none of my own. Cross-reference: fa's M1 (GD Created V2 never writes Item last_transaction_date) also covers the 1c row above.
