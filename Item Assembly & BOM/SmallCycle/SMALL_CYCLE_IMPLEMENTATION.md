# Small Cycle Item Assembly: what was implemented

For validation against the "Small Cycle IA implementation Contract" (19 October 2026, ENH-20261015-010 / 011).
Date: 20 October 2026, updated 17:50. Status: built and live on DEV; it goes to PROD with the 21 October full deployment.
Testing in a real browser and the acceptance scenarios SC01-SC26 are **still to run** (section 7).

Please confirm two things: that the behaviour in sections 2-5 is what was asked for, and that the decisions in section 6
are acceptable. Each line in section 8 needs a yes or a no.

## Changes since the version of 20 October, 16:22

This copy replaces the one sent at 16:22. The points to confirm in section 8 are the same; only point 7 (mobile) gains a note.

- **The Sales Order Link on the IA form (section 2).** It was one text box. It is now its own collapsible section under the
  header fields, with read-only labelled rows: the SO line, its customer, ordered and delivered on the left; produced, in
  progress, Suggested Qty (with how it is worked out) and After This IA on the right; the BOM used and any warning below.
  Section 2 has an example.
- **The SO "Linked IAs" page (section 3)** shows its summary the same way.
- **Linking (section 2):** if the IA has no component lines yet, a quantity already entered becomes the plan.
- **Flat (section 2):** when a BOM line names a specific BOM for its sub-assembly, the list of sub-assemblies to expand now
  uses that BOM too and shows its version. Before, only the expansion itself used it.
- **Size (section 2, Completion):** an IA with serial-numbered components and more than 250 stock picks is told to split when
  its BOM is prepared, instead of finding out only at completion.
- **Create IA (section 3):** if the SO line is no longer open when the form opens, the form says why and carries on as an
  ordinary IA for that item.
- **Organisation (section 4):** a Sales Order line's figures are shown only within its own organisation, and an IA without an
  organisation cannot be linked.
- **Mobile (decision D10, point 7):** Small Cycle stays desktop-only, but the mobile app is no longer left exactly as it was.
  From its next release, a linked or Flat IA's plant, BOM item and quantity are read-only on mobile (they are changed on
  desktop), and every other mobile edit keeps each component line's link to the prepared BOM. Until that release, the server
  keeps those links when an older app saves such an IA.

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
| Planned Output Qty | The plan. The existing Quantity (`item_qty`) stays the actual output that is posted. |
| Sales Order Link (section) | A collapsible section under the header fields. Read-only rows, each shown only when it applies: Sales Order and line, Customer, Ordered, Delivered (left); Produced, In Progress, Suggested Qty with how it is worked out, After This IA (right); the BOM used, and any warning (full width, in the error style). Its buttons sit on one row below. |
| Hidden fields | The SO header and line ids, the link context (baseline figures and link history), the root BOM, the BOM snapshot, and a reference key on each component line. |

**New buttons:** Select SO Line, Unlink, Re-link, Use Suggested Qty, Prepare BOM, Refresh Figures. Each one shows only where
it applies.

**Example: a Draft of 6 PCS linked to a line of 10 PCS**

```
▾ Sales Order Link
  Sales Order   SO/20261020-053 · line 1          Produced        0 PCS
  Customer      TEST MUITIPLE CURRENCY            In Progress     0 PCS in other open IAs
  Ordered       10 PCS                            Suggested Qty   10 PCS = 10 ordered − 0 produced − 0 in progress
  Delivered     0 PCS                             After This IA   4 PCS still needed
  BOM           Standard · V1 · prepared 2026-10-20
  [Select SO Line] [Unlink] [Use Suggested Qty] [Prepare BOM] [Refresh Figures]
```

- **Suggested Qty** takes off the larger of delivered and produced, then what other open IAs already plan (decision 4).
- **After This IA** follows the Quantity as it is typed: "4 PCS still needed", or "fully covered". Above the order a message
  replaces it: "⚠ This Item Assembly makes 2 PCS more than ordered. You can still save."
