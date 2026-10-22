# Small Cycle Item Assembly: what was implemented

For validation against the "Small Cycle IA implementation Contract" (19 October 2026, ENH-20261015-010 / 011).
Date: 20 October 2026, updated 22 October 10:50. Status: built and live on DEV; the PROD date is not set yet.
Testing in a real browser and the acceptance scenarios SC01-SC26 are **still to run** (section 7).

Please confirm two things: that the behaviour in sections 2-5 is what was asked for, and that the decisions in section 6
are acceptable. Each line in section 8 needs a yes or a no.

## Changes since the version of 20 October, 17:50 (the BA handoff)

This copy answers the BA's consolidated developer handoff of 20 October. Status on DEV, 21 October:

| Item | Status | Where |
|---|---|---|
| FIX-01 Remaining-production figures | Done (DEV, 21 October 10:18) | sections 2, 3 and 4 |
| FIX-02 Unlink keeps the prepared IA | Done (DEV, 21 October 10:18) | section 2 |
| FIX-04 Flat expansion choices | Done (DEV, 21 October 10:18) | section 2 |
| UI-01 Layout and labels | Done (DEV, 21 October 11:01), except the reservation summary, which comes with RES-01 | sections 2 and 3 |
| FIX-03 Server permissions | Done (DEV, 21 October 11:29): the server checks that the user belongs to the record's organisation | section 4 |
| FIX-05 Change history | Done (DEV, 21 October 11:29): the platform's own field history, switched on for the IA | section 6 (D11) |
| FIX-06 Re-link safety | Done (DEV, 21 October 11:29): a Re-link on an IA that changed in the meantime is refused | section 5 |
| RES-01 Raw-material reservation | Done (DEV, 22 October 09:34; switched ON, as you decided): a saved Draft reserves its picked stock; completion uses the reserved stock, then the rest is released; delete releases first; revert returns the stock to the bucket it came from. Live tests U09-U16 passed on 22 October; a revert fault they found was fixed the same morning. Not yet checked in a real browser (section 7) | RES01_DESIGN.md |

- **FIX-01 (sections 2-4).** The remaining quantity is given only when it does not depend on how the line's deliveries and its
  linked production overlap: nothing delivered, nothing produced, or the line covered either way. Otherwise the form shows
  "Remaining to Plan: Unavailable" and why, for example "nothing records whether the 40 PCS delivered came from the 30 PCS
  produced, so enter the quantity yourself". Your example (ordered 100, delivered 40 from other stock, 30 produced) now
  shows Unavailable instead of 60.
  - Use Suggestion is disabled while the figure is unavailable, and After This IA says Unavailable too.
  - An excess on such a line is given as "at least" the smallest possible excess.
  - A real 0 stays 0. A failed read or a unit that cannot be converted shows "unavailable", never 0.
  - The IA form, the Select SO Line list (its Suggested column stays blank) and the SO page all use the same figures.
  - Decision D2 is replaced.
- **FIX-02 (section 2).** Unlink removes only the SO link; the history keeps the UNLINK. The mode, the prepared BOM, the
  plan, the reference keys, the lines and their stock picks all stay, so a later quantity change still uses the saved BOM.
  An IA that was never prepared this way stays an ordinary IA.
- **FIX-04 (section 2).** The Flat dialog states that a tick applies to every place the item is used. For each sub-assembly
  it shows the level, the BOM and version actually used (several when its uses resolve to different BOMs), the items it is
  used under, and how many BOM lines use it.
