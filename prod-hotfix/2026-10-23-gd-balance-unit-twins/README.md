# Stock balances on a twin of the item's base unit (Kenhin 528521 + 073522, 2026-10-23)

GD Created V2 refuses with "allocation N: the balance row's unit differs from the material's base unit" (GD_ITEM_NOT_SUPPORTED). Kenhin had 105 refusals on 10-23 between 10:42 and 11:39, over 14 SOs.

- **The cause:** the stock balance row is on another unit *record* with the same name as the item's base unit (`kg` vs `KG`, `pkt` vs `PKT`; for 073522, two units both named `CA*24`).
- **Where the check is:** V2 compares unit records in GD_BULK_PREPARE, and again in the inventory engine when it writes the stock. Classic never compared them, so the quantities are already in the base unit.

## How the twins came about (checked on prod)

1. **SQL Accounting keeps units as free text per item.** Kenhin's items carry "KG", "Kg" and "kg".
2. **SQL_SYNC_MASTER_DATA copied each spelling as its own unit.** It matches with `client[clientKey] === dbRecord[dbKey]`, which is case-sensitive. The sync login (KELLY) created all of them on 05-25 at 20:34. Each item took its own spelling, so B03 got `KG`.
3. **The opening-balance import used the other spelling.** Kenhin's admin (`kenhin_main`) ran it on 05-26 between 00:36 and 00:38. The file said "kg" and "pkt", so the 16 rows were created on the `kg`/`pkt` records.

## The repair

`repair.sql` repoints only the rows whose unit name equals the item's base unit name ignoring capitals and spaces. It sets `material_uom` to the item's own base unit record and changes no quantity.

| Tenant | item_balance | item_batch_balance |
|---|---|---|
| 528521 (Kenhin) | 16 | 0 |
| 073522 | 10 | 10 |

The preview returned these 36 rows on 10-23. The condition is re-checked when the update runs, so a second run changes nothing.

1. Run the preview.
2. Run the two UPDATEs.
3. Run the preview again: it should return no rows.
4. Kenhin re-saves the 14 orders' deliveries.

**Not repaired: real differences.** These need a review with each client, because classic has been taking stock out of these balances as if they were in the base unit:

- V123 at Kenhin: the balance is in PKT, the base unit is BAG/12;
- 073522: 91 item-balance rows and 22 batch-balance rows;
- 551372 and 900938: 1 row each.

**Ask Kenhin to stop changing items' base units by hand.** `kenhin_main` edited B03 at 11:49 and B09 at 11:47 on 10-23, and every flip makes a new mismatch.

**Not fixed here: the sync, the opening import, and a unit-master rule** against names that differ only in capitals (support's fixes B, C and D) belong to whoever owns the SQL Accounting sync. The sync still creates twins (`bag` and `box` on 10-22), so new mismatches can appear until it is fixed.
