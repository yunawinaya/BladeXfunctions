# 2026-10-29 Picking -> Auto Complete GD: one GD-complete run at a time (prod paste)

**Status:** PROD LIVE 10-29: Picking form v185 (12:21:44) and Picking list v79 (12:24:38), each IDENTICAL to its paste
(`verify.py`); v79 keeps v78's one-by-one open kick. Dev form v441 / list v227 = the repo. Workers clean after the pastes;
health: the 3 known CHECKs. `watch_first_batch.py` reports the first Picking-started batch on the new code.
**15:50 Kenhin batch = OLD code** (same user as the 15:40 SO convert, browser not refreshed): 12 completions, last after 79 s,
6.6 s each, all completed; 20 worker runs, 12 by job id. Watch stopped 10-29 17:38 (user): no new-code Picking batch seen yet.

## Why
- GD completions started from a Picking (Auto Pick & Complete on the list, Completed on the Picking form) took 27.2 s on average
  since the 10-28 re-kick fix (244 jobs; max 306 s); from the GD form they take 4.4 s.
- **Kenhin 10-29 11:42:** 24 completions in 306 s. The follow started one GD_COMPLETE_WORKER run per completion as it appeared
  (24 runs within 25 s; about half found the stock locked and went to the 15 s / 30 s... lock wait), then kicked
  GD_COMPLETE_WORKER {} at most once per 15 s per browser. Each of those runs took ~5 s, so ~10 s of every 15 were idle.

## The change (same block in both handlers)
- `pkV2_onSave_Completed.js` (form eventScript 14) and `pkV2_listAutoPick.js` (list eventScript 24): each follow hands its
  queued completions to one drain per browser window (`window.pkV2GdcDrain`). The drain runs GD_COMPLETE_WORKER {} one at a
  time (a run takes the tenant's earliest due job, one stock call per run): the next 1 s after a run that moved a job, 5 s after
  one that moved nothing (a lock-waiting job is not due yet), 15 s after a failed run, 60 s with no answer.
- It reads the completions' STATUS only after a run that moved nothing, drops the ended ones, and stops once every delivery
  handed over has ended or after 3 quiet minutes (the old re-kick's bound). Each run stamps `pkv2_gdc_kick_at`, so the Picking
  list's 60-s sweep holds back meanwhile.
- The per-completion starts and `rekickGdCompletes` are gone; the messages ("Completing ... in the background", "Not completed
  automatically ...") are unchanged.

## Tests
- Offline: `scratchpad/pk1e/test/test_client_list.js` (both files) all passed - hand-over, {} runs one at a time, 1 s / 5 s /
  15 s / 60 s pacing, reads only after idle runs, ended statuses, unanswered reads, the 3-min stop, three Pickings into one
  drain; `scratchpad/pk1c/test/test_client_1c.js` all passed (its re-kick cases rewritten for the drain).
- Not caused by this: `scratchpad/pkv2-legacy/test_client.js` "a bin move" fails on the old handler too (stage 1c changed that);
  `test_lsh_replay.js` needs a cache file not on this machine.
- **Live, dev 10-29 12:17** (`scratchpad/pk1e/deploy_drain/live_auto_pick_dev.mjs`, the list's real block against the dev
  workflows): 8 Pickings PICK_ALL_REMAINING -> 8 confirms COMPLETED (3.3-4.1 s) -> 8 completions handed over -> 8
  GD_COMPLETE_WORKER {} runs one at a time (3.3-4.4 s each, the next 1.0 s after), the last done at 41.5 s (~4.7 s per GD),
  one idle run, one STATUS read, the drain stopped. Max 1 run in flight; all 8 GDs Completed, no job failed.

## Paste, either order
1. **Picking form** `transfer_order` 1935556443668959233: paste `PickingFullJSON.prod_paste.json`. Built on prod enabled v184;
   only `/config/eventScript/14/func` differs.
2. **Picking list page** `Picking` 1935635853539348481: paste `PickingListPageFullJSON.prod_paste.json`. Built on prod enabled
   v78 (it keeps this morning's one-by-one open kick); only `/config/eventScript/24/func` differs.
- **Then:** `python3 verify.py` (each enabled = its paste; Picking-started completion batches since, seconds each).
- **Rollback:** paste `PickingFullJSON.prod_v184.base.json` / `PickingListPageFullJSON.prod_v78.base.json`.
- Users get it after a full browser refresh (F5).

## Parity
Dev form v441 / list v227 and the repo (`Picking/AsyncV2/*.js`, `Picking/PickingFullJSON.json`, `Picking/PickingListPageFullJSON.json`)
carry the drain. Two open-time kicks stay PROD-ONLY (dev and the repo still start their workers all at once, on purpose while the
China team checks the prod restarts): the Picking list's (v78, `../2026-10-29-picking-list-one-by-one/`; dev v227) and the GD
list's (v195, the other dev's 07:51 change; dev v404, repo `Goods Delivery/CompleteV2/gdc_list_mounted.js`). Carry both over
before any promotion or a paste of those pages from dev.
