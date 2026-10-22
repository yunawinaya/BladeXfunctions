# Small Cycle IA: technical map for "Minimum Fixes to Keep Created Reservation On"

Date: **22 October 2026**. ENH-20261015-010 / ENH-20261015-011. Answers section 6 of `BA_MINIMUM_FIXES_2026-10-22.md` (rev. 1.1).

**Basis.** Written for DEV as published at 12:47 (batch 19: Created flow live, switch ON); **updated at 17:30 for DEV as published at 17:07** (batch 28): IA form v54, IA list v27, IA_SAVE v24, IA_HOLD v11, IA_V2_SUBMIT v12 / PREPARE v5 / COMMIT v6 / WORKER v4, IA_REVERT v8, IA_REVERT_V2_SUBMIT v4 / PREPARE v6 / COMMIT v5 / WORKER v3, SO_IA_PROJECTION v8, IA_SC_RELINK v8 (each read back identical after its publish). The status of each fix (implemented / enabled / verified / partial / blocked) is section 1 of `BA_REPLY_MIN_FIXES_2026-10-22.md`. The writer inventory is a read-only scan of the DEV app mirror pulled at 12:37 (its 7 missed objects are test, print, numbering and accounting-sync items, none a stock writer), plus the read-only reservation research of 21 October for the pickers. **TBC** = to be confirmed. Nothing was changed for this map.

## 1. Supported stock and client scope

**Held:** one hold per component line + material + bin + batch + category + unit, at the IA's plant and organisation: stock-controlled, non-serial items; loose picks above 0; picked from Unrestricted or Blocked; a unit that converts to the item's base unit. Batch holds are built but **not exercised live** (the DEV test tenant has no batch stock).

**Not held** (the line shows "not reserved" with a reason): non-stock lines (NON_STOCK, also left out of the coverage label); serial items (SERIAL); handling-unit picks (HANDLING_UNIT); another pick category, a unit with no conversion, an unknown item, non-digit ids (CATEGORY / UOM / ITEM / PICK); keys with duplicate balance rows or costing rows that need migration (DUPLICATE_BALANCE / COSTING: the engine would refuse them). Reference-only BOM rows (`consume_type` REF) never become Small Cycle component lines. A quantity picked below Required is not held.

| Client | Today on DEV |
|---|---|
| Desktop IA form | Draft holds nothing. **Created** saves, then starts IA_HOLD (waits for up to 50 hold picks, background above). Complete / Complete & Post: classic IA_SAVE for 50 picks or fewer, or any handling-unit / serial line; IA V2 above 50. Starts IA_HOLD on open (section 6). Its pickers add back this IA's own holds. |
| Desktop IA list | Delete (Draft or Created today: releases first, restores the IA if the release fails); Revert Completed; Post; opening it kicks the IA V2 workers. |
| Mobile app (code not in this repo) | No Created button. Saves and completes through IA_SAVE, which keeps a Created IA Created, marks it RESERVING and issues its holds at completion. Never calls IA_HOLD: reserve and close wait for a desktop open. Its picker does not add back own holds. Its delete writes straight to the database. The mobile guide's changes are not made. |
| Direct API | Any logged-in user can call a workflow by id (no per-workflow permission); section 8 applies. Platform data-API / scripting writes bypass every workflow. |

## 2. Writers that overlap IA holds

All change `item_balance` (and `item_batch_balance` for batch stock) and `inventory_movement` at the same plant / bin / batch. **Locked** = INVENTORY_BULK_APPLY (2109916822821744641) or INVENTORY_APPLY_OPERATION (2105133980371554305): both take the same per-balance locks (INVENTORY_LOCK_TOKENS, "same keys and order"), re-read under the lock and refuse a short bucket. **Classic** = SUBTRACT_INVENTORY (2012096660219564034) / ADD_INVENTORY (2012005532688723970) or their `_NEW` copies (2031973476128071681 / 2031995315136184322): read, check, write, no lock. No DEV workflow writes these tables through raw SQL.

