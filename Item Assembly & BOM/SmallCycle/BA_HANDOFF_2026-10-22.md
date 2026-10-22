# Small Cycle IA — Remaining Fixes and Created Flow

Date: **22 October 2026**. Enhancements: ENH-20261015-010 / ENH-20261015-011.

**This is the single current developer handoff for the remaining work.** It incorporates the user's latest direction to include the **Created** flow. It supersedes the remaining-work instructions in the20October consolidated handoff where they differ, particularly reservation on first Draft save. Earlier documents remain dated evidence; they are not additional conflicting task lists.

**Agreed flow:** Draft does not reserve. Saving as **Created** reserves available eligible raw materials and shows any shortage without refusing the save. Existing native completion consumes actual inputs and receives actual FG. Short completion releases unused holds after success and leaves SO shortage for manual planning.

**Preserve current IA/BOM business semantics.** This patch adds/corrects scoped lifecycle, concurrency, ownership, access, history and UI controls. It does not redesign BOM masters, native stock valuation, material issue/receipt ownership, sales fulfilment or the larger MES flow. Implementation and all application testing belong to the developer.

## 1. LOWCODE limits and evidence boundary

Use **LOWCODE, including Code and SQL Nodes; no backend changes**. The supplied BA confirmation admits shared-writer races, a two-tab completion gap, Reserved consumption without ownership checks, mobile orphan/stale holds and screen-only permission boundaries. These are unmet core controls, not accepted minor risks merely because they were disclosed.

If existing LOWCODE/native facilities cannot safely provide a required control, identify the exact unsupported capability and affected entry points before enabling it. Do not silently introduce backend changes, globally rewrite native writers, depend on users avoiding simultaneous work, or describe an unsafe approximation as completed reservation.

Evidence used:

- Developer's [BA confirmation,22October](/Users/potlink1999/Downloads/BA_CONFIRMATION_2026-10-22.md), including C1–C29 and known open items.
- [BA confirmation review](2026-10-22-small-cycle-ba-confirmation-review.md).
- [20October consolidated handoff](Small%20Cycle%20IA%20Consolidated%20Developer%20Handoff.md) and its captured source evidence.

The22October implementation/live/test statements are **developer reports**, not independently verified DEV/PROD results. No fresh database/CLI/browser checks or application tests were performed to prepare this document. The reported U09–U16 runs preceded or did not fully cover the final Created flow. Promotion dates in the supplied document are not deployment approval.

## 2. SAP baseline and deliberate SUDU simplification

Official sources checked22October2026. Relevant scope: S/4HANA **PP discrete production and MM-IM reservations/goods movements**; SD delivery remains separate. SAP Help below identifies **Cloud Public Edition2608**; the Learning lesson does not pin an edition/release. Do not conflate WM/EWM, PP-PI, Business One or separately configured ATP/make-to-order behavior.

