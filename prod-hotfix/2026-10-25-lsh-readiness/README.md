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

**10-26 live monitoring (user's split):**
- **GD issues: GD Completed & Created V2**, covering creation, completion, cancel, revert, SO → GD convert, the GD list and
  form. It runs `python3 scratchpad/lsh_watch.py --minutes 25` every 15 min, read-only, ~3 s, and
  `python3 scratchpad/prod_health.py --tenant 128671` hourly.
- **Picking issues: GD Edit & Picking V2. Packing issues: Packing V2.**
- An alert outside your own area goes to its owner at once, with the job / run ids.
- Known Picking pattern (42): a CONFIRM_PICKING job in COMMITTING_PICKING with PK_STEP_RETRY. Two web Auto Pick jobs on
  Pickings sharing a GD collide; the retry recomputes correctly but waits for a PICKING_ASYNC_WORKER kick. Neither the GD
  list nor the GD form starts that worker: only a Picking list / form open does. Over 10 min stuck → 42.
  - 42 found the cause (10-26 ~06:55): the sibling job wrote the correct final status after ours, and our read-back compared
    against facts read before the sibling's P1.
  - Fix in progress on dev: PICKING_BULK_COMMIT P4's check accepts a read-back that equals a fresh recomputation. No new
    nodes; the true stale case still retries. Prod is the user's call.
  - The GD-list kick of PICKING_ASYNC_WORKER is on hold at 42's request.
- Packing runs its own watch every 2.5 min (`scratchpad/pkg_sweep/pkg_watch.py`).

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
   Each session also watches its own jobs. Its new BALANCE section flags any Reserved balance that disagrees with its
   movements (item 9's lost write) within the hour, before the GD's completion is refused.

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
| 9 | **GD-2610-1245 cannot complete** (4 failures, `GDC_INVENTORY_INSUFFICIENT`). 10-24 13:38: its classic Packing save's +5 Reserved at the Packing bin was overwritten by GD-2610-1180's V2 completion writing the same balance row (no shared lock: item 5). The ledger nets +5 at that bin; the balances read 0. The only Reserved mismatch across every LSH batch balance. Packing confirmed: both V2 engines (INVENTORY_APPLY_OPERATION for Packing, INVENTORY_BULK_APPLY for GD complete) take the same ITEM\|/BATCH\| keys in inventory_balance_lock via INVENTORY_LOCK_TOKENS and re-read under the lock, so V2 Packing and V2 GD complete are serialized. **Remaining exposure:** classic 1.1.34 phones until the forced OTA lands. The NOT_ELIGIBLE fallback to classic PACKING_SAVE is ~0 at LSH (0 of 46 prod SUBMIT answers since 10-20; no LSH Packing has a shape it refuses) and is KEPT for 10-26 (user's decision, per Packing; see PACKING.md). The BALANCE section of prod_health.py catches a lost write within the hour. | GD; Packing | repair done 14:40 (both rows 5 Reserved); LSH 0 mismatches (1,224 keys) | `repair.sql` **pending (user)**: `prod-hotfix/2026-10-25-lsh-gd1245-balance/`, then Complete GD-2610-1245 |
| 10 | **GD Completion V2 from the GD form never ran on prod.** The form sends `gd_ref_doc: []`; a GD without attachments stores `null`; SUBMIT counted that as an unsaved edit, so every form completion since 10-20 (~240, every tenant; LSH 21 of 25) went to the classic save, the lockless stock writer behind item 9. Fixed: an empty list / object counts as no value; real edits still go classic. | GD | GD_COMPLETE_SUBMIT v13 (15:19); tests pass; **live PASSED** (496474 GD/20260910/043 through the form path: QUEUED, COMPLETED, reservation Delivered, BALANCE OK) | **DONE**: GD_COMPLETE_SUBMIT prod v12 15:21:05, IDENTICAL. **Watch** the first LSH form completions: SUBMIT should answer QUEUED, and the job should complete. |
| 11 | **BA: queue continuation is kick-driven, with no backend dispatcher** (by design: no Quartz, user 10-14). LSH since 10-24: job_id kicks start in 1-5 s (Picking, Packing, Edit, GD create); 59 jobs were re-claimed after a crash or retry and finished. The gap is the GD list's bulk Complete (id-less drain that runs only while the page stays open): 33 of 250 COMPLETE_GD jobs waited over 5 min, the longest 2.4 h. | GD | GD list page v402 (dev): bulk Complete starts each queued GD's own worker run (job_id, up to 12) and then the sweep; an open GD list re-kicks the workers every 2 minutes. test_list_mounted 8/8, client_list_sim OK (both fail on the live scripts) | **DONE**: GD list page published on prod 19:52:24 (the designer numbered it v181), the only enabled version, identical to the paste file; the working copy matches. |
| 12 | **BA: two overlapping cancels on one Picking header can silently drop a rename** (X5 writes the whole text; each check sees only its own token). Reproduced: `scratchpad/gdcan/test/race_x5.js`. Display text only. Never happened at LSH (0 of 310 shared headers). | GD | **fixed**: every X5 write also renames the siblings that will end Cancelled (past X2 / X3, or Cancelled with the rename lost), so the last write keeps them all; no lock, no SQL. GD_CANCEL_COMMIT dev v9; race test, 33 cases, sims pass; **live PASSED** (dev 504 + 505: one write carried both renames) | **DONE**: GD_CANCEL_COMMIT prod v7 20:12:23, IDENTICAL. The NUMBERS check stays as a monitor. |
| 8 | **Engine lock waits under concurrent SO → GD conversions.** This morning (11:40-11:45, 10 conversions) GD creation commits took 30-84 s, almost all inside INVENTORY_APPLY_OPERATION waiting in INVENTORY_LOCK_TOKENS (one run 47.9 s). Since 10-23: 8 lock-token runs over 50 s (max 96.5 s), all completed; no engine failure since the 10-23 incident fix. A throughput limit on shared materials, not a failure. | GD | - | mitigation live: GD_ASYNC_WORKER prod v13 (240 s, lock-conflict retries finish in the run). **Watch** creation latency and LOCK_CONFLICT counts. |
| 6 | `processed` in worker results counts SELECTED jobs, not done ones. Don't drive loops or reports from it. | each | | |
| 13 | **Stock locks** (10-26). **(a) Freeze and slow TAKEs:** the platform holds a taken key until the whole top-level run ends. APPLY's parallel TAKE lanes broke the lock order (the 07:31 freeze), and worker runs kept keys through further jobs and retry sleeps (TAKEs of 2-9 min). **(b) False review:** the engine compared stored decimals at 8 places while the platform stores the tenant's 4 / 3 (GUB GD-26/10/0528). **(c) Claim herd:** 161 worker runs died on the claim insert, all from retry passes. | GD | INVENTORY_APPLY_OPERATION v15 (precision + one ordered TAKE), INVENTORY_OPERATION_RECONCILE v13, GD_ASYNC_WORKER v21 (one stock call per run, no retry passes); all tests pass; dev end-to-end PASSED (GD/20261026/625, /626). Next: the same rule for GD_COMPLETE / GD_CANCEL workers. Edit & Picking (42): one breach, id-less runs take up to 5 jobs; fix LIMIT 5 -> 1 in GD_EDIT_WORKER / PICKING_ASYNC_WORKER polls, building on dev; GD_EDIT_WORKER suggested with this paste batch (its own folder), PICKING_ASYNC_WORKER after peak. Packing: 0 runs with 2+ jobs today; its options are with its owner | **Pasted 11:06-11:15.** INVENTORY_OPERATION_RECONCILE v12, GD_ASYNC_WORKER v17, GD_EDIT_WORKER v9 and PICKING_ASYNC_WORKER v6 are live and IDENTICAL. INVENTORY_APPLY_OPERATION was rolled back to v12 at ~11:25 (v13 froze >25-key operations at give-back; see the incident history). **~12:05 engine v2 is LIVE** (prod v14 = `../2026-10-26-engine-v2/INVENTORY_APPLY_OPERATION.json`: price fix + TAKE and GIVE each one call; tested at 200 keys on dev). First real large operation passed: LSH PKG|2114570881056509953|1, 40 keys, one TAKE 3.6 s + one GIVE 3.7 s, all keys back. 42's workers (GD_EDIT_WORKER v9, PICKING_ASYNC_WORKER v6) in the hour after: 81 LSH Picking jobs all COMPLETED (max 19 s, 0 retries), 221 Picking + 388 GD Edit worker runs all Complete, no claim crash |
| 14 | **Purchase returns from Blocked / Reserved / QI refused as Unrestricted** (LSH PR-2610-0014; 27 LSH refusals since 10-17). PURCHASE_RETURN passed the category to GLOBAL_INVENTORY_VALIDATION as `" category"` (leading space), so the check fell back to Unrestricted. Refused attempts write nothing: no repair. | PO GR Putaway | PURCHASE_RETURN v17 (10:24) | **DONE, IDENTICAL:** PURCHASE_RETURN prod v17 10:27:46 (`../2026-10-26-prt-blocked-category/`; seen by the GD session's 17:50 check) |
| 15 | **GD Created V2 stored allocation quantities as text** (`"gd_quantity":"100"`, since 10-08; GD_BULK_PREPARE `code_node_egoCivrm`). KF's loading-bay Picking merge joined 5 × "100" into "100100100100100" and refused PICK-FG2610-160 (16:19); nothing was saved. Only KF has the loading bay on. | GD; Edit & Picking (42) | GD_BULK_PREPARE dev v21 (`Number()` at the writer; dev GD/20261026/631: 100 of 100 lines numeric). 42: PICKING_BULK_PREPARE v13 + PICKING v156 add as numbers; GD Edit V2 has no text path. | **DONE, IDENTICAL:** GD_BULK_PREPARE prod v21 17:13:13, PICKING_BULK_PREPARE prod v13 17:14:50, PICKING prod v82 17:15:38 (each replaced version equals its base; only the fixed nodes changed). Live: GD-26/10/0566, 0567 (900938) and JO-01162 (836238) store numbers, 12 of 12 stock lines; 0564 / 0565 before were text. Lines already stored as text stay (no SQL; readers tolerate them). Picking's live check: KF's next multi-bin loading-bay confirm. |
| 16 | **Empty Packings on the lists** (621 LSH Packings were GD Created V2 save-time shells). The user's decision: keep the shell, but hidden ("Waiting") until a Picking fills it. Removing it would leave Picking as the only creator, and two Pickings of one GD confirm within 2 s often (95 times / 29 LSH GDs since 10-25 15:22). | GD; Edit & Picking (42); Packing | GD_BULK_COMMIT dev v32 (P7A flips the shell to "Waiting"); 42: PICKING_BULK_COMMIT P5 + PICKING un-hide; Packing: desktop list + mobile filter, cleanup SQL. Dev e2e: GD/20261026/124 -> PACK/20261026/0067 "Waiting", then "Created" + filled after PI-20261026-0114 | **LIVE, IDENTICAL**, in order: Packing list page 19:52:02, PICKING_BULK_COMMIT v15 19:54:13, PICKING v83 19:55:24, GD_BULK_COMMIT v30 19:57:15. **Pending (user):** the mobile OTA, then Packing's cleanup (`../2026-10-26-empty-packing-shell-cleanup/`). Watch: prod_health.py PACKING-HIDDEN. |
| 17 | **GD Complete / Cancel freeze, 10-26 20:40-21:10.** A ~30-GD bulk Complete: two id-less GD_COMPLETE_WORKER sweeps each kept the keys of GDs they had completed (the platform holds a run's keys until it ends) and waited for each other's (GD-2610-1438 / 1263). It held until the lock expired (21:09:50). 1438, 1418, 1411, 1409, 1263 took ~32 min, the cancel of 1016 took 17 min; nothing lost. | GD | GD_COMPLETE_WORKER dev v8 + GD_CANCEL_WORKER dev v6: one stock call per run (as GD_ASYNC_WORKER v17). Tests: 14 offline; dev real-size bulk cancel of 9 GDs incl. two 100-line ones (140 s, one job per run, longest lock call 4.8 s); complete smoke GD/20261019/598 | **Pasted, IDENTICAL:** GD_COMPLETE_WORKER prod v7 00:43:49, GD_CANCEL_WORKER prod v6 00:43:05. GD_REVERT_WORKER prod v7 01:04:29, IDENTICAL. Dev v7 tested (one sweep reverted 1 of 2 due jobs; 1,999-line GD/20261022/119 in one run) |
| 19 | **GOODS_DELIVERY's GD Created V2 guards were not bound to the tenant** (found by Edit & Picking, 10-27). `sql_node_GdSoGuard` / `sql_node_GdUomGuard` read GD, job, item and unit rows by id alone, so a crafted save naming another tenant's ids got that tenant's status, job id or SO number back. Low risk: it needs exact ids. | GD | GOODS_DELIVERY dev v252 (02:53:35): every read takes the session tenant; 8/8 tests (v251 fails 3); a refused test save on dev | **DONE:** GOODS_DELIVERY prod v183 03:13:00 = 68's combined item 1, IDENTICAL; both SQL nodes carry the tenant filters (2 + 3, checked on prod). Record: `../2026-10-27-gd-guard-tenant/` |
| 20 | **A cost-lock seed race parks a GD completion for its 30-min lease.** Two runs seed the same new COST\|material\|plant key; the losing twin insert crashes the child, which fails the caller. Nothing is applied. Hit Kenhin GD 2097 (15:58) and LSH GD-2610-1473 (17:25) on 10-26. | GD | GD_COMPLETE_COMMIT v12, GD_CANCEL_COMMIT v10, GD_REVERT_COMMIT v7 (03:32): the engine call in a try-catch, a caught failure = a counted retry with the lease released (as GD_BULK_COMMIT since 10-23). 30/30 offline; dev forced crash PASSED (no 30-min lease); normal cancel PASSED. The one-stock-call worker fix is now in the builders too | **DONE, IDENTICAL:** GD_COMPLETE_COMMIT prod v12 03:41:50, GD_CANCEL_COMMIT prod v8 03:45:04, GD_REVERT_COMMIT prod v7 03:48:20 (`../2026-10-27-gd-commit-catch-engine/`). **Follow-up, not urgent:** `../2026-10-27-gd-commit-own-run-wait/` (wait out our own engine run, 16-try ceiling; dev v14 / v12 / v9): **DONE, IDENTICAL:** prod v13 04:16:11, v9 04:18:41, v8 04:20:55. GD_EDIT_COMMIT (Edit & Picking): the same fix, dev test PASSED 04:11 (GD/20261027/633, stock moved once); its paste is `../2026-10-27-gde-engine-catch/` (theirs) |
| 21 | **Auto-SI: a completion's result note can name another GD's invoice** (Kenhin GD 2093 recorded 2094's SI/20261026/0856; its own 0857 is right). Cause: GD_Convert_SI names its run cache `<user>:<date>:<HHMMSS>`, so two runs of one user in one second share it (proven: both runs used `...:155817`). The same key naming is in SO_Convert_SI / PO_CONVERT_PI, where it also holds the loop cursor. | GD | GD_Convert_SI v32, SO_Convert_SI v60, PO_CONVERT_PI v7 (03:04-03:05): a random tag per run; tests pass; dev two-run auto-SI test OK. SI_POST untouched (out of scope, user) | **DONE, IDENTICAL:** GD_Convert_SI prod v30 03:15:30, SO_Convert_SI prod v41 03:14:55, PO_CONVERT_PI prod v7 03:14:24 (`../2026-10-27-convert-cache-key/`) |
| 18 | **SO list Convert to GD: refused lines shown in detail** (bladexfunctions-68). Insufficient-stock lines show as a table (item, unit, quantities, shortfall); other line errors are listed. GD_SO_CONVERT_CHECK gains an optional job_lines read; callers without it get the same answer. | 68; reviewed by GD | GD_SO_CONVERT_CHECK dev v9 + SO list dev v536 | **DONE:** GD_SO_CONVERT_CHECK prod v9 00:31:27 IDENTICAL (checked by GD), SO list prod v262 (68). `../2026-10-26-so-convert-shortfall-detail/` |

## Recurrence sweep, 10-25 evening (GD session; prod, read-only)

**Code:** all 130 workflows LSH ran 3+ times since 10-23 are functionally identical on dev and prod. Three differ by one node,
all harmless:
- SO_Convert_GD and GD_Convert_SI: a function moved within the file;
- ATC_SYNC_MASTER_DATA: prod has the extra sub_tenant_id.

So no fix is stranded on dev. All 41 GD / Picking / Packing repo files match prod.

**Data (LSH now), all clean:**
- no GD stuck in Processing without a job;
- no Picking held 15+ min;
- no stale mobile Packing lease;
- no negative or inconsistent balance;
- Reserved = movements (1,224 keys);
- open GD lines all within SO planned (234 lines, 45 GDs);
- no open SO line with an invalid unit (324 lines);
- no duplicate GD / Picking / Packing / SO numbers;
- no open GD with a blank picking_status.

| Past incident | Fixed and live on prod | Can it recur at 2x? | Watch |
|---|---|---|---|
| 10-23 engine precheck crash, 30-min stall | yes: engine v12, worker sweep, retries | covered | CRASHES, JOBS |
| 10-23 case-twin units (AutoCount sync) | sync exact-match v61; unit guard in classic + V2 | no: 0 of 324 open SO lines affected | refusals GD_INVALID_UOM |
| 10-23 V2 create left picking_status blank | PREPARE v18 | no: 0 open GDs affected | - |
| 10-23 ATC_SYNC_SO zeroed SO planned_qty | ATC_SYNC_SO v63 no longer writes Sudu-owned fields | not seen since; 0 of 234 open lines | completion refusals "planned would become negative" |
| 10-24 V2 completion review + held locks (GD-2610-1100), classic collision | detection works (the engine refuses to write over a mismatch) | **yes, while classic phones remain** | JOBS review; OTA |
| 10-24 borrowed guard (unreviewed prod paste) | reverted | process: only the user pastes; every paste verified | MASS-WRITE |
| 10-24 `%%` date formats | fixed, lint PCTPCT | no | - |
| 10-25 worker stall | budget 240 s, per-GD worker runs, 2-min re-kick | no while a GD list is open | JOBS untouched 15+ min |
| 10-25 shared-Picking cancels + lost rename | X5 per-token + siblings | no | NUMBERS |
| 10-25 cancel reads quadratic | derived-table reads | no | - |
| 10-25 GD-2610-1245 lost stock write | repaired | **yes, while classic phones remain** | BALANCE; OTA |
| 10-25 form completions went classic | gd_ref_doc rule | no | - |

**Residual risks, in order:**
1. Phones still on classic 1.1.34: the only known source of stock repairs. Get the OTA onto every phone before the shift;
   a morning query can name any user still on classic PACKING_SAVE / PICKING_LOOP.
2. First prod use of tonight's client paths: the form V2 completion, and the GD list's per-GD runs + 2-min re-kick. Dev-tested;
   a zero-risk prod check is to open the GD list once.
3. Slower creations under stock-lock contention: slower, not failing.
4. Platform capacity at 2x has never been seen.
5. Areas not swept here: SO Save, accounting. Picking / Packing: their sessions' sweeps (requested 20:40).
6. **Packing sweep (Packing V2, ~21:00):** past incidents fixed and live (borrowed guard, `%%`, SO flip; over-pack is blocked
   at completion; the client double-tap fix has also been in the store app since 1.1.32 and is in hotfix/v2-background,
   per sudu-mobile-expo-f1). LSH leftovers all 0 (jobs, locks, boxes, totals 337 checked, reservations, stock in Cancelled
   Packings).
   **Not yet run on prod at all:**
   - mobile V2 itself (last device run: dev iPhone 10-16);
   - 9a's four new client fixes (no device run);
   - never even on a dev phone: the NOT_ELIGIBLE fallback, two devices on one Packing, a big Packing.

   So the OTA swaps the known classic-collision risk for a first real use. **Do one device run on prod right after the OTA,
   before volume:** an updated phone picks and packs one real LSH GD end to end.
   - **Update 10-26 06:45 (Packing):** the first prod mobile V2 Packing run already happened on 10-25 16:12-16:18. joseph
     completed 10 Packings on V2 (PACK-2610-1176..1185, 11-26 lines): all COMPLETED, 0 retries, 25-49 s, locks released.
     No classic Completed save at LSH since. That covers PACKING.md step 1; the double tap / 2 devices aren't visible in the
     data.
   - Packing script: `PACKING.md`, section "First prod device run after the OTA (before volume)". Small GD pack + Complete,
     a double tap, optionally 2 phones and a 1.1.34 phone as the second device.
   - Tell the Packing session when you start; it verifies each step within a minute.
   - The Picking half is asked of the Picking session (PICKING_EDIT.md).
7. **Morning check of phones still on classic:** `python3 scratchpad/lsh_classic_phones.py --since "2026-10-26 06:00"`.
   - It counts classic Packing completions: PACKING_SAVE with saveAs "Completed" only. Updated phones still call it for
     Draft / Created saves.
   - It counts classic Picking confirms: PICKING_LOOP with saveAs "Completed" + pageStatus "Edit". Created + Add is Convert to
     Picking, an office action.
   - It leaves out an updated phone's fallback right after a NOT_ELIGIBLE SUBMIT for the same Picking.
   - Validated on 10-24. **These 19 users ran the classic app that day, so their phones must update:** packers carmen, ally,
     vivian, lam, joseph, jay; pickers shan, kang, lim, faez, hao, soon, raymond, rex, wilson, khai, ganeson, hisham,
     syarif. On 10-25 only joseph.
8. **Picking / Edit sweep (42, ~21:10):** no incident can recur as it was. Prod = repo for PICKING v155, PICKING_LOOP v89, all
   PICKING V2 and GD_EDIT_*; every V2 run since 10-23 completed. LSH leftovers clean (6 checks); no IN-UNION SQL.
   - 300-GD class: classic fixes live. LSH Pickings have at most 11 GDs (1.8 on average).
   - Low: Convert to Picking has no cap; V2 Force Complete's facts read would time out at 270+ GDs.
   - **Guidance: keep each Picking at ~50 GDs or fewer.**
   - Classic phones wipe the Picking header's delivery_method (0 of 769 classic-confirmed LSH Pickings keep it; 50 of 88 V2
     do). That's data quality, not a blocker; it ends per phone with the OTA. The OTA's classic fallbacks send the full stored
     header (confirmed by sudu-mobile-expo-f1).
   - Device run: the Picking half (4 steps, PICKING_EDIT.md) goes first. It ends with the Created Packing that PACKING.md
     step 1 starts from.

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
- 10-26 (GD session): LSH convert bursts (28 SOs at 06:51, then waves of 20-50 to 08:20).
  - **Retry limit too low.** Each GD's stock call takes 33-81 keys for ~19 s, so GDs on shared products queue behind each
    other; 15 creations failed GD_TRANSIENT_RETRIES_EXHAUSTED (clean, SO re-convertible). Fix: max_retries 6 -> 20 -> 60
    (worker / reconcile prod v15 / v9) and 200 for P3 in GD_BULK_COMMIT.
  - **Frozen key-taking.** Five stock calls froze in INVENTORY_LOCK_TOKENS (platform atomic-count) at 07:30 and were killed at
    the platform's 20-min child limit (07:51). GD_BULK_COMMIT then moved to a new operation id and stranded 81 keys (33
    products). Released by `../2026-10-26-lsh-orphan-locks/repair.sql`. Fix: the same operation is retried, so RECOVER
    releases the keys (prod v25+).
    - **Root cause (GD session, 10-26 10:50, from prod run timings):** the platform keeps the atomic-count lock that
      INVENTORY_LOCK_TOKENS takes on a key until the TOP-LEVEL run ends (the worker run), not when the engine call ends.
      - A blocked TAKE gets through only when that whole run ends. Packing PKG|2114544577384943617|3 waited 99.7 s: through
        1.8 s after GD_COMPLETE_WORKER 2114544729973723137 ended, 15 s after its engine run had ended.
      - So a worker run that touched a key (taken or given back) blocks it for its whole life: up to 240 s, several jobs,
        retry sleeps. Today there were 82 TAKEs over 30 s and 35 over 2 min.
      - **Freeze:** a run that holds keys out of order waits for another run that waits for it. The lock has no timeout,
        so only the 20-min limit ends it. Two ways to hold keys out of order:
        - INVENTORY_APPLY_OPERATION's 9 parallel TAKE lanes (since 10-22). At 07:31, 1 of GD|2114497026472415234|11's 8
          lanes waited while its other lanes' keys blocked 4 GDs.
        - A second engine call in the same worker run.
      - **Fix (user's choice, item 13):** one ordered TAKE call in INVENTORY_APPLY_OPERATION, and one stock call per
        GD_ASYNC_WORKER run. Dev v15 / v21, prod paste pending. `scratchpad/lsh_watch.py` now alerts on a lock call running
        3+ min.
  - **Starvation.** Big old GDs never found all their keys free while newer GDs kept taking some; GD-2610-1470 waited 70 min.
    Fix: oldest waiting GD goes first (prod v28, `../2026-10-26-gd-commit-oldest-first-v3/`). v26 / v27 never fired: the
    platform drops sql-node columns not declared in the node's response_json.
  - **Rule:** adding a SELECT column to an existing sql-node means adding it to that node's response_json.
  - lsh_watch.py now alerts on a stock operation past its lease that still holds keys.
  - **Review polish, prod 09:35-09:40** (`../2026-10-26-gd-review-polish/`: GD_ASYNC_WORKER v16, GD_BULK_COMMIT v29,
    GD_JOB_RECONCILE v10):
    - oldest-first counts only VALID allocated rows with a location (charge lines made unrelated GDs queue);
    - retry limit 200 everywhere (worker / reconcile were 60);
    - a head with 30+ retries no longer blocks the queue;
    - timezone-free liveness (next_attempt_at / lease, DB clock);
    - a lazy, indexed check;
    - unrecorded call failures fail cleanly after 6 in a row;
    - one more same-operation recovery before review.
    Lint rule SQLCOLUMN added. Dev end-to-end run passed (GD/20261026/624).
- 10-26 GUB (900938): GD-26/10/0528 was held for review by a false VERIFICATION_MISMATCH. The engine compares the planned FIFO
  price (99.93685714) with the stored 4-decimal value (99.9369). Stock was applied correctly. Repaired by
  `../2026-10-26-gub-gd0528-review/repair.sql`; the GD was Created at 09:23. Any tenant could hit this when a FIFO cost has
  more than 4 decimals. **Fix (item 13):** the engine's checks compare at the tenant's number rule; dev v14, prod paste
  pending.
- 10-26 (GD session): **claim herd.** 161 GD_ASYNC_WORKER runs died on `Duplicate entry ... W0_CLAIM_<n>` (06:51-08:31), 154 on
  jobs waiting on stock locks: every tick retried the same 3 oldest jobs and woke with the others. **Fix (item 13):** only
  the run that claimed a waiting job last sleeps on it and retries it; dev v20, prod paste pending.
- 10-26 11:06-11:39 (GD session's mistake): **engine v13 froze >25-key operations at give-back.** v13 (the ordered-TAKE
  paste) took every key in one call but still gave keys back in parallel lanes, which cannot release keys the main call took.
  - Frozen until the 20-min limit: GUB GD-26/10/0544 (6 keys), PACK-2610-1434 (67), PACK-2610-1462 (7). Packings on those 27
    materials failed "stock stayed busy" (PACK-2610-1461, 1322, ...) and are redone after the all-clear.
  - Rolled back to v12. The keys came back by themselves when each run ended (11:30:36, 11:32:58, ~11:39); no SQL was needed,
    and no key ever held 2 tokens.
  - Tested on dev only with a 2-key GD, which never used the lane path. **Rule:** an engine change is tested at LSH sizes
    (more than 25 keys) before a prod paste.
- 10-26 ~12:20 (GD session, dev, the user's request): **big-GD contention test.** Two 100-line GDs on the same stock (100
  shared material+bin rows), converted together and kicked every 15 s like the SO list:
  - older 113 s; younger 223 s (about 110 s waiting in line, then its own ~110 s);
  - the younger made no stock call while the older held the stock: no lock conflicts, no retries;
  - each stock call took and gave back 200 keys in one call (~9-12 s each on dev); nothing stuck.
  - Test data: SO/20260901-001 + SO/20261026-059 (created by SO Save V2 for the test) -> GD/20261026/630 / 629.
  - Driver: `scratchpad/gdc/gdcreate/contention/run_contention.py`.
- 10-26 (Edit & Picking session, 42): **mobile V2 Picking is live on prod and healthy.** Since 07:10:45, LSH ran 288
  CONFIRM_PICKING jobs from the app (PKC:, 14 users) plus 3 from the web. All COMPLETED, longest 29 s, no failure, review or
  stuck job. The OTA reached the pickers before 07:10, so real traffic replaced the planned first device run (item 5).
  - PACK-2610-1012: its 2 lines were written by an app V2 confirm's P5 at 10:57:49.9. A stale-copy classic PACKING_SAVE from
    carmen's phone wiped them at 10:59:04. The fix is the Packing session's.
- 10-26 (PO GR Putaway V2 session): LSH PR-2610-0014 could not be completed ("Insufficient stock ... (Unrestricted).
  Available: 0" for stock chosen from Blocked). Cause: a parameter named `" category"` in PURCHASE_RETURN, there since at
  least July. **Fix (item 14)**: live on prod since 10:27:46 (PURCHASE_RETURN v17, IDENTICAL).
- 10-26 17:25 (GD session): **a lock-seed twin crash parked GD-2610-1473 (15 lines).** A bulk Complete started 12
  COMPLETE_GD runs at 17:24:55, and two of them created the same first-use COST|2113378775130578954|<plant> lock row.
  - The loser's INVENTORY_BULK_APPLY caught the duplicate and answered LOCK_BUSY, with nothing taken or moved.
  - But the caught error still failed GD_COMPLETE_COMMIT and GD_COMPLETE_WORKER, so the job sat on its 30-min lease with the
    GD in Processing.
  - Ended by `../2026-10-26-gd1473-dead-lease/release_lease.sql` (the user, 17:47:00). Re-claimed 17:47:57, the stock applied
    once, and the job COMPLETED at 17:48:32. Health after: BALANCE, GD-STOCK and LOCKS OK.
  - Same crash at 15:58 (tenant 528521). It is the known residual of the 10-16 COST-lock fix. **Fix after the peak:** a twin
    seed must not fail the caller.
