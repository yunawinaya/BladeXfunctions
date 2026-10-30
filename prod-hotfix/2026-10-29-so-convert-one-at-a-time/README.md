# 2026-10-29 SO list Convert to GD: one worker run at a time (Kenhin's 2-3 min wait)

**Status:** PROD LIVE 10-29 12:01:35 as SO list v273, IDENTICAL to the paste (`verify.py`); dev v544 = repo = prod handler.
Health check after the paste: the same 3 known CHECKs as 10-28 19:50 (LSH SAVE_SO review from 10-25, BALANCE, NUMBERS).
`watch_first_batch.py` reports the first bulk convert on the new code.
**15:40 Kenhin batch = OLD code** (browser not refreshed since 12:01): 12 GDs, last after 262 s, 21.8 s per GD, all completed.
Kenhin needs a full refresh (F5). Watch stopped 10-29 17:38 (user): no new-code bulk convert seen yet.

## Why
- Kenhin (528521) said a bulk SO -> GD convert waits 2-3 minutes. It is not stuck and not new: about 12-24 s per GD since 10-26,
  14-27 s per GD on 10-29 (10:49 batch 17 GDs, last after 252 s; 11:21 batch 24 GDs, last after 624 s).
- **The cause, in the convert handler** (`Goods Delivery/GDhandleConvertSOtoGD.js`, func_handleConvertGD):
  - it started one worker run per SO at once (24 in the same second at 11:21:38); only 4-5 could commit, the rest found the
    stock locked by another GD and ended;
  - then it started one run per ~15 s (every 5th 3-s check in the 2-minute follow, then a 15-s beat). Each run commits one GD
    in ~8-10 s on prod, so each GD also waited the rest of the 15 s.
- GDs of SOs that share stock commit one at a time (the stock engine); that part stays.

## The change (repo handler, eventScript 43 only)
- **One run at a time** for the oldest delivery still waiting. The next starts 1 s after a run that moved a job, 5 s after one
  that moved nothing (another save holds the stock), 15 s after a failed run (as slow as before) and 60 s after a run with
  no answer.
- **The same loop goes on after the 2-minute follow,** in the background, while the page stays on the list, until each job
  ends or 30 min pass (replaces the 15-s keep-following beat). Without a page location it runs only during the follow, as before.
- Its status reads ask for statuses only (no refused lines); the follow's read and the summary are unchanged.

## Tests
- Offline (`node <file>`): `scratchpad/gdc/gdcreate/test/test_convert_drain.js` 5/5 (new: pacing, oldest first, never two in
  flight, failure / no answer, leaving the list); `test_convert_keep_following.js` 8/8, `scratchpad/soautogd/test_client.js`
  10/10, `scratchpad/soautogd/shortfall/test_shortfall_client.js` 14/14, `test_convert_handler.js` 5/5. Three of them asserted
  the old pacing (one kick per job at the start) and were updated to the new rule.
- **Live, dev 10-29 11:57** (`scratchpad/gdc/deploy_so_drain/live_drain.mjs`, the real handler against the dev workflows, every
  timer as published): 10 SOs sharing stock (5 x ITEM-JOJO-3, 4 x 49 Repeating Item) -> 10 GDs, created at 5-56 s, one run
  at a time (4.4-5.4 s each, the next ~1 s after), all 10 created before the summary; no worker start after the last one.

## Paste
- **SO list page** `Sales Order`, id 1901872125787099137: paste `SO_list.prod_paste.json`, save, enable. Built on prod enabled
  v272 (10-28 21:09); only `/config/eventScript/43/func` differs.
- **Then:** `python3 verify.py` (enabled = the paste; per bulk convert since: GDs, last after, s per GD).
- **Rollback:** paste `SO_list.prod_v272_base.json`.
- Users get it after a full browser refresh (F5): an already-loaded browser keeps the old page.
