# Generate Location Transfer Requests from Draft Item Assemblies

- Enhancement: **ENH-20261027-001**.
- Requested: **27 October 2026**; customer context: Mosca; reusable WM capability.
- Status: **Developer requirements prepared. Requested status selected by user. Not implemented or deployed.**
- Scope: **WM Item Assembly and WM Location Transfer only. No MES dependency or write.**
- Required outcome: production generates a material request from an existing Draft Item Assembly; warehouse selects stock and dispatches it to a production location; production receives it before the assembly consumes it.

## 1. Decisions and scope

**Confirmed by the user:** use Item Assembly for production, retain materials as stock in a separate production location, generate the transfer from a Draft assembly, use a new **Requested** transfer status, **require full fulfilment per transfer for the first release**, exclude MES, and preserve existing transfer logic.

**Requirement:** use the existing Location Transfer header and lines with an explicit new purpose **Item Assembly Supply**. Requested is a real `stock_movement_status` value, not a label for Draft or a second submission-status field. Requested makes **no stock movement or reservation**. Existing Draft/In Progress/Completed/Cancelled meanings and all ordinary transfer defaults remain unchanged.

The first-release fulfilment policy is recorded in section 10. Automatic netting against shared production stock, MRP, procurement, production scheduling, automatic assembly completion and dedicated WM Picking-task generation are outside this handoff. The warehouse can physically pick using the transfer document. An additional WM Picking-task integration needs its own assessment.

## 2. SAP reference and deliberate adaptation

