# LSH readiness for 2026-10-26 (heavy SO → GD → Picking → Packing → Complete volume)

The user wants the three sessions to coordinate so the 10-23 / 10-24 / 10-25 incidents do not happen again. LSH = tenant 128671,
organization 1996787068457861121.

**How we work:** each session owns its workflows and keeps ONE file in this folder. This README is the index, maintained by
"GD Completed & Created V2"; send it updates by message.

| Session | Owns | File |
|---|---|---|
| GD Completed & Created V2 | GD_ASYNC_* (create), GD_COMPLETE_*, GD_CANCEL_*, GD_REVERT_* (handed back by 42 after its budget fix), SO→GD convert, GD list bulk Complete / Cancel clients, gdc_list_mounted.js | `GD.md` |
| GD Edit & Picking V2 | GD_EDIT_*, PICKING_* (V2), Picking clients, GD form follow of EDIT jobs | `PICKING_EDIT.md` |
| Packing V2 | PACKING_* (V2), PACKING_SAVE (classic, used by LSH mobile), Packing clients | `PACKING.md` |
| PO GR Putaway V2 | PUTAWAY_ASYNC_* / PUTAWAY_BULK_* (V2), PUTAWAY_LOOP / PUTAWAY (classic), Putaway form + list, Putaway side of the mobile OTA | `PUTAWAY.md` |

Shared file: `Goods Delivery/GDonMounted.js` kicks several workers. Announce before editing it.

## Rules for prod

1. Only the user pastes prod or runs prod SQL. Each hand-off names the workflow AND its id. Several names differ by one word
   (PICKING_ / PACKING_BULK_COMMIT, GD_COMPLETE_ / GD_CANCEL_WORKER).
2. After every paste, check the target: `.dbtools/wf --prod deployed <repo file>` must say IDENTICAL.
   On 10-24 a paste landed in the look-alike workflow. `wf deployed` picks the workflow by shared node ids:
   `Putaway/AsyncV2/PUTAWAY_ASYNC_WORKER.json` resolves to PICKING_ASYNC_WORKER (79 shared ids), so compare that worker by id.
3. Before any paste: `python3 scratchpad/validate.py <file>`, a dry run on dev, and the paste file seeded from prod's live
   version (never from an old copy).
4. A finding that touches another session's area goes to that session at once, and into its file here.
5. Tomorrow: `python3 scratchpad/prod_health.py --tenant 128671` at least every hour, and after every paste.
   Each session also watches its own jobs.

## Open items (cross-session view)

