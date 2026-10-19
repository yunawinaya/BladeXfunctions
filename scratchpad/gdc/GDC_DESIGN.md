# GD Completion V2 — build design (dev)

Plan: `~/.claude/plans/buzzing-wiggling-summit.md`. This file is the node-level build reference.

## Authoring

FlowGram JSON via `pkv2tools/wfkit.py` (one designer paste per workflow; a compile-made sql-node never runs).
Later non-SQL edits may go through the CLI. Code bodies live in `gdc/code/<wf>/*.js`; lifted deployed bodies are
copied verbatim from the repo JSON (IDENTICAL to dev) by node id and wrapped as functions.

## Old path facts (verified 2026-10-13, dev = repo JSON)

- GOODS_DELIVERY (2017151544868491265, v240) Completed path: GR gate (408/409/410) → `code_node_shTWK0Nm` (401) →
  setups + `sql_node_ItemFlags` → auto allocation (rows without allocation) → original GD `get_node_xTRvHWB8` →
  `code_node_IyJHrBst` fill-back (400 invalidData; allData, gd_status, picking_status, needCL, needSOCleanUp) →
  `code_pick_reconcile` → CHECK_REQUIRED_FIELD → `code_node_8pN1MyXz` → CREDIT_LIMIT_CHECK (402/403) → picking 405/406
  → packing 407 → `code_node_hb8ZWe9c` + `search_node_SOLine8kQ2` (limit 500) + `code_node_QtyCheckBatch` (400) →
  `code_si_gate` (412) → `code_node_GKc0ALEe` → pre-flight GD_UNUSED_FN_NEW checkOnly → REORDER_SET_REDIS GD_COMPLETED →
  `update_node_elLmtlLm` (111 header cols + whole `table_gd` from `code_node_PkMerge`) → `code_node_Pgtw6zFL` →
  GD_COMPLETION_SNAPSHOT(allData = gdData) → SO lines (`update_node_wEJC3qKB`: delivered_qty, planned_qty,
  outstanding_quantity, line_status) → SO headers (`code_node_lwB2FVe0` → so_status, gd_status, partially_delivered,
  fully_delivered) → GD_UNUSED_FN_NEW → picking header sync → Item last_transaction_date → auto-GR / auto-SI.
- GD_UNUSED_FN_NEW (2032273338771128322, v54): `code_node_SSWylCan` → `sql_node_ItemDatas` → Allocated
  `search_node_r3NiR6B7` (target_gd_id, org, plant, status Allocated, **limit 1000**) + Pending `search_node_QdY1FLLA`
  (plant, org, Pending, doc_type not GD/PP, material in, parent_line_id in, **limit 1000**) → `code_node_eOMvMZOj` →
  `code_node_b71wypDJ` (1,888 lines; repo .js is BEHIND) → `code_node_QrF4F4Hx` → writes in parallel:
  on_reserved_gd update (11 cols) / add (26 cols, doc_id = target_gd_id, reserved_date = doc_date, plant/org params);
  movement loop; picking records (Branch 4); HU atomic decrements (Branch 5).
- Movement switch → engine movements (order = list order; pair = SUBTRACT then ADD):
  | movement_type | engine |
  |---|---|
  | DELIVERY | SUBTRACT `source` category, isMovingInv 0 |
  | UNRESTRICTED_TO_RESERVED | SUBTRACT Unrestricted (1) + ADD Reserved (1) `unit_price_from` + dates from the SUBTRACT |
  | RESERVED_SUBTRACT_CROSS_BIN | SUBTRACT Reserved (1) |
  | RESERVED_ADD_CROSS_BIN | ADD Reserved (1), no unit_price |
  | RESERVED_TO_UNRESTRICTED (default) | SUBTRACT Reserved (1) + ADD Unrestricted (1) `unit_price_from` + dates |
  Every call: plant/org = GD's, transaction_type `GDL`, trx_no = delivery_no, parent_trx_no = line_so_no,
  doc_date = delivery_date, material_uom, location_id = bin_location, batch_id, handling_unit_id.
- Branch 4 (non-PP, Completed): picking record `delivered_qty += stamp` (stamps = temp_qty_data[].picking_record_id),
  record + header delivery_status; header rows for every `line_to_id` picking.
- Branch 5: per huUpdates: `handling_unit.total_quantity -= deliver_quantity` (by id) and
  `handling_unit_atu7sreg_sub.quantity -=` (handling_unit_id + material_id + batch_id).
- Line/SO bundles: subform rows with `parent_id`; platform reads nest them as `children` (GD `table_gd`, SO `table_so`).
- get-node shape (recorded `get_node_xTRvHWB8`): ids strings, DECIMAL numbers, INT numbers, JSON parsed, NULL keys
  absent, datetime `YYYY-MM-DD HH:MM:SS` (create_time/update_time `.mmm`).
- Indexes: gd_publish_step UNIQUE (tenant, job_id, step_name); gd_async_job UNIQUE (tenant, org, idempotency_key);
  **none** on inventory_movement.operation_effect_key or on_reserved_gd.target_gd_id (prod 296k / 75k rows: add
  both before any prod rollout).

## Node-data budget

GD V2 hit the 64 MB cap at 2,922 lines. Rule: the lifted GOODS_DELIVERY / GD_UNUSED_FN_NEW bodies run as functions
inside ONE plan code node; only SQL rows go in and one compact plan comes out.

## Workflows

### GD_COMPLETE_PREPARE (job_id)
guard → job SQL → entry (COMPLETE_GD, VALIDATING, live lease) → parallel SQL reads keyed by gd_id (header, lines,
Allocated + Pending on_reserved_gd, items (ItemDatas + ItemFlags), SO lines + SO headers' lines, picking/packing setup,
pickings + records of `line_to_id`, HU + HU lines of the allocations) → `code_node_GCplan` (adapter → allData →
lifted chain → movements, reservation writes, SO targets, picking/HU targets, GD diff, after-step inputs) →
INVENTORY_BULK_APPLY PLAN → `code_node_GCready` → READY_TO_COMMIT + prepared_payload | FAILED + GD back to Created.

### GD_COMPLETE_COMMIT (job_id)
C0 revalidate → C1 snapshot → C2 inventory (APPLY `GDC|<job>`, first write) → SPLIT → C3 reservations → C3H HU → C4 SO
(fresh read, delta, intent) → C4P a Force Complete's Picking rows (status only) → C5 GD (diff) → C6 item date, reorder,
auto-SI → COMPLETED.

### GD_COMPLETE_WORKER — copy of PICKING_ASYNC_WORKER (command COMPLETE_GD; unlock = GD Processing → Created)

### GD_COMPLETE_SUBMIT — gates in GOODS_DELIVERY order + gate row + job QUEUED + GD Processing; STATUS
