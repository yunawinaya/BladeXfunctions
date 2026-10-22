# Small Cycle Item Assembly: what is implemented (for BA confirmation)

Date: **22 October 2026**. Register items: ENH-20261015-010 / ENH-20261015-011.
Answers: your Consolidated Developer Handoff of 20 October 2026, and your later request for a **Created** status.

## Summary

- **Built:** all eight handoff items: FIX-01 to FIX-06, UI-01 and RES-01 (raw-material reservation).
- **Live on DEV:** FIX-01, FIX-02, FIX-04 and UI-01 since 21 October; FIX-03, FIX-05 and FIX-06 since 21 October, 11:29. RES-01 has been live and switched on since 22 October, 09:34.
- **Tested live on DEV (22 October):** U09 to U16 passed. They found one revert fault, which was fixed and re-tested the same morning.
- **Ships to production tonight (22 October, 21:00):** the promotion carries everything live on DEV, with the reservation switched on. It also carries today's fixes (section 5) and your **Created** status (section 1).
- **The main change: Created.** A Draft no longer reserves stock. Saving as **Created** reserves it. This replaces the handoff's rule "the first save reserves". It is being built today. If it is not finished and checked in time, the reservation ships switched off (C5).
- **Not done yet:** the screens have not been checked in a real browser, SC01-SC26 have not been run on DEV, and the mobile app changes are not made (section 4).
- **What we need from you:** tick section 3, and tell us in section 6 if anything is missing.

Status words used below: **Live on DEV** means it ships tonight with the promotion. **Ships tonight** means it was built today and goes to DEV before the promotion. **Not done** means it is not built. **Changed - see Cn** means the build departs from or interprets the handoff; please confirm row Cn in section 3.

## 1. Created status (BA request, implemented 2026-10-22 for tonight's promotion)

Status: **Being built for tonight's promotion (final status to be confirmed by the developer).**
It replaces the handoff's rule "the first durable save reserves" (section 2, row "Raw-material hold").

| Action | Behaviour |
|---|---|
| Save as Draft | Reserves nothing, as before the reservation feature. Completing from a Draft takes free stock, as today. |
| Created (new button) | Saves the IA as **Created** and reserves its raw materials. The picked quantities move to Reserved at their bin and batch. The IA shows Fully reserved, Partially reserved, Shortage or Nothing to reserve. A shortage never blocks the save. |
| Edit a Created IA | Each save re-reserves: it reserves the extra and releases the surplus. The IA stays Created and never goes back to Draft. |
| Delete | The only way to drop the reservation. The reservation is released as part of the delete. If it cannot be released, the IA is not deleted. |
| Complete / Complete & Post | Work from Created: the normal save for small IAs, the background completion for big ones. Components come out of Reserved, the unused rest is released, and the reservation shows "Closed at completion". |
| Revert a Completed IA | Goes back to **Draft with nothing reserved**. Returned stock goes back to where it came from. To reserve again, the user clicks Created. |

## 2. The handoff, item by item

### 2.1 Fixes and UI (handoff sections 5 to 10 and 13)

