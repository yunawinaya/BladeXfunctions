# GD Edit V2 — hand-off brief (2026-10-15)

From the GD Completed V2 session (find it with `ListAgents`; it was `bladexfunctions-d3` on 10-15). The user decided to
build GD Edit V2 in its own session; the GD Completed V2 session stays on GD Completed V2. Everything below was verified
against dev on 2026-10-14/15 unless marked otherwise.

## Goal

Async **Edit + Save as Created of an existing Goods Delivery** that survives 2,000 lines on dev. Callers: the GD form's
Edit save, and SO_CASCADE (`Sales Order/SOcascadeDownstreamWorkflow.json`, `wf_cd_gd`), which re-saves linked Created GDs
when a Sales Order is edited. Dev only unless the user says otherwise (they declined prod for GD Completed V2).

## Why the classic path can't

GD form Edit → `onClick_save_as_created` → GOODS_DELIVERY (`Goods Delivery/GDheadWorkflow.json`, dev v241) → a full
re-save of the header + every line, then GD_UNUSED_FN_NEW's Created path. On a 2,000-line GD a 3-line partial pick's
re-save took 58 s and 59 MB of node data (cap ~64 MB); the full re-save took dev down on 2026-10-09
(memory `project_2k_line_scaling.md`).

## Current routing (verified 10-15)

- Form handler `gdV2_onClick_save_as_created` (GD form dev v1476 = repo `GDfullJSON.json`) sends a save to the async
  create V2 only for Add / Clone with no id yet. Every Edit, an Edit of a Draft included, runs the classic handler.
- Async create V2's GD_BULK_PREPARE (`Goods Delivery/AsyncV2/`, ours since 10-08) refuses any document number a GD already
  holds (live or deleted). It cannot update an existing GD.
- Nothing caps a classic Edit by size. SO_CASCADE v24 (dev, 10-15) refuses to re-save a GD over 500 lines, and refuses
  changes on a line held by a `Processing` GD. Edit V2 is what lets the cascade handle big GDs again.

## Recommended design: generalize GD Completed V2, not the create V2

