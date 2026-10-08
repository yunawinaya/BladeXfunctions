# 2026-10-08 prod hotfix — SUDU defect register (`bug-list.md`)

Seeded from the **enabled PROD** scripts (never from the repo module files, which mirror dev and
are stale for several of these workflows). `build.py` re-fetches each enabled script, asserts the
version it was written against, applies exact-text patches (any drift fails loudly), and writes:

- `<WF>.BASE.json` — what prod runs today (diff baseline, **never deploy**)
- `<WF>.PROD.json` — the file to paste into the designer
- `dev-port/` — the same patches applied to dev's GOODS_DELIVERY v237 / GD_Convert_SI v22, for the
  session that owns dev GD to review (those two differ from prod, so the PROD files must not go to dev)

## Deploy

Paste each `.PROD.json` into the workflow's designing copy, enable, then confirm:
`.dbtools/wf --prod deployed prod-hotfix/2026-10-08-bug-register/<WF>.PROD.json` → IDENTICAL,
and watch `.dbtools/wf --prod runs <WF>` for new failures before the next step.

| # | Workflow | id | prod | Same file to dev? |
|---|---|---|---|---|
| 1 | SI_SAVE | 2029040374929154050 | v81 | yes (dev == prod) |
| 1 | GD_Convert_SI | 2070069049332416514 | v21 | **no** — dev v22 has Cash Sales; use `dev-port/` |
| 2 | HANDLING_UNIT | 2037062451509002241 | v35 | yes |
| 2 | SM_LOCATION_TRANSFER | 2013133675374927874 | v65 | yes |
| 3 | PICKING_LOOP | 2021065804251615233 | v84 | yes |
| 3 | PACKING_SAVE | 1994279909883895810 | v28 | yes |
| 3 | PICKING_PLAN | 2021431201147527170 | v63 | yes |
| 4 | GOODS_DELIVERY + PICKING (together) | 2017151544868491265 / 2020683258347081730 | v172 / v72 | GD **no** (use `dev-port/`); PICKING yes |
| 5 | GD_UNUSED_FN_NEW | 2032273338771128322 | v52 | yes |

**PICKING is superseded** by `../2026-10-08-picking-packing-race/PICKING.PROD.json` (this file plus
sequential Packing writes) — paste that one into prod and dev instead.

"Same file to dev" is re-checked by every `build.py` run (dev enabled script == prod baseline).
Re-run it just before pasting into dev; if it says DIFFERS, dev moved and the file must be rebuilt.

## Repo mirrors (synced 2026-10-08)

`sync_repo.py --write` copied the patched content into the module files for the 8 dev==prod
workflows — `Sales Invoice/SIsaveWorkflow.json`, `Handling Unit/HUworkflow.json`,
`Picking/PickingLoopWorkflow(.PROD).json`, `Packing/PackingSaveWorkflowJSON.json`,
`Picking Plan/PPheadWorkflow.json`, `Picking/PickingProcessWorkflow(.PROD).json`,
`Goods Delivery/GDinventoryProcessWorkflow.json` (+ its stale `.js` mirror
`GDProcessTable_batchProcess.js`, re-synced from the deployed node) — keeping each file's
formatting. `Stock Movement/Location Transfer/LOTsaveWorkflow.json` is ahead of dev (unreleased
Stock Picking work), so it got only the Draft-reconcile fix, placed after its own "Created" gate.
GOODS_DELIVERY / GD_Convert_SI repo files were synced by the dev-GD session from `dev-port/`.
Until these are deployed, `.dbtools/wf --dev deployed <repo file>` reports DIFFERS — expected.

## What changed (bug → node)