| Item | What the handoff asked | What is implemented | Status |
|---|---|---|---|
| FIX-01 Remaining to plan | Give an exact figure, or "Unavailable" with the reason. Allow manual entry. Use the same figures on the IA and the SO. Never turn a failure into 0. | The figure is given only when it does not depend on how deliveries and linked production overlap. Otherwise it shows "Unavailable" and why, and Use Suggestion is disabled. Your example (100 / 40 / 30) shows Unavailable. A failed read or a unit that cannot be converted shows "unavailable", never 0. The IA form, the Select SO Line list and the SO page all use the same figures. | Live on DEV · see C26 |
| Plan vs open quantity | Keep DEV behaviour and label it. | Open supply = Output to Receive, and Planned Output is shown apart. Created counts like Draft. | Live on DEV · see C4, C16 |
| FIX-02 Unlink | Keep the prepared IA. | Unlink removes only the SO link, and the history keeps the unlink. Mode, prepared BOM, plan, reference keys, lines and picks stay. The reservation is not touched. | Live on DEV |
| FIX-03 Permissions | Server-side checks of tenant, organisation and record. | The server checks that the user is assigned to the organisation, or one of its plants, before it shows SO figures, saves a new link or runs a Re-link. Tenant and user come from the login. An organisation mismatch is refused. | Live on DEV · Changed - see C24 |
| FIX-04 Flat | Keep the per-IA ticks and make the rules visible. | The dialog says a tick applies to every place the item is used. It shows the level, the BOM and version actually used (several if they differ), the parent items and the number of uses. The ticks are saved. Prepare BOM lists the differences (Rebuild / Keep). Guards stop on a missing BOM, a cycle, more than 6 levels, a missing unit conversion, too many lines, or a failed read. | Live on DEV |
| FIX-05 Change history | Who, when, before and after. | The platform's own field history is on for the SO link and its context, Planned Output, Output to Receive, BOM mode, root BOM, BOM snapshot, item, statuses and reservation status, on every save path. Reservation moves are in the stock movement history. | Live on DEV · Changed - see C10, C25 |
| FIX-06 Completed-source repair | Safe, authorised, stale-proof. | Re-link only on a Completed or Fully Posted IA whose line was removed, onto a current line of the same SO, item and organisation. It is refused while the IA is Processing, or if the IA changed since it was opened. The history keeps the old line and its baseline, the new line, who, when and why. Only the link changes. | Live on DEV · see C20, C29 |
| UI-01 Layout | Grouped sections, correct labels, actions in context. | Stacked sections: Production, Sales Order Link, Output Location, Materials, Additional Details (collapsed). Output to Receive becomes Actual Received after completion; Planned Output is labelled. Use Suggestion and Prepare BOM sit in Production, and the SO buttons in the SO section. The SO page splits Output to Receive from Actual Received. | Live on DEV · Changed - see C23 |
| UI-01 Reservation summary | A coverage label, per-line figures, and a note that unsaved edits are pending. | A Materials row shows the label (Reserving..., Fully reserved, Partially reserved, Shortage, Nothing to reserve, Needs review, Closed at completion) and when it was last checked. A Draft also shows "Reservations update when this Item Assembly is saved." Each line shows Required / Reserved / Short. | Live on DEV · the "pending edit" marker: see section 4 |

### 2.2 RES-01 raw-material reservation (handoff sections 11 and 12)

On DEV today the reservation runs when a Draft is saved. From tonight it runs when an IA is saved as Created (section 1). The mechanics are the same.

