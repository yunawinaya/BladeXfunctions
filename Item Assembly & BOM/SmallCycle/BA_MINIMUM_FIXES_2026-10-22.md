# Small Cycle IA — Minimum Fixes to Keep Created Reservation On

Date: **22 October 2026**. Reviewed revision **1.1**. ENH-20261015-010 / ENH-20261015-011.

**Objective:** retain the client-facing Created reservation flow and fix the minimum controls needed for reliable IA-owned raw-material holds. Keep current IA/BOM business semantics, use **LOWCODE with Code/SQL Nodes only**, make **no backend changes**, and leave implementation and application testing to the developer.

This is the **current minimum reservation worklist**. The broader Small Cycle requirements remain the baseline; deferred requirements are not silently declared fulfilled. The user's request to keep reservation on does not waive the controls below or authorize backend changes. No runtime setting, code, database stock or deployment is changed by this document.

## 1. Scope and feasibility first

Required outcome: **Draft → Created/reserve available → native Complete/consume actual/release unused → native Revert/Draft with no holds**.

The developer's [release-decision memo](/Users/potlink1999/Downloads/RELEASE_DECISION_2026-10-22.md) states that RF-01–RF-06 are unmet. Those are developer-reported limits, not independently verified current DEV/PROD behavior. It also proposes moving multiple modules onto another stock engine. This handoff requires the protection outcome, **not that particular architecture**.

- Reuse verified native locked writers, guarded mutations, persistence and recovery wherever suitable. No wholesale module rewrite, new backend service or new infrastructure is prescribed.
- Identify the exact stock scope and writers that overlap IA holds. Apply compatible guards/ownership checks to those affected paths, including requests already in flight. Unrelated materials, bins and normal module business rules remain unchanged.
- A reservation-only lock cannot protect against another writer that ignores it. Read-then-write checks, hiding buttons and telling users to avoid simultaneous work do not meet the requirement.
- If the required protection is unavailable in LOWCODE, report the exact operation, reason and enforceable supported-scope option. Do not replace the requirement with an acknowledged race or silently disable whole modules. Any reduced scope must be explicit and technically enforced.
- Keep existing live holds protected during fixes and feature-flag changes. Do not release them indiscriminately to make the system fit the new rule.

No new normal-production approval, JO, warehouse task or mandatory operation reporting is included.

## 2. Reference baseline and evidence

Official SAP references checked 22 October 2026. Scope: **S/4HANA PP discrete production and MM-IM**, separate from SD delivery. SAP Help identifies **Cloud Public Edition 2608**; the Learning lesson is not pinned to an edition/release. No WM/EWM, PP-PI or SAP-specific locking/stock-segregation design is assumed.

