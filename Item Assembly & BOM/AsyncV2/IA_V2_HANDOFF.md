# Item Assembly V2: hand-off (prepared 2026-10-19 by bladexfunctions-39, Location Transfer V2 session)

The user wants an async "V2" save for Item Assembly (IA), like the V2 saves for GD, Picking, Packing, GR, Putaway, Location
Transfer and Stock Adjustment. V2 is a background job on the shared engine INVENTORY_BULK_APPLY that handles 2,000-line
documents.

**Start by settling scope with the user** (superpowers:brainstorming; questions at the end), then plan. Everything below was
verified read-only on 2026-10-19.

## 1. What runs today

### Workflows
| Workflow | id | Versions | Notes |
|---|---|---|---|
| IA_SAVE (save + completion) | 2098335576774463489 | enabled v11 on dev and on prod | 87 nodes |
| IA_REVERT (Revert Completed) | 2099319746652852225 | exists on dev and prod | list bulk action |

**Repo copies vs deployed:**
- `Item Assembly & BOM/ItemAssemblySaveWorkflow.json` and `RevertCompletedIA/IArevertCompletedWorkflow.json` are canonically IDENTICAL to deployed v11 / v4; only key order differs. This was corrected by bladexfunctions-dd on 2026-10-19; `wf deployed` showed a format-level DIFFERS. Still check against deployed before every edit.
- `scratchpad/gen_ia_save_workflow.py` is STALE (pre-q8). Never regenerate from it.

### Form and list
- Form `sm_item_assembly`: live dev **v32**, prod **v30**, both edited 2026-10-16 16:38. The repo `ItemAssemblyFullJSON.json` DIFFERS, so pull the live form (`.dbtools/form --dev ...`).
- List page JSON: `Item Assembly & BOM/ItemAssemblyListPageJSON.json`. Its Revert action is `ItemAssemblyListRevertCompleted.js`, handler `8r9xuzc4`.
- **List rows carry only the grid's columns + id.** `organization_id` had to be added as a hidden column; any list bulk action reading a non-column field has the same bug.

### Tables
- Header: `sm_item_assembly`. Status column `item_assembly_status`: Draft / Completed / Fully Posted. Also `posted_status`, `completed_status`, `stock_movement_no`, header `batch_no` and `inventory_category`.
- Components: `sm_item_assembly_tlm8ve69_sub`. `temp_qty_data` holds the picks.
- `sm_item_assembly_mw10kf66_sub`: 0 rows in prod.

### Prod usage
- 56 documents, 2 tenants (128671, 881544).
- At most 5 component lines and 5 picks per document.
- 46 are Fully Posted, which means the accounting post (Complete & Post) is in use.
- So 2,000 lines is forward-looking, exactly like Location Transfer.

### IA_SAVE flow
1. CHECK_REQUIRED_FIELD.
2. If not Draft:
   - `code_validate`: 401 on errors (manual batch required unless `batch_number_genaration === 'According To System Settings'`; category must be Unrestricted / Blocked).
   - Edit idempotency guard: 409.
   - Pre-check loop over components × picks: an inventory check per pick, 402 on failure.
3. Persist:
   - GENERATE_BATCH when needed.
   - Add or update the IA.
   - Loop over components × picks: one SUBTRACT_INVENTORY per pick.
   - ONE ADD_INVENTORY for the assembled item.
   - Loop over HU unloads: one HANDLING_UNIT call per HU.
   - Item transaction date.
4. Draft: add or update only.

Classic cost is about 1 s per sub-workflow call. It is not atomic: the document is written before stock moves.

### Costing (the hard part)
- `code_receipt_prep` computes the assembled item's unit cost as **Σ `total_price` of the issue movements just written, ÷ `item_qty`**. It reads the movement rows back, because SUBTRACT does not reliably return `unit_price`.
- IA is **isMovingInv 0**, so it writes FIFO / WA cost rows.

### Revert
- IA_REVERT replays movements labelled `IA` / `IA-R`, paired by item | batch | bin | category | HU. A revert goes back to Draft.
- It is blocked only when this IA's own output was used: its own FIFO layer, WA or balance.
- **V2-completed IAs must stay revertible.** V2 must write the same movement shape and labels, or the plan must include a V2 revert (GR Revert V2 `scratchpad/grrv` is the model).
- Known classic quirk: ADD_INVENTORY mints a Batch row per completion, blank for non-batch items, and the revert deletes it.

### Other features V2 must not break
- Header batch: Manual Input vs According To System Settings → GENERATE_BATCH.
- Receipt `inventory_category`: Unrestricted / Blocked.
- Item default bin before plant default, for both the receipt bin and the component pick order.
- HU unload of components.
- Serial handlers in the form (`ItemAssemblySearchSN.js`, `ItemAssemblyResetSN.js`). IA_SAVE has only 2 `serial` references; find out what it does with them.

### Mobile
- IA has mobile screens: `Item Assembly & BOM/IA_MOBILE_GUIDE.md`, built in the sudu-mobile-expo repo.
- Precedent (user, 2026-10-16): mobile keeps the CLASSIC save and the classic must keep working next to V2. Confirm with the user.

### Memory notes
`project_ia_revert_completed`, `project_ia_default_bin`, `project_ia_header_batch_category`, `project_engine_cost_row_race`,
`project_full_deployment_dev_to_prod`.

## 2. The engine, and what IA needs that it can't do yet

**Engine.** INVENTORY_BULK_APPLY (2109916822821744641) is **v10 on dev**. The contract and semantics are in:
- `scratchpad/smv2/CONTRACT.md` §5;
- `scratchpad/gdc/engine/core.js` (planBulk) and `scratchpad/gdc/iba/code/guard.js` (request rules).

