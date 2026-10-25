# GD Cancel V2: overlapping cancels can no longer drop a rename in a shared Picking's delivery list (2026-10-25, BA point 2)

## What was wrong

A Picking shared by several GDs lists them all in `delivery_no` ("GD-2610-1305, GD-2610-1311"). Cancel step X5 renames its
own GD's number in that list and writes the whole text. Two cancels that both read the list before either wrote could
overwrite each other: both checks pass, and one cancelled number stays without "-Cancelled". It affects display text only.
It never happened at LSH (0 of 310 shared Pickings), but a fix by SQL was not acceptable.

The platform has no atomic write: sql-nodes are SELECT-only, and update-node filters are not enforced. So no "write only if
unchanged" is possible.

## Fix (GD_CANCEL_COMMIT, X5 only)

Every X5 write also renames the sibling GDs on that Picking that will end Cancelled:
- one whose cancel is past its point of no return (X2 or X3 done; the GD still Processing);
- one already Cancelled whose rename was lost earlier.

Whichever write lands last therefore carries all the renames.

- Never renamed twice: a token already ending in "-Cancelled" is left as it is.
- On a held Picking (an edit or a confirm), only this GD's own rename waits. A sibling-only rename is skipped and left to the
  sibling.
- The read runs in 0.7 s on LSH prod, the same as before. The join order is forced so GDs are found through
  `(organization_id, delivery_no)`.

## Evidence

- `scratchpad/gdcan/test/race_x5.js` runs the BA's interleaving: with the sibling rows no rename is lost; without them (the
  old read) the loss reproduces.
- `test_shared_picking.js` passes 33 of 33 (7 new cases). The commit simulation passes every scenario. The PREPARE / SUBMIT
  simulation passes 21, the list tests 8, the form tests 4. Lint is unchanged.
- The read ran on prod, read-only:
  - today's LSH Pickings: no sibling rows, nothing to repair;
  - a made-up list naming cancelled GD-2610-1305 and GD-2610-1311 by their old numbers: exactly those two flagged.
- Dev v9, live: GD/20260828/504 and 505 cancelled together on PI-20260828-0299. Both COMPLETED in 7 s. One X5 wrote both
  renames in a single write, and the other had nothing left to write. List `GD/20260828/504-Cancelled,
  GD/20260828/505-Cancelled`, Picking Cancelled. The BALANCE and NUMBERS health checks report OK.

## Prod

1. Paste `GD_CANCEL_COMMIT.prod_v6_x5_siblings.json` into **GD_CANCEL_COMMIT** (id 2112455779051212802). It is prod v6 with
   exactly the 5 X5 nodes changed: X5 ids / plan / check and its read / read-back. Not GD_CANCEL_WORKER, not GD_COMPLETE_*.
2. Tell me and I'll check it is IDENTICAL.

`GD_CANCEL_COMMIT.prod_v6_live.json` is what prod runs now, kept to reverse the change.