| Bug | Workflow | Nodes |
|---|---|---|
| 001 zone Pickings overwrite each other's GD lines | GOODS_DELIVERY | new `if_PkMergeGd` → `get_node_PkMergeGd` (re-read GD just before the write) + `code_node_PkMerge` (per line keep the further-along Picking fields; ties keep the payload); `update_node_elLmtlLm.table_gd/.picking_status` → PkMerge |
| 002 converted SI completes despite failed credit check | SI_SAVE | `code_node_JoF0YVzG` fallback order; `code_node_Z0Tcxb1v` draft number |
| 004 cancelled GD revived | GOODS_DELIVERY `code_node_IyJHrBst` (Cancelled GD is final) · PACKING_SAVE `code_node_PkPickChk`, `code_node_GKPcKOcF` · PICKING_LOOP `code_node_LockDecide` + new `condition_or_item_LockCancelled` |
| 005 header not rolled up | GOODS_DELIVERY `code_node_8pN1MyXz` (roll up to Completed from lines, + `needMerge`), `if_DDiEWnn5` reads it |
| 006 Force Complete touches Cancelled Pickings | GOODS_DELIVERY `get_node_oU2TK3ms` (+ `to_status <> Cancelled`), `code_node_UiubQSk5` |
| 008 empty Packing (latent) | PICKING `code_node_gudzrvMQ`, `code_node_pMVdQBEQ` |
| 009 re-convert NPE | GD_Convert_SI `code_node_6JxbETDC` (+ `isAuto`), `if_dup_auto` |
| 010 empty HU stays Packed | HANDLING_UNIT `code_node_Li3O7y4d` |
| 011 second Completed save drops HUs | PACKING_SAVE new `code_node_PkStoredPrep` → `if_PkStored` → `get_node_PkStored`; `code_node_7u6VSG8X` merges `table_hu` |
| 014 FOOGA ghost residual / partial bay pick | PICKING `code_node_iES7iMKA`, `code_node_Z5JH4g2u` (q8) · GD_UNUSED_FN_NEW `code_node_b71wypDJ` (`detectBinHuMigrations` quantity-aware) |
| 015 LOT Draft edit double-posts | SM_LOCATION_TRANSFER `code_node_uht83Wzh` (reconcile only when stored status is In Progress) |
| 016 force-completed plan reopened | PICKING_PLAN `code_node_pp_gate` · PICKING `code_node_Qxtc1i6K` · GOODS_DELIVERY `code_node_QtyCheckBatch` (GD-from-plan checked at Created) |

Not changed: 003 (fixed 09-23, verified), 007 / 012 (deferred), 013 (historical, repaired).
Pre-existing lint finding left alone: `code_node_5oTXzIic` UNDECLARED keys (in dev and prod BASE).

## Verification (all read-only against prod data)

- `verify.py` — node diff vs BASE shows only the nodes above; no new lint findings; every changed
  code node parses. 10/10 OK.
- `replay_tests.py` — 22 tests replay the real incident runs: BASE reproduces each defect, PROD
  fixes it (e.g. GD-294/GD-280 lines stay Completed in every write order; SI 0037 → Draft; LOT
  Draft edits post 0 reconcile movements; DO-FG2610-012 migrates the reservation cross-bin). 22/22.
- `regress.py` / `regress_detector.py` — every changed code node replayed BASE vs PROD on recent
  real runs; BASE reproduced prod's recorded output in every case:
  - GD_UNUSED_FN_NEW detector: 692 loading-bay / Packing runs (09-24 → 10-08): 690 identical, 2
    differ = the two DO-FG2610-012 incident runs.
  - PICKING: 72 runs, only the 2 FOOGA runs differ (rounding). GOODS_DELIVERY: 200 runs identical.
    PACKING_SAVE 62, PICKING_PLAN 66, SI_SAVE 132 (1 differs = a Kenhin Override → Draft),
    LOT 6 In Progress edits identical, HANDLING_UNIT 17 real unloads (all → Created).

## Repairs (`repairs/`)

Prod is read-only from here. Run SQL in Bytebase with backup on: BEFORE checks must match, the
statement is guarded, then AFTER checks.

| File | What | How |
|---|---|---|
| R1 | 7 cancelled GDs revived to Created | **App**: re-cancel after deploy (verified safe) |
| R2 | 8 GD headers stale (LSH 328/335/337/341–344, Kenhin 1275) | SQL, optional |
| R3 | Cancelled Picking line flipped by Force Complete | SQL, 1 row |
| R4 | 19 empty Packed HUs + 5 qty-0 rows | SQL |
| R5 | 22 packed HUs missing from their Completed Packing | Report — needs your call |
| R6 | LOT-08/2026-131 double post (Ascent) | SQL, 4 rows in one guarded statement |
| R7 | GD-20261001-294 line still Created/0 | SQL, line + header |
| R8 | CA-3759 reopened plan | SQL, 1 row (+ detection query) |
| R9 | 4 unposted over-credit SIs | Report — app handling |

## Follow-ups (not in this pass)

BUG-007, BUG-012 · a real per-GD lock for BUG-001 (only `atomic-count-node` exists) · LOT
idempotent posting + stamp-last · Kenhin SUDU vs SQL Accounting credit/overdue sync · a Picking
still open after its GD completes would re-save the Completed GD (not seen in 14 days) · Force
Complete's lookup is a get-node and returns only the first matching Picking · repo mirrors
(`Picking/PickingProcessWorkflow*.json` etc.) are stale for these workflows — resync after deploy.