| # | Risk for tomorrow | Owner | Dev | Prod |
|---|---|---|---|---|
| 1 | **Worker stall.** A worker run starts no new job after 20 s; an LSH job takes 25-30 s, so one job per kick, and nothing kicks once the page closes (no Quartz, user rule). 10-25: 3 GDs waited 51 min, 8 still queued. | GD | GD_COMPLETE_WORKER v7 (240 s, poll 10) and GD_CANCEL_WORKER v5 (240 s) done, smoke OK | **DONE**: GD_COMPLETE_WORKER prod v6 14:17:14, GD_CANCEL_WORKER prod v5 14:23:52, both IDENTICAL |
| 1b | Same 20 s budget in GD_EDIT_WORKER, PICKING_ASYNC_WORKER and PACKING_ASYNC_WORKER. **Not a stall on desktop:** their clients kick with job_id, so each run takes only its own job (prod: 76 CONFIRM_PICKING and 81 EDIT_GD jobs, all claimed within 0-5 s; 19 LSH COMPLETE_PACKING jobs, claimed within 0-8 s). Only id-less sweeps (list mounts, mobile V2 drain) are limited. GD_REVERT_WORKER: 0 REVERT_GD jobs on prod since 10-22. | Edit & Picking; Packing; GD_REVERT_WORKER: Edit & Picking (42), budget fix only, at the user's request | no change needed (Picking / Edit); GD_REVERT_WORKER v6 (240 s) live 13:26:13, idle smoke OK | no change needed; GD_REVERT_WORKER **DONE**: prod v6 13:33:32, IDENTICAL (42). GD_REVERT_* is back with GD. |
| 2b | **Edit vs cancel on a shared Picking.** GD Edit V2 pins the Picking's update_time while it holds it (is_processing = 1). A sibling GD's cancel writing that Picking (X5 token, X4P status) sends the edit to a false review. No lost data. **Agreed:** GD side only, so cancel's X4P / X5 wait while the Picking is held. E5 stays as it is until after 10-26. | GD | done in GD_CANCEL_COMMIT v7 (13:22:41): a held Picking makes X4P / X5 wait (counted retry) | goes with item 2 |
| 2c | GD Edit V2 E2 compares custom_fields by key. Only 502801 has GD line custom-field definitions; **not an LSH risk**. | Edit & Picking | GD_EDIT_COMMIT v12 live 13:18:45; smoke on 496474 GD/20261022/115 passed | **DONE**: prod v12 13:31:06, IDENTICAL (42) |
| 7 | **OPS-09 PO line dates.** PO_SAVE prod v23 is pasted and IDENTICAL; LSH lines since are dated. | Edit & Picking | done | **closed**: the user chose to skip the backfill (90 older LSH lines stay undated) |
| 2 | **Cancel of GDs sharing a Picking** goes to review (X5 whole-text rename; X4P header from a snapshot). GD-2610-1305 / 1308 / 1310 are held in Processing. | GD | **done, dev live tests PASSED:** GD_CANCEL_COMMIT v8 (13:36: also closes a header a sibling left Completed), GD_CANCEL_WORKER v5. 14:02, 496474 PI-20261021-0104: both cancels COMPLETED, header Cancelled with one suffix, both numbers renamed, all rows and reservations Cancelled. | **pasted, IDENTICAL:** GD_CANCEL_COMMIT prod v6 14:20:53 (+ item 2d's two). `resume_3_cancels.sql` + one GD list open: **pending (user)** |
| 2d | **Cancel reads grow with the square of the tenant's Picking / Packing rows** (an `IN (… UNION …)` subquery runs once per row; the Packing tables have no packing_id index). Prod 10:13: LSH's 2,100 Packing lines took 2.5 s alone, 7 s with 10 cancels; dev hit the 30 s statement limit (the cancel crashed in PREPARE). Tomorrow adds lines. Fixed: each id set is read once. | GD | GD_CANCEL_PREPARE v4 + GD_CANCEL_SUBMIT v4 (14:01), identical rows on 8 LSH GDs (prod read-only) and 3 dev GDs; Packing read 2.5 → 0.4 s, box 1.7 → 0.4 s | **DONE**: GD_CANCEL_PREPARE prod v4 14:24:41, GD_CANCEL_SUBMIT prod v4 14:25:11, both IDENTICAL |
| 3 | **Creation retries wait for a kick.** GD-2610-1324 took 13 min: 10 parallel SO conversions met LOCK_CONFLICT; the run retried twice (8 s sleeps, 45 s); the SO list re-kicked for only 2 min; the next run came 10 min after the retry was due. Fix: a lock conflict's retries finish in the run (6 passes, sleeps up to 30 s, 240 s). | GD | GD_ASYNC_WORKER v16 done, tests and smoke OK | **DONE**: GD_ASYNC_WORKER prod v13 14:17:52, IDENTICAL |
| 1c | PACKING_ASYNC_WORKER budget 20 -> 240 s (drain mode only; nothing tomorrow while mobile is classic). | Packing | v5 done (13:01) | **DONE**: prod v5 13:21:31, IDENTICAL |
| 4 | **Packing:** PREPARE froze the "every delivery of the SO is packed" decision. Two deliveries of one SO packed together could leave the SO unflipped (never seen on prod). Fixed: P4 re-reads the sibling deliveries at commit time. | Packing | PACKING_BULK_COMMIT v8 + PREPARE v7 (13:07), offline 13/13, **live run PASSED** 13:15 (PACK/20261021/0049: 3 SOs, 6 lines flipped) | **DONE**: PACKING_BULK_COMMIT prod v9 13:20:10, PACKING_BULK_PREPARE prod v7 13:20:56, both IDENTICAL |
| 4b | **Classic PACKING_SAVE** carries tomorrow's mobile load. Prod v32 = v58: 184 runs since the 10-24 restore, 0 failures, 6-17 s on average (max 34 s). It takes no stock locks, so it cannot leak any. | Packing | - | healthy |
| 5 | **Mobile moves to V2 by OTA (the user's call).** `hotfix/v2-background` (PR #663) moves the app's Picking, Packing and Putaway to V2 and adds the Item Assembly fixes. It is JS only and the update is forced. Review by sudu-mobile-expo-9a is done: Picking and Packing follow their jobs after QUEUED, kick the list once with no loop on `processed`, and have timeouts; the Putaway follower is in commit 2b9c7e55 (OTA eligibility exit 0). Until every phone updates, classic and V2 run side by side; classic PICKING_LOOP v89 and PACKING_SAVE respect V2 jobs. Classic and V2 still share no stock lock (MIN-01 classic lock OFF). Job keys: app `PKC:` / `PKF:` (colons), web dashes. | all; Putaway: PO GR Putaway V2 | app fixes committed and pushed (42) | merge + OTA: **user**. Putaway server side: **nothing to paste** (PO GR Putaway V2): prod = dev = repo for SUBMIT v5, WORKER v3, PREPARE v5, COMMIT v8, PUTAWAY_LOOP v19, PUTAWAY v35; worker stays 20 s (user's decision; mobile and the form kick by job_id); PUTAWAY_LOOP v19 answers "under processing" while a V2 job of the TO is open. LSH putaway volume is small (6 TOs on 10-23). |
| 8 | **Engine lock waits under concurrent SO → GD conversions.** This morning (11:40-11:45, 10 conversions) GD creation commits took 30-84 s, almost all inside INVENTORY_APPLY_OPERATION waiting in INVENTORY_LOCK_TOKENS (one run 47.9 s). Since 10-23: 8 lock-token runs over 50 s (max 96.5 s), all completed; no engine failure since the 10-23 incident fix. A throughput limit on shared materials, not a failure. | GD | - | mitigation live: GD_ASYNC_WORKER prod v13 (240 s, lock-conflict retries finish in the run). **Watch** creation latency and LOCK_CONFLICT counts. |
| 6 | `processed` in worker results counts SELECTED jobs, not done ones. Don't drive loops or reports from it. | each | | |

## Incident history (what must not repeat)

- 10-23: an engine precheck crash caused 30-min stalls (fixed: retry in 13 s, worker sweep).
- 10-23: balance-unit twins blocked GD creation; V2 GD create left picking_status blank; consumer claim-gate race;
  ATC_SYNC_SO zeroed SO planned_qty.
- 10-24: a "borrowed guard" pasted straight to prod by another dev (an update node with multiple top-level filters) overwrote
  11,000 step rows and leaked locks. Lint rules MULTIWHERE / IDIGNORED were added.
- 10-24: `%%` date formats in Packing / Picking V2 (fixed, lint PCTPCT).
- 10-25: the worker stall (item 1) and the shared-Picking cancel (item 2). BA report: LSH-GD-Investigation-20261025.
- 10-25: `IN (SELECT … UNION SELECT …)` in a sql-node is run once per outer row by MySQL (DEPENDENT SUBQUERY); wrap the UNION
  in a derived table (item 2d).