- On a viewed, Completed or Processing IA, Suggested Qty and After This IA are not shown (the IA is already in the figures),
  and In Progress counts every open IA. An ordinary IA (not linked, not Flat) shows no section on a view.

**Linking an IA to an SO line (IA01)**
- **Select SO Line** lists the open lines for the IA's item. A line is open when its SO is Issued or Processing and the line is
  not Completed or Cancelled. The list shows the SO number, line, customer, ordered, delivered, the suggestion and the unit.
  Repeated lines of the same item, and lines of different customers, are listed separately.
- **If the IA already has component lines**, linking keeps them and their stock picks; the BOM snapshot is taken from them.
- **If the IA has no component lines**, linking prepares them from the BOM and auto-allocates stock, as today. A quantity
  already entered becomes the plan.
- **If the quantity is still 0**, linking fills the plan and the quantity with the suggestion. Otherwise the user's quantity
  is kept and the suggestion is only shown.
- **Unlink** removes the link. A Standard IA then returns to the old behaviour, keeping its lines. A Flat IA stays Flat. The
  link history keeps the unlink.
- **Changing the item** of a linked IA asks first, because it removes the link. "Keep Item" puts the old item back.

**Standard and Flat (IA03, BOM01-BOM03)**
- **Standard** gives the same component lines as today's BOM explosion. Compared over all 899 BOMs of the test tenant, the
  lines were identical.
- **Choosing Flat** opens a dialog that lists the sub-assemblies with their own active, non-empty BOM: level, BOM version and
  where each is used. The user ticks the ones to expand ("Expand All" is offered). Their components replace them at every
  occurrence, recursively, up to 6 levels.
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
- **Changing the Quantity** on a linked or Flat IA recalculates the reference quantities from the saved snapshot. It never
  re-reads the BOM and never runs today's BOM re-scale.
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
- **View, Completed and Processing IAs** show the Sales Order panel read-only.

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
| Summary | Read-only rows, as in the IA form's section: Sales Order and line, Customer, Item, Ordered, Delivered (left); Planned, Produced, In Progress, Suggested Qty with how it is worked out (right); any warning (full width). |
| The line's IAs | Number, status, mode, planned, actual, unit, and what it counts as (produced, open, not counted). **Open** shows the IA: a Draft to edit, any other status to view. |
| IAs whose line was removed | Listed apart, only when there are some (section 5). |
| Buttons | Create Item Assembly (only on an eligible line), Refresh, Close. |

- The page is set up to refresh when an IA saved from it closes (to be confirmed in the browser test; otherwise Refresh does it).
- A failed read shows "unavailable", never zero (SC18, SC24).
- Opening the page changes nothing.

## 4. Figures, warnings and server checks (IA02, IA06, 14.9)

**The quantities**
- `Suggestion = max(0, ordered - max(delivered, produced) - open)`, in the SO line's unit.
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
- **Excess** = coverage beyond the ordered quantity. It is shown, but it never blocks.
- **Organisation:** a Sales Order line's figures are shown only for its own organisation.

**Warnings:** the line was removed; the SO was removed, cancelled, void, completed, Draft or inactive; the line was cancelled
or completed; the line's item, unit or ordered quantity changed since the link (reduced); excess; a unit that cannot be
converted; an IA with an unknown status. None of them changes or blocks anything. The baseline figures are the ones taken at
link time, so a "reduced" warning stays visible on every later open (SC15, SC25).

**What the server checks on every save (classic and background completion alike)**
- **A new link** (or a change to another line):
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
- **Completed or Fully Posted:** the **Re-link** button, only onto a current line of the same SO, item and organisation.
  Only the link and its history change; stock and costs stay. It is refused while the IA is being processed.

No change was made to the SO save itself.

## 6. Decisions made during implementation (please validate)

