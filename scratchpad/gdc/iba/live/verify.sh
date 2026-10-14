#!/bin/zsh
# read-only checks after the engine's live test (dev)
cd /Users/yunawinaya/Developer/BladeXfunctions
.dbtools/db --dev "SELECT reserved_qty, unrestricted_qty, balance_quantity, update_time FROM item_balance WHERE id=2020755178501394434"
.dbtools/db --dev "SELECT operation_effect_key, movement, inventory_category, quantity, base_qty, unit_price, total_price, transaction_type, trx_no FROM inventory_movement WHERE tenant_id='000000' AND trx_no='IBA-TEST-1' AND is_deleted=0 ORDER BY id"
.dbtools/db --dev "SELECT job_id, step_name, step_status, LENGTH(result_ref) ref_len, error_message FROM gd_publish_step WHERE job_id LIKE 'IBATEST|%' AND is_deleted=0 ORDER BY id"
.dbtools/db --dev "SELECT lock_key, free_token, owner_operation_id, last_owner_operation_id, lock_version FROM inventory_balance_lock WHERE tenant_id='000000' AND lock_key='ITEM|2020755054429687810|2018912875841613825'"
.dbtools/db --dev "SELECT id, fifo_sequence, fifo_available_quantity FROM fifo_costing_history WHERE material_id=2020755054429687810 AND plant_id=1123598813738675202 AND is_deleted=0 ORDER BY id"
