# 2026-10-29 Picking list: start its three background workers one at a time (prod paste)

**Status:** PROD LIVE 10-29 10:31:46 as page v78, IDENTICAL to the paste (`verify.py`); the three workers keep completing. Dev
and the repo stay as they are (the China team is checking the prod restarts first), like the GD list's v195.
- **Old tabs keep the old code until they reload:** at 10:31:51 Niswa (710478) still started the three together, and at
  10:31:59 wayne1 (LSH) still started all six GD list workers together (a GD list tab from before its 07:51 change).
  `watch_first_open.py` reports the first open on the new code.

## Why
- Every open of the Picking list (page 1935635853539348481) starts PICKING_ASYNC_WORKER, GD_EDIT_WORKER and GD_COMPLETE_WORKER
  in the same instant. Workflows loading their scripts at the same moment after a backend restart can stay "script for
  node[...] is not loaded" until the next restart (`../2026-10-28-2133-v2-workers-not-loaded/`).
- The GD list already starts its workers one at a time on prod (v195, 10-29 07:51). The SO list always did.

## The change (`make_handler.py`)
- Only the list's `mounted` handler (eventScript 1). Its first part (Picking Plan setup) is unchanged.
- The three starts now go out in turn: Picking worker, then GD Edit 1 s after its answer, then the GD Complete sweep 1 s after
  that. With no answer after 60 s the next one starts anyway (a long run can lose its answer, Kenhin 10-27). A failed or
  throwing start moves on too.
- The 55-s per-browser throttle on the sweep and the 60-s beat are unchanged.

## Tests (`node test_one_by_one.js`): 17/17
Order and 1-s spacing; at most one run in flight; a lost answer (61 s / 122 s) and late answers that start nothing twice; a
failure and a throw; a second open inside the throttle; the beat sweeping alone and stopping off the list. Run against prod
v77's handler, the order cases fail, as they should. Not run on dev: dev stays unchanged on purpose.

## Paste
- **Picking list page** `Picking`, id 1935635853539348481: paste `PickingListPageFullJSON.prod_paste.json`, save, enable.
  Built on prod enabled v77 (10-28 18:38); `build.py` asserts nothing but `/config/eventScript/1/func` differs.
- **Then:** `python3 verify.py`: enabled = the paste, and the three workers' latest runs.
- **Rollback:** paste `PickingListPageFullJSON.prod_v77.base.json`.

## Parity
Dev v226 and the repo `Picking Plan/PPonMountedListPage.js` still start the three together. A promotion or a Picking list paste
from dev would undo this; carry `PPonMountedListPage.one_by_one.js` over first.

## First opens after the paste (watch, 10:31-10:54; the watch printed UTC+16 by mistake, times below are MYT)
- **10:54:05 UMI (528521): one by one.** GD Edit started 1.27 s after the Picking worker, the sweep 1.19 s after GD Edit.
- **Still all three together** (a browser holding the page it loaded before the paste): Niswa 710478 10:31:51, lshteam 128671
  10:37:19, PK-USER4 681409 10:50:44, gubunited.02 900938 10:53:08. Re-opening the list inside an already-loaded browser seems
  not to fetch the new page; a full refresh (F5) should (not yet confirmed).
