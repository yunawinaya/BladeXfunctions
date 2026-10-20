# GD Cancel V2: hand-off (prepared 2026-10-20 by bladexfunctions-e1, the Picking V2 / GD Edit V2 session)

**Decision (user, 2026-10-20):** cancelling a Goods Delivery gets a V2 background path.

- **Owner:** handed to the **GD Completed & Created V2** session, while e1 builds Picking Force Complete V2 (stage 1d).
- **Size target: 2,000-line GDs.** Today's prod sizes are small only because the high-volume client is not live yet, so
  they say nothing about the load V2 is for.

All ids and line numbers below were read on 2026-10-20. Check them against the DEPLOYED dev versions before relying on
them: the repo is often behind.

## 1. What runs today (classic only)

### Entry points

**GD list, bulk Cancel:** `Bulk Actions/Sales & Distribution/Goods Delivery/CancelWorkflow.js`.

- Takes Created GDs only (`:34-35`).
- **Per GD, one after another:**
  - reads the record (`db.collection("goods_delivery").doc(id).get()`);
  - calls GOODS_DELIVERY `2017151544868491265` with `{allData, saveAs: "Cancelled", pageStatus: "Edit"}` (`:1-12`,
    `:75`). It is one synchronous run per GD.
- **Then, client-side, after a 200:**
  - **Pickings:** for each Picking whose `gd_no` holds this GD it marks this GD's rows `line_status` Cancelled,
    including bundle children (`:146-160`). When every row is Cancelled, the Picking becomes `to_status` Cancelled and its
    `to_id` gets "-Cancelled" (`:162-180`).
    - Completed and Cancelled Pickings are skipped (`:134-139`).
    - GDPP (`is_select_picking = 1`) is skipped (`:117`).
  - **Movements:** `inventory_movement` rows with `trx_no` = delivery_no get "-Cancelled" appended (`:185-193`).

**Row action:** `Goods Delivery/GDcancelAlert.js`.

- Refuses unless gd_status is Created.
- Refuses a GD whose picking_status is In Progress or Completed.
- Then the same cancel.

**Not a document cancel:** `GD_ASYNC_CANCEL` (2105663419715063810) cancels a pre-commit V2 *save job*. It has no caller:
its buttons were removed in v1448 (`Goods Delivery/AsyncV2/README.md:93`).

### GOODS_DELIVERY's cancel path

As of the 10-19 notes this is dev v245. Nodes that branch on Cancelled:

- `code_node_IyJHrBst` (fillbackHeaderFields): builds the header from allData and has a Cancelled-from-Completed branch.
- `if_H2b1nRMW` (zero qty) and `if_WDczQjqt` (auto picking mode) skip their parts for Cancelled; so does `if_ACsN1GZD`
  ("IF !Cancelled").
- `code_node_QtyCheckBatch` updates the SO table. `code_node_lwB2FVe0` sets the SO header status.
  `code_node_8pN1MyXz` rolls up picking status when picking is required and the GD is Cancelled.
- **The release chain:** GD_UNUSED_FN_NEW → INVENTORY_APPLY_OPERATION. It releases reservations GD → SO → Production
  (the reverse of allocation) and moves Reserved → Unrestricted.
- **Reorder:** `if_ReorderCancelled` → `workflow_node_ReorderCancelled` (REORDER_SET_REDIS).
- **Result:** the GD's `delivery_no` gets "-Cancelled" (seen on dev and prod rows).

### Cost and usage

- **Dev, 2026-10-02, tenant 496474:** a 499-line cancel (run 2105960993361408002) took 605 s in GOODS_DELIVERY:
  GD_UNUSED_FN_NEW 571 s, INVENTORY_APPLY_OPERATION 98 s. That was before the dev slowdown; dev has been 2-7x slower
  since 10-16.
- **Prod, last 90 days:** 502 GDs cancelled, 237 of them in the last 30 days.
  - By tenant: 900938 192, 035843 115, 128671 89, 681409 41, ...
  - Lines per GD: median 2, p95 15, max 82.
  - NOT the target size (see the top).
- **Shape oracle:** the request of run 2105960993361408002 is what the client sends.
  - 42 header keys. These are lists: so_id, sales_person, assigned_to, pp_id, table_item_balance, table_insufficient.
  - 41 keys per line.

