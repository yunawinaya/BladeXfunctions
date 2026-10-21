# RES01 - How stock reservations work today (facts for IA raw-material holds)

Researched 2026-10-21 (about 09:30-11:00 MYT), read-only. Nothing was written, published or minted.
Sources: the ENABLED version (`su_code_workflow_history` / `su_code_tables_history` / `su_code_pages_history`,
`status='enabled'`, highest version) on DEV, DEV and PROD SELECTs through `.dbtools/db`, the repo, and the mobile repo
`~/Developer/sudu-mobile-expo` (HEAD c1042412, 2026-10-20). The Oct-13 decompiled mirror was used only to find names;
it is a week stale, so no claim rests on it.

Labels: **V** = verified this session in the live JSON or in DB rows; **P** = verified this session by a parallel read of
the live JSON (same sources), key points re-checked by me where marked **P+**; **N** = from memory notes, not re-verified;
**U** = unverified / open.

Workflow ids are the same on dev and prod (checked for 7 of them); version numbers are not comparable across environments.

---

## Q1. The `on_reserved_gd` table

### Columns (physical, dev) - V
`information_schema.columns`, dev:

| Column | Type | Meaning (form title / use) |
|---|---|---|
| id | bigint PK | |
| doc_type | varchar(255) | Static select, **enum in the schema**: Good Delivery, Location Transfer, Picking Plan, Sales Order, Production, Miscellaneous Issue, Plant Transfer (dev AND prod `su_code_tables.schema_json`). No "Item Assembly". |
| status | varchar(255) | Free text input. Values in use: Allocated, Pending, Delivered, Cancelled, Processing (V2 hidden rows), NULL (legacy prod rows). |
| parent_id / parent_no / parent_line_id | varchar | The SO (header id, number, SO line id). Pending rows are found through `parent_line_id`. |
| doc_id / doc_no / doc_line_id | varchar | The consuming document and its line (GD, PP, MSI, PT; PDR for Production rows). Cleared to "" on a Pending row. |
| target_gd_id | varchar | The GD (or PP header id for "Picking Plan" rows; the hidden GD for V2 Processing rows) the row is allocated to. Null/"" on Pending and released rows. |
| source_reserved_id | varchar | Chain back to the row a split came from (`record.source_reserved_id \|\| record.id`). |
| material_id, item_code, item_name, item_desc | | |
| batch_id bigint, bin_location bigint, handling_unit_id varchar | | The physical source. `handling_unit_id` set = HU-level hold. |
| item_uom bigint | | Unit the three quantities are counted in = the document line's order UOM (comment in GD_UNUSED_FN_NEW Batch Process). |
| reserved_qty, delivered_qty, open_qty | decimal(65,8) | Schema: `minimum: 0`, precision 8, numberRule "Inventory Qty" (so negatives and float residue crash the write). |
| reserved_date timestamp, line_no int, plant_id bigint, organization_id varchar, remark text | | |
| from_category varchar | | Category the held stock came from (MSI / PT holds; "" on many GD rows). Exists on dev AND prod. |
| job_line_key varchar | | V2 idempotency key (`<job>\|<line>\|<seq>`, `<job>\|C\|<n>`). **Dev only - prod has no such column.** |
| sub_tenant_id, create_*, update_*, is_deleted, tenant_id | | platform columns |

Logical DDL: `model/On Reserved Goods Delivery.sql` in the mirror (same columns; DECIMAL(18,8) logical).

### Indexes - V
- DEV: PRIMARY(id), plus five `idx_mp_*` indexes (tenant/org/is_deleted/status/doc_type/open_qty, one led by material_id) that are all **`Visible = NO`** (invisible, the optimizer does not use them). They look like they were added for the not-yet-live "SO Material Planning Reservation Read" workflow (2111008794300514305: its enabled version is empty, only a `designing` draft has content).
- PROD: PRIMARY(id) only.
- So every reader filtering by material / bin / status / parent_line_id scans the table (dev ~33k rows, prod ~87k).

### Row counts - V (2026-10-21 ~10:30)
DEV, live rows (is_deleted = 0):

| doc_type | Allocated | Pending | Delivered | Cancelled |
|---|---|---|---|---|
| Good Delivery | 10,006 | - | 11,143 | 10,191 |
| Picking Plan | 249 | - | 51 | 64 |
| Sales Order | 38 | 36 | 13 | 6 |
| Production | 1 | 6 | - | 1 |
| Miscellaneous Issue | 1 | - | - | - |
| (NULL) | 4 | - | - | - |

DEV deleted rows: 1,255 Good Delivery rows with status **Processing** (V2 hidden rows soft-deleted on a clean failure).
26,045 of the live Good Delivery rows carry `job_line_key` (V2 test runs).

PROD (all rows; one full scan of the table, 0.36 s):

| doc_type | status | live | deleted |
|---|---|---|---|
| Good Delivery | Allocated | 15,373 | 24 |
| Good Delivery | Delivered | 50,492 | 6 |
| Good Delivery | Cancelled | 11,400 | 13 |
| Good Delivery | NULL | 1,208 (1,124 with open_qty > 0; created 2025-08-07 .. 2026-02-25, 3 orgs) | 342 |
| Picking Plan | Allocated / Delivered / Cancelled | 301 / 7,601 / 431 | 2 / 2 / 0 |

PROD has **no** Sales Order, Production, Miscellaneous Issue, Plant Transfer or Location Transfer rows, and no Pending rows at all.
The NULL-status rows are legacy; every status-filtered reader ignores them.

### What the three quantities mean - V
Invariants hold on every live dev row (checked per doc_type/status):
- **Allocated / Pending**: `open_qty = reserved_qty`, `delivered_qty = 0`. The row still holds stock.
- **Delivered**: `open_qty = 0`, `delivered_qty = reserved_qty`.
- **Cancelled**: `open_qty = 0`, `delivered_qty = 0`, `reserved_qty` kept as history (the released amount).
- A row is never partly delivered: a partial delivery or partial release **splits** the row (one row closed for the part,
  a new row for the rest, `source_reserved_id` = the old row). `open_qty` is what readers sum.

