# MIN-01 B1 (classic children take the engine's ITEM token): DEV test log

Builders: `build_subtract_lock.py`, `build_add_lock.py` (bases in `../base/`, outputs in `../out/`). Requests and raw
responses: `../test/b1/`. Runs are one-off doTest runs of the built JSON (`runas.mjs ... --test <out json>`), nothing published,
as admin@000000. Item JN-TEST-01 (2049734383547097089), plant 1123598813738675202, org 1123598813738675201; bin A
2034476113458442241 (lock row 2110588423321849862), bin B 2019332620681957377 (no lock row before T2). Every move is a
1-unit Unrestricted category move (isMovingInv 1, no costing).

## SUBTRACT_INVENTORY, 22 Oct 15:44-15:51 (user yes)

| Test | trx_no | Result |
|---|---|---|
| T0 OFF control | MIN01-OFF-1 | 200; `code_node_CLkey` on NO; unlocked path; bin A 61 -> 60 |
| T1 locked | MIN01-TEST-1 | 200; claim TAKE, verify owner = CL|c3fe31e1e7814fdc, recompute 60 -> 59, re-verify OK, release; lock row token 1, owner '', last owner CL|c3fe..., lock_version 21 -> 22; movement written after the release |
| T2 locked + seed | MIN01-TEST-2 | 200; needSeed YES, INVENTORY_LOCK_SEED created lock row 2113175161186222081 (ITEM, token 1); take, write, release (lock_version 1); bin B 36 -> 35 |
| T3 4 calls, separate processes | MIN01-TEST-C1..C4 | all 200; they did NOT overlap (launched ~1.6 s apart, each ~200 ms): correct, but not a concurrency result; bin A 59 -> 55, lock_version 26 |
| T4 burst, one process (`runas --also`) | MIN01-TEST-D1..D4 | all four started within 8 ms, all read token 1 and routed TAKE; all 200; bin A 55 -> 51 (no lost update), lock_version 30, token 1 |
| Restore | MIN01-RESTORE-A / -B | published ADD_INVENTORY v65: +10 bin A, +1 bin B; back to 61 / 36; 11 OUT + 2 IN movement units net 0 |

**What T4 shows (node timings in the four runs):** the four takes queued. D4's verify ran at +63 ms; D1's verify only at +348 ms,
after D4's run ended (+227 ms); D3 at +666 ms after D1's end; D2 at +946 ms after D3's end. The platform's atomic-count node holds
its row lock until the holder's run ends, so concurrent classic calls on one key wait for each other instead of answering busy,
and each reads fresh rows after its wait. The last of four waited about 0.9 s.

## ADD_INVENTORY + mixed burst + crash test, 22 Oct 15:54-15:58 (user yes)

Bin C = A1-B2 2018912875841613825 (no balance row, no lock row before A2). Requests / responses: `../test/b1add/`.

| Test | trx_no | Result |
|---|---|---|
| A0 OFF control | MIN01-OFF-A0 | 200; on NO; unlocked path; bin A 61 -> 62 |
| A1 locked | MIN01-TEST-A1 | 200; TAKE, verify OK, cloned balance block (update), release (lock_version 31), movement, Data ID; bin A 63 |
| A2 locked, new balance row | MIN01-TEST-A2 | 200; seed YES (lock row 2113177256316567553), TAKE, balance row missing -> `add_node_MmpuGQaoCL` created it under the key, release; bin C 0 -> 1 |
| A3 mixed burst (`runas --also` per-request workflow) | M1, M2 ADD +1; M3, M4 SUBTRACT -1 | all four started within 81 ms, all TAKE, all 200; bin A 63 -> 63 (net 0, no lost update); lock_version 35; 2 IN + 2 OUT |
| X1 crash after the take (test-only copy: `code_node_CLvf2c` throws) | MIN01-TEST-X1 | run status Fail, errorMsg = the thrown text; **the take was NOT rolled back**: lock row token 0, owner CL|82859ce9a4aa40f2; balance unchanged 63, no movement. Freed with one guarded dbw UPDATE (user yes): token 1, owner '', last owner = that op, lock_version 36 |
| Restore | MIN01-RESTORE-A2 / -C1 | published SUBTRACT_INVENTORY v59: -2 bin A, -1 bin C; final bin A 61, bin B 36, bin C 0; MIN01-* movements net 0 (16 OUT / 16 IN units); no held lock row on the item |

