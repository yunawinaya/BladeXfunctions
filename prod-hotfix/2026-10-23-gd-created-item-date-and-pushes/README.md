# GD Created V2: Item date + no picker pushes (2026-10-23, parity audit M1 + D1)

These are the two findings from `Goods Delivery/V2_CLASSIC_PARITY_AUDIT_2026-10-23.md` that the user chose to fix.

| # | Prod workflow | File here | Base on prod |
|---|---|---|---|
| M1 | **GD_BULK_COMMIT** (2104840402446245890) | `GD_BULK_COMMIT.json` | the live version, identical to dev v18 (checked 10-23) |
| D1 | **GD_PICKING_OUTBOX_CONSUMER** (2105134245397041153) | `GD_PICKING_OUTBOX_CONSUMER.json` | the live version, identical to dev v12 (checked 10-23) |

**M1:** GD Created V2 now writes Item `last_transaction_date` for every material of the delivery, as classic does on every save.

- A new step, P7F, sits at the end of the once-only P7E reorder branch: up to 12 parallel lanes, each writing an ISO date as classic's `code_node_62FzZA2e` does.
- The platform keeps the date part only.
- Only the date's presence is read (the Item delete guard and the Item form lock).

**D1:** the Picking consumer no longer sends picker pushes when it updates an existing Picking. Classic builds these pushes but never sends them, and V2 already sent none when it creates a Picking. The consumer gets `notify_on_update: false` beside its existing `notify_on_create: false`.

## Paste

Paste both JSONs into the designer and publish. They are independent, so either order works. Then, optionally, run `repair.sql`, preview first. On 10-23 it matched 1 item (tenant 496474 "ppp").

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"              # IDENTICAL
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_PICKING_OUTBOX_CONSUMER.json"  # IDENTICAL
```

## Source and tests

- **Patch scripts:** `scratchpad/gdc/gdcreate/patch_commit_item_date.py` + `code/p7f_item_dates.js`, and `patch_consumer_no_push.py`.
- **Lint:** unchanged (16 and 2 findings, before and after).
- **P7F plan unit checks:**
  - duplicate materials are written once, and only digit ids count;
  - the date is an ISO string;
  - 2,000 materials fit in 8 lanes of at most 250;
  - nothing is dropped beyond 3,000;
  - an empty delivery writes nothing.
- **Compile:** both edited nodes compile.