| SAP reference baseline | SUDU reported behavior | Gap | Required SUDU outcome |
|---|---|---|---|
| Dependent reservations follow their preceding document and are updated through it ([SAP Help: Reservations](https://help.sap.com/docs/sap_s4hana_cloud/32da8359c8ee4e8b8e8c5e15cacba5aa/37485192f5d746f2bfe85d9ad00bebf3.html)) | IA/component holds, with Created as the reserving stage | Mobile and some other routes can bypass lifecycle/ownership | One authoritative IA-owned hold lifecycle, guarded on every supported entry point |
| Component reservation precedes issue; actual issue reduces stock/reservation and records actual costs ([SAP Learning](https://learning.sap.com/courses/manage-production-orders-in-sap-s-4hana-manufacturing/posting-goods-issues-for-production-orders)) | Existing classic/queued IA completion retained | Duplicate/concurrent requests and incomplete cleanup remain possible by the report | Native actual issue/receipt once; durable hold close/release and native reversal |
| Automatic issue/receipt depend on configuration; failed movements require correction/reprocessing ([SAP Help: Goods Movements for Confirmation](https://help.sap.com/docs/SAP_S4HANA_CLOUD/2bba750d1e124e1ea2a039bb1cd9b6c5/2d01e2ba9e0e4058bd46cda3c2086bcb.html?locale=en-US)) | Reservation/close can be asynchronous; Needs review exists | Browser-started work and recovery proof incomplete | Durable pending effects and authorized reconciliation without extra normal-production approval |

Created is the agreed **SUDU** stage, not a claim that it is SAP's equivalent status. Keep the SME cycle short: no JO, mandatory operation reporting or additional warehouse approval. Planner selects source/recipe/quantities and Created; authorized operator completes; native inventory/cost owners post/reverse; sales handles delivery. Existing item/BOM/UOM/plant/location/tracking masters remain in use.

Reservation/release changes availability only, not total physical on-hand or consumption accounting. Native actual issue/receipt and reversal retain existing valuation/category rules. SAP sources do not prove SUDU locking or API authorization; those controls are required by this handoff and must be evidenced separately.

## 3. Final Created lifecycle

Use existing native status fields/actions plus **Created**. Coverage/recovery labels such as Reserving or Needs review are not new production statuses unless an existing verified platform model already owns them. Confirm actual bindings rather than inventing new physical columns/endpoints.

| Action/state | Required behavior | Stock and control boundary |
|---|---|---|
| New/open unsaved IA | Existing Standard/Flat preparation and optional SO selection | No durable holds, issue or FG receipt merely from opening/preparing |
| Save Draft | Save intended IA data; reserve nothing | Preserve native validation; no physical/cost effect |
| Draft → Created | Save Created intent and durably arrange reservation of available eligible inputs | Shortage is nonblocking. Saving Created is not proof reservation succeeded; display pending/result truthfully |
| Edit/save Created | Remain Created; reconcile own holds against the newly committed material intent | Claim only available additional quantity and release unused surplus safely; no double hold or stale overwrite |
| Quantity/material/mode/plant/bin/UOM change | Existing saved-BOM/material review plus guarded hold reconciliation on successful save | Reopen does not read current master to replace recipe; failed edits do not leave unmatched old/new holds |
| SO unlink/reduction/cancellation | Keep accepted warning/manual behavior | Do not release raw holds while IA material demand remains. Unlink retains prepared recipe, plan, keys and native selections |
| Draft direct Complete / Complete & Post | Existing permitted direct path uses eligible free stock | No forced Created step, extra persistent hold or bypass of stock/permission/tracking checks |
| Created Complete / Complete & Post | Use matching own held inputs plus additional eligible free stock where actuals require it; receive actual FG | Exactly-once native issue/receipt/cost. Never claim another owner's hold |
| Processing/queued completion | Preserve holds/protection through the real commit | Submission success is not consumption or a reason to release holds |
| Successful completion, including short output | Close consumed own fragments and release unused remainder | Keep plan/history and actual output/materials. SO shortage remains open; no auto replacement IA |
| Failed/uncertain action | Show durable pending or Needs review with effect references | Do not release blindly, repeat stock posting, or imply completion/coverage before outcome is known |
| Permitted delete/abandon Created | Use guarded native deletion/abandon path, release unused own holds and preserve audit | No orphan holds. If release/restore cannot safely finish, retain recoverable state and refuse a misleading success. No new cancellation subsystem required |
| Native revert | Reverse exact posted actuals/costs/categories under current downstream-use restrictions; result is **Draft with no holds** | No duplicate return or automatic full-plan reinstatement. User explicitly chooses Created again to reserve |
| Clone | Existing source/plan/Flat-clone policy retained; no live hold copied | New clone is Draft; holds only after its own Created action |
| Feature disabled | Refuse new hold acquisition on every entry point; Created acquisition action unavailable | Existing holds still have protected consumption, close/release/revert and recovery. Do not free them or rely only on hiding a button |

Created keeps the current Draft numbering convention until native completion assigns the final number; do not allocate a second number or change numbering owners. Created counts as open production using **Output to Receive**, like Draft/Processing; Planned Output is shown separately. All native source selectors, server state guards, view/edit routing and SO summaries must recognize Created consistently.

Created must not silently return to Draft on ordinary save. Revert is the defined transition back to Draft. Define all allowed state transitions at the server boundary, including old/mobile clients, rather than inferring intent from a client `saveAs` value alone.

### Activation and historical Draft holds

The earlier DEV build reportedly reserved on Draft save. Before switching to Created, identify any existing Drafts with live holds and reconcile their actual owner/effect state. Do not release every Draft hold just because the new rule says Draft holds nothing. Preserve protection until an explicitly reviewed transition/release is completed. No automatic historical hold creation, mass state conversion or cleanup of unrelated reserved stock is authorized here. Record the activation/migration policy and applicable feature-off behavior before activation.

## 4. Remaining fixes

### RF-01 — Protect shared stock across competing writers

Source: C13(a). Reservation locking alone is insufficient when classic GD, Misc Issue, Plant Transfer, Stock Adjustment or small IA writers can concurrently overwrite the same stock.

- Use a compatible, enforced server protocol across supported competing effects: native guarded mutation, authoritative owner or equivalent provable mechanism. Do not prescribe a particular lock technology without verifying the runtime.
- Preserve each native writer's business meaning, stock categories, rounding, costing and allowed rights; document concrete affected callers and before/after guards.
- Do not claim protection based on checking free stock then writing later, UI exclusion or an operational instruction not to use two screens.
- If a supported path cannot participate safely in LOWCODE, report the limitation. A temporary reduced scope must be technically enforced and explicitly agreed; do not silently disable or rewrite unrelated modules.

Acceptance: competing reservations and reservation versus each supported stock writer cannot overbook, lose an update, make balances negative or corrupt free/held/physical totals.

### RF-02 — Server-side one-time IA completion

Source: known two-tab small-IA gap. Keep the one-tab double-click fix, but add an enforced document/action claim or equivalent guarded status/version/idempotency boundary across independent requests.

Only one successful completion may issue actual materials, receive actual FG, close holds and create the corresponding native cost/accounting effects. Concurrent/retried requests must return the existing result, a safe busy response or a scoped stale/refusal outcome; they must not both post. Do not rely on an unlocked second read of status. Cover both classic actions, queued handoff and uncertain-result retries while retaining their current owners.

### RF-03 — Enforce own-hold consumption on every supported route

Source: C13(b). Disposal/Scrap and Goods Issue reportedly can use Reserved stock without checking its owner.

- Ordinary other documents must not consume IA-held quantities. Apply native owner checks at server writers or a technically enforced supported-scope boundary.
- “Not used today” is not enforcement. Preserve legitimate authorized correction/transfer rights with explicit provenance and reconciliation.
- IA may add back/consume **only its own matching** hold fragments once; never make all Reserved stock available to it.
- Preserve original eligible category and item/bin/batch/serial/HU/UOM identity. A category shift to Reserved must not make otherwise ineligible Blocked stock consumable; native eligibility still applies. Revert restores original categories and exact actuals.

### RF-04 — Protect mobile and direct-API entry points

Sources: C2, C24 and the admitted mobile orphan-delete case.

- Until mobile can maintain Created requirements and holds, either route material-affecting save/delete/complete/revert through the same native guarded owner or server-refuse unsupported actions on affected IAs with a clear reason.
- Preserve omitted stored fields, but do not mistake that for protection against a changed plant/item/quantity, child-line deletion or whole-IA deletion.
- Validate session tenant plus native user record/action scope on read, create/link, Created/reserve, save, delete, complete, revert and relink, including scripting/direct workflow invocation. Keep the two SO row permissions, but button visibility is insufficient.
- Plant-only membership must not implicitly authorize every plant/record in an organization. Where the platform already supplies enforcement, identify and prove it instead of adding contradictory policy.

Do not freeze all legacy/mobile operations unnecessarily. Limit new refusal/routing to the state/effect that cannot safely be supported, while retaining existing record integrity. Wider mobile UI delivery remains backlog; server protection does not.

### RF-05 — Durable Created-to-reservation obligation

Source: C7. The browser may display progress or request a worker kick, but it cannot be the sole owner of the reservation obligation.

- The successful Created transition must leave a durable reservation intent/pending state tied to IA identity, committed material revision and request/effect identity. Persist it before reporting the reserving request as accepted.
- Recovery must work if the browser closes or the network fails between IA persistence and reservation execution. Duplicate kicks/retries must not acquire duplicate holds.
- A Created IA can legitimately be pending, fully held, partly held or short. Do not show Fully reserved from the document status or a successful form response alone.
- Block unsafe completion/conflicting mutations while the relevant revision is being reserved or its effect is uncertain. A partial hold with known shortage remains valid and may complete valid shorter actual output using native checks.
- Reconcile committed demand versus existing **own** fragments; preserve stable ownership across component replacement and handle stale material revisions safely.

If the platform cannot host one atomic operation, prove a durable guarded/recoverable sequence. This does not authorize an unprotected free-stock interval or browser-only follow-up.

### RF-06 — Complete delete/close/revert recovery

Sources: delete-then-release/restore, C3/C11 and partial reconciliation disclosure.

- Show durable states for interrupted delete, failed release, failed restore, close versus revert, expired worker ownership and repeated reconciliation. A soft-deleted/tombstoned IA and fragments must remain resolvable to their original owner while recovery is pending.
- Closing surplus reservation must not depend on a person reopening the IA. Opening may display/kick a known recovery job, but recovery must be resumable server-side and effect-idempotent.
- Do not release arbitrary holds merely because the IA says Draft. Validate transition/effect provenance, especially during the Draft-to-Created migration and after revert.
- Block unsafe revert until earlier close/consumption outcome is known; do not require a separate manual warehouse procedure to hide a missing recovery mechanism.
- Complete the reserved-bucket/owner reconciliation for all touched fragments and native aggregate layers. Do not “repair” unrelated historic mismatches automatically; isolate the affected action with Needs review and authorized reconciliation.

Physical returns of actually issued material use native reversal/movement rules. Releasing never-issued holds is only an availability release, not a physical warehouse return.

### RF-07 — Guard completed-source repair at mutation

Source: C29. Re-reading immediately before writing is not a stale-state guard.

Retain only the defined manual repair: Completed/Fully Posted IA with removed source line → current line of the same SO/item/organization. Refuse Processing and unauthorized records. Condition the actual mutation on expected status/source/version or equivalent enforced state. Retain old/new durable identities, original baseline, actor/time and reason. Change trace fields only—no inventory/cost recalculation or SO resizing.

If safe repair cannot be supported, surface the trace issue and keep that exception unavailable until resolved; do not broadly unlock completed IAs. Correction of a wrong-but-existing source beyond this policy stays backlog unless separately requested.

### RF-08 — Finish minimum material change evidence

Source: C25. Preserve the reported header-field history and native stock movements, but add durable before/after material evidence with actor/time. Required evidence covers material identity/UOM, required/actual intent and meaningful manual additions/removals/changes and relevant selection changes before posting.

Use existing platform audit where suitable. A compact material snapshot/diff can satisfy this; separate audit records for every cell are not mandated. Do not create a second physical stock ledger. Source/plan/mode/BOM preparation, Created transition and hold acquire/change/consume/release/recovery need their native references as well. Read-only navigation does not create a change event. A rich history screen remains backlog.

### RF-09 — Preserve manual Required intent and true coverage

Source: C8 and the under-picking wording issue.

- Keep Required, selected/picked, reserved, unreserved and consumed actual quantities distinct. Auto-allocation finding6 of required10 must not turn the requirement into6.
- Required follows saved BOM reference/output by default; explicit manual override stays manual through later output changes unless the planner explicitly restores automatic behavior. Do not infer no override merely because an entered value equals an earlier reference.
- Do not redefine existing `requested_qty`, `total_quantity`, `item_qty` or native pick payloads by assumption. Map any new Required/intent metadata explicitly.
- Distinguish genuine lack of eligible free stock from deliberate under-selection, unsupported tracking, unsaved changes and failed/pending reconciliation. Native selection priorities and eligible stock pools remain unchanged.

### RF-10 — Close the tracking-support scope gap

Source: C6. HU and serial hold acquisition are excluded by the developer report, although the consolidated requirements retained native batch/serial/HU compatibility.

Do not silently mark these components protected or call that exclusion an approved backlog decision. Developer must either support them through compatible native facilities or identify the unmet scope and obtain an explicit narrower release decision. Until then, UI must show unreserved/unsupported components and must not imply full material protection for an IA containing them. Preserve existing tracked-item completion, identity and valuation behavior; do not disable valid legacy production merely because new reservation coverage is incomplete. Batch support claimed in the document still needs native evidence.

## 5. UI corrections — finish the existing layout

Keep the new Production / Sales Order Link / Output Location / Materials / Additional Details structure. Plant may remain at the top to preserve the current workflow. No second redesign, mandatory wizard or extra normal-production approval is required.

| Area | Required final behavior |
|---|---|
| Draft | Clear “Draft — no stock reserved”; Created action explains reserve available/show shortage. Remove the old promise that any Draft save reserves |
| Created action/status | Existing document action placement and permissions; truthful pending/result feedback; no fake receipt or consumption from a reservation |
| Plan/output | Adjacent Planned Output and Output to Receive; Actual Received only after successful native completion; UOM visible |
| Reservation summary | Show committed coverage and last successful check; reflect pending/Needs review distinctly. No Fully reserved implication from Created alone |
| Unsaved edits | A visible “Unsaved material changes — reservation reflects the last saved version” marker on affected materials/summary; clear only after the corresponding committed reconciliation/result |
| Per-material facts | Required / Reserved for this IA / Unreserved with reason / UOM plus current native picks; do not sum incompatible material units into one quantity total |
| Coverage wording | Genuine stock shortage versus deliberate unallocated qty versus unsupported tracking versus pending/failed result. “Nothing to reserve” only when there truly are no eligible stock inputs, not when eligible inputs were skipped |
| SO card | Keep normal-contrast read-only facts, exact source line/customer, separate delivered and produced figures, visible source warnings and contextual actions |
| Suggestion | Preserve exact-or-Unavailable behavior and manual quantity entry; Use Suggestion disabled only when unsupported. Any “at least N” excess must be a proven bound in the stated UOM/source-use model |
| Recipe/material review | Keep saved version/Flat choices and explicit Prepare/Refresh differences. Refresh SO figures must not refresh the recipe |

Demand/excess warnings remain nonblocking. Native stock/tracking/authority validations, stale requests, busy reservation, Needs review and duplicate effects may legitimately refuse an unsafe operation. Correct C21's overbroad “only these cases block” wording accordingly.

## 6. Current IA/BOM behavior to retain

- Standalone IA and both SO entry points; one exact SO line per IA/many IAs per SO line. SO link remains trace-only: no FG holds, auto delivery, SO closure or automatic replacement IA.
- Standard direct executable components; user-selected Flat expansion. Ticks apply to every occurrence of that item, with actual child BOM/version/use paths visible. Valid explicit references take priority under current resolver eligibility; do not alter shared master defaults.
- Flat reserves/consumes terminal inputs, including unticked SFG. Never reserve/consume an expanded intermediate and its children on the same requirement. No intermediate receipt or child IA is introduced.
- Saved reproducible root/child recipe basis governs reopen and quantity review. Explicit refresh shows differences and reviews affected picks/holds. Preserve unit conversion, allowance, rounding, REF/non-stock, cycle/depth/size and native serial/HU safeguards.
- Preserve permitted manual material variance. Failed Flat/preparation cannot authorize stale-header posting.
- Unlink retains plan/snapshot/reference keys and actual selections. Existing source reduction/cancellation warns; no new trace-only completion veto.
- Native material issue, actual FG receipt, batch/serial/HU, stock category eligibility, valuation, accounting continuation and original-actual reversal remain under current owners.
- Existing no-hold Draft/direct Complete, historical records, SO→WO and unrelated BOM consumers retain their meaning. No historical automatic recipe/plan backfill or unrelated stock cleanup.

The remaining fixes intentionally affect scoped guards, availability, audit and UI. That is an impact and requires caller/regression evidence; additive implementation alone is not proof of no impact. Do not broaden this into an unreviewed stock-engine rewrite.

## 7. Technical mapping and developer-confirm gates

Known anchors below come from earlier captured contracts; they are **not verified22October current versions**. Re-pull/inspect current definitions before editing. If using LOWCODE CLI, follow the repository's current `dev-main` profile/mirror instructions rather than retired environment caches.

| Anchor | Known ID / fields | Required assessment |
|---|---|---|
| IA model/form | 2098256587713404929; native page2098312073316716546 | Created actions/status, all load/edit/clone/quantity/material callbacks, mobile omitted fields and UI pending/result bindings |
| IA_SAVE | 2098335576774463489 | Draft/Created/direct Complete/classic idempotency, permissions, durable intent and actual native posting |
| IA_V2_SUBMIT / worker | 2112141238600376321 / 2112141277456408577 | Committed material revision, protected hold handoff, native publish/retry/readback; assess actual prepare/publish callers |
| IA_REVERT | 2099319746652852225 plus current V2 callers | Exact actual category/cost restoration, close gate, one-time retry and resulting Draft/no-hold state |
| SO projection / source repair | 2112448183267332097 / 2112448260018900994 | Created open coverage, scoped rights, unavailable semantics and guarded trace-only repair |
| SO / BOM models | 1902773735979597826 / 1902195284188975106 | Preserve sales/FG semantics and shared BOM defaults/consumers |
| Shared native writers | GD, Misc Issue, Plant Transfer, Stock Adjustment, Disposal/Scrap, Goods Issue and other IA stock paths | Races, ownership, native categories/valuation and effective permissions; confirm exact current IDs/callers |

Previously verified IA header names: `source_so_id`, `source_so_line_id`, `source_so_context_json`, `bom_consumption_mode`, `source_bom_id`, `bom_snapshot_json`, `planned_output_qty`; component `sc_ref_key`. Existing `item_qty`, `stock_movement`, `requested_qty`, `total_quantity` and stock-picker fields retain their native meanings. Classic save's earlier `{ allData, saveAs, pageStatus }` mapping is not a new universal payload for Created, reservation, V2 or revert.

Developer must record exact current reservation model/writer IDs, IA/component/fragment discriminator, Required/manual-intent mapping, Created status persistence/validation, pending/effect/material-version fields, request/result shapes, audit storage, guards, UOM/precision and permission enforcement. These names are not invented existing schema in this document. Earlier `on_reserved_gd`/balance evidence is only a reuse starting point; confirm actual current contracts.

Confirm own-held add-back semantics and category buckets before changing calculations: some native free quantities may already be net of allocated Reserved stock. Do not subtract the same ledger quantity again or double-count HU aggregates. Reconcile scoped identities across ledger, aggregate balances and native actual movements.

## 8. Developer-owned acceptance on the final Created build

No application tests are run by preparing this handoff. Developer must report final object versions and evidence for the actual final code, using permitted isolated data. Existing mock/live tests may be reused only where the tested semantics and code still match. Do not claim a whole U09–U16 group passed when concurrency, failure, tracking or final Created paths were not exercised.

| Test | Required outcome |
|---|---|
| T01 Draft/Created/legacy | Draft saves no hold; Created reserves; old records do not acquire holds on open. Prior Draft-held data is handled under the recorded activation policy |
| T02 Required80/free50 | Created saves reserved50/short30; later eligible stock plus save/recheck claims only remaining available qty once |
| T03 Durable pending | Close browser/drop response between Created persistence and reservation; durable obligation survives and safely resumes; no false Fully reserved or unsafe completion |
| T04 Shared stock concurrency | Competing IAs and reservation versus each supported writer cannot lose updates, overbook or take another owner's hold; exercise real overlap, not sequential requests only |
| T05 Two-request completion | Two tabs/users/direct requests for the same classic IA and queued duplicates produce one native material issue, FG receipt and cost effect |
| T06 Ownership bypass | GD/SI, Disposal/Scrap, Goods Issue, transfers and other supported consumers cannot use IA-held stock without native authorized ownership/reconciliation |
| T07 Mobile/direct API | Server-protected material edit, line deletion, whole deletion, Created/reserve, Complete and revert; no stale/orphan holds or permission bypass. Unaffected legacy operations remain usable |
| T08 Manual intent / edits | Required override survives output changes even when equal to an earlier reference; partial auto-pick does not shrink need. Plant/bin/item/UOM/mode/material changes reconcile only proper own fragments |
| T09 Normal/short actual |80 held,70 actually used: native issue70, actual FG receipt once, unused10 released after success; SO shortage/manual follow-up preserved |
| T10 Direct Complete / Complete & Post | Draft path uses eligible free stock; Created uses own-held plus eligible additional stock. No extra lingering hold, duplicate stock or repeated accounting on retry |
| T11 Failure/delete/restore/close | Interrupted or uncertain actions, failed restore and concurrent recovery remain durably identifiable and protected without a required manual reopen |
| T12 Repeat complete/revert | At least two full cycles on classic and queued paths; exact original categories/quantities/costs restored once, native downstream checks retained; resulting Draft has no holds |
| T13 Tracking | Native batch and supported serial/HU cases preserve identity and availability without duplicate netting. Any unsupported scope is explicitly decided and honestly displayed |
| T14 Permissions/relink | Restricted roles/orgs/plants/tenants and direct calls refuse unauthorized records/actions; competing relink/status/source change cannot overwrite stale state |
| T15 Audit/reporting | Header and meaningful material before/after history plus hold/posting/reversal refs survive; free/held/physical totals reconcile; summary reads create no change event |
| T16 Actual browser UI | Final Created actions, plan/output labels, long names/UOM, pending edits, shortage/unallocated/unsupported/error states and required location controls are coherent |
| T17 Feature-off | New holds refused server-side; existing holds can still be safely consumed/closed/released/reverted/recovered; button hiding does not leave active unsafe endpoints |
| T18 Native regression | Standalone, same-form SO entries, trace-only sales/delivery, saved Standard/Flat basis, source warnings, manual variance, existing stock/cost/tracking, no-hold legacy/mobile, shared BOM and SO→WO retain specified rules |

Complete applicable original SC01–SC26 and U01–U21 as well, with the trigger/state expectations updated to Created. Tests for UI layout, basic flows and end-to-end native posting belong to the developer. Record each criterion as **passed on final code / partial / pending / explicitly excluded**, with evidence; do not equate disclosure of a limitation with passing its gate.

## 9. Delivery evidence and backlog

Before declaring completion, provide: final state-transition table; changed object/version list; native owner and payload/guard mappings; exact supported tracking/client/consumer scope; recorded migration/feature-off policy; field/material audit coverage; final-code test results; and unresolved LOWCODE limits. No deployment or production permissions are granted by this document.

**Minor/backlog:** rich history viewer, advanced tree/path-specific Flat selections, automatic background shortage top-up, additional analytics, candidate-list polish, broader mobile UI after records are server-protected, wider source repair, and larger-cycle JO/machines/calendar/scheduling/WIP/QC/rework/WMS features.

**Core, not backlog:** shared-stock/own-hold protection, one-time native posting, server authority, mobile record integrity, durable reservation/recovery, minimum material evidence, correct intent/coverage and honest UI result state. Keep the ordinary SME production cycle short while implementing those controls.

The original small-cycle and larger-cycle contracts remain separate historical baselines. The requested Created trigger is now explicitly recorded here; no remaining instruction should silently reserve on ordinary Draft save. This handoff records requirements and limits, not a claim that the application is fixed or regression-free.
