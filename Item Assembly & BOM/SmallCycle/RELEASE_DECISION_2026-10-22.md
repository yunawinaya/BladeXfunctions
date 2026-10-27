# Small Cycle IA: tonight's release decision and its limits

Date: **22 October 2026**. Enhancements: ENH-20261015-010 / ENH-20261015-011.
Answers: your handoff "Small Cycle IA — Remaining Fixes and Created Flow" (22 October). This records a decision and its limits. It is not
test evidence: the final DEV results are reported after today's publish.

## 1. Decision

Tonight's production promotion (22 October, 21:00) ships Small Cycle IA **with the Created reservation switched on**. This was decided on
22 October after your handoff was reviewed, in the knowledge that RF-01 to RF-06 are not met yet. The open controls in section 4 are
therefore known risks on production until they are fixed (section 5).

The reservation can still be switched off at any time: one setting in the save workflow and one in the form (`RES_ENABLED`: the
Created button hidden, no new Reserving recorded) and, since 17:07, one in the reservation workflow itself (`HD_ACQUIRE_ENABLED` in
IA_HOLD: no new hold from any caller, direct requests included). Switched off, reservations that already exist are still used at
completion, released on cancel and delete, closed after completion and returned on revert.

The single status map (implemented / enabled / verified / partial / blocked, with versions and switches) is section 1 of
`BA_REPLY_MIN_FIXES_2026-10-22.md`; this memo was corrected to it at 17:30 (the BA's rev 1.2, C1-C7).

## 2. What ships tonight

Built and covered by automated tests; published to DEV on 22 October (Created 12:47, Cancel 13:08, reservation labels 13:53, retry worklist 14:04, one completion per IA 14:20 / 14:39, stranded holds 14:51, unsaved-changes marker 15:15, manual Required and the Reserved-pick refusal 15:32, completion outcome check and the server-side switch 17:07) and checked live there where a workflow changed (Created L1-L8, Cancel C1-C6, labels M1-M3, completion race K2-K3, claims T1-T4, manual Required R1-R4: all passed; the list's buttons need the browser pass).

| Area | Behaviour |
|---|---|
| Save as Draft | Reserves nothing. |
| Created (new button next to Draft) | Saves the IA as Created and reserves the available eligible raw materials at their picked bin and batch. A shortage is shown and never blocks the save. The IA shows Reserving, then Fully / Partially reserved, Shortage or Nothing to reserve. |
| Edit a Created IA | Stays Created; each save reserves the extra and releases the surplus. It never goes back to Draft (a stale tab or a mobile save keeps it Created). |
| Complete / Complete & Post | From Draft: free stock, as today. From Created: its own holds first, then free stock where the actuals need it; the unused rest is released after the completion; the hold shows Closed. Small IAs use the normal save, big ones the background completion. A background job puts the IA back to the status it started from (Draft or Created, with its holds) only when the stock engine applied nothing (it refused, or never started the operation); an uncertain or partly applied job ends Requires Review and the IA stays Processing (nothing is reset or posted again). The normal save is not atomic: it writes Completed first, then the stock; a completion that did not finish is now flagged on the IA (see One completion per IA). |
| Cancel (decided by the product owner on 22 October: "to releases the reservation it should be Cancel tho with 'Cancelled' status, same way like GD logic" and "Delete is for Deleting Draft and Cancelled"; live on DEV 13:08, tested) | **Created IAs only.** Cancel releases the whole reservation, and only when that fully succeeds sets the status **Cancelled**; if the release cannot finish, the IA stays Created and the user is told. A Cancelled IA is read-only: saving, completing or reserving it is refused on the server. |
| Cancel from the list (22 October evening, like Goods Delivery) | The Item Assembly list's **Cancel** button (its own permission ia_cancel, set by the product owner in the designer on 22 October 20:22; on DEV 4 roles hold it, against 14 for ia_save_draft) cancels the selected Created IAs one at a time and shows one summary; any other selected status is left as it is, with the reason. This is the only Cancel: the form's own Cancel button was removed (product owner, 22 October evening). |
| Delete | **Draft and Cancelled IAs only**; the list refuses a Created IA ("cancel it first"). The list deletes the header first (no new reservation can start for it), then releases anything still held; if the release does not finish, the header is restored and nothing else is deleted; then the lines are deleted. An interruption after the header write is released when the list next opens (Stranded holds). |
| Revert | Back to **Draft with nothing reserved**; returned stock goes back to the category it came from. The user clicks Created to reserve again. |
| Clone | A new Draft; nothing is copied. |
| Numbering (product owner, 22 October evening) | A Created IA carries its real IA number, like a Created Goods Delivery: a new IA gets it at its first save as Created, a Draft (also a reverted one) gets a new one when it becomes Created, and its completion keeps it, also from mobile. A Draft keeps its draft number; Manual Input is unchanged. Live on DEV 19:52, checked live. |
| SO line summary / SO Linked IAs | A Created IA counts as open production (Output to Receive), like a Draft; the page opens it for editing. |
| Today's fixes | Double click on the normal Complete / Complete & Post / Draft buttons (one tab) refused; Completed saved again as Completed refused; delete race fixed (delete first, then release, restore on failure); IA numbers with special characters close correctly. |
| Reservation labels (your MIN-06; live on DEV 13:53, tested) | A Draft (and a new IA) shows "No stock reserved (Draft)". A Created IA shows Pending while its reservation runs, then Fully reserved / Partially reserved / Nothing reserved / Nothing to reserve. **Fully reserved never appears** while any stock line has an input the reservation does not support, and **Nothing to reserve** appears only when the IA has no stock-controlled material at all. Each line shows Required / Reserved for this IA / Unreserved, in the line's own unit, with the reason: not allocated, allocated stock not free, pending, needs review, or not supported (serial, handling unit, another category, a unit with no conversion). The row also says the figures are for the last save: changes not saved yet are not reserved. |

**Activation and old Draft holds (your section 3):** checked read-only on 22 October, 12:06. DEV: every IA reservation row is finished (128
Delivered, 67 Cancelled); none is live. Production: no IA reservation rows, and the reservation column is not there yet. No Draft holds stock
anywhere, so nothing needs migrating; no automatic historical reservation is made.

| Retry worklist (your MIN-03; live on DEV 14:04) | The Item Assembly list has a **Reservation** column (Pending, Fully reserved, Partially reserved, Nothing reserved, None, Needs review, Closed), so pending or failed reservations are found without opening each IA. **Retry Reservation** (toolbar, Edit permission) re-runs, for the selected IAs, what each one's stored state needs, decided on the server from the IA's status and its own hold rows re-read under the IA's run lock (never from the list's view): reserve a Created IA's missing quantity (and release only its surplus), close a completed IA that still holds, give back what a Draft (after a revert) or a Cancelled IA still holds. A Created IA whose browser closed before its reservation finished is finished when anyone next opens the list (up to 10 at a time, at most every 2 minutes per browser) or the IA itself. |

| One completion per IA (your MIN-02; live on DEV 14:20, 14:39) | Every completion of a saved IA, normal save or background, takes the same **server claim** on the IA right before its first write: a second completion of the same IA (another tab, another user, a direct request, the other path) is refused with "being completed in another window or by another user" and moves nothing. The claim also re-checks that the IA's status has not changed. Since 17:07 each claim records how its completion ended (finished, stopped at an issue, stopped at the receipt, background, refused), and a completed IA whose completion did not finish, or stopped, shows a warning: "Needs review: check this Item Assembly's stock movements before correcting it." The claim's 10-minute lease lets a new attempt start after a crash; it is not a proof that the earlier attempt stopped. |
| Stranded holds (your MIN-05; live on DEV 14:51) | An IA deleted while still holding (a delete interrupted between its two steps) is found from its own deleted record and released when the Item Assembly list opens. |

### Supported reservation scope (your MIN-06: an explicit list, for your decision)

| Reserved | Not reserved (shown on the line as "not supported", never counted as reserved) |
|---|---|
| Stock-controlled items without serial numbers | Serial-numbered items |
| Loose stock (no handling unit) | Stock picked from a handling unit |
| Picked from Unrestricted or Blocked | Picked from any other category (for example Quality Inspection, In Transit); a completion refuses a component picked from Reserved by hand (that stock is another document's reservation) |
| The line's unit is the item's base unit or has a conversion | A line unit with no conversion on the item |
| Desktop web form (the Created button) | Mobile: there is no Created button, so a mobile IA never reserves |
| Consumed by its own IA's completion (normal save and background completion); released by Cancel, Delete, Revert and after completion | Other documents (Goods Issue, Disposal / Scrap and others) do not check an IA's reservation (RF-03) |

Excluding serial and handling-unit materials is a scope reduction that needs your decision (section 6, RF-10); until then they are shown as not supported, never as reserved.

## 3. Not possible by tonight, and why

| Item | What it needs | Why not by 21:00 | Estimate |
|---|---|---|---|
| RF-01 Shared stock vs the classic writers | Built on 22 October and shipped **switched off**: the four classic stock children take the stock engine's balance lock around their read-and-write (DEV bursts: no lost update). Before switching it on: recovery of a lock key left by a failure inside the locked step (manual today), a busy answer instead of a crash when a classic call queues behind the engine, and multi-line classic saves that do not stop half-way on a busy answer. Still open after that: the engine overwriting a classic write. | The switch-on preconditions need their own changes and concurrent tests; the last part needs the engine owner. | See `MIN01_INVENTORY_2026-10-22.md` |
| RF-03 Owner checks in other consumers | Partly done on 22 October: Cancel Pending releases only Pending rows; Disposal / Scrap and the IA completion refuse Reserved picks; Goods Issue takes Unrestricted only. A guard in the shared subtract children (a Reserved subtract may not cut into an IA's open holds) is built and shipped switched off. Not covered: legacy page forms that write balances straight through the data API, and the engine-path writers that take the line's category (Location Transfer V2, Stock Adjustment V2). | Switching the guard on shares RF-01's preconditions; the legacy forms need their own changes. | See `MIN01_INVENTORY_2026-10-22.md` |
| RF-04 Mobile and direct API | The server refuses unsafe mobile edits and deletes of Created IAs; a user-scope check in every IA workflow. The mobile delete change (Draft / Cancelled only, release first) was handed to the mobile session on 22 October (17:20). | Mobile deletes write straight to the database (no server workflow sees them), so closing that gap needs a mobile app release. | 1-2 days + a mobile release |
| RF-05 Durable reservation obligation | Partly done (MIN-03, section 2): the save records the obligation on the IA (Reserving) before it answers, the list shows it, finishes it when opened, and Retry Reservation runs it on demand. Still open: an unattended run when nobody opens the list or the IA. | Needs a scheduled job; the platform's scheduler is not used for this, and the save cannot run the reservation inline (a crashed child workflow fails the save). | 1-2 days |
| RF-06 Delete / close / revert recovery | Done for interrupted deletes (MIN-05, section 2); closes and reverts already wait for or retry the step that did not finish. Still open: nothing runs while nobody opens the list. | Needs a scheduled job (not used, as RF-05). | - |
| RF-07 Guarded source repair | A conditional write for Re-link (status / source / version checked by the write itself). | The platform's update does not enforce its own condition; needs a lock-and-verify design. | About 0.5 day |
| RF-08 Material change evidence | A before / after material snapshot with actor and time on each save. | New storage on the form plus the save paths. | About 1 day |
| RF-09 Manual Required intent | Done on DEV on 22 October (15:32): a per-line flag set when Required is typed; the save keeps a flagged Required through output changes, also from a mobile save. | - | - |
| RF-10 Batch / serial / handling units | Support serial and handling-unit holds, or a narrower agreed scope. | Needs your decision first (section 6). | Depends on the decision |
| UI corrections (MIN-06) | Done on DEV on 22 October (section 2), including the live unsaved-changes marker (15:15). | - | - |
| Acceptance T01-T18 | On the final code, including real overlapping requests (T04, T05). | Needs the fixes above first. | About 2 days |

## 4. Known risks on production until fixed

| Risk | Until | What protects it meanwhile |
|---|---|---|
| A reservation racing a classic stock writer on the same bin can lose an update (the same gap exists today between any two classic writers) | RF-01 switched on | Reservations and the background completions use the locked engine; the classic lock is built and can be switched on once its preconditions are met |
| Legacy page forms (Stock Movement, Stock Adjustment, Goods Delivery, Goods Receiving, Sales Return Receiving, Production Order, QM inspection) write balances straight through the data API, and Location Transfer V2 / Stock Adjustment V2 take the line's category: none checks an IA's reservation | RF-03 | Disposal / Scrap, Cancel Pending and the IA completion refuse Reserved stock they do not own; Goods Issue takes Unrestricted only |
| Mobile: deleting a Created IA leaves its reservation without an owner; a mobile edit is reconciled only when the IA is next opened on desktop | RF-04 | Mobile has no Created button, so mobile Drafts never reserve |
| A reservation is made when the desktop form starts it; if the browser closes first, it waits until someone opens the Item Assembly list or the IA | RF-05 | The Reserving state is stored on the IA by the save and shown as Pending in the list; completion is refused while a reservation run is live or a hold move's outcome is unknown (a Needs review label alone does not block it) |
| An interrupted delete or close waits for someone to open the list or the IA | RF-06 | A delete that cannot release restores the IA; an interrupted one is released when the list opens (MIN-05); a revert is refused until the close has finished |
| Serial and handling-unit components are not reserved | RF-10 | Shown as "not supported" on the line; such an IA never shows Fully reserved |
| A normal-save completion is not atomic: the header is written Completed before the stock moves, so a refused issue or receipt, or a crash, leaves a Completed IA with part of its stock moved (as before RES-01) | A completion redesign (not planned) | The completion's claim records how it ended and the IA shows "Needs review"; a person reconciles from its stock movements. A new IA completed in one step has no claim, so it is not flagged |
| An attempt that stalls more than 10 minutes between its claim and its first write could still complete after a newer attempt | No fencing in the classic save | A classic save of at most 250 picks normally takes seconds; the status re-check under the claim stops every later attempt once the header says Completed |

## 5. Proposed order after the promotion

1. RF-05 / RF-06: our own IA workflows (RF-02's claim and its outcome check are done).
2. RF-04 server checks, then the mobile guide and a mobile release.
3. RF-09, RF-08, RF-07 and the UI corrections.
4. RF-01 / RF-03: meet the switch-on preconditions, switch the classic lock and the hold floor on, then the legacy page forms and the engine-path writers (Goods Delivery, Stock Adjustment and Location Transfer with their owner sessions; the engine overwrite with the engine owner).
5. T01-T18 on the final code, with the results recorded as passed / partial / pending / excluded.

## 6. What we need from you

- Confirm you have seen the decision in section 1, or ask for the reservation to be switched off.
- RF-10: support serial and handling-unit holds, or agree a narrower scope.
- Confirm or change the order in section 5.
