# GD_BULK_PREPARE: check the batch balance's unit too, and name both units (2026-10-23)

| Prod workflow | File here | Base on prod |
|---|---|---|
| **GD_BULK_PREPARE** (2104840044642754561) | `GD_BULK_PREPARE.json` | v18, identical to dev v18 (checked 10-23) |

1. **The batch row is checked.** INVENTORY_APPLY_OPERATION refuses an `item_batch_balance` row whose unit is not the item's base unit, but PREPARE checked only the `item_balance` row. A batch item therefore passed PREPARE and failed inside COMMIT. 073522 has 32 such batch rows. PREPARE now refuses it up front: `sql_node_zegvDynS` returns the batch row's unit, and the validation nodes (`code_node_J5T1G2s9` and `code_node_egoCivrm`) check it.
2. **Both units are named.** Kenhin saw 105 refusals reading "the balance row's unit differs from the material's base unit", with no unit given. The messages now read:
   - "allocation 1: the stock balance at this bin is in unit X, but the item's base unit is unit Y: the stock and the item must use the same unit";
   - "allocation 1: the stock of batch B at this bin is in unit X, …".

   The GD form's refusal alert turns "unit &lt;id&gt;" into the unit's name.

The error code (GD_ITEM_NOT_SUPPORTED) and the field are unchanged.

## Paste

Paste `GD_BULK_PREPARE.json` into the designer and publish. It doesn't depend on the other 10-23 pastes. `repair.sql` in `2026-10-23-gd-balance-unit-twins/` clears the rows this check stops for Kenhin and 073522.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_BULK_PREPARE.json"   # IDENTICAL
```

## Undo

`RESTORE_GD_BULK_PREPARE.json` is prod v18, what prod runs now.

## Source and tests

- **Patch:** `scratchpad/gdc/gdcreate/patch_prepare_balance_unit.py`, which round-trips the Prettier-rendered repo file.
- **Static checks:** lint is unchanged (18 findings before and after), and both changed nodes compile.
- **SQL:** the new facts SQL ran read-only on dev (53 batch rows, each with its unit) and on prod (a 073522 batch row showing its twin unit).
- **Dev:** v19, published 10-23 12:07.
- **Live test** (`deploy_prepare_unit/live_test.sh`, user's yes): two dev balance rows at one bin were switched PCS → BOX for about a minute, then restored.
  - Two V2 saves were refused with the new messages: the P-00002 item balance, and the ITM-20260600005-A batch row in PREPARE.
  - No GD was made and no stock moved.