Create V2 inserts a HIDDEN new GD and soft-deletes it on failure, an undo that only works because nothing existed before.
It also allocates from scratch. An edit changes a live GD that SO lines, reservations and a Picking already reference.
It needs the allocation DIFF (GD_UNUSED_FN_NEW's Created-path planner) and in-place writes guarded by before/after
intents, which is exactly GD Completed V2's machinery:

| Reuse (GD Completed V2, `scratchpad/gdc/`) | What it gives Edit V2 |
|---|---|
| `build_gdc.py` + `pkv2tools/wfkit.py` | FlowGram JSON builder (auto-wraps SQL ≤160 chars/line; addDraft fails on longer lines) |
| `code/submit/*` | sync gates in GOODS_DELIVERY's order + lock row + `gd_async_job` + `gd_status 'Processing'` |
| `lift/lift.py`, `lift/lifted_*.js`, `lift/runtime.js`, `code/prepare/{adapter,chain}.js` | deployed GOODS_DELIVERY + GD_UNUSED_FN_NEW bodies run in-process on SQL reads (`gcChain` runs the Completed path today) |
| `engine/core.js` + INVENTORY_BULK_APPLY (`Balance Table/`, dev v6; v7 pending from bladexfunctions-35) | set-based SUBTRACT/ADD incl. the Reserved/Unrestricted and cross-bin moves an edit makes |
| `code/commit/*` (C0 revalidate, C3 reservations, C4 SO lines/headers, C5 GD write, C6 reorder) | intent → write-at-before → read-back steps, SPLIT, retries, REQUIRES_REVIEW |
| `code/worker/*` | worker (client-kicked; NO Quartz, user decision) |
| `test/*` | `plan_live.js` + `run_prepare_sql.py` (PREPARE on live reads), `commit_reads.py` + `commit_steps.js`, `commit_sim.js` (built COMMIT on the interpreter, crash/resume), `submit_sim.js`, `snap.py` + `check_one.py` (live reconcile), `cascade_sim.js` |

Read first: `Goods Delivery/CompleteV2/README.md`, `scratchpad/gdc/GDC_DESIGN.md`, the approved plan
`~/.claude/plans/buzzing-wiggling-summit.md`, and memory `project_gd_completed_v2.md`.

Don't edit GD Completed V2's files in place. Build in `scratchpad/gde/` and `Goods Delivery/EditV2/`, importing or
copying the shared pieces. If a shared file has to change (`chain.js`, `lift.py`, `adapter.js`, `_common.js`), message
the GD Completed V2 session first.

## New work (not in GD Completed V2)

1. **Lift the Created/Edit path of GOODS_DELIVERY.** Branches that run on Edit + Save as Created (node ids in
   GDheadWorkflow.json):
   - `if_WDczQjqt` auto-allocation in Auto picking mode.
   - `if_kpeBjx1k` → `if_amlgRu7I` → `if_o5z3RcOy` Picking reconcile gate.
   - `code_pick_reconcile` with `if_pick_block` (refuses while a device / Picking V2 holds `is_processing`),
     `if_pick_has_reversal` / `if_pick_reversal_confirm` (the 413 "reverse picked quantities?" question).
   - `if_j38KWlWo` multiple-Created-Picking check (Full Picking).
   - `if_9xhwui06` auto-create / update Picking for `auto_trigger_to` orgs (assignments / cancellations).
   - `code_pick_hdr_sync` / `if_pick_hdr_sync`.
   - `if_ReorderCreated`; `if_yjDL1tIt` / `if_lyzamd38` (Edit mode).
   - GD_UNUSED_FN_NEW Created path: allocation diff, orphan cleanup, bin/HU migrations for `isPacking` / `isLoadingBay`
     (`detectBinHuMigrations`).
2. **Picking reconcile commit step**, the biggest new piece. It writes the existing Picking (`transfer_order`, records
   `transfer_order_vrqs3cmr_sub`), which Picking V2 also writes, so coordinate. The 413 question must be asked
   synchronously in SUBMIT, before queueing.
3. **GD write step for added and removed lines.** C5 today only patches columns of existing lines.
4. **Client:** the GD form Edit save routes eligible edits to Edit V2, otherwise classic. SO_CASCADE calls Edit V2
   instead of GOODS_DELIVERY.

## Rules and coordination

- **Deploys:** one explicit user yes per deploy/test batch. Show the change + `wf_upload --dry-run` first.
  `.dbtools/wf --dev backup <NAME>` before every publish.
- **Shared upload plan file** `.dbtools/wf_upload.plan.json`: list only your items, reset to `[]` after, message the other
  sessions (bladexfunctions-35 uses it often).
- **How to publish:** author FlowGram JSON and publish with `.dbtools/wf_upload.mjs`. A `compile` publish breaks
  interpolated sql-nodes.
- **GOODS_DELIVERY is shared.** Ask before changing it. Its first nodes refuse any save of a `Processing` GD (guard v241).
  Edit V2 should take the same lock.
- **Engine changes:** INVENTORY_BULK_APPLY is shared with GD Completed V2 and bladexfunctions-35 (PO/GR/Putaway V2).
  Engine changes need both, and replay all 7,489 recorded calls (`scratchpad/gdc/engine/`, fixtures in the GD Completed V2
  session's scratchpad).
- **Skills to invoke:** `authoring-lowcode-workflows` before writing workflow JSON, `avoiding-bladex-data-traps` before
  inventory writes, `running-dev-workflows-as-tenant` for live tests (`scratchpad/gdc/tools/runas.mjs`, identities
  `id711077.json` / `id000000.json` / `id496474.json`).
- **Database:** confirm before ANY DB write; reads are free (`.dbtools/db --dev|--prod`).

## Test data (dev)

- Tenant 711077 (minted admin identity): GD/20261003/006 and GD/20261005/007, 1,948 lines each, Created, FIFO, no
  picking/packing gates. /006's SO is SO/20261003-021 (`2106409543078952962`).
- For Picking reconcile you need a GD with a started Picking. Tenant 496474 has the 2,000-line Picking V2 history
  (memory `project_picking_async_v2.md`). Ask the user before consuming another session's test documents.

## Interpreter traps found 10-15 (`pkv2tools/sim/engine.js`)

- It evaluates only expression-style `if` nodes. GOODS_DELIVERY / SO_CASCADE use ConditionRule filters; see the patch in
  `test/cascade_sim.js`.
- It injects an empty string for a missing reference, while the platform injects `null`. `X || ""` then becomes a syntax
  error; `cascade_sim.js` patches `injectJs`.

## Open with the user

- Cap the GD form's own Edit at 500 lines meanwhile (cheap safety net), or wait for Edit V2.
- Prod: assume dev only unless told otherwise.

Relevant memory: `project_gd_completed_v2.md`, `project_gd_async_v2.md`, `project_so_cascade_gd.md`,
`project_edit_after_picking.md`, `project_picking_async_v2.md`, `project_gd_to_picking_mappers.md`,
`project_hardcoded_created_resave.md`, `project_2k_line_scaling.md`.