| # | Contract wording | What was decided | Why |
|---|---|---|---|
| D1 | BOM01: Flat follows an explicit child-BOM reference on the BOM line | Flat expands the sub-assemblies the user ticks on each IA, among those with their own active BOM. An explicit reference, if one is ever set, still picks the child BOM. | No BOM in any tenant has an explicit child reference, and the accounting BOM sync rewrites component rows, so reference-driven Flat could never run for these customers. |
| D2 | IA02: avoid counting a delivery and the production behind it twice | `max(delivered, produced)`: linked production and the line's deliveries are assumed to overlap. | Deliveries carry no receipt identity to link them to an IA. If the line was delivered from unrelated stock, the suggestion is lower than strictly needed (it never over-suggests because of that). |
| D3 | SO02: "native undelivered / outstanding quantity" | Undelivered is computed as ordered - delivered. | The native outstanding field is wrong on many existing lines (8,354 on prod). |
| D4 | 14.7: new records default to STANDARD | New standalone IAs keep an empty mode (old behaviour); linking sets Standard; Flat is chosen. | Only linked or Flat IAs use the new behaviour, so every other IA stays exactly as it is. |
| D5 | 14.7: ids as native bigint FK types | The SO, line and BOM ids are stored as text, like the existing item field. | Lossless (no rounding of long ids); same handling as the form's other references. |
| D6 | 14.7: a proposed context shape | The context holds the SO, line, customer, item, ordered quantity, unit, both statuses, linked at / by, and the history. | The same information, plus the link history. |
| D7 | IA02 / 14.7: the open supply of a Draft | Open coverage of a Draft or Processing IA = its quantity (what completion will receive); the plan is shown apart. | The quantity is what will be received. |
| D8 | 14.7: clone policy left to the developer | Clone drops the link and the plan; Flat keeps its choices and is prepared again. | A clone is a new production run and must not inherit another IA's link. |
| D9 | 10: costing | Flat consumes leaf components at their own cost. The finished good's receipt cost = consumed cost / quantity + the finished good's own assembly cost; intermediates' assembly costs are not added. Non-stock (labour / overhead) lines are allowed but add no cost. | The existing receipt-cost rule, unchanged; no new labour or machine costing. |
| D10 | 2: which apps | Desktop only. The mobile app keeps today's behaviour, except that from its next release a linked or Flat IA's plant, BOM item and quantity are read-only there (changed on desktop). | Mobile has its own release; the mobile app cannot prepare a BOM the Small Cycle way, so it must not rebuild those lines. |
| D11 | IA06: keep a history of changes | The link history is kept, but there is no separate history of plan, mode or BOM-version changes. The snapshot records when and by whom it was prepared. | The IA has no history mechanism; the contract says "where possible". |
| D12 | IA02: "Use suggested quantity" | It sets both the plan and the quantity. A suggestion of 0 changes nothing. | A deliberate action may fill the Draft; 0 is shown, never turned into 1. |
| D13 | SO01: who may use the shortcut | Two separate permissions: Linked IAs, and Create IA. | Seeing figures and creating IAs are different rights. |

## 7. What is tested and what is left

**Automated:** more than 1,000 checks run against the built forms and workflows, in a mock of the platform. They include:
- every old-IA path, compared call for call with the current version;
- the resolver over all 899 BOMs of the test tenant;
- mutation tests: 162 deliberately planted bugs, all caught;
- an independent code review, whose findings were fixed.

**Live on DEV (20 October):**
- every part published, each read back identical to the build;
- the database columns created with the right types;
- every new SQL run against the real tables;
- both save workflows smoke-run;
- the SO-line figures and the line list read correctly for a real SO line (SO/20261014-030 in the test tenant).

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
2. The suggestion uses `max(delivered, produced)` for the overlap between production and delivery (D2), and undelivered =
   ordered - delivered (D3).
3. Only linked or Flat IAs use the new behaviour; other IAs keep today's behaviour exactly (D4).
4. An open Draft counts its quantity, not its plan (D7).
5. The clone policy (D8).
6. The cost rule for Flat (D9).
7. Desktop only for now; on mobile, a linked or Flat IA's plant, BOM item and quantity become read-only (D10).
8. A removed SO line is detected and shown, and re-linked by hand (section 5).
9. Warnings never block a save or a completion. Only invalid links, an invalid or stale BOM preparation, and consuming an
   expanded sub-assembly are refused (section 4).
10. The two separate SO-line permissions (D13).