| Writer (DEV workflow) | Path | Can it consume Reserved? |
|---|---|---|
| IA_HOLD 2112752274794217473 (reserve, release, close) | Locked | Its own rows only |
| IA completion, classic: IA_SAVE 2098335576774463489 | Classic | Its own held part only |
| IA completion, background: IA_V2_SUBMIT 2112141238600376321 → WORKER 2112141277456408577 → PREPARE 2112141312130719745 / COMMIT 2112141346016501762 | Locked | Its own held part only |
| IA revert: IA_REVERT 2099319746652852225 (classic); IA_REVERT_V2_SUBMIT 2112141384234999809 → PREPARE 2112141455206817794 / COMMIT 2112141490329919490 | Classic / Locked | Returns to the recorded category, never into Reserved |
| Another IA (same workflows) | as above | Never this IA's rows (matched by IA id) |
| GD classic: GOODS_DELIVERY 2017151544868491265 → GD_UNUSED_FN_NEW 2032273338771128322; also via classic Picking (PICKING 2020683258347081730), Picking Plan (PICKING_PLAN 2021431201147527170), Packing save (PACKING_SAVE 1994279909883895810); GD revert GD_REVERT_COMPLETED → GD_PROCESS_REVERT | Classic | Yes, sized by its own SO-line / GD rows; IA rows carry neither |
| GD V2 (Created GD_BULK_COMMIT; Completed / Edit / Cancel / Revert GD_*_PREPARE / _COMMIT), Picking V2 (PICKING_BULK_*), Packing V2 (PACKING_BULK_COMMIT) | Locked | Same rule, own rows. Which GDs still route classic today (20 Oct audit: built from Picking / Picking Plan, non-stock or zero lines, SO multi-convert of HU / Pending lines, "Created and Post", V2 refusals): TBC |
| Misc Issue SM_MISC_ISSUE 2015602242971631618; Plant Transfer SM_PLANT_TRANSFER 2025864403783462913; Stock Picking STOCK_PICKING_PROCESS (calls these and SM_LOCATION_TRANSFER) | Classic | Only their own Created picks; pickers offer Unrestricted (PT also Blocked) |
| Location Transfer SM_LOCATION_TRANSFER 2013133675374927874 (50 lines or fewer, and mobile) / LOT V2 above 50 (LOT_V2_COMMIT 2110992400045441026) | Classic / Locked | Picker: Unrestricted / Blocked; the server takes the line's category |
| Stock Adjustment STOCK_ADJUSTMENT 2032025505853816833 (50 entries or fewer) / SA V2 above 50; Stock Count review splits the same way at 50 lines | Classic / Locked | Picker excludes Reserved; the server takes the line's category |
| Category Transfer SM_CATEGORY_TRANSFER 2056657152750440449 | Classic | Picker: Unrestricted / Blocked; the server takes the line's categories |
| Disposal / Scrap SM_DISPOSAL_SCRAP 2031319688329498625 | Classic | **Yes**: its picker offers Reserved (21 Oct) and the server subtracts the pick's category, no owner check (DEV use only; PROD 0 rows on 21 Oct) |
| Goods Issue SM_GOODS_ISSUE 2034106646263119874 | Classic | The workflow (production "Create GI", from SM_PROD_RECEIPT) subtracts Unrestricted only; its picker offers Reserved (21 Oct): TBC whether any path issues Reserved |
| Reservation writers: Reserve-list release CANCEL_PENDING 2021394283638693889; GLOBAL_RESERVED 2016050452018102274 (from SM_PROD_RECEIPT, WO_SAVE) | Classic | Own Pending / Production rows; TBC whether the Reserve list can show IA rows |
| Other classic writers: GOODS_RECEIVING, GR_REVERT_COMPLETED, PUTAWAY, PURCHASE_RETURN, SRR_SAVE, SM_MISC_RECEIPT, SM_OPENING_BALANCE, REPACKING_PROCESS, HANDLING_UNIT, IDA_SAVE | Classic | Purchase Return's picker excludes Reserved; the others TBC |
| Other locked writers: GR_COMPLETE_COMMIT, GR_REVERT_COMMIT, PUTAWAY_BULK_COMMIT, IDA_V2_PREPARE / COMMIT | Locked | n/a |
| Client form scripts writing through the platform data API (no workflow, no lock): Stock Movement, Plant Transfer, Location Transfer, Category Transfer, Picking and Packing loading-bay handlers, Picking Plan, Stock Count, Transfer Order Putaway, QM Basic Inspection Lot, Goods Receiving; legacy pages Goods Delivery / Stock Adjustment / Purchase Return / Sales Return Receiving / Goods Receiving Form | None | Some also write `on_reserved_gd`; TBC which handlers are still bound to live buttons |