| SAP baseline | Reported SUDU state | Gap | Minimum requirement |
|---|---|---|---|
| Dependent reservations follow their source document ([SAP Help: Reservations](https://help.sap.com/docs/sap_s4hana_cloud/32da8359c8ee4e8b8e8c5e15cacba5aa/37485192f5d746f2bfe85d9ad00bebf3.html)) | Created IA/component holds exist | Other writers/mobile can bypass ownership/lifecycle | Stable IA/component ownership enforced on all supported affected paths |
| Reservation precedes actual issue; issue reduces stock/reservation and records actual costs ([SAP Learning](https://learning.sap.com/courses/manage-production-orders-in-sap-s-4hana-manufacturing/posting-goods-issues-for-production-orders)) | Existing classic/queued completion retained | Duplicate effects and close/recovery gaps reported | Native actual issue/receipt once; owned holds consumed/released and native actuals reversed correctly |

Created is a SUDU simplification, not an asserted SAP status equivalent. Planner chooses recipe/material intent and Created; authorized operator completes; native inventory/cost owners post/reverse; sales retains delivery ownership. Existing item/BOM/UOM/plant/bin/category/tracking masters stay in use. Reservation/release changes availability, not physical on-hand or consumption accounting. Native issue/receipt/revert retain current cost and category rules. Coverage/audit reporting distinguishes Required, Reserved, actual consumed and delivered quantities.

Sources for scope: [latest full remaining-fix handoff](Small%20Cycle%20IA%20Remaining%20Fixes%20and%20Created%20Flow.md), [BA review](2026-10-22-small-cycle-ba-confirmation-review.md), developer's release memo and BA confirmation. No fresh DEV/PROD query, browser check or application test was performed for this minimum-scope document. SAP sources do not prove SUDU concurrency, API authority or LOWCODE feasibility.

## 3. Created behavior to retain

Reserving/Needs review are material-coverage or recovery labels, not additional normal production steps. Reuse verified native fields where appropriate; no extra approval/status ladder is required.

| Action | Required minimum behavior |
|---|---|
| Open/prepare unsaved IA | No hold, physical movement or cost effect |
| Save Draft | No reservation; preserve existing native validation and standalone behavior |
| Save as Created | Durably record the reserving intent and attempt eligible available inputs. Required80/free50 means Reserved50/unreserved30; shortage does not refuse the save |
| Save an edited Created IA | Remain Created; reconcile own holds for the committed material revision. Claim only the available extra and release only unused surplus safely |
| Draft direct Complete | Keep existing permitted free-stock path; do not force Created or leave an extra hold |
| Created Complete / Complete & Post | Consume own held inputs plus additional eligible free stock required by reviewed actuals. Native issue/FG receipt/cost occur once; unused own hold released after successful effect |
| Short completion | Keep planned output separate from actual output. Plan10/actual6 receives6 under native rules; review actual materials and release unused own holds. SO shortage stays open; planner manually creates another IA if needed |
| Queued Processing | Preserve protection until the real commit. Retain the originating Draft or Created state in the command; restore that state only on a proven pre-posting failure where native recovery permits. Uncertain/partly posted results require reconciliation, not a blind state reset |
| Delete/abandon through permitted native action | No orphan holds; guarded delete/release/restore outcome is durably recoverable and retains audit |
| Native revert | Exact posted actuals/categories/costs restored once under existing restrictions; resulting Draft has no holds. User selects Created again to reserve |
| Clone | Preserve existing clone policy; no live hold copied; new Draft reserves only through its own Created action |
| SO unlink/reduction/cancellation | Trace-only response; no automatic raw-hold release while IA material demand remains. Preserve recipe, plan, keys and native picks |
| Reservation feature disabled | Server refuses new hold acquisition; existing holds can still be consumed/closed/released/reverted/recovered safely. Native completion can still issue additional eligible free stock under its existing rules. No automatic Created-to-Draft reset or hold release; hiding Created alone is insufficient |

Created uses existing numbering convention until native completion assigns the final number. Count Created as open production using Output to Receive, separately from Planned Output. No ordinary save silently returns Created to Draft. All state transitions are checked by the server, including stale/mobile/API requests.

Before activating this rule over an earlier Draft-reserving build, verify whether live Draft holds actually remain. Preserve and reconcile any found owner/effects under an explicit transition policy; do not release by status alone or perform automatic historical hold backfill. The developer's earlier “no live holds” report is dated evidence, not a permanent assumption.

## 4. Six minimum fixes

| Earlier item | Minimum disposition |
|---|---|
| RF-01 + RF-03 | MIN-01: compatible shared-stock guards and own-hold enforcement |
| RF-02 | MIN-02: one server-owned completion/effect result |
| RF-05 + required-intent portion of RF-09 | MIN-03: durable reserving obligation and correct material revision/target |
| RF-04 | MIN-04: server integrity/rights; broad mobile UI can follow later |
| RF-06 | MIN-05: recoverable hold close/release/delete/revert with effect evidence |
| Reservation UI + RF-10 scope | MIN-06: truthful coverage and explicit supported/excluded materials; no inferred approval of exclusions |
| RF-07 + broader RF-08 and other polish | Deferred as stated in section8; unsafe active repair must still be guarded or unavailable; minimum effect evidence remains required |

### MIN-01 — Shared stock protection and reservation ownership

Combines the necessary outcomes of RF-01 and RF-03.

1. Guard reservations **and all supported writes touching the same stock identities** with a compatible server protocol. Inventory the actual competing GD, Misc Issue, Plant Transfer, Stock Adjustment, small IA, Disposal/Scrap, Goods Issue and other affected paths; include source/destination and relevant balance layers.
2. Prevent lost updates, over-reservation and use of another document's holds. IA can claim only its own matching fragments once; Reserved is not a generally consumable category for ordinary documents.
3. Preserve tenant/organization/plant/bin/material/UOM and applicable batch/serial/HU/category identity and native eligibility. Do not make ineligible Blocked stock consumable merely by moving it to Reserved. Revert preserves original categories.
4. Prove free-versus-reserved bucket semantics. Some native free quantities are already net of allocated holds; do not subtract the reservation ledger again or double-count HU aggregates.

Keep native movement types, quantities, rounding, cost ownership and legitimate authorized correction semantics. A narrow compatible wrapper/guard is acceptable if every affected writer respects it; migrating entire modules is not automatically required. A bounded stock scope is acceptable only when enforced at all entry points and explicitly agreed, not as a verbal rule.

### MIN-02 — One server-owned IA completion per command

Required even if the two-tab gap predates reservation.

- Retain one-tab double-click prevention, but claim the IA command at the server before effects using a native claim/guarded state or equivalent durable idempotency mechanism.
- Two tabs/users/direct requests must not both issue materials, receive FG, post corresponding cost or close/release the same holds.
- Exclusion applies to the same IA production cycle even when callers use different request IDs. A successful native revert permits a new legitimate completion cycle; old callbacks must not act on that newer cycle. Retain the originating state and cycle/revision identity rather than permanently marking an IA as already completed.
- Apply to affected classic Complete, Complete & Post, direct Draft Complete and queued submit/publish/retry paths while retaining their native owners.
- Busy/stale/retried commands must return a safe outcome or the existing result. A second unlocked status read and a browser button lock are insufficient.
- A crash/timeout must leave enough effect identity to decide what happened before retrying. Do not reset to Created or repeat physical posting merely because a response was lost.
- Expiry of a claim alone does not prove that the previous attempt stopped or had no effect. Recovery must prevent an earlier attempt from committing alongside its replacement, using a proven native mechanism or equivalent guarded ownership.

### MIN-03 — Durable Created intent, material revision and reservation result

Fix the required outcome of RF-05 without prescribing a new scheduler implementation.

- Created/save of Created must persist a reserving obligation tied to IA, committed material revision and stable request/effect identity before reporting the request as accepted. The browser may kick execution/display progress; it must not be the only record that work is required.
- Use a compatible existing LOWCODE queue/worker/recovery facility if available. A dedicated new worker or scheduler is not mandatory if equivalent durable processing/recovery is demonstrated.
- Browser closure/network loss must not erase the obligation. Pending/failed work must be visible and discoverable without guessing which IA to reopen. Support an authorized server-side retry/reconcile entry through an existing suitable screen/worklist if automatic dispatch is unavailable. This is exceptional recovery, not an extra approval on normal production.
- Do not promise unattended automatic execution unless an actual trigger exists. Fully autonomous scheduling is separate from the core requirement to persist, expose and safely resume an interrupted effect.
- Completion/conflicting mutations must validate that the reservation outcome belongs to the current committed materials. Pending or uncertain results cannot be presented as Fully reserved; known partial reservation with shortage is valid.
- Coordinate save/reserve, completion, delete and revert through a compatible guarded IA/revision boundary. An older reserve or release callback must not recreate holds after deletion/completion or overwrite a newer saved demand. Pending/failed edits must leave existing holds accounted for and protected until their own reconcile outcome is known.
- Required remains separate from selected and held. Auto-allocation finding6 of Required10 must show6 held/4 unreserved, not silently reduce Required to6. Explicit manual intent must survive quantity changes even if numerically equal to an old reference. Reuse verified fields or add minimal intent metadata; do not redefine native usage fields.
- Derive the target from the committed executable material list and reviewed manual intent. Do not reserve every reference/snapshot row or re-explode the latest BOM master during reconciliation. Preserve validated native stock selections and allocation rules; if saving recreates child IDs, retain a stable mapping to the previous owned fragments rather than losing ownership or reserving twice.

No job/column/API names are asserted as already existing here. Developer must map the durable boundary and actual restart entry points. A post-save browser callback alone does not qualify.

### MIN-04 — All-entry-point integrity and native action rights

Fix the stock-integrity portion of RF-04 immediately; a full mobile UI release is not mandatory for this minimum.

- Mobile/direct API/scripting must not bypass record rights or mutate/delete a held IA without the same reconcile/release controls. Server-route through the guarded owner or refuse unsupported material-affecting actions on those records until the caller is compatible.
- Preserve stored fields omitted by old clients, but also handle changed quantity/plant/item/child lines and whole-record deletion. Mobile lacking a Created button does not protect an existing Created IA.
- Validate session tenant, authorized organization/plant/record and action on reserving save, edit, complete, delete, revert and recovery. Menu visibility is not the authorization boundary.
- Where generic data writes bypass every workflow, identify a provable existing server permission/access restriction or compatible guarded route. A mobile guide or telling staff not to delete is insufficient. If no such restriction is available within the allowed scope, declare the capability blocked; do not claim it was solved in LOWCODE.

Limit restrictions to unsupported affected operations. Preserve unaffected legacy/mobile behavior and native permissions. Do not rewrite the whole mobile app merely to provide this safeguard.

### MIN-05 — Recoverable consume/close/release/delete/revert

Fix the required outcome of RF-06 using the same durable effect/recovery boundary as MIN-03 wherever practical.

- Preserve stable owner/fragment/material-revision and request/effect references, original category/identity, actor/time, committed target and actual result. This minimum effect evidence is required; a rich history UI is not.
- Retain the original stock-base quantity and conversion basis needed to reverse/release each effect. A later UOM/master change must not re-convert an old hold or issue using today's conversion and alter the amount returned.
- Consume actual material through the native owner once; close matched holds and release unused surplus only with known successful effects.80 held/70 used means native issue70 and release10, not issue80 or release before uncertain issue.
- A proven native stock completion remains recorded if subsequent hold cleanup or accounting continuation fails. Show the pending follow-up and recover only that missing effect; do not downgrade to an unposted state or issue/receive stock again. Complete & Post accounting retries stay with the existing accounting/post queue owner, never rerun IA_SAVE just to retry accounting.
- Delete/restore, close versus revert and repeated recovery must remain safe after interruption. Keep a recoverable owner/tombstone where needed; do not orphan holds if restoration or a response fails.
- Closing/releasing pending effects must be discoverable/resumable through the defined recovery facility, not permanently dependent on a person opening that specific document. Opening can display or kick known recovery; it cannot blindly release arbitrary Draft holds.
- Revert respects native downstream-use checks and reverses original posted actuals/categories/costs once, leaving Draft with no holds. Preserve existing valid zero/short-output restrictions; do not invent an automatic full-plan reinstatement.
- Reconcile the touched own fragments and native balances. Historic unrelated mismatches are not silently repaired; affected uncertainty is shown as Needs review with an authorized reconciliation path.

Release of never-issued stock changes availability only. Physical returns still use native movements. Ordinary stock shortage is nonblocking at Created; database failure, unknown effect, stale command or unauthorized stock are not ordinary shortage.

### MIN-06 — Truthful coverage and an enforceable supported scope

Only small UI corrections are needed for reservation-on; keep the new IA layout.

- Draft: “No stock reserved.” Created: pending/result of the saved materials, not presumed protection from the status name.
- Display Required / Reserved for this IA / Unreserved with reason and UOM. Distinguish actual shortage, deliberate unallocated quantity, unsupported tracking and pending/failed reconciliation. Do not sum unrelated material units into one total.
- Unsaved edits clearly state that displayed holds reflect the last saved revision; completion must not silently use mismatched data.
- Do not show Fully reserved for an IA whose required inputs include unprotected/skipped stock. “Nothing to reserve” applies only when there are genuinely no eligible stock inputs.
- Preserve current reservation capability while recording exactly which categories/tracking/client/consumer paths are supported. New serial/HU hold engines are not automatically required as part of the minimum build. However, an exclusion is a **scope reduction requiring an explicit business decision**, not approval inferred from this document. Existing tracked-item IA production remains native; unsupported hold coverage must be visible and must not be promised to the client.

If the client's required input types are excluded, their reservation requirement remains unmet. Wider support can be phased only after that is made explicit; do not quietly treat unsupported materials as reserved.

## 5. Preserve current IA/BOM and limit impacts

- Keep standalone IA, exact optional SO line/many IAs, shared form entry points, trace-only FG/delivery and current SO/WO meanings.
- Keep Standard direct inputs and per-IA Flat ticks. Reserve only executable terminal inputs; never both an expanded intermediate and its descendants. Preserve saved recipe basis, version/paths/UOM/allowance/rounding and explicit refresh review; no shared BOM default/master/save changes.
- Keep permitted actual material variance, native stock selection and actual FG quantity. Source unlink retains prepared data; source warnings do not cancel production or release raw holds automatically.
- Short completion retains the original plan and posts only reviewed actual output/material usage. SO delivery and shortage remain independently owned; there is no automatic replacement IA or automatic SO fulfilment in this small cycle.
- Retain native issue/receipt/cost/accounting owners, original-actual reversal and batch/serial/HU behavior. No second IA stock ledger or UI posting path.
- Preserve numbering, native state validations and historical data. No unrelated balance cleanup, historical hold creation or whole-module permission changes.

Authorized impact here is scoped concurrency/ownership/access/recovery around IA holds and their native effects. Identify each affected caller; do not label it “no impact” merely because it is a guard. If wider shared changes are necessary, describe them before implementation rather than silently expanding the patch.

## 6. Technical handoff required from the developer

Use current definitions, not old environment caches. Repository CLI rules use `dev-main` and a fresh profile-specific mirror; no publishing or installation is requested by this document.

Known earlier anchors, **not fresh 22 October verification**: IA model `2098256587713404929`; IA_SAVE `2098335576774463489`; IA_V2_SUBMIT `2112141238600376321`; IA_V2_WORKER `2112141277456408577`; IA_REVERT `2099319746652852225` plus current V2 callers. Confirm actual reservation writer/models and the shared stock consumers before editing.

Provide one compact map of: supported stock/client scope; all overlapping writers; native guard/ownership enforcement; material target/override/revision; durable pending/request/effect storage; retry/reconcile entry; native completion/close/revert handoff; permission checks; and activation/feature-off behavior. Exact fields, payloads, constraints and runtime facilities are developer-confirm items, not invented verified interfaces.

Minimum persistent evidence must allow the system to distinguish a duplicate request, changed intent, pending work, no effect, committed effect and uncertain effect. Keep opaque IDs lossless and native UOM/precision. Do not store credentials or rely on document-number text/row positions alone as ownership.

## 7. Minimum developer-owned acceptance

These checks are **to be run by the developer on the final build**, not tests run by this study. Reuse prior evidence only where code and semantics match. Report passed/partial/pending/explicitly excluded per case, with final versions and actual overlapping requests for concurrency.

| Case | Required result |
|---|---|
| A1 Basic cycle | Draft no hold; Created Required80/free50 reserves50/unreserved30 without shortage refusal; later eligible stock plus save/recheck adds only the remaining available quantity once |
| A2 Shared stock race/ownership | Competing IAs and each supported overlapping writer preserve totals and ownership; no lost updates or another consumer taking IA holds. Exercise source/destination and actual native balance layers |
| A3 Two independent completions | Two tabs/users/direct requests on the same IA, using same and different request IDs and including classic/queued retries, produce one native issue/FG receipt/cost and one hold close/release result. A stale/expired claimant cannot commit a second effect |
| A4 Lost browser/response | Close browser or lose response at Created save/reservation/commit boundaries; durable work remains visible and can safely resume without a required reopen of that IA; no false Fully reserved or duplicate effects |
| A5 Edits and manual intent | Quantity/material/plant/bin/UOM/mode changes and manual Required overrides reconcile only correct own fragments and executable saved rows; native selections survive. Recreated child IDs retain ownership mapping; stale saves/callbacks cannot overwrite newer intent or recreate closed holds; partial auto-selection does not lower demand |
| A6 Mobile/API and rights | Unsupported material edit/delete/complete/reserve/revert routes are server-blocked or use the same guarded owner; no orphan/stale holds, record-scope leak or direct-write bypass |
| A7 Actuals and recovery |80 held/70 used consumes70 and releases10 after success; interruptions of delete/restore/close/revert are durable and repeat-safe. Two complete/revert cycles restore exact original actuals/categories/costs once and end Draft/no holds; prior-cycle callbacks cannot affect the new cycle. Original conversions remain reproducible. Posted stock plus failed cleanup/accounting retries only the pending follow-up, without rerunning stock effects |
| A8 UI/scope and regression | Final browser shows truthful Draft/Created/pending/shortage/unallocated/unsupported/unsaved states; supported tracking identities reconcile. Standalone, direct Draft Complete, SO tracing, saved Standard/Flat, native costing/selection and existing legacy flows retain their rules. Proven queued pre-posting failure restores its originating Draft/Created state. Plan10/actual6 receives6, preserves plan, releases unused holds after success and leaves SO shortage for manual follow-up |
| A9 Activation/feature-off | Existing Draft/Created holds identified and protected; no silent backfill/release/state reset. Disable new hold acquisition server-side while existing holds retain safe consume/close/release/revert/recovery and native completion can issue eligible additional free stock |

Reservation/release alone must leave physical on-hand and consumption cost unchanged. Nonblocking shortage is not permission to post unavailable material or skip native validators. Existing mock tests and the release memo do not replace these final-code outcomes.

## 8. Deferred work and release meaning

**Minor backlog:** fuller layout polish, richer history/analytics screens, advanced Flat tree/path selection, candidate-list convenience, automatic shortage top-up, fully autonomous scheduling beyond the proven recovery path, broader mobile UI, and larger-cycle JO/machines/QC/WMS.

**Other prior requirements deferred from this reservation-on minimum, not declared complete:** comprehensive pre-completion material-change audit beyond the required hold/effect intent evidence; broader tracked-hold coverage once its scope is agreed; completed-source repair improvements. Keep any unsafe unguarded repair action server-unavailable until fixed rather than leaving an unsafe mutation active in backlog. Preserve an authorized manual review route for the trace issue, without changing stock merely to repair a source link.

MIN-01–MIN-06, effect evidence, accurate required intent and acceptance A1–A9 are not minor edge cases. They are the minimum truth behind “Created reserves materials for this IA.”

The target is **Created reservation enabled within a proven supported scope**. This is not blanket risk acceptance, a promise that every LOWCODE limitation is solvable, or authorization to change production settings. No forced global stock-engine migration or new backend is specified. Developer must report any unmet core capability before claiming the enabled scope is protected.

**Review record — revision 1.1:** clarified originating-state recovery, document-wide completion cycles, stale callback protection, saved executable material/selection ownership, original conversion evidence, short completion and separate stock versus cleanup/accounting recovery. The worklist remains six minimum fixes and nine developer acceptance cases. This document review does not establish deployed behavior or guarantee regression safety; the developer must confirm the mapped controls and run the final-build acceptance checks.
