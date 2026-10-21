# Item Disassembly V2 - verified facts (read-only, dev, 2026-10-21)

Every fact below was checked by SELECT on dev or by reading the pinned bases in `base/` (MANIFEST.json has the md5s).
The approved plan is `~/.claude/plans/there-s-this-item-dissasembly-binary-sonnet.md` (a copy of its design is in the
workspace brief). Where the plan and this file disagree, ask the controller.

## IDA as it runs today (zhenxiang's module, dev only; not on prod)

- IDA_SAVE `2107305535347552257` enabled **v6** (`base/IDA_SAVE.v6.json`, code bodies in `base/ida_code/<node id>.js`).
  Request `{allData, saveAs, pageStatus}`; response `{code, message, id}`.
- Form `sm_item_disassembly` (table / form id `2106937624568991746`) enabled **v35** (`base/ida_form_v35.json`); line
  sub table `sm_item_disassembly_tlm8ve69_sub` (form table id `2107013922280640514`, display name
  "Stock movement(Item Disassembly)", parent column `sm_item_disassembly_id`); dialog sub `sm_item_disassembly_mw10kf66_sub`.
- List page `2107013669846454273` enabled **v16** (`base/ida_list_v16.json`).
- 7 IDAs on dev, all tenant 000000 (2-4 lines, 1 pick); 12 IDA movement rows, all `uom == base uom`.
- Header columns of note: `item_id` (the item taken apart), `item_qty`, `item_uom`, `issuing_operation_faci` (plant),
  `stock_movement_no` (+ `_type`, -9999 = Manual Input), `item_disassembly_status` (varchar, plain dict key),
  `posted_status`, `temp_qty_data` (source picks, JSON text), `temp_hu_data`, `table_hu`, `item_disassembly_date`,
  `organization_id`, `project_id`, remarks. No `ida_v2_job_id` / `ida_idem_key` yet (the form publish creates them).
- Line columns: `item_selection` (item), `item_name`, `item_desc`, `requested_qty`, `bom_ratio` (null = manual row),
  `total_quantity`, `quantity_uom`, `storage_location_id`, `location_id` (target bin), `batch_number`
  (typed / `Auto-generated batch number` / `-`), `manufacturing_date`, `expired_date`, `item_remark`, `_2`, `_3`,
  `project_id`, `organization_id`, `line_index`, `uom_options`, `issuing_plant`.

### IDA_SAVE v6 flow (node ids)
`code_fillback` (LINE_FIELDS allow-list, q8, number sentinels `draft` / `issued`, `posted_status 'Unposted'` on
Completed) -> `code_required` + `wf_check_required` (CHECK_REQUIRED_FIELD) -> `if_validate` (!Draft):
`code_item_ids` -> `search_items` (Item, equalAny ids) -> `search_batches` (Batch by typed numbers + org) ->
`code_validate` (401 on failure) -> `if_edit_guard` (Edit: `get_persisted_ida` + `code_idem_guard`, 409 when stored
Completed / Fully Posted) -> per-pick loop `wf_check_inventory` (GLOBAL_INVENTORY_VALIDATION, 402) -> `if_persist`
(!Draft): `code_batch_plan` -> loop GENERATE_BATCH per auto line (Redis cache `idaBatches_<key>`) ->
`code_apply_batches` -> `update_ida` + `get_ida` (Edit) / `add_ida` -> `code_persisted` (real number) ->
`code_issue_prep` -> loop `wf_subtract` per pick -> `search_movements` (Inventory Movement: trx_no + movement OUT) ->
`code_cost_alloc` -> loop `wf_add` per line -> `code_hu_unloads` -> loop HANDLING_UNIT -> `code_item_txn` ->
`update_item_txn`; Draft branch: `update_draft` / `add_draft`; `code_doc_id` -> `return_ok`.
- Header written Completed BEFORE stock moves; failure checks are `== '400'` only, so a 401 / other answer continues.
- `wf_subtract` params: plant_id, organization_id, material_id (= header item), quantity (pick sm_quantity),
  material_uom (= `item_uom`), transaction_type `IDA`, trx_no (real number), inventory_category (pick category or
  Unrestricted), location_id, batch_id (or null), manufacturing_date, expired_date, handling_unit_id, doc_date, itemData,
  isMovingInv `'0'`.
- `wf_add` params: plant_id (line issuing_plant || header plant), organization_id, material_id (`item_selection`),
  quantity (`q8(total_quantity)`), material_uom (`quantity_uom`), transaction_type `IDA`, trx_no, inventory_category
  `Unrestricted`, location_id, batch_number (`-` -> `''`), unit_price, doc_date, manufacturing_date, expired_date, remark,
  remark2, remark3, itemData, isMovingInv `'0'`. No batch_id, no parent_trx_no, no handling_unit_id.
- `code_cost_alloc`: issuedValue = sum of `total_price` of `search_movements` rows; share by `q8(total_quantity)` over ALL
  lines in order; `lineValue_i = issuedValue * qty_i / totalQty`, the LAST line takes `remaining`; `unit_price =
  q8(lineValue / qty)` (per LINE unit - the bug the plan fixes: ADD treats unit_price per BASE unit).
