# Small Cycle IA — Consolidated Developer Handoff

Date: **20 October 2026**. Scope: **remaining fixes, UI improvements and raw-material reservation**. Related register items: ENH-20261015-010 / ENH-20261015-011.

**This is the single current handoff for this corrective scope.** It consolidates and supersedes the separate Developer Fix Brief and Reservation Addendum as instructions for the remaining work. The original Small Cycle IA implementation Contract remains the historical full-requirements baseline. Where that baseline differs, this document explicitly retains user-selected Flat expansion and adds raw-material holds on successful save. The larger-cycle contract is out of scope.

All actionable rules, known impacts, confirmation gates and acceptance criteria for this patch are included below. Linked earlier artifacts are evidence/history, not additional conflicting task lists. **Implementation and testing belong to the developer.** Creating this document changes no DEV business records, forms, workflows, stock or accounting, and is not a deployment approval.

## 1. LOWCODE limitations to highlight before implementation

Use **LOWCODE, including Code and SQL Nodes, without backend changes**.

- A Code/SQL node cannot reconstruct missing receipt-to-delivery provenance. When exact remaining production cannot be supported, show **Unavailable**, preserve the known figures and allow manual quantity entry. Do not add an allocation subsystem merely to make a suggestion look exact.
- Existing reservation data/readers provide a reuse starting point, but no safe IA-owned save/hold/consume/release writer has been verified by this review. Developer must establish the native owner, shared-consumer protection, concurrency and failure recovery before enabling holds. A form selection or extra ledger row alone is insufficient.
- If available LOWCODE facilities cannot safely protect shared stock or persist recoverable effects, identify the exact unmet requirement before implementation/activation. Do not silently add backend changes or describe an unsafe approximation as delivered.
- Do not add new approval steps to ordinary production. Use the previously agreed **Needs review** approach for an uncertain durable effect; normal shortage is a different, nonblocking condition.

## 2. Agreed small-cycle boundaries and protected behavior

| Area | Required behavior |
|---|---|
| IA source | Standalone IA remains available; one optional exact SO line per IA; one SO line may have multiple IAs; SO→IA and IA→select SO use the same native IA form |
| Sales and FG stock | SO link is for tracing; keep native sales delivery/outstanding/accounting owners. No customer-exclusive FG reservation, automatic SO fulfilment or IA-created delivery |
| Standard | Preserve current direct executable component behavior and native material review |
| Flat | Retain current user-selected subassembly expansion in IA; no requirement to maintain new BOM references before use. Saved choices and recipe basis govern that IA |
| Shared BOM master | Reuse existing master, default/version/eligibility rules and other consumers. No permanent flattening, global recursive save validator, automatic master reference creation or master/default rewrite |
| Saved IA | Preserve recipe basis, manual usage and native picks on reopen; explicit recipe refresh only. No automatic historical snapshot or plan backfill |
| Raw-material hold — new authorized scope | First durable successful save of a new enabled IA reserves available eligible materials for that IA. Show shortage and allow save. Applies to standalone/SO-linked and Standard/Flat |
| Physical inventory and cost | Reservation/release changes availability, not physical on-hand or consumption cost. Reviewed actual inputs and actual FG use existing inventory/valuation/posting owners once |
| Completion | Preserve existing Draft/Processing/completed behavior, classic and queued execution, Complete and Complete & Post. No mandatory JO, Release, QC, machine or WMS step |
| Short production | Complete at reviewed actual quantity; release unused raw-material holds after success; retain SO shortage. Planner manually creates further IA |
| Source changes | Source reduction/cancellation warns and permits native manual response; it does not automatically resize/cancel IA, refresh recipe or release holds while production demand remains |
| Existing stock consumers | New IA holds necessarily reduce free availability for other demand. Preserve other stock eligibility, valuation, priorities, authorized corrections and existing document semantics |
| Reversal | Preserve downstream-use restrictions and reverse exact posted actuals/costs; never re-explode current BOM or repeat stock posting blindly |
| Legacy/mobile/WO | Preserve proven historical/no-snapshot paths and compatible mobile data. Define explicit legacy-Draft reservation enrollment. No automatic historical holds. Existing SO→WO retirement remains a separate change |

The new first-save raw-material hold explicitly extends the earlier small-cycle exclusion of raw holds. It does **not** change this into the larger cycle's reserve-on-Release flow, create FG holds, or authorize unrelated shared-module changes.

## 3. Evidence and latest known DEV state

This handoff uses the supplied `SMALL_CYCLE_IMPLEMENTATION (1).md` (labeled20October17:50), its earlier version, and exact-ID read-only DEV definition captures. DEV identity was `sudu-nova-4:8787`, account `codex_dev_ro@%`. Stored source is evidence of definitions, not successful browser/stock execution or PROD behavior. This consolidation did not make a fresh DEV connection; developer must inspect current versions before editing.

| Object | ID | Last inspected definition |
|---|---|---|
| Item Assembly model/form | 2098256587713404929 | Updated20Oct17:53:55.463 |
| IA_SAVE | 2098335576774463489 | v15; updated20Oct17:45:38.563 |
| SO_IA_PROJECTION | 2112448183267332097 | v4; updated20Oct17:53:23.815 |
| IA_SC_RELINK | 2112448260018900994 | v4; updated20Oct17:34:23.290 |
| IA_V2_SUBMIT | 2112141238600376321 | Earlier capture v4; not re-read in the17:50 follow-up |
| IA_V2_WORKER | 2112141277456408577 | Earlier capture v3; not re-read in the17:50 follow-up |
| IA_REVERT | 2099319746652852225 | Known native contract anchor; latest complete reversal behavior remains developer verification |
| SO model | 1902773735979597826 | Known contract anchor; verify current page/action IDs and bindings |
| BOM model | 1902195284188975106 | Known contract anchor; do not change its shared meaning/defaults |