## 2. What V2 has to do

1. **Size:** 2,000 lines per GD, set-based. No per-line child workflows.
2. **Release, the same end state as classic:**
   - reservations GD → SO → Production: GD-origin rows Cancelled; SO- and Production-origin rows back to Pending, merged
     as classic merges them;
   - Reserved → Unrestricted through INVENTORY_BULK_APPLY;
   - SO planned_qty and statuses, the GD header Cancelled and the "-Cancelled" numbering, all as classic writes them.
3. **Pickings:** the client-side follow-ups move server-side:
   - rows Cancelled, and the Picking Cancelled when all its rows are;
   - GDPP skipped; Completed and Cancelled Pickings untouched, unless the user decides otherwise (§6).
4. **Also:** the `inventory_movement` trx_no suffix, and the reorder Redis update.
5. **Entry points:** both the list bulk Cancel and the row Cancel. Ask sudu-mobile-expo-52 whether the app cancels GDs.
6. **Parity:** twins against classic on dev (snapshot + diff), as for GD Completed V2.

## 3. Interplay with work e1 owns: coordinate before touching

**GD Edit V2** (`Goods Delivery/EditV2/*`, `scratchpad/gde/**`):

- e1 is changing its SUBMIT / PREPARE / WORKER for Picking Force Complete V2 (source PICKING_FC).
- **Do not edit those files.**
- Its planner already releases GD → SO → Production and gives the SO its quantity back, set-based. If you want that,
  call it through its SUBMIT contract or ask e1 first.
  - Note: today it refuses a GD left with no stock line, so "remove every line" is not a cancel without a change.

**A cancel must answer BUSY while any of these is open on the GD:**

- the `GDC|<gd>` lock (`gd_publish_step`) or gd_status Processing;
- an open EDIT_GD, COMPLETE_GD or CREATE_GD_FROM_FORM job;
- an open CONFIRM_PICKING job (Picking V2) on a Picking that names the GD. From 1d this includes operation FORCE_COMPLETE,
  whose EDIT_GD holds carry cascade_ref `PKFC|<job>`;
- a fresh Picking lock (`transfer_order.is_processing`).

**PICKING_LOOP** (dev v88) has the double-Picking coverage guard. 1d will make it honour open CONFIRM_PICKING jobs.

## 4. Test data

Dev 496474 has 8 staged GDs the user said to ignore ("dev meant for testing"). They are free to use as cancel cases:

- **GD/20261020/084:** 500 lines; its Picking PI-20261020-0081 is Completed.
- **GD/085 to GD/087:** batch 2. GD/085's stock was moved Reserved → Reserved into the loading-bay bin LB001-R1.
- **GD/088 to GD/091:** Pickings PI-20261020-0085 to 0088 and Packings PACK/20261020/0042 to 0044. PI-0088 is In
  Progress, with line 2 unpicked.

**Read-only snapshot / diff tool:** `scratchpad/pkdup/mobile/release_snap.py before|after|diff`. It covers the GDs, lines,
reservations, SO lines, Pickings, Packings, balances and movements of those 8; copy and widen it for your own cases.

## 5. Rules (as every V2 session)

- **Dev only;** prod is SELECT-only.
- **Every publish, dev DB write and live test needs the user's yes.**
  - Back up by workflow id first. A name can collide with a folder on macOS: "PICKING" vs `Picking/`.
  - Publish through a base-guarded `wf_upload` plan; `wf --dev deployed` must say IDENTICAL after.
- **Fetch DEPLOYED before editing;** run `scratchpad/validate.py` on every changed JSON. Invoke the
  `authoring-lowcode-workflows` and `avoiding-bladex-data-traps` skills.
- **Keep dev shippable:** the full deployment promotes dev wholesale.
- **Size every classic path at 2,000 lines,** never by today's prod sizes.

## 6. Questions to settle with the user first

1. **Row Cancel:** keep its refusal for GDs whose picking is In Progress or Completed (the bulk path allows them), or
   align the two?
2. **The GD's Completed Picking, and its Packing:** classic leaves them as they are. Keep that, or cancel or flag them?
3. **Timing:** design now and build on dev after the cut?
4. **Mobile:** does the app cancel GDs, and so need the V2 contract too?