| Event | What the handoff asked | What is implemented | Status |
|---|---|---|---|
| Save that reserves | Reserve what is free, show the shortage, do not refuse the save. | Reserves what is free at each picked bin and batch, and keeps the rest as shortage. Never refuses for a shortage. U10: required 80, 50 free: 50 reserved, 30 short. Saving again after stock arrived reserved the other 30. | Live on DEV · Changed - see section 1, C7 |
| Owner and scope | The hold belongs to the IA and its component line. Standalone or linked, Standard or Flat. No non-stock or reference-only lines. | Each hold belongs to IA + line + material + bin + batch + unit. It works for standalone and linked IAs, Standard and Flat. Non-stock and reference-only lines are not held, and neither are handling-unit picks or serial-numbered items. | Live on DEV · Changed - see C6 |
| Required vs picked | Keep required, picked, held and short apart. | New **Required** quantity on each line. Auto-allocation never lowers it. The line reads e.g. Required 10 / Reserved 6 / Short 4. | Live on DEV · see C8 |
| Uncertain result | Needs review is a real state, and completion is blocked until it is reconciled. | Needs review is stored on the IA. A completion is refused while a reservation run is live or a hold move's outcome is unknown (its rows still mid-update): "being reserved right now"; tested live. A Needs review label alone (a refused move, the holds as they stand) does **not** block completion: the completion uses the IA's own holds as they are (corrected 22 October). | Live on DEV · see section 4 |
| Repeated save, double click, competing IAs | No duplicate holds and no overbooking. | A repeat run reserves nothing more and makes no duplicate (U11). Only free stock is taken; other documents' holds are never used. | Live on DEV · see section 4 |
| Increase / decrease / remove | Claim only the extra, release only the surplus. | Done (U10, U12). | Live on DEV |
| Plant, bin, item, unit or mode change | Release the old hold, make the new one, leave nothing stranded. | The next save releases the old hold and reserves the new one. The unit is part of the hold. The live test covered a removed line; the other changes are covered by automated tests. | Live on DEV |
| SO unlink or source change | No automatic release. | Nothing is released. | Live on DEV |
| New stock arrives | No automatic top-up. | The planner saves again to claim it. Automatic top-up is backlog, as you allowed. | Live on DEV |
| Completion (normal or short) | Consume from the hold, release the unused rest, receive the actual output. | The held part is issued from Reserved; anything beyond it comes from free stock with today's checks. Then the used part is closed and the unused rest released. U13: 80 held, 70 used, 10 released. Stock, cost and posting go through the existing owners. | Live on DEV |
| Direct Complete (no save first) | Leaves no extra hold. | Holds nothing; issues from free stock as today (U14). | Live on DEV |
| Big IAs (background, Processing) | Keep the protection until the real commit. | The holds stay while the IA is queued. The background job issues from Reserved, then the reservation is closed. U15: 61 lines. | Live on DEV |
| Failed completion | Never release blindly or repeat the issue. | Nothing is released on a failure. An uncertain result goes to Needs review. | Live on DEV (failure cases in simulation) |
| Delete | Release only after the delete succeeds. No new cancel status. | The IA is deleted first, then released; if the release fails, the IA is restored. No cancel status was added. | Ships tonight (today's fix) · see C12 |
| Clone | No copied holds. | Nothing is copied. The clone reserves on its own save (U16). | Live on DEV |
| Revert | Reverse the exact actuals. If the result is an open IA, reconcile it once. | Components issued from Reserved go back to the category they were reserved from (Unrestricted or Blocked), so Blocked stock never becomes free. The IA goes to Draft with nothing reserved. Classic and background reverts were tested over two cycles (U16). | Live on DEV · Changed - see section 1, C11 |
| Old Drafts (enrolment) | An explicit policy, no backfill. | IAs that exist before activation never reserve automatically, and nothing is backfilled on reopen. | Live on DEV · Changed - see C9 |
| Mobile | An old app must not erase or duplicate holds. | The server keeps stored values (Required, reference keys) when the mobile app leaves them out. Mobile has no Created button. | Live on DEV (server) · mobile app: Not done · see C2 |
| LOWCODE gates (section 12) | Name what cannot be guaranteed. | See C13. | Changed - see C13 |

### 2.3 Boundaries (handoff section 2) and acceptance (section 15)

- **Kept as asked, all live on DEV:**
  - Standalone IAs still work; one exact SO line per IA; one SO line can have many IAs; the same IA form opens from the SO and from the IA screen.
  - The SO link is for tracing only: no FG reservation, no automatic SO fulfilment, no delivery created by the IA.
  - Standard gives the same lines as today's BOM explosion; this was compared over all 899 BOMs of the test tenant.
  - The shared BOM master is unchanged. A saved IA is never re-prepared on reopen.
  - Reservation changes availability only, never on-hand or cost.
  - Completion keeps the existing statuses and actions; Created is added as in section 1.
  - A short completion keeps the SO shortage open for manual planning. Source changes only warn.
  - Reversal keeps the existing checks. SO to WO is untouched.
- **Acceptance:**
  - **Live on DEV, 22 October:** U09 to U16 passed.
  - **U18:** reserved stock leaves the free stock that other pickers read, by design. Batch and handling-unit stock was not exercised (section 4).
  - **U01 to U08, U17, U19 to U21:** more than 1,000 automated checks in a mock of the platform, deliberately planted bugs all caught, and smoke runs on DEV. They have **not** run in a real browser yet. SC01 to SC26 are still to run on DEV.

## 3. Please confirm

Tick each row, or tell us what to change.

**Created: the developer's detail decisions**

| ✓ | # | Decision | Why | Effect |
|---|---|---|---|---|
| [ ] | C1 | Numbering does not change: a Created IA keeps its draft number until it is completed, as a Draft does today. | No change to the numbering rules. | The final number is given at completion. |
| [ ] | C2 | Mobile has no Created button, so mobile Drafts never reserve. A Created IA edited and saved on mobile stays Created; its reservation is refreshed the next time it is opened on desktop. | The mobile app has its own release. | Until then, a mobile edit can leave a Created IA's reservation out of date. |
| [ ] | C3 | A Draft never holds stock. A Draft with a leftover reservation (e.g. an IA reverted while a reservation was still open) is released when the Draft is opened or saved on desktop. | Only Created reserves. | No hidden holds on Drafts. |
| [ ] | C4 | Created IAs count as open supply on the SO line, like Drafts. The SO Linked IAs page opens a Created IA for editing, like a Draft. To change a Draft's or Created IA's SO line, edit the IA; Re-link is for Completed IAs only. | Both are open production. | Same figures as for Drafts. |
| [ ] | C5 | Safety fallback: if Created is not finished and checked before the promotion, the reservation ships **switched off**: nothing is reserved and the Created button is hidden. The rest of Small Cycle ships as built. Switching off never strands stock that is already reserved: an IA that holds stock still uses, releases or returns it. | No half-built feature on production. | No reservation on production until it is switched on. |

**Reservation**

| ✓ | # | Decision | Why | Effect |
|---|---|---|---|---|
| [ ] | C6 | Handling-unit picks and serial-numbered items are **not reserved**. They are shown as "not reserved" with the reason. | Kept out of this cycle (approved design). | Those components stay free for other documents until completion. |
| [ ] | C7 | The reservation runs just after the save, started by the desktop screen, so a save never fails because of a reservation. With more than 50 picks it runs in the background and shows "Reserving...". | On this platform a reservation failure inside the save would fail the save after it was written. Big BOMs would make the save wait minutes. | The coverage label can appear a moment after the save. |
| [ ] | C8 | Required follows the BOM reference when the output changes, until the planner changes it by hand; a manual value is kept. If the planner retypes the old value after an output change, it counts as unchanged and follows the BOM. | Today's line quantity is lowered by auto-allocation, so it cannot show a shortage. | Required / Reserved / Short are shown apart. |
| [ ] | C9 | IAs that exist before activation never reserve on their own. An old Draft reserves only when someone saves it as Created. | Your rule: no automatic historical holds. | Old IAs complete as today. |
| [ ] | C10 | Each reservation and release appears in the stock movement history as a move between categories (Unrestricted or Blocked to Reserved, and back), with the reference "IA number/H". | It uses the existing locked stock writer; it is not a second ledger. | On-hand and cost are unchanged; the stock card shows these moves. |
| [ ] | C11 | A Completed IA whose unused reservation has not been closed yet cannot be reverted. Opening it on desktop finishes the close, and then the revert works. | No stock may come back as Reserved without an owner. | Sometimes one extra open before a revert. |
| [ ] | C12 | Delete refuses rather than leave stock reserved without an owner. If the reservation service cannot answer, a Created IA cannot be deleted at that moment. | The handoff's "release only after success, never strand stock". | The user tries again later. |
| [ ] | C13 | Accepted platform limits, without backend changes. (a) The classic stock writers (classic Goods Delivery save, Misc Issue, Plant Transfer, Stock Adjustment, small IA saves) do not lock, so a reservation racing one of them on the same bin can still lose an update; every existing reservation has the same gap. (b) Disposal/Scrap and Goods Issue can use Reserved stock without an owner check; they are not used on production today. (c) Production already has some reserved stock with no reservation record. The build detects such a mismatch and stops with Needs review; it does not repair old data. | Your section 1: name what LOWCODE cannot guarantee. | Small residual risks, made visible. |

**Earlier decisions still open (from the implementation document)**

| ✓ | # | Decision | Why | Effect |
|---|---|---|---|---|
| [ ] | C14 | Undelivered = ordered − delivered. | The native outstanding field is wrong on many existing lines. | Correct figures on the SO card. |
| [ ] | C15 | Only linked or Flat IAs use the new BOM behaviour; new standalone IAs keep today's BOM handling. Reservation (Created) applies to all IAs. | Other IAs stay exactly as today. | No change for ordinary IAs. |
| [ ] | C16 | Open supply of a Draft, Created or Processing IA = its Output to Receive, not its Planned Output. | The handoff left this as a business choice. | Plan 10 / output 6 counts 6. |
| [ ] | C17 | Clone drops the SO link and the plan. A Flat IA keeps its ticks and is prepared again. No reservation is copied. | A clone is a new production run. | The clone must be linked again. |
| [ ] | C18 | Flat cost: leaf components at their own cost; FG cost = consumed cost / quantity + the FG's own assembly cost. Intermediate assembly costs are not added. | The existing receipt-cost rule. | No new labour or machine cost. |
| [ ] | C19 | Desktop only. From the mobile app's next release, a linked or Flat IA's plant, item and quantity are read-only on mobile. | The mobile app cannot prepare a BOM this way. | Changes are made on desktop. |
| [ ] | C20 | A removed SO line is detected and shown, and re-linked by hand. Re-link covers only Completed IAs whose line was removed. A Completed IA linked to a wrong but existing line needs a revert. | Completed history stays protected. | Rare manual correction. |
| [ ] | C21 | Warnings never block. Only invalid links, an invalid or stale BOM preparation, and consuming an expanded sub-assembly are refused. | Your nonblocking rule. | — |
| [ ] | C22 | Two SO-line permissions: Linked IAs and Create IA. The row actions stay hidden until a role is granted them. | Seeing figures and creating IAs are different rights. | They must be granted on production. |
| [ ] | C23 | Plant stays at the top, next to the IA number, not under Output Location. | Changing the plant clears the materials, so it must be chosen first. | One difference from your sketch. |
| [ ] | C24 | The server checks organisation membership. Menu rights (who may open the IA or use the SO buttons) stay a screen check, because the platform has no permission per workflow. Re-saving an IA that already has a link follows native IA rights; only a new link checks membership. A direct write through the platform's scripting API would still bypass the checks; this is a platform limit. | Platform facilities. | Small residual risk. |
| [ ] | C25 | Material lines are not tracked one by one in the change history, and there is no history screen (backlog, as you allowed). | Keeps big saves fast. | Line changes show only through completion and stock records. |
| [ ] | C26 | On an uncertain line, an excess is shown as "at least N". Remaining to Plan and After This IA show only while a Draft is being edited, not on a viewed, Completed or Processing IA. | The overlap cannot be known; on a saved IA it is already in the figures. | A viewer of a Draft does not see the suggestion. |
| [ ] | C27 | Create IA from an SO line does not prefill the plant. | The IA form's own plant rules apply. | An organisation-level user picks the plant. |
| [ ] | C28 | When the output changes, serial-numbered lines and handling-unit lines are kept as entered and named for a re-pick. | Their picks cannot be scaled safely. | The user re-picks them. |
| [ ] | C29 | Re-link re-reads the IA just before writing, without a lock. | A lock would bypass the field history. | A window of milliseconds remains. |

## 4. Known open items

- **Real-browser pass:** none of the screens has run in a real browser yet. It is planned on DEV today, on the final code, after today's publish (the developer will report the result). SC01 to SC26 are still to run on DEV.
- **Created:** being built today (section 1); the final status is to be confirmed by the developer before the promotion, with the fallback in C5.
- **Mobile:** the mobile app guide for the reservation has not been sent to the mobile developer yet, and it was written before Created, so it needs updating (to be confirmed by the developer). The mobile release with read-only plant, item and quantity (C19) is not out. If a reserving IA is deleted on mobile without first releasing its reservation, the reserved stock is left with no owner.
- **Not exercised live:** stock with batches or handling units (the DEV test tenant has none). The "another reservation is running" answer has been proven only in simulation; the live runs never overlapped.
- **Not live-tested:** changes of plant, bin, unit or mode on a reserving IA, and failed or uncertain completions. These are covered by automated tests only.
- **Unsaved edits marked "pending":** the screen shows "Reservations update when this Item Assembly is saved". A separate marker on lines with unsaved edits was not found in the built screen (to be confirmed by the developer).
- **Wording:** "Partially reserved" says "short of stock" even when the planner picked less than Required on purpose.
- **Two tabs at once:** if two browser tabs complete the same small IA (50 picks or fewer) in the same second, the server does not stop it, because the classic path has no server lock. A double click in one tab is fixed (section 5).
- **Special-character IA numbers:** today's fix uses a database form that production does not use yet; another module ships it in the same promotion. If it fails there, such IAs go to Needs review and no stock moves.
- **Deferred minor findings from the review:**
  - The reservation's own guard is separate from the IA's document lock. This fails safe, and a stuck close heals when the IA is opened.
  - The check that Reserved stock matches the IA's records is partial.
  - The form and the reservation table must reach production before the workflows; the full promotion carries both.
- **Size check:** a 50-line Flat IA completed the normal (non-background) way has not been reported as measured (to be confirmed by the developer).
- **After the promotion:** grant the two SO-line permissions on production (C22).

## 5. What was fixed today (22 October 2026)

| Fix | Status |
|---|---|
| A double click on the normal Complete, Complete & Post or Draft buttons (IAs with 50 picks or fewer) could save twice. Now the second click is refused with "Workflow is already in progress. Please wait." | Ships tonight (built and tested offline; to DEV today with Created) |
| Saving a Completed IA again as Completed: confirmed it is already refused; regression tests added. | Ships tonight (tests only) |
| Delete race: the list now deletes the IA first, then releases its reservation, retrying if a reservation run is busy. If the release fails, the IA is restored and not deleted. | Ships tonight |
| IA numbers with special characters (quotes, accents, non-Latin characters) used to send the close after completion to Needs review. Now any number works. | Ships tonight · see section 4 |
| "Required" after a big IA's background completion now follows the same rules as the normal save: it is kept, follows the BOM reference, or takes its default. | Ships tonight (with Created) |
| Found by today's live tests: an IA that was reverted, completed again and reverted again could get its components back twice. Fixed at 09:58 and re-tested live (two full cycles). Since 10:47, a revert also writes one stock movement per category instead of several. | Live on DEV |
| Background completion of big IAs, published with the reservation at 09:34: a retry now waits for a run that is still going instead of failing, and goes to Needs review after several waits. A very slow save can no longer leave an IA stuck in Processing. | Live on DEV |

## 6. Anything missing?

| Handoff section | Covered? |
|---|---|
| 1 LOWCODE limits | Yes: the limits are listed in C13, C24 and C29 |
| 2 Boundaries | Yes (section 2.3); the raw-material hold is replaced by Created (section 1) |
| 3 Evidence / 4 SAP | Nothing to build; no SAP equivalence is claimed |
| 5-7 FIX-01, FIX-02 | Yes |
| 8 FIX-03, FIX-06 | Yes, with the limits in C24 and C29 |
| 9 FIX-04 | Yes |
| 10 FIX-05 | Partly: the header fields are tracked, material lines are not (C25) |
| 11 RES-01 | Yes, with Created; handling-unit and serial items are not reserved (C6) |
| 12 Gates | Yes (C7, C10, C13) |
| 13 UI-01 | Yes, except the "pending edit" marker (section 4) and Plant at the top (C23) |
| 14 Fields, mobile integrity, new-entry fallback | Yes on the server; the mobile app is Not done (section 4) |
| 15 Acceptance U01-U21 | Partly: U09-U16 live; the rest automated only; browser and SC01-SC26 pending |
| 16 Evidence | This document and the implementation document |
| 17 Backlog | Not built, as allowed |
| Your Created request | Being built for tonight (section 1) |

**If you expect something that is not listed here, please name it.**

## References

- Your handoff: `BA_HANDOFF_2026-10-20.md` (this folder).
- What was built, with per-item detail: `SMALL_CYCLE_IMPLEMENTATION.md` (this folder; its section 8 is folded into C14-C29 above).
- Reservation design: `RES01_DESIGN.md`. Mobile guide: `MOBILE_RES01_GUIDE.md` (this folder).
- The original contract (19 October): `CONTRACT_SOURCE.md` (this folder).