Update times are database metadata as returned, without assuming their timezone. Captures were separate reads, not one atomic release snapshot.

| Reviewed item | Current disposition |
|---|---|
| Structured SO display | Separate read-only fact rows exist in the stored form. Keep/improve this implementation; do not rebuild the old grey textarea. Native visual acceptance remains pending |
| Flat referenced-version preview | Updated discovery/preview uses explicit referenced child BOM information. Keep the current selection approach and verify occurrence/version accuracy |
| Organization mismatch response | Latest summary returns an application refusal before attaching mismatched-organization data. The earlier specific response defect is partially remediated; **do not report it as unchanged**. Authorized-user/record scope still requires evidence |
| IA organization presence | New links without a valid IA organization are refused. Valid numeric organization is still not proof of user authority |
| Suggestion / unlink / history | Formula assumption, Standard snapshot deletion on unlink, and limited history remain open in inspected source |
| Completed source repair | Mutation still filters by IA ID after earlier checks; authority/stale-state controls remain to be resolved |
| Mobile | Handoff describes future read-only item/plant/quantity and server preservation of omitted reference fields. Future mobile release is not current verified behavior |
| Raw-material reservation | No explicit IA-owned Draft reservation creation lifecycle was found in the inspected save definition; this is **new scope**, not a verified existing feature |
| Testing | Handoff says browser checks and SC01–SC26 are pending. Mock tests, existing native callers and declared deployment dates do not establish acceptance or regression safety |

## 4. SAP baseline and deliberate SME adaptation

Official references rechecked20October2026. Relevant baseline: **S/4HANA PP discrete production with MM-IM reservations/goods movements and separate SD delivery**. SAP Help pages below identify **Cloud Public Edition2608**; Learning lessons are conceptual and do not pin an edition/release. Do not import WM/EWM, PP-PI, Business One, ATP or make-to-order configuration assumptions.