**What X1 means:** any failure between the take and the release (a node error, a platform restart, a "script for node is not
loaded" first run after a restart) strands the key: every engine run on that material + bin then answers 409 LOCK_BUSY and every
locked classic call 400 busy, until the row is cleared by hand. Before ON: a stale CL| key query + guarded repair, and not at a
restart (the promotion).

## Published OFF: SUBTRACT_INVENTORY v60 / ADD_INVENTORY v66, 22 Oct 16:00 (user yes)

Base guard SAME (v59 / v65), wf_upload backup + read-back. Smoke through the published versions (trx MIN01-SMOKE-S / -A, bin A,
net 0): both 200; `wf trace` of the SUBTRACT run shows `code_node_CLkey` on NO and the original exit node. Bin A 61.

Owners' OFF-path smoke tests (reported to 9d):
- **Stock Adjustment** (from session 05, 16:02, DEV 496474, their user's yes): twin T1 run, PASS. A 7-line / 9-entry document (FIFO, WA, batch,
  alternate UOM, In + Out on one key) was completed twice: classic STOCK_ADJUSTMENT v25 (SA 2113179093971173377, 5 ADD + 4 SUBTRACT
  calls into v66 / v60) and SA V2 (job 2113179184773660673). Deltas identical in all 11 tables; 0 lock rows held; every child run
  Complete. Kit: scratchpad/sav2/live.
- **Item Disassembly** (from session 97 / 8c, 16:02, DEV 000000, their user's yes): classic IDA_SAVE v7, PASS. IDA-2610-015 (2113179222006497282)
  Add -> Completed, 200 in 2.9 s: 1 source pick out (ITEM-0035, FIFO) + 4 recovery lines in (typed batches, alternate-UOM line at 0.0769
  per base PCS). Reconcile RECONCILED (15 ok, 2 info); 'IDA' calls, unit_price and batch_number passed through unchanged.
- **GR / Putaway / GR revert** (from session cf / 56, 15:56-16:08, DEV 000000, their user's yes): all 3 PASS, every child run on the OFF path
  (code_node_CLkey only), all Complete. Document PO/20260907/003, 2 FIFO lines of 5 each (TES510 / TES511).
  1. Classic GR Completed (GOODS_RECEIVING v104): GR/202610220024, auto TO TRF-PA-20261022-0022, 2 ADD (GRN IN In Transit at the loading bay).
  2. PUTAWAY_LOOP v19 (mobile path): 2 SUBTRACT (In Transit) + 2 ADD (Unrestricted).
  3. GR_REVERT_COMPLETED v8: 200, 2 SUBTRACT (GRN-R).
  Every item / bin / category nets to 0 over the 8 movements. Requests in scratchpad/pi2k/min01/.
- **Location Transfer** (from session 83 / 2e, DEV 711077, their user's yes): ALL PASS, snapshot exact. Classic SM_LOCATION_TRANSFER v85 with web-form
  payloads, A1-01 -> MBA, plain FIFO items 2105492402287841324 / ...325 / ...327 (layer 71.5) and 2105488759446736897 / ...898 (layer 0).
  - Covered: DIRECT LOT-20261022/0009 (the main pair); STAGE, Edit qty +1, Completed LOT-20261022/0010 (the recon pair ran exactly once for
    the +1); STAGE, list Cancel LOT-20261022/0011-Cancelled (the cancel pair); restore LOT-20261022/0012.
  - All 26 child runs Complete (116-227 ms), each `code_node_CLkey` on NO; no lock row was taken, seeded or changed.
  - Every ADD's unit_price equals its SUBTRACT's. Balances show 0 differences vs the snapshot (5 zero-quantity rows added at MBA), and the
    FIFO layers are identical.

## Classic GD children SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW (build_new_lock.py), 22 Oct 16:06-16:10 (user yes)

One-off runs of the built JSON, admin@000000, JN-TEST-01 bin A. Requests / responses: `../test/b1new/`.

| Test | trx_no | Result |
|---|---|---|
| N0 OFF control (SUBTRACT_NEW) | MIN01-OFF-N0 | 200; on NO; unlocked path; 61 -> 60 |
| N1 locked SUBTRACT_NEW | MIN01-TEST-N1 | 200; TAKE, recompute 60 -> 59 under the key, re-verify, write block, release (lock_version 37), post block (movement + costing) |
| N2 locked ADD_NEW | MIN01-TEST-N2 | 200; TAKE, verify, write block (cloned Balance branch read + update), release (38), post block; 60 |
| N3 mixed burst | N3A / N3B SUBTRACT_NEW -1, N3C / N3D ADD_NEW +1 | the two ADDs took the key first: 200, 200. The two SUBTRACTs, whose claim reads ran while an ADD held the token, answered **400 busy** ("Stock of this item at this bin is being updated by another document. Please try again."): clean refusals, status Complete, nothing written. Bin A 60 -> 62 (= +2 applied, no lost update); lock_version 40, token 1 |
| Restore | MIN01-RESTORE-N | published SUBTRACT_INVENTORY_NEW -1 (the refused subtracts made the net +1, not -1): bin A 61; all MIN01-* movements on the item net 0 (20 OUT / 20 IN units); no held lock row |

**Published OFF 16:09 (user yes):** SUBTRACT_INVENTORY_NEW v26, ADD_INVENTORY_NEW v19 (base guard SAME v25 / v18; backups by
wf_upload). Smoke through the published versions (MIN01-SMOKE-NS / -NA, net 0): both 200; `wf trace` shows `code_node_CLkey` on NO
and the original exit `return_node_V7eq9lyR`; bin A 61.

## A1 IA floor guard (build_floor.py) on SUBTRACT_INVENTORY v60, 22 Oct 16:17-16:21 (user yes)

One-off runs, admin@000000, JN-TEST-01 bin A. `floor_SUBTRACT_INVENTORY.fakehold.json` = test copy whose hold query returns one fixed
5-unit hold ("IA-FAKE-HOLD-TEST"). Requests / responses: `../test/floor/`. Setup (published v60 / v66): Unrestricted 3 -> Reserved.

| Test | Build | Call | Result |
|---|---|---|---|
| F1 refuse | fake hold 5 | Reserved -1, MIN01-TEST-F1 | **400** "Reserved stock of this item at this bin is held for Item Assembly IA-FAKE-HOLD-TEST (5 held, 3 reserved). Release it from the Item Assembly first."; gate on, held 5, after 2; nothing written |
| F4 switch OFF | fake hold 5 | Reserved -1, MIN01-OFF-F4 | 200; gate on NO (ordinary trx); R 3 -> 2 |
| F3 IA exempt | fake hold 5 | Reserved -1, transaction_type IA, MIN01-TEST-F3 | 200; gate NO (IA exempt); took the classic lock (MIN01-TEST hook); R 2 -> 1 |
| F2 pass-through | real | Reserved -1, MIN01-TEST-F2 | 200; gate YES, held 0, refuse NO; locked path; R 1 -> 0 |
| Restore | published v66 | Unrestricted +3 | U 61 / R 0 / balance 61; MIN01-* movements net 0 per category (Unrestricted 24/24, Reserved 3/3); no held lock row |

**Published OFF 16:15 (user yes):** SUBTRACT_INVENTORY v61 (A1) and SUBTRACT_INVENTORY_NEW v27 (A2), base guard SAME (v60 / v26).
Smoke through the published versions (MIN01-SMOKE-FS / -FNS, each added back with v66 / v19): all 200; `wf trace` shows
`code_node_FLgate` on NO and `code_node_CLkey` on NO (1-2 ms each), original exits; bin A 61. Run times 1.2-2.0 s vs ~0.4 s an hour
earlier, but the untouched ADD_INVENTORY v66 was equally slow: dev load, not the new nodes. A2's ON path is not run (same code as A1).
Note: every subtract call runs code_node_FLgate once; only Reserved subtracts that are not type IA read the holds.

## ON readiness, 22 Oct 16:23-16:35 (user: "ON readiness")

**Queue test** (`build_queue_test.py`, test-only copies of v61; `../test/queue/`):
- Setup: holder `qtest_holder.json` (spins 2 s after its take); two late callers `qtest_late.json` (spin 0.6 s before the claim; claim
  routes TAKE when token 0 is held by a CL| owner), fired together.
- Both late claims read token 0 owned by the holder (CL|ff77ef1b01464c36), routed TAKE, and waited. Their verify ran only after the
  holder's run ended (holder return +2517 ms; late verifies +2687 / +3126 ms).
- All three 200; bin A 61 -> 58 (no lost update); lock_version 42 -> 45. Restored +3.
- So the take reads the row FRESH after its wait (not the stale snapshot the atomicCount doc warns of), and queueing behind a classic
  holder is safe.

**Refined claim** (`build_queue_claim.py` -> out/q_*.json, from the live v61 / v66 / v27 / v19; `../test/qclaim/`):
- One locked call through each of the four children (MIN01-TEST-R1..R4): all 200, net 0.
- Mixed burst on the GD children (B1 / B2 SUBTRACT_NEW -1, B3 / B4 ADD_NEW +1): both subtract claims read token 0 held by an ADD
  (CL|7a1cc1376a784468) and queued; **all four 200** (the same collision gave two 400 busy in N3). Bin A 61 -> 61; lock_version 53.

**A2 ON path** (floor in SUBTRACT_INVENTORY_NEW; `../test/floor2/`; setup Unrestricted 2 -> Reserved):
- G1, fake hold 5: **400** "...held for Item Assembly IA-FAKE-HOLD-TEST (5 held, 2 reserved)...", nothing written.
- G2, real v27 build: held 0, passed, R 2 -> 1.
- Restored: U 61 / R 0 / balance 61; MIN01-* movements net 0 per category; no held lock row.

**Refined claim published OFF 16:28 (user yes):** SUBTRACT_INVENTORY v62, ADD_INVENTORY v67, SUBTRACT_INVENTORY_NEW v28,
ADD_INVENTORY_NEW v20 (base guard SAME v61 / v66 / v27 / v19). Smoke through each published version (MIN01-SMOKE-Q*, net 0): all 200,
`code_node_CLkey` on NO, original exits, 231-344 ms; bin A 61.

**Owners' re-runs against the current children (requested 16:45):**
- **Classic GD** (from 3f, their user's yes): PASS. SO_AUTO_GD converted SO/20261008/019 (496474, 60 lines) classically to GD/20261022/117 Created,
  16:36-16:37. Runs: GOODS_DELIVERY 1, GLOBAL_ALLOCATION 60, GD_UNUSED_FN_NEW 2, SUBTRACT_INVENTORY_NEW v28 60, ADD_INVENTORY_NEW v20 60,
  all Complete. Data: 60 OUT Unrestricted + 60 IN Reserved and 60 Allocated reservations. On all 57 keys, reserved_qty = the open
  reservations; nothing negative. Not covered: the classic Completed path and batch items.
- **SA twin T1** (from session 05, 16:38, 496474, their user's yes): PASS on v62 / v67. 9 of 11 tables identical. The 2 that differ (fifo, one
  movement) are an alternate-UOM Out of 10 PCS whose FIFO layer had 14 left: the classic took 10 @ 5, then V2 took 4 @ 5 + 6 @ 6. The
  engine's planner predicts exactly those numbers from each twin's start snapshot. 0 locks held. Classic STOCK_ADJUSTMENT v27
  now has the owner's own pre-write lock check, and it passed live.

## Classic GD pre-check (build_gd_precheck.py) in GD_UNUSED_FN_NEW v55, 22 Oct 16:38-16:42 (user yes)

Inserted before `IF Check Only`, so GOODS_DELIVERY's pre-flight (checkOnly 1) and the real run (GOODS_DELIVERY, PICKING_PLAN) both
pass through it. Requests / responses: `../test/gdpre/`. Every run check-only (writes nothing). Unit test of the key extraction (local
node, sample movements): duplicate keys collapsed, sorted, invalid ids skipped.

| Test | Build / lock row | Result |
|---|---|---|
| G0 | test-keys copy (JN-TEST-01 bin A), key free | gate YES, read ran, busy NO, then "Sufficient stock" |
| G3 | real build, ordinary doc_no | gate NO (OFF), "Sufficient stock" |
| G1 | test-keys copy; dbw (user yes): lock row token 0, owner TEST\|ENGINE-HOLD | **400** "Stock of 1 item / bin pair(s) on this delivery is being updated by another document. Please try again in a moment. (2049734383547097089\|2034476113458442241)"; exit at return_node_CLgdBusy, before the sufficiency check |
| G2 | dbw: owner CL\|TESTCLASSIC (classic holder) | busy NO (classic holders queue), "Sufficient stock" |
| Restore | dbw: token 1, owner '', last owner CL\|TESTCLASSIC, lock_version 55 | key free |

**Published OFF 16:42 (user yes):** GD_UNUSED_FN_NEW v56 (base guard SAME v55; backup by wf_upload). Smoke (check-only, ordinary
doc_no): "Sufficient stock"; `wf trace`: `code_node_CLgdKey` on NO (9 ms), exit return_node_ChkRet01.

## Pair entry (build_pair.py), 22 Oct 16:46-16:53 (user yes)

**Nested-child test** (3f's deadlock question; `build_nest_test.py`, `../test/nest/`):
- Setup: a test-only copy of the locked v62. Right after its balance write, still holding the key, it calls the PUBLISHED ADD_INVENTORY v67 (an
  ordinary trx, so ADD's unlocked path) on the same material / bin / category, +1.
- Result: Complete in 1.1 s, no wait. The parent wrote 61 -> 60; the child read 60 and wrote 61 (a stale read would have written 62).
  The parent then released; OUT 1 + IN 1. So update nodes commit per node, and a nested child on the same row doesn't block.

**ADD_INVENTORY v68 (HELD mode, `cl_hold_op`)**:
- Regression as one-off runs: locked path without cl_hold_op (MIN01-TEST-PA1: TAKE through the new take-if, release) and OFF path (MIN01-OFF-PA2): both 200,
  as v67.
- Published 16:50 (user yes; base guard SAME v67).

**Pair tests** (one-off runs of `p_SUBTRACT_INVENTORY.json`, which calls the published ADD v68; `../test/pair/`):

| Test | Call | Result |
|---|---|---|
| P1 same-bin category move | Unrestricted -1 at bin A, pair_add {inventory_category Reserved}, MIN01-TEST-P1 | 200; one key (key2 ''); nested ADD v68 **route HELD**, its release skipped (149 ms); bin A U 62 / R 1 / balance 63; lock free. No deadlock (3f's case) |
| P2 two bins | bin A -> bin B, MIN01-TEST-P2 | 200; keys in sorted order (bin B's first, bin A's second, both TAKE); A 62 -> 61 under both keys, nested ADD HELD at B 36 -> 37; both keys released (last owner the pair op) |
| P3 second key engine-held | dbw (user yes): bin A's key (the pair's second) token 0 under TEST\|ENGINE-HOLD; same move | **400 busy**; first key (bin B) taken, then given back (CLrpB needRelease YES); balances unchanged, 0 P3 movements; bin A's hold restored by dbw afterwards |
| P4 OFF pair | bin A -> bin B, ordinary trx MIN01-OFF-P4 | 200; on NO; unlocked subtract (A 61 -> 60), then ADD unlocked (B 37 -> 38); no lock row touched |
| Restore | published v62 / v68 | A 61 / R 0 / balance 61, B 36; MIN01-* movements net 0 per category (Unrestricted 43/43, Reserved 6/6); no held lock row |

**SUBTRACT_INVENTORY v63 published OFF 16:52 (user yes)**: base guard SAME v62. Smoke (no pair, ordinary trx): 200 in 236 ms;
code_node_FLgate NO, code_node_CLkey NO, code_node_CLpairIn ran (1 ms), original exit. ADD v68 smoke: CLkey NO, original exit, 177 ms.

**Busy vs queue (N3 vs T4):** a call whose claim read sees the token already taken (another classic call mid-section) answers 400 busy;
calls whose claim reads all see token 1 queue at the take. With the lock ON, two classic documents writing the same item + bin within
~200 ms would therefore see one refuse mid-document (3f's "busy in the middle of a multi-line classic GD save / revert" case). Possible
refinement for ON, untested: route TAKE also when the holder is a CL| owner, so the take queues behind it. That is safe only if the
take reads the row fresh after its wait (the atomic-count doc says its snapshot predates the lock), so it needs a test first.

**Consequence for the engine side:** a classic take that queues behind the ENGINE's take (INVENTORY_LOCK_TOKENS) finds token 0
when it gets the row, and an atomic minus on 0 fails the node: the classic run crashes (nothing written, nothing held). A classic
call that arrives while an engine run already holds the token reads token 0 in its claim and answers 400 busy cleanly.
