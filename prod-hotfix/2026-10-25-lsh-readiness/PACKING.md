# Packing: LSH readiness for 2026-10-26

Owner: the Packing V2 session. Scope: PACKING_ASYNC_SUBMIT / WORKER, PACKING_BULK_PREPARE / COMMIT (V2, desktop Packing form), PACKING_SAVE (classic, LSH mobile), the Packing form. Updated 2026-10-25 13:30 MYT. All Packing V2 workflows are now identical on dev and prod.

## Tomorrow's load runs on the classic path

LSH mobile store build 1.1.34 completes Packings through classic **PACKING_SAVE** (`1994279909883895810`); 898 of 900 LSH saves last week came from mobile. Only the desktop Packing form uses V2 (19 LSH jobs on 10-24 / 10-25).

**PACKING_SAVE prod v32** (= repo v58 apart from one empty `"blocks"` key the designer adds) since the 10-24 restore:
- 184 runs (10-24 11:29 to 10-25), **0 failures, 0 error messages**; average 6.3 s on 10-24 and 16.6 s on 10-25, longest 34 s. A Completed save re-saves the whole Goods Delivery through GOODS_DELIVERY, so its time grows with the delivery's size.
- It refuses a Completed save, before any write, when:
  - the delivery has an open background job: EDIT_GD / COMPLETE_GD / COMPLETE_PACKING on `GD|<gd>`, or SAVE_SO on an SO of its lines;
  - the delivery is Processing;
  - the Packing is already Completed or Cancelled;
  - the delivery has more than 500 lines.
- **It takes no stock locks**, so it cannot leak any. The PKS| locks of 10-24 came from the reverted guard, not from v58.
- The mobile Packing lease (PACKING_SESSION `1985966445405949953`, `packing_lock_*`, 2-minute expiry, 30 s keepAlive) is not a stock lock. A phone that dies leaves it for at most 2 minutes. V2 SUBMIT and GD Cancel V2 refuse while another user's lease is live.

**Known classic races** (not new; no change for tomorrow):
- Its reservation move (GOODS_DELIVERY → GD_UNUSED_FN_NEW → SUBTRACT/ADD_INVENTORY_NEW) writes balances without the V2 engine locks, so it can race a V2 job on the same balance row (README item 5; MIN-01 classic lock is OFF).
- Its SO "every delivery packed" decision has the same race as item 4 below, with a smaller window.

## V2 status and what to paste

| # | Item | Dev | Prod | Paste (name + id) |
|---|---|---|---|---|
| P1 | `%%` date formats in SUBMIT (mobile would have written the literal text into the delivery dates) | v7, 10-24 | **v7 pasted 10-24 13:18, IDENTICAL** | done |
| P2 | Worker budget 20 → 240 s. Only drain mode (`WORKER {}`, mobile V2 list mount) was limited; desktop kicks pass `{ job_id }` and the first job of a run always runs. Prod: 19 LSH jobs claimed 0-8 s after queueing, 8-41 s runs, 0 retries. No effect tomorrow (mobile is classic). | **v5 live 10-25 13:01** | **v5 pasted 10-25 13:21, IDENTICAL** | done: **PACKING_ASYNC_WORKER** `2109924593737240578` ← `prod-hotfix/2026-10-25-packing-worker-budget/PACKING_ASYNC_WORKER.prod_paste.json` |
| P3 | SO packed-decision race (README item 4). PREPARE froze "every other delivery of the SO is packed"; two deliveries of one SO completed together could each see the other unpacked, and neither flips the SO. **Fix:** P4 re-reads the sibling deliveries at commit time, after this delivery's P3; a payload from before the fix keeps the frozen decision. Prod: never happened (each of the 19 SOs has one delivery, all flipped). | **COMMIT v8 + PREPARE v7 live 10-25 13:07**; offline 13/13 incl. both race interleavings; **live run PASSED 10-25 13:15** (PACK/20261021/0049: 3 SOs + 6 lines flipped, batch + plain stock moved L1 → L2, HU stamped, same-bin HU untouched, 7/7 steps in 10 s) | **COMMIT v9 pasted 13:20 + PREPARE v7 pasted 13:20, both IDENTICAL** | done, COMMIT first: **PACKING_BULK_COMMIT** `2109924671239589890` ← `prod-hotfix/2026-10-25-packing-so-flip/PACKING_BULK_COMMIT.prod_paste.json`, then **PACKING_BULK_PREPARE** `2109924633813815298` ← `.../PACKING_BULK_PREPARE.prod_paste.json` |