| SAP reference | Evidenced SUDU behavior | Gap | Requirement / deliberate adaptation |
|---|---|---|---|
| Usage-specific BOM controls govern phantom expansion; BOM settings override material settings ([SAP Learning](https://learning.sap.com/courses/exploring-basic-data-for-manufacturing-and-product-management-in-sap-s-4hana/describing-phantom-assemblies)) | DEV has per-IA selections and saved expansion basis | Different from earlier explicit-reference-only contract | Retain simpler IA-level selection; show actual recipe/occurrence scope and preserve saved basis. Do not require new shared-master maintenance |
| Dependent reservations follow their preceding document ([SAP Help: Reservations](https://help.sap.com/docs/sap_s4hana_cloud/32da8359c8ee4e8b8e8c5e15cacba5aa/37485192f5d746f2bfe85d9ad00bebf3.html)) | IA components and shared reservation readers exist | IA-owned durable hold lifecycle unverified | Save/material changes reconcile IA-owned holds; no independent duplicate reservation owner |
| Production-order component reservations precede actual issue ([SAP Learning](https://learning.sap.com/courses/manage-production-orders-in-sap-s-4hana-manufacturing/posting-goods-issues-for-production-orders)) | IA completion owns issue/receipt | Save now needs material protection | Use successful IA save as trigger, with no extra Release step; consume through native completion |
| Automatic issue depends on backflush; receipt depends on control key or scheduling profile ([SAP Help: Goods Movements](https://help.sap.com/docs/SAP_S4HANA_CLOUD/2bba750d1e124e1ea2a039bb1cd9b6c5/2d01e2ba9e0e4058bd46cda3c2086bcb.html?locale=en-US)) | Classic/queued completion owners already exist | Integration and failure behavior unproven | Keep SUDU's shorter cycle, native stock/cost/serial rules and recovery; do not add a new issue/receipt owner |
| Order context includes status/components/movements and authorized related navigation ([SAP Help: Order display](https://help.sap.com/docs/SAP_S4HANA_CLOUD/2bba750d1e124e1ea2a039bb1cd9b6c5/62c06d57284f346ae10000000a4450e5.html)) | SO card, draft quantities and workflow helpers | Draft versus posted labels and access proof incomplete | Clearly separate proposals, actual movements and delivery; enforce native record permissions |

Roles remain native: planner reviews source/recipe/target; authorized operator reviews picks/completes; sales handles delivery; inventory/accounting owners handle movements and cost. Reserve/release alone posts no new consumption accounting. Native permitted reversal uses posted actuals. Sales delivery and production completion remain separate reporting facts.

Unresolved SAP questions: no source establishes SAP uses SUDU's `max(delivered,produced)` shortcut; exact ATP, hard allocation and make-to-order stock depend on configuration. SAP reservation creation alone is not proof every SUDU stock consumer enforces a hold. Do not claim SAP equivalence or add settlement/WIP requirements.

## 5. Remaining work checklist

| ID | Work | Status |
|---|---|---|
| FIX-01 | Accurate or explicitly unavailable suggestion, coverage/excess and consistent quantities across IA/SO | Open correction |
| FIX-02 | Preserve prepared Standard recipe/plan/reference keys on unlink | Open correction |
| FIX-03 | Server-side authorized tenant/organization/record/action access | Specific mismatch response guarded; authority verification/correction remains |
| FIX-04 | Retain Flat selections; visible occurrence/recipe rules and saved-basis protection | Keep existing direction; remaining guards/clarity and verification |
| FIX-05 | Minimum durable source/plan/output/recipe/material change evidence | Partial; complete required evidence |
| FIX-06 | Protect retained completed-source repair | Permission/stale-state/history checks outstanding; no broader editing right |
| RES-01 | First-save available-stock reservation and full reconcile/consume/release lifecycle | New authorized requirement; native/LOWCODE gates unresolved |
| UI-01 | Production/SO/material layout with correct labels and reservation facts | Structured SO rows already present; complete remaining improvements |

## 6. FIX-01 — Remaining-production figures

### Observed defect

DEV uses `max(0, ordered − max(delivered, produced) − open)`. This assumes overlap without proving which receipts fulfilled which delivery.

Example: SO100, delivered40 from unrelated stock, completed linked production30 still unused, other open IAs0. Remaining production is30. DEV suggests60. The developer handoff's claim that unrelated deliveries cannot cause over-suggestion must be corrected.

### Required behavior

1. Keep native sales ordered/delivered quantities, linked completed actual production, and other open IA quantities as separate facts. Convert them to a verified common UOM.
2. Produce an exact remaining suggestion only when native identities and usage support it. Deduplicate deliveries of linked production and account for linked output used elsewhere. Do not infer exclusive customer allocation from the SO link.
3. **If exact provenance is unavailable in current data, display `Remaining to plan: Unavailable` and explain why.** Keep the facts visible and let the planner enter quantity manually. Disable Use Suggested Qty for an unavailable result; a failed/unknown read must not become0.
4. Do not substitute unconditional `delivered + produced`, since deliveries from linked production would then be counted twice. Do not present the existing `max` result as an accurate quantity or quietly relabel it as an approved estimate.
5. Make candidate selection, IA summary and SO summary use the same projection. Coverage/excess statements based on uncertain overlap must also be unavailable or explicitly qualified; independently provable comparisons may still be shown with their exact meaning.
6. A genuine suggested0 remains0. Do not set1 or overwrite entered quantities merely to allow creation. Warnings remain warnings; native stock/pick validation still applies to completion.
7. Exclude the currently edited Draft only from the other-open-IA total, then include its pending quantity once in any supported comparison. Unsaved IAs are proposals, not persisted supply. Completed output uses actual received quantity, not original planned quantity.

**LOWCODE/data limit:** a Code/SQL node cannot reconstruct receipt-to-delivery identity that was never recorded. Developer must highlight that limitation and use the manual fallback above. Do not add backend changes, FG/customer allocation or a receipt-tracing subsystem to solve this projection. The separately authorized IA raw-material hold is defined in RES-01 and does not provide FG delivery provenance.

### Plan versus open quantity

The current enhancement counts an open IA's `item_qty` as proposed output, while showing `planned_output_qty` separately. Preserve that DEV behavior in this corrective patch and label it explicitly; do not silently switch between the two. Example: plan10/output-to-receive6 means the open quantity displayed under this implementation is6; after successful completion, actual received is6. Whether an unfinished Draft should instead cover the full plan is an unresolved business-rule choice, not something the developer should change incidentally. For Processing, use the actual queued production request and its status, not later unsaved form values.

## 7. FIX-02 — Unlink preserves the prepared IA

Current Standard unlink clears `bom_snapshot_json`, `source_bom_id`, `planned_output_qty` and component `sc_ref_key`. This moves the IA back to legacy quantity handling.

Required change for an eligible Draft:

- Clear the SO header/line association and retain its unlink history.
- Preserve valid mode, saved BOM identity/calculation basis, target plan, reference keys, entered actual materials and native stock selections.
- After unlink, reopen and quantity review must continue from the saved basis. Changing the master BOM must not silently change this IA.
- Recipe refresh remains a distinct explicit action with material/pick review. Unlink itself has no stock, costing, delivery or accounting effect.
- Preserve the existing path for truly legacy IAs that never had an enhanced snapshot. A defaulted Standard value alone must not enroll them in enhanced processing.

Apply the same persistence and compatibility reasoning to classic save and background submission. Do not broaden editing rights of completed IAs as part of this fix.

SO unlink alone also preserves existing IA-owned raw holds while its production demand remains. Reconcile holds only if the saved material intent itself changes.

## 8. FIX-03 / FIX-06 — Permissions and protected source repair

### Source summary and navigation

The latest DEV summary now refuses a header/request organization mismatch before returning source content. Retain that correction. Remaining work is to prove or implement authorization for the session user and requested records; caller-supplied organization digits and record-to-request equality are insufficient.

- Derive tenant from the session. Validate the user's authorized organization and record access server-side; a numeric caller-supplied organization is not proof of authority.
- Scope SO header/line/customer and IA reads before returning their content. Validate the exact header-line relationship. Return a scoped refusal for unauthorized/mismatched identities.
- Respect native SO and IA read/create/edit rights for summary, create/link and direct workflow invocation. Keep the separate menu capabilities where useful; button visibility is not the server check.
- If the platform already enforces the required rights outside the workflow, document the precise enforcement point and prove it with restricted-account results. Do not add redundant or contradictory permission policy blindly.
- Do not introduce a new completion veto solely because a valid existing trace-only source was subsequently reduced, cancelled or removed. Preserve the accepted warning/manual response and native action restrictions.

### Completed IA source repair already added in DEV

Do not expand this convenience into an automatic source migration. Where the existing repair is retained:

- Require explicit authorized action; only the defined same SO/item/organization repair after the original line is removed is eligible.
- Reject Processing records and respect native protected states.
- Recheck state at the mutation boundary and guard against another user/job changing the IA's link or status after the initial read. A stale request must fail safely rather than overwrite the new state.
- Retain original source baseline and old/new durable line IDs, actor/time and reason through history. Do not match a replacement line by item or visual row position alone.
- Change only authorized trace fields. Do not resize SO/IA, rewrite actual output/materials, post/revert stock, recalculate cost or alter delivery documents.

If safe completed repair cannot be provided through available LOWCODE controls, highlight it to the user and keep the IA visibly awaiting manual review. Do not bypass native locking to make the repair work. The exception policy for completed repair remains an explicit scope decision; this brief does not grant unrestricted completed-record editing.

## 9. FIX-04 — Keep user-selected Flat expansion

This is a practical transaction-level way to select which subassemblies are made within this IA. It avoids requiring customers to enrich every BOM reference before using Flat. Keep Standard's direct-material behavior and the shared BOM master unchanged.

### Rules to keep and clarify

1. In Flat, the user chooses expandable subassembly items on this IA. Unticked subassemblies remain material inputs. Do not expand every item merely because it has a BOM.
2. Retain current item-wide selection semantics for this cycle: **a tick applies to every occurrence of that item in this IA's expansion**. State this clearly in the dialog. Show its occurrence count/used-under paths sufficiently to make the choice understandable. Path-by-path selection is backlog.
3. Display the child BOM/version actually used. The current resolver prioritizes a valid explicit reference where present; otherwise it uses its eligible default/highest-version rule. Do not change shared BOM defaults. If occurrences resolve to different explicit recipes, show the distinction; do not imply one displayed recipe applies to all paths.
4. Persist expansion selections, exact chosen root/child identities, versions and reproducible quantities/UOM/allowance/conversion/rounding basis. Reopen and output changes use the saved basis, not current masters.
5. Explicit Prepare/Refresh BOM may use current eligible masters, but show the material difference and require affected native selection review before replacement. Failed preparation cannot authorize posting old lines under a mismatched FG/mode/header.
6. Preserve current guards for missing/empty/ineligible BOM, invalid base quantity, missing conversion, cycle, depth/size limits, reference-only rows and serial rounding. Confirm current configured boundaries rather than enlarging them opportunistically.
7. Do not consume both an expanded parent and its children on the same path. Do not generate intermediate receipts or child IAs. The output remains this IA's FG.
8. Aggregate leaves only where item/UOM and applicable stock-selection constraints are compatible. Preserve source-path evidence; if relevant constraints differ, keep separate rows. Developer must identify which native constraints actually apply rather than introducing arbitrary new grouping rules.
9. Keep legitimate reviewed component variance under existing IA rules. A stale or failed Flat preparation is not a valid manual-variance exception.

Example: FG needs Cap2 and Body1; selected Cap BOM needs Resin3 per cap. With Cap ticked, reserve/consume Resin6 + Body1 and receive only the FG. With Cap unticked, reserve/consume Cap2 + Body1. Cap is held as an input only when left unexpanded. There is no intermediate cap receipt, child IA or JO in this small cycle. Consumption still occurs only through successful native completion.

## 10. FIX-05 — Minimum durable change evidence

Keep actor/time and meaningful before/after changes for source assignment/unlink/repair, planned output, posting output, mode, prepared root/child BOM identities and reviewed materials, plus native completion/reversal references.

- First identify whether existing platform audit facilities already supply this evidence and preserve them.
- The current last20 LINK/RELINK/UNLINK array and latest snapshot timestamp do not alone satisfy the full change history requirement. Do not silently discard earlier evidence when truncating a UI payload.
- If native audit is insufficient, propose a small additive LOWCODE audit record using approved persistence. Its physical fields, transaction boundary and permissions are developer-confirm items; this brief does not invent verified existing columns or a new backend endpoint.
- Record actual changes, not read-only summary visits. Keep persisted history server-owned. No new approval or mandatory multi-step reporting process is required.

A richer history screen and comparison viewer can be backlog; basic trace evidence is part of this patch.

Reservation acquire/change/consume/release and recovery also need native effect references and actor/time. Preserve prior evidence when fragments are replaced or closed; reservation history must not become a second physical stock ledger.

## 11. RES-01 — Raw-material reservation lifecycle

**Confirmed user choice: reserve what is available on the first durable successful IA save and show shortage; do not refuse a Draft save solely for insufficient material.**

### Scope and ownership

- Apply to new IAs after activation: standalone or SO-linked, Standard or Flat. SO remains a trace source; raw materials are reserved **for the IA**, not as a sales FG reservation.
- Standard reserves its executable direct stock components. Flat reserves the resolved terminal inputs, including unticked SFG inputs. Never reserve both an expanded intermediate and its leaf materials for the same requirement.
- Exclude non-stock/reference-only materials under existing item/BOM semantics. Retain native UOM, stock category, plant, organization, project, batch, serial, HU and location eligibility.
- One hold owner is the durable IA ID plus stable component/fragment identity. Document number, row position and source SO line alone are insufficient. Preserve fragment identity across permitted edits; aggregate stock availability without erasing component ownership.
- Reopening a historical IA must not silently backfill reservations. Define an explicit legacy-Draft enrollment/migration policy before activation; no automatic holds on completed historical IAs or copied holds on clones.

### Required quantity versus picked quantity

Keep required material, currently selected stock, actually held stock, shortage and consumed actual quantity distinct.

- Default the reservation requirement from the current saved executable material requirements for the current IA production quantity, including authorized manually added/changed/removed material intent.
- Partial auto-allocation must not lower the requirement. If requirement10 can select only6, display required10/reserved6/shortage4, not required6/shortage0.
- Reviewed manual usage can differ from BOM reference. Developer must map how an explicit manual requirement override is distinguished from an automatically short pick; existing `requested_qty` and `total_quantity` must not be redefined by assumption. Additive intent metadata is a developer-confirm design detail if needed.
- Do not rebuild from the latest master BOM to decide reservation changes for an existing prepared IA. Use the saved executable basis/material intent. An edit to the comparison plan alone must not silently reserve a different recipe or overwrite actual output.

### First save and shortage

1. Validate and save through the native IA owner, with stable component identities.
2. Within a guarded durable save/reservation operation, claim eligible free stock for those material requirements. Use existing allocation priorities and valid selections; do not claim another document's held stock.
3. Reserve what is genuinely available. Keep any remainder as **unreserved shortage**; do not create a physical hold against nonexistent stock or negative balances.
4. Show the IA as saved with reservation results: Fully reserved, Partially reserved or Not reserved due to shortage. These are material-coverage labels, not new native IA status values.
5. A database/service failure is not an ordinary stock shortage. If the hold outcome is uncertain, show Needs review and prevent duplicate/inconsistent reservation changes or unsafe completion until reconciled. Do not report full reservation success merely because IA persistence succeeded.

Unsaved open/link/Prepare BOM operations remain previews. They do not acquire holds. A permitted direct Complete without a prior Draft must continue through the existing owner; it must not leave an extra Draft reservation after successful consumption.

### Changes and lifecycle

| Event | Required behavior |
|---|---|
| Repeated save / retry | Reconcile desired versus existing own holds; no additional reservation for the same unchanged quantity |
| Increase saved production/material need | Keep valid own holds; claim only additional available stock; display remaining shortage |
| Decrease/remove materials | Release only the corresponding unused own hold after the authorized edit saves successfully |
| Plant/bin/item/UOM/tracking or BOM-mode change | Revalidate scope and identities; reconcile old/new own fragments under a guarded operation; no stranded or double-held stock after failure |
| SO unlink/source reduction/cancellation | Do not automatically release raw materials while IA production demand remains. SO tracing changes alone are not IA cancellation |
| New receipt arrives | Do not silently promise automatic replenishment allocation. For this small cycle, planner saves/rechecks the IA to claim additional available stock; automatic background top-up is backlog |
| Successful normal/short completion | Native owner consumes reviewed actual materials, closes matched own reservation quantity and releases unused remainder; FG receipt uses actual output. SO shortage remains open for manual planning |
| Actual consumption exceeds hold | Claim only additional eligible available stock under existing validations; do not use another owner's hold or require equality to BOM reference |
| Queued Processing | Keep material protection through the actual commit; queued submission success is not stock consumption or a reason to free holds |
| Failed or uncertain completion | Retain/reconcile protection according to durable effect state. Never blindly release holds or repeat issue/receipt; explicit authorized Needs review reconciliation where necessary |
| Permitted IA cancel/delete/stop remaining | Release unused IA-owned holds only after the corresponding native action succeeds; preserve actual movements/costs/history. Confirm which native actions exist; do not invent a cancellation status |
| Clone | No inherited live holds/owner fragments. New clone can reserve on its own successful save |
| Native revert | Preserve native downstream-use checks and reverse exact posted actuals/costs. If the result is an open IA, reconcile its permitted current material demand once; do not reinstate the original full plan or double-restore stock by assumption |

Releasing a hold on stock that was never issued is an availability release, not a physical warehouse return. Physical returns for issued/staged materials remain governed by native movements.

### Illustrative stock effect

Assume one eligible material pool: physical on-hand100, all initially free; IA requires80.

| Step | Physical on-hand | Held for this IA | Free for other demand |
|---|---:|---:|---:|
| Before save | 100 | 0 | 100 |
| IA saved,80 reserved | 100 | 80 | 20 |
| IA completes consuming70; unused10 released | 30 | 0 | 30 |

Another example: requirement80, only50 free → save IA with reserved50/shortage30. It may still complete a valid shorter actual output after reviewing real actual usage and native stock checks. This does not bypass availability merely because shortage is nonblocking at save.

The table is conceptual. Native balance fields may represent already-net buckets and HU aggregates; do not derive a second subtraction mechanically from it.

## 12. Reservation reuse, affected callers and LOWCODE gates

### Verified versus unverified native support

- Inspected IA allocation code reads `on_reserved_gd` and material/batch/HU balances. It already attempts to exclude other allocated holds; selected rows are still form state, not proof of an IA-owned durable reservation.
- Dated local reservation schema includes `doc_type`, `doc_id`, `doc_line_id`, `material_id`, `plant_id`, `organization_id`, `bin_location`, `item_uom`, `batch_id`, `handling_unit_id`, `reserved_qty`, `delivered_qty`, `open_qty` and `status`. This is schema evidence, not a verified current IA API/enum/payload. Do not execute the schema reference file.
- Existing source comments indicate some allocated loose reservations already move quantity out of `unrestricted_qty` into `reserved_qty`. Do not subtract open reservations again from an already-net free balance. Confirm the actual writer/bucket/UOM contract and HU treatment.
- The schema comment mentions Production, but that does not prove that an Item Assembly discriminator is accepted or equivalent to WO/old MES Production. Developer must map the actual owner type, native IDs, precision, statuses and transitions before reuse.

### Required affected-caller checks

| Touchpoint | Concrete authorized impact | Protection |
|---|---|---|
| IA form / Save Draft | Durable reservation result replaces temporary stock selection as the coverage fact | Preserve required-versus-picked distinction and save error handling |
| Classic IA_SAVE / native validation/subtraction | Current IA may consume its own held stock | Add back/claim only matching own fragments once; no access to all Reserved stock |
| IA_V2_SUBMIT, worker, prepare/publish | Protection must survive queued completion and retries | Stable request/owner/version; durable effect readback; no early release |
| Native reservation writer and balance layers | Save/edit/close IA holds | Reuse one authoritative bucket/ledger owner; no parallel IA stock ledger or UI-only bucket writes |
| GD/SI, other IA, stock transfers and other shared consumers | IA-held material becomes unavailable to other ordinary consumers | Verify selectors and server writers enforce ownership; retain legitimate native transfers/corrections under existing permissions |
| Cancel/delete/revert and clone | Hold lifecycle follows successful authorized native actions | No orphan, copied, double-released or fabricated restored holds |
| Item/batch/serial/HU balances and reports | Show reconciled free/held/physical amounts and source ownership | No duplicate subtraction across ledger/balance/HU aggregate views; no changed valuation |

Shared stock protection necessarily affects availability for other demand; that is the user-requested impact. It does not authorize unrelated changes to existing stock eligibility, allocation priorities, category conversion, cost valuation, sales counters, BOM masters or permission policies.

### Developer-confirm contract gates

Before enabling this feature, supply:

1. Current native reservation workflow/model IDs, IA owner discriminator, source/component mappings and exact supported payloads; no new endpoint names or physical columns are asserted here.
2. Exact UOM/precision, free-versus-reserved bucket semantics, batch/serial/HU eligibility, current own-hold visibility and all shared consumer enforcement.
3. Durable concurrency protocol: two IAs competing for the same free stock cannot over-reserve. Read-then-write availability without an enforced guarded update is insufficient.
4. Save/hold/issue/release failure and idempotency mapping, including queued uncertain outcomes. If full atomicity is unavailable, show how partial state remains protected, distinguishable and safely recoverable; never expose stock as free during an uncertain handoff.
5. Legacy-Draft activation policy, direct Complete path, native cancel/delete/revert behavior and permission-controlled reconciliation.

No backend changes are authorized. If LOWCODE cannot safely host these controls using existing facilities, highlight that before activating reservation. “Needs review” must be a real durable recovery state, not a way to ignore unprotected stock.

## 13. UI-01 — Consolidated layout and interaction

### Screen structure

```text
ITEM ASSEMBLY                            Draft      [native document actions]
IA number / date

PRODUCTION                               SALES ORDER — optional
FG code + name                           SO number · exact line · customer
Planned output   Output to receive       Ordered / Delivered / Undelivered
10 PCS           10 PCS                  Posted production / Other open IAs
[Use suggestion]                         Remaining to plan: value / Unavailable
Standard / Flat · saved BOM version      [Change SO line] [Unlink] [Refresh]
[Prepare / Refresh BOM]                  Visible source/quantity warnings

OUTPUT LOCATION
Plant                 Storage location                 Bin / Category

MATERIALS
Coverage: Required / Reserved for this IA / Shortage / Pending edit
Component | Reference qty | Actual consumption | UOM | Native stock selection
Saved-recipe details / variance / shortage notices

Additional details ▸ Project / remarks / attachments / other native fields
```

### Required UI changes

- Retain the new structured read-only SO rows; finish contrast, hierarchy and contextual action placement. Do not revert to the old disabled multiline textarea or claim exclusive customer stock allocation.
- Group plan and posting quantity together. Label existing `item_qty` **Output to receive** before posting and **Actual received** after successful completion. Label `planned_output_qty` **Planned output**. A Draft10 is not already produced10.
- Keep UOM beside each quantity, including SO-versus-IA conversion. Show the reason for unavailable calculations. Do not hide warnings in a scrolling grey textbox.
- Place Use Suggested beside the plan/output group. It is an explicit eligible-Draft action; show that it updates both plan and proposed output, then invoke material/pick review. Disable only this action when suggestion is unavailable.
- Place Change/Unlink/Refresh in the SO card. Place Prepare/Refresh BOM by mode/materials. Do not present all six actions as equally prominent buttons below unrelated fields.
- Show the saved BOM version/preparation state and Flat expansion count/summary. Call an action Refresh BOM only when it really proposes a recipe refresh; Refresh SO figures must not refresh the BOM.
- Keep required plant, output storage, bin and category clear and accessible. Put secondary project/remarks/attachments under Additional details where the framework permits; preserve their validations and rights.
- Bring the materials table higher by reducing redundant text/empty spacing. Make reference versus actual consumption readable together. Retain the current stock-picker, HU and serial interactions.
- Preserve native save, Complete, Complete & Post, status and queued-processing behavior. A UI redesign must not introduce another posting owner, custom approval, JO or mandatory wizard.
- Preserve widget/field IDs and event bindings where possible. If moving a control changes event/load order, inventory all affected callbacks and regression-check them. Do not duplicate hidden/editable values that can diverge.

Use current LOWCODE layout/display capabilities. No backend or front-end framework migration is included.

### Reservation display beside materials

Add a concise **Raw material reservation** summary next to the materials table:

- Coverage label: Fully reserved / Partially reserved / Shortage / Needs review, with a last successful reconciliation time if available. Use per-line quantities/UOM; do not sum unrelated material units into one misleading quantity total.
- Per line: Required, Reserved for this IA, Unreserved shortage, UOM and existing stock selection details. Show other-document holds separately only where native rights permit.
- Say “Reservations update when this IA is saved.” Unsaved edits must be visibly pending and must not overwrite the displayed committed reservation fact.
- A shortage does not block Draft save; a reservation failure is shown distinctly. Do not put a mandatory approval, JO, Release or WMS picking step into this cycle.
- Keep current IA document statuses, receipt quantities and native Complete actions. Do not label reserved materials as already consumed or physically moved.

## 14. Verified fields and developer-confirm interfaces

Verified new IA header properties: `source_so_id`, `source_so_line_id`, `source_so_context_json`, `bom_consumption_mode`, `source_bom_id`, `bom_snapshot_json`, `planned_output_qty`. Component mapping uses `sc_ref_key`. Native current posting quantity remains `item_qty`; native materials remain `stock_movement` with their existing stock-picker payloads. Preserve field types/meanings and native validation.

The earlier contract captures classic save input `{ allData, saveAs, pageStatus }` and native source/workflow anchors. This is not a new API endpoint contract. Developer must verify all actual current binding names, field whitelists and queue-specific payloads before editing. Do not assume the classic payload is valid for V2 submit, reservation or every reversal route.

**Not verified existing contracts:** reservation owner discriminator, current writer/model IDs, new audit fields, material requirement-override intent fields, transaction guards, and any new result/error shapes. Record these exact mappings in the implementation handoff. Logical requirements above do not assert new physical columns or allocated workflow IDs.

Affected IA callbacks include `sc_main`, quantity change, unlink, prepare/refresh, load/reopen, plant/item/mode change, clone, Draft save and both variance/complete callers. Match the classic and queued owners, preserve serial/batch/HU picker seeds, and assess native cancel/delete/revert and mobile callers. Update SO candidate/summary/create navigation to the same scoped projection. Do not change shared helper semantics without identifying every caller.

**Mobile integrity:** enhancement UI is desktop-only in this delivery. The developer handoff promises mobile read-only item/plant/quantity in a future release. Until available, server validation/preservation must prevent older mobile payloads corrupting saved recipe/reference keys, material requirements or own holds. No stale app may erase or duplicate holds merely by omitting new fields. Broader mobile feature UI is backlog.

**New-entry source fallback:** retain a visible explanation if an SO line becomes ineligible between navigation and form opening. If the native entry continues as an ordinary IA for that item, show that no SO is linked; do not imply the source is still attached or create a saved IA/hold merely by opening the form. New linking must satisfy source eligibility; an existing link later reduced/cancelled follows the warning/manual rule above.

## 15. Developer-owned acceptance and regression criteria

These are **required checks to be run by the developer**, not tests executed or passed by this document. Use isolated permitted data and record actual DEV versions, result evidence and remaining limitations. Include applicable original SC01–SC26 cases. A declaration that native owners are unchanged is not regression proof.

| ID | Scenario | Acceptance |
|---|---|---|
| U01 | Standalone/legacy and both source entry points | No SO required; exact source identity; one line/many IAs; existing native actions and no-snapshot behavior preserved |
| U02 | Source cancellation/reduction/removal | Visible stable-baseline warning; native manual response; no automatic IA resize/unlink/material refresh or new trace-only completion veto |
| U03 | Linked-stock, unrelated-stock, mixed and other-SO delivery | Supported correct suggestion or explicit unavailability; no false precise coverage/excess, unconditional summation or silent zero-on-error |
| U04 | Edited Draft and plan10/output6 | Current IA counts once; comparison plan preserved; labels distinguish draft proposal and actual receipt; short completion receives6 and retains manual SO shortage |
| U05 | Standard unlink followed by master change/reopen/quantity edit | Plan/snapshot/reference keys/material usage preserved; saved basis still governs; holds remain owned by IA while its demand remains |
| U06 | Flat selected/unticked, repeated item and differing explicit child versions | Visible item-wide policy; correct actual recipes and immutable basis; no both-parent-and-leaf reservation/consumption on one requirement |
| U07 | Flat UOM/allowance/serial/REF/depth/size/cycle/invalid lookup | Native-compatible references or clear safe failure; no stale-header posting; serial-capacity split guidance matches actual supported owner limits |
| U08 | Manual material variance and explicit recipe refresh | Permitted additions/removals/usage retained; required versus partially selected quantity distinguished; recipe replacement reviews affected picks/holds |
| U09 | First save, standalone/SO-linked and Standard/Flat | Only eligible executable stock inputs are held; no effect on unsaved preview, non-stock/REF rows or expanded intermediate headers |
| U10 | Required80/free50; later additional stock and save/recheck | First save reserves50/shortage30 without refusing for shortage; later reconciliation fills only available remaining requirement once |
| U11 | Repeated save/double-click/stale edit/concurrent competing IAs | No duplicate hold or overbooking; old state not overwritten by stale requests; only eligible free stock claimed |
| U12 | Increase/decrease/remove materials or change plant/bin/UOM/mode/tracking | Own valid holds retained/reconciled; no cross-owner release, stranded fragments or double reservation on failure |
| U13 | Complete consuming70 from80 held | Native issue70, native actual FG receipt once, unused10 released after successful action; reserve/release itself changes no physical quantity or consumption cost |
| U14 | Actual usage above held qty; direct Complete; Complete & Post | Additional eligible stock checked safely; another document's holds unavailable; no extra Draft hold or duplicate stock/accounting effect |
| U15 | Queued Processing, timeout, failure and uncertain commit | Hold protection survives until known commit; no release-on-submit, blind retry or duplicate issue/receipt; durable Needs review recovery where needed |
| U16 | Permitted cancel/delete/stop, clone and revert | Unused own holds released only after success; clone has no copied hold; reversal restores exact native actuals/costs with current downstream checks; no fabricated full-plan reinstatement |
| U17 | Restricted role/org/tenant; direct helper invocation; source repair race | Unauthorized reads/writes refused; mismatch guard retained; stale protected repair rejected without changing stock/cost/delivery |
| U18 | Batch/serial/HU and shared GD/SI/IA/transfer writers | Native tracking identity and eligibility retained; own-held consumption works; other owners cannot consume IA hold; no double netting of reserved buckets/HU aggregates |
| U19 | Audit and reporting | Durable actor/time/before-after/native effect evidence; UI refresh creates no change event; free/held/physical totals reconcile without altered valuation |
| U20 | Desktop layout, long names, mixed UOM, error/zero/unavailable/standalone | Readable SO facts, adjacent plan/output, contextual actions, visible warnings, required output location and usable material/reservation review |
| U21 | Historical/mobile/shared BOM/SO→WO/accounting compatibility | No silent backfill or destructive omitted-field save; other BOM consumers/defaults remain unchanged; no incidental WO retirement or sales/accounting rewrite |

Confirm ordinary IA completion still obeys native stock checks even when its saved reservation is partial. Nonblocking Draft shortage is not permission to post unavailable materials.

## 16. Implementation handoff order and completion evidence

1. Inspect current deployed definitions and record actual fields/callers. Resolve reservation owner, requirement-versus-selection, legacy enrollment and concurrency/recovery gates before activation.
2. Correct the shared quantity projection and Standard unlink path; retain the current mismatch guard and prove authority checks. Keep current Flat selection direction and finish its necessary clarity/guard work.
3. Integrate the new IA-owned reservation lifecycle through native save/completion/cancel/revert owners, including direct Complete and queued requests. Do not add a second UI posting path.
4. Complete minimum change evidence and the consolidated UI using current LOWCODE components/bindings.
5. Developer executes relevant U01–U21/original SC cases and native regressions; resolve introduced failures. This document's creation involves no product testing or fixes.
6. Supply changed object/version list, exact reservation/audit/result mappings, before/after compatibility impacts, test evidence and explicit limitations. Do not claim no impact, completed testing or deployment approval from this study.

## 17. Backlog — not required for this small-cycle patch

- Per-occurrence/path expansion switches and advanced tree visualization.
- Rich audit timeline/comparison viewer beyond required durable evidence.
- Automatic background shortage top-up, reservation priority rebalancing/stealing and richer analytics.
- Wider mobile enhancement screens and additional candidate-list pagination/usability work.
- Additional automatic source repair beyond the existing guarded manual case.
- Larger-cycle JO, machines/calendars/scheduling, WIP continuation, QC, rework, automatic replacements and WMS picking/putaway integration.

Correct figures or explicit uncertainty, saved-basis preservation, server authority, durable reservation protection, one-time stock/cost effects and minimum history are **core**, not backlog. Do not turn ordinary production into additional procedures to accommodate this patch.

## 18. Evidence/history references

The content above is the working patch handoff; these links are supporting history only:

- [Original Small Cycle IA implementation Contract](Small%20Cycle%20IA%20implementation%20Contract.md).
- [Original implementation review](2026-10-20-small-cycle-implementation-review.md).
- [Earlier fix brief](Small%20Cycle%20IA%20Developer%20Fix%20Brief.md) and [reservation addendum / updated handoff review](Small%20Cycle%20IA%20Reservation%20Addendum.md).
- [Earlier DEV capture manifest](../../outputs/small-cycle-review-20261020/manifest.json) and [updated DEV capture manifest](../../outputs/small-cycle-review-20261020/update-1750/manifest.json).
- Supplied developer files: `/Users/potlink1999/Downloads/SMALL_CYCLE_IMPLEMENTATION.md` and `/Users/potlink1999/Downloads/SMALL_CYCLE_IMPLEMENTATION (1).md`.

No guarantee that existing IA/BOM is regression-free is made from source review or documentation alone. Preserve the specified native owners/semantics, implement the scoped authorized changes, and demonstrate the affected flows before declaring the work complete.