It runs PLAN / APPLY, all-or-nothing, at most 5,000 movements, resumable by `operation_key`. isMovingInv-0 movements also take `COST|<material>|<plant>` locks (v8+; the race fix of 2026-10-16).

**IA gaps:**
1. **Receipt price = Σ several SUBTRACTs' consumed totals ÷ qty.** `unit_price_from` copies ONE subtract's price. **This is the first design decision.** Options:
   - (a) An engine extension, for example a price summed over named keys ÷ qty. This needs the engine owners' yes plus their replay gates.
   - (b) Two operations: APPLY the issue leg, read its priced results, then APPLY the receipt with an explicit price. Single-operation atomicity is lost, so it needs a resumable two-step COMMIT.
   - (c) Price from PLAN results. PLAN takes no locks, so the price can drift before APPLY.
2. **A new batch on the receipt.** The engine refuses with UNSUPPORTED_NEW_BATCH. Insert the batch row first and pass `batch_id` (GR V2 C1 pattern, `scratchpad/grv2`).
3. **HU unloads are not engine effects.** The precedent is GD V2 C3H, `scratchpad/gdc/code/commit/_hu.js`.
4. **No serial support in the engine.**

## 3. Reuse (COPY into your own folder, e.g. `scratchpad/iav2/`; never edit in place)

**`scratchpad/smv2/` (Location Transfer V2, live on dev):**
- `lib/`: wfkit, `v2build` with a config-driven build_worker, `lift/lift.py` + `runtime.js`, `sim`, `sqlcheck`, `test_load`.
- `CONTRACT.md`: the contract template.
- `code/shared/`: the parse helpers (with the float fix) and the fingerprint.
- `code/commit/_cmp.js`: the numeric compare (fixed).
- Client patterns: one handler per save button, `awaitLink` same-key polling, the list action threshold + classic fallback.
- `deploy/*.plan.json` and the live-check method: `.superpowers/sdd/gd-picking-packing-gr-fluffy-bentley/live-report.md`.

**Other folders:**
- `scratchpad/sav2/` (Stock Adjustment V2): the CLOSEST analog. It is isMovingInv 0 with cost rows and COST locks; race harness `scratchpad/sav2/race/`.
- `scratchpad/grv2/` (GR V2): batch creation before the engine, priced ADDs. `scratchpad/grrv/` is GR Revert V2.
- `scratchpad/gdc/` (GD Completed V2): engine sources, HU drains, lockWait.

## 4. Rules every V2 session follows

**Namespaces.** Already taken:
- `SAVE_LOT`, `LOT|`, `SMLT|`
- `COMPLETE_SA`, `SA|`, `SAC|`, `SCR|`
- `COMPLETE_GD`, `EDIT_GD`, `GD|`, `GDC|`, `GDE|`
- `COMPLETE_GR`, `REVERT_GR`, `GR|`, `GRC|`, `GRV|`
- `COMPLETE_PUTAWAY`, `TO|`, `PWC|`
- `CONFIRM_PICKING`, `PKM|`
- `COMPLETE_PACKING`

Suggested for IA: command `COMPLETE_IA`, correlation `IA|<iaId>`, lock `IAC|<iaId>` / `LOCK|n`, engine op `IAC|<jobId>` (at most 32 characters). Your worker polls only its own command. Leave `gd_id` / `gd_no` empty.

**Shared machinery.** The engine, lock tokens and the job tables `gd_async_job` / `gd_publish_step` are shared and stay unchanged unless their owners agree:
- the GD Completed V2 session (owns the engine);
- the GR / Putaway V2 session;
- the SA V2 session.

Announce your namespace and the exact touch list to every session (ListAgents) before you publish.

**Publishing.** Dev only, through `.dbtools/wf_upload.mjs` with your OWN `--plan` file. Back up first. One user yes per batch. Never prod directly.

**Deployments.** A full dev→prod deployment promotes whatever is on dev, switches included. Keep dev shippable: switch OFF until it's ready.

**Seeding.** Seed from DEPLOYED versions; repo copies here are stale.

**Dev test data.** Items with `tenant_id '0'` are invisible to workflow search nodes; use tenant-000000 items such as JN-MANUAL-02. Keep tests away from other sessions' test items and bins, and ask them first.

**The user's working style:**
- optimization first;
- sparse comments;
- no git commits (the user handles git);
- "pause" = stop every agent at once;
- verdict-first updates;
- confirm before any DB write.

**Skills to invoke:**
- superpowers:brainstorming before scoping;
- authoring-lowcode-workflows and avoiding-bladex-data-traps before writing workflow JSON;
- using-sudu-lowcode-cli and debugging-bladex-prod for dev / prod reads.

## 5. Questions to settle with the user first
1. **Threshold.** Location Transfer and Stock Adjustment use V2 only above 50 lines, through one client constant. IAs have at most 5 components today. All IAs through V2, or only big ones?
2. **Actions in scope.**
   - Complete.
   - Complete & Post: how does the client trigger posting today? Look at `onClick_saveAsCompletedPost` and keep posting working after a background completion.
   - Draft at size.
   - Revert: IA_REVERT stays classic, or a V2 revert?
3. **The costing approach** (§2 gap 1). It may need the engine owners.
4. **Mobile and eligibility.** Mobile stays classic? HU / serial / batch-generation documents in v1, or classic only?
5. **Prod.** Ship ON or OFF in the next full deployment?
