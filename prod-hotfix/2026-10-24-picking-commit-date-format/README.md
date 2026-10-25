# PICKING_BULK_COMMIT: Delivery Info dates read as text (2026-10-24)

## Status: DONE on dev and prod

- Dev v13 (13:25:10) and prod v13 (13:32:24) both read IDENTICAL to the repo, with no '%%' left.
- PACKING_BULK_COMMIT is back on prod v7, IDENTICAL to the repo, after the 13:24 mix-up below. No Packing commit ran while
  the wrong code was in it.
- `scratchpad/validate.py` now reports this bug class as PCTPCT.

## What is wrong

`sql_node_PCp5hdr` (P5, the Picking header read) formats the Picking's four Delivery Info dates with `'%%Y-%%m-%%d %%H:%%i:%%s'`.
MySQL reads `%%` as a literal `%`, so the read returns text instead of a date:
- prod: `%Y-%m-%d %H:%i:00` (the dev-to-prod promotion turned the last `%%s` into `%s`, so only the seconds are real);
- dev: `%Y-%m-%d %H:%i:%s`.

When a Picking covers one delivery, P5 copies those values into the Packing it creates or refreshes. The Packing columns
(`di_est_delivery_date`, `di_est_arrival_date`, `di_pickup_date`, `di_validity_of_collection`) are timestamps.

This is the same bug 3d fixed in PACKING_ASYNC_SUBMIT v7.

## Impact so far: none

- 25 Picking V2 confirmations have run on prod. One Picking had a date: PI-20261020-0637 (tenant 502801, estimated delivery
  2026-10-21). Its organization has no Packing step (the job ran P0, P1, P3, P4), so the read never ran.
- No LSH Picking carries a Delivery Info date today. Prod has only 27 Pickings with any of these dates, across 6 tenants.

It would start to matter once mobile Picking V2 ships, for any organization with Packing that fills Delivery Info dates on a
single-delivery Picking.

## 13:24 mix-up: the paste went into PACKING_BULK_COMMIT

At 13:24:19 the Picking paste file was enabled as **PACKING_BULK_COMMIT** v8 (2109924671239589890), whose name differs by
one letter, instead of PICKING_BULK_COMMIT. No Packing V2 commit ran on prod between then and the check at about 13:30:
the last run was at 12:27:56, and no Packing job moved after 13:20.

Restore it first: paste `RESTORE_PACKING_BULK_COMMIT.prod_v7.json` into PACKING_BULK_COMMIT (2109924671239589890), then
enable it. It is prod v7 (10-20) exactly, node for node the same as the repo's `Packing/AsyncV2/PACKING_BULK_COMMIT.json`
and dev v7.

## Fix

Paste `PICKING_BULK_COMMIT.prod_v12_datefix.json` into PICKING_BULK_COMMIT (2109531367339180034), then enable it.

It is prod v12 with only those four lines changed, to `'%Y-%m-%d %H:%i:%s'`. That is the format the same workflow's job read
already uses: prod run 2113852262106402817 returned `db_now` "2026-10-24 04:37:07" from it.

`PICKING_BULK_COMMIT.prod_v12_live.json` is what prod runs now. It is kept only to reverse the change.

Dev gets the same content through `scratchpad/drift/deploy/publish_picking_bulk_commit_datefix.json`. Dev v12 is backed up in
`~/Documents/ASC-dev/workflow-backups/dev/PICKING_BULK_COMMIT/`.

## Check after pasting

```
.dbtools/wf --prod deployed "Picking/AsyncV2/PICKING_BULK_COMMIT.json"   # IDENTICAL, and no '%%' left
```
