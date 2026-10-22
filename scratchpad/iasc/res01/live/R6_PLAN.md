# RES-01 R6: live acceptance on DEV with the switch ON (U09-U16, U18 of BA_HANDOFF_2026-10-20.md)

Prerequisite: batch 16 published (switch ON; plan `scratchpad/iasc/deploy/wf_upload.sc.batch16.plan.json`), read back IDENTICAL.
User decision 10-22: the switch stays ON on DEV after the tests (a full promotion ships it ON).

Rules (from the IA V2 kit RUNBOOK, `scratchpad/iav2/live/RUNBOOK.md`):
- Tenant 711077 (Test Mosca / HQ, plant 2105200506810306561, every balance in bin A1-01): tell the engine owner (-3f) before and after
  the window; never pick "blade, loose" 2105492637718319110 at bin 2106278340907413505; never touch SO/20261016-034 / -035.
- Requests: `python3 scratchpad/iav2/live/build_ia_payload.py <subject>` (read-only; writes draft.json / classic.json / submit.json
  outside the repo, from TODAY's balances: re-run right before each step). Runs: `node scratchpad/gdc/tools/runas.mjs
  scratchpad/gdc/tools/id711077.json <workflowId> <request.json> <out.json>`, each its own command. Every write batch = the user's yes.
- No Complete & Post (it posts to the SQL Accounting V2 agent) without its own yes.
- Checks read-only: `on_reserved_gd` (doc_type 'Item Assembly', doc_id), `item_balance` (unrestricted / reserved / block at A1-01),
  `inventory_movement` (trx_no = the IA number: 'IA', 'IA-H' under "<no>/H", 'IA-R'), `sm_item_assembly.material_hold_status`.
- IA_HOLD 2112752274794217473: {ia_id, organization_id 2105190589240086530, operation RECONCILE | RELEASE_ALL | CLOSE, source}.

| # | Covers | Steps | Expect |
|---|---|---|---|
| 1 | U09 | subject `s-ns` (3 stocked lines + I-DL / I-IDL / I-VO) as a NEW Draft (draft.json) via IA_SAVE; then IA_HOLD RECONCILE source SAVE | header RESERVING after the save; after RECONCILE: one Allocated row per stocked line (non-stock none), FULL, A1-01 unrestricted -picks / reserved +picks, IA-H moves under "<no>/H" |
| 2 | U10 | edit 1 (`build_ia_payload.py edit --tenant 711077 --ia <id>`): one line Required 80 with picks 50; save + RECONCILE | 50 held, PARTIAL, that line short 30; nothing refused |
| 3 | U11 | two RECONCILE runs started together (two commands) on the same IA; then the same save twice | one runs, the other 409 BUSY; no duplicate rows; second save + RECONCILE changes nothing |
| 4 | U12 | edit: a pick down, a line removed, one pick moved to another free bin (if any), re-save + RECONCILE | the difference released / held only; removed line's row Cancelled; no other owner's row touched; no stranded Processing / Releasing rows |
| 5 | U13 | hold 80 on a line, complete with picks 70 (IA_SAVE Completed, <= 50 picks = classic), then CLOSE source COMPLETE | 'IA' OUT 70 from Reserved, one receipt; CLOSE: the row Delivered 70, 10 released (Reserved -> Unrestricted), CLOSED; total reserved back to before |
| 6 | U14 | a pick of 90 against 80 held; separately an Add completed at once (classic.json) | 80 from Reserved + 10 Unrestricted (native check); the direct Complete holds nothing and is never enrolled |
| 7 | U15 | subject `b` (60-80 lines) Draft + RECONCILE, then IA_V2_SUBMIT Completed + `tick_ia.sh` until COMPLETED, then CLOSE; and a SUBMIT while a RECONCILE ticket is live | V2 op 1 issues the held parts from Reserved; CLOSE delivers them; with a live ticket: PREPARE FAILED IA_RESERVING, the IA back to Draft, nothing moved |
| 8 | U16 | delete an enrolled Draft (RELEASE_ALL source LIST, then the list's soft delete via `.dbtools/dbw` after its own yes); Clone an enrolled IA (IA_SAVE pageStatus Clone); IA_REVERT (classic) of item 5's completed IA, then RECONCILE | delete: NONE then deleted, stock back; clone: no copied rows, enrolled RESERVING; revert: Reserved-issued stock back to its from_category, Draft RESERVING, RECONCILE holds again |
| 9 | U18 | a held item checked by a GD's allocation read (read-only: the GD pickers read unrestricted_qty); 711077 has no batch / HU stock - batch on 000000 (subject c-fifo components) only if the user wants it | the held quantity is not offered to the GD; batch identity kept on 000000 |

After the window: tell -3f; record every IA number + result in the ledger; leave the switch ON (user).
