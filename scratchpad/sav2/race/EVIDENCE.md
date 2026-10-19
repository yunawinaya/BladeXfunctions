# INVENTORY_BULK_APPLY cost-row race — evidence (DEV, 2026-10-16 20:24-20:31)

**Verdict: confirmed.** Two engine APPLYs on the same material + plant in DIFFERENT bins (disjoint `ITEM|` / `BATCH|` locks)
corrupt the FIFO / WA cost rows. Every overlapping pair we fired either lost an update or produced a duplicate FIFO sequence;
the bin balances (lock-protected) always stayed consistent. Engine dev v7 (2109916822821744641), unchanged.

Setup: tenant 496474 (admin), plant 1942795438353035266, bins L1 2046110651955724289 / L2 2046110685065560066; 4 dedicated items
SACRACE-FIFO 2111070303143723010, -WA 2111070325549694977, -FIFOB 2111070356172308482 (batch SACRACE-B1 2111070517371994114),
-FILL 2111070363029995521 (Fixed Cost filler). Seeded by one classic ADD (the batch) + one APPLY `SACRACE|SEED|1`.
Harness: `scratchpad/sav2/race/` (`fire.mjs` fires B then A through dev.mes as admin@496474; `reconcile.py check` compares the
cost-row delta with the movement delta per material / plant / batch; `reconcile.py timeline` reads both engine runs' node times).
Raw files: `<session scratchpad>/sav2-race/<run>.{before,fire,verdict}.*`.

| Run | Scenario | Engine answers | Verdict | Timeline (ms from B's start) |
|---|---|---|---|---|
| R1-01 | FIFO SUBTRACT 7 (B, L2) vs 5 (A, L1) | B **500 REVIEW** (locks kept), A 200 | **LOST UPDATE**: layer −5 vs movements −12 (−7 lost) | both cost reads 89-119, writes 205 / 215 |
| R1-02b | same, batch item (BATCH-scoped FIFO) | A **500 REVIEW**, B 200 | **LOST UPDATE**: −7 vs −12 (−5 lost) | reads 111-128, writes 232 / 232 |
| R2-02 | WA ADD 10 @ 50 (B) vs 10 @ 30 (A) | A **500 REVIEW**, B 200 | **LOST UPDATE**: WA qty +10 vs movements +20; value 499.97 vs 800 | reads 166-188, writes 343 / 357 |
| R2-03 | same | B **500 REVIEW**, A 200 | **LOST UPDATE**: qty +10 vs +20; value 300.04 vs 800 | reads 102-138, writes 196 / 222 |
| R3-01b | FIFO ADD 10 @ 6 vs 10 @ 5, batch | **both 200 OK** | **DUPLICATE SEQUENCE** (2 new layers, same `fifo_sequence`) — SILENT | reads 3,607-3,637, writes 4,336 / 4,343 |
| R3-02 | same, non-batch | **both 200 OK** | **DUPLICATE SEQUENCE** — SILENT | reads 118-137, writes 230 / 232 |
| R0-01 | eb's interleaving: B = 1,000 movements (999 filler + 1 FIFO SUBTRACT 10 in L2), A = FIFO SUBTRACT 5 in L1 sent 604 ms later | **both 200 OK** | **LOST UPDATE**: −10 vs −15 (A's −5 lost) — SILENT | B read 393-408 · A read 387-399, A wrote + read back by 531 → DONE · B wrote its stale absolute at ~3,669 and read back its own values → DONE |
| R0-02 | same, A sent 901 ms later | B **500 REVIEW** (locks kept), A 200 | consistent by write order (A read inside B's write phase) | B read 229-240, writes 2,864 · A read 622-634, writes 721 |
| R0-03 | same, A sent 1,202 ms later | B **409 LOCK_BUSY** (R0-02's B still held ITEM\|FIFO\|L2 + ITEM\|FILL\|L1), A 200 | — | the REVIEW of R0-02 blocked a later operation |

(R2-01: both calls got a gateway "404 page not found" — nothing reached the engine; discounted.)

## What this means
1. **Silent corruption is real** (R0-01, R3-01b, R3-02): both operations answer 200 and the read-backs pass, because each run only
   compares rows with its OWN plan. A FIFO layer keeps phantom availability; two layers share a sequence; a WA row loses a receipt.
2. **The detected case is not safe either** (R1, R2, R0-02): the losing side ends 500 REQUIRES_REVIEW and KEEPS its balance locks, so
   later V2 operations on those items get 409 (R0-03) until someone runs the runbook — and the cost rows are already wrong.
3. Balances never broke: the per-bin `ITEM|` / `BATCH|` locks work. Only the plant-level cost rows are exposed.
4. Exposure today (dev; prod gets the engine in next week's full deployment): every V2 caller with isMovingInv 0 on FIFO / WA items —
   GD Completed V2 (SUBTRACT), GR V2 (GRN ADD), SA V2 (both). A stock-count SA touches most items of a plant, so concurrent GD / GR
   completions overlap almost surely. Classic writers (no locks at all) race the same rows today.

## Proposal (bladexfunctions-eb's conditions, 2026-10-16)
- Derive `COST|<material>|<plant>` keys INSIDE the engine (guard.js key builder) for every movement with `isMovingInv 0` on a FIFO / WA
  item; take them in the SAME sorted TAKE as `ITEM|` / `BATCH|` (no new deadlock order; one key per material + plant, small count).
  Callers unchanged (GR V2 needs no change — a6).
- INVENTORY_LOCK_TOKENS: the BALANCE_TYPE_INVALID path and the GIVE re-read must accept `COST`.
- Before publish: the 7,489-call replay byte-identical, `scratchpad/gdc/engine/test_core.js`, eb's commit_sim / test_hu / test_c2_lock,
  a live completion re-run; then re-run this harness (expect 409 → lockWait → exact: CONSISTENT on every run).
- Not covered by an engine lock: GR Revert V2's R2 step writes cost rows itself (a6) — needs its own COST token if it should serialize.
- Yes needed from bladexfunctions-eb, -a6, -a3 and the user (the engine's builder, -8a, is gone: engine changes are the user's call).

## Re-run on the fix — engine v8 + INVENTORY_LOCK_TOKENS v5 (eb's COST locks), 2026-10-16 20:45-20:52
16/16 runs CONSISTENT — 0 lost updates, 0 duplicate sequences:
- R0-11..13 (the silent interleaving): the small op answers a clean **409 LOCK_BUSY** `COST|<FIFO>|<plant> (SACRACE|R0-1x|B)`; B DONE.
- R1-11..13, R2-11..13, R3-11..13, R1-11b..12b, R3-11b..12b: SERIAL (the second op read after the first finished writing) or one
  side failed as below.
- After: 0 SACRACE / COST locks held; 4 COST rows exist (all free).

**New finding (for eb):** the FIRST concurrent use of a not-yet-seeded COST key fails one op's run at `add_node_IBseed` — `Duplicate
entry '…-COST|<mat>|<plant>' for key 'inventory_balance_lock.Lock Key'` (e.g. engine instance 2111075965242609665, status Fail). The
caller gets the platform error envelope `{code 400, success false, data null, msg "An error occurred: …"}` (a 400 with no engine
result_code), not a 409. Nothing was written. Seen 3/16 — exactly the first use of each new COST key (R1-11 B, R2-11 B, R1-11b A).
On prod every material + plant starts unseeded. Options: pre-seed COST rows and/or the engine turns a failed seed into a 409.
SA V2's COMMIT A2 treats a 400 without a result_code as transient (lockWait), not as a refusal.

## First-use check on engine v9 + INVENTORY_LOCK_SEED v3 (eb's seed fix), 2026-10-16 20:58
Brand-new item SACRACE2-FIFO 2111079324238385153 (0 lock rows), 3 concurrent FIFO ADD/ADD pairs: all 3 CONSISTENT, 0 locks held.
- R3-21 (true first use): the seed child failed on the twin insert (INVENTORY_LOCK_SEED 2111079395394752513, Fail at add_node_LSseed)
  AND the parent engine run ended Fail too (2111079395239563265, at workflow_node_IBseed) → the caller still gets the platform envelope
  {code 400, data null, msg …Duplicate entry…}. A child's failure DOES abort the parent here. Nothing written.
- R3-22: clean 409 LOCK_BUSY on the COST key. R3-23: SERIAL, both 200.
Sent to eb + a6. SA V2 COMMIT v4 handles the envelope as transient (lockWait).

## First-use check on engine v10 + INVENTORY_LOCK_SEED v5 (seed + child call in try/catch), 2026-10-16 21:15 — FIXED
Brand-new SACRACE3-FIFO 2111083510162165762: 3/3 CONSISTENT, 0 locks held. R3-31's loser: ENGINE run 2111083547344670721 Complete at
return_node_IBbusy (BUSY "lock row not created yet"); both seed children Complete (catch). No engine run ended Fail.
Platform quirk: the HTTP run API still answers a direct caller {code 400, data null, msg <the caught error>} although the run Completed —
only direct HTTP callers (tests) see it; in-workflow callers get the return node (not verified live).

## State left on dev
Test items keep their (now inconsistent) cost rows as evidence; every `SACRACE|%` lock released (0 held, 20:31); `IBA|REVIEW` rows of
SACRACE operations left (they only block a replay of those operation keys). Nothing outside the 4 SACRACE items was written.