- Stale-tab bug: the Draft path has no stored-status guard (`update_draft` writes `item_disassembly_status 'Draft'`
  over a Completed IDA).

## Callees and the engine (pinned bases, unchanged)

- ADD_INVENTORY v65: `unitPrice = q8(unit_price)`, `totalPrice = q8(unitPrice * baseQty)` - per BASE unit; only GRN
  converts. `stock_control 0` -> returns code **401** "Skipping inventory update for item (stock control = 0)"
  (`if_uVK36sgG` -> `return_node_EAFxgDzE`). Batch insert `add_node_F9KqZLfd`, 11 columns: `batch_number, material_id,
  initial_quantity (= baseQty), transaction_no (= trx_no), plant_id, organization_id, remark, remark2, remark3,
  manufacturing_date, expired_date`; it never looks up an existing batch, and inserts a BLANK-number row for `''`
  (non-batch lines: 5 such rows on dev for IDA). Movement row: `movement 'IN'`, quantity / actual_qty = alt qty,
  base_qty / actual_base_qty = base qty, unit_price, total_price, uom_id, base_uom_id, bin, batch_number_id, no remarks.
- `batch` table: only a PRIMARY index (no uniqueness on batch_number); 10,367 rows, 7,054 blank.
- GENERATE_BATCH v20: reads the org's default `batch_number_config` row (item / category null; exactly one, else
  "No default batch found."), branches on `batch_level_selection` (Item / Category / Group override rows, else default;
  Organization Level = default); date from the default row's `date_format` (Document Date / Expired Date /
  Manufacturing Date / Document Created Date, each with its "X is required." refusal); tokens incl. `%Nd` running number;
  duplicate check in the org -> 401 "Duplicate Batch Format found." without advancing; writes `running_number` +
  `last_reset_date` back with NO lock; inserts no Batch row. org = `organization_id ?? global firstLvDeptId`.
- In-memory bulk generator: `tpl/grv2/shared/batchnum.js` `bnNumber(configRows, itemRows, requests, opts)` = what N
  sequential GENERATE_BATCH calls answer (generated by `tpl/grv2/lift/lift_batchnum.py` from v20; checked against
  1,500 recorded numbers). GR V2 uses it in COMMIT C1 (`tpl/grv2/commit/c1_plan.js`, `c1_decide.js`, `c1_check.js`,
  `c1b_*.js`; `tpl/grv2/build_grv2.py`). Run its tests with `TZ=Asia/Kuala_Lumpur`.
- INVENTORY_BULK_APPLY `2109916822821744641` v10 (== `tpl/gdc`-derived copies; see IA CONTRACT): request
  `{operation_key (/^[A-Za-z0-9|:._-]{1,32}$/), mode PLAN|APPLY, organization_id, movements[1..5000]}`; movement_key
  `/^[A-Za-z0-9._-]{1,40}$/` unique (no `|`); NO allow-list on transaction_type / trx_no / key prefix (`'IDA'`,
  `IDC|<19>|I` accepted; transaction_type must be non-null or the price becomes 0); `UNSUPPORTED_NEW_BATCH` only when an
  ADD carries a `batch_number` (not `-`) without `batch_id`; never writes Batch rows; ADD FIFO / WA: `up = q8(unit_price)`
  per base unit, `tp = q8(up * baseQty)`; Fixed Cost uses purchase_unit_price; stock_control 0 -> per-movement `code
  "401"` skip; locks `ITEM|mat|loc`, `BATCH|mat|loc|batch`, `COST|mat|plant` (isMovingInv != 1); claim all-or-nothing
  (409 LOCK_BUSY); results per movement `{movement_key, direction, code, batch_id, unit_price, total_price, ...}`, top
  `{code, result_code, message, results, summary{movements, skipped, ...}}`; 500 = REQUIRES_REVIEW (locks kept); a
  platform 400 without result_code = transient. Writes `operation_effect_key = <op>|<movement_key>` on movements.
- `unit_price_from` copies one earlier movement's price: cannot express a quantity-share allocation -> two operations.
- Lock throughput (memory `project_engine_lock_throughput.md`): ~33 ms per key per TAKE and GIVE on today's slowed dev
  (~5-7 ms before 10-16), ~8 s before each 250-row slice update; IA's 2,000-distinct-key op 1 = 554.7 s (18.2 MB node
  data); GR V2's 2,000-ADD completion = 124 s on 10-15 (pre-slowdown). IDA's op 2 at 2,000 lines = 4,000-6,000 keys.
- Lease: GR V2's job-sized rule = 600 s + 0.6 s per movement, cap 5,400 s (GR_COMPLETE v8 / GR_REVERT v7 entry node).

## Client (form v35 / list v16)