SAP S/4HANA PP separates production component requirements, warehouse staging and goods issue for manufacturing consumption. Staging can replenish a production storage location before consumption. Relevant master data include component/UOM, plant, issue storage location and the selected production process. SAP Learning does not identify a numbered release for this lesson. [SAP Learning: Posting Goods Issues for Production Orders](https://learning.sap.com/courses/manage-production-orders-in-sap-s-4hana-manufacturing/posting-goods-issues-for-production-orders).

SAP S/4HANA **on-premise 2025 FPS02**, **MM Inventory Management**, documents same-plant storage-location transfer with a reservation: source/destination quantities change, plant total remains unchanged, and no accounting document is generated. This is not a cross-plant/company rule. [SAP Help: One-Step Procedure With a Reservation: Storage Location](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/91b21005dded4984bcccf4a69ae1300c/aa64bd534f22b44ce10000000a174cb4.html).

Roles for this SUDU requirement are production requester, warehouse dispatcher, production receiver and authorised assembly operator. The SAP comparison supports separating these business events; it does not establish these SUDU permission names or require an SAP production order. Existing SUDU IA replaces that demand-source role. Requested is a SUDU extension, not a claim about a standard SAP status. EWM PMRs/control cycles/warehouse tasks and classic WM transfer orders are not adopted.

### SAP / SUDU / Gap / Proposed Requirement

| SAP baseline | SUDU evidence | Gap | Requirement |
|---|---|---|---|
| Component demand guides staging. | Captured deployed IA code stores selected component requirements and BOM snapshot/context. | No IA-to-LOT generation/source relation was found. | Generate from saved IA demand and retain header/line references. |
| Requirement precedes physical staging. | LOT Draft bypasses stock movement; In Progress already moves stock into destination In Transit. | No stock-neutral Requested route exists in the inspected definition. | Add Requested only for Item Assembly Supply; distinguish it from dispatch. |
| Transfer and manufacturing consumption are separate. | LOT relocates stock; IA separately selects/consumes components and receives output. | IA can retain suggested warehouse picks after stock moves. | Reselect usable production balances before IA reservation/completion. |
| Inventory corrections retain document trace. | Existing In Progress cancellation reverses/reconciles real transit movements. | A never-dispatched request needs no stock reversal. | Requested cancellation changes request state/audit only; dispatched cancellation retains existing stock rules. |
| Same-plant transfer conserves total inventory; consumption changes it. | Local code probes confirm source/destination/category movement plans. | Complete runtime costing/accounting regression remains unverified. | Verify quantity/value/costing outputs against the unchanged transfer baseline. |

SAP exact role catalogs, customer reservation blocking/ATP settings and quantity tolerances were not established and must not be invented. [Supporting SAP study](</Users/potlink1999/Documents/ChatGPT/Mosca Project/outputs/mosca-production-material-request-20261027/sap-reference.md>) contains configuration boundaries, consumption/accounting, return/reversal sources and reporting considerations.

## 3. Current SUDU code baseline

**Evidence class:** current shared production definitions read on 27 October 2026 through SELECT/SHOW VIEW-only access, plus local execution of extracted nodes/conditions. No live Mosca save, transfer, reservation, receipt or accounting UAT was executed. All 13 captured definition hashes matched a final production read; 11 local probes passed. These results establish code behaviour at the inspected points, not end-to-end runtime acceptance.

| Object | ID | Captured version / update |
|---|---|---|
| Item Assembly form / component table | `2098256587713404929` / `2098269596661833730` | 27 Oct 21:35:23 / 21:35:26 |
| Item Assembly page | `2098312073316716546` | v18 |
| IA_SAVE / IA_HOLD | `2098335576774463489` / `2112752274794217473` | v12 / v13 |
| Location Transfer form / component table | `2013791389687349250` / `2013831779991814146` | 22 Oct 16:30:47 |
| Location Transfer page | `2013863255693197313` | v49 |
| SM_LOCATION_TRANSFER | `2013133675374927874` | v85 |
| LOT_V2_SUBMIT / PREPARE | `2110992282596540417` / `2110992359150977026` | v5 / v7 |
| LOT_V2_COMMIT / WORKER | `2110992400045441026` / `2110992316335521793` | v8 / v6 |

Important existing behaviour:

- IA `sc_main` builds `requested_qty`, UOM and component reference keys. It then calls stock auto-allocation, so even a Draft may show suggested warehouse picks. Those picks are not demand.
- `required_qty` and `required_manual` support an explicit requirement distinct from BOM reference/picked quantity. Ordinary Draft IA does not enrol in IA_HOLD; Created can reserve.
- LOT non-Draft branches run allocation/stock validation/movement. Simply adding Requested to a dictionary would be unsafe.
- `code_node_LOTmainCompute` recognises Draft→In Progress as STAGE, In Progress→Completed as COMPLETE, and Draft→Completed as DIRECT. Requested is absent.
- Eligible larger transfers use background workflows; status restore allowlists currently include Draft/In Progress. PREPARE contains lifted classic logic and explicit SQL field reads. Updating only the visible form or classic workflow is insufficient.

Exact node analysis and hashes: [code assessment](</Users/potlink1999/Documents/ChatGPT/Mosca Project/outputs/mosca-production-material-request-20261027/code-assessment.md>), [evidence manifest](</Users/potlink1999/Documents/ChatGPT/Mosca Project/outputs/mosca-production-material-request-20261027/code-evidence.json>), [local probes](</Users/potlink1999/Documents/ChatGPT/Mosca Project/outputs/mosca-production-material-request-20261027/code-probe-results.json>). Raw captures remain outside the repository at `/private/tmp/mosca-ia-lot-request-20261027`; re-export fresh definitions before implementation.

## 4. User flow and eligibility

**IA-LT-01 — Generate.** Add **Create Transfer Request** to Item Assembly. It is available only for a saved, authorised **Draft** IA with a positive planned output basis, valid component demand and no unresolved material holds/background completion. Unsaved edits must be saved successfully as Draft first; otherwise generation stops. Read the persisted IA/lines again on the server. Do not change a Created IA back to Draft or release its holds implicitly.

**IA-LT-02 — Request destination.** Before generation select active production **Storage Location** and **Bin Location** within the same plant, and a required date. Warehouse source storage may be explicitly selected/configured. The IA finished-output bin must not be assumed to be the component staging bin. Cross-plant supply uses a different existing document process and is outside this feature.

**IA-LT-03 — Create document.** Create one Location Transfer with purpose Item Assembly Supply and status Requested. Copy required component demand, leave stock allocations empty, retain source references and show the generated number/link. IA remains Draft; no IA_HOLD, IA completion, physical transfer or accounting post is triggered. Once a request exists, show **View Transfer Request**. Generation, refresh and cancellation must be idempotent and auditable.

**IA-LT-04 — Warehouse.** Add a Requested worklist/filter to WM Location Transfer with transfer number, source IA, requester, requested/required dates, plant and production destination. Opening a request shows **Requested Qty** and **Actual Selected Qty** separately. Warehouse selects the actual bins/batches/HUs/serials using supported existing selection rules. Saving picks while Requested remains stock-neutral and does not reserve stock. Stock is rechecked at dispatch; an unpicked request is not a guarantee of availability.

**IA-LT-05 — Dispatch and receive.** Dispatch changes Requested→In Progress, reusing the existing STAGE inventory outcome. Production receipt changes In Progress→Completed, reusing the existing COMPLETE outcome. The first version does not expose Requested→Completed; ordinary Draft→Completed remains available exactly as before.

**IA-LT-06 — Assemble.** After receipt into a usable production stock category, production selects the production-location balances in the same IA before Created/completion. Warehouse-source pick IDs are never copied into the IA as received stock. IA actual quantities, outputs, variances, reservation, costing, accounting and reversal continue through their existing owners. A scoped production-stock selection helper may be added; manual reselection is sufficient for the initial handoff if it enforces the linked destination. Do not permit this linked flow to consume still-in-transit stock.

## 5. Status and stock contract

| Operation | Allowed stored state | New state | Stock/reservation contract |
|---|---|---|---|
| Generate from Draft IA | No existing request | Requested | No quantity/category/value change; no hold, transit or movement record |
| Save warehouse selections | Requested | Requested | Store picks only; no allocation fallback that moves/reserves stock |
| Refresh from saved IA | Requested, not processing/dispatched | Requested | Explicitly replace demand snapshot, clear picks, retain audit/revision; no movement |
| Cancel request | Requested, no dispatch/intent | Cancelled | Audit/state only; no SUBTRACT/ADD/IA_HOLD call |
| Dispatch | Requested, valid current IA demand and warehouse picks | In Progress | Existing STAGE: source category OUT; destination In Transit IN; existing transit detail |
| Receive | In Progress | Completed | Existing COMPLETE: destination In Transit OUT; original category IN |
| Cancel dispatched transfer | In Progress | Cancelled | Existing eligible cancellation/reconciliation rules |
| Return unused received material | Completed transfer remains Completed | Separate supported return transfer | Move only actual unconsumed production stock; preserve original history |

Requested cannot be used on a normal/legacy transfer by changing its status field. The server must require the explicit purpose plus valid source IA relation. Do not expose Requested as the new default for ordinary Add New. Existing Draft transitions, In Progress edits, cancellation, deletion, terminal-state guards and unknown-state refusal retain their current contracts.

The existing background **Processing** lock is internal; it must retain the true previous state Requested for this purpose. A pre-stock failure restores Requested, not Draft. An uncertain/partially applied movement remains in the existing review/recovery path; never reset it to Requested and replay dispatch blindly.

Requested and Cancelled requests retain audit history and cannot be physically deleted through this new purpose. Existing normal Draft/Cancelled deletion rules remain unchanged. Submitted demand cannot be edited directly by warehouse; refresh it from IA. Do not use stock-moving cancellation for an unissued request.

## 6. Quantity mapping and data contract

**IA-LT-07 — Use saved demand.** Use the persisted IA selected component list and saved Standard/Flat context. Do not explode the latest master BOM again. Read authoritative item stock-control/UOM data. Exclude non-stock/service and reference-only demand; exclude explicit zero requirements. Reject missing/invalid/negative requirements rather than silently copying stock picks.

Use an applicable explicit saved `required_qty` first, preserving intentional zero and manual intent; otherwise use saved BOM/reference `requested_qty`. A manually added line without a requirement must obtain one before generation. Do not fall back to `total_quantity`: partial/zero suggested stock does not reduce material demand. Preserve the existing tenant precision/UOM/serial rules without changing them globally. Missing conversion or unsupported serial quantity must stop generation with the offending component identified.

| LOT field | Required mapping |
|---|---|
| `item_selection`, `item_name`, `item_desc`, `quantity_uom` | Eligible saved IA line |
| `requested_qty` | Valid effective requirement in that line UOM |
| `total_quantity` | Zero initially; actual picks determine it later |
| `storage_location_id`, `location_id` | Confirmed production staging storage/bin |
| `temp_qty_data`, `temp_hu_data`, `balance_id`, `stock_summary` | Empty at generation/refresh |
| Proposed `source_ia_line_id` | Persisted IA component line ID |
| Proposed source reference key | Optional saved `sc_ref_key`, retained as context |
| `fm_key` | Fresh unique LOT row key; not an IA row primary ID |

Preserve separate source lines for repeated items/UOMs. Do not merge solely by item code. Never copy IA primary/subform/parent IDs into LOT primary keys. Snowflake IDs remain strings. Do not store derived reservation display columns as request demand.

**Proposed additive fields:** header purpose `transfer_purpose` with explicit IA-supply value; `source_ia_id`; `source_ia_revision`; demand fingerprint/snapshot; `requested_by`; `requested_at`; `required_date`; generation identity/revision. Line `source_ia_line_id` and optional source reference key. Exact field names require collision/type verification against a fresh schema. Existing ordinary rows remain blank/normal by default. Use no MES flags, IDs, tables, approval flows or dictionaries to implement this relation.

**IA-LT-08 — Dates and numbering.** Requested receives a unique stable Location Transfer number through the supported number allocator. Keep that number at dispatch/receipt/retry. Do not copy the IA number or repeatedly issue a new transfer number as status advances. Source IA ID is authoritative because its displayed Draft number may change. Keep request/required dates separate from actual dispatch/receipt evidence. If existing schema requires `issue_date` during Requested persistence, present it only as a planned transfer date in this new purpose and require warehouse confirmation of the actual posting date at dispatch; normal transfer date semantics remain unchanged. Use the existing business timezone rules.

## 7. Server controls and lifecycle

**IA-LT-09 — Access.** Check current user, tenant, organisation and plant on every command. Production can create/view/cancel an eligible own-scope request; warehouse can select stock/dispatch; receiver can complete under assigned permissions. Enforce both server and UI controls. Existing transfer permission meanings remain unchanged; add purpose-specific permissions where separation requires them. Do not trust client-supplied status, source revision, user or purpose.

**IA-LT-10 — Retry and duplicates.** Use a durable unique generation identity and an atomic claim/unique constraint or equivalent supported mechanism. Search-then-add alone is insufficient. At most one live IA-supply request may exist per IA; concurrent creation or changed destination must not evade that rule. Repeat calls return the existing request, including its eventual completion, rather than supplying the same demand twice. After cancellation, explicit replacement must retain the predecessor and audit link. A previous dispatch/completed/uncertain request blocks blind full-demand regeneration; reviewed delta/return supply is outside this first conversion command.

**IA-LT-11 — Source revision.** Fingerprint the saved material demand: source line identities, item, UOM, effective requirement, BOM context/choices, planned output basis, plant and staging destination. Exclude stock picks/display counters. Before save/refresh/dispatch re-read the source and check eligibility. A changed IA invalidates dispatch until an explicit refresh while Requested. Refresh atomically updates the demand snapshot, clears selections, increments revision and retains history. Do not silently modify an In Progress/Completed transfer. Existing IA actual-consumption variances remain governed by IA; this feature does not globally freeze IA editing.

**IA-LT-12 — Warehouse allocation.** For the new purpose, require intentional warehouse stock selections before dispatch. Do not let empty requested rows silently enter plant-wide auto-allocation. Validate selected source scope and exclude the staging destination as its own supply source; generation does not automatically net current production stock. Reuse stock availability, batch, category, UOM, serial and HU validation at dispatch. Current selector limitations remain limitations; do not bypass them to make this feature pass.

## 8. Developer change map

Prefer additive commands and purpose-gated routing around the existing stock computation. Original movement arithmetic, stock services and normal-flow guards remain unchanged. The following are identified change surfaces, not proof of no regression.

| Surface | Required extension and protected behaviour |
|---|---|
| IA form/page and saved-read command | Generate/View actions; destination/required-date input; saved Draft validation; demand snapshot. Reuse BOM resolution; do not change ordinary IA auto-allocation/reservation/output behaviour. |
| New generation command, proposed `IA_CREATE_TRANSFER_REQUEST` | Accept IA ID, expected demand revision, production destination, required date and idempotency key. Server derives source fields and creates Requested safely. Request-only creation/save/cancel must not fall into legacy non-Draft stock branches. |
| LOT schema/form/page | Purpose/source metadata, Requested option, requested-versus-selected columns, worklist, status/permission-specific actions. Audit both callback `func` bodies and JS rules where both occur in exports. Preserve legacy labels/defaults and bundle behaviour. |
| SM_LOCATION_TRANSFER guard and routing | Recognise valid IA-purpose Requested; early stock-neutral request-save/cancel path; new Requested→In Progress entry invokes STAGE. Preserve existing Draft→In Progress, Draft→Completed, In Progress→Completed/edit/cancel exactly. Unknown states/purposes fail closed. |
| Classic persistence | Review explicit property mappings at `add_node_5E9es34x`, `update_node_WKLUE7ka`, `add_node_xxQX3uMU`, `update_node_0rtpXydw`, `update_node_TxDhhT03`. Carry immutable source metadata; Requested saves need an explicit status-safe mapping. |
| Classic allocation and compute | `if_LOTallocGate`, `if_d8qLDKuv`, `if_PYPLDh47`, `if_qClvyiJK`, `code_node_LOTqtyComplete`, `code_node_LOTmainCompute`, `code_node_yPlLXIZW`: add scoped entry/phase handling; never broadly replace every non-Draft condition or globally redefine Requested as Draft. Preserve numbering for this new purpose. |
| LOT V2 form/SUBMIT | Preserve source metadata and request validation; review action/status eligibility, `LOT_HDR_PROPS`, stored-state guards, fingerprints and request payloads. Warehouse-stage larger documents must not bypass these controls. |
| LOT V2 PREPARE/COMMIT/WORKER | Review `sql_node_LPhdr`/`sql_node_LPlines`, lifted classic code, STAGE selection, commit revalidation, `update_node_LCl2write`, status completion, previous-state restore/recovery and retry comparison. Retain Requested as the real restore state. Do not globally expand legacy allowlists for unsupported purpose combinations. |
| Stock services, IA_HOLD and accounting | Reuse existing physical-transfer and IA contracts. No new global stock/costing algorithm, reservation ownership change or MES caller is required. New request creation performs no accounting sync. |
| Lists, print and reports | Show Requested clearly as demand, not physical issue. Scope date/status filters and source links; keep existing report totals/exports unchanged unless explicitly extended. |

A local phase adapter may treat valid IA-purpose Requested as a **STAGE origin for calculation only**. It must not persist Draft as an intermediate state, change the true prior-state lock/recovery value or rewrite legacy callers' source status. An alternative implementation is acceptable if it meets the same external contract and preserves existing engine semantics.

## 9. Existing logic protection and migration

**INV-01:** normal/legacy transfers remain on the original paths, including default Draft, direct completion, In Progress movement/category/ledger effects, editing, cancellation, numbering, permission and delete behaviour.

**INV-02:** keep source/batch/UOM/serial/HU identity, quantity precision, stock balances, transit ledger, costing, movement history and accounting integration semantics. Do not move money or quantity on Requested save/cancel/refresh.

**INV-03:** IA Standard/Flat choices, component calculations, suggested picks, Created holds, actual consumption, output splitting, posting and reversal retain their existing normal-flow contracts. New linked-flow checks are explicit and purpose-scoped.

**INV-04:** retain classic/background parity, existing size limits/fallback rules, locks and safe retry. Never fall back to an unmodified legacy handler with raw Requested if it would post stock or choose DIRECT incorrectly.

**INV-05:** no MES activation, record creation, field reuse or dependency. Leave pre-existing MES callers unchanged when editing shared definitions; test their compatibility without routing this feature through them.

Migration is additive: new fields/options/indexes with legacy defaults preserved, no historical conversion, renumbering, movement backfill or request fabrication. Do not activate new purpose until classic/background/form/list changes are compatible together. Rollback must preserve existing Requested documents and provide a safe read/cancel/recovery route; never map dispatched requests back to Draft or remove a status still used by records/jobs. Tenant/role enablement is opt-in for the initial release.

The user authorised preparing this feature while preserving existing behaviour. Shared branching/persistence/allowlist surfaces are affected by the extension; they cannot be labelled “no impact” from design alone. If implementation needs to change a legacy outcome, stop that specific change and obtain explicit authorization after showing before/after behaviour; continue unaffected work.

## 10. Fulfilment scope

**User selected full fulfilment for the first release.** Before Requested→In Progress, every positive requested line must have selected stock equal to its requested quantity in the line UOM under the existing precision/conversion rules. Both shortage and excess block dispatch; do not introduce an additional business tolerance. Validate per source-linked line and in aggregate for shared source balances so repeated components cannot select the same physical units twice. Warehouse cannot remove a requested line or reduce demand to make the check pass. It must obtain the stock or ask production to amend the IA and explicitly refresh the unissued request.

Receipt completes the entire dispatched transfer through the existing COMPLETE route. Partial dispatch, partial receipt and multiple deliveries on one request are excluded from this release. If a real-world receipt discrepancy arises, retain the transfer in its current valid state and use an authorised existing correction/cancellation procedure where supported; do not post a false full receipt or invent a new partial state. Developer UAT must verify the supported exception/recovery procedure before rollout.

A later partial-delivery extension needs a separate requirement: preserve original demand, dispatched/received/outstanding quantities, zero-supplied lines and delivery history through explicitly scoped new logic. It must not repeatedly reopen Completed transfers or weaken shared guards.

## 11. UAT and regression acceptance

All new/runtime UAT below is **Not Run**. The earlier 11 probes are baseline code evidence only.

| ID | Scenario | Required result |
|---|---|---|
| U01 | Saved Draft IA, requirement 100, picked 0 | Requested LOT has requested 100, actual 0, empty source allocations; IA stays Draft; no holds/movements/transit/accounting effects |
| U02 | Non-stock, REF, zero/manual-zero and manual added lines | Non-stock/REF/zero excluded; missing requirement identified; no fallback to picked quantity |
| U03 | Standard/Flat mixed SFG stopping points, repeated items/UOMs | Exact saved selected demand and source line identities retained; no duplicate parent/descendant supply |
| U04 | Change master BOM after saving IA | Generation uses saved valid IA basis; no silent re-explosion |
| U05 | Unsaved edits, save failure, Created/Processing IA, unresolved hold | Generation stops; no downgrade, hold release or partial request |
| U06 | Repeated click, concurrent creation and timeout retry | One durable request and stable number; existing result returned |
| U07 | Foreign tenant/org/plant, inactive/mismatched destination | Server rejects with no write/movement; valid roles limited to authorised scope |
| U08 | Generate Requested and reopen/save picks repeatedly | Status/reference/demand retained; stock/category/value and reservation unchanged |
| U09 | Warehouse worklist and ordinary Draft | Requested visible with IA/date/destination; ordinary Draft is not reclassified or exposed as submitted demand |
| U10 | Source IA demand changes while Requested | Dispatch blocked; explicit refresh updates revision, clears picks and retains audit |
| U11 | Changed IA after dispatch or repeated Generate after receipt | No rewriting prior transfer or blind duplicate full supply; discrepancy surfaced |
| U12 | Empty picks or picks at production destination/unauthorised warehouse | Dispatch rejected; plant-wide silent allocation does not bypass selection/source policy |
| U13 | Valid Requested→In Progress | Same stock/category/transit ledger outcome as equivalent legacy STAGE; Requested number preserved |
| U14 | In Progress→Completed | Same COMPLETE outcome; stock becomes usable at production; no double receipt |
| U15 | Requested→Completed attempt and normal Draft→Completed | New direct transition rejected; old normal direct flow remains unchanged |
| U16 | Cancel Requested; delete attempt | State/audit only, zero stock calls; physical delete blocked for new purpose |
| U17 | Cancel dispatched transfer | Existing eligible reversal/reconciliation retained; source/transit totals reconcile |
| U18 | Pre-stock background failure | Real prior Requested restored; references and picks recoverable; no duplicate number |
| U19 | Uncertain commit, worker retry, stale tab | Existing lock/review/recovery retained; no blind reset or duplicate movement |
| U20 | ≤50, >50 eligible lines and current upper limits | Same feature semantics in classic/V2; all metadata and guards survive SQL reads, job payload, commit and reopen; legacy limits preserved |
| U21 | Batch, serial, HU, alternate UOM, category variants | Existing supported validation/fallback/identity retained; unsupported case identified rather than bypassed |
| U22 | IA after receipt with earlier warehouse suggestions | Select usable production balances; consume production once, receive actual output; no second warehouse deduction or transit consumption |
| U23 | Unused material, assembly variance/reversal | Unused stock remains or transfers back; existing IA correction/posting rules retained; request history not erased |
| U24 | Request dates and number across dispatch/receipt | Separate request/required/actual evidence; one stable LOT number; normal numbering/date behaviour preserved |
| U25 | Full fulfilment with shortage/excess/zero-picked line or attempted partial receipt | Block dispatch until every requested line is fully selected; reject new partial-receipt action; ordinary transfer quantity rules unchanged |
| R01 | Existing normal Draft→In Progress→Completed | All pre/post balances, categories, transit and numbering match baseline |
| R02 | Existing normal Draft→Completed | Direct movement, costing and document behaviour match baseline |
| R03 | Existing In Progress edits/cancel/delete eligibility | Reconciliation, audit and restrictions match baseline |
| R04 | Existing normal/bundle auto-allocation and same-item repeats | Selection, quantities, UOM and merge behaviour unchanged |
| R05 | Existing normal Requested injection / unknown state | Unsupported purpose/status rejected; legacy unknown-state protections retained |
| R06 | Normal IA Standard/Flat, Created hold, output split, complete/post/revert | Existing results unchanged; related recent IA fixes not overwritten by stale imports |
| R07 | Existing shared form branches, integrations, print/report callers | No lost fields/defaults/status scope; normal permissions, accounting/cost/stock totals unchanged |
| R08 | Historical transfers and queued background jobs across rollout | Legacy reads/defaults unchanged; mixed versions cannot misroute Requested or lose recovery state |

Independent builder gap review completed with no important unanswered planning questions. This is a requirements review, not runtime acceptance.

Developer acceptance requires runtime proof for new-flow UAT and matched existing-flow regression fixtures, plus before/after affected-definition diffs. No success claim may be based solely on additive fields or the baseline probes.

## 12. Developer delivery

Provide a fresh-source change inventory with exact affected objects/nodes, additive schema/permission changes, complete local import/patch artifacts, Requested transition/command tests, old-flow comparison results, and deployment/rollback steps. Include source version/hash guards so newer IA or transfer work is not overwritten. The release must retain all invariants above; any deviation needs an explicit rationale and authorization before implementation.
