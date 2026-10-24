# GD_COMPLETE_SUBMIT: remove the last piece of the 10-24 "borrowed guard" (2026-10-24)

## What is wrong

At 11:05 on 10-24 the same dev who pasted the Packing guard also changed GD_COMPLETE_SUBMIT: prod v10, and dev v11 at 11:07. The
other three guard workflows (PACKING_SAVE, GOODS_DELIVERY, GD_UNUSED_FN_NEW) were put back by 12:37. This one was not.

The change adds an LSH-only check (tenant 128671, organization 1996787068457861121) to `code_node_GSentry`, fed by three new
columns in `sql_node_GSfacts`. It looks at the delivery's latest `GDC|<gd>` LOCK row and answers BUSY "Packing or completion holds
this delivery, or requires support review" unless one of these is true:
- the row's status is PACKING_DONE (a status only the removed Packing guard wrote);
- the row is a LOCK of a COMPLETE_GD job that has COMPLETED, FAILED or CANCELLED.

GD Edit V2 writes the same LOCK rows for its EDIT_GD jobs. The new query only looks for COMPLETE_GD jobs, so **every LSH delivery
whose latest lock came from GD Edit V2 is refused on every V2 completion attempt**. At 13:10, 11 open LSH deliveries were in that
state, for example GD-2610-1136, 1166, 1174 and 1175. The check had already refused 8 attempts on 6 deliveries between 11:13 and 11:39.

## Fix

Paste `RESTORE_GD_COMPLETE_SUBMIT.prod_v9.json` into GD_COMPLETE_SUBMIT (2110182609618337794), then enable it. It is prod v9
exactly (10-21, the version before the guard), and node for node the same as the repo's `Goods Delivery/CompleteV2/GD_COMPLETE_SUBMIT.json`.

`GUARD_GD_COMPLETE_SUBMIT.prod_v10.json` is what prod runs now. It is kept only to reverse the change.

Dev gets the same content through `scratchpad/drift/deploy/publish_gd_complete_submit.json`. Dev v11 is backed up in
`~/Documents/ASC-dev/workflow-backups/dev/GD_COMPLETE_SUBMIT/`.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/CompleteV2/GD_COMPLETE_SUBMIT.json"   # IDENTICAL
python3 scratchpad/prod_health.py                                                 # no new CHECK
```

Then complete one of the 11 deliveries from the GD list (for example GD-2610-1136). It should queue normally instead of answering BUSY.