- **UI-01 (sections 2 and 3).** The IA form is regrouped into stacked sections: Production, Sales Order Link, Output Location,
  the materials table, then Additional Details (collapsed). Quantity is labelled **Output to Receive**, and on a Completed
  or Fully Posted IA **Actual Received**. Planned Output Qty is now **Planned Output**, and Use Suggested Qty is now **Use
  Suggestion**. Use Suggestion and Prepare BOM sit in Production; the SO buttons stay in the Sales Order Link section. On the SO
  page, the old "Actual" column is split into Output to Receive (Draft and Processing IAs) and Actual Received (completed IAs).
  - **One change from your sketch:** the Plant stays at the top, next to the IA number, instead of under Output Location.
    Changing the plant clears the whole materials table (today's behaviour), so it must be chosen before the item.
- **FIX-03 (section 4).** The platform has no permission per workflow: any logged-in user can call a workflow directly by its
  id, and the SO and IA buttons only hide themselves. So the Small Cycle workflows now check, on the server, that the user
  belongs to the organisation (or one of its plants):
  - before showing an SO line's figures or the list of lines to link;
  - before a new link is saved;
  - before a Re-link.
  Otherwise the user sees "Your user is not assigned to this organisation, ...". The tenant and the user come from the login,
  never from the request.
  - Menu rights (who may open the IA or use the SO buttons) stay a screen check (point 12 in section 8).
  - A direct write through the platform's scripting API would still bypass any workflow check: a platform limit.
- **FIX-05 (D11).** The platform's own per-field change history is now on for the IA's SO link and its context, Planned Output,
  Output to Receive, BOM Mode, root BOM, BOM snapshot (child BOMs and versions), item and status. Every save path writes it
  (desktop, mobile, the workflows) with who, when and the new value. It is kept in `sm_item_assembly_history`; a history
  screen is backlog, as you allowed. The material lines are not tracked one by one, so big background saves stay fast.
- **FIX-06 (section 5).** Re-link sends the link and status the IA had when the user opened it. The server reads the IA again
  just before writing, and refuses if either has changed ("This Item Assembly changed since you opened it: open it again").
  The link history now keeps the old line, its baseline, the new line, who, when, and why.

## 1. In one paragraph

An Item Assembly (IA) can now be linked to one exact Sales Order (SO) line; one SO line can have many IAs, and a standalone
IA works as before. The IA chooses **Standard** (today's direct BOM) or **Flat** (sub-assemblies expanded into their own
components) and saves what it prepared as a self-contained snapshot. The planned output is kept apart from the actual
quantity that is posted. Completion goes through the existing IA completion (the normal one for small assemblies, the
background one for big assemblies), now with extra checks. Each SO line gets a read-only "Linked IAs" page and a "Create IA"
shortcut. IAs that are neither linked nor Flat behave exactly as before. Everything was built in LOWCODE (workflows, forms,
pages), with no backend change.

## 2. The IA form

**New fields**

| Field | What it holds |
|---|---|
| BOM Mode | Standard or Flat. Empty for an old or standalone IA, which then works exactly as before. |
| Planned Output | The plan. The posted quantity is still the existing `item_qty`, now labelled **Output to Receive**, and **Actual Received** once the IA is completed. |
| Sales Order Link (section) | A collapsible section under Production. Read-only rows, each shown only when it applies: Sales Order and line, Customer, Ordered, Delivered (left); Produced, In Progress, Remaining to Plan with how it is worked out (or Unavailable and why), After This IA (right); any warning (full width, in the error style). Its buttons sit on one row below. |
| BOM (row in Production) | The BOM used: Standard or Flat, its version, how many sub-assemblies are expanded, when it was prepared. |
| Hidden fields | The SO header and line ids, the link context (baseline figures and link history), the root BOM, the BOM snapshot, and a reference key on each component line. |

**New buttons:** Select SO Line, Unlink, Re-link and Refresh Figures in the Sales Order Link section; Use Suggestion and
Prepare BOM in Production. Each one shows only where it applies.

**Example: a Draft of 6 PCS linked to a line of 10 PCS (UI-01 layout)**

```
Plant              ASAI HQ                       Date        2026-10-21
Item Assembly No   IA-2610-0012                  Issued By   Admin

▾ Production
  BOM Item Code   TES500                         Planned Output      6
  BOM Item Name   Muffler ...                    Output to Receive   6
  BOM Mode        (•) Standard ( ) Flat          UOM                 PCS
  BOM             Standard · V1 · prepared 2026-10-20
  [Use Suggestion] [Prepare BOM]

▾ Sales Order Link
  Sales Order   SO/20261020-053 · line 1         Produced            0 PCS
  Customer      TEST MUITIPLE CURRENCY           In Progress         0 PCS in other open IAs
  Ordered       10 PCS                           Remaining to Plan   10 PCS = 10 ordered − 0 produced − 0 in progress
  Delivered     0 PCS                            After This IA       4 PCS still needed
  [Select SO Line] [Unlink] [Refresh Figures]

▾ Output Location
  Storage Location     Common Storage            Bin Location   A1-B1
  Inventory Category   Unrestricted

Materials (the component table)

▸ Additional Details   (Project, Reference Documents, Remarks 1-3)
```

- **Remaining to Plan** takes off delivered or produced, then what other open IAs already plan. If both delivered and
  produced are above 0 and the answer depends on how they overlap, it says Unavailable and why (FIX-01, section 4).
- **After This IA** follows Output to Receive as it is typed: "4 PCS still needed", or "fully covered". Above the order a
  message replaces it: "⚠ This Item Assembly makes 2 PCS more than ordered. You can still save."
- **Use Suggestion** sets both Planned Output and Output to Receive, says so, and then reviews the material lines (as a
  quantity change does).
- On a viewed, Completed or Processing IA, Remaining to Plan and After This IA are not shown (the IA is already in the figures),
  and In Progress counts every open IA. An ordinary IA (not linked, not Flat) shows no Sales Order Link section on a view.
- A Completed or Fully Posted IA shows **Actual Received** in place of Output to Receive.

**Linking an IA to an SO line (IA01)**
- **Select SO Line** lists the open lines for the IA's item. A line is open when its SO is Issued or Processing and the line is
  not Completed or Cancelled. The list shows the SO number, line, customer, ordered, delivered, the suggestion and the unit.
  Repeated lines of the same item, and lines of different customers, are listed separately.
- **If the IA already has component lines**, linking keeps them and their stock picks; the BOM snapshot is taken from them.
- **If the IA has no component lines**, linking prepares them from the BOM and auto-allocates stock, as today. A quantity
  already entered becomes the plan.
- **If the quantity is still 0**, linking fills the plan and the quantity with the suggestion (when there is one). Otherwise
  the user's quantity is kept and the suggestion is only shown.
- **Unlink** removes only the link (FIX-02). The IA keeps its mode, prepared BOM, plan, lines and picks. The link history keeps
  the unlink.
- **Changing the item** of a linked IA asks first, because it removes the link. "Keep Item" puts the old item back.

**Standard and Flat (IA03, BOM01-BOM03)**
- **Standard** gives the same component lines as today's BOM explosion. Compared over all 899 BOMs of the test tenant, the
  lines were identical.
- **Choosing Flat** opens a dialog that lists the sub-assemblies with their own active, non-empty BOM: level, the BOM and
  version actually used, the items it is used under, and how many BOM lines use it (FIX-04). The user ticks the ones to
  expand ("Expand All" is offered). A tick applies to every place the item is used, as the dialog says. Their components
  replace them there, recursively, up to 6 levels.
- **The ticks are saved** with the IA, so a BOM sync cannot erase them. "Prepare BOM" pre-sets them again.
- **Expansion rules**
  - Quantities are scaled at every BOM level: the parent's required quantity is converted to the child BOM's base unit.
  - Each level's allowance (wastage %) is applied.
  - Leaves with the same item and unit are combined, and every path is kept as evidence.
  - Serial-numbered components are rounded up.
  - Reference-only rows (`consume_type = REF`) are never consumed or expanded.
  - If a BOM line ever carries an explicit child BOM reference (`bom_type = reference` + `ref_bom_id`), that child BOM is used,
    both in the Flat list (its version is shown) and in the expansion.
- **Preparation stops** with a message naming the item and its BOM path when:
  - there is no active BOM, or a BOM is empty;
  - a ticked item has no BOM, or a referenced BOM is missing;
  - a base quantity is 0, or a unit conversion is missing (never assumed 1:1);
  - the expansion loops back on itself (a cycle), or goes deeper than 6 levels;
  - there are more than 5,000 paths, or more than 1,000 component lines (the posting limit);
  - a database read fails (shown as a failure, never as an empty BOM).
- **After a failed preparation**, the previous item, mode, quantity and lines stay as they were (SC26).
- **Prepare BOM** re-reads the current BOM and lists the differences: added, removed and changed components, and the BOM version.
  "Rebuild" applies them, "Keep" leaves everything as it was.
- **Opening a saved IA never re-prepares it.** Its saved lines and picks are shown as saved, and later BOM edits do not change
  them (SC23).

**Actual output and materials (IA04)**
- **Changing Output to Receive** on a linked or Flat IA recalculates the reference quantities from the saved snapshot. It
  never re-reads the BOM and never runs today's BOM re-scale.
- **Lines still at their old reference** (untouched) can be re-allocated for the new reference ("Re-allocate"), or keep their
  picks ("Keep picks").
- **Kept as entered:**
  - lines the user edited;
  - lines picked from a handling unit;
  - serial-numbered lines (they are named so the user picks their serial numbers again).
- **Old IAs** keep today's "Re-scale / Keep" question.
- **Changing the plant** on a prepared IA rebuilds the lines from the snapshot and re-allocates them. Today the lines are
  simply cleared.
- **Manual component lines** (added, removed or changed by the user) are still allowed. The snapshot is a reference, not a
  whitelist (SC22).

**Completion (IA05)**
- **The BOM-variance check** (Complete, and Complete & Post) compares the lines with the prepared BOM at the actual quantity,
  not with the latest BOM. It lists changed, added and removed components, plus the linked SO line's warnings.
- **Warnings never block.** If the SO figures cannot be read, the check says so and the user can still complete.
- **It refuses to complete:**
  - a Flat line that consumes a sub-assembly which was expanded;
  - reference quantities that no longer match the quantity.
- **The existing completion owners** still post: the normal save for small assemblies, the background completion for more
  than 50 stock picks. Stock, costing, batch, serial, handling-unit and posting rules are unchanged.
- **Size:** an IA with serial-numbered components can only complete through the normal save, which takes at most 250 stock
  picks. If preparing the BOM already gives more, the form says so straight away, so the planner can split the IA.
- **The server re-checks everything before writing anything** (section 4). Saving a Draft first is not required (SC20).

**Clone and other pages**
- **Clone** of a linked or Flat IA drops the link, its history and the plan. A Flat IA keeps its expansion choices and is
  prepared again from the current BOM. A Standard IA becomes an ordinary clone.
- **View, Completed and Processing IAs** show the Sales Order Link section read-only.

## 3. The Sales Order side (SO01, SO02)

**Two new row actions on each saved SO line**
- **Linked IAs** opens the "SO Linked IAs" page in a dialog. It works on a viewed SO too.
- **Create IA** appears only on a line of an Issued or Processing SO that is not Completed or Cancelled. It opens the same
  page, which re-checks the line and then opens the normal IA form, pre-filled with:
  - the item;
  - the SO and the exact line;
  - Standard mode;
  - plan and quantity = the suggestion, converted to the IA's unit (e.g. a line of 10 CTN gives 120 EA).

  It does not reserve, post or create anything until the user saves. If the line is no longer open when the form
  opens (for example the SO was cancelled in between), the form says why and continues as an ordinary Item Assembly for the item.
- **Permissions:** each action has its own permission, `so_item_linked_ias` and `so_item_create_ia`. They are buttons under
  the Sales Order menu, granted per role.

**The SO Linked IAs page**

| Part | Contents |
|---|---|
| Summary | Read-only rows, as in the IA form's section: Sales Order and line, Customer, Item, Ordered, Delivered (left); Planned, Produced, In Progress, Remaining to Plan with how it is worked out, or Unavailable and why (right); any warning (full width). |
| The line's IAs | Number, status, mode, Planned Output, Output to Receive (Draft and Processing IAs), Actual Received (Completed and Fully Posted IAs), unit, and what it counts as (produced, open, not counted). **Open** shows the IA: a Draft to edit, any other status to view. |
| IAs whose line was removed | Listed apart, only when there are some (section 5). |
| Buttons | Create Item Assembly (only on an eligible line), Refresh, Close. |

- The page is set up to refresh when an IA saved from it closes (to be confirmed in the browser test; otherwise Refresh does it).
- A failed read shows "unavailable", never zero (SC18, SC24).
- Opening the page changes nothing.

## 4. Figures, warnings and server checks (IA02, IA06, 14.9)

**The quantities (FIX-01)**
- Nothing records which receipt a delivery came from, so the remaining quantity has two bounds, in the SO line's unit:
  - `lowest = max(0, ordered - delivered - produced - open)`: no delivery came from the linked production;
  - `highest = max(0, ordered - max(delivered, produced) - open)`: every delivery came from it.
- **Remaining to Plan** = that figure when both bounds are equal (nothing delivered, nothing produced, or the line covered
  either way). Otherwise it is **Unavailable**, with the reason, and the planner enters the quantity.
- **ordered** = the line's ordered quantity.
- **delivered** = the native delivered quantity.
- **undelivered** = ordered - delivered (not below 0).
- **produced** = the actual quantity of linked IAs that are Completed or Fully Posted.
- **open** = the quantity of linked IAs that are Draft, Processing or Issued.
- **planned** = each IA's plan, or its quantity if it has no plan.
- **Units:** IA quantities are converted to the line's unit. If one cannot be converted, the figures say "unavailable"
  instead of counting it as 0.
- **Demand:** only an SO that is Issued or Processing, with a line not Completed or Cancelled, has demand. Otherwise the
  suggestion is 0, and a 0 is shown as 0.
- **The IA being edited:**
  - a Draft being edited is left out of "open in other IAs", and its own quantity counts once in the coverage and excess figures;
  - a new unsaved IA is not counted until it is saved;
  - a viewed or completed IA is counted once, inside the totals.
- **Excess** = coverage beyond the ordered quantity. When delivered and produced are both above 0, the smallest possible excess
  is shown ("at least"). It never blocks.
- **Organisation (FIX-03):** a Sales Order line's figures are shown only for its own organisation, and only to a user
  assigned to that organisation or one of its plants.

**Warnings:** the line was removed; the SO was removed, cancelled, void, completed, Draft or inactive; the line was cancelled
or completed; the line's item, unit or ordered quantity changed since the link (reduced); excess; a unit that cannot be
converted; an IA with an unknown status. None of them changes or blocks anything. The baseline figures are the ones taken at
link time, so a "reduced" warning stays visible on every later open (SC15, SC25).

**What the server checks on every save (classic and background completion alike)**
- **A new link** (or a change to another line):
  - the user saving is assigned to the IA's organisation or one of its plants (FIX-03);
  - the line exists and belongs to that SO;
  - it is for the IA's item and the IA's organisation (an IA without an organisation cannot be linked);
  - its SO is Issued or Processing, and the line is not Completed or Cancelled;
  - the baseline is rebuilt from the server's own read, never taken from the browser.
- **An existing link** may stay on a line that was later reduced, cancelled or removed. That is a warning, not a refusal.
- **The IA's item changed while it keeps its link:** refused (unlink first). If the item was changed on the SO line instead,
  it is only a warning.
- **Always refused:**
  - half a link (the SO without the line, or the line without the SO);
  - an unknown mode;
  - Flat without a prepared BOM;
  - a snapshot that no longer matches the IA's item, unit, mode or root BOM.
- **On completion:** the reference quantities must match the snapshot at the actual quantity, and no expanded sub-assembly
  may be consumed.
- **Old or mobile app saves** that do not send the new fields keep the stored values, and each component line keeps its link
  to the prepared BOM.
- **Link history:** LINK, RELINK and UNLINK, each with time and user, the last 20 kept. Only the server writes it.

## 5. SO lines that are re-created

Mobile SO edits and the accounting sync can re-create SO lines with new ids. A linked IA then points at a line that is gone.
This is detected, not prevented: the page and the IA show "line removed", and the SO page lists those IAs. Re-linking is
manual:
- **Draft:** edit it and Select SO Line again.
- **Completed or Fully Posted:** the **Re-link** button, only onto a current line of the same SO, item and organisation,
  and only by a user assigned to that organisation. Only the link and its history change; stock and costs stay.
  - It is refused while the IA is being processed.
  - It is refused if the IA's link or status changed since the user opened it (FIX-06).
  - The history records the old line and its baseline, the new line, who, when and why.

No change was made to the SO save itself.

## 6. Decisions made during implementation (please validate)

| # | Contract wording | What was decided | Why |
|---|---|---|---|
| D1 | BOM01: Flat follows an explicit child-BOM reference on the BOM line | Flat expands the sub-assemblies the user ticks on each IA, among those with their own active BOM. An explicit reference, if one is ever set, still picks the child BOM. | No BOM in any tenant has an explicit child reference, and the accounting BOM sync rewrites component rows, so reference-driven Flat could never run for these customers. |
| D2 | IA02: avoid counting a delivery and the production behind it twice | **Replaced by FIX-01 (21 October):** the figure is given only when it does not depend on the overlap; otherwise Unavailable, with the reason. | Deliveries carry no receipt identity to link them to an IA, so the overlap cannot be worked out. |
| D3 | SO02: "native undelivered / outstanding quantity" | Undelivered is computed as ordered - delivered. | The native outstanding field is wrong on many existing lines (8,354 on prod). |
| D4 | 14.7: new records default to STANDARD | New standalone IAs keep an empty mode (old behaviour); linking sets Standard; Flat is chosen. | Only linked or Flat IAs use the new behaviour, so every other IA stays exactly as it is. |
| D5 | 14.7: ids as native bigint FK types | The SO, line and BOM ids are stored as text, like the existing item field. | Lossless (no rounding of long ids); same handling as the form's other references. |
| D6 | 14.7: a proposed context shape | The context holds the SO, line, customer, item, ordered quantity, unit, both statuses, linked at / by, and the history. | The same information, plus the link history. |
| D7 | IA02 / 14.7: the open supply of a Draft | Open coverage of a Draft or Processing IA = its quantity (what completion will receive); the plan is shown apart. | The quantity is what will be received. |
| D8 | 14.7: clone policy left to the developer | Clone drops the link and the plan; Flat keeps its choices and is prepared again. | A clone is a new production run and must not inherit another IA's link. |
| D9 | 10: costing | Flat consumes leaf components at their own cost. The finished good's receipt cost = consumed cost / quantity + the finished good's own assembly cost; intermediates' assembly costs are not added. Non-stock (labour / overhead) lines are allowed but add no cost. | The existing receipt-cost rule, unchanged; no new labour or machine costing. |
| D10 | 2: which apps | Desktop only. The mobile app keeps today's behaviour, except that from its next release a linked or Flat IA's plant, BOM item and quantity are read-only there (changed on desktop). | Mobile has its own release; the mobile app cannot prepare a BOM the Small Cycle way, so it must not rebuild those lines. |
| D11 | IA06: keep a history of changes | **FIX-05 (21 October):** the platform's own field history is on for the IA's SO link and context, plan, Output to Receive, mode, root BOM, BOM snapshot, item and status (who, when, the new value; every save path), in `sm_item_assembly_history`. The link history inside the IA (last 20) stays as a quick view. | The platform has a per-field history; it was off for the IA. |
| D12 | IA02: "Use suggested quantity" | **Use Suggestion** sets both Planned Output and Output to Receive and says so. A suggestion of 0, or Unavailable, changes nothing. | A deliberate action may fill the Draft; 0 is shown, never turned into 1. |
| D13 | SO01: who may use the shortcut | Two separate permissions: Linked IAs, and Create IA. | Seeing figures and creating IAs are different rights. |

## 7. What is tested and what is left

**Automated:** more than 1,000 checks run against the built forms and workflows, in a mock of the platform. They include:
- every old-IA path, compared call for call with the current version;
- the resolver over all 899 BOMs of the test tenant;
- mutation tests: 255 deliberately planted bugs, all caught;
- an independent code review, whose findings were fixed.

**Live on DEV (20 October):**
- every part published, each read back identical to the build;
- the database columns created with the right types;
- every new SQL run against the real tables;
- both save workflows smoke-run;
- the SO-line figures and the line list read correctly for a real SO line (SO/20261014-030 in the test tenant).

**Live on DEV (21 October):** FIX-01, FIX-02, FIX-04 (10:18), UI-01 (11:01) and FIX-03, FIX-05, FIX-06 (11:29) published, each
read back identical to the build. The organisation check was run against the real user and department tables, and each new
workflow version answered a smoke run with its new refusal (nothing written). The IA history table was created by the
publish; the first IA saved on DEV will show its first history rows.

**Still to run:**
- **Browser checks:** none of the screens has run in a real browser yet.
  - Saving an existing IA the old way comes first.
  - Then the SO line's Linked IAs and Create IA, linking, Flat, quantity changes and completion.
- **The acceptance scenarios** SC01-SC26 on DEV with test data.
- **After the deployment:** the two permissions set up and granted on PROD. Until then the SO row actions stay hidden there.

| SC | Covered by the automated tests | Live |
|---|---|---|
| SC01, SC19 standalone / legacy | Yes: old IAs run unchanged, call for call | pending |
| SC02 SO entry vs IA screen | Yes | pending |
| SC03 same item on two lines / customers | Yes: exact line kept, lines listed apart | pending |
| SC04-SC06 suggestion, excess, covered or cancelled lines | Yes (the contract's examples) | pending |
| SC07-SC09 Standard / Flat, scaling, UOM, allowance, serial, REF, cycles, bad data | Yes (the contract's Box / Frame / Panel examples + 899 real BOMs) | pending |
| SC10, SC21, SC23, SC26 changes on a Draft, actual output, reopen, failed rebuild | Yes | pending |
| SC11, SC12 short completion and a later IA | Yes (figures and line handling; posting by the unchanged owners) | pending |
| SC13, SC14 the worked cycle in section 11 | Yes: 100 / 0 / 100 and plans 100 / actual 30 / open 60 / unplanned 10; after delivering 30, suggestion still 10 | pending |
| SC15, SC24, SC25 source reduced or cancelled, edited IA, failed read | Yes | pending |
| SC16 double click, concurrency | Existing guards unchanged (not specific to this release) | pending |
| SC17 full reversal | Existing reversal unchanged; a reverted IA counts as open again | pending |
| SC18 other organisation / tenant, failed read | Yes (tenant from the session, organisation checked on the server) | pending |
| SC20 Complete without saving a Draft first | Yes | pending |
| SC22 manual component variance | Yes | pending |

## 8. Please confirm (yes / no)

1. Flat expands the sub-assemblies the user ticks on each IA, saved with the IA (D1).
2. Settled by FIX-01: the remaining quantity is exact or Unavailable (D2). Still to confirm: undelivered = ordered - delivered
   (D3).
3. Only linked or Flat IAs use the new behaviour; other IAs keep today's behaviour exactly (D4).
4. An open Draft counts its quantity, not its plan (D7).
5. The clone policy (D8).
6. The cost rule for Flat (D9).
7. Desktop only for now; on mobile, a linked or Flat IA's plant, BOM item and quantity become read-only (D10).
8. A removed SO line is detected and shown, and re-linked by hand (section 5).
9. Warnings never block a save or a completion. Only invalid links, an invalid or stale BOM preparation, and consuming an
   expanded sub-assembly are refused (section 4).
10. The two separate SO-line permissions (D13).
11. UI-01: the Plant stays at the top of the IA form, next to the IA number, not under Output Location, because changing the
    plant clears the materials.
12. FIX-03: the server checks that the user belongs to the record's organisation. Menu rights (who may open the IA or use the
    SO buttons) stay a screen check, because the platform has no permission per workflow.
