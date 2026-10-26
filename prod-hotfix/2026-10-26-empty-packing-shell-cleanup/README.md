# Hide LSH's empty Packing shells whose delivery has no Picking (prod, tenant 128671)

GD Created V2 creates an empty Packing (key `PKG|<gd_id>`) when a delivery is saved. The user decided on 10-26 to keep
that shell hidden until picking fills it:
- GD_BULK_COMMIT leaves new shells at packing_status **"Waiting"** (GD session);
- Picking V2 P5 and classic PICKING set "Waiting" back to Created when they fill it (GD Edit & Picking V2);
- the desktop Packing list page and the mobile Packing list filter "Waiting" out (Packing session / mobile session).

This moves the shells already made, for deliveries nobody has converted to Picking yet, to "Waiting".

**Run it last**, after all of these are live on prod:
1. both list filters;
2. the Picking un-hide (P5 + classic PICKING);
3. the GD change.

A hidden shell that Picking cannot un-hide would leave a picked delivery's Packing invisible.

## Steps

Run `hide_shells.sql` once. It gives three results:
1. The shells about to be hidden. **Keep this one**: its ids are the restore list. There were 28 on 10-26 17:20 MYT.
2. The update. It re-checks every condition at run time, so a shell picked in between is left alone.
3. The same list again: expect 0 rows.

A shell is hidden only if all of these hold:
- it is Created, with the save-time key;
- it is not open in the Packing form and no Packing job holds it;
- it has no item, HU-source or HU row;
- its delivery is Created with no live Picking;
- no background job is open on that delivery.

Shells whose delivery already has a Picking are left visible; that Picking fills them soon, and hiding one at the moment
it is filled could miss the un-hide.

## Restore

```sql
UPDATE packing SET packing_status = 'Created' WHERE tenant_id = '128671' AND packing_status = 'Waiting' AND id IN (<ids from step 1>);
```

Not included: PACK-LSH-4 (tenant 683894, GD-LSH-4), the only shell outside LSH. Change the tenant in both files to cover
it too.
