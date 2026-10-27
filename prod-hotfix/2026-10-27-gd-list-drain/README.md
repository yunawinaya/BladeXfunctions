# 2026-10-27 GD list: drain the V2 workers instead of one job per 2 minutes

**Status:**
- **Dev:** LIVE on GD list page v403 (15:28). The live test passed at 15:30:55-15:31:39.
- **Prod:** LIVE on v193 (16:24:25), verified.
  - `mounted` equals `mounted.js`.
  - Against v192: the designer dropped one EMPTY `onFormChange` entry (no code, no rules). Every other event script, the layout, the columns and the config are identical.
  - Open GD lists get the new code when they reload.

**Paste (one handler only):**
- **Where:** in the prod designer, open the Goods Delivery list page (1902688873696313346).
- **What:** replace the event script `mounted` with `mounted.js` from this folder. Change nothing else: v192 carries other people's column changes.
- **Rollback:** paste `mounted.prod_base.js` back.
- **After the paste:** I compare the enabled page's `mounted` with `mounted.js`. Users with the GD list open get the new code when they reload it.

## Why (Kenhin 528521, 10-27)
- **What happened:** 14 GDs (GD/20261027/2162-2170 and 2195-2201) sat in Processing from 14:30 / 14:50 until about 15:19. Their Pickings were Completed, but their GD completions were queued and never started. They were cleared by opening each GD by URL.
- **Why the safety net didn't catch it:**
  - The GD list is the safety net. It starts every V2 worker when the list opens and every 2 minutes, and was meant to chain up to 40 runs while work is left.
  - On prod it never made a second run after a run that did work: none at Kenhin all day, for the create and the complete workers alike. The same holds on dev.
  - Each worker run does one stock call, so it completes one GD. One open list therefore cleared one GD every 2 minutes.
- **The cause:** the old chain started the next run inside the run's answer, right beside `this.refresh()`, and that run never went out.
  - The platform's `runWorkflow` silently drops a call while runs are disabled, and a callback error goes to the error handler, which only logged.
  - The dev test shows the answers do arrive (3-s gaps, not the 60-s fallback). So the immediate re-run beside the refresh was the broken step.

## The change (`Goods Delivery/CompleteV2/gdc_list_mounted.js`)
**Each kick drains its worker:**
- **Pace:** one run at a time. The next one starts 3 s after a run that moved a job, after the list refresh.
- **When it ends:**
  - A run moved nothing. Moved means one of its jobs left the state it was read in; `processed` counts jobs read, not moved, so a blocked queue no longer means 40 fast runs.
  - Or after 40 runs, or 3 failures.
  - Or when the page leaves the list.
- **No answer in 60 s:** the next run starts anyway.
- **One drain per worker per window:** a beat beside a running drain adds nothing. A re-mounted list hands the running drain its own page.
- **Unchanged:** the 2-minute throttle per browser, the 2-minute beat, the six workers, and the outbox consumer's DONE rule.

## Tests
**Offline, `scratchpad/gdc/test/test_list_drain.js`:** 14 cases on a fake clock, against the real file in a simulated list page.
- **The old script:** stalls at one job per beat both when the run beside the refresh is dropped and when answers are lost.
- **The new script:** drains in both cases, and also with a 5-s drop window (via the 60-s fallback) and with a throwing refresh.
- **The guard rails:** it stops after 3 failures, stops on leaving the list, keeps one run at a time beside beats and re-mounts, stops a blocked queue after one run, caps a drain at 40 runs, and ends an idle queue in one run.

**Live on dev:**
- **Setup:** 5 GD Cancel V2 jobs were queued with no worker started (GD/20261027/635-638 and 641, test GDs). The user opened the dev GD list once (tenant 000000).
- **Result:** all 6 workers started at 15:30:55. The cancel worker then ran 15:30:55, 15:31:04, 15:31:13, 15:31:22 and 15:31:31, each about 5 s, one at a time. An IDLE run at 15:31:39 ended the drain.
- **In short:** 5 jobs in 40 s, where the old code needed about 10 minutes.

**Related (42, Picking V2):** the Picking screens poll STATUS and start the GD completions themselves. An open Picking list also sweeps GD_COMPLETE_WORKER every 60 s. The two overlap harmlessly through the worker's claim gate.