### Life of a row (GD and PP; classic GD_UNUSED_FN_NEW Batch Process `code_node_b71wypDJ`) - V
V2 jobs emulate this same planner (GD_EDIT/CANCEL/COMPLETE PREPARE run the classic chain and write its
`reservedRecordUpdates / reservedRecordCreates`), so the semantics are the same.

| Event | What happens to on_reserved_gd | Stock bucket |
|---|---|---|
| GD/PP save as Created, new line or qty up (`processCreatedAllocation` -> `allocateFromPending`) | First take this SO line's **Pending Production**, then **Pending Sales Order** rows (status -> Allocated in place for the first consumer, a new Allocated row for later ones, the unused rest re-created as Pending). The remainder: a **new Allocated row** doc_type "Good Delivery" / "Picking Plan", `target_gd_id` = the doc. | Pending part: none (already in Reserved). New part: `UNRESTRICTED_TO_RESERVED`. |
| Qty down (`netChange < 0`) | Release in order GD/PP first, then SO, then Production (`releaseOrderPriority`). GD/PP-sourced part: row Cancelled (or reduced + a Cancelled split row). SO/Production-sourced part: back to **Pending** (merged into an existing Pending row of the same SO line, or a new Pending row with `doc_id/doc_no/doc_line_id = ""`, `target_gd_id = null`). | GD/PP part: `RESERVED_TO_UNRESTRICTED`; SO/Production part stays Reserved. |
| Line/bin/batch/HU removed (`cleanupOrphanedAllocations`, only rows with `target_gd_id = this doc`) | Same as a full release. | same |
| Packing / loading-bay bin or HU change (`detectBinHuMigrations`, saveAs Created + isPacking/isLoadingBay) | Old row reduced/Cancelled, new Allocated row at the new bin/HU (lineage kept). | `RESERVED_SUBTRACT_CROSS_BIN` + `RESERVED_ADD_CROSS_BIN` (Reserved to Reserved, no Unrestricted step) |
| GD Completed (`processDeliveredAllocation`) | Matched Allocated rows -> **Delivered** (`delivered = open`). Over-pick excess (`temp_excess_data`) and any un-delivered rest: GD rows -> new Cancelled split; PP rows -> new **Allocated** split (stays with the PP); SO/Production -> Pending. More delivered than allocated: take Pending Production/SO (as Delivered rows), the rest straight from Unrestricted (no row). PP rows delivered by a GD get `doc_type` flipped to "Good Delivery" and re-pointed to the GD. | `DELIVERY` subtract from **Reserved** (own rows) and/or Unrestricted; releases as above |
| GD Cancelled | `quantity = 0` through the release path. | `RESERVED_TO_UNRESTRICTED` |
| PP force complete (PP-direct, isGDPP=1 + Completed) | Release path down to the picked qty (picked part stays Allocated for a later GD). | release only, no OUT |
| GDPP Created ("middle state") | Skipped entirely (no rows, no movement). | none |
| Revert Completed GD (GD_PROCESS_REVERT 2058820005398224897 v13) | Restores the rows captured by GD_COMPLETION_SNAPSHOT (2058818938677665794 v14, `pre_on_reserved_gd_ids`): `update_node_inReservedRevert`, `update_node_inFragSoftDel`, `update_node_inPendingRestore`. | its own movements |

GD Created V2 (GD_BULK_COMMIT 2104840402446245890 v17) adds a status the classic save never uses: rows are inserted as
**Processing** (hidden, `target_gd_id` = the hidden GD, `job_line_key`; `add_node_sHg3g3FK`), the engine moves the stock,
then `update_node_wrLMUmAK` "P7B: on_reserved_gd.status Processing -> Allocated". On a clean failure the hidden rows are
soft-deleted (`update_node_F93Rh797` / `QkUzLFED` / `9l5YSfc9` / `mDFfdR3d`).