- Buttons (flex `t6y2yh5r`): `button_draft` `pnwvnd3c` -> `iasvdrft` onClick_saveAsDraft; `button_completed` `dxpzlyqp`
  -> `iasvcomp` onClick_saveAsCompleted; `comp_post_button` `lnfr8gna` -> `aymq6q8z` onClick_saveAsCompletedPost;
  `button_post` `tujc2l3o` -> `e9ib2r8i` onClick_post. IDA_SAVE called with `{allData: data, saveAs, pageStatus}`.
- `validateForSave()` (Completed paths) ignores `sm_item_balance.*` and `stock_movement.*.batch_number` errors;
  `confirmBomVariance(data)` = HTML `$confirm` "Recovery Components Differ From The BOM" (cancel ends silently).
- Posting (`postToAccounting`, in `aymq6q8z` and `e9ib2r8i`): `accounting_integration` by org; SQL Accounting V2 /
  AutoCount Accounting V2 -> `posted_status 'Pending Post'` then ACC_PRODUCER `{agent_id, task_type
  "post_item_disassembly", payload [id], priority "0"}`. `e9ib2r8i` does not re-read the stored status.
- `mounted`: status map Draft / Issued / Completed / Fully Posted -> html widgets `draft_status` `ujpqoxyi`,
  `issued_status` `x1z9chx8`, `completed_status` `cgsksd6l`, `fullyposted_status` `7jaqmoww` (flex `2det1nd2`); Edit +
  any status other than Draft / Completed shows Completed + Complete & Post and locks the table (inherited from IA v34).
  `lockComponentsTable()` exists. `page_status` widget `n8hu0kme` (hidden input; clone it for the two new fields).
- Status select `4cjp73ay` (`item_disassembly_status`): system dict `1897577528487428098`, `parent_id
  1914242988707749889`, narrowed to Draft / Issued / Completed / Fully Posted. Dict row `Processing`
  `1914500993831477249` EXISTS (sort 6); IA V2 only appended the filter leaf `{id: 1792170000001, prop: "dict_key",
  value: "Processing"}`.
- Explode `ida_src_item` onChange_idaSourceItem: `fetchByIds("item", ids)` = `.filter([...]).get()` with no `.field()`
  and no `.limit()`; per-row `setOptionData` + `disabled`; source-stock inspection reads balances without limits.
  Client reads: an explicit `.limit()` is honoured up to a 5,000 clamp; the default without `.limit()` is unknown;
  `.field("a,b,table_sub")` prunes the Item subform JOINs (memory `project_lowcode_client_field_projection.md`).
- Stock dialog `evhzkk8e` (js) -> `openDialog("sm_item_balance")` with `source_mode "IDA_SOURCE"`; `5y8a2wfi`
  onConfirm_Stock writes header `item_qty`, `temp_qty_data`, `temp_hu_data`, `stock_summary`, then re-triggers
  `onChange_idaSourceItem` with `{rescale: true, preserveAllocation: true}`.
- List v16: grid `s6wz5vvo` columns incl. hidden `organization_id`; Status badges already include Processing (not Fully
  Posted); Edit hidden only for Pending Post; Delete (`q82pv0wg`) refuses Completed / Fully Posted from GRID values;
  Post (`ee9v0c1h`) from grid values, 1-100 ids (fetch limit); `mounted` empty.
- IA V2 client sources to port: `tpl/iav2/client/src/` (`iaV2_onClick_completed.js`, `iaV2_mounted_block.js`,
  `ia_list_*.js`, `ia_reads.js`), builder `tpl/iav2/client/build_client.py`. Its anchors do NOT all fit IDA (closeDialog
  / postToAccounting pieces); IA's router counts LINE picks (IDA's picks are on the header) and gates on the revert
  switch (IDA has no revert).

## Posting fetch (unchanged; decision 2)
SQL_FETCH_POST_DATA v225 branch POST ITEM DISASSEMBLY: 1-100 unique ids; headers Completed / Fully Posted; every line
`total_quantity > 0`, bin + storage; the source picks of ONE accounting location + batch; serial refused; > 1,000
distinct item / UOM / plant / project / bin / batch ids -> "Too many reference IDs; split the task"; a recovery
`batch_number` of `Auto-generated batch number` or `-` -> refused ("not resolved by the save workflow").

## Test data (dev)
- 711077 (shared with the engine owner's tests - ask before use): 6,056 items (6,048 stock-controlled, none batch-managed),
  6,025 with stock; BOM 2783-000000-00 (830 components; item 2105489115887079441) and 13376648 (829), 13425955 (787)
  each with 100,000 in stock at plant 2105200506810306561 bin 2106278340907413505.
- 000000 org 1123598813738675201 (plant 1123598813738675202): 231 items, 8 batch-managed, 6 auto-batch.

## Namespace (free on dev 2026-10-21)
No `COMPLETE_IDA` job; no `IDA|` / `IDC|` correlation, step job_id or lock owner. Taken: `COMPLETE_IA`, `REVERT_IA`,
`IA|`, `IAC|`, `IAV|`, and the GD / GR / SA / LOT / Putaway / Picking / Packing ones (IA CONTRACT section 1).