## 3. Ownership enforcement

**Enforced:**
- **Hold rows** (`on_reserved_gd`): doc_type "Item Assembly", doc_id = IA id, doc_line_id = component line, status Allocated, no SO line and no GD id, so Goods Delivery / Picking / Packing readers never count them as theirs (reported by those modules' V2 owners on 21 Oct; not re-checked).
- **Reserved category:** the held quantity leaves Unrestricted / Blocked, which is what every picker reads.
- **Own add-back:** the IA's pickers add back only its own Allocated rows (a stored, enrolled IA; a clone never adds back its source's).
- **Completion split** (classic and V2): issues from Reserved only up to its own Allocated rows per line + material + bin + batch + category, the rest from the pick's category with the normal checks. A hold taken from Blocked serves only a Blocked pick and returns to Blocked.
- **CLOSE** attributes what this cycle issued from Reserved to its own rows; more than it held goes to Needs review.
- **Engine locks** per balance; a short bucket or a duplicate balance row is refused; a repeated operation key is replayed, not applied twice.

**Not enforced:**
- Reserved is one pooled quantity per balance row; ownership lives only in `on_reserved_gd`. No stock writer, classic or engine, checks who owns Reserved stock: a writer subtracting Reserved for its own rows, a picker offering Reserved, or a direct API call can take IA-backed stock.
- Classic writers take no lock: racing a hold on the same balance row, either side can lose an update.
- Existing drift (21 Oct research): PROD had 55 balance rows holding 7,188.95 reserved units with no reservation row. Nothing repairs it.

## 4. Material target, override and revision

| Item | Today |
|---|---|
| Hold target | The saved lines' loose picks (`temp_qty_data`), per line + material + bin + batch + category + unit, capped by free stock. Required does not drive the hold. |
| Required | Line `required_qty` (decimal 65,8): set from the BOM reference (`requested_qty`), follows it while still equal to it, a manual value is kept, auto-allocation never lowers it, a line sent without it keeps its stored value. Shown as Required / Reserved / Short. |
| Reference, line quantity | `requested_qty` (BOM reference) and `total_quantity` (lowered by auto-allocation to what it found): native meanings unchanged. |
| Missing | No manual-override flag (re-typing the old reference counts as following). No material revision id: IA_HOLD reserves whatever lines are saved when it reads them; a save during a run is caught only by the header `update_time` at the finish (the IA stays RESERVING). Completion matches holds by line + material + bin + batch + category, not by revision. IA V2 jobs refuse if the stored lines changed since submit (IA_LINES_CHANGED). |
| **Conversion basis (gap)** | Hold rows keep quantities in the line's unit (`item_uom`) only: no base quantity or factor. Releases, CLOSE, the completion split and revert all convert with the item's **current** conversion (the engine converts at apply time). A conversion changed between hold and release would move a different base quantity back than was held, so the Reserved bucket and the rows drift apart. The hold's IA-H movement records the base quantity, but nothing reads it back. |
| **Line ids (gap)** | Holds are keyed by `doc_line_id`. If a save recreates line ids (TBC whether any client does, e.g. mobile), the next reconcile releases the old rows and holds anew in the same locked operation: no double hold, but the old-to-new ownership mapping is lost, and a completion before that reconcile cannot use the old holds (it issues from free stock or is refused as short; CLOSE then releases them). |

## 5. Durable pending, request and effect storage

