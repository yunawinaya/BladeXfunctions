# 2026-10-28 21:33 → 10-29 07:55 GD V2 workers stuck on "script for node[...] is not loaded" (prod, again)

**Status:** NOT pasted, and not needed now. Prod's backend restart at 10-29 07:54:24 cleared it; all six GD workers have run
clean at every tenant since 07:55. The pastes stay here as a ready kit: if a worker sticks again, paste only that one.

## What happened
- **Four events, each changing which workers were stuck** (MYT; the 21:31:41 and 07:54:24 restarts are from the status
  endpoint's uptime, the other two from when runs flipped between Fail and Complete):

| From | Stuck | Fine |
|---|---|---|
| 10-28 21:33:34 (restart 21:31:41, two clean rounds first) | ASYNC, consumer, COMPLETE, CANCEL, REVERT | EDIT |
| ~23:24 | CANCEL, EDIT | ASYNC, consumer, COMPLETE, REVERT |
| ~02:19 | ASYNC, consumer, REVERT | COMPLETE, CANCEL, EDIT |
| 07:55 (restart 07:54:24) | none | all six |

- **Probably more than one prod backend instance.** The run history has no gap at any of these times, not even at the
  confirmed 07:54:24 restart (52 runs that minute). Uptime Kuma saw no prod down beat. `server_ip` is empty on prod, so the
  instance count and the restart cause are only visible to the server owner (docker restarts, OOM, deploys).

## Impact
- **10 LSH GD creates waited 63-97 min:** one user, submitted 06:19-06:52 (4 from the GD form, 6 SO conversions), created
  07:55:44-07:56:20 as GD-2610-2236 … 2245. All COMPLETED on the first attempt, one GD per SO, no duplicates.
- **Their Pickings are "Not Created", as for every LSH GD:** LSH's GD→Picking events all end with result NONE (588 since
  10-27); the Pickings are made later (on 10-28, 70 of 333 V2 GDs were still Not Created).
- **Nothing else waited:** the 4 COMPLETE_GD jobs started after 23:58 (worker fine), the 2 EDIT_GD at 08:03, and no cancel,
  revert or other tenant's GD job. No open job, no GD in Processing (08:28).

## The kit (`rename_stuck_nodes.py`)
Each file is the enabled prod version with only the stuck node's id renamed everywhere it occurs. The builder asserts that
renaming it back gives the deployed version exactly; the workflow linter's findings are the same before and after.

| Workflow | Id | Paste | Base (= prod = dev, 10-29 08:29) | Rename |
|---|---|---|---|---|
| GD_ASYNC_WORKER (GD create) | 2104840667119411201 | `GD_ASYNC_WORKER.json` | v19 | 1OvNTk9G3 → 1OvNTk9G4 |
| GD_PICKING_OUTBOX_CONSUMER (GD → Picking) | 2105134245397041153 | `GD_PICKING_OUTBOX_CONSUMER.json` | v15 | 3wpgxjXW4 → 3wpgxjXW5 |
| GD_COMPLETE_WORKER | 2110182645714518018 | `GD_COMPLETE_WORKER.json` | v7 | GWguard3 → GWguard4 |
| GD_CANCEL_WORKER | 2112455700319932418 | `GD_CANCEL_WORKER.json` | v7 | XWguard3 → XWguard4 |
| GD_REVERT_WORKER | 2112758130420088833 | `GD_REVERT_WORKER.json` | v8 | RWguard4 → RWguard5 |
| GD_EDIT_WORKER | 2110618789356687361 | `GD_EDIT_WORKER.json` | v10 | GEWguard2 → GEWguard3 |

**Which one to paste:** `python3 watch_stuck.py` (read-only) checks every 2 min and, on the first stuck run, names each stuck
workflow and its paste, or says the workflow changed since the build (re-run `rename_stuck_nodes.py` first).

**How:**
- In the prod designer, open the workflow by its id, replace the JSON with the paste file, save, and enable.
- **One at a time, about a minute apart,** so each new version's first run happens alone.
- **Rollback:** paste the `.base.json` back. That brings back the stuck id, so only do it if a paste breaks something else.
- **Then:** `python3 verify.py` shows, per workflow, whether the enabled version is the paste and its latest runs.
- **Repo / dev parity after a paste:** a dev→prod promotion must not bring the old id back while prod still runs the JVM that
  stuck it; carry the new id into dev and the builders before any promotion.

## Since (10-29)
- **Server-team report:** `server_team_report.txt` + Chinese `server_team_report.zh.txt` (also one page with both, switch at the
  top, `#zh` / `#en` links: https://claude.ai/artifact/CJZP38BEtpFr1k5nYm6iJH).
- **Prod GD list page v195 (07:51:40, not from this repo):** the background kick now takes turns, one worker run at a time,
  3 s apart, instead of six at once. Dev (v404) and the repo `Goods Delivery/CompleteV2/gdc_list_mounted.js` still have the
  parallel kick, so a promotion or a GD list paste from dev would undo it.
