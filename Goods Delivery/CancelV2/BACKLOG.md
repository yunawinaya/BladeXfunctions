# GD Cancel V2: backlog

## Return packed stock to the bins it was packed from (parked 2026-10-27)

**Why parked (user, 10-27):** LSH stopped using Packing on 10-27. No Created GD at LSH has a Completed Packing, so no
pending cancel needs it. Pick it up when a tenant packs again.

**The ask (user, 10-27):** when a GD is cancelled after a Completed Packing moved its stock to the dispatch bin, the
stock should go back to the bins the Packing took it from. It should not be released at the dispatch bin. This belongs
in **Cancel, not Revert**: a reverted GD is usually delivered again, and its packed goods stay at the dispatch area.

### Today
- **The Packing:** V2 (`PKG|<job>|N`) and classic both move the GD's Reserved stock from the source bins into a box (HU)
  at the Packing's dispatch bin ("Outbound" at LSH). The GD's reservations are re-pointed to that bin and box.
- **The cancel:** GD Cancel V2 releases Reserved → Unrestricted where the reservation sits, inside the box at the
  dispatch bin. The box stays Packed (decision of 10-20: a Completed Packing's boxes stay packed).
- **The effect:** the freed stock is later allocated to new GDs from the dispatch bin (LSH SO2610-1900, 10-27). LSH
  ended up with about 2,491 Unrestricted units at Outbound, from GDs cancelled after packing (GD-2610-1308..1339).

**Example: LSH GD-2610-1339 (10-25)**

| Time | Step |
|---|---|
| 16:03 | created; 395 units on 19 lines reserved at 10 shelf bins |
| 16:12 | PACK-2610-1185 moves them into box HU/2610/1712 at Outbound |
| 16:19 | delivered |
| 16:29 | the classic revert puts them back in the box |
| 16:34 | the cancel releases them, still in the box |

HU/2610/1712 is still Packed at Outbound with 395 units.

**The source bins are on record (verified):** the Packing lines' `packing_jz8m9w3h_sub.bin_location` are exactly the
bins the Packing move took stock from (PACK-2610-1185: the same 10 bins). This is verified on a V2 Packing only. Check a
classic-path Packing before relying on it: LSH had 611 Completed Packings in 30 days, but only 379 `PKG|` operations.

### Sketch (not agreed)
- **PREPARE:** take each reservation of the GD that sits in a box of one of the GD's Completed Packings. Map its
  quantity back to that Packing's lines (material + batch + unit → `bin_location`), in line order. Any part with no
  matching line is released in place, as today.
- **X2 (the one engine call):** for the returned part, SUBTRACT Reserved at (dispatch bin, box), then ADD Unrestricted at
  the source bin, with `isMovingInv` 1 and `unit_price_from`. First check that the engine accepts a pair that changes
  both the bin and the category. If it doesn't, use two pairs: a Reserved move across bins, then the release.
- **X4H:** also unload the returned rows from the Completed Packing's boxes: REPACKING_PROCESS Unload, `isPacking` 1,
  records only, this GD's rows only. Mark the box rows Unpacked, as for open Packings. Do not return 'locked' boxes
  (picked whole upstream): there, the box itself was the source. The X4H contract is Packing V2's (79's): coordinate
  with them.
- **Result:** say what went back to which bins, and what stayed.

### Open decision (user)
Should the cancel always return the stock, or offer a choice when cancelling? I recommend **always**. The person
cancelling often doesn't know where the goods physically are. A choice would also need a mobile app release, because
mobile cancels through the same SUBMIT.

### Out of scope
Stock already released at dispatch bins needs a one-off Location Transfer once the warehouse confirms where the goods
really are. A per-item list with each item's original bin can be drawn from the Packing lines.