### Is there a Production / MES / Item Assembly doc_type today? - V
- **"Production"** exists but means **finished goods** from an MES Production Receipt, reserved for the SO line of the
  MES production order. Writer: SM_PROD_RECEIPT (2015626478058602498 v44) `workflow_node_Pj3tsLOu` -> GLOBAL_RESERVED
  (2016050452018102274 v57), Pending + Production branch: `workflow_node_bvHNt6Ve` ADD_INVENTORY **into Reserved,
  isMovingInv 0** (a real receipt straight into the Reserved bucket), then `add_node_FMva4OAM` (status Pending,
  `parent_line_id` = MES order's `order_item_id`, doc_no = PDR number). The mapping `code_node_jYUUKJ3t` sends
  `batch_number`, but GLOBAL_RESERVED reads `batch_id`, so these rows carry no batch. SM_PROD_RECEIPT is called by
  PRODUCTION_REPORTING (2013152639840772097 v54) and the Production Receipt form. Dev: 8 rows; prod: 0 rows and 0 PDRs.
- **MES raw materials are not reserved.** PRODUCTION_REPORTING calls GLOBAL_ALLOCATION only to check stock for the BACK
  and AUX consume types, issues through "Create GI" (SM_GOODS_ISSUE), and reads on_reserved_gd only for **Cancelled** rows
  of the SO line (`search_node_PnpN3ofa`, `search_node_RpBEEC93`) when computing actual quantities.
- **"Location Transfer"** = a legacy production-order staging hold written by client code (`updateOnReservedTable`) in the
  legacy Stock Movement form (bound) and in unbound copies in the Location Transfer / Plant Transfer / Category Transfer
  forms, closed by the legacy Production Order form. 0 rows ever on dev or prod; `production_order` has 0 live rows on
  both. Dead in practice (see Q2).
- **No "Item Assembly" doc_type.** None of the 10 IA workflows references on_reserved_gd (0 occurrences in IA_SAVE v15,
  IA_REVERT v5, IA_V2_* , IA_REVERT_V2_*). The IA form only READS it in its pickers.
- Adding one: the memory note `project_stock_picking` says `doc_type` is **platform-enum-constrained** ("Miscellaneous
  Issue and Plant Transfer had to be added by hand in the designer"). The enum is in `schema_json` on dev and prod (V);
  that a write with an unlisted value is rejected is **N** (not tested here).

---

## Q2. Every writer of `on_reserved_gd`

Found by searching every ENABLED workflow / form / page on dev for `on_reserved_gd`, the display name
"On Reserved Goods Delivery" and the table id 1935880014687440897 (38 workflows, 15 forms, 6 pages), then classifying
each node (add / update / delete / search / sql) - V.

### Live server writers

| Workflow (id, dev v) | Writes (node ids) | Caller | Stock move |
|---|---|---|---|
| **GD_UNUSED_FN_NEW** (2032273338771128322, v55; prod v50) - the classic GD/PP reservation engine | `update_node_7k2yYMLH` (updates), `add_node_ojy0rTgC` (creates); reads Allocated by `target_gd_id` (`search_node_r3NiR6B7`, PP: `search_node_NxFJeRXS` `contains`) and Pending (`search_node_QdY1FLLA`) | GOODS_DELIVERY (2017151544868491265 v245): pre-flight `workflow_node_PreflightChk01` (checkOnly 1) then `workflow_node_hRMvSe8u`; PICKING_PLAN (2021431201147527170 v66, isGDPP 1) | loop `loop_88bcQyIz` -> SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW (Q3) |
| **GLOBAL_RESERVED** (2016050452018102274, v57) | branches by `status`: Pending (+doc_type SO: `add_node_fSjLz3x9`; Production: `add_node_FMva4OAM`), Allocated, Delivered, CancelAllocated (`update_node_TlZctBXD`, `KRU7doPX`, `OxqqnkIy`, `add_node_RimiRQTB`, `178Q7f9M`) | WO_SAVE (2018537490593169410 v32) from the "Convert Work Order" page (2017122760962363394 v59, opened from the Sales Order list page and Cash Sales page): Pending SO rows; SM_PROD_RECEIPT: Pending Production rows | SO Pending: SUBTRACT_INVENTORY Unrestricted + ADD_INVENTORY Reserved (both isMovingInv 1). The row is added **before** the stock moves. |
| GLOBAL_RESERVED_NEW (2031988369985323010, v2) | copy of the above | **no callers** (workflow, form or page) - dead | |
| **CANCEL_PENDING** (2021394283638693889, v4) | `update_node_dUapLqNU` (row -> Cancelled, `reserved_qty` = released), `add_node_PYa646qV` (new Pending for the rest) | "Release Stock" dialog page (2020773188905684994 v10), opened from the "Reserve List" page (2020760844007854081 v16) row action, **visible only when `row.status === 'Pending'`**, permission `reserve_release` | SUBTRACT Reserved + ADD Unrestricted (isMovingInv 1). Its update node's WHERE references `code_node_xtldYT5d`, a node that does not exist in this workflow (U: effect) |
| **SM_MISC_ISSUE** (2015602242971631618, v39; prod v38 has it) - MSI "Created" hold | `search_node_MSIresOpen`, `code_node_MSIresCompute`, `add_node_MSIresCreate`, `update_node_MSIresClose` (all under `if_MSIcreated`) | MSI save as Created | Idempotent rebuild on every Created save: release every open hold Reserved -> `from_category`, then re-reserve each pick `category` -> Reserved in place (SUBTRACT/ADD isMovingInv 1); rows doc_type "Miscellaneous Issue", status **Allocated**, `from_category`, `target_gd_id ""` |
| **SM_PLANT_TRANSFER** (2025864403783462913, v104; prod v61 has it) - PT "Created" hold | `add_node_PTresCreate`, `update_node_PTresClose`, `update_node_PTissResClose` | PT save as Created / Issued | Same rebuild; on Issued from Created (`code_node_PTissCompute`) every held row -> Delivered with `delivered = delivered + open`, while the issue subtracts **Reserved** per current pick |
| GD_BULK_COMMIT (2104840402446245890, v17) - GD Created V2 | see Q1 (Processing rows, P7B, soft-delete on failure) | GD_ASYNC_SUBMIT / worker | INVENTORY_APPLY_OPERATION OUT Unrestricted / IN Reserved + `RESERVATION\|<id>` verify effects |
| GD_EDIT_COMMIT (2110618866011787266, v9) | `update_node_GXe3write`, `add_node_GXe3add` (E3) | GD Edit V2 | INVENTORY_BULK_APPLY |
| GD_CANCEL_COMMIT (2112455779051212802, v3) | `update_node_XCx3write`, `add_node_XCx3add` (X3) | GD Cancel V2 | INVENTORY_BULK_APPLY |
| GD_COMPLETE_COMMIT (2110182729927753730, v9) | `update_node_CCc3write`, `add_node_CCc3add` (C3), after the engine phase C2 | GD Completed V2 | INVENTORY_BULK_APPLY |
| PACKING_BULK_COMMIT (2109924671239589890, v7) | `update_node_KCp2upd`, `add_node_KCp2add` (P2: reservation moved to the HU's bin) | Packing V2 | INVENTORY_APPLY_OPERATION |
| PICKING_BULK_COMMIT (2109531367339180034, v11) | `update_node_PCpm2write`, `add_node_PCpm2add` (PM2) | Picking V2 | INVENTORY_BULK_APPLY |
| GD_PROCESS_REVERT (2058820005398224897, v13) | 3 update nodes (Q1) | Revert Completed GD | |
| GD_BULK_TEST_CLEANUP (2105585498635800578, v5) | `delete_node_T5gUXWDB` (soft delete) | test runs, organization 0 only | |

V2 writers write rows only while the row still holds what PREPARE read (`code_node_CCc3plan`: compare `RES_COLS` before/after,
anything else -> REQUIRES_REVIEW) and create each new row once (`job_line_key <job>|C|<n>`) - V.

Readers only (no writes): GLOBAL_ALLOCATION (2032298961937842178 v34), GD_STOCK_CHECK (2105663605526925314 v3),
GD_ASYNC_SUBMIT v12, GD_BULK_PREPARE v17, GD_EDIT/CANCEL/COMPLETE PREPARE and SUBMIT, GD_REPLAN v4, SO_AUTO_GD v20,
PACKING_ASYNC_SUBMIT v5, PACKING_BULK_PREPARE v6, LOT_V2_PREPARE v7, PUTAWAY* (comments only), INVENTORY_APPLY_OPERATION
(verify read `sql_node_GfLGxjTi`), INVENTORY_OPERATION_RECONCILE v11, PRODUCTION_REPORTING, GD_COMPLETION_SNAPSHOT,
the sqlview `on_reserve_list` (plain SELECT over on_reserved_gd + bin + dept; "Reserve List" page) - V.

### Client-side writers (forms, pages, mobile)
Event bindings were checked (`"events": {"onClick": "<eventScript key>"}`): a handler whose key appears only in its own
definition is not bound to any component - V.

| Where | Handler | Bound? | Status |
|---|---|---|---|
| GD form v1483 | `onClick_creditLimit` (key e5v7cseq): legacy client save that adds/updates/soft-deletes rows | no | dead |
| GD list page v398 | `onClick_yes` (njrl37ug): legacy cancel, writes `item_balance` reserved -> unrestricted directly and soft-deletes rows | no | dead |
| PP form v156 | `onClick_save_as_completed` (145p4b81), `onClick_creditLimit` | no | dead |
| Picking list page v221 | `ForceCompletePickingPP` (et5ibrmt) | no | dead |
| Packing v205, Transfer Order Picking v437 | `onClick_savePPComplete` (jgudk6gh): updates `bin_location` | no | dead |
| Plant Transfer v116, Category Transfer v18 | `onClick_completed(_posted)` copies with `updateOnReservedTable` (doc_type "Location Transfer") | no | dead |
| Location Transfer v111 | `onClick_completed_posted` (opst8ztv) -> `updateOnReservedTable` (doc_type "Location Transfer") | no | dead |
| Stock Movement v964 (legacy combined form) | `onClick_completed`, `onClick_completed_posted` -> `updateOnReservedTable` when `movementType === "Location Transfer" && is_production_order === 1` | yes | unused: 0 such rows ever; last prod stock_movement row 2026-02-28 |
| Production Order v430 (legacy) | `onClick_complete` updates `delivered_qty/open_qty/doc_no` | yes | unused: production_order empty on dev and prod |
| Mobile (`goods_delivery.utils.ts`) | `createOnReserveGoodsDeliveryBatch`, `updateOnReserveGoodsDeliveryBatch`, `updateOnReserveGoodsDeliveryForCompleted`, `cleanupReservedGoods` | their callers `handleCreatedStatus` / `handleCompletedStatus` have no callers; mobile cancel runs the GD workflow (`cancelGoodsDelivery` -> `runGDWorkflow`) | dead (by grep of callers) |

So every **live** write goes through the server workflows above.

### Order rules - V
- Allocate: **Production -> Sales Order -> Good Delivery/Picking Plan (from Unrestricted)** (`allocateOrderPriority`,
  `allocateFromPending`; GLOBAL_ALLOCATION's own `allocateFromPending` also sorts Production first).
- Release: **Good Delivery/Picking Plan -> Sales Order -> Production** (`releaseOrderPriority` = 1 / 2 / 3).
- New Pending rows from a split or release: `doc_id = doc_no = doc_line_id = ""`, `target_gd_id = null`,
  `source_reserved_id = record.source_reserved_id || record.id`; merged into an existing Pending row of the same doc_type
  and SO line when one exists.
- Pending rows are only consumed for the same `parent_line_id` when the GD line has an SO line; SO/Production Pending rows
  only match loose picks (HU = null).

---

## Q3. Stock buckets and who moves them

### Columns - V
- `item_balance` (per material + bin + plant): `unrestricted_qty`, `reserved_qty`, `block_qty`, `qualityinsp_qty`,
  `intransit_qty`, `balance_quantity` (all decimal(65,8)), `material_uom`.
- `item_batch_balance` (per material + bin + batch + plant): the same six + batch dates/remarks. For batch items
  SUBTRACT/ADD update the batch row **and** the bin aggregate in `item_balance` (SUBTRACT_INVENTORY: `update_node_1ggwRzMs`
  under `if_0FIiDnWC`, then `update_node_q6uzhWpP` always).
- `item_serial_balance`: the same buckets, decimal(65,3).
- Handling units: `handling_unit.total_quantity` and the item rows `handling_unit_atu7sreg_sub.quantity` (one quantity,
  **no category buckets**, plus `balance_id`, `line_status`). HU stock is also counted inside `item_balance` of its bin.
- Category -> column map, identical in SUBTRACT_INVENTORY v59 (`code_node_TC1cqaOy`), SUBTRACT_INVENTORY_NEW,
  INVENTORY_BULK_APPLY (`CATEGORY_FIELD`): Unrestricted -> unrestricted_qty, **Reserved -> reserved_qty**, Blocked ->
  block_qty, Quality Inspection -> qualityinsp_qty, In Transit -> intransit_qty.

### Yes, allocation moves Unrestricted -> Reserved (for loose and HU picks alike) - V
| Movement | Classic (GD_UNUSED_FN_NEW nodes) | V2 (GD_EDIT/CANCEL/COMPLETE PREPARE -> INVENTORY_BULK_APPLY) |
|---|---|---|
| UNRESTRICTED_TO_RESERVED | `workflow_node_HAjj58tI` SUBTRACT_INVENTORY_NEW (2031973476128071681) Unrestricted, isMovingInv 1 + `workflow_node_REo8MaTY` ADD_INVENTORY_NEW (2031995315136184322) Reserved, isMovingInv 1 | SUBTRACT Unrestricted isMovingInv 1 + ADD Reserved isMovingInv 1, `unit_price_from` the subtract |
| RESERVED_TO_UNRESTRICTED (release) | `workflow_node_a8ATdTVz` Reserved + `workflow_node_ERaEukF3` Unrestricted | SUBTRACT Reserved + ADD Unrestricted |
| DELIVERY (consume) | `workflow_node_2TTLyQHx` SUBTRACT category = `movement.source` ("Reserved" for the GD's own rows, "Unrestricted" for the rest), **isMovingInv 0** (real OUT with costing) | SUBTRACT `inventory_category: m.source`, isMovingInv 0 |
| RESERVED_*_CROSS_BIN | `workflow_node_ZoW4REqy` / `workflow_node_xYoIyC1J`, Reserved, isMovingInv 1 | SUBTRACT / ADD Reserved, isMovingInv 1 |

- GD Created V2 uses the older engine INVENTORY_APPLY_OPERATION (2105133980371554305 v10): effects OUT `stock_status
  Unrestricted` / IN `stock_status Reserved` per ITEM/BATCH key, plus a verify-only `RESERVATION|<on_reserved_gd id>` IN
  effect per hidden row.
- GLOBAL_RESERVED (SO Pending), CANCEL_PENDING, the MSI/PT holds use classic SUBTRACT_INVENTORY (2012096660219564034) +
  ADD_INVENTORY (2012005532688723970) with isMovingInv 1.
- Each pair writes two `inventory_movement` rows. Example: dev GD/20261021/105 has pairs "GDL OUT Unrestricted 24 / IN
  Reserved 24" at bin 2046110651955724289, with its four on_reserved_gd rows written ~0.2 s **before** the movements
  (the add node and the movement loop sit in parallel branches of `condition_all_6v3Hmb18`).
- **HU quantities do not move on allocation**: only `item_balance` buckets change. The HU item `quantity` is decremented
  only at GD completion (`atomic_count_node_9GwpVap5` `quantity minus(deliver_quantity)`, `atomic_count_node_MtBduaPJ`
  `total_quantity minus(...)`). An HU-level hold therefore exists only as an on_reserved_gd row with `handling_unit_id`.
- The memory note `project_gd_alloc_hu_fixes` (N) and the GD code comments say a packed HU's qty "lives in
  item_balance.reserved_qty"; the GD dialog and GD save skip packed HUs (`if (hu.packing_id) continue;`, verified in
  GOODS_DELIVERY v245).

### Consumption and release
- Consumers take reserved stock by passing **category "Reserved"** to SUBTRACT (GD delivery sized by its own matched
  rows' `open_qty`; MSI/PT completing from Created: `inventory_category = "Reserved"` when the stored status is Created,
  `code_node_SXZuEFWW`, `code_node_PTissCompute`) - V.
- Release: Reserved -> Unrestricted (or -> `from_category` for MSI/PT), with the row Cancelled or turned back to Pending - V.

---

## Q4. Consumers (pickers and server writers)

### Pickers read only `unrestricted_qty` (plus `block_qty` where Blocked is offered) - P, P+ on the lines marked
| Consumer | Pool | on_reserved_gd overlay | HU handling |
|---|---|---|---|
| GD inventory dialog (goods_delivery v1483 `onClickInventory`) | With an SO line: unrestricted + (this SO line's Pending + this GD's own Allocated rows, only when the GD is Created). Without: unrestricted only (validator comment "Without SO: only check unrestricted (reserved belongs to other documents)", P+) | "Never include other GDs' Allocated records" (P+) | skips packed HUs unless the line's own; subtracts other GDs' Allocated HU rows - but the filter `(r.batch_id \|\| "") === huItem.batch_id \|\| ""` is false for a NULL-batch HU item (precedence bug, P+), so for non-batch items other GDs' HU holds are probably not subtracted (display only; U whether the client gets null) |
| GLOBAL_ALLOCATION (2032298961937842178 v34; GD dialog, GOODS_DELIVERY, SO_CASCADE, SM_LOCATION_TRANSFER, SM_GOODS_ISSUE, PRODUCTION_REPORTING) | unrestricted, inflated by `min(reserved_qty, claimable)` where claimable = **all Pending rows of this SO line and material** (`search_node_BOywHct7`: no doc_type filter, V) + this GD's own loose Allocated rows (`search_node_OwnReserved01`); inflation only when `includeReservedQty = 1` or Pending rows exist (V) | Pending consumed Production first | HU holds fetched by `search_node_WGl1NGSu` **only inside `IF isPending` (`if_xWXCj_YZ`)** (V): with isPending 0 other documents' HU holds are not subtracted |
| GD save (GOODS_DELIVERY v245 `code_node_Htpcyp8t`) | via GLOBAL_ALLOCATION with `isPending: currentRow.soLineItemId ? 1 : 0`, `includeReservedQty: (gd_status === "Created" \|\| isGDPP === 1) ? 1 : 0` (V) | | skips packed HUs |
| LOT dialog (sm_location_transfer v111) | Unrestricted or Blocked (dictionary filter, V) | Allocated, open > 0; loose rows not subtracted ("unrestricted_qty is already net of all loose Allocated reservations", V) | **whole HU hidden** if any Allocated row names it (V) |
| LOT server allocation (SM_LOCATION_TRANSFER v85) | GLOBAL_ALLOCATION `isPending: 0, includeReservedQty: 0, huData: []` (V) | none | none |
| Plant Transfer dialog (v116) | Unrestricted or Blocked | Allocated | whole-HU exclusion (V) |
| MSI dialog (v90) | Unrestricted only (V) | Allocated only; "Pending records already moved their qty ... subtracting them again would double-deduct" | partial: `huReservedMap[hu\|batch]` subtracted per HU item |
| IA dialog (sm_item_assembly v42) | **Unrestricted only** (`dict_key equal Unrestricted`, V); rows kept only if unrestricted > 0 or block > 0 | Allocated only (same as MSI, V) | partial (same as MSI); HU picks forced to category Unrestricted; no `packing_id` check (V: 0 matches) |
| IA auto-pick helpers (same form) and mobile IA (`iaAllocationCore.ts`, reuses MSI `StockSelectionModal`) | unrestricted - HU-held (net of Allocated HU rows) | Allocated HU rows only | |
| Picking Plan dialog (v156) | unrestricted; this SO line's Pending (Production first) | Pending by `parent_line_id` | none |
| Stock Picking (v7) | reads no balances | | |
| Sales Invoice (SI_SAVE v83) | **moves no stock** | | |
| Disposal/Scrap (v16), Goods Issue (v15) | **all 5 categories incl. Reserved** (no dictionary filter) | none | dev 2 / 41 rows, prod 0 / 0 |
| Category Transfer, Stock Adjustment, Purchase Return | CT: Unrestricted/Blocked; SA, PRT: `notEqual Reserved, In Transit, Quality Inspection` | | |

### Server writers do not check who owns reserved stock - V
- SUBTRACT_INVENTORY v59, SUBTRACT_INVENTORY_NEW v25, ADD_INVENTORY v65, INVENTORY_BULK_APPLY v10,
  GLOBAL_INVENTORY_VALIDATION v11, IA_SAVE v15, IA_V2_*, HANDLING_UNIT v38: **0 references to on_reserved_gd**.
- SUBTRACT_INVENTORY refuses only when the **requested bucket** at that bin/batch is short (`if_1rlS6mFL`,
  `currentCategoryQty = q8(existingBalance[categoryField])`), never falls back to another bucket.
- INVENTORY_BULK_APPLY plan: `if (q8(existing[categoryField] || 0) < u.baseQty) return fail(m, "INSUFFICIENT", ...)`,
  also refuses duplicate balance rows (`DUPLICATE_BALANCE`).
- INVENTORY_APPLY_OPERATION: a RESERVATION effect "is verify-only and IN only (D-4): the caller wrote the reservation row;
  releasing or consuming one is not implemented"; it checks the row is `Processing`, `target_gd_id` = the operation's
  source document, **no handling unit**, `reserved = open`, `delivered = 0`, and that an IN Reserved effect exists at that
  bin (`iao_reval` lines 265-298). An OUT on the Reserved bucket is not tied to any row.
- Ownership is enforced **only by on_reserved_gd bookkeeping inside each caller** (GD sizes its Reserved subtract from its
  own rows; MSI/PT from their own picks) and by which categories each client picker offers.

### Bookkeeping vs bucket drift - V
Pairs (material, bin, plant) of non-batch items whose open rows (Allocated/Pending/Processing) are all in the base UOM:
- DEV: 1,361 pairs: 1,246 equal, **108 with reserved_qty < sum(open_qty)**, 7 greater; 101 pairs have duplicate
  `item_balance` rows; 3 balance rows hold reserved stock with no open row.
- PROD (excluding legacy NULL-status rows): 1,087 pairs: 1,028 equal, **29 lower, 30 higher**; **55 `item_balance` rows
  hold 7,188.95 reserved units with no open row at all**.
- Stranded hold example (dev): MSI/202609080080 is Fully Posted, its row 2097173687037661186 is still Allocated, open 10,
  from_category Unrestricted; its only movements are OUT Unrestricted 10 / IN Reserved 10 - the issue never drew Reserved
  (cause U). The MSI completion path never closes hold rows (all MSI row writes sit under `if_MSIcreated`).

---

## Q5. Concurrency

### What prevents two documents from reserving the same free stock
- **Classic path: nothing atomic** - V.
  - SUBTRACT_INVENTORY / ADD_INVENTORY read the balance row (get-node), check the bucket, then write all six quantities
    as **absolute values** computed from that read (`update_node_q6uzhWpP` props `unrestricted_qty = {{code_node_mQnskse9.data.unrestrictedQty}}`
    etc.; ADD_INVENTORY `update_node_gJbvuAjp` the same). Two concurrent saves can both pass and the later write wins
    (lost update). No lock, mutex or atomic node on balance rows in GOODS_DELIVERY, GD_UNUSED_FN_NEW (its only
    atomic-count nodes decrement HU quantities at delivery), GLOBAL_RESERVED, SM_MISC_ISSUE or IA_SAVE (their cache nodes
    are loop indices; IA_SAVE has only a stored-status guard, `sql_node_IAguard`).
  - GOODS_DELIVERY runs a read-only pre-flight (`workflow_node_PreflightChk01`, `code_node_ChkSuff01`: checks the net
    Unrestricted need; "Reserved-category subtracts are backed by this GD's own existing reservation and are intentionally
    NOT checked") - a check-then-act window, not a lock.
  - Document-level guards only: `sql_node_GdProcGuard` (stored GD status), `sql_node_GdSoGuard` ("unfinished background
    save of these sales orders").
  - Classic rows and stock moves are not atomic either: GLOBAL_RESERVED adds the Pending row before SUBTRACT/ADD; GD_UNUSED_FN_NEW
    writes rows and runs the movement loop in parallel branches.
- **V2 paths: engine locks** - V.
  - INVENTORY_BULK_APPLY (2109916822821744641 v10) on APPLY: seed missing lock rows (INVENTORY_LOCK_SEED 2111078356478234625
    v5, add-node in try/catch), claim (409 LOCK_BUSY if another operation holds a key), TAKE every key through
    INVENTORY_LOCK_TOKENS (2105936479113383937 v5), verify, read balances **under the locks**, plan (INSUFFICIENT),
    record intent rows (`gd_publish_step` `IBA|I|nnn`), write balances in slices of 250, GIVE.
    Keys: `ITEM|<mat>|<bin>`, `BATCH|<mat>|<bin>|<batch>`, `COST|<mat>|<plant>` when isMovingInv != 1 (`code_node_IBguard`).
    A replayed operation_key returns the stored answer.
  - INVENTORY_APPLY_OPERATION also locks `RESERVATION|<id>` keys (dev `inventory_balance_lock`: 18,970 RESERVATION, 9,234
    ITEM, 344 BATCH, 3,788 COST, 81 GATE rows).
  - **Classic writers never take these tokens**, so engine locks protect only engine callers from each other; classic and
    V2 race the same balance rows (memory `project_engine_cost_row_race` says the same, N).
- Client pickers hold nothing in the DB: staged picks live in line temp JSON until the save.

### Lock primitives a new low-code writer could reuse - V
1. **INVENTORY_BULK_APPLY** with category moves (SUBTRACT `Unrestricted` isMovingInv 1 + ADD `Reserved` isMovingInv 1,
   `unit_price_from`), exactly as GD Edit/Cancel/Complete V2 do: row locks, re-read under lock, all-or-nothing plan,
   replay by operation_key. Cost: about 0.28 s per distinct pick on the slowed dev, 70% of it token TAKE/GIVE (memory
   `project_ia_v2`, `project_engine_lock_throughput`, N). It writes no on_reserved_gd rows: the caller writes them
   (V2 pattern: idempotent creates by `job_line_key`, compare-before-write updates).
2. **INVENTORY_APPLY_OPERATION RESERVATION effects**: only for a Processing row whose `target_gd_id` is the operation's
   source document, IN only, no HU - shaped for GD Created V2.
3. **`gd_publish_step`** unique key `Job Step (tenant_id, job_id, step_name)`: document mutex rows `LOCK|<n>` (dev: GDC 70,
   SMLT 35, GRC 27, PWC 17, IAC 14, SAC 5, SCR 2) and once-only step rows (P0..P7 STARTED / DONE). IA V2 already uses
   `IAC|<ia_id>` / `LOCK|<n+1>` (`add_node_ISlock`: "a concurrent twin fails its run").
4. **`gd_async_job`** unique `Idempotency Key (tenant_id, organization_id, idempotency_key)` + lease columns.
5. **atomic-count-node** (platform atomic plus/minus with an insufficiency error): INVENTORY_LOCK_TOKENS takes a token with
   `free_token minus(1)` + owner in one node and gives it back with `plus(1)`; GD delivery decrements HU quantities with it.
   The memory note `project_bug_register_hotfix_2026_10_08` calls it "the only atomic primitive found in prod" (N).

---

## Q6. Item Assembly completion today (P, key points P+)

- **Statuses written**: Draft, Processing (V2 job holds the IA), Completed, Fully Posted (accounting). Data: dev Completed 20 /
  Draft 8; prod Completed 19 / Fully Posted 59 / Draft 2 (V). No Created/Issued status with a stock effect exists; the only
  pre-stock status is Draft.
- **Draft stores the picks, holds nothing**: dev 2,841 of 2,844 Draft lines carry `temp_qty_data`, prod 9 of 9 (V).
- **Actions**: Save as Draft, Completed (V2 router `iaV2_onClick_completed`, classic fallback), Complete & Post, Post; list
  page: Delete = **client-side soft delete** of header + both subforms, refused for Completed / Fully Posted / Processing
  (`AsyncV2/iaList_delete.js` lines 15, 68, 89, V), Revert Completed (IA_REVERT, or IA_REVERT_V2 above 50 rows). **No Cancel,
  no short completion**: `code_validate` requires `total_quantity` = sum of `sm_quantity` within 0.0005 (V).
- **Classic IA_SAVE (2098335576774463489 v15)**: header written Completed **before** the issue loop (non-atomic; a failure
  mid-way leaves a Completed IA with some components issued) (P). One SUBTRACT_INVENTORY per pick (`wf_subtract`):
  transaction_type "IA", `inventory_category: pick.category || 'Unrestricted'` (V), location, batch, `quantity = sm_quantity`
  in the line UOM, mfg/expiry dates, `handling_unit_id` (stamp only), isMovingInv 0 (real OUT + costing), no serial (P).
  Pre-check per pick through GLOBAL_INVENTORY_VALIDATION with the same category (P). Receipt: ADD_INVENTORY into the header
  category, which must be Unrestricted or Blocked (V). HU picks: one HANDLING_UNIT "unload" per HU (P).
  **A pick with category "Reserved" would be issued from reserved_qty with no owner check** (SUBTRACT accepts it, V).
- **IA_REVERT (2099319746652852225 v5)**: components come back IN (`workflow_node_iaRvAdd`, isMovingInv 0) with
  `inventory_category: S(r.inventory_category) || "Unrestricted"` read from the IA's OUT movement = the category they were
  taken from (V); does not touch on_reserved_gd (V).
- **IA V2** (SUBMIT 2112141238600376321 v5, PREPARE 2112141312130719745 v3, COMMIT 2112141346016501762 v4, WORKER
  2112141277456408577 v3): only for a new / stored-Draft IA with more than 50 picks, no HU, no serial (P).
  `IA_OK_CATEGORIES = ["Unrestricted", "Blocked"]` in SUBMIT, re-checked in PREPARE (`IA_OK_CATEGORIES.indexOf(mv.inventory_category) < 0
  -> failed(...)`, V): a Reserved pick is NOT_ELIGIBLE and falls back to classic (cap 250 picks). Two INVENTORY_BULK_APPLY
  operations per job: `IAC|<job>|I` (SUBTRACT per pick, isMovingInv 0, `handling_unit_id null`) and `IAC|<job>|R` (ADD,
  priced from the stored OUT rows + assembly_cost) (P). Locks: document `IAC|<ia>` / `LOCK|<n>`; job `gd_async_job`
  COMPLETE_IA, `correlation_id IA|<ia>`; worker lease 10 min, COMMIT lease 30 min; engine tokens ITEM/BATCH/COST (P).
- **Pick shape** (`sm_item_assembly_tlm8ve69_sub.temp_qty_data`, JSON string) - V on real rows:
  - most common key set (dev 3,233 / prod 93): `balance_id, balance_quantity, batch_id, category, expired_date, is_deleted,
    location_id, manufacturing_date, material_id, organization_id, plant_id, sm_quantity, storage_location_id, unrestricted_qty`;
  - older dialog shapes on prod (67 + 13 entries) carry the whole balance row (`block_qty, reserved_qty, qualityinsp_qty,
    intransit_qty, material_uom, fm_key, create_*`, ...) and **no `balance_id`**;
  - no entry on dev (3,245) or prod (185) has a `handling_unit_id`; every entry's category is **Unrestricted**.
  - The server reads `sm_quantity, location_id, batch_id, category, manufacturing_date, expired_date, handling_unit_id`
    (+ `storage_location_id, material_id, balance_id` for HU unloads) (P).

---

## Q7. What would double-count (or under-protect) if IA holds moved stock to Reserved AND wrote rows

Pickers assume `unrestricted_qty` is already net of **loose Allocated** holds and add back only Pending rows of the line's SO
line. Consequences, each tied to the code above:

1. **Loose hold + loose Allocated row: no double count.** No picker subtracts loose Allocated rows again (MSI, IA, LOT, PT
   comments and filters; GD only adds its own). A loose row alone (no bucket move) would protect nothing.
2. **HU hold without an HU-tagged Allocated row double-deducts.** The MSI/IA dialogs compute loose = unrestricted -
   (HU qty - Allocated HU rows). If the bucket moved but no row carries `handling_unit_id`, loose is reduced twice and the
   HU tab still offers the held qty. With the row, LOT/PT hide the whole HU (over-protect), GLOBAL_ALLOCATION ignores it
   when `isPending = 0` (GD lines without an SO line, LOT server allocation) and the GD dialog may ignore it for NULL-batch
   HU items.
3. **Status "Pending" would be claimed by others.** GLOBAL_ALLOCATION's claimable pool and the GD/PP dialogs' SO overlay take
   **every** Pending row with the SO line's `parent_line_id` (no doc_type filter in `search_node_BOywHct7`);
   GD_UNUSED_FN_NEW fetches Pending rows of any doc_type except GD/PP (`search_node_QdY1FLLA`); GD_STOCK_CHECK and the GD V2
   PREPAREs read Pending rows of SO lines; the Reserve List shows a Release button for any Pending row and CANCEL_PENDING
   releases by id without checking doc_type.
4. **The IA's own picker would hide its own hold.** The IA dialog keeps rows with unrestricted > 0 or block > 0 and merges
   staged picks with `...tempItem` (the stale `unrestricted_qty` snapshot stored in the pick), so after a hold its own
   held rows show stale availability, and rows with no snapshot vanish (re-confirm could drop picks; same class as the
   packed-HU "own HU hidden" fix in `project_gd_alloc_hu_fixes`) (V code read; behaviour with holds U).
5. **Completing from Unrestricted while holding Reserved strands the hold** (today's IA_SAVE / IA V2 default to the pick's
   category, which is Unrestricted). Completing from Reserved without closing rows strands rows (MSI/202609080080).
6. **Revert after a Reserved-sourced completion** returns components to Reserved (IA_REVERT uses the pick category) with no
   row behind it -> orphan reserved stock (prod already has 55 such balance rows).
7. **Trusting reserved_qty = own rows fails on drifted data** (29-108 under-reserved pairs per environment): a consumer that
   subtracts its own open qty from Reserved can fail "Insufficient", or succeed by eating another document's Reserved.
8. **UOM**: row quantities are in the line UOM (`item_uom`), consumers convert with `table_uom_conversion.base_qty`; the
   MSI-copied IA auto-pick helpers subtract `open_qty` **without** UOM conversion (P), the dialogs convert it.

---

## Constraints for an IA-owned hold (what must be true for a safe design)

1. Loose holds must move the qty from the pick's category to **Reserved** at the exact material / bin / batch (that is what
   hides loose stock from every picker); a row alone does not protect anything.
2. Hold rows must use status **"Allocated"** (never "Pending"), carry `doc_id/doc_no/doc_line_id` = the IA, and must not put
   an SO line in `parent_line_id` or a GD/PP id in `target_gd_id` (keeps them out of every Pending / target_gd_id reader).
3. `doc_type` needs a new enum value (e.g. "Item Assembly") added to the on_reserved_gd form on dev **and** prod before any
   write; record `from_category` so a release restores Blocked picks to Blocked.
4. HU picks: either refuse holds on HU picks or write HU-tagged Allocated rows and accept LOT/PT whole-HU hiding and the
   GLOBAL_ALLOCATION `isPending = 0` gap. No IA pick on dev or prod uses an HU today; IA V2 and the engine's RESERVATION
   effect do not support HU.
5. Every terminal path must close the IA's own rows and move the stock: complete -> Delivered + issue from Reserved;
   partial / short completion -> Delivered for the used part, Reserved -> from_category for the rest (Cancelled split);
   Draft delete (today a client-side soft delete) and any cancel -> release; quantity / BOM edits -> rebuild (MSI pattern:
   release all + re-reserve) or a delta.
6. Completion must issue the held qty from **Reserved** (both classic IA_SAVE and IA V2; V2 needs Reserved added to
   `IA_OK_CATEGORIES` in SUBMIT and PREPARE or holds released first), and IA_REVERT must not re-create Reserved stock
   without a row.
7. Placement must not lose updates against concurrent writers of the same balance row. Classic SUBTRACT/ADD cannot give
   that (read-check-absolute-write, no lock); the only existing primitive that does is the engine's token lock
   (INVENTORY_BULK_APPLY category moves: lock, re-read, INSUFFICIENT), and even it is bypassed by classic writers. Two saves of
   the same IA must not both place holds (existing document mutex: `gd_publish_step` `IAC|<ia>` / `LOCK|<n>`), and a
   retried save must not create rows twice (existing patterns: `job_line_key`, compare-before-write).
8. Row and stock writes must not be able to diverge on a failure (the classic GD and GLOBAL_RESERVED paths can: rows are
   written before or beside the stock move). The only existing precedent that cannot is GD Created V2: rows written as
   "Processing" (ignored by every reader), stock moved, rows published as Allocated, soft-deleted on a clean failure.
9. Consumption must check both its own open rows and the Reserved bucket and stop on a shortfall (drift exists in both
   environments).
10. The IA picker (web and mobile `iaAllocationCore.ts`) must add the IA's own hold back when the dialog reopens.
11. Quantities: q8 / toFixed strings, clamp >= 0 (`minimum: 0`), store in the line UOM with `item_uom`; key holds on
    material + bin + batch, not `balance_id` (older picks have none).
12. Prod has no `job_line_key` column on on_reserved_gd and no V2 engine workflows yet (INVENTORY_BULK_APPLY,
    INVENTORY_APPLY_OPERATION, IA_V2_SUBMIT absent from prod's enabled list) - both arrive only with the dev->prod promotion.

## Open questions

1. Is the doc_type enum enforced on add/update nodes (memory says yes; not tested read-only)?
2. Where in the IA life should the hold be placed: at Draft save (the only pre-stock status) or at a new "Created"-like
   status? Draft IAs today store picks without holding them (dev 2,841 lines).
3. Should Disposal/Scrap and Goods Issue (which offer the Reserved category and check no owner) be blocked from Reserved
   stock that belongs to an IA? (0 rows on prod today.)
4. Stock Count / Stock Adjustment variance posting on a bin that holds Reserved stock was not examined.
5. Cause of the dev MSI stranded hold (MSI/202609080080) and of the drift counts (race vs bug) was not investigated.
6. What CANCEL_PENDING's update node does with a WHERE that references a missing node (`code_node_xtldYT5d`).
7. Mobile: the mobile IA saves through the same IA_SAVE (`src/constants/workflowNamespace.ts:41`, V), so server-side hold
   logic in IA_SAVE would cover it; its picker (`iaAllocationCore.ts`, `useIAInventoryDialog.ts`) applies the web rule and
   would need the same own-hold add-back. Not checked: whether any mobile build sends picks with a category other than
   Unrestricted.
8. Throughput: holds through the engine cost about 0.28 s per distinct pick on the slowed dev (N); an 830-pick BOM would need
   minutes per hold rebuild.