| Store | Content |
|---|---|
| IA header `sm_item_assembly` (table 2098256587713404929) | Status Created. `material_hold_status`: RESERVING (written by IA_SAVE in the Created save itself), FULL, PARTIAL, SHORT, NONE, REVIEW, CLOSED; `material_hold_at` = last check. Both in the platform field history (`sm_item_assembly_history`). |
| Hold rows (`on_reserved_gd`) | Per fragment: doc_id, doc_no, doc_line_id, material, bin, batch, item_uom, reserved / open / delivered qty, from_category, plant, organisation, job_line_key (the run's operation key), source_reserved_id (the row it replaced). Processing (written before the move; every reader skips it) → Allocated, or soft-deleted if nothing moved. Allocated → Releasing → Cancelled (or back to Allocated). CLOSE: used part → Delivered (row split), rest → Releasing → Cancelled. |
| Stock moves | `inventory_movement` type IA-H, reference `<IA number>/H`, no costing: category → Reserved and back. |
| Run identity | One operation key per run, `IAH\|<ia>\|<n>`; the engine records it in `gd_publish_step` (`IBA\|I\|<n>` intents, `IBA\|DONE`) and replays a repeated key. |
| Run mutex | `gd_publish_step` job_id `IAH\|<ia>`, step `TICKET\|<n>`, HELD → FREE, result_ref = the operation key; a HELD ticket older than 10 minutes counts as dead. |
| Completion claim (MIN-02, 14:20; outcome since 17:07) | `gd_publish_step` job_id `IAS\|<ia>`, step `CLAIM\|<n>` (the next number ever used), HELD at the server clock right before the completion's first write; the lowest live HELD claim wins (a claim older than 10 minutes counts as dead); FREE at every exit with `result_ref` = how it ended: `DONE`, `PARTIAL\|SUBTRACT`, `PARTIAL\|RECEIPT` (normal save), `V2` (handed to the background job), `LOST` (refused). IA_HOLD CHECK reads them. |
| Background completion / revert | `gd_async_job` command COMPLETE_IA / REVERT_IA, correlation `IA\|<ia>`, idempotency key; QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_IA / COMMITTING_REVERT → COMPLETED / FAILED / REQUIRES_REVIEW; lock rows `IAC\|<ia>` `LOCK\|<n>`; header `ia_v2_job_id`. |
| Not stored | A reservation request or job row, a material revision, a base quantity or conversion on hold rows. |

**Run controls across cycles.** IA_HOLD refuses RECONCILE on a deleted IA (RELEASE_ALL only), answers "nothing to reserve" for statuses other than Draft / Created, refuses Processing (409), and runs CLOSE only for Completed / Fully Posted, reading only the current cycle (after the last revert's IA-R movement) net of this cycle's Delivered rows.

| | Guarantees | Does not guarantee |
|---|---|---|
| MIN-02 | Hold runs of one IA never overlap; no hold, release or close move is applied twice; CLOSE delivers each consumption once per cycle; a completion is refused (409) while a hold run is live or its rows are in flight; IA V2 allows one open job per IA. Since 14:20 / 14:39 every completion of a saved IA (normal save and background) takes the `IAS\|` claim before its first write, with the status re-checked under it; since 17:07 the claim records how the completion ended. | Atomic completion: the normal save writes Completed before its stock moves; a stopped one is flagged, not repaired. Fencing: an attempt stalled more than 10 minutes between its claim and its first write could still write after a newer one. A new IA completed in one step takes no claim. |
| MIN-03 | RESERVING is written in the same server save (a closed browser cannot lose it); an unfinished run is classified by the next run from the engine's record (applied → finished; nothing moved → rolled back; uncertain → REVIEW, no new move); a stale run never labels a newer save as reserved. | Anything runs by itself (only the desktop form starts IA_HOLD); RESERVING has no request id or material revision. A stored RESERVING or REVIEW label alone does not block a completion: it then uses the holds that exist and free stock for the rest. |

## 6. Retry and reconcile entry

- **After a Created save** the form starts RECONCILE; **after a completion** it starts CLOSE (classic at once, V2 when the job is COMPLETED).
- **On open (desktop form):** Created + RESERVING → RECONCILE (switch ON only); Completed / Fully Posted still holding (RESERVING, FULL, PARTIAL, SHORT, REVIEW) → CLOSE; a Draft still marked (e.g. after a revert) → a quiet RECONCILE that gives everything back.
- **IA list:** Delete (Draft and Cancelled only) → header deleted, then RELEASE_ALL (3 tries on 409), header restored unless 200 + NONE, then the lines. Opening the list kicks the IA V2 workers (at most every 2 minutes per browser), finishes up to 10 Pending reservations (every 2 minutes) and runs the SWEEP of IAs deleted while still holding, releasing each (every 10 minutes). **Retry Reservation** (toolbar) runs for the selected IAs what each one's stored state needs. A completed IA still holding is closed by Retry or on open.
- **Needs review:** a Created IA retries only on its next save (opening does not); a completed IA on its next open; an uncertain engine result ("did not report back") needs an administrator, with no tool for it.
- **Nobody opens the list or the IA: nothing runs.** No server job; the platform scheduler is not used (decision, 22 October).
- **The list's Reservation column** (Pending, Fully reserved, Partially reserved, Nothing reserved, None, Needs review, Closed) finds what needs a retry.

## 7. Completion, close and revert handoff

| Path | Behaviour |
|---|---|
| Draft direct Complete | Holds nothing; free stock, as before. |
| Created, classic IA_SAVE (50 picks or fewer, or any HU / serial line) | Reads its own holds (refused 409 while a hold run is live); the held part is issued from Reserved, the rest from the pick's category; FG received; then the form starts CLOSE. |
| Created, IA V2 (more than 50 picks) | SUBMIT queues COMPLETE_IA (claim `IAS\|`, freed `V2` once the IA is Processing); PREPARE splits the same way and fails the job while a hold run is busy; COMMIT issues through the engine; the form starts CLOSE when the job is COMPLETED. A job goes back to the status it started from (Draft or Created, holds untouched) only when the engine applied nothing (it refused, or never started the operation: no intent after 8 waits); anything uncertain or partly applied is REQUIRES_REVIEW with the IA left Processing. |
| CLOSE (IA_HOLD) | Current cycle only: used holds → Delivered, the rest released to its category in one engine operation; header CLOSED; a mismatch → REVIEW. |
| Delete (list) | Draft or Cancelled only (a Created IA is cancelled first): the header is soft-deleted first (a client write), then RELEASE_ALL; unless it answers 200 + NONE, the header is restored; then the lines. The deleted header keeps its hold mark until released, so the list's SWEEP finds an interrupted delete. |
| Cancel (form) | Created only: IA_HOLD CANCEL releases everything, then sets Cancelled; a release that does not finish leaves it Created (Needs review). Cancelled is read-only on the server. |
| Revert (classic and V2) | Refused while any own row is open or a hold run is live ("open it once"). Reserved-issued components return to the category recorded on this cycle's Delivered rows. The result is Draft with no holds; the user clicks Created to reserve again. |
| Accounting | Separate from the stock completion (verified in both form handlers and the list's Post): Complete & Post completes first (classic save, or the V2 job once COMPLETED), then the form sets `posted_status` "Pending Post" (client write) and queues the accounting agent task 2013511169625042946 ("post_item_assembly") for SQL Accounting V2 / AutoCount Accounting V2. A post that fails or never starts is retried from the list's Post (Completed, posted Unposted / Failed Post / blank), never by re-running IA_SAVE. Unchanged by RES-01. |

## 8. Permission checks

**Checked by the server today:**
- Every IA workflow: the session tenant (from the login, never the request).
- IA_HOLD: session tenant and user required; digit ids; operation RECONCILE / RELEASE_ALL / CLOSE / CANCEL, plus the read-only SWEEP (list only) and CHECK (form or list); source SAVE / FORM / LIST / REVERT / COMPLETE; the IA must exist in the tenant and belong to the given organisation; the user must be assigned to it or one of its plants (CHECK and SWEEP: tenant and organisation only, they move nothing); the status gates of section 5.
- Organisation membership (the user's department within the organisation's tree): IA_HOLD, SO_IA_PROJECTION, IA_SC_RELINK; IA_SAVE and IA_V2_SUBMIT only when a new SO link is saved.
- IA_SAVE refuses a stale completion of a Completed / Fully Posted IA (409), a save from a form already showing Completed (401) and a completion while a hold run is live (409); a Draft save of a stored Created IA stays Created.

**Not checked:**
- Menu rights (who may open, create, complete, delete or revert) are screen checks; the platform has no per-workflow permission.
- Membership is organisation-wide: a user assigned to one plant passes for every plant of that organisation.
- Ordinary IA saves and completions and both reverts check the tenant, not membership.
- IA_SAVE takes the transition from the client's `saveAs`: any value other than "Draft" runs the completion; TBC whether unknown values from a direct call are refused (no allow-list found).
- Platform data-API writes (the list's header delete, mobile deletes, scripting) bypass every workflow.

## 9. Activation and switch-off

- **Switch `RES_ENABLED`:** one constant in IA_SAVE (`code_node_SCin`) and one builder constant baked into three form scripts (Created save, Draft save, mount). ON on DEV since 09:34 today (then reserving on Draft saves); Created flow live since 12:47.
- **OFF:** IA_SAVE enrols nothing (no RESERVING); the form hides Created and never starts RECONCILE. From the stored status, whatever the switch: completion split (classic and V2), CLOSE after completion and on open, Draft release on open, own add-back, list-delete release, revert, display.
- **IA_HOLD's own switch `HD_ACQUIRE_ENABLED` (17:07, ON):** off, no run makes a new hold, whoever calls (the form, the save's follow-up, Retry, a direct request); surplus release, CLOSE, CANCEL, RELEASE_ALL and the SWEEP work as before, and the answer says "Reservation is switched off".
- **Gap when only `RES_ENABLED` is OFF:** edits of an enrolled Created IA are not reconciled (its holds stay as they were until completion, cancel or delete).
- **No live Draft holds:** developer's read-only check at 12:06: DEV 128 Delivered + 67 Cancelled hold rows, none live; PROD no IA hold rows and no `material_hold_status` column yet. Re-checked for this map on DEV at 13:07 (UTC+8): 195 Delivered + 70 Cancelled, none Allocated / Processing / Releasing, none on a Draft; no hold row was created between 12:06 and the 12:47 publish, and every row since belongs to a Created or completed IA (the developer's post-publish live tests). PROD not re-queried.

## Unmet core capabilities (MIN items we cannot meet in LOWCODE tonight)

- **MIN-01:** classic writers do not take the engine's balance locks, and no writer checks who owns Reserved stock. Protection needs every overlapping writer changed: classic GD save (GOODS_DELIVERY → GD_UNUSED_FN_NEW, incl. classic Picking, Picking Plan, Packing save, GD revert), Misc Issue, Plant Transfer, Stock Picking, Location Transfer (50 lines or fewer, and mobile), Stock Adjustment (50 entries or fewer) and Stock Count review, Category Transfer, Disposal / Scrap, Goods Issue, CANCEL_PENDING and GLOBAL_RESERVED callers, Goods Receiving, GR revert, Putaway, Purchase Return, Sales Return Receiving, Misc Receipt, Opening Balance, Repacking, Handling Unit, Item Disassembly, the classic IA save and IA revert, and the client form scripts of section 2; plus an owner check wherever Reserved can be subtracted.
- **MIN-04:** mobile deletes write straight to the database through the platform's data API (so does the desktop list's header delete): no workflow sees them, so server-side refusal is not available without a mobile release. TBC: whether the platform offers a per-table delete permission. Mobile edits go through IA_SAVE (kept Created, marked RESERVING) but are reconciled only on the next desktop open.
- **MIN-05:** no server-side job resumes an interrupted close or release by itself. Since 14:04 / 14:51 the list's Retry Reservation and its SWEEP (interrupted deletes, found from the deleted header's hold mark) cover them when someone opens the list; an uncertain engine result still needs an administrator.

## Built and published today after this map was first written

1. **Cancel for Created IAs** (13:08): as section 7.
2. **MIN-06 truthful coverage labels** (13:53) and the unsaved-changes marker (15:15).
3. **MIN-03 retry worklist** (14:04): the Reservation column and Retry Reservation.
4. **MIN-02 one completion per IA** (14:20 normal save, 14:39 background), its outcome check (17:07).
5. **MIN-05 stranded holds** (14:51): the SWEEP.
6. **RF-09 manual Required** and the Reserved-pick refusal at completion (15:32).
7. **C5 server-side switch** in IA_HOLD (17:07).

The findings of the 12:50 review went out with the 12:47-13:00 publish (for example, the SO Linked IAs page v8 counts a Created IA as open).
