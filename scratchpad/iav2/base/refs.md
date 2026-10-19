# Item Assembly V2 - verified references (WP0, 2026-10-19, read-only `.dbtools/db`)

New file next to the snapshots; no snapshot was changed (`python3 base/snapshot.py --check` -> ok, run three times between 14:50 and 15:40).

## Namespace (dev)
`SELECT COUNT(*) FROM gd_async_job WHERE command = 'COMPLETE_IA'` -> 0; `... WHERE correlation_id LIKE 'IA|%'` -> 0;
`SELECT COUNT(*) FROM gd_publish_step WHERE job_id LIKE 'IAC|%'` -> 0. No `su_code_workflow` named `IA_V2_%` (dev, prod).

## Workflows
`SELECT CAST(w.id AS CHAR), w.name, w.is_deleted, (SELECT MAX(h.version_number) FROM su_code_workflow_history h WHERE h.data_id = w.id AND h.status = 'enabled') FROM su_code_workflow w WHERE w.id IN (...)`

| Name | id | dev enabled | prod enabled |
|---|---|---|---|
| IA_SAVE | 2098335576774463489 | 11 | 11 |
| IA_REVERT | 2099319746652852225 | 4 | 4 |
| GENERATE_BATCH | 2060178784435535873 | 20 | 20 |
| CHECK_REQUIRED_FIELD | 1988831880511062018 | 8 | 8 |
| GLOBAL_INVENTORY_VALIDATION | 2056291728334573570 | 11 | 11 |
| INVENTORY_BULK_APPLY | 2109916822821744641 | 10 | absent |
| INVENTORY_LOCK_TOKENS | 2105936479113383937 | 5 | absent |
| INVENTORY_LOCK_SEED | 2111078356478234625 | 5 | absent |
| ADD_INVENTORY | 2012005532688723970 | 65 | 65 |
| SUBTRACT_INVENTORY | 2012096660219564034 | 59 | 58 |
| HANDLING_UNIT | 2037062451509002241 | 38 | 36 |
| ACC_PRODUCER | 2013511169625042946 | 119 | 68 |
| SQL_FETCH_POST_DATA | 2018512118312943617 | 218 | 178 |

IA_SAVE / IA_REVERT live in folder_id 2098308285411414018 (dev, prod). IDA_SAVE 2107305535347552257 (Item Disassembly) exists on dev only.

## Tables
`SELECT CAST(id AS CHAR), name, table_name, actual_table_name, is_deleted FROM su_code_tables WHERE id IN (...)` (dev; prod has all but the 3 V2 tables)

| Physical | id | display name |
|---|---|---|
| sm_item_assembly | 2098256587713404929 | Item Assembly |
| sm_item_assembly_tlm8ve69_sub | 2098269596661833730 | Stock movement(Item Assembly) |
| Item (`item` in SQL) | 1901546842240438273 | Item |
| inventory_movement | 1902259348776800257 | Inventory Movement |
| batch | 1902719754154655746 | Batch |
| batch_number_config | 2058765580973846530 | Batch Number Configuration |
| item_balance / item_batch_balance | 1902698977724317697 / 1902718803880558594 | Item Balance / Item Batch Balance |
| fifo_costing_history / wa_costing_method | 1902947165008400386 / 1902948453171433474 | FIFO Costing History / Weighted Average Costing History |
| gd_async_job / gd_publish_step / inventory_balance_lock | 2104845286495150081 / 2105131615547461634 / 2105132021358956546 | dev only until the cut |
| system dict (form datasource) | 1897577528487428098 | 系统字典(勿删) = `blade_dict` |

Columns: `information_schema.columns` (snapshot `columns.json`); `sm_item_assembly.ia_v2_job_id` / `ia_idem_key` absent on dev
and prod (the form publish creates them). Item: `assembly_cost` decimal(65,2), `purchase_unit_price` decimal(65,4), UOM rows
`item_mji552rc_sub` (`Item_id`, `alt_uom_id`, `base_qty` decimal(65,6)).

## Status dict, page
`SELECT CAST(id AS CHAR), CAST(parent_id AS CHAR), code, dict_key, dict_value, is_deleted FROM blade_dict WHERE id IN (1914500993831477249, 1914242988707749889)`
-> dev and prod: 1914242988707749889 (parent, code status, dict_key -1, "Status"); 1914500993831477249 (parent 1914242988707749889,
dict_key Processing, not deleted).
`SELECT ... FROM su_code_pages p WHERE id = 2098312073316716546` -> "Item Assembly" list, dev enabled v20 (prod v17).

## Facts behind contract decisions
- GENERATE_BATCH's error end-node (code 401) FAILS the calling run at its workflow node: dev SM_MISC_RECEIPT
  2098295611508183041, GOODS_RECEIVING 2091804770166583298, SM_OPENING_BALANCE 2105180515746615298, error
  `执行工作流节点[Generate Batch]报错[No default batch found.]` (`su_code_workflow_inst WHERE workflow_id = <caller> AND status = 'Fail'`).
- Classic IA movements: `parent_trx_no = ''` on every 'IA' row (dev 31, prod 197); SUBTRACT_INVENTORY v59 defaults isMovingInv `?? 0`.
- Platform code nodes keep 19-digit ids exact through `String()`: prod IA_SAVE run 2112073133161844738 `code_batch_decide`
  matched `String(it.id) === String(entry.item_id)` (needsGen 1) although nodes_data stores the ids as JSON numbers.
- price.js reproduces every classic receipt on prod: 56 / 56 Completed IAs (`test/shared/sql_live.py`).
