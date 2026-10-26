# Remove LSH's empty Packing shells whose delivery has no Picking (prod, tenant 128671)

GD Created V2 creates an empty Packing (key `PKG|<gd_id>`) when a delivery is saved. The user decided on 10-26 that
the Packing should only appear once picking is confirmed. The GD session is changing GD_BULK_COMMIT to stop making the
shell. This cleanup removes the shells already made for deliveries nobody has converted to Picking yet.

**Run it only after** the no-shell GD_BULK_COMMIT is live on prod. Before that, new shells keep appearing.

## Steps

1. Run `preview.sql` and **keep its output** (the ids are the restore list). 28 rows on 10-26 17:20 MYT.
2. Run `cleanup.sql`. It re-checks every condition at run time, so a shell picked in between is left alone.
3. Run `preview.sql` again: expect 0 rows.

A shell is removed (`is_deleted = 1`) only if all of these hold:
- it is Created, with the save-time key;
- it is not open in the Packing form and no Packing job holds it;
- it has no item, HU-source or HU row;
- its delivery is Created with no live Picking;
- no background job is open on that delivery.

Nothing else points at a shell: the delivery header and lines carry no Packing reference. When such a delivery is picked
later, Picking creates a fresh Packing with a new number.

## Restore

```sql
UPDATE packing SET is_deleted = 0 WHERE tenant_id = '128671' AND id IN (<ids from step 1>);
```

Not included: PACK-LSH-4 (tenant 683894, GD-LSH-4), the only shell outside LSH. Change the tenant in both files to clean
it too.
