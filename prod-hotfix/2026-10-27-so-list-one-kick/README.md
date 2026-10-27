# 2026-10-27 SO list Convert to GD: one worker run per re-kick (no more red "CLAIM GATE" toasts)

**Status:**
- **Dev:** LIVE on SO list v539 (16:33), handler only; the rest of the page equals v538. Live test passed.
- **Prod:** LIVE on v269 (16:43:48), verified. `func_handleConvertGD` equals `func_handleConvertGD.js`. Only the handler
  changed against v268: every other event script, the config and the layout are identical. Open SO lists get it when
  they reload.

**Paste (handler only):**
- **Where:** in the prod designer, open the Sales Order list page (1901872125787099137).
- **What:** replace the event script `func_handleConvertGD` with `func_handleConvertGD.js` from this folder. Change nothing else.
- **Rollback:** paste `func_handleConvertGD.prod_base.js` back.
- **After the paste:** I compare the enabled page's handler with `func_handleConvertGD.js`.

## Why (LSH 128671, 10-27)
- **What users saw:** red toasts on the SO list, "An error occurred: 节点[CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> ...] ... Duplicate entry '128671-<job>-W0_CLAIM_27'". LSH's converting user got 34 bursts in 40 minutes, up to 5 at once.
- **What it is:**
  - The worker's claim gate. Two worker runs reached the same job at the same instant, and the second one's unique insert failed.
  - That run stops before writing anything, and the platform shows any failed run as a toast to whoever started it.
  - Nothing is damaged: the jobs went on normally.
- **Why so many:** after converting, the list re-started EVERY waiting job, one run per job: every 5th poll in the 2-minute follow, then every 15 s in the background (v268). In a batch sharing stock, most jobs wait. Each run also takes other due jobs when its own is not due, so these runs collided with each other.

## The change (`Goods Delivery/GDhandleConvertSOtoGD.js`)
- **Re-kicks, follow and background:** one run per re-kick, for the oldest waiting job. The run goes on to the other due jobs.
- **The first kick:** still one run per queued job. Every job is due then, and each run claims its own.
- **The status check:** one that never answers is given up after 20 s, so the follow goes on (before, it would have waited forever).

## Tests
- **Offline:** 68's suites pass, 14 + 10 + 5.
- **`scratchpad/gdc/gdcreate/test/test_convert_keep_following.js`:** 8 cases, stable over 12 runs.
  - New cases: one run per background beat, for the oldest waiting job; the follow starts every job once, then re-kicks one run; a silent check is given up and the beats go on.
  - The v268 handler fails the one-run case: it kicked J12, J13, J14 on every beat.
- **Live on dev** (`scratchpad/gdc/deploy_so_follow/live_keep_following.mjs`: the real handler, follow shortened to 20 s, 4 SOs sharing stock):
  - The convert queued 4 jobs, and each was kicked once. 2 were created at once (GD/20261027/645, 646).
  - After that, every re-kick was one run: at 16.8 s inside the follow, then the background beats at 23.0 s, 41.7 s and 56.7 s.
  - Those beats created the other 2 (643, 644), then went quiet.
  - In total: 8 worker runs, 0 failed.
