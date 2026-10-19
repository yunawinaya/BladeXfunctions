# SM V2 / LOT - verified references (2026-10-16, SELECT-only on dev and prod)

Every id below was read from `su_code_workflow` / `su_code_workflow_history` / `su_code_tables` / `su_code_pages(_history)`
on DEV (`.dbtools/db --dev`) and cross-checked on PROD (`--prod`). "same md5" = byte-identical `script_json` / `form_json`.
Machine-readable copy: `scratchpad/smv2/ids.json`. Re-pull the snapshots with `python3 base/snapshot.py` (`--check` = compare only).

## Workflows

| Name | id | DEV enabled | PROD enabled | Use in V2 |
|---|---|---|---|---|
| SM_LOCATION_TRANSFER (classic LOT save) | 2013133675374927874 | v82, md5 48690c5886be1917615d1133aeadcaac (designing v83 = same md5) | v67, **same md5** | base of the guarded classic; source of every lifted body |
| SUBTRACT_INVENTORY | 2012096660219564034 | v59, md5 a6b5a04125b9ebacd63596239f3ad3b7 | v58, md5 4ab79c01b5c04296f9f530b0ee773aad (**differs**) | called by classic only; parity reference (E) |
| ADD_INVENTORY | 2012005532688723970 | v65, md5 5fcf78a1a39eff466033c381513d5527 | v65, same md5 | called by classic only; parity reference (E) |
| GLOBAL_INVENTORY_VALIDATION | 2056291728334573570 | v11, md5 248c9eb105a5a69d3334fd0a997f2424 | v11, same md5 | its WA "no costing record" text is SUBMIT's STOP message (`base/GLOBAL_INVENTORY_VALIDATION.v11.json`, `code_node_hDa6pSw5`) |
| CHECK_REQUIRED_FIELD | 1988831880511062018 | v8, md5 c3c37c0e255bb39851347b527f7a8199 | v8, same md5 | lifted in SUBMIT (`code_node_AeSdXE85`); `base/CHECK_REQUIRED_FIELD.v8.json` = `scratchpad/pwv2/lift/src/CHECK_REQUIRED_FIELD.v8.json` (same md5) |
| INVENTORY_BULK_APPLY (the engine) | 2109916822821744641 | v7, md5 cf6ba1fb737d3ca9f9d5213844b33d5c | **absent** (ships with the full deployment) | COMMIT L1, called unchanged. v7 == repo `Balance Table/INVENTORY_BULK_APPLY.json` node for node; its `code_node_IBguard` == `scratchpad/gdc/iba/code/guard.js` |
| INVENTORY_LOCK_TOKENS | 2105936479113383937 | v4, md5 65c09474fceb6b15470194fdc888e675 | **absent** | not called by LOT (the engine takes its own locks) |
| HANDLING_UNIT | 2037062451509002241 | v38 | v36, same md5 | classic only (HU rows are not eligible for V2) |
| GLOBAL_ALLOCATION | 2032298961937842178 | v34 | v34, same md5 | classic only (rows needing auto-allocation are not eligible) |
| LOT_V2_SUBMIT / _WORKER / _PREPARE / _COMMIT | "0" | not created yet (the user makes the shells: Save Workflow / Stock Movement) | - | ids go into `scratchpad/smv2/ids.json` and `Stock Movement/Location Transfer/AsyncV2/ids.json` |

v82 calls (workflow-node sources, verified in `base/SM_LOCATION_TRANSFER.v82.json`): SUBTRACT_INVENTORY (`workflow_node_LOT{main,recon,cancel}Sub`),
ADD_INVENTORY (`..Add`), GLOBAL_INVENTORY_VALIDATION (`workflow_node_LOTprecheckChk`), CHECK_REQUIRED_FIELD (`workflow_node_AMO4jf5Z`),
HANDLING_UNIT (`workflow_node_vVPX9VI7`), GLOBAL_ALLOCATION (`workflow_node_LOTallocRun`). The prod hotfix snapshot
`prod-hotfix/2026-10-08-bug-register/SM_LOCATION_TRANSFER.PROD.json` has the same 219 nodes, the same 27 code bodies and the
same node data as dev v82 (`base/MANIFEST.json`).

## Tables (`su_code_tables.id`, "Display:Table:<id>" in workflow JSON)