Every prod paste file is seeded from prod's live version and equals the dev file. After each paste: `.dbtools/wf --prod deployed Packing/AsyncV2/<file>.json` must say IDENTICAL.
- P2 → `PACKING_ASYNC_WORKER.json`.
- P3 → `PACKING_BULK_COMMIT.json`, then `PACKING_BULK_PREPARE.json`. Note: PACKING_BULK_COMMIT ≠ PICKING_BULK_COMMIT.

## If the mobile V2 OTA ships (`hotfix/v2-background`, user's decision)

LSH mobile packing then moves from PACKING_SAVE to PACKING_ASYNC_SUBMIT / WORKER. Reviewed with sudu-mobile-expo-9a on 10-25; the server needs no change.
- **Mixed fleet is covered both ways.**
  - A running job holds the Packing lock (`PKGJOB-<job>`, 30 min), and PACKING_SESSION (prod v11 = dev) answers PACKING_IN_USE to a 1.1.34 phone.
  - PACKING_SAVE refuses a Completed save while the GD has an open job.
  - SUBMIT refuses another user's live lease.
  - Edges: the same user on two devices; a job stuck past 30 min (0 on prod).
- **Lock conflicts:** LSH GD creates on the same engine hit LOCK_CONFLICT on 89 of 423 attempts since 10-22. A Packing retries a conflict 3 times (2, 4, 8 s), each needing a new kick, then ends FAILED "the stock stayed busy" (clean). **User decision 10-25: keep 3 and watch tomorrow**; raise only if these failures show up.
- **Asked of mobile (now in MOBILE_PACKING_V2_GUIDE.md):**
  - follow its own job with `WORKER { job_id }` until it ends;
  - send at most one `{}` drain per 2 min, never looping on `processed`;
  - use a new idempotency key after a definitive answer;
  - mark its keys `PKM:<packing_id>:<gen>`.

## NOT_ELIGIBLE fallback after the OTA (README item 9)

The fallback to classic PACKING_SAVE is the only classic stock writer left on an updated phone's Packing path. At LSH it should be **~0**:
- **SUBMIT's answers since 10-20:** 0 NOT_ELIGIBLE among 46 (19 QUEUED, 26 STATUS, 1 REJECT "open on mobile by joseph").
- **All 364 LSH Packings since 10-11:**
  - every one has a Goods Delivery and none is a Draft;
  - 0 have an item the engine can't move (no base unit, serial, no batch flag, unsupported costing, Fixed Cost without a price);
  - 0 have a non-batch item with batch balance rows (an upper bound for the stray-row rule);
  - prod has 0 serial balance rows.
- No Packing job has ever FAILED `PK_NOT_SUPPORTED`.

**User decision 10-25: keep the fallback.** Refusing instead of falling back on 10-26 was not recommended: It would protect against nothing measured, and it would leave a real Packing impossible to complete, for example a new item created without a base unit. Any lost write still shows up in prod_health.py's BALANCE section within the hour. If the user wants it anyway: one line in SUBMIT's decide (tenant 128671: REJECT with a message instead of NOT_ELIGIBLE), a dev publish and a prod paste.

The other classic writers are the 1.1.34 phones, until the forced update lands.

## Read cost per tap (README item 2d, EXPLAIN ANALYZE on prod 10-25, LSH PACK-2610-1175)

No dependent (per-row) subquery in any Packing read.
- **PACKING_SAVE `sql_node_PkJobChk`** (every classic Completed save): 63 ms. Its subquery is materialized once.
- **SUBMIT `sql_node_KSfacts`** (every V2 tap): 0.7-0.9 s, from three single scans of `goods_delivery_fwii8mvb_sub` (80,456 rows, no index besides PRIMARY, 60-100 ms each).
- **PREPARE / COMMIT**: read each Packing child table once (619-2,030 rows).

All of these grow linearly. An index on `goods_delivery_fwii8mvb_sub(goods_delivery_id)` would help GD, Picking and Packing alike; that is the user's decision, not needed for tomorrow.

## What the Packing session watches tomorrow

- `gd_async_job` COMPLETE_PACKING (tenant 128671) not COMPLETED for more than 2 minutes, or any FAILED / REQUIRES_REVIEW.
- A Packing still locked by `PKGJOB-<job>` after its job ended.
- PACKING_SAVE prod failures and run times above 60 s.
- After an OTA: FAILED jobs with "the stock stayed busy", PK_INVENTORY_RETRY counts, and jobs waiting more than 2 min for a kick.