| Display name | id | Physical table | DEV | PROD |
|---|---|---|---|---|
| GD Async Job | 2104845286495150081 | gd_async_job | yes; unique `Idempotency Key` (tenant_id, organization_id, idempotency_key) | **table absent** |
| GD Publish Step | 2105131615547461634 | gd_publish_step | yes; unique `Job Step` (tenant_id, job_id, step_name); job_id / step_name varchar(32), step_status varchar(16), result_ref longtext | **table absent** |
| In Transit Detail | 2080477944160923650 | in_transit_detail | yes, has `job_line_key` varchar(255) | yes, **no `job_line_key`** |
| Item | 1901546842240438273 | item | yes | yes |
| Location Transfer | 2013791389687349250 | sm_location_transfer | yes; unique `Document Number` (stock_movement_no, organization_id); no `lot_v2_job_id` / `lot_idem_key` yet | yes |
| Stock Movement Table(Location Transfer) | 2013831779991814146 | sm_location_transfer_d2c7o1jd_sub (fk `sm_location_transfer_id`; `line_index` is varchar) | yes | yes |
| Serial Number Records(Location Transfer) | 2013831780214112257 | sm_location_transfer_jw9bqcxo_sub | yes | - |
| Balance Index(Location Transfer) | 2013831780675485698 | sm_location_transfer_371v7gdf_sub | yes | - |
| Table Select Balance(Location Transfer) | 2048649591312293890 | sm_location_transfer_5l7cgknd_sub | yes | - |
| Bin Location | 1902282127538507778 | bin_location (`bin_location_combine` = the bin's code) | yes | - |
| Weighted Average Costing History | 1902948453171433474 | wa_costing_method (plant-keyed) | yes | - |
| FIFO Costing History | 1902947165008400386 | fifo_costing_history | yes | - |

Full column lists (name, type, nullable, default) and the unique indexes: `base/columns.json`.

## Form and list page

| What | DEV live | PROD live | Snapshot |
|---|---|---|---|
| LOT form (table 2013791389687349250) | v107, su_code_tables_history 2105236667519897601, md5 f39c5369d4e9c2202adb92cf93be669b (= su_code_tables.form_json) | v47, md5 0708eacda4c1d557839b91faf7c4f2df | `base/lot_form_v107.json` (+ `lot_schema_header.json`, `lot_schema_lines.json` = current schema_json) |
| LOT list page 2013863255693197313 | v47, su_code_pages_history 2109477145172230146, md5 0591082ab9bec10388151639009aec16 | v44, md5 5c8a11d63a0deedc56259951a9683c57 | `base/lot_list_v47.json` |
| list page DESIGNING row | v48, 2109832002601205762 (2026-10-13 10:22), md5 816e13b6268344817fe5879cb76091fa - **differs from v47** | - | `base/lot_list_v48_designing.json` (NOT live) |

v48 designing vs v47 (sorted-key diff): only the list's custom **Print** button gained designer-default display attributes
(`btnIcon ""`, `dialog_top ""`, `disabled ""`, `eventsPrint []`, `hidden ""`, `segmented_fzl86zm3 "center"`, `styleType "Link"`).
No handler, column or filter changed. Someone opened / re-saved the Print button in the designer; not resolved here.
The list's `bulkCancel_LOT` handler (event key `d1og3odt`) in v47 is byte-identical to the repo's
`Bulk Actions/Warehouse Management/Location Transfer/Cancel.js`.

## Engine request (INVENTORY_BULK_APPLY v7)

request_json: `operation_key` (string, 1-32 of `A-Za-z0-9|:._-`), `mode` (PLAN | APPLY), `organization_id` (digits),
`movements` (array, 1-5,000); response_json: `code` ("200" / "400" / "409" / "500"), `result_code`, `message`, `results`,
`summary`. A 400 names the failing movement: `"<message> (movement <movement_key>)"`; a 409 is `LOCK_BUSY` ("Another operation
took a lock before this one could"). Engine-owned step rows live under `gd_publish_step.job_id = <operation_key>`:
`IBA|I|<nnn>` (intent), `IBA|DONE` (replayed answer), `IBA|REVIEW`.

## Namespace check (dev, 2026-10-16)

No `gd_async_job` row has command SAVE_LOT or a `LOT|` correlation; no `gd_publish_step.job_id` starts with `SMLT|`.
In use by others: commands COMPLETE_GD, EDIT_GD, COMPLETE_GR, REVERT_GR, COMPLETE_PUTAWAY, CONFIRM_PICKING, COMPLETE_PACKING,
CREATE_GD_FROM_FORM; step job_id prefixes GDC|, GDE|, GRC|, GRV|, PWC|, GRPO|, IBATEST, IBAPREC and bare job ids.
